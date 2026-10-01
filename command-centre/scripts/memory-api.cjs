#!/usr/bin/env node
/**
 * memory-api — the hosted memory ingest/search API server.
 *
 * Runs the node:http transport (src/lib/memory/server.ts) over the same memory
 * store every memory:* command uses. Deploy it NEXT TO the hosted Postgres
 * (Railway/VPS): consumers then reach team memory with a URL + token instead of
 * raw database credentials, and scope filtering + audit happen server-side.
 *
 * Environment:
 *   MEMORY_API_TOKEN        REQUIRED. Bearer token for /v1/memory/*. The server
 *                           refuses to start without it (fail closed).
 *   MEMORY_API_PORT         Port to listen on. Falls back to PORT (the Railway
 *                           convention), then 8787.
 *   MEMORY_DATABASE_URL     Hosted Postgres URL (or DATABASE_URL). With neither
 *                           set, the server runs on local PGLite — fine for dev,
 *                           not what you want hosted.
 *   MEMORY_STORE_BACKEND    auto | pglite | postgres (see backend.ts).
 *   MEMORY_EMBEDDER         Optional compatibility label. Hosted API accepts
 *                           client-provided bge-m3/1024 embeddings only.
 *   MEMORY_MODEL_CACHE_DIR  Optional BGE-M3 model cache. Defaults to
 *                           <AI_OS_DIR>/.command-centre/models.
 *   MEMORY_API_SERVER_EMBEDDINGS
 *                           Set to 1 to let /v1/memory/search embed query text
 *                           server-side with BGE-M3.
 *   MEMORY_API_TEAM_ID      Team id resolved by the server for token auth.
 *   MEMORY_API_USER_ID      User id resolved by the server for token auth.
 *   MEMORY_API_TEAM_SLUG    Alternative to MEMORY_API_TEAM_ID for Docker/dev.
 *   MEMORY_API_USER_EMAIL   Alternative to MEMORY_API_USER_ID for Docker/dev.
 *   MEMORY_API_BOOTSTRAP_TEAM_SLUG   Optional: create this team before serving.
 *   MEMORY_API_BOOTSTRAP_TEAM_NAME   Optional display name for bootstrap team.
 *   MEMORY_API_BOOTSTRAP_OWNER_EMAIL Optional: create this owner before serving.
 *   TEAM_OS_GITHUB_BACKUP_REMOTE     Optional: private GitHub remote for server
 *                           workspace file backup.
 *   TEAM_OS_GITHUB_BACKUP_TOKEN      Required when the backup remote is set.
 *                           Used for HTTPS push and never written to Git config.
 *   TEAM_OS_GITHUB_BACKUP_INTERVAL_SECONDS
 *                           Optional backup interval. Defaults to 900.
 *   PGSSLMODE               disable | require | no-verify (see postgres-adapter).
 *
 * Usage:
 *   MEMORY_API_TOKEN=... npm run memory:api
 *   MEMORY_API_TOKEN=... MEMORY_API_PORT=9000 node scripts/memory-api.cjs
 *
 * Endpoints (full contract in docs/memory/hosted-api.md):
 *   GET  /v1/health          liveness + backend/embedder info (no auth)
 *   GET  /v1/team/whoami     resolved user/team context
 *   GET  /v1/team/clients    clients granted to the resolved user
 *   GET  /v1/workspace/manifest granted client file manifest
 *   GET  /v1/workspace/file     read one granted client file
 *   PUT  /v1/workspace/file     write one granted client file
 *   GET  /v1/memory/imports  list manual imports and failures
 *   POST /v1/memory/imports  admin manual shared content import
 *   POST /v1/memory/imports/retry retry a manual import
 *   POST /v1/memory/search   { query, queryEmbedding... } or { query, embeddingMode:"server", ... }
 *   POST /v1/memory/ingest   { scope, sourcePath, chunks, embeddingModel, embeddingDim, ... }
 *
 * The .ts library is loaded the same way the other memory commands load it —
 * via loadTsModule, leaf-first (scripts/load-memory-modules.cjs). There is no
 * build step in this repo; this is the supported runtime path.
 */

const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const path = require("node:path");

const { loadMemoryModules } = require("./load-memory-modules.cjs");
const { loadIdentityModules } = require("./load-identity-modules.cjs");
const { findWorkspaceRoot } = require("./workspace-root.cjs");

const USAGE = `memory-api — hosted memory ingest/search API server

Usage:
  MEMORY_API_TOKEN=<token> node scripts/memory-api.cjs

Environment:
  MEMORY_API_TOKEN       required — bearer token for /v1/memory/* (fail closed)
  MEMORY_API_PORT        port (default 8787)
  MEMORY_DATABASE_URL    hosted Postgres URL; unset = local PGLite (dev only)
  MEMORY_STORE_BACKEND   auto | pglite | postgres
  MEMORY_EMBEDDER        optional; hosted API accepts bge-m3 client-provided vectors only
  MEMORY_MODEL_CACHE_DIR optional BGE-M3 model cache; defaults to <AI_OS_DIR>/.command-centre/models
  MEMORY_API_SERVER_EMBEDDINGS
                         set to 1 to allow /v1/memory/search embeddingMode:"server"
  MEMORY_API_TEAM_ID     required in hosted mode
  MEMORY_API_USER_ID     required in hosted mode
  MEMORY_API_TEAM_SLUG   alternative to MEMORY_API_TEAM_ID
  MEMORY_API_USER_EMAIL  alternative to MEMORY_API_USER_ID
  MEMORY_API_BOOTSTRAP_TEAM_SLUG / MEMORY_API_BOOTSTRAP_OWNER_EMAIL
                         optional Docker/dev bootstrap owner
  TEAM_OS_GITHUB_BACKUP_REMOTE
                         optional private GitHub remote for server workspace backup
  TEAM_OS_GITHUB_BACKUP_TOKEN
                         required with the backup remote; not written to Git config
  TEAM_OS_GITHUB_BACKUP_INTERVAL_SECONDS
                         backup interval in seconds (default 900; 0 disables)

Team endpoints:
  GET /v1/team/whoami
  GET /v1/team/clients

Workspace endpoints:
  GET /v1/workspace/manifest
  GET /v1/workspace/file?path=clients/<client>/<file>
  PUT /v1/workspace/file?path=clients/<client>/<file>

Manual import endpoints:
  GET  /v1/memory/imports
  POST /v1/memory/imports
  POST /v1/memory/imports/retry`;

function envValue(key) {
  return (process.env[key] ?? "").trim();
}

function envValueFirst(keys) {
  for (const key of keys) {
    const value = envValue(key);
    if (value) return value;
  }
  return "";
}

function hasValue(value) {
  return typeof value === "string" && value.trim() !== "";
}

function requireBothOrNeither(left, right, message) {
  if (hasValue(left) !== hasValue(right)) {
    throw new Error(message);
  }
}

function resolveExpectedEmbedding() {
  const rawModel =
    envValue("MEMORY_EMBEDDING_MODEL") ||
    envValue("MEMORY_EMBEDDER") ||
    "bge-m3";
  const model = rawModel === "local" ? "bge-m3" : rawModel;
  if (model !== "bge-m3") {
    throw new Error(
      `Hosted Memory API accepts client-provided bge-m3 embeddings only; got ${rawModel}. ` +
        "Remove MEMORY_EMBEDDER=hash or set MEMORY_EMBEDDER=bge-m3.",
    );
  }
  const rawDim = envValue("MEMORY_EMBEDDING_DIM") || "1024";
  const dim = Number(rawDim);
  if (!Number.isInteger(dim) || dim !== 1024) {
    throw new Error("Hosted Memory API expects BGE-M3 vectors with 1024 dimensions.");
  }
  return { model, dim };
}

async function bootstrapIdentity(identityStore) {
  const slug = envValue("MEMORY_API_BOOTSTRAP_TEAM_SLUG");
  const ownerEmail = envValue("MEMORY_API_BOOTSTRAP_OWNER_EMAIL");
  requireBothOrNeither(
    slug,
    ownerEmail,
    "MEMORY_API_BOOTSTRAP_TEAM_SLUG and MEMORY_API_BOOTSTRAP_OWNER_EMAIL must be set together.",
  );
  if (!slug) return null;

  let team = await identityStore.getTeamBySlug(slug);
  if (!team) {
    team = await identityStore.createTeam({
      slug,
      name: envValue("MEMORY_API_BOOTSTRAP_TEAM_NAME") || slug,
    });
  }

  const owner = await identityStore.upsertUser({
    email: ownerEmail,
    displayName: envValue("MEMORY_API_BOOTSTRAP_OWNER_NAME") || null,
  });
  await identityStore.upsertMembership({
    teamId: team.id,
    userId: owner.id,
    role: "owner",
    status: "active",
  });
  const companyMemberships = await identityStore.listCompanyMemberships();
  if (!companyMemberships.some((membership) => (
    membership.role === "owner" && membership.status === "active"
  ))) {
    await identityStore.recoverCompanyOwner({ userId: owner.id });
  }

  return { team, owner };
}

async function resolveServerPrincipal(identityStore) {
  let teamId = envValue("MEMORY_API_TEAM_ID");
  let userId = envValue("MEMORY_API_USER_ID");
  const teamSlug = envValue("MEMORY_API_TEAM_SLUG") || envValue("MEMORY_API_BOOTSTRAP_TEAM_SLUG");
  const userEmail = envValue("MEMORY_API_USER_EMAIL") || envValue("MEMORY_API_BOOTSTRAP_OWNER_EMAIL");

  requireBothOrNeither(
    teamId,
    userId,
    "MEMORY_API_TEAM_ID and MEMORY_API_USER_ID must be set together.",
  );
  requireBothOrNeither(
    teamSlug,
    userEmail,
    "MEMORY_API_TEAM_SLUG and MEMORY_API_USER_EMAIL must be set together.",
  );

  if (!teamId && teamSlug) {
    const team = await identityStore.getTeamBySlug(teamSlug);
    if (!team) throw new Error(`MEMORY_API_TEAM_SLUG not found: ${teamSlug}`);
    teamId = team.id;
  }
  if (!userId && userEmail) {
    const user = await identityStore.getUserByEmail(userEmail);
    if (!user) throw new Error(`MEMORY_API_USER_EMAIL not found: ${userEmail}`);
    userId = user.id;
  }
  if (!teamId || !userId) return null;
  return {
    teamId,
    userId,
    authSource: "dev-token",
  };
}

function tokenMatches(provided, expected) {
  const a = crypto.createHash("sha256").update(String(provided)).digest();
  const b = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function resolveLockedDevPrincipal(principal, requestedTeamId) {
  if (requestedTeamId && requestedTeamId !== principal.teamId) {
    return {
      status: "blocked",
      statusCode: 403,
      code: "credential_team_mismatch",
      message: "this credential is locked to a different team",
    };
  }
  return { ...principal, authSource: "dev-token", teamScopeSource: "locked-token" };
}

function resolveGitHubBackupRuntime() {
  const remote = envValueFirst([
    "TEAM_OS_GITHUB_BACKUP_REMOTE",
    "TEAM_OS_WORKSPACE_BACKUP_REMOTE",
    "TEAM_OS_GIT_BACKUP_REMOTE",
  ]);
  if (!remote) return null;

  const token = envValueFirst([
    "TEAM_OS_GITHUB_BACKUP_TOKEN",
    "TEAM_OS_WORKSPACE_BACKUP_TOKEN",
    "TEAM_OS_GIT_BACKUP_TOKEN",
    "GITHUB_TOKEN",
    "GH_TOKEN",
  ]);
  if (!token) {
    console.warn("  backup:   GitHub backup remote is set, but TEAM_OS_GITHUB_BACKUP_TOKEN is missing.");
    return null;
  }

  const rawInterval =
    envValueFirst([
      "TEAM_OS_GITHUB_BACKUP_INTERVAL_SECONDS",
      "TEAM_OS_WORKSPACE_BACKUP_INTERVAL_SECONDS",
    ]) || "900";
  const intervalSeconds = Number(rawInterval);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 0) {
    console.warn(
      `  backup:   invalid TEAM_OS_GITHUB_BACKUP_INTERVAL_SECONDS="${rawInterval}"; using 900 seconds.`,
    );
    return { intervalMs: 900_000 };
  }
  return { intervalMs: Math.floor(intervalSeconds * 1000) };
}

function startGitHubBackupLoop(rootDir) {
  const config = resolveGitHubBackupRuntime();
  if (!config) {
    console.log("  backup:   GitHub workspace backup disabled");
    return null;
  }
  if (config.intervalMs === 0) {
    console.log("  backup:   GitHub workspace backup configured but periodic backup is disabled");
    return null;
  }

  const scriptPath = path.join(__dirname, "team-workspace-backup.cjs");
  let stopped = false;
  let running = false;
  let initialTimer = null;
  let intervalTimer = null;

  const runBackup = () => {
    if (stopped || running) return;
    running = true;
    const child = spawn(process.execPath, [scriptPath], {
      cwd: rootDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => {
      process.stdout.write(`[workspace-backup] ${chunk}`);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(`[workspace-backup] ${chunk}`);
    });
    child.on("close", (code) => {
      running = false;
      if (code !== 0) {
        console.error(`[workspace-backup] failed with exit code ${code}`);
      }
    });
    child.on("error", (error) => {
      running = false;
      console.error(`[workspace-backup] failed: ${error.message}`);
    });
  };

  initialTimer = setTimeout(runBackup, 5_000);
  initialTimer.unref();
  intervalTimer = setInterval(runBackup, config.intervalMs);
  intervalTimer.unref();
  console.log(`  backup:   GitHub workspace backup every ${Math.floor(config.intervalMs / 1000)}s`);

  return {
    stop() {
      stopped = true;
      if (initialTimer) clearTimeout(initialTimer);
      if (intervalTimer) clearInterval(intervalTimer);
    },
  };
}

async function warmServerSideSearchEmbedder(opts) {
  if (!opts.enabled) return null;

  opts.log("  embedder: warming server-side bge-m3 model...");
  try {
    const emb = await opts.serverEmbedder();
    opts.log(`  embedder: server-side ${emb.model} ready`);
    return emb;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      "server-side embedding warmup failed: the BGE-M3 model could not be " +
        `loaded or downloaded (${reason}). Fix the server network/cache/dependencies, ` +
        "or disable MEMORY_API_SERVER_EMBEDDINGS=1 to keep using client-provided embeddings.",
    );
  }
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }

  const token = (process.env.MEMORY_API_TOKEN ?? "").trim();
  if (token === "") {
    console.error(
      "memory-api: MEMORY_API_TOKEN is required — the hosted memory API never " +
        "serves unauthenticated. Set a strong token (e.g. `openssl rand -hex 32`).\n",
    );
    console.error(USAGE);
    return 1;
  }

  // MEMORY_API_PORT wins; PORT is the Railway/PaaS convention; 8787 the default.
  const rawPort = process.env.MEMORY_API_PORT ?? process.env.PORT ?? "8787";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`memory-api: invalid port "${rawPort}".`);
    return 1;
  }

  const rootDir = process.env.AI_OS_DIR
    ? path.resolve(process.env.AI_OS_DIR)
    : findWorkspaceRoot(__dirname);
  process.env.MEMORY_MODEL_CACHE_DIR =
    process.env.MEMORY_MODEL_CACHE_DIR || path.join(rootDir, ".command-centre", "models");

  const modules = loadMemoryModules({ withApi: true, withCapture: false });
  const { backend, embedder, reranker, store, server } = modules;
  const expectedEmbedding = resolveExpectedEmbedding();
  const serverEmbeddingsEnabled = envValue("MEMORY_API_SERVER_EMBEDDINGS") === "1";
  let serverEmbedderPromise = null;
  const serverEmbedder = async () => {
    if (!serverEmbedderPromise) {
      serverEmbedderPromise = embedder
        .createEmbedder({ kind: expectedEmbedding.model })
        .catch((error) => {
          serverEmbedderPromise = null;
          throw error;
        });
    }
    return serverEmbedderPromise;
  };

  const dataDir = path.join(rootDir, ".command-centre", "memory");
  // Resolve the engine up front (same pure rule openMemoryStore applies) so the
  // startup log says what this deployment actually serves. A failed resolution
  // (e.g. MEMORY_STORE_BACKEND=postgres with no URL) propagates as a hard error.
  const resolvedBackend = backend.resolveMemoryBackend({ dataDir }, process.env);

  const rerankConfig = reranker.loadRerankerConfig(rootDir);

  console.log(`memory-api → ${rootDir}`);
  console.log(`  backend:  ${resolvedBackend.kind}`);
  console.log(
    `  embedder: client-provided ${expectedEmbedding.model} (dim ${expectedEmbedding.dim})` +
      (serverEmbeddingsEnabled ? "; server search mode enabled" : "; server search mode disabled"),
  );
  if (resolvedBackend.kind === "pglite") {
    console.log(
      "  note: serving from LOCAL PGLite — set MEMORY_DATABASE_URL for hosted team memory.",
    );
  }

  await warmServerSideSearchEmbedder({
    enabled: serverEmbeddingsEnabled,
    serverEmbedder,
    log: console.log,
  });

  // Pooled serving: migrations run on a dedicated single connection, then a
  // pg.Pool takes over (a dropped pinned connection would otherwise kill a
  // long-lived server). PGLite ignores the flag.
  const memStore = await store.openMemoryStore({
    dataDir,
    embedDim: expectedEmbedding.dim,
    pool: true,
  });
  const hasPrincipalConfig =
    (envValue("MEMORY_API_TEAM_ID") !== "" && envValue("MEMORY_API_USER_ID") !== "") ||
    ((envValue("MEMORY_API_TEAM_SLUG") !== "" || envValue("MEMORY_API_BOOTSTRAP_TEAM_SLUG") !== "") &&
      (envValue("MEMORY_API_USER_EMAIL") !== "" || envValue("MEMORY_API_BOOTSTRAP_OWNER_EMAIL") !== ""));
  if (resolvedBackend.kind === "postgres" && !hasPrincipalConfig) {
    throw new Error(
      "Hosted mode requires a server principal. Set MEMORY_API_TEAM_ID + " +
        "MEMORY_API_USER_ID, or MEMORY_API_TEAM_SLUG + MEMORY_API_USER_EMAIL. " +
        "For first Docker startup you can set MEMORY_API_BOOTSTRAP_TEAM_SLUG + " +
        "MEMORY_API_BOOTSTRAP_OWNER_EMAIL.",
    );
  }

  let identityStore = null;
  let resolvePrincipal;
  let resolveUser;
  if (hasPrincipalConfig) {
    const identityModules = loadIdentityModules();
    identityStore = await identityModules.store.openIdentityStore({ client: memStore.client });
    await identityModules.teamAuth.ensureTeamAuthSchema();
    const bootstrapped = await bootstrapIdentity(identityStore);
    if (bootstrapped) {
      console.log(
        `  bootstrap: ensured owner ${bootstrapped.owner.email} for team ${bootstrapped.team.slug}`,
      );
    }
    const principal = await resolveServerPrincipal(identityStore);
    if (!principal) {
      throw new Error("Server principal could not be resolved from the configured environment.");
    }
    resolveUser = async ({ token: providedToken }) => {
      if (tokenMatches(providedToken, token)) {
        return {
          userId: principal.userId,
          authSource: "dev-token",
          credentialKind: "dev-token",
          legacyTeamId: principal.teamId,
        };
      }
      return identityModules.teamAuth.resolveTeamApiUserToken(identityStore, providedToken);
    };
    resolvePrincipal = async ({ token: providedToken, path: requestPath, requestedTeamId }) => {
      if (tokenMatches(providedToken, token)) {
        return resolveLockedDevPrincipal(principal, requestedTeamId);
      }
      const resolution = await identityModules.teamAuth.resolveTeamApiToken(
        identityStore,
        providedToken,
        { requestedTeamId },
      );
      if (
        resolution &&
        resolution.status !== "blocked" &&
        resolution.teamScopeSource &&
        resolution.teamScopeSource !== "explicit-header" &&
        resolution.teamScopeSource !== "locked-token"
      ) {
        console.warn(JSON.stringify({
          event: "team_scope_fallback",
          route: requestPath,
          source: resolution.teamScopeSource,
          teamId: resolution.teamId,
          authSource: resolution.authSource ?? null,
        }));
      }
      return resolution;
    };
    console.log(
      `  authz:    Team API sessions enabled; dev-token principal ${principal.userId} in team ${principal.teamId}`,
    );
  } else {
    console.log("  authz:    legacy local mode (no server principal configured)");
  }

  const httpServer = server.createMemoryApiServer({
    deps: {
      store: memStore,
      expectedEmbeddingModel: expectedEmbedding.model,
      expectedEmbeddingDim: expectedEmbedding.dim,
      ...(serverEmbeddingsEnabled ? { serverEmbedder } : {}),
      rerankConfig,
      workspaceRoot: rootDir,
      ...(identityStore ? { identityStore } : {}),
    },
    token,
    backendKind: resolvedBackend.kind,
    resolvePrincipal,
    resolveUser,
  });

  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, () => resolve());
  });
  console.log(`  listening on :${port}  (GET /v1/health)`);
  const backupLoop = startGitHubBackupLoop(rootDir);

  // Graceful shutdown — stop accepting, then release the store/pool.
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    backupLoop?.stop();
    console.log(`\nmemory-api: ${signal} — shutting down.`);
    httpServer.close(() => {
      memStore
        .close()
        .catch(() => {})
        .finally(() => process.exit(0));
    });
    // Hard stop if connections linger past 5s.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  return -1; // keep running (the listener holds the event loop open)
}

if (require.main === module) {
  main()
    .then((code) => {
      if (code >= 0) process.exit(code);
    })
    .catch((error) => {
      console.error(`\nmemory-api failed: ${error instanceof Error ? error.message : error}`);
      if (error && error.stack) console.error(error.stack);
      process.exit(1);
    });
}

module.exports = {
  resolveLockedDevPrincipal,
  warmServerSideSearchEmbedder,
};

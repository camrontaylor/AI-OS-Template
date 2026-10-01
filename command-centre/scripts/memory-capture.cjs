#!/usr/bin/env node
/**
 * memory-capture — AI-OS-owned session capture + memory refresh.
 *
 * The runtime replacement for the legacy memsearch Stop hook + background
 * indexing. Two modes:
 *
 *   --session   archive the raw transcript, summarize the transcript's last
 *               turn into context/memory/{date}.aos.md, then run a debounced
 *               incremental index of the memory sources (reason:
 *               session_capture). This is what the .claude/hooks/memory-capture.js
 *               Stop hook spawns.
 *   (default)   just run the debounced/forced incremental index (reason: refresh).
 *               This is what the nightly cron runs.
 *
 * No Memsearch: capture shells out to the configured summarizer, with a raw
 * fallback. With a live Team OS login, captured session blocks are sent to the
 * hosted Memory API with client-generated BGE-M3 embeddings. Signed-out or
 * explicit --local mode indexes the local PGLite store.
 *
 * Usage:
 *   node scripts/memory-capture.cjs --session --session-id <id> --transcript <path>
 *   node scripts/memory-capture.cjs --reason refresh --force
 *   node scripts/memory-capture.cjs --session --transcript <path> --client acme
 *
 * Flags:
 *   --session                capture the transcript's last turn before indexing
 *   --session-id <id>        session id for the capture block (default "session")
 *   --transcript <path>      transcript JSONL to capture from (required with --session)
 *   --visibility <system|team|client|private>   local default private; TeamOS default staging team.
 *                            explicit private/system never stage — they ingest
 *                            directly, so they never enter the team review queue.
 *   --team <id> / --client <slug> / --user <id> scope ids (per visibility)
 *   --allow-system          hosted admin/owner only: allow shared system capture
 *   --workspace <dir>        workspace to capture/index (default: store root)
 *   --reason <session_capture|refresh|...>       index_jobs tag (default by mode)
 *   --debounce <seconds>     skip indexing if it ran within N seconds (default 30)
 *   --team-api / --api-ingest legacy direct ingest; normal TeamOS team/client capture uses staging
 *   --local                  force local PGLite indexing, even when signed in
 *   --embedder <bge-m3|hash>  local default: bge-m3 (or $MEMORY_EMBEDDER); hash is explicit offline mode
 *   --force                  re-embed + bypass the debounce
 *   --help
 *
 * The .ts library is loaded via the shared loader (loadTsModule, leaf-first) —
 * there is no build step; this is the supported runtime path.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const { findWorkspaceRoot } = require("./workspace-root.cjs");
const { loadMemoryModules } = require("./load-memory-modules.cjs");
const { ensureLocalUserId } = require("./local-memory-identity.cjs");
const { prepareMemoryApiIngestBody } = require("./lib/memory-api-payload.cjs");
const { teamRequest } = require("./lib/team-api.cjs");
const {
  drainMemoryOutbox,
  queueMemoryOutboxItem,
} = require("./lib/memory-sync-outbox.cjs");
const {
  assertTeamEmbedderAllowed,
  resolveTeamMemoryRoute,
  savedTeamContextFromRoute,
  TeamMemoryRoutingError,
} = require("./lib/team-memory-routing.cjs");
const { isExpired, readConfigOptional } = require("./lib/team-config.cjs");
const {
  loadIdentityModules,
  openLocalIdentityStore,
  resolveTeamRef,
  resolveUserRef,
} = require("./load-identity-modules.cjs");

const { scope, store, embedder, capture } = loadMemoryModules({ withCapture: true });

// ── Flag parsing. ───────────────────────────────────────────────────────────
function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[(i += 1)];
    switch (arg) {
      case "--session": flags.session = true; break;
      case "--session-id": flags.sessionId = next(); break;
      case "--transcript": flags.transcript = next(); break;
      case "--cwd": flags.cwd = next(); break;
      case "--team-context-auto": flags.teamContextAuto = true; break;
      case "--visibility": flags.visibility = next(); break;
      case "--team": flags.team = next(); break;
      case "--client": flags.client = next(); break;
      case "--user": flags.user = next(); break;
      case "--allow-system": flags.allowSystem = true; break;
      case "--workspace": flags.workspace = next(); break;
      case "--reason": flags.reason = next(); break;
      case "--debounce": flags.debounce = Number(next()); break;
      case "--embedder": flags.embedder = next(); break;
      case "--team-api": flags.teamApi = true; break;
      case "--local": flags.local = true; break;
      case "--api-ingest": flags.apiIngest = true; break;
      case "--no-consolidate": flags.noConsolidate = true; break;
      case "--force": flags.force = true; break;
      case "--help": case "-h": flags.help = true; break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return flags;
}

const USAGE = `memory-capture — AOS session capture + debounced memory refresh

Modes:
  --session     capture the transcript's last turn, then index (reason session_capture)
  (default)     debounced/forced incremental index only (reason refresh)

Options:
  --session-id <id>        session id for the capture block (default "session")
  --transcript <path>      transcript JSONL (required with --session)
  --cwd <path>             session cwd, used by hooks
  --team-context-auto      read saved Team OS login and default capture to team staging
  --visibility <system|team|client|private>   local default private; TeamOS default staging team
                           (explicit private/system ingest directly, never staged)
  --team <id> / --client <slug> / --user <id>  scope ids (per visibility)
  --allow-system          hosted admin/owner only: allow shared system capture
  --workspace <dir>        workspace to capture/index (default: store root)
  --reason <...>           index_jobs tag (default by mode)
  --debounce <seconds>     skip indexing if it ran within N seconds (default 30)
    --team-api / --api-ingest legacy direct ingest; normal TeamOS team/client capture uses staging
    --no-consolidate       do not start opportunistic TeamOS consolidation after staging
    --local                  force local PGLite indexing, even when signed in
  --embedder <bge-m3|hash>  local default: bge-m3 (or $MEMORY_EMBEDDER); hash is explicit offline mode
  --force                  re-embed + bypass the debounce
  --help`;

function truthyEnv(name) {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] ?? "").trim().toLowerCase());
}

function teamConfigPath() {
  const dir = process.env.AI_OS_TEAM_CONFIG_DIR
    ? path.resolve(process.env.AI_OS_TEAM_CONFIG_DIR)
    : path.join(os.homedir(), ".AI-OS");
  return path.join(dir, "team-context.json");
}

function readSavedTeamContext() {
  try {
    const parsed = JSON.parse(fs.readFileSync(teamConfigPath(), "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const apiUrl = typeof parsed.apiUrl === "string" ? parsed.apiUrl.trim().replace(/\/+$/, "") : "";
    const token = typeof parsed.token === "string" ? parsed.token.trim() : "";
    if (!/^https?:\/\//i.test(apiUrl) || token === "") return null;
    if (typeof parsed.expiresAt === "string" && Date.parse(parsed.expiresAt) <= Date.now()) return null;
    return { ...parsed, apiUrl, token };
  } catch {
    return null;
  }
}

function idFromRecord(value) {
  return value && typeof value === "object" && typeof value.id === "string"
    ? value.id.trim()
    : "";
}

async function teamFetch(config, pathname) {
  const response = await fetch(`${config.apiUrl}${pathname}`, {
    headers: { authorization: `Bearer ${config.token}` },
    signal: AbortSignal.timeout(6000),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body && typeof body === "object" && body.error && typeof body.error === "object"
      ? body.error
      : {};
    throw new Error(
      typeof error.message === "string"
        ? error.message
        : `Team OS request failed (${response.status})`,
    );
  }
  return body;
}

async function resolveSavedTeamCaptureContext(flags) {
  if (!flags.teamContextAuto) return null;
  const config = readSavedTeamContext();
  if (!config) return null;
  const whoami = await teamFetch(config, "/v1/team/whoami");
  const teamId = idFromRecord(whoami.team || config.team);
  const userId = idFromRecord(whoami.user || config.user);
  if (!teamId || !userId) return null;
  return {
    config,
    teamId,
    userId,
    membership: whoami.membership || config.membership || null,
  };
}

function hostedCaptureMode({ includeSavedTeamContext = true } = {}) {
  const backend = String(process.env.MEMORY_STORE_BACKEND ?? "").trim().toLowerCase();
  return Boolean(
    (process.env.MEMORY_DATABASE_URL ?? "").trim() ||
      (process.env.DATABASE_URL ?? "").trim() ||
      backend === "postgres" ||
      truthyEnv("MEMORY_CAPTURE_VIA_API") ||
      truthyEnv("AI_OS_HOSTED_MODE") ||
      truthyEnv("TEAM_OS_HOSTED_MODE") ||
      (includeSavedTeamContext && readSavedTeamContext()),
  );
}

function captureValue(flagValue, ...envNames) {
  if (flagValue != null && String(flagValue).trim() !== "") return String(flagValue).trim();
  for (const envName of envNames) {
    const value = String(process.env[envName] ?? "").trim();
    if (value) return value;
  }
  return null;
}

function buildScope(flags, hostedMode = hostedCaptureMode(), savedContext = null, options = {}) {
  const defaultVisibility = options.defaultVisibility || (hostedMode ? "team" : "private");
  const visibility =
    flags.visibility ??
    captureValue(null, "MEMORY_CAPTURE_VISIBILITY") ??
    defaultVisibility;
  const valid = ["system", "team", "client", "private"];
  if (!valid.includes(visibility)) {
    throw new Error(`--visibility must be one of: ${valid.join(", ")}`);
  }
  if (hostedMode && visibility === "system" && !flags.allowSystem && !truthyEnv("MEMORY_CAPTURE_ALLOW_SYSTEM")) {
    throw new Error(
      "hosted memory capture refuses shared system scope by default; use private/client/team scope, or --allow-system for an admin/service capture",
    );
  }
  const teamId =
    captureValue(flags.team, "MEMORY_CAPTURE_TEAM_ID", "MEMORY_API_TEAM_ID") ??
    savedContext?.teamId ??
    null;
  const clientId = captureValue(flags.client, "MEMORY_CAPTURE_CLIENT_ID");
  const userId =
    captureValue(flags.user, "MEMORY_CAPTURE_USER_ID", "MEMORY_API_USER_ID") ??
    savedContext?.userId ??
    options.localUserId ??
    null;
  if (hostedMode && (!teamId || !userId)) {
    throw new Error(
      "hosted memory capture requires team and user context; set MEMORY_CAPTURE_TEAM_ID and MEMORY_CAPTURE_USER_ID or pass --team and --user",
    );
  }
  const s = {
    teamId,
    clientId,
    userId,
    visibility,
  };
  scope.assertValidScope(s); // throws if a required id is missing for the visibility
  return s;
}

function clientSlugFromCwd(rootDir, cwd) {
  if (!cwd) return null;
  const root = path.resolve(rootDir);
  const current = path.resolve(cwd);
  const rel = path.relative(root, current).replace(/\\/g, "/");
  if (rel === "" || rel.startsWith("../") || rel === ".." || path.isAbsolute(rel)) return null;
  const parts = rel.split("/").filter(Boolean);
  return parts[0] === "clients" && parts[1] ? parts[1] : null;
}

function validateClientCaptureCwd(rawScope, flags, rootDir) {
  if (rawScope.visibility !== "client") return;
  const cwdClient = clientSlugFromCwd(rootDir, flags.cwd);
  if (!cwdClient) {
    throw new Error("Team OS client capture requires --cwd under clients/{slug}");
  }
  if (cwdClient !== rawScope.clientId) {
    throw new Error("Team OS client capture cwd client must match the requested client");
  }
}

async function authorizeSavedTeamScope(rawScope, flags) {
  const saved = flags.savedTeamContext;
  if (!saved) return null;

  if (rawScope.visibility === "private") {
    return {
      teamId: saved.teamId,
      clientId: null,
      userId: saved.userId,
      visibility: "private",
    };
  }

  if (rawScope.visibility === "client") {
    const body = await teamFetch(saved.config, "/v1/team/clients");
    const clients = Array.isArray(body.clients) ? body.clients : [];
    const granted = clients.find((client) => (
      client &&
      typeof client === "object" &&
      client.slug === rawScope.clientId &&
      client.access === "write"
    ));
    if (!granted) {
      throw new Error("Team OS client capture requires write access to the client");
    }
    return {
      teamId: saved.teamId,
      clientId: rawScope.clientId,
      userId: null,
      visibility: "client",
    };
  }

  const role = saved.membership && typeof saved.membership === "object"
    ? String(saved.membership.role ?? "")
    : "";
  if (role !== "admin" && role !== "owner") {
    throw new Error("Team OS shared capture requires admin or owner access");
  }
  if (rawScope.visibility === "system" && !flags.allowSystem && !truthyEnv("MEMORY_CAPTURE_ALLOW_SYSTEM")) {
    throw new Error("Team OS system capture requires --allow-system");
  }
  return {
    teamId: saved.teamId,
    clientId: null,
    userId: null,
    visibility: rawScope.visibility,
  };
}

async function authorizeHostedScope(rawScope, flags, hostedMode = hostedCaptureMode()) {
  if (!hostedMode) return rawScope;

  const savedScope = await authorizeSavedTeamScope(rawScope, flags);
  if (savedScope) return savedScope;

  const identityModules = loadIdentityModules();
  const identityStore = await openLocalIdentityStore(identityModules.store);
  try {
    const team = await resolveTeamRef(identityStore, rawScope.teamId);
    const user = await resolveUserRef(identityStore, rawScope.userId);
    const membership = await identityStore.getMembership(team.id, user.id);
    if (!membership || membership.status !== "active") {
      throw new Error("hosted memory capture requires an active team membership");
    }

    if (rawScope.visibility === "private") {
      return { teamId: team.id, clientId: null, userId: user.id, visibility: "private" };
    }

    if (rawScope.visibility === "client") {
      const client = await identityStore.getClientBySlug(team.id, rawScope.clientId);
      if (!client || client.status !== "active") {
        throw new Error("hosted client capture requires an active client");
      }
      const grant = await identityStore.getActiveGrant(team.id, client.id, user.id);
      if (!grant || grant.status !== "active" || grant.access !== "write") {
        throw new Error("hosted client capture requires write access to the client");
      }
      return { teamId: team.id, clientId: client.slug, userId: null, visibility: "client" };
    }

    if (membership.role !== "admin" && membership.role !== "owner") {
      throw new Error("hosted shared capture requires admin or owner access");
    }
    if (rawScope.visibility === "system" && !flags.allowSystem && !truthyEnv("MEMORY_CAPTURE_ALLOW_SYSTEM")) {
      throw new Error("hosted system capture requires --allow-system");
    }
    return { teamId: team.id, clientId: null, userId: null, visibility: rawScope.visibility };
  } finally {
    await identityStore.close();
  }
}

function hostedApiIngestMode(flags) {
  return flags.apiIngest === true || flags.teamApi === true || truthyEnv("MEMORY_CAPTURE_VIA_API");
}

function extractCaptureBlock(filePath, sourceHash) {
  const text = fs.readFileSync(filePath, "utf8");
  const markerIndex = text.indexOf(`source:${sourceHash}`);
  if (markerIndex < 0) return null;
  const blockStart = text.lastIndexOf("<!-- aos-capture", markerIndex);
  const blockEndMarker = "<!-- /aos-capture -->";
  const blockEnd = text.indexOf(blockEndMarker, markerIndex);
  if (blockStart < 0 || blockEnd < 0) return null;
  return `${text.slice(blockStart, blockEnd + blockEndMarker.length).trim()}\n`;
}

function captureRelativeSourcePath(rootDir, filePath, sessionId, sourceHash) {
  const relativePath = path.relative(rootDir, filePath).replace(/\\/g, "/");
  const safeSessionId = String(sessionId || "session").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `${relativePath}#session-${safeSessionId}-${sourceHash.slice(0, 12)}`;
}

function contentDateFromCaptureFile(filePath) {
  const match = path.basename(filePath).match(/^(\d{4}-\d{2}-\d{2})\.aos\.md$/);
  return match ? match[1] : null;
}

function savedConfigIsRecent(config, maxAgeDays = 7) {
  if (!config || isExpired(config)) return false;
  if (typeof config.savedAt !== "string") return false;
  const savedAt = Date.parse(config.savedAt);
  if (!Number.isFinite(savedAt)) return false;
  return Date.now() - savedAt <= maxAgeDays * 24 * 60 * 60 * 1000;
}

function offlineTeamContextFromConfig() {
  const config = readConfigOptional();
  if (!savedConfigIsRecent(config)) return null;
  const teamId = idFromRecord(config.team);
  const userId = idFromRecord(config.user);
  if (!teamId || !userId) return null;
  return { config, teamId, userId, membership: config.membership || null };
}

function captureScopeForStaging(baseScope, savedContext) {
  if (baseScope.visibility === "client") {
    return {
      teamId: savedContext.teamId,
      clientId: baseScope.clientId,
      userId: null,
      visibility: "client",
    };
  }
  if (baseScope.visibility === "team") {
    return {
      teamId: savedContext.teamId,
      clientId: null,
      userId: null,
      visibility: "team",
    };
  }
  throw new Error(
    `only team or client captures can be staged; got visibility "${baseScope.visibility}" (private/system captures use direct ingest)`,
  );
}

function shouldConsolidateAfterCapture(flags) {
  if (flags.noConsolidate) return false;
  const raw = String(process.env.MEMORY_CONSOLIDATE_AFTER_CAPTURE ?? "1").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(raw);
}

function spawnConsolidationAfterCapture(baseScope, flags) {
  if (!shouldConsolidateAfterCapture(flags)) return;
  const script = path.join(__dirname, "memory-consolidation-tick.cjs");
  const args = [script, "--quiet", "--limit", "20", "--after-capture", "--reason", "after-capture"];
  if (baseScope.visibility === "client" && baseScope.clientId) {
    args.push("--client", baseScope.clientId);
  }
  const child = spawn(process.execPath, args, {
    cwd: path.resolve(__dirname, ".."),
    env: process.env,
    stdio: "ignore",
    detached: true,
    windowsHide: true,
  });
  child.unref();
}

function captureBodyFromBlock({ scope: captureScope, rootDir, captureResult, sessionId, content, sourcePath, reason }) {
  const contentSha256 = crypto.createHash("sha256").update(content).digest("hex");
  return {
    scope: captureScope,
    sessionId: String(sessionId || "session"),
    sourceHash: captureResult.sourceHash,
    sourcePath,
    sourceType: "session",
    title: `AI-OS session capture ${sessionId || "session"}`,
    contentDate: contentDateFromCaptureFile(captureResult.filePath),
    content,
    contentSha256,
    byteSize: Buffer.byteLength(content, "utf8"),
    metadata: {
      reason,
      captureFile: path.relative(rootDir, captureResult.filePath).replace(/\\/g, "/"),
      rawTranscriptPath: captureResult.rawTranscriptPath ?? null,
      summarySource: captureResult.summarySource ?? null,
    },
  };
}

async function postCaptureEventViaApi({ savedTeamContext, scope: captureScope, rootDir, captureResult, sessionId, reason }) {
  if (!savedTeamContext?.config) {
    throw new Error("Team OS capture staging requires a saved Team OS login; run npm run team -- login first");
  }
  const content = extractCaptureBlock(captureResult.filePath, captureResult.sourceHash);
  if (!content) {
    throw new Error("could not find the captured session block to stage");
  }
  const sourcePath = captureRelativeSourcePath(
    rootDir,
    captureResult.filePath,
    sessionId,
    captureResult.sourceHash,
  );
  const body = captureBodyFromBlock({
    scope: captureScope,
    rootDir,
    captureResult,
    sessionId,
    content,
    sourcePath,
    reason,
  });
  const response = await fetch(`${savedTeamContext.config.apiUrl}/v1/memory/captures`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${savedTeamContext.config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = responseBody && typeof responseBody === "object" && responseBody.error && typeof responseBody.error === "object"
      ? responseBody.error
      : {};
    throw new Error(
      typeof error.message === "string"
        ? error.message
        : `Team OS memory capture staging failed (${response.status})`,
    );
  }
  return responseBody;
}

async function openLocalMemoryStore({ storeRoot, embedDim }) {
  const dataDir = path.join(storeRoot, ".command-centre", "memory");
  fs.mkdirSync(dataDir, { recursive: true });
  return store.openMemoryStore({ dataDir, embedDim });
}

async function queueLocalPendingCapture({ memStore, savedTeamContext, scope: captureScope, rootDir, captureResult, sessionId, reason, directIngest = false }) {
  const content = extractCaptureBlock(captureResult.filePath, captureResult.sourceHash);
  if (!content) throw new Error("could not find the captured session block to queue");
  const sourcePath = captureRelativeSourcePath(
    rootDir,
    captureResult.filePath,
    sessionId,
    captureResult.sourceHash,
  );
  const body = captureBodyFromBlock({
    scope: captureScope,
    rootDir,
    captureResult,
    sessionId,
    content,
    sourcePath,
    reason,
  });
  if (directIngest) {
    const prepared = await prepareMemoryApiIngestBody({ content, sourcePath });
    await queueMemoryOutboxItem({
      memStore,
      savedTeamContext,
      item: {
        operation: "ingest",
        scope: captureScope,
        actorUserId: savedTeamContext.userId,
        sourcePath,
        sourceHash: captureResult.sourceHash,
        contentSha256: prepared.contentSha256,
        sessionId: body.sessionId,
        requestBody: {
          scope: captureScope,
          sourcePath,
          sourceType: "session",
          title: body.title,
          contentDate: body.contentDate,
          reason,
          content,
          ...prepared,
          force: true,
        },
        metadata: body.metadata,
      },
    });
    return;
  }

  await queueMemoryOutboxItem({
    memStore,
    savedTeamContext,
    item: {
      operation: "capture_create",
      scope: captureScope,
      actorUserId: savedTeamContext.userId,
      sourcePath: body.sourcePath,
      sourceHash: body.sourceHash,
      contentSha256: body.contentSha256,
      sessionId: body.sessionId,
      requestBody: body,
      metadata: body.metadata,
    },
  });
}

async function syncLegacyPendingLocalCaptures({ memStore, savedTeamContext, limit = 25 }) {
  if (!savedTeamContext?.config) return { synced: 0, failed: 0 };
  const { rows } = await memStore.client.query(
    `SELECT id::text, team_id, client_id, actor_user_id, visibility, session_id,
            source_hash, source_path, source_type, title, content_date::text AS content_date,
            content, content_sha256, byte_size, metadata
       FROM memory_capture_events
      WHERE team_id = $1
        AND actor_user_id = $2
        AND sync_status IN ('local_pending', 'sync_failed')
      ORDER BY created_at ASC
      LIMIT $3`,
    [savedTeamContext.teamId, savedTeamContext.userId, limit],
  );
  let synced = 0;
  let failed = 0;
  for (const row of rows) {
    const body = {
      scope: {
        teamId: row.team_id,
        clientId: row.client_id,
        userId: null,
        visibility: row.visibility,
      },
      sessionId: row.session_id,
      sourceHash: row.source_hash,
      sourcePath: row.source_path,
      sourceType: row.source_type,
      title: row.title,
      contentDate: row.content_date,
      content: row.content,
      contentSha256: row.content_sha256,
      byteSize: row.byte_size,
      metadata: {
        ...(row.metadata && typeof row.metadata === "object" ? row.metadata : {}),
        syncedFromOfflineQueue: true,
      },
    };
    try {
      await teamRequest(savedTeamContext.config, "/v1/memory/captures", {
        method: "POST",
        body,
        signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
          ? AbortSignal.timeout(30_000)
          : undefined,
      });
      await memStore.client.query("DELETE FROM memory_capture_events WHERE id = $1", [row.id]);
      synced += 1;
    } catch (error) {
      failed += 1;
      await memStore.client.query(
        `UPDATE memory_capture_events
            SET sync_status = 'sync_failed',
                error_message = $2,
                updated_at = now()
          WHERE id = $1`,
        [row.id, error instanceof Error ? error.message : String(error)],
      );
    }
  }
  return { synced, failed };
}

async function syncPendingLocalMemory({ storeRoot, savedTeamContext, limit = 25 }) {
  if (!savedTeamContext?.config) return { synced: 0, failed: 0, retrying: 0, legacySynced: 0, legacyFailed: 0 };
  const memStore = await openLocalMemoryStore({ storeRoot, embedDim: 1024 });
  try {
    const outbox = await drainMemoryOutbox({
      memStore,
      savedTeamContext,
      request: teamRequest,
      limit,
    });
    const legacy = await syncLegacyPendingLocalCaptures({ memStore, savedTeamContext, limit });
    return {
      synced: outbox.synced + legacy.synced,
      failed: outbox.failed,
      retrying: outbox.retrying,
      legacySynced: legacy.synced,
      legacyFailed: legacy.failed,
    };
  } finally {
    await memStore.close();
  }
}

async function ingestCaptureBlockViaApi({ savedTeamContext, scope: captureScope, rootDir, captureResult, sessionId, reason }) {
  if (!savedTeamContext?.config) {
    throw new Error("Team OS API ingest requires a saved Team OS login; run npm run team -- login first");
  }
  const content = extractCaptureBlock(captureResult.filePath, captureResult.sourceHash);
  if (!content) {
    throw new Error("could not find the captured session block to ingest");
  }
  const sourcePath = captureRelativeSourcePath(
    rootDir,
    captureResult.filePath,
    sessionId,
    captureResult.sourceHash,
  );
  const prepared = await prepareMemoryApiIngestBody({ content, sourcePath });
  const body = {
    scope: captureScope,
    sourcePath,
    sourceType: "session",
    title: `AI-OS session capture ${sessionId || "session"}`,
    contentDate: contentDateFromCaptureFile(captureResult.filePath),
    reason,
    content,
    ...prepared,
    force: true,
  };
  const response = await fetch(`${savedTeamContext.config.apiUrl}/v1/memory/ingest`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${savedTeamContext.config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = responseBody && typeof responseBody === "object" && responseBody.error && typeof responseBody.error === "object"
      ? responseBody.error
      : {};
    throw new Error(
      typeof error.message === "string"
        ? error.message
        : `Team OS memory ingest failed (${response.status})`,
    );
  }
  return responseBody;
}

function assertWorkspaceWithinRoot(storeRoot, workspaceDir) {
  const rel = path.relative(storeRoot, workspaceDir);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    return;
  }
  throw new Error(`--workspace must be inside the AI-OS root (${storeRoot})`);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }

  const storeRoot = process.env.AI_OS_DIR
    ? path.resolve(process.env.AI_OS_DIR)
    : findWorkspaceRoot(__dirname);
  const workspaceDir = flags.workspace ? path.resolve(storeRoot, flags.workspace) : storeRoot;
  assertWorkspaceWithinRoot(storeRoot, workspaceDir);

  process.env.MEMORY_MODEL_CACHE_DIR =
    process.env.MEMORY_MODEL_CACHE_DIR || path.join(storeRoot, ".command-centre", "models");
  if (flags.local && hostedApiIngestMode(flags)) {
    throw new Error("Use either --team-api/--api-ingest or --local, not both");
  }

  let route;
  let offlineTeamContext = null;
  try {
    route = await resolveTeamMemoryRoute({ flags, env: process.env });
  } catch (error) {
    if (error instanceof TeamMemoryRoutingError && error.code === "TEAM_MEMORY_UNAVAILABLE") {
      offlineTeamContext = offlineTeamContextFromConfig();
      if (!offlineTeamContext) throw error;
      route = { target: "offline-team", mode: "auto", reason: "team-unavailable" };
    } else {
      throw error;
    }
  }

  const directApiIngest = hostedApiIngestMode(flags);
  const teamStaging = route.target === "team" && !directApiIngest;
  const offlineTeamQueue = route.target === "offline-team";
  if (directApiIngest) assertTeamEmbedderAllowed(flags, process.env);

  flags.savedTeamContext =
    savedTeamContextFromRoute(route) ??
    offlineTeamContext ??
    (route.target === "team" ? await resolveSavedTeamCaptureContext(flags) : null);

  if (route.target === "team" && flags.savedTeamContext) {
    const syncResult = await syncPendingLocalMemory({
      storeRoot,
      savedTeamContext: flags.savedTeamContext,
    });
    if (syncResult.synced || syncResult.failed || syncResult.retrying || syncResult.legacyFailed) {
      console.log(
        `memory-capture: offline queue sync ${syncResult.synced} synced / ` +
          `${syncResult.failed + syncResult.legacyFailed} failed / ${syncResult.retrying} retrying`,
      );
    }
  }

  const envMemoryMode = String(process.env.TEAM_OS_MEMORY_MODE ?? "").trim().toLowerCase();
  const forcedLocal = route.target === "local" && (flags.local === true || envMemoryMode === "local");
  const localUserId = route.target === "local" ? ensureLocalUserId(storeRoot) : null;
  const hostedScopeMode = !forcedLocal && (
    route.target === "team" ||
    offlineTeamQueue ||
    directApiIngest ||
    hostedCaptureMode({ includeSavedTeamContext: !forcedLocal })
  );
  const defaultVisibility = route.target === "local" ? "private" : "team";
  const rawScope = buildScope(flags, hostedScopeMode, flags.savedTeamContext, {
    defaultVisibility,
    localUserId,
  });
  validateClientCaptureCwd(rawScope, flags, storeRoot);
  // Explicit private/system captures never enter team staging (no admin review
  // queue for them) — they authorize and ingest directly, same as --api-ingest.
  const stagingIneligible = rawScope.visibility === "private" || rawScope.visibility === "system";
  if (stagingIneligible && (teamStaging || offlineTeamQueue)) assertTeamEmbedderAllowed(flags, process.env);
  const authorizedScope = directApiIngest || (teamStaging && stagingIneligible) || (hostedScopeMode && !teamStaging && !offlineTeamQueue)
    ? await authorizeHostedScope(rawScope, flags, hostedScopeMode)
    : rawScope;
  const baseScope = scope.normalizeScope(authorizedScope);
  const now = new Date();
  const debounceMs = Number.isFinite(flags.debounce) ? Math.max(0, flags.debounce) * 1000 : undefined;
  const reason = flags.reason ?? (flags.session ? "session_capture" : "refresh");

  // 1. Archive the raw transcript, summarize the last turn, and append it.
  let captureResult = null;
  if (flags.session) {
    const turn = flags.transcript ? capture.extractLastTurn(flags.transcript) : null;
    if (turn) {
      captureResult = await capture.captureSessionTurn({
        rootDir: workspaceDir,
        sessionId: flags.sessionId ?? "session",
        turn,
        transcriptPath: flags.transcript,
        now,
      });
      console.log(
        captureResult.written
          ? `memory-capture: captured ${captureResult.summarySource} session ${flags.sessionId ?? "session"} → ${captureResult.filePath}`
          : `memory-capture: session ${flags.sessionId ?? "session"} already captured (no change)`,
      );
    } else {
      // Headless / missing / corrupt transcript: nothing to capture, but the
      // index refresh below still runs. Never crash the Stop chain.
      console.log("memory-capture: no capturable turn in transcript — refreshing index only");
    }
  }

  if (teamStaging && !stagingIneligible) {
    if (!captureResult) {
      console.log("memory-capture: no captured session block — skipped Team OS capture staging");
      return 0;
    }
    const captureScope = captureScopeForStaging(baseScope, flags.savedTeamContext);
    const result = await postCaptureEventViaApi({
      savedTeamContext: flags.savedTeamContext,
      scope: captureScope,
      rootDir: workspaceDir,
      captureResult,
      sessionId: flags.sessionId ?? "session",
      reason,
    });
    const captureId = result?.capture && typeof result.capture === "object" ? result.capture.id : null;
    console.log(
      `memory-capture: staged Team OS capture${captureId ? ` ${captureId}` : ""} (reason ${reason})`,
    );
    spawnConsolidationAfterCapture(baseScope, flags);
    return 0;
  }

  if (offlineTeamQueue) {
    if (!captureResult) {
      console.log("memory-capture: no captured session block — skipped offline Team OS queue");
      return 0;
    }
    if (baseScope.visibility === "system") {
      throw new Error("system capture is not supported while the Team OS API is unreachable");
    }
    const memStore = await openLocalMemoryStore({ storeRoot, embedDim: 1024 });
    try {
      const captureScope = baseScope.visibility === "private"
        ? { teamId: baseScope.teamId, clientId: null, userId: baseScope.userId, visibility: "private" }
        : captureScopeForStaging(baseScope, flags.savedTeamContext);
      await queueLocalPendingCapture({
        memStore,
        savedTeamContext: flags.savedTeamContext,
        scope: captureScope,
        rootDir: workspaceDir,
        captureResult,
        sessionId: flags.sessionId ?? "session",
        reason,
        directIngest: directApiIngest || baseScope.visibility === "private",
      });
      console.log("memory-capture: queued Team OS capture locally for later sync");
      return 0;
    } finally {
      await memStore.close();
    }
  }

  if (directApiIngest || (teamStaging && stagingIneligible)) {
    if (!captureResult) {
      console.log("memory-capture: no captured session block — skipped Team OS API ingest");
      return 0;
    }
    const result = await ingestCaptureBlockViaApi({
      savedTeamContext: flags.savedTeamContext,
      scope: baseScope,
      rootDir: workspaceDir,
      captureResult,
      sessionId: flags.sessionId ?? "session",
      reason,
    });
    const skipped = result && typeof result === "object" && result.skipped === true;
    const chunksInserted = result && typeof result === "object" && typeof result.chunksInserted === "number"
      ? result.chunksInserted
      : 0;
    console.log(
      skipped
        ? `memory-capture: Team OS API ingest skipped existing source (reason ${reason})`
        : `memory-capture: Team OS API ingested ${chunksInserted} chunks (reason ${reason})`,
    );
    return 0;
  }

  // 2. Debounced incremental index of the memory sources.
  const emb = await embedder.createEmbedder({ kind: flags.embedder });
  const dataDir = path.join(storeRoot, ".command-centre", "memory");
  fs.mkdirSync(dataDir, { recursive: true }); // PGLite's own mkdir is not recursive
  const memStore = await store.openMemoryStore({ dataDir, embedDim: emb.dim });

  try {
    const { summary, skipped } = await capture.refreshIndex({
      store: memStore,
      embedder: emb,
      scope: baseScope,
      rootDir: workspaceDir,
      stateDir: dataDir,
      reason,
      force: flags.force === true,
      debounceMs,
      now,
    });

    if (skipped) {
      console.log(`memory-capture: index ${skipped} (reason ${reason})`);
      return 0;
    }
    console.log(
      `memory-capture: indexed ${summary.sourcesIndexed} / skipped ${summary.sourcesSkipped} / ` +
        `+${summary.chunksInserted} chunks / errors ${summary.errors.length} (reason ${reason})`,
    );
    for (const err of summary.errors) console.log(`  ! ${err.sourcePath}: ${err.message}`);
    return summary.errors.length > 0 ? 1 : 0;
  } finally {
    await memStore.close();
  }
}

main()
  .then((code) => {
    // Drain the event loop instead of process.exit(): forcing exit aborts
    // onnxruntime-node's native teardown (mutex lock failed → SIGABRT / Abort trap 6).
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`\nmemory-capture failed: ${error instanceof Error ? error.message : error}`);
    if (error && error.stack) console.error(error.stack);
    console.error(`\n${USAGE}`);
    process.exitCode = 1;
  });

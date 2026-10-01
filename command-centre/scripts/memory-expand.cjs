#!/usr/bin/env node
/**
 * memory-expand — the expand rung of the recall ladder. Given a chunk id from a
 * scoped memory-search result, returns the surrounding source context (anchor
 * chunk plus a bounded window of neighbours). Reads only through the scope-safe
 * boundary, so out-of-scope ids return "(not found in scope)". No embedding;
 * scope is required.
 *
 * Usage:
 *   node scripts/memory-expand.cjs <chunk-id> --system
 *   node scripts/memory-expand.cjs <chunk-id> --client acme --radius 2
 *   node scripts/memory-expand.cjs <chunk-id> --system --json
 *
 * Flags:
 *   <chunk-id>             positional; the anchor chunk id (required)
 *   --system               expand within the local system baseline
 *   --team <id>            expand as this team (adds system + team)
 *   --client <slug>        expand as this client (adds system + client)
 *   --user <id>            include this user's private rows (adds system + private)
 *   --include <list>       set visibility layers explicitly (system,team,client,private)
 *   --radius <n>           chunks of context on each side of the anchor (default 1)
 *   --limit <n>            hard cap on neighbouring chunks fetched (default 20)
 *   --max-chars <n>        cap on the stitched context length (default 4000)
 *   --team-api             force hosted Team OS Memory API
 *   --local                force local PGLite memory
 *   --json                 emit the expansion as JSON (machine output)
 *   --help
 */

const path = require("node:path");

const { loadTsModule } = require("../src/lib/test-utils/load-ts-module.cjs");
const { findWorkspaceRoot } = require("./workspace-root.cjs");
const { teamRequest } = require("./lib/team-api.cjs");
const {
  buildTeamSearchScope,
  resolveTeamMemoryRoute,
} = require("./lib/team-memory-routing.cjs");

const MEM_DIR = path.resolve(__dirname, "../src/lib/memory");
const resolve = (file) => path.join(MEM_DIR, file);

// ── Load the memory module graph (leaf-first). ──────────────────────────────
const types = { ALL_VISIBILITIES: ["private", "client", "team", "system"] };
const embedding = loadTsModule(resolve("embedding.ts"));
const scope = loadTsModule(resolve("scope.ts"), { stubs: { "./types": types } });
const migrate = loadTsModule(resolve("migrate.ts"));
const adapter = loadTsModule(resolve("pglite-adapter.ts"));
const postgresAdapter = loadTsModule(resolve("postgres-adapter.ts"));
const backend = loadTsModule(resolve("backend.ts"));
const rowMappers = loadTsModule(resolve("row-mappers.ts"), {
  stubs: { "./types": types, "./embedding": embedding },
});
const store = loadTsModule(resolve("store.ts"), {
  stubs: {
    "./types": types,
    "./migrate": migrate,
    "./scope": scope,
    "./embedding": embedding,
    "./row-mappers": rowMappers,
    "./pglite-adapter": adapter,
    "./postgres-adapter": postgresAdapter,
    "./backend": backend,
  },
});
const scopedAccess = loadTsModule(resolve("scoped-access.ts"), {
  stubs: { "./scope": scope, "./row-mappers": rowMappers },
});
const expand = loadTsModule(resolve("expand.ts"), {
  stubs: { "./scoped-access": scopedAccess },
});

// ── Flag parsing. ───────────────────────────────────────────────────────────
const VALID_VISIBILITIES = ["system", "team", "client", "private"];

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[(i += 1)];
    switch (arg) {
      case "--system": flags.system = true; break;
      case "--team": flags.team = next(); break;
      case "--client": flags.client = next(); break;
      case "--user": flags.user = next(); break;
      case "--include": flags.include = next(); break;
      case "--radius": flags.radius = Number(next()); break;
      case "--limit": flags.limit = Number(next()); break;
      case "--max-chars": flags.maxChars = Number(next()); break;
      case "--team-api": flags.teamApi = true; break;
      case "--local": flags.local = true; break;
      case "--json": flags.json = true; break;
      case "--help": case "-h": flags.help = true; break;
      default:
        if (arg.startsWith("--")) throw new Error(`Unknown flag: ${arg}`);
        positional.push(arg);
    }
  }
  flags.chunkId = positional.join(" ").trim();
  return flags;
}

const USAGE = `memory-expand — surrounding source context for a scoped search result

Usage:
  node scripts/memory-expand.cjs <chunk-id> <scope> [options]

Scope (at least one required):
  --system               expand within the local system baseline
  --team <id>            expand as this team (adds system + team)
  --client <slug>        expand as this client (adds system + client)
  --user <id>            include this user's private rows (adds system + private)
  --include <list>       set visibility layers explicitly (system,team,client,private)

Options:
  --radius <n>           chunks of context on each side of the anchor (default 1)
  --limit <n>            hard cap on neighbouring chunks fetched (default 20)
  --max-chars <n>        cap on the stitched context length (default 4000)
  --team-api             force hosted Team OS Memory API
  --local                force local PGLite memory
  --json                 emit the expansion as JSON
  --help`;

/**
 * Build the SearchScope from the CLI flags. An explicit scope is REQUIRED — same
 * rule and shape as memory-search.cjs: identity flags set teamId/clientId/userId;
 * the searched layers come from --include or are derived from the identity flags
 * with `system` as the always-present baseline.
 */
function buildSearchScope(flags) {
  const hasIdentity =
    flags.system === true ||
    flags.team != null ||
    flags.client != null ||
    flags.user != null;
  const hasInclude = flags.include != null;

  if (!hasIdentity && !hasInclude) {
    throw new Error(
      "explicit search scope required: pass one of --system, --team <id>, " +
        "--client <slug>, --user <id>, or --include <layers>",
    );
  }

  const searchScope = {
    teamId: flags.team ?? null,
    clientId: flags.client ?? null,
    userId: flags.user ?? null,
  };

  if (hasInclude) {
    const parts = flags.include.split(",").map((s) => s.trim()).filter(Boolean);
    for (const p of parts) {
      if (!VALID_VISIBILITIES.includes(p)) {
        throw new Error(
          `--include has invalid visibility "${p}" (allowed: ${VALID_VISIBILITIES.join(", ")})`,
        );
      }
    }
    searchScope.include = parts;
  } else {
    const include = ["system"];
    if (flags.team != null) include.push("team");
    if (flags.client != null) include.push("client");
    if (flags.user != null) include.push("private");
    searchScope.include = include;
  }

  return searchScope;
}

function toJson(r) {
  return {
    anchor_chunk_id: r.anchorChunkId,
    source_id: r.sourceId,
    source: r.sourcePath,
    source_path: r.sourcePath,
    source_type: r.sourceType,
    heading: r.heading,
    from_index: r.fromIndex,
    to_index: r.toIndex,
    start_line: r.startLine,
    end_line: r.endLine,
    has_line_provenance: r.hasLineProvenance,
    chunk_ids: r.chunkIds,
    content: r.content,
    truncated: r.truncated,
  };
}

function printHuman(chunkId, searchScope, r) {
  console.log(`memory-expand → ${chunkId}`);
  console.log(
    `  scope: team=${searchScope.teamId ?? "-"} client=${searchScope.clientId ?? "-"} ` +
      `user=${searchScope.userId ?? "-"} layers=${(searchScope.include ?? []).join("+") || "-"}`,
  );
  if (r === null) {
    console.log("  (not found in scope)");
    return;
  }
  const lines =
    r.startLine != null && r.endLine != null ? ` lines ${r.startLine}-${r.endLine}` : "";
  console.log(
    `  ${r.sourcePath} (chunks ${r.fromIndex}-${r.toIndex}${lines}` +
      `${r.hasLineProvenance ? "" : ", no line provenance"}${r.truncated ? ", truncated" : ""})`,
  );
  if (r.heading) console.log(`  # ${r.heading}`);
  console.log("");
  console.log(r.content);
}

function teamApiSignal() {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(30_000)
    : undefined;
}

async function runTeamExpand({ flags, rootDir, route, radius, limit, maxChars, info }) {
  const searchScope = buildTeamSearchScope(flags, { rootDir });
  info(`memory-expand → ${route.config.apiUrl}`);
  info("  backend: Team OS Memory API");
  info(`  scope: client=${searchScope.clientId ?? "-"} layers=${searchScope.include.join("+")}`);

  const body = await teamRequest(route.config, "/v1/memory/expand", {
    method: "POST",
    signal: teamApiSignal(),
    body: {
      chunkId: flags.chunkId,
      scope: searchScope,
      ...(radius !== undefined ? { radius } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(maxChars !== undefined ? { maxChars } : {}),
    },
  });
  const result = body && typeof body === "object" ? body.expansion ?? null : null;

  if (flags.json) {
    console.log(JSON.stringify(result === null ? null : toJson(result), null, 2));
  } else {
    printHuman(flags.chunkId, searchScope, result);
  }
  return 0;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }
  if (!flags.chunkId) {
    console.error("memory-expand: a chunk id is required.\n");
    console.error(USAGE);
    return 1;
  }

  const rootDir = process.env.AI_OS_DIR
    ? path.resolve(process.env.AI_OS_DIR)
    : findWorkspaceRoot(__dirname);

  const radius = Number.isFinite(flags.radius) && flags.radius >= 0 ? Math.floor(flags.radius) : undefined;
  const limit = Number.isFinite(flags.limit) && flags.limit > 0 ? Math.floor(flags.limit) : undefined;
  const maxChars = Number.isFinite(flags.maxChars) && flags.maxChars > 0 ? Math.floor(flags.maxChars) : undefined;

  // Diagnostics go to stderr in --json mode so stdout stays pure JSON.
  const info = flags.json ? (m) => console.error(m) : (m) => console.log(m);

  const route = await resolveTeamMemoryRoute({ flags, env: process.env });
  if (route.target === "team") {
    return runTeamExpand({ flags, rootDir, route, radius, limit, maxChars, info });
  }

  let searchScope;
  try {
    searchScope = buildSearchScope(flags);
  } catch (error) {
    console.error(`memory-expand: ${error instanceof Error ? error.message : error}\n`);
    console.error(USAGE);
    return 1;
  }

  const dataDir = path.join(rootDir, ".command-centre", "memory");
  const resolvedBackend = backend.resolveMemoryBackend({ dataDir }, process.env);
  info(`memory-expand → ${rootDir}`);
  info(`  backend: ${resolvedBackend.kind}`);

  // Expand does no embedding, so the store's embedDim only matters for a fresh-init
  // migration; omit it and let openMemoryStore use the default (idempotent on an
  // existing DB). A local store-open failure is the "backend unavailable" signal.
  let memStore;
  try {
    memStore = await store.openMemoryStore({ dataDir });
  } catch (error) {
    if (resolvedBackend.kind === "pglite") {
      error.code = "MEMORY_BACKEND_UNAVAILABLE";
    }
    throw error;
  }

  try {
    const result = await expand.expandMemoryChunk({
      client: memStore.client,
      chunkId: flags.chunkId,
      searchScope,
      radius,
      limit,
      maxChars,
    });

    if (flags.json) {
      console.log(JSON.stringify(result === null ? null : toJson(result), null, 2));
    } else {
      printHuman(flags.chunkId, searchScope, result);
    }
    return 0;
  } finally {
    await memStore.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(
      `\nmemory-expand failed: ${error instanceof Error ? error.message : error}`,
    );
    if (error && error.stack) console.error(error.stack);
    console.error(`\n${USAGE}`);
    process.exitCode = error && error.code === "MEMORY_BACKEND_UNAVAILABLE" ? 3 : 1;
  });

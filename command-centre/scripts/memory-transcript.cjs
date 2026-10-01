#!/usr/bin/env node
/**
 * memory-transcript — the transcript rung of the recall ladder. Given a chunk id
 * from a scoped memory-search (or memory-expand) result, drills into the raw
 * session transcript it was captured from and returns a small window of turns
 * around the one the chunk summarizes. Reads only through the scope-safe
 * boundary, so out-of-scope ids return "(not found in scope)". No embedding;
 * scope is required.
 *
 * Usage:
 *   node scripts/memory-transcript.cjs <chunk-id> --system
 *   node scripts/memory-transcript.cjs <chunk-id> --client acme --radius 3
 *   node scripts/memory-transcript.cjs <chunk-id> --system --json
 *
 * Flags:
 *   <chunk-id>             positional; the anchor chunk id (required)
 *   --system               drill down within the local system baseline
 *   --team <id>            drill down as this team (adds system + team)
 *   --client <slug>        drill down as this client (adds system + client)
 *   --user <id>            include this user's private rows (adds system + private)
 *   --include <list>       set visibility layers explicitly (system,team,client,private)
 *   --radius <n>           transcript turns on each side of the matched turn (default 2)
 *   --max-chars <n>        cap on the serialized window length (default 4000)
 *   --team-api             rejected: transcript is local-only in this phase
 *   --local                force local PGLite memory
 *   --json                 emit the window as JSON (machine output)
 *   --help
 */

const path = require("node:path");

const { loadTsModule } = require("../src/lib/test-utils/load-ts-module.cjs");
const { findWorkspaceRoot } = require("./workspace-root.cjs");
const { isExpired, readConfigOptional } = require("./lib/team-config.cjs");
const { requestedMemoryMode } = require("./lib/team-memory-routing.cjs");

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
const chunker = loadTsModule(resolve("chunker.ts"));
const discovery = loadTsModule(resolve("discovery.ts"));
const ingest = loadTsModule(resolve("ingest.ts"), {
  stubs: { "./scope": scope, "./embedding": embedding, "./chunker": chunker },
});
const indexer = loadTsModule(resolve("indexer.ts"), {
  stubs: { "./scope": scope, "./ingest": ingest, "./discovery": discovery },
});
const capture = loadTsModule(resolve("capture.ts"), {
  stubs: { "./indexer": indexer },
});
const scopedAccess = loadTsModule(resolve("scoped-access.ts"), {
  stubs: { "./scope": scope, "./row-mappers": rowMappers },
});
const transcript = loadTsModule(resolve("transcript.ts"), {
  stubs: { "./scoped-access": scopedAccess, "./capture": capture },
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

const USAGE = `memory-transcript — raw transcript drill-down for a scoped search result

Usage:
  node scripts/memory-transcript.cjs <chunk-id> <scope> [options]

Scope (at least one required):
  --system               drill down within the local system baseline
  --team <id>            drill down as this team (adds system + team)
  --client <slug>        drill down as this client (adds system + client)
  --user <id>            include this user's private rows (adds system + private)
  --include <list>       set visibility layers explicitly (system,team,client,private)

Options:
  --radius <n>           transcript turns on each side of the matched turn (default 2)
  --max-chars <n>        cap on the serialized window length (default 4000)
  --team-api             rejected: transcript is local-only in this phase
  --local                force local PGLite memory
  --json                 emit the window as JSON
  --help`;

/**
 * Build the SearchScope from the CLI flags. An explicit scope is REQUIRED — same
 * rule and shape as memory-search.cjs / memory-expand.cjs: identity flags set
 * teamId/clientId/userId; the searched layers come from --include or are derived
 * from the identity flags with `system` as the always-present baseline.
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
    chunk_id: r.chunkId,
    source_id: r.sourceId,
    source: r.sourcePath,
    source_path: r.sourcePath,
    transcript_path: r.transcriptPath,
    turn_id: r.turnId,
    matched: r.matched,
    turns: r.turns,
    truncated: r.truncated,
  };
}

function printHuman(chunkId, searchScope, r) {
  console.log(`memory-transcript → ${chunkId}`);
  console.log(
    `  scope: team=${searchScope.teamId ?? "-"} client=${searchScope.clientId ?? "-"} ` +
      `user=${searchScope.userId ?? "-"} layers=${(searchScope.include ?? []).join("+") || "-"}`,
  );
  if (r === null) {
    console.log("  (not found in scope)");
    return;
  }
  console.log(
    `  ${r.sourcePath} → ${r.transcriptPath} (turn ${r.turnId ?? "-"}, ` +
      `${r.matched ? "matched" : "unmatched"}${r.truncated ? ", truncated" : ""})`,
  );
  console.log("");
  if (r.turns.length === 0) {
    console.log("  (no turns)");
    return;
  }
  for (const turn of r.turns) {
    console.log(`  [${turn.role}] ${turn.text}`);
    console.log("");
  }
}

function transcriptRemoteMode(flags, env = process.env) {
  const mode = requestedMemoryMode(flags, env);
  if (mode === "local") return { remote: false };
  if (mode === "team") return { remote: true, expired: false };

  const config = readConfigOptional();
  if (!config) return { remote: false };
  return { remote: true, expired: isExpired(config) };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }
  if (!flags.chunkId) {
    console.error("memory-transcript: a chunk id is required.\n");
    console.error(USAGE);
    return 1;
  }

  try {
    const route = transcriptRemoteMode(flags, process.env);
    if (route.remote) {
      const expired = route.expired
        ? " Saved Team OS login is expired."
        : "";
      console.error(
        `memory-transcript: transcript drill-down reads local transcript files only in this phase.${expired} ` +
          "Use --local to run it against local PGLite.",
      );
      return 1;
    }
  } catch (error) {
    console.error(`memory-transcript: ${error instanceof Error ? error.message : error}\n`);
    console.error(USAGE);
    return 1;
  }

  let searchScope;
  try {
    searchScope = buildSearchScope(flags);
  } catch (error) {
    console.error(`memory-transcript: ${error instanceof Error ? error.message : error}\n`);
    console.error(USAGE);
    return 1;
  }

  const rootDir = process.env.AI_OS_DIR
    ? path.resolve(process.env.AI_OS_DIR)
    : findWorkspaceRoot(__dirname);

  const radius = Number.isFinite(flags.radius) && flags.radius >= 0 ? Math.floor(flags.radius) : undefined;
  const maxChars = Number.isFinite(flags.maxChars) && flags.maxChars > 0 ? Math.floor(flags.maxChars) : undefined;

  // Diagnostics go to stderr in --json mode so stdout stays pure JSON.
  const info = flags.json ? (m) => console.error(m) : (m) => console.log(m);

  const dataDir = path.join(rootDir, ".command-centre", "memory");
  const resolvedBackend = backend.resolveMemoryBackend({ dataDir }, process.env);
  info(`memory-transcript → ${rootDir}`);
  info(`  backend: ${resolvedBackend.kind}`);

  // Transcript drill-down does no embedding, so the store's embedDim only matters
  // for a fresh-init migration; omit it and let openMemoryStore use the default
  // (idempotent on an existing DB). A local store-open failure is the "backend
  // unavailable" signal.
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
    const result = await transcript.expandTranscriptWindow({
      client: memStore.client,
      rootDir,
      chunkId: flags.chunkId,
      searchScope,
      radius,
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
      `\nmemory-transcript failed: ${error instanceof Error ? error.message : error}`,
    );
    if (error && error.stack) console.error(error.stack);
    console.error(`\n${USAGE}`);
    process.exitCode = error && error.code === "MEMORY_BACKEND_UNAVAILABLE" ? 3 : 1;
  });

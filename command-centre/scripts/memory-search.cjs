#!/usr/bin/env node
/**
 * memory-search — the replacement for `memsearch search`.
 *
 * In auto mode, a live saved Team OS login sends the query to the hosted Memory
 * API. If the server advertises server-side query embeddings, the CLI sends
 * text only; otherwise it keeps the legacy client-generated BGE-M3 query vector.
 * Signed-out local mode embeds a query, runs a scope-filtered nearest-neighbour
 * search over the local PGLite + pgvector store, reranks the hits (authority +
 * recency + floor-ratio), and records a `search_events` audit row.
 *
 * Scope is the searcher's IDENTITY. In local AIOS mode, no explicit scope
 * means the stable local private user plus the system baseline. Team OS mode
 * uses the authenticated server identity. Explicit --team/--client/--user flags
 * still let tests and admin tooling pin a scope.
 *
 * Privacy: by default the audit row stores NEITHER the query text nor its
 * embedding. --store-query-text opts the text in; the embedding is never stored.
 *
 * Usage:
 *   node scripts/memory-search.cjs "how did we scope memory?"
 *   node scripts/memory-search.cjs "billing flow" --client acme --top-k 5
 *   node scripts/memory-search.cjs "release process" --json
 *   node scripts/memory-search.cjs "offline note" --local
 *
 * Flags:
 *   <query>                positional; the search text (required)
 *   --system               local mode: search the local system baseline
 *   --team <id>            search as this team (adds system + team)
 *   --client <slug>        search as this client (adds system + client)
 *   --user <id>            include this user's private rows (adds system + private)
 *   --include <list>       set visibility layers explicitly (system,team,client,private)
 *   --top-k <n>            number of results to return (default 10)
 *   --team-api             force hosted Team OS Memory API
 *   --local                force local PGLite memory
 *   --embedding-mode <auto|server|client>
 *                          Team OS search embedding mode (default auto)
 *   --embedder <bge-m3|hash>  local mode default: bge-m3 (or $MEMORY_EMBEDDER); hash is explicit offline mode
 *   --json                 emit the reranked results as JSON (machine output)
 *   --store-query-text     persist the query text on the audit row (off by default)
 *   --no-events            do not write a search_events audit row
 *   --help
 *
 * Local mode defaults to the current machine's private local user + system.
 * Team mode uses the authenticated server identity and defaults to system +
 * team + private, adding client when --client or clients/* cwd applies.
 *
 * The .ts library is loaded the same way the indexer and tests load it — via
 * loadTsModule, leaf-first, injecting each module as a stub into its dependents.
 * There is no build step in this repo; this is the supported runtime path.
 */

const path = require("node:path");

const { loadTsModule } = require("../src/lib/test-utils/load-ts-module.cjs");
const { findWorkspaceRoot } = require("./workspace-root.cjs");
const { ensureLocalUserId } = require("./local-memory-identity.cjs");
const { teamRequest } = require("./lib/team-api.cjs");
const { prepareMemoryApiSearchBody } = require("./lib/memory-api-payload.cjs");
const {
  assertTeamEmbedderAllowed,
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
const embedder = loadTsModule(resolve("embedder.ts"));
const reranker = loadTsModule(resolve("reranker.ts"));
const search = loadTsModule(resolve("search.ts"), {
  stubs: { "./types": types, "./reranker": reranker, "./row-mappers": rowMappers },
});

// ── Flag parsing. ───────────────────────────────────────────────────────────
const VALID_VISIBILITIES = ["system", "team", "client", "private"];
const VALID_EMBEDDING_MODES = new Set(["auto", "server", "client"]);

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
      case "--top-k": flags.topK = Number(next()); break;
      case "--embedding-mode": flags.embeddingMode = next(); break;
      case "--embedder": flags.embedder = next(); break;
      case "--team-api": flags.teamApi = true; break;
      case "--local": flags.local = true; break;
      case "--json": flags.json = true; break;
      case "--store-query-text": flags.storeQueryText = true; break;
      case "--no-events": flags.noEvents = true; break;
      case "--help": case "-h": flags.help = true; break;
      default:
        if (arg.startsWith("--")) throw new Error(`Unknown flag: ${arg}`);
        positional.push(arg);
    }
  }
  flags.query = positional.join(" ").trim();
  return flags;
}

const USAGE = `memory-search — scoped, reranked search over Team OS or local PGLite memory

Usage:
  node scripts/memory-search.cjs "<query>" [scope] [options]

Scope:
  Team OS mode defaults to system + team + private for the signed-in user.
  Local mode defaults to this machine's private local user + system.
  --system               search the local system baseline
  --team <id>            search as this team (adds system + team)
  --client <slug>        search as this client (adds system + client)
  --user <id>            include this user's private rows (adds system + private)
  --include <list>       set visibility layers explicitly (system,team,client,private)

Options:
  --top-k <n>            results to return (default 10)
  --team-api             force hosted Team OS Memory API
  --local                force local PGLite memory
  --embedding-mode <auto|server|client>
                         Team OS mode only. auto uses server-side query
                         embeddings when /v1/health says they are enabled.
  --embedder <bge-m3|hash>   local mode default: bge-m3 (or $MEMORY_EMBEDDER); hash is explicit offline mode
  --json                 emit reranked results as JSON
  --store-query-text     persist the query text on the audit row (off by default)
  --no-events            skip the search_events audit row
  --help`;

/**
 * Build the SearchScope from the CLI flags. With no explicit local scope, use a
 * stable local private user. Explicit identity flags set teamId/clientId/userId;
 * searched visibility layers are taken from --include when given, else derived
 * from the identity flags with `system` as the always-present baseline.
 */
function buildSearchScope(flags, { rootDir } = {}) {
  const hasIdentity =
    flags.system === true ||
    flags.team != null ||
    flags.client != null ||
    flags.user != null;
  const hasInclude = flags.include != null;
  let includeParts = null;

  if (hasInclude) {
    includeParts = flags.include.split(",").map((s) => s.trim()).filter(Boolean);
    for (const part of includeParts) {
      if (!VALID_VISIBILITIES.includes(part)) {
        throw new Error(
          `--include has invalid visibility "${part}" (allowed: ${VALID_VISIBILITIES.join(", ")})`,
        );
      }
    }
  }

  if (!hasIdentity && !hasInclude) {
    if (!rootDir) {
      throw new Error("local default private search requires a workspace root");
    }
    return {
      teamId: null,
      clientId: null,
      userId: ensureLocalUserId(rootDir),
      include: ["system", "private"],
    };
  }

  let userId = flags.user ?? null;
  if (includeParts?.includes("private") && userId == null) {
    if (!rootDir) {
      throw new Error("local private search requires a workspace root");
    }
    userId = ensureLocalUserId(rootDir);
  }

  const searchScope = {
    teamId: flags.team ?? null,
    clientId: flags.client ?? null,
    userId,
  };

  if (hasInclude) {
    searchScope.include = includeParts;
  } else {
    // Derive layers from the identity flags; system is the baseline everyone sees.
    const include = ["system"];
    if (flags.team != null) include.push("team");
    if (flags.client != null) include.push("client");
    if (flags.user != null) include.push("private");
    searchScope.include = include;
  }

  return searchScope;
}

function snippet(text, max = 160) {
  const collapsed = String(text).replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

function toJson(r) {
  return {
    chunk_id: r.id,
    source_id: r.sourceId,
    source: r.sourcePath,
    source_path: r.sourcePath,
    source_type: r.sourceType,
    content_date: r.contentDate,
    heading: r.heading,
    heading_level: r.headingLevel,
    start_line: r.startLine,
    end_line: r.endLine,
    content_hash: r.contentHash,
    chunk_key: r.chunkKey,
    content: r.content,
    score: Number((1 - r.distance).toFixed(6)),
    distance: r.distance,
    match_type: r.matchType,
    vector_rank: r.vectorRank,
    keyword_rank: r.keywordRank,
    keyword_score: r.keywordScore,
    fusion_score: r.fusionScore,
    final_score: r.finalScore,
    reranked: r.reranked,
  };
}

function normalizeNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeRemoteHit(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const score = normalizeNumber(r.score, null);
  const distance = normalizeNumber(r.distance, score == null ? 1 : 1 - score);
  return {
    id: r.chunkId ?? r.chunk_id ?? r.id ?? null,
    sourceId: r.sourceId ?? r.source_id ?? null,
    sourcePath: String(r.sourcePath ?? r.source_path ?? r.source ?? "team-memory"),
    sourceType: r.sourceType ?? r.source_type ?? "memory",
    contentDate: r.contentDate ?? r.content_date ?? null,
    heading: r.heading ?? null,
    headingLevel: r.headingLevel ?? r.heading_level ?? null,
    startLine: r.startLine ?? r.start_line ?? null,
    endLine: r.endLine ?? r.end_line ?? null,
    contentHash: r.contentHash ?? r.content_hash ?? null,
    chunkKey: r.chunkKey ?? r.chunk_key ?? null,
    content: String(r.content ?? ""),
    distance,
    matchType: r.matchType ?? r.match_type ?? "vector",
    vectorRank: r.vectorRank ?? r.vector_rank ?? null,
    keywordRank: r.keywordRank ?? r.keyword_rank ?? null,
    keywordScore: r.keywordScore ?? r.keyword_score ?? null,
    fusionScore: r.fusionScore ?? r.fusion_score ?? null,
    finalScore: normalizeNumber(r.finalScore ?? r.final_score, score == null ? 0 : score),
    reranked: r.reranked ?? true,
  };
}

function normalizeRemoteSearchResponse(body, fallbackScope) {
  const record = body && typeof body === "object" ? body : {};
  const rawResults = Array.isArray(record.results) ? record.results : [];
  const visibilitySet = Array.isArray(record.visibilitySet)
    ? record.visibilitySet.filter((value) => typeof value === "string")
    : fallbackScope.include ?? [];
  return {
    results: rawResults.map(normalizeRemoteHit),
    visibilitySet,
    latencyMs: normalizeNumber(record.latencyMs, 0),
    event: typeof record.eventId === "string" ? { id: record.eventId } : null,
  };
}

function printHuman(query, searchScope, res) {
  console.log(`memory-search → "${query}"`);
  console.log(
    `  scope: team=${searchScope.teamId ?? "-"} client=${searchScope.clientId ?? "-"} ` +
      `user=${searchScope.userId ?? "-"} layers=${res.visibilitySet.join("+") || "-"}`,
  );
  const eventNote = res.event ? `event ${res.event.id}` : "no event recorded";
  console.log(`  ${res.results.length} result(s) in ${res.latencyMs}ms (${eventNote})`);
  if (res.results.length === 0) {
    console.log("  (no matches in scope)");
    return;
  }
  res.results.forEach((r, i) => {
    console.log(
      `\n  ${i + 1}. [${r.finalScore.toFixed(4)}] ${r.sourcePath}  ` +
        `(${r.contentDate ?? "-"}, ${r.matchType ?? "vector"})`,
    );
    if (r.startLine != null && r.endLine != null) {
      console.log(`     lines ${r.startLine}-${r.endLine}`);
    }
    if (r.heading) console.log(`     # ${r.heading}`);
    console.log(`     ${snippet(r.content)}`);
  });
}

function teamApiSignal() {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(30_000)
    : undefined;
}

function shortTeamApiSignal() {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(5_000)
    : undefined;
}

function normalizeEmbeddingMode(raw) {
  const mode = String(raw ?? "auto").trim().toLowerCase() || "auto";
  if (!VALID_EMBEDDING_MODES.has(mode)) {
    throw new Error(`--embedding-mode must be auto, server, or client (got "${mode}")`);
  }
  return mode;
}

function hasServerSideSearchEmbeddings(health) {
  return health &&
    typeof health === "object" &&
    health.embedder &&
    typeof health.embedder === "object" &&
    health.embedder.serverModeEnabled === true;
}

async function readTeamHealth(config) {
  try {
    const body = await teamRequest(config, "/v1/health", {
      signal: shortTeamApiSignal(),
    });
    return { ok: true, body };
  } catch (error) {
    return { ok: false, error };
  }
}

async function resolveTeamSearchEmbeddingMode({ flags, route }) {
  const requested = normalizeEmbeddingMode(flags.embeddingMode);
  if (requested === "client") return "client";

  const health = await readTeamHealth(route.config);
  if (health.ok && hasServerSideSearchEmbeddings(health.body)) {
    return "server";
  }

  if (requested === "server") {
    const reason = health.ok
      ? "the server does not advertise server-side search embeddings"
      : `could not read /v1/health: ${health.error instanceof Error ? health.error.message : health.error}`;
    throw new Error(
      `Server-side search embeddings are not enabled (${reason}). ` +
        "Set MEMORY_API_SERVER_EMBEDDINGS=1 on the API server, or use --embedding-mode client.",
    );
  }

  return "client";
}

async function runTeamSearch({ flags, rootDir, route, info }) {
  const searchScope = buildTeamSearchScope(flags, { rootDir });
  const topK = Number.isFinite(flags.topK) && flags.topK > 0 ? Math.floor(flags.topK) : 10;
  const embeddingMode = await resolveTeamSearchEmbeddingMode({ flags, route });

  info(`memory-search → ${route.config.apiUrl}`);
  info("  backend: Team OS Memory API");
  info(`  scope: client=${searchScope.clientId ?? "-"} layers=${searchScope.include.join("+")}`);
  info(
    `  embedding: ${embeddingMode === "server" ? "server-side bge-m3" : "client-provided bge-m3"}`,
  );

  let embeddingPayload;
  if (embeddingMode === "server") {
    embeddingPayload = { embeddingMode: "server" };
  } else {
    assertTeamEmbedderAllowed(flags, process.env);
    embeddingPayload = await prepareMemoryApiSearchBody(flags.query);
  }
  const body = await teamRequest(route.config, "/v1/memory/search", {
    method: "POST",
    signal: teamApiSignal(),
    body: {
      query: flags.query,
      ...embeddingPayload,
      topK,
      storeQueryText: flags.storeQueryText === true,
      scope: searchScope,
    },
  });

  const res = normalizeRemoteSearchResponse(body, searchScope);
  if (flags.json) {
    console.log(JSON.stringify(res.results.map(toJson), null, 2));
  } else {
    printHuman(flags.query, searchScope, res);
  }
  return 0;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }
  if (!flags.query) {
    console.error("memory-search: a query is required.\n");
    console.error(USAGE);
    return 1;
  }

  const rootDir = process.env.AI_OS_DIR
    ? path.resolve(process.env.AI_OS_DIR)
    : findWorkspaceRoot(__dirname);
  process.env.MEMORY_MODEL_CACHE_DIR =
    process.env.MEMORY_MODEL_CACHE_DIR || path.join(rootDir, ".command-centre", "models");

  // Diagnostics go to stderr in --json mode so stdout stays pure JSON.
  const info = flags.json ? (m) => console.error(m) : (m) => console.log(m);

  const route = await resolveTeamMemoryRoute({ flags, env: process.env });
  if (route.target === "team") {
    return runTeamSearch({ flags, rootDir, route, info });
  }

  let searchScope;
  try {
    searchScope = buildSearchScope(flags, { rootDir });
  } catch (error) {
    console.error(`memory-search: ${error instanceof Error ? error.message : error}\n`);
    console.error(USAGE);
    return 1;
  }

  const topK = Number.isFinite(flags.topK) && flags.topK > 0 ? Math.floor(flags.topK) : 10;

  const emb = await embedder.createEmbedder({ kind: flags.embedder });
  info(`memory-search → ${rootDir}`);
  info(`  embedder: ${emb.model} (dim ${emb.dim})`);

  const cfg = reranker.loadRerankerConfig(rootDir);
  const dataDir = path.join(rootDir, ".command-centre", "memory");

  // Which engine will openMemoryStore pick? Resolve it here (same pure rule) so
  // we can decide how a store-open failure is reported. A failed resolution
  // (e.g. MEMORY_STORE_BACKEND=postgres with no URL) propagates as a hard error.
  const resolvedBackend = backend.resolveMemoryBackend({ dataDir }, process.env);
  info(`  backend: ${resolvedBackend.kind}`);

  // A store-open failure on the LOCAL engine is the "backend unavailable" signal:
  // tag it so the top-level handler surfaces exit 3. For the HOSTED engine this
  // stays a hard error (exit 1), preserving the no-silent-local-fallback rule.
  let memStore;
  try {
    memStore = await store.openMemoryStore({ dataDir, embedDim: emb.dim });
  } catch (error) {
    if (resolvedBackend.kind === "pglite") {
      error.code = "MEMORY_BACKEND_UNAVAILABLE";
    }
    throw error;
  }

  try {
    const res = await search.searchMemory({
      store: memStore,
      embedder: emb,
      query: flags.query,
      searchScope,
      topK,
      rerankConfig: cfg,
      recordEvent: flags.noEvents !== true,
      storeQueryText: flags.storeQueryText === true,
    });

    if (flags.json) {
      console.log(JSON.stringify(res.results.map(toJson), null, 2));
    } else {
      printHuman(flags.query, searchScope, res);
    }
    return 0;
  } finally {
    await memStore.close();
  }
}

module.exports = { buildSearchScope, parseArgs };

if (require.main === module) {
  main()
    .then((code) => {
      // Drain the event loop instead of process.exit(): forcing exit aborts
      // onnxruntime-node's native teardown (mutex lock failed → SIGABRT / Abort trap 6).
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(
        `\nmemory-search failed: ${error instanceof Error ? error.message : error}`,
      );
      if (error && error.stack) console.error(error.stack);
      console.error(`\n${USAGE}`);
      // Store-open failure -> exit 3 ("backend unavailable"). All else stays exit 1.
      process.exitCode = error && error.code === "MEMORY_BACKEND_UNAVAILABLE" ? 3 : 1;
    });
}

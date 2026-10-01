#!/usr/bin/env node
/**
 * memory-index — the replacement for `memsearch index`.
 *
 * Indexes the active AI-OS memory sources (context/memory and
 * context/learnings.md) into the local PGLite + pgvector store, tagging every
 * chunk with an explicit scope. Additional roots can still be passed with
 * --root, and legacy .memsearch/memory can be imported only when passed
 * explicitly with --root during migration.
 *
 * Scope is REQUIRED — the command refuses to run without --visibility. This is
 * the CLI face of "explicit scope at indexing time".
 *
 * Usage:
 *   node scripts/memory-index.cjs --visibility system
 *   node scripts/memory-index.cjs --visibility client --client acme
 *   node scripts/memory-index.cjs --visibility system --embedder local
 *   node scripts/memory-index.cjs --visibility system --dry-run
 *
 * Flags:
 *   --visibility <system|team|client|private>  (required)
 *   --team <id>     teamId   (required iff visibility=team)
 *   --client <slug> clientId (required iff visibility=client)
 *   --user <id>     userId   (required iff visibility=private)
 *   --root <path>   override source root (repeatable)
 *   --embedder <bge-m3|hash>  default: bge-m3 (or $MEMORY_EMBEDDER); hash is explicit offline mode
 *   --force         re-embed even unchanged sources
 *   --dry-run       discover + chunk only; no database writes
 *   --help
 *
 * The .ts library is loaded the same way the tests load it — via loadTsModule,
 * leaf-first, injecting each module as a stub into the ones that import it.
 * There is no build step in this repo; this is the supported runtime path.
 */

const path = require("node:path");

const { findWorkspaceRoot } = require("./workspace-root.cjs");
const { loadMemoryModules } = require("./load-memory-modules.cjs");

// ── Load the memory module graph (leaf-first, shared loader). ───────────────
const { scope, store, embedder, chunker, discovery, indexer } = loadMemoryModules({
  withCapture: false,
});

// ── Flag parsing. ───────────────────────────────────────────────────────────
function parseArgs(argv) {
  const flags = { roots: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[(i += 1)];
    switch (arg) {
      case "--visibility": flags.visibility = next(); break;
      case "--team": flags.team = next(); break;
      case "--client": flags.client = next(); break;
      case "--user": flags.user = next(); break;
      case "--root": flags.roots.push(next()); break;
      case "--embedder": flags.embedder = next(); break;
      case "--reason": flags.reason = next(); break;
      case "--force": flags.force = true; break;
      case "--dry-run": flags.dryRun = true; break;
      case "--help": case "-h": flags.help = true; break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return flags;
}

const USAGE = `memory-index — index AI-OS memory into the PGLite store

Required:
  --visibility <system|team|client|private>

Conditionally required:
  --team <id>      when --visibility team
  --client <slug>  when --visibility client
  --user <id>      when --visibility private

Optional:
  --root <path>    override source root (repeatable)
  --embedder <bge-m3|hash>   default: bge-m3 (or $MEMORY_EMBEDDER); hash is explicit offline mode
  --reason <manual|refresh|session_capture|file_change|backfill>  index_jobs tag (default manual)
  --force          re-embed even unchanged sources
  --dry-run        discover + chunk only; no database writes
  --help`;

function buildScope(flags) {
  if (!flags.visibility) {
    throw new Error("--visibility is required (explicit scope at indexing time)");
  }
  const valid = ["system", "team", "client", "private"];
  if (!valid.includes(flags.visibility)) {
    throw new Error(`--visibility must be one of: ${valid.join(", ")}`);
  }
  const s = scope.normalizeScope({
    teamId: flags.team ?? null,
    clientId: flags.client ?? null,
    userId: flags.user ?? null,
    visibility: flags.visibility,
  });
  // Throws a typed error if a required id is missing for the visibility.
  scope.assertValidScope(s);
  return s;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }

  const rootDir = process.env.AI_OS_DIR
    ? path.resolve(process.env.AI_OS_DIR)
    : findWorkspaceRoot(__dirname);
  process.env.MEMORY_MODEL_CACHE_DIR =
    process.env.MEMORY_MODEL_CACHE_DIR || path.join(rootDir, ".command-centre", "models");
  const baseScope = buildScope(flags);
  const roots = flags.roots.length > 0 ? flags.roots : undefined;

  console.log(`memory-index → ${rootDir}`);
  console.log(
    `  scope: visibility=${baseScope.visibility} team=${baseScope.teamId ?? "-"} ` +
      `client=${baseScope.clientId ?? "-"} user=${baseScope.userId ?? "-"}`,
  );

  // Dry run: discovery + chunk counts only, no store.
  if (flags.dryRun) {
    const weights = discovery.loadAuthorityWeights(rootDir);
    const sources = discovery.discoverSources({ rootDir, roots, authorityWeights: weights });
    console.log(`  [dry-run] ${sources.length} source(s):`);
    let totalChunks = 0;
    for (const src of sources) {
      const n = chunker.chunkMarkdown(src.content).length;
      totalChunks += n;
      console.log(
        `    ${src.sourcePath}  type=${src.sourceType} date=${src.contentDate ?? "-"} ` +
          `weight=${src.authorityWeight} chunks=${n}`,
      );
    }
    console.log(`  [dry-run] ${totalChunks} chunk(s) total. No data written.`);
    return 0;
  }

  const kind = flags.embedder; // undefined → factory uses $MEMORY_EMBEDDER or "bge-m3"
  const emb = await embedder.createEmbedder({ kind });
  console.log(`  embedder: ${emb.model} (dim ${emb.dim})`);

  const dataDir = path.join(rootDir, ".command-centre", "memory");
  const memStore = await store.openMemoryStore({ dataDir, embedDim: emb.dim });

  try {
    const summary = await indexer.indexSources({
      store: memStore,
      embedder: emb,
      scope: baseScope,
      rootDir,
      roots,
      force: flags.force === true,
      reason: flags.reason,
      log: (msg) => console.log(msg),
    });

    console.log("\n── summary ─────────────────────────────");
    console.log(`  sources indexed : ${summary.sourcesIndexed}`);
    console.log(`  sources skipped : ${summary.sourcesSkipped}`);
    console.log(`  chunks inserted : ${summary.chunksInserted}`);
    console.log(`  chunks pruned   : ${summary.chunksPruned}`);
    console.log(`  errors          : ${summary.errors.length}`);
    for (const err of summary.errors) {
      console.log(`    ! ${err.sourcePath}: ${err.message}`);
    }
    console.log(`  db: ${dataDir}`);

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
    console.error(`\nmemory-index failed: ${error instanceof Error ? error.message : error}`);
    if (error && error.stack) console.error(error.stack);
    console.error(`\n${USAGE}`);
    process.exitCode = 1;
  });

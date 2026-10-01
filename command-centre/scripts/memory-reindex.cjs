#!/usr/bin/env node
/**
 * memory-reindex — seed the hosted memory store with existing memory.
 *
 * The one-shot migration that moves the AI-OS memory sources already on
 * disk (context/memory and context/learnings.md) into HOSTED Postgres, so a
 * freshly provisioned team database starts with the existing history instead of
 * empty. Additional roots can still be passed with --root, and legacy
 * .memsearch/memory can be imported only when passed explicitly with --root
 * during migration.
 *
 * It is not a new pipeline — it runs the SAME indexer (indexSources) every
 * memory:index pass uses, so chunking, embedding, metadata, and the idempotent
 * UPSERT/prune behavior are identical. Re-running does NOT duplicate chunks
 * (the acceptance criterion): unchanged sources are skipped, and a changed
 * source replaces its chunks in place.
 *
 * What it adds over `memory:index` is INTENT + a guard rail. "Re-index into
 * hosted Postgres" must not silently write the LOCAL PGLite store because
 * MEMORY_DATABASE_URL was forgotten — that would seed nothing and look like it
 * worked. So this command resolves the backend first and REFUSES to run against
 * local PGLite unless you pass --allow-local. (Same "no silent unsafe source of
 * truth" spirit as the backend-selection rule.)
 *
 * Scope: local PGLite defaults to the stable local private user so rebuilding
 * matches automatic capture. Hosted Postgres requires an explicit visibility;
 * shared `system` seeding must be an intentional operator choice. Per-client
 * folders auto-scope to their client regardless.
 *
 * Usage:
 *   MEMORY_DATABASE_URL=postgres://... node scripts/memory-reindex.cjs --visibility system
 *   MEMORY_DATABASE_URL=postgres://... node scripts/memory-reindex.cjs --visibility system --dry-run
 *   MEMORY_DATABASE_URL=postgres://... node scripts/memory-reindex.cjs --visibility system --force
 *   node scripts/memory-reindex.cjs --allow-local        # backfill the LOCAL store
 *
 * Flags:
 *   --visibility <system|team|client|private>  local default: private; hosted: required
 *   --team <id>     teamId   (required iff visibility=team)
 *   --client <slug> clientId (required iff visibility=client)
 *   --user <id>     userId   (required iff visibility=private)
 *   --root <path>   override source root (repeatable)
 *   --embedder <bge-m3|hash>  default: bge-m3 (or $MEMORY_EMBEDDER); hash is explicit offline mode
 *   --force         re-embed even unchanged sources (full re-index)
 *   --allow-local   permit writing to the LOCAL PGLite store (no hosted URL set)
 *   --dry-run       discover + chunk only; no database writes
 *   --help
 *
 * The .ts library is loaded the same way the other memory commands load it —
 * via loadTsModule, leaf-first (scripts/load-memory-modules.cjs). There is no
 * build step in this repo; this is the supported runtime path.
 */

const path = require("node:path");

const { findWorkspaceRoot } = require("./workspace-root.cjs");
const { ensureLocalUserId, readLocalUserId } = require("./local-memory-identity.cjs");
const { loadMemoryModules } = require("./load-memory-modules.cjs");

// ── Load the memory module graph (leaf-first, shared loader). ───────────────
const { backend, scope, store, embedder, chunker, discovery, indexer } = loadMemoryModules({
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
      case "--force": flags.force = true; break;
      case "--allow-local": flags.allowLocal = true; break;
      case "--dry-run": flags.dryRun = true; break;
      case "--help": case "-h": flags.help = true; break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return flags;
}

const USAGE = `memory-reindex — rebuild existing AI-OS memory

Local PGLite defaults to the stable local private user.
Hosted Postgres requires an explicit --visibility.

Optional:
  --visibility <system|team|client|private>   local default: private; hosted: required
  --team <id>      when --visibility team
  --client <slug>  when --visibility client
  --user <id>      when --visibility private
  --root <path>    override source root (repeatable)
  --embedder <bge-m3|hash>   default: bge-m3 (or $MEMORY_EMBEDDER); hash is explicit offline mode
  --force          re-embed even unchanged sources (full re-index)
  --allow-local    permit writing to LOCAL PGLite (no MEMORY_DATABASE_URL set)
  --dry-run        discover + chunk only; no data written
  --help`;

function buildScope(flags, options) {
  const { backendKind, rootDir, persistLocalIdentity = true } = options;
  const visibility = flags.visibility ?? (backendKind === "pglite" ? "private" : null);
  const valid = ["system", "team", "client", "private"];
  if (!visibility) {
    throw new Error(
      "--visibility is required when re-indexing hosted Postgres; use system only for an intentional shared baseline",
    );
  }
  if (!valid.includes(visibility)) {
    throw new Error(`--visibility must be one of: ${valid.join(", ")}`);
  }
  let userId = flags.user ?? null;
  if (visibility === "private" && backendKind === "pglite" && !userId) {
    userId = persistLocalIdentity
      ? ensureLocalUserId(rootDir)
      : readLocalUserId(rootDir) || "local-dry-run";
  }
  const s = scope.normalizeScope({
    teamId: flags.team ?? null,
    clientId: flags.client ?? null,
    userId,
    visibility,
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
  const roots = flags.roots.length > 0 ? flags.roots : undefined;
  const dataDir = path.join(rootDir, ".command-centre", "memory");

  // Resolve which engine openMemoryStore will pick (same pure rule). A backfill
  // named "into hosted Postgres" must not quietly seed the local store.
  const resolvedBackend = backend.resolveMemoryBackend({ dataDir }, process.env);

  if (resolvedBackend.kind === "pglite" && !flags.allowLocal && !flags.dryRun) {
    console.error(
      "\nmemory-reindex: refusing to seed the LOCAL PGLite store.\n" +
        "  This command re-indexes existing memory INTO hosted Postgres. No " +
        "connection\n  string is set, so it would write to the local store " +
        "instead — almost certainly\n  not what you want.\n\n" +
        "  Fix: set MEMORY_DATABASE_URL (or DATABASE_URL) to your hosted Postgres,\n" +
        "  e.g. MEMORY_DATABASE_URL=postgres://... npm run memory:reindex -- --visibility system\n\n" +
        "  Or pass --allow-local to deliberately backfill the local store.",
    );
    return 2;
  }

  const baseScope = buildScope(flags, {
    backendKind: resolvedBackend.kind,
    rootDir,
    persistLocalIdentity: !flags.dryRun,
  });
  console.log(`memory-reindex → ${rootDir}`);
  console.log(`  backend: ${resolvedBackend.kind}`);
  console.log(
    `  scope: visibility=${baseScope.visibility} team=${baseScope.teamId ?? "-"} ` +
      `client=${baseScope.clientId ?? "-"} user=${baseScope.userId ?? "-"}`,
  );

  // Dry run: discovery + chunk counts only, no store opened.
  if (flags.dryRun) {
    const weights = discovery.loadAuthorityWeights(rootDir);
    const sources = discovery.discoverSources({ rootDir, roots, authorityWeights: weights });
    console.log(`\n  [dry-run] ${sources.length} source(s):`);
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

  const emb = await embedder.createEmbedder({ kind: flags.embedder });
  console.log(`  embedder: ${emb.model} (dim ${emb.dim})`);

  const memStore = await store.openMemoryStore({ dataDir, embedDim: emb.dim });

  try {
    const summary = await indexer.indexSources({
      store: memStore,
      embedder: emb,
      scope: baseScope,
      rootDir,
      roots,
      force: flags.force === true,
      reason: "backfill", // the index_jobs tag for this migration
      log: (msg) => console.log(msg),
    });

    console.log("\n── summary ─────────────────────────────");
    console.log(`  sources indexed : ${summary.sourcesIndexed}`);
    console.log(`  sources skipped : ${summary.sourcesSkipped}  (unchanged — no duplicate chunks)`);
    console.log(`  chunks inserted : ${summary.chunksInserted}`);
    console.log(`  chunks pruned   : ${summary.chunksPruned}`);
    console.log(`  errors          : ${summary.errors.length}`);
    for (const err of summary.errors) {
      console.log(`    ! ${err.sourcePath}: ${err.message}`);
    }
    console.log(`  target: ${resolvedBackend.kind === "postgres" ? "hosted Postgres" : dataDir}`);

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
    console.error(`\nmemory-reindex failed: ${error instanceof Error ? error.message : error}`);
    if (error && error.stack) console.error(error.stack);
    console.error(`\n${USAGE}`);
    process.exitCode = 1;
  });

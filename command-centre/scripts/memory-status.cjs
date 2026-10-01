#!/usr/bin/env node
/**
 * memory-status — local view of the PGLite memory store.
 *
 * Confirms that AI-OS-owned capture + indexing are working: source/chunk
 * counts, per-visibility breakdown, the most recent index job (with its reason),
 * and whether today's session capture exists and is indexed. This is the
 * "expose enough local status" deliverable; it makes no network calls and writes
 * nothing.
 *
 * Usage:
 *   node scripts/memory-status.cjs
 *   node scripts/memory-status.cjs --json
 */

const fs = require("node:fs");
const path = require("node:path");

const { findWorkspaceRoot } = require("./workspace-root.cjs");
const { loadMemoryModules } = require("./load-memory-modules.cjs");

const { store, capture } = loadMemoryModules({ withCapture: true });

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    if (arg === "--json") flags.json = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

const USAGE = `memory-status — counts, last index job, and today's capture state

Usage:
  node scripts/memory-status.cjs [--json]`;

function printHuman(rootDir, status) {
  console.log(`memory-status → ${rootDir}`);
  console.log(`  sources: ${status.sources}   chunks: ${status.chunks}`);
  console.log(
    `  embedding: expected=${status.expectedEmbeddingModel}/${status.expectedEmbeddingDim} ` +
      `store_dim=${status.embedDim} compatible=${status.embeddingCompatible ? "yes" : "no"}`,
  );
  if (status.embeddingModels && status.embeddingModels.length > 0) {
    const models = status.embeddingModels
      .map((m) => `${m.model ?? "unknown"}/${m.dim ?? "unknown"}=${m.chunks}`)
      .join("  ");
    console.log(`  indexed models: ${models}`);
  }
  const vis = capture.STATUS_VISIBILITIES
    .map((v) => `${v}=${status.byVisibility[v] ?? 0}`)
    .join("  ");
  console.log(`  by visibility: ${vis}`);
  if (status.lastIndex) {
    const li = status.lastIndex;
    console.log(
      `  last index: ${li.status} (${li.reason}) ${li.sourcePath} @ ${li.finishedAt ?? "—"}`,
    );
  } else {
    console.log("  last index: none recorded");
  }
  const t = status.today;
  console.log(
    `  today (${t.date}): curated=${t.curatedPresent ? "yes" : "no"}  ` +
      `capture=${t.capturePresent ? "yes" : "no"}  indexed=${t.captureIndexed ? "yes" : "no"}`,
  );
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
  const dataDir = path.join(rootDir, ".command-centre", "memory");
  fs.mkdirSync(dataDir, { recursive: true }); // PGLite's own mkdir is not recursive
  const memStore = await store.openMemoryStore({ dataDir });

  try {
    const status = await capture.memoryStatus({ store: memStore, rootDir });
    if (flags.json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      printHuman(rootDir, status);
    }
    return 0;
  } finally {
    await memStore.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`\nmemory-status failed: ${error instanceof Error ? error.message : error}`);
    if (error && error.stack) console.error(error.stack);
    console.error(`\n${USAGE}`);
    process.exit(1);
  });

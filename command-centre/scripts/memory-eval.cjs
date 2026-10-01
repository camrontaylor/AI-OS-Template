#!/usr/bin/env node
/**
 * memory-eval — recall evaluation harness for the memory store. Indexes the
 * committed gold-set corpus, runs it through the real search path, and reports
 * recall@k, MRR, scope-leak count, and latency. Exit code gates on thresholds;
 * --embedder hash gives a deterministic/offline run.
 *
 * Usage:
 *   npm run memory:eval                         # bge-m3, committed corpus
 *   npm run memory:eval -- --embedder hash      # deterministic, offline
 *   npm run memory:eval -- --json               # machine output
 *   npm run memory:eval -- --gold-set ./my.json # custom gold-set
 *   npm run memory:eval -- --live --gold-set ./real.json  # eval the real store
 *
 * Flags:
 *   --embedder <bge-m3|hash>   default: bge-m3 (or $MEMORY_EMBEDDER)
 *   --k <list>                 recall cutoffs, e.g. 1,5,10 (5 is always included)
 *   --gold-set <path>          override the committed gold-set
 *   --live                     evaluate the real .command-centre/memory store
 *                              instead of indexing the committed corpus
 *                              (pair with a --gold-set that matches your memory)
 *   --json                     emit the full report + gate as JSON
 *   --help
 */

const fs = require("node:fs");
const path = require("node:path");

const { loadTsModule } = require("../src/lib/test-utils/load-ts-module.cjs");
const { loadMemoryModules } = require("./load-memory-modules.cjs");
const { findWorkspaceRoot } = require("./workspace-root.cjs");

const MEM_DIR = path.resolve(__dirname, "../src/lib/memory");
const CORPUS_DIR = path.join(MEM_DIR, "eval", "corpus");
const DEFAULT_GOLD_SET = path.join(MEM_DIR, "eval", "gold-set.json");

// ── Load the memory module graph + the eval module (leaf-first). ─────────────
const modules = loadMemoryModules({ withSearch: true, withCapture: false });
const evalMod = loadTsModule(path.join(MEM_DIR, "eval.ts"), {
  stubs: { "./search": modules.search, "./indexer": modules.indexer },
});
const { store, embedder } = modules;

// ── Flag parsing. ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[(i += 1)];
    switch (arg) {
      case "--embedder": flags.embedder = next(); break;
      case "--k": flags.k = next(); break;
      case "--gold-set": flags.goldSet = next(); break;
      case "--live": flags.live = true; break;
      case "--json": flags.json = true; break;
      case "--help": case "-h": flags.help = true; break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return flags;
}

const USAGE = `memory-eval — recall evaluation over the memory store

Usage:
  npm run memory:eval [-- options]

Options:
  --embedder <bge-m3|hash>   default: bge-m3 (or $MEMORY_EMBEDDER); hash is deterministic/offline
  --k <list>                 recall cutoffs, e.g. 1,5,10 (5 is always included)
  --gold-set <path>          override the committed gold-set
  --live                     evaluate the real .command-centre/memory store (pair with --gold-set)
  --json                     emit the full report + gate as JSON
  --help`;

function parseKs(raw) {
  const base = raw
    ? raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0)
    : [1, 5, 10];
  // 5 is always present so an @5 threshold can be evaluated.
  const set = new Set(base);
  set.add(5);
  return [...set].sort((a, b) => a - b);
}

/** Build the gate checks from the report + gold-set thresholds. */
function evaluateGate(report, thresholds, embedderModel) {
  const th = thresholds || {};
  const isBge = embedderModel === "bge-m3";
  const maxLeaks = th.maxLeaks != null ? th.maxLeaks : 0;
  const checks = [];

  checks.push({
    name: `leak-count <= ${maxLeaks}`,
    got: report.leakCount,
    ok: report.leakCount <= maxLeaks,
  });

  if (th.exactRecallAt5 != null) {
    const got = report.byKind.exact.recallAtK[5] ?? 0;
    checks.push({ name: `exact recall@5 >= ${th.exactRecallAt5}`, got, ok: got >= th.exactRecallAt5 });
  }

  if (th.semanticRecallAt5 != null) {
    const got = report.byKind.semantic.recallAtK[5] ?? 0;
    if (isBge) {
      checks.push({ name: `semantic recall@5 >= ${th.semanticRecallAt5}`, got, ok: got >= th.semanticRecallAt5 });
    } else {
      checks.push({
        name: `semantic recall@5 (informational under ${embedderModel})`,
        got,
        ok: true,
        informational: true,
      });
    }
  }

  return { pass: checks.every((c) => c.ok), checks };
}

function fmtPct(n) {
  return (typeof n === "number" ? n : 0).toFixed(2);
}

function printHuman(report, gate, source) {
  const kinds = report.cases.reduce((acc, c) => {
    acc[c.kind] = (acc[c.kind] || 0) + 1;
    return acc;
  }, {});
  console.log(`memory-eval → ${source}`);
  console.log(`  embedder: ${report.embedderModel}`);
  console.log(
    `  cases: ${report.totalCases} (exact ${kinds.exact || 0}, ` +
      `semantic ${kinds.semantic || 0}, leak ${kinds.leak || 0})`,
  );

  const row = (label, m) => {
    const cells = report.ks.map((k) => `@${k} ${fmtPct(m.recallAtK[k])}`).join("  ");
    console.log(`    ${label.padEnd(9)} ${cells}   mrr ${fmtPct(m.mrr)}`);
  };
  console.log("\n  recall@k:");
  row("overall", report.overall);
  row("exact", report.byKind.exact);
  row("semantic", report.byKind.semantic);

  const hv = report.hybridVsVector;
  console.log(
    `\n  hybrid vs vector-only (exact): ${hv.cases} case(s), ` +
      `${hv.hybridBetter} hybrid-better, ${hv.sameOrBetter} same-or-better`,
  );
  console.log(`  leak-count: ${report.leakCount}`);
  console.log(`  latency: p50 ${report.latency.p50}ms  p95 ${report.latency.p95}ms`);

  console.log("\n  gate:");
  for (const c of gate.checks) {
    const tag = c.informational ? "INFO" : c.ok ? "PASS" : "FAIL";
    console.log(`    [${tag}] ${c.name} (got ${fmtPct(c.got)})`);
  }
  console.log(`  => ${gate.pass ? "PASS" : "FAIL"}`);
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

  const goldSetPath = flags.goldSet ? path.resolve(flags.goldSet) : DEFAULT_GOLD_SET;
  const goldSet = JSON.parse(fs.readFileSync(goldSetPath, "utf-8"));
  const ks = parseKs(flags.k);

  const info = flags.json ? (m) => console.error(m) : (m) => console.log(m);

  const emb = await embedder.createEmbedder({ kind: flags.embedder });
  info(`memory-eval → embedder ${emb.model} (dim ${emb.dim})`);

  // --live evaluates the real local store; default indexes the committed corpus
  // into an ephemeral in-memory store (no dataDir).
  const openOpts = flags.live
    ? { dataDir: path.join(rootDir, ".command-centre", "memory"), embedDim: emb.dim }
    : { embedDim: emb.dim };
  const memStore = await store.openMemoryStore(openOpts);

  try {
    if (!flags.live) {
      info(`  indexing corpus: ${CORPUS_DIR}`);
      await evalMod.indexEvalCorpus({ store: memStore, embedder: emb, corpusDir: CORPUS_DIR });
    }

    const report = await evalMod.runEval({ store: memStore, embedder: emb, goldSet, ks });
    const gate = evaluateGate(report, goldSet.thresholds, emb.model);
    const source = flags.live ? "live store" : "committed corpus";

    if (flags.json) {
      console.log(JSON.stringify({ source, report, gate }, null, 2));
    } else {
      printHuman(report, gate, source);
    }

    return gate.pass ? 0 : 1;
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
    console.error(`\nmemory-eval failed: ${error instanceof Error ? error.message : error}`);
    if (error && error.stack) console.error(error.stack);
    console.error(`\n${USAGE}`);
    process.exitCode = 1;
  });

/**
 * Memory — recall eval harness tests.
 *
 * Offline + deterministic (PGLite in-memory + the hash embedder). Pins three things:
 *   1. Committed corpus + gold-set: exact recall@5 is perfect (the FTS keyword
 *      leg is embedder-independent) with zero real leaks.
 *   2. The recall@k / MRR math, on a hand-seeded store with a known hit and miss.
 *   3. The leak counter actually counts — a `forbid` that overlaps the correct
 *      hit pushes leakCount above zero, so the metric can fail.
 *
 * The semantic bar is bge-m3-only (hash has no semantics), so it is not asserted
 * here — `memory:eval` exercises that under bge-m3, not CI.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");
const { loadMemoryModules } = require("../../../scripts/load-memory-modules.cjs");

const { store, embedder, indexer, search } = loadMemoryModules({
  withSearch: true,
  withCapture: false,
});
const evalMod = loadTsModule(path.resolve(__dirname, "eval.ts"), {
  stubs: { "./search": search, "./indexer": indexer },
});

const CORPUS_DIR = path.join(__dirname, "eval", "corpus");
const GOLD_SET = JSON.parse(fs.readFileSync(path.join(__dirname, "eval", "gold-set.json"), "utf-8"));
const NOW = new Date("2026-06-28T00:00:00Z");

/** Open an ephemeral in-memory store at `embedDim`, run `fn`, always close. */
async function withStore(embedDim, fn) {
  const s = await store.openMemoryStore({ embedDim });
  try {
    return await fn(s);
  } finally {
    await s.close();
  }
}

function systemScope() {
  return { teamId: null, clientId: null, userId: null, visibility: "system" };
}

/** Seed a single system-scoped chunk with a real (hash) embedding for `content`. */
async function seedSystemChunk(s, emb, sourcePath, content) {
  const sc = systemScope();
  const src = await s.insertSource({
    scope: sc,
    sourcePath,
    sourceType: "memory",
    contentSha256: `sha-${sourcePath}`,
  });
  const [embedding] = await emb.embed([content]);
  await s.insertChunk({
    sourceId: src.id,
    sourceScope: sc,
    chunkScope: sc,
    chunkIndex: 0,
    content,
    sourcePath,
    sourceType: "memory",
    embedding,
    embeddingModel: emb.model,
  });
}

test("eval: committed corpus + gold-set — exact recall@5 perfect, zero leaks (hash)", async () => {
  await withStore(64, async (s) => {
    const emb = new embedder.HashEmbedder({ dim: 64 });
    await evalMod.indexEvalCorpus({ store: s, embedder: emb, corpusDir: CORPUS_DIR });

    const report = await evalMod.runEval({ store: s, embedder: emb, goldSet: GOLD_SET, now: NOW });

    assert.ok(report.byKind.exact.count >= 3, "gold-set should have several exact cases");
    assert.equal(
      report.byKind.exact.recallAtK[5],
      1,
      "FTS keyword leg must surface every exact token within the top 5",
    );
    assert.equal(report.leakCount, 0, "no cross-tenant leaks on real scoped data");
    assert.equal(
      report.hybridVsVector.sameOrBetter,
      report.hybridVsVector.cases,
      "hybrid must never rank an exact target below vector-only",
    );
    assert.ok(
      report.cases.some((c) => c.kind === "leak"),
      "gold-set must include leak cases so leak-count is meaningful",
    );
  });
});

test("eval: recall@k and MRR are computed from the hit ranks", async () => {
  await withStore(4, async (s) => {
    const emb = new embedder.HashEmbedder({ dim: 4 });
    await seedSystemChunk(s, emb, "context/memory/a.md", "alpha needletokenxyz unique entry");
    await seedSystemChunk(s, emb, "context/memory/b.md", "beta gamma delta unrelated entry");

    const goldSet = {
      cases: [
        {
          id: "hit",
          query: "needletokenxyz",
          kind: "exact",
          scope: { teamId: null, include: ["system"] },
          expect: { sourcePath: "context/memory/a.md" },
        },
        {
          id: "miss",
          query: "needletokenxyz",
          kind: "exact",
          scope: { teamId: null, include: ["system"] },
          expect: { sourcePath: "context/memory/does-not-exist.md" },
        },
      ],
    };

    const report = await evalMod.runEval({ store: s, embedder: emb, goldSet, now: NOW });

    const hit = report.cases.find((c) => c.id === "hit");
    const miss = report.cases.find((c) => c.id === "miss");
    assert.equal(hit.hybridRank, 1, "the exact token must rank first");
    assert.equal(miss.hybridRank, null, "a non-existent expectation must miss");
    assert.equal(report.byKind.exact.recallAtK[1], 0.5, "one of two exact cases hits @1");
    assert.equal(report.byKind.exact.recallAtK[5], 0.5, "same single hit holds @5");
    assert.equal(report.byKind.exact.mrr, 0.5, "MRR = (1/1 + 0)/2");
  });
});

test("eval: leak counter counts a forbidden hit (guard)", async () => {
  await withStore(4, async (s) => {
    const emb = new embedder.HashEmbedder({ dim: 4 });
    await seedSystemChunk(s, emb, "context/memory/secret.md", "tokenguard001 sensitive note");

    // The forbid intentionally overlaps the in-scope hit's own path, so the
    // returned chunk trips the leak matcher — proving the counter can fire.
    const goldSet = {
      cases: [
        {
          id: "guard",
          query: "tokenguard001",
          kind: "leak",
          scope: { teamId: null, include: ["system"] },
          forbid: [{ sourcePathIncludes: "context/memory" }],
        },
      ],
    };

    const report = await evalMod.runEval({ store: s, embedder: emb, goldSet, now: NOW });
    assert.ok(report.leakCount >= 1, "a returned hit matching forbid must be counted as a leak");
  });
});

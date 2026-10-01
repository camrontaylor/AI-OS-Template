/**
 * Memory — expand tests.
 *
 * expand is pure orchestration over the scope-safe boundary, so these tests pin
 * both halves of the contract:
 *   - Behaviour: anchor plus a symmetric chunk_index window, ordered, with a
 *     combined line span; degrades when line provenance is missing; the anchor
 *     survives a tight `limit`; output is bounded by maxChars.
 *   - No-leak: a chunk from another client/team/private user can never be
 *     expanded, and the permission hook denies even when the scope matches.
 *
 * Tenants share one store with the same source path + content, so only the
 * scope filter keeps them apart.
 */

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");

// Leaf-first stub graph: store subgraph (to seed real rows), the scope-safe
// boundary, and the module under test.
const types = { ALL_VISIBILITIES: ["private", "client", "team", "system"] };
const scope = loadTsModule(path.resolve(__dirname, "scope.ts"), {
  stubs: { "./types": types },
});
const migrate = loadTsModule(path.resolve(__dirname, "migrate.ts"));
const embedding = loadTsModule(path.resolve(__dirname, "embedding.ts"));
const rowMappers = loadTsModule(path.resolve(__dirname, "row-mappers.ts"), {
  stubs: { "./types": types, "./embedding": embedding },
});
const adapter = loadTsModule(path.resolve(__dirname, "pglite-adapter.ts"));
const postgresAdapter = loadTsModule(path.resolve(__dirname, "postgres-adapter.ts"));
const backend = loadTsModule(path.resolve(__dirname, "backend.ts"));
const store = loadTsModule(path.resolve(__dirname, "store.ts"), {
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
const scopedAccess = loadTsModule(path.resolve(__dirname, "scoped-access.ts"), {
  stubs: { "./scope": scope, "./row-mappers": rowMappers },
});
const expand = loadTsModule(path.resolve(__dirname, "expand.ts"), {
  stubs: { "./scoped-access": scopedAccess },
});

const { expandMemoryChunk } = expand;

const EMBED_DIM = 4;
const SAME_VECTOR = [1, 0, 0, 0];

function mkScope(visibility, overrides = {}) {
  return { teamId: null, clientId: null, userId: null, visibility, ...overrides };
}

const SYSTEM = mkScope("system");
const systemSearch = { teamId: null, include: ["system"] };

async function withStore(fn) {
  const s = await store.openMemoryStore({ embedDim: EMBED_DIM });
  try {
    return await fn(s);
  } finally {
    await s.close();
  }
}

/**
 * Insert a source plus chunks (chunk_index 0..n-1) under one scope. `opts.contents`
 * items are a string or `{ content, startLine, endLine, heading, headingLevel }`,
 * so a test can opt in/out of line provenance per chunk.
 */
async function seedSourceWithChunks(s, opts) {
  const sc = opts.sc;
  const sourceType = opts.sourceType ?? "memory";
  const src = await s.insertSource({
    scope: sc,
    sourcePath: opts.sourcePath,
    sourceType,
    contentSha256: `sha-${opts.sourcePath}`,
  });
  const chunks = [];
  for (let i = 0; i < opts.contents.length; i += 1) {
    const c = opts.contents[i];
    const item = typeof c === "string" ? { content: c } : c;
    chunks.push(
      await s.insertChunk({
        sourceId: src.id,
        sourceScope: sc,
        chunkScope: sc,
        chunkIndex: i,
        content: item.content,
        heading: item.heading ?? null,
        headingLevel: item.headingLevel ?? null,
        startLine: item.startLine ?? null,
        endLine: item.endLine ?? null,
        sourcePath: opts.sourcePath,
        sourceType,
        embedding: SAME_VECTOR,
        embeddingModel: "fixed-test",
      }),
    );
  }
  return { src, chunks };
}

// ---------------------------------------------------------------------------
// Successful expand.
// ---------------------------------------------------------------------------

test("expandMemoryChunk returns the anchor + one neighbour each side, ordered, with a combined line span", async () => {
  await withStore(async (s) => {
    const { chunks } = await seedSourceWithChunks(s, {
      sc: SYSTEM,
      sourcePath: "context/memory/2026-06-01.md",
      contents: [
        { content: "chunk zero", heading: "Intro", headingLevel: 2, startLine: 1, endLine: 4 },
        { content: "chunk one", heading: "Intro", headingLevel: 2, startLine: 5, endLine: 9 },
        { content: "chunk two anchor", heading: "Decision", headingLevel: 2, startLine: 10, endLine: 14 },
        { content: "chunk three", heading: "Decision", headingLevel: 2, startLine: 15, endLine: 19 },
        { content: "chunk four", heading: "Outro", headingLevel: 2, startLine: 20, endLine: 24 },
      ],
    });
    const anchor = chunks[2];

    const res = await expandMemoryChunk({
      client: s.client,
      chunkId: anchor.id,
      searchScope: systemSearch,
      radius: 1,
    });

    assert.ok(res, "expand returned a result");
    assert.equal(res.anchorChunkId, anchor.id);
    assert.deepEqual(res.chunkIds, [chunks[1].id, chunks[2].id, chunks[3].id]);
    assert.equal(res.fromIndex, 1);
    assert.equal(res.toIndex, 3);
    assert.equal(res.hasLineProvenance, true);
    assert.equal(res.startLine, 5);
    assert.equal(res.endLine, 19);
    assert.equal(res.heading, "Decision");
    assert.equal(res.sourcePath, "context/memory/2026-06-01.md");
    assert.ok(res.content.includes("chunk one"));
    assert.ok(res.content.includes("chunk two anchor"));
    assert.ok(res.content.includes("chunk three"));
    assert.ok(!res.content.includes("chunk zero"));
    assert.ok(!res.content.includes("chunk four"));
    assert.equal(res.truncated, false);
  });
});

test("expandMemoryChunk floors the window at chunk_index 0 and keeps the anchor", async () => {
  await withStore(async (s) => {
    const { chunks } = await seedSourceWithChunks(s, {
      sc: SYSTEM,
      sourcePath: "context/memory/boundary.md",
      contents: [
        { content: "first", startLine: 1, endLine: 3 },
        { content: "second", startLine: 4, endLine: 6 },
        { content: "third", startLine: 7, endLine: 9 },
      ],
    });

    const res = await expandMemoryChunk({
      client: s.client,
      chunkId: chunks[0].id,
      searchScope: systemSearch,
      radius: 1,
    });

    assert.ok(res);
    assert.equal(res.fromIndex, 0);
    assert.equal(res.toIndex, 1);
    assert.deepEqual(res.chunkIds, [chunks[0].id, chunks[1].id]);
    assert.equal(res.startLine, 1);
    assert.equal(res.endLine, 6);
  });
});

test("expandMemoryChunk keeps the anchor even when a tight limit clips it from the neighbour fetch", async () => {
  await withStore(async (s) => {
    const { chunks } = await seedSourceWithChunks(s, {
      sc: SYSTEM,
      sourcePath: "context/memory/clip.md",
      contents: ["c0", "c1", "c2", "c3", "c4"],
    });
    const anchor = chunks[4];

    // radius 3 -> window [1,7]; limit 2 -> the primitive (ORDER BY chunk_index ASC)
    // returns indices 1,2 and drops the anchor. expand must merge it back.
    const res = await expandMemoryChunk({
      client: s.client,
      chunkId: anchor.id,
      searchScope: systemSearch,
      radius: 3,
      limit: 2,
    });

    assert.ok(res);
    assert.ok(res.chunkIds.includes(anchor.id), "anchor survives the clip");
    const indices = res.chunkIds.map((id) => chunks.findIndex((c) => c.id === id));
    assert.deepEqual(indices, [...indices].sort((a, b) => a - b), "ordered by chunk_index");
  });
});

test("expandMemoryChunk truncates the stitched content to maxChars", async () => {
  await withStore(async (s) => {
    const big = "x".repeat(500);
    const { chunks } = await seedSourceWithChunks(s, {
      sc: SYSTEM,
      sourcePath: "context/memory/big.md",
      contents: [
        { content: big, startLine: 1, endLine: 10 },
        { content: big, startLine: 11, endLine: 20 },
        { content: big, startLine: 21, endLine: 30 },
      ],
    });

    const res = await expandMemoryChunk({
      client: s.client,
      chunkId: chunks[1].id,
      searchScope: systemSearch,
      radius: 1,
      maxChars: 100,
    });

    assert.ok(res);
    assert.equal(res.truncated, true);
    assert.equal(res.content.length, 100);
  });
});

// ---------------------------------------------------------------------------
// Missing provenance — expand still works off chunk_index.
// ---------------------------------------------------------------------------

test("expandMemoryChunk expands by chunk_index when ALL chunks lack line provenance", async () => {
  await withStore(async (s) => {
    const { chunks } = await seedSourceWithChunks(s, {
      sc: SYSTEM,
      sourcePath: "context/memory/legacy.md",
      contents: ["alpha", "bravo", "charlie"], // no startLine/endLine
    });

    const res = await expandMemoryChunk({
      client: s.client,
      chunkId: chunks[1].id,
      searchScope: systemSearch,
      radius: 1,
    });

    assert.ok(res);
    assert.deepEqual(res.chunkIds, [chunks[0].id, chunks[1].id, chunks[2].id]);
    assert.equal(res.hasLineProvenance, false);
    assert.equal(res.startLine, null);
    assert.equal(res.endLine, null);
    assert.ok(res.content.includes("alpha"));
    assert.ok(res.content.includes("bravo"));
    assert.ok(res.content.includes("charlie"));
  });
});

test("expandMemoryChunk degrades the span to null when SOME chunks lack line provenance", async () => {
  await withStore(async (s) => {
    const { chunks } = await seedSourceWithChunks(s, {
      sc: SYSTEM,
      sourcePath: "context/memory/mixed.md",
      contents: [
        { content: "with lines", startLine: 1, endLine: 4 },
        { content: "anchor with lines", startLine: 5, endLine: 9 },
        { content: "no lines" }, // missing provenance
      ],
    });

    const res = await expandMemoryChunk({
      client: s.client,
      chunkId: chunks[1].id,
      searchScope: systemSearch,
      radius: 1,
    });

    assert.ok(res);
    assert.equal(res.chunkIds.length, 3);
    assert.equal(res.hasLineProvenance, false);
    assert.equal(res.startLine, null);
    assert.equal(res.endLine, null);
  });
});

// ---------------------------------------------------------------------------
// No-leak — denied scope across the three tenant axes.
// ---------------------------------------------------------------------------

test("no-leak (expand): a chunk from another client cannot be expanded, and its content never rides along", async () => {
  await withStore(async (s) => {
    const acme = mkScope("client", { clientId: "acme" });
    const globex = mkScope("client", { clientId: "globex" });
    const { chunks: acmeChunks } = await seedSourceWithChunks(s, {
      sc: acme,
      sourcePath: "context/memory/shared.md",
      contents: ["acme-0", "acme-1", "acme-2"],
    });
    const { chunks: globexChunks } = await seedSourceWithChunks(s, {
      sc: globex,
      sourcePath: "context/memory/shared.md",
      contents: ["globex-0", "globex-1", "globex-2"],
    });

    const globexSearch = { teamId: null, clientId: "globex", include: ["system", "client"] };

    // globex caller presenting acme's real anchor id -> not found in scope.
    const denied = await expandMemoryChunk({
      client: s.client,
      chunkId: acmeChunks[1].id,
      searchScope: globexSearch,
      radius: 1,
    });
    assert.equal(denied, null);

    // globex expands its own chunk fine and never sees acme content.
    const ok = await expandMemoryChunk({
      client: s.client,
      chunkId: globexChunks[1].id,
      searchScope: globexSearch,
      radius: 1,
    });
    assert.ok(ok);
    assert.deepEqual(ok.chunkIds, [globexChunks[0].id, globexChunks[1].id, globexChunks[2].id]);
    assert.ok(!ok.content.includes("acme"));
  });
});

test("no-leak (expand): team B can never expand team A chunks", async () => {
  await withStore(async (s) => {
    const teamA = mkScope("team", { teamId: "team-a" });
    const { chunks: aChunks } = await seedSourceWithChunks(s, {
      sc: teamA,
      sourcePath: "context/memory/team.md",
      contents: ["a-0", "a-1", "a-2"],
    });

    const teamBSearch = { teamId: "team-b", include: ["system", "team"] };
    const denied = await expandMemoryChunk({
      client: s.client,
      chunkId: aChunks[1].id,
      searchScope: teamBSearch,
      radius: 1,
    });
    assert.equal(denied, null);
  });
});

test("no-leak (expand): user B can never expand user A private chunks", async () => {
  await withStore(async (s) => {
    const userA = mkScope("private", { userId: "user-a" });
    const { chunks: aChunks } = await seedSourceWithChunks(s, {
      sc: userA,
      sourcePath: "context/memory/private.md",
      contents: ["a-0", "a-1", "a-2"],
    });

    const userBSearch = { teamId: null, userId: "user-b", include: ["system", "private"] };
    const denied = await expandMemoryChunk({
      client: s.client,
      chunkId: aChunks[1].id,
      searchScope: userBSearch,
      radius: 1,
    });
    assert.equal(denied, null);
  });
});

// ---------------------------------------------------------------------------
// Permission hook — composes on top of the scope filter.
// ---------------------------------------------------------------------------

test("expandMemoryChunk returns null when the permission hook denies, even when the scope matches", async () => {
  await withStore(async (s) => {
    const { chunks } = await seedSourceWithChunks(s, {
      sc: SYSTEM,
      sourcePath: "context/memory/perm.md",
      contents: ["one", "two", "three"],
    });

    const denied = await expandMemoryChunk({
      client: s.client,
      chunkId: chunks[1].id,
      searchScope: systemSearch,
      radius: 1,
      permissionCheck: () => false,
    });
    assert.equal(denied, null);

    // An allow hook composes with the matching scope and passes through.
    const ok = await expandMemoryChunk({
      client: s.client,
      chunkId: chunks[1].id,
      searchScope: systemSearch,
      radius: 1,
      permissionCheck: (ctx) => ctx.operation === "expand" || ctx.operation === "sibling",
    });
    assert.ok(ok);
    assert.equal(ok.chunkIds.length, 3);
  });
});

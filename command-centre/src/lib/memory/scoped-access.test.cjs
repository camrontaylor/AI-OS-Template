/**
 * Memory — scope-safe drill-down (scoped-access) tests.
 *
 * Proves expand and transcript drill-down can never bypass the scope boundary
 * search already enforces. Every gate re-applies buildScopeWhere(), checked
 * across client, team, and private-user axes plus two drill-down guarantees:
 * expand never returns another scope's neighbour, and transcript checks scope
 * before any fs access, confined under context/transcripts/, with the
 * permission hook composing on top.
 *
 * Two tenants share one store with the same content, so only the scope filter
 * separates them. A fake fs records every call, so "no read on deny" is a hard zero.
 */

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");

// Leaf-first stub graph: store subgraph (to seed real rows) plus the module under test.
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

const {
  resolveScopedChunk,
  resolveScopedSource,
  fetchScopedSiblingChunks,
  readScopedTranscriptWindow,
} = scopedAccess;

const EMBED_DIM = 4;
const SAME_VECTOR = [1, 0, 0, 0];
const ROOT = "/workspace";

function mkScope(visibility, overrides = {}) {
  return { teamId: null, clientId: null, userId: null, visibility, ...overrides };
}

async function withStore(fn) {
  const s = await store.openMemoryStore({ embedDim: EMBED_DIM });
  try {
    return await fn(s);
  } finally {
    await s.close();
  }
}

/** Insert a source plus a sequence of chunks (chunk_index 0..n-1) under one scope. */
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
    chunks.push(
      await s.insertChunk({
        sourceId: src.id,
        sourceScope: sc,
        chunkScope: sc,
        chunkIndex: i,
        content: opts.contents[i],
        sourcePath: opts.sourcePath,
        sourceType,
        embedding: SAME_VECTOR,
        embeddingModel: "fixed-test",
      }),
    );
  }
  return { src, chunks };
}

/** A fake fs that records every call, so "no read on deny" is a hard zero. */
function fakeFs(files = {}) {
  const calls = { stat: [], read: [] };
  return {
    calls,
    statSync(p) {
      calls.stat.push(p);
      if (!(p in files)) {
        const err = new Error(`ENOENT: ${p}`);
        throw err;
      }
      return { isFile: () => true };
    },
    readFileSync(p) {
      calls.read.push(p);
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
      return files[p];
    },
  };
}

function transcriptAbs(rel) {
  const stripped = rel.replace(/^context\/transcripts\//, "");
  return path.resolve(ROOT, "context", "transcripts", stripped);
}

// ---------------------------------------------------------------------------
// resolveScopedChunk / resolveScopedSource — the validated entry points.
// ---------------------------------------------------------------------------

test("resolveScopedChunk returns the chunk when it is in scope", async () => {
  await withStore(async (s) => {
    const { chunks } = await seedSourceWithChunks(s, {
      sc: mkScope("client", { clientId: "acme" }),
      sourcePath: "clients/acme/context/memory/notes.md",
      contents: ["secret acme note"],
    });

    const got = await resolveScopedChunk({
      client: s.client,
      chunkId: chunks[0].id,
      searchScope: { teamId: null, clientId: "acme", include: ["client"] },
    });

    assert.ok(got, "in-scope chunk must resolve");
    assert.equal(got.id, chunks[0].id);
    assert.equal(got.content, "secret acme note");
  });
});

test("no-leak (expand): resolveScopedChunk denies a chunk id from another client", async () => {
  await withStore(async (s) => {
    const seeded = {};
    for (const clientId of ["acme", "globex"]) {
      seeded[clientId] = await seedSourceWithChunks(s, {
        sc: mkScope("client", { clientId }),
        sourcePath: `clients/${clientId}/context/memory/notes.md`,
        contents: [`secret ${clientId} note`],
      });
    }

    // Caller is acme but presents globex's real chunk id.
    const got = await resolveScopedChunk({
      client: s.client,
      chunkId: seeded.globex.chunks[0].id,
      searchScope: { teamId: null, clientId: "acme", include: ["client"] },
    });

    assert.equal(got, null, "a chunk from another client must be invisible");
  });
});

test("resolveScopedSource returns in-scope, denies out-of-scope", async () => {
  await withStore(async (s) => {
    const acme = await seedSourceWithChunks(s, {
      sc: mkScope("client", { clientId: "acme" }),
      sourcePath: "clients/acme/context/memory/notes.md",
      contents: ["note"],
    });

    const inScope = await resolveScopedSource({
      client: s.client,
      sourceId: acme.src.id,
      searchScope: { teamId: null, clientId: "acme", include: ["client"] },
    });
    assert.ok(inScope, "acme source must resolve under acme scope");

    const crossScope = await resolveScopedSource({
      client: s.client,
      sourceId: acme.src.id,
      searchScope: { teamId: null, clientId: "globex", include: ["client"] },
    });
    assert.equal(crossScope, null, "acme source must be invisible to globex");
  });
});

// ---------------------------------------------------------------------------
// fetchScopedSiblingChunks — the expand building block.
// ---------------------------------------------------------------------------

test("no-leak (expand): sibling chunks of another client are never returned", async () => {
  await withStore(async (s) => {
    const seeded = {};
    for (const clientId of ["acme", "globex"]) {
      seeded[clientId] = await seedSourceWithChunks(s, {
        sc: mkScope("client", { clientId }),
        sourcePath: `clients/${clientId}/context/memory/notes.md`,
        // Same content across tenants — only the scope filter separates them.
        contents: ["chunk zero", "chunk one", "chunk two"],
      });
    }

    // globex caller asking for acme's source id sees nothing.
    const leaked = await fetchScopedSiblingChunks({
      client: s.client,
      sourceId: seeded.acme.src.id,
      searchScope: { teamId: null, clientId: "globex", include: ["client"] },
      fromIndex: 0,
      toIndex: 10,
    });
    assert.deepEqual(leaked, [], "acme siblings leaked to globex");

    // acme caller gets its own siblings, ordered by chunk_index.
    const own = await fetchScopedSiblingChunks({
      client: s.client,
      sourceId: seeded.acme.src.id,
      searchScope: { teamId: null, clientId: "acme", include: ["client"] },
      fromIndex: 0,
      toIndex: 10,
    });
    assert.deepEqual(
      own.map((c) => c.chunkIndex),
      [0, 1, 2],
    );
    assert.ok(own.every((c) => c.sourcePath.includes("acme")));
  });
});

test("fetchScopedSiblingChunks honours the bounded limit and the index window", async () => {
  await withStore(async (s) => {
    const contents = Array.from({ length: 30 }, (_, i) => `chunk ${i}`);
    const { src } = await seedSourceWithChunks(s, {
      sc: mkScope("client", { clientId: "acme" }),
      sourcePath: "clients/acme/context/memory/big.md",
      contents,
    });

    const limited = await fetchScopedSiblingChunks({
      client: s.client,
      sourceId: src.id,
      searchScope: { teamId: null, clientId: "acme", include: ["client"] },
      fromIndex: 0,
      toIndex: 29,
      limit: 5,
    });
    assert.equal(limited.length, 5, "limit must cap the row count");
    assert.deepEqual(
      limited.map((c) => c.chunkIndex),
      [0, 1, 2, 3, 4],
    );

    const window = await fetchScopedSiblingChunks({
      client: s.client,
      sourceId: src.id,
      searchScope: { teamId: null, clientId: "acme", include: ["client"] },
      fromIndex: 10,
      toIndex: 12,
    });
    assert.deepEqual(
      window.map((c) => c.chunkIndex),
      [10, 11, 12],
    );
  });
});

// ---------------------------------------------------------------------------
// readScopedTranscriptWindow — the transcript safe-read gate.
// ---------------------------------------------------------------------------

test("no-leak (transcript): scope is checked before any fs access", async () => {
  await withStore(async (s) => {
    const rel = "context/transcripts/2026-06-16/acme-deadbeef0001.jsonl";
    for (const clientId of ["acme", "globex"]) {
      await seedSourceWithChunks(s, {
        sc: mkScope("client", { clientId }),
        sourcePath: `clients/${clientId}/context/memory/2026-06-16.aos.md`,
        contents: [`turn summary\n\nRaw transcript: \`${rel}\``],
      });
    }
    // Resolve globex's chunk id so we can present it under the acme caller below.
    const { rows } = await s.client.query(
      "SELECT id FROM memory_chunks WHERE client_id = 'globex' LIMIT 1",
    );
    const globexChunkId = rows[0].id;

    const fs = fakeFs();
    const denied = await readScopedTranscriptWindow({
      client: s.client,
      rootDir: ROOT,
      chunkId: globexChunkId,
      searchScope: { teamId: null, clientId: "acme", include: ["client"] },
      fs,
    });

    assert.equal(denied, null, "cross-scope transcript drill-down must be denied");
    assert.equal(fs.calls.stat.length, 0, "fs.statSync must not run on a denial");
    assert.equal(fs.calls.read.length, 0, "fs.readFileSync must not run on a denial");
  });
});

test("readScopedTranscriptWindow returns the confined transcript for an in-scope chunk", async () => {
  await withStore(async (s) => {
    const rel = "context/transcripts/2026-06-16/acme-deadbeef0001.jsonl";
    const { chunks } = await seedSourceWithChunks(s, {
      sc: mkScope("client", { clientId: "acme" }),
      sourcePath: "clients/acme/context/memory/2026-06-16.aos.md",
      contents: [`turn summary\n\nRaw transcript: \`${rel}\``],
    });
    const abs = transcriptAbs(rel);
    const fs = fakeFs({ [abs]: '{"role":"user"}\n{"role":"assistant"}\n' });

    const got = await readScopedTranscriptWindow({
      client: s.client,
      rootDir: ROOT,
      chunkId: chunks[0].id,
      searchScope: { teamId: null, clientId: "acme", include: ["client"] },
      fs,
    });

    assert.ok(got, "in-scope transcript must resolve");
    assert.equal(got.transcriptPath, rel);
    assert.equal(got.chunkId, chunks[0].id);
    assert.match(got.raw, /"role":"assistant"/);
    assert.deepEqual(fs.calls.read, [abs], "exactly the confined path is read");
  });
});

test("readScopedTranscriptWindow blocks a path-escape attempt", async () => {
  await withStore(async (s) => {
    const { chunks } = await seedSourceWithChunks(s, {
      sc: mkScope("client", { clientId: "acme" }),
      sourcePath: "clients/acme/context/memory/2026-06-16.aos.md",
      contents: ["turn\n\nRaw transcript: `../../../../etc/passwd`"],
    });
    const fs = fakeFs();

    const got = await readScopedTranscriptWindow({
      client: s.client,
      rootDir: ROOT,
      chunkId: chunks[0].id,
      searchScope: { teamId: null, clientId: "acme", include: ["client"] },
      fs,
    });

    assert.equal(got, null, "a path escaping context/transcripts/ must be rejected");
    assert.equal(fs.calls.read.length, 0, "no read outside the transcripts dir");
  });
});

test("readScopedTranscriptWindow returns null for a missing transcript, without throwing", async () => {
  await withStore(async (s) => {
    const rel = "context/transcripts/2026-06-16/acme-missing.jsonl";
    const { chunks } = await seedSourceWithChunks(s, {
      sc: mkScope("client", { clientId: "acme" }),
      sourcePath: "clients/acme/context/memory/2026-06-16.aos.md",
      contents: [`turn\n\nRaw transcript: \`${rel}\``],
    });
    const fs = fakeFs(); // file not present

    const got = await readScopedTranscriptWindow({
      client: s.client,
      rootDir: ROOT,
      chunkId: chunks[0].id,
      searchScope: { teamId: null, clientId: "acme", include: ["client"] },
      fs,
    });

    assert.equal(got, null, "a missing transcript yields null, not a throw");
    assert.equal(fs.calls.stat.length, 1, "the scope check passed, so fs was probed once");
    assert.equal(fs.calls.read.length, 0, "a missing file is never read");
  });
});

test("readScopedTranscriptWindow returns null when no transcript path is derivable", async () => {
  await withStore(async (s) => {
    const { chunks } = await seedSourceWithChunks(s, {
      sc: mkScope("client", { clientId: "acme" }),
      sourcePath: "clients/acme/context/memory/2026-06-16.aos.md",
      contents: ["a turn summary with no raw transcript line"],
    });
    const fs = fakeFs();

    const got = await readScopedTranscriptWindow({
      client: s.client,
      rootDir: ROOT,
      chunkId: chunks[0].id,
      searchScope: { teamId: null, clientId: "acme", include: ["client"] },
      fs,
    });

    assert.equal(got, null);
    assert.equal(fs.calls.stat.length, 0, "no path derived means no fs access");
  });
});

// ---------------------------------------------------------------------------
// Permission hook — composes on top of the scope filter.
// ---------------------------------------------------------------------------

test("permissionCheck denies every gate even when the scope matches", async () => {
  await withStore(async (s) => {
    const rel = "context/transcripts/2026-06-16/acme-deadbeef0001.jsonl";
    const { src, chunks } = await seedSourceWithChunks(s, {
      sc: mkScope("client", { clientId: "acme" }),
      sourcePath: "clients/acme/context/memory/2026-06-16.aos.md",
      contents: ["chunk zero", `turn\n\nRaw transcript: \`${rel}\``],
    });
    const deny = () => false;
    const searchScope = { teamId: null, clientId: "acme", include: ["client"] };

    assert.equal(
      await resolveScopedChunk({ client: s.client, chunkId: chunks[0].id, searchScope, permissionCheck: deny }),
      null,
    );
    assert.equal(
      await resolveScopedSource({ client: s.client, sourceId: src.id, searchScope, permissionCheck: deny }),
      null,
    );
    assert.deepEqual(
      await fetchScopedSiblingChunks({ client: s.client, sourceId: src.id, searchScope, fromIndex: 0, toIndex: 10, permissionCheck: deny }),
      [],
    );

    const fs = fakeFs({ [transcriptAbs(rel)]: "should never be read" });
    const transcript = await readScopedTranscriptWindow({
      client: s.client,
      rootDir: ROOT,
      chunkId: chunks[1].id,
      searchScope,
      fs,
      permissionCheck: deny,
    });
    assert.equal(transcript, null, "permission denial blocks the transcript read");
    assert.equal(fs.calls.read.length, 0, "permission denial short-circuits before fs");
  });
});

test("permissionCheck that allows composes with a matching scope", async () => {
  await withStore(async (s) => {
    const { chunks } = await seedSourceWithChunks(s, {
      sc: mkScope("client", { clientId: "acme" }),
      sourcePath: "clients/acme/context/memory/notes.md",
      contents: ["allowed content"],
    });

    const seen = [];
    const got = await resolveScopedChunk({
      client: s.client,
      chunkId: chunks[0].id,
      searchScope: { teamId: null, clientId: "acme", include: ["client"] },
      permissionCheck: (ctx) => {
        seen.push(ctx);
        return true;
      },
    });

    assert.ok(got, "both gates pass → the chunk resolves");
    assert.equal(seen.length, 1, "the permission hook ran once");
    assert.equal(seen[0].operation, "expand");
    assert.equal(seen[0].chunkId, chunks[0].id);
  });
});

// ---------------------------------------------------------------------------
// Team and private axes — same guarantees as the client axis (parity with no-leak).
// ---------------------------------------------------------------------------

test("no-leak (expand): team B can never resolve or expand team A chunks", async () => {
  await withStore(async (s) => {
    const seeded = {};
    for (const teamId of ["team-a", "team-b"]) {
      seeded[teamId] = await seedSourceWithChunks(s, {
        sc: mkScope("team", { teamId }),
        sourcePath: `context/memory/${teamId}.md`,
        contents: ["c0", "c1"],
      });
    }

    const denied = await resolveScopedChunk({
      client: s.client,
      chunkId: seeded["team-a"].chunks[0].id,
      searchScope: { teamId: "team-b", include: ["team"] },
    });
    assert.equal(denied, null, "team A chunk leaked to team B");

    const siblings = await fetchScopedSiblingChunks({
      client: s.client,
      sourceId: seeded["team-a"].src.id,
      searchScope: { teamId: "team-b", include: ["team"] },
      fromIndex: 0,
      toIndex: 10,
    });
    assert.deepEqual(siblings, [], "team A siblings leaked to team B");
  });
});

test("no-leak (expand): user B can never resolve or expand user A private chunks", async () => {
  await withStore(async (s) => {
    const seeded = {};
    for (const userId of ["user-a", "user-b"]) {
      seeded[userId] = await seedSourceWithChunks(s, {
        sc: mkScope("private", { teamId: "team-1", userId }),
        sourcePath: `context/memory/${userId}.md`,
        contents: ["c0", "c1"],
      });
    }

    const denied = await resolveScopedChunk({
      client: s.client,
      chunkId: seeded["user-a"].chunks[0].id,
      searchScope: { teamId: "team-1", userId: "user-b", include: ["private"] },
    });
    assert.equal(denied, null, "user A private chunk leaked to user B");

    const siblings = await fetchScopedSiblingChunks({
      client: s.client,
      sourceId: seeded["user-a"].src.id,
      searchScope: { teamId: "team-1", userId: "user-b", include: ["private"] },
      fromIndex: 0,
      toIndex: 10,
    });
    assert.deepEqual(siblings, [], "user A private siblings leaked to user B");
  });
});

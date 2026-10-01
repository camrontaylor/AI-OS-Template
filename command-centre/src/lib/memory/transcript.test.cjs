/**
 * Memory — transcript drill-down window tests.
 *
 * transcript.ts is pure orchestration over the scope-safe boundary plus
 * capture.ts's tolerant JSONL parser, so these tests pin the new layer's
 * behaviour (no-leak, path-escape, missing-file, and permission-denial are
 * already covered against readScopedTranscriptWindow in scoped-access.test.cjs):
 *   - Allowed: a real turn id from the chunk's capture marker matches the parsed
 *     transcript, and the window includes the right entry's text.
 *   - Denied: a cross-scope chunk id returns null.
 *   - Missing transcript: propagates null.
 *   - Malformed data: garbage non-JSON lines among valid JSONL turns are skipped
 *     and the real turn is still extracted.
 *   - Turn id not found: matched:false, falls back to bounded raw content, no throw.
 */

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");

// Leaf-first stub graph: store subgraph (to seed real rows), the scope-safe
// boundary, capture.ts (parseTranscriptEntries/roleOf/etc.), and the module under test.
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
const chunker = loadTsModule(path.resolve(__dirname, "chunker.ts"));
const discovery = loadTsModule(path.resolve(__dirname, "discovery.ts"));
const ingest = loadTsModule(path.resolve(__dirname, "ingest.ts"), {
  stubs: { "./scope": scope, "./embedding": embedding, "./chunker": chunker },
});
const indexer = loadTsModule(path.resolve(__dirname, "indexer.ts"), {
  stubs: { "./scope": scope, "./ingest": ingest, "./discovery": discovery },
});
const capture = loadTsModule(path.resolve(__dirname, "capture.ts"), {
  stubs: { "./indexer": indexer },
});
const scopedAccess = loadTsModule(path.resolve(__dirname, "scoped-access.ts"), {
  stubs: { "./scope": scope, "./row-mappers": rowMappers },
});
const transcript = loadTsModule(path.resolve(__dirname, "transcript.ts"), {
  stubs: { "./scoped-access": scopedAccess, "./capture": capture },
});

const { expandTranscriptWindow } = transcript;

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
        metadata: opts.metadatas ? opts.metadatas[i] : undefined,
      }),
    );
  }
  return { src, chunks };
}

/** A fake fs, mirroring scoped-access.test.cjs's. */
function fakeFs(files = {}) {
  const calls = { stat: [], read: [] };
  return {
    calls,
    statSync(p) {
      calls.stat.push(p);
      if (!(p in files)) {
        throw new Error(`ENOENT: ${p}`);
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

/** Build a chunk body carrying the real capture marker + Raw transcript line. */
function captureChunkContent(opts) {
  return [
    `<!-- aos-capture session:${opts.sessionId} source:${opts.sourceHash} turn:${opts.turnId} -->`,
    `### Session ${opts.sessionId}`,
    "",
    opts.summary ?? "a turn summary",
    "",
    `Raw transcript: \`${opts.rel}\``,
    "",
    "<!-- /aos-capture -->",
  ].join("\n");
}

function jsonl(entries) {
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Allowed access — turn id matched, window extracted.
// ---------------------------------------------------------------------------

test("expandTranscriptWindow matches the turn id from the capture marker and returns a window of turns", async () => {
  await withStore(async (s) => {
    const rel = "context/transcripts/2026-06-22/sess-aaaa0001.jsonl";
    const { chunks } = await seedSourceWithChunks(s, {
      sc: mkScope("system"),
      sourcePath: "context/memory/2026-06-22.aos.md",
      contents: [
        captureChunkContent({ sessionId: "sess", sourceHash: "abc123", turnId: "a1", rel }),
      ],
    });

    const abs = transcriptAbs(rel);
    const raw = jsonl([
      { type: "user", uuid: "u0", message: { role: "user", content: "what is the capital of France?" } },
      { type: "assistant", uuid: "a1", message: { role: "assistant", content: [{ type: "text", text: "The capital of France is Paris." }] } },
      { type: "user", uuid: "u1", message: { role: "user", content: "thanks" } },
    ]);
    const fs = fakeFs({ [abs]: raw });

    const res = await expandTranscriptWindow({
      client: s.client,
      rootDir: ROOT,
      chunkId: chunks[0].id,
      searchScope: { teamId: null, include: ["system"] },
      radius: 2,
      fs,
    });

    assert.ok(res, "in-scope chunk with a real turn id must resolve");
    assert.equal(res.turnId, "a1");
    assert.equal(res.matched, true);
    assert.equal(res.chunkId, chunks[0].id);
    assert.equal(res.transcriptPath, rel);
    assert.ok(
      res.turns.some((t) => t.text.includes("The capital of France is Paris.")),
      "window must include the matched assistant turn",
    );
    assert.ok(
      res.turns.some((t) => t.text.includes("what is the capital of France?")),
      "window must include the preceding user turn (within radius)",
    );
    assert.equal(res.truncated, false);
  });
});

// Regression: real captures embed a hyphenated UUID turn id. The earlier
// `[^\s-]+` regex stopped at the first hyphen, degrading every real drill-down
// to the raw-text fallback (matched:false).
test("expandTranscriptWindow matches a hyphenated UUID turn id (real capture format)", async () => {
  await withStore(async (s) => {
    const uuid = "88c1b3b4-f9f5-48c5-9b74-4737b6ae55b0";
    const rel = "context/transcripts/2026-06-23/sess-uuid0001.jsonl";
    const { chunks } = await seedSourceWithChunks(s, {
      sc: mkScope("system"),
      sourcePath: "context/memory/2026-06-23.aos.md",
      contents: [
        captureChunkContent({ sessionId: "sess", sourceHash: "abc123", turnId: uuid, rel }),
      ],
    });

    const raw = jsonl([
      { type: "user", uuid: "u0", message: { role: "user", content: "how do I scope memory?" } },
      { type: "assistant", uuid, message: { role: "assistant", content: [{ type: "text", text: "Every read compiles through buildScopeWhere." }] } },
      { type: "user", uuid: "u1", message: { role: "user", content: "got it" } },
    ]);
    const fs = fakeFs({ [transcriptAbs(rel)]: raw });

    const res = await expandTranscriptWindow({
      client: s.client,
      rootDir: ROOT,
      chunkId: chunks[0].id,
      searchScope: { teamId: null, include: ["system"] },
      radius: 2,
      fs,
    });

    assert.ok(res, "in-scope chunk with a UUID turn id must resolve");
    assert.equal(res.turnId, uuid, "the full hyphenated UUID must be extracted from the marker");
    assert.equal(res.matched, true, "the UUID must match the transcript entry, not fall back to raw");
    assert.ok(
      res.turns.some((t) => t.text.includes("Every read compiles through buildScopeWhere.")),
      "window must include the matched assistant turn",
    );
  });
});

// Regression (head-slice): the target turn sits at the END of a transcript larger
// than the read cap. A head slice used to miss it; the read now windows on the turn.
test("expandTranscriptWindow matches a turn at the END of a transcript larger than the read cap", async () => {
  await withStore(async (s) => {
    const uuid = "ce7bc9eb-673f-4cb9-94f4-3fee455bbc58";
    const rel = "context/transcripts/2026-06-23/sess-big0001.jsonl";
    const { chunks } = await seedSourceWithChunks(s, {
      sc: mkScope("system"),
      sourcePath: "context/memory/2026-06-23.aos.md",
      contents: [
        captureChunkContent({ sessionId: "sess", sourceHash: "abc123", turnId: uuid, rel }),
      ],
    });

    // > 256 KiB of filler with the target turn LAST.
    const filler = "x".repeat(800);
    const entries = [];
    for (let i = 0; i < 220; i += 1) {
      entries.push({ type: "user", uuid: `u${i}`, message: { role: "user", content: `filler ${i} ${filler}` } });
      entries.push({ type: "assistant", uuid: `a${i}`, message: { role: "assistant", content: [{ type: "text", text: `reply ${i} ${filler}` }] } });
    }
    entries.push({ type: "assistant", uuid, message: { role: "assistant", content: [{ type: "text", text: "NEEDLE-the recovery guard reverted the finished upgrade." }] } });
    const raw = jsonl(entries);
    assert.ok(raw.length > 262144, `fixture must exceed the 256 KiB read cap (got ${raw.length})`);

    const fs = fakeFs({ [transcriptAbs(rel)]: raw });
    const res = await expandTranscriptWindow({
      client: s.client,
      rootDir: ROOT,
      chunkId: chunks[0].id,
      searchScope: { teamId: null, include: ["system"] },
      radius: 2,
      fs,
    });

    assert.ok(res, "must resolve");
    assert.equal(res.turnId, uuid);
    assert.equal(res.matched, true, "a turn past the 256 KiB head must still match, not fall back to the head");
    assert.ok(
      res.turns.some((t) => t.text.includes("NEEDLE-the recovery guard reverted the finished upgrade.")),
      "window must include the matched turn at the end of the large transcript",
    );
  });
});

// Real-world fix: ingest stamps metadata.turnId on the body chunk, whose content
// carries the next block's orphaned marker (the chunker straddle). metadata.turnId
// must win over a content scrape and match.
test("expandTranscriptWindow prefers metadata.turnId over the chunk's content marker", async () => {
  await withStore(async (s) => {
    const ownTurn = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"; // this chunk's real block
    const nextTurn = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"; // orphaned marker that bled in
    const rel = "context/transcripts/2026-06-23/sess-meta0001.jsonl";
    const content = [
      "- a summary bullet for this block",
      `Raw transcript: \`${rel}\``,
      "<!-- /aos-capture -->",
      `<!-- aos-capture session:sess source:next turn:${nextTurn} -->`,
    ].join("\n");
    const { chunks } = await seedSourceWithChunks(s, {
      sc: mkScope("system"),
      sourcePath: "context/memory/2026-06-23.aos.md",
      contents: [content],
      metadatas: [{ turnId: ownTurn, transcriptPath: rel }],
    });

    const raw = jsonl([
      { type: "user", uuid: "u0", message: { role: "user", content: "scope question" } },
      { type: "assistant", uuid: ownTurn, message: { role: "assistant", content: [{ type: "text", text: "the answer for this block" }] } },
    ]);
    const fs = fakeFs({ [transcriptAbs(rel)]: raw });

    const res = await expandTranscriptWindow({
      client: s.client,
      rootDir: ROOT,
      chunkId: chunks[0].id,
      searchScope: { teamId: null, include: ["system"] },
      radius: 2,
      fs,
    });

    assert.ok(res, "must resolve");
    assert.equal(res.turnId, ownTurn, "metadata.turnId must win over the next block's content marker");
    assert.equal(res.matched, true, "the metadata turn id must match the transcript entry");
    assert.ok(res.turns.some((t) => t.text.includes("the answer for this block")));
  });
});

// ---------------------------------------------------------------------------
// Denied access — cross-scope chunk id.
// ---------------------------------------------------------------------------

test("no-leak (transcript window): a chunk from another client cannot be drilled into", async () => {
  await withStore(async (s) => {
    const rel = "context/transcripts/2026-06-22/sess-bbbb0001.jsonl";
    const { chunks } = await seedSourceWithChunks(s, {
      sc: mkScope("client", { clientId: "acme" }),
      sourcePath: "clients/acme/context/memory/2026-06-22.aos.md",
      contents: [
        captureChunkContent({ sessionId: "sess", sourceHash: "abc123", turnId: "a1", rel }),
      ],
    });

    const fs = fakeFs({ [transcriptAbs(rel)]: jsonl([{ type: "assistant", uuid: "a1", message: { role: "assistant", content: "secret acme answer" } }]) });

    const denied = await expandTranscriptWindow({
      client: s.client,
      rootDir: ROOT,
      chunkId: chunks[0].id,
      searchScope: { teamId: null, clientId: "globex", include: ["client"] },
      fs,
    });

    assert.equal(denied, null, "a chunk from another client must be invisible");
    assert.equal(fs.calls.read.length, 0, "no fs read on a denial");
  });
});

// ---------------------------------------------------------------------------
// Missing transcript — propagated null from readScopedTranscriptWindow.
// ---------------------------------------------------------------------------

test("expandTranscriptWindow returns null when the derived transcript file is missing", async () => {
  await withStore(async (s) => {
    const rel = "context/transcripts/2026-06-22/sess-missing.jsonl";
    const { chunks } = await seedSourceWithChunks(s, {
      sc: mkScope("system"),
      sourcePath: "context/memory/2026-06-22.aos.md",
      contents: [
        captureChunkContent({ sessionId: "sess", sourceHash: "abc123", turnId: "a1", rel }),
      ],
    });

    const fs = fakeFs(); // file not present

    const got = await expandTranscriptWindow({
      client: s.client,
      rootDir: ROOT,
      chunkId: chunks[0].id,
      searchScope: { teamId: null, include: ["system"] },
      fs,
    });

    assert.equal(got, null, "a missing transcript composes to null through the new layer, not a throw");
  });
});

// ---------------------------------------------------------------------------
// Malformed transcript data — the genuinely new coverage.
// ---------------------------------------------------------------------------

test("expandTranscriptWindow skips garbage non-JSON lines and still extracts the matching turn", async () => {
  await withStore(async (s) => {
    const rel = "context/transcripts/2026-06-22/sess-garbage.jsonl";
    const { chunks } = await seedSourceWithChunks(s, {
      sc: mkScope("system"),
      sourcePath: "context/memory/2026-06-22.aos.md",
      contents: [
        captureChunkContent({ sessionId: "sess", sourceHash: "def456", turnId: "a9", rel }),
      ],
    });

    const abs = transcriptAbs(rel);
    const goodEntries = [
      { type: "user", uuid: "u8", message: { role: "user", content: "where is the eiffel tower?" } },
      { type: "assistant", uuid: "a9", message: { role: "assistant", content: [{ type: "text", text: "The Eiffel Tower is in Paris." }] } },
    ];
    // Interleave garbage lines (partial writes / corrupt JSON) with valid JSONL.
    const raw = [
      "{not valid json",
      JSON.stringify(goodEntries[0]),
      "",
      "   ",
      "{\"unterminated\": ",
      JSON.stringify(goodEntries[1]),
      "garbage-trailer-line",
    ].join("\n") + "\n";
    const fs = fakeFs({ [abs]: raw });

    const res = await expandTranscriptWindow({
      client: s.client,
      rootDir: ROOT,
      chunkId: chunks[0].id,
      searchScope: { teamId: null, include: ["system"] },
      radius: 1,
      fs,
    });

    assert.ok(res);
    assert.equal(res.matched, true, "the real turn must still be found despite surrounding garbage");
    assert.ok(
      res.turns.some((t) => t.text.includes("The Eiffel Tower is in Paris.")),
      "matched assistant turn text must be present",
    );
  });
});

// ---------------------------------------------------------------------------
// Turn id not found in an otherwise well-formed transcript.
// ---------------------------------------------------------------------------

test("expandTranscriptWindow falls back to bounded raw content when the turn id has no match", async () => {
  await withStore(async (s) => {
    const rel = "context/transcripts/2026-06-22/sess-nomatch.jsonl";
    const { chunks } = await seedSourceWithChunks(s, {
      sc: mkScope("system"),
      sourcePath: "context/memory/2026-06-22.aos.md",
      contents: [
        // turnId "zzz" will never appear in the transcript below.
        captureChunkContent({ sessionId: "sess", sourceHash: "ghi789", turnId: "zzz", rel }),
      ],
    });

    const abs = transcriptAbs(rel);
    const raw = jsonl([
      { type: "user", uuid: "u1", message: { role: "user", content: "hello" } },
      { type: "assistant", uuid: "a1", message: { role: "assistant", content: [{ type: "text", text: "hi there" }] } },
    ]);
    const fs = fakeFs({ [abs]: raw });

    const res = await expandTranscriptWindow({
      client: s.client,
      rootDir: ROOT,
      chunkId: chunks[0].id,
      searchScope: { teamId: null, include: ["system"] },
      fs,
    });

    assert.ok(res, "an unmatched turn id must not throw or return null");
    assert.equal(res.turnId, "zzz");
    assert.equal(res.matched, false);
    assert.equal(res.truncated, false);
    assert.ok(res.turns.length > 0, "falls back to the bounded raw content");
  });
});

test("expandTranscriptWindow returns matched:false without throwing when no turn id is derivable", async () => {
  await withStore(async (s) => {
    const rel = "context/transcripts/2026-06-22/sess-noturn.jsonl";
    const { chunks } = await seedSourceWithChunks(s, {
      sc: mkScope("system"),
      sourcePath: "context/memory/2026-06-22.aos.md",
      // No capture marker -> no turn id derivable, but a transcript path is present
      // via the Raw transcript line, so readScopedTranscriptWindow resolves.
      contents: [`a summary with no marker\n\nRaw transcript: \`${rel}\``],
    });

    const fs = fakeFs({ [transcriptAbs(rel)]: jsonl([{ type: "assistant", uuid: "a1", message: { role: "assistant", content: "hi" } }]) });

    const res = await expandTranscriptWindow({
      client: s.client,
      rootDir: ROOT,
      chunkId: chunks[0].id,
      searchScope: { teamId: null, include: ["system"] },
      fs,
    });

    assert.ok(res);
    assert.equal(res.turnId, null);
    assert.equal(res.matched, false);
  });
});

// ---------------------------------------------------------------------------
// Permission hook composes on top of the scope filter, through both calls.
// ---------------------------------------------------------------------------

test("expandTranscriptWindow returns null when the permission hook denies, even when the scope matches", async () => {
  await withStore(async (s) => {
    const rel = "context/transcripts/2026-06-22/sess-perm.jsonl";
    const { chunks } = await seedSourceWithChunks(s, {
      sc: mkScope("system"),
      sourcePath: "context/memory/2026-06-22.aos.md",
      contents: [
        captureChunkContent({ sessionId: "sess", sourceHash: "jkl012", turnId: "a1", rel }),
      ],
    });

    const fs = fakeFs({ [transcriptAbs(rel)]: "should never be read" });

    const denied = await expandTranscriptWindow({
      client: s.client,
      rootDir: ROOT,
      chunkId: chunks[0].id,
      searchScope: { teamId: null, include: ["system"] },
      fs,
      permissionCheck: () => false,
    });

    assert.equal(denied, null);
    assert.equal(fs.calls.read.length, 0, "permission denial short-circuits before fs");
  });
});

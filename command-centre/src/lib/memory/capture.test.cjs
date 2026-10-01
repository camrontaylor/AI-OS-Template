const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");
const { openMemoryTestStore, resetMemoryTestStore } = require("./test-store.cjs");

// Leaf-first loading, same as indexer.test.cjs. capture.ts value-imports only
// ./indexer (the rest are type-only and erased), so it is loaded with that one
// stub. Stays fully OFFLINE — HashEmbedder is constructed directly.
const types = { ALL_VISIBILITIES: ["private", "client", "team", "system"] };
const embedding = loadTsModule(path.resolve(__dirname, "embedding.ts"));
const scope = loadTsModule(path.resolve(__dirname, "scope.ts"), {
  stubs: { "./types": types },
});
const migrate = loadTsModule(path.resolve(__dirname, "migrate.ts"));
const adapter = loadTsModule(path.resolve(__dirname, "pglite-adapter.ts"));
const postgresAdapter = loadTsModule(path.resolve(__dirname, "postgres-adapter.ts"));
const backend = loadTsModule(path.resolve(__dirname, "backend.ts"));
const rowMappers = loadTsModule(path.resolve(__dirname, "row-mappers.ts"), {
  stubs: { "./types": types, "./embedding": embedding },
});
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
const embedder = loadTsModule(path.resolve(__dirname, "embedder.ts"));
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

const EMBED_DIM = 8;
let sharedStore = null;

test.before(async () => {
  sharedStore = await openMemoryTestStore(store, { embedDim: EMBED_DIM });
});

test.after(async () => {
  await sharedStore?.close();
  sharedStore = null;
});

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-cap-"));
}
function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
async function withStore(fn) {
  if (!sharedStore) throw new Error("shared memory test store was not initialized");
  await resetMemoryTestStore(sharedStore);
  return fn(sharedStore);
}
function sysScope(overrides = {}) {
  return { teamId: null, clientId: null, userId: null, visibility: "system", ...overrides };
}
function clientScope(clientId, overrides = {}) {
  return { teamId: null, clientId, userId: null, visibility: "client", ...overrides };
}
function newEmbedder() {
  return new embedder.HashEmbedder({ dim: EMBED_DIM });
}
// Local-time date so the .aos.md filename matches across timezones.
const NOW = new Date(2026, 5, 7, 12, 0, 0);
const TODAY = "2026-06-07";

function writeTranscript(dir, entries) {
  const file = path.join(dir, "transcript.jsonl");
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return file;
}

// ---------------------------------------------------------------------------
// extractLastTurn
// ---------------------------------------------------------------------------

test("extractLastTurn pulls the last user→assistant exchange, skipping tool results", () => {
  const dir = tempDir();
  try {
    const file = writeTranscript(dir, [
      { type: "user", uuid: "u0", message: { role: "user", content: "first question" } },
      { type: "assistant", uuid: "a0", message: { role: "assistant", content: [{ type: "text", text: "first answer" }] } },
      { type: "user", uuid: "u1", message: { role: "user", content: [{ type: "text", text: "what is the capital of France?" }] } },
      // A tool_result user turn must NOT be treated as the prompt.
      { type: "user", uuid: "tr", message: { role: "user", content: [{ type: "tool_result", content: "ignored" }] } },
      { type: "assistant", uuid: "a1", message: { role: "assistant", content: [{ type: "text", text: "The capital of France is Paris." }] } },
    ]);
    const turn = capture.extractLastTurn(file);
    assert.ok(turn);
    assert.equal(turn.assistantMessage, "The capital of France is Paris.");
    assert.equal(turn.userPrompt, "what is the capital of France?");
    assert.equal(turn.turnId, "a1"); // from the assistant entry uuid
  } finally {
    rmDir(dir);
  }
});

test("extractLastTurn returns null on missing or contentless transcripts", () => {
  const dir = tempDir();
  try {
    assert.equal(capture.extractLastTurn(path.join(dir, "nope.jsonl")), null);
    // Corrupt + no assistant text → null, never throws.
    const corrupt = path.join(dir, "corrupt.jsonl");
    fs.writeFileSync(corrupt, "{not json\n{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"hi\"}}\n");
    assert.equal(capture.extractLastTurn(corrupt), null);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// upsertSessionCapture
// ---------------------------------------------------------------------------

test("upsertSessionCapture writes one summarized block and is idempotent by source hash", () => {
  const root = tempDir();
  try {
    const turn = { userPrompt: "hello", assistantMessage: "raw answer that should not be stored", turnId: "t1" };
    const summaryText = "- User asked for a greeting.\n- Claude answered with a short summary.";
    const r1 = capture.upsertSessionCapture({ rootDir: root, sessionId: "s1", turn, summaryText, now: NOW });
    assert.equal(r1.written, true);
    assert.ok(r1.filePath.endsWith(path.join("context", "memory", `${TODAY}.aos.md`)));
    const after1 = fs.readFileSync(r1.filePath, "utf-8");
    assert.match(after1, /## Auto-capture \(machine-owned/);
    assert.ok(after1.includes(summaryText));
    assert.ok(!after1.includes("raw answer that should not be stored"));

    // Same source turn again -> no write, even if the runtime turn id differs.
    const r2 = capture.upsertSessionCapture({
      rootDir: root,
      sessionId: "s1",
      turn: { ...turn, turnId: "t1-replayed" },
      summaryText,
      now: NOW,
    });
    assert.equal(r2.written, false);
    const after2 = fs.readFileSync(r2.filePath, "utf-8");
    assert.equal(after2, after1);
    assert.equal((after2.match(/aos-capture session:s1 source:/g) || []).length, 1);
  } finally {
    rmDir(root);
  }
});

test("upsertSessionCapture appends new turns in the same session", () => {
  const root = tempDir();
  try {
    capture.upsertSessionCapture({
      rootDir: root, sessionId: "s1", now: NOW,
      turn: { userPrompt: "q1", assistantMessage: "answer one", turnId: "t1" },
      summaryText: "- User asked q1.\n- Claude answered one.",
    });
    const r = capture.upsertSessionCapture({
      rootDir: root, sessionId: "s1", now: NOW,
      turn: { userPrompt: "q2", assistantMessage: "answer two", turnId: "t2" },
      summaryText: "- User asked q2.\n- Claude answered two.",
    });
    assert.equal(r.written, true);
    const text = fs.readFileSync(r.filePath, "utf-8");
    assert.equal((text.match(/aos-capture session:s1 source:/g) || []).length, 2);
    assert.ok(text.includes("Claude answered one."));
    assert.ok(text.includes("Claude answered two."));
  } finally {
    rmDir(root);
  }
});

test("upsertSessionCapture writes nothing for an empty assistant message", () => {
  const root = tempDir();
  try {
    const r = capture.upsertSessionCapture({
      rootDir: root, sessionId: "s1", now: NOW,
      turn: { userPrompt: "q", assistantMessage: "   ", turnId: "t1" },
    });
    assert.equal(r.written, false);
    assert.equal(typeof r.sourceHash, "string");
    assert.equal(fs.existsSync(r.filePath), false);
  } finally {
    rmDir(root);
  }
});

test("archiveRawTranscript copies the source transcript once", () => {
  const root = tempDir();
  const transcriptDir = tempDir();
  try {
    const transcript = writeTranscript(transcriptDir, [
      { type: "user", uuid: "u1", message: { role: "user", content: "archive this" } },
      { type: "assistant", uuid: "a1", message: { role: "assistant", content: [{ type: "text", text: "archived answer" }] } },
    ]);
    const turn = capture.extractLastTurn(transcript);
    const r1 = capture.archiveRawTranscript({
      rootDir: root,
      transcriptPath: transcript,
      sessionId: "session one",
      turn,
      now: NOW,
    });
    assert.equal(r1.written, true);
    assert.ok(r1.relativePath.startsWith(`context/transcripts/${TODAY}/session-one-`));
    assert.equal(fs.readFileSync(r1.filePath, "utf-8"), fs.readFileSync(transcript, "utf-8"));

    const r2 = capture.archiveRawTranscript({
      rootDir: root,
      transcriptPath: transcript,
      sessionId: "session one",
      turn,
      now: NOW,
    });
    assert.equal(r2.written, false);
    assert.equal(r2.filePath, r1.filePath);
  } finally {
    rmDir(root);
    rmDir(transcriptDir);
  }
});

test("captureSessionTurn uses summaries and records the raw transcript archive", async () => {
  const root = tempDir();
  const transcriptDir = tempDir();
  try {
    const transcript = writeTranscript(transcriptDir, [
      { type: "user", uuid: "u1", message: { role: "user", content: "summarize this turn" } },
      { type: "assistant", uuid: "a1", message: { role: "assistant", content: [{ type: "text", text: "raw answer not persisted" }] } },
    ]);
    const turn = capture.extractLastTurn(transcript);
    let summaryCalls = 0;
    const r = await capture.captureSessionTurn({
      rootDir: root,
      sessionId: "s-summary",
      transcriptPath: transcript,
      turn,
      now: NOW,
      summaryConfig: { enabled: true, provider: "claude", model: "haiku", timeoutMs: 100 },
      summaryRunner: async () => {
        summaryCalls += 1;
        return "- User asked to summarize a turn.\n- Claude captured a compact memory.";
      },
    });

    assert.equal(r.written, true);
    assert.equal(r.summarySource, "summarized");
    assert.equal(summaryCalls, 1);
    assert.equal(r.rawTranscriptWritten, true);
    const text = fs.readFileSync(r.filePath, "utf-8");
    assert.ok(text.includes("Claude captured a compact memory."));
    assert.ok(text.includes(`Raw transcript: \`${r.rawTranscriptPath}\``));
    assert.ok(!text.includes("raw answer not persisted"));

    const replay = await capture.captureSessionTurn({
      rootDir: root,
      sessionId: "s-summary",
      transcriptPath: transcript,
      turn,
      now: NOW,
      summaryConfig: { enabled: true, provider: "claude", model: "haiku", timeoutMs: 100 },
      summaryRunner: async () => {
        summaryCalls += 1;
        return "- This should not run.";
      },
    });
    assert.equal(replay.written, false);
    assert.equal(replay.summarySource, "skipped");
    assert.equal(summaryCalls, 1);
  } finally {
    rmDir(root);
    rmDir(transcriptDir);
  }
});

test("captureSessionTurn falls back when summarization fails", async () => {
  const root = tempDir();
  try {
    const turn = {
      userPrompt: "what happened?",
      assistantMessage: "The assistant explained the fallback path.",
      turnId: "t-fallback",
    };
    const r = await capture.captureSessionTurn({
      rootDir: root,
      sessionId: "s-fallback",
      turn,
      now: NOW,
      summaryConfig: { enabled: true, provider: "claude", model: "haiku", timeoutMs: 100 },
      summaryRunner: async () => null,
    });
    assert.equal(r.written, true);
    assert.equal(r.summarySource, "fallback");
    const text = fs.readFileSync(r.filePath, "utf-8");
    assert.ok(text.includes("- User asked: what happened?"));
    assert.ok(text.includes("- Assistant responded: The assistant explained the fallback path."));
  } finally {
    rmDir(root);
  }
});

// ---------------------------------------------------------------------------
// refreshIndex — debounce + force
// ---------------------------------------------------------------------------

test("refreshIndex debounces, and --force bypasses it", async () => {
  const root = tempDir();
  const stateDir = tempDir();
  try {
    await withStore(async (s) => {
    const base = NOW.getTime();
    const common = { store: s, embedder: newEmbedder(), scope: sysScope(), rootDir: root, stateDir };

    const run1 = await capture.refreshIndex({ ...common, reason: "session_capture", force: true, now: new Date(base) });
    assert.equal(run1.skipped, null);
    assert.ok(run1.summary);

    // 5s later, within the 30s debounce window → skipped.
    const run2 = await capture.refreshIndex({ ...common, debounceMs: 30_000, now: new Date(base + 5_000) });
    assert.equal(run2.skipped, "debounced");
    assert.equal(run2.summary, null);

    // force bypasses the debounce.
    const run3 = await capture.refreshIndex({ ...common, debounceMs: 30_000, force: true, now: new Date(base + 5_000) });
    assert.equal(run3.skipped, null);

    // State file records the last run.
    const state = JSON.parse(fs.readFileSync(path.join(stateDir, "capture-state.json"), "utf-8"));
    assert.equal(typeof state.lastIndexAt, "number");
    });
  } finally {
    rmDir(root);
    rmDir(stateDir);
  }
});

test("refreshIndex debounces independently per scope", async () => {
  const root = tempDir();
  const stateDir = tempDir();
  try {
    await withStore(async (s) => {
    const base = NOW.getTime();
    const common = { store: s, embedder: newEmbedder(), rootDir: root, stateDir, debounceMs: 30_000 };

    const systemRun = await capture.refreshIndex({
      ...common,
      scope: sysScope(),
      reason: "session_capture",
      now: new Date(base),
    });
    assert.equal(systemRun.skipped, null);
    assert.ok(fs.existsSync(path.join(stateDir, "capture-state.json")));

    const clientRun = await capture.refreshIndex({
      ...common,
      scope: clientScope("acme"),
      reason: "session_capture",
      now: new Date(base + 5_000),
    });
    assert.equal(clientRun.skipped, null);
    assert.ok(fs.existsSync(path.join(stateDir, "capture-state.client-acme.json")));

    const clientReplay = await capture.refreshIndex({
      ...common,
      scope: clientScope("acme"),
      reason: "session_capture",
      now: new Date(base + 10_000),
    });
    assert.equal(clientReplay.skipped, "debounced");
    });
  } finally {
    rmDir(root);
    rmDir(stateDir);
  }
});

// ---------------------------------------------------------------------------
// End-to-end: a captured turn becomes searchable, and status reflects it
// ---------------------------------------------------------------------------

test("a captured session is indexed and searchable, and status reflects it", async () => {
  const root = tempDir();
  const stateDir = tempDir();
  try {
    await withStore(async (s) => {
    const written = capture.upsertSessionCapture({
      rootDir: root, sessionId: "s9", now: NOW,
      turn: {
        userPrompt: "how does pglite pgvector memory capture work?",
        assistantMessage: "The pglite pgvector memory store indexes the captured session chunk.",
        turnId: "t1",
      },
    });
    assert.equal(written.written, true);

    const refresh = await capture.refreshIndex({
      store: s, embedder: newEmbedder(), scope: sysScope(), rootDir: root,
      stateDir, reason: "session_capture", force: true, now: NOW,
    });
    assert.equal(refresh.summary.errors.length, 0);
    assert.ok(refresh.summary.sourcesIndexed >= 1);

    // The captured text is retrievable via a scoped vector search.
    const [q] = await newEmbedder().embed(["pglite pgvector memory store captured session"]);
    const hits = await s.vectorSearch({ teamId: null, include: ["system"] }, q, 5);
    assert.ok(hits.some((h) => h.content.includes("captured session chunk")));
    assert.ok(hits.some((h) => h.sourcePath === `context/memory/${TODAY}.aos.md`));

    // Status reflects the capture + the index job reason.
    const status = await capture.memoryStatus({ store: s, rootDir: root, now: NOW });
    assert.ok(status.sources >= 1);
    assert.ok(status.chunks >= 1);
    assert.ok(status.jobs >= 1);
    assert.ok((status.byVisibility.system ?? 0) >= 1);
    assert.ok((status.jobsByStatus.succeeded ?? 0) >= 1);
    assert.ok(status.lastIndexedAt);
    assert.equal(status.today.capturePresent, true);
    assert.equal(status.today.captureIndexed, true);
    assert.ok(status.lastIndex);
    assert.equal(status.lastIndex.reason, "session_capture");
    });
  } finally {
    rmDir(root);
    rmDir(stateDir);
  }
});

// ---------------------------------------------------------------------------
// Capture-block parsing (chunker.ts) — transcript-rung provenance stamped onto
// chunks. Tested here because this file already loads the real chunker. Mirrors
// the .aos.md layout where the `turn:` marker sits above the `### Session`
// heading, so a body chunk straddles into the next block's marker but must
// still be attributed to its own block.
// ---------------------------------------------------------------------------

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const TWO_BLOCKS = [
  "# 2026-06-27 - session auto-capture", // 1
  "", // 2
  `<!-- aos-capture session:s source:h1 turn:${U1} -->`, // 3 (block 1 marker)
  "### Session s - 2026-06-27T22:13:56.000Z", // 4
  "", // 5
  "- summary one", // 6
  "", // 7
  "Raw transcript: `context/transcripts/2026-06-27/s-h1.jsonl`", // 8
  "", // 9
  "<!-- /aos-capture -->", // 10
  "", // 11
  `<!-- aos-capture session:s source:h2 turn:${U2} -->`, // 12 (block 2 marker)
  "### Session s - 2026-06-27T22:20:00.000Z", // 13
  "", // 14
  "- summary two", // 15
  "", // 16
  "Raw transcript: `context/transcripts/2026-06-27/s-h2.jsonl`", // 17
  "", // 18
  "<!-- /aos-capture -->", // 19
].join("\n");

test("parseCaptureBlocks extracts hyphenated UUID turn ids, paths, and 1-based ranges", () => {
  const blocks = chunker.parseCaptureBlocks(TWO_BLOCKS);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], {
    startLine: 3,
    endLine: 10,
    turnId: U1,
    transcriptPath: "context/transcripts/2026-06-27/s-h1.jsonl",
  });
  assert.deepEqual(blocks[1], {
    startLine: 12,
    endLine: 19,
    turnId: U2,
    transcriptPath: "context/transcripts/2026-06-27/s-h2.jsonl",
  });
});

test("parseCaptureBlocks returns [] for a source with no capture markers", () => {
  assert.deepEqual(chunker.parseCaptureBlocks("# notes\n\njust prose, no markers\n"), []);
});

test("captureMetadataForChunk maps a straddling body chunk to its OWN block, not the next", () => {
  const blocks = chunker.parseCaptureBlocks(TWO_BLOCKS);
  // Body chunk for block 1: after its heading (line 4) to block 2's orphaned
  // marker (line 12) — the chunker's real output shape.
  const block1Body = chunker.captureMetadataForChunk({ startLine: 4, endLine: 12 }, blocks);
  assert.equal(block1Body.turnId, U1, "must be block 1's turn id despite holding block 2's marker line");
  assert.equal(block1Body.transcriptPath, "context/transcripts/2026-06-27/s-h1.jsonl");

  const block2Body = chunker.captureMetadataForChunk({ startLine: 13, endLine: 19 }, blocks);
  assert.equal(block2Body.turnId, U2);

  // A chunk overlapping no block (pure preamble) gets nothing.
  assert.equal(chunker.captureMetadataForChunk({ startLine: 1, endLine: 2 }, blocks), null);
});

test("client workspace capture indexes context memory under client scope", async () => {
  const storeRoot = tempDir();
  const clientRoot = path.join(storeRoot, "clients", "acme");
  const stateDir = path.join(storeRoot, ".command-centre", "memory");
  try {
    await withStore(async (s) => {
    const written = capture.upsertSessionCapture({
      rootDir: clientRoot, sessionId: "client-session", now: NOW,
      turn: {
        userPrompt: "remember the acme onboarding plan",
        assistantMessage: "Acme onboarding needs contract review before kickoff.",
        turnId: "client-turn",
      },
    });
    assert.equal(written.written, true);

    const refresh = await capture.refreshIndex({
      store: s,
      embedder: newEmbedder(),
      scope: clientScope("acme"),
      rootDir: clientRoot,
      stateDir,
      reason: "session_capture",
      force: true,
      now: NOW,
    });
    assert.equal(refresh.summary.errors.length, 0);
    assert.ok(refresh.summary.sourcesIndexed >= 1);

    const rows = await s.client.query(
      "SELECT source_path, visibility, client_id FROM memory_sources WHERE source_path = $1",
      [`context/memory/${TODAY}.aos.md`],
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].source_path, `context/memory/${TODAY}.aos.md`);
    assert.equal(rows.rows[0].visibility, "client");
    assert.equal(rows.rows[0].client_id, "acme");

    const [q] = await newEmbedder().embed(["acme onboarding contract review"]);
    const clientHits = await s.vectorSearch({ teamId: null, clientId: "acme", include: ["client"] }, q, 5);
    assert.ok(clientHits.some((h) => h.content.includes("contract review")));
    const systemHits = await s.vectorSearch({ teamId: null, include: ["system"] }, q, 5);
    assert.ok(!systemHits.some((h) => h.content.includes("contract review")));
    });
  } finally {
    rmDir(storeRoot);
  }
});

test("summarizeTurn never lets the summary Claude inherit the parent task id", async () => {
  const { EventEmitter } = require("node:events");
  const spawnCalls = [];
  const isolatedCapture = loadTsModule(path.resolve(__dirname, "capture.ts"), {
    stubs: {
      "./indexer": indexer,
      "node:child_process": {
        spawnSync: () => ({ status: 0 }),
        spawn: (command, args, options) => {
          spawnCalls.push({ command, args, options });
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stdin = {
            end() {
              setImmediate(() => {
                child.stdout.emit("data", Buffer.from("- Summarized turn"));
                child.emit("close", 0);
              });
            },
          };
          return child;
        },
      },
    },
  });
  const previous = process.env.AI_OS_TASK_ID;
  process.env.AI_OS_TASK_ID = "cron-task-running-this-hook";
  try {
    const summary = await isolatedCapture.summarizeTurn({
      rootDir: os.tmpdir(),
      config: { enabled: true, provider: "claude", model: "haiku", timeoutMs: 5_000 },
      turn: { userPrompt: "Run the distill", assistantMessage: "Done.", turnId: "t1" },
    });

    assert.equal(spawnCalls.length, 1);
    assert.ok(summary);
    assert.equal(spawnCalls[0].options.env.AI_OS_TASK_ID, undefined);
    assert.equal(spawnCalls[0].options.env.AI_OS_MEMORY_CAPTURE, "1");
    assert.ok(spawnCalls[0].options.env.PATH ?? spawnCalls[0].options.env.Path);
  } finally {
    if (previous === undefined) delete process.env.AI_OS_TASK_ID;
    else process.env.AI_OS_TASK_ID = previous;
  }
});

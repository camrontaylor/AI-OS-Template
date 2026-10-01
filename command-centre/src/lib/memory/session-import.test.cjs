const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadMemoryModules } = require("../../../scripts/load-memory-modules.cjs");

// Load the real module graph (also exercises the load-memory-modules wiring for
// session-import.ts). Fully offline: we inject HashEmbedder and a fake summary
// runner, so neither @huggingface/transformers nor the `claude` CLI is touched.
const { sessionImport, store, embedder, indexer } = loadMemoryModules({ withImport: true });
const {
  workspaceSlug,
  sessionIdFromFilename,
  discoverSessions,
  sessionTimeMs,
  parseSessionTurns,
  sessionContentHash,
  buildSessionDigest,
  loadLedger,
  saveLedger,
  importStatus,
  reportSources,
  candidatesForKind,
  selectSessions,
  importSessions,
} = sessionImport;

const EMBED_DIM = 8;

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-import-"));
}
function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}
function newEmbedder() {
  return new embedder.HashEmbedder({ dim: EMBED_DIM });
}

// A fake summarizer: deterministic, never spawns `claude`.
const fakeRunner = async () => "- fake summary line one\n- fake summary line two";

function jsonl(entries) {
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}
function userEntry(text, ts) {
  return { type: "user", message: { role: "user", content: text }, timestamp: ts };
}
function toolResultEntry(ts) {
  return {
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", content: "tool output" }] },
    timestamp: ts,
  };
}
function assistantEntry(text, ts) {
  return {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
    timestamp: ts,
  };
}
function thinkingOnlyEntry(ts) {
  return {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "thinking", thinking: "hmm" }] },
    timestamp: ts,
  };
}

// ---------------------------------------------------------------------------
// parseSessionTurns — the new full-session parser
// ---------------------------------------------------------------------------

test("parseSessionTurns pairs turns, merges assistant parts, tolerates noise", () => {
  const raw = [
    JSON.stringify(userEntry("Question one", "2026-05-01T10:00:00Z")),
    JSON.stringify(assistantEntry("Answer 1a", "2026-05-01T10:00:01Z")),
    "{ this is not valid json", // corrupt line → skipped
    JSON.stringify(thinkingOnlyEntry("2026-05-01T10:00:02Z")), // no text → ignored
    JSON.stringify(toolResultEntry("2026-05-01T10:00:03Z")), // tool-only user → not a prompt
    JSON.stringify(assistantEntry("Answer 1b", "2026-05-01T10:00:04Z")), // merges into turn 1
    JSON.stringify(userEntry("Question two", "2026-05-01T10:01:00Z")),
    JSON.stringify(assistantEntry("Answer 2", "2026-05-01T10:01:01Z")),
    JSON.stringify(userEntry("Trailing unanswered", "2026-05-01T10:02:00Z")), // dropped (no reply)
  ].join("\n");

  const turns = parseSessionTurns(raw, "sess-1");
  assert.equal(turns.length, 2);
  assert.equal(turns[0].userPrompt, "Question one");
  assert.equal(turns[0].assistantMessage, "Answer 1a\nAnswer 1b");
  assert.equal(turns[1].userPrompt, "Question two");
  assert.equal(turns[1].assistantMessage, "Answer 2");
  // Deterministic, distinct source hashes per turn.
  assert.match(turns[0].sourceHash, /^[0-9a-f]{64}$/);
  assert.notEqual(turns[0].sourceHash, turns[1].sourceHash);
  assert.deepEqual(turns.map((t) => t.index), [0, 1]);
});

test("parseSessionTurns returns [] for an empty or assistant-less transcript", () => {
  assert.deepEqual(parseSessionTurns(""), []);
  assert.deepEqual(parseSessionTurns(jsonl([userEntry("hi", "2026-05-01T10:00:00Z")])), []);
});

test("sessionContentHash is stable across re-parses and changes with content", () => {
  const a = jsonl([userEntry("Q", "2026-05-01T10:00:00Z"), assistantEntry("A", "2026-05-01T10:00:01Z")]);
  const b = jsonl([
    userEntry("Q", "2026-05-01T10:00:00Z"),
    assistantEntry("A", "2026-05-01T10:00:01Z"),
    userEntry("Q2", "2026-05-01T10:02:00Z"),
    assistantEntry("A2", "2026-05-01T10:02:01Z"),
  ]);
  assert.equal(sessionContentHash(parseSessionTurns(a)), sessionContentHash(parseSessionTurns(a)));
  assert.notEqual(sessionContentHash(parseSessionTurns(a)), sessionContentHash(parseSessionTurns(b)));
});

test("buildSessionDigest is bounded and includes both sides", () => {
  const turns = parseSessionTurns(
    jsonl([userEntry("ask about the xylophone protocol", "2026-05-01T10:00:00Z"), assistantEntry("reply detail", "2026-05-01T10:00:01Z")]),
  );
  const digest = buildSessionDigest(turns, 50);
  assert.ok(digest.length <= 50);
  const full = buildSessionDigest(turns);
  assert.ok(full.includes("xylophone protocol"));
  assert.ok(full.includes("reply detail"));
});

// ---------------------------------------------------------------------------
// Filename / slug helpers
// ---------------------------------------------------------------------------

test("workspaceSlug + sessionIdFromFilename", () => {
  const slug = workspaceSlug("/Users/me/Documents/AI-OS");
  // Slug must contain only alphanumerics and hyphens (no other special chars).
  assert.match(slug, /^[A-Za-z0-9-]+$/);
  // Must end with the path components regardless of OS drive prefix (Windows prepends e.g. "C-").
  assert.ok(slug.endsWith("Users-me-Documents-AI-OS"), `slug "${slug}" should end with "Users-me-Documents-AI-OS"`);
  assert.equal(sessionIdFromFilename("abc-123.jsonl"), "abc-123");
  // Archived form `{sessionId}-{12hex}.jsonl` strips the hash suffix.
  assert.equal(sessionIdFromFilename("c0d3f2e4-2643-407b-08ea565fc229.jsonl"), "c0d3f2e4-2643-407b");
});

// ---------------------------------------------------------------------------
// discoverSessions — classification, sidecar exclusion, newest-first
// ---------------------------------------------------------------------------

test("discoverSessions classifies sources, excludes subagents, sorts newest-first", () => {
  const root = tempDir();
  const claudeHome = tempDir();
  try {
    const slug = workspaceSlug(root);
    const projects = path.join(claudeHome, "projects");

    // Current workspace: two main sessions (one newer).
    write(
      projects,
      `${slug}/old.jsonl`,
      jsonl([userEntry("old q", "2026-05-01T10:00:00Z"), assistantEntry("old a", "2026-05-01T10:00:01Z")]),
    );
    write(
      projects,
      `${slug}/new.jsonl`,
      jsonl([userEntry("new q", "2026-06-01T10:00:00Z"), assistantEntry("new a", "2026-06-01T10:00:01Z")]),
    );
    // A subagent sidecar that must NOT be discovered.
    write(
      projects,
      `${slug}/some-session/subagents/agent-1.jsonl`,
      jsonl([assistantEntry("sidecar", "2026-06-02T10:00:00Z")]),
    );
    // A different project → global.
    write(
      projects,
      `-Users-me-other/g.jsonl`,
      jsonl([userEntry("g q", "2026-04-01T10:00:00Z"), assistantEntry("g a", "2026-04-01T10:00:01Z")]),
    );

    const found = discoverSessions({ rootDir: root, claudeHome });
    const byName = (p) => path.basename(p.absPath);

    // Sidecar excluded.
    assert.ok(!found.some((c) => byName(c) === "agent-1.jsonl"));
    // Three main sessions discovered.
    assert.equal(found.length, 3);
    // Newest-first: new (Jun 1) → old (May 1) → g (Apr 1).
    assert.deepEqual(found.map(byName), ["new.jsonl", "old.jsonl", "g.jsonl"]);
    // Classification.
    const kinds = Object.fromEntries(found.map((c) => [byName(c), c.sourceKind]));
    assert.equal(kinds["new.jsonl"], "current-workspace");
    assert.equal(kinds["old.jsonl"], "current-workspace");
    assert.equal(kinds["g.jsonl"], "global");
    // sessionTimeMs reflects transcript start.
    assert.ok(sessionTimeMs(found[0]) > sessionTimeMs(found[1]));
  } finally {
    rmDir(root);
    rmDir(claudeHome);
  }
});

test("discoverSessions picks up aos-archive and explicit other paths", () => {
  const root = tempDir();
  const claudeHome = tempDir();
  const otherDir = tempDir();
  try {
    write(
      root,
      "context/transcripts/2026-05-10/sess-aaaaaaaaaaaa.jsonl",
      jsonl([userEntry("arch q", "2026-05-10T10:00:00Z"), assistantEntry("arch a", "2026-05-10T10:00:01Z")]),
    );
    const otherFile = write(
      otherDir,
      "mine.jsonl",
      jsonl([userEntry("other q", "2026-05-20T10:00:00Z"), assistantEntry("other a", "2026-05-20T10:00:01Z")]),
    );

    const found = discoverSessions({ rootDir: root, claudeHome, extraPaths: [otherFile] });
    const kinds = found.map((c) => c.sourceKind).sort();
    assert.deepEqual(kinds, ["aos-archive", "other"]);
  } finally {
    rmDir(root);
    rmDir(claudeHome);
    rmDir(otherDir);
  }
});

// ---------------------------------------------------------------------------
// selectSessions — newest-first + each limit mode
// ---------------------------------------------------------------------------

test("selectSessions applies all/recent/days/range limits newest-first", () => {
  const mk = (name, ms) => ({
    sourceKind: "global",
    absPath: `/x/${name}.jsonl`,
    sessionId: name,
    projectSlug: null,
    byteSize: 1,
    modifiedMs: ms,
    startedAtMs: ms,
    endedAtMs: ms,
    fingerprint: name,
  });
  const now = new Date("2026-06-30T00:00:00Z");
  const day = 86_400_000;
  const cands = [
    mk("d10", now.getTime() - 10 * day),
    mk("d1", now.getTime() - 1 * day),
    mk("d40", now.getTime() - 40 * day),
    mk("d3", now.getTime() - 3 * day),
  ];

  assert.deepEqual(selectSessions(cands, { mode: "all" }, now).map((c) => c.sessionId), ["d1", "d3", "d10", "d40"]);
  assert.deepEqual(selectSessions(cands, { mode: "recent", count: 2 }, now).map((c) => c.sessionId), ["d1", "d3"]);
  assert.deepEqual(selectSessions(cands, { mode: "days", days: 7 }, now).map((c) => c.sessionId), ["d1", "d3"]);
  const range = selectSessions(
    cands,
    { mode: "range", sinceMs: now.getTime() - 11 * day, untilMs: now.getTime() - 2 * day },
    now,
  );
  assert.deepEqual(range.map((c) => c.sessionId), ["d3", "d10"]);
});

// ---------------------------------------------------------------------------
// Ledger + reportSources
// ---------------------------------------------------------------------------

test("ledger round-trips and importStatus tracks new/imported/changed", () => {
  const root = tempDir();
  try {
    assert.deepEqual(loadLedger(root).entries, {});
    const cand = {
      sourceKind: "global",
      absPath: "/x/a.jsonl",
      sessionId: "a",
      projectSlug: null,
      byteSize: 100,
      modifiedMs: 1000,
      startedAtMs: 1000,
      endedAtMs: 1000,
      fingerprint: "fp-a",
    };
    const ledger = loadLedger(root);
    assert.equal(importStatus(ledger, cand), "new");

    ledger.entries["fp-a"] = {
      fingerprint: "fp-a",
      sourceKind: "global",
      originalPath: cand.absPath,
      sessionId: "a",
      contentSha256: "x",
      byteSize: 100,
      modifiedMs: 1000,
      importedAt: "2026-06-01T00:00:00Z",
      memorySourcePath: "context/memory/2026-06-01.aos.md",
      rawArchivePath: null,
      turnsImported: 2,
      summaryStatus: "session",
      lastError: null,
    };
    saveLedger(root, ledger);

    const reloaded = loadLedger(root);
    assert.equal(importStatus(reloaded, cand), "imported");
    // A changed file (different size/mtime) is offered again.
    assert.equal(importStatus(reloaded, { ...cand, byteSize: 200 }), "changed");
    assert.equal(importStatus(reloaded, { ...cand, modifiedMs: 2000 }), "changed");
  } finally {
    rmDir(root);
  }
});

test("reportSources counts total/imported/available with global spanning all CC history", () => {
  const cands = [
    { sourceKind: "current-workspace", fingerprint: "c1" },
    { sourceKind: "current-workspace", fingerprint: "c2" },
    { sourceKind: "global", fingerprint: "g1" },
    { sourceKind: "aos-archive", fingerprint: "a1" },
  ].map((c) => ({ byteSize: 1, modifiedMs: 1, ...c }));

  const ledger = { version: 1, entries: {} };
  const reports = reportSources(cands, ledger);
  const byKind = Object.fromEntries(reports.map((r) => [r.sourceKind, r]));

  assert.equal(byKind["current-workspace"].total, 2);
  assert.equal(byKind["global"].total, 3); // current-workspace + global
  assert.equal(byKind["aos-archive"].total, 1);
  assert.equal(byKind["current-workspace"].available, 2);

  // candidatesForKind global spans current-workspace too.
  assert.equal(candidatesForKind(cands, "global").length, 3);
  assert.equal(candidatesForKind(cands, "current-workspace").length, 2);
});

// ---------------------------------------------------------------------------
// importSessions — write blocks, idempotency, modes
// ---------------------------------------------------------------------------

function buildCandidate(root, rel, raw, sessionId) {
  const abs = write(root, rel, raw);
  const stat = fs.statSync(abs);
  return {
    sourceKind: "other",
    absPath: abs,
    sessionId,
    projectSlug: null,
    byteSize: stat.size,
    modifiedMs: stat.mtimeMs,
    startedAtMs: Date.parse("2026-05-15T10:00:00Z"),
    endedAtMs: Date.parse("2026-05-15T10:05:00Z"),
    fingerprint: `fp-${sessionId}`,
  };
}

test("importSessions (session mode) writes a summarized block and is idempotent", async () => {
  const root = tempDir();
  try {
    const raw = jsonl([
      userEntry("how does the xylophone protocol work", "2026-05-15T10:00:00Z"),
      assistantEntry("The xylophone protocol uses staged resonance.", "2026-05-15T10:00:01Z"),
    ]);
    const cand = buildCandidate(root, "src/sess-x.jsonl", raw, "sess-x");

    const run1 = await importSessions({
      rootDir: root,
      candidates: [cand],
      summaryMode: "session",
      summaryRunner: fakeRunner,
      now: new Date("2026-06-28T00:00:00Z"),
    });
    assert.equal(run1.imported, 1);
    assert.equal(run1.blocksWritten, 1);
    assert.equal(run1.failed, 0);
    assert.equal(run1.sourcePaths.length, 1);

    // The block landed under context/memory/*.aos.md with the summary + marker.
    const aosFile = path.join(root, run1.sourcePaths[0]);
    const body = fs.readFileSync(aosFile, "utf-8");
    assert.ok(body.includes("fake summary line one"));
    assert.ok(body.includes("source:"));
    assert.ok(run1.sourcePaths[0].startsWith("context/memory/"));
    const beforeMtime = fs.statSync(aosFile).mtimeMs;

    // Re-run: ledger says imported & unchanged → skipped, no new block.
    const run2 = await importSessions({
      rootDir: root,
      candidates: [cand],
      summaryMode: "session",
      summaryRunner: fakeRunner,
      now: new Date("2026-06-28T00:00:00Z"),
    });
    assert.equal(run2.skipped, 1);
    assert.equal(run2.imported, 0);
    assert.equal(fs.readFileSync(aosFile, "utf-8"), body);
    assert.equal(fs.statSync(aosFile).mtimeMs, beforeMtime);
  } finally {
    rmDir(root);
  }
});

test("importSessions dedups via the block marker even when the ledger is wiped", async () => {
  const root = tempDir();
  try {
    const raw = jsonl([
      userEntry("q", "2026-05-15T10:00:00Z"),
      assistantEntry("a", "2026-05-15T10:00:01Z"),
    ]);
    const cand = buildCandidate(root, "src/sess-y.jsonl", raw, "sess-y");
    const run1 = await importSessions({
      rootDir: root,
      candidates: [cand],
      summaryMode: "none",
      now: new Date("2026-06-28T00:00:00Z"),
    });
    const aosFile = path.join(root, run1.sourcePaths[0]);
    const body = fs.readFileSync(aosFile, "utf-8");

    // Wipe the ledger → importStatus is "new" again, but the block dedup holds.
    fs.rmSync(path.join(root, ".command-centre", "memory-import", "import-ledger.json"), { force: true });
    const run2 = await importSessions({
      rootDir: root,
      candidates: [cand],
      summaryMode: "none",
      now: new Date("2026-06-28T00:00:00Z"),
    });
    assert.equal(run2.imported, 1); // ledger re-recorded
    assert.equal(run2.blocksWritten, 0); // but no duplicate block written
    assert.equal(fs.readFileSync(aosFile, "utf-8"), body);
  } finally {
    rmDir(root);
  }
});

test("importSessions (turn mode) writes one block per meaningful turn", async () => {
  const root = tempDir();
  try {
    const raw = jsonl([
      userEntry("first question", "2026-05-15T10:00:00Z"),
      assistantEntry("first answer", "2026-05-15T10:00:01Z"),
      userEntry("second question", "2026-05-15T10:01:00Z"),
      assistantEntry("second answer", "2026-05-15T10:01:01Z"),
    ]);
    const cand = buildCandidate(root, "src/sess-z.jsonl", raw, "sess-z");
    const run = await importSessions({
      rootDir: root,
      candidates: [cand],
      summaryMode: "turn",
      summaryRunner: fakeRunner,
      now: new Date("2026-06-28T00:00:00Z"),
    });
    assert.equal(run.imported, 1);
    assert.equal(run.turnsImported, 2);
    assert.equal(run.blocksWritten, 2); // one block per turn
    const body = fs.readFileSync(path.join(root, run.sourcePaths[0]), "utf-8");
    const openMarkers = body.match(/<!-- aos-capture /g) || [];
    assert.equal(openMarkers.length, 2);
  } finally {
    rmDir(root);
  }
});

// ---------------------------------------------------------------------------
// End-to-end: import → index → recall, and re-index idempotency
// ---------------------------------------------------------------------------

test("the ledger survives opening the PGLite store in the default data dir", async () => {
  // Regression: the ledger must NOT live inside .command-centre/memory, because
  // opening PGLite there turns the dir into a pure Postgres cluster and deletes
  // foreign files. The CLI opens the store at exactly that default data dir.
  const root = tempDir();
  try {
    const raw = jsonl([
      userEntry("q", "2026-05-15T10:00:00Z"),
      assistantEntry("a", "2026-05-15T10:00:01Z"),
    ]);
    const cand = buildCandidate(root, "src/sess-led.jsonl", raw, "sess-led");
    await importSessions({
      rootDir: root,
      candidates: [cand],
      summaryMode: "none",
      now: new Date("2026-06-28T00:00:00Z"),
    });
    assert.equal(Object.keys(loadLedger(root).entries).length, 1);

    // Open + close the store at the SAME default data dir the CLI uses.
    const dataDir = path.join(root, ".command-centre", "memory");
    const s = await store.openMemoryStore({ dataDir, embedDim: EMBED_DIM });
    await s.close();

    // Ledger must still be intact → the session is recognized as imported.
    const reloaded = loadLedger(root);
    assert.equal(Object.keys(reloaded.entries).length, 1);
    assert.equal(importStatus(reloaded, cand), "imported");
  } finally {
    rmDir(root);
  }
});

test("imported sessions are searchable after indexing, and re-index is idempotent", async () => {
  const root = tempDir();
  const dataDir = tempDir();
  try {
    const raw = jsonl([
      userEntry("explain the xylophone protocol design", "2026-05-15T10:00:00Z"),
      assistantEntry("The xylophone protocol stages resonance across nodes.", "2026-05-15T10:00:01Z"),
    ]);
    const cand = buildCandidate(root, "src/sess-e2e.jsonl", raw, "sess-e2e");
    await importSessions({
      rootDir: root,
      candidates: [cand],
      summaryMode: "none", // deterministic, no LLM
      now: new Date("2026-06-28T00:00:00Z"),
    });

    const s = await store.openMemoryStore({ dataDir, embedDim: EMBED_DIM });
    try {
      const run1 = await indexer.indexSources({
        store: s,
        embedder: newEmbedder(),
        scope: { teamId: null, clientId: null, userId: null, visibility: "system" },
        rootDir: root,
        roots: ["context/memory"],
        reason: "backfill",
      });
      assert.ok(run1.sourcesIndexed >= 1);

      const [q] = await newEmbedder().embed(["xylophone protocol"]);
      const hits = await s.vectorSearch({ teamId: null, include: ["system"] }, q, 5);
      assert.ok(hits.some((h) => h.content.includes("xylophone protocol")));

      const chunkCount = async () =>
        Number((await s.client.query("SELECT count(*)::int AS n FROM memory_chunks")).rows[0].n);
      const before = await chunkCount();

      // Re-index unchanged sources → skipped, no new chunks.
      const run2 = await indexer.indexSources({
        store: s,
        embedder: newEmbedder(),
        scope: { teamId: null, clientId: null, userId: null, visibility: "system" },
        rootDir: root,
        roots: ["context/memory"],
        reason: "backfill",
      });
      assert.ok(run2.sourcesSkipped >= 1);
      assert.equal(await chunkCount(), before);
    } finally {
      await s.close();
    }
  } finally {
    rmDir(root);
    rmDir(dataDir);
  }
});

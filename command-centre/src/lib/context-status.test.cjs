const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const { getContextStatusForSession } = loadTsModule(
  path.resolve(__dirname, "context-status.ts"),
);

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeTranscript(homeDir, sessionId, entries) {
  const projectDir = path.join(homeDir, ".claude", "projects", "workspace");
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, `${sessionId}.jsonl`),
    entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    "utf-8",
  );
}

test("reads fresh exact bridge context data", () => {
  const tempDir = makeTempDir("context-status-temp-");
  const homeDir = makeTempDir("context-status-home-");
  try {
    const nowMs = Date.now();
    const bridgePath = path.join(tempDir, "claude-ctx-session-exact.json");
    fs.writeFileSync(bridgePath, JSON.stringify({
      tokensUsed: 100_000,
      totalTokens: 200_000,
      updatedAt: "2026-05-17T10:30:00.000Z",
    }));
    fs.utimesSync(bridgePath, new Date(nowMs), new Date(nowMs));

    const status = getContextStatusForSession("session-exact", { tempDir, homeDir, nowMs });

    assert.equal(status.status, "available");
    assert.equal(status.source, "exact");
    assert.equal(status.percentUsed, 50);
    assert.equal(status.percentRemaining, 50);
    assert.equal(status.tokensUsed, 100_000);
  } finally {
    cleanup(tempDir);
    cleanup(homeDir);
  }
});

test("reads current gsd-statusline bridge field names", () => {
  const tempDir = makeTempDir("context-status-temp-");
  const homeDir = makeTempDir("context-status-home-");
  try {
    const nowMs = Date.now();
    const bridgePath = path.join(tempDir, "claude-ctx-session-gsd.json");
    fs.writeFileSync(bridgePath, JSON.stringify({
      session_id: "session-gsd",
      remaining_percentage: 58,
      used_pct: 42,
      timestamp: Math.floor(nowMs / 1000),
    }));
    fs.utimesSync(bridgePath, new Date(nowMs), new Date(nowMs));

    const status = getContextStatusForSession("session-gsd", { tempDir, homeDir, nowMs });

    assert.equal(status.status, "available");
    assert.equal(status.source, "exact");
    assert.equal(status.percentUsed, 42);
    assert.equal(status.percentRemaining, 58);
  } finally {
    cleanup(tempDir);
    cleanup(homeDir);
  }
});

test("ignores a fresh context bridge owned by another local profile", () => {
  const tempDir = makeTempDir("context-status-temp-");
  const homeDir = makeTempDir("context-status-home-");
  try {
    const nowMs = Date.now();
    const bridgePath = path.join(tempDir, "claude-ctx-session-other.json");
    fs.writeFileSync(bridgePath, JSON.stringify({
      profileKey: "profile-a",
      tokensUsed: 100_000,
      totalTokens: 200_000,
    }));
    fs.utimesSync(bridgePath, new Date(nowMs), new Date(nowMs));

    const status = getContextStatusForSession("session-other", {
      tempDir,
      homeDir,
      nowMs,
      profileKey: "profile-b",
    });
    assert.deepEqual(status, { status: "unavailable", reason: "no_data" });
  } finally {
    cleanup(tempDir);
    cleanup(homeDir);
  }
});

test("falls back to transcript when bridge data is stale", () => {
  const tempDir = makeTempDir("context-status-temp-");
  const homeDir = makeTempDir("context-status-home-");
  try {
    const nowMs = Date.now();
    const bridgePath = path.join(tempDir, "claude-ctx-session-stale.json");
    fs.writeFileSync(bridgePath, JSON.stringify({
      tokensUsed: 10_000,
      totalTokens: 200_000,
    }));
    const oldDate = new Date(nowMs - 120_000);
    fs.utimesSync(bridgePath, oldDate, oldDate);

    writeTranscript(homeDir, "session-stale", [
      { type: "user", message: { role: "user", content: "hello" } },
      {
        type: "assistant",
        timestamp: "2026-05-17T11:00:00.000Z",
        message: {
          role: "assistant",
          usage: {
            input_tokens: 60_000,
            cache_creation_input_tokens: 20_000,
            cache_read_input_tokens: 10_000,
            output_tokens: 10_000,
            context_window: 200_000,
          },
        },
      },
    ]);

    const status = getContextStatusForSession("session-stale", { tempDir, homeDir, nowMs });

    assert.equal(status.status, "available");
    assert.equal(status.source, "estimated");
    assert.equal(status.percentUsed, 50);
    assert.equal(status.tokensUsed, 100_000);
  } finally {
    cleanup(tempDir);
    cleanup(homeDir);
  }
});

test("estimates from latest assistant usage with default context window", () => {
  const tempDir = makeTempDir("context-status-temp-");
  const homeDir = makeTempDir("context-status-home-");
  try {
    writeTranscript(homeDir, "session-transcript", [
      {
        type: "assistant",
        message: {
          role: "assistant",
          usage: {
            input_tokens: 10_000,
            output_tokens: 10_000,
          },
        },
      },
      {
        type: "assistant",
        timestamp: "2026-05-17T12:00:00.000Z",
        message: {
          role: "assistant",
          usage: {
            input_tokens: 20_000,
            cache_creation_input_tokens: 5_000,
            cache_read_input_tokens: 5_000,
            output_tokens: 10_000,
          },
        },
      },
    ]);

    const status = getContextStatusForSession("session-transcript", { tempDir, homeDir });

    assert.equal(status.status, "available");
    assert.equal(status.source, "estimated");
    assert.equal(status.tokensUsed, 40_000);
    assert.equal(status.totalTokens, 200_000);
    assert.equal(status.percentUsed, 20);
  } finally {
    cleanup(tempDir);
    cleanup(homeDir);
  }
});

test("returns unavailable without session or context data", () => {
  const tempDir = makeTempDir("context-status-temp-");
  const homeDir = makeTempDir("context-status-home-");
  try {
    assert.deepEqual(
      getContextStatusForSession(null, { tempDir, homeDir }),
      { status: "unavailable", reason: "no_session" },
    );
    assert.deepEqual(
      getContextStatusForSession("missing-session", { tempDir, homeDir }),
      { status: "unavailable", reason: "no_data" },
    );
  } finally {
    cleanup(tempDir);
    cleanup(homeDir);
  }
});

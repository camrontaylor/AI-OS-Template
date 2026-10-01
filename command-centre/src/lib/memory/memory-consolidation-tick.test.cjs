const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const tick = require(path.resolve(__dirname, "../../../scripts/memory-consolidation-tick.cjs"));

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aios-tick-"));
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Test\n");
  fs.mkdirSync(path.join(root, "command-centre", "scripts"), { recursive: true });
  fs.copyFileSync(
    path.resolve(__dirname, "../../../scripts/memory-consolidation-tick.cjs"),
    path.join(root, "command-centre", "scripts", "memory-consolidation-tick.cjs"),
  );
  return root;
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function withConfigDir(fn) {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-tick-config-"));
  const previous = process.env.AI_OS_TEAM_CONFIG_DIR;
  process.env.AI_OS_TEAM_CONFIG_DIR = configDir;
  fs.writeFileSync(
    path.join(configDir, "team-context.json"),
    JSON.stringify({
      version: 2,
      apiUrl: "http://team.test",
      token: "token",
      savedAt: new Date().toISOString(),
      expiresAt: "2099-01-01T00:00:00.000Z",
      team: { id: "team-1" },
      user: { id: "user-1" },
    }),
    "utf-8",
  );
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) delete process.env.AI_OS_TEAM_CONFIG_DIR;
      else process.env.AI_OS_TEAM_CONFIG_DIR = previous;
      rmDir(configDir);
    });
}

test("memory-consolidation-tick runs local consolidation and records the result", async () => {
  const root = tempRoot();
  try {
    await withConfigDir(async () => {
      const calls = [];
      const result = await tick.runTick({
        rootDir: root,
        flags: { client: "acme", limit: 7, quiet: true, force: true, reason: "test" },
        consolidateOnce: async (input) => {
          calls.push(input);
          return { claimed: 1, published: 0, review: 1, discarded: 0, batch: { id: "batch-1" } };
        },
      });

      assert.equal(result.status, "ran");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].flags.client, "acme");
      assert.equal(calls[0].limit, 7);

      const state = JSON.parse(fs.readFileSync(tick.statePath(root), "utf-8"));
      assert.equal(state.scopes["client:acme"].lastResult.review, 1);
    });
  } finally {
    rmDir(root);
  }
});

test("memory-consolidation-tick respects cooldown unless forced", async () => {
  const root = tempRoot();
  try {
    await withConfigDir(async () => {
      let calls = 0;
      const consolidateOnce = async () => {
        calls += 1;
        return { claimed: 0, published: 0, review: 0, discarded: 0, batch: null };
      };

      await tick.runTick({ rootDir: root, flags: { quiet: true, force: true }, consolidateOnce });
      const skipped = await tick.runTick({ rootDir: root, flags: { quiet: true }, consolidateOnce });

      assert.equal(skipped.status, "skipped");
      assert.equal(skipped.reason, "cooldown");
      assert.equal(calls, 1);
    });
  } finally {
    rmDir(root);
  }
});

test("memory-consolidation-tick skips cleanly without a saved Team OS login", async () => {
  const root = tempRoot();
  const previous = process.env.AI_OS_TEAM_CONFIG_DIR;
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-tick-empty-config-"));
  try {
    process.env.AI_OS_TEAM_CONFIG_DIR = configDir;
    const result = await tick.runTick({
      rootDir: root,
      flags: { quiet: true, force: true },
      consolidateOnce: async () => {
        throw new Error("should not run without login");
      },
    });
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "not_logged_in");
  } finally {
    if (previous === undefined) delete process.env.AI_OS_TEAM_CONFIG_DIR;
    else process.env.AI_OS_TEAM_CONFIG_DIR = previous;
    rmDir(configDir);
    rmDir(root);
  }
});

test("memory-consolidation-tick delayed retry scheduling extends later captures", () => {
  const state = { scopes: { team: { delayedRetryAt: "2026-07-02T10:20:00.000Z" } } };
  assert.equal(tick.shouldScheduleDelayedRetry(state, "team", Date.parse("2026-07-02T10:22:00.000Z")), false);
  assert.equal(tick.shouldScheduleDelayedRetry(state, "team", Date.parse("2026-07-02T10:30:30.000Z")), true);
});

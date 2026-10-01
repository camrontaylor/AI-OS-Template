const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");
const claudeOptions = loadTsModule(path.resolve(__dirname, "claude-options.ts"), {
  stubs: { "@/types/task": {} },
});
const autoMode = loadTsModule(path.resolve(__dirname, "claude-auto-mode.ts"), {
  stubs: {
    "@/lib/claude-options": claudeOptions,
    "@/types/task": {},
  },
});
const capabilities = loadTsModule(path.resolve(__dirname, "claude-capabilities.server.ts"), {
  stubs: {
    "@/lib/subprocess": {
      spawnManagedTaskProcess: () => { throw new Error("not used in pure tests"); },
      killChildProcessTree: () => {},
    },
    "@/lib/claude-auto-mode": autoMode,
    "@/types/task": {},
  },
});

test("Claude capability classification handles supported and old versions", () => {
  assert.equal(
    capabilities.classifyClaudeVersionProbe({ exitCode: 0, stdout: "2.1.82 (Claude Code)" }).autoMode.reason,
    "cli_too_old",
  );
  assert.equal(
    capabilities.classifyClaudeVersionProbe({ exitCode: 0, stdout: "2.1.83 (Claude Code)" }).autoMode.cliCompatibility,
    "compatible",
  );
  assert.equal(
    capabilities.classifyClaudeVersionProbe({ exitCode: 0, stdout: "2.1.100 (Claude Code)" }).autoMode.cliCompatibility,
    "compatible",
  );
  assert.equal(
    capabilities.classifyClaudeVersionProbe({ exitCode: 0, stdout: "2.2.0 (Claude Code)" }).autoMode.cliCompatibility,
    "compatible",
  );
});

test("Claude capability classification fails open only for unknown checks", () => {
  assert.equal(capabilities.classifyClaudeVersionProbe({ errorCode: "ENOENT" }).autoMode.reason, "cli_missing");
  assert.equal(
    capabilities.classifyClaudeVersionProbe({ exitCode: 1, stderr: "claude: command not found" }).autoMode.reason,
    "cli_missing",
  );
  assert.equal(capabilities.classifyClaudeVersionProbe({ timedOut: true }).autoMode.reason, "check_timeout");
  assert.equal(capabilities.classifyClaudeVersionProbe({ exitCode: 1, stderr: "gateway error" }).autoMode.reason, "check_failed");
  assert.equal(capabilities.classifyClaudeVersionProbe({ exitCode: 0, stdout: "future build" }).autoMode.reason, "version_unparseable");
});

test("Claude capability checks deduplicate and cache probes", async () => {
  capabilities.resetClaudeCapabilityCacheForTests();
  let calls = 0;
  let resolveProbe;
  const probe = () => {
    calls += 1;
    return new Promise((resolve) => { resolveProbe = resolve; });
  };

  const first = capabilities.getClaudeCapabilities({ force: true, probe });
  const second = capabilities.getClaudeCapabilities({ probe });
  assert.equal(calls, 1);
  resolveProbe(capabilities.buildClaudeCapabilityFromVersionOutput("2.1.205"));
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(firstResult, secondResult);

  await capabilities.getClaudeCapabilities({ probe });
  assert.equal(calls, 1);
  capabilities.resetClaudeCapabilityCacheForTests();
});

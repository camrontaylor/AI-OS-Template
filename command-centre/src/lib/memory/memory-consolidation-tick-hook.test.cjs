const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const hook = require(path.resolve(__dirname, "../../../../.claude/hooks/memory-consolidation-tick.js"));

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-tick-hook-"));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function write(root, rel, content = "") {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

test("memory consolidation tick hook scopes client workspaces", () => {
  const root = tempDir();
  try {
    write(root, path.join("command-centre", "scripts", "memory-consolidation-tick.cjs"), "#!/usr/bin/env node\n");
    fs.mkdirSync(path.join(root, "clients", "acme", ".claude"), { recursive: true });
    const cwd = path.join(root, "clients", "acme");
    const config = hook.buildTickSpawn(JSON.stringify({ cwd }));

    assert.ok(config);
    assert.equal(config.cwd, root);
    assert.deepEqual(config.args, [
      path.join(root, "command-centre", "scripts", "memory-consolidation-tick.cjs"),
      "--quiet",
      "--reason",
      "session-start",
      "--client",
      "acme",
    ]);
  } finally {
    rmDir(root);
  }
});

test("memory consolidation tick hook leaves root sessions team-scoped", () => {
  const root = tempDir();
  try {
    write(root, path.join("command-centre", "scripts", "memory-consolidation-tick.cjs"), "#!/usr/bin/env node\n");
    const config = hook.buildTickSpawn(JSON.stringify({ cwd: root }));

    assert.ok(config);
    assert.deepEqual(config.args, [
      path.join(root, "command-centre", "scripts", "memory-consolidation-tick.cjs"),
      "--quiet",
      "--reason",
      "session-start",
    ]);
  } finally {
    rmDir(root);
  }
});

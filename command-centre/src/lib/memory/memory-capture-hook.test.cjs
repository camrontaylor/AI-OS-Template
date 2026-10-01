const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const hook = require(path.resolve(__dirname, "../../../../.claude/hooks/memory-capture.js"));

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-hook-"));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function mkdir(root, rel) {
  fs.mkdirSync(path.join(root, rel), { recursive: true });
}

function write(root, rel, content = "") {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

function makeRoot() {
  const root = tempDir();
  write(root, path.join("command-centre", "scripts", "memory-capture.cjs"), "#!/usr/bin/env node\n");
  return root;
}

test("memory capture hook finds command-centre root past a client workspace", () => {
  const root = makeRoot();
  try {
    mkdir(root, path.join("clients", "acme", ".claude"));
    write(root, path.join("clients", "acme", "AGENTS.md"), "# Client\n");
    const cwd = path.join(root, "clients", "acme", "projects", "briefs");
    mkdir(root, path.relative(root, cwd));

    assert.equal(hook.findCommandCentreRoot(cwd), root);
  } finally {
    rmDir(root);
  }
});

test("memory capture hook scopes real client workspaces to client memory", () => {
  const root = makeRoot();
  try {
    mkdir(root, path.join("clients", "acme", ".claude"));
    const cwd = path.join(root, "clients", "acme", "projects");
    mkdir(root, path.relative(root, cwd));

    assert.deepEqual(hook.clientScopeArgs(root, cwd), [
      "--workspace",
      path.join(root, "clients", "acme"),
      "--visibility",
      "client",
      "--client",
      "acme",
    ]);
  } finally {
    rmDir(root);
  }
});

test("memory capture hook leaves non-client folders unscoped", () => {
  const root = makeRoot();
  try {
    const cwd = path.join(root, "clients", "made-up", "projects");
    mkdir(root, path.relative(root, cwd));

    assert.deepEqual(hook.clientScopeArgs(root, cwd), []);
  } finally {
    rmDir(root);
  }
});

test("memory capture hook spawn config passes client workspace arguments", () => {
  const root = makeRoot();
  try {
    mkdir(root, path.join("clients", "acme", ".claude"));
    const cwd = path.join(root, "clients", "acme");
    const transcript = path.join(root, "transcript.jsonl");
    const config = hook.buildCaptureSpawn(JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd,
    }));

    assert.ok(config);
    assert.equal(config.cwd, root);
    assert.deepEqual(config.args.slice(0, 8), [
      path.join(root, "command-centre", "scripts", "memory-capture.cjs"),
      "--session",
      "--workspace",
      path.join(root, "clients", "acme"),
      "--visibility",
      "client",
      "--client",
      "acme",
    ]);
  } finally {
    rmDir(root);
  }
});

test("memory capture hook skips when cron opts out of capture", () => {
  const root = makeRoot();
  const previous = process.env.AI_OS_SKIP_MEMORY_CAPTURE;
  try {
    process.env.AI_OS_SKIP_MEMORY_CAPTURE = "1";
    const transcript = path.join(root, "transcript.jsonl");
    const config = hook.buildCaptureSpawn(JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: root,
    }));

    assert.equal(config, null);
  } finally {
    if (previous === undefined) {
      delete process.env.AI_OS_SKIP_MEMORY_CAPTURE;
    } else {
      process.env.AI_OS_SKIP_MEMORY_CAPTURE = previous;
    }
    rmDir(root);
  }
});

test("memory capture hook does not pass the parent task id to the capture process", () => {
  const root = makeRoot();
  const previous = process.env.AI_OS_TASK_ID;
  try {
    process.env.AI_OS_TASK_ID = "cron-task-running-this-hook";
    const transcript = write(root, "transcript.jsonl", "{}\n");
    const config = hook.buildCaptureSpawn(JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: root,
    }));

    assert.ok(config);
    assert.ok(config.env, "capture spawn should carry an explicit env");
    assert.equal(config.env.AI_OS_TASK_ID, undefined);
    assert.equal(config.env.PATH ?? config.env.Path, process.env.PATH ?? process.env.Path);
  } finally {
    if (previous === undefined) delete process.env.AI_OS_TASK_ID;
    else process.env.AI_OS_TASK_ID = previous;
    rmDir(root);
  }
});

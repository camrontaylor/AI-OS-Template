const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const HOOK = path.resolve(__dirname, "..", "..", "..", ".claude", "hooks", "session-sync.js");

// Starts a fake Command Centre, runs the SessionStart hook against it and
// returns the sync-session payloads it received within `waitMs`.
async function runHook(extraEnv, waitMs = 4000) {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push({ url: req.url, body: JSON.parse(body || "{}") });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ taskId: "t1", isNew: true, syncMode: "managed" }));
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "session-sync-hook-"));

  const env = { ...process.env, COMMAND_CENTRE_PORT: String(port), ...extraEnv };
  delete env.AI_OS_TASK_ID;
  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === undefined) delete env[key];
  }

  const child = spawn(process.execPath, [HOOK], { cwd, env, stdio: ["pipe", "ignore", "ignore"] });
  child.stdin.end(JSON.stringify({ session_id: "s-hook-test", cwd, hook_event_name: "SessionStart" }));
  const exitCode = await new Promise((resolve) => child.on("exit", resolve));

  const deadline = Date.now() + waitMs;
  while (received.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await new Promise((resolve) => server.close(resolve));
  return { exitCode, received };
}

test("session-sync registers a normal Claude session with the Command Centre", async () => {
  const { exitCode, received } = await runHook({ AI_OS_MEMORY_CAPTURE: undefined });
  assert.equal(exitCode, 0);
  assert.equal(received.length, 1);
  assert.equal(received[0].url, "/api/tasks/sync-session");
  assert.equal(received[0].body.sessionId, "s-hook-test");
});

test("session-sync ignores the memory-capture summary Claude so it adds no board task", async () => {
  const { exitCode, received } = await runHook({ AI_OS_MEMORY_CAPTURE: "1" }, 2500);
  assert.equal(exitCode, 0);
  assert.equal(received.length, 0);
});

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { setTimeout: delay } = require("node:timers/promises");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");
const subprocess = loadTsModule(path.resolve(__dirname, "subprocess.ts"));

test("Windows cancellation uses taskkill for the entire tree and forces termination", () => {
  assert.deepEqual(subprocess.getWindowsTaskkillArgs(4321), ["/PID", "4321", "/T", "/F"]);
});

test("Windows cancellation terminates a cmd wrapper and its child process", {
  skip: process.platform !== "win32",
  timeout: 15_000,
}, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-stop-tree-"));
  const childScript = path.join(tempDir, "child.cjs");
  const pidFile = path.join(tempDir, "child.pid");
  fs.writeFileSync(
    childScript,
    "require('node:fs').writeFileSync(process.argv[2], String(process.pid)); setInterval(() => {}, 1000);\n",
    "utf-8",
  );

  const command = `node "${childScript}" "${pidFile}"`;
  const wrapper = spawn(
    process.env.ComSpec || "cmd.exe",
    ["/d", "/s", "/c", command],
    {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
    windowsVerbatimArguments: true,
    },
  );
  let stderr = "";
  wrapper.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  try {
    for (let attempt = 0; attempt < 100 && !fs.existsSync(pidFile); attempt += 1) {
      await delay(25);
    }
    assert.equal(fs.existsSync(pidFile), true, `child process did not start: ${stderr}`);
    const childPid = Number(fs.readFileSync(pidFile, "utf-8"));
    assert.equal(subprocess.isProcessAlive(wrapper.pid), true);
    assert.equal(subprocess.isProcessAlive(childPid), true);

    const result = await subprocess.terminateProcessTreeByPid(wrapper.pid);
    assert.equal(result.stopped, true);
    assert.equal(subprocess.isProcessAlive(wrapper.pid), false);
    assert.equal(subprocess.isProcessAlive(childPid), false);
  } finally {
    if (wrapper.pid && subprocess.isProcessAlive(wrapper.pid)) {
      await subprocess.terminateProcessTreeByPid(wrapper.pid).catch(() => {});
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

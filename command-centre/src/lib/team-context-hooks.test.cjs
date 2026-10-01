const assert = require("node:assert/strict");
const { execFile, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const TEAM_HOOK = path.join(REPO_ROOT, ".claude", "hooks", "team-context-snapshot.js");
const MEMORY_HOOK = path.join(REPO_ROOT, ".claude", "hooks", "load-memory-snapshot.js");
const FIRST_RUN_HOOK = path.join(REPO_ROOT, ".claude", "hooks", "detect-first-run.js");
const SNAPSHOT_SCRIPT = path.join(REPO_ROOT, "command-centre", "scripts", "context-snapshot.cjs");

function tempWorkspace(prefix = "aios-team-hook-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Agents\n", "utf-8");
  fs.writeFileSync(path.join(root, "CLAUDE.md"), "# Claude\n", "utf-8");
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  return root;
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function runHook(script, cwd, env = {}, input = {}) {
  return spawnSync(process.execPath, [script], {
    input: JSON.stringify({ cwd, session_id: "session-1", ...input }),
    encoding: "utf8",
    env: { ...process.env, ...env },
    windowsHide: true,
    timeout: 15000,
  });
}

function writeTeamConfig(configDir, apiUrl = "https://team.example.test", selectedTeamId = "team-a") {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "team-context.json"),
    JSON.stringify({
      version: 3,
      apiUrl,
      token: "test-token",
      serverId: "server-1",
      user: { id: "user-1" },
      selectedTeamId,
      team: { id: selectedTeamId },
    }),
    "utf-8",
  );
}

test("team-context SessionStart hook injects additionalContext from the snapshot script", () => {
  const root = tempWorkspace();
  try {
    const scriptPath = path.join(root, "command-centre", "scripts", "context-snapshot.cjs");
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(
      scriptPath,
      "process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '# Team Snapshot\\n' } }));\n",
      "utf-8",
    );

    const result = runHook(TEAM_HOOK, root);
    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.hookSpecificOutput.hookEventName, "SessionStart");
    assert.equal(body.hookSpecificOutput.additionalContext, "# Team Snapshot\n");
  } finally {
    rmDir(root);
  }
});

test("team-context hook skips every snapshot request in conversation-only mode", () => {
  const root = tempWorkspace();
  try {
    const scriptPath = path.join(root, "command-centre", "scripts", "context-snapshot.cjs");
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(scriptPath, "process.stdout.write('SHOULD_NOT_RUN');\n", "utf-8");

    const result = runHook(TEAM_HOOK, root, { AI_OS_TEAM_ENRICHMENT: "conversation_only" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
  } finally {
    rmDir(root);
  }
});

test("team-context hook skips duplicate injection for a managed runtime overlay", () => {
  const root = tempWorkspace();
  try {
    const scriptPath = path.join(root, "command-centre", "scripts", "context-snapshot.cjs");
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(scriptPath, "process.stdout.write('SHOULD_NOT_RUN');\n", "utf-8");

    const result = runHook(TEAM_HOOK, root, {
      AI_OS_CONTEXT_OVERLAY_DIR: path.join(root, ".command-centre", "profiles", "profile-a", "tmp", "runtime"),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
  } finally {
    rmDir(root);
  }
});

test("load-memory-snapshot ignores the obsolete global Team snapshot as a mode signal", () => {
  const root = tempWorkspace();
  try {
    fs.mkdirSync(path.join(root, "context"), { recursive: true });
    fs.writeFileSync(path.join(root, "context", "SOUL.md"), "Agent identity.", "utf-8");
    fs.writeFileSync(path.join(root, "context", "USER.md"), "Private user preference.", "utf-8");
    fs.writeFileSync(path.join(root, "context", "MEMORY.md"), "Private memory note.", "utf-8");
    fs.mkdirSync(path.join(root, ".AI-OS", "context-snapshot"), { recursive: true });
    fs.writeFileSync(path.join(root, ".AI-OS", "context-snapshot", "current.md"), "# Snapshot\n", "utf-8");

    const result = runHook(MEMORY_HOOK, root, {
      AI_OS_TEAM_CONFIG_DIR: path.join(root, "empty-team-config"),
      AI_OS_WORK_MODE: "solo",
      AI_OS_CONTEXT_OVERLAY_DIR: "",
      AI_OS_TEAM_ENRICHMENT: "",
    });
    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    const context = body.hookSpecificOutput.additionalContext;
    assert.match(context, /Agent identity/);
    assert.match(context, /Private user preference/);
    assert.match(context, /Private memory note/);
  } finally {
    rmDir(root);
  }
});

test("load-memory-snapshot skips local private context when Team OS is signed in without a snapshot", () => {
  const root = tempWorkspace();
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-team-config-"));
  try {
    writeTeamConfig(configDir);
    fs.mkdirSync(path.join(root, "context"), { recursive: true });
    fs.writeFileSync(path.join(root, "context", "SOUL.md"), "Agent identity.", "utf-8");
    fs.writeFileSync(path.join(root, "context", "USER.md"), "Stale private preference.", "utf-8");
    fs.writeFileSync(path.join(root, "context", "MEMORY.md"), "Stale private memory.", "utf-8");

    const result = runHook(MEMORY_HOOK, root, { AI_OS_TEAM_CONFIG_DIR: configDir });
    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    const context = body.hookSpecificOutput.additionalContext;
    assert.match(context, /Agent identity/);
    assert.doesNotMatch(context, /Stale private preference/);
    assert.doesNotMatch(context, /Stale private memory/);
  } finally {
    rmDir(root);
    rmDir(configDir);
  }
});

test("load-memory-snapshot explains conversation-only mode without loading private memory", () => {
  const root = tempWorkspace();
  try {
    fs.mkdirSync(path.join(root, "context"), { recursive: true });
    fs.writeFileSync(path.join(root, "context", "SOUL.md"), "Agent identity.", "utf-8");
    fs.writeFileSync(path.join(root, "context", "USER.md"), "Private user preference.", "utf-8");
    fs.writeFileSync(path.join(root, "context", "MEMORY.md"), "Private memory note.", "utf-8");

    const result = runHook(MEMORY_HOOK, root, { AI_OS_TEAM_ENRICHMENT: "conversation_only" });
    assert.equal(result.status, 0, result.stderr);
    const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    assert.match(context, /conversation-only mode/i);
    assert.match(context, /Agent identity/);
    assert.doesNotMatch(context, /Private user preference/);
    assert.doesNotMatch(context, /Private memory note/);
  } finally {
    rmDir(root);
  }
});

test("first-run detection does not inspect materialized brand context in Team mode", () => {
  const root = tempWorkspace();
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-team-config-"));
  try {
    writeTeamConfig(configDir);
    const result = runHook(FIRST_RUN_HOOK, root, { AI_OS_TEAM_CONFIG_DIR: configDir });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
  } finally {
    rmDir(root);
    rmDir(configDir);
  }
});

test("context-snapshot removes stale cache when the Team OS server is unavailable", async () => {
  const root = tempWorkspace();
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-team-config-"));
  const cacheDir = path.join(root, ".AI-OS", "context-snapshot");
  let server;
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, "current.md"), "stale snapshot", "utf-8");
    fs.writeFileSync(path.join(cacheDir, "current.json"), "{\"stale\":true}\n", "utf-8");

    server = http.createServer((_req, res) => {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "offline" } }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    writeTeamConfig(configDir, `http://127.0.0.1:${address.port}`);

    const result = await execFileAsync(
      process.execPath,
      [SNAPSHOT_SCRIPT, "--cwd", root, "--session-id", "session-offline", "--format", "hook"],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, AI_OS_TEAM_CONFIG_DIR: configDir },
        windowsHide: true,
        timeout: 20000,
      },
    );
    assert.equal(result.stdout, "");
    assert.equal(fs.existsSync(path.join(cacheDir, "current.md")), false);
    assert.equal(fs.existsSync(path.join(cacheDir, "current.json")), false);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    rmDir(root);
    rmDir(configDir);
  }
});

test("direct Claude sessions keep separate immutable Team overlays", async () => {
  const root = tempWorkspace("aios-direct-overlay-");
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-team-config-"));
  let server;
  let snapshotRequests = 0;
  try {
    server = http.createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/auth/teams") {
        res.end(JSON.stringify({ teams: [{ id: "team-a" }, { id: "team-b" }] }));
        return;
      }
      if (req.url.startsWith("/v1/context/snapshot")) {
        snapshotRequests += 1;
        const teamId = req.headers["x-ai-team-id"];
        res.end(JSON.stringify({ snapshot: { markdown: `# Snapshot ${teamId}\n` } }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: "not found" } }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const apiUrl = `http://127.0.0.1:${server.address().port}`;
    const runSnapshot = async (sessionId, envOverrides = {}) => {
      const result = await execFileAsync(
        process.execPath,
        [SNAPSHOT_SCRIPT, "--cwd", root, "--session-id", sessionId, "--format", "hook"],
        {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            AI_OS_TEAM_CONFIG_DIR: configDir,
            AI_OS_WORK_MODE: "",
            AI_OS_PROFILE_KEY: "",
            AI_OS_SERVER_ID: "",
            AI_OS_USER_ID: "",
            AI_OS_TEAM_ID: "",
            AI_OS_CLIENT_ID: "",
            ...envOverrides,
          },
          windowsHide: true,
          timeout: 20000,
        },
      );
      return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    };

    writeTeamConfig(configDir, apiUrl, "team-a");
    assert.equal(await runSnapshot("direct-session-1"), "# Snapshot team-a\n");

    writeTeamConfig(configDir, apiUrl, "team-b");
    assert.equal(await runSnapshot("direct-session-1"), "# Snapshot team-a\n");
    assert.equal(await runSnapshot("direct-session-2"), "# Snapshot team-b\n");
    assert.equal(await runSnapshot("pinned-session-3", {
      AI_OS_WORK_MODE: "team",
      AI_OS_PROFILE_KEY: crypto.createHash("sha256")
        .update("team-os-profile:v1\nserver-1\nuser-1", "utf8")
        .digest("hex"),
      AI_OS_SERVER_ID: "server-1",
      AI_OS_USER_ID: "user-1",
      AI_OS_TEAM_ID: "team-a",
      AI_OS_CLIENT_ID: "",
    }), "# Snapshot team-a\n");
    assert.equal(snapshotRequests, 3);

    const profileRoot = path.join(root, ".command-centre", "profiles");
    const metadataFiles = [];
    for (const profile of fs.readdirSync(profileRoot)) {
      const overlaysRoot = path.join(profileRoot, profile, "tmp", "runtime", "context-overlays");
      for (const overlayDir of fs.readdirSync(overlaysRoot)) {
        metadataFiles.push(path.join(overlaysRoot, overlayDir, "metadata-v1.json"));
      }
    }
    assert.equal(metadataFiles.length, 3);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    rmDir(root);
    rmDir(configDir);
  }
});

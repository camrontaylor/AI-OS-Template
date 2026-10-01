"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

test("local terminal keeps its original profile, scope, directory, and environment", () => {
  let spawnOptions;
  const process = new EventEmitter();
  process.stdout = new EventEmitter();
  process.stderr = new EventEmitter();
  process.stdin = { writable: true, write() {} };
  process.kill = () => true;

  const profile = {
    version: 1,
    mode: "team",
    profileKey: "profile-a",
    identity: { version: 1, serverId: "server-1", userId: "user-1" },
  };
  const scope = {
    mode: "team",
    scope: { version: 1, serverId: "server-1", userId: "user-1", teamId: "team-a", clientId: "acme" },
  };

  const terminal = loadTsModule(path.resolve(__dirname, "terminal-sessions.ts"), {
    stubs: {
      child_process: {
        spawn(_command, _args, options) {
          spawnOptions = options;
          return process;
        },
        spawnSync() {
          return { error: undefined, status: 1 };
        },
      },
      "./config": { getConfig: () => ({ aiOsDir: "C:/workspace" }) },
      "./db": { getActiveLocalProfileDescriptor: () => profile },
      "./local-profile": {},
      "./identity/session-scope": {},
      "./identity/work-scope": {
        buildWorkScopeEnvironment: () => ({ AI_OS_TEAM_ID: "team-a", AI_OS_CLIENT_ID: "acme" }),
        createSoloStoredWorkScope: () => ({ mode: "solo", version: 1, clientId: null }),
        readWorkScopeFromRow() {},
      },
      "./subprocess": { killChildProcessTree: (child, signal) => child.kill(signal) },
    },
  });

  const session = terminal.createSession("terminal-1", { cwd: "C:/workspace/clients/acme", profile, workScope: scope });
  assert.equal(session.profileKey, "profile-a");
  assert.equal(session.cwd, "C:/workspace/clients/acme");
  assert.equal(session.workScope.scope.teamId, "team-a");
  assert.equal(spawnOptions.cwd, "C:/workspace/clients/acme");
  assert.equal(spawnOptions.env.AI_OS_TEAM_ID, "team-a");
  assert.equal(spawnOptions.env.AI_OS_CLIENT_ID, "acme");
  assert.equal(terminal.getSession("terminal-1"), session);
  terminal.destroySession("terminal-1");
});

const modulePath = path.resolve(__dirname, "terminal-sessions.ts");

function loadTerminalSessions({ pwshAvailable = true, workspaceRoot = path.resolve(__dirname, "..") } = {}) {
  const spawnCalls = [];
  const whereCalls = [];

  const fakeProcess = new EventEmitter();
  fakeProcess.stdout = new EventEmitter();
  fakeProcess.stderr = new EventEmitter();
  fakeProcess.stdin = {
    writable: true,
    write: () => true,
  };
  fakeProcess.kill = () => true;

  const terminalSessions = loadTsModule(modulePath, {
    stubs: {
      child_process: {
        spawn(command, args, options) {
          spawnCalls.push({ command, args, options });
          return fakeProcess;
        },
        spawnSync(command, args, options) {
          whereCalls.push({ command, args, options });
          return { error: undefined, status: pwshAvailable ? 0 : 1 };
        },
      },
      "./config": {
        getConfig: () => ({ aiOsDir: workspaceRoot }),
        getClientAiOsDir: (slug) => path.join(workspaceRoot, "clients", slug),
      },
      "./db": {
        getActiveLocalProfileDescriptor: () => ({
          version: 1,
          mode: "solo",
          profileKey: "solo",
          dataDir: workspaceRoot,
          stateDir: workspaceRoot,
          tempDir: workspaceRoot,
          dbPath: "",
        }),
      },
      "./identity/work-scope": {
        buildWorkScopeEnvironment: () => ({}),
        createSoloStoredWorkScope: () => ({ mode: "solo", version: 1, clientId: null }),
        readWorkScopeFromRow() {},
      },
      "./subprocess": { killChildProcessTree: (child, signal) => child.kill(signal) },
    },
  });

  return { terminalSessions, spawnCalls, whereCalls };
}

test("resolveTaskTerminalCwd uses the root Goal client and only accepts real worktree directories", (t) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aios-terminal-root-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "aios-terminal-outside-"));
  const worktreesRoot = path.join(workspaceRoot, ".worktrees");
  const safeWorktree = path.join(worktreesRoot, "task-safe");
  const escapedWorktree = path.join(worktreesRoot, "task-escaped");
  const otherClient = path.join(workspaceRoot, "clients", "other");
  fs.mkdirSync(safeWorktree, { recursive: true });
  fs.mkdirSync(otherClient, { recursive: true });
  fs.symlinkSync(outside, escapedWorktree, process.platform === "win32" ? "junction" : "dir");
  t.after(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  const { terminalSessions } = loadTerminalSessions({ workspaceRoot });

  assert.equal(
    terminalSessions.resolveTaskTerminalCwd({ clientId: null, worktreePath: null }),
    workspaceRoot,
  );
  assert.equal(
    terminalSessions.resolveTaskTerminalCwd({ clientId: "acme", worktreePath: null }),
    path.join(workspaceRoot, "clients", "acme"),
  );
  assert.equal(
    terminalSessions.resolveTaskTerminalCwd({ clientId: "acme", worktreePath: safeWorktree }),
    safeWorktree,
  );
  assert.equal(
    terminalSessions.resolveTaskTerminalCwd({ clientId: null, worktreePath: path.resolve(workspaceRoot, "..") }),
    workspaceRoot,
  );
  assert.equal(
    terminalSessions.resolveTaskTerminalCwd({ clientId: "acme", worktreePath: otherClient }),
    path.join(workspaceRoot, "clients", "acme"),
  );
  assert.equal(
    terminalSessions.resolveTaskTerminalCwd({ clientId: "acme", worktreePath: escapedWorktree }),
    path.join(workspaceRoot, "clients", "acme"),
  );
});

test("resolveTaskTerminalCwd rejects a .worktrees junction outside the workspace", (t) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aios-terminal-junction-root-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "aios-terminal-junction-outside-"));
  const outsideTask = path.join(outside, "task-outside");
  fs.mkdirSync(outsideTask, { recursive: true });
  fs.symlinkSync(outside, path.join(workspaceRoot, ".worktrees"), process.platform === "win32" ? "junction" : "dir");
  t.after(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  const { terminalSessions } = loadTerminalSessions({ workspaceRoot });
  assert.equal(
    terminalSessions.resolveTaskTerminalCwd({
      clientId: null,
      worktreePath: path.join(workspaceRoot, ".worktrees", "task-outside"),
    }),
    workspaceRoot,
  );
});

test("resolveTerminalShell prefers PowerShell 7 on Windows", () => {
  const { terminalSessions } = loadTerminalSessions();

  const shell = terminalSessions.resolveTerminalShell("win32", () => true);

  assert.deepEqual(shell, {
    command: "pwsh.exe",
    args: ["-NoLogo", "-NoExit", "-Command", "-"],
    windowsHide: true,
  });
});

test("resolveTerminalShell falls back to Windows PowerShell", () => {
  const { terminalSessions } = loadTerminalSessions();

  const shell = terminalSessions.resolveTerminalShell("win32", () => false);

  assert.deepEqual(shell, {
    command: "powershell.exe",
    args: ["-NoLogo", "-NoExit", "-Command", "-"],
    windowsHide: true,
  });
});

test("resolveTerminalShell keeps bash on macOS and Linux", () => {
  const { terminalSessions } = loadTerminalSessions();
  const unexpectedLookup = () => {
    throw new Error("Non-Windows platforms must not look up PowerShell");
  };

  for (const platform of ["darwin", "linux"]) {
    assert.deepEqual(
      terminalSessions.resolveTerminalShell(platform, unexpectedLookup),
      {
        command: "bash",
        args: ["-l"],
        windowsHide: false,
      },
    );
  }
});

test("createSession launches the selected platform shell with the requested cwd", () => {
  const { terminalSessions, spawnCalls, whereCalls } = loadTerminalSessions({
    pwshAvailable: true,
  });

  terminalSessions.createSession("terminal-1", "C:\\project");

  assert.equal(spawnCalls.length, 1);
  const [call] = spawnCalls;
  assert.equal(call.options.cwd, "C:\\project");
  assert.equal(call.options.env.TERM, "dumb");
  assert.deepEqual(call.options.stdio, ["pipe", "pipe", "pipe"]);

  if (process.platform === "win32") {
    assert.equal(whereCalls.length, 1);
    assert.deepEqual(whereCalls[0].args, ["pwsh.exe"]);
    assert.equal(call.command, "pwsh.exe");
    assert.deepEqual(call.args, ["-NoLogo", "-NoExit", "-Command", "-"]);
    assert.equal(call.options.windowsHide, true);
  } else {
    assert.equal(whereCalls.length, 0);
    assert.equal(call.command, "bash");
    assert.deepEqual(call.args, ["-l"]);
    assert.equal(call.options.windowsHide, false);
  }
});

test("the task pane hides the terminal action while preserving session cleanup", () => {
  const chatListSource = fs.readFileSync(
    path.resolve(__dirname, "../components/modal/chat-list.tsx"),
    "utf8",
  );

  assert.doesNotMatch(chatListSource, /onOpenTerminal/);
  assert.doesNotMatch(chatListSource, /aria-label="New terminal"/);

  const terminalPaneSource = fs.readFileSync(
    path.resolve(__dirname, "../components/modal/terminal-pane.tsx"),
    "utf8",
  );
  assert.match(terminalPaneSource, /action: "destroy", sessionId[\s\S]*keepalive: true/);
});

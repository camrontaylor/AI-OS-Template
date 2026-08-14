const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const test = require("node:test");
const ts = require("typescript");

const processManagerSourcePath = path.resolve(__dirname, "process-manager.ts");

function makeTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "command-centre-process-manager-"));
}

function cleanupTempWorkspace(workspaceDir) {
  fs.rmSync(workspaceDir, { recursive: true, force: true });
}

function createFakeDb(task) {
  const state = {
    task: { ...task },
    logsDeleted: 0,
    outputsDeleted: 0,
  };

  function cloneTask() {
    return { ...state.task };
  }

  return {
    state,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim();

      return {
        get(...args) {
          if (normalized.includes("SELECT * FROM tasks WHERE id = ?")) {
            return args[0] === state.task.id ? cloneTask() : undefined;
          }

          if (normalized.includes("SELECT conversationId, title FROM tasks WHERE id = ?")) {
            return args[0] === state.task.id
              ? {
                  conversationId: state.task.conversationId ?? null,
                  title: state.task.title,
                }
              : undefined;
          }

          if (normalized.includes("SELECT permissionMode, model, thinkingEffort, cronJobSlug, projectSlug FROM tasks WHERE id = ?")) {
            return args[0] === state.task.id
              ? {
                  permissionMode: state.task.permissionMode ?? null,
                  model: state.task.model ?? null,
                  thinkingEffort: state.task.thinkingEffort ?? null,
                  cronJobSlug: state.task.cronJobSlug ?? null,
                  projectSlug: state.task.projectSlug ?? null,
                }
              : undefined;
          }

          if (normalized.includes("SELECT permissionMode, executionPermissionMode FROM tasks WHERE id = ?")) {
            return args[0] === state.task.id
              ? {
                  permissionMode: state.task.permissionMode ?? null,
                  executionPermissionMode: state.task.executionPermissionMode ?? null,
                }
              : undefined;
          }

          if (normalized.includes("SELECT COUNT(*) as count FROM tasks WHERE parentId = ?")) {
            return { count: 0 };
          }

          if (normalized.includes("SELECT gsdStep, phaseNumber FROM tasks WHERE id = ?")) {
            return args[0] === state.task.id
              ? { gsdStep: state.task.gsdStep ?? null, phaseNumber: state.task.phaseNumber ?? null }
              : undefined;
          }

          if (normalized.includes("SELECT id, level, claudeSessionId FROM tasks WHERE id = ?")) {
            return undefined;
          }

          throw new Error(`Unhandled get SQL: ${normalized}`);
        },
        run(...args) {
          if (normalized.includes("WHERE id = ? AND status = 'queued'")) {
            const [status, startedAt, updatedAt, activityLabel, taskId] = args;
            if (taskId !== state.task.id || state.task.status !== "queued") {
              return { changes: 0 };
            }

            state.task.status = status;
            state.task.startedAt = state.task.startedAt ?? startedAt;
            state.task.updatedAt = updatedAt;
            state.task.activityLabel = activityLabel;
            state.task.errorMessage = null;
            state.task.needsInput = 0;
            return { changes: 1 };
          }

          if (normalized.startsWith("DELETE FROM task_logs")) {
            state.logsDeleted += 1;
            return { changes: 1 };
          }

          if (normalized.startsWith("DELETE FROM task_outputs")) {
            state.outputsDeleted += 1;
            return { changes: 1 };
          }

          if (normalized.includes("UPDATE tasks SET contextSources = ? WHERE id = ?")) {
            const [contextSources, taskId] = args;
            if (taskId === state.task.id) {
              state.task.contextSources = contextSources;
            }
            return { changes: 1 };
          }

          if (normalized.includes("UPDATE tasks SET startSnapshot = ? WHERE id = ?")) {
            const [snapshot, taskId] = args;
            if (taskId === state.task.id) {
              state.task.startSnapshot = snapshot;
            }
            return { changes: 1 };
          }

          if (normalized.includes("UPDATE tasks SET claudeSessionId = ? WHERE id = ?")) {
            const [claudeSessionId, taskId] = args;
            if (taskId === state.task.id) {
              state.task.claudeSessionId = claudeSessionId;
            }
            return { changes: 1 };
          }

          if (normalized.includes("UPDATE tasks SET permissionMode = ?, executionPermissionMode = ? WHERE id = ?")) {
            const [permissionMode, executionPermissionMode, taskId] = args;
            if (taskId === state.task.id) {
              state.task.permissionMode = permissionMode;
              state.task.executionPermissionMode = executionPermissionMode;
            }
            return { changes: 1 };
          }

          throw new Error(`Unhandled run SQL: ${normalized}`);
        },
        all() {
          if (normalized.includes("SELECT * FROM tasks WHERE parentId = ? AND status = 'backlog'")) {
            return [];
          }

          throw new Error(`Unhandled all SQL: ${normalized}`);
        },
      };
    },
  };
}

function createCronQuestionDb(task, runningRowSequence = [true]) {
  const state = {
    task: { ...task },
    runningRowSequence: [...runningRowSequence],
  };

  function cloneTask() {
    return { ...state.task };
  }

  return {
    state,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim();

      return {
        get(...args) {
          if (normalized.includes("SELECT cronJobSlug FROM tasks WHERE id = ?")) {
            return args[0] === state.task.id
              ? { cronJobSlug: state.task.cronJobSlug }
              : undefined;
          }

          if (normalized.includes("SELECT status FROM tasks WHERE id = ?")) {
            return args[0] === state.task.id ? { status: state.task.status } : undefined;
          }

          if (normalized.includes("SELECT level, parentId, completedAt FROM tasks WHERE id = ?")) {
            return args[0] === state.task.id
              ? {
                  level: state.task.level,
                  parentId: state.task.parentId,
                  completedAt: state.task.completedAt ?? null,
                }
              : undefined;
          }

          if (normalized.includes("SELECT * FROM tasks WHERE id = ?")) {
            return args[0] === state.task.id ? cloneTask() : undefined;
          }

          if (normalized.includes("SELECT permissionMode, executionPermissionMode FROM tasks WHERE id = ?")) {
            return args[0] === state.task.id
              ? {
                  permissionMode: state.task.permissionMode ?? null,
                  executionPermissionMode: state.task.executionPermissionMode ?? null,
                }
              : undefined;
          }

          if (normalized.includes("SELECT conversationId, title FROM tasks WHERE id = ?")) {
            return args[0] === state.task.id
              ? {
                  conversationId: state.task.conversationId ?? null,
                  title: state.task.title,
                }
              : undefined;
          }

          if (normalized.includes("SELECT id, startedAt, trigger, scheduledFor FROM cron_runs WHERE taskId = ? AND result = 'running' LIMIT 1")) {
            const next = state.runningRowSequence.length > 0
              ? state.runningRowSequence.shift()
              : false;
            return next
              ? {
                  id: 1,
                  startedAt: state.task.startedAt ?? state.task.createdAt,
                  trigger: "scheduled",
                  scheduledFor: state.task.startedAt ?? state.task.createdAt,
                }
              : undefined;
          }

          throw new Error(`Unhandled get SQL: ${normalized}`);
        },
        run(...args) {
          if (normalized.includes("UPDATE tasks SET updatedAt = ?, activityLabel = ?, needsInput = 1 WHERE id = ?")) {
            const [updatedAt, activityLabel, taskId] = args;
            if (taskId === state.task.id) {
              state.task.updatedAt = updatedAt;
              state.task.activityLabel = activityLabel;
              state.task.needsInput = 1;
            }
            return { changes: 1 };
          }

          if (normalized.includes("UPDATE tasks SET status = 'review', completedAt = NULL, updatedAt = ?, costUsd = ?, tokensUsed = ?, durationMs = ?, needsInput = 1, activityLabel = NULL WHERE id = ?")) {
            const [updatedAt, costUsd, tokensUsed, durationMs, taskId] = args;
            if (taskId === state.task.id) {
              state.task.status = "review";
              state.task.completedAt = null;
              state.task.updatedAt = updatedAt;
              state.task.costUsd = costUsd;
              state.task.tokensUsed = tokensUsed;
              state.task.durationMs = durationMs;
              state.task.needsInput = 1;
            }
            return { changes: 1 };
          }

          if (normalized.includes("UPDATE tasks SET permissionMode = ?, executionPermissionMode = ? WHERE id = ?")) {
            const [permissionMode, executionPermissionMode, taskId] = args;
            if (taskId === state.task.id) {
              state.task.permissionMode = permissionMode;
              state.task.executionPermissionMode = executionPermissionMode;
            }
            return { changes: 1 };
          }

          throw new Error(`Unhandled run SQL: ${normalized}`);
        },
        all() {
          throw new Error(`Unhandled all SQL: ${normalized}`);
        },
      };
    },
  };
}

function loadProcessManagerModule(stubs = {}) {
  delete global.__processManager;

  const mergedStubs = {
    "./config": {
      getConfig: () => ({ agenticOsDir: process.cwd() }),
      getClientAiOsDir: (clientId) => path.join(process.cwd(), "clients", clientId),
    },
    "./subprocess": {
      spawnManagedTaskProcess: () => {
        throw new Error("spawnManagedTaskProcess stub not provided");
      },
      killChildProcessTree: () => {},
    },
    "./file-watcher": {
      fileWatcher: {
        startWatching: async () => {},
        stopWatching: async () => {},
        cleanupAll: () => {},
      },
    },
    "./gather-context": {
      buildSiblingContextBlock: () => "",
    },
    "./cron-service": {
      completeCronRunForTask: () => {},
    },
    "./marketing-findings": {
      recordMarketingBlockerFinding: () => {},
    },
    "./prompt-tags": {
      expandPromptTags: (prompt) => prompt,
    },
    "./permission-mode": {
      getActivePermissionMode: (value, fallback = "bypassPermissions") => {
        if (!value) return fallback;
        return value === "auto" ? "bypassPermissions" : value;
      },
      getExecutionPermissionMode: (value, fallback = "bypassPermissions") => {
        if (!value) return fallback;
        const normalized = value === "auto" ? "bypassPermissions" : value;
        return normalized === "plan" ? fallback : normalized;
      },
    },
    ...stubs,
  };

  const source = fs.readFileSync(processManagerSourcePath, "utf-8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });

  const module = { exports: {} };
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(mergedStubs, request)) {
      return mergedStubs[request];
    }

    if (request.startsWith("./") || request.startsWith("../")) {
      return require(path.resolve(path.dirname(processManagerSourcePath), request));
    }

    return require(request);
  };

  const compiled = new Function("require", "module", "exports", "__dirname", "__filename", outputText);
  compiled(localRequire, module, module.exports, path.dirname(processManagerSourcePath), processManagerSourcePath);
  return module.exports;
}

test("executeTask only claims one start for near-simultaneous queued cron calls", async () => {
  const workspaceDir = makeTempWorkspace();
  const now = new Date().toISOString();
  const task = {
    id: "task-queued-once",
    title: "Queued cron task",
    description: "This scheduled task should only start once.",
    status: "queued",
    level: "task",
    parentId: null,
    projectSlug: null,
    clientId: null,
    needsInput: 0,
    phaseNumber: null,
    gsdStep: null,
    cronJobSlug: "duplicate-start-job",
    permissionMode: "default",
    createdAt: now,
    updatedAt: now,
  };
  const db = createFakeDb(task);
  const logEntries = [];
  const emitEvents = [];
  let spawnCalls = 0;
  let resolveWatcher;
  const watcherPromise = new Promise((resolve) => {
    resolveWatcher = resolve;
  });

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./config": {
        getConfig: () => ({ agenticOsDir: workspaceDir }),
        getClientAiOsDir: (clientId) => path.join(workspaceDir, "clients", clientId),
      },
      "./event-bus": {
        emitTaskEvent: (event) => {
          emitEvents.push(event);
        },
      },
      "./claude-parser": {
        ClaudeOutputParser: class {},
      },
      "./file-watcher": {
        fileWatcher: {
          startWatching: () => watcherPromise,
          stopWatching: async () => {},
          cleanupAll: () => {},
        },
      },
      "./gather-context": {
        buildSiblingContextBlock: () => "",
      },
      "./file-diff": {
        captureSnapshot: () => ({}),
      },
      "./cron-service": {
        completeCronRunForTask: () => {},
      },
      "./prompt-tags": {
        expandPromptTags: (prompt) => prompt,
      },
    });

    processManager.addLogEntry = (_taskId, entry) => {
      logEntries.push(entry);
    };
    processManager.normalizeTask = (value) => value;
    processManager.isSessionContextTask = () => false;
    processManager.spawnClaudeTurn = () => {
      spawnCalls += 1;
    };

    const firstRun = processManager.executeTask(task.id);
    const secondRun = processManager.executeTask(task.id);

    await Promise.resolve();
    assert.equal(processManager.hasActiveSession(task.id), true);

    resolveWatcher();
    await Promise.all([firstRun, secondRun]);

    assert.equal(spawnCalls, 1);
    assert.equal(logEntries.length, 1);
    assert.equal(db.state.logsDeleted, 1);
    assert.equal(db.state.outputsDeleted, 1);
    assert.equal(db.state.task.status, "running");
    assert.equal(processManager.hasActiveSession(task.id), false);
    assert.equal(
      emitEvents.filter((event) => event.type === "task:status").length,
      1
    );
  } finally {
    delete global.__processManager;
    cleanupTempWorkspace(workspaceDir);
  }
});

test("ask mode spawn wires the permission bridge and isolated settings", () => {
  const workspaceDir = makeTempWorkspace();
  const bridgeScriptPath = path.join(
    workspaceDir,
    "command-centre",
    "scripts",
    "permission-prompt-mcp.cjs",
  );
  fs.mkdirSync(path.dirname(bridgeScriptPath), { recursive: true });
  fs.writeFileSync(bridgeScriptPath, "#!/usr/bin/env node\n", "utf-8");
  const now = new Date().toISOString();
  const task = {
    id: "task-ask-mode",
    title: "Ask mode task",
    description: "Verify Ask mode spawn arguments",
    status: "running",
    level: "task",
    parentId: null,
    projectSlug: "preview-task",
    clientId: null,
    needsInput: 0,
    phaseNumber: null,
    gsdStep: null,
    cronJobSlug: null,
    permissionMode: "default",
    model: "sonnet",
    createdAt: now,
    updatedAt: now,
    costUsd: null,
    tokensUsed: null,
    durationMs: null,
    activityLabel: null,
    errorMessage: null,
  };
  const db = createFakeDb(task);
  const spawnCalls = [];

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: () => {},
        emitChatEvent: () => {},
      },
      "./config": {
        getConfig: () => ({
          agenticOsDir: workspaceDir,
          dbPath: path.join(workspaceDir, ".command-centre", "data.db"),
        }),
        getClientAiOsDir: (clientId) => path.join(workspaceDir, "clients", clientId),
      },
      "./claude-parser": {
        ClaudeOutputParser: class {
          constructor() {}
          feedLine() {}
          get isCompleted() {
            return false;
          }
        },
      },
      "./subprocess": {
        spawnManagedTaskProcess: (command, args) => {
          spawnCalls.push({ command, args: [...args] });
          const proc = new EventEmitter();
          proc.stdout = new Readable({
            read() {
              this.push(null);
            },
          });
          proc.stderr = new Readable({
            read() {
              this.push(null);
            },
          });
          proc.stdin = { end() {} };
          proc.unref = () => {};
          proc.pid = 12345;
          return proc;
        },
        killChildProcessTree: () => {},
      },
    });

    processManager.spawnClaudeTurn(task.id, "Check Ask mode", workspaceDir, false, false);

    assert.equal(spawnCalls.length, 1);
    const [{ command, args }] = spawnCalls;
    assert.equal(command, "claude");
    assert.ok(args.includes("--permission-mode"));
    assert.ok(args.includes("default"));
    assert.ok(args.includes("--allowedTools"));
    assert.ok(args.includes("Read,Glob,Grep,WebSearch,WebFetch,mcp__permissions"));
    assert.ok(args.includes("--permission-prompt-tool"));
    assert.ok(args.includes("mcp__permissions__approval_prompt"));
    assert.ok(args.includes("--setting-sources"));
    assert.ok(args.includes("user"));
    assert.ok(args.includes("--settings"));
    assert.ok(args.includes("--mcp-config"));
    assert.equal(args.includes("--effort"), false);

    const settingsPath = args[args.indexOf("--settings") + 1];
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    assert.deepEqual(settings.permissions.allow, [
      "Read(*)",
      "Glob(*)",
      "Grep(*)",
      "WebSearch",
      "WebFetch",
      "mcp__permissions",
    ]);
    const mcpConfigPath = args[args.indexOf("--mcp-config") + 1];
    const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, "utf-8"));
    assert.equal(mcpConfig.mcpServers.permissions.type, "stdio");
    assert.equal(mcpConfig.mcpServers.permissions.args[0], bridgeScriptPath);
    fs.unlinkSync(settingsPath);
    fs.unlinkSync(mcpConfigPath);
  } finally {
    delete global.__processManager;
    cleanupTempWorkspace(workspaceDir);
  }
});

test("spawn passes --effort when thinking effort is explicit", () => {
  const workspaceDir = makeTempWorkspace();
  const now = new Date().toISOString();
  const task = {
    id: "task-effort-high",
    title: "High effort task",
    description: "Verify effort spawn arguments",
    status: "running",
    level: "task",
    parentId: null,
    projectSlug: null,
    clientId: null,
    needsInput: 0,
    phaseNumber: null,
    gsdStep: null,
    cronJobSlug: null,
    permissionMode: "bypassPermissions",
    model: "sonnet",
    thinkingEffort: "high",
    createdAt: now,
    updatedAt: now,
  };
  const db = createFakeDb(task);
  const spawnCalls = [];

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: () => {},
        emitChatEvent: () => {},
      },
      "./config": {
        getConfig: () => ({ agenticOsDir: workspaceDir }),
        getClientAiOsDir: (clientId) => path.join(workspaceDir, "clients", clientId),
      },
      "./claude-parser": {
        ClaudeOutputParser: class {
          constructor() {}
          feedLine() {}
          get isCompleted() {
            return false;
          }
        },
      },
      "./subprocess": {
        spawnManagedTaskProcess: (command, args) => {
          spawnCalls.push({ command, args: [...args] });
          const proc = new EventEmitter();
          proc.stdout = new Readable({ read() { this.push(null); } });
          proc.stderr = new Readable({ read() { this.push(null); } });
          proc.stdin = { end() {} };
          proc.unref = () => {};
          proc.pid = 12345;
          return proc;
        },
        killChildProcessTree: () => {},
      },
    });

    processManager.spawnClaudeTurn(task.id, "Think hard", workspaceDir, false, false);

    const args = spawnCalls[0].args;
    assert.equal(args[args.indexOf("--effort") + 1], "high");
  } finally {
    delete global.__processManager;
    cleanupTempWorkspace(workspaceDir);
  }
});

test("spawn omits --effort when thinking effort is auto", () => {
  const workspaceDir = makeTempWorkspace();
  const now = new Date().toISOString();
  const task = {
    id: "task-effort-auto",
    title: "Auto effort task",
    description: "Verify auto effort spawn arguments",
    status: "running",
    level: "task",
    parentId: null,
    projectSlug: null,
    clientId: null,
    needsInput: 0,
    phaseNumber: null,
    gsdStep: null,
    cronJobSlug: null,
    permissionMode: "bypassPermissions",
    model: "sonnet",
    thinkingEffort: "auto",
    createdAt: now,
    updatedAt: now,
  };
  const db = createFakeDb(task);
  const spawnCalls = [];

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: () => {},
        emitChatEvent: () => {},
      },
      "./config": {
        getConfig: () => ({ agenticOsDir: workspaceDir }),
        getClientAiOsDir: (clientId) => path.join(workspaceDir, "clients", clientId),
      },
      "./claude-parser": {
        ClaudeOutputParser: class {
          constructor() {}
          feedLine() {}
          get isCompleted() {
            return false;
          }
        },
      },
      "./subprocess": {
        spawnManagedTaskProcess: (command, args) => {
          spawnCalls.push({ command, args: [...args] });
          const proc = new EventEmitter();
          proc.stdout = new Readable({ read() { this.push(null); } });
          proc.stderr = new Readable({ read() { this.push(null); } });
          proc.stdin = { end() {} };
          proc.unref = () => {};
          proc.pid = 12345;
          return proc;
        },
        killChildProcessTree: () => {},
      },
    });

    processManager.spawnClaudeTurn(task.id, "Use auto effort", workspaceDir, false, false);

    assert.equal(spawnCalls[0].args.includes("--effort"), false);
  } finally {
    delete global.__processManager;
    cleanupTempWorkspace(workspaceDir);
  }
});

test("spawn separates leading-dash prompts from CLI options", () => {
  const workspaceDir = makeTempWorkspace();
  const now = new Date().toISOString();
  const task = {
    id: "task-leading-dash-prompt",
    title: "Leading dash prompt task",
    description: "Verify prompt argument separation",
    status: "running",
    level: "task",
    parentId: null,
    projectSlug: null,
    clientId: null,
    needsInput: 0,
    phaseNumber: null,
    gsdStep: null,
    cronJobSlug: null,
    permissionMode: "bypassPermissions",
    model: null,
    thinkingEffort: null,
    createdAt: now,
    updatedAt: now,
  };
  const db = createFakeDb(task);
  const spawnCalls = [];
  const prompt = "--- SESSION SNAPSHOT ---\nLoaded baseline context.\n--- END SNAPSHOT ---\n\nWrite a poem.";

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: () => {},
        emitChatEvent: () => {},
      },
      "./config": {
        getConfig: () => ({ agenticOsDir: workspaceDir }),
        getClientAiOsDir: (clientId) => path.join(workspaceDir, "clients", clientId),
      },
      "./claude-parser": {
        ClaudeOutputParser: class {
          constructor() {}
          feedLine() {}
          get isCompleted() {
            return false;
          }
        },
      },
      "./subprocess": {
        spawnManagedTaskProcess: (command, args) => {
          spawnCalls.push({ command, args: [...args] });
          const proc = new EventEmitter();
          proc.stdout = new Readable({ read() { this.push(null); } });
          proc.stderr = new Readable({ read() { this.push(null); } });
          proc.stdin = { end() {} };
          proc.unref = () => {};
          proc.pid = 12345;
          return proc;
        },
        killChildProcessTree: () => {},
      },
    });

    processManager.spawnClaudeTurn(task.id, prompt, workspaceDir, false, false);

    const args = spawnCalls[0].args;
    assert.deepEqual(args.slice(-2), ["--", prompt]);
    assert.equal(args.indexOf(prompt), args.length - 1);
  } finally {
    delete global.__processManager;
    cleanupTempWorkspace(workspaceDir);
  }
});

test("ask mode bridge failure hint mentions a pending MCP server", () => {
  const { processManager } = loadProcessManagerModule({
    "./db": { getDb: () => createFakeDb({ id: "unused", status: "queued" }) },
    "./event-bus": {
      emitTaskEvent: () => {},
      emitChatEvent: () => {},
    },
    "./claude-parser": {
      ClaudeOutputParser: class {
        constructor() {}
        feedLine() {}
        get isCompleted() {
          return false;
        }
      },
    },
  });
  const failure = processManager.classifyPermissionBridgeFailure(
    "Error: MCP tool mcp__permissions__approval_prompt (passed via --permission-prompt-tool) not found. Available MCP tools: ReadMcpResourceTool"
  );

  assert.equal(
    failure?.summary,
    "Ask mode permission bridge failed: Claude could not find the approval prompt tool."
  );
  assert.match(failure?.detail ?? "", /stayed pending and never finished connecting/i);
});

test("cron prose questions stay in review and record needs_input instead of done", () => {
  const workspaceDir = makeTempWorkspace();
  const now = new Date().toISOString();
  const task = {
    id: "task-cron-question",
    title: "Cron question task",
    description: "Ask a follow-up",
    status: "running",
    level: "task",
    parentId: null,
    projectSlug: null,
    clientId: null,
    needsInput: 0,
    phaseNumber: null,
    gsdStep: null,
    cronJobSlug: "cron-question-job",
    permissionMode: "default",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    costUsd: null,
    tokensUsed: null,
    durationMs: null,
    activityLabel: null,
    errorMessage: null,
  };
  const db = createCronQuestionDb(task, [true]);
  const emittedEvents = [];
  const cronRunPayloads = [];
  const blockerPayloads = [];
  const killedPids = [];

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: (event) => emittedEvents.push(event),
      },
      "./cron-service": {
        completeCronRunForTask: (_task, payload) => {
          cronRunPayloads.push(payload);
        },
      },
      "./marketing-findings": {
        recordMarketingBlockerFinding: (_db, payload) => {
          blockerPayloads.push(payload);
        },
      },
      "./subprocess": {
        spawnManagedTaskProcess: () => {
          throw new Error("spawnManagedTaskProcess should not be called in this test");
        },
        killChildProcessTree: (proc) => {
          killedPids.push(proc.pid);
        },
      },
      "./file-watcher": {
        fileWatcher: {
          startWatching: async () => {},
          stopWatching: async () => {},
          cleanupAll: () => {},
        },
      },
      "./claude-parser": {
        ClaudeOutputParser: class {},
      },
      "./gather-context": {
        buildSiblingContextBlock: () => "",
      },
    });

    processManager.handleQuestion(task.id, "What should I test next?");
    processManager.sessions.set(task.id, {
      proc: { pid: 4321 },
      pendingQuestion: true,
      totalCostUsd: 0,
      totalTokensUsed: 0,
      totalDurationMs: 0,
      resumedFromReview: false,
    });

    processManager.handleTurnComplete(task.id, {
      costUsd: 1.5,
      tokensUsed: 24,
      durationMs: 2500,
    });

    assert.equal(db.state.task.status, "review");
    assert.equal(db.state.task.needsInput, 1);
    assert.equal(db.state.task.completedAt, null);
    assert.equal(db.state.task.activityLabel, "What should I test next?");
    assert.deepEqual(killedPids, [4321]);
    assert.equal(cronRunPayloads.length, 1);
    assert.equal(cronRunPayloads[0].result, "failure");
    assert.equal(cronRunPayloads[0].completionReason, "needs_input");
    assert.equal(blockerPayloads.length, 1);
    assert.equal(blockerPayloads[0].jobSlug, "cron-question-job");
    assert.equal(blockerPayloads[0].runId, 1);
    assert.equal(blockerPayloads[0].taskId, task.id);
    assert.equal(blockerPayloads[0].completionReason, "needs_input");
    assert.equal(
      emittedEvents.some((event) => event.type === "task:question"),
      true
    );
  } finally {
    delete global.__processManager;
    cleanupTempWorkspace(workspaceDir);
  }
});

test("a resumed cron task that asks again stays in review and does not create a second cron run", () => {
  const workspaceDir = makeTempWorkspace();
  const now = new Date().toISOString();
  const task = {
    id: "task-cron-question-twice",
    title: "Cron question twice",
    description: "Ask again on resume",
    status: "running",
    level: "task",
    parentId: null,
    projectSlug: null,
    clientId: null,
    needsInput: 0,
    phaseNumber: null,
    gsdStep: null,
    cronJobSlug: "cron-question-twice-job",
    permissionMode: "default",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    costUsd: null,
    tokensUsed: null,
    durationMs: null,
    activityLabel: null,
    errorMessage: null,
  };
  const db = createCronQuestionDb(task, [true, false]);
  const cronRunPayloads = [];
  const blockerPayloads = [];

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: () => {},
      },
      "./cron-service": {
        completeCronRunForTask: (_task, payload) => {
          cronRunPayloads.push(payload);
        },
      },
      "./marketing-findings": {
        recordMarketingBlockerFinding: (_db, payload) => {
          blockerPayloads.push(payload);
        },
      },
      "./subprocess": {
        spawnManagedTaskProcess: () => {
          throw new Error("spawnManagedTaskProcess should not be called in this test");
        },
        killChildProcessTree: () => {},
      },
      "./file-watcher": {
        fileWatcher: {
          startWatching: async () => {},
          stopWatching: async () => {},
          cleanupAll: () => {},
        },
      },
      "./claude-parser": {
        ClaudeOutputParser: class {},
      },
      "./gather-context": {
        buildSiblingContextBlock: () => "",
      },
    });

    processManager.sessions.set(task.id, {
      proc: { pid: 111 },
      pendingQuestion: true,
      totalCostUsd: 0,
      totalTokensUsed: 0,
      totalDurationMs: 0,
      resumedFromReview: false,
    });
    processManager.handleTurnComplete(task.id, {
      costUsd: 0.4,
      tokensUsed: 10,
      durationMs: 1000,
    });

    db.state.task.status = "running";
    db.state.task.needsInput = 0;
    db.state.task.updatedAt = new Date(Date.now() + 1000).toISOString();

    processManager.sessions.set(task.id, {
      proc: { pid: 222 },
      pendingQuestion: true,
      totalCostUsd: 0.4,
      totalTokensUsed: 10,
      totalDurationMs: 1000,
      resumedFromReview: true,
    });
    processManager.handleTurnComplete(task.id, {
      costUsd: 0.2,
      tokensUsed: 8,
      durationMs: 800,
    });

    assert.equal(db.state.task.status, "review");
    assert.equal(db.state.task.needsInput, 1);
    assert.equal(db.state.task.completedAt, null);
    assert.equal(cronRunPayloads.length, 1);
    assert.equal(cronRunPayloads[0].completionReason, "needs_input");
    assert.equal(blockerPayloads.length, 1);
    assert.equal(blockerPayloads[0].jobSlug, "cron-question-twice-job");
  } finally {
    delete global.__processManager;
    cleanupTempWorkspace(workspaceDir);
  }
});

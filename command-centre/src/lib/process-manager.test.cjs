const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const test = require("node:test");
const ts = require("typescript");
const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const processManagerSourcePath = path.resolve(__dirname, "process-manager.ts");
const SOLO_WORK_SCOPE = { mode: "solo", version: 1, clientId: null };
const TEAM_WORK_SCOPE = {
  mode: "team",
  scope: {
    version: 1,
    serverId: "server-1",
    userId: "user-1",
    teamId: "team-a",
    clientId: null,
  },
};
const claudeParserSourcePath = path.resolve(__dirname, "claude-parser.ts");
const questionSpecModule = loadTsModule(path.resolve(__dirname, "..", "types", "question-spec.ts"));

function loadActualClaudeParserModule() {
  const source = fs.readFileSync(claudeParserSourcePath, "utf-8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} };
  const localRequire = (request) => {
    if (request === "@/types/question-spec") {
      return {
        ...questionSpecModule,
        extractQuestionSpecsFromText: () => null,
        stripQuestionSpecsFromText: (text) => text,
      };
    }
    if (request === "@/types/task") return {};
    return require(request);
  };
  const compiled = new Function("require", "module", "exports", "__dirname", "__filename", outputText);
  compiled(localRequire, module, module.exports, path.dirname(claudeParserSourcePath), claudeParserSourcePath);
  return module.exports;
}

function assertAskUserQuestionDisallowed(args) {
  const index = args.indexOf("--disallowedTools");
  assert.notEqual(index, -1, "Command Centre sessions must pass --disallowedTools");
  assert.equal(args[index + 1], "AskUserQuestion");
}

function makeTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "command-centre-process-manager-"));
}

function cleanupTempWorkspace(workspaceDir) {
  fs.rmSync(workspaceDir, { recursive: true, force: true });
}

function resetProcessManagerSingleton() {
  const manager = global.__processManager;
  if (manager && typeof manager.dispose === "function") {
    manager.dispose();
  } else if (manager && typeof manager.cleanup === "function") {
    manager.cleanup();
  }
  delete global.__processManager;
}

function decodeClaudeStreamUserMessage(value) {
  const parsed = JSON.parse(String(value).trim());
  assert.equal(parsed.type, "user");
  assert.equal(parsed.message.role, "user");
  assert.equal(parsed.parent_tool_use_id, null);
  return parsed.message.content;
}

test("stream writes treat backpressure as accepted and closed streams as unavailable", () => {
  try {
    const {
      writeClaudePermissionModeControl,
      writeClaudeStreamUserMessage,
    } = loadProcessManagerModule({
      "./db": { getDb: () => ({}) },
      "./event-bus": { emitTaskEvent: () => {}, emitChatEvent: () => {} },
      "./claude-parser": { ClaudeOutputParser: class {} },
    });
    const writes = [];
    const backpressured = {
      writable: true,
      writableEnded: false,
      destroyed: false,
      write(value) { writes.push(value); return false; },
    };

    assert.equal(writeClaudeStreamUserMessage(backpressured, "Large planned project prompt"), true);
    assert.equal(writeClaudePermissionModeControl(backpressured, "request-1", "auto"), true);
    assert.equal(decodeClaudeStreamUserMessage(writes[0]), "Large planned project prompt");
    assert.deepEqual(JSON.parse(String(writes[1]).trim()), {
      type: "control_request",
      request_id: "request-1",
      request: { subtype: "set_permission_mode", mode: "auto" },
    });

    const closed = {
      writable: false,
      writableEnded: true,
      destroyed: false,
      write() { throw new Error("closed stream should not be written"); },
    };
    assert.equal(writeClaudeStreamUserMessage(closed, "ignored"), false);
    assert.equal(
      writeClaudeStreamUserMessage({ writable: true, write() { throw new Error("EPIPE"); } }, "ignored"),
      false,
    );
  } finally {
    resetProcessManagerSingleton();
  }
});

test("instruction directory discovery does not double-count the same workspace", () => {
  try {
    const { dedupeInstructionDirs } = loadProcessManagerModule({
      "./db": { getDb: () => ({}) },
      "./event-bus": { emitTaskEvent: () => {}, emitChatEvent: () => {} },
      "./claude-parser": { ClaudeOutputParser: class {} },
    });
    const workspaceDir = path.resolve("workspace-root");
    const duplicate = process.platform === "win32" ? workspaceDir.toUpperCase() : workspaceDir;
    assert.deepEqual(
      dedupeInstructionDirs([workspaceDir, duplicate, workspaceDir]),
      [workspaceDir],
    );
  } finally {
    resetProcessManagerSingleton();
  }
});

function createFakeDb(task) {
  const state = {
    task: { ...task },
    logs: [],
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

          if (normalized.includes("SELECT permissionMode, model, thinkingEffort, cronJobSlug, projectSlug, clientId, workScope, cancelRequestedAt FROM tasks WHERE id = ?")) {
            return args[0] === state.task.id
              ? {
                  permissionMode: state.task.permissionMode ?? null,
                  model: state.task.model ?? null,
                  thinkingEffort: state.task.thinkingEffort ?? null,
                  cronJobSlug: state.task.cronJobSlug ?? null,
                  projectSlug: state.task.projectSlug ?? null,
                  clientId: state.task.clientId ?? null,
                  workScope: state.task.workScope ?? null,
                  cancelRequestedAt: state.task.cancelRequestedAt ?? null,
                }
              : undefined;
          }

          if (normalized.includes("SELECT clientId, workScope FROM tasks WHERE id = ?")) {
            return args[0] === state.task.id
              ? { clientId: state.task.clientId ?? null, workScope: state.task.workScope ?? null }
              : undefined;
          }

          if (normalized.includes("SELECT cancelRequestedAt FROM tasks WHERE id = ?")) {
            return args[0] === state.task.id
              ? { cancelRequestedAt: state.task.cancelRequestedAt ?? null }
              : undefined;
          }

          if (normalized.includes("SELECT claudePid FROM tasks WHERE id = ?")) {
            return args[0] === state.task.id
              ? { claudePid: state.task.claudePid ?? null }
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

          if (normalized.includes("SELECT cronJobSlug FROM tasks WHERE id = ?")) {
            return args[0] === state.task.id
              ? { cronJobSlug: state.task.cronJobSlug ?? null }
              : undefined;
          }

          if (normalized.includes("SELECT needsInput FROM tasks WHERE id = ?")) {
            return args[0] === state.task.id
              ? { needsInput: state.task.needsInput ? 1 : 0 }
              : undefined;
          }

          if (normalized.includes("SELECT status FROM tasks WHERE id = ?")) {
            return args[0] === state.task.id ? { status: state.task.status } : undefined;
          }

          if (normalized.includes("SELECT claudeSessionId FROM tasks WHERE id = ?")) {
            return args[0] === state.task.id
              ? { claudeSessionId: state.task.claudeSessionId ?? null }
              : undefined;
          }

          if (normalized.includes("SELECT id FROM cron_runs WHERE taskId = ? AND result = 'running' LIMIT 1")) {
            return state.task.cronJobSlug ? { id: 1 } : undefined;
          }

          if (normalized.includes("SELECT level, parentId, completedAt FROM tasks WHERE id = ?")) {
            return args[0] === state.task.id
              ? {
                  level: state.task.level,
                  parentId: state.task.parentId ?? null,
                  completedAt: state.task.completedAt ?? null,
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

          if (normalized.includes("SELECT claudeSessionId FROM tasks WHERE id = ?")) {
            return args[0] === state.task.id
              ? { claudeSessionId: state.task.claudeSessionId ?? null }
              : undefined;
          }

          if (normalized.includes("FROM tasks c JOIN tasks p ON c.parentId = p.id WHERE c.id = ?")) {
            return undefined;
          }

          throw new Error(`Unhandled get SQL: ${normalized}`);
        },
        run(...args) {
          if (
            normalized.startsWith("INSERT INTO task_logs") ||
            normalized.startsWith("INSERT OR IGNORE INTO task_logs")
          ) {
            const log = {
              id: args[0],
              taskId: args[1],
              type: args[2],
              timestamp: args[3],
              content: args[4],
              permissionMode: args[13],
            };
            if (args[5] != null) log.toolName = args[5];
            if (args[6] != null) log.toolArgs = args[6];
            if (args[7] != null) log.toolResult = args[7];
            if (args[8] != null) log.toolUseId = args[8];
            if (args[9] != null) log.parentToolUseId = args[9];
            if (args[10]) log.isCollapsed = 1;
            if (args[11] != null) log.questionSpec = args[11];
            if (
              normalized.startsWith("INSERT OR IGNORE") &&
              state.logs.some((entry) => entry.id === log.id)
            ) {
              return { changes: 0 };
            }
            state.logs.push(log);
            return { changes: 1 };
          }

          if (normalized.includes("WHERE id = ? AND status = 'queued'")) {
            const [status, startedAt, updatedAt, activityLabel, taskId] = args;
            if (taskId !== state.task.id || state.task.status !== "queued" || state.task.cancelRequestedAt) {
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

          if (normalized.includes("WHERE id = ? AND status = 'backlog' AND parentId IS NOT NULL")) {
            const [startedAt, updatedAt, lastReplyAt, activityLabel, taskId] = args;
            if (taskId !== state.task.id || state.task.status !== "backlog" || !state.task.parentId) {
              return { changes: 0 };
            }

            state.task.status = "running";
            state.task.startedAt = state.task.startedAt ?? startedAt;
            state.task.updatedAt = updatedAt;
            state.task.lastReplyAt = lastReplyAt;
            state.task.activityLabel = activityLabel;
            state.task.errorMessage = null;
            state.task.needsInput = 0;
            return { changes: 1 };
          }

          if (normalized.startsWith("DELETE FROM task_logs")) {
            state.logsDeleted += 1;
            state.logs = [];
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

          if (normalized.includes("UPDATE tasks SET claudePid = ?, ownedClaudePid = ? WHERE id = ?")) {
            const [claudePid, ownedClaudePid, taskId] = args;
            if (taskId === state.task.id && !state.task.cancelRequestedAt) {
              state.task.claudePid = claudePid;
              state.task.ownedClaudePid = ownedClaudePid;
              return { changes: 1 };
            }
            return { changes: 0 };
          }

          if (normalized.includes("UPDATE tasks SET claudePid = -1 WHERE id = ?")) {
            const [taskId] = args;
            if (taskId === state.task.id && !state.task.cancelRequestedAt) {
              state.task.claudePid = -1;
              return { changes: 1 };
            }
            return { changes: 0 };
          }

          if (normalized.includes("UPDATE tasks SET claudePid = NULL, ownedClaudePid = NULL WHERE id = ?")) {
            if (args[0] === state.task.id) {
              state.task.claudePid = null;
              state.task.ownedClaudePid = null;
            }
            return { changes: 1 };
          }

          if (normalized.includes("UPDATE tasks SET updatedAt = ?, activityLabel = ? WHERE id = ?")) {
            const [updatedAt, activityLabel, taskId] = args;
            if (taskId === state.task.id) {
              state.task.updatedAt = updatedAt;
              state.task.activityLabel = activityLabel;
            }
            return { changes: 1 };
          }

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
              state.task.activityLabel = null;
            }
            return { changes: 1 };
          }

          if (normalized.startsWith("UPDATE tasks SET cancelRequestedAt = COALESCE")) {
            if (args.length === 2) {
              const [cancelRequestedAt, taskId] = args;
              if (taskId !== state.task.id) return { changes: 0 };
              state.task.cancelRequestedAt ??= cancelRequestedAt;
              return { changes: 1 };
            }
            const [cancelRequestedAt, updatedAt, activityLabel, taskId] = args;
            if (taskId !== state.task.id || !["queued", "running"].includes(state.task.status)) {
              return { changes: 0 };
            }
            state.task.cancelRequestedAt ??= cancelRequestedAt;
            state.task.updatedAt = updatedAt;
            state.task.activityLabel = activityLabel;
            state.task.errorMessage = null;
            return { changes: 1 };
          }

          if (normalized.startsWith("UPDATE approval_requests SET status = 'denied'")) {
            return { changes: 0 };
          }

          if (normalized.includes("UPDATE tasks SET activityLabel = ? WHERE id = ?")) {
            const [activityLabel, taskId] = args;
            if (taskId === state.task.id) {
              state.task.activityLabel = activityLabel;
            }
            return { changes: 1 };
          }

          if (normalized.includes("UPDATE tasks SET status = 'running', updatedAt = ?, activityLabel = ?, needsInput = 0 WHERE id = ?")) {
            const [updatedAt, activityLabel, taskId] = args;
            if (taskId === state.task.id) {
              state.task.status = "running";
              state.task.updatedAt = updatedAt;
              state.task.activityLabel = activityLabel;
              state.task.needsInput = 0;
            }
            return { changes: 1 };
          }

          if (normalized.includes("UPDATE tasks SET status = 'running', updatedAt = ?, costUsd = ?, tokensUsed = ?, durationMs = ?, activityLabel = ?, needsInput = 0 WHERE id = ?")) {
            const [updatedAt, costUsd, tokensUsed, durationMs, activityLabel, taskId] = args;
            if (taskId === state.task.id) {
              state.task.status = "running";
              state.task.updatedAt = updatedAt;
              state.task.costUsd = costUsd;
              state.task.tokensUsed = tokensUsed;
              state.task.durationMs = durationMs;
              state.task.activityLabel = activityLabel;
              state.task.needsInput = 0;
            }
            return { changes: 1 };
          }

          if (normalized.includes("UPDATE tasks SET status = 'review', updatedAt = ?, costUsd = ?, tokensUsed = ?, durationMs = ?, needsInput = 1 WHERE id = ?")) {
            const [updatedAt, costUsd, tokensUsed, durationMs, taskId] = args;
            if (taskId === state.task.id) {
              state.task.status = "review";
              state.task.updatedAt = updatedAt;
              state.task.costUsd = costUsd;
              state.task.tokensUsed = tokensUsed;
              state.task.durationMs = durationMs;
              state.task.needsInput = 1;
            }
            return { changes: 1 };
          }

          if (normalized.includes("UPDATE tasks SET status = 'review', completedAt = NULL, updatedAt = ?, costUsd = ?, tokensUsed = ?, durationMs = ?, activityLabel = ?, needsInput = 1, claudePid = NULL WHERE id = ?")) {
            const [updatedAt, costUsd, tokensUsed, durationMs, activityLabel, taskId] = args;
            if (taskId === state.task.id) {
              state.task.status = "review";
              state.task.completedAt = null;
              state.task.updatedAt = updatedAt;
              state.task.costUsd = costUsd;
              state.task.tokensUsed = tokensUsed;
              state.task.durationMs = durationMs;
              state.task.activityLabel = activityLabel;
              state.task.needsInput = 1;
              state.task.claudePid = null;
            }
            return { changes: 1 };
          }

          if (normalized.includes("UPDATE tasks SET status = 'review', completedAt = NULL, updatedAt = ?, errorMessage = ?, activityLabel = ?, needsInput = 1, claudePid = NULL WHERE id = ?")) {
            const [updatedAt, errorMessage, activityLabel, taskId] = args;
            if (taskId === state.task.id) {
              state.task.status = "review";
              state.task.completedAt = null;
              state.task.updatedAt = updatedAt;
              state.task.errorMessage = errorMessage;
              state.task.activityLabel = activityLabel;
              state.task.needsInput = 1;
              state.task.claudePid = null;
            }
            return { changes: 1 };
          }

          if (normalized.includes("UPDATE tasks SET status = 'done', completedAt = ?, updatedAt = ?, costUsd = ?, tokensUsed = ?, durationMs = ?, activityLabel = ?, needsInput = 0, claudePid = NULL WHERE id = ?")) {
            const [completedAt, updatedAt, costUsd, tokensUsed, durationMs, activityLabel, taskId] = args;
            if (taskId === state.task.id) {
              state.task.status = "done";
              state.task.completedAt = completedAt;
              state.task.updatedAt = updatedAt;
              state.task.costUsd = costUsd;
              state.task.tokensUsed = tokensUsed;
              state.task.durationMs = durationMs;
              state.task.activityLabel = activityLabel;
              state.task.needsInput = 0;
              state.task.claudePid = null;
            }
            return { changes: 1 };
          }

          if (normalized.startsWith("UPDATE tasks SET status = ?, updatedAt = ?, activityLabel = ?, costUsd = NULL")) {
            const [status, updatedAt, activityLabel, taskId] = args;
            if (taskId === state.task.id) {
              state.task.status = status;
              state.task.updatedAt = updatedAt;
              state.task.activityLabel = activityLabel;
              state.task.costUsd = null;
              state.task.tokensUsed = null;
              state.task.durationMs = null;
              state.task.errorMessage = null;
              state.task.startedAt = null;
              state.task.completedAt = null;
              state.task.needsInput = 0;
              state.task.claudePid = null;
            }
            return { changes: 1 };
          }

          if (normalized.includes("UPDATE tasks SET permissionMode = ?, executionPermissionMode = ?, updatedAt = ? WHERE id = ?")) {
            const [permissionMode, executionPermissionMode, updatedAt, taskId] = args;
            if (taskId === state.task.id) {
              state.task.permissionMode = permissionMode;
              state.task.executionPermissionMode = executionPermissionMode;
              state.task.updatedAt = updatedAt;
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
        all(...args) {
          if (normalized.includes("FROM task_logs")) {
            const [taskId] = args;
            return state.logs
              .filter((log) => log.taskId === taskId)
              .map((log) => ({
                id: log.id,
                type: log.type,
                timestamp: log.timestamp,
                content: log.content,
                toolName: log.toolName ?? null,
                toolArgs: log.toolArgs ?? null,
                toolResult: log.toolResult ?? null,
                toolUseId: log.toolUseId ?? null,
                parentToolUseId: log.parentToolUseId ?? null,
                isCollapsed: log.isCollapsed ?? 0,
                questionSpec: log.questionSpec ?? null,
                questionAnswers: log.questionAnswers ?? null,
                permissionMode: log.permissionMode ?? null,
              }));
          }

          if (normalized.includes("SELECT * FROM tasks WHERE parentId = ? AND status = 'backlog'")) {
            return [];
          }

          throw new Error(`Unhandled all SQL: ${normalized}`);
        },
      };
    },
    transaction(fn) {
      return (...args) => fn(...args);
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
          if (normalized.includes("SELECT cancelRequestedAt FROM tasks WHERE id = ?")) {
            return args[0] === state.task.id
              ? { cancelRequestedAt: state.task.cancelRequestedAt ?? null }
              : undefined;
          }

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

          if (normalized.includes("SELECT id FROM cron_runs WHERE taskId = ? AND result = 'running' LIMIT 1")) {
            const next = state.runningRowSequence.length > 0
              ? state.runningRowSequence.shift()
              : false;
            return next ? { id: 1 } : undefined;
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

          if (normalized.includes("UPDATE tasks SET claudePid = ?, ownedClaudePid = ? WHERE id = ?")) {
            const [claudePid, ownedClaudePid, taskId] = args;
            if (taskId === state.task.id) {
              state.task.claudePid = claudePid;
              state.task.ownedClaudePid = ownedClaudePid;
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

function loadProcessManagerModule(stubs = {}, options = {}) {
  if (options.resetSingleton !== false) {
    resetProcessManagerSingleton();
  }

  class WorkflowAgentJournalBridgeStub {
    constructor(callbacks = {}) {
      this.callbacks = callbacks;
      this.runs = new Map();
      this.observeCalls = [];
    }
    key(taskId, runId) { return `${taskId}\0${runId}`; }
    async observeLaunch(launch) {
      this.observeCalls.push(launch);
      const snapshot = {
        hostTaskId: launch.hostTaskId,
        workflowTaskId: launch.taskId,
        sessionId: launch.sessionId,
        runId: launch.runId,
        parentToolUseId: launch.toolUseId,
        transcriptDir: launch.transcriptDir,
        journalPath: path.join(launch.transcriptDir, "journal.jsonl"),
        agents: [],
        startedCount: 0,
        completedCount: 0,
        outstandingCount: 0,
      };
      this.runs.set(this.key(launch.hostTaskId, launch.runId), snapshot);
      return snapshot;
    }
    getSnapshot(taskId, runId) {
      return this.runs.get(this.key(taskId, runId));
    }
    async finalizeTerminal(terminal) {
      const snapshot = this.getSnapshot(terminal.hostTaskId, terminal.runId);
      if (!snapshot) return undefined;
      snapshot.terminal = {
        status: terminal.status,
        finalizedAt: new Date().toISOString(),
      };
      this.callbacks.onRunTerminal?.(snapshot);
      return snapshot;
    }
    async stopTask(taskId, summary) {
      const runs = [...this.runs.values()].filter((run) => run.hostTaskId === taskId && !run.terminal);
      return Promise.all(runs.map((run) => this.finalizeTerminal({
        hostTaskId: taskId,
        runId: run.runId,
        status: "stopped",
        summary,
      })));
    }
    dispose() { this.runs.clear(); }
  }

  const mergedStubs = {
    "./config": {
      getConfig: () => ({ aiOsDir: process.cwd() }),
      getClientAiOsDir: (clientId) => path.join(process.cwd(), "clients", clientId),
    },
    "./subprocess": {
      spawnManagedTaskProcess: () => {
        throw new Error("spawnManagedTaskProcess stub not provided");
      },
      killChildProcessTree: () => {},
      terminateProcessTreeByPid: async (pid) => ({ pid, stopped: true }),
    },
    "./task-permission-rules": {
      revokeTaskPermissionRules: () => 0,
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
    "./file-diff": {
      captureSnapshot: () => ({}),
    },
    "./prompt-tags": {
      expandPromptTags: (prompt) => prompt,
    },
    "./runtime-context-overlay": {
      RuntimeContextOverlayError: class RuntimeContextOverlayError extends Error {},
      loadRuntimeContextOverlay: () => null,
      createOrLoadRuntimeContextOverlay: (expectation, snapshotMarkdown) => {
        const overlayDir = path.join(
          expectation.profileTempDir,
          "runtime",
          "context-overlays",
          expectation.ownerId,
        );
        const snapshotPath = path.join(overlayDir, "snapshot.md");
        fs.mkdirSync(overlayDir, { recursive: true });
        fs.writeFileSync(snapshotPath, snapshotMarkdown, "utf8");
        return {
          metadata: { teamId: expectation.teamId },
          overlayDir,
          snapshotPath,
          snapshotMarkdown,
        };
      },
      deleteRuntimeContextOverlay: () => {},
    },
    "./subagent-activity": {
      isSubagentToolUse: (entry) =>
        entry.type === "tool_use" && ["agent", "task"].includes(String(entry.toolName || "").toLowerCase()),
      buildSubagentActivityModel: (entries) => {
        const eventsByEntryId = new Map();
        const openByKey = new Map();
        const legacyOpenKeys = [];
        const seenToolUseIds = new Set();

        for (const entry of entries) {
          const isSubagentToolUse =
            entry.type === "tool_use" && ["agent", "task"].includes(String(entry.toolName || "").toLowerCase());
          if (isSubagentToolUse) {
            const toolUseId = entry.toolUseId;
            if (toolUseId && seenToolUseIds.has(toolUseId)) continue;
            if (toolUseId) seenToolUseIds.add(toolUseId);
            let args = {};
            try {
              args = JSON.parse(entry.toolArgs || "{}");
            } catch {
              args = {};
            }
            const toolUseKey = toolUseId || `legacy:${entry.id}`;
            const event = {
              kind: "created",
              entryId: entry.id,
              timestamp: entry.timestamp,
              toolUseKey,
              toolUseId,
              agentName: args.subagent_type || args.agent || args.agent_name || args.name || "agent",
              instructions: args.prompt || args.instructions || args.task || args.description || null,
              reliableMatch: Boolean(toolUseId),
            };
            eventsByEntryId.set(entry.id, event);
            openByKey.set(toolUseKey, event);
            if (!toolUseId) legacyOpenKeys.push(toolUseKey);
            continue;
          }

          if (entry.type !== "tool_result") continue;

          let toolUseKey = null;
          let reliableMatch = false;
          if (entry.toolUseId && openByKey.has(entry.toolUseId)) {
            toolUseKey = entry.toolUseId;
            reliableMatch = true;
          } else if (!entry.toolUseId && legacyOpenKeys.length > 0) {
            toolUseKey = legacyOpenKeys.shift();
          }
          if (!toolUseKey) continue;

          const created = openByKey.get(toolUseKey);
          if (!created) continue;
          openByKey.delete(toolUseKey);
          eventsByEntryId.set(entry.id, {
            kind: "closed",
            entryId: entry.id,
            timestamp: entry.timestamp,
            toolUseKey,
            toolUseId: created.toolUseId,
            agentName: created.agentName,
            instructions: created.instructions,
            reliableMatch,
          });
        }

        return {
          eventsByEntryId,
          activeKeys: new Set(openByKey.keys()),
          activeCount: openByKey.size,
        };
      },
      getSubagentName: (entry) => {
        try {
          const args = JSON.parse(entry.toolArgs || "{}");
          return args.subagent_type || args.agent || args.agent_name || args.name || "agent";
        } catch {
          return "agent";
        }
      },
      getSubagentInstructions: (entry) => {
        try {
          const args = JSON.parse(entry.toolArgs || "{}");
          return args.prompt || args.instructions || args.task || args.description || null;
        } catch {
          return null;
        }
      },
    },
    "./task-logs": {
      getTaskLogEntries: (db, taskId) =>
        db.prepare("SELECT * FROM task_logs WHERE taskId = ?").all(taskId).map((row) => ({
          id: row.id,
          type: row.type,
          timestamp: row.timestamp,
          content: row.content,
          ...(row.toolName ? { toolName: row.toolName } : {}),
          ...(row.toolArgs ? { toolArgs: row.toolArgs } : {}),
          ...(row.toolResult ? { toolResult: row.toolResult } : {}),
          ...(row.toolUseId ? { toolUseId: row.toolUseId } : {}),
          ...(row.parentToolUseId ? { parentToolUseId: row.parentToolUseId } : {}),
          isCollapsed: Boolean(row.isCollapsed),
        })),
    },
    "./task-branch": {
      isTaskBranch: (task) => Boolean(task.forkedFromTaskId && task.forkedFromLogId),
      buildTaskBranchPrompt: (_task, logs) =>
        `BRANCH PROMPT\n${logs.map((entry) => `${entry.type}:${entry.content}`).join("\n")}`,
    },
    "./permission-mode": {
      getActivePermissionMode: (value, fallback = "bypassPermissions") => {
        if (!value) return fallback;
        return value;
      },
      getExecutionPermissionMode: (value, fallback = "bypassPermissions") => {
        if (!value) return fallback;
        const normalized = value;
        return normalized === "plan" ? fallback : normalized;
      },
    },
    "@/lib/claude-capabilities.server": {
      getAutoModeUnavailability: async () => null,
    },
    "./team-api-context": {
      readTeamContext: async () => null,
      fetchTeamContextSnapshot: async () => null,
    },
    "./team-skill-cache": {
      refreshAuthorizedTeamSkillCache: async () => ({ conflicts: [], skills: [] }),
      resolveLocalSkillRuntime: () => ({
        pluginDir: null,
        promptFile: null,
        fingerprint: "test-local-skills",
        teamSkills: [],
        localSkills: [],
        clientSkills: [],
        incompatibleTeamSkills: [],
      }),
      resolveTeamSkillRuntime: () => ({
        pluginDir: null,
        promptFile: null,
        fingerprint: "test-skills",
        teamSkills: [],
        localSkills: [],
        clientSkills: [],
      }),
      routeSkillCommandAliases: (message) => message,
    },
    "./identity/work-scope": {
      readWorkScopeFromRow: (row) => {
        if (row.workScope == null) {
          return { mode: "solo", version: 1, clientId: row.clientId ?? null };
        }
        return typeof row.workScope === "string" ? JSON.parse(row.workScope) : row.workScope;
      },
      normalizeWorkScopedRow: (row) => ({
        ...row,
        workScope: row.workScope == null
          ? { mode: "solo", version: 1, clientId: row.clientId ?? null }
          : typeof row.workScope === "string" ? JSON.parse(row.workScope) : row.workScope,
      }),
      inheritWorkScope: (row) => {
        const scope = row.workScope == null
          ? { mode: "solo", version: 1, clientId: row.clientId ?? null }
          : typeof row.workScope === "string" ? JSON.parse(row.workScope) : row.workScope;
        const clientId = scope.mode === "team" ? scope.scope.clientId : scope.clientId;
        return { scope, serialized: JSON.stringify(scope), clientId };
      },
      getTeamIdForWorkScope: (scope) => scope.mode === "team" ? scope.scope.teamId : null,
      buildWorkScopeEnvironment: (scope, profileKey) => ({
        AI_OS_WORK_SCOPE_VERSION: "1",
        AI_OS_WORK_MODE: scope.mode,
        AI_OS_PROFILE_KEY: profileKey,
        AI_OS_CLIENT_ID: scope.mode === "team" ? scope.scope.clientId ?? "" : scope.clientId ?? "",
        ...(scope.mode === "team" ? {
          AI_OS_SERVER_ID: scope.scope.serverId,
          AI_OS_USER_ID: scope.scope.userId,
          AI_OS_TEAM_ID: scope.scope.teamId,
        } : {}),
      }),
    },
    "./workflow-agent-journal": {
      WorkflowAgentJournalBridge: WorkflowAgentJournalBridgeStub,
    },
    "@/types/question-spec": questionSpecModule,
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

test("module reloads keep one process cleanup listener and still clean active sessions", () => {
  resetProcessManagerSingleton();
  const cleanupEvents = ["exit", "SIGTERM", "SIGINT"];
  const baselineListeners = Object.fromEntries(cleanupEvents.map((event) => [event, process.listeners(event)]));
  const baselineCounts = Object.fromEntries(cleanupEvents.map((event) => [event, baselineListeners[event].length]));
  const dbStub = {
    getDb: () => ({
      prepare: () => ({
        run: () => ({ changes: 1 }),
      }),
    }),
  };
  const stubs = {
    "./db": dbStub,
    "./event-bus": {
      emitTaskEvent: () => {},
      emitChatEvent: () => {},
    },
    "./claude-parser": {
      ClaudeOutputParser: class {},
    },
  };
  let first;
  let second;
  let firstStops = 0;
  let secondStops = 0;

  const makeSession = (onStop) => ({
    proc: { pid: 12345 },
    runner: {
      stop: (signal) => {
        assert.equal(signal, "SIGTERM");
        onStop();
      },
    },
    pendingQuestion: false,
    totalCostUsd: 0,
    totalTokensUsed: 0,
    totalDurationMs: 0,
    resumedFromReview: false,
    closing: false,
    activeSubagents: new Map(),
    legacySubagentKeys: [],
  });

  try {
    first = loadProcessManagerModule(stubs, { resetSingleton: false }).processManager;
    for (const event of cleanupEvents) {
      assert.equal(process.listenerCount(event), baselineCounts[event] + 1);
    }

    const cleanupListener = process.listeners("SIGTERM").find(
      (listener) => !baselineListeners.SIGTERM.includes(listener)
    );
    assert.equal(typeof cleanupListener, "function");

    delete global.__processManager;
    second = loadProcessManagerModule(stubs, { resetSingleton: false }).processManager;
    assert.notEqual(first, second);
    for (const event of cleanupEvents) {
      assert.equal(process.listenerCount(event), baselineCounts[event] + 1);
    }

    first.sessions.set("listener-first", makeSession(() => {
      firstStops += 1;
    }));
    second.sessions.set("listener-second", makeSession(() => {
      secondStops += 1;
    }));

    cleanupListener();
    assert.equal(firstStops, 1);
    assert.equal(secondStops, 1);
    assert.equal(first.getActiveCount(), 0);
    assert.equal(second.getActiveCount(), 0);

    first.dispose();
    second.dispose();
    delete global.__processManager;
    for (const event of cleanupEvents) {
      assert.equal(process.listenerCount(event), baselineCounts[event]);
    }
  } finally {
    first?.dispose?.();
    second?.dispose?.();
    resetProcessManagerSingleton();
  }
});

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
        getConfig: () => ({ aiOsDir: workspaceDir }),
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
    resetProcessManagerSingleton();
    cleanupTempWorkspace(workspaceDir);
  }
});

test("startBacklogTaskFromReply claims a child backlog task once and starts a fresh turn", async () => {
  const workspaceDir = makeTempWorkspace();
  const now = new Date().toISOString();
  const task = {
    id: "child-backlog-reply",
    title: "HTML Guide Page",
    description: "Create the HTML guide page.",
    status: "backlog",
    level: "task",
    parentId: "parent-project",
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
    startedAt: null,
    lastReplyAt: null,
    activityLabel: null,
    errorMessage: null,
  };
  const db = createFakeDb(task);
  const emitEvents = [];
  const spawnCalls = [];
  const stdinWrites = [];
  let resolveWatcher;
  const watcherPromise = new Promise((resolve) => {
    resolveWatcher = resolve;
  });

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./config": {
        getConfig: () => ({ aiOsDir: workspaceDir }),
        getClientAiOsDir: (clientId) => path.join(workspaceDir, "clients", clientId),
      },
      "./event-bus": {
        emitTaskEvent: (event) => {
          emitEvents.push(event);
        },
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
      "./subprocess": {
        spawnManagedTaskProcess: (command, args, options) => {
          spawnCalls.push({ command, args: [...args], options });
          const proc = new EventEmitter();
          proc.stdout = new Readable({ read() { this.push(null); } });
          proc.stderr = new Readable({ read() { this.push(null); } });
          proc.stdin = {
            on() { return this; },
            write(value) { stdinWrites.push(value); return true; },
            end(value) { if (value) stdinWrites.push(value); },
          };
          proc.unref = () => {};
          proc.pid = 12345;
          return proc;
        },
        killChildProcessTree: () => {},
      },
    });

    const firstRun = processManager.startBacklogTaskFromReply(
      task.id,
      "Please start the HTML guide here",
      { logEntryId: "reply-1", permissionMode: "default" },
    );
    await Promise.resolve();
    assert.equal(processManager.hasActiveSession(task.id), true);

    const secondRun = await processManager.startBacklogTaskFromReply(
      task.id,
      "Duplicate start",
      { logEntryId: "reply-2", permissionMode: "default" },
    );
    assert.equal(secondRun, false);

    resolveWatcher();
    const firstStarted = await firstRun;

    assert.equal(firstStarted, true);
    assert.equal(db.state.task.status, "running");
    assert.equal(db.state.logsDeleted, 0);
    assert.equal(db.state.outputsDeleted, 1);
    assert.deepEqual(db.state.logs.filter((entry) => entry.type === "user_reply"), [{
      id: "reply-1",
      taskId: task.id,
      type: "user_reply",
      timestamp: db.state.logs[0].timestamp,
      content: "Please start the HTML guide here",
      permissionMode: "default",
    }]);
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].command, "claude");
    assert.equal(spawnCalls[0].args.includes("--input-format"), true);
    assert.equal(spawnCalls[0].args.includes("stream-json"), true);
    assert.equal(spawnCalls[0].args.includes("--resume"), false);
    assert.equal(spawnCalls[0].args.includes("--continue"), false);
    const initialMessage = decodeClaudeStreamUserMessage(stdinWrites[0]);
    assert.match(initialMessage, /Task: HTML Guide Page/);
    assert.match(initialMessage, /Initial user message:\nPlease start the HTML guide here/);
    assert.equal(
      emitEvents.some((event) => event.type === "task:status" && event.task.status === "running"),
      true,
    );
  } finally {
    resetProcessManagerSingleton();
    cleanupTempWorkspace(workspaceDir);
  }
});

test("executeTask runs branch tasks from copied logs without clearing history or resuming", async () => {
  const workspaceDir = makeTempWorkspace();
  const now = new Date().toISOString();
  const task = {
    id: "branch-task-1",
    title: "Edited branch",
    description: "Edited final user request",
    status: "queued",
    level: "task",
    parentId: null,
    projectSlug: null,
    clientId: null,
    needsInput: 0,
    phaseNumber: null,
    gsdStep: null,
    cronJobSlug: null,
    permissionMode: "bypassPermissions",
    executionPermissionMode: "bypassPermissions",
    createdAt: now,
    updatedAt: now,
    forkedFromTaskId: "source-task-1",
    forkedFromLogId: "source-log-2",
    claudeSessionId: null,
  };
  const db = createFakeDb(task);
  db.state.logs.push(
    {
      id: "copy-1",
      taskId: task.id,
      type: "user_reply",
      timestamp: now,
      content: "Original first message",
      permissionMode: "bypassPermissions",
    },
    {
      id: "copy-2",
      taskId: task.id,
      type: "text",
      timestamp: now,
      content: "Assistant response before edit",
    },
    {
      id: "copy-3",
      taskId: task.id,
      type: "user_reply",
      timestamp: now,
      content: "Edited final user request",
      permissionMode: "bypassPermissions",
    },
  );
  const emitEvents = [];
  const stdinWrites = [];
  const spawnCalls = [];

  try {
    const { processManager } = loadProcessManagerModule({
      "./config": {
        getConfig: () => ({ aiOsDir: workspaceDir }),
        getClientAiOsDir: (clientId) => path.join(workspaceDir, "clients", clientId),
      },
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: (event) => emitEvents.push(event),
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
      "./subprocess": {
        spawnManagedTaskProcess: (command, args) => {
          spawnCalls.push({ command, args: [...args] });
          const proc = new EventEmitter();
          proc.stdout = new Readable({ read() { this.push(null); } });
          proc.stderr = new Readable({ read() { this.push(null); } });
          proc.stdin = {
            on() { return this; },
            write(value) { stdinWrites.push(value); return true; },
            end(value) { if (value) stdinWrites.push(value); },
          };
          proc.unref = () => {};
          proc.pid = 12345;
          return proc;
        },
        killChildProcessTree: () => {},
      },
    });

    await processManager.executeTask(task.id);

    assert.equal(db.state.task.status, "running");
    assert.equal(db.state.logsDeleted, 0);
    assert.equal(db.state.outputsDeleted, 1);
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].args.includes("--resume"), false);
    assert.equal(spawnCalls[0].args.includes("--continue"), false);
    const prompt = decodeClaudeStreamUserMessage(stdinWrites[0]);
    assert.match(prompt, /^BRANCH PROMPT/);
    assert.match(prompt, /user_reply:Edited final user request/);
    assert.equal(
      emitEvents.some((event) => event.type === "task:status" && event.task.status === "running"),
      true,
    );
  } finally {
    resetProcessManagerSingleton();
    cleanupTempWorkspace(workspaceDir);
  }
});

test("storeClaudeSessionId does not mirror branch sessions to parent tasks", () => {
  let branchSessionId = null;
  let parentSessionId = null;
  const db = {
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      return {
        run(sessionId, taskId) {
          if (normalized === "UPDATE tasks SET claudeSessionId = ? WHERE id = ?") {
            if (taskId === "branch-child") {
              branchSessionId = sessionId;
            }
            if (taskId === "parent-project") {
              parentSessionId = sessionId;
            }
            return { changes: 1 };
          }
          throw new Error(`Unhandled run SQL: ${normalized}`);
        },
        get(taskId) {
          if (normalized.includes("FROM tasks c JOIN tasks p ON c.parentId = p.id WHERE c.id = ?")) {
            assert.equal(taskId, "branch-child");
            return {
              id: "parent-project",
              level: "project",
              claudeSessionId: null,
              forkedFromTaskId: "source-task",
            };
          }
          throw new Error(`Unhandled get SQL: ${normalized}`);
        },
      };
    },
  };

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: () => {},
        emitChatEvent: () => {},
      },
      "./claude-parser": {
        ClaudeOutputParser: class {},
      },
    });

    processManager.storeClaudeSessionId("branch-child", "branch-session");

    assert.equal(branchSessionId, "branch-session");
    assert.equal(parentSessionId, null);
  } finally {
    resetProcessManagerSingleton();
  }
});

test("cancelTask moves a running task to review and records a stopped system log", async () => {
  const now = new Date().toISOString();
  const task = {
    id: "task-stop-1",
    title: "Running task",
    description: "Stop me",
    status: "running",
    level: "task",
    parentId: null,
    projectSlug: null,
    clientId: null,
    needsInput: 0,
    startedAt: now,
    completedAt: null,
    costUsd: 1.23,
    tokensUsed: 456,
    durationMs: 789,
    errorMessage: "old error",
    claudePid: 12345,
    claudeSessionId: "session-stop-1",
    activityLabel: "Working",
    createdAt: now,
    updatedAt: now,
  };
  const db = createFakeDb(task);
  const emitEvents = [];
  const terminatedPids = [];
  const revokedTaskIds = [];

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: (event) => emitEvents.push(event),
        emitChatEvent: () => {},
      },
      "./claude-parser": {
        ClaudeOutputParser: class {},
      },
      "./subprocess": {
        spawnManagedTaskProcess: () => { throw new Error("spawn should not run"); },
        killChildProcessTree: () => {},
        terminateProcessTreeByPid: async (pid) => {
          terminatedPids.push(pid);
          return { pid, stopped: true };
        },
      },
      "./task-permission-rules": {
        revokeTaskPermissionRules: (taskId) => {
          revokedTaskIds.push(taskId);
          return 1;
        },
      },
    });

    processManager.sessions.set(task.id, {
      proc: { pid: 12345 },
      pendingQuestion: false,
      totalCostUsd: 0,
      totalTokensUsed: 0,
      totalDurationMs: 0,
      resumedFromReview: false,
      closing: false,
      activeSubagents: new Map(),
      activeWorkflowRuns: new Map(),
      terminalizingWorkflowRuns: new Set(),
      workflowParentCompletionPending: false,
      legacySubagentKeys: [],
    });
    processManager.handleWorkflowLaunch(task.id, {
      toolUseId: "toolu-stop-workflow",
      taskId: "workflow-task-stop",
      runId: "run-stop-workflow",
      transcriptDir: path.join(
        os.homedir(),
        ".claude",
        "projects",
        "project-a",
        "session-stop-1",
        "subagents",
        "workflows",
        "run-stop-workflow",
      ),
    });
    await new Promise((resolve) => setImmediate(resolve));

    await processManager.cancelTask(task.id);

    assert.equal(db.state.task.status, "review");
    assert.equal(db.state.task.activityLabel, "Stopped by user");
    assert.equal(db.state.task.costUsd, null);
    assert.equal(db.state.task.tokensUsed, null);
    assert.equal(db.state.task.durationMs, null);
    assert.equal(db.state.task.errorMessage, null);
    assert.equal(db.state.task.startedAt, null);
    assert.equal(db.state.task.completedAt, null);
    assert.equal(db.state.task.needsInput, 0);
    assert.equal(db.state.task.claudePid, null);
    assert.deepEqual(terminatedPids, [12345]);
    assert.deepEqual(revokedTaskIds, [task.id]);
    assert.equal(
      processManager.workflowJournalBridge.getSnapshot(task.id, "run-stop-workflow").terminal.status,
      "stopped",
    );
    assert.equal(
      emitEvents.some((event) => event.type === "task:status" && event.task.activityLabel === "Collecting agent results"),
      false,
    );
    assert.equal(
      db.state.logs.some((log) => log.taskId === task.id && log.type === "system" && log.content === "Stopped by user"),
      true,
    );
    assert.equal(
      emitEvents.some((event) => event.type === "task:status" && event.task.status === "review"),
      true,
    );

    const logCountAfterStop = db.state.logs.length;
    processManager.workflowJournalBridge.callbacks.onAgentStarted({
      hostTaskId: task.id,
      workflowTaskId: "workflow-task-stop",
      sessionId: "session-stop-1",
      runId: "run-stop-workflow",
      parentToolUseId: "toolu-stop-workflow",
      transcriptDir: "ignored",
      agentId: "late-agent",
      journalKey: "late-agent-key",
      agentIndex: 1,
      agentLabel: "Late agent",
      toolUseId: "workflow:run-stop-workflow:late-agent",
      observedAt: new Date().toISOString(),
      synthesized: false,
    });
    assert.equal(db.state.logs.length, logCountAfterStop);

    const observeCountAfterStop = processManager.workflowJournalBridge.observeCalls.length;
    processManager.workflowJournalBridge.runs.clear();
    db.state.task.cancelRequestedAt = null;
    processManager.getLogEntries(task.id);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(processManager.workflowJournalBridge.observeCalls.length, observeCountAfterStop);
  } finally {
    resetProcessManagerSingleton();
  }
});

test("cancelTask waits for an initializing worker to acknowledge cancellation", async () => {
  const now = new Date().toISOString();
  const task = {
    id: "task-stop-initializing",
    title: "Initializing task",
    description: "Stop before spawn",
    status: "running",
    level: "task",
    parentId: null,
    projectSlug: null,
    clientId: null,
    needsInput: 0,
    claudePid: -1,
    cancelRequestedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const db = createFakeDb(task);

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": { emitTaskEvent: () => {}, emitChatEvent: () => {} },
      "./claude-parser": { ClaudeOutputParser: class {} },
    });

    const acknowledgement = setTimeout(() => {
      db.state.task.claudePid = null;
    }, 75);
    const startedAt = Date.now();
    await processManager.cancelTask(task.id);
    clearTimeout(acknowledgement);

    assert.ok(Date.now() - startedAt >= 50);
    assert.equal(db.state.task.status, "review");
    assert.equal(db.state.task.activityLabel, "Stopped by user");
  } finally {
    resetProcessManagerSingleton();
  }
});

test("archive quiesce blocks startup and shuts down sessions without applying cancel semantics", async () => {
  for (const scenario of [
    { status: "queued", archivedAt: null },
    { status: "running", archivedAt: null },
    { status: "review", archivedAt: null },
    { status: "done", archivedAt: null },
    { status: "done", archivedAt: "already-archived" },
  ]) {
    const task = {
      id: `archive-${scenario.status}-${scenario.archivedAt ? "old" : "new"}`,
      title: "Archive lifecycle",
      status: scenario.status,
      archivedAt: scenario.archivedAt,
      level: "task",
      parentId: null,
      clientId: null,
      workScope: SOLO_WORK_SCOPE,
      cancelRequestedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const db = createFakeDb(task);
    const stoppedWorkflows = [];
    const killedSessions = [];

    try {
      const { processManager } = loadProcessManagerModule({
        "./db": { getDb: () => db },
        "./event-bus": { emitTaskEvent: () => {}, emitChatEvent: () => {} },
        "./claude-parser": { ClaudeOutputParser: class {} },
      });
      processManager.workflowJournalBridge.stopTask = async (taskId, summary) => {
        stoppedWorkflows.push([taskId, summary]);
      };
      processManager.killSessionInProfile = async (taskId) => {
        killedSessions.push(taskId);
      };

      await processManager.quiesceTaskForArchive(task.id);

      assert.ok(db.state.task.cancelRequestedAt);
      assert.equal(db.state.task.status, scenario.status);
      assert.equal(db.state.logs.length, 0);
      assert.deepEqual(stoppedWorkflows, [[task.id, "Goal archived"]]);
      assert.deepEqual(killedSessions, [task.id]);
    } finally {
      resetProcessManagerSingleton();
    }
  }
});

test("archive quiesce still kills the process when workflow shutdown fails", async () => {
  const task = {
    id: "archive-all-settled",
    title: "Archive all settled",
    status: "running",
    level: "task",
    parentId: null,
    clientId: null,
    workScope: SOLO_WORK_SCOPE,
    cancelRequestedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const db = createFakeDb(task);
  let killAttempted = false;

  try {
    const { processManager, TaskCancellationError } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": { emitTaskEvent: () => {}, emitChatEvent: () => {} },
      "./claude-parser": { ClaudeOutputParser: class {} },
    });
    processManager.workflowJournalBridge.stopTask = async () => {
      throw new Error("workflow stop failed");
    };
    processManager.killSessionInProfile = async () => {
      killAttempted = true;
    };

    await assert.rejects(
      () => processManager.quiesceTaskForArchive(task.id),
      (error) => error instanceof TaskCancellationError && error.status === 503,
    );
    assert.equal(killAttempted, true);
    assert.ok(db.state.task.cancelRequestedAt);
    assert.equal(db.state.task.status, "running");
  } finally {
    resetProcessManagerSingleton();
  }
});

test("replyToTask reuses a live persistent process instead of spawning resume", async () => {
  const now = new Date().toISOString();
  const task = {
    id: "task-live-reply",
    title: "Live reply task",
    description: "Keep the same Claude process.",
    status: "review",
    level: "task",
    parentId: null,
    projectSlug: null,
    clientId: null,
    needsInput: 1,
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
  const sentMessages = [];
  const killedPids = [];

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: () => {},
        emitChatEvent: () => {},
      },
      "./claude-parser": {
        ClaudeOutputParser: class {
          constructor() {}
          feedLine() {}
          get isCompleted() { return false; }
        },
      },
      "./subprocess": {
        spawnManagedTaskProcess: () => {
          throw new Error("spawnManagedTaskProcess should not run when a live session exists");
        },
        killChildProcessTree: (proc) => {
          killedPids.push(proc.pid);
        },
      },
    });

    processManager.sessions.set(task.id, {
      proc: { pid: 2468 },
      runner: {
        sendUserMessage(value) {
          sentMessages.push(value);
          return true;
        },
        stop() {
          killedPids.push(2468);
        },
      },
      pendingQuestion: false,
      totalCostUsd: 0,
      totalTokensUsed: 0,
      totalDurationMs: 0,
      resumedFromReview: false,
      closing: false,
      activeSubagents: new Map(),
      legacySubagentKeys: [],
      workScope: SOLO_WORK_SCOPE,
    });
    processManager.waitingForReply.add(task.id);

    const replied = await processManager.replyToTask(task.id, "Please continue in the same process");

    assert.equal(replied, true);
    assert.deepEqual(sentMessages, ["Please continue in the same process"]);
    assert.deepEqual(killedPids, []);
    assert.equal(processManager.sessions.has(task.id), true);
    assert.equal(processManager.waitingForReply.has(task.id), false);
    assert.equal(db.state.task.claudePid, 2468);
  } finally {
    resetProcessManagerSingleton();
  }
});

test("spawnContinueTurn after restore resumes the saved session without clearing conversation history", async () => {
  const now = new Date().toISOString();
  const task = {
    id: "task-restored-reply",
    title: "Restored reply task",
    description: "The original prompt must not run again.",
    status: "running",
    level: "task",
    parentId: null,
    projectSlug: null,
    clientId: null,
    workScope: SOLO_WORK_SCOPE,
    needsInput: 0,
    phaseNumber: null,
    gsdStep: null,
    cronJobSlug: null,
    permissionMode: "bypassPermissions",
    model: null,
    thinkingEffort: null,
    claudeSessionId: "session-before-archive",
    cancelRequestedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const db = createFakeDb(task);
  db.state.logs.push(
    {
      id: "original-user-log",
      taskId: task.id,
      type: "user_reply",
      timestamp: now,
      content: task.description,
    },
    {
      id: "original-assistant-log",
      taskId: task.id,
      type: "text",
      timestamp: now,
      content: "Original response",
    },
    {
      id: "restored-user-reply",
      taskId: task.id,
      type: "user_reply",
      timestamp: now,
      content: "Continue after restore",
    },
  );
  const persistedHistory = structuredClone(db.state.logs);
  const spawnCalls = [];
  const stdinWrites = [];

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": { emitTaskEvent: () => {}, emitChatEvent: () => {} },
      "./claude-parser": {
        ClaudeOutputParser: class {
          constructor() {}
          feedLine() {}
          get isCompleted() { return false; }
        },
      },
      "./subprocess": {
        spawnManagedTaskProcess: (command, args, options) => {
          spawnCalls.push({ command, args: [...args], options });
          const proc = new EventEmitter();
          proc.stdout = new Readable({ read() {} });
          proc.stderr = new Readable({ read() {} });
          proc.stdin = {
            writable: true,
            writableEnded: false,
            destroyed: false,
            on() { return this; },
            write(value) { stdinWrites.push(value); return true; },
            end() {},
          };
          proc.unref = () => {};
          proc.pid = 9877;
          return proc;
        },
        killChildProcessTree: () => {},
      },
    });

    await processManager.spawnContinueTurn(task.id, "Continue after restore", true);

    assert.equal(spawnCalls.length, 1);
    const resumeIndex = spawnCalls[0].args.indexOf("--resume");
    assert.notEqual(resumeIndex, -1);
    assert.equal(spawnCalls[0].args[resumeIndex + 1], "session-before-archive");
    assert.deepEqual(stdinWrites.map(decodeClaudeStreamUserMessage), ["Continue after restore"]);
    assert.equal(db.state.task.claudeSessionId, "session-before-archive");
    assert.equal(db.state.logsDeleted, 0);
    assert.equal(db.state.outputsDeleted, 0);
    assert.deepEqual(db.state.logs, persistedHistory);
    assert.deepEqual(
      db.state.logs.map((entry) => [entry.type, entry.content]),
      [
        ["user_reply", "The original prompt must not run again."],
        ["text", "Original response"],
        ["user_reply", "Continue after restore"],
      ],
    );
  } finally {
    resetProcessManagerSingleton();
  }
});

test("spawnContinueTurn without a saved session fails safely without starting Claude or clearing history", async () => {
  const now = new Date().toISOString();
  const task = {
    id: "task-restored-without-session",
    title: "Restored task without session",
    description: "Do not continue an unrelated Claude conversation.",
    status: "running",
    level: "task",
    parentId: null,
    projectSlug: null,
    clientId: null,
    workScope: SOLO_WORK_SCOPE,
    needsInput: 0,
    phaseNumber: null,
    gsdStep: null,
    cronJobSlug: null,
    permissionMode: "bypassPermissions",
    model: null,
    thinkingEffort: null,
    claudeSessionId: null,
    cancelRequestedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const db = createFakeDb(task);
  db.state.logs.push(
    {
      id: "original-user-log-no-session",
      taskId: task.id,
      type: "user_reply",
      timestamp: now,
      content: task.description,
    },
    {
      id: "restored-user-reply-no-session",
      taskId: task.id,
      type: "user_reply",
      timestamp: now,
      content: "Continue after restore",
    },
  );
  const persistedHistory = structuredClone(db.state.logs);
  const spawnCalls = [];

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": { emitTaskEvent: () => {}, emitChatEvent: () => {} },
      "./claude-parser": {
        ClaudeOutputParser: class {
          constructor() {}
          feedLine() {}
          get isCompleted() { return false; }
        },
      },
      "./subprocess": {
        spawnManagedTaskProcess: (...args) => {
          spawnCalls.push(args);
          throw new Error("Claude must not start without the task's saved session");
        },
        killChildProcessTree: () => {},
      },
    });

    await processManager.spawnContinueTurn(task.id, "Continue after restore", true);

    assert.deepEqual(spawnCalls, []);
    assert.equal(db.state.task.status, "review");
    assert.equal(db.state.task.needsInput, 1);
    assert.equal(db.state.task.claudePid, null);
    assert.match(db.state.task.errorMessage, /saved Claude session is unavailable/i);
    assert.equal(db.state.logsDeleted, 0);
    assert.equal(db.state.outputsDeleted, 0);
    assert.deepEqual(db.state.logs, persistedHistory);
  } finally {
    resetProcessManagerSingleton();
  }
});

test("task overlay cleanup is contained to the active Team profile", () => {
  const deleted = [];
  const profile = {
    version: 1,
    mode: "team",
    profileKey: "profile-a",
    identity: { version: 1, serverId: "server-1", userId: "user-1" },
    dataDir: "C:\\profiles\\profile-a",
    stateDir: "C:\\profiles\\profile-a\\state",
    tempDir: "C:\\profiles\\profile-a\\tmp",
    dbPath: "C:\\profiles\\profile-a\\data.db",
  };
  try {
    const { processManager } = loadProcessManagerModule({
      "./db": {
        getActiveLocalProfileDescriptor: () => profile,
        getDb: () => ({ prepare: () => ({ run: () => ({ changes: 1 }) }) }),
      },
      "./event-bus": { emitTaskEvent: () => {}, emitChatEvent: () => {} },
      "./claude-parser": { ClaudeOutputParser: class {} },
      "./runtime-context-overlay": {
        RuntimeContextOverlayError: class RuntimeContextOverlayError extends Error {},
        loadRuntimeContextOverlay: () => null,
        createOrLoadRuntimeContextOverlay: () => null,
        deleteRuntimeContextOverlay: (expectation) => deleted.push(expectation),
      },
    });

    processManager.removeTaskContextOverlay("task-delete-me");
    assert.deepEqual(deleted, [{
      profileTempDir: profile.tempDir,
      ownerType: "task",
      ownerId: "task-delete-me",
    }]);
  } finally {
    resetProcessManagerSingleton();
  }
});

test("replyToTask restarts a Team chat in conversation-only mode when enrichment is unavailable", async () => {
  const now = new Date().toISOString();
  const task = {
    id: "task-detached-reply",
    title: "Detached Team reply",
    description: "Keep the saved Claude context without Team enrichment.",
    status: "review",
    level: "task",
    parentId: null,
    projectSlug: null,
    clientId: null,
    needsInput: 1,
    phaseNumber: null,
    gsdStep: null,
    cronJobSlug: null,
    permissionMode: "bypassPermissions",
    model: null,
    thinkingEffort: null,
    claudeSessionId: "saved-team-session",
    createdAt: now,
    updatedAt: now,
    workScope: TEAM_WORK_SCOPE,
  };
  const db = createFakeDb(task);
  const stopped = [];
  const spawnCalls = [];

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": { emitTaskEvent: () => {}, emitChatEvent: () => {} },
      "./claude-parser": { ClaudeOutputParser: class { constructor() {} feedLine() {} get isCompleted() { return false; } } },
      "./team-api-context": {
        fetchTeamContextSnapshot: async () => { throw new Error("membership revoked"); },
      },
      "./subprocess": {
        spawnManagedTaskProcess: (command, args, options) => {
          spawnCalls.push({ command, args: [...args], options });
          const proc = new EventEmitter();
          proc.stdout = new Readable({ read() {} });
          proc.stderr = new Readable({ read() {} });
          proc.stdin = { on() { return this; }, write() { return true; }, end() {} };
          proc.unref = () => {};
          proc.pid = 9876;
          return proc;
        },
        killChildProcessTree: () => {},
      },
    });

    processManager.sessions.set(task.id, {
      proc: { pid: 2468 },
      runner: { sendUserMessage() { return true; }, stop() { stopped.push(2468); } },
      pendingQuestion: false,
      totalCostUsd: 0,
      totalTokensUsed: 0,
      totalDurationMs: 0,
      resumedFromReview: false,
      closing: false,
      activeSubagents: new Map(),
      legacySubagentKeys: [],
      workScope: TEAM_WORK_SCOPE,
      teamEnrichmentMode: "authorized",
    });
    processManager.waitingForReply.add(task.id);

    const replied = await processManager.replyToTask(task.id, "Continue without Team data");

    assert.equal(replied, true);
    assert.deepEqual(stopped, [2468]);
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].options.env.AI_OS_TEAM_ENRICHMENT, "conversation_only");
    assert.equal(spawnCalls[0].options.env.AI_OS_SKIP_MEMORY_CAPTURE, "1");
    assert.ok(spawnCalls[0].args.includes("--resume"));
    assert.ok(spawnCalls[0].args.includes("saved-team-session"));
  } finally {
    resetProcessManagerSingleton();
  }
});

test("replyToTask blocks conversation-only fallback when no saved Claude session exists", async () => {
  const now = new Date().toISOString();
  const task = {
    id: "task-detached-no-session",
    title: "Detached Team reply without a session",
    description: "Never resume an unrelated last session.",
    status: "review",
    level: "task",
    parentId: null,
    projectSlug: null,
    clientId: null,
    needsInput: 1,
    phaseNumber: null,
    gsdStep: null,
    cronJobSlug: null,
    permissionMode: "bypassPermissions",
    model: null,
    thinkingEffort: null,
    claudeSessionId: null,
    createdAt: now,
    updatedAt: now,
    workScope: TEAM_WORK_SCOPE,
  };
  const db = createFakeDb(task);
  let spawnCalls = 0;

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": { emitTaskEvent: () => {}, emitChatEvent: () => {} },
      "./claude-parser": { ClaudeOutputParser: class { constructor() {} feedLine() {} get isCompleted() { return false; } } },
      "./team-api-context": {
        fetchTeamContextSnapshot: async () => { throw new Error("membership revoked"); },
      },
      "./subprocess": {
        spawnManagedTaskProcess: () => {
          spawnCalls += 1;
          throw new Error("must not spawn");
        },
        killChildProcessTree: () => {},
      },
    });

    processManager.waitingForReply.add(task.id);
    const replied = await processManager.replyToTask(task.id, "Continue");

    assert.equal(replied, true);
    assert.equal(spawnCalls, 0);
    assert.equal(db.state.task.status, "review");
    assert.match(db.state.task.errorMessage, /saved Claude session is unavailable/i);
  } finally {
    resetProcessManagerSingleton();
  }
});

test("live permission changes are acknowledged before the next user message", async () => {
  const now = new Date().toISOString();
  const task = {
    id: "task-live-permission",
    title: "Live permission task",
    description: "Change mode without restarting.",
    status: "review",
    level: "task",
    parentId: null,
    projectSlug: null,
    clientId: null,
    needsInput: 1,
    phaseNumber: null,
    gsdStep: null,
    cronJobSlug: null,
    permissionMode: "default",
    executionPermissionMode: "default",
    model: "sonnet",
    thinkingEffort: null,
    createdAt: now,
    updatedAt: now,
  };
  const db = createFakeDb(task);
  const order = [];

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": { emitTaskEvent: () => {}, emitChatEvent: () => {} },
      "./claude-parser": {
        ClaudeOutputParser: class {
          feedLine() {}
          get isCompleted() { return false; }
        },
      },
      "./subprocess": {
        spawnManagedTaskProcess: () => { throw new Error("spawn should not run"); },
        killChildProcessTree: () => {},
      },
    });

    const session = {
      proc: { pid: 9876 },
      runner: {
        sendUserMessage() {
          order.push("user");
          return true;
        },
        sendPermissionModeControl(requestId, mode) {
          order.push(`control:${mode}`);
          queueMicrotask(() => {
            processManager.handleControlResponse(session, JSON.stringify({
              type: "control_response",
              response: {
                subtype: "success",
                request_id: requestId,
                response: { mode },
              },
            }));
          });
          return true;
        },
        stop() {},
      },
      pendingQuestion: false,
      totalCostUsd: 0,
      totalTokensUsed: 0,
      totalDurationMs: 0,
      resumedFromReview: false,
      closing: false,
      activeSubagents: new Map(),
      legacySubagentKeys: [],
      pendingControlRequests: new Map(),
      permissionChangeQueue: Promise.resolve(),
      appliedPermissionMode: "default",
      workScope: SOLO_WORK_SCOPE,
    };
    processManager.sessions.set(task.id, session);
    processManager.waitingForReply.add(task.id);

    await processManager.applyPermissionState(task.id, {
      permissionMode: "auto",
      executionPermissionMode: "auto",
    });
    await processManager.replyToTask(task.id, "Continue with Auto");

    assert.deepEqual(order, ["control:auto", "user"]);
    assert.equal(db.state.task.permissionMode, "auto");
    assert.equal(db.state.task.executionPermissionMode, "auto");
    assert.equal(session.appliedPermissionMode, "auto");
  } finally {
    resetProcessManagerSingleton();
  }
});

test("a rejected live permission change leaves the stored mode unchanged", async () => {
  const now = new Date().toISOString();
  const task = {
    id: "task-rejected-permission",
    title: "Rejected permission task",
    description: "Keep the old mode on rejection.",
    status: "running",
    level: "task",
    parentId: null,
    projectSlug: null,
    clientId: null,
    needsInput: 0,
    cronJobSlug: null,
    permissionMode: "default",
    executionPermissionMode: "default",
    model: "sonnet",
    createdAt: now,
    updatedAt: now,
  };
  const db = createFakeDb(task);

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": { emitTaskEvent: () => {}, emitChatEvent: () => {} },
      "./claude-parser": {
        ClaudeOutputParser: class {
          feedLine() {}
          get isCompleted() { return false; }
        },
      },
      "./subprocess": {
        spawnManagedTaskProcess: () => { throw new Error("spawn should not run"); },
        killChildProcessTree: () => {},
      },
    });

    const session = {
      proc: { pid: 8765 },
      runner: {
        sendUserMessage() { return true; },
        sendPermissionModeControl(requestId) {
          queueMicrotask(() => {
            processManager.handleControlResponse(session, JSON.stringify({
              type: "control_response",
              response: {
                subtype: "error",
                request_id: requestId,
                error: "Auto is unavailable for this account",
              },
            }));
          });
          return true;
        },
        stop() {},
      },
      pendingQuestion: false,
      totalCostUsd: 0,
      totalTokensUsed: 0,
      totalDurationMs: 0,
      resumedFromReview: false,
      closing: false,
      activeSubagents: new Map(),
      legacySubagentKeys: [],
      pendingControlRequests: new Map(),
      permissionChangeQueue: Promise.resolve(),
      appliedPermissionMode: "default",
      workScope: SOLO_WORK_SCOPE,
    };
    processManager.sessions.set(task.id, session);

    await assert.rejects(
      processManager.applyPermissionState(task.id, {
        permissionMode: "auto",
        executionPermissionMode: "auto",
      }),
      /unavailable for this account/,
    );
    assert.equal(db.state.task.permissionMode, "default");
    assert.equal(db.state.task.executionPermissionMode, "default");
    assert.equal(processManager.sessions.has(task.id), true);
  } finally {
    resetProcessManagerSingleton();
  }
});

test("turn completion keeps top-level persistent process alive for replies", () => {
  const now = new Date().toISOString();
  const task = {
    id: "task-live-after-result",
    title: "Live after result",
    description: "Result should finish a turn, not the process.",
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
  const killedPids = [];
  const emittedEvents = [];

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: (event) => emittedEvents.push(event),
        emitChatEvent: () => {},
      },
      "./subprocess": {
        spawnManagedTaskProcess: () => {
          throw new Error("spawnManagedTaskProcess should not be called in this test");
        },
        killChildProcessTree: (proc) => {
          killedPids.push(proc.pid);
        },
      },
      "./claude-parser": {
        ClaudeOutputParser: class {},
      },
    });

    processManager.buildCompletionSummary = () => "Claude has finished this step";
    processManager.sessions.set(task.id, {
      proc: { pid: 8642 },
      runner: {
        sendUserMessage() { return true; },
        stop() { killedPids.push(8642); },
      },
      pendingQuestion: false,
      totalCostUsd: 0,
      totalTokensUsed: 0,
      totalDurationMs: 0,
      resumedFromReview: false,
      closing: false,
      activeSubagents: new Map(),
      legacySubagentKeys: [],
    });

    processManager.handleTurnComplete(task.id, {
      costUsd: 0.25,
      tokensUsed: 50,
      durationMs: 1200,
    });

    assert.equal(db.state.task.status, "review");
    assert.equal(db.state.task.needsInput, 1);
    assert.equal(db.state.task.claudePid, 8642);
    assert.equal(processManager.sessions.has(task.id), true);
    assert.equal(processManager.waitingForReply.has(task.id), true);
    assert.deepEqual(killedPids, []);
    assert.equal(
      emittedEvents.some((event) => event.type === "task:status" && event.task.status === "review"),
      true,
    );
  } finally {
    resetProcessManagerSingleton();
  }
});

test("turn completion moves finished subchat to review instead of done", () => {
  const now = new Date().toISOString();
  const task = {
    id: "task-subchat-finished",
    title: "Finished subchat",
    description: "Child work",
    status: "running",
    level: "task",
    parentId: "parent-goal",
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
    completedAt: null,
    claudePid: 9753,
  };
  const db = createFakeDb(task);
  const emittedEvents = [];
  const stoppedPids = [];

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: (event) => emittedEvents.push(event),
        emitChatEvent: () => {},
      },
      "./subprocess": {
        spawnManagedTaskProcess: () => {
          throw new Error("spawnManagedTaskProcess should not be called in this test");
        },
        killChildProcessTree: (proc) => {
          stoppedPids.push(proc.pid);
        },
      },
      "./claude-parser": {
        ClaudeOutputParser: class {},
      },
    });

    processManager.buildCompletionSummary = () => "Subchat finished";
    processManager.sessions.set(task.id, {
      proc: { pid: 9753 },
      pendingQuestion: false,
      totalCostUsd: 0,
      totalTokensUsed: 0,
      totalDurationMs: 0,
      resumedFromReview: false,
      closing: false,
      activeSubagents: new Map(),
      legacySubagentKeys: [],
    });

    processManager.handleTurnComplete(task.id, {
      costUsd: 0.12,
      tokensUsed: 42,
      durationMs: 900,
    });

    assert.equal(db.state.task.status, "review");
    assert.equal(db.state.task.completedAt, null);
    assert.equal(db.state.task.needsInput, 1);
    assert.equal(db.state.task.activityLabel, "Subchat finished");
    assert.equal(db.state.task.claudePid, null);
    assert.equal(processManager.sessions.has(task.id), false);
    assert.deepEqual(stoppedPids, [9753]);
    assert.equal(
      emittedEvents.some((event) => event.type === "task:status" && event.task.status === "review"),
      true,
    );
    assert.equal(
      emittedEvents.some((event) => event.type === "task:status" && event.task.status === "done"),
      false,
    );
  } finally {
    resetProcessManagerSingleton();
  }
});

test("turn completion still moves cron tasks to done", () => {
  const now = new Date().toISOString();
  const task = {
    id: "task-cron-finished",
    title: "Finished cron",
    description: "Cron work",
    status: "running",
    level: "task",
    parentId: null,
    projectSlug: null,
    clientId: null,
    needsInput: 0,
    phaseNumber: null,
    gsdStep: null,
    cronJobSlug: "nightly-job",
    permissionMode: "default",
    model: null,
    thinkingEffort: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    claudePid: 86420,
  };
  const db = createFakeDb(task);
  const cronRunPayloads = [];

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: () => {},
        emitChatEvent: () => {},
      },
      "./cron-service": {
        completeCronRunForTask: (_task, payload) => {
          cronRunPayloads.push(payload);
        },
      },
      "./subprocess": {
        spawnManagedTaskProcess: () => {
          throw new Error("spawnManagedTaskProcess should not be called in this test");
        },
        killChildProcessTree: () => {},
      },
      "./claude-parser": {
        ClaudeOutputParser: class {},
      },
    });

    processManager.buildCompletionSummary = () => "Cron finished";
    processManager.sessions.set(task.id, {
      proc: { pid: 86420 },
      pendingQuestion: false,
      totalCostUsd: 0,
      totalTokensUsed: 0,
      totalDurationMs: 0,
      resumedFromReview: false,
      closing: false,
      activeSubagents: new Map(),
      legacySubagentKeys: [],
    });

    processManager.handleTurnComplete(task.id, {
      costUsd: 0.2,
      tokensUsed: 55,
      durationMs: 1200,
    });

    assert.equal(db.state.task.status, "done");
    assert.ok(db.state.task.completedAt);
    assert.equal(db.state.task.needsInput, 0);
    assert.equal(db.state.task.activityLabel, "Cron finished");
    assert.equal(cronRunPayloads.length, 1);
    assert.equal(cronRunPayloads[0].result, "success");
  } finally {
    resetProcessManagerSingleton();
  }
});

test("active subagent keeps task running when a result message arrives", () => {
  const now = new Date().toISOString();
  const task = {
    id: "task-active-agent-result",
    title: "Active agent result",
    description: "Result should not become user turn while an agent is open.",
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

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: () => {},
        emitChatEvent: () => {},
      },
      "./subprocess": {
        spawnManagedTaskProcess: () => {
          throw new Error("spawnManagedTaskProcess should not be called in this test");
        },
        killChildProcessTree: () => {},
      },
      "./claude-parser": {
        ClaudeOutputParser: class {},
      },
    });

    processManager.sessions.set(task.id, {
      proc: { pid: 2222 },
      runner: {
        sendUserMessage() { return true; },
        stop() {},
      },
      pendingQuestion: false,
      totalCostUsd: 0,
      totalTokensUsed: 0,
      totalDurationMs: 0,
      resumedFromReview: false,
      closing: false,
      activeSubagents: new Map(),
      legacySubagentKeys: [],
    });

    processManager.addLogEntry(task.id, {
      id: "log-agent-open",
      type: "tool_use",
      timestamp: now,
      content: "Agent",
      toolName: "Agent",
      toolArgs: JSON.stringify({ subagent_type: "Ramanujan", prompt: "Wait and report back." }),
      toolUseId: "toolu-agent-open",
    });
    processManager.handleTurnComplete(task.id, {
      costUsd: 0.5,
      tokensUsed: 100,
      durationMs: 19000,
    });

    assert.equal(db.state.task.status, "running");
    assert.equal(db.state.task.needsInput, 0);
    assert.equal(db.state.task.activityLabel, "Waiting for 1 agent to finish");
    assert.equal(db.state.task.claudePid, 2222);
    assert.equal(processManager.waitingForReply.has(task.id), false);
    assert.equal(processManager.sessions.get(task.id).activeSubagents.size, 1);
  } finally {
    resetProcessManagerSingleton();
  }
});

test("three agents close out of order and wait for the parent summary result", () => {
  const now = new Date().toISOString();
  const task = {
    id: "task-three-agent-lifecycle",
    title: "Three agent lifecycle",
    description: "Track every agent until the parent summarizes their work.",
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

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": { emitTaskEvent: () => {}, emitChatEvent: () => {} },
      "./subprocess": {
        spawnManagedTaskProcess: () => {
          throw new Error("spawnManagedTaskProcess should not be called in this test");
        },
        killChildProcessTree: () => {},
      },
      "./claude-parser": { ClaudeOutputParser: class {} },
    });

    processManager.buildCompletionSummary = () => "Claude summarized all agent results";
    processManager.sessions.set(task.id, {
      proc: { pid: 9898 },
      runner: { sendUserMessage() { return true; }, stop() {} },
      pendingQuestion: false,
      totalCostUsd: 0,
      totalTokensUsed: 0,
      totalDurationMs: 0,
      resumedFromReview: false,
      closing: false,
      activeSubagents: new Map(),
      legacySubagentKeys: [],
    });

    for (const index of [1, 2, 3]) {
      processManager.addLogEntry(task.id, {
        id: `log-three-agent-${index}`,
        type: "tool_use",
        timestamp: now,
        content: "Agent",
        toolName: "Agent",
        toolArgs: JSON.stringify({ description: `Agent ${index}`, prompt: `Run check ${index}.` }),
        toolUseId: `toolu-three-agent-${index}`,
      });
    }

    assert.equal(processManager.sessions.get(task.id).activeSubagents.size, 3);
    processManager.handleTurnComplete(task.id, {
      costUsd: 0.6,
      tokensUsed: 120,
      durationMs: 12000,
    });
    assert.equal(processManager.sessions.get(task.id).activeSubagents.size, 3);
    assert.equal(db.state.task.activityLabel, "Waiting for 3 agents to finish");

    for (const [toolUseId, remaining] of [
      ["toolu-three-agent-2", 2],
      ["toolu-three-agent-1", 1],
      ["toolu-three-agent-3", 0],
    ]) {
      processManager.addLogEntry(task.id, {
        id: `result-${toolUseId}`,
        type: "tool_result",
        timestamp: now,
        content: "Agent finished",
        toolName: "AgentNotification",
        toolResult: "Agent finished",
        toolUseId,
      });
      assert.equal(processManager.sessions.get(task.id).activeSubagents.size, remaining);
    }

    assert.equal(db.state.task.status, "running");
    assert.equal(db.state.task.activityLabel, "Collecting agent results");
    assert.equal(db.state.task.needsInput, 0);
    assert.equal(processManager.waitingForReply.has(task.id), false);

    processManager.handleTurnComplete(task.id, {
      costUsd: 0.2,
      tokensUsed: 40,
      durationMs: 2500,
    });

    assert.equal(db.state.task.status, "review");
    assert.equal(db.state.task.needsInput, 1);
    assert.equal(db.state.task.activityLabel, "Claude summarized all agent results");
    assert.equal(db.state.task.costUsd, 0.2);
    assert.equal(db.state.task.tokensUsed, 40);
    assert.equal(db.state.task.durationMs, 2500);
  } finally {
    resetProcessManagerSingleton();
  }
});

test("Workflow agents count down and an early parent result cannot finish the Goal", async () => {
  const now = new Date().toISOString();
  const task = {
    id: "task-workflow-agent-lifecycle",
    title: "Workflow agent lifecycle",
    description: "Track agents launched by Workflow.",
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
    claudeSessionId: "session-workflow-1",
    createdAt: now,
    updatedAt: now,
  };
  const db = createFakeDb(task);

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": { emitTaskEvent: () => {}, emitChatEvent: () => {} },
      "./claude-parser": { ClaudeOutputParser: class {} },
    });
    processManager.buildCompletionSummary = () => "Workflow results collected";
    processManager.sessions.set(task.id, {
      proc: { pid: 3434 },
      runner: { sendUserMessage() { return true; }, stop() {} },
      pendingQuestion: false,
      totalCostUsd: 0,
      totalTokensUsed: 0,
      totalDurationMs: 0,
      resumedFromReview: false,
      closing: false,
      activeSubagents: new Map(),
      activeWorkflowRuns: new Map(),
      terminalizingWorkflowRuns: new Set(),
      workflowParentCompletionPending: false,
      legacySubagentKeys: [],
    });

    const { ClaudeOutputParser } = loadActualClaudeParserModule();
    const launchParser = new ClaudeOutputParser({
      onProgress: () => {},
      onComplete: () => {},
      onError: () => {},
      onLogEntry: (entry) => processManager.addLogEntry(task.id, entry),
      onWorkflowLaunch: (data) => processManager.handleWorkflowLaunch(task.id, data),
    });
    const transcriptDir = path.join(os.homedir(), ".claude", "projects", "project-a", "session-workflow-1", "subagents", "workflows", "run-workflow-1");
    launchParser.feedLine(JSON.stringify({
      type: "tool_use",
      id: "toolu-workflow-parent",
      name: "Workflow",
      input: {},
    }));
    launchParser.feedLine(JSON.stringify({
      type: "user",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: "toolu-workflow-parent",
          content: [
            {
              type: "text",
              text: [
                "Workflow launched in background. Task ID: workflow-engine-task",
                "Summary: Three checks",
                `Transcript dir: ${transcriptDir}`,
                "Run ID: run-workflow-1",
              ].join("\n"),
            },
          ],
        }],
      },
    }));
    await Promise.resolve();
    assert.equal(db.state.task.activityLabel, "Starting workflow agents");

    processManager.handleTurnComplete(task.id, { costUsd: 0.1, tokensUsed: 10, durationMs: 1000 });
    assert.equal(db.state.task.status, "running");
    assert.equal(db.state.task.needsInput, 0);

    const bridge = processManager.workflowJournalBridge;
    for (const index of [1, 2, 3]) {
      bridge.callbacks.onAgentStarted({
        hostTaskId: task.id,
        workflowTaskId: "workflow-engine-task",
        sessionId: "session-workflow-1",
        runId: "run-workflow-1",
        parentToolUseId: "toolu-workflow-parent",
        transcriptDir: "ignored-in-callback",
        agentId: `agent-${index}`,
        journalKey: `key-${index}`,
        agentIndex: index,
        agentLabel: `Agent ${index}`,
        prompt: `Run check ${index}`,
        toolUseId: `workflow:run-workflow-1:agent-${index}`,
        observedAt: now,
        synthesized: false,
      });
    }
    bridge.callbacks.onAgentStarted({
      hostTaskId: task.id,
      workflowTaskId: "workflow-engine-task",
      sessionId: "session-workflow-1",
      runId: "run-workflow-1",
      parentToolUseId: "toolu-workflow-parent",
      transcriptDir: "ignored-in-callback",
      agentId: "agent-1",
      journalKey: "key-1",
      agentIndex: 1,
      agentLabel: "Agent 1",
      prompt: "Run check 1",
      toolUseId: "workflow:run-workflow-1:agent-1",
      observedAt: now,
      synthesized: false,
    });
    assert.equal(processManager.sessions.get(task.id).activeSubagents.size, 3);
    assert.equal(db.state.task.activityLabel, "Waiting for 3 agents to finish");

    for (const [index, remaining] of [[2, 2], [1, 1], [3, 0]]) {
      bridge.callbacks.onAgentCompleted({
        hostTaskId: task.id,
        workflowTaskId: "workflow-engine-task",
        sessionId: "session-workflow-1",
        runId: "run-workflow-1",
        parentToolUseId: "toolu-workflow-parent",
        transcriptDir: "ignored-in-callback",
        agentId: `agent-${index}`,
        journalKey: `key-${index}`,
        agentIndex: index,
        agentLabel: `Agent ${index}`,
        toolUseId: `workflow:run-workflow-1:agent-${index}`,
        observedAt: now,
        synthesized: false,
        outcome: "completed",
        source: "journal",
        completedAt: now,
      });
      assert.equal(processManager.sessions.get(task.id).activeSubagents.size, remaining);
    }
    assert.equal(db.state.task.activityLabel, "Collecting agent results");

    processManager.handleWorkflowTerminal(task.id, {
      toolUseId: "toolu-workflow-parent",
      taskId: "workflow-engine-task",
      runId: "run-workflow-1",
      status: "completed",
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(db.state.task.status, "running");

    processManager.handleTurnComplete(task.id, { costUsd: 0.2, tokensUsed: 20, durationMs: 2000 });
    assert.equal(db.state.task.status, "review");
    assert.equal(db.state.task.needsInput, 1);
    assert.equal(db.state.task.activityLabel, "Workflow results collected");

    const lifecycleLogs = db.state.logs.filter((entry) => entry.id.startsWith("workflow:run-workflow-1:agent-"));
    assert.equal(lifecycleLogs.length, 6);
  } finally {
    resetProcessManagerSingleton();
  }
});

test("Workflow text launch accepts the final main result after terminal notification", async () => {
  const now = new Date().toISOString();
  const task = {
    id: "task-workflow-text-final-result",
    title: "Workflow text launch validation",
    description: "The final parent result should move the Goal to review.",
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
    claudeSessionId: "session-workflow-text-final",
    createdAt: now,
    updatedAt: now,
  };
  const db = createFakeDb(task);

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": { emitTaskEvent: () => {}, emitChatEvent: () => {} },
      "./claude-parser": loadActualClaudeParserModule(),
    });
    processManager.buildCompletionSummary = () => "Workflow results collected";

    const session = {
      proc: { pid: 4545 },
      runner: { sendUserMessage() { return true; }, stop() {} },
      pendingQuestion: false,
      totalCostUsd: 0,
      totalTokensUsed: 0,
      totalDurationMs: 0,
      resumedFromReview: false,
      closing: false,
      activeSubagents: new Map(),
      activeWorkflowRuns: new Map(),
      terminalizingWorkflowRuns: new Set(),
      workflowParentCompletionPending: false,
      legacySubagentKeys: [],
    };
    processManager.sessions.set(task.id, session);
    processManager.setNextTurnParser(task.id, session);

    const parser = session.parser;
    const toolUseId = "toolu-workflow-text-final";
    const workflowTaskId = "workflow-task-text-final";
    const runId = "run-workflow-text-final";
    const transcriptDir = path.join(
      os.homedir(),
      ".claude",
      "projects",
      "project-a",
      task.claudeSessionId,
      "subagents",
      "workflows",
      runId,
    );

    parser.feedLine(JSON.stringify({
      type: "tool_use",
      id: toolUseId,
      name: "Workflow",
      input: {},
    }));
    parser.feedLine(JSON.stringify({
      type: "user",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: toolUseId,
          content: [{
            type: "text",
            text: [
              `Workflow launched in background. Task ID: ${workflowTaskId}`,
              `Transcript dir: ${transcriptDir}`,
              `Run ID: ${runId}`,
            ].join("\n"),
          }],
        }],
      },
    }));
    await Promise.resolve();

    parser.feedLine(JSON.stringify({
      type: "result",
      cost_usd: 0.1,
      duration_ms: 1000,
      usage: { input_tokens: 6, output_tokens: 4 },
    }));
    assert.equal(db.state.task.status, "running");
    assert.equal(session.deferredCompletion.costUsd, 0.1);

    parser.feedLine(JSON.stringify({
      type: "system",
      subtype: "task_notification",
      task_id: workflowTaskId,
      tool_use_id: toolUseId,
      status: "completed",
    }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(db.state.task.status, "running");

    parser.feedLine(JSON.stringify({
      type: "result",
      cost_usd: 0.2,
      duration_ms: 2000,
      usage: { input_tokens: 12, output_tokens: 8 },
    }));

    assert.equal(db.state.task.status, "review");
    assert.equal(db.state.task.needsInput, 1);
    assert.equal(db.state.task.activityLabel, "Workflow results collected");
    assert.equal(db.state.task.costUsd, 0.2);
    assert.equal(db.state.task.tokensUsed, 20);
    assert.equal(db.state.task.durationMs, 2000);
  } finally {
    resetProcessManagerSingleton();
  }
});

test("persisted Workflow launch metadata reconnects one observer after reload", async () => {
  const now = new Date().toISOString();
  const task = {
    id: "task-workflow-reconnect",
    title: "Reconnect Workflow",
    description: "Restore a new-format Workflow observer.",
    status: "running",
    level: "task",
    parentId: null,
    projectSlug: null,
    clientId: null,
    needsInput: 0,
    cronJobSlug: null,
    permissionMode: "bypassPermissions",
    claudeSessionId: "session-reconnect",
    createdAt: now,
    updatedAt: now,
  };
  const db = createFakeDb(task);
  const launch = {
    hostTaskId: task.id,
    sessionId: "session-reconnect",
    toolUseId: "toolu-reconnect",
    taskId: "workflow-engine-reconnect",
    runId: "run-reconnect",
    transcriptDir: path.join(os.homedir(), ".claude", "projects", "project-a", "session-reconnect", "subagents", "workflows", "run-reconnect"),
  };
  db.state.logs.push({
    id: "workflow:run-reconnect:launch",
    taskId: task.id,
    type: "tool_result",
    timestamp: now,
    content: "Workflow launch metadata",
    toolName: "WorkflowLaunch",
    toolArgs: JSON.stringify(launch),
    toolUseId: "toolu-reconnect",
  });

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": { emitTaskEvent: () => {}, emitChatEvent: () => {} },
      "./claude-parser": { ClaudeOutputParser: class {} },
    });
    processManager.getLogEntries(task.id);
    processManager.getLogEntries(task.id);
    await new Promise((resolve) => setImmediate(resolve));

    assert.ok(processManager.workflowJournalBridge.getSnapshot(task.id, "run-reconnect"));
    assert.equal(processManager.workflowJournalBridge.observeCalls.length, 1);
  } finally {
    resetProcessManagerSingleton();
  }
});

test("last subagent close waits for the parent result before showing user turn", () => {
  const now = new Date().toISOString();
  const task = {
    id: "task-agent-close-finalizes",
    title: "Agent close finalizes",
    description: "The last matching result should release the deferred turn.",
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

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: () => {},
        emitChatEvent: () => {},
      },
      "./subprocess": {
        spawnManagedTaskProcess: () => {
          throw new Error("spawnManagedTaskProcess should not be called in this test");
        },
        killChildProcessTree: () => {},
      },
      "./claude-parser": {
        ClaudeOutputParser: class {},
      },
    });

    processManager.buildCompletionSummary = () => "Claude has finished this step";
    processManager.sessions.set(task.id, {
      proc: { pid: 3333 },
      runner: {
        sendUserMessage() { return true; },
        stop() {},
      },
      pendingQuestion: false,
      totalCostUsd: 0,
      totalTokensUsed: 0,
      totalDurationMs: 0,
      resumedFromReview: false,
      closing: false,
      activeSubagents: new Map(),
      legacySubagentKeys: [],
    });

    processManager.addLogEntry(task.id, {
      id: "log-agent-one",
      type: "tool_use",
      timestamp: now,
      content: "Agent",
      toolName: "Agent",
      toolArgs: JSON.stringify({ subagent_type: "Ramanujan", prompt: "First agent." }),
      toolUseId: "toolu-agent-one",
    });
    processManager.addLogEntry(task.id, {
      id: "log-agent-two",
      type: "tool_use",
      timestamp: now,
      content: "Agent",
      toolName: "Agent",
      toolArgs: JSON.stringify({ subagent_type: "Godel", prompt: "Second agent." }),
      toolUseId: "toolu-agent-two",
    });
    processManager.handleTurnComplete(task.id, {
      costUsd: 0.75,
      tokensUsed: 125,
      durationMs: 21000,
    });

    assert.equal(db.state.task.status, "running");
    assert.equal(db.state.task.activityLabel, "Waiting for 2 agents to finish");

    processManager.addLogEntry(task.id, {
      id: "log-agent-one-result",
      type: "tool_result",
      timestamp: now,
      content: "First done",
      toolResult: "First done",
      toolUseId: "toolu-agent-one",
    });

    assert.equal(db.state.task.status, "running");
    assert.equal(db.state.task.activityLabel, "Waiting for 1 agent to finish");
    assert.equal(processManager.waitingForReply.has(task.id), false);

    processManager.addLogEntry(task.id, {
      id: "log-agent-two-result",
      type: "tool_result",
      timestamp: now,
      content: "Second done",
      toolResult: "Second done",
      toolUseId: "toolu-agent-two",
    });

    assert.equal(db.state.task.status, "running");
    assert.equal(db.state.task.activityLabel, "Collecting agent results");
    assert.equal(db.state.task.needsInput, 0);
    assert.equal(db.state.task.claudePid, 3333);
    assert.equal(processManager.waitingForReply.has(task.id), false);
    assert.equal(processManager.sessions.has(task.id), true);

    processManager.handleTurnComplete(task.id, {
      costUsd: 0.1,
      tokensUsed: 25,
      durationMs: 1500,
    });

    assert.equal(db.state.task.status, "review");
    assert.equal(db.state.task.needsInput, 1);
    assert.equal(db.state.task.costUsd, 0.1);
    assert.equal(db.state.task.tokensUsed, 25);
    assert.equal(db.state.task.durationMs, 1500);
    assert.equal(processManager.waitingForReply.has(task.id), true);
  } finally {
    resetProcessManagerSingleton();
  }
});

test("last task-notification close waits for the main agent final result", () => {
  const now = new Date().toISOString();
  const task = {
    id: "task-agent-notification-final-result",
    title: "Agent notification final result",
    description: "A background agent notification should not show user turn before Claude summarizes.",
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

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: () => {},
        emitChatEvent: () => {},
      },
      "./subprocess": {
        spawnManagedTaskProcess: () => {
          throw new Error("spawnManagedTaskProcess should not be called in this test");
        },
        killChildProcessTree: () => {},
      },
      "./claude-parser": {
        ClaudeOutputParser: class {},
      },
    });

    processManager.buildCompletionSummary = () => "Claude has finished this step";
    processManager.sessions.set(task.id, {
      proc: { pid: 7777 },
      runner: {
        sendUserMessage() { return true; },
        stop() {},
      },
      pendingQuestion: false,
      totalCostUsd: 0,
      totalTokensUsed: 0,
      totalDurationMs: 0,
      resumedFromReview: false,
      closing: false,
      activeSubagents: new Map(),
      legacySubagentKeys: [],
    });

    processManager.addLogEntry(task.id, {
      id: "log-agent-notification",
      type: "tool_use",
      timestamp: now,
      content: "Agent",
      toolName: "Agent",
      toolArgs: JSON.stringify({ subagent_type: "Ramanujan", prompt: "Report back." }),
      toolUseId: "toolu-agent-notification",
    });
    processManager.handleTurnComplete(task.id, {
      costUsd: 0.5,
      tokensUsed: 100,
      durationMs: 19000,
    });

    processManager.addLogEntry(task.id, {
      id: "log-agent-notification-result",
      type: "tool_result",
      timestamp: now,
      content: "Agent finished",
      toolName: "AgentNotification",
      toolResult: "Agent finished",
      toolUseId: "toolu-agent-notification",
    });

    assert.equal(db.state.task.status, "running");
    assert.equal(db.state.task.activityLabel, "Collecting agent results");
    assert.equal(db.state.task.needsInput, 0);
    assert.equal(db.state.task.claudePid, 7777);
    assert.equal(processManager.sessions.get(task.id).activeSubagents.size, 0);
    assert.equal(processManager.sessions.get(task.id).deferredCompletion.costUsd, 0.5);
    assert.equal(processManager.waitingForReply.has(task.id), false);

    processManager.handleTurnComplete(task.id, {
      costUsd: 0.25,
      tokensUsed: 50,
      durationMs: 3000,
    });

    assert.equal(db.state.task.status, "review");
    assert.equal(db.state.task.needsInput, 1);
    assert.equal(db.state.task.costUsd, 0.25);
    assert.equal(db.state.task.tokensUsed, 50);
    assert.equal(db.state.task.durationMs, 3000);
    assert.equal(processManager.sessions.get(task.id).deferredCompletion, undefined);
    assert.equal(processManager.waitingForReply.has(task.id), true);
  } finally {
    resetProcessManagerSingleton();
  }
});

test("reconciled closed subagents release a deferred turn without double-counting result metrics", () => {
  const now = new Date().toISOString();
  const task = {
    id: "task-agent-reconcile-finalizes",
    title: "Agent reconcile finalizes",
    description: "A later result should not leave stale active agent state running forever.",
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

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: () => {},
        emitChatEvent: () => {},
      },
      "./subprocess": {
        spawnManagedTaskProcess: () => {
          throw new Error("spawnManagedTaskProcess should not be called in this test");
        },
        killChildProcessTree: () => {},
      },
      "./claude-parser": {
        ClaudeOutputParser: class {},
      },
    });

    processManager.buildCompletionSummary = () => "Claude has finished this step";
    processManager.sessions.set(task.id, {
      proc: { pid: 5555 },
      runner: {
        sendUserMessage() { return true; },
        stop() {},
      },
      pendingQuestion: false,
      totalCostUsd: 0,
      totalTokensUsed: 0,
      totalDurationMs: 0,
      resumedFromReview: false,
      closing: false,
      activeSubagents: new Map(),
      legacySubagentKeys: [],
    });

    processManager.addLogEntry(task.id, {
      id: "log-agent-reconcile",
      type: "tool_use",
      timestamp: now,
      content: "Agent",
      toolName: "Agent",
      toolArgs: JSON.stringify({ subagent_type: "Ramanujan", prompt: "Report back." }),
      toolUseId: "toolu-agent-reconcile",
    });
    processManager.handleTurnComplete(task.id, {
      costUsd: 0.5,
      tokensUsed: 100,
      durationMs: 19000,
    });

    assert.equal(db.state.task.status, "running");
    assert.equal(processManager.sessions.get(task.id).activeSubagents.size, 1);
    assert.equal(processManager.sessions.get(task.id).deferredCompletion.costUsd, 0.5);

    db.state.logs.push({
      id: "log-agent-reconcile-result",
      taskId: task.id,
      type: "tool_result",
      timestamp: now,
      content: "Agent finished",
      toolName: null,
      toolArgs: null,
      toolResult: "Agent finished",
      toolUseId: "toolu-agent-reconcile",
      parentToolUseId: null,
      isCollapsed: 0,
    });

    processManager.handleTurnComplete(task.id, {
      costUsd: 0.5,
      tokensUsed: 100,
      durationMs: 19000,
    });

    assert.equal(db.state.task.status, "review");
    assert.equal(db.state.task.needsInput, 1);
    assert.equal(db.state.task.costUsd, 0.5);
    assert.equal(db.state.task.tokensUsed, 100);
    assert.equal(db.state.task.durationMs, 19000);
    assert.equal(processManager.sessions.get(task.id).activeSubagents.size, 0);
    assert.equal(processManager.waitingForReply.has(task.id), true);
  } finally {
    resetProcessManagerSingleton();
  }
});

test("hard error clears active subagent tracking and moves task to review", () => {
  const now = new Date().toISOString();
  const task = {
    id: "task-agent-hard-error",
    title: "Agent hard error",
    description: "A hard process error should clear live agent tracking.",
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
    claudePid: 4444,
  };
  const db = createFakeDb(task);
  const killedPids = [];

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: () => {},
        emitChatEvent: () => {},
      },
      "./subprocess": {
        spawnManagedTaskProcess: () => {
          throw new Error("spawnManagedTaskProcess should not be called in this test");
        },
        killChildProcessTree: (proc) => {
          killedPids.push(proc.pid);
        },
      },
      "./claude-parser": {
        ClaudeOutputParser: class {},
      },
    });

    processManager.sessions.set(task.id, {
      proc: { pid: 4444 },
      pendingQuestion: false,
      totalCostUsd: 0,
      totalTokensUsed: 0,
      totalDurationMs: 0,
      resumedFromReview: false,
      closing: false,
      activeSubagents: new Map([
        ["toolu-agent-open", { toolUseKey: "toolu-agent-open", toolUseId: "toolu-agent-open" }],
      ]),
      legacySubagentKeys: [],
    });

    processManager.handleTaskError(task.id, "Claude CLI exited with code 1");

    assert.equal(db.state.task.status, "review");
    assert.equal(db.state.task.needsInput, 1);
    assert.equal(db.state.task.claudePid, null);
    assert.equal(processManager.sessions.has(task.id), false);
    assert.equal(processManager.waitingForReply.has(task.id), true);
    assert.deepEqual(killedPids, [4444]);
  } finally {
    resetProcessManagerSingleton();
  }
});

test("lost live session moves task to review with a clear message", () => {
  const now = new Date().toISOString();
  const task = {
    id: "task-lost-live-session",
    title: "Lost live session",
    description: "Simulate a process that can no longer be tracked.",
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
    claudePid: 1357,
  };
  const db = createFakeDb(task);
  const stopped = [];
  const emittedEvents = [];

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: (event) => emittedEvents.push(event),
        emitChatEvent: () => {},
      },
      "./subprocess": {
        spawnManagedTaskProcess: () => {
          throw new Error("spawnManagedTaskProcess should not be called in this test");
        },
        killChildProcessTree: (proc) => {
          stopped.push(proc.pid);
        },
      },
      "./claude-parser": {
        ClaudeOutputParser: class {},
      },
    });

    processManager.sessions.set(task.id, {
      proc: { pid: 1357 },
      runner: {
        sendUserMessage() { return true; },
        stop() { stopped.push(1357); },
      },
      pendingQuestion: false,
      totalCostUsd: 0,
      totalTokensUsed: 0,
      totalDurationMs: 0,
      resumedFromReview: false,
      closing: false,
      activeSubagents: new Map([
        ["toolu-lost-agent", { toolUseKey: "toolu-lost-agent", toolUseId: "toolu-lost-agent" }],
      ]),
      legacySubagentKeys: [],
    });

    processManager.handleLostLiveSession(
      task.id,
      "The previous Claude process exited, so live subagent state was lost.",
    );

    assert.equal(db.state.task.status, "review");
    assert.equal(db.state.task.needsInput, 1);
    assert.equal(db.state.task.claudePid, null);
    assert.match(db.state.task.errorMessage, /live subagent state was lost/i);
    assert.equal(db.state.task.activityLabel, "Live Claude session ended — review output");
    assert.equal(processManager.sessions.has(task.id), false);
    assert.equal(processManager.waitingForReply.has(task.id), true);
    assert.deepEqual(stopped, [1357]);
    assert.equal(
      emittedEvents.some((event) => event.type === "task:status" && event.task.status === "review"),
      true,
    );
  } finally {
    resetProcessManagerSingleton();
  }
});

test("startBacklogTaskFromReply reports root Solo instructions and loaded snapshot after logout", async () => {
  const workspaceDir = makeTempWorkspace();
  fs.mkdirSync(path.join(workspaceDir, "context"), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, "brand_context"), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, "team_context"), { recursive: true });
  fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "ROOT_AGENT_INSTRUCTIONS", "utf-8");
  fs.writeFileSync(path.join(workspaceDir, "CLAUDE.md"), "ROOT_CLAUDE_INSTRUCTIONS", "utf-8");
  fs.writeFileSync(path.join(workspaceDir, "context", "SOUL.md"), "Solo identity.", "utf-8");
  fs.writeFileSync(path.join(workspaceDir, "context", "USER.md"), "Solo user preference.", "utf-8");
  fs.writeFileSync(path.join(workspaceDir, "context", "MEMORY.md"), "Solo memory note.", "utf-8");
  fs.writeFileSync(path.join(workspaceDir, "context", "learnings.md"), "LAZY_LEARNINGS", "utf-8");
  fs.writeFileSync(path.join(workspaceDir, "brand_context", "voice-profile.md"), "LAZY_BRAND_CONTEXT", "utf-8");
  fs.writeFileSync(path.join(workspaceDir, "team_context", "AGENTS.md"), "STALE_TEAM_CONTEXT", "utf-8");
  const now = new Date().toISOString();
  const task = {
    id: "solo-local-context",
    title: "Solo task",
    description: "Use local context.",
    status: "backlog",
    level: "task",
    parentId: "parent-project",
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
    startedAt: null,
    lastReplyAt: null,
    activityLabel: null,
    errorMessage: null,
    workScope: SOLO_WORK_SCOPE,
  };
  const db = createFakeDb(task);
  const spawnCalls = [];

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./config": {
        getConfig: () => ({ aiOsDir: workspaceDir }),
        getClientAiOsDir: (clientId) => path.join(workspaceDir, "clients", clientId),
      },
      "./event-bus": {
        emitTaskEvent: () => {},
        emitChatEvent: () => {},
      },
      "./claude-parser": {
        ClaudeOutputParser: class {
          constructor() {}
          feedLine() {}
          get isCompleted() { return false; }
        },
      },
      "./file-watcher": {
        fileWatcher: {
          startWatching: async () => {},
          stopWatching: async () => {},
          cleanupAll: () => {},
        },
      },
      "./team-api-context": {
        readTeamContext: async () => null,
        fetchTeamContextSnapshot: async () => {
          throw new Error("should not fetch without login");
        },
      },
      "./subprocess": {
        spawnManagedTaskProcess: (command, args) => {
          spawnCalls.push({ command, args: [...args] });
          const proc = new EventEmitter();
          proc.stdout = new Readable({ read() { this.push(null); } });
          proc.stderr = new Readable({ read() { this.push(null); } });
          proc.stdin = { on() { return this; }, write() { return true; }, end() {} };
          proc.unref = () => {};
          proc.pid = 12345;
          return proc;
        },
        killChildProcessTree: () => {},
      },
    });
    processManager.isSessionContextTask = () => false;

    const started = await processManager.startBacklogTaskFromReply(
      task.id,
      "Start with solo context",
      { logEntryId: "reply-solo", permissionMode: "bypassPermissions" },
    );

    assert.equal(started, true);
    const args = spawnCalls[0].args;
    const snapshotArgIndex = args.indexOf("--append-system-prompt-file");
    assert.notEqual(snapshotArgIndex, -1);
    const snapshotPath = args[snapshotArgIndex + 1];
    const snapshot = fs.readFileSync(snapshotPath, "utf-8");
    assert.match(snapshot, /Solo identity/);
    assert.match(snapshot, /Solo user preference/);
    assert.match(snapshot, /Solo memory note/);
    assert.doesNotMatch(snapshot, /ROOT_AGENT_INSTRUCTIONS/);
    assert.doesNotMatch(snapshot, /ROOT_CLAUDE_INSTRUCTIONS/);
    assert.doesNotMatch(snapshot, /LAZY_LEARNINGS/);
    assert.doesNotMatch(snapshot, /LAZY_BRAND_CONTEXT/);
    assert.doesNotMatch(snapshot, /STALE_TEAM_CONTEXT/);
    fs.rmSync(snapshotPath, { force: true });

    assert.deepEqual(JSON.parse(db.state.task.contextSources), [
      { type: "system", label: "AGENTS.md", path: "AGENTS.md", status: "loaded" },
      { type: "system", label: "CLAUDE.md", path: "CLAUDE.md", status: "loaded" },
      { type: "system", label: "learnings.md", path: "context/learnings.md", status: "available" },
      { type: "brand", label: "voice-profile.md", path: "brand_context/voice-profile.md", status: "available", size: 18 },
      { type: "system", label: "SOUL.md", path: "context/SOUL.md", status: "loaded" },
      { type: "system", label: "USER.md", path: "context/USER.md", status: "loaded" },
      { type: "system", label: "MEMORY.md", path: "context/MEMORY.md", status: "loaded" },
    ]);
    const systemLog = db.state.logs.find((log) => log.type === "system");
    assert.equal(systemLog.content, "Context ready: 5 files loaded");
  } finally {
    resetProcessManagerSingleton();
    cleanupTempWorkspace(workspaceDir);
  }
});

test("startBacklogTaskFromReply reports the root and client Solo instruction chain", async () => {
  const workspaceDir = makeTempWorkspace();
  const clientDir = path.join(workspaceDir, "clients", "acme");
  fs.mkdirSync(path.join(clientDir, "context"), { recursive: true });
  fs.mkdirSync(path.join(clientDir, "brand_context"), { recursive: true });
  fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "ROOT_AGENT_INSTRUCTIONS", "utf-8");
  fs.writeFileSync(path.join(workspaceDir, "CLAUDE.md"), "ROOT_CLAUDE_INSTRUCTIONS", "utf-8");
  fs.writeFileSync(path.join(clientDir, "AGENTS.md"), "CLIENT_AGENT_INSTRUCTIONS", "utf-8");
  fs.writeFileSync(path.join(clientDir, "CLAUDE.md"), "CLIENT_CLAUDE_INSTRUCTIONS", "utf-8");
  fs.writeFileSync(path.join(clientDir, "context", "SOUL.md"), "Client identity.", "utf-8");
  fs.writeFileSync(path.join(clientDir, "context", "USER.md"), "Client user preference.", "utf-8");
  fs.writeFileSync(path.join(clientDir, "context", "MEMORY.md"), "Client memory note.", "utf-8");
  fs.writeFileSync(path.join(clientDir, "context", "learnings.md"), "CLIENT_LAZY_LEARNINGS", "utf-8");
  fs.writeFileSync(path.join(clientDir, "brand_context", "voice.md"), "CLIENT_LAZY_BRAND", "utf-8");
  const now = new Date().toISOString();
  const task = {
    id: "solo-client-context",
    title: "Client Solo task",
    description: "Use client context.",
    status: "backlog",
    level: "task",
    parentId: "parent-project",
    projectSlug: null,
    clientId: "acme",
    needsInput: 0,
    phaseNumber: null,
    gsdStep: null,
    cronJobSlug: null,
    permissionMode: "bypassPermissions",
    model: null,
    thinkingEffort: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    lastReplyAt: null,
    activityLabel: null,
    errorMessage: null,
    workScope: { mode: "solo", version: 1, clientId: "acme" },
  };
  const db = createFakeDb(task);
  const spawnCalls = [];

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./config": {
        getConfig: () => ({ aiOsDir: workspaceDir }),
        getClientAiOsDir: (clientId) => path.join(workspaceDir, "clients", clientId),
      },
      "./event-bus": {
        emitTaskEvent: () => {},
        emitChatEvent: () => {},
      },
      "./claude-parser": {
        ClaudeOutputParser: class {
          constructor() {}
          feedLine() {}
          get isCompleted() { return false; }
        },
      },
      "./file-watcher": {
        fileWatcher: {
          startWatching: async () => {},
          stopWatching: async () => {},
          cleanupAll: () => {},
        },
      },
      "./team-api-context": {
        readTeamContext: async () => null,
        fetchTeamContextSnapshot: async () => {
          throw new Error("should not fetch without login");
        },
      },
      "./subprocess": {
        spawnManagedTaskProcess: (command, args) => {
          spawnCalls.push({ command, args: [...args] });
          const proc = new EventEmitter();
          proc.stdout = new Readable({ read() { this.push(null); } });
          proc.stderr = new Readable({ read() { this.push(null); } });
          proc.stdin = { on() { return this; }, write() { return true; }, end() {} };
          proc.unref = () => {};
          proc.pid = 12345;
          return proc;
        },
        killChildProcessTree: () => {},
      },
    });
    processManager.isSessionContextTask = () => false;

    const started = await processManager.startBacklogTaskFromReply(
      task.id,
      "Start with client Solo context",
      { logEntryId: "reply-client-solo", permissionMode: "bypassPermissions" },
    );

    assert.equal(started, true);
    const args = spawnCalls[0].args;
    const snapshotArgIndex = args.indexOf("--append-system-prompt-file");
    assert.notEqual(snapshotArgIndex, -1);
    const snapshotPath = args[snapshotArgIndex + 1];
    const snapshot = fs.readFileSync(snapshotPath, "utf-8");
    assert.match(snapshot, /Client identity/);
    assert.match(snapshot, /Client user preference/);
    assert.match(snapshot, /Client memory note/);
    assert.doesNotMatch(snapshot, /ROOT_AGENT_INSTRUCTIONS/);
    assert.doesNotMatch(snapshot, /ROOT_CLAUDE_INSTRUCTIONS/);
    assert.doesNotMatch(snapshot, /CLIENT_AGENT_INSTRUCTIONS/);
    assert.doesNotMatch(snapshot, /CLIENT_CLAUDE_INSTRUCTIONS/);
    assert.doesNotMatch(snapshot, /CLIENT_LAZY_LEARNINGS/);
    assert.doesNotMatch(snapshot, /CLIENT_LAZY_BRAND/);
    fs.rmSync(snapshotPath, { force: true });

    assert.deepEqual(JSON.parse(db.state.task.contextSources), [
      { type: "system", label: "AGENTS.md", path: "AGENTS.md", status: "loaded" },
      { type: "system", label: "CLAUDE.md", path: "CLAUDE.md", status: "loaded" },
      { type: "system", label: "clients/acme/AGENTS.md", path: "clients/acme/AGENTS.md", status: "loaded" },
      { type: "system", label: "clients/acme/CLAUDE.md", path: "clients/acme/CLAUDE.md", status: "loaded" },
      { type: "system", label: "learnings.md", path: "clients/acme/context/learnings.md", status: "available" },
      { type: "brand", label: "voice.md", path: "clients/acme/brand_context/voice.md", status: "available", size: 17 },
      { type: "system", label: "SOUL.md", path: "clients/acme/context/SOUL.md", status: "loaded" },
      { type: "system", label: "USER.md", path: "clients/acme/context/USER.md", status: "loaded" },
      { type: "system", label: "MEMORY.md", path: "clients/acme/context/MEMORY.md", status: "loaded" },
    ]);
    const systemLog = db.state.logs.find((log) => log.type === "system");
    assert.equal(systemLog.content, "Context ready: 7 files loaded");
  } finally {
    resetProcessManagerSingleton();
    cleanupTempWorkspace(workspaceDir);
  }
});

test("startBacklogTaskFromReply stores context sources and logs compact context notice", async () => {
  const workspaceDir = makeTempWorkspace();
  const now = new Date().toISOString();
  const task = {
    id: "team-context-available",
    title: "Team context task",
    description: "Use Team OS context.",
    status: "backlog",
    level: "task",
    parentId: "parent-project",
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
    startedAt: null,
    lastReplyAt: null,
    activityLabel: null,
    errorMessage: null,
    workScope: TEAM_WORK_SCOPE,
  };
  const db = createFakeDb(task);
  const spawnCalls = [];

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./config": {
        getConfig: () => ({ aiOsDir: workspaceDir }),
        getClientAiOsDir: (clientId) => path.join(workspaceDir, "clients", clientId),
      },
      "./event-bus": {
        emitTaskEvent: () => {},
        emitChatEvent: () => {},
      },
      "./claude-parser": {
        ClaudeOutputParser: class {
          constructor() {}
          feedLine() {}
          get isCompleted() { return false; }
        },
      },
      "./file-watcher": {
        fileWatcher: {
          startWatching: async () => {},
          stopWatching: async () => {},
          cleanupAll: () => {},
        },
      },
      "./team-api-context": {
        readTeamContext: async () => ({ apiUrl: "https://team.example.test", token: "token" }),
        fetchTeamContextSnapshot: async () => ({
          generatedAt: now,
          team: null,
          user: null,
          client: null,
          taskType: "command-centre-task",
          layers: [
            {
              label: "Team",
              visibility: "team",
              kind: "preferences",
              path: "team_context/team-profile.md",
              sha256: "abc",
              source: "database",
              updatedAt: null,
            },
          ],
          availableContext: [
            {
              visibility: "team",
              kind: "brand",
              path: "brand_context/voice-profile.md",
              title: "Voice profile",
              size: 123,
              source: "database",
              updatedAt: null,
            },
          ],
          markdown: "# Team OS Context Snapshot\n\nTEAM_CONTEXT",
        }),
      },
      "./subprocess": {
        spawnManagedTaskProcess: (command, args, options) => {
          spawnCalls.push({ command, args: [...args], options });
          const proc = new EventEmitter();
          proc.stdout = new Readable({ read() { this.push(null); } });
          proc.stderr = new Readable({ read() { this.push(null); } });
          proc.stdin = { on() { return this; }, write() { return true; }, end() {} };
          proc.unref = () => {};
          proc.pid = 12345;
          return proc;
        },
        killChildProcessTree: () => {},
      },
    });
    processManager.isSessionContextTask = () => false;

    const started = await processManager.startBacklogTaskFromReply(
      task.id,
      "Start with Team OS context",
      { logEntryId: "reply-team-success", permissionMode: "bypassPermissions" },
    );

    assert.equal(started, true);
    const args = spawnCalls[0].args;
    const snapshotArgIndex = args.indexOf("--append-system-prompt-file");
    assert.notEqual(snapshotArgIndex, -1);
    const snapshotPath = args[snapshotArgIndex + 1];
    assert.match(fs.readFileSync(snapshotPath, "utf-8"), /TEAM_CONTEXT/);
    assert.equal(
      spawnCalls[0].options.env.AI_OS_CONTEXT_OVERLAY_DIR,
      path.dirname(snapshotPath),
    );
    fs.rmSync(snapshotPath, { force: true });

    const contextSources = JSON.parse(db.state.task.contextSources);
    assert.deepEqual(contextSources, [
      {
        type: "system",
        label: "Team: team_context/team-profile.md",
        status: "loaded",
      },
      {
        type: "brand",
        label: "brand_context/voice-profile.md — Voice profile",
        path: "brand_context/voice-profile.md",
        status: "available",
        title: "Voice profile",
        size: 123,
      },
    ]);
    const systemLog = db.state.logs.find((log) => log.type === "system");
    assert.equal(systemLog.content, "Context ready: 1 file loaded");
  } finally {
    resetProcessManagerSingleton();
    cleanupTempWorkspace(workspaceDir);
  }
});

test("startBacklogTaskFromReply blocks a new Team chat when Team context is unavailable", async () => {
  const workspaceDir = makeTempWorkspace();
  fs.mkdirSync(path.join(workspaceDir, "context"), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, "team_context"), { recursive: true });
  fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "LOCAL_AGENT_INSTRUCTIONS", "utf-8");
  fs.writeFileSync(path.join(workspaceDir, "CLAUDE.md"), "LOCAL_CLAUDE_INSTRUCTIONS", "utf-8");
  fs.writeFileSync(path.join(workspaceDir, "context", "USER.md"), "Local private Team OS content.", "utf-8");
  fs.writeFileSync(path.join(workspaceDir, "team_context", "AGENTS.md"), "Stale Team instructions.", "utf-8");
  const now = new Date().toISOString();
  const task = {
    id: "team-offline-context",
    title: "Team task",
    description: "Do not load stale local context.",
    status: "backlog",
    level: "task",
    parentId: "parent-project",
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
    startedAt: null,
    lastReplyAt: null,
    activityLabel: null,
    errorMessage: null,
    workScope: TEAM_WORK_SCOPE,
  };
  const db = createFakeDb(task);
  const spawnCalls = [];

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./config": {
        getConfig: () => ({ aiOsDir: workspaceDir }),
        getClientAiOsDir: (clientId) => path.join(workspaceDir, "clients", clientId),
      },
      "./event-bus": {
        emitTaskEvent: () => {},
        emitChatEvent: () => {},
      },
      "./claude-parser": {
        ClaudeOutputParser: class {
          constructor() {}
          feedLine() {}
          get isCompleted() { return false; }
        },
      },
      "./file-watcher": {
        fileWatcher: {
          startWatching: async () => {},
          stopWatching: async () => {},
          cleanupAll: () => {},
        },
      },
      "./team-api-context": {
        readTeamContext: async () => ({ apiUrl: "https://team.example.test", token: "token" }),
        fetchTeamContextSnapshot: async () => {
          throw new Error("server offline");
        },
      },
      "./subprocess": {
        spawnManagedTaskProcess: (command, args, options) => {
          spawnCalls.push({ command, args: [...args], options });
          const proc = new EventEmitter();
          proc.stdout = new Readable({ read() { this.push(null); } });
          proc.stderr = new Readable({ read() { this.push(null); } });
          proc.stdin = { on() { return this; }, write() { return true; }, end() {} };
          proc.unref = () => {};
          proc.pid = 12345;
          return proc;
        },
        killChildProcessTree: () => {},
      },
    });
    processManager.isSessionContextTask = () => false;

    const started = await processManager.startBacklogTaskFromReply(
      task.id,
      "Start without stale context",
      { logEntryId: "reply-team", permissionMode: "bypassPermissions" },
    );

    assert.equal(started, true);
    assert.equal(spawnCalls.length, 0);
    assert.equal(db.state.task.status, "review");
    assert.equal(db.state.task.needsInput, 1);
    assert.match(db.state.task.errorMessage, /exact Team OS context/i);
    assert.equal(db.state.task.contextSources ?? null, null);
  } finally {
    resetProcessManagerSingleton();
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
  fs.mkdirSync(path.join(workspaceDir, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, ".claude", "settings.json"),
    JSON.stringify({
      permissions: { allow: ["Write(*)", "Edit(*)"], deny: ["Bash(rm *)"] },
      hooks: { Stop: [] },
    }),
    "utf-8",
  );
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
          aiOsDir: workspaceDir,
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
        spawnManagedTaskProcess: (command, args, options) => {
          spawnCalls.push({ command, args: [...args], options });
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
          proc.stdin = { write() { return true; }, end() {} };
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
    assertAskUserQuestionDisallowed(args);
    assert.ok(args.includes("--allowedTools"));
    assert.ok(args.includes("Read,Glob,Grep,WebSearch,mcp__permissions"));
    assert.ok(args.includes("--permission-prompt-tool"));
    assert.ok(args.includes("mcp__permissions__approval_prompt"));
    assert.ok(args.includes("--setting-sources"));
    assert.ok(args.includes("user"));
    assert.ok(args.includes("--settings"));
    assert.ok(args.includes("--mcp-config"));
    assert.ok(args.includes("--allow-dangerously-skip-permissions"));
    assert.equal(args.includes("--dangerously-skip-permissions"), false);
    assert.equal(args.includes("--effort"), false);
    assert.equal(args[args.indexOf("--setting-sources") + 1], "user");

    const settingsPath = args[args.indexOf("--settings") + 1];
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    assert.deepEqual(settings.permissions.allow, [
      "Read(*)",
      "Glob(*)",
      "Grep(*)",
      "WebSearch",
      "mcp__permissions",
    ]);
    assert.deepEqual(settings.permissions.deny, ["Bash(rm *)"]);
    assert.deepEqual(settings.hooks, { Stop: [] });
    const mcpConfigPath = args[args.indexOf("--mcp-config") + 1];
    const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, "utf-8"));
    assert.equal(mcpConfig.mcpServers.permissions.type, "stdio");
    assert.equal(mcpConfig.mcpServers.permissions.args[0], bridgeScriptPath);
    assert.equal(
      mcpConfig.mcpServers.permissions.args[mcpConfig.mcpServers.permissions.args.indexOf("--workspace-path") + 1],
      workspaceDir,
    );
    fs.unlinkSync(settingsPath);
    fs.unlinkSync(mcpConfigPath);

    processManager.stopSession(task.id);
    db.state.task.permissionMode = "auto";
    processManager.spawnClaudeTurn(task.id, "Check Auto mode", workspaceDir, false, false);
    const autoArgs = spawnCalls[1].args;
    assertAskUserQuestionDisallowed(autoArgs);
    assert.equal(autoArgs[autoArgs.indexOf("--permission-mode") + 1], "auto");
    assert.ok(autoArgs.includes("--allow-dangerously-skip-permissions"));
    assert.ok(autoArgs.includes("--permission-prompt-tool"));
    assert.equal(autoArgs.includes("--dangerously-skip-permissions"), false);

    processManager.stopSession(task.id);
    db.state.task.permissionMode = "bypassPermissions";
    processManager.spawnClaudeTurn(task.id, "Check Full access", workspaceDir, false, false);
    const fullAccessArgs = spawnCalls[2].args;
    assertAskUserQuestionDisallowed(fullAccessArgs);
    assert.ok(fullAccessArgs.includes("--dangerously-skip-permissions"));
    assert.ok(fullAccessArgs.includes("--allow-dangerously-skip-permissions"));
    assert.ok(fullAccessArgs.includes("--permission-prompt-tool"));

    processManager.stopSession(task.id);
    db.state.task.cronJobSlug = "scheduled-job";
    processManager.spawnClaudeTurn(task.id, "Check cron mode", workspaceDir, false, false);
    const cronArgs = spawnCalls[3].args;
    assertAskUserQuestionDisallowed(cronArgs);
    assert.ok(cronArgs.includes("--dangerously-skip-permissions"));
    assert.equal(cronArgs.includes("--allow-dangerously-skip-permissions"), false);
    assert.equal(cronArgs.includes("--permission-prompt-tool"), false);

    processManager.stopSession(task.id);
    db.state.task.cronJobSlug = null;
    db.state.task.permissionMode = "plan";
    processManager.spawnClaudeTurn(task.id, "Check plan mode", workspaceDir, false, false);
    const planArgs = spawnCalls[4].args;
    assert.equal(planArgs[planArgs.indexOf("--permission-mode") + 1], "plan");
    assertAskUserQuestionDisallowed(planArgs);

    processManager.stopSession(task.id);
    db.state.task.permissionMode = "bypassPermissions";
    const pluginDir = path.join(workspaceDir, ".team-plugin");
    const promptFile = path.join(pluginDir, "routing.md");
    const clientDir = path.join(workspaceDir, "clients", "client-a");
    fs.mkdirSync(path.join(pluginDir, "skills"), { recursive: true });
    fs.mkdirSync(clientDir, { recursive: true });
    fs.writeFileSync(promptFile, "# Effective skills\n", "utf-8");
    processManager.spawnClaudeTurn(task.id, "Use /mkt-copywriting", clientDir, false, false, "", "authorized", {
      pluginDir,
      promptFile,
      fingerprint: "team-plugin-v1",
      teamSkills: ["mkt-copywriting"],
      localSkills: ["mkt-copywriting"],
      clientSkills: [],
      incompatibleTeamSkills: [],
    });
    const pluginSpawn = spawnCalls[5];
    assert.equal(pluginSpawn.args[pluginSpawn.args.indexOf("--plugin-dir") + 1], pluginDir);
    assert.equal(pluginSpawn.args[pluginSpawn.args.indexOf("--add-dir") + 1], workspaceDir);
    assert.equal(pluginSpawn.options.env.CLAUDE_SKILL_DIR, path.join(pluginDir, "skills"));
  } finally {
    resetProcessManagerSingleton();
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
        getConfig: () => ({ aiOsDir: workspaceDir }),
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
          proc.stdin = { write() { return true; }, end() {} };
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
    resetProcessManagerSingleton();
    cleanupTempWorkspace(workspaceDir);
  }
});

test("spawn records ownership of the exact Claude PID and tells hooks which task they belong to", () => {
  const workspaceDir = makeTempWorkspace();
  const now = new Date().toISOString();
  const task = {
    id: "task-owned-spawn",
    title: "Owned spawn",
    description: "Verify ownership bookkeeping",
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
    thinkingEffort: null,
    createdAt: now,
    updatedAt: now,
  };
  const db = createFakeDb(task);
  const spawnCalls = [];
  const originalTaskIdEnv = process.env.AI_OS_TASK_ID;

  try {
    process.env.AI_OS_TASK_ID = "inherited-parent-task";
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: () => {},
        emitChatEvent: () => {},
      },
      "./config": {
        getConfig: () => ({ aiOsDir: workspaceDir }),
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
        spawnManagedTaskProcess: (command, args, options) => {
          spawnCalls.push({ command, args: [...args], options });
          const proc = new EventEmitter();
          proc.stdout = new Readable({ read() { this.push(null); } });
          proc.stderr = new Readable({ read() { this.push(null); } });
          proc.stdin = { write() { return true; }, end() {} };
          proc.unref = () => {};
          proc.pid = 12345;
          return proc;
        },
        killChildProcessTree: () => {},
      },
    });

    processManager.spawnClaudeTurn(task.id, "Do the work", workspaceDir, false, false);

    assert.equal(spawnCalls[0].options.env.AI_OS_TASK_ID, task.id);
    assert.equal(db.state.task.claudePid, 12345);
    assert.equal(db.state.task.ownedClaudePid, 12345);
  } finally {
    if (originalTaskIdEnv === undefined) delete process.env.AI_OS_TASK_ID;
    else process.env.AI_OS_TASK_ID = originalTaskIdEnv;
    resetProcessManagerSingleton();
    cleanupTempWorkspace(workspaceDir);
  }
});

test("spawn passes custom model IDs through --model", () => {
  const workspaceDir = makeTempWorkspace();
  const now = new Date().toISOString();
  const task = {
    id: "task-custom-model",
    title: "Custom model task",
    description: "Verify custom model spawn arguments",
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
    model: "claude-fable-5",
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
        getConfig: () => ({ aiOsDir: workspaceDir }),
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
          proc.stdin = { write() { return true; }, end() {} };
          proc.unref = () => {};
          proc.pid = 12345;
          return proc;
        },
        killChildProcessTree: () => {},
      },
    });

    processManager.spawnClaudeTurn(task.id, "Use custom model", workspaceDir, false, false);

    const args = spawnCalls[0].args;
    assert.equal(args[args.indexOf("--model") + 1], "claude-fable-5");
  } finally {
    resetProcessManagerSingleton();
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
        getConfig: () => ({ aiOsDir: workspaceDir }),
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
          proc.stdin = { write() { return true; }, end() {} };
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
    resetProcessManagerSingleton();
    cleanupTempWorkspace(workspaceDir);
  }
});

test("spawn sends leading-dash prompts through stdin instead of CLI args", () => {
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
  const stdinWrites = [];
  const prompt = "--- SESSION SNAPSHOT ---\nLoaded baseline context.\n--- END SNAPSHOT ---\n\nWrite a poem.";

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: () => {},
        emitChatEvent: () => {},
      },
      "./config": {
        getConfig: () => ({ aiOsDir: workspaceDir }),
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
          proc.stdin = {
            on() { return this; },
            write(value) { stdinWrites.push(value); return true; },
            end(value) { if (value) stdinWrites.push(value); },
          };
          proc.unref = () => {};
          proc.pid = 12345;
          return proc;
        },
        killChildProcessTree: () => {},
      },
    });

    processManager.spawnClaudeTurn(task.id, prompt, workspaceDir, false, false);

    const args = spawnCalls[0].args;
    assert.equal(args.includes(prompt), false);
    assert.deepEqual(stdinWrites.map(decodeClaudeStreamUserMessage), [prompt]);
  } finally {
    resetProcessManagerSingleton();
    cleanupTempWorkspace(workspaceDir);
  }
});

test("spawn keeps very large prompts out of process arguments", () => {
  const workspaceDir = makeTempWorkspace();
  const now = new Date().toISOString();
  const task = {
    id: "task-large-prompt",
    title: "Large prompt task",
    description: "Verify large prompt transport",
    status: "running",
    level: "project",
    parentId: null,
    projectSlug: "large-planned-project",
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
  const stdinWrites = [];
  const prompt = `Plan this project:\n${"Large context block. ".repeat(20_000)}`;

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: () => {},
        emitChatEvent: () => {},
      },
      "./config": {
        getConfig: () => ({ aiOsDir: workspaceDir }),
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
          proc.stdin = {
            on() { return this; },
            write(value) { stdinWrites.push(value); return false; },
            end(value) { if (value) stdinWrites.push(value); },
          };
          proc.unref = () => {};
          proc.pid = 12345;
          return proc;
        },
        killChildProcessTree: () => {},
      },
    });

    processManager.spawnClaudeTurn(task.id, prompt, workspaceDir, false, false);

    const args = spawnCalls[0].args;
    assert.equal(args.includes(prompt), false);
    assert.equal(JSON.stringify(args).includes("Large context block."), false);
    assert.deepEqual(stdinWrites.map(decodeClaudeStreamUserMessage), [prompt]);
    assert.equal(db.state.task.status, "running");
    assert.equal(db.state.task.errorMessage ?? null, null);
  } finally {
    resetProcessManagerSingleton();
    cleanupTempWorkspace(workspaceDir);
  }
});

test("project scoping prompt uses the stored project slug for the brief path", () => {
  const workspaceDir = makeTempWorkspace();
  const now = new Date().toISOString();
  const task = {
    id: "task-project-slug",
    title: "Create an example so I can understand planned project...",
    description: "Create an HTML guide for AI Agent RAG.",
    status: "running",
    level: "project",
    parentId: null,
    projectSlug: "ai-agent-rag",
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

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => createFakeDb(task) },
      "./event-bus": {
        emitTaskEvent: () => {},
        emitChatEvent: () => {},
      },
      "./claude-parser": {
        ClaudeOutputParser: class {},
      },
    });
    const prompt = processManager.buildProjectScopingPrompt(task, workspaceDir);

    assert.match(prompt, /Save the brief to projects\/briefs\/ai-agent-rag\/brief\.md/);
    assert.match(prompt, /project: ai-agent-rag/);
    assert.equal(
      prompt.includes("projects/briefs/create-an-example-so-i-can-understand-planned-project"),
      false,
    );
  } finally {
    resetProcessManagerSingleton();
    cleanupTempWorkspace(workspaceDir);
  }
});

test("Team planned project scoping excludes workspace-local brand and user context", () => {
  const workspaceDir = makeTempWorkspace();
  fs.mkdirSync(path.join(workspaceDir, "brand_context"), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, "context"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "brand_context", "voice-profile.md"),
    "LOCAL_BRAND_SENTINEL",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(workspaceDir, "context", "USER.md"),
    "LOCAL_USER_SENTINEL",
    "utf-8",
  );
  const now = new Date().toISOString();
  const task = {
    id: "team-planned-project-context",
    title: "Team planned project",
    description: "Use only the immutable Team snapshot.",
    status: "running",
    level: "project",
    parentId: null,
    projectSlug: "team-planned-project",
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

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => createFakeDb(task) },
      "./event-bus": { emitTaskEvent: () => {}, emitChatEvent: () => {} },
      "./claude-parser": { ClaudeOutputParser: class {} },
    });
    const prompt = processManager.buildProjectScopingPrompt(task, workspaceDir, false);

    assert.equal(prompt.includes("LOCAL_BRAND_SENTINEL"), false);
    assert.equal(prompt.includes("LOCAL_USER_SENTINEL"), false);
    assert.match(prompt, /Team planned project/);
  } finally {
    resetProcessManagerSingleton();
    cleanupTempWorkspace(workspaceDir);
  }
});

test("subtask extraction ignores generated done markers", () => {
  const now = new Date().toISOString();
  const parentTask = {
    id: "parent-project",
    title: "Parent project",
    description: "Parent",
    status: "review",
    level: "project",
    parentId: null,
    projectSlug: null,
    clientId: null,
    needsInput: 0,
    phaseNumber: null,
    gsdStep: null,
    cronJobSlug: null,
    permissionMode: "bypassPermissions",
    executionPermissionMode: "bypassPermissions",
    model: null,
    thinkingEffort: null,
    createdAt: now,
    updatedAt: now,
  };
  const child = { id: "child-one", title: "Existing child", status: "review" };
  let currentDb;

  function createExtractionDb(logs, { readOnlyInsert = false } = {}) {
    const state = { doneUpdates: 0, insertAttempts: 0 };
    return {
      state,
      prepare(sql) {
        const normalized = sql.replace(/\s+/g, " ").trim();
        return {
          all(...args) {
            if (normalized.includes("SELECT content FROM task_logs WHERE taskId = ?")) {
              assert.equal(args[0], parentTask.id);
              return logs.map((content) => ({ content }));
            }
            if (normalized.includes("SELECT id, title, status FROM tasks WHERE parentId = ?")) {
              assert.equal(args[0], parentTask.id);
              return [{ ...child }];
            }
            throw new Error(`Unhandled all SQL: ${normalized}`);
          },
          get(...args) {
            if (normalized.includes("SELECT cancelRequestedAt FROM tasks WHERE id = ?")) {
              assert.equal(args[0], parentTask.id);
              return { cancelRequestedAt: null };
            }
            if (normalized.includes("SELECT COALESCE(MAX(columnOrder)")) {
              return { maxOrder: 1 };
            }
            throw new Error(`Unhandled get SQL: ${normalized}`);
          },
          run() {
            if (normalized.includes("INSERT INTO tasks")) {
              state.insertAttempts += 1;
              if (readOnlyInsert) throw new Error("task_tree_read_only");
              return { changes: 1 };
            }
            if (normalized.includes("UPDATE tasks SET status = 'done'")) {
              state.doneUpdates += 1;
              return { changes: 1 };
            }
            throw new Error(`Unhandled run SQL: ${normalized}`);
          },
        };
      },
    };
  }

  try {
    const { processManager } = loadProcessManagerModule({
      "./db": { getDb: () => currentDb },
      "./event-bus": {
        emitTaskEvent: () => {},
        emitChatEvent: () => {},
      },
      "./claude-parser": {
        ClaudeOutputParser: class {},
      },
    });

    currentDb = createExtractionDb([
      "```subtasks_done\n[\"Existing child\"]\n```",
    ]);
    processManager.extractAndCreateSubtasks(parentTask.id, parentTask);
    assert.equal(currentDb.state.doneUpdates, 0);

    currentDb = createExtractionDb([
      "```subtasks\n[{\"title\":\"Existing child\",\"status\":\"done\"}]\n```",
    ]);
    processManager.extractAndCreateSubtasks(parentTask.id, parentTask);
    assert.equal(currentDb.state.doneUpdates, 0);

    currentDb = createExtractionDb([
      "```subtasks\n[{\"title\":\"Late child\"}]\n```",
    ], { readOnlyInsert: true });
    assert.doesNotThrow(() => processManager.extractAndCreateSubtasks(parentTask.id, parentTask));
    assert.equal(currentDb.state.insertAttempts, 1);
  } finally {
    resetProcessManagerSingleton();
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
    "Permission bridge failed: Claude could not find the approval prompt tool."
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
      closing: false,
      activeSubagents: new Map(),
      legacySubagentKeys: [],
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
    assert.deepEqual(killedPids, []);
    assert.equal(cronRunPayloads.length, 1);
    assert.equal(cronRunPayloads[0].result, "failure");
    assert.equal(cronRunPayloads[0].completionReason, "needs_input");
    assert.equal(
      emittedEvents.some((event) => event.type === "task:question"),
      true
    );
  } finally {
    resetProcessManagerSingleton();
    cleanupTempWorkspace(workspaceDir);
  }
});

function runUnansweredAskUserQuestionCronTurn(taskId, askInput) {
  const now = new Date().toISOString();
  const task = {
    id: taskId,
    title: "Cron AskUserQuestion task",
    description: "Ask through the built-in tool",
    status: "running",
    level: "task",
    parentId: null,
    projectSlug: null,
    clientId: null,
    needsInput: 0,
    phaseNumber: null,
    gsdStep: null,
    cronJobSlug: "cron-ask-job",
    permissionMode: "bypassPermissions",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    costUsd: null,
    tokensUsed: null,
    durationMs: null,
    activityLabel: null,
    errorMessage: null,
  };
  const db = createFakeDb(task);
  const emittedEvents = [];
  const cronRunPayloads = [];

  const { processManager } = loadProcessManagerModule({
    "./db": { getDb: () => db },
    "./event-bus": {
      emitTaskEvent: (event) => emittedEvents.push(event),
      emitChatEvent: () => {},
    },
    "./cron-service": {
      completeCronRunForTask: (_task, payload) => cronRunPayloads.push(payload),
    },
    "./claude-parser": loadActualClaudeParserModule(),
  });
  processManager.buildCompletionSummary = () => "Cron finished";

  const session = {
    proc: { pid: 5151 },
    runner: { sendUserMessage() { return true; }, stop() {} },
    pendingQuestion: false,
    totalCostUsd: 0,
    totalTokensUsed: 0,
    totalDurationMs: 0,
    resumedFromReview: false,
    closing: false,
    activeSubagents: new Map(),
    activeWorkflowRuns: new Map(),
    terminalizingWorkflowRuns: new Set(),
    workflowParentCompletionPending: false,
    legacySubagentKeys: [],
  };
  processManager.sessions.set(task.id, session);
  processManager.setNextTurnParser(task.id, session);

  const parser = session.parser;
  parser.feedLine(JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: "toolu-ask-cron", name: "AskUserQuestion", input: askInput }],
    },
  }));
  parser.feedLine(JSON.stringify({
    type: "user",
    message: {
      content: [{
        type: "tool_result",
        tool_use_id: "toolu-ask-cron",
        content: "The user did not answer the questions.",
      }],
    },
  }));
  parser.feedLine(JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "I'll hold off until you weigh in." }] },
  }));
  parser.feedLine(JSON.stringify({
    type: "result",
    cost_usd: 0.1,
    duration_ms: 1000,
    usage: { input_tokens: 6, output_tokens: 4 },
  }));

  return { db, emittedEvents, cronRunPayloads };
}

test("a built-in AskUserQuestion call opens the question modal and keeps the cron task waiting", () => {
  try {
    const { db, emittedEvents, cronRunPayloads } = runUnansweredAskUserQuestionCronTurn(
      "task-cron-ask-surfaced",
      {
        questions: [{
          question: "Which audience should the report target?",
          header: "Audience",
          options: [{ label: "Execs", description: "" }, { label: "Engineers", description: "" }],
          multiSelect: false,
        }],
      },
    );

    const structured = db.state.logs.filter((log) => log.type === "structured_question");
    assert.equal(structured.length, 1);
    assert.deepEqual(JSON.parse(structured[0].questionSpec), [{
      id: "q1",
      prompt: "Which audience should the report target?",
      type: "select",
      required: true,
      options: ["Execs", "Engineers"],
    }]);
    assert.equal(db.state.task.status, "review");
    assert.equal(db.state.task.needsInput, 1);
    assert.equal(db.state.task.completedAt, null);
    assert.equal(cronRunPayloads.length, 1);
    assert.equal(cronRunPayloads[0].completionReason, "needs_input");
    assert.equal(emittedEvents.some((event) => event.type === "task:question"), true);
  } finally {
    resetProcessManagerSingleton();
  }
});

test("an unanswered AskUserQuestion result flags the task even when the questions could not be surfaced", () => {
  try {
    const { db, emittedEvents, cronRunPayloads } = runUnansweredAskUserQuestionCronTurn(
      "task-cron-ask-unsurfaced",
      { questions: "not-an-array" },
    );

    assert.equal(db.state.logs.some((log) => log.type === "structured_question"), false);
    const notice = db.state.logs.find(
      (log) => log.type === "system" && /couldn't show/i.test(log.content),
    );
    assert.ok(notice, "expected a visible system notice for the unanswered question");
    assert.equal(db.state.task.status, "review");
    assert.equal(db.state.task.needsInput, 1);
    assert.equal(cronRunPayloads.length, 1);
    assert.equal(cronRunPayloads[0].completionReason, "needs_input");
    assert.equal(emittedEvents.some((event) => event.type === "task:question"), true);
  } finally {
    resetProcessManagerSingleton();
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
      closing: false,
      activeSubagents: new Map(),
      legacySubagentKeys: [],
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
      closing: false,
      activeSubagents: new Map(),
      legacySubagentKeys: [],
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
  } finally {
    resetProcessManagerSingleton();
    cleanupTempWorkspace(workspaceDir);
  }
});

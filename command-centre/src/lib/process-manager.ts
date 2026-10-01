import type { ChildProcess } from "child_process";
import { createInterface } from "readline";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import {
  acquireLocalProfileLease,
  closeAllLocalProfileHandles,
  getActiveLocalProfileDescriptor,
  getDb,
  runWithLocalProfile,
  type LocalProfileLease,
} from "./db";
import type { LocalProfileDescriptorV1 } from "./local-profile";
import { getConfig, getClientAiOsDir } from "./config";
import { completeCronRunForTask } from "./cron-service";
import { emitTaskEvent, emitChatEvent } from "./event-bus";
import {
  ClaudeOutputParser,
  type CompleteData,
  type WorkflowLaunchData,
  type WorkflowTerminalData,
} from "./claude-parser";
import {
  WorkflowAgentJournalBridge,
  type WorkflowJournalAgentCompletedEvent,
  type WorkflowJournalAgentStartedEvent,
  type WorkflowJournalLaunchData,
  type WorkflowJournalRunSnapshot,
} from "./workflow-agent-journal";
import { fileWatcher } from "./file-watcher";
import { buildSiblingContextBlock } from "./gather-context";
import {
  killChildProcessTree,
  spawnManagedTaskProcess,
  terminateProcessTreeByPid,
} from "./subprocess";
import { revokeTaskPermissionRules } from "./task-permission-rules";
import { getActivePermissionMode, getExecutionPermissionMode } from "./permission-mode";
import { getAutoModeUnavailability } from "@/lib/claude-capabilities.server";
import { fetchTeamContextSnapshot, type TeamContextSnapshot } from "./team-api-context";
import {
  refreshAuthorizedTeamSkillCache,
  resolveLocalSkillRuntime,
  resolveTeamSkillRuntime,
  routeSkillCommandAliases,
  type TeamSkillRuntime,
} from "./team-skill-cache";
import {
  createOrLoadRuntimeContextOverlay,
  deleteRuntimeContextOverlay,
  loadRuntimeContextOverlay,
  RuntimeContextOverlayError,
} from "./runtime-context-overlay";
import {
  buildSubagentActivityModel,
  getSubagentInstructions,
  getSubagentName,
  isSubagentToolUse,
} from "./subagent-activity";
import { getTaskLogEntries } from "./task-logs";
import { buildTaskBranchPrompt, isTaskBranch } from "./task-branch";
import type { Task, LogEntry, PermissionMode } from "@/types/task";
import { ASK_USER_QUESTION_TOOL_NAME, type QuestionSpec } from "@/types/question-spec";
import type { StoredWorkScopeV1 } from "./identity/session-scope";
import {
  buildWorkScopeEnvironment,
  getTeamIdForWorkScope,
  inheritWorkScope,
  normalizeWorkScopedRow,
  readWorkScopeFromRow,
} from "./identity/work-scope";

export function dedupeInstructionDirs(directories: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const directory of directories) {
    const resolved = path.resolve(directory);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(resolved);
  }
  return unique;
}

function resolveProcessProfile(): LocalProfileDescriptorV1 {
  if (typeof getActiveLocalProfileDescriptor === "function") {
    return getActiveLocalProfileDescriptor();
  }
  const config = getConfig();
  const dbPath = config.dbPath ?? path.join(config.aiOsDir, ".command-centre", "data.db");
  return {
    version: 1,
    mode: "solo",
    profileKey: "solo",
    dataDir: path.dirname(dbPath),
    stateDir: path.dirname(dbPath),
    tempDir: os.tmpdir(),
    dbPath,
  };
}

function runInProcessProfile<T>(profile: LocalProfileDescriptorV1, operation: () => T): T {
  return typeof runWithLocalProfile === "function"
    ? runWithLocalProfile(profile, operation)
    : operation();
}

function acquireProcessProfileLease(profile: LocalProfileDescriptorV1): LocalProfileLease {
  if (typeof acquireLocalProfileLease === "function") {
    return acquireLocalProfileLease(profile);
  }
  return { descriptor: profile, db: getDb(), release() {} };
}

/**
 * Injected into every initial task prompt so Claude knows to emit
 * typed clarifying questions as a fenced block instead of asking in
 * prose. The prose-detection path still catches cases where Claude
 * ignores this instruction.
 */
const STRUCTURED_QUESTION_ADDENDUM = `\n\n---\nWhen you need clarification from the user, do NOT ask in prose. Instead emit a fenced code block with the language tag \`ask-user-questions\` containing a JSON array of typed question objects. Each object has: id (short string), prompt (the question), type ("text" | "multiline" | "select" | "multiselect"), required (boolean), and options (array of strings, only for select/multiselect). Prefer select/multiselect when the set of reasonable answers is small. Example:\n\n\`\`\`ask-user-questions\n[\n  { "id": "audience", "prompt": "Who is the primary audience?", "type": "text", "required": true },\n  { "id": "tone", "prompt": "What tone should this take?", "type": "select", "options": ["Formal", "Casual", "Playful"], "required": true }\n]\n\`\`\`\n\nEmit the block and stop — the system will surface it to the user, collect answers, and resume you with their replies.\n---\n`;
const PERMISSION_BRIDGE_SERVER = "permissions";
const PERMISSION_BRIDGE_TOOL_NAME = "approval_prompt";
const PERMISSION_BRIDGE_TOOL_ID = `mcp__${PERMISSION_BRIDGE_SERVER}__${PERMISSION_BRIDGE_TOOL_NAME}`;
const PERMISSION_BRIDGE_RELATIVE_PATH = path.join(
  "command-centre",
  "scripts",
  "permission-prompt-mcp.cjs",
);
const PERMISSION_MODE_CONTROL_TIMEOUT_MS = 60_000;

export class PermissionModeControlError extends Error {
  constructor(
    message: string,
    public readonly kind: "rejected" | "ambiguous" | "persistence",
    public readonly status: 409 | 500 | 504,
  ) {
    super(message);
    this.name = "PermissionModeControlError";
  }
}

export class TaskCancellationError extends Error {
  readonly status = 503;

  constructor(message: string) {
    super(message);
    this.name = "TaskCancellationError";
  }
}

/**
 * Manages Claude CLI child processes for task execution.
 * Supports multi-turn conversations through one persistent stream-json process per task.
 * Singleton -- one instance per server process.
 */
interface SessionEntry {
  taskId: string;
  profileLease: LocalProfileLease;
  workScope: StoredWorkScopeV1;
  teamEnrichmentMode: TeamEnrichmentMode;
  skillRuntime: TeamSkillRuntime | null;
  proc: ChildProcess;
  runner: ClaudeRunnerSession;
  parser?: ClauseOutputParserWithTurnAwareness;
  /** Set when a question was detected during this turn — prevents handleComplete from finalising */
  pendingQuestion: boolean;
  /** Accumulated cost across multiple turns */
  totalCostUsd: number;
  totalTokensUsed: number;
  totalDurationMs: number;
  /** True when this turn was resumed from "review" status (for logging only — tasks always go through review) */
  resumedFromReview: boolean;
  /** Set while Command Centre intentionally stops the process. */
  closing: boolean;
  activeSubagents: Map<string, ActiveSubagent>;
  activeWorkflowRuns: Map<string, ActiveWorkflowRun>;
  terminalizingWorkflowRuns: Set<string>;
  workflowParentCompletionPending: boolean;
  legacySubagentKeys: string[];
  deferredCompletion?: CompleteData;
  cleanupTempFiles?: () => void;
  pendingControlRequests: Map<string, PendingControlRequest>;
  permissionChangeQueue: Promise<void>;
  appliedPermissionMode: PermissionMode;
}

type TeamEnrichmentMode = "authorized" | "conversation_only";

interface TeamEnrichmentResolution {
  mode: TeamEnrichmentMode;
  snapshot: TeamContextSnapshot | null;
  skillRuntime: TeamSkillRuntime | null;
}

interface PendingControlRequest {
  resolve: () => void;
  reject: (error: PermissionModeControlError) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface ActiveSubagent {
  toolUseKey: string;
  toolUseId?: string;
  agentName: string;
  instructions: string | null;
  startedAt: string;
  source?: "direct" | "workflow";
}

interface ActiveWorkflowRun {
  runId: string;
  toolUseId: string;
  workflowTaskId: string;
  sessionId: string;
  transcriptDir: string;
}

interface ClaudeRunnerSession {
  proc: ChildProcess;
  sendUserMessage(message: string): boolean;
  sendPermissionModeControl(requestId: string, mode: PermissionMode): boolean;
  stop(signal?: NodeJS.Signals): void;
}

interface ClaudeRunnerStartOptions {
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

interface ClaudeRunner {
  start(options: ClaudeRunnerStartOptions): ClaudeRunnerSession;
}

function buildClaudeStreamUserMessage(content: string): string {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content,
    },
    parent_tool_use_id: null,
  }) + "\n";
}

function writeClaudeStreamPayload(stdin: ChildProcess["stdin"], payload: string): boolean {
  if (!stdin || typeof stdin.write !== "function") return false;
  if (stdin.destroyed || stdin.writableEnded || stdin.writable === false) return false;
  try {
    // Writable.write() returning false signals backpressure. The chunk was
    // accepted into the buffer and will be flushed after "drain".
    stdin.write(payload);
    return true;
  } catch {
    return false;
  }
}

export function writeClaudeStreamUserMessage(
  stdin: ChildProcess["stdin"],
  content: string,
): boolean {
  return writeClaudeStreamPayload(stdin, buildClaudeStreamUserMessage(content));
}

function buildPermissionModeControlRequest(requestId: string, mode: PermissionMode): string {
  return JSON.stringify({
    type: "control_request",
    request_id: requestId,
    request: {
      subtype: "set_permission_mode",
      mode,
    },
  }) + "\n";
}

export function writeClaudePermissionModeControl(
  stdin: ChildProcess["stdin"],
  requestId: string,
  mode: PermissionMode,
): boolean {
  return writeClaudeStreamPayload(
    stdin,
    buildPermissionModeControlRequest(requestId, mode),
  );
}

class StreamingClaudeRunner implements ClaudeRunner {
  start(options: ClaudeRunnerStartOptions): ClaudeRunnerSession {
    const proc = spawnManagedTaskProcess("claude", options.args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: options.env,
      detached: false,
    });

    if (proc.stdin && typeof proc.stdin.on === "function") {
      proc.stdin.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code !== "EPIPE") {
          console.warn(`[process-manager] Claude stdin error: ${err.message}`);
        }
      });
    }

    return {
      proc,
      sendUserMessage(message: string): boolean {
        return writeClaudeStreamUserMessage(proc.stdin, message);
      },
      sendPermissionModeControl(requestId: string, mode: PermissionMode): boolean {
        return writeClaudePermissionModeControl(proc.stdin, requestId, mode);
      },
      stop(signal: NodeJS.Signals = "SIGTERM"): void {
        killChildProcessTree(proc, signal);
      },
    };
  }
}

const PROCESS_MANAGER_CLEANUP_EVENTS = ["exit", "SIGTERM", "SIGINT"] as const;
type ProcessManagerCleanupEvent = (typeof PROCESS_MANAGER_CLEANUP_EVENTS)[number];

interface ProcessManagerCleanupTarget {
  cleanup(): void;
}

interface ProcessManagerCleanupRegistry {
  managers: Set<ProcessManagerCleanupTarget>;
  listeners: Partial<Record<ProcessManagerCleanupEvent, () => void>>;
}

const globalForProcessManagerCleanup = globalThis as unknown as {
  __processManagerCleanup?: ProcessManagerCleanupRegistry;
};

function getProcessManagerCleanupRegistry(): ProcessManagerCleanupRegistry {
  if (!globalForProcessManagerCleanup.__processManagerCleanup) {
    globalForProcessManagerCleanup.__processManagerCleanup = {
      managers: new Set(),
      listeners: {},
    };
  }
  return globalForProcessManagerCleanup.__processManagerCleanup;
}

function registerProcessManagerCleanup(manager: ProcessManagerCleanupTarget): void {
  const registry = getProcessManagerCleanupRegistry();
  registry.managers.add(manager);

  for (const event of PROCESS_MANAGER_CLEANUP_EVENTS) {
    if (registry.listeners[event]) continue;

    const listener = () => {
      for (const activeManager of Array.from(registry.managers)) {
        activeManager.cleanup();
      }
    };

    registry.listeners[event] = listener;
    process.on(event, listener);
  }
}

function unregisterProcessManagerCleanup(manager: ProcessManagerCleanupTarget): void {
  const registry = globalForProcessManagerCleanup.__processManagerCleanup;
  if (!registry) return;

  registry.managers.delete(manager);
  if (registry.managers.size > 0) return;

  for (const event of PROCESS_MANAGER_CLEANUP_EVENTS) {
    const listener = registry.listeners[event];
    if (!listener) continue;
    process.off(event, listener);
    delete registry.listeners[event];
  }

  delete globalForProcessManagerCleanup.__processManagerCleanup;
}

class ProcessManager {
  private sessions = new Map<string, SessionEntry>();
  private lastProgressEmit = new Map<string, number>();
  private runner: ClaudeRunner;
  private workflowJournalBridge: WorkflowAgentJournalBridge;
  private restoringWorkflowRuns = new Set<string>();
  /** Track which tasks are waiting for user reply between persistent turns */
  private waitingForReply = new Set<string>();
  /** Track tasks that have claimed execution before a live Claude session exists */
  private startingTasks = new Set<string>();

  constructor(runner: ClaudeRunner = new StreamingClaudeRunner()) {
    this.runner = runner;
    this.workflowJournalBridge = new WorkflowAgentJournalBridge({
      onAgentStarted: (event) => this.handleWorkflowAgentStarted(event),
      onAgentCompleted: (event) => this.handleWorkflowAgentCompleted(event),
      onRunTerminal: (snapshot) => this.handleWorkflowRunTerminal(snapshot),
    });
    registerProcessManagerCleanup(this);
  }

  private taskKey(
    taskId: string,
    descriptor: LocalProfileDescriptorV1 = resolveProcessProfile(),
  ): string {
    if (typeof getActiveLocalProfileDescriptor !== "function") return taskId;
    return `${descriptor.profileKey}:${taskId}`;
  }

  dispose(): void {
    this.cleanup();
    unregisterProcessManagerCleanup(this);
  }

  /** Check if this task has an active in-memory session (managed by processManager) */
  hasActiveSession(taskId: string): boolean {
    return (
      this.sessions.has(this.taskKey(taskId)) ||
      this.waitingForReply.has(this.taskKey(taskId)) ||
      this.startingTasks.has(this.taskKey(taskId))
    );
  }

  removeTaskContextOverlay(taskId: string): void {
    const profile = resolveProcessProfile();
    if (profile.mode !== "team") return;
    deleteRuntimeContextOverlay({
      profileTempDir: profile.tempDir,
      ownerType: "task",
      ownerId: taskId,
    });
  }

  // ownedClaudePid is the reaper's proof that this Command Centre spawned the
  // exact process in claudePid; only this manager ever writes it.
  private storeClaudePid(taskId: string, pid: number | null | undefined): void {
    const db = getDb();
    if (pid == null) {
      db.prepare("UPDATE tasks SET claudePid = NULL, ownedClaudePid = NULL WHERE id = ?").run(taskId);
      return;
    }
    db.prepare(
      "UPDATE tasks SET claudePid = ?, ownedClaudePid = ? WHERE id = ? AND cancelRequestedAt IS NULL",
    ).run(pid, pid, taskId);
  }

  private clearClaudePid(taskId: string): void {
    this.storeClaudePid(taskId, null);
  }

  private isCancellationRequested(taskId: string): boolean {
    const row = getDb().prepare(
      "SELECT cancelRequestedAt FROM tasks WHERE id = ?",
    ).get(taskId) as { cancelRequestedAt: string | null } | undefined;
    return Boolean(row?.cancelRequestedAt);
  }

  storeClaudeSessionId(taskId: string, sessionId: string): void {
    const db = getDb();
    db.prepare("UPDATE tasks SET claudeSessionId = ? WHERE id = ?").run(sessionId, taskId);
    console.log(`[process-manager] Stored claudeSessionId=${sessionId} for ${taskId.slice(0, 8)}`);

    // Mirror the session ID up to this task's project/GSD parent if the
    // parent doesn't already own one. This establishes the single-session
    // model: whichever subtask runs first captures the canonical session
    // for the entire project, and every later subtask resumes it.
    const parentRow = db
      .prepare(
        "SELECT p.id as id, p.level as level, p.claudeSessionId as claudeSessionId, c.forkedFromTaskId as forkedFromTaskId " +
        "FROM tasks c JOIN tasks p ON c.parentId = p.id WHERE c.id = ?"
      )
      .get(taskId) as
      | { id: string; level: string; claudeSessionId: string | null; forkedFromTaskId: string | null }
      | undefined;
    if (
      parentRow &&
      (parentRow.level === "project" || parentRow.level === "gsd") &&
      !parentRow.claudeSessionId &&
      !parentRow.forkedFromTaskId
    ) {
      db.prepare("UPDATE tasks SET claudeSessionId = ? WHERE id = ?")
        .run(sessionId, parentRow.id);
      console.log(
        `[process-manager] Mirrored claudeSessionId up to parent ${parentRow.id.slice(0, 8)} (${parentRow.level})`,
      );
    }
  }

  private setNextTurnParser(taskId: string, session: SessionEntry): void {
    session.pendingQuestion = false;
    session.activeSubagents.clear();
    this.getActiveWorkflowRuns(session).clear();
    this.getTerminalizingWorkflowRuns(session).clear();
    session.workflowParentCompletionPending = false;
    session.legacySubagentKeys = [];
    session.deferredCompletion = undefined;
    session.parser = new ClauseOutputParserWithTurnAwareness(taskId, session, this);
  }

  private stopSession(taskId: string, signal: NodeJS.Signals = "SIGTERM"): void {
    const taskKey = this.taskKey(taskId);
    const session = this.sessions.get(taskKey);
    if (!session) {
      this.waitingForReply.delete(taskKey);
      this.lastProgressEmit.delete(taskKey);
      this.clearClaudePid(taskId);
      return;
    }

    session.closing = true;
    this.rejectPendingControlRequests(
      session,
      new PermissionModeControlError("The live Claude session closed before confirming the permission change.", "ambiguous", 504),
    );
    session.cleanupTempFiles?.();
    if (session.runner) {
      session.runner.stop(signal);
    } else {
      killChildProcessTree(session.proc, signal);
    }

    this.sessions.delete(taskKey);
    session.profileLease?.release();
    this.waitingForReply.delete(taskKey);
    this.lastProgressEmit.delete(taskKey);
    this.clearClaudePid(taskId);
  }

  private rejectPendingControlRequests(
    session: SessionEntry,
    error: PermissionModeControlError,
  ): void {
    const pendingRequests = session.pendingControlRequests;
    if (!pendingRequests) return;
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    pendingRequests.clear();
  }

  private handleControlResponse(session: SessionEntry, line: string): boolean {
    if (!line.includes("control_response")) return false;

    let message: {
      type?: string;
      request_id?: string;
      response?: {
        request_id?: string;
        subtype?: string;
        error?: string;
        response?: { mode?: string };
      };
    };
    try {
      message = JSON.parse(line);
    } catch {
      return false;
    }
    if (message.type !== "control_response") return false;

    const response = message.response;
    const requestId = response?.request_id ?? message.request_id;
    if (!requestId) return true;
    const pending = session.pendingControlRequests?.get(requestId);
    if (!pending) return true;

    clearTimeout(pending.timeout);
    session.pendingControlRequests.delete(requestId);
    if (response?.subtype === "success") {
      pending.resolve();
    } else {
      pending.reject(new PermissionModeControlError(
        response?.error || "Claude rejected the permission mode change.",
        "rejected",
        409,
      ));
    }
    return true;
  }

  private async setLivePermissionMode(taskId: string, mode: PermissionMode): Promise<void> {
    const session = this.sessions.get(this.taskKey(taskId));
    if (!session) return;
    session.pendingControlRequests ??= new Map();
    session.permissionChangeQueue ??= Promise.resolve();
    session.appliedPermissionMode ??= getActivePermissionMode(
      (getDb().prepare("SELECT permissionMode FROM tasks WHERE id = ?").get(taskId) as
        | { permissionMode: string | null }
        | undefined)?.permissionMode,
      "bypassPermissions",
    );

    const operation = session.permissionChangeQueue
      .catch(() => {})
      .then(async () => {
        if (this.sessions.get(this.taskKey(taskId)) !== session || session.closing) {
          throw new PermissionModeControlError(
            "The live Claude session is no longer available.",
            "ambiguous",
            504,
          );
        }
        if (session.appliedPermissionMode === mode) return;

        const requestId = `perm-${crypto.randomUUID()}`;
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            session.pendingControlRequests.delete(requestId);
            reject(new PermissionModeControlError(
              "Claude did not confirm the permission change within 60 seconds.",
              "ambiguous",
              504,
            ));
          }, PERMISSION_MODE_CONTROL_TIMEOUT_MS);

          session.pendingControlRequests.set(requestId, { resolve, reject, timeout });
          const sendControl = session.runner?.sendPermissionModeControl;
          const sent = typeof sendControl === "function"
            ? sendControl.call(session.runner, requestId, mode)
            : Boolean(session.proc.stdin?.write?.(buildPermissionModeControlRequest(requestId, mode)));
          if (!sent) {
            clearTimeout(timeout);
            session.pendingControlRequests.delete(requestId);
            reject(new PermissionModeControlError(
              "The live Claude session could not accept the permission change.",
              "ambiguous",
              504,
            ));
          }
        });

        session.appliedPermissionMode = mode;
      });

    session.permissionChangeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async applyPermissionState(
    taskId: string,
    state: { permissionMode: PermissionMode; executionPermissionMode: PermissionMode },
    options: { persistAdditional?: () => void } = {},
  ): Promise<Task> {
    const db = getDb();
    const existing = db.prepare(
      "SELECT * FROM tasks WHERE id = ?",
    ).get(taskId) as (Omit<Task, "workScope"> & { workScope: string | null }) | undefined;
    if (!existing) {
      throw new PermissionModeControlError("Task not found.", "persistence", 500);
    }
    const workScope = readWorkScopeFromRow(existing);

    const previousPermissionMode = getActivePermissionMode(
      existing.permissionMode,
      "bypassPermissions",
    );
    const previousExecutionMode = getExecutionPermissionMode(
      existing.executionPermissionMode ?? existing.permissionMode,
      "bypassPermissions",
    );
    const nextPermissionMode = getActivePermissionMode(
      state.permissionMode,
      previousPermissionMode,
    );
    const nextExecutionMode = getExecutionPermissionMode(
      state.executionPermissionMode,
      previousExecutionMode,
    );
    const session = this.sessions.get(this.taskKey(taskId));
    if (session && JSON.stringify(session.workScope) !== JSON.stringify(workScope)) {
      this.handleLostLiveSession(
        taskId,
        "The saved work scope no longer matches the live process, so it was stopped safely.",
      );
      throw new PermissionModeControlError(
        "The task work scope does not match the live session.",
        "ambiguous",
        409,
      );
    }
    const needsLiveChange = Boolean(session && session.appliedPermissionMode !== nextPermissionMode);

    if (needsLiveChange) {
      try {
        await this.setLivePermissionMode(taskId, nextPermissionMode);
      } catch (error) {
        const controlError = error instanceof PermissionModeControlError
          ? error
          : new PermissionModeControlError(String(error), "ambiguous", 504);
        if (controlError.kind === "ambiguous") {
          this.handleLostLiveSession(
            taskId,
            "Command Centre could not confirm the permission change, so the live Claude session was stopped without replaying the current turn.",
          );
        }
        throw controlError;
      }
    }

    const persist = db.transaction(() => {
      db.prepare(
        "UPDATE tasks SET permissionMode = ?, executionPermissionMode = ?, updatedAt = ? WHERE id = ?",
      ).run(nextPermissionMode, nextExecutionMode, new Date().toISOString(), taskId);
      options.persistAdditional?.();
    });

    try {
      persist();
    } catch (error) {
      if (needsLiveChange) {
        try {
          await this.setLivePermissionMode(taskId, previousPermissionMode);
        } catch {
          this.handleLostLiveSession(
            taskId,
            "Command Centre could not restore the previous permission mode, so the live Claude session was stopped.",
          );
        }
      }
      throw new PermissionModeControlError(
        `The permission change could not be saved: ${error instanceof Error ? error.message : String(error)}`,
        "persistence",
        500,
      );
    }

    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as
      Omit<Task, "workScope"> & { workScope: string | null };
    return this.normalizeTask(updated);
  }

  private sendToLiveSession(taskId: string, message: string): boolean {
    const session = this.sessions.get(this.taskKey(taskId));
    if (!session) return false;

    this.setNextTurnParser(taskId, session);
    const sent = session.runner
      ? session.runner.sendUserMessage(message)
      : writeClaudeStreamUserMessage(session.proc.stdin, message);
    if (!sent) {
      console.warn(
        `[process-manager] Live Claude session for ${taskId.slice(0, 8)} could not accept reply — falling back to resume`,
      );
      this.stopSession(taskId);
      return false;
    }

    this.waitingForReply.delete(this.taskKey(taskId));
    this.storeClaudePid(taskId, session.proc.pid);
    return true;
  }

  private resolvePermissionPromptScriptPath(aiOsDir: string): string {
    const absolutePath = path.join(aiOsDir, PERMISSION_BRIDGE_RELATIVE_PATH);
    if (fs.existsSync(absolutePath)) return absolutePath;

    // Next.js and tests can run with command-centre as the process cwd while
    // the configured workspace points elsewhere.
    const bundledPath = path.join(process.cwd(), "scripts", "permission-prompt-mcp.cjs");
    if (fs.existsSync(bundledPath)) return bundledPath;

    throw new Error(`Permission bridge script is missing at ${absolutePath}`);
  }

  private reportPermissionBridgeFailure(taskId: string, summary: string, detail?: string): void {
    const timestamp = new Date().toISOString();
    this.addLogEntry(taskId, {
      id: crypto.randomUUID(),
      type: "system",
      timestamp,
      content: detail ? `${summary} ${detail}` : summary,
    });
    this.handleTaskError(taskId, summary);
  }

  private classifyPermissionBridgeFailure(stderr: string): {
    summary: string;
    detail?: string;
  } | null {
    const normalizedStderr = stderr.trim();
    if (!normalizedStderr) {
      return null;
    }

    if (
      /permission-prompt-tool/i.test(normalizedStderr) &&
      /not found/i.test(normalizedStderr) &&
      (new RegExp(PERMISSION_BRIDGE_TOOL_ID, "i").test(normalizedStderr) ||
        new RegExp(PERMISSION_BRIDGE_TOOL_NAME, "i").test(normalizedStderr))
    ) {
      return {
        summary: "Permission bridge failed: Claude could not find the approval prompt tool.",
        detail: `Expected ${PERMISSION_BRIDGE_TOOL_ID} from the temporary ${PERMISSION_BRIDGE_SERVER} MCP server. This usually means the server stayed pending and never finished connecting.`,
      };
    }

    if (
      /(mcp|permission)/i.test(normalizedStderr) &&
      /(failed|error|unexpectedly|exited|spawn|startup|connect|handshake|stdio)/i.test(normalizedStderr)
    ) {
      return {
        summary: "Permission bridge failed: the temporary MCP server could not start.",
        detail: normalizedStderr.slice(0, 300),
      };
    }

    return null;
  }

  private async resolveTeamEnrichment(
    taskId: string,
    task: Pick<Task, "clientId">,
    workScope: StoredWorkScopeV1,
  ): Promise<TeamEnrichmentResolution> {
    if (workScope.mode !== "team") {
      return { mode: "authorized", snapshot: null, skillRuntime: resolveLocalSkillRuntime(task.clientId) };
    }
    try {
      const snapshot = await fetchTeamContextSnapshot(
        task.clientId ?? null,
        "command-centre-task",
        { teamId: workScope.scope.teamId },
      );
      if (snapshot?.markdown) {
        let skillRuntime: TeamSkillRuntime;
        try {
          await refreshAuthorizedTeamSkillCache(workScope.scope.teamId);
          skillRuntime = resolveTeamSkillRuntime(workScope.scope.teamId, task.clientId);
        } catch (error) {
          console.warn(
            `[process-manager] Team skill authorization refresh failed for ${taskId.slice(0, 8)}; continuing with local skills only:`,
            error instanceof Error ? error.message : error,
          );
          const resolved = resolveTeamSkillRuntime(workScope.scope.teamId, task.clientId);
          skillRuntime = { ...resolved, pluginDir: null, teamSkills: [] };
        }
        return { mode: "authorized", snapshot, skillRuntime };
      }
    } catch (error) {
      console.warn(
        `[process-manager] Stored Team scope unavailable for ${taskId.slice(0, 8)}:`,
        error instanceof Error ? error.message : error,
      );
    }
    return {
      mode: "conversation_only",
      snapshot: null,
      skillRuntime: resolveTeamSkillRuntime(workScope.scope.teamId, task.clientId),
    };
  }

  /**
   * Execute a task by spawning a Claude CLI session.
   */
  async executeTask(taskId: string): Promise<void> {
    const profile = resolveProcessProfile();
    return runInProcessProfile(profile, () => this.executeTaskInProfile(taskId));
  }

  private async executeTaskInProfile(taskId: string): Promise<void> {
    console.log(`[process-manager] executeTask called for ${taskId}`);

    if (this.hasActiveSession(taskId)) {
      console.warn(`[process-manager] Task ${taskId} is already running, skipping`);
      return;
    }

    this.startingTasks.add(this.taskKey(taskId));

    try {
      const db = getDb();
      const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task | undefined;

      if (!task) {
        console.error(`[process-manager] Task ${taskId} not found in database`);
        return;
      }
      const workScope = readWorkScopeFromRow(task);

      const autoModeUnavailable = await getAutoModeUnavailability({
        permissionMode: task.permissionMode,
        executionPermissionMode: task.executionPermissionMode,
        model: task.model,
      });
      if (autoModeUnavailable) {
        this.handleTaskError(taskId, autoModeUnavailable.error);
        return;
      }

      const now = new Date().toISOString();

      const claimed = db.prepare(
        "UPDATE tasks SET status = ?, startedAt = COALESCE(startedAt, ?), updatedAt = ?, activityLabel = ?, errorMessage = NULL, needsInput = 0 WHERE id = ? AND status = 'queued' AND cancelRequestedAt IS NULL"
      ).run("running", now, now, "Starting Claude session...", taskId);

      if (!claimed.changes) {
        console.warn(`[process-manager] Task ${taskId} is no longer queued, skipping duplicate start`);
        return;
      }

      if (isTaskBranch(task)) {
        const branchLogs = this.getLogEntries(taskId);
        await this.startFreshTaskTurn(taskId, task, now, {
          clearLogs: false,
          clearOutputs: true,
          overridePrompt: buildTaskBranchPrompt(task, branchLogs),
        });
        return;
      }

      // If this is a parent task that already has children (subtasks were created
      // at goal-entry time by scope-goal), don't execute the parent itself.
      // Just set it to "running" and let the auto-queue system manage children.
      if (!task.parentId && (task.level === "project" || task.level === "task")) {
        const childCount = db.prepare(
          "SELECT COUNT(*) as count FROM tasks WHERE parentId = ?"
        ).get(taskId) as { count: number };

        if (childCount.count > 0) {
          const backlogChildren = db.prepare(
            "SELECT * FROM tasks WHERE parentId = ? AND status = 'backlog' ORDER BY columnOrder ASC"
          ).all(taskId) as Task[];

          // Queue the first child(ren)
          if (backlogChildren.length > 0) {
            const hasDeps = backlogChildren.some(c => {
              const match = c.description?.match(/\[depends_on:\s*([\d,\s]+)\]\s*$/);
              return match ? match[1].split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)).length > 0 : false;
            });

            if (hasDeps) {
              // Queue all independent children (no dependencies)
              for (const child of backlogChildren) {
                const depMatch = child.description?.match(/\[depends_on:\s*([\d,\s]+)\]\s*$/);
                const deps = depMatch ? depMatch[1].split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) : [];
                if (deps.length === 0) {
                  db.prepare("UPDATE tasks SET status = 'queued', updatedAt = ? WHERE id = ?").run(now, child.id);
                  const updatedChild = db.prepare("SELECT * FROM tasks WHERE id = ?").get(child.id) as Task;
                  emitTaskEvent({ type: "task:status", task: { ...updatedChild, needsInput: Boolean(updatedChild.needsInput) }, timestamp: now });
                }
              }
            } else {
              // Sequential: queue first child only
              const first = backlogChildren[0];
              db.prepare("UPDATE tasks SET status = 'queued', updatedAt = ? WHERE id = ?").run(now, first.id);
              const updatedFirst = db.prepare("SELECT * FROM tasks WHERE id = ?").get(first.id) as Task;
              emitTaskEvent({ type: "task:status", task: { ...updatedFirst, needsInput: Boolean(updatedFirst.needsInput) }, timestamp: now });
            }
          }

          // Set parent to "running" as a container
          db.prepare(
            "UPDATE tasks SET status = 'running', startedAt = ?, updatedAt = ?, activityLabel = ? WHERE id = ?"
          ).run(now, now, `0/${childCount.count} subtasks done — first task queued`, taskId);
          const updatedParent = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;
          emitTaskEvent({ type: "task:status", task: { ...updatedParent, needsInput: Boolean(updatedParent.needsInput) }, timestamp: now });

          console.log(`[process-manager] Task ${taskId} has ${childCount.count} children — running as container, not executing`);
          return;
        }
      }

      await this.startFreshTaskTurn(taskId, task, now, {
        clearLogs: true,
        clearOutputs: true,
        initialUserLog: {
          content: task.description || task.title,
          permissionMode: task.permissionMode || undefined,
        },
      });
    } finally {
      this.startingTasks.delete(this.taskKey(taskId));
    }
  }

  async startBacklogTaskFromReply(
    taskId: string,
    message: string,
    options: { logEntryId?: string; permissionMode?: string | null } = {},
  ): Promise<boolean> {
    const profile = resolveProcessProfile();
    return runInProcessProfile(profile, () => this.startBacklogTaskFromReplyInProfile(taskId, message, options));
  }

  private async startBacklogTaskFromReplyInProfile(
    taskId: string,
    message: string,
    options: { logEntryId?: string; permissionMode?: string | null } = {},
  ): Promise<boolean> {
    console.log(`[process-manager] startBacklogTaskFromReply called for ${taskId}`);

    if (this.hasActiveSession(taskId)) {
      console.warn(`[process-manager] Task ${taskId} is already active, cannot start from backlog reply`);
      return false;
    }

    this.startingTasks.add(this.taskKey(taskId));

    try {
      const db = getDb();
      const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task | undefined;

      if (!task || !task.parentId || task.status !== "backlog") {
        console.warn(`[process-manager] Task ${taskId} is not a backlog child task`);
        return false;
      }

      const now = new Date().toISOString();
      const claimed = db.prepare(
        "UPDATE tasks SET status = 'running', startedAt = COALESCE(startedAt, ?), updatedAt = ?, lastReplyAt = ?, activityLabel = ?, errorMessage = NULL, needsInput = 0 WHERE id = ? AND status = 'backlog' AND parentId IS NOT NULL"
      ).run(now, now, now, "Starting Claude session...", taskId);

      if (!claimed.changes) {
        console.warn(`[process-manager] Task ${taskId} is no longer a backlog child task`);
        return false;
      }

      await this.startFreshTaskTurn(taskId, task, now, {
        clearLogs: false,
        clearOutputs: true,
        initialUserLog: {
          id: options.logEntryId,
          content: message,
          permissionMode: options.permissionMode ?? task.permissionMode ?? undefined,
        },
        firstReplyMessage: message,
      });

      return true;
    } finally {
      this.startingTasks.delete(this.taskKey(taskId));
    }
  }

  private async startFreshTaskTurn(
    taskId: string,
    task: Task,
    now: string,
    options: {
      clearLogs: boolean;
      clearOutputs: boolean;
      initialUserLog?: { id?: string; content: string; permissionMode?: string | null };
      firstReplyMessage?: string;
      overridePrompt?: string;
    },
  ): Promise<void> {
    const db = getDb();
    const workScope = readWorkScopeFromRow(task);
    const teamId = getTeamIdForWorkScope(workScope);

    if (this.isCancellationRequested(taskId)) return;

    if (options.clearLogs) {
      db.prepare("DELETE FROM task_logs WHERE taskId = ?").run(taskId);
    }
    if (options.clearOutputs) {
      db.prepare("DELETE FROM task_outputs WHERE taskId = ?").run(taskId);
    }

    if (options.initialUserLog) {
      this.addLogEntry(taskId, {
        id: options.initialUserLog.id ?? crypto.randomUUID(),
        type: "user_reply",
        timestamp: now,
        content: options.initialUserLog.content,
        permissionMode: options.initialUserLog.permissionMode ?? undefined,
      });
    }

    const updatedTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;
    emitTaskEvent({ type: "task:status", task: this.normalizeTask(updatedTask), timestamp: now });

    try {
      await fileWatcher.startWatching(taskId, task.projectSlug, task.clientId);
    } catch (err) {
      console.error(`[process-manager] fileWatcher.startWatching failed:`, err);
    }

    if (this.isCancellationRequested(taskId)) {
      await fileWatcher.stopWatching(taskId);
      return;
    }

    try {
      const fsSnap = require("fs") as typeof import("fs");
      const pathSnap = require("path") as typeof import("path");
      const { captureSnapshot } = require("./file-diff") as typeof import("./file-diff");
      const snapConfig = getConfig();
      const snapCwd = task.clientId ? getClientAiOsDir(task.clientId) : snapConfig.aiOsDir;
      if (task.projectSlug) {
        const projDir = pathSnap.join(snapCwd, "projects", "briefs", task.projectSlug);
        if (fsSnap.existsSync(projDir)) {
          const snapshot = captureSnapshot(projDir);
          db.prepare("UPDATE tasks SET startSnapshot = ? WHERE id = ?").run(JSON.stringify(snapshot), taskId);
        }
      }
    } catch (err) {
      console.error(`[process-manager] snapshot capture failed:`, err);
    }

    const config = getConfig();

    const cwd = task.clientId ? getClientAiOsDir(task.clientId) : config.aiOsDir;

    if (task.clientId) {
      const fs = await import("fs");
      if (!fs.existsSync(cwd)) {
        this.handleTaskError(taskId, `Client directory not found: clients/${task.clientId}`);
        return;
      }
    }

    const fs = require("fs") as typeof import("fs");
    const pathMod = require("path") as typeof import("path");
    const hasSavedTeamContext = workScope.mode === "team";
    if (this.isCancellationRequested(taskId)) {
      await fileWatcher.stopWatching(taskId);
      return;
    }
    const contextSources: {
      type: string;
      label: string;
      path?: string;
      status?: "loaded" | "available";
      title?: string | null;
      size?: number;
    }[] = [];
    const addLoadedContext = (type: string, label: string, path?: string): void => {
      contextSources.push({ type, label, path, status: "loaded" });
    };
    const addAvailableContext = (
      type: string,
      label: string,
      path?: string,
      extra: { title?: string | null; size?: number } = {},
    ): void => {
      contextSources.push({ type, label, path, status: "available", ...extra });
    };
    const toWorkspaceRelativePath = (absolutePath: string): string => {
      const relativePath = pathMod.relative(config.aiOsDir, absolutePath);
      return relativePath.split(pathMod.sep).join("/");
    };

    if (!hasSavedTeamContext) {
      // Claude loads the instruction chain from the workspace root through the
      // active client directory. Report those files as loaded without copying
      // their contents into the task prompt a second time.
      const instructionDirs = dedupeInstructionDirs(task.clientId
        ? [config.aiOsDir, cwd]
        : [config.aiOsDir]);
      for (const instructionDir of instructionDirs) {
        for (const instructionFile of ["AGENTS.md", "CLAUDE.md"]) {
          const filePath = pathMod.join(instructionDir, instructionFile);
          if (!fs.existsSync(filePath)) continue;
          const sourcePath = toWorkspaceRelativePath(filePath);
          addLoadedContext("system", sourcePath, sourcePath);
        }
      }

      for (const contextFile of ["learnings.md"]) {
        const filePath = pathMod.join(cwd, "context", contextFile);
        if (fs.existsSync(filePath)) {
          addAvailableContext("system", contextFile, toWorkspaceRelativePath(filePath));
        }
      }

      const brandDir = pathMod.join(cwd, "brand_context");
      if (fs.existsSync(brandDir)) {
        try {
          const brandFiles = fs.readdirSync(brandDir).filter((f: string) => f.endsWith(".md"));
          for (const bf of brandFiles) {
            const fullPath = pathMod.join(brandDir, bf);
            const stat = fs.statSync(fullPath);
            if (stat.size > 0) {
              addAvailableContext("brand", bf, toWorkspaceRelativePath(fullPath), { size: stat.size });
            }
          }
        } catch { /* ignore */ }
      }
    }

    let prompt = "";
    if (options.overridePrompt) {
      prompt = options.overridePrompt;
    } else {
      const isSlashCommand = task.description?.match(/^Run \/[\w:.-]+/);
      const taskRow = db.prepare("SELECT gsdStep, phaseNumber FROM tasks WHERE id = ?").get(taskId) as { gsdStep: string | null; phaseNumber: number | null } | undefined;
      const gsdStep = taskRow?.gsdStep;
      const gsdPhaseNumber = taskRow?.phaseNumber;
      const isTopLevelParent = !task.parentId;

      if (isSlashCommand) {
        prompt = task.description!;
      } else if (gsdStep) {
        const phaseArg = gsdPhaseNumber != null ? ` ${gsdPhaseNumber}` : "";
        const gsdPrompts: Record<string, string> = {
          discuss: `Run /gsd-discuss-phase${phaseArg}. Ask the user interactive questions — do NOT use --auto. Wait for their replies.`,
          plan: `Run /gsd-plan-phase${phaseArg}.`,
          execute: `Run /gsd-execute-phase${phaseArg}.`,
          verify: `Run /gsd-verify-work${phaseArg}.`,
        };
        prompt = gsdPrompts[gsdStep] || task.title;
      } else if (task.level === "project" && isTopLevelParent) {
        prompt = this.buildProjectScopingPrompt(task, cwd, workScope.mode === "solo");
      } else if (task.level === "gsd" && isTopLevelParent) {
        prompt = `Run /gsd-new-project "${task.title}"${task.description ? `\n\nContext from user: ${task.description}` : ""}`;
      } else {
        if (task.projectSlug) {
          const briefPath = pathMod.join(cwd, "projects", "briefs", task.projectSlug, "brief.md");
          try {
            if (fs.existsSync(briefPath)) {
              const briefContent = fs.readFileSync(briefPath, "utf-8");
              prompt += `[Project Context: ${task.projectSlug}]\n${briefContent}\n\n---\n\n`;
              addLoadedContext("project", `brief.md (${task.projectSlug})`, `projects/briefs/${task.projectSlug}/brief.md`);
            }
          } catch { /* proceed without context */ }
        }
        if (gsdStep || gsdPhaseNumber != null) {
          try {
            const siblingBlock = buildSiblingContextBlock(task);
            if (siblingBlock) {
              prompt += `${siblingBlock}\n\n---\n\n`;
              addLoadedContext("system", "Sibling task context");
            }
          } catch (err) {
            console.error("[process-manager] buildSiblingContextBlock failed:", err);
          }
        }
        prompt += task.description ? `Task: ${task.title}\n\n${task.description}` : task.title;

        if (task.permissionMode === "plan" && task.projectSlug) {
          prompt += `\n\n---\n\n[Plan Mode] You are running in read-only plan mode.\n1. Do NOT edit any files yet.\n2. Research and prepare the exact markdown that should be saved to projects/briefs/${task.projectSlug}/brief.md.\n3. Present a short planning summary in normal prose.\n4. Then emit a fenced code block tagged \`approved-brief\` containing ONLY the markdown that should be saved to brief.md. If you need code examples inside that block, use \`~~~\` fences or indented code blocks instead of nested triple backticks when possible.\n5. Then emit a fenced \`ask-user-questions\` block with exactly one select question using this shape:\n\`\`\`ask-user-questions\n[\n  {\n    "id": "plan_action",\n    "prompt": "The plan is ready. What should I do next?",\n    "type": "select",\n    "options": ["Approve and start", "Ask for changes", "Cancel"],\n    "required": true,\n    "intent": "plan_approval",\n    "metadata": { "briefFile": "projects/briefs/${task.projectSlug}/brief.md" }\n  }\n]\n\`\`\`\n6. After emitting those blocks, stop and wait. Do not execute anything until the user approves.\n---`;
        }
      }

      if (options.firstReplyMessage) {
        prompt += `\n\nInitial user message:\n${options.firstReplyMessage}`;
      }
    }

    const needsSessionContext = this.isSessionContextTask(task);
    console.log(`[process-manager] Session context check for "${task.title}" (desc: "${task.description?.slice(0, 50)}"): ${needsSessionContext}`);
    if (needsSessionContext) {
      const sessionSummary = this.buildSessionSummary(cwd, taskId);
      console.log(`[process-manager] Session summary length: ${sessionSummary.length} chars`);
      prompt = `IMPORTANT: The following session activity summary contains the complete record of what was done today across ALL tasks in the Command Centre. Use this as your primary source of truth for the session wrap-up — do NOT rely solely on git status or your own conversation history, as you are running in a fresh context window without visibility into other task conversations.\n\n${sessionSummary}\nNow proceed with the task:\n\n${prompt}`;
      addLoadedContext("system", "Session Activity Summary");
    }

    let snapshotContent = "";
    let teamContextUnavailable = false;
    if (hasSavedTeamContext) {
      try {
        const teamSnapshot = await fetchTeamContextSnapshot(
          task.clientId ?? null,
          "command-centre-task",
          { teamId },
        );
        if (teamSnapshot?.markdown) {
          snapshotContent = teamSnapshot.markdown;
          const labels = teamSnapshot.layers.length > 0
            ? teamSnapshot.layers.map((layer) => `${layer.label}: ${layer.path}`)
            : ["Team OS Context Snapshot"];
          for (const label of labels) {
            addLoadedContext("system", label);
          }
          for (const file of teamSnapshot.availableContext) {
            addAvailableContext(
              file.kind || "context",
              `${file.path}${file.title ? ` — ${file.title}` : ""}`,
              file.path,
              { title: file.title ?? null, size: file.size },
            );
          }
        } else {
          teamContextUnavailable = true;
        }
      } catch (err) {
        teamContextUnavailable = true;
        console.warn(
          "[process-manager] Team OS context snapshot unavailable; fail-closed without local Team OS context:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (!snapshotContent) {
      if (hasSavedTeamContext) {
        if (teamContextUnavailable) {
          this.handleTaskError(
            taskId,
            "The exact Team OS context for this new chat is unavailable. Reconnect or restore access, then retry; no other Team or Solo context was used.",
          );
          return;
        }
      } else {
        const snapshot = this.readSessionSnapshot(cwd, config.aiOsDir);
        if (snapshot.content) {
          snapshotContent = snapshot.content;
          for (const source of snapshot.loaded) {
            addLoadedContext("system", source.label, source.path);
          }
        }
      }
    }

    if (contextSources.length > 0) {
      db.prepare("UPDATE tasks SET contextSources = ? WHERE id = ?")
        .run(JSON.stringify(contextSources), taskId);

      const loadedLabels = contextSources
        .filter((s) => s.status !== "available")
        .map((s) => s.label);
      const loadedFileLabel = loadedLabels.length === 1 ? "file" : "files";
      this.addLogEntry(taskId, {
        id: crypto.randomUUID(),
        type: "system",
        timestamp: new Date().toISOString(),
        content: `Context ready: ${loadedLabels.length} ${loadedFileLabel} loaded`,
      });
    }

    try {
      const { expandPromptTags } = require("./prompt-tags") as typeof import("./prompt-tags");
      prompt = expandPromptTags(
        prompt,
        task.clientId,
        workScope.mode === "team" ? "team" : "solo",
      );
    } catch (err) {
      console.error(`[process-manager] prompt tag expansion failed:`, err);
    }

    prompt = prompt + STRUCTURED_QUESTION_ADDENDUM;
    if (this.isCancellationRequested(taskId)) {
      await fileWatcher.stopWatching(taskId);
      return;
    }
    let skillRuntime: TeamSkillRuntime | null = resolveLocalSkillRuntime(task.clientId);
    if (workScope.mode === "team" && !task.cronJobSlug) {
      try {
        await refreshAuthorizedTeamSkillCache(workScope.scope.teamId);
        skillRuntime = resolveTeamSkillRuntime(workScope.scope.teamId, task.clientId);
      } catch (error) {
        console.warn("[process-manager] Team skills could not be refreshed for a new chat; local skills remain available:", error);
        const resolved = resolveTeamSkillRuntime(workScope.scope.teamId, task.clientId);
        skillRuntime = { ...resolved, pluginDir: null, teamSkills: [] };
      }
    }
    this.spawnClaudeTurn(
      taskId,
      prompt,
      cwd,
      false,
      false,
      snapshotContent,
      "authorized",
      skillRuntime,
    );
  }

  /**
   * Reply to a task that's waiting for user input.
   * Sends the message into the live persistent Claude process when available.
   * Falls back to --resume only when the in-memory process no longer exists.
   *
   * Handles two states:
   * 1. Process is alive and waiting between turns → write stream-json input
   * 2. Process reference is gone → spawn a resumed persistent process
   */
  async replyToTask(taskId: string, message: string): Promise<boolean> {
    const profile = resolveProcessProfile();
    return runInProcessProfile(profile, () => this.replyToTaskInProfile(taskId, message));
  }

  private async replyToTaskInProfile(taskId: string, message: string): Promise<boolean> {
    const db = getDb();
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as
      | (Omit<Task, "workScope"> & { workScope: string | null })
      | undefined;
    if (!task) return false;
    const workScope = readWorkScopeFromRow(task);
    const session = this.sessions.get(this.taskKey(taskId));
    const isWaiting = this.waitingForReply.has(this.taskKey(taskId));
    const isPendingQuestion = session?.pendingQuestion === true;

    console.log(`[process-manager] replyToTask(${taskId.slice(0, 8)}): isWaiting=${isWaiting}, hasSession=${!!session}, pendingQuestion=${isPendingQuestion}, sessionCount=${this.sessions.size}, waitingCount=${this.waitingForReply.size}`);
    console.log(`[process-manager] replyToTask sessions:`, [...this.sessions.keys()].map(k => k.slice(0, 8)));
    console.log(`[process-manager] replyToTask waitingForReply:`, [...this.waitingForReply].map(k => k.slice(0, 8)));

    // Also check if the DB says needsInput — if so, trust the DB over in-memory state
    // (handles HMR or other edge cases where in-memory state was lost)
    if (!session && !isWaiting && !isPendingQuestion) {
      const dbTask = db.prepare("SELECT needsInput FROM tasks WHERE id = ?").get(taskId) as { needsInput: number } | undefined;
      const dbNeedsInput = dbTask?.needsInput === 1;
      console.log(`[process-manager] In-memory state empty — DB needsInput=${dbNeedsInput}`);

      if (!dbNeedsInput) {
        console.warn(`[process-manager] Task ${taskId} is not waiting for a reply (both in-memory and DB)`);
        return false;
      }

      // DB says needsInput but in-memory state is gone — proceed anyway
      console.log(`[process-manager] DB says needsInput=true, proceeding with reply despite empty in-memory state`);
    }

    const teamEnrichment = await this.resolveTeamEnrichment(taskId, task, workScope);
    const teamEnrichmentMode = teamEnrichment.mode;

    if (session) {
      if (session.skillRuntime === undefined) {
        // Live sessions created before this runtime field was introduced adopt
        // the current catalog without an unnecessary restart.
        session.skillRuntime = teamEnrichment.skillRuntime;
      }
      if (JSON.stringify(session.workScope) !== JSON.stringify(workScope)) {
        this.handleLostLiveSession(
          taskId,
          "The saved work scope no longer matches the live process, so it was stopped safely.",
        );
        return false;
      }
      if (
        (session.teamEnrichmentMode ?? "authorized") !== teamEnrichmentMode
        || session.skillRuntime?.fingerprint !== teamEnrichment.skillRuntime?.fingerprint
        || session.skillRuntime?.pluginDir !== teamEnrichment.skillRuntime?.pluginDir
      ) {
        console.log(
          `[process-manager] Team enrichment changed to ${teamEnrichmentMode}; restarting ${taskId.slice(0, 8)} with its saved Claude session`,
        );
        this.stopSession(taskId);
        const config = getConfig();
        const cwd = task.clientId ? getClientAiOsDir(task.clientId) : config.aiOsDir;
        this.spawnClaudeTurn(
          taskId,
          message,
          cwd,
          true,
          task.status === "review" || task.status === "done",
          teamEnrichment.snapshot?.markdown ?? "",
          teamEnrichmentMode,
          teamEnrichment.skillRuntime,
        );
        return true;
      }
      console.log(`[process-manager] Reusing live Claude process for reply to ${taskId.slice(0, 8)}`);
      return this.sendToLiveSession(taskId, routeSkillCommandAliases(message, session.skillRuntime));
    }

    // The reply route already persisted the log entry and updated the DB.
    // No live process is available, so resume from the stored transcript.
    this.waitingForReply.delete(this.taskKey(taskId));

    const config = getConfig();
    const cwd = task.clientId ? getClientAiOsDir(task.clientId) : config.aiOsDir;

    // Track whether this reply came from a review/done state (for logging only)
    const wasInReview = task.status === "review" || task.status === "done";
    if (this.isCancellationRequested(taskId)) return false;
    this.spawnClaudeTurn(
      taskId,
      message,
      cwd,
      true,
      wasInReview,
      teamEnrichment.snapshot?.markdown ?? "",
      teamEnrichmentMode,
      teamEnrichment.skillRuntime,
    );
    return true;
  }

  /**
   * Cancel a running or waiting task.
   */
  async cancelTask(taskId: string): Promise<void> {
    const profile = resolveProcessProfile();
    return runInProcessProfile(profile, () => this.cancelTaskInProfile(taskId));
  }

  private async cancelTaskInProfile(taskId: string): Promise<void> {
    const db = getDb();
    const existing = db.prepare("SELECT clientId, workScope FROM tasks WHERE id = ?").get(taskId) as
      | { clientId: string | null; workScope: string | null }
      | undefined;
    if (!existing) throw new Error(`Task ${taskId} not found`);
    readWorkScopeFromRow(existing);
    const now = new Date().toISOString();
    const marked = db.prepare(
      `UPDATE tasks
       SET cancelRequestedAt = COALESCE(cancelRequestedAt, ?), updatedAt = ?, activityLabel = ?, errorMessage = NULL
       WHERE id = ? AND status IN ('queued', 'running')`,
    ).run(now, now, "Stopping agent...", taskId);
    if (!marked.changes) return;

    try {
      await this.workflowJournalBridge.stopTask(taskId, "Stopped by user");
      await this.killSession(taskId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.prepare(
        `UPDATE tasks SET updatedAt = ?, activityLabel = ?, errorMessage = ?, needsInput = 1
         WHERE id = ?`,
      ).run(now, "Stop failed — agent may still be running", message, taskId);
      const failedTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;
      emitTaskEvent({ type: "task:status", task: this.normalizeTask(failedTask), timestamp: now });
      throw error instanceof TaskCancellationError
        ? error
        : new TaskCancellationError(`The agent could not be stopped: ${message}`);
    }

    revokeTaskPermissionRules(taskId, db);
    const stoppedAt = new Date().toISOString();
    db.prepare(
      `UPDATE approval_requests
       SET status = 'denied', decision = 'deny', decisionMessage = ?, resolvedAt = ?
       WHERE taskId = ? AND status = 'pending'`,
    ).run("Stopped by user", stoppedAt, taskId);
    db.prepare(
      "UPDATE tasks SET status = ?, updatedAt = ?, activityLabel = ?, costUsd = NULL, tokensUsed = NULL, durationMs = NULL, errorMessage = NULL, startedAt = NULL, completedAt = NULL, needsInput = 0, claudePid = NULL WHERE id = ?"
    ).run("review", stoppedAt, "Stopped by user", taskId);

    const cancellation = db.prepare(
      "SELECT cancelRequestedAt FROM tasks WHERE id = ?",
    ).get(taskId) as { cancelRequestedAt: string | null };
    this.addLogEntry(taskId, {
      id: `stop:${taskId}:${cancellation.cancelRequestedAt ?? now}`,
      type: "system",
      timestamp: stoppedAt,
      content: "Stopped by user",
    });

    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;
    emitTaskEvent({ type: "task:status", task: this.normalizeTask(updated), timestamp: stoppedAt });
  }

  /**
   * Quiesce every process that may belong to a Goal being archived.
   *
   * Unlike cancelTask, this does not move the task to review, write a user
   * stop log, revoke permissions, resolve approvals, or emit an intermediate
   * task event. archiveGoal owns the final atomic database transition.
   */
  async quiesceTaskForArchive(taskId: string): Promise<void> {
    const profile = resolveProcessProfile();
    return runInProcessProfile(profile, () => this.quiesceTaskForArchiveInProfile(taskId));
  }

  private async quiesceTaskForArchiveInProfile(taskId: string): Promise<void> {
    const db = getDb();
    const existing = db.prepare("SELECT clientId, workScope FROM tasks WHERE id = ?").get(taskId) as
      | { clientId: string | null; workScope: string | null }
      | undefined;
    if (!existing) return;
    readWorkScopeFromRow(existing);

    // This write is deliberately independent of task status. Persist it before
    // any await so queued startup and late completion handlers cannot race the
    // archive shutdown.
    db.prepare(
      "UPDATE tasks SET cancelRequestedAt = COALESCE(cancelRequestedAt, ?) WHERE id = ?",
    ).run(new Date().toISOString(), taskId);

    const results = await Promise.allSettled([
      this.workflowJournalBridge.stopTask(taskId, "Goal archived"),
      this.killSessionInProfile(taskId),
    ]);
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
    if (failures.length > 0) {
      throw new TaskCancellationError(
        `The agent could not be stopped for archiving: ${failures.join("; ")}`,
      );
    }
  }

  /**
   * Kill the process and clean up session state without touching the DB or
   * emitting SSE events. Used by the PATCH handler when the caller manages
   * the final DB state (e.g. marking done).
   */
  async killSession(taskId: string): Promise<void> {
    const profile = resolveProcessProfile();
    return runInProcessProfile(profile, () => this.killSessionInProfile(taskId));
  }

  private async killSessionInProfile(taskId: string): Promise<void> {
    const taskKey = this.taskKey(taskId);
    const session = this.sessions.get(taskKey);
    let row = getDb().prepare("SELECT claudePid FROM tasks WHERE id = ?").get(taskId) as
      { claudePid: number | null } | undefined;

    // -1 means another worker is between the final cancellation check and
    // creating the process. Wait for that worker to either publish the real
    // PID or acknowledge the cancellation by clearing the sentinel.
    if (!session && row?.claudePid === -1) {
      const deadline = Date.now() + 5_000;
      while (row?.claudePid === -1 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        row = getDb().prepare("SELECT claudePid FROM tasks WHERE id = ?").get(taskId) as
          { claudePid: number | null } | undefined;
      }
      if (row?.claudePid === -1) {
        throw new TaskCancellationError(
          "The agent was still initializing, and Command Centre could not confirm that startup was cancelled.",
        );
      }
    }

    const pid = session?.proc.pid ?? row?.claudePid ?? null;

    if (session) {
      session.closing = true;
      this.rejectPendingControlRequests(
        session,
        new PermissionModeControlError(
          "The live Claude session was stopped by the user.",
          "ambiguous",
          504,
        ),
      );
    }

    if (pid) {
      const result = await terminateProcessTreeByPid(pid);
      if (!result.stopped) {
        throw new TaskCancellationError(
          `The process tree for PID ${pid} is still running${result.detail ? `: ${result.detail}` : "."}`,
        );
      }
    }

    session?.cleanupTempFiles?.();
    this.sessions.delete(taskKey);
    session?.profileLease?.release();
    this.waitingForReply.delete(taskKey);
    this.lastProgressEmit.delete(taskKey);
    this.clearClaudePid(taskId);

    await fileWatcher.stopWatching(taskId);
  }

  // ── Prompt builders for interactive scoping ─────────────────────

  /**
   * Read brand_context/ and context/ files from the working directory.
   * Returns a formatted string block to prepend to prompts.
   */
  private readBrandContext(cwd: string): string {
    const fs = require("fs") as typeof import("fs");
    const pathMod = require("path") as typeof import("path");
    const sections: string[] = [];

    // Brand context files
    const brandDir = pathMod.join(cwd, "brand_context");
    if (fs.existsSync(brandDir)) {
      const brandFiles = ["voice-profile.md", "positioning.md", "icp.md", "samples.md", "assets.md"];
      for (const file of brandFiles) {
        const filePath = pathMod.join(brandDir, file);
        try {
          if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, "utf-8").trim();
            if (content.length > 0) {
              sections.push(`[${file}]\n${content}`);
            }
          }
        } catch { /* skip */ }
      }
      // Also pick up any other .md files in brand_context/
      try {
        const allFiles = fs.readdirSync(brandDir).filter((f: string) => f.endsWith(".md"));
        for (const f of allFiles) {
          if (brandFiles.includes(f)) continue; // already handled
          const filePath = pathMod.join(brandDir, f);
          const stat = fs.statSync(filePath);
          if (stat.size > 0) {
            const content = fs.readFileSync(filePath, "utf-8").trim();
            sections.push(`[${f}]\n${content}`);
          }
        }
      } catch { /* skip */ }
    }

    // USER.md for preferences
    const userMdPath = pathMod.join(cwd, "context", "USER.md");
    try {
      if (fs.existsSync(userMdPath)) {
        const content = fs.readFileSync(userMdPath, "utf-8").trim();
        if (content.length > 0) {
          sections.push(`[USER.md]\n${content}`);
        }
      }
    } catch { /* skip */ }

    if (sections.length === 0) return "";
    return `\n\n--- BRAND & USER CONTEXT ---\n${sections.join("\n\n")}\n--- END CONTEXT ---\n`;
  }

  /**
   * Read the session snapshot — agent identity, user preferences, working
   * memory, and today's daily log. Prepended to every task prompt so the
   * command-centre's spawned -p sessions have the same baseline context as
   * a fresh Claude Code CLI session would have via .claude/hooks/load-memory-snapshot.js.
   *
   * Loads (when present):
   *   - context/SOUL.md            (agent identity)
   *   - context/USER.md            (user profile)
   *   - context/MEMORY.md          (curated working scratchpad — frozen snapshot)
   *   - context/memory/{today}.md  (today's daily log, with yesterday as fallback)
   *
   * Does NOT load context/learnings.md — that file is lazy-loaded per skill
   * by design (see AGENTS.md "Memory System").
   */
  private readSessionSnapshot(
    cwd: string,
    workspaceRoot: string = cwd,
  ): { content: string; loaded: Array<{ label: string; path: string }> } {
    const fs = require("fs") as typeof import("fs");
    const pathMod = require("path") as typeof import("path");
    const sections: string[] = [];
    const loaded: Array<{ label: string; path: string }> = [];

    const tryLoad = (relPath: string, label: string): void => {
      const abs = pathMod.join(cwd, relPath);
      try {
        if (!fs.existsSync(abs)) return;
        const content = fs.readFileSync(abs, "utf-8").trim();
        if (content.length === 0) return;
        sections.push(`[${label}]\n${content}`);
        const sourcePath = pathMod.relative(workspaceRoot, abs).split(pathMod.sep).join("/");
        loaded.push({ label, path: sourcePath });
      } catch { /* skip */ }
    };

    tryLoad("context/SOUL.md", "SOUL.md");
    tryLoad("context/USER.md", "USER.md");
    tryLoad("context/MEMORY.md", "MEMORY.md");

    const dateStr = (d: Date): string => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    };
    const today = dateStr(new Date());
    const yesterday = dateStr(new Date(Date.now() - 86400000));
    const todayLogRel = `context/memory/${today}.md`;
    const yesterdayLogRel = `context/memory/${yesterday}.md`;
    if (fs.existsSync(pathMod.join(cwd, todayLogRel))) {
      tryLoad(todayLogRel, `memory/${today}.md (today)`);
    } else {
      tryLoad(yesterdayLogRel, `memory/${yesterday}.md (yesterday — no session today yet)`);
    }

    if (sections.length === 0) return { content: "", loaded: [] };
    const content =
      `--- SESSION SNAPSHOT ---\n` +
      `The following files were auto-loaded so this task starts with the same baseline ` +
      `context that a fresh Claude Code CLI session would have. Mid-session writes to ` +
      `context/MEMORY.md persist to disk but only take effect on the next task.\n\n` +
      sections.join("\n\n") +
      `\n--- END SNAPSHOT ---`;
    return { content, loaded };
  }

  private buildProjectScopingPrompt(
    task: Task,
    cwd: string,
    includeLocalContext: boolean = true,
  ): string {
    const userContext = task.description ? `\n\nThe user's goal: ${task.description}` : "";
    const brandContext = includeLocalContext ? this.readBrandContext(cwd) : "";
    const slug = task.projectSlug || this.slugify(task.title);
    const briefPath = `projects/briefs/${slug}/brief.md`;

    return `You are scoping a Level 2 planned project. Your job is to create the project brief and deliverables immediately, then ask for adjustments.
${brandContext}
Project: "${task.title}"${userContext}

IMPORTANT INSTRUCTIONS:
1. You are running in a persistent Command Centre session. Each result completes one turn, not the whole session. The user may reply in this same live process.

2. Your FIRST turn — do ALL of this:
   a. Use the brand context and goal above to infer what the user needs. Don't ask questions first — make your best judgement call based on what you know.
   b. Save the brief to ${briefPath} with this format:
      ---
      project: ${slug}
      status: active
      level: 2
      created: ${new Date().toISOString().split("T")[0]}
      ---

      # {Project Title}

      ## Goal
      {One clear sentence describing what this project delivers}

      ## Deliverables
      - [ ] **{Deliverable 1}** — {what it is and acceptance criteria}
      - [ ] **{Deliverable 2}** — {what it is and acceptance criteria}
      {etc — one per major deliverable, not every granular step}

      ## Acceptance Criteria
      {How the user will know the project is done — bullet points}

      ## Constraints
      {Any timeline, format, or technical constraints — or "None specified"}

   c. Output subtasks (one per deliverable from the brief):
      \`\`\`subtasks
      [
        {"title": "Deliverable name", "description": "What this deliverable involves and its acceptance criteria"}
      ]
      \`\`\`

   d. End with a summary of what you planned and ask: "Want to adjust anything before I start working through these?"

3. On SUBSEQUENT turns: The user may want to adjust deliverables, add constraints, or refine scope. Update the brief file and subtasks accordingly. If the user says it looks good, confirm and end.

4. LIVE SUBTASK MANAGEMENT: As the project conversation progresses, the subtask list on the UI is the user's source of truth for "what's left". You may ADD a new subtask mid-project by emitting another \`\`\`subtasks\`\`\` JSON block. Existing titles are preserved; only new titles get appended. Do not mark subtasks as done in generated output; completion is a manual user action in the UI.

CRITICAL: Every turn MUST end with a question mark (?). This is how the system detects that you need user input.
Keep subtasks high-level — one per major deliverable, not every granular step.`;
  }

  private slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  /**
   * Build a session activity summary for context-aware tasks (e.g. wrap-up).
   * Pulls from: today's tasks in DB, task logs, git history, and memory file.
   */
  private buildSessionSummary(cwd: string, currentTaskId: string): string {
    const db = getDb();
    const fs = require("fs") as typeof import("fs");
    const pathMod = require("path") as typeof import("path");
    const { execSync } = require("child_process") as typeof import("child_process");

    const todayStr = new Date().toISOString().slice(0, 10);
    const parts: string[] = ["[Session Activity Summary]", ""];

    // 1. Today's tasks from DB (exclude the current wrap-up task)
    const todayTasks = db.prepare(
      `SELECT id, title, status, level, costUsd, tokensUsed, durationMs, startedAt, completedAt, projectSlug
       FROM tasks
       WHERE date(createdAt) = ? AND id != ?
       ORDER BY createdAt ASC`
    ).all(todayStr, currentTaskId) as Array<{
      id: string; title: string; status: string; level: string;
      costUsd: number | null; tokensUsed: number | null; durationMs: number | null;
      startedAt: string | null; completedAt: string | null; projectSlug: string | null;
    }>;

    // Also include tasks from earlier that were active today
    const activeTodayTasks = db.prepare(
      `SELECT id, title, status, level, costUsd, tokensUsed, durationMs, startedAt, completedAt, projectSlug
       FROM tasks
       WHERE date(createdAt) < ? AND id != ?
         AND (date(startedAt) = ? OR date(completedAt) = ? OR date(updatedAt) = ?)
       ORDER BY updatedAt ASC`
    ).all(todayStr, currentTaskId, todayStr, todayStr, todayStr) as typeof todayTasks;

    const allTasks = [...activeTodayTasks, ...todayTasks];

    if (allTasks.length > 0) {
      parts.push("## Tasks Today", "");
      for (const t of allTasks) {
        const cost = t.costUsd ? ` ($${t.costUsd.toFixed(2)})` : "";
        const project = t.projectSlug ? ` [${t.projectSlug}]` : "";
        parts.push(`- **${t.title}**${project} — ${t.status}${cost}`);

        // Get skills invoked by this task
        const skillMentions = db.prepare(
          `SELECT content FROM task_logs
           WHERE taskId = ? AND type = 'text'
             AND (content LIKE '%/mkt-%' OR content LIKE '%/str-%' OR content LIKE '%/viz-%'
               OR content LIKE '%/ops-%' OR content LIKE '%/tool-%' OR content LIKE '%/meta-%'
               OR content LIKE '%Running skill%' OR content LIKE '%Invoking skill%'
               OR content LIKE '%skill:%')
           LIMIT 5`
        ).all(t.id) as Array<{ content: string }>;

        const skills = new Set<string>();
        for (const s of skillMentions) {
          const matches = s.content.match(/\/(mkt|str|viz|ops|tool|meta)-[\w-]+/g);
          if (matches) matches.forEach((m) => skills.add(m));
        }
        // Also check the task description for skill references
        if (t.title) {
          const titleMatches = t.title.match(/\/(mkt|str|viz|ops|tool|meta)-[\w-]+/g);
          if (titleMatches) titleMatches.forEach((m) => skills.add(m));
        }
        if (skills.size > 0) {
          parts.push(`  Skills: ${[...skills].join(", ")}`);
        }

        // Get condensed activity: text entries and questions
        const logs = db.prepare(
          `SELECT type, content, timestamp FROM task_logs
           WHERE taskId = ? AND type IN ('text', 'question', 'user_reply')
           ORDER BY timestamp ASC`
        ).all(t.id) as Array<{ type: string; content: string; timestamp: string }>;

        if (logs.length > 0) {
          const keyLogs = logs.filter((l) =>
            l.type === "question" || l.type === "user_reply" || l.content.length > 50
          );
          const condensed = keyLogs.slice(-6);
          for (const log of condensed) {
            const prefix = log.type === "question" ? "  Claude asked" : log.type === "user_reply" ? "  User replied" : "  Claude";
            const content = log.content.length > 200 ? log.content.slice(0, 200) + "…" : log.content;
            parts.push(`${prefix}: ${content}`);
          }
        }

        // Get output files
        const outputs = db.prepare(
          `SELECT fileName FROM task_outputs WHERE taskId = ?`
        ).all(t.id) as Array<{ fileName: string }>;
        if (outputs.length > 0) {
          parts.push(`  Outputs: ${outputs.map((o) => o.fileName).join(", ")}`);
        }
        parts.push("");
      }
    }

    // 2. Git history — commits from today
    try {
      const gitLog = execSync(
        `git log --since="today 00:00" --format="%h %s" --no-merges 2>/dev/null`,
        { cwd, encoding: "utf-8", timeout: 5000 }
      ).trim();
      if (gitLog) {
        parts.push("## Git Commits Today", "", gitLog, "");
      }
    } catch { /* no git or no commits */ }

    // 3. Unstaged changes summary
    try {
      const gitDiffStat = execSync(
        `git diff --stat HEAD 2>/dev/null`,
        { cwd, encoding: "utf-8", timeout: 5000 }
      ).trim();
      if (gitDiffStat) {
        parts.push("## Uncommitted Changes", "", gitDiffStat, "");
      }
    } catch { /* ignore */ }

    // 4. Today's memory file
    const memoryPath = pathMod.join(cwd, "context", "memory", `${todayStr}.md`);
    try {
      if (fs.existsSync(memoryPath)) {
        const memoryContent = fs.readFileSync(memoryPath, "utf-8").trim();
        if (memoryContent.length > 0) {
          parts.push("## Today's Memory File", "", memoryContent, "");
        }
      }
    } catch { /* ignore */ }

    parts.push("---", "");
    return parts.join("\n");
  }

  /**
   * Check if a task needs session context injected into its prompt.
   */
  private isSessionContextTask(task: Task): boolean {
    const title = (task.title || "").toLowerCase();
    const desc = (task.description || "").toLowerCase();
    return (
      title.includes("wrap") ||
      title.includes("session") ||
      desc.includes("/wrap-up") ||
      desc.includes("meta-wrap-up") ||
      desc.includes("/gsd-session-report") ||
      desc.includes("session summary") ||
      desc.includes("what did we do") ||
      desc.includes("what have we done")
    );
  }

  // ── GSD phase sync (reads .planning/ROADMAP.md) ────────────────

  private async autoSyncPhases(parentTaskId: string): Promise<void> {
    if (this.isCancellationRequested(parentTaskId)) return;
    try {
      console.log(`[process-manager] Auto-syncing GSD phases for ${parentTaskId.slice(0, 8)}`);
      const res = await fetch(`http://localhost:${process.env.PORT || 3000}/api/tasks/${parentTaskId}/sync-phases`, {
        method: "POST",
        headers: {
          "x-AI-OS-profile-key": resolveProcessProfile().profileKey,
          "x-AI-OS-profile-source": "process",
        },
      });
      if (res.ok) {
        const data = await res.json();
        console.log(`[process-manager] Synced ${data.created} phase tasks (${data.phases} phases)`);
      } else {
        console.warn(`[process-manager] Phase sync failed: ${res.status}`);
      }
    } catch (err) {
      console.error(`[process-manager] Phase sync error:`, err);
    }
  }

  // ── Auto-queue next sibling when a child completes ──────────────────

  private autoQueueNextSibling(completedChild: Task): void {
    if (this.isCancellationRequested(completedChild.id)) return;
    if (!completedChild.parentId) return;
    if (this.isCancellationRequested(completedChild.parentId)) return;

    const db = getDb();
    const now = new Date().toISOString();

    // Find the next backlog sibling (by columnOrder)
    const nextSibling = db.prepare(
      `SELECT * FROM tasks WHERE parentId = ? AND status = 'backlog' ORDER BY columnOrder ASC LIMIT 1`
    ).get(completedChild.parentId) as Task | undefined;

    if (!nextSibling) {
      // No more siblings to queue — check if all are done
      const remaining = db.prepare(
        `SELECT COUNT(*) as count FROM tasks WHERE parentId = ? AND status != 'done'`
      ).get(completedChild.parentId) as { count: number };

      if (remaining.count === 0) {
        // All subtasks complete — move parent to review
        db.prepare(
          "UPDATE tasks SET status = 'review', updatedAt = ?, activityLabel = NULL, needsInput = 0 WHERE id = ?"
        ).run(now, completedChild.parentId);

        const updatedParent = db.prepare("SELECT * FROM tasks WHERE id = ?").get(completedChild.parentId) as Task;
        emitTaskEvent({ type: "task:status", task: this.normalizeTask(updatedParent), timestamp: now });
        console.log(`[process-manager] All subtasks done — parent ${completedChild.parentId.slice(0, 8)} moved to review`);
      }
      return;
    }

    // Queue the next sibling — it will need user go-ahead to start
    db.prepare(
      "UPDATE tasks SET status = 'review', updatedAt = ?, needsInput = 1, activityLabel = ? WHERE id = ?"
    ).run(now, "Ready to start — waiting for go-ahead", nextSibling.id);

    const updatedSibling = db.prepare("SELECT * FROM tasks WHERE id = ?").get(nextSibling.id) as Task;
    emitTaskEvent({ type: "task:status", task: this.normalizeTask(updatedSibling), timestamp: now });

    // Keep parent in "in progress" — update its activity
    const completedCount = db.prepare(
      `SELECT COUNT(*) as count FROM tasks WHERE parentId = ? AND status = 'done'`
    ).get(completedChild.parentId) as { count: number };
    const totalCount = db.prepare(
      `SELECT COUNT(*) as count FROM tasks WHERE parentId = ?`
    ).get(completedChild.parentId) as { count: number };

    db.prepare(
      "UPDATE tasks SET status = 'running', updatedAt = ?, activityLabel = ? WHERE id = ?"
    ).run(now, `${completedCount.count}/${totalCount.count} tasks done — next task queued`, completedChild.parentId);

    const updatedParent = db.prepare("SELECT * FROM tasks WHERE id = ?").get(completedChild.parentId) as Task;
    emitTaskEvent({ type: "task:status", task: this.normalizeTask(updatedParent), timestamp: now });

    console.log(`[process-manager] Auto-queued next sibling ${nextSibling.id.slice(0, 8)} "${nextSibling.title}" — ${completedCount.count}/${totalCount.count} done`);
  }

  // ── Subtask extraction from structured output ──────────────────

  private extractAndCreateSubtasks(parentTaskId: string, parentTask: Task): void {
    if (this.isCancellationRequested(parentTaskId)) return;
    const db = getDb();
    const now = new Date().toISOString();
    const inheritedScope = inheritWorkScope(parentTask);

    // Scan log entries for ```subtasks JSON block
    const logs = db.prepare(
      "SELECT content FROM task_logs WHERE taskId = ? AND type = 'text' ORDER BY rowid DESC LIMIT 10"
    ).all(parentTaskId) as Array<{ content: string }>;

    let subtaskJson: string | null = null;
    for (const log of logs) {
      const match = log.content.match(/```subtasks\s*\n([\s\S]*?)```/);
      if (match) {
        subtaskJson = match[1].trim();
        break;
      }
    }

    let subtasks: Array<{ title: string; description?: string; phaseNumber?: number; gsdStep?: string; status?: string }>;

    if (subtaskJson) {
      try {
        subtasks = JSON.parse(subtaskJson);
        if (!Array.isArray(subtasks) || subtasks.length === 0) subtasks = [];
      } catch (err) {
        console.error(`[process-manager] Failed to parse subtask JSON for ${parentTaskId.slice(0, 8)}:`, err);
        subtasks = [];
      }
    } else {
      subtasks = [];
    }

    // Fallback: parse deliverables from brief.md if no subtasks block found
    if (subtasks.length === 0 && parentTask.projectSlug) {
      const fs = require("fs") as typeof import("fs");
      const pathMod = require("path") as typeof import("path");
      const baseDir = getConfig().aiOsDir;
      const briefPath = pathMod.join(baseDir, "projects", "briefs", parentTask.projectSlug, "brief.md");
      if (fs.existsSync(briefPath)) {
        const briefContent = fs.readFileSync(briefPath, "utf-8");
        const delMatch = briefContent.match(/## Deliverables\s*\n([\s\S]*?)(?=\n## |\n---|\s*$)/);
        if (delMatch) {
          const lines = delMatch[1].split("\n");
          for (const line of lines) {
            const item = line.match(/^-\s*\[[ x]\]\s*\**(.+?)\**\s*(?:—\s*(.*))?$/);
            if (item) {
              subtasks.push({
                title: item[1].trim(),
                description: item[2]?.trim() || null as unknown as string,
              });
            }
          }
        }
        if (subtasks.length > 0) {
          console.log(`[process-manager] Parsed ${subtasks.length} deliverables from brief.md for ${parentTaskId.slice(0, 8)}`);
        }
      }
    }

    if (subtasks.length === 0) {
      console.log(`[process-manager] No subtasks found for ${parentTaskId.slice(0, 8)}`);
      return;
    }

    // Load existing children so we can append only NEW subtasks instead of
    // blanket-skipping when any child already exists. This lets Claude add
    // higher-level subtasks as the project conversation progresses.
    const existingChildren = db.prepare(
      "SELECT id, title, status FROM tasks WHERE parentId = ?"
    ).all(parentTaskId) as Array<{ id: string; title: string; status: string }>;
    const existingTitles = new Set(
      existingChildren.map((c) => c.title.trim().toLowerCase())
    );

    // Drop garbage + dedupe within this payload. Claude occasionally parrots
    // the "[Project Context: <slug>]" prompt prefix back into the subtasks
    // block, and sometimes emits the same title twice. Both bugs surface as
    // a flood of duplicate subtasks in the feed.
    const seenTitles = new Set<string>();
    subtasks = subtasks.filter((sub) => {
      if (!sub || typeof sub.title !== "string") return false;
      const title = sub.title.trim();
      if (!title) return false;
      if (title.startsWith("[Project Context:")) return false;
      if (seenTitles.has(title)) return false;
      seenTitles.add(title);
      return true;
    });

    if (subtasks.length === 0) {
      console.log(`[process-manager] All subtasks filtered out as garbage for ${parentTaskId.slice(0, 8)}`);
      return;
    }

    // Skip ones that already exist (case-insensitive title match). Anything
    // new gets appended after the existing set. Completion remains manual, so
    // any emitted status field is ignored.
    const newSubtasks = subtasks.filter((sub) => {
      const key = sub.title.trim().toLowerCase();
      if (existingTitles.has(key)) return false;
      return true;
    });

    if (newSubtasks.length === 0) {
      console.log(`[process-manager] No new subtasks to create for ${parentTaskId.slice(0, 8)}`);
      return;
    }

    console.log(`[process-manager] Creating ${newSubtasks.length} new subtasks for ${parentTaskId.slice(0, 8)} (${existingChildren.length} already existed)`);

    // Append new subtasks after the existing set
    const maxOrder = db.prepare(
      "SELECT COALESCE(MAX(columnOrder), 0) as maxOrder FROM tasks WHERE parentId = ?"
    ).get(parentTaskId) as { maxOrder: number };
    let order = maxOrder.maxOrder + 1;

    for (const sub of newSubtasks) {
      if (this.isCancellationRequested(parentTaskId)) return;
      if (!sub.title || typeof sub.title !== "string") continue;

      const childLevel = parentTask.level === "gsd" ? "gsd" : "task";
      const childId = crypto.randomUUID();
      const child: Task = {
        id: childId,
        title: sub.title.trim(),
        description: sub.description?.trim() || null,
        status: "backlog",
        level: childLevel as Task["level"],
        parentId: parentTaskId,
        projectSlug: parentTask.projectSlug,
        columnOrder: order++,
        createdAt: now,
        updatedAt: now,
        costUsd: null,
        tokensUsed: null,
        durationMs: null,
        activityLabel: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        clientId: parentTask.clientId,
        workScope: inheritedScope.scope,
        needsInput: false,
        phaseNumber: sub.phaseNumber ?? null,
        gsdStep: (sub.gsdStep as Task["gsdStep"]) ?? null,
        contextSources: null,
        cronJobSlug: null,
        claudeSessionId: null,
        permissionMode: parentTask.permissionMode ?? "bypassPermissions",
        executionPermissionMode:
          parentTask.executionPermissionMode ?? parentTask.permissionMode ?? "bypassPermissions",
        model: parentTask.model ?? null,
        thinkingEffort: parentTask.thinkingEffort ?? null,
        lastReplyAt: null,
        goalGroup: null,
        tag: null,
        pinnedAt: null,
        archivedAt: null,
      };

      try {
        db.prepare(
          `INSERT INTO tasks (id, title, description, status, level, parentId, projectSlug, columnOrder, createdAt, updatedAt, costUsd, tokensUsed, durationMs, activityLabel, errorMessage, startedAt, completedAt, clientId, workScope, needsInput, phaseNumber, gsdStep, permissionMode, executionPermissionMode, model, thinkingEffort)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          child.id, child.title, child.description, child.status, child.level,
          child.parentId, child.projectSlug, child.columnOrder, child.createdAt,
          child.updatedAt, child.costUsd, child.tokensUsed, child.durationMs,
          child.activityLabel, child.errorMessage, child.startedAt, child.completedAt,
          child.clientId, inheritedScope.serialized, 0, child.phaseNumber, child.gsdStep,
          child.permissionMode, child.executionPermissionMode, child.model, child.thinkingEffort
        );
      } catch (error) {
        if (error instanceof Error && /task_tree_read_only/.test(error.message)) {
          console.log(`[process-manager] Skipped late subtask creation while ${parentTaskId.slice(0, 8)} was being archived`);
          return;
        }
        throw error;
      }

      emitTaskEvent({ type: "task:created", task: child, timestamp: now });
    }

    console.log(`[process-manager] Created ${subtasks.length} subtasks for parent ${parentTaskId.slice(0, 8)}`);
  }

  getActiveCount(): number {
    return this.sessions.size;
  }

  isWaitingForReply(taskId: string): boolean {
    return this.waitingForReply.has(this.taskKey(taskId));
  }

  async shutdownProfile(
    profileKey: string,
    options: { gracefulMs?: number; forceMs?: number } = {},
  ): Promise<{ stopped: number; forced: number; pending: number }> {
    const gracefulMs = options.gracefulMs ?? 3000;
    const forceMs = options.forceMs ?? 2000;
    const prefix = `${profileKey}:`;
    const owned = [...this.sessions.entries()].filter(([key]) => key.startsWith(prefix));

    const waitForExit = (session: SessionEntry, timeoutMs: number): Promise<boolean> => {
      if (session.proc.exitCode !== null && session.proc.exitCode !== undefined) return Promise.resolve(true);
      if (typeof session.proc.once !== "function" || typeof session.proc.off !== "function") {
        return Promise.resolve(false);
      }
      return new Promise((resolve) => {
        let settled = false;
        const finish = (exited: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          session.proc.off("close", onClose);
          resolve(exited);
        };
        const onClose = () => finish(true);
        const timer = setTimeout(() => finish(false), timeoutMs);
        session.proc.once("close", onClose);
      });
    };

    for (const [, session] of owned) {
      session.closing = true;
      this.rejectPendingControlRequests(
        session,
        new PermissionModeControlError("The local profile is signing out.", "ambiguous", 504),
      );
      session.cleanupTempFiles?.();
      try {
        if (session.runner) session.runner.stop("SIGTERM");
        else killChildProcessTree(session.proc, "SIGTERM");
      } catch { /* process already stopped */ }
    }

    const graceful = await Promise.all(owned.map(([, session]) => waitForExit(session, gracefulMs)));
    let forced = 0;
    for (let index = 0; index < owned.length; index += 1) {
      if (graceful[index]) continue;
      forced += 1;
      const session = owned[index][1];
      try {
        if (session.runner) session.runner.stop("SIGKILL");
        else killChildProcessTree(session.proc, "SIGKILL");
      } catch { /* process already stopped */ }
    }
    const final = await Promise.all(owned.map(([, session]) => waitForExit(session, forceMs)));

    for (let index = 0; index < owned.length; index += 1) {
      const [key, session] = owned[index];
      if (!final[index]) continue;
      try {
        runInProcessProfile(session.profileLease.descriptor, () => this.clearClaudePid(session.taskId));
      } catch { /* database cleanup will retry separately */ }
      session.profileLease.release();
      this.sessions.delete(key);
    }
    for (const collection of [this.waitingForReply, this.startingTasks]) {
      for (const key of collection) if (key.startsWith(prefix)) collection.delete(key);
    }
    for (const key of this.lastProgressEmit.keys()) {
      if (key.startsWith(prefix)) this.lastProgressEmit.delete(key);
    }

    return {
      stopped: owned.length,
      forced,
      pending: final.filter((exited) => !exited).length,
    };
  }

  cleanup(): void {
    fileWatcher.cleanupAll();
    for (const session of this.sessions.values()) {
      console.log(`[process-manager] Cleaning up session for task ${session.taskId}`);
      session.closing = true;
      this.rejectPendingControlRequests(
        session,
        new PermissionModeControlError("Command Centre is shutting down.", "ambiguous", 504),
      );
      session.cleanupTempFiles?.();
      if (session.runner) {
        session.runner.stop("SIGTERM");
      } else {
        killChildProcessTree(session.proc);
      }
      try {
        const taskId = session.taskId ?? "";
        if (taskId && session.profileLease) {
          runInProcessProfile(session.profileLease.descriptor, () => this.clearClaudePid(taskId));
        }
      } catch {
        // Process shutdown should not be blocked by DB cleanup.
      }
      session.profileLease?.release();
    }
    this.sessions.clear();
    this.waitingForReply.clear();
    this.startingTasks.clear();
    this.lastProgressEmit.clear();
    this.restoringWorkflowRuns.clear();
    this.workflowJournalBridge.dispose();
    if (typeof closeAllLocalProfileHandles === "function") {
      try { closeAllLocalProfileHandles(); } catch { /* active shutdown work keeps its handle */ }
    }
  }

  getLogEntries(taskId: string): LogEntry[] {
    const db = getDb();
    const rows = db.prepare(
      "SELECT id, type, timestamp, content, toolName, toolArgs, toolResult, toolUseId, parentToolUseId, isCollapsed, questionSpec, questionAnswers, permissionMode FROM task_logs WHERE taskId = ? ORDER BY rowid ASC"
    ).all(taskId) as Array<{
      id: string; type: string; timestamp: string; content: string;
      toolName: string | null; toolArgs: string | null; toolResult: string | null;
      toolUseId: string | null; parentToolUseId: string | null;
      isCollapsed: number;
      questionSpec: string | null; questionAnswers: string | null;
      permissionMode: string | null;
    }>;

    const entries = rows.map((row): LogEntry => ({
      id: row.id,
      type: row.type as LogEntry["type"],
      timestamp: row.timestamp,
      content: row.content,
      ...(row.toolName ? { toolName: row.toolName } : {}),
      ...(row.toolArgs ? { toolArgs: row.toolArgs } : {}),
      ...(row.toolResult ? { toolResult: row.toolResult } : {}),
      ...(row.toolUseId ? { toolUseId: row.toolUseId } : {}),
      ...(row.parentToolUseId ? { parentToolUseId: row.parentToolUseId } : {}),
      ...(row.isCollapsed ? { isCollapsed: true } : {}),
      ...(row.questionSpec ? { questionSpec: row.questionSpec } : {}),
      ...(row.questionAnswers ? { questionAnswers: row.questionAnswers } : {}),
      ...(row.permissionMode ? { permissionMode: row.permissionMode } : {}),
    }));
    this.restoreWorkflowObservers(taskId, entries);
    return entries;
  }

  private restoreWorkflowObservers(taskId: string, entries: LogEntry[]): void {
    if (this.isCancellationRequested(taskId)) return;

    const terminalRunIds = new Set<string>();
    let latestStopIndex = -1;
    for (const [index, entry] of entries.entries()) {
      if (entry.type === "system" && entry.content === "Stopped by user") {
        latestStopIndex = index;
      }
      if ((entry.toolName || "").toLowerCase() !== "workflowterminalmetadata") continue;
      try {
        const args = JSON.parse(entry.toolArgs ?? "{}") as { workflowRunId?: unknown };
        if (typeof args.workflowRunId === "string") terminalRunIds.add(args.workflowRunId);
      } catch {
        // Ignore malformed internal metadata.
      }
    }

    for (const [index, entry] of entries.entries()) {
      if ((entry.toolName || "").toLowerCase() !== "workflowlaunch") continue;
      if (index <= latestStopIndex) continue;
      let launch: WorkflowJournalLaunchData;
      try {
        launch = JSON.parse(entry.toolArgs ?? "{}") as WorkflowJournalLaunchData;
      } catch {
        continue;
      }
      if (
        launch.hostTaskId !== taskId
        || !launch.runId
        || terminalRunIds.has(launch.runId)
        || this.workflowJournalBridge.getSnapshot(taskId, launch.runId)
      ) {
        continue;
      }

      const restoreKey = `${taskId}\u0000${launch.runId}`;
      if (this.restoringWorkflowRuns.has(restoreKey)) continue;
      this.restoringWorkflowRuns.add(restoreKey);
      void this.workflowJournalBridge.observeLaunch(launch).catch((error) => {
        console.warn(`[process-manager] Could not reconnect Workflow ${launch.runId}:`, error);
      }).finally(() => {
        this.restoringWorkflowRuns.delete(restoreKey);
      });
    }
  }

  /**
   * Public entry point to resume when the live persistent process is gone.
   * Used by the reply route as a fallback when in-memory state is stale.
   */
  async spawnContinueTurn(taskId: string, message: string, resumedFromReview: boolean = false): Promise<void> {
    const profile = resolveProcessProfile();
    return runInProcessProfile(profile, () => this.spawnContinueTurnInProfile(taskId, message, resumedFromReview));
  }

  private async spawnContinueTurnInProfile(taskId: string, message: string, resumedFromReview: boolean = false): Promise<void> {
    const db = getDb();
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as
      | (Omit<Task, "workScope"> & { workScope: string | null })
      | undefined;
    if (!task) throw new Error(`Task ${taskId} not found`);
    const workScope = readWorkScopeFromRow(task);
    const teamEnrichment = await this.resolveTeamEnrichment(taskId, task, workScope);

    const config = getConfig();
    const cwd = task.clientId ? getClientAiOsDir(task.clientId) : config.aiOsDir;

    this.waitingForReply.delete(this.taskKey(taskId));
    this.spawnClaudeTurn(
      taskId,
      message,
      cwd,
      true,
      resumedFromReview,
      teamEnrichment.snapshot?.markdown ?? "",
      teamEnrichment.mode,
      teamEnrichment.skillRuntime,
    );
  }

  // ── Private: spawn a single Claude CLI turn ──────────────────────

  private spawnClaudeTurn(
    taskId: string,
    prompt: string,
    cwd: string,
    isContinuation: boolean,
    resumedFromReview: boolean = false,
    snapshotContent: string = "",
    teamEnrichmentMode: TeamEnrichmentMode = "authorized",
    skillRuntime: TeamSkillRuntime | null = null,
  ): void {
    const profileDescriptor = resolveProcessProfile();
    const taskKey = this.taskKey(taskId, profileDescriptor);
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.AI_OS_CONTEXT_OVERLAY_DIR;
    // Lets the session-sync hook attach this session to its own task.
    cleanEnv.AI_OS_TASK_ID = taskId;
    const config = getConfig();

    // Read the task's permission mode, model, and thinking effort from the DB
    const db = getDb();
    const preparationClaim = db.prepare(
      "UPDATE tasks SET claudePid = -1 WHERE id = ? AND cancelRequestedAt IS NULL",
    ).run(taskId);
    if (!preparationClaim.changes) return;
    const taskRow = db.prepare(
      "SELECT permissionMode, model, thinkingEffort, cronJobSlug, projectSlug, clientId, workScope, cancelRequestedAt FROM tasks WHERE id = ?",
    ).get(taskId) as {
      permissionMode: string | null;
      model: string | null;
      thinkingEffort: string | null;
      cronJobSlug: string | null;
      projectSlug: string | null;
      clientId: string | null;
      workScope: string | null;
      cancelRequestedAt: string | null;
    } | undefined;
    if (!taskRow) {
      this.clearClaudePid(taskId);
      this.handleTaskError(taskId, "Task not found while preparing its immutable work scope.");
      return;
    }
    if (taskRow.cancelRequestedAt) {
      this.clearClaudePid(taskId);
      return;
    }
    let workScope: StoredWorkScopeV1;
    try {
      workScope = readWorkScopeFromRow(taskRow, profileDescriptor);
    } catch (error) {
      this.handleTaskError(
        taskId,
        error instanceof Error ? error.message : "The immutable work scope is invalid.",
      );
      this.clearClaudePid(taskId);
      return;
    }
    Object.assign(cleanEnv, buildWorkScopeEnvironment(workScope, profileDescriptor.profileKey));
    cleanEnv.AI_OS_TEAM_ENRICHMENT = teamEnrichmentMode;
    if (teamEnrichmentMode === "conversation_only") {
      cleanEnv.AI_OS_SKIP_MEMORY_CAPTURE = "1";
    }

    let continuationSessionId: string | null = null;
    if (isContinuation) {
      const row = db.prepare("SELECT claudeSessionId FROM tasks WHERE id = ?").get(taskId) as
        | { claudeSessionId: string | null }
        | undefined;
      continuationSessionId = row?.claudeSessionId ?? null;
      if (!continuationSessionId) {
        this.handleTaskError(
          taskId,
          "This chat cannot continue because its saved Claude session is unavailable. Start a new chat instead.",
        );
        return;
      }
    }

    // Tell GSD which project this task belongs to (priority 2 in resolvePlanningDir)
    if (taskRow?.projectSlug) {
      cleanEnv.AI_OS_ACTIVE_PROJECT = taskRow.projectSlug;
    }
    const isCronTask = Boolean(taskRow?.cronJobSlug);
    if (!isCronTask) {
      prompt = routeSkillCommandAliases(prompt, skillRuntime);
      if (skillRuntime?.promptFile && fs.existsSync(skillRuntime.promptFile)) {
        prompt = `${fs.readFileSync(skillRuntime.promptFile, "utf8")}\n\n---\n\n${prompt}`;
      }
    }
    // Cron tasks always run with bypassPermissions — they execute unattended
    const permissionMode = isCronTask
      ? "bypassPermissions"
      : (taskRow?.permissionMode || "bypassPermissions");
    const model = taskRow?.model || null;
    const thinkingEffort = taskRow?.thinkingEffort || null;

    // Build args. User messages are written to stdin as stream-json JSONL so
    // large prompts do not hit Windows command-line length limits and replies
    // can reuse the same live process.
    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--permission-mode", permissionMode,
      // Nothing can answer the built-in question tool in a headless run;
      // Claude asks through the ask-user-questions block instead.
      "--disallowedTools", ASK_USER_QUESTION_TOOL_NAME,
    ];

    if (!isCronTask && path.resolve(cwd) !== path.resolve(config.aiOsDir)) {
      // Claude discovers project skills from additional directories. This keeps
      // the installation's root skill pack available in client chats too.
      args.push("--add-dir", config.aiOsDir);
    }
    if (!isCronTask && skillRuntime?.pluginDir) {
      args.push("--plugin-dir", skillRuntime.pluginDir);
      cleanEnv.CLAUDE_SKILL_DIR = path.join(skillRuntime.pluginDir, "skills");
    }

    if (model) {
      args.push("--model", model);
    }
    if (thinkingEffort && thinkingEffort !== "auto") {
      args.push("--effort", thinkingEffort);
    }

    let snapshotFilePath: string | null = null;
    if (workScope.mode === "team" && teamEnrichmentMode === "authorized") {
      if (
        profileDescriptor.mode !== "team" &&
        typeof getActiveLocalProfileDescriptor === "function"
      ) {
        this.handleTaskError(taskId, "The Team task cannot use a Solo runtime profile.");
        return;
      }
      const expectation = {
        profileTempDir: profileDescriptor.tempDir,
        ownerType: "task" as const,
        ownerId: taskId,
        profileKey: profileDescriptor.profileKey,
        serverId: workScope.scope.serverId,
        userId: workScope.scope.userId,
        teamId: workScope.scope.teamId,
        clientId: workScope.scope.clientId,
      };
      try {
        const existing = loadRuntimeContextOverlay(expectation);
        const overlay = existing ?? createOrLoadRuntimeContextOverlay(
          expectation,
          snapshotContent,
          "command-centre-task",
        );
        cleanEnv.AI_OS_CONTEXT_OVERLAY_DIR = overlay.overlayDir;
        args.push("--append-system-prompt-file", overlay.snapshotPath);
      } catch (error) {
        const message = error instanceof RuntimeContextOverlayError
          ? error.message
          : "The immutable Team context overlay could not be prepared.";
        this.handleTaskError(taskId, message);
        return;
      }
    } else if (workScope.mode === "solo" && snapshotContent) {
      const runtimeTempDir = path.join(profileDescriptor.tempDir, "runtime");
      fs.mkdirSync(runtimeTempDir, { recursive: true });
      snapshotFilePath = path.join(runtimeTempDir, `aios-snapshot-${taskId}-${Date.now()}.txt`);
      fs.writeFileSync(snapshotFilePath, snapshotContent, "utf-8");
      args.push("--append-system-prompt-file", snapshotFilePath);
    }

    // bypassPermissions needs the dangerously-skip flag
    if (permissionMode === "bypassPermissions") {
      args.push("--dangerously-skip-permissions");
    }
    if (!isCronTask) {
      // Makes Full access available to the live control protocol without
      // activating it for Ask, Auto, or Plan sessions.
      args.push("--allow-dangerously-skip-permissions");
    }

    // Mount the bridge for every interactive session so a live task can move
    // back to Ask after starting in any other mode.
    let permissionConfigPath: string | null = null;
    let permissionSettingsPath: string | null = null;
    if (!isCronTask) {
      try {
        const permissionPromptScriptPath = this.resolvePermissionPromptScriptPath(config.aiOsDir);
        args.push("--allowedTools", "Read,Glob,Grep,WebSearch,mcp__permissions");
        const runtimeTempDir = path.join(profileDescriptor.tempDir, "runtime");
        fs.mkdirSync(runtimeTempDir, { recursive: true });
        permissionConfigPath = path.join(
          runtimeTempDir,
          `aios-permissions-${taskId}-${Date.now()}.json`,
        );
        permissionSettingsPath = path.join(
          runtimeTempDir,
          `aios-permissions-settings-${taskId}-${Date.now()}.json`,
        );
        const mcpConfig = {
          mcpServers: {
            permissions: {
              type: "stdio",
              command: process.execPath,
              args: [
                permissionPromptScriptPath,
                "--task-id",
                taskId,
                "--db-path",
                profileDescriptor.dbPath,
                "--workspace-path",
                cwd,
              ],
              env: {
                AI_OS_DIR: config.aiOsDir,
              },
            },
          },
        };
        const workspaceSettingsPath = [
          path.join(cwd, ".claude", "settings.json"),
          path.join(config.aiOsDir, ".claude", "settings.json"),
        ].find((candidate) => fs.existsSync(candidate));
        const workspaceSettings = workspaceSettingsPath
          ? JSON.parse(fs.readFileSync(workspaceSettingsPath, "utf-8")) as Record<string, unknown>
          : {};
        const workspacePermissions = workspaceSettings.permissions && typeof workspaceSettings.permissions === "object"
          ? workspaceSettings.permissions as Record<string, unknown>
          : {};
        const permissionSettings = {
          ...workspaceSettings,
          permissions: {
            ...workspacePermissions,
            // Keep the workspace's absolute denies, but do not preload its
            // editable-tool allows. Ask mode must reach the approval bridge.
            allow: [
              "Read(*)",
              "Glob(*)",
              "Grep(*)",
              "WebSearch",
              "mcp__permissions",
            ],
            deny: Array.isArray(workspacePermissions.deny)
              ? workspacePermissions.deny
              : [],
          },
        };
        fs.writeFileSync(permissionConfigPath, JSON.stringify(mcpConfig), "utf-8");
        fs.writeFileSync(permissionSettingsPath, JSON.stringify(permissionSettings), "utf-8");
        args.push("--setting-sources", "user");
        args.push("--settings", permissionSettingsPath);
        args.push("--mcp-config", permissionConfigPath);
        args.push("--permission-prompt-tool", PERMISSION_BRIDGE_TOOL_ID);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const summary = /missing at/i.test(detail)
          ? "Permission bridge failed: the bridge script path is missing."
          : "Permission bridge failed to start.";
        this.reportPermissionBridgeFailure(taskId, summary, detail);
        return;
      }
    }

    if (isContinuation) {
      // Continuations are accepted only with the exact session saved for this task.
      // Missing session IDs fail above rather than risking Claude's global --continue fallback.
      args.push("--resume", continuationSessionId!);
      console.log(`[process-manager] Using --resume ${continuationSessionId} for ${taskId.slice(0, 8)}`);
    }

    console.log(`[process-manager] Spawning persistent Claude${isContinuation ? " (resume)" : ""}: claude -p "${prompt.slice(0, 80)}..."`);
    console.log(`[process-manager] CWD: ${cwd}`);

    const prevSession = this.sessions.get(taskKey);
    if (
      prevSession
      && JSON.stringify(prevSession.workScope) !== JSON.stringify(workScope)
    ) {
      this.handleLostLiveSession(
        taskId,
        "The saved work scope changed unexpectedly, so the live session was stopped safely.",
      );
      return;
    }
    const profileLease = prevSession?.profileLease ?? acquireProcessProfileLease(profileDescriptor);
    let runnerSession: ClaudeRunnerSession;
    if (this.isCancellationRequested(taskId)) {
      for (const tempPath of [permissionConfigPath, permissionSettingsPath, snapshotFilePath]) {
        if (!tempPath) continue;
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // Ignore temp-file cleanup failure.
        }
      }
      this.clearClaudePid(taskId);
      return;
    }
    try {
      runnerSession = this.runner.start({
        args,
        cwd,
        env: cleanEnv,
      });
      const proc = runnerSession.proc;
      console.log(`[process-manager] Spawn succeeded, pid=${proc.pid}`);
    } catch (err) {
      if (permissionConfigPath) {
        try {
          fs.unlinkSync(permissionConfigPath);
        } catch {
          // Ignore temp-file cleanup failure
        }
      }
      if (permissionSettingsPath) {
        try {
          fs.unlinkSync(permissionSettingsPath);
        } catch {
          // Ignore temp-file cleanup failure
        }
      }
      if (snapshotFilePath) {
        try {
          fs.unlinkSync(snapshotFilePath);
        } catch {
          // Ignore temp-file cleanup failure
        }
      }
      console.error(`[process-manager] Spawn failed:`, err);
      if (!prevSession) profileLease.release();
      this.handleSpawnError(taskId, err);
      return;
    }

    const proc = runnerSession.proc;

    const pidClaim = db.prepare(
      "UPDATE tasks SET claudePid = ?, ownedClaudePid = ? WHERE id = ? AND cancelRequestedAt IS NULL",
    ).run(proc.pid ?? null, proc.pid ?? null, taskId);
    if (!pidClaim.changes) {
      killChildProcessTree(proc, "SIGKILL");
      for (const tempPath of [permissionConfigPath, permissionSettingsPath, snapshotFilePath]) {
        if (!tempPath) continue;
        try { fs.unlinkSync(tempPath); } catch { /* already removed */ }
      }
      if (!prevSession) profileLease.release();
      this.clearClaudePid(taskId);
      return;
    }

    // Carry forward accumulated metrics from previous turns
    const session: SessionEntry = {
      taskId,
      profileLease,
      workScope,
      teamEnrichmentMode,
      skillRuntime,
      proc,
      runner: runnerSession,
      pendingQuestion: false,
      totalCostUsd: prevSession?.totalCostUsd ?? 0,
      totalTokensUsed: prevSession?.totalTokensUsed ?? 0,
      totalDurationMs: prevSession?.totalDurationMs ?? 0,
      resumedFromReview,
      closing: false,
      activeSubagents: new Map(),
      activeWorkflowRuns: new Map(),
      terminalizingWorkflowRuns: new Set(),
      workflowParentCompletionPending: false,
      legacySubagentKeys: [],
      pendingControlRequests: new Map(),
      permissionChangeQueue: Promise.resolve(),
      appliedPermissionMode: getActivePermissionMode(permissionMode, "bypassPermissions"),
    };
    this.sessions.set(taskKey, session);
    const cleanupPermissionConfig = () => {
      if (!permissionConfigPath) return;
      try {
        fs.unlinkSync(permissionConfigPath);
      } catch {
        // Ignore temp-file cleanup failure
      }
      permissionConfigPath = null;
    };
    const cleanupPermissionSettings = () => {
      if (!permissionSettingsPath) return;
      try {
        fs.unlinkSync(permissionSettingsPath);
      } catch {
        // Ignore temp-file cleanup failure
      }
      permissionSettingsPath = null;
    };
    const cleanupSnapshotFile = () => {
      if (!snapshotFilePath) return;
      try {
        fs.unlinkSync(snapshotFilePath);
      } catch {
        // Ignore temp-file cleanup failure
      }
      snapshotFilePath = null;
    };
    session.cleanupTempFiles = () => {
      cleanupPermissionConfig();
      cleanupPermissionSettings();
      cleanupSnapshotFile();
    };
    this.setNextTurnParser(taskId, session);
    this.storeClaudePid(taskId, proc.pid);

    proc.on("error", (err) => {
      this.rejectPendingControlRequests(
        session,
        new PermissionModeControlError("The live Claude process failed before confirming the permission change.", "ambiguous", 504),
      );
      session.cleanupTempFiles?.();
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.handleTaskError(taskId, "Claude CLI not found. Ensure 'claude' is installed and in your PATH.");
      } else {
        this.handleTaskError(
          taskId,
          this.formatClaudeRuntimeError(taskId, `Process error: ${err.message}`, "startup"),
        );
      }
    });

    if (proc.stdout) {
      const rl = createInterface({ input: proc.stdout });
      rl.on("line", (line) => {
        console.log(`[process-manager] stdout(${taskId.slice(0, 8)}): ${line.slice(0, 120)}`);
        if (this.handleControlResponse(session, line)) return;
        session.parser?.feedLine(line);
      });
    }

    let stderrBuffer = "";
    if (proc.stderr) {
      proc.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        console.log(`[process-manager] stderr(${taskId.slice(0, 8)}): ${text.trim().slice(0, 200)}`);
        stderrBuffer += text;
      });
    }

    proc.on("close", (code) => {
      this.rejectPendingControlRequests(
        session,
        new PermissionModeControlError("The live Claude process closed before confirming the permission change.", "ambiguous", 504),
      );
      session.cleanupTempFiles?.();
      if (this.isCancellationRequested(taskId)) {
        this.sessions.delete(taskKey);
        session.profileLease?.release();
        this.clearClaudePid(taskId);
        this.lastProgressEmit.delete(taskKey);
        return;
      }
      // Check if this process is still the current one for this task.
      // If not, Command Centre intentionally stopped or replaced it.
      const currentSession = this.sessions.get(taskKey);
      if (currentSession && currentSession.proc !== proc) {
        console.log(`[process-manager] Stale close for ${taskId.slice(0, 8)} — ignoring`);
        return;
      }

      if (!currentSession || currentSession.closing) {
        console.log(`[process-manager] Close for ${taskId.slice(0, 8)} after intentional stop — ignoring`);
        this.clearClaudePid(taskId);
        this.lastProgressEmit.delete(taskKey);
        return;
      }

      if (code !== 0) {
        const trimmedStderr = stderrBuffer.trim();
        const permissionBridgeFailure = !isCronTask
          ? this.classifyPermissionBridgeFailure(trimmedStderr)
          : null;

        if (permissionBridgeFailure) {
          this.reportPermissionBridgeFailure(
            taskId,
            permissionBridgeFailure.summary,
            permissionBridgeFailure.detail,
          );
          this.lastProgressEmit.delete(taskKey);
          return;
        }

        const rawError = trimmedStderr
          ? `Claude CLI exited with code ${code}: ${trimmedStderr.slice(0, 500)}`
          : `Claude CLI exited with code ${code}`;
        this.handleTaskError(
          taskId,
          this.formatClaudeRuntimeError(taskId, rawError, "startup"),
        );
      } else {
        this.handleLostLiveSession(
          taskId,
          "The live Claude process exited, so Command Centre lost the in-process session state. Review the output; replying will resume from the saved transcript, but live subagent handles from the previous process cannot be recovered.",
        );
      }

      this.lastProgressEmit.delete(taskKey);
    });

    if (!runnerSession.sendUserMessage(prompt)) {
      this.handleLostLiveSession(
        taskId,
        "The live Claude session could not accept the first message. Command Centre did not start this task reliably.",
      );
    }
  }

  // ── Internal event handlers (called by parser wrapper) ───────────

  private getActiveWorkflowRuns(session: SessionEntry): Map<string, ActiveWorkflowRun> {
    return session.activeWorkflowRuns ??= new Map();
  }

  private getTerminalizingWorkflowRuns(session: SessionEntry): Set<string> {
    return session.terminalizingWorkflowRuns ??= new Set();
  }

  handleWorkflowLaunch(taskId: string, data: WorkflowLaunchData): void {
    if (this.isCancellationRequested(taskId)) return;

    const session = this.sessions.get(this.taskKey(taskId));
    if (!session) return;

    const activeRuns = this.getActiveWorkflowRuns(session);
    if (activeRuns.has(data.runId) || this.workflowJournalBridge.getSnapshot(taskId, data.runId)) {
      return;
    }

    const task = getDb().prepare("SELECT claudeSessionId FROM tasks WHERE id = ?").get(taskId) as
      | { claudeSessionId: string | null }
      | undefined;
    const sessionId = task?.claudeSessionId?.trim();
    if (!sessionId) {
      console.warn(`[process-manager] Ignoring Workflow ${data.runId}: Claude session ID is unavailable`);
      return;
    }

    const launch: WorkflowJournalLaunchData = {
      hostTaskId: taskId,
      sessionId,
      toolUseId: data.toolUseId,
      taskId: data.taskId,
      runId: data.runId,
      transcriptDir: data.transcriptDir,
      ...(data.scriptPath ? { scriptPath: data.scriptPath } : {}),
      ...(data.workflowName ? { workflowName: data.workflowName } : {}),
      ...(data.summary ? { summary: data.summary } : {}),
    };

    activeRuns.set(data.runId, {
      runId: data.runId,
      toolUseId: data.toolUseId,
      workflowTaskId: data.taskId,
      sessionId,
      transcriptDir: data.transcriptDir,
    });
    session.workflowParentCompletionPending = false;
    this.addLogEntryIfAbsent(taskId, {
      id: `workflow:${data.runId}:launch`,
      type: "tool_result",
      timestamp: new Date().toISOString(),
      content: "Workflow launch metadata",
      toolName: "WorkflowLaunch",
      toolArgs: JSON.stringify(launch),
      toolUseId: data.toolUseId,
    });
    this.updateWorkflowWaitStatus(taskId, session);

    void this.workflowJournalBridge.observeLaunch(launch).catch((error) => {
      activeRuns.delete(data.runId);
      console.warn(`[process-manager] Could not observe Workflow ${data.runId}:`, error);
      this.addLogEntryIfAbsent(taskId, {
        id: `workflow:${data.runId}:observer-error`,
        type: "tool_result",
        timestamp: new Date().toISOString(),
        content: "Workflow observer unavailable",
        toolName: "WorkflowObserverError",
        toolArgs: JSON.stringify({ source: "workflow", workflowRunId: data.runId }),
        toolUseId: data.toolUseId,
      });
    });
  }

  handleWorkflowTerminal(taskId: string, data: WorkflowTerminalData): void {
    if (this.isCancellationRequested(taskId)) return;

    const session = this.sessions.get(this.taskKey(taskId));
    if (session) {
      this.getActiveWorkflowRuns(session).delete(data.runId);
      this.getTerminalizingWorkflowRuns(session).add(data.runId);
      // Any result received before this terminal notification was an early
      // parent result. Only the next parent result may finish the Goal.
      session.deferredCompletion = undefined;
      session.workflowParentCompletionPending = true;
      this.updateWorkflowWaitStatus(taskId, session);
    }

    void this.workflowJournalBridge.finalizeTerminal({
      hostTaskId: taskId,
      runId: data.runId,
      status: data.status,
      ...(data.summary ? { summary: data.summary } : {}),
      ...(data.result ? { result: data.result } : {}),
      ...(data.outputFile ? { outputFile: data.outputFile } : {}),
    }).then((snapshot) => {
      if (!snapshot && session) {
        this.getTerminalizingWorkflowRuns(session).delete(data.runId);
      }
    }).catch((error) => {
      if (session) this.getTerminalizingWorkflowRuns(session).delete(data.runId);
      console.warn(`[process-manager] Could not finalize Workflow ${data.runId}:`, error);
    });
  }

  private handleWorkflowAgentStarted(event: WorkflowJournalAgentStartedEvent): void {
    this.addLogEntryIfAbsent(event.hostTaskId, {
      id: `workflow:${event.runId}:${event.agentId}:started`,
      type: "tool_use",
      timestamp: event.observedAt,
      content: `${event.agentLabel} started`,
      toolName: "Agent",
      toolArgs: JSON.stringify({
        source: "workflow",
        workflowRunId: event.runId,
        workflowAgentId: event.agentId,
        agentIndex: event.agentIndex,
        subagent_type: event.agentLabel,
        ...(event.prompt ? { prompt: event.prompt } : {}),
      }),
      toolUseId: event.toolUseId,
      parentToolUseId: event.parentToolUseId,
    });
  }

  private handleWorkflowAgentCompleted(event: WorkflowJournalAgentCompletedEvent): void {
    this.addLogEntryIfAbsent(event.hostTaskId, {
      id: `workflow:${event.runId}:${event.agentId}:closed`,
      type: "tool_result",
      timestamp: event.completedAt,
      content: event.summary ?? `${event.agentLabel} ${event.outcome}`,
      toolName: "AgentNotification",
      toolArgs: JSON.stringify({
        source: "workflow",
        workflowRunId: event.runId,
        workflowAgentId: event.agentId,
        status: event.outcome,
      }),
      ...(event.summary ? { toolResult: event.summary } : {}),
      toolUseId: event.toolUseId,
      parentToolUseId: event.parentToolUseId,
    });
  }

  private handleWorkflowRunTerminal(snapshot: WorkflowJournalRunSnapshot): void {
    if (this.isCancellationRequested(snapshot.hostTaskId)) return;

    const timestamp = snapshot.terminal?.finalizedAt ?? new Date().toISOString();
    for (const agent of snapshot.agents) {
      if (!agent.officialLabel && !agent.prompt && !agent.promptPreview && !agent.workflowOutcome) continue;
      this.addLogEntryIfAbsent(snapshot.hostTaskId, {
        id: `workflow:${snapshot.runId}:${agent.agentId}:metadata`,
        type: "tool_result",
        timestamp,
        content: "Workflow agent metadata",
        toolName: "WorkflowAgentMetadata",
        toolArgs: JSON.stringify({
          source: "workflow",
          workflowRunId: snapshot.runId,
          workflowAgentId: agent.agentId,
          agentName: agent.officialLabel,
          prompt: agent.prompt ?? agent.promptPreview,
          status: agent.workflowOutcome ?? agent.status,
          startedAt: agent.startedAtMs,
          durationMs: agent.durationMs,
          resultPreview: agent.resultPreview,
          workflowState: agent.workflowState,
          model: agent.model,
          phaseTitle: agent.phaseTitle,
          tokens: agent.tokens,
          toolCalls: agent.toolCalls,
        }),
        toolUseId: agent.toolUseId,
        parentToolUseId: snapshot.parentToolUseId,
      });
    }

    this.addLogEntryIfAbsent(snapshot.hostTaskId, {
      id: `workflow:${snapshot.runId}:terminal`,
      type: "tool_result",
      timestamp,
      content: "Workflow terminal metadata",
      toolName: "WorkflowTerminalMetadata",
      toolArgs: JSON.stringify({
        source: "workflow",
        workflowRunId: snapshot.runId,
        status: snapshot.terminal?.status,
      }),
      toolUseId: snapshot.parentToolUseId,
    });

    const session = this.sessions.get(snapshot.hostTaskId);
    if (!session) return;
    this.getActiveWorkflowRuns(session).delete(snapshot.runId);
    this.getTerminalizingWorkflowRuns(session).delete(snapshot.runId);

    if (
      session.workflowParentCompletionPending
      && session.deferredCompletion
      && this.getActiveWorkflowRuns(session).size === 0
      && this.getTerminalizingWorkflowRuns(session).size === 0
      && session.activeSubagents.size === 0
    ) {
      const completion = session.deferredCompletion;
      session.deferredCompletion = undefined;
      session.workflowParentCompletionPending = false;
      queueMicrotask(() => this.handleTurnComplete(snapshot.hostTaskId, completion));
      return;
    }

    this.updateWorkflowWaitStatus(snapshot.hostTaskId, session);
  }

  private formatSubagentWaitLabel(count: number): string {
    return count === 1 ? "Waiting for 1 agent to finish" : `Waiting for ${count} agents to finish`;
  }

  private updateWorkflowWaitStatus(taskId: string, session: SessionEntry): void {
    if (this.isCancellationRequested(taskId)) return;

    const agentCount = session.activeSubagents.size;
    const activeWorkflowCount = this.getActiveWorkflowRuns(session).size;
    const terminalizingCount = this.getTerminalizingWorkflowRuns(session).size;
    const activityLabel = agentCount > 0
      ? this.formatSubagentWaitLabel(agentCount)
      : activeWorkflowCount > 0
        ? "Starting workflow agents"
        : terminalizingCount > 0
          ? "Collecting agent results"
          : "Collecting agent results";

    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE tasks SET status = 'running', updatedAt = ?, activityLabel = ?, needsInput = 0 WHERE id = ?"
    ).run(now, activityLabel, taskId);

    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task | undefined;
    if (updated) {
      emitTaskEvent({ type: "task:status", task: this.normalizeTask(updated), timestamp: now });
    }
  }

  private updateSubagentWaitStatus(taskId: string, session: SessionEntry): void {
    const count = session.activeSubagents.size;
    if (count === 0) return;
    this.updateWorkflowWaitStatus(taskId, session);
  }

  private updateSubagentSummaryWaitStatus(taskId: string, session: SessionEntry): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE tasks SET status = 'running', updatedAt = ?, activityLabel = ?, needsInput = 0 WHERE id = ?"
    ).run(now, "Collecting agent results", taskId);
    this.storeClaudePid(taskId, session.proc.pid);

    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task | undefined;
    if (updated) {
      emitTaskEvent({ type: "task:status", task: this.normalizeTask(updated), timestamp: now });
    }
  }

  private reconcileActiveSubagentsFromLogs(taskId: string, session: SessionEntry): void {
    const entries = getTaskLogEntries(getDb(), taskId);
    const model = buildSubagentActivityModel(entries);
    const activeSubagents = new Map<string, ActiveSubagent>();
    const legacySubagentKeys: string[] = [];

    for (const event of model.eventsByEntryId.values()) {
      if (event.kind !== "created" || !model.activeKeys.has(event.toolUseKey)) {
        continue;
      }

      activeSubagents.set(event.toolUseKey, {
        toolUseKey: event.toolUseKey,
        ...(event.toolUseId ? { toolUseId: event.toolUseId } : {}),
        agentName: event.agentName,
        instructions: event.instructions,
        startedAt: event.timestamp,
        source: event.source,
      });
      if (!event.toolUseId) {
        legacySubagentKeys.push(event.toolUseKey);
      }
    }

    session.activeSubagents = activeSubagents;
    session.legacySubagentKeys = legacySubagentKeys;
  }

  private handleSubagentToolUse(taskId: string, entry: LogEntry): void {
    if (this.isCancellationRequested(taskId)) return;
    const session = this.sessions.get(this.taskKey(taskId));
    if (!session || !isSubagentToolUse(entry)) return;

    const toolUseKey = entry.toolUseId ?? `legacy:${entry.id}`;
    if (session.activeSubagents.has(toolUseKey)) {
      return;
    }

    let source: "direct" | "workflow" = "direct";
    try {
      const args = JSON.parse(entry.toolArgs ?? "{}") as { source?: unknown };
      if (args.source === "workflow") source = "workflow";
    } catch {
      // Invalid tool arguments remain a direct-agent lifecycle entry.
    }

    session.activeSubagents.set(toolUseKey, {
      toolUseKey,
      ...(entry.toolUseId ? { toolUseId: entry.toolUseId } : {}),
      agentName: getSubagentName(entry),
      instructions: getSubagentInstructions(entry),
      startedAt: entry.timestamp,
      source,
    });
    if (!entry.toolUseId) {
      session.legacySubagentKeys.push(toolUseKey);
    }

    this.updateSubagentWaitStatus(taskId, session);
  }

  private handleSubagentToolResult(taskId: string, entry: LogEntry): void {
    if (this.isCancellationRequested(taskId)) return;
    const session = this.sessions.get(this.taskKey(taskId));
    if (!session || entry.type !== "tool_result") return;

    let toolUseKey: string | null = null;
    if (entry.toolUseId && session.activeSubagents.has(entry.toolUseId)) {
      toolUseKey = entry.toolUseId;
    } else if (!entry.toolUseId && session.legacySubagentKeys.length > 0) {
      toolUseKey = session.legacySubagentKeys.shift() ?? null;
    }

    if (!toolUseKey || !session.activeSubagents.has(toolUseKey)) {
      return;
    }

    session.activeSubagents.delete(toolUseKey);

    if (session.activeSubagents.size > 0) {
      this.updateSubagentWaitStatus(taskId, session);
      return;
    }

    // A subagent close means its result is ready for the parent agent to
    // collect. The task remains running until the parent emits its next
    // top-level result; that result, not the child close, starts user review.
    this.updateSubagentSummaryWaitStatus(taskId, session);
  }

  handleProgress(
    taskId: string,
    data: { costUsd?: number; tokensUsed?: number; activityLabel?: string }
  ): void {
    if (this.isCancellationRequested(taskId)) return;
    const now = Date.now();
    const taskKey = this.taskKey(taskId);
    const lastEmit = this.lastProgressEmit.get(taskKey) || 0;
    if (now - lastEmit < 1000) return;
    this.lastProgressEmit.set(taskKey, now);

    const db = getDb();
    const updates: string[] = ["updatedAt = ?"];
    const values: unknown[] = [new Date().toISOString()];

    if (data.costUsd !== undefined) {
      updates.push("costUsd = ?");
      values.push(data.costUsd);
    }
    if (data.tokensUsed !== undefined) {
      updates.push("tokensUsed = ?");
      values.push(data.tokensUsed);
    }
    if (data.activityLabel !== undefined) {
      updates.push("activityLabel = ?");
      values.push(data.activityLabel);
    }

    values.push(taskId);
    db.prepare(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`).run(...values);

    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;
    emitTaskEvent({ type: "task:progress", task: this.normalizeTask(updated), timestamp: new Date().toISOString() });
  }

  /**
   * Called when a single Claude turn completes (result message received).
   * If a question was asked during this turn, the task stays in "running"
   * with needsInput — waiting for user to reply into the same live process.
   * Otherwise, the task is finalised to "review".
   */
  handleTurnComplete(
    taskId: string,
    data: { costUsd: number; tokensUsed: number; durationMs: number; sessionId?: string }
  ): void {
    if (this.isCancellationRequested(taskId)) return;
    const session = this.sessions.get(this.taskKey(taskId));

    // Accumulate metrics across turns
    const totalCost = (session?.totalCostUsd ?? 0) + data.costUsd;
    const totalTokens = (session?.totalTokensUsed ?? 0) + data.tokensUsed;
    const totalDuration = (session?.totalDurationMs ?? 0) + data.durationMs;

    const db = getDb();
    const now = new Date().toISOString();

    // Persist Claude CLI session ID for --resume support
    if (data.sessionId) {
      this.storeClaudeSessionId(taskId, data.sessionId);
    }

    // Check if a question was asked during this turn.
    const db2 = getDb();
    const cronCheck = db2.prepare("SELECT cronJobSlug FROM tasks WHERE id = ?").get(taskId) as { cronJobSlug: string | null } | undefined;
    const isCronTask = !!cronCheck?.cronJobSlug;
    const questionAsked = session?.pendingQuestion ?? false;

    // Respect explicit user actions: if the user already marked this task "done"
    // via the UI while Claude was finishing, don't override it.
    const currentStatus = (db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as { status: string } | undefined)?.status;
    if (currentStatus === "done") {
      console.log(`[process-manager] Task ${taskId.slice(0, 8)} already marked done by user — respecting explicit status`);
      this.stopSession(taskId);
      return;
    }

    if (session && session.activeSubagents.size > 0) {
      this.reconcileActiveSubagentsFromLogs(taskId, session);
    }

    const activeWorkflowCount = session ? this.getActiveWorkflowRuns(session).size : 0;
    const terminalizingWorkflowCount = session ? this.getTerminalizingWorkflowRuns(session).size : 0;
    const activeAgentCount = session?.activeSubagents.size ?? 0;
    if (session && (activeAgentCount > 0 || activeWorkflowCount > 0 || terminalizingWorkflowCount > 0)) {
      session.deferredCompletion = data;
      session.workflowParentCompletionPending = activeWorkflowCount === 0
        && terminalizingWorkflowCount > 0
        && [...session.activeSubagents.values()].every((agent) => agent.source === "workflow");
      const activityLabel = activeAgentCount > 0
        ? this.formatSubagentWaitLabel(activeAgentCount)
        : activeWorkflowCount > 0
          ? "Starting workflow agents"
          : "Collecting agent results";
      db.prepare(
        "UPDATE tasks SET status = 'running', updatedAt = ?, costUsd = ?, tokensUsed = ?, durationMs = ?, activityLabel = ?, needsInput = 0 WHERE id = ?"
      ).run(now, totalCost, totalTokens, totalDuration, activityLabel, taskId);
      this.storeClaudePid(taskId, session.proc.pid);

      const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;
      emitTaskEvent({ type: "task:status", task: this.normalizeTask(updated), timestamp: now });
      this.lastProgressEmit.delete(this.taskKey(taskId));
      console.log(`[process-manager] Deferring turn completion for ${taskId.slice(0, 8)} while ${activeAgentCount} agent(s) and ${activeWorkflowCount + terminalizingWorkflowCount} Workflow run(s) remain`);
      return;
    }

    if (session) {
      session.deferredCompletion = undefined;
      session.workflowParentCompletionPending = false;
      session.totalCostUsd = totalCost;
      session.totalTokensUsed = totalTokens;
      session.totalDurationMs = totalDuration;
    }

    // Determine if this is a subtask (has a parent). Subtasks are still
    // manual-complete: finishing the run moves them to review, not done.
    const taskCheck = db.prepare("SELECT level, parentId, completedAt FROM tasks WHERE id = ?").get(taskId) as
      { level: string; parentId: string | null; completedAt: string | null } | undefined;
    const isSubtask = !!taskCheck?.parentId;

    console.log(`[process-manager] handleTurnComplete(${taskId.slice(0, 8)}): questionAsked=${questionAsked}, isCronTask=${isCronTask}, isSubtask=${isSubtask}, hasSession=${!!session}`);

    // For cron tasks and subtasks: use question detection to decide flow.
    // For all other tasks (user-facing): ALWAYS keep interactive.
    // The user decides when a task is done — not the system.
    if (!isCronTask && !isSubtask) {
      // Top-level interactive task: move to "review" (Your Turn) with needsInput.
      // Question detection is only used to surface the specific question text.
      const completionLabel = questionAsked
        ? undefined  // handleQuestion already set the activityLabel
        : this.buildCompletionSummary(taskId, db) || "Claude has finished this step — review and reply, or mark as done";

      if (completionLabel) {
        db.prepare("UPDATE tasks SET activityLabel = ? WHERE id = ?").run(completionLabel, taskId);
      }

      db.prepare(
        "UPDATE tasks SET status = 'review', updatedAt = ?, costUsd = ?, tokensUsed = ?, durationMs = ?, needsInput = 1 WHERE id = ?"
      ).run(now, totalCost, totalTokens, totalDuration, taskId);

      this.waitingForReply.add(this.taskKey(taskId));
      if (session) {
        this.storeClaudePid(taskId, session.proc.pid);
      }

      const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;
      emitTaskEvent({ type: "task:status", task: this.normalizeTask(updated), timestamp: now });

      // Still auto-create subtasks for parent tasks if needed
      if (!updated.parentId) {
        if (updated.level === "gsd") {
          this.autoSyncPhases(taskId);
        } else if (updated.level === "project") {
          this.extractAndCreateSubtasks(taskId, updated);
        }
      }
      this.lastProgressEmit.delete(this.taskKey(taskId));
      return;
    }

    if (questionAsked) {
      // Subtask or cron asked a question — keep interactive
      console.log(`[process-manager] Turn complete with pending question for ${taskId} — adding to waitingForReply`);

      if (isCronTask) {
        db.prepare(
          "UPDATE tasks SET status = 'review', completedAt = NULL, updatedAt = ?, costUsd = ?, tokensUsed = ?, durationMs = ?, needsInput = 1, activityLabel = NULL WHERE id = ?"
        ).run(now, totalCost, totalTokens, totalDuration, taskId);
      } else {
        db.prepare(
          "UPDATE tasks SET updatedAt = ?, costUsd = ?, tokensUsed = ?, durationMs = ?, needsInput = 1, activityLabel = NULL WHERE id = ?"
        ).run(now, totalCost, totalTokens, totalDuration, taskId);
      }

      this.waitingForReply.add(this.taskKey(taskId));
      if (session) {
        this.storeClaudePid(taskId, session.proc.pid);
      }

      const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;

      if (updated.cronJobSlug) {
        this.recordCronRun(updated, totalCost, totalDuration, {
          result: "failure",
          exitCode: 1,
          completionReason: "needs_input",
        });
      }

      emitTaskEvent({ type: "task:status", task: this.normalizeTask(updated), timestamp: now });
    } else {
      fileWatcher.stopWatching(taskId).catch(() => {});

      const completionLabel = this.buildCompletionSummary(taskId, db);

      if (isCronTask) {
        console.log(`[process-manager] Cron task ${taskId} completed — moving to done`);

        db.prepare(
          "UPDATE tasks SET status = 'done', completedAt = ?, updatedAt = ?, costUsd = ?, tokensUsed = ?, durationMs = ?, activityLabel = ?, needsInput = 0, claudePid = NULL WHERE id = ?"
        ).run(now, now, totalCost, totalTokens, totalDuration, completionLabel, taskId);
      } else {
        console.log(`[process-manager] Subtask ${taskId} finished running — moving to review`);

        db.prepare(
          "UPDATE tasks SET status = 'review', completedAt = NULL, updatedAt = ?, costUsd = ?, tokensUsed = ?, durationMs = ?, activityLabel = ?, needsInput = 1, claudePid = NULL WHERE id = ?"
        ).run(now, totalCost, totalTokens, totalDuration, completionLabel || "Subchat finished — review and mark done if complete", taskId);
      }

      this.stopSession(taskId);

      const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;

      // Record cron run data BEFORE emitting events (so history is available when UI refreshes)
      if (updated.cronJobSlug) {
        this.recordCronRun(updated, totalCost, totalDuration);
      }

      emitTaskEvent({ type: "task:status", task: this.normalizeTask(updated), timestamp: now });

      // Auto-create subtasks for parent tasks on completion
      if (!updated.parentId) {
        if (updated.level === "gsd") {
          // GSD: sync phases from .planning/ROADMAP.md (created by /gsd-new-project)
          this.autoSyncPhases(taskId);
        } else if (updated.level === "project") {
          // Project: extract deliverable subtasks from the conversation output
          this.extractAndCreateSubtasks(taskId, updated);
        }
      }

      // Auto-queue next sibling only after cron/other automatic done flows.
      // Normal subchat completion lands in review and waits for manual done.
      if (updated.parentId && updated.status === "done") {
        this.autoQueueNextSibling(updated);
      }
    }

    this.lastProgressEmit.delete(this.taskKey(taskId));
  }

  /**
   * Called when question-like text is detected in Claude's output.
   * Updates the UI to show the question, but does NOT set session.pendingQuestion —
   * that's controlled by the turn-aware wrapper so only the LAST text block's
   * question state matters (intermediate questions followed by more work don't count).
   */
  /**
   * Called when a structured question block is detected in Claude's output.
   * Parallel to `handleQuestion`, but stores the typed QuestionSpec[] so the
   * UI can render the QuestionModal instead of a prose bubble.
   */
  handleStructuredQuestion(taskId: string, specs: QuestionSpec[]): void {
    if (this.isCancellationRequested(taskId)) return;
    console.log(
      `[process-manager] handleStructuredQuestion(${taskId.slice(0, 8)}): ${specs.length} questions`
    );

    const db = getDb();
    const now = new Date().toISOString();

    // Build a short activity label from the first question prompt
    const firstPrompt = specs[0]?.prompt ?? "Waiting for your answers";
    const label = firstPrompt.length > 100 ? firstPrompt.slice(0, 97) + "..." : firstPrompt;
    db.prepare("UPDATE tasks SET updatedAt = ?, activityLabel = ?, needsInput = 1 WHERE id = ?")
      .run(now, label, taskId);

    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;
    emitTaskEvent({
      type: "task:question",
      task: this.normalizeTask(updated),
      timestamp: now,
      questionText: `${specs.length} question${specs.length === 1 ? "" : "s"}`,
    });

    this.addLogEntry(taskId, {
      id: crypto.randomUUID(),
      type: "structured_question",
      timestamp: now,
      content: specs.map((s, i) => `${i + 1}. ${s.prompt}`).join("\n"),
      questionSpec: JSON.stringify(specs),
    });

    // Bubble into the chat conversation if this task is part of one
    const summaryText = specs.map((s, i) => `${i + 1}. ${s.prompt}`).join("\n");
    this.bubbleQuestionToChat(db, taskId, summaryText, now, specs);
  }

  /**
   * Called when the CLI reports that an AskUserQuestion call went unanswered
   * and its questions could not be shown in the modal. Flags the task so the
   * user knows Claude is waiting on them.
   */
  handleUnansweredToolQuestion(taskId: string): void {
    if (this.isCancellationRequested(taskId)) return;
    console.log(`[process-manager] handleUnansweredToolQuestion(${taskId.slice(0, 8)}): AskUserQuestion went unanswered`);

    const db = getDb();
    const now = new Date().toISOString();
    const notice = "Claude asked a question the Command Centre couldn't show. Reply in the chat to continue.";
    db.prepare("UPDATE tasks SET updatedAt = ?, activityLabel = ?, needsInput = 1 WHERE id = ?")
      .run(now, notice, taskId);

    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;
    emitTaskEvent({ type: "task:question", task: this.normalizeTask(updated), timestamp: now, questionText: notice });

    this.addLogEntry(taskId, {
      id: crypto.randomUUID(),
      type: "system",
      timestamp: now,
      content: notice,
    });
  }

  handleQuestion(taskId: string, questionText: string): void {
    if (this.isCancellationRequested(taskId)) return;
    console.log(`[process-manager] handleQuestion(${taskId.slice(0, 8)}): detected question in output`);

    const db = getDb();
    const now = new Date().toISOString();

    // Use the question text as the activity label so the card shows what's being asked
    const label = questionText.length > 100 ? questionText.slice(0, 97) + "..." : questionText;
    db.prepare("UPDATE tasks SET updatedAt = ?, activityLabel = ?, needsInput = 1 WHERE id = ?")
      .run(now, label, taskId);

    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;
    emitTaskEvent({ type: "task:question", task: this.normalizeTask(updated), timestamp: now, questionText });

    // Bubble into the chat conversation if this task is part of one
    this.bubbleQuestionToChat(db, taskId, questionText, now);
  }

  /**
   * Insert a sub_agent message into the chat conversation so the question
   * appears in the autonomous chat view as a bubbled question card.
   */
  private bubbleQuestionToChat(
    db: ReturnType<typeof getDb>,
    taskId: string,
    questionText: string,
    timestamp: string,
    questionSpecs?: QuestionSpec[],
  ): void {
    const task = db.prepare("SELECT conversationId, title FROM tasks WHERE id = ?").get(taskId) as
      { conversationId: string | null; title: string } | undefined;
    if (!task?.conversationId) return;

    const msgId = crypto.randomUUID();
    const metadata: Record<string, unknown> = {
      questionTaskId: taskId,
      questionText,
    };
    if (questionSpecs && questionSpecs.length > 0) {
      metadata.questionSpecs = questionSpecs;
    }

    db.prepare(
      `INSERT INTO messages (id, conversationId, taskId, role, content, metadata, parentMessageId, createdAt)
       VALUES (?, ?, ?, 'sub_agent', ?, ?, NULL, ?)`
    ).run(
      msgId,
      task.conversationId,
      taskId,
      questionText,
      JSON.stringify(metadata),
      timestamp,
    );

    emitChatEvent({
      type: "chat:message",
      conversationId: task.conversationId,
      message: {
        id: msgId,
        conversationId: task.conversationId,
        taskId,
        role: "sub_agent",
        content: questionText,
        metadata: metadata as import("@/types/chat").MessageMetadata,
        parentMessageId: null,
        createdAt: timestamp,
      },
      timestamp,
    });
  }

  handleLostLiveSession(taskId: string, message: string): void {
    if (this.isCancellationRequested(taskId)) return;
    fileWatcher.stopWatching(taskId).catch(() => {});

    const taskKey = this.taskKey(taskId);
    const session = this.sessions.get(taskKey);
    if (session) {
      session.closing = true;
      this.rejectPendingControlRequests(
        session,
        new PermissionModeControlError(message, "ambiguous", 504),
      );
      session.cleanupTempFiles?.();
      if (session.runner) {
        session.runner.stop("SIGTERM");
      } else {
        killChildProcessTree(session.proc);
      }
      this.sessions.delete(taskKey);
      session.profileLease?.release();
    }

    this.waitingForReply.add(taskKey);
    this.lastProgressEmit.delete(taskKey);

    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE tasks SET status = 'review', completedAt = NULL, updatedAt = ?, errorMessage = ?, activityLabel = ?, needsInput = 1, claudePid = NULL WHERE id = ?"
    ).run(now, message, "Live Claude session ended — review output", taskId);

    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;
    emitTaskEvent({ type: "task:status", task: this.normalizeTask(updated), timestamp: now });
  }

  handleTaskError(taskId: string, errorMessage: string): void {
    if (this.isCancellationRequested(taskId)) return;
    fileWatcher.stopWatching(taskId).catch(() => {});

    const db = getDb();
    const now = new Date().toISOString();

    // Check if this is a cron task so resumed scheduled work can land in review,
    // not misleadingly mark itself done.
    const task = db.prepare("SELECT cronJobSlug FROM tasks WHERE id = ?").get(taskId) as { cronJobSlug: string | null } | undefined;
    const isCronTask = !!task?.cronJobSlug;

    if (isCronTask) {
      // Cron task continuations still need a human to step in when they fail.
      db.prepare(
        "UPDATE tasks SET status = 'review', completedAt = NULL, updatedAt = ?, errorMessage = ?, activityLabel = ?, needsInput = 1, claudePid = NULL WHERE id = ?"
      ).run(now, errorMessage, "Error — needs attention", taskId);

      this.waitingForReply.add(this.taskKey(taskId));
    } else {
      // Interactive tasks need a human review after a hard process error.
      db.prepare(
        "UPDATE tasks SET status = 'review', completedAt = NULL, updatedAt = ?, errorMessage = ?, activityLabel = ?, needsInput = 1, claudePid = NULL WHERE id = ?"
      ).run(now, errorMessage, "Error — needs attention", taskId);

      this.waitingForReply.add(this.taskKey(taskId));
    }

    this.stopSession(taskId);
    this.waitingForReply.add(this.taskKey(taskId));

    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;
    emitTaskEvent({ type: "task:status", task: this.normalizeTask(updated), timestamp: now });

    // Record failed cron run if this task was triggered by a cron job
    if (updated.cronJobSlug) {
      this.recordCronRun(updated, 0, 0);
    }
  }

  handleClaudeOutputError(taskId: string, errorMessage: string): void {
    this.handleTaskError(
      taskId,
      this.formatClaudeRuntimeError(taskId, errorMessage, "turn"),
    );
  }

  addLogEntry(taskId: string, entry: LogEntry): void {
    this.persistLogEntry(taskId, entry, false);
  }

  private addLogEntryIfAbsent(taskId: string, entry: LogEntry): boolean {
    return this.persistLogEntry(taskId, entry, true);
  }

  private persistLogEntry(taskId: string, entry: LogEntry, idempotent: boolean): boolean {
    if (this.isCancellationRequested(taskId) && entry.content !== "Stopped by user") {
      return false;
    }
    const db = getDb();
    const result = db.prepare(
      `${idempotent ? "INSERT OR IGNORE" : "INSERT"} INTO task_logs (id, taskId, type, timestamp, content, toolName, toolArgs, toolResult, toolUseId, parentToolUseId, isCollapsed, questionSpec, questionAnswers, permissionMode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      entry.id, taskId, entry.type, entry.timestamp, entry.content,
      entry.toolName ?? null, entry.toolArgs ?? null, entry.toolResult ?? null,
      entry.toolUseId ?? null, entry.parentToolUseId ?? null,
      entry.isCollapsed ? 1 : 0,
      entry.questionSpec ?? null, entry.questionAnswers ?? null,
      entry.permissionMode ?? null,
    );
    if (result.changes === 0) return false;

    // When Claude writes or edits a file, register it as a task output immediately.
    // This supplements the file-watcher (which may miss files due to timing or scope).
    if (entry.type === "tool_use" && entry.toolArgs) {
      const toolName = (entry.toolName || "").toLowerCase();
      if (toolName === "write" || toolName === "edit" || toolName === "multiedit") {
        this.registerFileOutput(taskId, entry.toolArgs);
      }
    }

    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task | undefined;
    if (task) {
      emitTaskEvent({
        type: "task:log",
        task: this.normalizeTask(task),
        timestamp: entry.timestamp,
        logEntry: entry,
      });
    }

    if (entry.type === "tool_use") {
      this.handleSubagentToolUse(taskId, entry);
    } else if (entry.type === "tool_result") {
      this.handleSubagentToolResult(taskId, entry);
    }

    return true;
  }

  /**
   * Extract a file path from a Write/Edit tool_use and insert into task_outputs.
   * Skips source code extensions and deduplicates against existing records.
   */
  private registerFileOutput(taskId: string, toolArgs: string): void {
    try {
      const args = JSON.parse(toolArgs);
      const filePath: string | undefined = args.file_path ?? args.path;
      if (!filePath || typeof filePath !== "string") return;

      const fileName = path.basename(filePath);
      const extension = path.extname(filePath).replace(".", "").toLowerCase();

      // Skip source code and config files
      const skipExtensions = new Set([
        "ts", "tsx", "js", "jsx", "css", "scss", "less",
        "py", "rb", "go", "rs", "java", "c", "cpp", "h",
        "sh", "bash", "zsh", "sql",
        "lock", "map", "tsbuildinfo", "env", "gitignore", "eslintrc", "prettierrc",
      ]);
      if (!extension || skipExtensions.has(extension)) return;

      const db = getDb();

      // Deduplicate: skip if already tracked for this task
      const existing = db.prepare(
        "SELECT id FROM task_outputs WHERE taskId = ? AND filePath = ? LIMIT 1"
      ).get(taskId, filePath) as { id: string } | undefined;
      if (existing) return;

      // Get file size if the file exists on disk
      let sizeBytes: number | null = null;
      try {
        sizeBytes = fs.statSync(filePath).size;
      } catch {
        // File may not exist yet (Edit on a new path, or write hasn't flushed)
      }

      const config = getConfig();
      const relativePath = path.relative(config.aiOsDir, filePath);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      db.prepare(
        "INSERT INTO task_outputs (id, taskId, fileName, filePath, relativePath, extension, sizeBytes, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(id, taskId, fileName, filePath, relativePath, extension, sizeBytes, now);

      // Emit event so the UI updates the FILES tab in real time
      const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task | undefined;
      if (task) {
        emitTaskEvent({ type: "task:output", task: this.normalizeTask(task), timestamp: now });
      }
    } catch {
      // Non-critical — don't break log entry processing
    }
  }

  /**
   * Build a plain-English completion summary for the user.
   * Reads the last text log entries and output files to describe
   * what happened in business terms, not technical terms.
   */
  private buildCompletionSummary(taskId: string, db: ReturnType<typeof getDb>): string {
    // 1. Check for output files
    const outputs = db.prepare(
      "SELECT fileName FROM task_outputs WHERE taskId = ? ORDER BY createdAt DESC LIMIT 5"
    ).all(taskId) as Array<{ fileName: string }>;

    // 2. Get the last few text log entries (Claude's actual output)
    const logs = db.prepare(
      `SELECT content FROM task_logs
       WHERE taskId = ? AND type = 'text' AND length(content) > 20
       ORDER BY timestamp DESC LIMIT 4`
    ).all(taskId) as Array<{ content: string }>;

    // 3. Find the best summary line from Claude's output
    //    Look for lines that describe outcomes, not technical actions
    let bestLine: string | null = null;
    for (const log of logs) {
      const cleaned = log.content
        .replace(/```[\s\S]*?```/g, "")
        .replace(/\[SILENT\]/gi, "")
        .replace(/`[^`]+`/g, "")
        .replace(/[#*_~]/g, "")
        .trim();

      if (!cleaned || cleaned.length < 10) continue;

      // Split into lines and find the best one
      const lines = cleaned.split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 15)
        // Skip lines that are just file paths or technical actions
        .filter((l) => !/^(Saved|Wrote|Created|Updated|Reading|Writing|Running|Executed|Report saved)\s+(to|from|at|in)\s+/i.test(l))
        .filter((l) => !l.match(/^[-*]\s*(\/|projects\/|src\/)/))
        .filter((l) => !/^Working directory/i.test(l))
        .filter((l) => !/^Co-Authored-By/i.test(l));

      // Prefer lines that sound like summaries
      const summaryLine = lines.find((l) =>
        /^(no |all |found |there |nothing |everything |completed |checked |reviewed |analysed |analyzed |updated |the |your |this |here|we )/i.test(l)
      ) || lines.find((l) =>
        /\b(available|complete|ready|done|success|found|checked|reviewed|no issues|no changes|up to date)\b/i.test(l)
      ) || lines[0];

      if (summaryLine) {
        bestLine = summaryLine;
        break;
      }
    }

    // 4. Build the final label
    if (bestLine) {
      // Clean up and truncate
      let label = bestLine
        .replace(/(?:\/[\w.-]+){2,}/g, "")          // remove file paths
        .replace(/[\w.-]+\/[\w.-]+\/[\w.-]+/g, "")   // remove relative paths
        .replace(/\b\w+\.(md|json|ts|tsx|js|py|sh)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();

      // Remove leading bullets/dashes
      label = label.replace(/^[-*•]\s*/, "");

      if (label.length > 5) {
        // Capitalise first letter
        label = label.charAt(0).toUpperCase() + label.slice(1);
        return label.length > 120 ? label.slice(0, 117) + "..." : label;
      }
    }

    // 5. Fallback: describe outputs
    if (outputs.length > 0) {
      const count = outputs.length;
      return count === 1
        ? `Produced 1 file`
        : `Produced ${count} files`;
    }

    return "Completed";
  }

  /** Finalize the currently running cron row, if one exists for this task. */
  private recordCronRun(
    task: Task,
    costUsd: number,
    durationMs: number,
    overrides: {
      result?: "success" | "failure" | "timeout";
      exitCode?: number;
      completionReason?: string;
    } = {},
  ): void {
    if (!task.cronJobSlug) return;

    const db = getDb();
    const runningRow = db
      .prepare("SELECT id FROM cron_runs WHERE taskId = ? AND result = 'running' LIMIT 1")
      .get(task.id) as { id: number } | undefined;

    if (!runningRow) {
      return;
    }

    completeCronRunForTask(task, {
      costUsd,
      durationMs,
      result: overrides.result ?? (task.errorMessage ? "failure" : "success"),
      exitCode: overrides.exitCode ?? (task.errorMessage ? 1 : 0),
      completedAt: new Date().toISOString(),
      ...(overrides.completionReason ? { completionReason: overrides.completionReason } : {}),
    });
  }

  private handleSpawnError(taskId: string, err: unknown): void {
    const message = err instanceof Error ? err.message : "Unknown spawn error";
    this.handleTaskError(
      taskId,
      this.formatClaudeRuntimeError(taskId, `Failed to start Claude CLI: ${message}`, "startup"),
    );
  }

  private formatClaudeRuntimeError(
    taskId: string,
    detail: string,
    phase: "startup" | "turn",
  ): string {
    const sessionMode = this.sessions.get(this.taskKey(taskId))?.appliedPermissionMode;
    const storedMode = (() => {
      try {
        return (getDb().prepare("SELECT permissionMode FROM tasks WHERE id = ?").get(taskId) as
          | { permissionMode: string | null }
          | undefined)?.permissionMode;
      } catch {
        return null;
      }
    })();
    if ((sessionMode ?? storedMode) !== "auto") return detail;

    return phase === "startup"
      ? `Auto could not start with this Claude setup. Check your Claude account, provider, selected model, and organization settings. Claude Code: ${detail}`
      : `Auto's safety check could not complete. Retry the task or switch to Ask. Claude Code: ${detail}`;
  }

  normalizeTask(
    row: Omit<Task, "workScope"> & { workScope?: string | StoredWorkScopeV1 | null },
  ): Task {
    return {
      ...normalizeWorkScopedRow(row),
      needsInput: Boolean(row.needsInput),
    } as Task;
  }
}

/**
 * Thin wrapper around ClaudeOutputParser that routes callbacks
 * to the ProcessManager's methods (which are now turn-aware).
 */
/**
 * Turn-aware wrapper around ClaudeOutputParser.
 *
 * Key behaviour: only the LAST assistant text block determines whether the task
 * needs user input. If Claude asks a question in the middle of its work but then
 * continues with more output, the intermediate question does NOT block completion.
 *
 * How it works:
 * - `lastTextWasQuestion` resets to false on every new assistant text block
 * - When a question IS detected, it's set to true (and UI is updated immediately)
 * - At completion time, `session.pendingQuestion` is set from `lastTextWasQuestion`
 * - So only the very last text determines the outcome
 */
class ClauseOutputParserWithTurnAwareness {
  private parser: ClaudeOutputParser;
  /** Tracks whether the most recent assistant text block contained a question */
  private lastTextWasQuestion = false;
  /** Set when Claude used AskUserQuestion this turn; later text doesn't clear it */
  private askedThroughTool = false;

  constructor(
    private taskId: string,
    private session: SessionEntry,
    private pm: ProcessManager,
  ) {
    this.parser = new ClaudeOutputParser({
      onProgress: (data) => {
        // New assistant text arriving — reset question flag (will be re-set by onQuestion if this text IS a question)
        if (data.activityLabel) {
          this.lastTextWasQuestion = false;
        }
        pm.handleProgress(taskId, data);
      },
      onComplete: (data) => {
        // Commit the question state: true if the LAST text block was a question,
        // or if Claude asked through AskUserQuestion at any point this turn
        session.pendingQuestion = this.lastTextWasQuestion || this.askedThroughTool;
        console.log(`[process-manager] Turn complete for ${taskId.slice(0, 8)}: lastTextWasQuestion=${this.lastTextWasQuestion}, askedThroughTool=${this.askedThroughTool}`);
        pm.handleTurnComplete(taskId, data);
      },
      shouldProcessResultAfterCompletion: () => Boolean(
        session.deferredCompletion || session.workflowParentCompletionPending
      ),
      onError: (error) => pm.handleClaudeOutputError(taskId, error),
      onLogEntry: (entry) => pm.addLogEntry(taskId, entry),
      onQuestion: (questionText) => {
        this.lastTextWasQuestion = true;
        pm.handleQuestion(taskId, questionText);
      },
      onStructuredQuestion: (specs) => {
        this.lastTextWasQuestion = true;
        pm.handleStructuredQuestion(taskId, specs);
      },
      onToolQuestion: (specs) => {
        this.askedThroughTool = true;
        pm.handleStructuredQuestion(taskId, specs);
      },
      onUnansweredToolQuestion: (surfaced) => {
        this.askedThroughTool = true;
        if (!surfaced) pm.handleUnansweredToolQuestion(taskId);
      },
      onSession: (sessionId) => pm.storeClaudeSessionId(taskId, sessionId),
      onWorkflowLaunch: (data) => pm.handleWorkflowLaunch(taskId, data),
      onWorkflowTerminal: (data) => pm.handleWorkflowTerminal(taskId, data),
    });
  }

  feedLine(line: string): void {
    this.parser.feedLine(line);
  }

  get isCompleted(): boolean {
    return this.parser.isCompleted;
  }
}

// Singleton instance — use globalThis to survive Next.js HMR in dev mode
const globalForPM = globalThis as unknown as { __processManager?: ProcessManager };
export const processManager = globalForPM.__processManager ?? new ProcessManager();
if (process.env.NODE_ENV !== "production") {
  globalForPM.__processManager = processManager;
}

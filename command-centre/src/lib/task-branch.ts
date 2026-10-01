import type Database from "better-sqlite3";
import crypto from "crypto";
import type { LogEntry, Task } from "@/types/task";
import { isParentContainerRun } from "./task-run-state";
import { inheritWorkScope, normalizeWorkScopedRow } from "./identity/work-scope";

export class TaskBranchError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "TaskBranchError";
    this.status = status;
  }
}

type TaskLogCopyRow = {
  rowid: number;
  id: string;
  type: LogEntry["type"];
  timestamp: string;
  content: string;
  toolName: string | null;
  toolArgs: string | null;
  toolResult: string | null;
  toolUseId: string | null;
  parentToolUseId: string | null;
  isCollapsed: number | null;
  questionSpec: string | null;
  questionAnswers: string | null;
  permissionMode: string | null;
};

export type CreateTaskBranchResult = {
  task: Task;
  copiedLogCount: number;
};

export function isTaskBranch(task: Pick<Task, "forkedFromTaskId" | "forkedFromLogId">): boolean {
  return Boolean(task.forkedFromTaskId && task.forkedFromLogId);
}

function normalizeBranchTask(row: Task & { workScope?: string | null }): Task {
  return {
    ...normalizeWorkScopedRow(row),
    needsInput: Boolean(row.needsInput),
  };
}

function createBranchTitle(title: string): string {
  const base = title.trim() || "Untitled task";
  return base.length > 120 ? base.slice(0, 120).trimEnd() : base;
}

function getLineageRootTaskId(db: Database.Database, task: Omit<Task, "workScope">): string {
  let currentId = task.id;
  let forkedFromTaskId = task.forkedFromTaskId ?? null;
  const seen = new Set<string>();

  while (forkedFromTaskId && !seen.has(currentId)) {
    seen.add(currentId);
    const parent = db
      .prepare("SELECT id, forkedFromTaskId FROM tasks WHERE id = ?")
      .get(forkedFromTaskId) as Pick<Task, "id" | "forkedFromTaskId"> | undefined;
    if (!parent) {
      return forkedFromTaskId;
    }
    currentId = parent.id;
    forkedFromTaskId = parent.forkedFromTaskId ?? null;
  }

  return currentId;
}

function countLineageChildren(db: Database.Database, task: Omit<Task, "workScope">): number {
  const rootId = getLineageRootTaskId(db, task);
  const parentIds = Array.from(new Set([task.id, rootId]));
  const placeholders = parentIds.map(() => "?").join(", ");
  const row = db
    .prepare(`SELECT COUNT(*) as count FROM tasks WHERE parentId IN (${placeholders})`)
    .get(...parentIds) as { count: number } | undefined;
  return row?.count ?? 0;
}

function shouldBlockEditForRunState(db: Database.Database, task: Omit<Task, "workScope">): boolean {
  if (task.status === "queued") {
    return true;
  }
  if (task.status !== "running") {
    return false;
  }

  return !isParentContainerRun({
    status: task.status,
    parentId: task.parentId,
    childCount: countLineageChildren(db, task),
    claudePid: task.claudePid ?? null,
    activityLabel: task.activityLabel ?? null,
  });
}

export function createTaskBranch(
  db: Database.Database,
  sourceTaskId: string,
  fromLogId: string,
  editedContent: string,
): CreateTaskBranchResult {
  const trimmedContent = editedContent.trim();
  if (!fromLogId || typeof fromLogId !== "string") {
    throw new TaskBranchError(400, "fromLogId is required");
  }
  if (!trimmedContent) {
    throw new TaskBranchError(400, "editedContent is required");
  }

  const create = (): CreateTaskBranchResult => {
    const sourceTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(sourceTaskId) as
      | (Omit<Task, "workScope"> & { workScope: string | null })
      | undefined;
    if (!sourceTask) {
      throw new TaskBranchError(404, "Task not found");
    }
    if (shouldBlockEditForRunState(db, sourceTask)) {
      throw new TaskBranchError(409, "Stop this task before editing this message");
    }
    const inherited = inheritWorkScope(sourceTask);

    const sourceLog = db
      .prepare("SELECT rowid, * FROM task_logs WHERE taskId = ? AND id = ?")
      .get(sourceTaskId, fromLogId) as TaskLogCopyRow | undefined;
    if (!sourceLog) {
      throw new TaskBranchError(404, "Message not found");
    }
    if (sourceLog.type !== "user_reply") {
      throw new TaskBranchError(400, "Only user messages can be edited in v1");
    }

    const sourceLogs = db
      .prepare(
        `SELECT rowid, id, type, timestamp, content, toolName, toolArgs, toolResult,
                toolUseId, parentToolUseId, isCollapsed, questionSpec, questionAnswers, permissionMode
         FROM task_logs
         WHERE taskId = ? AND rowid <= ?
         ORDER BY rowid ASC`,
      )
      .all(sourceTaskId, sourceLog.rowid) as TaskLogCopyRow[];

    const now = new Date().toISOString();
    const branchId = crypto.randomUUID();

    db.prepare(
      `INSERT INTO tasks (
        id, title, description, status, level, parentId, projectSlug, columnOrder,
        createdAt, updatedAt, costUsd, tokensUsed, durationMs, activityLabel,
        errorMessage, startedAt, completedAt, clientId, needsInput, phaseNumber,
        gsdStep, contextSources, cronJobSlug, claudeSessionId, claudePid,
        permissionMode, executionPermissionMode, model, thinkingEffort, lastReplyAt,
        conversationId, originMessageId, teamId, coordinationLevel, goalGroup, tag,
        pinnedAt, dependsOnTaskIds, startSnapshot, forkedFromTaskId, forkedFromLogId,
        forkedFromClaudeSessionId, workScope
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      branchId,
      createBranchTitle(sourceTask.title),
      sourceTask.description ?? null,
      "queued",
      sourceTask.level,
      sourceTask.parentId ?? null,
      sourceTask.projectSlug ?? null,
      sourceTask.columnOrder ?? 0,
      now,
      now,
      null,
      null,
      null,
      "Edited message queued",
      null,
      null,
      null,
      sourceTask.clientId ?? null,
      0,
      sourceTask.phaseNumber ?? null,
      sourceTask.gsdStep ?? null,
      null,
      null,
      null,
      null,
      sourceTask.permissionMode ?? "bypassPermissions",
      sourceTask.executionPermissionMode ?? sourceTask.permissionMode ?? "bypassPermissions",
      sourceTask.model ?? null,
      sourceTask.thinkingEffort ?? null,
      null,
      null,
      null,
      sourceTask.teamId ?? null,
      sourceTask.coordinationLevel ?? null,
      sourceTask.goalGroup ?? null,
      sourceTask.tag ?? null,
      sourceTask.pinnedAt ?? null,
      null,
      null,
      sourceTask.id,
      sourceLog.id,
      sourceTask.claudeSessionId ?? null,
      inherited.serialized,
    );

    const insertLog = db.prepare(
      `INSERT INTO task_logs (
        id, taskId, type, timestamp, content, toolName, toolArgs, toolResult,
        toolUseId, parentToolUseId, isCollapsed, questionSpec, questionAnswers,
        permissionMode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const row of sourceLogs) {
      insertLog.run(
        crypto.randomUUID(),
        branchId,
        row.type,
        row.timestamp,
        row.id === sourceLog.id ? trimmedContent : row.content,
        row.toolName,
        row.toolArgs,
        row.toolResult,
        row.toolUseId,
        row.parentToolUseId,
        row.isCollapsed ? 1 : 0,
        row.questionSpec,
        row.questionAnswers,
        row.permissionMode,
      );
    }

    const branchTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(branchId) as Task & { workScope: string | null };
    return {
      task: normalizeBranchTask(branchTask),
      copiedLogCount: sourceLogs.length,
    };
  };

  const maybeTransaction = db.transaction?.(create);
  return maybeTransaction ? maybeTransaction() : create();
}

function cleanPromptContent(value: string | null | undefined, maxLength = 6000): string {
  const text = String(value ?? "").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength).trimEnd()}\n[truncated]`;
}

function formatLogForBranchPrompt(entry: LogEntry): string | null {
  if (entry.type === "user_reply") {
    return `User:\n${cleanPromptContent(entry.content)}`;
  }
  if (entry.type === "text" || entry.type === "question" || entry.type === "structured_question") {
    return `Assistant:\n${cleanPromptContent(entry.content)}`;
  }
  if (entry.type === "system") {
    return `System note:\n${cleanPromptContent(entry.content, 2000)}`;
  }
  if (entry.type === "tool_use") {
    const toolName = entry.toolName ? ` ${entry.toolName}` : "";
    const args = cleanPromptContent(entry.toolArgs ?? entry.content, 3000);
    return `Tool use${toolName}:\n${args}`;
  }
  if (entry.type === "tool_result") {
    const result = cleanPromptContent(entry.toolResult ?? entry.content, 3000);
    return result ? `Tool result:\n${result}` : null;
  }
  return null;
}

export function buildTaskBranchPrompt(task: Task, logEntries: LogEntry[]): string {
  const transcript = logEntries
    .map(formatLogForBranchPrompt)
    .filter((item): item is string => Boolean(item))
    .join("\n\n---\n\n");
  const fallbackGoal = task.description?.trim() || task.title;

  return [
    "You are continuing an AI-OS chat after an edited user message.",
    "This is a fresh Claude session. Only the history below should be treated as conversation context.",
    "Do not assume any messages after the final user message happened.",
    "",
    transcript ? `Conversation history:\n\n${transcript}` : `User:\n${fallbackGoal}`,
    "",
    "Continue from the final user message now.",
  ].join("\n");
}

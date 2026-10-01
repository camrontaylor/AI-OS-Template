import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { processManager } from "@/lib/process-manager";
import { getDb } from "@/lib/db";
import { getClientAiOsDir } from "@/lib/config";
import { emitTaskEvent } from "@/lib/event-bus";
import type { Task, LogEntry } from "@/types/task";
import type { Message } from "@/types/chat";
import { buildCronTaskLogEntries, mergeTaskLogsWithConversation, type CronRunLog } from "@/lib/task-logs";
import {
  isWorkScopeError,
  readWorkScopeFromRow,
  workScopeErrorBody,
} from "@/lib/identity/work-scope";
import { isMaterializedPathAccessible } from "@/lib/materialized-file-ownership";
import { isTaskArchived } from "@/lib/task-archive";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;

  if (!task) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }
  try {
    readWorkScopeFromRow(task);
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    throw error;
  }

  // First try direct logs for this task
  let entries = processManager.getLogEntries(id);

  // If no logs and this is a parent/container task, aggregate child task logs
  if (entries.length === 0) {
    const childCount = db.prepare(
      "SELECT COUNT(*) as count FROM tasks WHERE parentId = ?"
    ).get(id) as { count: number };

    if (childCount.count > 0) {
      // Fetch logs from all child tasks, ordered by timestamp
      const childLogs = db.prepare(
        `SELECT tl.id, tl.type, tl.timestamp, tl.content, tl.toolName, tl.toolArgs,
                tl.toolResult, tl.toolUseId, tl.parentToolUseId, tl.isCollapsed, tl.questionSpec, tl.questionAnswers,
                t.title as taskTitle, t.phaseNumber, t.gsdStep
         FROM task_logs tl
         JOIN tasks t ON tl.taskId = t.id
         WHERE t.parentId = ?
         ORDER BY tl.timestamp ASC`
      ).all(id) as Array<{
        id: string; type: string; timestamp: string; content: string;
        toolName: string | null; toolArgs: string | null; toolResult: string | null;
        toolUseId: string | null; parentToolUseId: string | null;
        isCollapsed: number;
        questionSpec: string | null; questionAnswers: string | null;
        taskTitle: string; phaseNumber: number | null; gsdStep: string | null;
      }>;

      // Group by child task and insert header entries so the user knows
      // which subtask each block of logs came from
      let lastTaskTitle = "";
      entries = [];
      for (const row of childLogs) {
        // Insert a divider when switching between child tasks
        if (row.taskTitle !== lastTaskTitle) {
          lastTaskTitle = row.taskTitle;
          const label = row.phaseNumber != null
            ? `Phase ${row.phaseNumber}${row.gsdStep ? ` (${row.gsdStep})` : ""}: ${row.taskTitle}`
            : row.taskTitle;
          entries.push({
            id: `header-${row.id}`,
            type: "text" as LogEntry["type"],
            timestamp: row.timestamp,
            content: `--- ${label} ---`,
          });
        }

        entries.push({
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
        });
      }
    }
  }

  if (task.conversationId) {
    const messageRows = db.prepare(
      "SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt ASC"
    ).all(task.conversationId) as Array<{
      id: string;
      conversationId: string;
      taskId: string | null;
      role: Message["role"];
      content: string;
      metadata: string | null;
      parentMessageId: string | null;
      createdAt: string;
    }>;

    const conversationMessages: Message[] = messageRows.map((row) => ({
      id: row.id,
      conversationId: row.conversationId,
      taskId: row.taskId,
      role: row.role,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      parentMessageId: row.parentMessageId,
      createdAt: row.createdAt,
    }));

    entries = mergeTaskLogsWithConversation(entries, conversationMessages, {
      originMessageId: task.originMessageId,
    });
  }

  if (entries.length === 0 && task.cronJobSlug) {
    const cronWorkspace = getClientAiOsDir(task.clientId ?? null);
    const logFilePath = path.join(
      cronWorkspace,
      "cron",
      "logs",
      `${task.cronJobSlug}.log`
    );
    const jobFilePath = path.join(cronWorkspace, "cron", "jobs", `${task.cronJobSlug}.md`);

    let cronLogContent = "";
    try {
      if (isMaterializedPathAccessible(jobFilePath)) {
        cronLogContent = fs.readFileSync(logFilePath, "utf-8");
      }
    } catch {
      cronLogContent = "";
    }

    if (cronLogContent.length > 0) {
      const currentRun = db.prepare(
        `SELECT id, jobSlug, taskId, startedAt, completedAt, result, trigger, clientId, scheduledFor
         FROM cron_runs
         WHERE taskId = ?
         ORDER BY id DESC
         LIMIT 1`
      ).get(task.id) as CronRunLog | undefined;

      if (currentRun) {
        const jobRuns = db.prepare(
          `SELECT id, jobSlug, taskId, startedAt, completedAt, result, trigger, clientId, scheduledFor
           FROM cron_runs
           WHERE jobSlug = ?
             AND COALESCE(clientId, '') = COALESCE(?, '')
           ORDER BY startedAt ASC, id ASC`
        ).all(task.cronJobSlug, task.clientId ?? null) as CronRunLog[];

        entries = buildCronTaskLogEntries(
          cronLogContent,
          currentRun,
          jobRuns,
          task.id
        );
      }
    }
  }

  return NextResponse.json(entries);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();

    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    readWorkScopeFromRow(task);
    if (isTaskArchived(db, id)) {
      return NextResponse.json({ error: "Restore this Goal before adding activity." }, { status: 409 });
    }

    const body = await request.json();
    const { type, content, toolName, toolArgs, toolResult, toolUseId, parentToolUseId, questionSpec, questionAnswers } = body as {
      type: string;
      content: string;
      toolName?: string;
      toolArgs?: string;
      toolResult?: string;
      toolUseId?: string;
      parentToolUseId?: string;
      questionSpec?: string;
      questionAnswers?: string;
    };

    if (!type || !content) {
      return NextResponse.json({ error: "type and content are required" }, { status: 400 });
    }

    const entry: LogEntry = {
      id: crypto.randomUUID(),
      type: type as LogEntry["type"],
      timestamp: new Date().toISOString(),
      content,
      ...(toolName ? { toolName } : {}),
      ...(toolArgs ? { toolArgs } : {}),
      ...(toolResult ? { toolResult } : {}),
      ...(toolUseId ? { toolUseId } : {}),
      ...(parentToolUseId ? { parentToolUseId } : {}),
      ...(questionSpec ? { questionSpec } : {}),
      ...(questionAnswers ? { questionAnswers } : {}),
    };

    db.prepare(
      "INSERT INTO task_logs (id, taskId, type, timestamp, content, toolName, toolArgs, toolResult, toolUseId, parentToolUseId, isCollapsed, questionSpec, questionAnswers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(entry.id, id, entry.type, entry.timestamp, entry.content, toolName ?? null, toolArgs ?? null, toolResult ?? null, toolUseId ?? null, parentToolUseId ?? null, 0, questionSpec ?? null, questionAnswers ?? null);

    emitTaskEvent({
      type: "task:log",
      task: { ...task, needsInput: Boolean(task.needsInput) },
      timestamp: entry.timestamp,
      logEntry: entry,
    });

    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    console.error("POST /api/tasks/[id]/logs error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { emitTaskEvent } from "@/lib/event-bus";
import { cleanupChatAttachmentStorage, copyChatAttachmentsToSent, deleteSourceDraftAttachments } from "@/lib/chat-attachment-service";
import { composeMessageWithAttachments } from "@/lib/chat-message-content";
import { saveApprovedPlanToBrief } from "@/lib/plan-brief.server";
import { getActivePermissionMode, getExecutionPermissionMode, VALID_PERMISSION_MODES } from "@/lib/permission-mode";
import { processManager } from "@/lib/process-manager";
import {
  isNullableClaudeThinkingEffort,
  normalizeClaudeThinkingEffortForModel,
  VALID_CLAUDE_MODELS,
} from "@/lib/claude-options";
import type { ChatAttachment } from "@/types/chat-composer";
import type { Task, PermissionMode, ClaudeModel, ClaudeThinkingEffort } from "@/types/task";
import {
  parseQuestionSpecs,
  serializeAnswersToProse,
  type QuestionSpec,
  type QuestionAnswers,
} from "@/types/question-spec";

function normalizeAttachments(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ChatAttachment => {
    return Boolean(
      item &&
      typeof item === "object" &&
      typeof (item as ChatAttachment).id === "string" &&
      typeof (item as ChatAttachment).relativePath === "string" &&
      typeof (item as ChatAttachment).fileName === "string",
    );
  });
}

function getStructuredAnswerText(
  questions: QuestionSpec[],
  answers: QuestionAnswers,
  message: string | null,
): string {
  const structured = serializeAnswersToProse(questions, answers);
  if (message && message.trim().length > 0) {
    return `${structured}\n\nAdditional note:\n${message.trim()}`;
  }
  return structured;
}

function getPlanApprovalAction(
  questions: QuestionSpec[],
  answers: QuestionAnswers,
): string | null {
  const actionQuestion = questions.find((q) => q.intent === "plan_approval" || q.id === "plan_action");
  if (!actionQuestion) return null;
  const raw = answers[actionQuestion.id];
  return typeof raw === "string" ? raw.trim() : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: {
    message?: string;
    attachments?: ChatAttachment[];
    structuredAnswers?: QuestionAnswers;
    permissionMode?: PermissionMode;
    executionPermissionMode?: PermissionMode | null;
    model?: ClaudeModel | null;
    thinkingEffort?: ClaudeThinkingEffort | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { message, attachments: attachmentPayload, structuredAnswers, permissionMode, executionPermissionMode, model, thinkingEffort } = body;

  if ("thinkingEffort" in body && !isNullableClaudeThinkingEffort(thinkingEffort)) {
    return NextResponse.json(
      { error: 'thinkingEffort must be "auto", "low", "medium", "high", "xhigh", "max", or null' },
      { status: 400 }
    );
  }
  if ("model" in body && model !== null && model !== undefined && !VALID_CLAUDE_MODELS.includes(model)) {
    return NextResponse.json(
      { error: 'model must be "opus", "sonnet", "haiku", or null' },
      { status: 400 }
    );
  }

  const db = getDb();
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // If structured answers were provided, find the most recent unanswered
  // structured_question log entry and serialise its spec + the answers into
  // a prose message for the Claude continuation.
  const userMessage =
    typeof message === "string" && message.trim().length > 0 ? message.trim() : null;
  const incomingAttachments = normalizeAttachments(attachmentPayload);
  let resolvedMessage: string | null = userMessage;
  let answeredLogId: string | null = null;
  let pendingQuestions: QuestionSpec[] = [];
  let planApprovalAction: string | null = null;

  if (structuredAnswers && typeof structuredAnswers === "object") {
    const pending = db
      .prepare(
        `SELECT id, questionSpec FROM task_logs
         WHERE taskId = ? AND type = 'structured_question' AND (questionAnswers IS NULL OR questionAnswers = '')
         ORDER BY rowid DESC LIMIT 1`
      )
      .get(id) as { id: string; questionSpec: string | null } | undefined;

    if (pending?.questionSpec) {
      try {
        const spec = parseQuestionSpecs(JSON.parse(pending.questionSpec));
        pendingQuestions = spec;
        if (spec.length > 0) {
          resolvedMessage = getStructuredAnswerText(spec, structuredAnswers, userMessage);
          answeredLogId = pending.id;
          planApprovalAction = getPlanApprovalAction(spec, structuredAnswers);
        }
      } catch (err) {
        console.error("[reply-route] Failed to parse pending questionSpec:", err);
      }
    }
  }

  const needsInput = Boolean(task.needsInput);
  const isResuming = task.status === "review" || task.status === "done";
  const isRunning = task.status === "running";

  console.log(`[reply-route] POST /reply for ${id.slice(0, 8)}: needsInput=${needsInput}, status=${task.status}, isResuming=${isResuming}`);

  // Allow reply if: task needs input, OR task is in review/done (follow-up), OR running with pending question
  if (!needsInput && !isResuming && !isRunning) {
    return NextResponse.json(
      { error: "Task cannot receive messages in its current state" },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();
  const entryId = crypto.randomUUID();
  const attachments = incomingAttachments.length > 0
    ? copyChatAttachmentsToSent({
        surface: "task",
        scopeId: id,
        referenceId: entryId,
        attachments: incomingAttachments,
      })
    : [];
  const trimmed = composeMessageWithAttachments(resolvedMessage ?? "", attachments).trim();

  if (!trimmed) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  // If this reply answers a structured_question entry, store the answers on it
  if (answeredLogId && structuredAnswers) {
    db.prepare(
      "UPDATE task_logs SET questionAnswers = ? WHERE id = ?"
    ).run(JSON.stringify(structuredAnswers), answeredLogId);
  }

  // Persist user reply as log entry — include the permission mode chosen at reply time
  const normalizedReplyPermission = permissionMode && VALID_PERMISSION_MODES.includes(permissionMode)
    ? getActivePermissionMode(permissionMode, task.permissionMode || "bypassPermissions")
    : null;
  const replyPermMode = normalizedReplyPermission ?? (task.permissionMode || null);
  db.prepare(
    "INSERT INTO task_logs (id, taskId, type, timestamp, content, toolName, toolArgs, toolResult, isCollapsed, questionSpec, questionAnswers, permissionMode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(entryId, id, "user_reply", now, trimmed, null, null, null, 0, null, null, replyPermMode);

  // Title is set once at creation (via AI generation or fallback).
  // User replies are follow-ups, not new goals — don't overwrite the title.

  // Persist permission settings, model, and thinking effort on the task BEFORE spawning so the next
  // turn picks them up. In plan mode, picker changes stage the execution mode.
  if (normalizedReplyPermission) {
    const activeMode = getActivePermissionMode(
      normalizedReplyPermission,
      task.permissionMode || "bypassPermissions",
    );
    const nextExecutionMode =
      activeMode === "plan"
        ? getExecutionPermissionMode(
            executionPermissionMode ?? task.executionPermissionMode ?? task.permissionMode,
            "bypassPermissions",
          )
        : activeMode;
    db.prepare("UPDATE tasks SET permissionMode = ?, executionPermissionMode = ? WHERE id = ?").run(
      activeMode,
      nextExecutionMode,
      id,
    );
  } else if (executionPermissionMode && VALID_PERMISSION_MODES.includes(executionPermissionMode)) {
    db.prepare("UPDATE tasks SET executionPermissionMode = ? WHERE id = ?").run(
      getExecutionPermissionMode(executionPermissionMode, "bypassPermissions"),
      id,
    );
  }
  if (model === null) {
    db.prepare("UPDATE tasks SET model = NULL WHERE id = ?").run(id);
  } else if (model && VALID_CLAUDE_MODELS.includes(model)) {
    db.prepare("UPDATE tasks SET model = ? WHERE id = ?").run(model, id);
  }
  if ("model" in body || "thinkingEffort" in body) {
    const nextModel = "model" in body ? model ?? null : task.model ?? null;
    const nextThinkingEffort = "thinkingEffort" in body
      ? thinkingEffort ?? null
      : task.thinkingEffort ?? null;
    const normalizedThinkingEffort = normalizeClaudeThinkingEffortForModel(nextModel, nextThinkingEffort);
    if (normalizedThinkingEffort === null) {
      db.prepare("UPDATE tasks SET thinkingEffort = NULL WHERE id = ?").run(id);
    } else {
      db.prepare("UPDATE tasks SET thinkingEffort = ? WHERE id = ?").run(normalizedThinkingEffort, id);
    }
  }

  if (planApprovalAction && pendingQuestions.length > 0) {
    if (planApprovalAction === "Approve and start") {
      const logEntries = db.prepare(
        `SELECT id, type, timestamp, content, toolName, toolArgs, toolResult, isCollapsed, questionSpec, questionAnswers, permissionMode
         FROM task_logs WHERE taskId = ? ORDER BY rowid ASC`
      ).all(id) as import("@/types/task").LogEntry[];
      const refreshedTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task;
      const briefPath = saveApprovedPlanToBrief(refreshedTask, logEntries);
      const executionMode = getActivePermissionMode(
        refreshedTask.executionPermissionMode ?? refreshedTask.permissionMode,
        "bypassPermissions",
      );

      if (briefPath) {
        db.prepare(
          "INSERT INTO task_logs (id, taskId, type, timestamp, content, toolName, toolArgs, toolResult, isCollapsed, questionSpec, questionAnswers, permissionMode) VALUES (?, ?, 'system', ?, ?, NULL, NULL, NULL, 0, NULL, NULL, ?)"
        ).run(
          crypto.randomUUID(),
          id,
          now,
          `Approved plan saved to ${briefPath}`,
          executionMode,
        );
      }

      db.prepare(
        "UPDATE tasks SET status = 'running', permissionMode = ?, executionPermissionMode = ?, updatedAt = ?, lastReplyAt = ?, activityLabel = ?, needsInput = 0, errorMessage = NULL, startedAt = COALESCE(startedAt, ?) WHERE id = ?"
      ).run(executionMode, executionMode, now, now, "Plan approved — starting execution", now, id);

      const updatedAfterApproval = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task;
      emitTaskEvent({
        type: "task:status",
        task: { ...updatedAfterApproval, needsInput: false },
        timestamp: now,
      });

      try {
        const success = await processManager.replyToTask(
          id,
          "Plan approved. Exit plan mode, use the approved brief.md as the source of truth, and execute now.",
        );
        if (!success) {
          await processManager.spawnContinueTurn(
            id,
            "Plan approved. Exit plan mode, use the approved brief.md as the source of truth, and execute now.",
            true,
          );
        }
      } catch (err) {
        console.error(`[reply-route] Plan approval resume failed:`, err);
      }

      deleteSourceDraftAttachments(incomingAttachments);
      cleanupChatAttachmentStorage({ surface: "task", scopeId: id });
      return NextResponse.json({ ok: true, action: "approved" });
    }

    if (planApprovalAction === "Cancel") {
      const executionMode = getExecutionPermissionMode(
        task.executionPermissionMode ?? task.permissionMode,
        "bypassPermissions",
      );
      db.prepare(
        "UPDATE tasks SET status = 'review', permissionMode = ?, executionPermissionMode = ?, updatedAt = ?, lastReplyAt = ?, activityLabel = ?, needsInput = 0 WHERE id = ?"
      ).run(executionMode, executionMode, now, now, "Plan canceled", id);
      const canceledTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task;
      emitTaskEvent({
        type: "task:status",
        task: { ...canceledTask, needsInput: false },
        timestamp: now,
      });
      deleteSourceDraftAttachments(incomingAttachments);
      cleanupChatAttachmentStorage({ surface: "task", scopeId: id });
      return NextResponse.json({ ok: true, action: "canceled" });
    }
  }

  // Reactivate the task to running (set startedAt if not already set, track lastReplyAt)
  db.prepare(
    "UPDATE tasks SET status = 'running', updatedAt = ?, lastReplyAt = ?, activityLabel = ?, needsInput = 0, errorMessage = NULL, startedAt = COALESCE(startedAt, ?) WHERE id = ?"
  ).run(now, now, "Processing reply...", now, id);

  const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task;
  emitTaskEvent({
    type: "task:status",
    task: { ...updated, needsInput: false },
    timestamp: now,
  });
  emitTaskEvent({
    type: "task:log",
    task: { ...updated, needsInput: false },
    timestamp: now,
    logEntry: {
      id: entryId,
      type: "user_reply",
      timestamp: now,
      content: trimmed,
      permissionMode: replyPermMode ?? undefined,
    },
  });

  // The picker on the reply input persists permissionMode + model + thinkingEffort on the
  // task itself, so spawnClaudeTurn just reads them from the DB. We always
  // spawn a fresh turn so picker changes are picked up immediately.
  try {
    const success = await processManager.replyToTask(id, trimmed);
    if (!success) {
      // In-memory state was stale — spawn resume turn directly
      console.log(`[reply-route] In-memory replyToTask returned false — spawning via DB path`);
      try {
        await processManager.spawnContinueTurn(id, trimmed, isResuming);
      } catch (err) {
        console.error(`[reply-route] Failed to spawn continue turn:`, err);
      }
    }
  } catch (err) {
    console.error(`[reply-route] Reply spawn failed:`, err);
  }

  deleteSourceDraftAttachments(incomingAttachments);
  cleanupChatAttachmentStorage({ surface: "task", scopeId: id });
  return NextResponse.json({ ok: true });
}

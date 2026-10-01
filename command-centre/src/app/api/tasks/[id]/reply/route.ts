import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { emitTaskEvent } from "@/lib/event-bus";
import { cleanupChatAttachmentStorage, copyChatAttachmentsToSent, deleteSourceDraftAttachments } from "@/lib/chat-attachment-service";
import { composeMessageWithAttachments } from "@/lib/chat-message-content";
import { saveApprovedPlanToBrief } from "@/lib/plan-brief.server";
import { RequestPrincipalError } from "@/lib/identity/request-principal";
import { requireSkillUseForRequest } from "@/lib/identity/skill-authorization";
import { getActivePermissionMode, getExecutionPermissionMode, VALID_PERMISSION_MODES } from "@/lib/permission-mode";
import { PermissionModeControlError, processManager } from "@/lib/process-manager";
import { getAutoModeUnavailability } from "@/lib/claude-capabilities.server";
import {
  isClaudeModel,
  isNullableClaudeThinkingEffort,
  normalizeClaudeModel,
  normalizeClaudeThinkingEffortForModel,
} from "@/lib/claude-options";
import type { ChatAttachment } from "@/types/chat-composer";
import type { Task, PermissionMode, ClaudeModel, ClaudeThinkingEffort } from "@/types/task";
import { isTaskArchived } from "@/lib/task-archive";
import { revokeTaskPermissionRules } from "@/lib/task-permission-rules";
import {
  isWorkScopeError,
  readWorkScopeFromRow,
  requestWithWorkScope,
  workScopeErrorBody,
} from "@/lib/identity/work-scope";
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
  const trimmedMessage = message?.trim();
  if (trimmedMessage) {
    const normalizedStructured = structured.replace(/\r\n/g, "\n").trim();
    const normalizedMessage = trimmedMessage.replace(/\r\n/g, "\n");
    if (normalizedMessage === normalizedStructured) {
      return structured;
    }
    return `${structured}\n\nAdditional note:\n${trimmedMessage}`;
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

function permissionModeErrorResponse(error: unknown): NextResponse {
  const controlError = error instanceof PermissionModeControlError ? error : null;
  return NextResponse.json(
    {
      code: "permission_mode_change_failed",
      error: controlError?.message ?? "The permission mode could not be changed.",
    },
    { status: controlError?.status ?? 500 },
  );
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
  if ("model" in body && model !== null && model !== undefined && !isClaudeModel(model)) {
    return NextResponse.json(
      { error: "model must be a Claude model alias or model ID without spaces, or null" },
      { status: 400 }
    );
  }

  const db = getDb();
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
    | (Omit<Task, "workScope"> & { workScope: string | null })
    | undefined;

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  let workScope: Task["workScope"];
  try {
    workScope = readWorkScopeFromRow(task);
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    throw error;
  }
  if (isTaskArchived(db, id)) {
    return NextResponse.json({ error: "Restore this Goal to continue the chat." }, { status: 409 });
  }

  const normalizedReplyPermission = permissionMode && VALID_PERMISSION_MODES.includes(permissionMode)
    ? getActivePermissionMode(permissionMode, task.permissionMode || "bypassPermissions")
    : null;
  const nextPermissionMode = normalizedReplyPermission
    ?? getActivePermissionMode(task.permissionMode, "bypassPermissions");
  const nextExecutionMode = normalizedReplyPermission
    ? nextPermissionMode === "plan"
      ? getExecutionPermissionMode(
          executionPermissionMode ?? task.executionPermissionMode ?? task.permissionMode,
          "bypassPermissions",
        )
      : nextPermissionMode
    : executionPermissionMode && VALID_PERMISSION_MODES.includes(executionPermissionMode)
      ? getExecutionPermissionMode(executionPermissionMode, "bypassPermissions")
      : getExecutionPermissionMode(
          task.executionPermissionMode ?? task.permissionMode,
          "bypassPermissions",
        );
  const nextModel = "model" in body ? normalizeClaudeModel(model) : normalizeClaudeModel(task.model);
  const autoModeUnavailable = await getAutoModeUnavailability({
    permissionMode: nextPermissionMode,
    executionPermissionMode: nextExecutionMode,
    model: nextModel,
  });
  if (autoModeUnavailable) {
    return NextResponse.json(autoModeUnavailable, { status: 409 });
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
  const canStartBacklogChild = task.status === "backlog" && task.parentId != null;

  console.log(`[reply-route] POST /reply for ${id.slice(0, 8)}: needsInput=${needsInput}, status=${task.status}, isResuming=${isResuming}`);

  // Allow reply if: task needs input, task is in review/done (follow-up),
  // task is running with a pending question, or this is the first message for
  // an unstarted child subtask chat.
  if (!needsInput && !isResuming && !isRunning && !canStartBacklogChild) {
    return NextResponse.json(
      { error: "Task cannot receive messages in its current state" },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();
  if (task.cancelRequestedAt) {
    db.prepare("UPDATE tasks SET cancelRequestedAt = NULL WHERE id = ?").run(id);
    revokeTaskPermissionRules(id, db);
  }
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

  try {
    await requireSkillUseForRequest(requestWithWorkScope(request, workScope), trimmed);
  } catch (error) {
    if (error instanceof RequestPrincipalError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  if (normalizedReplyPermission || (executionPermissionMode && VALID_PERMISSION_MODES.includes(executionPermissionMode))) {
    try {
      await processManager.applyPermissionState(id, {
        permissionMode: nextPermissionMode,
        executionPermissionMode: nextExecutionMode,
      });
    } catch (error) {
      return permissionModeErrorResponse(error);
    }
  }

  // If this reply answers a structured_question entry, store the answers on it
  if (answeredLogId && structuredAnswers) {
    db.prepare(
      "UPDATE task_logs SET questionAnswers = ? WHERE id = ?"
    ).run(JSON.stringify(structuredAnswers), answeredLogId);
  }

  // Persist user reply as log entry — include the permission mode chosen at reply time
  const replyPermMode = nextPermissionMode;
  if (!canStartBacklogChild) {
    db.prepare(
      "INSERT INTO task_logs (id, taskId, type, timestamp, content, toolName, toolArgs, toolResult, isCollapsed, questionSpec, questionAnswers, permissionMode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(entryId, id, "user_reply", now, trimmed, null, null, null, 0, null, null, replyPermMode);
  }

  // Title is set once at creation (via AI generation or fallback).
  // User replies are follow-ups, not new goals — don't overwrite the title.

  const normalizedModel = normalizeClaudeModel(model);
  if (model === null) {
    db.prepare("UPDATE tasks SET model = NULL WHERE id = ?").run(id);
  } else if (normalizedModel) {
    db.prepare("UPDATE tasks SET model = ? WHERE id = ?").run(normalizedModel, id);
  }
  if ("model" in body || "thinkingEffort" in body) {
    const nextModel = "model" in body ? normalizedModel : normalizeClaudeModel(task.model);
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

  if (canStartBacklogChild) {
    try {
      const started = await processManager.startBacklogTaskFromReply(id, trimmed, {
        logEntryId: entryId,
        permissionMode: replyPermMode ?? undefined,
      });
      if (!started) {
        return NextResponse.json(
          { error: "Task cannot receive messages in its current state" },
          { status: 409 }
        );
      }
    } catch (err) {
      console.error(`[reply-route] Backlog child start failed:`, err);
      return NextResponse.json(
        { error: "Failed to start subtask from reply" },
        { status: 500 }
      );
    }

    deleteSourceDraftAttachments(incomingAttachments);
    cleanupChatAttachmentStorage({ surface: "task", scopeId: id });
    return NextResponse.json({ ok: true, action: "started" });
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

      try {
        await processManager.applyPermissionState(id, {
          permissionMode: executionMode,
          executionPermissionMode: executionMode,
        });
      } catch (error) {
        return permissionModeErrorResponse(error);
      }

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
        "UPDATE tasks SET status = 'running', updatedAt = ?, lastReplyAt = ?, activityLabel = ?, needsInput = 0, errorMessage = NULL, startedAt = COALESCE(startedAt, ?) WHERE id = ?"
      ).run(now, now, "Plan approved — starting execution", now, id);

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
      try {
        await processManager.applyPermissionState(id, {
          permissionMode: executionMode,
          executionPermissionMode: executionMode,
        });
      } catch (error) {
        return permissionModeErrorResponse(error);
      }
      db.prepare(
        "UPDATE tasks SET status = 'review', updatedAt = ?, lastReplyAt = ?, activityLabel = ?, needsInput = 0 WHERE id = ?"
      ).run(now, now, "Plan canceled", id);
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

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { emitTaskEvent } from "@/lib/event-bus";
import { cleanupChatAttachmentStorage, copyChatAttachmentsToSent, deleteSourceDraftAttachments } from "@/lib/chat-attachment-service";
import { composeMessageWithAttachments, getMessageTitleSource } from "@/lib/chat-message-content";
import { getActivePermissionMode, getExecutionPermissionMode } from "@/lib/permission-mode";
import {
  isNullableClaudeThinkingEffort,
  normalizeClaudeThinkingEffortForModel,
  VALID_CLAUDE_MODELS,
} from "@/lib/claude-options";
import type { Message } from "@/types/chat";
import type { ChatAttachment } from "@/types/chat-composer";
import type { ClaudeModel, ClaudeThinkingEffort, PermissionMode, Task } from "@/types/task";

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

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const {
      conversationId,
      content,
      attachments: attachmentPayload,
      replyToMessageId,
      permissionMode: requestedPermissionMode,
      model: requestedModel,
      thinkingEffort: requestedThinkingEffort,
    } = body as {
      conversationId?: string;
      content?: string;
      attachments?: ChatAttachment[];
      replyToMessageId?: string;
      permissionMode?: PermissionMode;
      model?: ClaudeModel | null;
      thinkingEffort?: ClaudeThinkingEffort | null;
    };

    const rawContent = typeof content === "string" ? content.trim() : "";
    const incomingAttachments = normalizeAttachments(attachmentPayload);

    if (!conversationId || (!rawContent && incomingAttachments.length === 0)) {
      return NextResponse.json(
        { error: "conversationId and either content or attachments are required" },
        { status: 400 },
      );
    }

    if ("thinkingEffort" in body && !isNullableClaudeThinkingEffort(requestedThinkingEffort)) {
      return NextResponse.json(
        { error: 'thinkingEffort must be "auto", "low", "medium", "high", "xhigh", "max", or null' },
        { status: 400 },
      );
    }
    if ("model" in body && requestedModel !== null && requestedModel !== undefined && !VALID_CLAUDE_MODELS.includes(requestedModel)) {
      return NextResponse.json(
        { error: 'model must be "opus", "sonnet", "haiku", or null' },
        { status: 400 },
      );
    }

    const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
    if (!conv) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const now = new Date().toISOString();
    const userMessageId = crypto.randomUUID();
    const attachments = incomingAttachments.length > 0
      ? copyChatAttachmentsToSent({
          surface: "conversation",
          scopeId: conversationId,
          referenceId: userMessageId,
          attachments: incomingAttachments,
        })
      : [];
    const titleSource = getMessageTitleSource(rawContent, attachments);
    const claudeContent = composeMessageWithAttachments(rawContent, attachments);

    const userMessage: Message = {
      id: userMessageId,
      conversationId,
      taskId: null,
      role: "user",
      content: rawContent,
      metadata: replyToMessageId || attachments.length > 0
        ? {
            ...(replyToMessageId ? { replyToMessageId } : {}),
            ...(attachments.length > 0 ? { attachments } : {}),
          }
        : null,
      parentMessageId: replyToMessageId || null,
      createdAt: now,
    };

    db.prepare(
      `INSERT INTO messages (id, conversationId, taskId, role, content, metadata, parentMessageId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      userMessage.id,
      userMessage.conversationId,
      userMessage.taskId,
      userMessage.role,
      userMessage.content,
      userMessage.metadata ? JSON.stringify(userMessage.metadata) : null,
      userMessage.parentMessageId,
      userMessage.createdAt,
    );

    const msgCount = db.prepare(
      "SELECT COUNT(*) as count FROM messages WHERE conversationId = ? AND role = 'user'",
    ).get(conversationId) as { count: number };

    if (msgCount.count <= 1) {
      const title = titleSource.length > 80 ? titleSource.slice(0, 77) + "..." : titleSource;
      db.prepare("UPDATE conversations SET title = ?, updatedAt = ? WHERE id = ?")
        .run(title, now, conversationId);
    } else {
      db.prepare("UPDATE conversations SET updatedAt = ? WHERE id = ?")
        .run(now, conversationId);
    }

    if (replyToMessageId) {
      const parentMsg = db.prepare("SELECT * FROM messages WHERE id = ?").get(replyToMessageId) as Record<string, unknown> | undefined;
      if (parentMsg && parentMsg.role === "sub_agent" && parentMsg.taskId) {
        try {
          const taskId = parentMsg.taskId as string;
          await fetch(new URL(`/api/tasks/${taskId}/reply`, request.url), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: rawContent,
              attachments,
              permissionMode: requestedPermissionMode,
              model: requestedModel ?? undefined,
              thinkingEffort: requestedThinkingEffort ?? undefined,
            }),
          });
        } catch (err) {
          console.error("Failed to route reply to task:", err);
        }
      }
    }

    let orchestratorMessage: Message | null = null;
    let createdTask: Task | null = null;

    if (!replyToMessageId) {
      const pendingTask = db.prepare(
        `SELECT * FROM tasks
         WHERE conversationId = ? AND needsInput = 1 AND status IN ('running', 'review')
         ORDER BY updatedAt DESC LIMIT 1`,
      ).get(conversationId) as Task | undefined;

      if (pendingTask) {
        try {
          const replyUrl = new URL(`/api/tasks/${pendingTask.id}/reply`, request.url);
          await fetch(replyUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: rawContent,
              attachments,
              permissionMode: requestedPermissionMode,
              model: requestedModel ?? undefined,
              thinkingEffort: requestedThinkingEffort ?? undefined,
            }),
          });

          orchestratorMessage = {
            id: crypto.randomUUID(),
            conversationId,
            taskId: pendingTask.id,
            role: "orchestrator",
            content: `Sent your reply to "${pendingTask.title}".`,
            metadata: null,
            parentMessageId: userMessage.id,
            createdAt: new Date().toISOString(),
          };

          db.prepare(
            `INSERT INTO messages (id, conversationId, taskId, role, content, metadata, parentMessageId, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            orchestratorMessage.id,
            orchestratorMessage.conversationId,
            orchestratorMessage.taskId,
            orchestratorMessage.role,
            orchestratorMessage.content,
            null,
            orchestratorMessage.parentMessageId,
            orchestratorMessage.createdAt,
          );
        } catch (err) {
          console.error("Failed to route reply to pending task:", err);
        }

        deleteSourceDraftAttachments(incomingAttachments);
        cleanupChatAttachmentStorage({ surface: "conversation", scopeId: conversationId });

        return NextResponse.json({
          userMessage,
          orchestratorMessage,
          task: null,
        }, { status: 201 });
      }

      const taskId = crypto.randomUUID();
      const permissionMode = getActivePermissionMode(requestedPermissionMode, "bypassPermissions");
      const executionPermissionMode = getExecutionPermissionMode(requestedPermissionMode, "bypassPermissions");
      const model =
        requestedModel === null
          ? null
          : requestedModel && VALID_CLAUDE_MODELS.includes(requestedModel)
            ? requestedModel
            : null;
      const thinkingEffort = normalizeClaudeThinkingEffortForModel(model, requestedThinkingEffort ?? null);
      const task: Task = {
        id: taskId,
        title: titleSource.length > 100
          ? titleSource.slice(0, 97) + "..."
          : titleSource,
        description: claudeContent,
        status: "queued",
        level: "task",
        parentId: null,
        projectSlug: null,
        columnOrder: -1,
        createdAt: now,
        updatedAt: now,
        costUsd: null,
        tokensUsed: null,
        durationMs: null,
        activityLabel: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        clientId: (conv as Record<string, unknown>).clientId as string | null,
        needsInput: false,
        phaseNumber: null,
        gsdStep: null,
        contextSources: null,
        cronJobSlug: null,
        claudeSessionId: null,
        permissionMode,
        executionPermissionMode,
        model,
        thinkingEffort,
        lastReplyAt: null,
        goalGroup: null,
        tag: null,
        pinnedAt: null,
        conversationId,
        originMessageId: userMessage.id,
      };

      db.prepare(
        `INSERT INTO tasks (id, title, description, status, level, parentId, projectSlug, columnOrder, createdAt, updatedAt, clientId, needsInput, permissionMode, executionPermissionMode, model, thinkingEffort, conversationId, originMessageId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        task.id,
        task.title,
        task.description,
        task.status,
        task.level,
        task.parentId,
        task.projectSlug,
        task.columnOrder,
        task.createdAt,
        task.updatedAt,
        task.clientId,
        0,
        task.permissionMode,
        task.executionPermissionMode,
        task.model,
        task.thinkingEffort,
        task.conversationId,
        task.originMessageId,
      );

      createdTask = task;

      emitTaskEvent({
        type: "task:created",
        task,
        timestamp: now,
      });

      orchestratorMessage = {
        id: crypto.randomUUID(),
        conversationId,
        taskId: task.id,
        role: "orchestrator",
        content: `Queued "${task.title}" — it'll start executing shortly.`,
        metadata: null,
        parentMessageId: userMessage.id,
        createdAt: new Date().toISOString(),
      };

      db.prepare(
        `INSERT INTO messages (id, conversationId, taskId, role, content, metadata, parentMessageId, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        orchestratorMessage.id,
        orchestratorMessage.conversationId,
        orchestratorMessage.taskId,
        orchestratorMessage.role,
        orchestratorMessage.content,
        null,
        orchestratorMessage.parentMessageId,
        orchestratorMessage.createdAt,
      );
    }

    deleteSourceDraftAttachments(incomingAttachments);
    cleanupChatAttachmentStorage({ surface: "conversation", scopeId: conversationId });

    return NextResponse.json({
      userMessage,
      orchestratorMessage,
      task: createdTask,
    }, { status: 201 });
  } catch (error) {
    console.error("POST /api/chat/message error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

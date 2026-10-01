import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { emitTaskEvent } from "@/lib/event-bus";
import { assertValidClientId } from "@/lib/clients";
import { detectClientIdFromCwd } from "@/lib/config";
import {
  RequestPrincipalError,
} from "@/lib/identity/request-principal";
import { requireSkillUseForRequest } from "@/lib/identity/skill-authorization";
import {
  WorkScopeError,
  assertNoWorkScopeInput,
  captureNewWorkScope,
  inheritWorkScope,
  isWorkScopeError,
  normalizeWorkScopedRow,
  requestWithWorkScope,
  workScopeErrorBody,
} from "@/lib/identity/work-scope";
import { getActivePermissionMode, getExecutionPermissionMode } from "@/lib/permission-mode";
import { getAutoModeUnavailability } from "@/lib/claude-capabilities.server";
import {
  isClaudeModel,
  isNullableClaudeThinkingEffort,
  normalizeClaudeModel,
  normalizeClaudeThinkingEffortForModel,
} from "@/lib/claude-options";
import type { Task, TaskCreateInput } from "@/types/task";
import { validateTaskListScope } from "@/lib/task-list-scope";
import { isTaskArchived, isTaskTreeReadOnlyError } from "@/lib/task-archive";
import { resolveTaskHasMainChat } from "@/lib/task-main-chat";

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const clientId = searchParams.get("clientId");
    const clientIds = searchParams
      .get("clientIds")
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    const scopeError = validateTaskListScope(searchParams);
    if (scopeError) {
      return NextResponse.json(
        { code: "invalid_scope_input", error: scopeError },
        { status: 400 },
      );
    }

    // Build query with optional filters
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }

    if (clientIds && clientIds.length > 0) {
      const includeRoot = clientIds.includes("_root");
      const scopedClientIds = clientIds.filter((value) => value !== "_root");
      const scopeConditions: string[] = [];

      if (includeRoot) {
        scopeConditions.push("clientId IS NULL");
      }

      if (scopedClientIds.length > 0) {
        scopeConditions.push(
          `clientId IN (${scopedClientIds.map(() => "?").join(", ")})`
        );
        params.push(...scopedClientIds);
      }

      if (scopeConditions.length > 0) {
        conditions.push(`(${scopeConditions.join(" OR ")})`);
      }
    } else if (clientId && clientId !== "root") {
      conditions.push("clientId = ?");
      params.push(clientId);
    }

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    const rows = db
      .prepare(`SELECT * FROM tasks${where} ORDER BY columnOrder ASC`)
      .all(...params) as Array<Omit<Task, "workScope" | "dependsOnTaskIds"> & {
        workScope: string | null;
        dependsOnTaskIds: string | string[] | null;
      }>;

    const directLogTaskIds = new Set(
      (db.prepare("SELECT DISTINCT taskId FROM task_logs").all() as Array<{ taskId: string }>)
        .map((row) => row.taskId),
    );
    const conversationIdsWithMessages = new Set(
      (db.prepare("SELECT DISTINCT conversationId FROM messages").all() as Array<{ conversationId: string }>)
        .map((row) => row.conversationId),
    );

    // Normalize SQLite integer to boolean for needsInput, parse JSON fields
    const tasks: Task[] = rows.map((raw) => {
      const t = normalizeWorkScopedRow(raw) as Task & { dependsOnTaskIds: string | string[] | null };
      return {
        ...t,
        hasMainChat: resolveTaskHasMainChat(t, {
          directLogTaskIds,
          conversationIdsWithMessages,
        }),
        needsInput: Boolean(t.needsInput),
        dependsOnTaskIds:
          typeof t.dependsOnTaskIds === "string" && t.dependsOnTaskIds.length > 0
          ? (() => {
              try {
                const parsed = JSON.parse(t.dependsOnTaskIds as string);
                return Array.isArray(parsed) ? (parsed as string[]) : null;
              } catch {
                return null;
              }
            })()
            : null,
      };
    });

    return NextResponse.json(tasks);
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    console.error("GET /api/tasks error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    assertNoWorkScopeInput(body);

    // Validate input
    const { title, description, level, projectSlug: bodyProjectSlug, clientId: bodyClientId, parentId: bodyParentId, phaseNumber: bodyPhaseNumber, gsdStep: bodyGsdStep, cronJobSlug: bodyCronJobSlug, permissionMode: bodyPermissionMode, executionPermissionMode: bodyExecutionPermissionMode, status: bodyStatus, dependsOnTaskIds: bodyDependsOnTaskIds, model: bodyModel, thinkingEffort: bodyThinkingEffort, cwd: bodyCwd } = body as TaskCreateInput & { cronJobSlug?: string; status?: string; dependsOnTaskIds?: string[]; cwd?: string };
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json(
        { error: "title is required and must be a non-empty string" },
        { status: 400 }
      );
    }
    if (!level || !["task", "project", "gsd"].includes(level)) {
      return NextResponse.json(
        { error: 'level is required and must be "task", "project", or "gsd"' },
        { status: 400 }
      );
    }
    if (bodyModel !== undefined && bodyModel !== null && !isClaudeModel(bodyModel)) {
      return NextResponse.json(
        { error: "model must be a Claude model alias or model ID without spaces, or null" },
        { status: 400 }
      );
    }
    if (bodyThinkingEffort !== undefined && !isNullableClaudeThinkingEffort(bodyThinkingEffort)) {
      return NextResponse.json(
        { error: 'thinkingEffort must be "auto", "low", "medium", "high", "xhigh", "max", or null' },
        { status: 400 }
      );
    }
    if (bodyCronJobSlug) {
      return NextResponse.json(
        { code: "invalid_scope_input", error: "Scheduled tasks are created by the trusted local cron runtime." },
        { status: 400 },
      );
    }

    let clientId: string | null;
    try {
      clientId = assertValidClientId(bodyClientId ?? detectClientIdFromCwd(bodyCwd));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid client selection";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    let captured: Awaited<ReturnType<typeof captureNewWorkScope>>;
    if (bodyParentId) {
      const parent = db.prepare(
        "SELECT clientId, workScope FROM tasks WHERE id = ?",
      ).get(bodyParentId) as { clientId: string | null; workScope: string | null } | undefined;
      if (!parent) {
        return NextResponse.json({ error: "Parent task not found" }, { status: 404 });
      }
      captured = inheritWorkScope(parent);
      if (bodyClientId !== undefined && clientId !== captured.clientId) {
        throw new WorkScopeError(
          "invalid_scope_input",
          400,
          "A child task must use the same client and work scope as its parent.",
        );
      }
      if (isTaskArchived(db, bodyParentId)) {
        return NextResponse.json({ error: "Restore this Goal before creating a subchat." }, { status: 409 });
      }
    } else {
      captured = await captureNewWorkScope(clientId);
    }
    clientId = captured.clientId;

    try {
      await requireSkillUseForRequest(requestWithWorkScope(request, captured.scope), title, description);
    } catch (error) {
      if (error instanceof RequestPrincipalError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    // Get min columnOrder in queued — new tasks get lowest value to sort to top
    const minOrder = db
      .prepare(
        "SELECT COALESCE(MIN(columnOrder), 1) as minOrder FROM tasks WHERE status = 'queued'"
      )
      .get() as { minOrder: number };

    const now = new Date().toISOString();
    // Child tasks (with parentId) start as backlog — the auto-progression
    // system queues them when their turn comes. Top-level tasks start as queued
    // so the queue watcher picks them up immediately.
    // Allow explicit status override (e.g., "review" for scoping flow).
    const validStatuses = ["backlog", "queued", "review"];
    const initialStatus = (bodyStatus && validStatuses.includes(bodyStatus)
      ? bodyStatus
      : bodyParentId ? "backlog" : "queued") as Task["status"];
    const requestedPermissionMode = bodyCronJobSlug ? "bypassPermissions" : bodyPermissionMode;
    const permissionMode = getActivePermissionMode(requestedPermissionMode, "bypassPermissions");
    const executionPermissionMode = getExecutionPermissionMode(
      bodyExecutionPermissionMode ?? requestedPermissionMode,
      "bypassPermissions",
    );
    const model = normalizeClaudeModel(bodyModel) ?? null;
    const thinkingEffort = normalizeClaudeThinkingEffortForModel(model, bodyThinkingEffort ?? null);
    const autoModeUnavailable = await getAutoModeUnavailability({
      permissionMode,
      executionPermissionMode,
      model,
    });
    if (autoModeUnavailable) {
      return NextResponse.json(autoModeUnavailable, { status: 409 });
    }

    const task: Task = {
      id: crypto.randomUUID(),
      title: title.trim(),
      description: description?.trim() || null,
      status: initialStatus,
      level,
      parentId: bodyParentId || null,
      projectSlug: bodyProjectSlug || null,
      columnOrder: minOrder.minOrder - 1,
      createdAt: now,
      updatedAt: now,
      costUsd: null,
      tokensUsed: null,
      durationMs: null,
      activityLabel: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      clientId,
      workScope: captured.scope,
      needsInput: false,
      phaseNumber: bodyPhaseNumber ?? null,
      gsdStep: bodyGsdStep ?? null,
      contextSources: null,
      cronJobSlug: bodyCronJobSlug || null,
      claudeSessionId: null,
      permissionMode,
      executionPermissionMode,
      model,
      thinkingEffort,
      lastReplyAt: null,
      goalGroup: null,
      tag: null,
      pinnedAt: null,
      archivedAt: null,
      hasMainChat: true,
      dependsOnTaskIds:
        Array.isArray(bodyDependsOnTaskIds) && bodyDependsOnTaskIds.length > 0
          ? bodyDependsOnTaskIds
          : null,
    };

    db.prepare(
      `INSERT INTO tasks (id, title, description, status, level, parentId, projectSlug, columnOrder, createdAt, updatedAt, costUsd, tokensUsed, durationMs, activityLabel, errorMessage, startedAt, completedAt, clientId, workScope, needsInput, phaseNumber, gsdStep, cronJobSlug, permissionMode, executionPermissionMode, model, thinkingEffort, dependsOnTaskIds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      task.costUsd,
      task.tokensUsed,
      task.durationMs,
      task.activityLabel,
      task.errorMessage,
      task.startedAt,
      task.completedAt,
      task.clientId,
      captured.serialized,
      0,
      task.phaseNumber,
      task.gsdStep,
      task.cronJobSlug,
      task.permissionMode,
      task.executionPermissionMode,
      task.model,
      task.thinkingEffort,
      task.dependsOnTaskIds ? JSON.stringify(task.dependsOnTaskIds) : null
    );

    emitTaskEvent({
      type: "task:created",
      task,
      timestamp: now,
    });

    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    if (isTaskTreeReadOnlyError(error)) {
      return NextResponse.json(
        { error: "Restore this Goal before creating a subchat." },
        { status: 409 },
      );
    }
    console.error("POST /api/tasks error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

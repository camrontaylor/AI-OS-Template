import crypto from "crypto";
import path from "path";
import type Database from "better-sqlite3";
import { getDb } from "./db";
import type {
  ApprovalRequest,
  TaskPermissionMatcherType,
  TaskPermissionRule,
} from "@/types/approval";

const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);

export interface NormalizedTaskPermission {
  matcherType: TaskPermissionMatcherType;
  matcherValue: string;
}

export function normalizePermissionWorkspace(workspacePath: string): string {
  const resolved = path.resolve(workspacePath);
  return process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
}

export function normalizeTaskPermission(
  toolName: string,
  input: unknown,
): NormalizedTaskPermission {
  const value = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};

  if (toolName === "Bash" || toolName.startsWith("Bash(")) {
    const command = typeof value.command === "string" ? value.command.trim() : "";
    return { matcherType: "bash_exact", matcherValue: command };
  }

  if (EDIT_TOOLS.has(toolName)) {
    return { matcherType: "edit_session", matcherValue: "file_edits" };
  }

  if (toolName === "WebFetch") {
    const rawUrl = typeof value.url === "string" ? value.url : "";
    try {
      return {
        matcherType: "web_domain",
        matcherValue: new URL(rawUrl).hostname.toLocaleLowerCase("en-US"),
      };
    } catch {
      return { matcherType: "exact_tool", matcherValue: toolName };
    }
  }

  return { matcherType: "exact_tool", matcherValue: toolName };
}

export function createTaskPermissionRule(
  request: ApprovalRequest,
  workspacePath: string,
  database: Database.Database = getDb(),
): TaskPermissionRule {
  const input = JSON.parse(request.inputJson || "{}");
  const normalized = normalizeTaskPermission(request.toolName, input);
  const normalizedWorkspace = normalizePermissionWorkspace(workspacePath);
  const existing = database.prepare(
    `SELECT * FROM task_permission_rules
     WHERE taskId = ? AND matcherType = ? AND matcherValue = ?
       AND workspacePath = ? AND revokedAt IS NULL
     ORDER BY createdAt DESC LIMIT 1`,
  ).get(
    request.taskId,
    normalized.matcherType,
    normalized.matcherValue,
    normalizedWorkspace,
  ) as TaskPermissionRule | undefined;
  if (existing) return existing;

  const rule: TaskPermissionRule = {
    id: crypto.randomUUID(),
    taskId: request.taskId,
    sourceApprovalRequestId: request.id,
    toolName: request.toolName,
    matcherType: normalized.matcherType,
    matcherValue: normalized.matcherValue,
    workspacePath: normalizedWorkspace,
    createdAt: new Date().toISOString(),
    revokedAt: null,
  };
  database.prepare(
    `INSERT INTO task_permission_rules
      (id, taskId, sourceApprovalRequestId, toolName, matcherType, matcherValue, workspacePath, createdAt, revokedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    rule.id,
    rule.taskId,
    rule.sourceApprovalRequestId,
    rule.toolName,
    rule.matcherType,
    rule.matcherValue,
    rule.workspacePath,
    rule.createdAt,
  );
  return rule;
}

export function getRuleForApprovalRequest(
  requestId: string,
  database: Database.Database = getDb(),
): TaskPermissionRule | undefined {
  return database.prepare(
    `SELECT * FROM task_permission_rules
     WHERE sourceApprovalRequestId = ? AND revokedAt IS NULL
     ORDER BY createdAt DESC LIMIT 1`,
  ).get(requestId) as TaskPermissionRule | undefined;
}

export function revokeTaskPermissionRules(
  taskId: string,
  database: Database.Database = getDb(),
): number {
  const result = database.prepare(
    `UPDATE task_permission_rules SET revokedAt = ?
     WHERE taskId = ? AND revokedAt IS NULL`,
  ).run(new Date().toISOString(), taskId);
  return result.changes;
}

export function describeTaskPermissionRule(request: ApprovalRequest): string {
  const input = JSON.parse(request.inputJson || "{}");
  const normalized = normalizeTaskPermission(request.toolName, input);
  switch (normalized.matcherType) {
    case "bash_exact":
      return "Allow this exact command in this subchat";
    case "edit_session":
      return "Allow file edits in this subchat";
    case "web_domain":
      return `Allow ${normalized.matcherValue || "this domain"} in this subchat`;
    default:
      return `Allow ${request.toolName} in this subchat`;
  }
}

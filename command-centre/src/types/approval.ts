export type ApprovalRequestKind = "permission";
export type ApprovalRequestStatus = "pending" | "approved" | "denied";
export type ApprovalDecision = "allow_once" | "allow_for_task" | "deny";

export interface ApprovalRequest {
  id: string;
  taskId: string;
  kind: ApprovalRequestKind;
  status: ApprovalRequestStatus;
  title: string;
  description: string | null;
  toolName: string;
  inputJson: string;
  decision: ApprovalDecision | null;
  decisionMessage: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export type TaskPermissionMatcherType =
  | "bash_exact"
  | "edit_session"
  | "web_domain"
  | "exact_tool";

export interface TaskPermissionRule {
  id: string;
  taskId: string;
  sourceApprovalRequestId: string;
  toolName: string;
  matcherType: TaskPermissionMatcherType;
  matcherValue: string;
  workspacePath: string;
  createdAt: string;
  revokedAt: string | null;
}

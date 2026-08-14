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

export interface ApprovalRequestWithTask extends ApprovalRequest {
  taskTitle: string | null;
  taskStatus: string | null;
  taskClientId: string | null;
  taskProjectSlug: string | null;
  taskNeedsInput: boolean;
  taskPermissionMode: string | null;
  taskExecutionPermissionMode: string | null;
}

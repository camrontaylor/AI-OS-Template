import type { StoredWorkScopeV1 } from "@/lib/identity/session-scope";

export type TaskStatus = "backlog" | "queued" | "running" | "review" | "done";
export type TaskLevel = "task" | "project" | "gsd";

// Human-friendly labels and hints for task levels now live in `@/lib/levels`
// to keep a single source of truth across the app.

export type GsdStep = "discuss" | "plan" | "execute" | "verify";
export type PermissionMode = "plan" | "default" | "acceptEdits" | "auto" | "bypassPermissions";
export type ClaudeModel = string;
export type ClaudeThinkingEffort = "auto" | "low" | "medium" | "high" | "xhigh" | "max";

export interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

export const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  plan: "Plan",
  default: "Ask",
  acceptEdits: "Auto-edit (legacy)",
  auto: "Auto",
  bypassPermissions: "Full access",
};

export const PERMISSION_MODE_HINTS: Record<PermissionMode, string> = {
  plan: "Creates a plan first, then waits for your approval.",
  default: "Claude asks before actions that need permission.",
  acceptEdits: "Automatically accepts file edits; commands can still ask.",
  auto: "Works independently, with background checks for unsafe actions.",
  bypassPermissions: "Runs without asking or permission checks.",
};

export type LogEntryType =
  | "text"
  | "tool_use"
  | "tool_result"
  | "question"
  | "structured_question"
  | "user_reply"
  | "system";

export interface LogEntry {
  id: string;
  type: LogEntryType;
  timestamp: string;
  content: string;
  toolName?: string;
  toolArgs?: string;
  toolResult?: string;
  toolUseId?: string;
  parentToolUseId?: string;
  isCollapsed?: boolean;
  /** JSON-serialised QuestionSpec[] when type === "structured_question" */
  questionSpec?: string;
  /** JSON-serialised QuestionAnswers once the user has replied */
  questionAnswers?: string;
  /** Task ID this entry came from (set when merging parent + subtask logs). */
  sourceTaskId?: string;
  /** Permission mode active when this user_reply was sent */
  permissionMode?: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  level: TaskLevel;
  parentId: string | null;
  projectSlug: string | null;
  columnOrder: number;
  createdAt: string;
  updatedAt: string;
  costUsd: number | null;
  tokensUsed: number | null;
  durationMs: number | null;
  activityLabel: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  /** Internal barrier while an archive request is stopping active work. */
  archivingAt?: string | null;
  /** Whether this row owns a displayable main Chat, rather than only acting as a project/GSD shell. */
  hasMainChat?: boolean;
  clientId: string | null;
  workScope: StoredWorkScopeV1;
  needsInput: boolean;
  phaseNumber: number | null;
  gsdStep: GsdStep | null;
  contextSources: string | null;
  cronJobSlug: string | null;
  claudeSessionId: string | null;
  claudePid?: number | null;
  ownedClaudePid?: number | null;
  cancelRequestedAt?: string | null;
  permissionMode: PermissionMode;
  executionPermissionMode?: PermissionMode | null;
  model?: ClaudeModel | null;
  thinkingEffort?: ClaudeThinkingEffort | null;
  lastReplyAt: string | null;
  conversationId?: string | null;
  originMessageId?: string | null;
  teamId?: string | null;
  coordinationLevel?: "inject" | "shared_context" | "team" | null;
  goalGroup: string | null;
  tag: string | null;
  pinnedAt: string | null;
  dependsOnTaskIds?: string[] | null;
  /** Worktree isolation mode for parallel execution */
  isolation?: "none" | "worktree" | null;
  /** Absolute path to the git worktree when running in isolation */
  worktreePath?: string | null;
  /** Git branch name for the worktree */
  worktreeBranch?: string | null;
  /** Source task for edit-and-branch history. Metadata only. */
  forkedFromTaskId?: string | null;
  /** Source user message/log for edit-and-branch history. Metadata only. */
  forkedFromLogId?: string | null;
  /** Original Claude session at branch time. Never use for resume. */
  forkedFromClaudeSessionId?: string | null;
}

export interface OutputFile {
  id: string;
  taskId: string;
  fileName: string;
  filePath: string;
  relativePath: string;
  extension: string;
  sizeBytes: number | null;
  createdAt: string;
  diffStatus?: "added" | "modified" | "unchanged";
  directoryHint?: boolean;
}

export interface TaskCreateInput {
  title: string;
  description?: string | null;
  level: TaskLevel;
  projectSlug?: string | null;
  clientId?: string | null;
  parentId?: string | null;
  phaseNumber?: number | null;
  gsdStep?: GsdStep | null;
  permissionMode?: PermissionMode;
  executionPermissionMode?: PermissionMode | null;
  model?: ClaudeModel | null;
  thinkingEffort?: ClaudeThinkingEffort | null;
  conversationId?: string | null;
  originMessageId?: string | null;
}

export type TaskUpdateInput = Partial<
  Pick<
    Task,
    | "title"
    | "description"
    | "status"
    | "level"
    | "parentId"
    | "projectSlug"
    | "columnOrder"
    | "costUsd"
    | "tokensUsed"
    | "durationMs"
    | "activityLabel"
    | "errorMessage"
    | "startedAt"
    | "completedAt"
    | "cancelRequestedAt"
    | "archivedAt"
    | "clientId"
    | "needsInput"
    | "phaseNumber"
    | "gsdStep"
    | "permissionMode"
    | "executionPermissionMode"
    | "model"
    | "thinkingEffort"
    | "conversationId"
    | "originMessageId"
    | "teamId"
    | "coordinationLevel"
    | "goalGroup"
    | "tag"
    | "pinnedAt"
    | "isolation"
    | "worktreePath"
    | "worktreeBranch"
    | "forkedFromTaskId"
    | "forkedFromLogId"
    | "forkedFromClaudeSessionId"
  >
>;

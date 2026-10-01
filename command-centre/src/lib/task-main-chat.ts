import type { Task } from "@/types/task";

export interface TaskMainChatEvidence {
  directLogTaskIds: ReadonlySet<string>;
  conversationIdsWithMessages: ReadonlySet<string>;
}

type MainChatTask = Pick<
  Task,
  "id" | "level" | "status" | "conversationId" | "claudeSessionId"
>;

/**
 * Ordinary Goals always retain their Chat entry, including a legitimate empty
 * first turn. Project/GSD rows can also be generated as navigation shells, so
 * they need evidence that a main Chat exists or is about to run.
 */
export function resolveTaskHasMainChat(
  task: MainChatTask,
  evidence: TaskMainChatEvidence,
): boolean {
  if (task.level === "task") return true;
  if (evidence.directLogTaskIds.has(task.id)) return true;
  if (
    task.conversationId
    && evidence.conversationIdsWithMessages.has(task.conversationId)
  ) {
    return true;
  }
  if (task.claudeSessionId) return true;
  return task.status === "queued";
}

/** Missing metadata is treated as visible so older callers never hide work. */
export function shouldShowTaskInChatFeed(
  task: Pick<Task, "level" | "hasMainChat">,
): boolean {
  return task.level === "task" || task.hasMainChat !== false;
}

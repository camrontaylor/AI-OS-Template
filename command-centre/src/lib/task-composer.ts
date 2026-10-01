import { isTaskChatActivelyRunning, type TaskRunStateInput } from "./task-run-state";

export type TaskComposerPrimaryAction = "send" | "stop";

export function getTaskComposerPrimaryAction(
  taskStatus?: string | null,
  runState: Omit<TaskRunStateInput, "status"> = {},
): TaskComposerPrimaryAction {
  return isTaskChatActivelyRunning({ ...runState, status: taskStatus }) ? "stop" : "send";
}

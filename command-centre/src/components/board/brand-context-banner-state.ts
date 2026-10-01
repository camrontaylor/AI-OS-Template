import {
  findReusableStartHereTask,
  shouldQueueStartHereTask,
  type StartHereTaskLike,
} from "@/components/onboarding/onboarding-state";

export function shouldShowBrandContextBanner(hasBrandContext: boolean | null): boolean {
  return hasBrandContext === false;
}

export function getBrandContextBannerMessage(clientId: string | null): string {
  return clientId
    ? "This client is missing brand context. Run Start-Here for this client to set up voice, positioning, and ICP."
    : "Brand context is missing. Run Start-Here to set up voice, positioning, and ICP.";
}

export function findStartHereTaskToQueue(
  tasks: StartHereTaskLike[],
  createdTaskId: string | null,
  clientId: string | null,
): StartHereTaskLike | null {
  const scopedClientId = clientId ?? null;
  const createdTask = createdTaskId
    ? tasks.find((task) => task.id === createdTaskId && (task.clientId ?? null) === scopedClientId) ?? null
    : null;

  return createdTask ?? findReusableStartHereTask(tasks, scopedClientId);
}

export function shouldQueueBrandStartHereTask(task: StartHereTaskLike | null): task is StartHereTaskLike {
  return !!task && shouldQueueStartHereTask(task);
}

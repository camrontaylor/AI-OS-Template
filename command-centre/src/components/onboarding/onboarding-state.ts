export const ONBOARDING_COMPLETED_STORAGE_KEY = "ai_os_onboarding_completed";
export const LEGACY_ONBOARDING_SEEN_STORAGE_KEY = "ai_os_onboarding_seen";

export const START_HERE_TITLE = "Start Here";
export const START_HERE_DESCRIPTION = "Run /start-here";

export interface OnboardingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface OnboardingStorageState {
  completed: boolean;
  legacySeen: boolean;
}

export interface OnboardingVisibilityInput {
  forceVisible?: boolean;
  storage: OnboardingStorageState | null;
  tasksReady: boolean;
  hasBrandContext: boolean | null;
  dismissedForSession: boolean;
  selectedClientId?: string | null;
}

export interface StartHereTaskLike {
  id: string;
  title: string;
  description: string | null;
  status: string;
  clientId: string | null;
  parentId: string | null;
}

export function readOnboardingStorage(storage: OnboardingStorage): OnboardingStorageState {
  return {
    completed: storage.getItem(ONBOARDING_COMPLETED_STORAGE_KEY) === "true",
    legacySeen: storage.getItem(LEGACY_ONBOARDING_SEEN_STORAGE_KEY) === "true",
  };
}

export function markOnboardingCompleted(storage: OnboardingStorage): void {
  storage.setItem(ONBOARDING_COMPLETED_STORAGE_KEY, "true");
  storage.removeItem?.(LEGACY_ONBOARDING_SEEN_STORAGE_KEY);
}

export function shouldShowOnboarding(input: OnboardingVisibilityInput): boolean {
  if (input.forceVisible) return true;
  if (!input.storage || !input.tasksReady) return false;
  if (input.storage.completed) return false;
  if (input.dismissedForSession) return false;
  if (input.selectedClientId) return false;
  if (input.hasBrandContext === null) return false;

  return input.hasBrandContext === false;
}

export function findReusableStartHereTask(
  tasks: StartHereTaskLike[],
  selectedClientId: string | null,
): StartHereTaskLike | null {
  const clientId = selectedClientId ?? null;
  return tasks.find((task) =>
    task.title === START_HERE_TITLE &&
    task.description === START_HERE_DESCRIPTION &&
    task.status !== "done" &&
    (task.clientId ?? null) === clientId &&
    task.parentId === null
  ) ?? null;
}

export function shouldQueueStartHereTask(task: StartHereTaskLike): boolean {
  return task.status === "backlog";
}

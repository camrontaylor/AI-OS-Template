import type { PermissionMode, TaskStatus } from "@/types/task";

export const VALID_PERMISSION_MODES: PermissionMode[] = [
  "plan",
  "default",
  "acceptEdits",
  "auto",
  "bypassPermissions",
];

export function normalizePermissionMode(
  value: string | null | undefined,
  fallback: PermissionMode = "bypassPermissions",
): PermissionMode {
  if (!value || !VALID_PERMISSION_MODES.includes(value as PermissionMode)) {
    return fallback;
  }
  return value as PermissionMode;
}

export function getExecutionPermissionMode(
  requestedMode: string | null | undefined,
  fallback: PermissionMode = "bypassPermissions",
): PermissionMode {
  const normalized = normalizePermissionMode(requestedMode, fallback);
  return normalized === "plan" ? fallback : normalized;
}

export function getActivePermissionMode(
  requestedMode: string | null | undefined,
  fallback: PermissionMode = "bypassPermissions",
): PermissionMode {
  return normalizePermissionMode(requestedMode, fallback);
}

export function getPickerPermissionMode(
  activeMode: string | null | undefined,
  executionMode: string | null | undefined,
  taskStatus?: TaskStatus | string | null,
): PermissionMode {
  const normalizedActive = normalizePermissionMode(activeMode, "bypassPermissions");
  if (normalizedActive === "plan") {
    return "plan";
  }

  if (taskStatus === "running") {
    return getExecutionPermissionMode(
      executionMode ?? normalizedActive,
      normalizedActive,
    );
  }

  return normalizedActive;
}

export function getInheritedPermissionModes(
  activeMode: string | null | undefined,
  executionMode: string | null | undefined,
  taskStatus?: TaskStatus | string | null,
): { permissionMode: PermissionMode; executionPermissionMode: PermissionMode } {
  const pickerMode = getPickerPermissionMode(activeMode, executionMode, taskStatus);
  if (pickerMode === "plan") {
    return {
      permissionMode: "plan",
      executionPermissionMode: getExecutionPermissionMode(
        executionMode ?? activeMode,
        "bypassPermissions",
      ),
    };
  }

  return {
    permissionMode: pickerMode,
    executionPermissionMode: pickerMode,
  };
}

export function getPermissionStateForPickerChange(
  nextMode: string | null | undefined,
  activeMode: string | null | undefined,
  executionMode: string | null | undefined,
  fallback: PermissionMode = "bypassPermissions",
): { permissionMode: PermissionMode; executionPermissionMode: PermissionMode } {
  const normalizedNext = getActivePermissionMode(nextMode, fallback);
  if (normalizedNext === "plan") {
    const stagedExecutionMode = getExecutionPermissionMode(
      normalizePermissionMode(activeMode, fallback) === "plan" ? executionMode : activeMode,
      fallback,
    );
    return {
      permissionMode: "plan",
      executionPermissionMode: stagedExecutionMode,
    };
  }

  return {
    permissionMode: normalizedNext,
    executionPermissionMode: normalizedNext,
  };
}

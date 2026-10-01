export const PERMISSION_REQUIRED_ACTIVITY_LABEL = "Needs permission";
export const PERMISSION_RESUMING_ACTIVITY_LABEL = "Resuming after approval";
export const PERMISSION_DENIED_ACTIVITY_LABEL = "Permission denied";
export const PERMISSION_BRIDGE_FAILURE_PREFIX = "Permission bridge failed";

export function isWorkspacePolicyDenialText(value: string | null | undefined): boolean {
  const text = value?.trim();
  if (!text) return false;
  return /^Permission to use [\s\S]+ has been denied\.?$/i.test(text);
}

export function isPermissionBridgeFailureText(value: string | null | undefined): boolean {
  const text = value?.trim();
  if (!text) return false;
  return text.startsWith(PERMISSION_BRIDGE_FAILURE_PREFIX);
}

export function isTaskWaitingOnPermission({
  needsInput,
  activityLabel,
  errorMessage,
}: {
  needsInput: boolean;
  activityLabel?: string | null;
  errorMessage?: string | null;
}): boolean {
  if (!needsInput) {
    return false;
  }

  const activity = activityLabel?.trim() ?? "";
  if (activity === PERMISSION_REQUIRED_ACTIVITY_LABEL) {
    return true;
  }

  return (
    isPermissionBridgeFailureText(activityLabel) ||
    isPermissionBridgeFailureText(errorMessage)
  );
}

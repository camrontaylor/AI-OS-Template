import { cleanTerminalOutput } from "./terminal-output";

export type ScriptRunStatus = "running" | "success" | "error";

export type UpdateProgressTone = "running" | "success" | "warning" | "error";

export interface UpdateProgressState {
  title: string;
  description: string;
  tone: UpdateProgressTone;
  activeStep: number;
}

export interface ScriptRunnerViewState {
  showUpdateStatus: boolean;
  terminalVisible: boolean;
  detailsToggleVisible: boolean;
  detailsToggleLabel: "Show details" | "Hide details";
  updateStatus: UpdateProgressState | null;
}

export const UPDATE_PROGRESS_STEPS = [
  "Checking access",
  "Checking updates",
  "Reviewing changes",
  "Finishing",
] as const;

export function cleanScriptOutput(input: string): string {
  return cleanTerminalOutput(input);
}

export function getInitialShowOutput(scriptId: string): boolean {
  return scriptId !== "update";
}

export function getUpdateProgressState({
  status,
  needsUpdateToken,
  output,
}: {
  status: ScriptRunStatus;
  needsUpdateToken: boolean;
  output: string;
}): UpdateProgressState {
  const cleanOutput = cleanScriptOutput(output);

  if (needsUpdateToken) {
    return {
      title: "New access token required",
      description: "Paste the latest AI-OS token to continue the update.",
      tone: "warning",
      activeStep: 0,
    };
  }

  if (status === "success") {
    return {
      title: "Update completed",
      description: "AI-OS finished the update process.",
      tone: "success",
      activeStep: 3,
    };
  }

  if (status === "error") {
    return {
      title: "Update could not finish",
      description: "Open details to review the log and see what happened.",
      tone: "error",
      activeStep: 3,
    };
  }

  if (/Step 4: Summary|What's New|You are now|You already have/i.test(cleanOutput)) {
    return {
      title: "Finishing update",
      description: "AI-OS is wrapping up and preparing the final summary.",
      tone: "running",
      activeStep: 3,
    };
  }

  if (/Step 2: Your Local Changes|Step 3: Skill Catalog|local skill modifications|installed skills match|Skill Catalog/i.test(cleanOutput)) {
    return {
      title: "Reviewing local changes",
      description: "Your skills and local files are being checked before the update finishes.",
      tone: "running",
      activeStep: 2,
    };
  }

  if (/Update Check|Checking for updates|Updates from the Main Repo|No new updates|Pulled \d+ new commit|Already up to date|Fetching update dependencies/i.test(cleanOutput)) {
    return {
      title: "Checking for updates",
      description: "AI-OS is comparing your install with the main repo.",
      tone: "running",
      activeStep: 1,
    };
  }

  return {
    title: "Checking access token",
    description: "AI-OS is making sure GitHub access is ready before changing files.",
    tone: "running",
    activeStep: 0,
  };
}

export function getScriptRunnerViewState({
  scriptId,
  status,
  needsUpdateToken,
  output,
  lineCount,
  showOutput,
}: {
  scriptId: string;
  status: ScriptRunStatus;
  needsUpdateToken: boolean;
  output: string;
  lineCount: number;
  showOutput: boolean;
}): ScriptRunnerViewState {
  const isUpdate = scriptId === "update";
  const terminalVisible = isUpdate ? showOutput : true;

  return {
    showUpdateStatus: isUpdate,
    terminalVisible,
    detailsToggleVisible: isUpdate && lineCount > 0,
    detailsToggleLabel: showOutput ? "Hide details" : "Show details",
    updateStatus: isUpdate
      ? getUpdateProgressState({ status, needsUpdateToken, output })
      : null,
  };
}

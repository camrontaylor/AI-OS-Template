import { cleanTerminalOutput } from "./terminal-output";

export const UPDATE_TOKEN_REQUIRED_MARKER = "AI_OS_UPDATE_TOKEN_REQUIRED";
export const UPDATE_TOKEN_REQUIRED_EXIT_CODE = 20;

export function hasUpdateTokenRequiredMarker(output: string): boolean {
  return cleanTerminalOutput(output).includes(UPDATE_TOKEN_REQUIRED_MARKER);
}

export function shouldRequestUpdateToken({
  scriptId,
  exitCode,
  output,
}: {
  scriptId: string;
  exitCode: number | null;
  output: string;
}): boolean {
  if (scriptId !== "update") {
    return false;
  }

  return exitCode === UPDATE_TOKEN_REQUIRED_EXIT_CODE || hasUpdateTokenRequiredMarker(output);
}

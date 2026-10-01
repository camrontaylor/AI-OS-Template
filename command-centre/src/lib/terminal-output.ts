const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;

export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, "");
}

export function cleanTerminalOutput(input: string): string {
  return stripAnsi(input).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

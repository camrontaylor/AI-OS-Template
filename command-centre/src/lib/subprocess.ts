import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
} from "child_process";

const isWindows = process.platform === "win32";

export interface ProcessTerminationResult {
  pid: number;
  stopped: boolean;
  detail?: string;
}

export function getWindowsTaskkillArgs(pid: number): string[] {
  return ["/PID", String(pid), "/T", "/F"];
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isProcessAlive(pid);
}

export async function terminateProcessTreeByPid(
  pid: number,
  options: { gracefulTimeoutMs?: number; forceTimeoutMs?: number } = {},
): Promise<ProcessTerminationResult> {
  if (!isProcessAlive(pid)) return { pid, stopped: true };

  if (isWindows) {
    const result = spawnSync("taskkill", getWindowsTaskkillArgs(pid), {
      stdio: "ignore",
      windowsHide: true,
    });
    const stopped = await waitForProcessExit(pid, options.forceTimeoutMs ?? 2_000);
    return {
      pid,
      stopped,
      detail: stopped
        ? undefined
        : result.error?.message || `taskkill exited with status ${result.status}`,
    };
  }

  killProcessTreeByPid(pid, "SIGTERM");
  if (await waitForProcessExit(pid, options.gracefulTimeoutMs ?? 1_500)) {
    return { pid, stopped: true };
  }

  killProcessTreeByPid(pid, "SIGKILL");
  const stopped = await waitForProcessExit(pid, options.forceTimeoutMs ?? 1_000);
  return {
    pid,
    stopped,
    detail: stopped ? undefined : "The process was still alive after SIGKILL.",
  };
}

function withQuietWindowsOptions(options: SpawnOptions = {}): SpawnOptions {
  if (!isWindows) {
    return options;
  }

  return {
    ...options,
    windowsHide: true,
  };
}

export function spawnUiProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptions = {},
): ChildProcess {
  return spawn(command, [...args], withQuietWindowsOptions(options));
}

export function spawnManagedTaskProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptions = {},
): ChildProcess {
  const quietOptions = withQuietWindowsOptions(options);

  if (isWindows) {
    const { detached: _ignored, ...rest } = quietOptions;
    // spawn() cannot execute .cmd files without cmd.exe; route claude through it
    // so both old installs (claude.exe shim) and new installs (claude.cmd only) work.
    if (command === "claude") {
      return spawn("cmd", ["/d", "/s", "/c", command, ...args], rest);
    }
    return spawn(command, [...args], rest);
  }

  return spawn(command, [...args], {
    ...quietOptions,
    detached: options.detached ?? true,
  });
}

export function killChildProcessTree(
  proc: ChildProcess,
  signal: NodeJS.Signals = "SIGTERM",
): void {
  if (!proc.pid) {
    return;
  }

  killProcessTreeByPid(proc.pid, signal, proc);
}

export function killProcessTreeByPid(
  pid: number,
  signal: NodeJS.Signals = "SIGTERM",
  proc?: Pick<ChildProcess, "kill">,
): void {
  if (isWindows) {
    const taskkillArgs = signal === "SIGKILL"
      ? getWindowsTaskkillArgs(pid)
      : ["/PID", String(pid), "/T"];

    const result = spawnSync("taskkill", taskkillArgs, {
      stdio: "ignore",
      windowsHide: true,
    });

    if (!result.error && result.status === 0) {
      return;
    }
  }

  try {
    process.kill(-pid, signal);
  } catch {
    try {
      if (proc) {
        proc.kill(signal);
      } else {
        process.kill(pid, signal);
      }
    } catch {
      // Process already exited.
    }
  }
}

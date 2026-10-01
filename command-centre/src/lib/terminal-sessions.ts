import { spawn, spawnSync, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { getClientAiOsDir, getConfig } from "./config";
import { getActiveLocalProfileDescriptor } from "./db";
import type { LocalProfileDescriptorV1 } from "./local-profile";
import type { StoredWorkScopeV1 } from "./identity/session-scope";
import {
  buildWorkScopeEnvironment,
  createSoloStoredWorkScope,
  readWorkScopeFromRow,
} from "./identity/work-scope";
import { killChildProcessTree } from "./subprocess";
import type { Task } from "@/types/task";

function getWorkspaceRoot(): string {
  return getConfig().aiOsDir;
}

interface BufferedEvent {
  event: string;
  data: string;
}

interface TerminalSession {
  id: string;
  profileKey: string;
  profile: LocalProfileDescriptorV1;
  workScope: StoredWorkScopeV1;
  cwd: string;
  proc: ChildProcess;
  listeners: Set<(event: string, data: string) => void>;
  alive: boolean;
  /** Buffer output that arrives before any listener connects */
  earlyBuffer: BufferedEvent[];
}

const sessions = new Map<string, TerminalSession>();

function sessionKey(id: string, profileKey?: string): string {
  if (typeof getActiveLocalProfileDescriptor !== "function") return id;
  return `${profileKey ?? getActiveLocalProfileDescriptor().profileKey}:${id}`;
}

interface TerminalShellSpec {
  command: string;
  args: string[];
  windowsHide: boolean;
}

export function resolveTaskTerminalCwd(task: Pick<Task, "clientId" | "worktreePath">): string {
  const config = getConfig();
  const workspaceRoot = task.clientId ? getClientAiOsDir(task.clientId) : config.aiOsDir;
  if (!task.worktreePath) return workspaceRoot;

  const root = path.resolve(config.aiOsDir, ".worktrees");
  const candidate = path.resolve(task.worktreePath);
  const relative = path.relative(root, candidate);
  const isInsideWorktrees = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  if (!isInsideWorktrees || !fs.existsSync(root) || !fs.existsSync(candidate)) return workspaceRoot;

  try {
    const workspaceBoundary = fs.realpathSync.native(path.resolve(config.aiOsDir));
    const boundary = fs.realpathSync.native(root);
    const boundaryRelative = path.relative(workspaceBoundary, boundary);
    const boundaryStaysInsideWorkspace = boundaryRelative !== ""
      && !boundaryRelative.startsWith("..")
      && !path.isAbsolute(boundaryRelative);
    if (!boundaryStaysInsideWorkspace) return workspaceRoot;
    const realCandidate = fs.realpathSync.native(candidate);
    const realRelative = path.relative(boundary, realCandidate);
    const staysInsideBoundary = realRelative !== ""
      && !realRelative.startsWith("..")
      && !path.isAbsolute(realRelative);
    return staysInsideBoundary && fs.statSync(realCandidate).isDirectory() ? candidate : workspaceRoot;
  } catch {
    return workspaceRoot;
  }
}

type CommandExists = (command: string) => boolean;

function commandExistsOnWindows(command: string): boolean {
  const result = spawnSync("where.exe", [command], {
    stdio: "ignore",
    windowsHide: true,
  });

  return !result.error && result.status === 0;
}

export function resolveTerminalShell(
  platform: NodeJS.Platform = process.platform,
  commandExists: CommandExists = commandExistsOnWindows,
): TerminalShellSpec {
  if (platform === "win32") {
    return {
      command: commandExists("pwsh.exe") ? "pwsh.exe" : "powershell.exe",
      args: ["-NoLogo", "-NoExit", "-Command", "-"],
      windowsHide: true,
    };
  }

  return {
    command: "bash",
    args: ["-l"],
    windowsHide: false,
  };
}

export interface CreateTerminalSessionOptions {
  cwd?: string;
  profile?: LocalProfileDescriptorV1;
  workScope?: StoredWorkScopeV1;
}

/** Create a new persistent shell session for the current platform. */
export function createSession(
  id: string,
  options: string | CreateTerminalSessionOptions = {},
): TerminalSession {
  const normalizedOptions = typeof options === "string" ? { cwd: options } : options;
  const profile = normalizedOptions.profile
    ?? (typeof getActiveLocalProfileDescriptor === "function"
      ? getActiveLocalProfileDescriptor()
      : {
          version: 1 as const,
          mode: "solo" as const,
          profileKey: "solo" as const,
          dataDir: getWorkspaceRoot(),
          stateDir: getWorkspaceRoot(),
          tempDir: getWorkspaceRoot(),
          dbPath: "",
        });
  const profileKey = profile.profileKey;
  const workScope = normalizedOptions.workScope ?? createSoloStoredWorkScope(null);
  readWorkScopeFromRow({
    clientId: workScope.mode === "team" ? workScope.scope.clientId : workScope.clientId,
    workScope,
  }, profile);
  const cwd = normalizedOptions.cwd || getWorkspaceRoot();
  const scopedId = sessionKey(id, profileKey);

  // Kill existing session with same ID
  destroySession(id, profileKey);

  const shell = resolveTerminalShell();
  const spawnOptions = {
    cwd,
    env: {
      ...process.env,
      TERM: "dumb",
      ...buildWorkScopeEnvironment(workScope, profileKey),
    },
    stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"],
    windowsHide: shell.windowsHide,
  };
  // Keep executable names explicit so Next's server tracer does not treat a
  // dynamic spawn target as an arbitrary file in the project.
  const proc = shell.command === "pwsh.exe"
    ? spawn("pwsh.exe", ["-NoLogo", "-NoExit", "-Command", "-"], spawnOptions)
    : shell.command === "powershell.exe"
      ? spawn("powershell.exe", ["-NoLogo", "-NoExit", "-Command", "-"], spawnOptions)
      : spawn("bash", ["-l"], spawnOptions);

  const session: TerminalSession = {
    id,
    profileKey,
    profile,
    workScope,
    cwd,
    proc,
    listeners: new Set(),
    alive: true,
    earlyBuffer: [],
  };

  const broadcast = (event: string, data: string) => {
    if (session.listeners.size === 0) {
      // No listeners yet — buffer it
      session.earlyBuffer.push({ event, data });
    } else {
      for (const listener of session.listeners) {
        listener(event, data);
      }
    }
  };

  proc.stdout?.on("data", (chunk) => {
    broadcast("stdout", chunk.toString());
  });

  proc.stderr?.on("data", (chunk) => {
    broadcast("stderr", chunk.toString());
  });

  proc.on("close", (code) => {
    session.alive = false;
    broadcast("exit", String(code ?? 0));
    if (sessions.get(scopedId) === session) sessions.delete(scopedId);
  });

  proc.on("error", (err) => {
    session.alive = false;
    broadcast("stderr", `Shell error: ${err.message}`);
    broadcast("exit", "1");
    if (sessions.get(scopedId) === session) sessions.delete(scopedId);
  });

  sessions.set(scopedId, session);
  return session;
}

/** Get an existing session */
export function getSession(id: string, profileKey?: string): TerminalSession | undefined {
  return sessions.get(sessionKey(id, profileKey));
}

/** Send input to a session's stdin */
export function sendInput(id: string, input: string): boolean {
  const session = sessions.get(sessionKey(id));
  if (!session?.alive || !session.proc.stdin?.writable) return false;
  session.proc.stdin.write(input);
  return true;
}

/** Subscribe to session output — replays any buffered early output immediately */
export function subscribe(
  id: string,
  listener: (event: string, data: string) => void,
): () => void {
  const session = sessions.get(sessionKey(id));
  if (!session) return () => {};

  // Replay buffered output
  for (const { event, data } of session.earlyBuffer) {
    listener(event, data);
  }
  session.earlyBuffer = [];

  session.listeners.add(listener);
  return () => { session.listeners.delete(listener); };
}

/** Destroy a session */
export function destroySession(id: string, profileKey?: string) {
  const scopedId = sessionKey(id, profileKey);
  const session = sessions.get(scopedId);
  if (!session) return;
  session.alive = false;
  try {
    killChildProcessTree(session.proc, "SIGTERM");
    const forceTimer = setTimeout(() => {
      try { killChildProcessTree(session.proc, "SIGKILL"); } catch {}
    }, 2000);
    session.proc.once("close", () => clearTimeout(forceTimer));
    forceTimer.unref?.();
  } catch {}
  sessions.delete(scopedId);
}

/** List active sessions */
export function listSessions(): string[] {
  const profileKey = typeof getActiveLocalProfileDescriptor === "function"
    ? getActiveLocalProfileDescriptor().profileKey
    : "solo";
  return Array.from(sessions.values())
    .filter((session) => session.profileKey === profileKey)
    .map((session) => session.id);
}

function waitForExit(session: TerminalSession, timeoutMs: number): Promise<boolean> {
  if (session.proc.exitCode !== null && session.proc.exitCode !== undefined) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.proc.off("close", onClose);
      resolve(exited);
    };
    const onClose = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    session.proc.once("close", onClose);
  });
}

export async function shutdownTerminalSessionsForProfile(
  profileKey: string,
  options: { gracefulMs?: number; forceMs?: number } = {},
): Promise<{ stopped: number; forced: number; pending: number }> {
  const gracefulMs = options.gracefulMs ?? 3000;
  const forceMs = options.forceMs ?? 2000;
  const owned = [...sessions.entries()].filter(([, session]) => session.profileKey === profileKey);
  for (const [, session] of owned) {
    session.alive = false;
    try { killChildProcessTree(session.proc, "SIGTERM"); } catch { /* already stopped */ }
  }

  const gracefulResults = await Promise.all(owned.map(([, session]) => waitForExit(session, gracefulMs)));
  let forced = 0;
  for (let index = 0; index < owned.length; index += 1) {
    if (gracefulResults[index]) continue;
    forced += 1;
    try { killChildProcessTree(owned[index][1].proc, "SIGKILL"); } catch { /* already stopped */ }
  }
  const finalResults = await Promise.all(owned.map(([, session]) => waitForExit(session, forceMs)));
  for (let index = 0; index < owned.length; index += 1) {
    if (finalResults[index]) sessions.delete(owned[index][0]);
  }
  return {
    stopped: owned.length,
    forced,
    pending: finalResults.filter((exited) => !exited).length,
  };
}

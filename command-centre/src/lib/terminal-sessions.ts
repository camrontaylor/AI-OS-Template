import { spawn, type ChildProcess } from "child_process";
import { getConfig } from "./config";

function getWorkspaceRoot(): string {
  return getConfig().agenticOsDir;
}

interface BufferedEvent {
  event: string;
  data: string;
}

interface TerminalSession {
  id: string;
  proc: ChildProcess;
  listeners: Set<(event: string, data: string) => void>;
  alive: boolean;
  /** Buffer output that arrives before any listener connects */
  earlyBuffer: BufferedEvent[];
}

const sessions = new Map<string, TerminalSession>();

/** Create a new persistent bash session */
export function createSession(id: string, cwd?: string): TerminalSession {
  // Kill existing session with same ID
  destroySession(id);

  const proc = spawn("bash", ["-l"], {
    cwd: cwd || getWorkspaceRoot(),
    env: {
      ...process.env,
      TERM: "dumb",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const session: TerminalSession = {
    id,
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
    sessions.delete(id);
  });

  proc.on("error", (err) => {
    session.alive = false;
    broadcast("stderr", `Shell error: ${err.message}`);
    broadcast("exit", "1");
    sessions.delete(id);
  });

  sessions.set(id, session);
  return session;
}

/** Get an existing session */
export function getSession(id: string): TerminalSession | undefined {
  return sessions.get(id);
}

/** Send input to a session's stdin */
export function sendInput(id: string, input: string): boolean {
  const session = sessions.get(id);
  if (!session?.alive || !session.proc.stdin?.writable) return false;
  session.proc.stdin.write(input);
  return true;
}

/** Subscribe to session output — replays any buffered early output immediately */
export function subscribe(
  id: string,
  listener: (event: string, data: string) => void,
): () => void {
  const session = sessions.get(id);
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
export function destroySession(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  session.alive = false;
  try {
    session.proc.kill("SIGTERM");
    setTimeout(() => {
      try { session.proc.kill("SIGKILL"); } catch {}
    }, 2000);
  } catch {}
  sessions.delete(id);
}

/** List active sessions */
export function listSessions(): string[] {
  return Array.from(sessions.keys());
}

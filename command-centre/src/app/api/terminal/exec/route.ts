import { NextRequest } from "next/server";
import {
  createSession,
  getSession,
  sendInput,
  subscribe,
  destroySession,
  resolveTaskTerminalCwd,
} from "@/lib/terminal-sessions";
import path from "node:path";
import fs from "node:fs";
import { assertValidClientId } from "@/lib/clients";
import { getConfig, getClientAiOsDir } from "@/lib/config";
import { getActiveLocalProfileDescriptor, getDb } from "@/lib/db";
import type { Task } from "@/types/task";
import {
  assertNoWorkScopeInput,
  captureNewWorkScope,
  inheritWorkScope,
  isWorkScopeError,
  workScopeErrorBody,
  WorkScopeError,
} from "@/lib/identity/work-scope";
import { fetchTeamContextSnapshot } from "@/lib/team-api-context";
import { isTaskArchived } from "@/lib/task-archive";
import { resolveTaskWorkspace } from "@/lib/task-file-access";

export const dynamic = "force-dynamic";

function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveContainedTerminalDirectory(root: string, candidate: string): string | null {
  try {
    const realRoot = fs.realpathSync(root);
    const realCandidate = fs.realpathSync(candidate);
    if (!fs.statSync(realCandidate).isDirectory()) return null;
    return isContainedPath(realRoot, realCandidate) ? realCandidate : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    assertNoWorkScopeInput(body);
    const { action, sessionId } = body as {
      action: string;
      sessionId: string;
      input?: string;
      cwd?: string;
      clientId?: string | null;
      taskId?: string;
    };

    if (!sessionId) {
      return json({ error: "Missing sessionId" }, 400);
    }

    if (action === "input") {
      if (typeof body.input !== "string") {
        return json({ error: "Missing input" }, 400);
      }
      const sent = sendInput(sessionId, body.input);
      if (!sent) return json({ error: "Session not found or dead" }, 404);
      return json({ ok: true });
    }

    if (action === "destroy") {
      destroySession(sessionId);
      return json({ ok: true });
    }

    if (action === "create") {
      const profile = getActiveLocalProfileDescriptor();
      let captured: Awaited<ReturnType<typeof captureNewWorkScope>>;
      let cwd: string;

      if (typeof body.taskId === "string" && body.taskId.trim()) {
        const db = getDb();
        const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(body.taskId) as Task | undefined;
        if (!task) return json({ error: "Task not found" }, 404);
        if (isTaskArchived(db, task.id)) {
          return json({ error: "Restore this Goal before opening a Terminal." }, 409);
        }
        const workspace = resolveTaskWorkspace(task.id);
        if (!workspace) return json({ error: "Task workspace not found" }, 404);
        captured = inheritWorkScope(task, profile);
        cwd = resolveTaskTerminalCwd({
          clientId: workspace.root.clientId,
          worktreePath: task.worktreePath,
        });
      } else {
        const clientId = assertValidClientId(body.clientId);
        captured = await captureNewWorkScope(clientId);
        cwd = getClientAiOsDir(captured.clientId);

        if (typeof body.cwd === "string" && body.cwd.trim()) {
          if (profile.mode === "team") {
            return json({
              code: "invalid_scope_input",
              error: "Team terminals use a server-validated root, client, or task directory.",
            }, 400);
          }
          const requestedCwd = path.resolve(body.cwd);
          if (!isContainedPath(getConfig().aiOsDir, requestedCwd)) {
            return json({ error: "Terminal directory must stay inside the AI-OS workspace" }, 400);
          }
          cwd = requestedCwd;
        }
      }

      if (captured.scope.mode === "team") {
        try {
          await fetchTeamContextSnapshot(captured.clientId, undefined, {
            teamId: captured.scope.scope.teamId,
          });
        } catch {
          throw new WorkScopeError(
            "team_context_unavailable",
            503,
            "The selected Team or client could not be validated. Reconnect or restore access before opening this terminal.",
          );
        }
      }

      const validatedCwd = resolveContainedTerminalDirectory(getConfig().aiOsDir, cwd);
      if (!validatedCwd) {
        return json({ error: "Terminal directory is unavailable or outside the workspace" }, 400);
      }
      if (request.signal.aborted) {
        return json({ error: "Terminal request was cancelled" }, 499);
      }
      createSession(sessionId, { cwd: validatedCwd, profile, workScope: captured.scope });

      // Create the session and return its output stream in one response.
      const encoder = new TextEncoder();
      let disposeStream = () => destroySession(sessionId, profile.profileKey);
      const stream = new ReadableStream({
        start(controller) {
          let disposed = false;
          const send = (event: string, data: string) => {
            try {
              controller.enqueue(
                encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
              );
            } catch {}
          };

          // Subscribe immediately — earlyBuffer replays any output that arrived before this
          const unsub = subscribe(sessionId, (event, data) => {
            send(event, data);
          });

          // Send a ready event so the client knows we're connected
          send("ready", sessionId);

          const keepalive = setInterval(() => {
            try { controller.enqueue(encoder.encode(": ping\n\n")); } catch {}
          }, 15000);

          const checkAlive = setInterval(() => {
            if (!getSession(sessionId, profile.profileKey)) {
              dispose(false);
              try { controller.close(); } catch {}
            }
          }, 2000);

          const abortHandler = () => dispose(true);
          function dispose(destroy: boolean) {
            if (disposed) return;
            disposed = true;
            clearInterval(checkAlive);
            clearInterval(keepalive);
            unsub();
            request.signal.removeEventListener("abort", abortHandler);
            if (destroy) destroySession(sessionId, profile.profileKey);
          }

          disposeStream = abortHandler;
          request.signal.addEventListener("abort", abortHandler, { once: true });
          if (request.signal.aborted) abortHandler();
        },
        cancel() {
          disposeStream();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (error) {
    if (isWorkScopeError(error)) {
      return json(workScopeErrorBody(error), error.status);
    }
    return json({ error: "Invalid request body" }, 400);
  }
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

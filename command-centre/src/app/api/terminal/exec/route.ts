import { NextRequest } from "next/server";
import {
  createSession,
  getSession,
  sendInput,
  subscribe,
  destroySession,
} from "@/lib/terminal-sessions";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, sessionId } = body as {
      action: string;
      sessionId: string;
      input?: string;
      cwd?: string;
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
      // Create session AND return the output stream in one response
      createSession(sessionId, body.cwd);

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
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
            if (!getSession(sessionId)) {
              clearInterval(checkAlive);
              clearInterval(keepalive);
              unsub();
              try { controller.close(); } catch {}
            }
          }, 2000);

          request.signal.addEventListener("abort", () => {
            clearInterval(checkAlive);
            clearInterval(keepalive);
            unsub();
          });
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
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

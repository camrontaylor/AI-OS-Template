import {
  offChatEvent,
  offTaskEvent,
  onChatEvent,
  onTaskEvent,
  registerProfileEventStream,
} from "@/lib/event-bus";
import type { ChatEvent, TaskEvent } from "@/lib/event-bus";
import { startCronTaskSync } from "@/lib/cron-task-sync";
import {
  LocalProfileLockedError,
  localProfileErrorBody,
  resolveLocalProfileDescriptor,
} from "@/lib/local-profile";
import {
  assertLocalProfileRequest,
  LocalProfileRequestError,
  localProfileRequestErrorBody,
} from "@/lib/local-profile-lifecycle";

export const dynamic = "force-dynamic";

// Start the cron-task sync poller when the first SSE client connects
startCronTaskSync();

export async function GET(request: Request) {
  let profileKey: string;
  try {
    const descriptor = resolveLocalProfileDescriptor();
    assertLocalProfileRequest(descriptor, request.headers);
    profileKey = descriptor.profileKey;
  } catch (error) {
    if (error instanceof LocalProfileRequestError) {
      return Response.json(localProfileRequestErrorBody(error), { status: error.status });
    }
    if (error instanceof LocalProfileLockedError) {
      return Response.json(localProfileErrorBody(error), { status: error.status });
    }
    throw error;
  }
  const encoder = new TextEncoder();
  let cleanup = (_closeStream = true) => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let keepAlive: ReturnType<typeof setInterval> | undefined;
      let unregisterProfileStream = () => {};

      // The HTTP adapter already owns stream shutdown after a client abort.
      // Closing the controller again in that same abort stack can surface a
      // harmless ECONNRESET as an uncaught Next.js development error.
      const abortHandler = () => cleanup(false);

      cleanup = (closeStream = true) => {
        if (closed) return;
        closed = true;
        if (keepAlive) {
          clearInterval(keepAlive);
          keepAlive = undefined;
        }
        offTaskEvent(taskHandler);
        offChatEvent(chatHandler);
        unregisterProfileStream();
        request.signal.removeEventListener("abort", abortHandler);
        if (closeStream) {
          try {
            controller.close();
          } catch {
            // cancel() may already have closed the stream.
          }
        }
      };

      const enqueue = (message: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(message));
        } catch {
          cleanup();
        }
      };

      // Subscribe to task events
      const taskHandler = (event: TaskEvent) => {
        if (event.profileKey !== profileKey) return;
        enqueue(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      };

      // Subscribe to chat events
      const chatHandler = (event: ChatEvent) => {
        if (event.profileKey !== profileKey) return;
        enqueue(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      };

      onTaskEvent(taskHandler);
      onChatEvent(chatHandler);
      unregisterProfileStream = registerProfileEventStream(profileKey, cleanup);

      request.signal.addEventListener("abort", abortHandler, { once: true });
      if (request.signal.aborted) {
        cleanup();
        return;
      }

      enqueue(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString(), profileKey })}\n\n`);
      if (closed) return;

      keepAlive = setInterval(() => {
        enqueue(": keep-alive\n\n");
      }, 30000);
    },
    cancel() {
      cleanup(false);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

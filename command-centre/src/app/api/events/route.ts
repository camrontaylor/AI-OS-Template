import { onTaskEvent, offTaskEvent, onChatEvent, offChatEvent } from "@/lib/event-bus";
import type { TaskEvent, ChatEvent } from "@/lib/event-bus";
import { startCronTaskSync } from "@/lib/cron-task-sync";

export const dynamic = "force-dynamic";

export async function GET() {
  // Start the cron-task sync poller when the first SSE client connects.
  startCronTaskSync();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connected event
      const connectMsg = `event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`;
      controller.enqueue(encoder.encode(connectMsg));

      // Subscribe to task events
      const taskHandler = (event: TaskEvent) => {
        try {
          const msg = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(msg));
        } catch {
          // Client disconnected, clean up
          offTaskEvent(taskHandler);
          offChatEvent(chatHandler);
        }
      };

      // Subscribe to chat events
      const chatHandler = (event: ChatEvent) => {
        try {
          const msg = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(msg));
        } catch {
          offTaskEvent(taskHandler);
          offChatEvent(chatHandler);
        }
      };

      onTaskEvent(taskHandler);
      onChatEvent(chatHandler);

      // Clean up on cancel (client disconnect)
      const checkClosed = setInterval(() => {
        try {
          // Send a keep-alive comment every 30s
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          clearInterval(checkClosed);
          offTaskEvent(taskHandler);
          offChatEvent(chatHandler);
        }
      }, 30000);

      // Store cleanup references for when the stream is cancelled
      (controller as unknown as Record<string, unknown>)._cleanup = () => {
        clearInterval(checkClosed);
        offTaskEvent(taskHandler);
        offChatEvent(chatHandler);
      };
    },
    cancel(controller) {
      const cleanup = (controller as unknown as Record<string, unknown>)
        ?._cleanup as (() => void) | undefined;
      if (cleanup) cleanup();
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

import { registerProfileEventStream } from "@/lib/event-bus";
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
import { resolveTaskWorkspace } from "@/lib/task-file-access";
import { workspaceFileWatcher } from "@/lib/workspace-file-watcher";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params;
  const context = resolveTaskWorkspace(id);
  if (!context) return Response.json({ error: "Task not found" }, { status: 404 });

  const encoder = new TextEncoder();
  let cleanup = (_closeStream = true) => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let keepAlive: ReturnType<typeof setInterval> | undefined;
      let unsubscribeWatcher = () => {};
      let unregisterProfileStream = () => {};
      const abortHandler = () => cleanup(false);

      cleanup = (closeStream = true) => {
        if (closed) return;
        closed = true;
        if (keepAlive) clearInterval(keepAlive);
        keepAlive = undefined;
        unsubscribeWatcher();
        unregisterProfileStream();
        request.signal.removeEventListener("abort", abortHandler);
        if (closeStream) {
          try { controller.close(); } catch { /* stream already closed */ }
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

      unsubscribeWatcher = workspaceFileWatcher.subscribe({
        profileKey,
        baseDir: context.baseDir,
        onChange: (event) => {
          enqueue(`event: ${event.type}\ndata: ${JSON.stringify({ directory: event.directory })}\n\n`);
        },
      });
      unregisterProfileStream = registerProfileEventStream(profileKey, cleanup);
      request.signal.addEventListener("abort", abortHandler, { once: true });
      if (request.signal.aborted) {
        cleanup();
        return;
      }

      enqueue(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
      if (closed) return;
      keepAlive = setInterval(() => enqueue(": keep-alive\n\n"), 30000);
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

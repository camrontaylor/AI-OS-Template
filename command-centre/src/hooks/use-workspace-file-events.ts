"use client";

import { useEffect, useRef } from "react";

type ParsedWorkspaceFileEvent =
  | { type: "connected" }
  | { type: "workspace:directory-changed"; directory: string };

export function parseWorkspaceFileEventBlock(block: string): ParsedWorkspaceFileEvent | null {
  if (!block || block.startsWith(":")) return null;
  const lines = block.replace(/\r\n/g, "\n").split("\n");
  const eventType = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
  if (eventType === "connected") return { type: "connected" };
  if (eventType !== "workspace:directory-changed") return null;
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as { directory?: unknown };
    if (typeof parsed.directory !== "string") return null;
    const slashPath = parsed.directory.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
    if (slashPath.split("/").includes("..") || /^[a-zA-Z]:/.test(slashPath)) return null;
    return { type: "workspace:directory-changed", directory: slashPath };
  } catch {
    return null;
  }
}

export function useWorkspaceFileEvents({
  taskId,
  onDirectoryChanged,
  onReconnect,
}: {
  taskId: string;
  onDirectoryChanged: (directory: string) => void;
  onReconnect: () => void;
}) {
  const onDirectoryChangedRef = useRef(onDirectoryChanged);
  const onReconnectRef = useRef(onReconnect);
  onDirectoryChangedRef.current = onDirectoryChanged;
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    let disposed = false;
    let connectedBefore = false;
    let retryDelay = 1000;
    let controller: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      controller = new AbortController();
      try {
        const response = await fetch(`/api/tasks/${taskId}/files/events`, {
          signal: controller.signal,
          headers: { accept: "text/event-stream" },
          cache: "no-store",
        });
        if (!response.ok || !response.body) {
          if (response.status >= 400 && response.status < 500) return;
          throw new Error("Workspace file events are unavailable");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!disposed && !controller.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");
            const event = parseWorkspaceFileEventBlock(block);
            if (event?.type === "connected") {
              retryDelay = 1000;
              if (connectedBefore) onReconnectRef.current();
              connectedBefore = true;
            } else if (event?.type === "workspace:directory-changed") {
              onDirectoryChangedRef.current(event.directory);
            }
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn("[workspace-file-events] Connection closed", error instanceof Error ? error.message : error);
        }
      }

      if (!disposed && !controller.signal.aborted) {
        const delay = retryDelay;
        retryDelay = Math.min(retryDelay * 2, 30000);
        retryTimer = setTimeout(() => void connect(), delay);
      }
    };

    void connect();
    return () => {
      disposed = true;
      controller?.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [taskId]);
}

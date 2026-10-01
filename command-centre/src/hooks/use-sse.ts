"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTaskStore } from "@/store/task-store";
import { useClientStore } from "@/store/client-store";
import { useChatStore } from "@/store/chat-store";

const TASK_EVENTS = new Set([
  "task:created",
  "task:updated",
  "task:deleted",
  "task:status",
  "task:progress",
  "task:output",
  "task:question",
  "task:log",
]);
const CHAT_EVENTS = new Set(["chat:message", "chat:decision"]);

export function useSSE() {
  const [isConnected, setIsConnected] = useState(false);
  const retryDelay = useRef(3000);
  const abortRef = useRef<AbortController | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applySSEEvent = useTaskStore((state) => state.applySSEEvent);
  const applyChatSSE = useChatStore((state) => state.applyChatSSE);

  const connect = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/events", {
        signal: controller.signal,
        headers: { accept: "text/event-stream" },
        cache: "no-store",
      });
      if (!response.ok || !response.body) throw new Error("SSE unavailable");
      setIsConnected(true);
      retryDelay.current = 3000;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!controller.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
          if (!block || block.startsWith(":")) continue;
          const eventType = block.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
          const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
          if (!eventType || !data) continue;
          if (eventType === "connected") continue;
          try {
            const event = JSON.parse(data);
            if (TASK_EVENTS.has(eventType)) {
              const activeClientSlugs = useClientStore.getState().activeClientSlugs;
              if (activeClientSlugs !== null) {
                const eventClientSlug = event.task?.clientId ?? "_root";
                if (!activeClientSlugs.includes(eventClientSlug)) continue;
              }
              applySSEEvent(event);
            } else if (CHAT_EVENTS.has(eventType)) {
              applyChatSSE(event);
            }
          } catch {
            // Ignore malformed events.
          }
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn("[sse] connection closed", error instanceof Error ? error.message : error);
    }

    if (!controller.signal.aborted) {
      setIsConnected(false);
      const delay = retryDelay.current;
      retryDelay.current = Math.min(delay * 2, 30000);
      retryTimerRef.current = setTimeout(() => void connect(), delay);
    }
  }, [applySSEEvent, applyChatSSE]);

  useEffect(() => {
    void connect();
    return () => {
      abortRef.current?.abort();
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [connect]);

  return { isConnected };
}

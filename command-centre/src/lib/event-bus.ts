import { EventEmitter } from "events";
import type { Task } from "@/types/task";
import { getActiveLocalProfileDescriptor } from "@/lib/db";
import { normalizeWorkScopedRow } from "@/lib/identity/work-scope";

export type TaskEventType =
  | "task:created"
  | "task:updated"
  | "task:deleted"
  | "task:status"
  | "task:progress"
  | "task:output"
  | "task:question"
  | "task:log"
  | "chat:message"
  | "chat:decision";

export interface TaskEvent {
  profileKey: string;
  type: TaskEventType;
  task: Task;
  timestamp: string;
  questionText?: string;
  logEntry?: import("@/types/task").LogEntry;
}

// Use globalThis to ensure a single EventEmitter instance across all
// Next.js module instances (route handlers, instrumentation, etc.)
// Without this, dev mode / Turbopack creates separate instances per import.
const globalKey = "__command_centre_event_bus__";
const globalObj = globalThis as Record<string, unknown>;
if (!globalObj[globalKey]) {
  const em = new EventEmitter();
  em.setMaxListeners(100);
  globalObj[globalKey] = em;
}
const emitter = globalObj[globalKey] as EventEmitter;
const profileStreamClosersKey = "__command_centre_profile_stream_closers__";
if (!globalObj[profileStreamClosersKey]) {
  globalObj[profileStreamClosersKey] = new Map<string, Set<() => void>>();
}
const profileStreamClosers = globalObj[profileStreamClosersKey] as Map<string, Set<() => void>>;

type TaskEventCallback = (event: TaskEvent) => void;

export function emitTaskEvent(event: Omit<TaskEvent, "profileKey"> & { profileKey?: string }): void {
  const task = normalizeWorkScopedRow(event.task as Task & { workScope?: string | null }) as Task;
  const scopedEvent: TaskEvent = {
    ...event,
    task,
    profileKey: event.profileKey ?? getActiveLocalProfileDescriptor().profileKey,
  };
  const count = emitter.listenerCount("task-event");
  console.log(`[event-bus] Emitting ${scopedEvent.type} for task ${scopedEvent.task.id.slice(0, 8)} (${count} listeners)`);
  emitter.emit("task-event", scopedEvent);
}

export function onTaskEvent(callback: TaskEventCallback): void {
  emitter.on("task-event", callback);
}

export function offTaskEvent(callback: TaskEventCallback): void {
  emitter.off("task-event", callback);
}

// --------------- Chat events ---------------

export interface ChatEvent {
  profileKey: string;
  type: "chat:message" | "chat:decision" | "chat:typing";
  conversationId: string;
  message?: import("@/types/chat").Message;
  decision?: import("@/types/chat").AgentDecision;
  timestamp: string;
}

type ChatEventCallback = (event: ChatEvent) => void;

export function emitChatEvent(event: Omit<ChatEvent, "profileKey"> & { profileKey?: string }): void {
  const scopedEvent: ChatEvent = {
    ...event,
    profileKey: event.profileKey ?? getActiveLocalProfileDescriptor().profileKey,
  };
  const count = emitter.listenerCount("chat-event");
  console.log(`[event-bus] Emitting ${scopedEvent.type} for conversation ${scopedEvent.conversationId.slice(0, 8)} (${count} listeners)`);
  emitter.emit("chat-event", scopedEvent);
}

export function onChatEvent(callback: ChatEventCallback): void {
  emitter.on("chat-event", callback);
}

export function offChatEvent(callback: ChatEventCallback): void {
  emitter.off("chat-event", callback);
}

export function registerProfileEventStream(profileKey: string, close: () => void): () => void {
  const closers = profileStreamClosers.get(profileKey) ?? new Set<() => void>();
  closers.add(close);
  profileStreamClosers.set(profileKey, closers);
  return () => {
    closers.delete(close);
    if (closers.size === 0) profileStreamClosers.delete(profileKey);
  };
}

export function closeProfileEventStreams(profileKey: string): void {
  const closers = profileStreamClosers.get(profileKey);
  if (!closers) return;
  profileStreamClosers.delete(profileKey);
  for (const close of closers) {
    try { close(); } catch { /* stream already closed */ }
  }
}

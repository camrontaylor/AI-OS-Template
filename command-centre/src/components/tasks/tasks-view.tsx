"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  ArrowUp,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  ExternalLink,
  Eye,
  Layers,
} from "lucide-react";
import { useTaskStore } from "@/store/task-store";
import type { Task, LogEntry, TaskLevel } from "@/types/task";
import { LevelBadge } from "@/components/board/level-badge";

// ─── Formatters ──────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatElapsedLive(startedAt: string | null): string {
  if (!startedAt) return "...";
  const start = new Date(startedAt).getTime();
  if (isNaN(start)) return "...";
  const ms = Math.max(0, Date.now() - start);
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return `${min}m ${rem.toString().padStart(2, "0")}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h ${remMin}m`;
}

/** Extract the action summary — what does the operator need to do? */
function getActionSummary(task: Task, logEntries: LogEntry[]): string | null {
  if (task.errorMessage) {
    return `Error: ${task.errorMessage.length > 120 ? task.errorMessage.slice(0, 120) + "..." : task.errorMessage}`;
  }

  // Review tasks are completed — show completion message.
  // Only show question text for tasks genuinely waiting for input (running + needsInput).
  if (task.status === "review") {
    return "Claude has finished — review the outputs and mark as done.";
  }

  if (task.status === "running" && task.needsInput) {
    // Find the last question Claude asked
    const lastQuestion = [...logEntries]
      .reverse()
      .find((e) => e.type === "question");
    if (lastQuestion) {
      const content = lastQuestion.content.trim();
      return content.length > 160 ? content.slice(0, 160).trimEnd() + "..." : content;
    }
    return "Claude is waiting for your input to continue.";
  }

  return null;
}

// ─── Inline reply ────────────────────────────────────────────────────────────

function InlineReply({ taskId }: { taskId: string }) {
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const appendLogEntry = useTaskStore((s) => s.appendLogEntry);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed || isSending) return;
    setIsSending(true);

    const entry: LogEntry = {
      id: "local-" + crypto.randomUUID(),
      type: "user_reply",
      timestamp: new Date().toISOString(),
      content: trimmed,
    };
    appendLogEntry(taskId, entry);
    setMessage("");

    try {
      const res = await fetch(`/api/tasks/${taskId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      if (!res.ok) console.error("Reply failed:", await res.text());
    } catch (err) {
      console.error("Reply error:", err);
    } finally {
      setIsSending(false);
    }
  }, [message, isSending, taskId, appendLogEntry]);

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-end",
        padding: "12px 16px",
        backgroundColor: "var(--card)",
        borderRadius: 8,
        border: "1px solid color-mix(in srgb, var(--foreground) 20%, transparent)",
      }}
    >
      <textarea
        ref={textareaRef}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder="Reply to this task..."
        rows={1}
        style={{
          flex: 1,
          resize: "none",
          border: "none",
          outline: "none",
          backgroundColor: "transparent",
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 13,
          color: "var(--foreground)",
          lineHeight: "20px",
        }}
      />
      <button
        onClick={handleSubmit}
        disabled={!message.trim() || isSending}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: 6,
          border: "none",
          backgroundColor: message.trim() ? "var(--primary)" : "var(--border)",
          color: message.trim() ? "var(--card)" : "var(--muted-foreground)",
          cursor: message.trim() ? "pointer" : "default",
          flexShrink: 0,
          transition: "all 150ms ease",
        }}
      >
        <ArrowUp size={14} />
      </button>
    </div>
  );
}

// ─── Expanded detail ─────────────────────────────────────────────────────────

function TaskDetail({ task, parentTask }: { task: Task; parentTask: Task | null }) {
  const allLogEntries = useTaskStore((s) => s.logEntries);
  const fetchLogEntries = useTaskStore((s) => s.fetchLogEntries);
  const openPanel = useTaskStore((s) => s.openPanel);
  const updateTask = useTaskStore((s) => s.updateTask);
  const logEntries = allLogEntries[task.id] ?? [];

  useEffect(() => {
    fetchLogEntries(task.id);
  }, [task.id, fetchLogEntries]);

  const recentEntries = logEntries
    .filter((e) => ["text", "question", "user_reply"].includes(e.type))
    .slice(-5);

  const isWaitingForInput = task.status === "running" && task.needsInput === true;
  const needsHuman = task.status === "review" || isWaitingForInput;
  const actionSummary = getActionSummary(task, logEntries);

  return (
    <div
      style={{
        padding: "16px 20px 20px 52px",
        borderTop: "1px solid color-mix(in srgb, var(--foreground) 15%, transparent)",
        backgroundColor: "var(--muted)",
      }}
    >
      {/* Action summary — the key thing the operator needs to know */}
      {actionSummary && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "12px 16px",
            backgroundColor: task.errorMessage ? "var(--card)" : "var(--card)",
            borderRadius: 8,
            border: `1px solid ${task.errorMessage ? "color-mix(in srgb, var(--foreground) 15%, transparent)" : "color-mix(in srgb, var(--foreground) 15%, transparent)"}`,
            marginBottom: 16,
          }}
        >
          {task.errorMessage ? (
            <AlertCircle size={14} color="var(--destructive)" style={{ flexShrink: 0, marginTop: 2 }} />
          ) : (
            <Eye size={14} color="var(--primary)" style={{ flexShrink: 0, marginTop: 2 }} />
          )}
          <div
            style={{
              fontSize: 13,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              color: task.errorMessage ? "var(--destructive)" : "var(--foreground)",
              lineHeight: "20px",
            }}
          >
            {actionSummary}
          </div>
        </div>
      )}

      {/* Description */}
      {task.description && (
        <div
          style={{
            fontSize: 13,
            color: "var(--muted-foreground)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            marginBottom: 12,
            lineHeight: "20px",
            whiteSpace: "pre-wrap",
            maxHeight: 80,
            overflow: "hidden",
          }}
        >
          {task.description}
        </div>
      )}

      {/* Recent activity log */}
      {recentEntries.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={sectionLabel}>Recent activity</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {recentEntries.map((entry) => (
              <div
                key={entry.id}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  padding: "3px 0",
                }}
              >
                <span style={timeCell}>
                  {new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <DigestIcon type={entry.type as "text" | "question" | "reply"} />
                <div
                  style={{
                    fontSize: 13,
                    color: entry.type === "user_reply" ? "var(--primary)" : entry.type === "question" ? "var(--primary)" : "var(--muted-foreground)",
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontWeight: entry.type === "question" ? 500 : 400,
                    lineHeight: "18px",
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical" as const,
                    flex: 1,
                  }}
                >
                  {entry.type === "user_reply" && (
                    <span style={{ fontWeight: 600, marginRight: 4 }}>You:</span>
                  )}
                  {entry.content}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reply input — only for tasks genuinely waiting for input (running + needsInput) */}
      {isWaitingForInput && <InlineReply taskId={task.id} />}

      {/* Action buttons row */}
      <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center" }}>
        {task.status === "review" && (
          <button
            onClick={() => updateTask(task.id, { status: "done" })}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              backgroundColor: "var(--muted-foreground)",
              color: "var(--card)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 150ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--muted-foreground)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--muted-foreground)"; }}
          >
            <CheckCircle2 size={13} />
            Mark as done
          </button>
        )}
        <button
          onClick={() => openPanel(task.id)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 16px",
            borderRadius: 8,
            border: "1px solid color-mix(in srgb, var(--foreground) 20%, transparent)",
            backgroundColor: "var(--card)",
            color: "var(--primary)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 150ms ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--muted)"; e.currentTarget.style.borderColor = "var(--primary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--card)"; e.currentTarget.style.borderColor = "color-mix(in srgb, var(--foreground) 20%, transparent)"; }}
        >
          <ExternalLink size={13} />
          Open full detail
        </button>
      </div>
    </div>
  );
}

function DigestIcon({ type }: { type: "text" | "question" | "reply" }) {
  const s = { flexShrink: 0, marginTop: 2 } as const;
  switch (type) {
    case "text": return <MessageSquare size={13} color="var(--muted-foreground)" style={s} />;
    case "question": return <Eye size={13} color="var(--primary)" style={s} />;
    case "reply": return <MessageSquare size={13} color="var(--primary)" style={s} />;
  }
}

// ─── Task row ────────────────────────────────────────────────────────────────

function TaskRow({ task, parentTask }: { task: Task; parentTask: Task | null }) {
  const [expanded, setExpanded] = useState(false);
  const [, setTick] = useState(0);
  const allLogEntries = useTaskStore((s) => s.logEntries);
  const fetchLogEntries = useTaskStore((s) => s.fetchLogEntries);
  const updateTask = useTaskStore((s) => s.updateTask);

  const isRunning = task.status === "running" && !task.needsInput;
  const isWaitingForInput = task.status === "running" && task.needsInput === true;
  const isReview = task.status === "review";
  const needsHuman = isReview || isWaitingForInput;
  const hasError = task.errorMessage !== null;

  // Pre-fetch logs for action summary even when collapsed
  useEffect(() => {
    if (needsHuman || hasError) {
      fetchLogEntries(task.id);
    }
  }, [task.id, needsHuman, hasError, fetchLogEntries]);

  const logEntries = allLogEntries[task.id] ?? [];
  const actionSummary = (needsHuman || hasError) ? getActionSummary(task, logEntries) : null;

  // Tick for live elapsed time
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  return (
    <div
      style={{
        backgroundColor: "var(--card)",
        borderRadius: 10,
        border: needsHuman
          ? "1.5px dashed color-mix(in srgb, var(--foreground) 50%, transparent)"
          : hasError
            ? "1px solid color-mix(in srgb, var(--foreground) 25%, transparent)"
            : "1px solid color-mix(in srgb, var(--foreground) 15%, transparent)",
        overflow: "hidden",
        opacity: isRunning ? 0.75 : 1,
        transition: "all 150ms ease",
      }}
    >
      {/* Main row */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 20px",
          cursor: "pointer",
          transition: "background 100ms ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 6%, transparent)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
      >
        {/* Expand chevron */}
        <span style={{ flexShrink: 0, color: "var(--muted-foreground)" }}>
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>

        {/* Status indicator */}
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            flexShrink: 0,
            backgroundColor: needsHuman
              ? "var(--primary)"
              : isRunning
                ? "var(--primary)"
                : hasError
                  ? "var(--destructive)"
                  : "var(--muted-foreground)",
            animation: (needsHuman || isRunning) ? "pulse-dot 2s ease-in-out infinite" : undefined,
          }}
        />

        {/* Title + parent breadcrumb + level */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: 14,
                fontWeight: 500,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                color: "var(--foreground)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {task.title}
            </span>
            <LevelBadge level={task.level} />
          </div>
          {/* Parent breadcrumb */}
          {parentTask && (
            <div
              style={{
                fontSize: 11,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                color: "var(--muted-foreground)",
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              ↳ {parentTask.title}
            </div>
          )}
          {/* Action summary preview — visible when collapsed */}
          {!expanded && actionSummary && (
            <div
              style={{
                fontSize: 12,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                color: hasError ? "var(--destructive)" : "var(--primary)",
                marginTop: 3,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {actionSummary}
            </div>
          )}
        </div>

        {/* Live status label */}
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            color: isWaitingForInput ? "var(--primary)" : isReview ? "var(--primary)" : isRunning ? "var(--primary)" : hasError ? "var(--destructive)" : "var(--muted-foreground)",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          {isWaitingForInput
            ? "Awaiting input"
            : isReview
              ? "Ready for review"
              : isRunning
                ? task.activityLabel || "Working..."
                : hasError
                  ? "Error"
                  : "Done"}
        </span>

        {/* Mark as done — quick action for review tasks */}
        {task.status === "review" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              updateTask(task.id, { status: "done" });
            }}
            title="Mark as done"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "4px 12px",
              borderRadius: 6,
              border: "none",
              backgroundColor: "color-mix(in srgb, var(--foreground) 10%, transparent)",
              color: "var(--muted-foreground)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              flexShrink: 0,
              transition: "all 150ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--muted-foreground)"; e.currentTarget.style.color = "var(--card)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 10%, transparent)"; e.currentTarget.style.color = "var(--muted-foreground)"; }}
          >
            <CheckCircle2 size={12} />
            Done
          </button>
        )}

        {/* Time — show last reply time when available, otherwise updated time */}
        <span
          style={{
            fontSize: 11,
            color: "var(--muted-foreground)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {task.lastReplyAt ? (
            <>
              <MessageSquare size={10} />
              You · {timeAgo(task.lastReplyAt)}
            </>
          ) : (
            <>
              <Clock size={11} />
              {isRunning ? formatElapsedLive(task.startedAt) : timeAgo(task.updatedAt)}
            </>
          )}
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && <TaskDetail task={task} parentTask={parentTask} />}
    </div>
  );
}

// ─── Task grouping ──────────────────────────────────────────────────────────

interface TaskGroup {
  key: string;
  parent: Task | null;
  children: Task[];
}

const QUICK_TASKS_KEY = "__quick_tasks__";

function groupTasksByProject(
  tasks: Task[],
  taskById: Map<string, Task>
): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();

  // First pass: identify parent tasks (project/gsd level) and seed groups
  for (const t of tasks) {
    if (t.level === "project" || t.level === "gsd") {
      if (!groups.has(t.id)) {
        groups.set(t.id, { key: t.id, parent: t, children: [] });
      } else {
        groups.get(t.id)!.parent = t;
      }
    }
  }

  // Second pass: assign children by parentId
  for (const t of tasks) {
    if (t.parentId) {
      const parentKey = t.parentId;
      if (!groups.has(parentKey)) {
        const parent = taskById.get(parentKey) ?? null;
        groups.set(parentKey, { key: parentKey, parent, children: [] });
      }
      groups.get(parentKey)!.children.push(t);
    } else if (t.projectSlug && t.level === "task") {
      // Task with projectSlug but no parentId — find parent by projectSlug
      const parentEntry = tasks.find(
        (p) => p.projectSlug === t.projectSlug && (p.level === "project" || p.level === "gsd")
      );
      if (parentEntry) {
        if (!groups.has(parentEntry.id)) {
          groups.set(parentEntry.id, { key: parentEntry.id, parent: parentEntry, children: [] });
        }
        groups.get(parentEntry.id)!.children.push(t);
      }
    }
  }

  // Collect unassigned tasks
  const assignedIds = new Set<string>();
  for (const g of groups.values()) {
    if (g.parent) assignedIds.add(g.parent.id);
    for (const c of g.children) assignedIds.add(c.id);
  }

  // Group unassigned tasks by goalGroup (semantic AI clustering)
  const goalBuckets = new Map<string, Task[]>();
  const orphans: Task[] = [];
  for (const t of tasks) {
    if (assignedIds.has(t.id)) continue;
    if (t.goalGroup) {
      if (!goalBuckets.has(t.goalGroup)) goalBuckets.set(t.goalGroup, []);
      goalBuckets.get(t.goalGroup)!.push(t);
    } else {
      orphans.push(t);
    }
  }

  const result = Array.from(groups.values());

  // Add goal groups as virtual groups (no parent task — label comes from goalGroup)
  for (const [goal, goalTasks] of goalBuckets) {
    // Create a virtual parent-like task for the header display
    const virtualParent: Task = {
      ...goalTasks[0],
      id: `goal:${goal}`,
      title: goal,
      level: "task",
      parentId: null,
      status: "running",
    };
    result.push({ key: `goal:${goal}`, parent: virtualParent, children: goalTasks });
  }

  if (orphans.length > 0) {
    result.push({ key: QUICK_TASKS_KEY, parent: null, children: orphans });
  }

  return result;
}

/** Compute urgency score for a group (lower = more urgent) */
function groupUrgency(group: TaskGroup): number {
  const allTasks = group.parent ? [group.parent, ...group.children] : group.children;
  let hasError = false;
  let hasInput = false;
  let hasReview = false;
  let hasRunning = false;

  for (const t of allTasks) {
    if (t.errorMessage) hasError = true;
    if (t.status === "running" && t.needsInput) hasInput = true;
    if (t.status === "review") hasReview = true;
    if (t.status === "running" && !t.needsInput) hasRunning = true;
  }

  if (hasError) return 0;
  if (hasInput) return 1;
  if (hasReview) return 2;
  if (hasRunning) return 3;
  return 4;
}

function groupLatestTime(group: TaskGroup): number {
  const allTasks = group.parent ? [group.parent, ...group.children] : group.children;
  let latest = 0;
  for (const t of allTasks) {
    const time = new Date(t.lastReplyAt || t.updatedAt).getTime();
    if (time > latest) latest = time;
  }
  return latest;
}

function sortGroups(groups: TaskGroup[]): TaskGroup[] {
  // Quick tasks always last
  const quickTasks = groups.find((g) => g.key === QUICK_TASKS_KEY);
  const projectGroups = groups.filter((g) => g.key !== QUICK_TASKS_KEY);

  projectGroups.sort((a, b) => {
    const ua = groupUrgency(a);
    const ub = groupUrgency(b);
    if (ua !== ub) return ua - ub;
    return groupLatestTime(b) - groupLatestTime(a);
  });

  if (quickTasks) projectGroups.push(quickTasks);
  return projectGroups;
}

// ─── Project group header ───────────────────────────────────────────────────

const LEVEL_ACCENT: Record<string, string> = {
  gsd: "var(--muted-foreground)",    // purple for GSD
  project: "var(--muted-foreground)", // blue for project
};

function ProjectGroupHeader({
  group,
  isExpanded,
  onToggle,
}: {
  group: TaskGroup;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const openPanel = useTaskStore((s) => s.openPanel);
  const parent = group.parent;
  const isQuickTasks = group.key === QUICK_TASKS_KEY;
  const isGoalGroup = group.key.startsWith("goal:");

  if (isQuickTasks) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 0",
          marginTop: 8,
          cursor: "pointer",
        }}
        onClick={onToggle}
      >
        <span style={{ flexShrink: 0, color: "var(--muted-foreground)" }}>
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <Layers size={14} color="var(--muted-foreground)" />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: "var(--muted-foreground)",
          }}
        >
          Quick Tasks
        </span>
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            color: "var(--muted-foreground)",
            backgroundColor: "var(--border)",
            padding: "2px 10px",
            borderRadius: 10,
            fontWeight: 500,
          }}
        >
          {group.children.length}
        </span>
      </div>
    );
  }

  const level: TaskLevel = parent?.level ?? "project";
  const accent = isGoalGroup ? "var(--primary)" : (LEVEL_ACCENT[level] ?? "var(--muted-foreground)");
  const allTasks = parent ? [parent, ...group.children] : group.children;
  const doneCount = allTasks.filter((t) => t.status === "done").length;
  const totalCount = allTasks.length;
  const progressPct = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;

  // GSD phase context
  const phaseLabel =
    parent?.level === "gsd" && parent.phaseNumber != null
      ? `Phase ${parent.phaseNumber}${parent.gsdStep ? ` — ${parent.gsdStep.charAt(0).toUpperCase() + parent.gsdStep.slice(1)}` : ""}`
      : null;

  return (
    <div
      style={{
        backgroundColor: "color-mix(in srgb, var(--foreground) 3%, transparent)",
        borderRadius: 10,
        borderLeft: `3px solid ${accent}`,
        overflow: "hidden",
        marginBottom: 2,
      }}
    >
      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 16px",
          cursor: "pointer",
          transition: "background 100ms ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 5%, transparent)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
      >
        {/* Collapse toggle */}
        <span style={{ flexShrink: 0, color: "var(--muted-foreground)" }}>
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>

        {/* Left: name, badge, phase */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              color: "var(--foreground)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {parent?.title ?? "Project"}
          </span>
          {isGoalGroup ? (
            <span
              style={{
                display: "inline-block",
                fontSize: 9,
                fontWeight: 600,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                padding: "2px 6px",
                borderRadius: 3,
                backgroundColor: "color-mix(in srgb, var(--foreground) 8%, transparent)",
                color: "var(--primary)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Goal
            </span>
          ) : (
            <LevelBadge level={level} />
          )}
          {!isGoalGroup && phaseLabel && (
            <span
              style={{
                fontSize: 11,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                color: "var(--muted-foreground)",
                whiteSpace: "nowrap",
              }}
            >
              {phaseLabel}
            </span>
          )}
        </div>

        {/* Right: progress pill */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              color: "var(--muted-foreground)",
              whiteSpace: "nowrap",
            }}
          >
            {doneCount}/{totalCount} done
          </span>
          <div
            style={{
              width: 60,
              height: 4,
              borderRadius: 2,
              backgroundColor: "var(--border)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${progressPct}%`,
                height: "100%",
                borderRadius: 2,
                backgroundColor: "var(--muted-foreground)",
                transition: "width 300ms ease",
              }}
            />
          </div>
        </div>

        {/* Open parent panel — not for goal groups (virtual parent) */}
        {parent && !isGoalGroup && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              openPanel(parent.id);
            }}
            title="Open project detail"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
              borderRadius: 6,
              border: "none",
              backgroundColor: "transparent",
              color: "var(--muted-foreground)",
              cursor: "pointer",
              flexShrink: 0,
              transition: "all 150ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = accent; e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 4%, transparent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--muted-foreground)"; e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            <ExternalLink size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Grouped task list ──────────────────────────────────────────────────────

function GroupedTaskList({
  tasks,
  taskById,
}: {
  tasks: Task[];
  taskById: Map<string, Task>;
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const groups = sortGroups(groupTasksByProject(tasks, taskById));

  // If there are no project groups (only quick tasks or empty), render flat
  const hasProjectGroups = groups.some((g) => g.key !== QUICK_TASKS_KEY);
  if (!hasProjectGroups && groups.length <= 1) {
    // All orphans, no grouping needed — render flat
    const orphans = groups[0]?.children ?? [];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {orphans.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            parentTask={task.parentId ? taskById.get(task.parentId) ?? null : null}
          />
        ))}
      </div>
    );
  }

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {groups.map((group) => {
        const isExpanded = collapsedGroups[group.key] !== true; // default expanded
        // For project groups, show children (not the parent as a row — it's in the header)
        // For quick tasks, show all children
        const visibleTasks = group.children;

        return (
          <div key={group.key}>
            <ProjectGroupHeader
              group={group}
              isExpanded={isExpanded}
              onToggle={() => toggleGroup(group.key)}
            />
            {isExpanded && visibleTasks.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  paddingLeft: group.key !== QUICK_TASKS_KEY ? 16 : 0,
                  marginTop: 4,
                  marginBottom: 8,
                }}
              >
                {visibleTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    parentTask={task.parentId ? taskById.get(task.parentId) ?? null : null}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Section header ──────────────────────────────────────────────────────────

function SectionHeader({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 10,
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: color,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--foreground)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 11,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          color: "var(--muted-foreground)",
          backgroundColor: "var(--border)",
          padding: "2px 10px",
          borderRadius: 10,
          fontWeight: 500,
        }}
      >
        {count}
      </span>
    </div>
  );
}

// ─── Main view ───────────────────────────────────────────────────────────────

/** Check if a task needs human attention */
function isWaitingTask(t: Task): boolean {
  return t.status === "review" || (t.status === "running" && t.needsInput === true) || t.errorMessage !== null;
}

/** Check if a task is actively running (Claude's turn) */
function isRunningTask(t: Task): boolean {
  return t.status === "running" && !t.needsInput && !t.errorMessage;
}

export function TasksView() {
  const tasks = useTaskStore((s) => s.tasks);

  const taskById = new Map(tasks.map((t) => [t.id, t]));

  // Filter tasks into "Your Turn" and "Claude's Turn" categories
  const waitingTasks = tasks
    .filter(isWaitingTask)
    .sort((a, b) => {
      const aIsInput = a.status === "running" && a.needsInput;
      const bIsInput = b.status === "running" && b.needsInput;
      const aWeight = a.errorMessage ? 0 : (aIsInput) ? 1 : (a.status === "review") ? 2 : 3;
      const bWeight = b.errorMessage ? 0 : (bIsInput) ? 1 : (b.status === "review") ? 2 : 3;
      if (aWeight !== bWeight) return aWeight - bWeight;
      const aTime = new Date(a.lastReplyAt || a.updatedAt).getTime();
      const bTime = new Date(b.lastReplyAt || b.updatedAt).getTime();
      return bTime - aTime;
    });

  const runningTasks = tasks
    .filter(isRunningTask)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const isEmpty = waitingTasks.length === 0 && runningTasks.length === 0;

  return (
    <div>
      {isEmpty ? (
        <div
          style={{
            padding: "64px 24px",
            textAlign: "center",
            color: "var(--muted-foreground)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 14,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <CheckCircle2 size={32} color="var(--muted-foreground)" strokeWidth={1.5} />
            <span>Nothing active right now</span>
          </div>
        </div>
      ) : (
        <>
          {/* Waiting on you — grouped by project */}
          {waitingTasks.length > 0 && (
            <div style={{ marginBottom: runningTasks.length > 0 ? 24 : 0 }}>
              <SectionHeader label="Waiting on you" count={waitingTasks.length} color="var(--primary)" />
              <GroupedTaskList tasks={waitingTasks} taskById={taskById} />
            </div>
          )}

          {/* Running in background — grouped by project */}
          {runningTasks.length > 0 && (
            <div>
              <SectionHeader label="Running" count={runningTasks.length} color="var(--primary)" />
              <GroupedTaskList tasks={runningTasks} taskById={taskById} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Shared styles ───────────────────────────────────────────────────────────

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontFamily: "var(--font-inter), Inter, sans-serif",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--muted-foreground)",
  fontWeight: 600,
  marginBottom: 8,
};

const timeCell: React.CSSProperties = {
  fontSize: 10,
  color: "var(--muted-foreground)",
  fontFamily: "var(--font-inter), Inter, sans-serif",
  flexShrink: 0,
  marginTop: 2,
  width: 40,
};

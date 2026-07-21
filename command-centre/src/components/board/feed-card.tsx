"use client";

import { useState, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2, CheckCircle2, Square } from "lucide-react";
import type { Task } from "@/types/task";
import { useTaskStore } from "@/store/task-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return `${min}m ${rem.toString().padStart(2, "0")}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h ${remMin}m`;
}

function timeAgo(dateStr: string): string {
  const ts = new Date(dateStr).getTime();
  if (isNaN(ts)) return "--";
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Show Claude's actual compute time, not wall-clock.
 * Only adds live elapsed when the task has been recently updated (< 5 min),
 * indicating Claude is actively processing. Otherwise shows static durationMs.
 * Uses updatedAt (set when each turn starts) as the turn-start proxy, not
 * startedAt which reflects when the task was first created.
 */
function formatLiveClaudeTime(task: Task): string {
  const accumulated = task.durationMs ?? 0;

  const lastUpdate = new Date(task.updatedAt).getTime();
  if (isNaN(lastUpdate) || Date.now() - lastUpdate > 5 * 60 * 1000) {
    return formatDuration(accumulated);
  }

  // Task was recently updated — add live elapsed for the current turn only
  const currentTurnMs = Math.max(0, Date.now() - lastUpdate);
  return formatDuration(accumulated + currentTurnMs);
}

type FeedCardVariant = "running" | "queued" | "review" | "needsInput" | "error";

function getVariant(task: Task): FeedCardVariant {
  if (task.errorMessage && task.status !== "done") return "error";
  if (task.needsInput) return "needsInput";
  if (task.status === "review") return "review";
  if (task.status === "queued") return "queued";
  return "running";
}

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const statusConfig: Record<FeedCardVariant, {
  label: string;
  badgeVariant: BadgeVariant;
  pulse: boolean;
  showTimer: boolean;
}> = {
  running: { label: "Running", badgeVariant: "default", pulse: true, showTimer: true },
  queued: { label: "Queued", badgeVariant: "outline", pulse: false, showTimer: false },
  review: { label: "Review", badgeVariant: "secondary", pulse: false, showTimer: false },
  needsInput: { label: "Input needed", badgeVariant: "default", pulse: true, showTimer: false },
  error: { label: "Error", badgeVariant: "destructive", pulse: true, showTimer: false },
};

export function FeedCard({ task, isOverlay }: { task: Task; isOverlay?: boolean }) {
  const openPanel = useTaskStore((s) => s.openPanel);
  const updateTask = useTaskStore((s) => s.updateTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const cancelTask = useTaskStore((s) => s.cancelTask);
  const fetchOutputFiles = useTaskStore((s) => s.fetchOutputFiles);
  const allOutputFiles = useTaskStore((s) => s.outputFiles);
  const outputFiles = allOutputFiles[task.id] ?? [];
  const [, setTick] = useState(0);
  const variant = getVariant(task);
  const config = statusConfig[variant];

  // Fetch outputs for running/review tasks too (not just done)
  useEffect(() => {
    if (variant === "running" || variant === "review" || variant === "needsInput") {
      fetchOutputFiles(task.id);
    }
  }, [task.id, variant, fetchOutputFiles]);

  // Parse context sources
  const contextTags: string[] = [];
  if (task.contextSources) {
    try {
      const sources = JSON.parse(task.contextSources) as { label: string }[];
      for (const s of sources) contextTags.push(s.label);
    } catch { /* ignore */ }
  }

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const dndTransform = CSS.Transform.toString(transform);

  const isActivelyRunning = variant === "running" &&
    (Date.now() - new Date(task.updatedAt).getTime()) < 5 * 60 * 1000;

  useEffect(() => {
    if (!isActivelyRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isActivelyRunning]);

  const showAccumulatedTime = (variant === "review" || variant === "needsInput" || variant === "error") && (task.durationMs ?? 0) > 0;

  const narrativeText = variant === "error"
    ? (task.errorMessage || "Claude hit an error.")
    : variant === "needsInput"
      ? (task.errorMessage || task.activityLabel || "Claude needs your input to continue.")
      : variant === "review"
        ? (task.activityLabel || task.description || "Claude has finished — review the output.")
        : (task.activityLabel || task.description || null);

  const isQueued = variant === "queued";
  const isRunning = variant === "running";

  // Long-running warning: >1 hour of compute time
  const durationMs = task.durationMs ?? 0;
  const isLongRunning = isRunning && durationMs > 3600000;
  const badgeVariant: BadgeVariant = isLongRunning ? "default" : config.badgeVariant;

  // Staleness: review/input tasks older than 24h
  const updatedAgo = Date.now() - new Date(task.updatedAt).getTime();
  const isStale = (variant === "review" || variant === "needsInput") && updatedAgo > 24 * 60 * 60 * 1000;

  return (
    <div
      ref={setNodeRef}
      onClick={() => openPanel(task.id)}
      className={cn(
        "group relative mb-2 cursor-pointer rounded-lg border border-border bg-card px-3 py-3 transition-colors hover:bg-muted/60",
        isRunning && "ring-1 ring-foreground/10",
        isDragging && "opacity-50",
        isOverlay && "shadow-lg",
      )}
      style={{
        transform: dndTransform || undefined,
        transition: transition || undefined,
        cursor: isDragging ? "grabbing" : "pointer",
      }}
      {...attributes}
    >
      <div className="flex items-start justify-between gap-2">
        {/* Drag handle + done + kill */}
        <div className="mt-1 flex shrink-0 flex-col items-center gap-1">
          <div
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "flex cursor-grab items-center text-transparent transition-colors group-hover:text-muted-foreground",
              isDragging && "cursor-grabbing",
            )}
          >
            <GripVertical className="size-3" />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-5 rounded text-transparent transition-colors group-hover:text-muted-foreground hover:!text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              updateTask(task.id, { status: "done" });
            }}
            title="Mark as done"
          >
            <CheckCircle2 className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-5 rounded text-transparent transition-colors group-hover:text-muted-foreground hover:!text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              if (task.status === "running") {
                cancelTask(task.id);
              } else {
                deleteTask(task.id);
              }
            }}
            title={task.status === "running" ? "Kill session" : "Delete task"}
          >
            {task.status === "running" ? <Square className="size-3" /> : <Trash2 className="size-3" />}
          </Button>
        </div>

        {/* Left: title + narrative */}
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "flex items-center gap-2 truncate text-[13px] leading-tight",
              isRunning ? "font-bold" : "font-semibold",
              isQueued ? "text-muted-foreground" : "text-foreground",
            )}
          >
            <span className="truncate">{task.title}</span>
            {task.projectSlug && (
              <Badge
                variant="outline"
                className="shrink-0 px-2 py-0 text-[9px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                {task.projectSlug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
              </Badge>
            )}
          </div>
          {narrativeText && (
            <div className="mt-1 truncate text-xs leading-relaxed text-muted-foreground">
              {narrativeText}
            </div>
          )}
        </div>

        {/* Right: status + time info */}
        <div className="mt-1 flex shrink-0 items-center gap-2">
          {showAccumulatedTime && (
            <span className="text-[10px] text-muted-foreground">{formatDuration(task.durationMs!)}</span>
          )}
          {isStale && (
            <span className="text-[10px] text-foreground">{timeAgo(task.updatedAt)}</span>
          )}
          <Badge variant={badgeVariant} className="gap-1 px-2 py-1 text-[10px] font-medium">
            {config.pulse && (
              <span className="size-2 shrink-0 rounded-full bg-current [animation:pulse-dot_2s_ease-in-out_infinite]" />
            )}
            {config.label}
            {config.showTimer && (
              <span className="font-bold tabular-nums">{formatLiveClaudeTime(task)}</span>
            )}
          </Badge>
        </div>
      </div>

      {/* Output file chips */}
      {outputFiles.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {outputFiles.slice(0, 3).map((f) => (
            <Badge key={f.id} variant="secondary" className="px-2 py-0 text-[10px] font-normal">
              {f.fileName}
            </Badge>
          ))}
          {outputFiles.length > 3 && (
            <span className="text-[10px] text-muted-foreground">+{outputFiles.length - 3}</span>
          )}
        </div>
      )}

      {/* Context source tags */}
      {contextTags.length > 0 && variant === "running" && (
        <div className="mt-1 flex flex-wrap gap-1">
          {contextTags.slice(0, 4).map((tag) => (
            <Badge key={tag} variant="outline" className="px-1 py-0 text-[9px] font-normal text-muted-foreground">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

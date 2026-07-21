"use client";

import { useState, useMemo } from "react";
import { Check, ChevronRight } from "lucide-react";
import type { Task } from "@/types/task";
import type { Client } from "@/types/client";
import { LevelBadge } from "./level-badge";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const taskDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today.getTime() - taskDay.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function groupByDate(tasks: Task[]): { label: string; tasks: Task[]; sortKey: number }[] {
  const groups = new Map<string, Task[]>();
  for (const t of tasks) {
    const ts = t.completedAt || t.updatedAt;
    const d = new Date(ts);
    const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  return [...groups.entries()]
    .map(([, tasks]) => {
      const ts = tasks[0].completedAt || tasks[0].updatedAt;
      return { label: formatDateLabel(ts), tasks, sortKey: new Date(ts).getTime() };
    })
    .sort((a, b) => b.sortKey - a.sortKey);
}

function DoneMiniCard({
  task,
  clients,
  isSelected,
  showClientDot,
  onSelect,
}: {
  task: Task;
  clients: Client[];
  isSelected: boolean;
  showClientDot: boolean;
  onSelect: (id: string) => void;
}) {
  const client = task.clientId ? clients.find((c) => c.slug === task.clientId) : null;

  return (
    <div
      data-card
      onClick={() => onSelect(task.id)}
      title={`${task.title} · click to reopen`}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-md border bg-muted px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-card",
        isSelected && "border-foreground/30 bg-card",
      )}
    >
      <Check size={10} className="text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">
        {task.title}
      </span>
      {showClientDot && client && (
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: client.color || "var(--muted-foreground)" }}
        />
      )}
      <LevelBadge level={task.level} />
    </div>
  );
}

export function KanbanColumnDone({
  tasks,
  clients,
  selectedId,
  collapsed,
  showClientDot,
  onToggleCollapsed,
  onSelect,
  onDrop,
  onDragOver,
  onDragLeave,
  isDragActive,
}: {
  tasks: Task[];
  clients: Client[];
  selectedId: string | null;
  collapsed: boolean;
  showClientDot: boolean;
  onToggleCollapsed: () => void;
  onSelect: (id: string) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  isDragActive: boolean;
}) {
  const [showCount, setShowCount] = useState(PAGE_SIZE);
  const [dragOver, setDragOver] = useState(false);

  const groups = useMemo(() => groupByDate(tasks), [tasks]);

  // Flatten for pagination
  const allItems = useMemo(() => groups.flatMap((g) => g.tasks), [groups]);
  const visibleItems = useMemo(() => new Set(allItems.slice(0, showCount).map((t) => t.id)), [allItems, showCount]);
  const hasMore = allItems.length > showCount;

  // Collapsed state — vertical strip
  if (collapsed) {
    const collapsedBorder = dragOver
      ? "2px solid var(--muted-foreground)"
      : isDragActive
        ? "2px dashed color-mix(in srgb, var(--foreground) 50%, transparent)"
        : "1px solid var(--border)";
    return (
      <div
        onClick={onToggleCollapsed}
        onDrop={(e) => { e.preventDefault(); onDrop(e); setDragOver(false); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragOver(e); setDragOver(true); }}
        onDragLeave={() => { onDragLeave(); setDragOver(false); }}
        className="sticky top-3 flex min-h-[200px] w-12 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg transition-colors"
        style={{
          backgroundColor: dragOver ? "color-mix(in srgb, var(--foreground) 8%, transparent)" : isDragActive ? "color-mix(in srgb, var(--foreground) 3%, transparent)" : "var(--muted)",
          border: collapsedBorder,
        }}
      >
        <span
          className="text-[11px] font-semibold tracking-wide text-muted-foreground"
          style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
        >
          {isDragActive ? "Drop here" : "Done"}
        </span>
        <span className="text-[10px] font-medium text-muted-foreground">
          {tasks.length}
        </span>
      </div>
    );
  }

  // Expanded state
  return (
    <div
      onDrop={(e) => { e.preventDefault(); onDrop(e); setDragOver(false); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragOver(e); setDragOver(true); }}
      onDragLeave={() => { onDragLeave(); setDragOver(false); }}
      className="sticky top-3 max-h-[calc(100vh-180px)] overflow-y-auto rounded-lg px-4 py-3 transition-colors"
      style={{
        backgroundColor: dragOver ? "color-mix(in srgb, var(--foreground) 4%, transparent)" : isDragActive ? "color-mix(in srgb, var(--foreground) 2%, transparent)" : "var(--muted)",
        border: dragOver ? "2px solid var(--muted-foreground)" : isDragActive ? "2px dashed color-mix(in srgb, var(--foreground) 40%, transparent)" : "1px solid var(--border)",
      }}
    >
      {/* Header */}
      <div
        className="mb-3 flex cursor-pointer items-center justify-between"
        onClick={onToggleCollapsed}
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Done
          </span>
          <span className="rounded-full bg-muted-foreground/15 px-2 py-0 text-[10px] text-muted-foreground">
            {tasks.length}
          </span>
        </div>
        <ChevronRight size={14} className="text-muted-foreground" />
      </div>

      {/* Date-grouped cards */}
      {tasks.length === 0 ? (
        <div className="py-5 text-center text-xs text-muted-foreground">
          No completed tasks yet
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map((group) => {
            const visible = group.tasks.filter((t) => visibleItems.has(t.id));
            if (visible.length === 0) return null;
            return (
              <div key={group.label}>
                <div className="mb-1 pl-1 text-[10px] tracking-wide text-muted-foreground">
                  {group.label}
                </div>
                <div className="flex flex-col gap-1">
                  {visible.map((t) => (
                    <DoneMiniCard
                      key={t.id}
                      task={t}
                      clients={clients}
                      isSelected={selectedId === t.id}
                      showClientDot={showClientDot}
                      onSelect={onSelect}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {hasMore && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowCount((c) => c + PAGE_SIZE); }}
              className="mt-1 inline-flex items-center gap-1 rounded-md border border-dashed border-border bg-transparent px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/60"
            >
              Show more ({allItems.length - showCount} remaining)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

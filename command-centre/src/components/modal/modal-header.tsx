"use client";

import { useState, useRef, useEffect } from "react";
import { X, ChevronDown, Trash2, Terminal, Copy } from "lucide-react";
import type { Task, TaskStatus } from "@/types/task";
import { useTaskStore } from "@/store/task-store";
import { LevelBadge } from "@/components/board/level-badge";
import { PermissionPicker } from "@/components/shared/permission-picker";
import { getPermissionStateForPickerChange, getPickerPermissionMode } from "@/lib/permission-mode";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const statusColorMap: Record<string, string> = {
  backlog: "var(--muted-foreground)",
  queued: "var(--muted-foreground)",
  running: "var(--primary)",
  review: "var(--primary)",
  done: "var(--muted-foreground)",
};

const ALL_STATUSES: TaskStatus[] = ["backlog", "queued", "running", "review", "done"];

const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  queued: "Queued",
  running: "Running",
  review: "Review",
  done: "Done",
};

export function ModalHeader({
  task,
  onClose,
}: {
  task: Task;
  onClose: () => void;
}) {
  const updateTask = useTaskStore((s) => s.updateTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const statusColor = statusColorMap[task.status] || "var(--muted-foreground)";
  const pickerMode = getPickerPermissionMode(
    task.permissionMode,
    task.executionPermissionMode,
    task.status,
  );

  const [statusOpen, setStatusOpen] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!statusOpen) return;
    const handler = (e: MouseEvent) => {
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) {
        setStatusOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [statusOpen]);

  const handlePermissionModeChange = (mode: "bypassPermissions" | "default" | "plan") => {
    void updateTask(
      task.id,
      getPermissionStateForPickerChange(
        mode,
        task.permissionMode,
        task.executionPermissionMode,
        "bypassPermissions",
      ),
    );
  };

  return (
    <div style={{ flexShrink: 0 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          minHeight: 56,
          padding: "12px 24px",
        }}
      >
        {/* Left: title + metadata */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            flex: 1,
            minWidth: 0,
          }}
        >
          {/* Title row */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: 16,
                fontWeight: 600,
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
            {task.level === "gsd" && task.phaseNumber != null && task.gsdStep && (
              <Badge variant="secondary" className="shrink-0 px-2 py-1 text-[11px] font-medium">
                Phase {task.phaseNumber} · {task.gsdStep}
              </Badge>
            )}

            {/* Status selector */}
            <div ref={statusRef} className="relative shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStatusOpen(!statusOpen)}
                className="h-auto gap-2 py-1 pl-2 pr-2 font-normal"
              >
                <span
                  className={cn(
                    "inline-block size-2 rounded-full",
                    task.status === "running" && "[animation:pulse-dot_2s_ease-in-out_infinite]",
                  )}
                  style={{ backgroundColor: statusColor }}
                />
                <span className="text-xs text-muted-foreground">
                  {STATUS_LABELS[task.status]}
                </span>
                <ChevronDown className="size-3 text-muted-foreground" />
              </Button>

              {statusOpen && (
                <Card className="absolute left-0 top-[calc(100%+4px)] z-[200] min-w-[140px] gap-0 overflow-hidden rounded-lg border p-0 shadow-md">
                  {ALL_STATUSES.map((s) => {
                    const isActive = task.status === s;
                    return (
                      <button
                        key={s}
                        onClick={() => {
                          if (!isActive) {
                            updateTask(task.id, { status: s });
                          }
                          setStatusOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors",
                          isActive
                            ? "cursor-default bg-muted font-semibold text-foreground"
                            : "cursor-pointer font-normal text-muted-foreground hover:bg-muted/60",
                        )}
                      >
                        <span
                          className="inline-block size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: statusColorMap[s] }}
                        />
                        {STATUS_LABELS[s]}
                      </button>
                    );
                  })}
                </Card>
              )}
            </div>

          </div>

          {/* Permission mode row */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: 10,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontWeight: 600,
                color: "var(--muted-foreground)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Mode
            </span>
            <PermissionPicker value={pickerMode} onChange={handlePermissionModeChange} />
            {task.permissionMode === "plan" && (
              <Badge variant="secondary" className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide">
                Plan active
              </Badge>
            )}
          </div>
        </div>

        {/* Right: reopen + resume + mark complete (GSD step only) + delete + close */}
        <div className="flex shrink-0 items-center gap-1 self-start">
          {task.status === "done" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                updateTask(task.id, { status: "queued" });
              }}
              title="Reopen — moves back to Claude's Turn"
              className="mr-1 h-auto px-3 py-1 text-[11px] font-semibold"
            >
              Reopen
            </Button>
          )}
          {/* Resume button removed — individual pane resume buttons are sufficient */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              deleteTask(task.id);
              onClose();
            }}
            title="Delete task"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-muted-foreground"
          >
            <X className="size-5" />
          </Button>
        </div>
      </div>

      {/* Bottom separator */}
      <div className="h-px bg-border" />
    </div>
  );
}

function ResumeButton({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false);
  const command = `claude --resume ${sessionId}`;

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(command);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      title={copied ? "Copied!" : command}
      className="mr-1 h-auto gap-1 px-3 py-1 text-[11px] font-semibold"
    >
      {copied ? <Copy className="size-3" /> : <Terminal className="size-3" />}
      {copied ? "Copied" : "Resume"}
    </Button>
  );
}

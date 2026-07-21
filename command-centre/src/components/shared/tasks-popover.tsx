"use client";

import { useEffect, useRef, useState } from "react";
import { ListChecks, Check, Loader2, ChevronRight } from "lucide-react";
import type { Todo } from "@/types/task";
import { Button } from "@/components/ui/button";

export interface SubtaskSummary {
  id: string;
  title: string;
  status: string;
  phaseNumber?: number | null;
  gsdStep?: string | null;
  needsInput?: boolean;
}

interface TasksPopoverProps {
  /** Claude's internal TodoWrite progress for the current run. */
  todos: Todo[];
  /** Real child subtasks of the parent task, if any. Takes precedence
   *  over `todos` when non-empty. */
  subtasks?: SubtaskSummary[];
  /** Optional click handler for a subtask row (e.g. scroll to / focus). */
  onSelectSubtask?: (id: string) => void;
  /** Execute a subtask — POST /api/tasks/:id/execute */
  onRunSubtask?: (id: string) => void;
  /** Execute a subtask in a new chat pane */
  onRunSubtaskInNewChat?: (id: string, title: string) => void;
  /** Execute all backlog subtasks */
  onRunAll?: () => void;
  /** Mark a subtask as done */
  onMarkDone?: (id: string) => void;
  /** Available chat panes for "Add to existing chat" picker */
  availablePanes?: Array<{ id: string; label: string; isMain?: boolean }>;
  /** Run a subtask in a specific existing pane */
  onRunSubtaskInPane?: (subtaskId: string, paneId: string) => void;
  /** Compact mode — icon only, no label text (for multi-pane layouts) */
  compact?: boolean;
}

const SUBTASK_DONE = new Set(["done", "completed", "review"]);
const SUBTASK_RUNNING = new Set(["running", "queued"]);

function subtaskBucket(status: string): "done" | "running" | "pending" {
  if (SUBTASK_DONE.has(status)) return "done";
  if (SUBTASK_RUNNING.has(status)) return "running";
  return "pending";
}

export function TasksPopover({ todos, subtasks, onSelectSubtask, onRunSubtask, onRunSubtaskInNewChat, onRunAll, onMarkDone, availablePanes, onRunSubtaskInPane, compact }: TasksPopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const hasSubtasks = (subtasks?.length ?? 0) > 0;
  const total = hasSubtasks ? subtasks!.length : todos.length;
  const completed = hasSubtasks
    ? subtasks!.filter((s) => subtaskBucket(s.status) === "done").length
    : todos.filter((t) => t.status === "completed").length;
  const progress = total > 0 ? completed / total : 0;
  const headerLabel = hasSubtasks ? "Subtasks" : "Todos";
  const buttonLabel = hasSubtasks ? "Subtasks" : "Todos";

  const btnRef = useRef<HTMLButtonElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ left: number; bottom: number } | null>(null);

  // Recalculate position when opening
  useEffect(() => {
    if (open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPopoverPos({ left: rect.left, bottom: window.innerHeight - rect.top + 6 });
    }
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Button
        ref={btnRef}
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        title={buttonLabel}
        className="h-[28px] gap-2 px-2 text-xs font-medium text-muted-foreground"
      >
        <ListChecks size={13} />
        {!compact && <>{buttonLabel}{total > 0 ? ` · ${completed}/${total}` : ""}</>}
      </Button>
      {open && (
        <div
          className="border border-border"
          style={{
            position: "fixed",
            left: popoverPos?.left ?? 0,
            bottom: popoverPos?.bottom ?? 0,
            width: 340,
            maxHeight: 400,
            backgroundColor: "var(--popover)",
            borderRadius: 10,
            boxShadow: "0 8px 24px color-mix(in srgb, var(--foreground) 12%, transparent)",
            zIndex: 9999,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              padding: "12px 12px 8px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 12,
                fontWeight: 600,
                fontFamily:
                  "var(--font-inter), Inter, sans-serif",
                color: "var(--foreground)",
                marginBottom: 8,
              }}
            >
              <span>{headerLabel}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--muted-foreground)", fontWeight: 500 }}>
                  {completed}/{total} completed
                </span>
              </div>
            </div>
            <div
              style={{
                height: 4,
                borderRadius: 2,
                background: "var(--muted)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${progress * 100}%`,
                  background: "var(--foreground)",
                  transition: "width 200ms ease",
                }}
              />
            </div>
          </div>
          <div style={{ overflowY: "auto", padding: "4px 0" }}>
            {total === 0 && (
              <div style={{
                padding: "12px",
                fontSize: 12,
                color: "var(--muted-foreground)",
                fontFamily: "var(--font-inter), Inter, sans-serif",
                textAlign: "center",
              }}>
                No {hasSubtasks ? "subtasks" : "todos"} yet.
              </div>
            )}
            {hasSubtasks &&
              subtasks!.map((st) => {
                const bucket = subtaskBucket(st.status);
                const done = bucket === "done";
                const running = bucket === "running";
                const pending = bucket === "pending";
                const executed = !pending; // has been run at some point

                return (
                  <div
                    key={st.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      padding: "8px 12px",
                      width: "100%",
                      textAlign: "left",
                      borderLeft: st.needsInput
                        ? "3px solid var(--primary)"
                        : "3px solid transparent",
                      backgroundColor: st.needsInput
                        ? "var(--muted)"
                        : "transparent",
                      transition: "background 80ms ease",
                    }}
                    onMouseEnter={(e) => {
                      if (executed && !st.needsInput) {
                        e.currentTarget.style.background = "var(--muted)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = st.needsInput
                        ? "var(--muted)"
                        : "transparent";
                    }}
                  >
                    {/* Status checkbox — clickable to toggle done */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (running) return; // Can't mark running tasks as done
                        if (onMarkDone) {
                          onMarkDone(st.id);
                        }
                      }}
                      style={{
                        flexShrink: 0,
                        width: 14,
                        height: 14,
                        borderRadius: 4,
                        border: `1.5px solid ${
                          done ? "var(--foreground)" : running ? "var(--primary)" : "var(--border)"
                        }`,
                        background: done ? "var(--foreground)" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginTop: 0,
                        padding: 0,
                        cursor: running ? "default" : "pointer",
                      }}
                    >
                      {done && <Check size={10} color="var(--background)" strokeWidth={3} />}
                      {running && (
                        <Loader2 size={9} color="var(--primary)" className="animate-spin" />
                      )}
                    </button>

                    {/* Title + info */}
                    <button
                      type="button"
                      onClick={() => {
                        if (executed && onSelectSubtask) {
                          onSelectSubtask(st.id);
                          setOpen(false);
                        }
                      }}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        border: "none",
                        background: "transparent",
                        padding: 0,
                        textAlign: "left",
                        cursor: executed && onSelectSubtask ? "pointer" : "default",
                        fontSize: 12,
                        fontFamily: "var(--font-inter), Inter, sans-serif",
                        color: done ? "var(--muted-foreground)" : pending ? "var(--muted-foreground)" : "var(--foreground)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            textDecoration: done ? "line-through" : "none",
                            lineHeight: 1.4,
                            fontWeight: running ? 600 : 400,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          {st.title}
                        </span>
                        {st.phaseNumber != null && (
                          <span
                            style={{
                              fontSize: 9,
                              fontFamily: "var(--font-inter), Inter, sans-serif",
                              fontWeight: 600,
                              padding: "0 4px",
                              borderRadius: 4,
                              backgroundColor: "var(--muted)",
                              color: "var(--muted-foreground)",
                              flexShrink: 0,
                            }}
                          >
                            P{st.phaseNumber}
                            {st.gsdStep ? ` · ${st.gsdStep}` : ""}
                          </span>
                        )}
                      </div>
                      {running && (
                        <div
                          style={{
                            fontSize: 10,
                            fontFamily: "var(--font-inter), Inter, sans-serif",
                            color: "var(--primary)",
                            marginTop: 4,
                          }}
                        >
                          {st.status === "running" ? "working..." : "queued"}
                        </div>
                      )}
                      {st.needsInput && (
                        <div
                          style={{
                            fontSize: 10,
                            fontFamily: "var(--font-inter), Inter, sans-serif",
                            color: "var(--primary)",
                            fontStyle: "italic",
                            marginTop: 4,
                          }}
                        >
                          Waiting for your input
                        </div>
                      )}
                    </button>

                    {/* Open as conversation */}
                    {onSelectSubtask && (
                      <ChevronRight
                        size={12}
                        color="var(--muted-foreground)"
                        style={{ flexShrink: 0, cursor: "pointer" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectSubtask(st.id);
                          setOpen(false);
                        }}
                      />
                    )}
                  </div>
                );
              })}
            {!hasSubtasks &&
              todos.map((todo, i) => {
                const done = todo.status === "completed";
                const inProgress = todo.status === "in_progress";
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      padding: "8px 12px",
                      fontSize: 12,
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      color: done ? "var(--muted-foreground)" : "var(--foreground)",
                    }}
                  >
                    <div
                      style={{
                        flexShrink: 0,
                        width: 14,
                        height: 14,
                        borderRadius: 4,
                        border: `1.5px solid ${
                          done ? "var(--foreground)" : inProgress ? "var(--primary)" : "var(--border)"
                        }`,
                        background: done ? "var(--foreground)" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginTop: 0,
                      }}
                    >
                      {done && <Check size={10} color="var(--background)" strokeWidth={3} />}
                    </div>
                    <span
                      style={{
                        textDecoration: done ? "line-through" : "none",
                        lineHeight: 1.4,
                        fontWeight: inProgress ? 600 : 400,
                      }}
                    >
                      {inProgress && todo.activeForm ? todo.activeForm : todo.content}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

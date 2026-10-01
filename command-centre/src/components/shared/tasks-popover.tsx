"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ListChecks, Check, Loader2, ChevronRight } from "lucide-react";
import type { Todo } from "@/types/task";
import { POPOVER_LAYER_Z_INDEX, resolvePopoverPosition } from "./popover-position";
import { shouldActivateSubtaskRowKey } from "./task-row-interaction";

const POPOVER_WIDTH = 340;
const POPOVER_MAX_HEIGHT = 400;
const POPOVER_GAP = 6;
const VIEWPORT_PADDING = 8;

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
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPosition, setPopoverPosition] = useState({
    top: 0,
    left: 0,
    width: POPOVER_WIDTH,
    maxHeight: POPOVER_MAX_HEIGHT,
    positioned: false,
  });

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!containerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const hasSubtasks = (subtasks?.length ?? 0) > 0;
  const total = hasSubtasks ? subtasks!.length : todos.length;
  const completed = hasSubtasks
    ? subtasks!.filter((s) => subtaskBucket(s.status) === "done").length
    : todos.filter((t) => t.status === "completed").length;
  const progress = total > 0 ? completed / total : 0;
  const headerLabel = hasSubtasks ? "Subtasks" : "Todos";
  const buttonLabel = hasSubtasks ? "Subtasks" : "Todos";

  const updatePopoverPosition = useCallback(() => {
    const trigger = btnRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover || typeof window === "undefined") return;
    const rect = trigger.getBoundingClientRect();
    const measurementWidth = Math.min(
      POPOVER_WIDTH,
      Math.max(0, window.innerWidth - VIEWPORT_PADDING * 2),
    );
    popover.style.width = `${measurementWidth}px`;
    const resolved = resolvePopoverPosition({
      anchor: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      popoverWidth: POPOVER_WIDTH,
      contentHeight: popover.scrollHeight,
      maxHeight: POPOVER_MAX_HEIGHT,
      preferredPlacement: "above",
      gap: POPOVER_GAP,
      viewportPadding: VIEWPORT_PADDING,
    });
    setPopoverPosition({
      top: resolved.top,
      left: resolved.left,
      width: resolved.width,
      maxHeight: resolved.maxHeight,
      positioned: true,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePopoverPosition();
    const handleWindowChange = () => updatePopoverPosition();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => updatePopoverPosition());
    if (popoverRef.current) observer?.observe(popoverRef.current);
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [open, updatePopoverPosition]);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          if (!open) setPopoverPosition((current) => ({ ...current, positioned: false }));
          setOpen((current) => !current);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={buttonLabel}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          height: 26,
          padding: "0 8px",
          borderRadius: 6,
          border: "none",
          background: "transparent",
          color: "var(--cc-text-secondary)",
          fontSize: 12,
          fontWeight: 500,
          fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--cc-neutral-alpha-04)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        <ListChecks size={13} />
        {!compact && <>{buttonLabel}{total > 0 ? ` · ${completed}/${total}` : ""}</>}
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          data-composer-popover-open="true"
          role="dialog"
          aria-label={headerLabel}
          style={{
            position: "fixed",
            top: popoverPosition.top,
            left: popoverPosition.left,
            width: popoverPosition.width,
            maxHeight: popoverPosition.maxHeight,
            boxSizing: "border-box",
            backgroundColor: "var(--cc-surface)",
            border: "1px solid var(--cc-line-alpha-30)",
            borderRadius: 10,
            boxShadow: "0 8px 24px var(--cc-neutral-alpha-12)",
            zIndex: POPOVER_LAYER_Z_INDEX,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            visibility: popoverPosition.positioned ? "visible" : "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 12px 8px",
              borderBottom: "1px solid var(--cc-control-bg)",
              flexShrink: 0,
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
                  "var(--font-space-grotesk), Space Grotesk, sans-serif",
                color: "var(--cc-text-primary)",
                marginBottom: 6,
              }}
            >
              <span>{headerLabel}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--cc-text-secondary)", fontWeight: 500 }}>
                  {completed}/{total} completed
                </span>
              </div>
            </div>
            <div
              style={{
                height: 4,
                borderRadius: 2,
                background: "var(--cc-control-bg)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${progress * 100}%`,
                  background: "var(--cc-palette-green)",
                  transition: "width 200ms ease",
                }}
              />
            </div>
          </div>
          <div style={{ overflowY: "auto", padding: "4px 0", flex: "1 1 auto", minHeight: 0 }}>
            {total === 0 && (
              <div style={{
                padding: "12px",
                fontSize: 12,
                color: "var(--cc-text-tertiary)",
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
                const interactive = Boolean(onSelectSubtask);

                return (
                  <div
                    key={st.id}
                    role={interactive ? "button" : undefined}
                    tabIndex={interactive ? 0 : undefined}
                    aria-label={interactive ? `Open ${st.title}` : undefined}
                    onClick={() => {
                      if (!onSelectSubtask) return;
                      onSelectSubtask(st.id);
                      setOpen(false);
                    }}
                    onKeyDown={(event) => {
                      if (
                        !onSelectSubtask
                        || !shouldActivateSubtaskRowKey(event.key, event.target === event.currentTarget)
                      ) return;
                      event.preventDefault();
                      onSelectSubtask(st.id);
                      setOpen(false);
                    }}
                    onFocus={(event) => {
                      if (!interactive) return;
                      event.currentTarget.style.outline = "2px solid var(--cc-brand-primary)";
                      event.currentTarget.style.outlineOffset = "-2px";
                    }}
                    onBlur={(event) => {
                      event.currentTarget.style.outline = "none";
                    }}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      padding: "8px 12px",
                      width: "100%",
                      textAlign: "left",
                      borderLeft: st.needsInput
                        ? "3px solid var(--cc-brand-primary)"
                        : "3px solid transparent",
                      backgroundColor: st.needsInput
                        ? "var(--cc-brand-alpha-05)"
                        : "transparent",
                      transition: "background 80ms ease",
                      cursor: interactive ? "pointer" : "default",
                      outline: "none",
                    }}
                    onMouseEnter={(e) => {
                      if (interactive && !st.needsInput) {
                        e.currentTarget.style.background = "var(--cc-neutral-alpha-02)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = st.needsInput
                        ? "var(--cc-brand-alpha-05)"
                        : "transparent";
                    }}
                  >
                    {/* Status checkbox — clickable to toggle done */}
                    <button
                      type="button"
                      aria-label={done ? `Mark ${st.title} incomplete` : `Mark ${st.title} done`}
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
                          done ? "var(--cc-palette-green)" : running ? "var(--cc-brand-primary)" : "var(--cc-palette-neutral-400)"
                        }`,
                        background: done ? "var(--cc-palette-green)" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginTop: 1,
                        padding: 0,
                        cursor: running ? "default" : "pointer",
                      }}
                    >
                      {done && <Check size={10} color="var(--cc-surface)" strokeWidth={3} />}
                      {running && (
                        <Loader2 size={9} color="var(--cc-brand-primary)" className="animate-spin" />
                      )}
                    </button>

                    {/* Title + info */}
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        textAlign: "left",
                        fontSize: 12,
                        fontFamily: "var(--font-inter), Inter, sans-serif",
                        color: done ? "var(--cc-text-tertiary)" : pending ? "var(--cc-text-tertiary)" : "var(--cc-text-primary)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
                              fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                              fontWeight: 600,
                              padding: "1px 5px",
                              borderRadius: 3,
                              backgroundColor: "var(--cc-surface-purple)",
                              color: "var(--cc-status-purple)",
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
                            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                            color: "var(--cc-brand-primary)",
                            marginTop: 2,
                          }}
                        >
                          {st.status === "running" ? "working..." : "queued"}
                        </div>
                      )}
                      {st.needsInput && (
                        <div
                          style={{
                            fontSize: 10,
                            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                            color: "var(--cc-brand-primary)",
                            fontStyle: "italic",
                            marginTop: 2,
                          }}
                        >
                          Waiting for your input
                        </div>
                      )}
                    </div>

                    {/* Open as conversation */}
                    {onSelectSubtask && (
                      <ChevronRight
                        size={12}
                        color="var(--cc-text-muted)"
                        aria-hidden
                        style={{ flexShrink: 0, pointerEvents: "none" }}
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
                      color: done ? "var(--cc-text-tertiary)" : "var(--cc-text-primary)",
                    }}
                  >
                    <div
                      style={{
                        flexShrink: 0,
                        width: 14,
                        height: 14,
                        borderRadius: 4,
                        border: `1.5px solid ${
                          done ? "var(--cc-palette-green)" : inProgress ? "var(--cc-brand-primary)" : "var(--cc-palette-neutral-400)"
                        }`,
                        background: done ? "var(--cc-palette-green)" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginTop: 1,
                      }}
                    >
                      {done && <Check size={10} color="var(--cc-surface)" strokeWidth={3} />}
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
        </div>,
        document.body,
      )}
    </div>
  );
}

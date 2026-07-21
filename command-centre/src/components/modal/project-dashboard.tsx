"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  FileText,
  Home,
  Inbox,
  Loader2,
  MessageSquare,
  Play,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import type { LogEntry, OutputFile, Task } from "@/types/task";
import { MAIN_PANE_ID, type PaneItem } from "@/hooks/use-pane-state";
import { useTaskStore } from "@/store/task-store";
import { LevelBadge } from "@/components/board/level-badge";
import { ModalChat } from "./modal-chat";
import { ReplyInput } from "./reply-input";
import { NextActionChips } from "./next-action-chips";
import { getPendingTaskQuestionPreview } from "@/lib/task-logs";
import { getInheritedPermissionModes } from "@/lib/permission-mode";

type StatusKey = "backlog" | "queued" | "running" | "review" | "done";

const statusConfig: Record<
  StatusKey,
  { icon: typeof CheckCircle2; color: string; label: string }
> = {
  backlog: { icon: Inbox, color: "var(--muted-foreground)", label: "Backlog" },
  queued: { icon: Clock, color: "var(--muted-foreground)", label: "Queued" },
  running: { icon: Loader2, color: "var(--primary)", label: "Running" },
  review: { icon: Eye, color: "var(--primary)", label: "Needs review" },
  done: { icon: CheckCircle2, color: "var(--muted-foreground)", label: "Done" },
};

function getPendingQuestionPreview(
  child: Task,
  childLogs: LogEntry[],
): string | null {
  return getPendingTaskQuestionPreview(childLogs, child.needsInput === true, 120);
}

async function runTask(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/tasks/${id}/execute`, { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}

interface ProjectDashboardProps {
  task: Task;
  childTasks: Task[];
  childLogEntries: Record<string, LogEntry[]>;
  logEntries: LogEntry[];
  isRunning: boolean;
  needsInput: boolean;
  status: string;
  showReplyInput: boolean;
  onViewSubtask: (childId: string) => void;
  onOptimisticReply: (entry: LogEntry) => void;
  onPreviewFile: (file: OutputFile) => void;
  onOpenBrief?: () => void;
  onOpenPlan?: () => void;
  briefDescription: string | null;
  /** Ref to the ReplyInput textarea for command insertion from chips */
  replyInputRef?: React.RefObject<{ insertText: (text: string) => void } | null>;
  /** Open panes — used to show which chat a subtask is in */
  openPanes?: PaneItem[];
  /** Open a new chat pane for a subtask */
  onOpenSubtaskPane?: (taskId: string, label: string) => void;
  /** Focus an existing pane */
  onFocusPane?: (paneId: string) => void;
  /** Assign a task to an existing pane */
  onAssignSubtaskToPane?: (paneId: string, taskId: string) => void;
}

export function ProjectDashboard({
  task,
  childTasks,
  childLogEntries,
  logEntries,
  isRunning,
  needsInput,
  status,
  showReplyInput,
  onViewSubtask,
  onOptimisticReply,
  onPreviewFile,
  onOpenBrief,
  onOpenPlan,
  briefDescription,
  openPanes,
  onOpenSubtaskPane,
  onFocusPane,
  onAssignSubtaskToPane,
}: ProjectDashboardProps) {
  const updateTask = useTaskStore((s) => s.updateTask);
  const createTask = useTaskStore((s) => s.createTask);

  const [showSubtasksPopover, setShowSubtasksPopover] = useState(false);
  const [runMenuId, setRunMenuId] = useState<string | null>(null);
  const [runMenuRect, setRunMenuRect] = useState<DOMRect | null>(null);
  const runBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [showAddSubtask, setShowAddSubtask] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [creatingSubtask, setCreatingSubtask] = useState(false);
  const [chipCommand, setChipCommand] = useState<string | null>(null);
  const [showBriefBanner, setShowBriefBanner] = useState(true);


  const fetchLogEntries = useTaskStore((s) => s.fetchLogEntries);

  const backlogChildren = useMemo(
    () => childTasks.filter((c) => c.status === "backlog"),
    [childTasks],
  );

  // Merged timeline for the chat — parent logs + child logs with phase dividers
  const mergedConversation = useMemo(() => {
    const merged: LogEntry[] = [...logEntries];
    for (const child of childTasks) {
      merged.push(...(childLogEntries[child.id] ?? []));
    }
    merged.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    return merged;
  }, [logEntries, childTasks, childLogEntries]);

  const doneCount = childTasks.filter((c) => c.status === "done").length;
  const total = childTasks.length;

  const handleRun = useCallback(
    async (child: Task) => {
      // "Add to existing chat" — just execute; logs merge into main conversation via SSE.
      // Inherit parent's permission mode so the subtask runs with the same permissions.
      await updateTask(child.id, {
        status: "running",
        ...getInheritedPermissionModes(
          task.permissionMode,
          task.executionPermissionMode,
          task.status,
        ),
      });
      fetchLogEntries(child.id);
      const ok = await runTask(child.id);
      if (!ok) {
        await updateTask(child.id, { status: "queued" });
      }
    },
    [updateTask, fetchLogEntries, task.executionPermissionMode, task.permissionMode, task.status],
  );

  const handleRunAll = useCallback(async () => {
    for (const child of backlogChildren) {
      await updateTask(child.id, {
        status: "running",
        ...getInheritedPermissionModes(
          task.permissionMode,
          task.executionPermissionMode,
          task.status,
        ),
      });
      const ok = await runTask(child.id);
      if (!ok) {
        await updateTask(child.id, { status: "queued" });
      }
    }
  }, [backlogChildren, updateTask, task.executionPermissionMode, task.permissionMode, task.status]);

  /** Find which pane (if any) a subtask is currently open in */
  const getPaneForSubtask = useCallback(
    (childId: string): PaneItem | null => {
      if (!openPanes) return null;
      return openPanes.find((p) => p.taskId === childId) ?? null;
    },
    [openPanes],
  );

  /** Whether a subtask has ever been executed (has a chat) */
  const hasBeenRun = useCallback(
    (child: Task): boolean => {
      return child.status !== "backlog";
    },
    [],
  );

  /** Run a subtask in a new chat pane */
  const handleRunInNewChat = useCallback(
    async (child: Task) => {
      // Open the pane FIRST so it's visible immediately
      if (onOpenSubtaskPane) {
        onOpenSubtaskPane(child.id, child.title);
      }
      // Ensure the child's log entries are loaded into the store
      fetchLogEntries(child.id);
      // Optimistic: show running state immediately + inherit parent permissions
      await updateTask(child.id, {
        status: "running",
        ...getInheritedPermissionModes(
          task.permissionMode,
          task.executionPermissionMode,
          task.status,
        ),
      });
      // Then execute the task (logs will stream into the pane via SSE)
      const ok = await runTask(child.id);
      if (!ok) {
        await updateTask(child.id, { status: "queued" });
      }
    },
    [onOpenSubtaskPane, fetchLogEntries, updateTask, task.executionPermissionMode, task.permissionMode, task.status],
  );

  /** Available chat panes for "Add to existing chat" picker */
  const availablePanes = useMemo(() => {
    const panes: Array<{ id: string; label: string; isMain?: boolean }> = [
      { id: MAIN_PANE_ID, label: "Main chat", isMain: true },
    ];
    if (openPanes) {
      for (const p of openPanes) {
        if (p.type === "chat") {
          panes.push({ id: p.id, label: p.label });
        }
      }
    }
    return panes;
  }, [openPanes]);

  /** Run a subtask in a specific existing pane */
  const handleRunInExistingPane = useCallback(
    async (subtaskId: string, paneId: string) => {
      const child = childTasks.find((c) => c.id === subtaskId);
      if (!child) return;
      if (paneId === MAIN_PANE_ID) {
        // "Main chat" selected — just execute, logs merge into main conversation via SSE
        // (no side pane created)
      } else {
        // Assign subtask to the selected existing pane
        if (onAssignSubtaskToPane) onAssignSubtaskToPane(paneId, child.id);
        if (onFocusPane) onFocusPane(paneId);
      }
      await updateTask(child.id, {
        status: "running",
        ...getInheritedPermissionModes(
          task.permissionMode,
          task.executionPermissionMode,
          task.status,
        ),
      });
      fetchLogEntries(child.id);
      await runTask(child.id);
    },
    [childTasks, onAssignSubtaskToPane, onFocusPane, fetchLogEntries, updateTask, task.executionPermissionMode, task.permissionMode, task.status],
  );

  /** Handle clicking a subtask row — navigate to its chat */
  const handleSubtaskClick = useCallback(
    (child: Task) => {
      if (!hasBeenRun(child)) return; // Not clickable

      // Check if there's an open pane for this subtask
      const pane = getPaneForSubtask(child.id);
      if (pane && onFocusPane) {
        onFocusPane(pane.id);
      } else {
        // Fall back to drill-down navigation
        onViewSubtask(child.id);
      }
      setShowSubtasksPopover(false);
    },
    [hasBeenRun, getPaneForSubtask, onFocusPane, onViewSubtask, updateTask],
  );

  const handleAddSubtask = useCallback(async () => {
    const title = newSubtaskTitle.trim();
    if (!title || creatingSubtask) return;
    if (!task.projectSlug) return;
    setCreatingSubtask(true);
    try {
      await createTask(title, null, "task", task.projectSlug, task.id);
      setNewSubtaskTitle("");
      setShowAddSubtask(false);
    } finally {
      setCreatingSubtask(false);
    }
  }, [newSubtaskTitle, creatingSubtask, task.id, task.projectSlug, createTask]);

  const handleInsertCommand = useCallback((text: string) => {
    setChipCommand(text);
  }, []);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minHeight: 0,
        minWidth: 0,
        position: "relative",
      }}
    >
      {/* Collapsible brief banner */}
      {showBriefBanner && (briefDescription || onOpenBrief || onOpenPlan) && (
        <div
          style={{
            padding: "8px 24px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            backgroundColor: "var(--card)",
            flexShrink: 0,
          }}
        >
          {briefDescription && (
            <span
              style={{
                flex: 1,
                fontSize: 12,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                color: "var(--muted-foreground)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {briefDescription}
            </span>
          )}
          {onOpenBrief && (
            <button
              onClick={onOpenBrief}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 6px",
                border: "none",
                background: "transparent",
                color: "var(--primary)",
                fontSize: 11,
                fontWeight: 500,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <FileText size={11} />
              Brief
            </button>
          )}
          {onOpenPlan && (
            <button
              onClick={onOpenPlan}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 6px",
                border: "none",
                background: "transparent",
                color: "var(--muted-foreground)",
                fontSize: 11,
                fontWeight: 500,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <FileText size={11} />
              Plan
            </button>
          )}
          {/* Subtasks popover trigger */}
          {total > 0 && (
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setShowSubtasksPopover(!showSubtasksPopover)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 8px",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  background: "transparent",
                  color: "var(--muted-foreground)",
                  fontSize: 11,
                  fontWeight: 500,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                Subtasks ({doneCount}/{total})
                <ChevronDown size={10} />
              </button>

              {/* Subtasks popover */}
              {showSubtasksPopover && (
                <>
                  <div
                    style={{ position: "fixed", inset: 0, zIndex: 20 }}
                    onClick={() => setShowSubtasksPopover(false)}
                  />
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      right: 0,
                      zIndex: 21,
                      marginTop: 4,
                      width: 300,
                      maxWidth: "calc(100vw - 32px)",
                      maxHeight: 360,
                      overflowY: "auto",
                      backgroundColor: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      boxShadow: "0 8px 24px color-mix(in srgb, var(--foreground) 10%, transparent)",
                      padding: "8px 0",
                    }}
                  >
                    {/* Header */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "4px 12px 8px",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontFamily: "var(--font-inter), Inter, sans-serif",
                          fontWeight: 600,
                          color: "var(--muted-foreground)",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        Subtasks
                      </span>
                      <button
                        onClick={handleRunAll}
                        disabled={backlogChildren.length === 0}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "4px 8px",
                          border: "1px solid var(--border)",
                          borderRadius: 5,
                          backgroundColor: backlogChildren.length === 0 ? "var(--muted)" : "color-mix(in srgb, var(--foreground) 6%, transparent)",
                          color: backlogChildren.length === 0 ? "var(--muted-foreground)" : "var(--primary)",
                          fontFamily: "var(--font-inter), Inter, sans-serif",
                          fontSize: 10,
                          fontWeight: 600,
                          cursor: backlogChildren.length === 0 ? "default" : "pointer",
                        }}
                      >
                        <Play size={9} />
                        Run all
                      </button>
                    </div>

                    {/* Subtask rows */}
                    {childTasks.map((child) => {
                      const cfgKey = (statusConfig[child.status as StatusKey] ? child.status : "backlog") as StatusKey;
                      const cfg = statusConfig[cfgKey];
                      const Icon = cfg.icon;
                      const needs = child.needsInput === true;
                      const questionPreview = getPendingQuestionPreview(child, childLogEntries[child.id] || []);
                      const canRun = child.status === "backlog" || child.status === "review" || child.status === "done";
                      const runLabel = child.status === "backlog" ? "Run" : child.status === "review" ? "Requeue" : "Rerun";
                      const RunIcon = child.status === "backlog" ? Play : RotateCcw;
                      const executed = hasBeenRun(child);
                      const pane = getPaneForSubtask(child.id);
                      const chatLabel = pane ? pane.label : executed ? "Main Chat" : null;
                      const showRunMenu = runMenuId === child.id;

                      return (
                        <div
                          key={child.id}
                          onClick={() => handleSubtaskClick(child)}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 8,
                            padding: "8px 12px",
                            cursor: executed ? "pointer" : "default",
                            borderLeft: needs ? "3px solid var(--primary)" : "3px solid transparent",
                            backgroundColor: needs ? "var(--muted)" : "transparent",
                            transition: "background 80ms ease",
                          }}
                          onMouseEnter={(e) => {
                            if (executed) {
                              e.currentTarget.style.backgroundColor = needs ? "var(--muted)" : "var(--card)";
                            }
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = needs ? "var(--muted)" : "transparent";
                          }}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (child.status === "running" || child.status === "queued") return;
                              updateTask(child.id, { status: child.status === "done" ? "backlog" : "done" });
                            }}
                            style={{
                              border: "none",
                              background: "transparent",
                              padding: 0,
                              cursor: child.status === "running" || child.status === "queued" ? "default" : "pointer",
                              flexShrink: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                          <Icon
                            size={14}
                            style={{
                              color: cfg.color,
                              marginTop: 2,
                              animation: child.status === "running" ? "spin 1.2s linear infinite" : undefined,
                            }}
                          />
                          </button>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span
                                style={{
                                  flex: 1,
                                  fontSize: 12,
                                  fontWeight: 500,
                                  fontFamily: "var(--font-inter), Inter, sans-serif",
                                  color: executed ? "var(--foreground)" : "var(--muted-foreground)",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  textDecoration: child.status === "done" ? "line-through" : "none",
                                }}
                              >
                                {child.title}
                              </span>
                              {child.level === "gsd" && child.phaseNumber != null && (
                                <span
                                  style={{
                                    fontSize: 9,
                                    fontFamily: "var(--font-inter), Inter, sans-serif",
                                    fontWeight: 600,
                                    padding: "1px 5px",
                                    borderRadius: 3,
                                    backgroundColor: "var(--muted)",
                                    color: "var(--muted-foreground)",
                                    flexShrink: 0,
                                  }}
                                >
                                  P{child.phaseNumber}
                                  {child.gsdStep ? ` · ${child.gsdStep}` : ""}
                                </span>
                              )}
                            </div>
                            {/* Chat location indicator */}
                            {chatLabel && (
                              <div
                                style={{
                                  marginTop: 2,
                                  fontSize: 10,
                                  fontFamily: "var(--font-inter), Inter, sans-serif",
                                  color: "var(--muted-foreground)",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 3,
                                }}
                              >
                                <MessageSquare size={8} />
                                {chatLabel}
                              </div>
                            )}
                            {questionPreview && (
                              <div
                                style={{
                                  marginTop: 2,
                                  fontSize: 11,
                                  fontFamily: "var(--font-inter), Inter, sans-serif",
                                  color: "var(--primary)",
                                  fontStyle: "italic",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {needs && "↳ "}
                                {questionPreview}
                              </div>
                            )}
                          </div>
                          {/* Run/Rerun with target dropdown */}
                          {canRun && (
                            <div style={{ position: "relative", flexShrink: 0 }}>
                              <button
                                ref={(el) => { runBtnRefs.current[child.id] = el; }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (showRunMenu) {
                                    setRunMenuId(null);
                                    setRunMenuRect(null);
                                  } else {
                                    const rect = runBtnRefs.current[child.id]?.getBoundingClientRect();
                                    setRunMenuRect(rect ?? null);
                                    setRunMenuId(child.id);
                                  }
                                }}
                                title={runLabel}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                  padding: "4px 8px",
                                  border: "1px solid var(--border)",
                                  borderRadius: 4,
                                  backgroundColor: "var(--card)",
                                  color: "var(--primary)",
                                  fontSize: 10,
                                  fontFamily: "var(--font-inter), Inter, sans-serif",
                                  fontWeight: 600,
                                  cursor: "pointer",
                                }}
                              >
                                <RunIcon size={8} />
                                {runLabel}
                                <ChevronDown size={7} style={{ marginLeft: 1 }} />
                              </button>
                              {showRunMenu && runMenuRect && (() => {
                                const flipUp = runMenuRect.bottom + 120 > window.innerHeight;
                                return (
                                <>
                                  <div
                                    style={{ position: "fixed", inset: 0, zIndex: 30 }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setRunMenuId(null);
                                      setRunMenuRect(null);
                                    }}
                                  />
                                  <div
                                    style={{
                                      position: "fixed",
                                      ...(flipUp
                                        ? { bottom: window.innerHeight - runMenuRect.top + 4 }
                                        : { top: runMenuRect.bottom + 4 }),
                                      right: window.innerWidth - runMenuRect.right,
                                      zIndex: 31,
                                      minWidth: 140,
                                      backgroundColor: "var(--card)",
                                      border: "1px solid var(--border)",
                                      borderRadius: 8,
                                      boxShadow: "0 4px 12px color-mix(in srgb, var(--foreground) 10%, transparent)",
                                      padding: 4,
                                    }}
                                  >
                                    {availablePanes.length <= 1 ? (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleRun(child);
                                          setRunMenuId(null);
                                          setRunMenuRect(null);
                                        }}
                                        style={{
                                          width: "100%",
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 8,
                                          padding: "8px 8px",
                                          border: "none",
                                          background: "transparent",
                                          cursor: "pointer",
                                          borderRadius: 4,
                                          textAlign: "left",
                                        }}
                                        onMouseEnter={(e) => {
                                          e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 4%, transparent)";
                                        }}
                                        onMouseLeave={(e) => {
                                          e.currentTarget.style.backgroundColor = "transparent";
                                        }}
                                      >
                                        <Home size={11} style={{ color: "var(--primary)", flexShrink: 0 }} />
                                        <span style={{
                                          fontSize: 11,
                                          fontFamily: "var(--font-inter), Inter, sans-serif",
                                          color: "var(--foreground)",
                                        }}>
                                          Add to existing chat
                                        </span>
                                      </button>
                                    ) : (
                                      <>
                                        <div style={{
                                          fontSize: 10,
                                          fontFamily: "var(--font-inter), Inter, sans-serif",
                                          fontWeight: 600,
                                          color: "var(--muted-foreground)",
                                          padding: "4px 8px 2px",
                                          textTransform: "uppercase",
                                          letterSpacing: "0.03em",
                                        }}>
                                          Add to existing chat
                                        </div>
                                        {availablePanes.map((pane) => (
                                          <button
                                            key={pane.id}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleRunInExistingPane(child.id, pane.id);
                                              setRunMenuId(null);
                                              setRunMenuRect(null);
                                            }}
                                            style={{
                                              width: "100%",
                                              display: "flex",
                                              alignItems: "center",
                                              gap: 8,
                                              padding: "4px 8px",
                                              border: "none",
                                              background: "transparent",
                                              cursor: "pointer",
                                              borderRadius: 4,
                                              textAlign: "left",
                                            }}
                                            onMouseEnter={(e) => {
                                              e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 4%, transparent)";
                                            }}
                                            onMouseLeave={(e) => {
                                              e.currentTarget.style.backgroundColor = "transparent";
                                            }}
                                          >
                                            {pane.isMain
                                              ? <Home size={10} style={{ color: "var(--primary)", flexShrink: 0 }} />
                                              : <MessageSquare size={10} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />}
                                            <span style={{
                                              fontSize: 11,
                                              fontFamily: "var(--font-inter), Inter, sans-serif",
                                              color: "var(--foreground)",
                                            }}>
                                              {pane.label}
                                            </span>
                                          </button>
                                        ))}
                                        <div style={{ height: 1, backgroundColor: "var(--border)", margin: "2px 0" }} />
                                      </>
                                    )}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRunInNewChat(child);
                                        setRunMenuId(null);
                                        setRunMenuRect(null);
                                        setShowSubtasksPopover(false);
                                      }}
                                      style={{
                                        width: "100%",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                        padding: "8px 8px",
                                        border: "none",
                                        background: "transparent",
                                        cursor: "pointer",
                                        borderRadius: 4,
                                        textAlign: "left",
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 4%, transparent)";
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = "transparent";
                                      }}
                                    >
                                      <MessageSquare size={11} style={{ color: "var(--primary)", flexShrink: 0 }} />
                                      <span style={{
                                        fontSize: 11,
                                        fontFamily: "var(--font-inter), Inter, sans-serif",
                                        color: "var(--foreground)",
                                      }}>
                                        Start new chat
                                      </span>
                                    </button>
                                  </div>
                                </>
                              ); })()}
                            </div>
                          )}
                          {executed && (
                            <ChevronRight size={12} style={{ color: "var(--muted-foreground)", flexShrink: 0, marginTop: 3 }} />
                          )}
                        </div>
                      );
                    })}

                    {/* Add subtask row */}
                    <div style={{ padding: "8px 12px", borderTop: "1px solid var(--border)" }}>
                      {showAddSubtask ? (
                        <div style={{ display: "flex", gap: 4 }}>
                          <input
                            autoFocus
                            type="text"
                            value={newSubtaskTitle}
                            onChange={(e) => setNewSubtaskTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddSubtask();
                              } else if (e.key === "Escape") {
                                setShowAddSubtask(false);
                                setNewSubtaskTitle("");
                              }
                            }}
                            placeholder="New subtask..."
                            style={{
                              flex: 1,
                              fontSize: 12,
                              fontFamily: "var(--font-inter), Inter, sans-serif",
                              padding: "4px 8px",
                              backgroundColor: "var(--card)",
                              border: "1px solid var(--border)",
                              borderRadius: 5,
                              color: "var(--foreground)",
                              outline: "none",
                            }}
                          />
                          <button
                            onClick={handleAddSubtask}
                            disabled={!newSubtaskTitle.trim() || creatingSubtask}
                            style={{
                              padding: "0 8px",
                              border: "none",
                              borderRadius: 5,
                              background: newSubtaskTitle.trim() && !creatingSubtask
                                ? "linear-gradient(135deg, var(--primary), var(--primary))"
                                : "var(--border)",
                              color: newSubtaskTitle.trim() && !creatingSubtask ? "var(--card)" : "var(--muted-foreground)",
                              fontSize: 11,
                              fontWeight: 600,
                              cursor: newSubtaskTitle.trim() && !creatingSubtask ? "pointer" : "default",
                            }}
                          >
                            Add
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setShowAddSubtask(true)}
                          disabled={!task.projectSlug}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "4px 0",
                            border: "none",
                            background: "transparent",
                            color: "var(--muted-foreground)",
                            fontSize: 11,
                            fontFamily: "var(--font-inter), Inter, sans-serif",
                            fontWeight: 500,
                            cursor: task.projectSlug ? "pointer" : "not-allowed",
                          }}
                          onMouseEnter={(e) => {
                            if (task.projectSlug) e.currentTarget.style.color = "var(--primary)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = "var(--muted-foreground)";
                          }}
                        >
                          <Plus size={10} />
                          Add subtask
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          <button
            onClick={() => setShowBriefBanner(false)}
            style={{
              width: 18,
              height: 18,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              background: "transparent",
              color: "var(--muted-foreground)",
              cursor: "pointer",
              borderRadius: 3,
              flexShrink: 0,
            }}
          >
            <X size={10} />
          </button>
        </div>
      )}

      {/* Main chat area — full width, single column */}
      <ModalChat
        taskId={task.id}
        logEntries={mergedConversation}
        isRunning={isRunning}
        needsInput={needsInput}
        status={status}
        childTasks={childTasks}
        childLogEntries={childLogEntries}
        activePreviewPath={null}
        onPreviewFile={(f) => {
          onPreviewFile({
            id: `chat-preview-${f.relativePath}`,
            taskId: task.id,
            fileName: f.fileName,
            filePath: f.relativePath,
            relativePath: f.relativePath,
            extension: f.extension,
            sizeBytes: null,
            createdAt: new Date().toISOString(),
          });
        }}
        durationMs={task.durationMs}
        onRefresh={() => fetchLogEntries(task.id)}
      />

      {/* Next action chips — between chat and reply input */}
      <NextActionChips
        task={task}
        childTasks={childTasks}
        onInsertCommand={handleInsertCommand}
      />

      {/* Reply input */}
      <ReplyInput
        taskId={task.id}
        isVisible={showReplyInput || needsInput || isRunning || status === "review" || status === "done" || status === "running"}
        needsInput={needsInput}
        taskStatus={status}
        initialPermissionMode={task.permissionMode ?? "bypassPermissions"}
        initialExecutionPermissionMode={task.executionPermissionMode ?? null}
        initialModel={task.model ?? null}
        initialThinkingEffort={task.thinkingEffort ?? null}
        onOptimisticReply={onOptimisticReply}
        subtasks={childTasks.map(c => ({ id: c.id, title: c.title, status: c.status, phaseNumber: c.phaseNumber, gsdStep: c.gsdStep, needsInput: c.needsInput === true }))}
        onSelectSubtask={(id) => { const child = childTasks.find(c => c.id === id); if (child) handleSubtaskClick(child); }}
        onRunSubtask={(id) => { const child = childTasks.find(c => c.id === id); if (child) handleRun(child); }}
        onRunSubtaskInNewChat={(id) => { const child = childTasks.find(c => c.id === id); if (child) handleRunInNewChat(child); }}
        onRunAll={handleRunAll}
        onMarkDone={(id) => updateTask(id, { status: "done", needsInput: false })}
        availablePanes={availablePanes}
        onRunSubtaskInPane={handleRunInExistingPane}
        projectSlug={task.projectSlug}
      />

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

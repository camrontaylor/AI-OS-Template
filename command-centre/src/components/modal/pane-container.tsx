"use client";

import React, { useState } from "react";
import { X, Grid2x2, Columns2, Rows2, Terminal, Check } from "lucide-react";
import type { Task, LogEntry, OutputFile, ClaudeThinkingEffort } from "@/types/task";
import type { ChatAttachment } from "@/types/chat-composer";
import { MAIN_PANE_ID, type PaneItem, type PaneLayout } from "@/hooks/use-pane-state";
import { composeMessageWithAttachments } from "@/lib/chat-message-content";
import { useTaskStore } from "@/store/task-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChatPane } from "./chat-pane";
import { ReplyInput } from "./reply-input";
import { TerminalPane } from "./terminal-pane";
import type { SubtaskSummary } from "@/components/shared/tasks-popover";

/* ─── PaneContainer ─────────────────────────────────────────────── */

interface PaneContainerProps {
  /** Resolved visible panes (already filtered from openPanes) */
  visiblePanes: PaneItem[];
  /** All tasks (for resolving taskId on chat panes) */
  allTasks: Task[];
  /** Log entries keyed by task ID */
  logEntriesByTask: Record<string, LogEntry[]>;
  /** Which pane has focus */
  activePaneId: string | null;
  /** Layout mode */
  layout: PaneLayout;
  /** Parent task (for project context when creating new chats) */
  parentTask?: Task;
  onFocusPane: (paneId: string) => void;
  onClosePane: (paneId: string) => void;
  onPreviewFile: (file: OutputFile) => void;
  onRenamePane?: (paneId: string, newLabel: string) => void;
  onAssignTaskToPane?: (paneId: string, taskId: string) => void;
  onSetLayout?: (layout: PaneLayout) => void;
  onDropPane?: (paneId: string) => void;
  /** Render callback for the main chat pane (MAIN_PANE_ID) */
  renderMainPane?: () => React.ReactNode;
  /** Label for the main pane header (task title) */
  mainPaneLabel?: string;
  subtasks?: SubtaskSummary[];
  onSelectSubtask?: (id: string) => void;
  onRunSubtask?: (id: string) => void;
  onRunSubtaskInNewChat?: (id: string, title: string) => void;
  onRunAll?: () => void;
  onMarkTaskDone?: (taskId: string) => void;
  onMarkSubtaskDone?: (id: string) => void;
  availablePanes?: Array<{ id: string; label: string; isMain?: boolean }>;
  onRunSubtaskInPane?: (subtaskId: string, paneId: string) => void;
}

export function PaneContainer({
  visiblePanes,
  allTasks,
  logEntriesByTask,
  activePaneId,
  layout,
  parentTask,
  onFocusPane,
  onClosePane,
  onPreviewFile,
  onRenamePane,
  onAssignTaskToPane,
  onSetLayout,
  onDropPane,
  renderMainPane,
  mainPaneLabel,
  subtasks,
  onSelectSubtask,
  onRunSubtask,
  onRunSubtaskInNewChat,
  onRunAll,
  onMarkTaskDone,
  onMarkSubtaskDone,
  availablePanes,
  onRunSubtaskInPane,
}: PaneContainerProps) {
  const [dropHover, setDropHover] = useState(false);
  const multiPane = visiblePanes.length > 1;

  // Resolve display label — main pane uses mainPaneLabel prop (task title)
  const getPaneLabel = (pane: PaneItem) =>
    pane.id === MAIN_PANE_ID ? (mainPaneLabel || parentTask?.title || "Chat") : pane.label;

  // Resolve task for a pane (for resume/done buttons)
  const getPaneTask = (pane: PaneItem) =>
    pane.taskId ? allTasks.find((t) => t.id === pane.taskId) : undefined;
  function renderPaneContent(paneItem: PaneItem, isFocused: boolean) {
    // Main chat pane — rendered by parent via callback
    if (paneItem.id === MAIN_PANE_ID && renderMainPane) {
      return <>{renderMainPane()}</>;
    }

    if (paneItem.type === "terminal") {
      return (
        <TerminalPane
          paneId={paneItem.id}
          label={paneItem.label}
          isFocused={isFocused}
          onFocus={() => onFocusPane(paneItem.id)}
          onClose={() => onClosePane(paneItem.id)}
          compact={multiPane}
        />
      );
    }

    const task = paneItem.taskId
      ? allTasks.find((t) => t.id === paneItem.taskId)
      : undefined;

    if (task) {
      return (
        <ChatPane
          task={task}
          logEntries={logEntriesByTask[task.id] ?? []}
          isFocused={isFocused}
          onFocus={() => onFocusPane(paneItem.id)}
          onClose={() => onClosePane(paneItem.id)}
          onPreviewFile={onPreviewFile}
          compact={multiPane}
          subtasks={subtasks}
          onSelectSubtask={onSelectSubtask}
          onRunSubtask={onRunSubtask}
          onRunSubtaskInNewChat={onRunSubtaskInNewChat}
          onRunAll={onRunAll}
          onMarkSubtaskDone={onMarkSubtaskDone}
          availablePanes={availablePanes}
          onRunSubtaskInPane={onRunSubtaskInPane}
        />
      );
    }

    // Empty chat pane
    return (
      <div
        onClick={() => onFocusPane(paneItem.id)}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <div style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted-foreground)",
          fontSize: 13,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          padding: 24,
          textAlign: "center",
          lineHeight: 1.5,
        }}>
          Type a message below to start a new Claude conversation
        </div>
        <ReplyInput
          taskId="empty"
          isVisible={true}
          needsInput={false}
          taskStatus="backlog"
          initialPermissionMode={parentTask?.permissionMode ?? "bypassPermissions"}
          initialExecutionPermissionMode={parentTask?.executionPermissionMode ?? null}
          initialModel={parentTask?.model ?? null}
          initialThinkingEffort={parentTask?.thinkingEffort ?? null}
          subtasks={subtasks}
          onSelectSubtask={onSelectSubtask}
          onRunSubtask={onRunSubtask}
          onRunAll={onRunAll}
          compact={multiPane}
          onCreatePaneTask={async (msg: string, permMode: string, model, thinkingEffort: ClaudeThinkingEffort | null, attachments: ChatAttachment[]) => {
            if (!parentTask) return null;
            const fullMessage = composeMessageWithAttachments(msg, attachments);
            const titleSource = msg.trim() || (attachments.length === 1 ? attachments[0].fileName : `Attached ${attachments.length} files`);
            const title = titleSource.length > 80 ? titleSource.slice(0, 77) + "..." : titleSource;
            const autoLabel = titleSource.length > 40 ? titleSource.slice(0, 37) + "..." : titleSource;
            onRenamePane?.(paneItem.id, autoLabel);
            const createTask = useTaskStore.getState().createTask;
            const newId = await createTask(
              title, fullMessage, "task",
              parentTask.projectSlug ?? null,
              parentTask.id,
              permMode,
              "queued",
              parentTask.clientId,
              model,
              thinkingEffort,
            );
            if (newId) {
              onAssignTaskToPane?.(paneItem.id, newId);
              // Append to brief deliverables if project has a brief
              if (parentTask.projectSlug) {
                try {
                  await fetch("/api/briefs/sync", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      action: "add-to-brief",
                      projectSlug: parentTask.projectSlug,
                      parentId: parentTask.id,
                      deliverable: title,
                    }),
                  });
                } catch {}
              }
              try {
                await fetch(`/api/tasks/${newId}/execute`, { method: "POST" });
              } catch {}
              useTaskStore.setState((state) => ({
                tasks: state.tasks.map((t) =>
                  t.id === newId
                    ? { ...t, status: "running" as const, activityLabel: "Starting Claude session...", startedAt: new Date().toISOString() }
                    : t,
                ),
              }));
              return newId;
            }
            return null;
          }}
        />
      </div>
    );
  }

  // Drop zone handlers
  const handleDragOver = (e: React.DragEvent) => {
    if (visiblePanes.length >= 4) return;
    const paneId = e.dataTransfer.types.includes("application/x-pane-id") ? "pending" : null;
    if (!paneId) return;
    e.preventDefault();
    setDropHover(true);
  };
  const handleDragLeave = () => setDropHover(false);
  const handleDrop = (e: React.DragEvent) => {
    setDropHover(false);
    const paneId = e.dataTransfer.getData("application/x-pane-id");
    if (paneId && onDropPane) {
      e.preventDefault();
      onDropPane(paneId);
    }
  };

  if (visiblePanes.length === 0) return null;

  // Single pane — full width, no header. Column so the main pane's stacked
  // children (ModalChat header + messages, then ReplyInput composer) lay out
  // vertically (messages fill, composer pinned to the bottom) instead of
  // side-by-side. ModalChat returns a fragment, so this parent owns the axis.
  if (!multiPane) {
    const pane = visiblePanes[0];
    return (
      <div
        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0, minHeight: 0 }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {renderPaneContent(pane, true)}
        {dropHover && <DropOverlay />}
      </div>
    );
  }

  // Multiple panes — stacked (grid) or side-by-side (horizontal)
  const useGrid = layout === "grid" && visiblePanes.length >= 2;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
        minWidth: 0,
        minHeight: 0,
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Layout toggle — available when 2+ panes */}
      {visiblePanes.length >= 2 && onSetLayout && (
        <div className="flex shrink-0 justify-end gap-1 px-2 py-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onSetLayout("horizontal")}
            className={cn(
              "size-[24px] rounded",
              layout === "horizontal" ? "bg-muted/60 text-primary" : "text-muted-foreground",
            )}
          >
            <Columns2 className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onSetLayout("grid")}
            className={cn(
              "size-[24px] rounded",
              layout === "grid" ? "bg-muted/60 text-primary" : "text-muted-foreground",
            )}
          >
            {visiblePanes.length <= 2 ? <Rows2 className="size-3" /> : <Grid2x2 className="size-3" />}
          </Button>
        </div>
      )}

      {useGrid ? (
        /* Grid: 2 panes = vertical stack, 3-4 panes = 2x2 grid */
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          {visiblePanes.length <= 2 ? (
            /* Vertical stack — each pane in its own row */
            visiblePanes.map((pane, idx) => (
              <React.Fragment key={pane.id}>
                {idx > 0 && <div style={{ height: 1, backgroundColor: "var(--border)", flexShrink: 0 }} />}
                <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
                  <PaneWrapper
                    pane={pane}
                    displayLabel={getPaneLabel(pane)}
                    isFocused={activePaneId === pane.id}
                    onFocus={() => onFocusPane(pane.id)}
                    onClose={() => onClosePane(pane.id)}
                    borderLeft={false}
                    canClose={visiblePanes.length > 1}

                    taskStatus={getPaneTask(pane)?.status}
                    onMarkDone={pane.taskId && onMarkTaskDone ? () => onMarkTaskDone(pane.taskId!) : undefined}
                  >
                    {renderPaneContent(pane, activePaneId === pane.id)}
                  </PaneWrapper>
                </div>
              </React.Fragment>
            ))
          ) : (
            /* 2x2 grid — top row + bottom row */
            <>
              <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
                {visiblePanes.slice(0, 2).map((pane, idx) => (
                  <PaneWrapper
                    key={pane.id}
                    pane={pane}
                    displayLabel={getPaneLabel(pane)}
                    isFocused={activePaneId === pane.id}
                    onFocus={() => onFocusPane(pane.id)}
                    onClose={() => onClosePane(pane.id)}
                    borderLeft={idx > 0}
                    canClose={visiblePanes.length > 1}

                    taskStatus={getPaneTask(pane)?.status}
                    onMarkDone={pane.taskId && onMarkTaskDone ? () => onMarkTaskDone(pane.taskId!) : undefined}
                  >
                    {renderPaneContent(pane, activePaneId === pane.id)}
                  </PaneWrapper>
                ))}
              </div>
              <div style={{ height: 1, backgroundColor: "var(--border)", flexShrink: 0 }} />
              <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
                {visiblePanes.slice(2, 4).map((pane, idx) => (
                  <PaneWrapper
                    key={pane.id}
                    pane={pane}
                    displayLabel={getPaneLabel(pane)}
                    isFocused={activePaneId === pane.id}
                    onFocus={() => onFocusPane(pane.id)}
                    onClose={() => onClosePane(pane.id)}
                    borderLeft={idx > 0}
                    canClose={visiblePanes.length > 1}

                    taskStatus={getPaneTask(pane)?.status}
                    onMarkDone={pane.taskId && onMarkTaskDone ? () => onMarkTaskDone(pane.taskId!) : undefined}
                  >
                    {renderPaneContent(pane, activePaneId === pane.id)}
                  </PaneWrapper>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        /* Horizontal row */
        <div style={{ flex: 1, display: "flex", overflow: "hidden", minWidth: 0, minHeight: 0 }}>
          {visiblePanes.map((pane, idx) => (
            <PaneWrapper
              key={pane.id}
              pane={pane}
              displayLabel={getPaneLabel(pane)}
              isFocused={activePaneId === pane.id}
              onFocus={() => onFocusPane(pane.id)}
              onClose={() => onClosePane(pane.id)}
              borderLeft={idx > 0}
              canClose={visiblePanes.length > 1}
              taskStatus={getPaneTask(pane)?.status}
              onMarkDone={pane.taskId && onMarkTaskDone ? () => onMarkTaskDone(pane.taskId!) : undefined}
            >
              {renderPaneContent(pane, activePaneId === pane.id)}
            </PaneWrapper>
          ))}
        </div>
      )}

      {dropHover && <DropOverlay />}
    </div>
  );
}

/* ─── PaneWrapper — name header + content ───────────────────────── */

function PaneWrapper({
  pane,
  displayLabel,
  isFocused,
  onFocus,
  onClose,
  borderLeft,
  canClose = true,
  taskStatus,
  onMarkDone,
  children,
}: {
  pane: PaneItem;
  displayLabel: string;
  isFocused: boolean;
  onFocus: () => void;
  onClose: () => void;
  borderLeft: boolean;
  canClose?: boolean;
  taskStatus?: string;
  onMarkDone?: () => void;
  children: React.ReactNode;
}) {

  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      borderLeft: borderLeft ? "1px solid var(--border)" : undefined,
    }}>
      {/* Name header */}
      <div
        onClick={onFocus}
        style={{
          height: 28,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 12px",
          backgroundColor: isFocused ? "color-mix(in srgb, var(--foreground) 3%, transparent)" : "var(--card)",
          borderBottom: isFocused ? "2px solid var(--primary)" : "1px solid var(--border)",
          flexShrink: 0,
          cursor: "pointer",
        }}
      >
        {pane.type === "terminal" && (
          <Terminal size={11} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />
        )}
        <span style={{
          flex: 1,
          fontSize: 11,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontWeight: 600,
          color: isFocused ? "var(--foreground)" : "var(--muted-foreground)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {displayLabel}
        </span>

        {onMarkDone && taskStatus !== "done" && (
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => { e.stopPropagation(); onMarkDone(); }}
            title="Mark as done"
            className="size-[20px] shrink-0 rounded text-muted-foreground"
          >
            <Check className="size-3" />
          </Button>
        )}
        {canClose && (
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="size-[20px] shrink-0 rounded text-muted-foreground hover:text-primary"
          >
            <X className="size-3" />
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}

/* ─── Drop overlay ──────────────────────────────────────────────── */

function DropOverlay() {
  return (
    <div style={{
      position: "absolute",
      inset: 0,
      backgroundColor: "color-mix(in srgb, var(--foreground) 6%, transparent)",
      border: "2px dashed var(--border)",
      borderRadius: 8,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 10,
      pointerEvents: "none",
    }}>
      <span style={{
        fontSize: 13,
        fontFamily: "var(--font-inter), Inter, sans-serif",
        fontWeight: 600,
        color: "var(--primary)",
        opacity: 0.6,
      }}>
        Drop to add to viewport
      </span>
    </div>
  );
}

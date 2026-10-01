"use client";

import { useState, useCallback, useMemo } from "react";
import { Terminal, Copy, CheckCircle2, RotateCcw } from "lucide-react";
import type { Task, LogEntry, OutputFile } from "@/types/task";
import { useTaskStore } from "@/store/task-store";
import { ModalChat } from "./modal-chat";
import { ReplyInput } from "./reply-input";
import type { SubtaskSummary } from "@/components/shared/tasks-popover";
import {
  getEditedLineageRootTaskId,
  getVisibleEditedTasks,
  type BranchCreatedContext,
} from "@/lib/task-branch-ui";
import { getContainerAwareStatus, isParentContainerRun } from "@/lib/task-run-state";

interface ChatPaneProps {
  task: Task;
  logEntries: LogEntry[];
  isFocused: boolean;
  onFocus: () => void;
  onClose: () => void;
  onPreviewFile: (file: OutputFile) => void;
  /** Compact mode for when split with another pane */
  compact?: boolean;
  /** Parent's planned subtasks — shown in the subtasks popover */
  subtasks?: SubtaskSummary[];
  /** Handler when a subtask is selected from the popover */
  onSelectSubtask?: (id: string) => void;
  /** Execute a subtask */
  onRunSubtask?: (id: string) => void;
  /** Execute a subtask in a new chat pane */
  onRunSubtaskInNewChat?: (id: string, title: string) => void;
  /** Execute all backlog subtasks */
  onRunAll?: () => void;
  /** Mark a subtask as done */
  onMarkSubtaskDone?: (id: string) => void;
  /** Available chat panes for "Add to existing chat" picker */
  availablePanes?: Array<{ id: string; label: string; isMain?: boolean }>;
  /** Run a subtask in a specific existing pane */
  onRunSubtaskInPane?: (subtaskId: string, paneId: string) => void;
  /** Replace the visible chat after a message edit creates its internal task. */
  onBranchCreated?: (task: Task, context: BranchCreatedContext) => void;
  readOnly?: boolean;
  presentation?: "default" | "feed";
}

export function ChatPane({
  task,
  logEntries,
  isFocused,
  onFocus,
  onClose,
  onPreviewFile,
  compact = false,
  subtasks,
  onSelectSubtask,
  onRunSubtask,
  onRunSubtaskInNewChat,
  onRunAll,
  onMarkSubtaskDone,
  availablePanes,
  onRunSubtaskInPane,
  onBranchCreated,
  readOnly = false,
  presentation = "default",
}: ChatPaneProps) {
  const feedPresentation = presentation === "feed";
  const appendLogEntry = useTaskStore((s) => s.appendLogEntry);
  const fetchLogEntries = useTaskStore((s) => s.fetchLogEntries);
  const updateTask = useTaskStore((s) => s.updateTask);
  const allTasks = useTaskStore((s) => s.tasks);
  const [resumeCopied, setResumeCopied] = useState(false);
  const visibleTasks = useMemo(() => getVisibleEditedTasks(allTasks), [allTasks]);
  const taskRootId = getEditedLineageRootTaskId(task.id, allTasks);
  const children = visibleTasks.filter((t) => t.parentId === task.id || t.parentId === taskRootId);
  const hasChildren = children.length > 0;
  const hasRunningChildren = children.some((c) => c.status === "running" || c.status === "queued");
  const isContainerRun = isParentContainerRun({
    status: task.status,
    parentId: task.parentId,
    childCount: children.length,
    claudePid: task.claudePid ?? null,
    activityLabel: task.activityLabel ?? null,
  });
  const composerStatus = getContainerAwareStatus({
    status: task.status,
    parentId: task.parentId,
    childCount: children.length,
    claudePid: task.claudePid ?? null,
    activityLabel: task.activityLabel ?? null,
  });
  const isRunning = task.status === "running" && !isContainerRun;
  const directNeedsInput = task.needsInput === true
    || task.status === "review"
    || (task.status === "running" && !!task.activityLabel?.trimEnd().endsWith("?"));
  const childNeedsInput = (c: typeof children[0]) =>
    c.needsInput === true || c.status === "review"
    || (c.status === "running" && !!c.activityLabel?.trimEnd().endsWith("?"));
  const allChildrenNeedInput = hasChildren
    && children.filter((c) => c.status === "running").every(childNeedsInput)
    && !children.some((c) => c.status === "queued");
  const needsInput = directNeedsInput || (task.status === "running" && allChildrenNeedInput && hasRunningChildren);
  const sessionId = task.claudeSessionId;

  const isDone = task.status === "done";

  const handleMarkDone = useCallback(() => {
    updateTask(task.id, { status: "done", needsInput: false });
  }, [updateTask, task.id]);

  const handleReopen = useCallback(() => {
    updateTask(task.id, { status: "review" });
  }, [updateTask, task.id]);

  const showDoneToggle = task.status !== "backlog" && !isDone;

  return (
    <div
      data-feed-chat-shell={feedPresentation ? "true" : undefined}
      onClick={() => {
        onFocus();
      }}
      style={{
        flex: 1,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minWidth: 0,
        minHeight: 0,
        border: feedPresentation ? "none" : isDone ? "1px solid var(--cc-control-bg-active)" : "1px solid var(--cc-control-bg-hover)",
        borderRadius: feedPresentation ? 0 : 8,
        background: feedPresentation ? "transparent" : isDone ? "var(--cc-canvas-subtle)" : "var(--cc-surface)",
        opacity: feedPresentation ? 1 : isDone ? 0.7 : 1,
        transition: "opacity 200ms ease, background 200ms ease",
      }}
    >
      {/* Action bar — mark done + resume */}
      {!feedPresentation && !readOnly && (sessionId || showDoneToggle || isDone) && (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 6,
          padding: "4px 10px",
          borderBottom: "1px solid var(--cc-control-bg)",
          flexShrink: 0,
          backgroundColor: isDone ? "var(--cc-surface-muted)" : "var(--cc-surface-raised)",
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
        }}>
          {sessionId && !isDone && (
            <>
              <span style={{
                fontSize: 10,
                fontFamily: "'DM Mono', monospace",
                color: "var(--cc-text-tertiary)",
                flexShrink: 0,
              }}>
                {task.claudeSessionId?.slice(0, 12)}...
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(`claude --resume ${sessionId}`);
                  setResumeCopied(true);
                  setTimeout(() => setResumeCopied(false), 2000);
                }}
                title={resumeCopied ? "Copied!" : `claude --resume ${sessionId}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  padding: "2px 8px",
                  border: "none",
                  borderRadius: 4,
                  backgroundColor: resumeCopied ? "var(--cc-status-success-bg)" : "var(--cc-brand-alpha-06)",
                  color: resumeCopied ? "var(--cc-status-success)" : "var(--cc-brand-primary)",
                  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: "pointer",
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  if (!resumeCopied) e.currentTarget.style.backgroundColor = "var(--cc-brand-alpha-12)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = resumeCopied
                    ? "var(--cc-status-success-bg)"
                    : "var(--cc-brand-alpha-06)";
                }}
              >
                {resumeCopied ? <Copy size={10} /> : <Terminal size={10} />}
                {resumeCopied ? "Copied" : "Resume"}
              </button>
            </>
          )}
          {showDoneToggle && (
            <button
              onClick={(e) => { e.stopPropagation(); handleMarkDone(); }}
              title="Mark conversation as complete"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                padding: "2px 8px",
                border: "none",
                borderRadius: 4,
                backgroundColor: "var(--cc-status-success-bg-soft)",
                color: "var(--cc-status-success)",
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                fontSize: 10,
                fontWeight: 600,
                cursor: "pointer",
                flexShrink: 0,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--cc-status-success-bg)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--cc-status-success-bg-soft)"; }}
            >
              <CheckCircle2 size={10} />
              Done
            </button>
          )}
          {isDone && (
            <button
              onClick={(e) => { e.stopPropagation(); handleReopen(); }}
              title="Reopen this conversation"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                padding: "2px 8px",
                border: "none",
                borderRadius: 4,
                backgroundColor: "var(--cc-brand-alpha-06)",
                color: "var(--cc-brand-primary)",
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                fontSize: 10,
                fontWeight: 600,
                cursor: "pointer",
                flexShrink: 0,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--cc-brand-alpha-12)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--cc-brand-alpha-06)"; }}
            >
              <RotateCcw size={10} />
              Reopen
            </button>
          )}
        </div>
      )}

      {/* Completed Chats stay readable; Feed makes the Reopen action visible. */}
      {isDone && !readOnly && (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: "8px 12px",
          backgroundColor: "var(--cc-status-success-bg-soft)",
          borderBottom: "1px solid var(--cc-control-bg)",
          flexShrink: 0,
        }}>
          <CheckCircle2 size={12} style={{ color: "var(--cc-status-success)" }} />
          <span style={{
            fontSize: 11,
            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
            fontWeight: 500,
            color: "var(--cc-status-success)",
          }}>
            Complete
          </span>
          {feedPresentation ? (
            <>
              <span aria-hidden="true" style={{ color: "var(--cc-text-tertiary)" }}>—</span>
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); handleReopen(); }}
                style={{
                  border: 0,
                  padding: 0,
                  background: "transparent",
                  color: "var(--cc-brand-primary)",
                  font: "600 11px/1 var(--cc-font-label)",
                  cursor: "pointer",
                }}
              >
                Reopen
              </button>
            </>
          ) : null}
        </div>
      )}
      <ModalChat
        taskId={task.id}
        logEntries={logEntries}
        isRunning={isRunning}
        needsInput={needsInput}
        status={task.status}
        contextSources={task.contextSources}
        activePreviewPath={null}
        onPreviewFile={(f) => {
          onPreviewFile({
            id: `pane-preview-${f.relativePath}`,
            taskId: task.id,
            fileName: f.fileName,
            filePath: f.relativePath,
            relativePath: f.relativePath,
            extension: f.extension,
            sizeBytes: null,
            createdAt: new Date().toISOString(),
            directoryHint: f.directoryHint,
          });
        }}
        activityLabel={hasChildren ? null : task.activityLabel}
        startedAt={task.startedAt}
        lastReplyAt={task.lastReplyAt}
        costUsd={task.costUsd}
        tokensUsed={task.tokensUsed}
        errorMessage={task.errorMessage}
        durationMs={task.durationMs}
        onRefresh={() => fetchLogEntries(task.id)}
        onBranchCreated={onBranchCreated}
        readOnly={readOnly}
        presentation={presentation}
      />

      {/* Reply input — hidden when done */}
      {!isDone && (
        <ReplyInput
          taskId={task.id}
          isVisible={true}
          needsInput={needsInput}
          taskStatus={composerStatus ?? undefined}
          initialPermissionMode={task.permissionMode ?? "bypassPermissions"}
          initialExecutionPermissionMode={task.executionPermissionMode ?? null}
          initialModel={task.model ?? null}
          initialThinkingEffort={task.thinkingEffort ?? null}
          onOptimisticReply={(entry: LogEntry) => appendLogEntry(task.id, entry)}
          subtasks={subtasks}
          onSelectSubtask={onSelectSubtask}
          onRunSubtask={onRunSubtask}
          onRunSubtaskInNewChat={onRunSubtaskInNewChat}
          onRunAll={onRunAll}
          onMarkDone={onMarkSubtaskDone}
          availablePanes={availablePanes}
          onRunSubtaskInPane={onRunSubtaskInPane}
          compact={compact}
          presentation={presentation}
          hideTasksPopover={task.level === "task"}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}

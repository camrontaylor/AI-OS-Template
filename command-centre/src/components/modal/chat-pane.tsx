"use client";

import { useState, useCallback } from "react";
import { Terminal, Copy, CheckCircle2, RotateCcw } from "lucide-react";
import type { Task, LogEntry, OutputFile } from "@/types/task";
import { useTaskStore } from "@/store/task-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ModalChat } from "./modal-chat";
import { ReplyInput } from "./reply-input";
import type { SubtaskSummary } from "@/components/shared/tasks-popover";

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
}: ChatPaneProps) {
  const appendLogEntry = useTaskStore((s) => s.appendLogEntry);
  const fetchLogEntries = useTaskStore((s) => s.fetchLogEntries);
  const updateTask = useTaskStore((s) => s.updateTask);
  const allTasks = useTaskStore((s) => s.tasks);
  const [resumeCopied, setResumeCopied] = useState(false);
  const children = allTasks.filter((t) => t.parentId === task.id);
  const hasChildren = children.length > 0;
  const hasRunningChildren = children.some((c) => c.status === "running" || c.status === "queued");
  // For parent tasks with children: the parent's own session is done (scoping).
  // The parent should only appear "running" if it has no children and is itself running.
  const isRunning = hasChildren ? false : task.status === "running";
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
      onClick={() => {
        onFocus();
      }}
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card transition-opacity",
        isDone ? "border-border opacity-70" : "border-border",
      )}
    >
      {/* Action bar — mark done + resume */}
      {(sessionId || showDoneToggle || isDone) && (
        <div
          className={cn(
            "flex shrink-0 items-center justify-end gap-2 rounded-t-lg border-b border-border px-3 py-1",
            isDone ? "bg-muted" : "bg-card",
          )}
        >
          {sessionId && !isDone && (
            <>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {task.claudeSessionId?.slice(0, 12)}...
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(`claude --resume ${sessionId}`);
                  setResumeCopied(true);
                  setTimeout(() => setResumeCopied(false), 2000);
                }}
                title={resumeCopied ? "Copied!" : `claude --resume ${sessionId}`}
                className="h-auto shrink-0 gap-1 px-2 py-1 text-[10px] font-semibold"
              >
                {resumeCopied ? <Copy className="size-3" /> : <Terminal className="size-3" />}
                {resumeCopied ? "Copied" : "Resume"}
              </Button>
            </>
          )}
          {showDoneToggle && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); handleMarkDone(); }}
              title="Mark conversation as complete"
              className="h-auto shrink-0 gap-1 px-2 py-1 text-[10px] font-semibold"
            >
              <CheckCircle2 className="size-3" />
              Done
            </Button>
          )}
          {isDone && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); handleReopen(); }}
              title="Reopen this conversation"
              className="h-auto shrink-0 gap-1 px-2 py-1 text-[10px] font-semibold"
            >
              <RotateCcw className="size-3" />
              Reopen
            </Button>
          )}
        </div>
      )}

      {/* Done overlay banner */}
      {isDone && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
          <CheckCircle2 className="size-3 text-muted-foreground" />
          <span className="text-[11px] font-medium text-muted-foreground">
            Complete
          </span>
        </div>
      )}
      <ModalChat
        taskId={task.id}
        logEntries={logEntries}
        isRunning={isRunning}
        needsInput={needsInput}
        status={task.status}
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
      />

      {/* Reply input — hidden when done */}
      {!isDone && (
        <ReplyInput
          taskId={task.id}
          isVisible={true}
          needsInput={needsInput}
          taskStatus={task.status}
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
          hideTasksPopover={task.level === "task"}
        />
      )}
    </div>
  );
}

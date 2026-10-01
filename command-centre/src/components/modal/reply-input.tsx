"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { ArrowUp, Paperclip, Square } from "lucide-react";
import type { LogEntry, PermissionMode, ClaudeModel, ClaudeThinkingEffort, Todo } from "@/types/task";
import type { ChatAttachment } from "@/types/chat-composer";
import { useTaskStore } from "@/store/task-store";
import { createExclusiveSubmitLock } from "@/lib/exclusive-submit-lock";
import { SlashCommandMenu } from "@/components/shared/slash-command-menu";
import type { TagItem } from "@/components/shared/slash-command-menu";
import { PermissionPicker, type PermissionPickerMode } from "@/components/shared/permission-picker";
import { ModelPicker } from "@/components/shared/model-picker";
import { ThinkingEffortPicker } from "@/components/shared/thinking-effort-picker";
import { ComposerAssetTray } from "@/components/shared/composer-asset-tray";
import { ComposerDraftAssetCollection } from "@/components/shared/composer-draft-asset-collection";
import { ComposerEditorModal, EditorExpandButton } from "@/components/shared/composer-editor-modal";
import { TasksPopover, type SubtaskSummary } from "@/components/shared/tasks-popover";
import { ContextUsageRing } from "./context-usage-ring";
import { parseTodosFromInput } from "@/lib/claude-parser";
import { useChatComposer } from "@/hooks/use-chat-composer";
import { composeMessageWithAttachments } from "@/lib/chat-message-content";
import {
  getExecutionPermissionMode,
  getPermissionStateForPickerChange,
  getPickerPermissionMode,
  normalizePermissionMode,
} from "@/lib/permission-mode";
import { normalizeClaudeThinkingEffortForModel } from "@/lib/claude-options";
import {
  DEFAULT_CLAUDE_LLM_PREFERENCE,
  loadClaudeLlmPreference,
  saveClaudeLlmPreference,
} from "@/lib/llm-preferences";
import {
  getActiveSlashCommandToken,
  replaceActiveSlashCommand,
  type SlashCommand,
} from "@/lib/slash-commands";
import { recordTagUsage } from "@/components/board/goal-chips";
import { syncComposerTextareaHeight } from "@/lib/composer";
import { useComposerResize } from "@/hooks/use-composer-resize";
import { useComposerExpansionTrigger } from "@/hooks/use-composer-expansion-trigger";
import { getChatAttachmentExtension } from "@/lib/chat-attachment-policy";
import { getTaskComposerPrimaryAction } from "@/lib/task-composer";
import { readApiError } from "@/lib/api-error";
import { getFeedComposerTextareaMaxHeight } from "@/lib/feed-chat-layout";

/** Renders a highlight mirror behind a transparent textarea so @tags and
 *  /commands appear colored while the user types normally. */
export function HighlightMirror({
  text,
  style,
  scrollTop = 0,
  scrollLeft = 0,
}: {
  text: string;
  style: React.CSSProperties;
  scrollTop?: number;
  scrollLeft?: number;
}) {
  // Split text into segments: @tag, /command, or plain text
  const parts: { text: string; kind: "tag" | "command" | "plain" }[] = [];
  const re = /((?:^|\s)(@[\w\/-]+))|((?:^|\s)(\/[\w:.-]+))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const fullMatch = match[0];
    const start = match.index;
    if (start > lastIndex) {
      parts.push({ text: text.slice(lastIndex, start), kind: "plain" });
    }
    if (match[2]) {
      // Leading whitespace stays plain
      const leading = fullMatch.slice(0, fullMatch.indexOf("@"));
      if (leading) parts.push({ text: leading, kind: "plain" });
      parts.push({ text: match[2], kind: "tag" });
    } else if (match[4]) {
      const leading = fullMatch.slice(0, fullMatch.indexOf("/"));
      if (leading) parts.push({ text: leading, kind: "plain" });
      parts.push({ text: match[4], kind: "command" });
    }
    lastIndex = start + fullMatch.length;
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), kind: "plain" });
  }

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          ...style,
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          whiteSpace: "pre-wrap",
          overflow: "hidden",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
          wordWrap: "break-word",
          maxWidth: "100%",
          color: "var(--cc-text-primary)",
          transform: `translate(${-scrollLeft}px, ${-scrollTop}px)`,
        }}
      >
        {parts.map((p, i) =>
          p.kind === "tag" ? (
            <span key={i} style={{ color: "var(--cc-brand-primary)" }}>{p.text}</span>
          ) : p.kind === "command" ? (
            <span key={i} style={{ color: "var(--cc-status-purple)" }}>{p.text}</span>
          ) : (
            <span key={i}>{p.text}</span>
          )
        )}
        {/* Trailing space to match textarea line height */}
        {"\u200B"}
      </div>
    </div>
  );
}

interface ReplyInputProps {
  taskId: string;
  isVisible: boolean;
  needsInput?: boolean;
  taskStatus?: string | null;
  onOptimisticReply?: (entry: LogEntry) => void;
  /** Initial permission mode (sourced from the task row). */
  initialPermissionMode?: PermissionMode;
  /** Execution mode staged while the task is in plan mode. */
  initialExecutionPermissionMode?: PermissionMode | null;
  /** Initial model selection (sourced from the task row). */
  initialModel?: ClaudeModel | null;
  /** Initial thinking effort selection (sourced from the task row). */
  initialThinkingEffort?: ClaudeThinkingEffort | null;
  /** Real child subtasks for the Subtasks popover. */
  subtasks?: SubtaskSummary[];
  /** Click handler for a subtask row. */
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
  /** When set, the first message creates a new pane task instead of replying.
   *  Returns the new task ID on success, null on failure. */
  onCreatePaneTask?: (message: string, permissionMode: string, model: ClaudeModel | null, thinkingEffort: ClaudeThinkingEffort | null, attachments: ChatAttachment[]) => Promise<string | null>;
  /** Compact mode — shrink toolbar elements (for multi-pane layouts) */
  compact?: boolean;
  presentation?: "default" | "feed";
  /** Project slug — used to pin the relevant brief at the top of the @ menu */
  projectSlug?: string | null;
  /** Hide the tasks/todos popover (e.g. for single tasks without a plan) */
  hideTasksPopover?: boolean;
  readOnly?: boolean;
}

export function ReplyInput({
  taskId,
  isVisible,
  needsInput,
  taskStatus,
  onOptimisticReply,
  initialPermissionMode = "bypassPermissions",
  initialExecutionPermissionMode = null,
  initialModel = null,
  initialThinkingEffort = null,
  subtasks,
  onSelectSubtask,
  onRunSubtask,
  onRunSubtaskInNewChat,
  onRunAll,
  onMarkDone,
  availablePanes,
  onRunSubtaskInPane,
  onCreatePaneTask,
  compact,
  presentation = "default",
  projectSlug,
  hideTasksPopover,
  readOnly = false,
}: ReplyInputProps) {
  const feedPresentation = presentation === "feed";
  const dense = compact || feedPresentation;
  const createsPaneTask = Boolean(onCreatePaneTask);
  const [isSending, setIsSending] = useState(false);
  const submitLockRef = useRef(createExclusiveSubmitLock());
  const [error, setError] = useState<string | null>(null);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const [promptTags, setPromptTags] = useState<TagItem[]>([]);
  const [activePermissionMode, setActivePermissionMode] = useState<PermissionMode>(
    normalizePermissionMode(initialPermissionMode, "bypassPermissions"),
  );
  const [executionPermissionMode, setExecutionPermissionMode] = useState<PermissionMode>(
    getExecutionPermissionMode(
      initialExecutionPermissionMode ?? initialPermissionMode,
      "bypassPermissions",
    ),
  );
  const [model, setModel] = useState<ClaudeModel | null>(() =>
    createsPaneTask && initialModel == null && initialThinkingEffort == null
      ? DEFAULT_CLAUDE_LLM_PREFERENCE.model
      : initialModel
  );
  const [thinkingEffort, setThinkingEffort] = useState<ClaudeThinkingEffort | null>(() =>
    createsPaneTask && initialModel == null && initialThinkingEffort == null
      ? DEFAULT_CLAUDE_LLM_PREFERENCE.reasoningEffort
      : initialThinkingEffort ?? "auto"
  );
  const composer = useChatComposer({
    surface: "task",
    scopeId: taskId,
  });
  const updateTask = useTaskStore((s) => s.updateTask);
  const cancelTask = useTaskStore((s) => s.cancelTask);
  const logEntries = useTaskStore((s) => s.logEntries[taskId]) ?? [];
  const primaryAction = getTaskComposerPrimaryAction(taskStatus);
  const isStopAction = primaryAction === "stop";
  const hasAssets =
    composer.attachments.length > 0 ||
    composer.uploads.length > 0 ||
    composer.pastedBlocks.length > 0;
  const [mirrorScroll, setMirrorScroll] = useState({ top: 0, left: 0 });
  const [isCancelling, setIsCancelling] = useState(false);
  const [isComposerModalOpen, setIsComposerModalOpen] = useState(false);
  const inlineTextareaRef = useRef<HTMLTextAreaElement>(null);
  const feedComposerRef = useRef<HTMLDivElement>(null);
  const [feedShellHeight, setFeedShellHeight] = useState<number | null>(null);
  const minComposerHeight = feedPresentation ? 36 : dense ? 44 : 60;
  const maxComposerHeight = feedPresentation
    ? getFeedComposerTextareaMaxHeight(feedShellHeight, minComposerHeight)
    : dense ? 220 : 320;
  const { composerHeight, hasUserResized, handleResizePointerDown } = useComposerResize({
    minHeight: minComposerHeight,
    maxHeight: maxComposerHeight,
    initialHeight: minComposerHeight,
  });

  const permissionMode = useMemo(
    () => getPickerPermissionMode(activePermissionMode, executionPermissionMode, taskStatus),
    [activePermissionMode, executionPermissionMode, taskStatus],
  );

  // Fetch prompt tags on mount
  useEffect(() => {
    fetch("/api/prompt-tags")
      .then((r) => r.json())
      .then((data) => setPromptTags((data.tags ?? []).map((t: { name: string; body: string; category?: string; description?: string }) => ({ name: t.name, body: t.body, category: t.category, description: t.description }))))
      .catch(() => {});
  }, []);

  // Re-sync when switching tasks
  useEffect(() => {
    setActivePermissionMode(normalizePermissionMode(initialPermissionMode, "bypassPermissions"));
    setExecutionPermissionMode(
      getExecutionPermissionMode(
        initialExecutionPermissionMode ?? initialPermissionMode,
        "bypassPermissions",
      ),
    );
    if (createsPaneTask && initialModel == null && initialThinkingEffort == null) {
      const preference = loadClaudeLlmPreference();
      setModel(preference.model);
      setThinkingEffort(preference.reasoningEffort);
    } else {
      setModel(initialModel);
      setThinkingEffort(initialThinkingEffort ?? "auto");
    }
  }, [taskId, initialPermissionMode, initialExecutionPermissionMode, initialModel, initialThinkingEffort, createsPaneTask]);

  useEffect(() => {
    if (!feedPresentation) {
      setFeedShellHeight(null);
      return;
    }
    const shell = feedComposerRef.current?.closest('[data-feed-chat-shell="true"]') as HTMLElement | null;
    if (!shell) return;
    const syncShellHeight = () => {
      setFeedShellHeight((current) => current === shell.clientHeight ? current : shell.clientHeight);
    };
    syncShellHeight();
    const observer = new ResizeObserver(syncShellHeight);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [feedPresentation]);

  useEffect(() => {
    syncComposerTextareaHeight(inlineTextareaRef.current, {
      minHeight: minComposerHeight,
      maxHeight: maxComposerHeight,
      targetHeight: hasUserResized ? composerHeight : null,
    });
  }, [composer.message, composerHeight, hasUserResized, isComposerModalOpen, maxComposerHeight, minComposerHeight]);

  const showExpansionTrigger = useComposerExpansionTrigger(
    inlineTextareaRef,
    composer.message,
    3,
    isComposerModalOpen,
  );

  const setInlineTextarea = useCallback((node: HTMLTextAreaElement | null) => {
    inlineTextareaRef.current = node;
    if (!isComposerModalOpen) composer.textareaRef.current = node;
  }, [composer.textareaRef, isComposerModalOpen]);

  const setModalTextarea = useCallback((node: HTMLTextAreaElement | null) => {
    if (isComposerModalOpen) composer.textareaRef.current = node;
  }, [composer.textareaRef, isComposerModalOpen]);

  const closeComposerModal = useCallback(() => {
    setIsComposerModalOpen(false);
    requestAnimationFrame(() => inlineTextareaRef.current?.focus());
  }, []);

  const syncMirrorScroll = useCallback(() => {
    const textarea = composer.textareaRef.current;
    if (!textarea) return;
    setMirrorScroll((current) => {
      const next = { top: textarea.scrollTop, left: textarea.scrollLeft };
      return current.top === next.top && current.left === next.left ? current : next;
    });
  }, [composer.textareaRef]);

  useEffect(() => {
    requestAnimationFrame(() => syncMirrorScroll());
  }, [composer.message, syncMirrorScroll]);

  const latestTodos: Todo[] = useMemo(() => {
    for (let i = logEntries.length - 1; i >= 0; i--) {
      const entry = logEntries[i];
      if (entry.type === "tool_use" && entry.toolName === "TodoWrite" && entry.toolArgs) {
        try {
          const parsed = parseTodosFromInput(JSON.parse(entry.toolArgs));
          if (parsed) return parsed;
        } catch {
          // ignore
        }
      }
    }
    return [];
  }, [logEntries]);

  const handlePermissionModeChange = useCallback((nextMode: PermissionPickerMode) => {
    const nextState = getPermissionStateForPickerChange(
      nextMode,
      activePermissionMode,
      executionPermissionMode,
      "bypassPermissions",
    );
    setActivePermissionMode(nextState.permissionMode);
    setExecutionPermissionMode(nextState.executionPermissionMode);
    if (!createsPaneTask) {
      void updateTask(taskId, nextState);
    }
  }, [activePermissionMode, createsPaneTask, executionPermissionMode, taskId, updateTask]);

  const handleModelChange = useCallback((nextModel: ClaudeModel | null) => {
    const nextThinkingEffort = normalizeClaudeThinkingEffortForModel(nextModel, thinkingEffort) ?? "auto";
    setModel(nextModel);
    setThinkingEffort(nextThinkingEffort);
    saveClaudeLlmPreference({
      model: nextModel,
      reasoningEffort: nextThinkingEffort,
    });
    if (!createsPaneTask) {
      void updateTask(taskId, { model: nextModel, thinkingEffort: nextThinkingEffort });
    }
  }, [createsPaneTask, taskId, thinkingEffort, updateTask]);

  const handleThinkingEffortChange = useCallback((nextThinkingEffort: ClaudeThinkingEffort) => {
    const normalizedThinkingEffort =
      normalizeClaudeThinkingEffortForModel(model, nextThinkingEffort) ?? "auto";
    setThinkingEffort(normalizedThinkingEffort);
    saveClaudeLlmPreference({
      model: model ?? undefined,
      reasoningEffort: normalizedThinkingEffort,
    });
    if (!createsPaneTask) {
      void updateTask(taskId, { thinkingEffort: normalizedThinkingEffort });
    }
  }, [createsPaneTask, model, taskId, updateTask]);

  const handleSubmit = useCallback(async () => {
    if (readOnly || isStopAction) return;
    const submission = composer.buildSubmission();
    if (!submission.message && submission.attachments.length === 0) return;
    if (isSending) return;
    const finalMessage = composeMessageWithAttachments(submission.message, submission.attachments);

    if (!submitLockRef.current.tryAcquire()) return;
    setIsSending(true);

    // If this is an empty pane, create a new task instead of replying
    if (onCreatePaneTask) {
      try {
        await onCreatePaneTask(
          submission.message,
          activePermissionMode === "plan" ? "plan" : permissionMode,
          model,
          thinkingEffort,
          submission.attachments,
        );
        composer.clearComposer();
      } catch {
        setError("Failed to start conversation");
        setTimeout(() => setError(null), 3000);
      } finally {
        submitLockRef.current.release();
        setIsSending(false);
      }
      return;
    }

    // Optimistic: add user_reply entry locally
    if (onOptimisticReply) {
      const entry: LogEntry = {
        id: "local-" + crypto.randomUUID(),
        type: "user_reply",
        timestamp: new Date().toISOString(),
        content: finalMessage,
        permissionMode: activePermissionMode === "plan" ? "plan" : permissionMode,
      };
      onOptimisticReply(entry);
    }

    // Optimistic: mark task as running (clears needsInput so card lights up purple)
    useTaskStore.getState().setTaskFields(taskId, {
      status: "running",
      needsInput: false,
      activityLabel: null,
      lastReplyAt: new Date().toISOString(),
    });

    composer.clearComposer();

    try {
      const res = await fetch(`/api/tasks/${taskId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: submission.message,
          attachments: submission.attachments,
          permissionMode: activePermissionMode === "plan" ? "plan" : permissionMode,
          executionPermissionMode,
          model,
          thinkingEffort,
        }),
      });
      if (!res.ok) {
        console.error(`[reply-input] Reply failed: ${res.status}`);
        setError(await readApiError(res, "Reply failed -- try again"));
        setTimeout(() => setError(null), 3000);
      }
    } catch {
      setError("Reply failed — try again");
      setTimeout(() => setError(null), 3000);
    } finally {
      submitLockRef.current.release();
      setIsSending(false);
    }
  }, [
    composer,
    isSending,
    taskId,
    onOptimisticReply,
    onCreatePaneTask,
    activePermissionMode,
    permissionMode,
    executionPermissionMode,
    model,
    thinkingEffort,
    isStopAction,
    readOnly,
  ]);

  const handleStop = useCallback(async () => {
    if (readOnly || isCancelling || taskId === "empty") return;
    setIsCancelling(true);
    const stopped = await cancelTask(taskId);
    if (!stopped) {
      setError(useTaskStore.getState().error || "Stop failed — try again");
    }
    setIsCancelling(false);
  }, [cancelTask, isCancelling, readOnly, taskId]);

  const handleSlashSelect = useCallback((cmd: SlashCommand) => {
    setShowSlashMenu(false);
    setSlashQuery("");

    const textarea = composer.textareaRef.current;
    const cursor = textarea?.selectionStart ?? composer.message.length;
    const insertion = replaceActiveSlashCommand(
      composer.message,
      cursor,
      cmd.command,
    );
    if (!insertion) return;

    composer.setMessage(insertion.value);
    requestAnimationFrame(() => {
      const activeTextarea = composer.textareaRef.current;
      activeTextarea?.focus();
      activeTextarea?.setSelectionRange(
        insertion.selectionStart,
        insertion.selectionEnd,
      );
      syncMirrorScroll();
    });
  }, [composer, syncMirrorScroll]);

  const handleChange = useCallback((value: string, cursor: number) => {
    composer.setMessage(value);
    const slashToken = getActiveSlashCommandToken(value, cursor);
    if (slashToken) {
      setShowSlashMenu(true);
      setSlashQuery(slashToken.query);
      setShowTagMenu(false);
      setTagQuery("");
      return;
    }

    setShowSlashMenu(false);
    setSlashQuery("");

    // Detect @tag trigger
    const before = value.slice(0, cursor);
    const match = before.match(/(^|[\s])@([\w\/-]*)$/);
    if (match) {
      setShowTagMenu(true);
      setTagQuery(match[2]);
    } else {
      setShowTagMenu(false);
      setTagQuery("");
    }
  }, [composer]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((showSlashMenu || showTagMenu) && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!isStopAction) {
          handleSubmit();
        }
      }
    },
    [handleSubmit, isStopAction, showSlashMenu, showTagMenu]
  );

  const canSubmit =
    !readOnly && (
      composer.message.trim().length > 0 ||
      composer.attachments.length > 0 ||
      composer.pastedBlocks.length > 0
    );

  const handleModalKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((showSlashMenu || showTagMenu) && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) return;
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (!canSubmit || isSending || isStopAction) return;
        closeComposerModal();
        void handleSubmit();
      }
    },
    [canSubmit, closeComposerModal, handleSubmit, isSending, isStopAction, showSlashMenu, showTagMenu],
  );

  if (!isVisible) return null;

  if (readOnly) {
    return (
      <div
        aria-label="Archived Goal is read only"
        style={{
          padding: compact ? "10px 12px" : "12px 24px 16px",
          borderTop: "1px solid var(--cc-line-alpha-20)",
          color: "var(--cc-status-warning-strong)",
          background: "var(--cc-surface-warning-soft)",
          fontFamily: "var(--cc-font-label)",
          fontSize: 12,
        }}
      >
        Restore this Goal to continue the chat.
      </div>
    );
  }

  const placeholder =
    taskStatus === "running" && !needsInput
      ? "Claude is still working. You can add context if needed..."
      : needsInput
        ? "Reply to Claude...  Type / for commands or skills, @ for tags"
        : taskStatus === "review" || taskStatus === "done"
          ? "Send a follow-up or type / for commands or skills..."
          : "Send a message...  Type / for commands or skills, @ for tags";
  const contextRingTaskId = taskId === "empty" ? null : taskId;

  const renderAssets = () => hasAssets ? (
    <ComposerAssetTray compact={compact}>
      <ComposerDraftAssetCollection
        pastedBlocks={composer.pastedBlocks}
        attachmentItems={[
          ...composer.attachments.map((attachment) => ({
            id: attachment.id,
            fileName: attachment.fileName,
            extension: attachment.extension,
            sizeBytes: attachment.sizeBytes,
            contentType: attachment.contentType ?? null,
            previewPath: attachment.relativePath,
            previewSurface: attachment.surface,
            previewScopeId: attachment.scopeId,
            status: "ready" as const,
          })),
          ...composer.uploads.map((upload) => ({
            id: upload.id,
            fileName: upload.fileName,
            extension: getChatAttachmentExtension(upload.fileName),
            status: upload.status,
            error: upload.error,
          })),
        ]}
        compact={compact}
        padding="0"
        onInsertPastedBlock={composer.insertPastedTextBlock}
        onRemovePastedBlock={composer.removePastedTextBlock}
        onRemoveAttachmentItem={(itemId) => {
          const attachment = composer.attachments.find((candidate) => candidate.id === itemId);
          if (attachment) {
            void composer.removeAttachment(attachment);
            return;
          }
          composer.removeUpload(itemId);
        }}
        onRetryAttachmentItem={(itemId) => { void composer.retryUpload(itemId); }}
      />
    </ComposerAssetTray>
  ) : null;

  const renderEditorMenus = (modal: boolean) => {
    const menus = (
      <>
        {showSlashMenu && (
          <SlashCommandMenu
            query={slashQuery}
            onSelect={handleSlashSelect}
            onClose={() => { setShowSlashMenu(false); setSlashQuery(""); }}
            anchor="above"
          />
        )}
        {showTagMenu && promptTags.length > 0 && (
          <SlashCommandMenu
            query={tagQuery}
            onSelect={() => {}}
            onClose={() => { setShowTagMenu(false); setTagQuery(""); }}
            anchor="above"
            mode="tag"
            tagItems={promptTags
              .filter((tag) => !tagQuery || tag.name.toLowerCase().includes(tagQuery.toLowerCase()))
              .sort((a, b) => {
                if (projectSlug) {
                  const aIsBrief = a.name === `brief/${projectSlug}`;
                  const bIsBrief = b.name === `brief/${projectSlug}`;
                  if (aIsBrief && !bIsBrief) return -1;
                  if (!aIsBrief && bIsBrief) return 1;
                }
                return 0;
              })}
            onTagSelect={(tag) => {
              const el = composer.textareaRef.current;
              if (el) {
                const cursor = el.selectionStart ?? composer.message.length;
                const before = composer.message.slice(0, cursor);
                const after = composer.message.slice(cursor);
                const replaced = before.replace(/(^|[\s])@[\w\/-]*$/, `$1@${tag.name} `);
                composer.setMessage(replaced + after);
              } else {
                composer.setMessage((previous) => previous + `@${tag.name} `);
              }
              recordTagUsage(tag.name);
              setShowTagMenu(false);
              setTagQuery("");
              composer.textareaRef.current?.focus();
            }}
          />
        )}
      </>
    );

    return modal ? (
      <div style={{ position: "absolute", left: 14, right: 14, bottom: 8, height: 0, zIndex: 40 }}>
        {menus}
      </div>
    ) : menus;
  };

  const renderEditor = (modal: boolean) => {
    const textPadding = modal
      ? "12px 56px 12px 12px"
      : dense
        ? `2px ${showExpansionTrigger ? 34 : 0}px 2px 0`
        : `4px ${showExpansionTrigger ? 34 : 0}px 4px 0`;
    const highlighted = composer.message.includes("@") || composer.message.includes("/");

    return (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: modal ? "100%" : undefined,
          minWidth: 0,
          padding: modal ? 0 : dense ? "6px 10px 4px" : "12px 14px 8px",
          boxSizing: "border-box",
        }}
      >
        {renderEditorMenus(modal)}
        <div style={{ position: "relative", width: "100%", height: modal ? "100%" : undefined, minWidth: 0, overflow: "hidden" }}>
          {highlighted && (
            <HighlightMirror
              text={composer.message}
              scrollTop={mirrorScroll.top}
              scrollLeft={mirrorScroll.left}
              style={{
                fontSize: dense ? 13 : 14,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                padding: textPadding,
                boxSizing: "border-box",
                lineHeight: 1.5,
              }}
            />
          )}
          <textarea
            data-feed-chat-composer-input={!modal && feedPresentation ? "true" : undefined}
            ref={modal ? setModalTextarea : setInlineTextarea}
            value={composer.message}
            onChange={(event) =>
              handleChange(event.target.value, event.target.selectionStart)
            }
            onSelect={(event) =>
              handleChange(event.currentTarget.value, event.currentTarget.selectionStart)
            }
            onKeyDown={modal ? handleModalKeyDown : handleKeyDown}
            onPaste={composer.handlePaste}
            onScroll={syncMirrorScroll}
            placeholder={placeholder}
            disabled={readOnly}
            autoFocus={modal}
            rows={modal ? undefined : dense ? 1 : 3}
            style={{
              width: "100%",
              height: modal ? "100%" : undefined,
              fontSize: dense ? 13 : 14,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              padding: textPadding,
              boxSizing: "border-box",
              minHeight: modal ? 0 : minComposerHeight,
              maxHeight: modal ? "none" : hasUserResized ? composerHeight : maxComposerHeight,
              maxWidth: "100%",
              backgroundColor: "transparent",
              outline: "none",
              border: "none",
              resize: "none",
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
              color: highlighted ? "transparent" : "var(--cc-text-primary)",
              caretColor: "var(--cc-text-primary)",
              position: "relative",
              zIndex: 1,
              overflowX: "hidden",
              overflowY: "auto",
            }}
          />
        </div>
        {!modal && showExpansionTrigger && (
          <EditorExpandButton expanded={false} onClick={() => setIsComposerModalOpen(true)} />
        )}
      </div>
    );
  };

  const renderToolbar = (modal: boolean) => (
    <div
      data-feed-chat-composer-toolbar={!modal && feedPresentation ? "true" : undefined}
      style={{
        display: "flex",
        flexWrap: modal ? "wrap" : "nowrap",
        alignItems: "center",
        gap: 2,
        padding: dense ? "4px 6px" : "6px 8px",
        borderTop: "1px solid var(--cc-control-bg-active)",
      }}
    >
      <button
        type="button"
        onClick={composer.openFilePicker}
        disabled={readOnly || composer.isUploading}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "4px 6px",
          border: "none",
          borderRadius: 5,
          backgroundColor: "transparent",
          color: readOnly || composer.isUploading ? "var(--cc-text-disabled)" : "var(--cc-text-secondary)",
          cursor: readOnly || composer.isUploading ? "not-allowed" : "pointer",
        }}
        onMouseEnter={(event) => { if (!composer.isUploading) event.currentTarget.style.backgroundColor = "var(--cc-neutral-alpha-04)"; }}
        onMouseLeave={(event) => { event.currentTarget.style.backgroundColor = "transparent"; }}
        title="Attach file"
      >
        <Paperclip size={14} />
      </button>
      {!modal && composer.hasDraft && (
        <button
          type="button"
          onClick={() => { void composer.discardDraft(); }}
          style={{
            border: "none",
            backgroundColor: "transparent",
            color: "var(--cc-text-tertiary)",
            fontSize: 11,
            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
            cursor: "pointer",
            padding: "4px 6px",
          }}
        >
          Discard draft
        </button>
      )}
      <ContextUsageRing taskId={contextRingTaskId} />
      <ModelPicker
        value={model}
        onChange={handleModelChange}
        autoModeActive={activePermissionMode === "auto" || executionPermissionMode === "auto"}
      />
      <ThinkingEffortPicker value={thinkingEffort} model={model} onChange={handleThinkingEffortChange} />
      <PermissionPicker value={permissionMode} model={model} onChange={handlePermissionModeChange} />
      {!hideTasksPopover && (
        <TasksPopover
          todos={latestTodos}
          subtasks={subtasks}
          onSelectSubtask={onSelectSubtask}
          onRunSubtask={onRunSubtask}
          onRunSubtaskInNewChat={onRunSubtaskInNewChat}
          onRunAll={onRunAll}
          onMarkDone={onMarkDone}
          availablePanes={availablePanes}
          onRunSubtaskInPane={onRunSubtaskInPane}
          compact={dense}
        />
      )}
      <div style={{ flex: 1 }} />
      {!modal && (isStopAction ? (
        <button
          type="button"
          onClick={handleStop}
          disabled={readOnly || isCancelling}
          title="Stop current run"
          aria-label="Stop current run"
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            border: "none",
            background: isCancelling ? "var(--cc-control-bg-hover)" : "var(--cc-status-danger-bright)",
            color: "var(--cc-surface)",
            cursor: isCancelling ? "default" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 150ms ease, opacity 150ms ease",
            opacity: isCancelling ? 0.7 : 1,
          }}
        >
          <Square size={11} fill="currentColor" strokeWidth={0} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => { void handleSubmit(); }}
          disabled={readOnly || !canSubmit || isSending}
          aria-label="Send message"
          title="Send message"
          style={{
            width: 28,
            height: 26,
            borderRadius: 6,
            border: "none",
            background: canSubmit && !isSending
              ? "linear-gradient(135deg, var(--cc-brand-primary), var(--cc-brand-hover))"
              : "var(--cc-control-bg-hover)",
            color: canSubmit && !isSending ? "var(--cc-surface)" : "var(--cc-text-secondary)",
            cursor: canSubmit && !isSending ? "pointer" : "default",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 150ms ease",
          }}
        >
          <ArrowUp size={14} />
        </button>
      ))}
    </div>
  );

  return (
    <div
      ref={feedComposerRef}
      data-feed-chat-composer={feedPresentation ? "true" : undefined}
      onDragEnter={composer.handleDragEnter}
      onDragOver={composer.handleDragOver}
      onDragLeave={composer.handleDragLeave}
      onDrop={composer.handleDrop}
      aria-disabled={readOnly}
      style={{
        padding: feedPresentation ? "6px 24px 8px" : compact ? "6px 12px 8px 12px" : "12px 24px 16px 24px",
        borderTop: feedPresentation ? "none" : "1px solid var(--cc-control-bg)",
        flexShrink: 0,
        minHeight: 0,
        maxHeight: feedPresentation ? "40%" : undefined,
        overflowY: feedPresentation ? "auto" : undefined,
        overscrollBehavior: feedPresentation ? "contain" : undefined,
      }}
    >
      {error && !isComposerModalOpen && (
        <div style={{ fontSize: 12, color: "var(--cc-status-danger)", marginBottom: 6, fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif" }}>
          {error}
        </div>
      )}
      {!isComposerModalOpen && <div
        data-feed-chat-composer-rail={feedPresentation ? "true" : undefined}
        style={{
          width: "100%",
          maxWidth: feedPresentation ? 720 : undefined,
          margin: feedPresentation ? "0 auto" : undefined,
          background: "var(--cc-surface-soft)",
          border: composer.isDragging ? "1px solid var(--cc-brand-alpha-45)" : "1px solid var(--cc-control-bg-active)",
          borderRadius: 10,
          overflow: "visible",
          position: "relative",
          boxShadow: composer.isDragging ? "0 0 0 3px var(--cc-brand-alpha-08)" : "none",
        }}
      >
        {!feedPresentation && <div style={{ display: "flex", justifyContent: "center", padding: dense ? "6px 10px 0" : "8px 14px 0" }}>
          <button
            type="button"
            aria-label="Drag to resize input"
            onPointerDown={handleResizePointerDown}
            style={{
              width: dense ? 36 : 44,
              height: dense ? 6 : 8,
              border: "none",
              borderRadius: 999,
              backgroundColor: "var(--cc-line-alpha-30)",
              cursor: "ns-resize",
            }}
          />
        </div>}
        {renderAssets()}
        {renderEditor(false)}
        {renderToolbar(false)}
      </div>}
      <input
        ref={composer.fileInputRef}
        type="file"
        multiple
        onChange={composer.handleFileInputChange}
        style={{ display: "none" }}
        accept={composer.accept}
      />
      {isComposerModalOpen && (
        <ComposerEditorModal
          title="Compose message"
          initialExpanded
          submitting={isSending}
          submitDisabled={!canSubmit || isStopAction}
          onClose={closeComposerModal}
          onSubmit={() => {
            if (!canSubmit || isStopAction) return;
            closeComposerModal();
            void handleSubmit();
          }}
          leading={renderAssets()}
          editor={renderEditor(true)}
          toolbar={renderToolbar(true)}
          error={error}
          escapeDisabled={showSlashMenu || showTagMenu}
        />
      )}
    </div>
  );
}

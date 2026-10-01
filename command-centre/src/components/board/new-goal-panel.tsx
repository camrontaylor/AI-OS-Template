"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { X, ArrowUp, ChevronDown, MessageSquare, Paperclip } from "lucide-react";
import type { TaskLevel, PermissionMode, ClaudeModel, ClaudeThinkingEffort } from "@/types/task";
import type { ChatPastedBlock } from "@/types/chat-composer";
import type { GoalDraftAttachment, GoalDraftPayload } from "@/types/goal-draft";
import { useTaskStore } from "@/store/task-store";
import { useClientStore } from "@/store/client-store";
import { SlashCommandMenu } from "@/components/shared/slash-command-menu";
import type { TagItem } from "@/components/shared/slash-command-menu";
import {
  getActiveSlashCommandToken,
  replaceActiveSlashCommand,
  type SlashCommand,
} from "@/lib/slash-commands";
import { HighlightMirror } from "@/components/modal/reply-input";
import { ModelPicker } from "@/components/shared/model-picker";
import { ThinkingEffortPicker } from "@/components/shared/thinking-effort-picker";
import { PermissionPicker } from "@/components/shared/permission-picker";
import { DeleteConfirmButton } from "@/components/shared/delete-confirm-button";
import { TagPicker } from "@/components/shared/tag-picker";
import { ComposerAssetTray } from "@/components/shared/composer-asset-tray";
import { ComposerDraftAssetCollection } from "@/components/shared/composer-draft-asset-collection";
import { ComposerEditorModal, EditorExpandButton } from "@/components/shared/composer-editor-modal";
import { useComposerExpansionTrigger } from "@/hooks/use-composer-expansion-trigger";
import { recordTagUsage } from "./goal-chips";
import { LEVEL_LABELS, LEVEL_HINTS } from "@/lib/levels";
import {
  CHAT_ATTACHMENT_ACCEPT_ATTR,
  getChatAttachmentExtension,
  getChatAttachmentValidationError,
} from "@/lib/chat-attachment-policy";
import { expandComposerPastedBlocks } from "@/lib/chat-message-content";
import { buildGoalDraftSnapshot, hasGoalDraftContent } from "@/lib/goal-drafts";
import { normalizeClaudeThinkingEffortForModel } from "@/lib/claude-options";
import {
  DEFAULT_CLAUDE_LLM_PREFERENCE,
  loadClaudeLlmPreference,
  saveClaudeLlmPreference,
} from "@/lib/llm-preferences";
import {
  insertPastedTextAtSelection,
  removePendingPastedText,
  shouldCapturePastedText,
} from "@/lib/pasted-text";
import { resolvePlannedProjectNameForClient } from "@/lib/planned-project-naming.client";
import { slugifyProjectName } from "@/lib/planned-project-naming";

const MONO = "'DM Mono', monospace";

// ── Static fallback suggestions ─────────────────────────────────
const STATIC_SUGGESTIONS = [
  {
    title: "Manage skills",
    desc: "Install, edit, or import a skill into the system",
    prompt: "I want to work with skills. Show me what's currently installed with `bash scripts/list-skills.sh`, then ask me whether I want to: (1) install a new skill from the catalog, (2) edit or improve an existing skill, or (3) import/create a brand new skill from scratch. Use /meta-skill-creator for editing or creating skills.",
  },
  {
    title: "Create a scheduled task",
    desc: "Automate something on a recurring schedule",
    prompt: "/ops-cron Create a new scheduled cron job. Ask me what I want to automate and how often it should run.",
  },
  {
    title: "Use a skill...",
    desc: "See what's installed and run one",
    prompt: "List all my installed skills with `bash scripts/list-skills.sh` and briefly describe what each one does, so I can pick one to use.",
  },
  {
    title: "Connect to your apps (MCP)...",
    desc: "Link an external service like Notion, Slack, etc.",
    prompt: "I want to connect an external app via MCP. Show me what MCP servers are currently configured in .claude/settings.json, and help me add a new one. Ask which app or service I want to connect.",
  },
  {
    title: "Add a client",
    desc: "Set up a new client workspace",
    prompt: "I want to add a new client. Ask me for the client name, then run `bash scripts/add-client.sh` with it.",
  },
  {
    title: "Perform some research",
    desc: "Find what's trending in your industry",
    prompt: "/str-trending-research Research what's trending in my industry. Ask me what topic or niche to focus on.",
  },
];

const FLAG_OPTIONS: { flag: string; label: string; hint: string; level: TaskLevel }[] = [
  { flag: "--project", label: "--project", hint: "Planned project — multi-deliverable", level: "project" },
  { flag: "--gsd", label: "--gsd", hint: "GSD project — complex multi-phase", level: "gsd" },
];

interface NewGoalPanelProps {
  drawerWidth?: number | null;
  draft?: GoalDraftPayload | null;
  onClose: () => void;
  onCreated: (taskId: string, draftId?: string | null) => void;
  onDraftSaved: (draft: GoalDraftPayload) => void;
  onDiscarded: (draftId: string | null) => void | Promise<void>;
  onStartDrawerDrag?: (e: React.MouseEvent) => void;
  inline?: boolean;
}

export function NewGoalPanel({
  drawerWidth,
  draft,
  onClose,
  onCreated,
  onDraftSaved,
  onDiscarded,
  onStartDrawerDrag,
  inline = false,
}: NewGoalPanelProps) {
  const storeSelectedClientId = useClientStore((s) => s.selectedClientId);
  const [draftId, setDraftId] = useState<string | null>(draft?.id ?? null);
  const [createdAt, setCreatedAt] = useState<string | null>(draft?.createdAt ?? null);
  const [title, setTitle] = useState(draft?.title ?? "");
  const [message, setMessage] = useState(draft?.message ?? "");
  const [level, setLevel] = useState<TaskLevel>(draft?.level ?? "task");
  const [showLevelMenu, setShowLevelMenu] = useState(false);
  const [model, setModel] = useState<ClaudeModel | null>(
    draft?.model ?? DEFAULT_CLAUDE_LLM_PREFERENCE.model,
  );
  const [thinkingEffort, setThinkingEffort] = useState<ClaudeThinkingEffort | null>(
    draft?.thinkingEffort ?? DEFAULT_CLAUDE_LLM_PREFERENCE.reasoningEffort,
  );
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(draft?.permissionMode ?? "bypassPermissions");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const [showFlagMenu, setShowFlagMenu] = useState(false);
  const [flagQuery, setFlagQuery] = useState("");
  const [flagMenuIndex, setFlagMenuIndex] = useState(0);
  const [promptTags, setPromptTags] = useState<TagItem[]>([]);
  const [attachments, setAttachments] = useState<GoalDraftAttachment[]>(draft?.attachments ?? []);
  const [pastedBlocks, setPastedBlocks] = useState<ChatPastedBlock[]>(draft?.pastedBlocks ?? []);
  const [isUploading, setIsUploading] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(draft?.clientId ?? storeSelectedClientId);
  const [showClientMenu, setShowClientMenu] = useState(false);
  const [descriptionMirrorScroll, setDescriptionMirrorScroll] = useState({ top: 0, left: 0 });
  const [selectedTag, setSelectedTag] = useState<string | null>(draft?.tag ?? null);
  const [isComposerModalOpen, setIsComposerModalOpen] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const inlineDescRef = useRef<HTMLTextAreaElement>(null);
  const dragDepthRef = useRef(0);
  const levelMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clientMenuRef = useRef<HTMLDivElement>(null);
  const clientSelectionTouchedRef = useRef(Boolean(draft));
  const submittingRef = useRef(false);
  const lastPersistedSnapshotRef = useRef<string | null>(
    draft ? buildGoalDraftSnapshot(draft) : null,
  );

  const createTask = useTaskStore((s) => s.createTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const clients = useClientStore((s) => s.clients);
  const rootName = useClientStore((s) => s.rootName);
  const hasMaterializedDraft = draftId !== null;

  const handleModelChange = useCallback((nextModel: ClaudeModel | null) => {
    const nextThinkingEffort =
      normalizeClaudeThinkingEffortForModel(nextModel, thinkingEffort ?? "auto") ?? "auto";
    setModel(nextModel);
    setThinkingEffort(nextThinkingEffort);
    saveClaudeLlmPreference({
      model: nextModel,
      reasoningEffort: nextThinkingEffort,
    });
  }, [thinkingEffort]);

  const handleThinkingEffortChange = useCallback((nextThinkingEffort: ClaudeThinkingEffort) => {
    const normalizedThinkingEffort =
      normalizeClaudeThinkingEffortForModel(model, nextThinkingEffort) ?? "auto";
    setThinkingEffort(normalizedThinkingEffort);
    saveClaudeLlmPreference({
      model: model ?? undefined,
      reasoningEffort: normalizedThinkingEffort,
    });
  }, [model]);

  useEffect(() => {
    if (draft) return;
    const preference = loadClaudeLlmPreference();
    setModel(preference.model);
    setThinkingEffort(preference.reasoningEffort);
  }, [draft]);

  // Fetch prompt tags
  useEffect(() => {
    fetch("/api/prompt-tags")
      .then((r) => r.json())
      .then((data) =>
        setPromptTags(
          (data.tags ?? []).map((t: { name: string; body: string; category?: string; description?: string }) => ({
            name: t.name, body: t.body, category: t.category, description: t.description,
          }))
        )
      )
      .catch(() => {});
  }, []);

  // Auto-focus title input
  useEffect(() => { titleRef.current?.focus(); }, []);

  useEffect(() => {
    if (draftId !== null) return;
    if (clientSelectionTouchedRef.current) return;
    setSelectedClientId(storeSelectedClientId);
  }, [draftId, storeSelectedClientId]);

  // Close level menu on outside click
  useEffect(() => {
    if (!showLevelMenu) return;
    const handler = (e: MouseEvent) => {
      if (levelMenuRef.current && !levelMenuRef.current.contains(e.target as Node)) {
        setShowLevelMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showLevelMenu]);

  // Close client menu on outside click
  useEffect(() => {
    if (!showClientMenu) return;
    const handler = (e: MouseEvent) => {
      if (clientMenuRef.current && !clientMenuRef.current.contains(e.target as Node)) {
        setShowClientMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showClientMenu]);

  // Auto-grow textarea
  const autoGrow = useCallback(() => {
    const el = inlineDescRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(120, el.scrollHeight)}px`;
  }, []);

  useEffect(() => { autoGrow(); }, [message, autoGrow, isComposerModalOpen]);

  const showExpansionTrigger = useComposerExpansionTrigger(
    inlineDescRef,
    message,
    3,
    isComposerModalOpen,
  );

  const setInlineDescription = useCallback((node: HTMLTextAreaElement | null) => {
    inlineDescRef.current = node;
    if (!isComposerModalOpen) descRef.current = node;
  }, [isComposerModalOpen]);

  const setModalDescription = useCallback((node: HTMLTextAreaElement | null) => {
    if (isComposerModalOpen) descRef.current = node;
  }, [isComposerModalOpen]);

  const closeComposerModal = useCallback(() => {
    setIsComposerModalOpen(false);
    requestAnimationFrame(() => inlineDescRef.current?.focus());
  }, []);

  const syncDescriptionMirrorScroll = useCallback(() => {
    const textarea = descRef.current;
    if (!textarea) return;
    setDescriptionMirrorScroll((current) => {
      const next = { top: textarea.scrollTop, left: textarea.scrollLeft };
      return current.top === next.top && current.left === next.left ? current : next;
    });
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => syncDescriptionMirrorScroll());
  }, [message, syncDescriptionMirrorScroll]);
  const ensureDraftMaterialized = useCallback(() => {
    const nextDraftId = draftId ?? crypto.randomUUID();
    const nextCreatedAt = createdAt ?? new Date().toISOString();
    if (!draftId) {
      setDraftId(nextDraftId);
    }
    if (!createdAt) {
      setCreatedAt(nextCreatedAt);
    }
    return { draftId: nextDraftId, createdAt: nextCreatedAt };
  }, [createdAt, draftId]);

  const buildDraftPayload = useCallback((nextDraftId: string, nextCreatedAt: string): GoalDraftPayload => {
    return {
      version: 2,
      id: nextDraftId,
      clientId: selectedClientId,
      title,
      message,
      attachments,
      level,
      permissionMode,
      model,
      thinkingEffort,
      tag: selectedTag,
      pastedBlocks,
      createdAt: nextCreatedAt,
      updatedAt: new Date().toISOString(),
    };
  }, [
    attachments,
    level,
    message,
    model,
    pastedBlocks,
    permissionMode,
    selectedClientId,
    selectedTag,
    thinkingEffort,
    title,
  ]);

  useEffect(() => {
    const hasMeaningfulContent = hasGoalDraftContent({
      title,
      message,
      attachments,
      pastedBlocks,
    });

    if (!hasMaterializedDraft && !hasMeaningfulContent) {
      return;
    }

    const { draftId: nextDraftId, createdAt: nextCreatedAt } = ensureDraftMaterialized();
    const nextDraft = buildDraftPayload(nextDraftId, nextCreatedAt);
    const nextSnapshot = buildGoalDraftSnapshot(nextDraft);
    if (lastPersistedSnapshotRef.current === nextSnapshot) {
      return;
    }

    lastPersistedSnapshotRef.current = nextSnapshot;
    onDraftSaved(nextDraft);
  }, [
    attachments,
    buildDraftPayload,
    ensureDraftMaterialized,
    hasMaterializedDraft,
    level,
    message,
    model,
    onDraftSaved,
    pastedBlocks,
    permissionMode,
    selectedClientId,
    selectedTag,
    storeSelectedClientId,
    thinkingEffort,
    title,
  ]);

  const createWithLevel = useCallback(
    async (
      goalTitle: string,
      fullDescription: string,
      taskLevel: TaskLevel,
      projectSlugOverride?: string | null,
    ) => {
      let taskProjectSlug: string | null = null;
      // Create a brief for project/gsd tasks, or for any task in plan mode
      const needsBrief = taskLevel === "project" || taskLevel === "gsd" || permissionMode === "plan";
      if (needsBrief) {
        taskProjectSlug = projectSlugOverride || slugifyProjectName(goalTitle);
        try {
          await fetch("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              slug: taskProjectSlug,
              name: goalTitle,
              level: taskLevel === "gsd" ? 3 : taskLevel === "project" ? 2 : 1,
              goal: fullDescription.slice(0, 200),
            }),
          });
        } catch { /* non-critical */ }
      }

      return createTask(goalTitle, fullDescription, taskLevel, taskProjectSlug, undefined, permissionMode, undefined, selectedClientId, model, thinkingEffort);
    },
    [createTask, model, permissionMode, selectedClientId, thinkingEffort]
  );

  const handleSubmit = useCallback(async () => {
    const trimmed = message.trim();
    const trimmedTitle = title.trim();
    if ((!trimmed && !trimmedTitle && attachments.length === 0 && pastedBlocks.length === 0) || submittingRef.current) return;

    submittingRef.current = true;

    // Detect and strip --project / --gsd flags
    const flagMatch = trimmed.match(/\s*--(project|gsd)\s*/i);
    let detectedLevel: TaskLevel = level;
    if (flagMatch) {
      detectedLevel = flagMatch[1].toLowerCase() as TaskLevel;
    }
    const cleanMessage = trimmed.replace(/\s*--(project|gsd)\s*/gi, " ").trim();

    const expandedMessage = expandComposerPastedBlocks(cleanMessage, pastedBlocks);
    // Build description with attachment paths
    let fullDescription = expandedMessage || trimmedTitle;
    if (attachments.length > 0) {
      const attachmentLines = attachments.map((a) => `- ${a.relativePath}`).join("\n");
      fullDescription = fullDescription
        ? `${fullDescription}\n\nAttached files:\n${attachmentLines}`
        : `Attached files:\n${attachmentLines}`;
    }

    setIsSubmitting(true);
    try {
      let projectSlugOverride: string | null = null;
      let goalTitle: string;

      if (detectedLevel === "project" || detectedLevel === "gsd") {
        const resolved = await resolvePlannedProjectNameForClient(
          trimmedTitle,
          fullDescription || cleanMessage || trimmedTitle,
        );
        goalTitle = resolved.name;
        projectSlugOverride = resolved.slug;
      } else if (trimmedTitle) {
        goalTitle = trimmedTitle.length <= 60
          ? trimmedTitle
          : trimmedTitle.slice(0, 57).replace(/\s+\S*$/, "") + "...";
      } else {
        const lines = cleanMessage.split("\n");
        const firstLine = lines[0];
        goalTitle = firstLine.length <= 60
          ? firstLine
          : firstLine.slice(0, 57).replace(/\s+\S*$/, "") + "...";
      }

      const taskId = await createWithLevel(goalTitle, fullDescription || goalTitle, detectedLevel, projectSlugOverride);
      if (taskId && selectedTag) {
        await updateTask(taskId, { tag: selectedTag });
      }
      if (taskId) onCreated(taskId, draftId);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [attachments, createWithLevel, draftId, level, message, onCreated, pastedBlocks, selectedTag, title, updateTask]);

  const handleMessageChange = useCallback((value: string, cursor: number) => {
    setMessage(value);

    // Real-time level detection from completed inline flags
    const completedFlag = value.match(/--(project|gsd)\b/i);
    if (completedFlag) {
      setLevel(completedFlag[1].toLowerCase() as TaskLevel);
    }

    const before = value.slice(0, cursor);

    const slashToken = getActiveSlashCommandToken(value, cursor);
    if (slashToken) {
      setShowSlashMenu(true);
      setSlashQuery(slashToken.query);
      setShowTagMenu(false);
      setTagQuery("");
      setShowFlagMenu(false);
      return;
    }
    setShowSlashMenu(false);
    setSlashQuery("");

    // Check for @tag at cursor position
    const tagMatch = before.match(/(^|[\s])@([\w\/-]*)$/);
    if (tagMatch) {
      setShowTagMenu(true);
      setTagQuery(tagMatch[2]);
      setShowFlagMenu(false);
      return;
    }
    setShowTagMenu(false);
    setTagQuery("");

    // Check for --flag at cursor position (incomplete, for autocomplete)
    const dashMatch = before.match(/(^|[\s])--([\w]*)$/);
    if (dashMatch) {
      setShowFlagMenu(true);
      setFlagQuery(dashMatch[2].toLowerCase());
      setFlagMenuIndex(0);
    } else {
      setShowFlagMenu(false);
      setFlagQuery("");
    }
  }, []);

  const handleSlashSelect = useCallback(
    (cmd: SlashCommand) => {
      setShowSlashMenu(false);
      setSlashQuery("");

      const el = descRef.current;
      const cursor = el?.selectionStart ?? message.length;
      const insertion = replaceActiveSlashCommand(
        message,
        cursor,
        cmd.command,
      );
      if (!insertion) return;

      setMessage(insertion.value);

      // Re-focus and place cursor right after the inserted command
      requestAnimationFrame(() => {
        if (descRef.current) {
          descRef.current.focus();
          descRef.current.setSelectionRange(
            insertion.selectionStart,
            insertion.selectionEnd,
          );
        }
      });
    },
    [message]
  );

  const filteredFlags = FLAG_OPTIONS.filter((f) =>
    !flagQuery || f.flag.slice(2).startsWith(flagQuery)
  );

  const handleFlagSelect = useCallback(
    (option: typeof FLAG_OPTIONS[number]) => {
      setShowFlagMenu(false);
      setFlagQuery("");
      setLevel(option.level);

      const el = descRef.current;
      const cursor = el?.selectionStart ?? message.length;
      const before = message.slice(0, cursor);
      const after = message.slice(cursor);

      // Replace the partial --query with the full flag + trailing space
      const replaced = before.replace(/(^|[\s])--[\w]*$/, `$1${option.flag} `);
      const newMsg = replaced + after;
      setMessage(newMsg);

      requestAnimationFrame(() => {
        if (descRef.current) {
          descRef.current.focus();
          const pos = replaced.length;
          descRef.current.setSelectionRange(pos, pos);
        }
      });
    },
    [message]
  );

  const uploadFiles = useCallback(async (files: File[] | FileList | null) => {
    const normalizedFiles = Array.from(files ?? []);
    if (normalizedFiles.length === 0) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const uploaded: GoalDraftAttachment[] = [];
      const { draftId: nextDraftId } = ensureDraftMaterialized();

      for (const file of normalizedFiles) {
        const validationError = getChatAttachmentValidationError(file);
        if (validationError) {
          setUploadError(validationError);
          continue;
        }

        const formData = new FormData();
        formData.append("draftId", nextDraftId);
        if (selectedClientId) {
          formData.append("clientId", selectedClientId);
        }
        formData.append("files", file);

        const res = await fetch("/api/goal-drafts/attachments", { method: "POST", body: formData });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setUploadError(typeof data.error === "string" ? data.error : "Upload failed");
          continue;
        }

        const result = await res.json();
        uploaded.push(...(Array.isArray(result.attachments) ? result.attachments : []));
      }

      if (uploaded.length > 0) {
        setAttachments((prev) => {
          const seen = new Set(prev.map((item) => item.relativePath));
          const next = [...prev];
          for (const item of uploaded) {
            if (seen.has(item.relativePath)) continue;
            seen.add(item.relativePath);
            next.push(item);
          }
          return next;
        });
      }
    } finally {
      setIsUploading(false);
    }
  }, [ensureDraftMaterialized, selectedClientId]);

  const removeAttachment = useCallback((relativePath: string) => {
    setAttachments((prev) => prev.filter((a) => a.relativePath !== relativePath));
    if (!draftId) return;

    void fetch("/api/goal-drafts/attachments", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        draftId,
        clientId: selectedClientId,
        relativePath,
      }),
    }).catch(() => {
      // Best effort cleanup only.
    });
  }, [draftId, selectedClientId]);

  const focusDescription = useCallback((selectionStart?: number, selectionEnd = selectionStart) => {
    requestAnimationFrame(() => {
      const textarea = descRef.current;
      if (!textarea) return;
      textarea.focus();
      if (selectionStart == null || selectionEnd == null) return;
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  }, []);

  const handleInsertPastedText = useCallback((block: ChatPastedBlock) => {
    const textarea = descRef.current;
    const selectionStart = textarea?.selectionStart ?? message.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    const insertion = insertPastedTextAtSelection(
      message,
      block.text,
      selectionStart,
      selectionEnd,
    );

    handleMessageChange(insertion.value, insertion.selectionEnd);
    setPastedBlocks((prev) => removePendingPastedText(prev, block.id));
    focusDescription(insertion.selectionStart, insertion.selectionEnd);
    requestAnimationFrame(() => {
      autoGrow();
      syncDescriptionMirrorScroll();
    });
  }, [autoGrow, focusDescription, handleMessageChange, message, syncDescriptionMirrorScroll]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const fileItems = Array.from(e.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (fileItems.length > 0) {
      e.preventDefault();
      void uploadFiles(fileItems);
      return;
    }
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (shouldCapturePastedText(text)) {
      e.preventDefault();
      setPastedBlocks((prev) => [...prev, { id: crypto.randomUUID(), text }]);
    }
  }, [uploadFiles]);

  const hasFileDragPayload = useCallback((dataTransfer: DataTransfer | null): boolean => {
    if (!dataTransfer) return false;
    return Array.from(dataTransfer.types).includes("Files");
  }, []);

  const handleDragEnter = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!hasFileDragPayload(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  }, [hasFileDragPayload]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!hasFileDragPayload(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDraggingFiles(true);
  }, [hasFileDragPayload]);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!hasFileDragPayload(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFiles(false);
    }
  }, [hasFileDragPayload]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!hasFileDragPayload(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    void uploadFiles(event.dataTransfer.files);
  }, [hasFileDragPayload, uploadFiles]);

  const hasHighlight = message.includes("@") || message.includes("/") || message.includes("--");
  const canSubmit =
    (message.trim().length > 0 || title.trim().length > 0 || attachments.length > 0 || pastedBlocks.length > 0) &&
    !isSubmitting;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((showSlashMenu || showTagMenu) && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) return;

      // Flag menu keyboard navigation
      if (showFlagMenu && filteredFlags.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setFlagMenuIndex((i) => (i + 1) % filteredFlags.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setFlagMenuIndex((i) => (i - 1 + filteredFlags.length) % filteredFlags.length);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          handleFlagSelect(filteredFlags[flagMenuIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setShowFlagMenu(false);
          return;
        }
      }

      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, showSlashMenu, showTagMenu, showFlagMenu, filteredFlags, flagMenuIndex, handleFlagSelect]
  );

  const handleModalKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((showSlashMenu || showTagMenu) && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) return;

      if (showFlagMenu && filteredFlags.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setFlagMenuIndex((index) => (index + 1) % filteredFlags.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setFlagMenuIndex((index) => (index - 1 + filteredFlags.length) % filteredFlags.length);
          return;
        }
        if ((e.key === "Enter" && !e.metaKey && !e.ctrlKey) || e.key === "Tab") {
          e.preventDefault();
          handleFlagSelect(filteredFlags[flagMenuIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setShowFlagMenu(false);
          return;
        }
      }

      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (!canSubmit) return;
        closeComposerModal();
        void handleSubmit();
      }
    },
    [canSubmit, closeComposerModal, filteredFlags, flagMenuIndex, handleFlagSelect, handleSubmit, showFlagMenu, showSlashMenu, showTagMenu],
  );

  const suggestions = STATIC_SUGGESTIONS;
  const suggestionsLabel = "Try something like";

  const renderAssets = () => (attachments.length > 0 || pastedBlocks.length > 0 || uploadError) ? (
    <ComposerAssetTray error={uploadError}>
      <ComposerDraftAssetCollection
        pastedBlocks={pastedBlocks}
        attachmentItems={attachments.map((attachment) => ({
          id: attachment.relativePath,
          fileName: attachment.fileName,
          extension: attachment.extension || getChatAttachmentExtension(attachment.fileName),
          sizeBytes: attachment.sizeBytes,
          previewPath: attachment.relativePath,
          previewClientId: selectedClientId,
        }))}
        padding="0"
        onInsertPastedBlock={(blockId) => {
          const block = pastedBlocks.find((candidate) => candidate.id === blockId);
          if (block) handleInsertPastedText(block);
        }}
        onRemovePastedBlock={(blockId) => {
          setPastedBlocks((previous) => removePendingPastedText(previous, blockId));
        }}
        onRemoveAttachmentItem={(itemId) => removeAttachment(itemId)}
      />
    </ComposerAssetTray>
  ) : null;

  const renderEditorMenus = (modal: boolean) => {
    const commandMenus = (
      <>
        {showSlashMenu && (
          <SlashCommandMenu
            query={slashQuery}
            onSelect={handleSlashSelect}
            onClose={() => { setShowSlashMenu(false); setSlashQuery(""); }}
            anchor={modal ? "above" : "below"}
          />
        )}
        {showTagMenu && promptTags.length > 0 && (
          <SlashCommandMenu
            query={tagQuery}
            onSelect={() => {}}
            onClose={() => { setShowTagMenu(false); setTagQuery(""); }}
            anchor={modal ? "above" : "below"}
            mode="tag"
            tagItems={promptTags.filter((tag) => !tagQuery || tag.name.toLowerCase().includes(tagQuery.toLowerCase()))}
            onTagSelect={(tag) => {
              const el = descRef.current;
              if (el) {
                const cursor = el.selectionStart ?? message.length;
                const before = message.slice(0, cursor);
                const after = message.slice(cursor);
                const replaced = before.replace(/(^|[\s])@[\w\/-]*$/, `$1@${tag.name} `);
                setMessage(replaced + after);
              } else {
                setMessage((previous) => previous + `@${tag.name} `);
              }
              recordTagUsage(tag.name);
              setShowTagMenu(false);
              setTagQuery("");
              descRef.current?.focus();
            }}
          />
        )}
      </>
    );

    const flagMenu = showFlagMenu && filteredFlags.length > 0 ? (
      <div
        style={{
          position: "absolute",
          ...(modal ? { bottom: 0 } : { top: 0, marginTop: 28 }),
          left: 0,
          zIndex: 300,
          backgroundColor: "var(--cc-surface)",
          borderRadius: 8,
          boxShadow: "0 4px 16px var(--cc-neutral-alpha-12)",
          border: "1px solid var(--cc-control-bg-active)",
          padding: 4,
          width: 260,
        }}
      >
        <div style={{ fontSize: 10, fontFamily: MONO, color: "var(--cc-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", padding: "4px 10px 2px" }}>
          Level flag
        </div>
        {filteredFlags.map((option, index) => (
          <button
            key={option.flag}
            type="button"
            onClick={() => handleFlagSelect(option)}
            onMouseEnter={() => setFlagMenuIndex(index)}
            style={{
              display: "block",
              width: "100%",
              padding: "7px 10px",
              fontSize: 12,
              fontFamily: MONO,
              border: "none",
              borderRadius: 5,
              backgroundColor: index === flagMenuIndex ? "var(--cc-surface-soft)" : "transparent",
              color: "var(--cc-text-primary)",
              cursor: "pointer",
              textAlign: "left",
              fontWeight: 400,
            }}
          >
            <div style={{ fontWeight: 600 }}>{option.label}</div>
            <div style={{ fontSize: 10, color: "var(--cc-text-tertiary)", marginTop: 1 }}>{option.hint}</div>
          </button>
        ))}
      </div>
    ) : null;

    if (!modal) return <>{commandMenus}{flagMenu}</>;
    return (
      <div style={{ position: "absolute", left: 14, right: 14, bottom: 8, height: 0, zIndex: 40 }}>
        {commandMenus}
        {flagMenu}
      </div>
    );
  };

  const renderEditor = (modal: boolean) => {
    const textPadding = modal
      ? "12px 56px 12px 12px"
      : `4px ${showExpansionTrigger ? 34 : 0}px 4px 0`;
    return (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: modal ? "100%" : undefined,
          padding: modal ? 0 : "12px 14px 8px",
          boxSizing: "border-box",
        }}
      >
        {renderEditorMenus(modal)}
        <div style={{ position: "relative", width: "100%", height: modal ? "100%" : undefined, minWidth: 0, overflow: "hidden" }}>
          {hasHighlight && (
            <HighlightMirror
              text={message}
              scrollTop={descriptionMirrorScroll.top}
              scrollLeft={descriptionMirrorScroll.left}
              style={{
                fontSize: 13,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                lineHeight: 1.5,
                padding: textPadding,
                boxSizing: "border-box",
              }}
            />
          )}
          <textarea
            ref={modal ? setModalDescription : setInlineDescription}
            value={message}
            onChange={(event) =>
              handleMessageChange(event.target.value, event.target.selectionStart)
            }
            onSelect={(event) =>
              handleMessageChange(event.currentTarget.value, event.currentTarget.selectionStart)
            }
            onKeyDown={modal ? handleModalKeyDown : handleKeyDown}
            onPaste={handlePaste}
            onScroll={syncDescriptionMirrorScroll}
            placeholder="What do you want to do? (/ commands, @ tags, -- flags)"
            autoFocus={modal}
            style={{
              width: "100%",
              height: modal ? "100%" : undefined,
              fontSize: 13,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              color: hasHighlight ? "transparent" : "var(--cc-text-primary)",
              caretColor: "var(--cc-text-primary)",
              lineHeight: 1.5,
              border: "none",
              outline: "none",
              background: "transparent",
              resize: "none",
              padding: textPadding,
              minHeight: modal ? 0 : 80,
              boxSizing: "border-box",
              maxWidth: "100%",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
              position: "relative",
              zIndex: 1,
              overflowX: "hidden",
              overflowY: modal ? "auto" : undefined,
            }}
          />
        </div>
        {!modal && showExpansionTrigger && (
          <EditorExpandButton expanded={false} onClick={() => setIsComposerModalOpen(true)} />
        )}
      </div>
    );
  };

  const renderLevelPicker = () => (
    <div ref={levelMenuRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setShowLevelMenu((current) => !current)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "3px 8px",
          fontSize: 11,
          fontWeight: 500,
          fontFamily: MONO,
          border: "1px solid var(--cc-line-alpha-40)",
          borderRadius: 5,
          backgroundColor: "transparent",
          color: "var(--cc-text-secondary)",
          cursor: "pointer",
          transition: "all 120ms ease",
        }}
        onMouseEnter={(event) => { event.currentTarget.style.borderColor = "var(--cc-line-alpha-70)"; }}
        onMouseLeave={(event) => { event.currentTarget.style.borderColor = "var(--cc-line-alpha-40)"; }}
      >
        {LEVEL_LABELS[level]}
        <ChevronDown size={10} />
      </button>
      {showLevelMenu && (
        <div style={{ position: "absolute", bottom: "100%", left: 0, marginBottom: 4, backgroundColor: "var(--cc-surface)", borderRadius: 8, boxShadow: "0 4px 16px var(--cc-neutral-alpha-12)", border: "1px solid var(--cc-control-bg-active)", padding: 4, zIndex: 200, width: 220 }}>
          {(["task", "project", "gsd"] as TaskLevel[]).map((itemLevel) => (
            <button
              key={itemLevel}
              type="button"
              onClick={() => { setLevel(itemLevel); setShowLevelMenu(false); }}
              onMouseEnter={(event) => { if (level !== itemLevel) event.currentTarget.style.backgroundColor = "var(--cc-canvas-muted)"; }}
              onMouseLeave={(event) => { if (level !== itemLevel) event.currentTarget.style.backgroundColor = "transparent"; }}
              style={{ display: "block", width: "100%", padding: "7px 10px", fontSize: 12, fontFamily: MONO, border: "none", borderRadius: 5, backgroundColor: level === itemLevel ? "var(--cc-surface-soft)" : "transparent", color: "var(--cc-text-primary)", cursor: "pointer", textAlign: "left", fontWeight: level === itemLevel ? 600 : 400 }}
            >
              <div>{LEVEL_LABELS[itemLevel]}</div>
              <div style={{ fontSize: 10, fontWeight: 400, color: "var(--cc-text-tertiary)", marginTop: 1 }}>
                {LEVEL_HINTS[itemLevel]}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const renderWorkspacePicker = () => clients.length > 0 ? (
    <div ref={clientMenuRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => {
          if (attachments.length === 0) setShowClientMenu((current) => !current);
        }}
        disabled={attachments.length > 0}
        title={attachments.length > 0 ? "Remove attachments before switching workspace" : "Choose workspace"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "3px 8px",
          fontSize: 11,
          fontWeight: 500,
          fontFamily: MONO,
          border: "1px solid var(--cc-line-alpha-40)",
          borderRadius: 5,
          backgroundColor: "transparent",
          color: attachments.length > 0 ? "var(--cc-text-muted)" : "var(--cc-text-secondary)",
          cursor: attachments.length > 0 ? "not-allowed" : "pointer",
          transition: "all 120ms ease",
        }}
        onMouseEnter={(event) => { if (attachments.length === 0) event.currentTarget.style.borderColor = "var(--cc-line-alpha-70)"; }}
        onMouseLeave={(event) => { event.currentTarget.style.borderColor = "var(--cc-line-alpha-40)"; }}
      >
        {selectedClientId
          ? (clients.find((client) => client.slug === selectedClientId)?.name ?? selectedClientId)
          : rootName}
        <ChevronDown size={10} />
      </button>
      {showClientMenu && (
        <div style={{ position: "absolute", bottom: "100%", left: 0, marginBottom: 4, backgroundColor: "var(--cc-surface)", borderRadius: 8, boxShadow: "0 4px 16px var(--cc-neutral-alpha-12)", border: "1px solid var(--cc-control-bg-active)", padding: 4, zIndex: 200, width: 200 }}>
          {[{ slug: null, name: rootName }, ...clients.map((client) => ({ slug: client.slug, name: client.name }))].map((workspace) => {
            const selected = selectedClientId === workspace.slug;
            return (
              <button
                key={workspace.slug ?? "root"}
                type="button"
                onClick={() => {
                  clientSelectionTouchedRef.current = true;
                  setSelectedClientId(workspace.slug);
                  setShowClientMenu(false);
                }}
                onMouseEnter={(event) => { if (!selected) event.currentTarget.style.backgroundColor = "var(--cc-canvas-muted)"; }}
                onMouseLeave={(event) => { if (!selected) event.currentTarget.style.backgroundColor = "transparent"; }}
                style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "6px 10px", fontSize: 12, fontFamily: MONO, border: "none", borderRadius: 5, backgroundColor: selected ? "var(--cc-surface-soft)" : "transparent", color: "var(--cc-text-primary)", cursor: "pointer", textAlign: "left", fontWeight: selected ? 600 : 400 }}
              >
                {workspace.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  ) : null;

  const renderToolbar = (modal: boolean) => (
    <div style={{ display: "flex", flexWrap: modal ? "wrap" : "nowrap", alignItems: "center", gap: 2, padding: "6px 8px", borderTop: "1px solid var(--cc-control-bg-active)" }}>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={isUploading}
        onMouseEnter={(event) => { if (!isUploading) event.currentTarget.style.backgroundColor = "var(--cc-neutral-alpha-04)"; }}
        onMouseLeave={(event) => { event.currentTarget.style.backgroundColor = "transparent"; }}
        title="Attach file"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "4px 6px", border: "none", borderRadius: 5, backgroundColor: "transparent", color: isUploading ? "var(--cc-text-disabled)" : "var(--cc-text-secondary)", cursor: isUploading ? "not-allowed" : "pointer" }}
      >
        <Paperclip size={14} />
      </button>
      {!modal && (
        <DeleteConfirmButton
          ariaLabel="Discard draft"
          onConfirm={() => onDiscarded(draftId)}
          size="compact"
          disabled={!draftId && !title.trim() && !message.trim() && attachments.length === 0 && pastedBlocks.length === 0}
          idleColor="var(--cc-palette-neutral-600)"
        />
      )}
      <ModelPicker value={model} onChange={handleModelChange} autoModeActive={permissionMode === "auto"} />
      <ThinkingEffortPicker value={thinkingEffort} model={model} onChange={handleThinkingEffortChange} />
      <PermissionPicker value={permissionMode} model={model} onChange={setPermissionMode} />
      <TagPicker value={selectedTag} onChange={setSelectedTag} />
      {renderLevelPicker()}
      {renderWorkspacePicker()}
      <div style={{ flex: 1 }} />
      {!modal && (
        <button
          type="button"
          onClick={() => { void handleSubmit(); }}
          disabled={!canSubmit}
          aria-label="Create Goal"
          title="Create Goal"
          onMouseEnter={(event) => { if (canSubmit) event.currentTarget.style.opacity = "0.9"; }}
          onMouseLeave={(event) => { event.currentTarget.style.opacity = "1"; }}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 14px", fontSize: 12, fontWeight: 600, fontFamily: MONO, background: canSubmit ? "linear-gradient(135deg, var(--cc-brand-primary), var(--cc-brand-hover))" : "var(--cc-control-bg-hover)", color: canSubmit ? "var(--cc-surface)" : "var(--cc-text-tertiary)", border: "none", borderRadius: 6, cursor: canSubmit ? "pointer" : "default", transition: "all 150ms ease" }}
        >
          <ArrowUp size={12} />
          {isSubmitting ? "Sending..." : "Send"}
        </button>
      )}
    </div>
  );

  return (
    <div
      style={{
        position: inline ? "relative" : "fixed",
        top: inline ? undefined : 52,
        right: inline ? undefined : 0,
        bottom: inline ? undefined : 0,
        width: inline ? "100%" : drawerWidth ?? 720,
        height: inline ? "100%" : undefined,
        background: "var(--cc-canvas)",
        borderLeft: inline ? "none" : "1px solid var(--cc-palette-neutral-400)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        zIndex: inline ? 1 : 100,
        boxShadow: inline ? "none" : "-4px 0 24px var(--cc-neutral-alpha-08)",
      }}
    >
      {/* Resize handle */}
      {!inline && onStartDrawerDrag && (
        <div
          onMouseDown={onStartDrawerDrag}
          title="Drag to resize"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 6,
            cursor: "col-resize",
            zIndex: 60,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget.firstChild as HTMLElement | null)?.style?.setProperty("background", "var(--cc-brand-primary)");
          }}
          onMouseLeave={(e) => {
            (e.currentTarget.firstChild as HTMLElement | null)?.style?.setProperty("background", "transparent");
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 2,
              width: 2,
              background: "transparent",
              transition: "background 150ms ease",
              borderRadius: 1,
            }}
          />
        </div>
      )}

      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 48,
        minHeight: 48,
        padding: "0 16px",
        borderBottom: "1px solid var(--cc-line-alpha-20)",
        background: "var(--cc-canvas)",
        flexShrink: 0,
      }}>
        <input
          ref={titleRef}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              descRef.current?.focus();
            }
          }}
          placeholder="New Goal"
          style={{
            flex: 1,
            minWidth: 0,
            padding: 0,
            border: 0,
            outline: 0,
            background: "transparent",
            fontSize: "var(--cc-feed-type-goal)",
            fontWeight: 600,
            fontFamily: "var(--cc-font-body)",
            color: "var(--cc-text-primary)",
          }}
        />
        <span style={{ padding: "3px 9px", borderRadius: 6, color: "var(--cc-text-secondary)", background: "var(--cc-neutral-alpha-06)", font: "600 11px/1 var(--cc-font-label)" }}>
          Draft
        </span>
        <span style={{ color: "var(--cc-text-tertiary)", font: "400 11px/1 var(--cc-font-mono)", whiteSpace: "nowrap" }}>
          {selectedClientId ? clients.find((client) => client.slug === selectedClientId)?.name ?? selectedClientId : rootName}
        </span>
        <button
          onClick={onClose}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            border: "none",
            borderRadius: 6,
            background: "transparent",
            color: "var(--cc-text-tertiary)",
            cursor: "pointer",
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Draft Chat panel */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: 12 }}>
        <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid var(--cc-line-alpha-20)", borderRadius: 10, background: "var(--cc-surface)" }}>
          <div style={{ height: 34, minHeight: 34, display: "flex", alignItems: "center", gap: 7, padding: "0 10px", borderBottom: "1px solid var(--cc-line-alpha-20)", background: "var(--cc-surface-raised)", color: "var(--cc-text-secondary)" }}>
            <MessageSquare size={13} aria-hidden />
            <span style={{ fontSize: "var(--cc-feed-type-panel)", fontWeight: 600, lineHeight: 1, fontFamily: "var(--cc-font-label)", letterSpacing: "0.02em" }}>Chat — Main</span>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", padding: "20px 24px 14px" }}>

        {/* Grey input container — matches reply-input style */}
        {!isComposerModalOpen && <div
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            order: 2,
            width: "100%",
            maxWidth: 720,
            margin: "0 auto",
            background: "var(--cc-surface-soft)",
            border: isDraggingFiles ? "1px solid var(--cc-brand-alpha-45)" : "1px solid var(--cc-control-bg-active)",
            borderRadius: 10,
            overflow: "visible",
            position: "relative",
            boxShadow: isDraggingFiles ? "0 0 0 3px var(--cc-brand-alpha-08)" : "none",
            transition: "border-color 150ms ease, box-shadow 150ms ease",
          }}
        >
          {renderAssets()}
          {renderEditor(false)}
          {renderToolbar(false)}
        </div>}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={(event) => {
            void uploadFiles(event.target.files);
            event.target.value = "";
          }}
          style={{ display: "none" }}
          accept={CHAT_ATTACHMENT_ACCEPT_ATTR}
        />
        {isComposerModalOpen && (
          <ComposerEditorModal
            title="Compose message"
            initialExpanded
            submitting={isSubmitting}
            submitDisabled={!canSubmit}
            onClose={closeComposerModal}
            onSubmit={() => {
              if (!canSubmit) return;
              closeComposerModal();
              void handleSubmit();
            }}
            leading={renderAssets()}
            editor={(
              <div
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                style={{ width: "100%", height: "100%" }}
              >
                {renderEditor(true)}
              </div>
            )}
            toolbar={renderToolbar(true)}
            escapeDisabled={showSlashMenu || showTagMenu || showFlagMenu}
          />
        )}

        {/* Suggestion chips */}
        {(
          <div style={{ order: 1, flex: 1, width: "100%", maxWidth: 720, margin: "0 auto 16px", overflowY: "auto" }}>
            <div style={{
              fontSize: 11,
              fontFamily: MONO,
              color: "var(--cc-text-tertiary)",
              textTransform: "uppercase" as const,
              letterSpacing: "0.06em",
              marginBottom: 10,
            }}>
              {suggestionsLabel}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {suggestions.map((s) => (
                <button
                  key={s.title}
                  onClick={() => {
                    const addition = s.prompt ?? (s.title + (s.desc ? "\n" + s.desc : ""));
                    setMessage((prev) => {
                      if (!prev.trim()) return addition;
                      return prev.trimEnd() + "\n" + addition;
                    });
                    descRef.current?.focus();
                  }}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    padding: "8px 10px",
                    border: "1px solid var(--cc-line-alpha-20)",
                    borderRadius: 8,
                    backgroundColor: "transparent",
                    cursor: "pointer",
                    textAlign: "left" as const,
                    transition: "all 120ms ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--cc-canvas-muted)";
                    e.currentTarget.style.borderColor = "var(--cc-line-alpha-50)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                    e.currentTarget.style.borderColor = "var(--cc-line-alpha-20)";
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--cc-font-body)", color: "var(--cc-text-primary)" }}>
                    {s.title}
                  </span>
                  <span style={{ fontSize: 12, fontFamily: MONO, color: "var(--cc-text-tertiary)" }}>
                    {s.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
          </div>
        </div>
      </div>
    </div>
  );
}

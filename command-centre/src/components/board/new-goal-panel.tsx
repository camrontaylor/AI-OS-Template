"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { X, ArrowUp, ChevronDown, Paperclip, Trash2 } from "lucide-react";
import type { TaskLevel, PermissionMode, ClaudeModel, ClaudeThinkingEffort } from "@/types/task";
import type { ChatPastedBlock } from "@/types/chat-composer";
import type { GoalDraftAttachment, GoalDraftPayload } from "@/types/goal-draft";
import { useTaskStore } from "@/store/task-store";
import { useClientStore } from "@/store/client-store";
import { SlashCommandMenu } from "@/components/shared/slash-command-menu";
import type { TagItem } from "@/components/shared/slash-command-menu";
import type { SlashCommand } from "@/lib/slash-commands";
import { HighlightMirror } from "@/components/modal/reply-input";
import { ModelPicker } from "@/components/shared/model-picker";
import { ThinkingEffortPicker } from "@/components/shared/thinking-effort-picker";
import { PermissionPicker } from "@/components/shared/permission-picker";
import { TagPicker } from "@/components/shared/tag-picker";
import { ComposerAssetTray } from "@/components/shared/composer-asset-tray";
import { ComposerDraftAssetCollection } from "@/components/shared/composer-draft-asset-collection";
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
import { loadClaudeLlmPreference, saveClaudeLlmPreference } from "@/lib/llm-preferences";
import {
  insertPastedTextAtSelection,
  removePendingPastedText,
  shouldCapturePastedText,
} from "@/lib/pasted-text";

const MONO = "var(--font-inter), Inter, sans-serif";

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
  onDiscarded: (draftId: string | null) => void;
  onStartDrawerDrag?: (e: React.MouseEvent) => void;
}

export function NewGoalPanel({
  drawerWidth,
  draft,
  onClose,
  onCreated,
  onDraftSaved,
  onDiscarded,
  onStartDrawerDrag,
}: NewGoalPanelProps) {
  const storeSelectedClientId = useClientStore((s) => s.selectedClientId);
  const [draftId, setDraftId] = useState<string | null>(draft?.id ?? null);
  const [createdAt, setCreatedAt] = useState<string | null>(draft?.createdAt ?? null);
  const [title, setTitle] = useState(draft?.title ?? "");
  const [message, setMessage] = useState(draft?.message ?? "");
  const [level, setLevel] = useState<TaskLevel>(draft?.level ?? "task");
  const [showLevelMenu, setShowLevelMenu] = useState(false);
  const [model, setModel] = useState<ClaudeModel | null>(() => draft?.model ?? loadClaudeLlmPreference().model);
  const [thinkingEffort, setThinkingEffort] = useState<ClaudeThinkingEffort | null>(() => draft?.thinkingEffort ?? loadClaudeLlmPreference().reasoningEffort);
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

  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const dragDepthRef = useRef(0);
  const levelMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clientMenuRef = useRef<HTMLDivElement>(null);
  const clientSelectionTouchedRef = useRef(Boolean(draft));
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
    const el = descRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(120, el.scrollHeight)}px`;
  }, []);

  useEffect(() => { autoGrow(); }, [message, autoGrow]);

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
      version: 1,
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
    async (goalTitle: string, fullDescription: string, taskLevel: TaskLevel) => {
      let taskProjectSlug: string | null = null;
      // Create a brief for project/gsd tasks, or for any task in plan mode
      const needsBrief = taskLevel === "project" || taskLevel === "gsd" || permissionMode === "plan";
      if (needsBrief) {
        taskProjectSlug = goalTitle
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 40);
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

      await createTask(goalTitle, fullDescription, taskLevel, taskProjectSlug, undefined, permissionMode, undefined, selectedClientId, model, thinkingEffort);

      const tasks = useTaskStore.getState().tasks;
      const created = tasks.find((t) => t.title === goalTitle && t.description === fullDescription);
      return created?.id ?? null;
    },
    [createTask, model, permissionMode, selectedClientId, thinkingEffort]
  );

  const handleSubmit = useCallback(async () => {
    const trimmed = message.trim();
    const trimmedTitle = title.trim();
    if ((!trimmed && !trimmedTitle && attachments.length === 0 && pastedBlocks.length === 0) || isSubmitting) return;

    // Detect and strip --project / --gsd flags
    const flagMatch = trimmed.match(/\s*--(project|gsd)\s*/i);
    let detectedLevel: TaskLevel = level;
    if (flagMatch) {
      detectedLevel = flagMatch[1].toLowerCase() as TaskLevel;
    }
    const cleanMessage = trimmed.replace(/\s*--(project|gsd)\s*/gi, " ").trim();

    // Use the explicit title, or derive from first line of description
    let goalTitle: string;
    if (trimmedTitle) {
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
    const taskId = await createWithLevel(goalTitle, fullDescription || goalTitle, detectedLevel);
    if (taskId && selectedTag) {
      await updateTask(taskId, { tag: selectedTag });
    }
    setIsSubmitting(false);
    if (taskId) onCreated(taskId, draftId);
  }, [attachments, createWithLevel, draftId, isSubmitting, level, message, onCreated, pastedBlocks, selectedTag, title, updateTask]);

  const handleMessageChange = useCallback((value: string) => {
    setMessage(value);

    // Real-time level detection from completed inline flags
    const completedFlag = value.match(/--(project|gsd)\b/i);
    if (completedFlag) {
      setLevel(completedFlag[1].toLowerCase() as TaskLevel);
    }

    const el = descRef.current;
    const cursor = el?.selectionStart ?? value.length;
    const before = value.slice(0, cursor);

    // Check for /command at cursor position (after start-of-string or whitespace)
    const slashMatch = before.match(/(^|[\s])\/([\w:/-]*)$/);
    if (slashMatch) {
      setShowSlashMenu(true);
      setSlashQuery("/" + slashMatch[2]);
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
      const before = message.slice(0, cursor);
      const after = message.slice(cursor);

      // Replace the partial /query with the full command, add a trailing space
      const replaced = before.replace(/(^|[\s])\/[\w:/-]*$/, `$1${cmd.command} `);
      const newMsg = replaced + after;
      setMessage(newMsg);

      // Re-focus and place cursor right after the inserted command
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

    handleMessageChange(insertion.value);
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

      // Escape closes the composer when no menu is open (common sheet pattern).
      if (e.key === "Escape" && !showSlashMenu && !showTagMenu && !showFlagMenu) {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, showSlashMenu, showTagMenu, showFlagMenu, filteredFlags, flagMenuIndex, handleFlagSelect, onClose]
  );

  const hasHighlight = message.includes("@") || message.includes("/") || message.includes("--");
  const canSubmit =
    (message.trim().length > 0 || title.trim().length > 0 || attachments.length > 0 || pastedBlocks.length > 0) &&
    !isSubmitting;

  const suggestions = STATIC_SUGGESTIONS;
  const suggestionsLabel = "Try something like";

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: drawerWidth ?? 720,
        maxWidth: "100vw",
        background: "var(--card)",
        borderLeft: "1px solid var(--border)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        zIndex: 100,
        boxShadow: "-4px 0 24px color-mix(in srgb, var(--foreground) 8%, transparent)",
      }}
    >
      {/* Resize handle */}
      {onStartDrawerDrag && (
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
            (e.currentTarget.firstChild as HTMLElement | null)?.style?.setProperty("background", "var(--primary)");
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
        justifyContent: "space-between",
        padding: "8px 16px",
        borderBottom: "1px solid var(--border)",
        background: "var(--card)",
        flexShrink: 0,
      }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            fontFamily: MONO,
            color: "var(--muted-foreground)",
          }}
        >
          New Goal
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
            color: "var(--muted-foreground)",
            cursor: "pointer",
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflow: "auto", padding: "16px 20px 20px" }}>
        {/* Title input */}
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              descRef.current?.focus();
            }
          }}
          placeholder="Goal title..."
          style={{
            width: "100%",
            fontSize: 20,
            fontWeight: 600,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            color: "var(--foreground)",
            border: "none",
            outline: "none",
            background: "transparent",
            padding: 0,
            marginBottom: 12,
          }}
        />

        {/* Grey input container — matches reply-input style */}
        <div
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            background: "var(--muted)",
            border: isDraggingFiles ? "1px solid color-mix(in srgb, var(--foreground) 45%, transparent)" : "1px solid var(--border)",
            borderRadius: 10,
            overflow: "visible",
            position: "relative",
            boxShadow: isDraggingFiles ? "0 0 0 3px color-mix(in srgb, var(--foreground) 8%, transparent)" : "none",
            transition: "border-color 150ms ease, box-shadow 150ms ease",
          }}
        >
          {(attachments.length > 0 || pastedBlocks.length > 0 || uploadError) ? (
            <ComposerAssetTray error={uploadError}>
              <ComposerDraftAssetCollection
                pastedBlocks={pastedBlocks}
                attachmentItems={attachments.map((att) => ({
                  id: att.relativePath,
                  fileName: att.fileName,
                  extension: att.extension || getChatAttachmentExtension(att.fileName),
                  sizeBytes: att.sizeBytes,
                  previewPath: att.relativePath,
                  previewClientId: selectedClientId,
                }))}
                padding="0"
                onInsertPastedBlock={(blockId) => {
                  const block = pastedBlocks.find((candidate) => candidate.id === blockId);
                  if (block) {
                    handleInsertPastedText(block);
                  }
                }}
                onRemovePastedBlock={(blockId) => {
                  setPastedBlocks((prev) => removePendingPastedText(prev, blockId));
                }}
                onRemoveAttachmentItem={(itemId) => removeAttachment(itemId)}
              />
            </ComposerAssetTray>
          ) : null}
          {/* Description */}
          <div style={{ position: "relative", padding: "12px 16px 8px" }}>
            {showSlashMenu && (
              <SlashCommandMenu
                query={slashQuery}
                onSelect={handleSlashSelect}
                onClose={() => { setShowSlashMenu(false); setSlashQuery(""); }}
                anchor="below"
              />
            )}
            {showTagMenu && promptTags.length > 0 && (
              <SlashCommandMenu
                query={tagQuery}
                onSelect={() => {}}
                onClose={() => { setShowTagMenu(false); setTagQuery(""); }}
                anchor="below"
                mode="tag"
                tagItems={promptTags.filter((t) => !tagQuery || t.name.toLowerCase().includes(tagQuery.toLowerCase()))}
                onTagSelect={(tag) => {
                  const el = descRef.current;
                  if (el) {
                    const cursor = el.selectionStart ?? message.length;
                    const before = message.slice(0, cursor);
                    const after = message.slice(cursor);
                    const replaced = before.replace(/(^|[\s])@[\w\/-]*$/, `$1@${tag.name} `);
                    setMessage(replaced + after);
                  } else {
                    setMessage((prev) => prev + `@${tag.name} `);
                  }
                  recordTagUsage(tag.name);
                  setShowTagMenu(false);
                  setTagQuery("");
                  descRef.current?.focus();
                }}
              />
            )}
            {showFlagMenu && filteredFlags.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  zIndex: 300,
                  marginTop: 28,
                  backgroundColor: "var(--card)",
                  borderRadius: 8,
                  boxShadow: "0 4px 16px color-mix(in srgb, var(--foreground) 12%, transparent)",
                  border: "1px solid var(--border)",
                  padding: 4,
                  width: 260,
                }}
              >
                <div style={{
                  fontSize: 10,
                  fontFamily: MONO,
                  color: "var(--muted-foreground)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  padding: "4px 8px 4px",
                }}>
                  Level flag
                </div>
                {filteredFlags.map((opt, i) => (
                  <button
                    key={opt.flag}
                    onClick={() => handleFlagSelect(opt)}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "8px 12px",
                      fontSize: 12,
                      fontFamily: MONO,
                      border: "none",
                      borderRadius: 5,
                      backgroundColor: i === flagMenuIndex ? "var(--muted)" : "transparent",
                      color: "var(--foreground)",
                      cursor: "pointer",
                      textAlign: "left" as const,
                      fontWeight: 400,
                    }}
                    onMouseEnter={() => setFlagMenuIndex(i)}
                  >
                    <div style={{ fontWeight: 600 }}>{opt.label}</div>
                    <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 0 }}>
                      {opt.hint}
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div style={{ position: "relative", minWidth: 0, overflow: "hidden" }}>
              {hasHighlight && (
                <HighlightMirror
                  text={message}
                  scrollTop={descriptionMirrorScroll.top}
                  scrollLeft={descriptionMirrorScroll.left}
                  style={{
                    fontSize: 14,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    lineHeight: 1.5,
                    padding: "4px 0",
                  }}
                />
              )}
              <textarea
                ref={descRef}
                value={message}
                onChange={(e) => handleMessageChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onScroll={syncDescriptionMirrorScroll}
                placeholder="What do you want to do? (/ commands, @ tags, -- flags)"
                style={{
                  width: "100%",
                  fontSize: 14,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  color: hasHighlight ? "transparent" : "var(--foreground)",
                  caretColor: "var(--foreground)",
                  lineHeight: 1.5,
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  resize: "none",
                  padding: "4px 0",
                  minHeight: 80,
                  boxSizing: "border-box" as const,
                  maxWidth: "100%",
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                  position: "relative",
                  zIndex: 1,
                  overflowX: "hidden",
                }}
              />
            </div>
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(e) => {
              void uploadFiles(e.target.files);
              e.target.value = "";
            }}
            style={{ display: "none" }}
            accept={CHAT_ATTACHMENT_ACCEPT_ATTR}
          />

          {/* Toolbar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 4,
              padding: "8px 8px",
              borderTop: "1px solid var(--border)",
            }}
          >
        {/* Attach file */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "4px 8px",
            border: "none",
            borderRadius: 5,
            backgroundColor: "transparent",
            color: isUploading ? "var(--border)" : "var(--muted-foreground)",
            cursor: isUploading ? "not-allowed" : "pointer",
          }}
          onMouseEnter={(e) => { if (!isUploading) e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 4%, transparent)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
          title="Attach file"
        >
          <Paperclip size={14} />
        </button>

        <button
          type="button"
          onClick={() => { void onDiscarded(draftId); }}
          disabled={!draftId && !title.trim() && !message.trim() && attachments.length === 0 && pastedBlocks.length === 0}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "4px 8px",
            border: "none",
            borderRadius: 5,
            backgroundColor: "transparent",
            color: !draftId && !title.trim() && !message.trim() && attachments.length === 0 && pastedBlocks.length === 0 ? "var(--border)" : "var(--border)",
            cursor: !draftId && !title.trim() && !message.trim() && attachments.length === 0 && pastedBlocks.length === 0 ? "not-allowed" : "pointer",
          }}
          title="Discard draft"
        >
          <Trash2 size={14} />
        </button>

        <ModelPicker value={model} onChange={handleModelChange} />
        <ThinkingEffortPicker value={thinkingEffort} model={model} onChange={handleThinkingEffortChange} />
        <PermissionPicker value={permissionMode} onChange={setPermissionMode} />
        <TagPicker value={selectedTag} onChange={setSelectedTag} />

        {/* Level pill — in toolbar */}
        <div ref={levelMenuRef} style={{ position: "relative" }}>
          <button
            onClick={() => setShowLevelMenu(!showLevelMenu)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 8px",
              fontSize: 11,
              fontWeight: 500,
              fontFamily: MONO,
              border: "1px solid color-mix(in srgb, var(--foreground) 40%, transparent)",
              borderRadius: 5,
              backgroundColor: "transparent",
              color: "var(--muted-foreground)",
              cursor: "pointer",
              transition: "all 120ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "color-mix(in srgb, var(--foreground) 70%, transparent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "color-mix(in srgb, var(--foreground) 40%, transparent)"; }}
          >
            {LEVEL_LABELS[level]}
            <ChevronDown size={10} />
          </button>
          {showLevelMenu && (
            <div
              style={{
                position: "absolute",
                bottom: "100%",
                left: 0,
                marginBottom: 4,
                backgroundColor: "var(--card)",
                borderRadius: 8,
                boxShadow: "0 4px 16px color-mix(in srgb, var(--foreground) 12%, transparent)",
                border: "1px solid var(--border)",
                padding: 4,
                zIndex: 200,
                width: 220,
              }}
            >
              {(["task", "project", "gsd"] as TaskLevel[]).map((l) => {
                const label = LEVEL_LABELS[l];
                const hint = LEVEL_HINTS[l];
                return (
                  <button
                    key={l}
                    onClick={() => { setLevel(l); setShowLevelMenu(false); }}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "8px 12px",
                      fontSize: 12,
                      fontFamily: MONO,
                      border: "none",
                      borderRadius: 5,
                      backgroundColor: level === l ? "var(--muted)" : "transparent",
                      color: "var(--foreground)",
                      cursor: "pointer",
                      textAlign: "left" as const,
                      fontWeight: level === l ? 600 : 400,
                    }}
                    onMouseEnter={(e) => { if (level !== l) e.currentTarget.style.backgroundColor = "var(--card)"; }}
                    onMouseLeave={(e) => { if (level !== l) e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    <div>{label}</div>
                    <div style={{ fontSize: 10, fontWeight: 400, color: "var(--muted-foreground)", marginTop: 0 }}>
                      {hint}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Client picker — only show when clients exist */}
        {clients.length > 0 && (
          <div ref={clientMenuRef} style={{ position: "relative" }}>
            <button
              onClick={() => {
                if (attachments.length > 0) return;
                setShowClientMenu(!showClientMenu);
              }}
              disabled={attachments.length > 0}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 8px",
                fontSize: 11,
                fontWeight: 500,
                fontFamily: MONO,
                border: "1px solid color-mix(in srgb, var(--foreground) 40%, transparent)",
                borderRadius: 5,
                backgroundColor: "transparent",
                color: attachments.length > 0 ? "var(--border)" : "var(--muted-foreground)",
                cursor: attachments.length > 0 ? "not-allowed" : "pointer",
                transition: "all 120ms ease",
              }}
              onMouseEnter={(e) => { if (attachments.length === 0) e.currentTarget.style.borderColor = "color-mix(in srgb, var(--foreground) 70%, transparent)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "color-mix(in srgb, var(--foreground) 40%, transparent)"; }}
              title={attachments.length > 0 ? "Remove attachments before switching workspace" : "Choose workspace"}
            >
              {selectedClientId
                ? (clients.find((c) => c.slug === selectedClientId)?.name ?? selectedClientId)
                : rootName
              }
              <ChevronDown size={10} />
            </button>
            {showClientMenu && (
              <div
                style={{
                  position: "absolute",
                  bottom: "100%",
                  left: 0,
                  marginBottom: 4,
                  backgroundColor: "var(--card)",
                  borderRadius: 8,
                  boxShadow: "0 4px 16px color-mix(in srgb, var(--foreground) 12%, transparent)",
                  border: "1px solid var(--border)",
                  padding: 4,
                  zIndex: 200,
                  width: 200,
                }}
              >
                {/* Root option */}
                <button
                  onClick={() => {
                    clientSelectionTouchedRef.current = true;
                    setSelectedClientId(null);
                    setShowClientMenu(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "8px 12px",
                    fontSize: 12,
                    fontFamily: MONO,
                    border: "none",
                    borderRadius: 5,
                    backgroundColor: selectedClientId === null ? "var(--muted)" : "transparent",
                    color: "var(--foreground)",
                    cursor: "pointer",
                    textAlign: "left" as const,
                    fontWeight: selectedClientId === null ? 600 : 400,
                  }}
                  onMouseEnter={(e) => { if (selectedClientId !== null) e.currentTarget.style.backgroundColor = "var(--card)"; }}
                  onMouseLeave={(e) => { if (selectedClientId !== null) e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  {rootName}
                </button>
                {/* Client options */}
                {clients.map((c) => (
                  <button
                    key={c.slug}
                    onClick={() => {
                      clientSelectionTouchedRef.current = true;
                      setSelectedClientId(c.slug);
                      setShowClientMenu(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      padding: "8px 12px",
                      fontSize: 12,
                      fontFamily: MONO,
                      border: "none",
                      borderRadius: 5,
                      backgroundColor: selectedClientId === c.slug ? "var(--muted)" : "transparent",
                      color: "var(--foreground)",
                      cursor: "pointer",
                      textAlign: "left" as const,
                      fontWeight: selectedClientId === c.slug ? 600 : 400,
                    }}
                    onMouseEnter={(e) => { if (selectedClientId !== c.slug) e.currentTarget.style.backgroundColor = "var(--card)"; }}
                    onMouseLeave={(e) => { if (selectedClientId !== c.slug) e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Send button */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "8px 16px",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: MONO,
            background: canSubmit
              ? "linear-gradient(135deg, var(--primary), var(--primary))"
              : "var(--border)",
            color: canSubmit ? "var(--card)" : "var(--muted-foreground)",
            border: "none",
            borderRadius: 6,
            cursor: canSubmit ? "pointer" : "default",
            transition: "all 150ms ease",
          }}
          onMouseEnter={(e) => { if (canSubmit) e.currentTarget.style.opacity = "0.9"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
        >
          <ArrowUp size={12} />
          {isSubmitting ? "Sending..." : "Send"}
        </button>
          </div>
        </div>

        {/* Suggestion chips */}
        {(
          <div style={{ marginTop: 16 }}>
            <div style={{
              fontSize: 11,
              fontFamily: MONO,
              color: "var(--muted-foreground)",
              textTransform: "uppercase" as const,
              letterSpacing: "0.06em",
              marginBottom: 12,
            }}>
              {suggestionsLabel}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
                    gap: 4,
                    padding: "8px 12px",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    backgroundColor: "transparent",
                    cursor: "pointer",
                    textAlign: "left" as const,
                    transition: "all 120ms ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--muted)";
                    e.currentTarget.style.borderColor = "color-mix(in srgb, var(--foreground) 50%, transparent)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--foreground)" }}>
                    {s.title}
                  </span>
                  <span style={{ fontSize: 12, fontFamily: MONO, color: "var(--muted-foreground)" }}>
                    {s.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

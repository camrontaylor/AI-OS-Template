"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Paperclip, X, Image, FileType, FileText, Sunrise, Moon, AlertTriangle, ChevronDown, Zap, ClipboardList, Layers } from "lucide-react";
import type { TaskLevel, PermissionMode } from "@/types/task";
import { useTaskStore } from "@/store/task-store";
import { useClientStore } from "@/store/client-store";
import type { ScopeResult } from "@/app/api/tasks/scope-goal/route";
import type { QuestionSpec } from "@/types/question-spec";

import { SlashCommandMenu } from "@/components/shared/slash-command-menu";
import type { TagItem } from "@/components/shared/slash-command-menu";
import type { SlashCommand } from "@/lib/slash-commands";
import { GoalChips, recordTagUsage } from "./goal-chips";
import { CHAT_ATTACHMENT_ACCEPT_ATTR } from "@/lib/chat-attachment-policy";

// Minimal fallback questions — mirrors server-side fallbackQuestions but
// kept local so the client can synthesise a scope result when scope-goal
// is unreachable or keyword-routing skips the round-trip entirely.
function clientFallbackQuestions(level: "project" | "gsd"): QuestionSpec[] {
  if (level === "project") {
    return [
      { id: "audience", prompt: "Who is the primary audience or user for this?", type: "text", required: true },
      { id: "success", prompt: "What does success look like — how will you know it's done well?", type: "multiline" },
      { id: "constraints", prompt: "Are there existing assets, tools, or constraints we should work within?", type: "multiline" },
      { id: "deadline", prompt: "Is there a deadline or timeline we need to hit?", type: "text" },
    ];
  }
  return [
    { id: "flows", prompt: "What are the core user flows this needs to support?", type: "multiline", required: true },
    { id: "constraints", prompt: "What are the non-negotiable constraints (compliance, performance, budget)?", type: "multiline" },
    { id: "integrations", prompt: "Which existing systems does this need to integrate with?", type: "multiline" },
    { id: "success", prompt: "What does success look like in 90 days?", type: "multiline" },
  ];
}

function synthesizeFallbackScope(level: "project" | "gsd"): ScopeResult {
  return {
    level,
    confidence: 0.75,
    overlaps: [],
    questions: clientFallbackQuestions(level),
    suggestedSubtasks: [],
  };
}

interface Attachment {
  fileName: string;
  relativePath: string;
  extension: string;
  sizeBytes: number;
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

function getAttachmentIcon(ext: string) {
  if (IMAGE_EXTS.has(ext)) return Image;
  if (ext === "pdf") return FileType;
  return FileText;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

import { LEVEL_LABELS, LEVEL_HINTS } from "@/lib/levels";

// Command Centre always launches tasks in bypassPermissions ("yolo") mode.
// The picker UI was removed so there is no longer a default vs. full-auto
// choice — every task runs with --dangerously-skip-permissions.
const FIXED_PERMISSION_MODE: PermissionMode = "bypassPermissions";

interface GsdStatus {
  exists: boolean;
  projectName?: string;
  currentPhase?: number | null;
  totalPhases?: number | null;
}

type ScopingState =
  | { phase: "idle" }
  | { phase: "picking"; description: string }
  | { phase: "error"; message: string };

export function TaskCreateInput({
  projectSlug,
  onRoutingDecision,
  pickSeed,
}: {
  projectSlug?: string | null;
  onRoutingDecision?: (decision: ScopeResult, goal: string) => void;
  /** Externally triggered: when `nonce` changes, open the inline picker with `description`. */
  pickSeed?: { description: string; nonce: number } | null;
}) {
  const [description, setDescription] = useState("");
  const [planFirst, setPlanFirst] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Routing: when levelOverride is null the dropdown shows "Auto" and submit
  // calls /api/tasks/scope-goal. When an explicit level is selected, submit
  // bypasses routing and queues directly at that level.
  const [routingPending, setRoutingPending] = useState(false);

  // Scoping state
  const [scopingState, setScopingState] = useState<ScopingState>({ phase: "idle" });
  const [levelOverride, setLevelOverride] = useState<TaskLevel>("task");
  const [showLevelOverride, setShowLevelOverride] = useState(false);
  const [confirmationBadge, setConfirmationBadge] = useState<string | null>(null);


  // Attachments state
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // GSD conflict state
  const [gsdStatus, setGsdStatus] = useState<GsdStatus | null>(null);

  const createTask = useTaskStore((s) => s.createTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const [quickStarting, setQuickStarting] = useState<string | null>(null);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");

  // @-tag prompt snippets
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const [promptTags, setPromptTags] = useState<TagItem[]>([]);

  const descRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // Fetch prompt tags on mount
  useEffect(() => {
    fetch("/api/prompt-tags")
      .then((r) => r.json())
      .then((data) => setPromptTags((data.tags ?? []).map((t: { name: string; body: string; category?: string; description?: string }) => ({ name: t.name, body: t.body, category: t.category, description: t.description }))))
      .catch(() => {});
  }, []);

  // Auto-grow textarea
  const adjustTextareaHeight = useCallback(() => {
    const el = descRef.current;
    if (!el) return;
    el.style.height = "44px";
    const scrollH = el.scrollHeight;
    el.style.height = Math.min(Math.max(scrollH, 44), 160) + "px";
  }, []);

  // Collapse when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        formRef.current &&
        !formRef.current.contains(e.target as Node) &&
        !description.trim() &&
        attachments.length === 0 &&
        scopingState.phase === "idle"
      ) {
        setIsExpanded(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [description, attachments.length, scopingState.phase]);

  // External pick-seed trigger: open the inline picker with the given description.
  const pickSeedNonce = pickSeed?.nonce;
  useEffect(() => {
    if (!pickSeed || !pickSeed.description) return;
    setScopingState({ phase: "picking", description: pickSeed.description });
    setIsExpanded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickSeedNonce]);

  // Clear confirmation badge after 3s
  useEffect(() => {
    if (!confirmationBadge) return;
    const timer = setTimeout(() => setConfirmationBadge(null), 3000);
    return () => clearTimeout(timer);
  }, [confirmationBadge]);

  const handleFileUpload = useCallback(async (file: File) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("dir", "projects");

      const res = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }

      const result: Attachment = await res.json();
      setAttachments((prev) => [...prev, result]);
      setIsExpanded(true);
    } catch {
      // Silently fail — user can retry
    } finally {
      setIsUploading(false);
    }
  }, []);

  const removeAttachment = useCallback((relativePath: string) => {
    setAttachments((prev) => prev.filter((a) => a.relativePath !== relativePath));
  }, []);

  /** Create the task (and project if needed) with the determined level */
  const createWithLevel = useCallback(async (
    fullDescription: string,
    level: TaskLevel,
  ) => {
    // Quick fallback title from first line
    const firstLine = fullDescription.split("\n")[0];
    const firstSentence = firstLine.match(/^[^.!?]+[.!?]?/)?.[0] || firstLine;
    const fallbackTitle = firstSentence.length <= 60
      ? firstSentence
      : firstSentence.slice(0, 57).replace(/\s+\S*$/, "") + "...";

    // For project/gsd levels, create a project row
    let taskProjectSlug = projectSlug || null;
    if ((level === "project" || level === "gsd") && !taskProjectSlug) {
      const slug = fallbackTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40);
      taskProjectSlug = slug;

      // Check for GSD conflicts
      if (level === "gsd") {
        try {
          const gsdRes = await fetch("/api/gsd/status");
          const gsdData = await gsdRes.json();
          if (gsdData?.exists) {
            setGsdStatus(gsdData);
            return; // Block — show conflict
          }
        } catch { /* proceed */ }
      }

      // Create project brief (projects/briefs/{slug}/brief.md)
      try {
        await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug,
            name: fallbackTitle,
            level: level === "gsd" ? 3 : 2,
            goal: fullDescription.slice(0, 200),
          }),
        });
      } catch { /* non-critical */ }
    }

    // Plan-first only applies to single tasks — projects and GSD have their
    // own planning built in, so we ignore the toggle for them.
    const effectivePermissionMode: PermissionMode =
      level === "task" && planFirst ? "plan" : FIXED_PERMISSION_MODE;

    // Create task as "queued" — goes straight to Claude's Turn
    await createTask(fallbackTitle, fullDescription, level, taskProjectSlug, undefined, effectivePermissionMode);

    // Remember last routing decision for next time
    try { localStorage.setItem("cc.last-route", level); } catch { /* ignore */ }

    // Plan-first is per-launch — reset so the next task defaults to full-auto
    setPlanFirst(false);
  }, [createTask, planFirst, projectSlug]);

  /** Handle level selection from the modal */
  const handleLevelSelect = useCallback(async (level: TaskLevel) => {
    if (scopingState.phase !== "picking") return;
    const desc = scopingState.description;

    setScopingState({ phase: "idle" });
    setIsExpanded(false);
    setConfirmationBadge(`Queued — ${LEVEL_LABELS[level]}`);
    setIsSubmitting(true);
    await createWithLevel(desc, level);
    setIsSubmitting(false);
  }, [scopingState, createWithLevel]);

  // Keyboard shortcuts for level picker modal
  useEffect(() => {
    if (scopingState.phase !== "picking") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "1") handleLevelSelect("task");
      else if (e.key === "2") handleLevelSelect("project");
      else if (e.key === "3") handleLevelSelect("gsd");
      else if (e.key === "Escape") {
        setScopingState({ phase: "idle" });
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [scopingState.phase, handleLevelSelect]);

  const handleSubmit = useCallback(async () => {
    const trimmedDesc = description.trim();
    if (!trimmedDesc || isSubmitting || routingPending) return;
    setGsdStatus(null);

    // Build description with attachment paths
    let fullDescription = trimmedDesc;
    if (attachments.length > 0) {
      const attachmentLines = attachments.map((a) => `- ${a.relativePath}`).join("\n");
      const attachmentBlock = `\n\nAttached files:\n${attachmentLines}`;
      fullDescription = fullDescription + attachmentBlock;
    }

    // Task — fast path, no scoping needed
    if (levelOverride === "task") {
      setDescription("");
      setAttachments([]);
      setIsExpanded(false);
      setLevelOverride("task");
      setShowLevelOverride(false);
      setConfirmationBadge(`Queued — ${LEVEL_LABELS.task}`);
      setIsSubmitting(true);
      await createWithLevel(fullDescription, "task");
      setIsSubmitting(false);
      return;
    }

    // Project / GSD — call scope-goal for the wizard / guardrail
    setRoutingPending(true);
    try {
      const currentClientId = useClientStore.getState().selectedClientId;
      const res = await fetch("/api/tasks/scope-goal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: fullDescription, clientId: currentClientId ?? null }),
      });
      if (!res.ok) throw new Error(`scope-goal failed: ${res.status}`);
      const scopeResult = (await res.json()) as ScopeResult;
      // Honour the user's explicit level pick
      scopeResult.level = levelOverride;
      setLevelOverride("task");
      setShowLevelOverride(false);
      onRoutingDecision?.(scopeResult, fullDescription);
      setDescription("");
      setAttachments([]);
      setIsExpanded(false);
    } catch (err) {
      console.error("[TaskCreateInput] scope-goal failed, using fallback", err);
      const fallback = synthesizeFallbackScope(levelOverride as "project" | "gsd");
      setLevelOverride("task");
      setShowLevelOverride(false);
      onRoutingDecision?.(fallback, fullDescription);
      setDescription("");
      setAttachments([]);
      setIsExpanded(false);
    } finally {
      setRoutingPending(false);
    }
  }, [description, attachments, isSubmitting, routingPending, levelOverride, createWithLevel, onRoutingDecision]);

  const handleQuickStart = useCallback(async (type: "start-here" | "wrap-up") => {
    if (quickStarting) return;
    setQuickStarting(type);
    try {
      const taskTitle = type === "start-here" ? "Start Here" : "Wrap Up";
      const taskDesc = type === "start-here" ? "Run /start-here" : "Run /wrap-up";
      const permMode = type === "start-here" ? "bypassPermissions" : undefined;
      await createTask(taskTitle, taskDesc, "task", null, null, permMode);
      const tasks = useTaskStore.getState().tasks;
      const newTask = tasks.find(
        (t) => t.title === taskTitle && t.status === "backlog"
      );
      if (newTask) {
        await updateTask(newTask.id, { status: "queued" });
      }
    } finally {
      setQuickStarting(null);
    }
  }, [quickStarting, createTask, updateTask]);

  const handleSlashSelect = useCallback(async (cmd: SlashCommand) => {
    setShowSlashMenu(false);
    setSlashQuery("");
    setDescription("");
    setIsExpanded(false);

    const taskTitle = cmd.label;
    const taskDesc = `Run ${cmd.command}`;
    await createTask(taskTitle, taskDesc, "task");
    const tasks = useTaskStore.getState().tasks;
    const newTask = tasks.find(
      (t) => t.title === taskTitle && t.status === "backlog"
    );
    if (newTask) {
      await updateTask(newTask.id, { status: "queued" });
    }
  }, [createTask, updateTask]);

  const handleDescChange = useCallback((value: string) => {
    setDescription(value);
    if (value.startsWith("/")) {
      setShowSlashMenu(true);
      setSlashQuery(value);
      setShowTagMenu(false);
    } else {
      setShowSlashMenu(false);
      setSlashQuery("");
    }
    // Detect @tag trigger — look for @ followed by partial word at cursor position
    const el = descRef.current;
    if (el) {
      const cursor = el.selectionStart ?? value.length;
      const before = value.slice(0, cursor);
      const match = before.match(/(^|[\s])@([\w\/-]*)$/);
      if (match && !value.startsWith("/")) {
        setShowTagMenu(true);
        setTagQuery(match[2]);
        setShowSlashMenu(false);
      } else {
        setShowTagMenu(false);
        setTagQuery("");
      }
    }
  }, []);

  const shouldExpand = isExpanded || description.trim().length > 0 || attachments.length > 0;
  const hasGsdConflict = gsdStatus?.exists === true && scopingState.phase === "idle";

  return (
    <div
      ref={formRef}
      style={{
        marginBottom: 16,
        backgroundColor: "var(--card)",
        borderRadius: shouldExpand ? "0.5rem" : "0.375rem",
        boxShadow: shouldExpand ? "0px 12px 32px color-mix(in srgb, var(--foreground) 6%, transparent)" : "none",
        padding: shouldExpand ? 16 : 0,
        outline: shouldExpand ? "none" : "1px solid var(--border)",
        transition: "all 200ms ease",
      }}
    >
      {/* Confirmation badge */}
      {confirmationBadge && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          marginBottom: 8,
          backgroundColor: "color-mix(in srgb, var(--foreground) 8%, transparent)",
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 500,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          color: "var(--muted-foreground)",
          animation: "fadeIn 200ms ease",
        }}>
          {confirmationBadge}
        </div>
      )}

      {/* Single textarea input + slash command menu */}
      <div style={{ position: "relative" }}>
        <textarea
          ref={descRef}
          value={description}
          onChange={(e) => {
            handleDescChange(e.target.value);
            adjustTextareaHeight();
          }}
          onFocus={() => setIsExpanded(true)}
          onKeyDown={(e) => {
            if (showSlashMenu && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) return;
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
          disabled={isSubmitting}
          placeholder="What's your goal?  Type / for commands"
          style={{
            width: "100%",
            padding: shouldExpand ? "0" : "8px 16px",
            fontSize: 15,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontWeight: 400,
            backgroundColor: "transparent",
            border: "none",
            borderRadius: 6,
            outline: "none",
            color: "var(--foreground)",
            minHeight: shouldExpand ? 44 : 40,
            maxHeight: shouldExpand ? 160 : 40,
            resize: "none",
            lineHeight: "1.5",
            opacity: isSubmitting ? 0.6 : 1,
            transition: "all 150ms ease",
            boxSizing: "border-box" as const,
            overflow: shouldExpand ? "auto" : "hidden",
          }}
        />
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
              // Replace the @partial with @tag-name in the textarea
              const el = descRef.current;
              if (el) {
                const cursor = el.selectionStart ?? description.length;
                const before = description.slice(0, cursor);
                const after = description.slice(cursor);
                const replaced = before.replace(/(^|[\s])@[\w\/-]*$/, `$1@${tag.name} `);
                setDescription(replaced + after);
              } else {
                setDescription((prev) => prev + `@${tag.name} `);
              }
              recordTagUsage(tag.name);
              setShowTagMenu(false);
              setTagQuery("");
              descRef.current?.focus();
            }}
          />
        )}
      </div>

      {/* Quick-start buttons — visible when collapsed */}
      {!shouldExpand && (
        <div style={{ display: "flex", gap: 8, padding: "8px 16px 12px" }}>
          <button
            onClick={() => handleQuickStart("start-here")}
            disabled={quickStarting !== null}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 12px",
              fontSize: 12,
              fontWeight: 500,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              border: "1px solid color-mix(in srgb, var(--foreground) 30%, transparent)",
              borderRadius: 6,
              backgroundColor: "transparent",
              color: "var(--primary)",
              cursor: quickStarting ? "not-allowed" : "pointer",
              opacity: quickStarting === "wrap-up" ? 0.5 : 1,
              transition: "all 150ms ease",
            }}
            onMouseEnter={(e) => { if (!quickStarting) e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 6%, transparent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            <Sunrise size={13} />
            {quickStarting === "start-here" ? "Starting..." : "Start Here"}
          </button>
          <button
            onClick={() => handleQuickStart("wrap-up")}
            disabled={quickStarting !== null}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 12px",
              fontSize: 12,
              fontWeight: 500,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              border: "1px solid color-mix(in srgb, var(--foreground) 30%, transparent)",
              borderRadius: 6,
              backgroundColor: "transparent",
              color: "var(--muted-foreground)",
              cursor: quickStarting ? "not-allowed" : "pointer",
              opacity: quickStarting === "start-here" ? 0.5 : 1,
              transition: "all 150ms ease",
            }}
            onMouseEnter={(e) => { if (!quickStarting) e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 6%, transparent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            <Moon size={13} />
            {quickStarting === "wrap-up" ? "Wrapping up..." : "Wrap Up"}
          </button>
        </div>
      )}

      {/* Goal chips — prompt tag shortcuts below the textarea */}
      {shouldExpand && (
        <GoalChips onInsert={(text) => {
          setDescription((prev) => text + prev);
          setTimeout(() => {
            descRef.current?.focus();
            adjustTextareaHeight();
          }, 0);
        }} />
      )}

      {/* Expandable bottom section */}
      <div
        style={{
          maxHeight: shouldExpand ? 800 : 0,
          overflow: shouldExpand ? "visible" : "hidden",
          transition: "max-height 200ms ease",
        }}
      >
        {/* Attachments */}
        <input
          ref={fileInputRef}
          type="file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileUpload(file);
            e.target.value = "";
          }}
          style={{ display: "none" }}
          accept={CHAT_ATTACHMENT_ACCEPT_ATTR}
        />

        {attachments.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginTop: 8,
              padding: "8px 0",
              borderTop: "1px solid var(--border)",
            }}
          >
            {attachments.map((att) => {
              const Icon = getAttachmentIcon(att.extension);
              const isImage = IMAGE_EXTS.has(att.extension);
              return (
                <div
                  key={att.relativePath}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 8px",
                    borderRadius: 6,
                    backgroundColor: "var(--muted)",
                    fontSize: 12,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    color: "var(--foreground)",
                  }}
                >
                  {isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/files/preview?path=${encodeURIComponent(att.relativePath)}`}
                      alt=""
                      style={{ width: 20, height: 20, borderRadius: 3, objectFit: "cover" }}
                    />
                  ) : (
                    <Icon size={14} style={{ color: "var(--muted-foreground)" }} />
                  )}
                  <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {att.fileName}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
                    {formatBytes(att.sizeBytes)}
                  </span>
                  <button
                    onClick={() => removeAttachment(att.relativePath)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      display: "flex",
                      color: "var(--muted-foreground)",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "var(--destructive)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--muted-foreground)"; }}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* GSD conflict warning */}
        {hasGsdConflict && (
          <div style={conflictPanelStyle}>
            <div style={{ ...guidanceHeaderStyle, justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <AlertTriangle size={14} color="var(--muted-foreground)" />
                <span style={{ ...guidanceTitleStyle, color: "var(--muted-foreground)" }}>Active deep build detected</span>
              </div>
              <button
                onClick={() => setGsdStatus(null)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 4,
                  color: "var(--muted-foreground)",
                  display: "flex",
                }}
              >
                <X size={14} />
              </button>
            </div>
            <p style={conflictTextStyle}>
              <strong>{gsdStatus?.projectName}</strong> is currently in progress
              {gsdStatus?.currentPhase && gsdStatus?.totalPhases
                ? ` (phase ${gsdStatus.currentPhase} of ${gsdStatus.totalPhases})`
                : ""
              }.
              Only one deep build can run at a time.
            </p>
            <p style={{ ...conflictTextStyle, marginTop: 8 }}>
              To start a new deep build, first archive the current one. You can do this by asking Claude to run <code style={codeStyle}>/archive-gsd</code>, or complete the remaining phases.
            </p>
          </div>
        )}

        {/* Bottom bar: permission mode + level override + submit button */}
        <div style={{ marginTop: 8 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            {/* Left: yolo badge + attach + level override */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* YOLO mode indicator — permissions picker removed; tasks always run with --dangerously-skip-permissions */}
              <div
                title="All tasks run in yolo mode — permissions are skipped"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  height: 28,
                  padding: "0 8px",
                  borderRadius: 6,
                  backgroundColor: "var(--muted)",
                  color: "var(--destructive)",
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                <Zap size={11} />
                Yolo
              </div>

              {/* Attach file button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                title="Attach file"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                  border: "none",
                  borderRadius: 6,
                  backgroundColor: attachments.length > 0 ? "var(--muted)" : "transparent",
                  color: attachments.length > 0 ? "var(--primary)" : "var(--muted-foreground)",
                  cursor: isUploading ? "wait" : "pointer",
                  opacity: isUploading ? 0.5 : 1,
                  transition: "all 150ms ease",
                  position: "relative",
                }}
                onMouseEnter={(e) => {
                  if (!attachments.length) e.currentTarget.style.backgroundColor = "var(--muted)";
                }}
                onMouseLeave={(e) => {
                  if (!attachments.length) e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <Paperclip size={16} />
                {attachments.length > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: -2,
                      right: -2,
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      backgroundColor: "var(--primary)",
                      color: "var(--card)",
                      fontSize: 9,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                    }}
                  >
                    {attachments.length}
                  </span>
                )}
              </button>

              {/* Level dropdown */}
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setShowLevelOverride(!showLevelOverride)}
                  title="Task level"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "4px 8px",
                    fontSize: 11,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    border: "none",
                    borderRadius: 4,
                    backgroundColor: "var(--muted)",
                    color: "var(--foreground)",
                    cursor: "pointer",
                    fontWeight: 500,
                    height: 28,
                  }}
                >
                  {LEVEL_LABELS[levelOverride]}
                  <ChevronDown size={10} />
                </button>
                {showLevelOverride && (
                  <div style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    marginTop: 4,
                    backgroundColor: "var(--card)",
                    borderRadius: 8,
                    boxShadow: "0 4px 16px color-mix(in srgb, var(--foreground) 12%, transparent)",
                    border: "1px solid var(--border)",
                    padding: 8,
                    zIndex: 100,
                    width: 280,
                  }}>
                    {(["task", "project", "gsd"] as TaskLevel[]).map((level) => (
                      <button
                        key={level}
                        onClick={async () => {
                          setLevelOverride(level);
                          setShowLevelOverride(false);
                          if (level === "gsd") {
                            try {
                              const res = await fetch("/api/gsd/status");
                              const data = await res.json();
                              if (data?.exists) setGsdStatus(data);
                            } catch { /* ignore */ }
                          } else {
                            setGsdStatus(null);
                          }
                        }}
                        style={{
                          display: "block",
                          width: "100%",
                          padding: "8px 12px",
                          fontSize: 12,
                          fontFamily: "var(--font-inter), Inter, sans-serif",
                          border: "none",
                          borderRadius: 5,
                          backgroundColor: levelOverride === level ? "var(--muted)" : "transparent",
                          color: "var(--foreground)",
                          cursor: "pointer",
                          textAlign: "left",
                          fontWeight: 500,
                        }}
                      >
                        <div>{LEVEL_LABELS[level]}</div>
                        <div style={{
                          fontSize: 10,
                          fontWeight: 400,
                          color: "var(--muted-foreground)",
                          fontFamily: "var(--font-inter), Inter, sans-serif",
                          marginTop: 0,
                        }}>
                          {LEVEL_HINTS[level]}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Plan-first checkbox — only applies to single tasks.
                  Projects and GSD projects have their own planning built in.
                  Sits in the left cluster so it's left-aligned. */}
              {levelOverride === "task" && (
                <label
                  title="Have Claude draft a plan before executing (single tasks only)"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "0 8px",
                    height: 28,
                    fontSize: 11,
                    fontWeight: 500,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    color: planFirst ? "var(--primary)" : "var(--muted-foreground)",
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={planFirst}
                    onChange={(e) => setPlanFirst(e.target.checked)}
                    style={{
                      width: 13,
                      height: 13,
                      accentColor: "var(--primary)",
                      cursor: "pointer",
                      margin: 0,
                    }}
                  />
                  Start with planning mode
                </label>
              )}
            </div>

            {/* Submit button */}
            <button
              onClick={handleSubmit}
              disabled={!description.trim() || isSubmitting || routingPending}
              style={{
                background: description.trim()
                  ? "linear-gradient(135deg, var(--primary), var(--primary))"
                  : "var(--border)",
                color: "var(--card)",
                border: "none",
                borderRadius: "0.375rem",
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                cursor: description.trim() && !routingPending ? "pointer" : "default",
                opacity: isSubmitting || routingPending ? 0.6 : 1,
                transition: "all 150ms ease",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {routingPending && (
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    border: "2px solid color-mix(in srgb, var(--foreground) 40%, transparent)",
                    borderTopColor: "var(--card)",
                    animation: "spin 800ms linear infinite",
                    display: "inline-block",
                  }}
                />
              )}
              {routingPending ? "Routing…" : "Send to Claude"}
            </button>
          </div>

        </div>
      </div>

      {/* Level picker modal */}
      {scopingState.phase === "picking" && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "color-mix(in srgb, var(--foreground) 40%, transparent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => {
            setScopingState({ phase: "idle" });
          }}
        >
          <div
            style={{
              backgroundColor: "var(--card)",
              borderRadius: 12,
              padding: 24,
              maxWidth: 420,
              width: "90%",
              boxShadow: "0 20px 60px color-mix(in srgb, var(--foreground) 15%, transparent)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                fontSize: 16,
                fontWeight: 700,
                fontFamily: "var(--font-inter)",
                color: "var(--foreground)",
                marginBottom: 16,
                marginTop: 0,
              }}
            >
              How structured do you want this?
            </h3>

            {/* Goal preview */}
            <div
              style={{
                fontSize: 12,
                color: "var(--muted-foreground)",
                fontFamily: "var(--font-inter)",
                padding: "8px 12px",
                backgroundColor: "color-mix(in srgb, var(--foreground) 8%, transparent)",
                borderRadius: 6,
                marginBottom: 16,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {scopingState.description.slice(0, 100)}
              {scopingState.description.length > 100 ? "..." : ""}
            </div>

            {/* Three level options */}
            {([
              {
                level: "task" as TaskLevel,
                icon: Zap,
                title: "Task",
                desc: "I'll just get it done. Best for one-off deliverables.",
                key: "1",
              },
              {
                level: "project" as TaskLevel,
                icon: ClipboardList,
                title: "Planned project",
                desc: "I'll scope it first — goal, deliverables, what 'done' looks like. Best for multi-deliverable work.",
                key: "2",
              },
              {
                level: "gsd" as TaskLevel,
                icon: Layers,
                title: "GSD project",
                desc: "Full structured planning with phases, milestones, and verification. Best for complex builds.",
                key: "3",
              },
            ]).map((opt) => (
              <div key={opt.level}>
                <button
                  onClick={() => handleLevelSelect(opt.level)}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    width: "100%",
                    padding: "12px 16px",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    marginBottom: 8,
                    backgroundColor: "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 100ms ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 4%, transparent)";
                    e.currentTarget.style.borderColor = "color-mix(in srgb, var(--foreground) 30%, transparent)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                >
                  <opt.icon size={18} color="var(--primary)" style={{ flexShrink: 0, marginTop: 0 }} />
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        fontFamily: "var(--font-inter)",
                        color: "var(--foreground)",
                      }}
                    >
                      {opt.title}
                      <span style={{ fontSize: 10, color: "var(--border)", marginLeft: 8 }}>
                        ({opt.key})
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--muted-foreground)",
                        fontFamily: "var(--font-inter)",
                        marginTop: 4,
                        lineHeight: "1.4",
                      }}
                    >
                      {opt.desc}
                    </div>
                  </div>
                </button>
              </div>
            ))}

            <button
              onClick={() => {
                setScopingState({ phase: "idle" });
              }}
              style={{
                fontSize: 12,
                color: "var(--muted-foreground)",
                fontFamily: "var(--font-inter)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "8px 0 0",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Styles ──

const conflictPanelStyle: React.CSSProperties = {
  marginTop: 12,
  padding: "12px 16px",
  backgroundColor: "var(--card)",
  borderRadius: 8,
  border: "1px solid var(--border)",
};

const guidanceHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 12,
};

const guidanceTitleStyle: React.CSSProperties = {
  fontFamily: "var(--font-inter), Inter, sans-serif",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--primary)",
};

const conflictTextStyle: React.CSSProperties = {
  fontFamily: "var(--font-inter), Inter, sans-serif",
  fontSize: 12,
  color: "var(--muted-foreground)",
  lineHeight: 1.5,
  margin: 0,
};

const codeStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: 11,
  backgroundColor: "color-mix(in srgb, var(--foreground) 10%, transparent)",
  padding: "0px 4px",
  borderRadius: 3,
};

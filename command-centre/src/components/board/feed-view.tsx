"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, CheckCircle2, Paperclip, Download, Eye, ExternalLink, FileText, Play, ArrowLeft, Maximize2, Minimize2, Plus, Pencil, Terminal, Copy, PanelRight, PanelRightClose, Pin } from "lucide-react";
import { useTaskStore } from "@/store/task-store";
import type { Task, LogEntry, TaskLevel, PermissionMode, ClaudeModel, ClaudeThinkingEffort, Todo } from "@/types/task";
import { getPendingTaskQuestionPreview } from "@/lib/task-logs";
import { PermissionPicker } from "@/components/shared/permission-picker";
import { ModelPicker } from "@/components/shared/model-picker";
import { ThinkingEffortPicker } from "@/components/shared/thinking-effort-picker";
import { TasksPopover } from "@/components/shared/tasks-popover";
import { PastedTextCard } from "@/components/shared/pasted-text-card";
import {
  DraftPlanPreviewModal,
  DraftPlanPreviewPanel,
} from "@/components/shared/draft-plan-preview";
import { parseTodosFromInput } from "@/lib/claude-parser";
import { NewGoalPanel } from "./new-goal-panel";
import { GoalDraftCard } from "./goal-draft-card";
import { LevelBadge } from "./level-badge";
import { RoutingDecisionCard } from "./routing-decision-card";
import { ClientFilterBar } from "./client-filter-bar";
import { KanbanBoard, type SwimLane, type DoneFilter } from "./kanban-board";
import { ScopingWizardInline } from "../modal/scoping-wizard-panel";
import { GsdGuardrailModal } from "../modal/gsd-guardrail-modal";
import type { ScopeResult } from "@/app/api/tasks/scope-goal/route";
import { useClientStore } from "@/store/client-store";
import type { Client } from "@/types/client";
import { useCronStore } from "@/store/cron-store";
import type { CronJob } from "@/types/cron";
import { ModalChat } from "@/components/modal/modal-chat";
import { ReplyInput, HighlightMirror } from "@/components/modal/reply-input";
import { PhaseProgressStrip } from "@/components/modal/phase-progress-strip";
import { ChatList } from "@/components/modal/chat-list";
import { PaneContainer } from "@/components/modal/pane-container";
import { usePaneState, MAIN_PANE_ID, type PaneItem } from "@/hooks/use-pane-state";
import { SlashCommandMenu, type TagItem } from "@/components/shared/slash-command-menu";
import type { SlashCommand } from "@/lib/slash-commands";
import { TagPicker, TagPill, TagFilterBar } from "@/components/shared/tag-picker";
import { appendClientId } from "@/hooks/use-client-id";
import {
  getExecutionPermissionMode,
  getPermissionStateForPickerChange,
  getPickerPermissionMode,
  normalizePermissionMode,
} from "@/lib/permission-mode";
import { loadGoalDrafts, removeGoalDraft, saveGoalDraft } from "@/lib/goal-drafts";
import { normalizeClaudeThinkingEffortForModel } from "@/lib/claude-options";
import { saveClaudeLlmPreference } from "@/lib/llm-preferences";
import {
  clearActiveGoalDraftPanel,
  createGoalDraftPanelState,
  openBlankGoalDraftPanel,
  openSavedGoalDraftPanel,
  saveDraftInOpenGoalPanel,
} from "@/lib/goal-draft-panel-state";
import {
  extractPendingApprovedBriefFromLogs,
} from "@/lib/plan-brief";
import { syncComposerTextareaHeight } from "@/lib/composer";
import {
  appendPendingPastedText,
  insertPastedTextAtSelection,
  removePendingPastedText,
  shouldCapturePastedText,
} from "@/lib/pasted-text";
import { useComposerResize } from "@/hooks/use-composer-resize";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CHAT_ATTACHMENT_ACCEPT_ATTR } from "@/lib/chat-attachment-policy";
import type { GoalDraftPayload } from "@/types/goal-draft";

const mdComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <p style={{ margin: "6px 0" }}>{children}</p>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} style={{ color: "var(--primary)", textDecoration: "underline" }} target="_blank" rel="noopener noreferrer">{children}</a>
  ),
  code: ({ children, className: cn }: { children?: React.ReactNode; className?: string }) => cn
    ? <code style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 12 }}>{children}</code>
    : <code style={{ backgroundColor: "color-mix(in srgb, var(--foreground) 6%, transparent)", padding: "0 4px", borderRadius: 3, fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 12 }}>{children}</code>,
  pre: ({ children }: { children?: React.ReactNode }) => <pre style={{ backgroundColor: "color-mix(in srgb, var(--foreground) 4%, transparent)", padding: 12, borderRadius: 6, overflow: "auto", margin: "8px 0", fontSize: 12 }}>{children}</pre>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul style={{ paddingLeft: 20, margin: "4px 0" }}>{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol style={{ paddingLeft: 20, margin: "4px 0" }}>{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li style={{ margin: "2px 0" }}>{children}</li>,
  h1: ({ children }: { children?: React.ReactNode }) => <h1 style={{ fontSize: 16, fontWeight: 700, margin: "12px 0 6px" }}>{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 style={{ fontSize: 14, fontWeight: 700, margin: "10px 0 4px" }}>{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 style={{ fontSize: 13, fontWeight: 600, margin: "8px 0 4px" }}>{children}</h3>,
  blockquote: ({ children }: { children?: React.ReactNode }) => <blockquote style={{ borderLeft: "3px solid var(--primary)", paddingLeft: 12, margin: "6px 0", color: "var(--muted-foreground)", fontStyle: "italic" }}>{children}</blockquote>,
  table: ({ children }: { children?: React.ReactNode }) => <table style={{ width: "100%", borderCollapse: "collapse", margin: "8px 0", fontSize: 12 }}>{children}</table>,
  th: ({ children }: { children?: React.ReactNode }) => <th style={{ padding: "4px 8px", textAlign: "left" as const, fontWeight: 600, borderBottom: "1px solid color-mix(in srgb, var(--foreground) 10%, transparent)" }}>{children}</th>,
  td: ({ children }: { children?: React.ReactNode }) => <td style={{ padding: "4px 8px", borderBottom: "1px solid color-mix(in srgb, var(--foreground) 5%, transparent)" }}>{children}</td>,
  hr: () => <hr style={{ border: "none", borderTop: "1px solid color-mix(in srgb, var(--foreground) 30%, transparent)", margin: "12px 0" }} />,
};

// ── Paste chip type ─────────────────────────────────────────────

interface PastedChip {
  id: string;
  kind: "text" | "image";
  label: string;          // e.g. "47 lines" or "screenshot.png"
  content: string;        // full text or base64 data URI
}

function buildImagePasteLabel(name: string): string {
  return name || "screenshot.png";
}

// ── Helpers ──────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const ts = new Date(dateStr).getTime();
  if (isNaN(ts)) return "--";
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatElapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return `${min}m ${rem.toString().padStart(2, "0")}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function taskNeedsInput(t: Task): boolean {
  return t.needsInput
    || !!t.errorMessage
    || t.status === "review"
    || (t.status === "running" && !!t.activityLabel?.trimEnd().endsWith("?"));
}

// For project/gsd parents, a child awaiting input should make the parent
// surface as "your turn" too. For regular tasks, this is identical to
// taskNeedsInput.
function effectiveNeedsInput(t: Task, allTasks: Task[]): boolean {
  if (taskNeedsInput(t)) return true;
  if (t.level !== "project" && t.level !== "gsd") return false;
  const children = allTasks.filter(
    (c) => c.parentId === t.id || (t.projectSlug && c.projectSlug === t.projectSlug && c.id !== t.id)
  );
  return children.some(taskNeedsInput);
}

function isAchieved(t: Task): boolean {
  return t.status === "done" && !taskNeedsInput(t);
}

function isTerminalTask(t: Task): boolean {
  return !!(t.description && /^Working directory:\s/m.test(t.description));
}

// ── GoalCard (terminal style with nested subtask rows) ──────────

const MONO = "var(--font-inter), Inter, sans-serif";

// Terminal-lines palette — light cream, mono typography, dashed rules.
// Looks like a terminal readout rendered into the cream page, not a dark
// terminal window.
const T = {
  bg: "var(--card)",
  bgNeeds: "var(--card)",
  bgDone: "var(--muted)",
  border: "var(--border)",
  borderDashed: "color-mix(in srgb, var(--foreground) 60%, transparent)",
  borderSelected: "color-mix(in srgb, var(--foreground) 25%, transparent)",
  borderNeeds: "color-mix(in srgb, var(--foreground) 40%, transparent)",
  text: "var(--foreground)",
  textDim: "var(--muted-foreground)",
  textMuted: "var(--muted-foreground)",
  accent: "var(--muted-foreground)",
  accentRun: "var(--muted-foreground)",
  green: "var(--muted-foreground)",
};

/** Inline-editable title — double-click to rename */
function InlineTitle({ title, taskId, color }: { title: string; taskId: string; color: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [hover, setHover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const updateTask = useTaskStore((s) => s.updateTask);

  useEffect(() => { setValue(title); }, [title]);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== title) updateTask(taskId, { title: trimmed });
    else setValue(title);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setValue(title); setEditing(false); } }}
        onClick={(e) => e.stopPropagation()}
        style={{
          fontSize: 14, fontWeight: 600, fontFamily: "var(--font-inter), Inter, sans-serif",
          color, flex: 1, minWidth: 0, border: "none", outline: "none",
          background: "color-mix(in srgb, var(--foreground) 3%, transparent)",
          borderBottom: "1.5px solid color-mix(in srgb, var(--foreground) 40%, transparent)",
          borderRadius: 0, padding: "1px 2px", margin: "-1px -2px",
        }}
      />
    );
  }

  return (
    <span
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        fontSize: 14, fontWeight: 600, fontFamily: "var(--font-inter), Inter, sans-serif",
        color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0,
        cursor: "text",
        borderBottom: "1px solid transparent",
        padding: "1px 2px", margin: "-1px -2px",
        borderRadius: 0,
      }}
    >
      {title}
    </span>
  );
}

function GoalCard({
  task,
  allTasks,
  clients,
  isSelected,
  dimmed,
  onSelect,
  onDragStart,
  onDragEnd,
  onDragOverCard,
  onDropOnCard,
  onMarkDone,
  dropIndicator,
  isDragging,
  unseen,
}: {
  task: Task;
  allTasks: Task[];
  clients: Client[];
  isSelected: boolean;
  dimmed?: boolean;
  onSelect: (id: string) => void;
  onDragStart: (id: string, e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onDragOverCard?: (id: string, position: "before" | "after", e: React.DragEvent) => void;
  onDropOnCard?: (id: string, e: React.DragEvent) => void;
  onMarkDone?: (id: string) => void;
  /** When set, renders a blue line above/below the card to show the drop slot */
  dropIndicator?: "before" | "after" | null;
  /** True when this specific card is being dragged (dim it) */
  isDragging?: boolean;
  /** True when task needs input but hasn't been opened yet */
  unseen?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const [, setTagPickerOpen] = useState(false);
  const updateTask = useTaskStore((s) => s.updateTask);
  const isPinned = !!task.pinnedAt;
  const isProjectParent = task.level === "project" || task.level === "gsd";
  const client = task.clientId ? clients.find((c) => c.slug === task.clientId) : null;

  const children = allTasks.filter((t) => t.parentId === task.id);
  const hasChildren = children.length > 0;
  // Chat conversations = children that were user-initiated chats, NOT GSD
  // execution steps (which have phaseNumber/gsdStep set). Only count tasks
  // that actually ran (startedAt set) and are real chat windows.
  const conversations = children.filter((t) => t.startedAt && !t.gsdStep && t.phaseNumber == null);
  const childDone = conversations.filter((t) => t.status === "done").length;
  const childNeeds = isProjectParent && children.some(taskNeedsInput);
  const childRunning = isProjectParent && children.some((c) => c.status === "running");

  // A parent is only "running" if at least one child is actively working (not waiting for input)
  const runningChildren = children.filter((c) => c.status === "running");
  const activeRunningChildren = runningChildren.filter((c) => !taskNeedsInput(c));
  const allRunningChildrenNeedInput = runningChildren.length > 0
    && runningChildren.every(taskNeedsInput);
  const parentSelfRunning = task.status === "running" && !taskNeedsInput(task);
  const needs = taskNeedsInput(task) || childNeeds || allRunningChildrenNeedInput;
  // For parents: show running when ANY child is actively working, even if others need input.
  // For single tasks: only show running when the task itself is active (not needing input).
  const isRunning = isProjectParent
    ? activeRunningChildren.length > 0
    : parentSelfRunning;
  const isDone = isAchieved(task);

  // Conversation status counts — the main chat (parent task) is always
  // conversation #1. Additional child chat windows (non-GSD) are also counted.
  const mainNeedsReview = taskNeedsInput(task) && task.status !== "done";
  const mainIsActive = task.status === "running" && !taskNeedsInput(task);
  const mainIsDone = task.status === "done";
  const childReviewCount = conversations.filter((c) => c.status !== "done" && taskNeedsInput(c)).length + (mainNeedsReview ? 1 : 0);
  const childActiveCount = conversations.filter((c) => c.status === "running" && !taskNeedsInput(c)).length + (mainIsActive ? 1 : 0);
  const childDoneWithMain = childDone + (mainIsDone ? 1 : 0);
  const totalConversations = conversations.length + 1; // +1 for main chat

  const [elapsed, setElapsed] = useState("");
  useEffect(() => {
    if (!isRunning || !task.startedAt) return;
    const tick = () => setElapsed(formatElapsed(task.startedAt!));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [isRunning, task.startedAt]);

  // Brief snippet: prefer description, fall back to activity label
  const briefSnippet = (task.description || "")
    .replace(/^Working directory:.*$/m, "")
    .trim()
    .split("\n")
    .find((l) => l.trim().length > 0) || "";
  const truncatedBrief = briefSnippet.length > 120
    ? briefSnippet.slice(0, 117) + "..."
    : briefSnippet;

  return (
    <div
      data-card
      draggable
      onDragStart={(e) => onDragStart(task.id, e)}
      onDragEnd={() => onDragEnd?.()}
      onDragOver={(e) => {
        if (!onDragOverCard) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const rect = e.currentTarget.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const position: "before" | "after" = e.clientY < midY ? "before" : "after";
        onDragOverCard(task.id, position, e);
      }}
      onDrop={(e) => {
        if (!onDropOnCard) return;
        e.preventDefault();
        e.stopPropagation();
        onDropOnCard(task.id, e);
      }}
      onClick={() => onSelect(task.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: isSelected && !isDone
          ? "color-mix(in srgb, var(--foreground) 5%, var(--card))"
          : hover && !isDone
          ? "color-mix(in srgb, var(--foreground) 4%, var(--card))"
          : T.bg,
        border: `1px solid ${isSelected ? T.borderSelected : T.border}`,
        borderRadius: 8,
        padding: 12,
        minWidth: 0,
        maxWidth: "100%",
        boxShadow: hover && !isDone && !isDragging
          ? "0 1px 2px color-mix(in srgb, var(--foreground) 9%, transparent)"
          : "none",
        cursor: "pointer",
        position: "relative",
        overflow: "visible",
        color: T.text,
        transition: "background 150ms ease, border-color 150ms ease, box-shadow 150ms ease, opacity 200ms ease",
        opacity: isDragging ? 0.35 : dimmed ? 0.4 : isDone ? 0.65 : 1,
        filter: dimmed ? "saturate(0.4)" : "none",
      }}
    >
      {dropIndicator && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            [dropIndicator === "before" ? "top" : "bottom"]: -3,
            height: 3,
            borderRadius: 2,
            background: "var(--primary)",
            boxShadow: "0 0 0 2px color-mix(in srgb, var(--foreground) 15%, transparent)",
            pointerEvents: "none",
            zIndex: 5,
          }}
        />
      )}
      <div style={{ display: "flex", gap: 8 }}>
        {/* Left: card content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title row */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minHeight: 24,
          }}>
            {client && (
              <span style={{
                fontSize: 10,
                fontFamily: MONO,
                color: "var(--muted-foreground)",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}>
                {client.name}
              </span>
            )}
            <InlineTitle
              title={task.title}
              taskId={task.id}
              color={isDone ? T.textDim : T.text}
            />
            {/* Pin toggle — visible on hover or when pinned */}
            {(hover || isPinned) && !isDone && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                {isPinned && (
                  <span style={{
                    fontSize: 10,
                    fontFamily: MONO,
                    color: T.textMuted,
                    whiteSpace: "nowrap",
                  }}>
                    {new Date(task.updatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    updateTask(task.id, { pinnedAt: isPinned ? null : new Date().toISOString() });
                  }}
                  title={isPinned ? "Unpin" : "Pin to top"}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 4,
                    display: "flex",
                    alignItems: "center",
                    flexShrink: 0,
                    opacity: isPinned ? 0.5 : 0.3,
                    transition: "opacity 120ms ease",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.8"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = isPinned ? "0.5" : "0.3"; }}
                >
                  <Pin size={13} color={T.textMuted} />
                </button>
              </div>
            )}
          </div>

          {/* Description — one line, muted */}
          {truncatedBrief && (
            <div style={{
              marginTop: 4,
              fontSize: 12,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              color: T.textDim,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              lineHeight: 1.4,
            }}>
              {truncatedBrief}
            </div>
          )}

          {/* Metadata row — all inline */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {task.level !== "task" && (
                <LevelBadge level={task.level} projectSlug={task.projectSlug} />
              )}
              {/* Tag is always visible: shows the tag when set, or a subtle
                  "tag" affordance when not. No longer hover-gated. */}
              <TagPicker
                value={task.tag}
                onChange={(tag) => updateTask(task.id, { tag })}
                onOpenChange={setTagPickerOpen}
              />
              {/* Non-parent: simple labels */}
              {!hasChildren && needs && !isDone && (
                <span style={{
                  fontSize: 10,
                  fontFamily: MONO,
                  fontWeight: 500,
                  color: T.accent,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}>
                  needs input
                  {unseen && (
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        backgroundColor: "var(--primary)",
                        flexShrink: 0,
                      }}
                      title="Not yet viewed"
                    />
                  )}
                </span>
              )}
            </div>
            {!hasChildren && isRunning && !needs && (
              <span style={{
                fontSize: 10,
                fontFamily: MONO,
                color: T.accentRun,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}>
                running
                {elapsed && <span style={{ color: T.textMuted }}>{elapsed}</span>}
              </span>
            )}
            {isRunning && task.activityLabel && !isProjectParent && (
              <span style={{
                fontSize: 11,
                fontFamily: MONO,
                color: "var(--muted-foreground)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "100%",
              }}>
                {task.activityLabel.length > 60 ? task.activityLabel.slice(0, 59) + "…" : task.activityLabel}
              </span>
            )}
          </div>
        </div>

        {/* Right: stacked conversation status counts (main chat + child chats) */}
        {!isDone && (childReviewCount > 0 || childActiveCount > 0 || childDoneWithMain > 0) && (
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 4,
            flexShrink: 0,
            fontSize: 10,
            fontFamily: MONO,
            paddingTop: 4,
          }}>
            {childReviewCount > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  // Mark all review conversations as done (children + main)
                  const reviewTasks = conversations.filter((c) => c.status !== "done" && taskNeedsInput(c));
                  for (const t of reviewTasks) {
                    updateTask(t.id, { status: "done", needsInput: false, errorMessage: null, completedAt: new Date().toISOString() });
                  }
                  if (mainNeedsReview) {
                    updateTask(task.id, { status: "done", needsInput: false, errorMessage: null, completedAt: new Date().toISOString() });
                  }
                }}
                title="Click to mark all review items done"
                style={{
                  color: T.accent,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 10,
                  fontFamily: MONO,
                  padding: 0,
                  textAlign: "right",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
              >
                Review · {childReviewCount}
              </button>
            )}
            {childActiveCount > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const activeTasks = conversations.filter((c) => c.status === "running" && !taskNeedsInput(c));
                  for (const t of activeTasks) {
                    updateTask(t.id, { status: "done", needsInput: false, errorMessage: null, completedAt: new Date().toISOString() });
                  }
                }}
                title="Click to mark all in-progress items done"
                style={{
                  color: T.accentRun,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 10,
                  fontFamily: MONO,
                  padding: 0,
                  textAlign: "right",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
              >
                In progress · {childActiveCount}
              </button>
            )}
            {childDoneWithMain > 0 && (
              <span style={{ color: T.textMuted }}>
                Done · {childDoneWithMain}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── DoneDropZone ─────────────────────────────────────────────────

function DoneDropZone({
  visible,
  isOver,
  onDrop,
  onDragOver,
  onDragLeave,
}: {
  visible: boolean;
  isOver: boolean;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
}) {
  if (!visible) return null;

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      style={{
        border: isOver ? "2px solid var(--muted-foreground)" : "2px dashed var(--border)",
        borderRadius: 10,
        padding: "20px 24px",
        textAlign: "center",
        background: isOver ? "color-mix(in srgb, var(--foreground) 8%, transparent)" : "color-mix(in srgb, var(--foreground) 2%, transparent)",
        transition: "all 150ms ease",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
    >
      <CheckCircle2 size={16} color={isOver ? "var(--muted-foreground)" : "var(--border)"} />
      <span style={{
        fontSize: 13,
        fontWeight: 500,
        color: isOver ? "var(--muted-foreground)" : "var(--border)",
        fontFamily: "var(--font-inter), Inter, sans-serif",
        transition: "color 150ms ease",
      }}>
        Drop here to mark done
      </span>
    </div>
  );
}

// ── DetailPanel ──────────────────────────────────────────────────

// ── SubtasksList (truncated with expand) ────────────────────────

const SUBTASK_FOLD = 5;

function SubtasksList({
  subtasks,
  onSelectSubtask,
  onRunSubtask,
  onRunAll,
  childLogEntries,
}: {
  subtasks: Task[];
  onSelectSubtask?: (id: string) => void;
  onRunSubtask?: (id: string, currentStatus: string) => void;
  onRunAll?: () => void;
  childLogEntries?: Record<string, LogEntry[]>;
}) {
  const [expanded, setExpanded] = useState(false);

  const backlogCount = subtasks.filter((s) => s.status === "backlog").length;

  if (subtasks.length === 0) {
    return (
      <div style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "var(--font-inter), Inter, sans-serif", padding: "8px 0" }}>
        No subtasks yet
      </div>
    );
  }

  const visible = expanded ? subtasks : subtasks.slice(0, SUBTASK_FOLD);
  const hiddenCount = subtasks.length - SUBTASK_FOLD;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {onRunAll && backlogCount > 0 && (
        <button
          onClick={onRunAll}
          style={{
            alignSelf: "flex-start",
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "4px 8px", marginBottom: 8,
            fontSize: 10, fontFamily: "var(--font-inter), Inter, sans-serif", fontWeight: 600,
            border: "1px solid color-mix(in srgb, var(--foreground) 30%, transparent)",
            borderRadius: 5,
            background: "color-mix(in srgb, var(--foreground) 6%, transparent)",
            color: "var(--primary)",
            cursor: "pointer",
          }}
          title={`Run all ${backlogCount} backlog subtasks`}
        >
          <Play size={10} />
          Run all ({backlogCount})
        </button>
      )}
      {visible.map((st) => {
        // Mutually-exclusive display state — priority order matters.
        // done > needsInput > running > queued > backlog
        type DisplayState = "done" | "needs" | "running" | "queued" | "backlog";
        const rawNeeds = taskNeedsInput(st);
        const displayState: DisplayState =
          st.status === "done"
            ? "done"
            : rawNeeds
            ? "needs"
            : st.status === "running"
            ? "running"
            : st.status === "queued"
            ? "queued"
            : "backlog";

        const canRun = st.status === "backlog" || st.status === "review" || st.status === "done";
        const runLabel = st.status === "backlog" ? "run" : st.status === "review" ? "requeue" : "rerun";

        // Only surface a waiting-on-input preview if we're actually in needs state.
        const logs = childLogEntries?.[st.id] || [];
        const questionPreview =
          displayState === "needs"
            ? getPendingTaskQuestionPreview(logs, true, 110)
            : null;

        // Per-state visual tokens (one source of truth).
        const visuals: Record<DisplayState, {
          bg: string; bgHover: string; border: string; borderLeft: string;
          textColor: string; dotColor: string; pulse: boolean;
          statusLabel: string; statusColor: string; strike: boolean;
        }> = {
          done: {
            bg: "transparent", bgHover: "color-mix(in srgb, var(--foreground) 3%, transparent)",
            border: "1px solid transparent", borderLeft: "3px solid transparent",
            textColor: "var(--border)", dotColor: "var(--muted-foreground)", pulse: false,
            statusLabel: "done", statusColor: "var(--border)", strike: true,
          },
          needs: {
            bg: "color-mix(in srgb, var(--foreground) 6%, transparent)", bgHover: "color-mix(in srgb, var(--foreground) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--foreground) 35%, transparent)", borderLeft: "3px solid var(--border)",
            textColor: "var(--border)", dotColor: "var(--border)", pulse: false,
            statusLabel: "input", statusColor: "var(--border)", strike: false,
          },
          running: {
            bg: "transparent", bgHover: "color-mix(in srgb, var(--foreground) 3%, transparent)",
            border: "1px solid transparent", borderLeft: "3px solid color-mix(in srgb, var(--foreground) 50%, transparent)",
            textColor: "var(--muted-foreground)", dotColor: "var(--foreground)", pulse: true,
            statusLabel: "running", statusColor: "var(--border)", strike: false,
          },
          queued: {
            bg: "transparent", bgHover: "color-mix(in srgb, var(--foreground) 3%, transparent)",
            border: "1px solid transparent", borderLeft: "3px solid transparent",
            textColor: "var(--muted-foreground)", dotColor: "var(--border)", pulse: false,
            statusLabel: "queued", statusColor: "var(--border)", strike: false,
          },
          backlog: {
            bg: "transparent", bgHover: "color-mix(in srgb, var(--foreground) 3%, transparent)",
            border: "1px solid transparent", borderLeft: "3px solid transparent",
            textColor: "var(--muted-foreground)", dotColor: "var(--muted)", pulse: false,
            statusLabel: st.status, statusColor: "var(--border)", strike: false,
          },
        };
        const v = visuals[displayState];

        return (
          <div
            key={st.id}
            onClick={onSelectSubtask ? () => onSelectSubtask(st.id) : undefined}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              padding: "8px 8px",
              borderRadius: 6,
              fontSize: 11,
              color: v.textColor,
              background: v.bg,
              border: v.border,
              borderLeft: v.borderLeft,
              cursor: onSelectSubtask ? "pointer" : "default",
              transition: "background 120ms ease, border-color 120ms ease",
            }}
            onMouseEnter={(e) => {
              if (!onSelectSubtask) return;
              e.currentTarget.style.background = v.bgHover;
            }}
            onMouseLeave={(e) => {
              if (!onSelectSubtask) return;
              e.currentTarget.style.background = v.bg;
            }}
          >
            <span style={{
              width: 6, height: 6, borderRadius: "50%", flexShrink: 0, marginTop: 4,
              background: v.dotColor,
              animation: v.pulse ? "pulse-dot 2s ease-in-out infinite" : undefined,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                textDecoration: v.strike ? "line-through" : "none",
              }}>
                {st.title}
              </div>
              {questionPreview && (
                <div style={{
                  marginTop: 4,
                  fontSize: 10,
                  fontStyle: "italic",
                  color: "var(--muted-foreground)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  ↳ {questionPreview}
                </div>
              )}
            </div>
            {onRunSubtask && canRun && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRunSubtask(st.id, st.status);
                }}
                style={{
                  padding: "4px 8px",
                  fontSize: 9,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontWeight: 600,
                  color: "var(--primary)",
                  background: "var(--card)",
                  border: "1px solid color-mix(in srgb, var(--foreground) 30%, transparent)",
                  borderRadius: 4,
                  cursor: "pointer",
                  flexShrink: 0,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
                title={`${runLabel} this subtask`}
              >
                {runLabel}
              </button>
            )}
            <span style={{
              fontSize: 9, fontFamily: "var(--font-inter), Inter, sans-serif",
              color: v.statusColor, flexShrink: 0, marginTop: 4,
            }}>
              {v.statusLabel}
            </span>
          </div>
        );
      })}
      {hiddenCount > 0 && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            background: "none", border: "none", cursor: "pointer",
            fontSize: 10, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--muted-foreground)",
            padding: "4px 8px", marginTop: 4,
          }}
        >
          <span style={{ fontSize: 8 }}>&#9654;</span>
          {hiddenCount} more
        </button>
      )}
      {expanded && hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(false)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            background: "none", border: "none", cursor: "pointer",
            fontSize: 10, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--muted-foreground)",
            padding: "4px 8px", marginTop: 4,
          }}
        >
          <span style={{ fontSize: 8, transform: "rotate(90deg)", display: "inline-block" }}>&#9654;</span>
          show less
        </button>
      )}
    </div>
  );
}

// ── GSD Phases Overview ─────────────────────────────────────────

interface GsdPhaseGroup {
  phaseNumber: number;
  phaseName: string;
  steps: Task[];
}

interface PlanningFile {
  name: string;
  relativePath: string;
  size: number;
}

function PlanningDocViewer({ relativePath, onClose }: { relativePath: string; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    setEditing(false);
    fetch(`/api/gsd/files?file=${encodeURIComponent(relativePath)}`)
      .then((r) => r.json())
      .then((data) => { setContent(data.content ?? null); setDraft(data.content ?? ""); })
      .catch(() => setContent(null))
      .finally(() => setLoading(false));
  }, [relativePath]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`/api/files/${encodeURIComponent(relativePath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      setContent(draft);
      setEditing(false);
    } catch { /* non-critical */ }
    setSaving(false);
  };

  return (
    <div style={{
      background: "var(--muted)",
      border: editing ? "1px solid color-mix(in srgb, var(--foreground) 30%, transparent)" : "1px solid var(--border)",
      borderRadius: 8,
      overflow: "hidden",
      maxHeight: 500,
      display: "flex",
      flexDirection: "column",
      marginTop: 8,
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px",
        borderBottom: "1px solid var(--border)",
        background: "var(--muted)",
      }}>
        <span style={{ fontSize: 10, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--muted-foreground)" }}>
          {relativePath.split("/").pop()}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {!loading && content !== null && !editing && (
            <button
              onClick={() => { setDraft(content); setEditing(true); }}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", display: "flex", padding: 4, fontSize: 10, fontFamily: "var(--font-inter), Inter, sans-serif" }}
              title="Edit"
            >
              Edit
            </button>
          )}
          {editing && (
            <>
              <button
                onClick={() => setEditing(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", display: "flex", padding: 4, fontSize: 10, fontFamily: "var(--font-inter), Inter, sans-serif" }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || draft === content}
                style={{
                  background: draft !== content ? "var(--primary)" : "var(--border)", border: "none", cursor: draft !== content ? "pointer" : "default",
                  color: "var(--card)", display: "flex", padding: "4px 8px", fontSize: 10, fontFamily: "var(--font-inter), Inter, sans-serif", borderRadius: 3,
                }}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </>
          )}
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", display: "flex", padding: 4 }}
          >
            <X size={12} />
          </button>
        </div>
      </div>
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: editing ? 0 : 12,
        fontSize: 12,
        lineHeight: 1.6,
        color: "var(--foreground)",
        wordBreak: "break-word",
      }}>
        {loading ? (
          <span style={{ padding: 12, color: "var(--muted-foreground)" }}>Loading...</span>
        ) : editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{
              width: "100%",
              height: "100%",
              minHeight: 300,
              border: "none",
              outline: "none",
              resize: "none",
              padding: 12,
              fontSize: 12,
              lineHeight: 1.6,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              color: "var(--foreground)",
              background: "transparent",
            }}
          />
        ) : content ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents as never}>
            {content}
          </ReactMarkdown>
        ) : (
          <span style={{ color: "var(--muted-foreground)" }}>File not found</span>
        )}
      </div>
    </div>
  );
}

function GsdPhasesOverview({
  subtasks,
  parentTask,
  onSelectSubtask,
  onStepLaunched,
  onCommand,
}: {
  subtasks: Task[];
  parentTask: Task;
  onSelectSubtask?: (id: string) => void;
  onStepLaunched?: () => void;
  /** Fill the reply input with a /gsd command instead of queuing directly. */
  onCommand?: (command: string) => void;
}) {
  const [expandedPhase, setExpandedPhase] = useState<number | null>(null);
  const [phaseFiles, setPhaseFiles] = useState<PlanningFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [viewingDoc, setViewingDoc] = useState<string | null>(null);
  const [showProjectDocs, setShowProjectDocs] = useState(false);
  const [projectFiles, setProjectFiles] = useState<PlanningFile[]>([]);
  const [researchFiles, setResearchFiles] = useState<PlanningFile[]>([]);
  const updateTask = useTaskStore((s) => s.updateTask);

  // Click chip → fill the reply input with the /gsd command
  const handleLaunchStep = useCallback(
    (commandName: string, phaseNumber: number, e: React.MouseEvent) => {
      e.stopPropagation();
      if (onCommand) {
        onCommand(`/gsd-${commandName} ${phaseNumber}`);
      }
    },
    [onCommand]
  );

  // Separate affordance: hover-revealed ✓ marks that step complete without running it
  const handleMarkStepDone = useCallback(
    async (step: Task, e: React.MouseEvent) => {
      e.stopPropagation();
      if (step.status === "done") return;
      await updateTask(step.id, {
        status: "done",
        needsInput: false,
        errorMessage: null,
        completedAt: new Date().toISOString(),
      });
    },
    [updateTask]
  );

  // Group subtasks by phase number
  const phases = useMemo(() => {
    const map = new Map<number, GsdPhaseGroup>();
    for (const st of subtasks) {
      if (st.phaseNumber == null) continue;
      if (!map.has(st.phaseNumber)) {
        const nameMatch = st.title.match(/Phase \d+:\s*\w+\s*—\s*(.+)/);
        map.set(st.phaseNumber, {
          phaseNumber: st.phaseNumber,
          phaseName: nameMatch ? nameMatch[1].trim() : `Phase ${st.phaseNumber}`,
          steps: [],
        });
      }
      map.get(st.phaseNumber)!.steps.push(st);
    }
    const stepOrder: Record<string, number> = { discuss: 0, plan: 1, execute: 2, verify: 3 };
    for (const group of map.values()) {
      group.steps.sort((a, b) => (stepOrder[a.gsdStep || ""] ?? 99) - (stepOrder[b.gsdStep || ""] ?? 99));
    }
    return [...map.values()].sort((a, b) => a.phaseNumber - b.phaseNumber);
  }, [subtasks]);

  // Fetch project-level files on mount
  useEffect(() => {
    fetch("/api/gsd/files")
      .then((r) => r.json())
      .then((data) => {
        if (data.projectFiles) setProjectFiles(data.projectFiles);
        if (data.researchFiles) setResearchFiles(data.researchFiles);
      })
      .catch(() => {});
  }, []);

  // Fetch phase files when a phase is expanded
  useEffect(() => {
    if (expandedPhase == null) { setPhaseFiles([]); return; }
    setLoadingFiles(true);
    setViewingDoc(null);
    fetch(`/api/gsd/files?phase=${expandedPhase}`)
      .then((r) => r.json())
      .then((data) => setPhaseFiles(data.files || []))
      .catch(() => setPhaseFiles([]))
      .finally(() => setLoadingFiles(false));
  }, [expandedPhase]);

  const totalPhases = phases.length;
  const donePhases = phases.filter((p) => p.steps.every((s) => s.status === "done")).length;

  if (phases.length === 0) {
    return (
      <div style={{ fontSize: 13, color: "var(--muted-foreground)", fontFamily: "var(--font-inter), Inter, sans-serif", padding: "12px 0" }}>
        {parentTask.description || "No phases synced yet"}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Project docs toggle */}
      {(projectFiles.length > 0 || researchFiles.length > 0) && (
        <div>
          <button
            onClick={() => { setShowProjectDocs(!showProjectDocs); setExpandedPhase(null); setViewingDoc(null); }}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              background: showProjectDocs ? "color-mix(in srgb, var(--foreground) 5%, transparent)" : "none",
              border: showProjectDocs ? "1px solid color-mix(in srgb, var(--foreground) 15%, transparent)" : "1px solid transparent",
              borderRadius: 6, cursor: "pointer", padding: "8px 12px",
              fontSize: 11, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--primary)",
              fontWeight: 500, width: "100%", transition: "all 150ms ease",
            }}
          >
            <FileText size={12} />
            <span>Project Documents</span>
            <span style={{
              fontSize: 8, display: "inline-block",
              transition: "transform 150ms ease",
              transform: showProjectDocs ? "rotate(90deg)" : "rotate(0deg)",
              marginLeft: "auto",
            }}>&#9654;</span>
          </button>

          {showProjectDocs && (
            <div style={{ paddingLeft: 8, paddingTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {projectFiles.map((f) => (
                <button
                  key={f.relativePath}
                  onClick={() => setViewingDoc(viewingDoc === f.relativePath ? null : f.relativePath)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    background: viewingDoc === f.relativePath ? "color-mix(in srgb, var(--foreground) 6%, transparent)" : "transparent",
                    border: "none", borderRadius: 4, cursor: "pointer",
                    padding: "4px 8px", fontSize: 11, color: "var(--muted-foreground)", textAlign: "left",
                    fontFamily: "var(--font-inter), Inter, sans-serif", transition: "background 100ms ease",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--foreground) 3%, transparent)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = viewingDoc === f.relativePath ? "color-mix(in srgb, var(--foreground) 6%, transparent)" : "transparent"; }}
                >
                  <FileText size={10} color="var(--border)" />
                  {f.name}
                </button>
              ))}
              {researchFiles.length > 0 && (
                <>
                  <div style={{ fontSize: 9, color: "var(--muted-foreground)", fontFamily: "var(--font-inter), Inter, sans-serif", padding: "4px 8px", marginTop: 4 }}>
                    Research
                  </div>
                  {researchFiles.map((f) => (
                    <button
                      key={f.relativePath}
                      onClick={() => setViewingDoc(viewingDoc === f.relativePath ? null : f.relativePath)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        background: viewingDoc === f.relativePath ? "color-mix(in srgb, var(--foreground) 6%, transparent)" : "transparent",
                        border: "none", borderRadius: 4, cursor: "pointer",
                        padding: "4px 8px", fontSize: 11, color: "var(--muted-foreground)", textAlign: "left",
                        fontFamily: "var(--font-inter), Inter, sans-serif", transition: "background 100ms ease",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--foreground) 3%, transparent)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = viewingDoc === f.relativePath ? "color-mix(in srgb, var(--foreground) 6%, transparent)" : "transparent"; }}
                    >
                      <FileText size={10} color="var(--border)" />
                      {f.name}
                    </button>
                  ))}
                </>
              )}
              {viewingDoc && !viewingDoc.startsWith("phases/") && (
                <PlanningDocViewer relativePath={viewingDoc} onClose={() => setViewingDoc(null)} />
              )}
            </div>
          )}
        </div>
      )}

      {/* Summary bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          flex: 1, height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden",
        }}>
          <div style={{
            width: `${totalPhases > 0 ? (donePhases / totalPhases) * 100 : 0}%`,
            height: "100%", borderRadius: 2,
            background: "linear-gradient(90deg, var(--muted-foreground), var(--border))",
            transition: "width 0.3s ease",
          }} />
        </div>
        <span style={{
          fontSize: 10, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--muted-foreground)", flexShrink: 0,
        }}>
          {donePhases}/{totalPhases} phases
        </span>
      </div>

      {/* Phase rows */}
      {phases.map((phase) => {
        const allDone = phase.steps.every((s) => s.status === "done");
        const inProgress = phase.steps.some((s) => s.status === "running" || s.status === "queued" || taskNeedsInput(s));
        const currentStep = phase.steps.find((s) => s.status !== "done" && s.status !== "backlog");
        const isExpanded = expandedPhase === phase.phaseNumber;

        return (
          <div key={phase.phaseNumber} style={{
            padding: "8px 12px",
            borderRadius: 6,
            background: allDone ? "color-mix(in srgb, var(--foreground) 4%, transparent)" : inProgress ? "var(--card)" : "var(--muted)",
            border: isExpanded
              ? "1px solid color-mix(in srgb, var(--foreground) 25%, transparent)"
              : inProgress ? "1px solid color-mix(in srgb, var(--foreground) 15%, transparent)" : "1px solid color-mix(in srgb, var(--foreground) 15%, transparent)",
            cursor: "pointer",
            transition: "border-color 150ms ease",
          }}
            onClick={() => {
              setShowProjectDocs(false);
              setExpandedPhase(isExpanded ? null : phase.phaseNumber);
            }}
          >
            {/* Phase header */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
            }}>
              <span style={{
                fontSize: 9, fontFamily: "var(--font-inter), Inter, sans-serif", fontWeight: 600,
                color: allDone ? "var(--muted-foreground)" : inProgress ? "var(--primary)" : "var(--border)",
                minWidth: 14,
              }}>
                {phase.phaseNumber}
              </span>
              <span style={{
                fontSize: 12, fontWeight: 500,
                color: allDone ? "var(--muted-foreground)" : "var(--foreground)",
                textDecoration: allDone ? "line-through" : "none",
                flex: 1,
              }}>
                {phase.phaseName}
              </span>
              {onSelectSubtask && (currentStep || phase.steps[0]) && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectSubtask((currentStep || phase.steps[0]).id);
                  }}
                  title="Open conversation"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "4px 8px",
                    fontSize: 9,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    border: "1px solid color-mix(in srgb, var(--foreground) 25%, transparent)",
                    borderRadius: 4,
                    background: "var(--card)",
                    color: "var(--primary)",
                    cursor: "pointer",
                  }}
                >
                  open
                </button>
              )}
              {allDone && <CheckCircle2 size={12} color="var(--muted-foreground)" />}
              <span style={{
                fontSize: 8, display: "inline-block",
                transition: "transform 150ms ease",
                transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                color: "var(--muted-foreground)",
              }}>&#9654;</span>
            </div>

            {/* Step pills — always clickable, fills reply input with the /gsd command */}
            <div style={{ display: "flex", gap: 4, paddingLeft: 22 }}>
              {phase.steps.map((step) => {
                const isDone = step.status === "done";
                const isActive = step.status === "running" || step.status === "queued" || taskNeedsInput(step);
                const label = step.gsdStep || "?";
                const commandName =
                  step.gsdStep === "execute" ? "execute-phase"
                    : step.gsdStep === "verify" ? "verify-work"
                    : step.gsdStep === "plan" ? "plan-phase"
                    : "discuss-phase";
                return (
                  <span
                    key={step.id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      borderRadius: 4,
                      background: isDone ? "color-mix(in srgb, var(--foreground) 12%, transparent)"
                        : isActive ? "color-mix(in srgb, var(--foreground) 8%, transparent)"
                        : "color-mix(in srgb, var(--foreground) 4%, transparent)",
                      border: "1px solid transparent",
                      transition: "border-color 120ms ease",
                    }}
                    onMouseEnter={(e) => {
                      const checkBtn = e.currentTarget.querySelector("[data-mark-done]") as HTMLElement | null;
                      if (checkBtn && !isDone) checkBtn.style.display = "inline-flex";
                      e.currentTarget.style.borderColor = "color-mix(in srgb, var(--foreground) 30%, transparent)";
                    }}
                    onMouseLeave={(e) => {
                      const checkBtn = e.currentTarget.querySelector("[data-mark-done]") as HTMLElement | null;
                      if (checkBtn) checkBtn.style.display = "none";
                      e.currentTarget.style.borderColor = "transparent";
                    }}
                  >
                    <button
                      onClick={(e) => handleLaunchStep(commandName, phase.phaseNumber, e)}
                      title={`Run /gsd-${commandName} ${phase.phaseNumber}`}
                      style={{
                        fontSize: 10,
                        fontFamily: "var(--font-inter), Inter, sans-serif",
                        padding: "4px 8px",
                        borderRadius: 4,
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        color: isDone ? "var(--border)"
                          : isActive ? "var(--primary)"
                          : "var(--primary)",
                        fontWeight: 500,
                        transition: "background 120ms ease",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--foreground) 8%, transparent)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      {label}
                    </button>
                    {!isDone && (
                      <button
                        data-mark-done
                        onClick={(e) => handleMarkStepDone(step, e)}
                        title={`Mark ${label} complete without running it`}
                        style={{
                          display: "none",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "0 4px 0 2px",
                          marginRight: 4,
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          color: "var(--muted-foreground)",
                        }}
                      >
                        <Check size={9} />
                      </button>
                    )}
                  </span>
                );
              })}
            </div>

            {/* Current step activity */}
            {currentStep && (
              <div style={{
                fontSize: 10, fontFamily: "var(--font-inter), Inter, sans-serif",
                color: taskNeedsInput(currentStep) ? "var(--border)" : "color-mix(in srgb, var(--foreground) 60%, transparent)",
                paddingLeft: 22, marginTop: 4,
              }}>
                {taskNeedsInput(currentStep)
                  ? `Needs input — ${currentStep.gsdStep}`
                  : currentStep.activityLabel || `${currentStep.gsdStep} ${currentStep.status}`}
              </div>
            )}

            {/* Expanded: phase documents */}
            {isExpanded && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ paddingLeft: 22, paddingTop: 8, borderTop: "1px dashed var(--border)", marginTop: 8 }}
              >
                {loadingFiles ? (
                  <span style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "var(--font-inter), Inter, sans-serif" }}>Loading...</span>
                ) : phaseFiles.length === 0 ? (
                  <span style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "var(--font-inter), Inter, sans-serif" }}>No documents for this phase</span>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {phaseFiles.map((f) => (
                      <button
                        key={f.relativePath}
                        onClick={() => setViewingDoc(viewingDoc === f.relativePath ? null : f.relativePath)}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          background: viewingDoc === f.relativePath ? "color-mix(in srgb, var(--foreground) 6%, transparent)" : "transparent",
                          border: "none", borderRadius: 4, cursor: "pointer",
                          padding: "4px 8px", fontSize: 11, color: "var(--muted-foreground)", textAlign: "left",
                          fontFamily: "var(--font-inter), Inter, sans-serif", transition: "background 100ms ease",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--foreground) 3%, transparent)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = viewingDoc === f.relativePath ? "color-mix(in srgb, var(--foreground) 6%, transparent)" : "transparent"; }}
                      >
                        <FileText size={10} color="var(--border)" />
                        {f.name}
                      </button>
                    ))}
                  </div>
                )}
                {viewingDoc && viewingDoc.startsWith("phases/") && (
                  <PlanningDocViewer relativePath={viewingDoc} onClose={() => setViewingDoc(null)} />
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Goal from description */}
      {parentTask.description && (
        <div style={{
          fontSize: 11, color: "var(--muted-foreground)", fontStyle: "italic",
          padding: "4px 0", borderTop: "1px dashed var(--border)", marginTop: 4,
        }}>
          {parentTask.description}
        </div>
      )}
    </div>
  );
}

// ── Checkbox helpers for interactive markdown ────────────────────

/** Recursively extract plain text from React children */
function extractTextFromChildren(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (!children) return "";
  if (Array.isArray(children)) return children.map(extractTextFromChildren).join("");
  if (typeof children === "object" && "props" in (children as React.ReactElement)) {
    const el = children as React.ReactElement;
    // Skip checkbox inputs
    if (el.type === "input") return "";
    return extractTextFromChildren((el.props as { children?: React.ReactNode }).children);
  }
  return "";
}

/** Filter out checkbox <input> elements from children, keeping everything else */
function filterCheckboxFromChildren(children: React.ReactNode): React.ReactNode {
  if (!children) return children;
  if (!Array.isArray(children)) {
    if (typeof children === "object" && "props" in (children as React.ReactElement)) {
      const el = children as React.ReactElement;
      if (el.type === "input") return null;
    }
    return children;
  }
  return children.filter((c) => {
    if (typeof c === "object" && c && "props" in (c as React.ReactElement)) {
      return (c as React.ReactElement).type !== "input";
    }
    return true;
  });
}

/** Strip markdown inline formatting (bold, italic, code, links) for plain-text comparison */
function stripMarkdownInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")  // bold
    .replace(/__(.+?)__/g, "$1")       // bold alt
    .replace(/\*(.+?)\*/g, "$1")       // italic
    .replace(/_(.+?)_/g, "$1")         // italic alt
    .replace(/`(.+?)`/g, "$1")         // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"); // links
}

/** Toggle a checkbox in raw markdown content by matching the label text.
 *  Client-side equivalent of brief-sync's toggleDeliverableCheckbox. */
function toggleCheckboxInMarkdown(md: string, label: string, checked: boolean): string {
  const lines = md.split("\n");
  const normalizedLabel = label.toLowerCase().trim();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match task-list items: - [ ] or - [x]
    if (/^\s*[-*]\s+\[[ xX]\]/.test(line)) {
      // Extract text after the checkbox, strip markdown formatting for comparison
      const rawText = line.replace(/^\s*[-*]\s+\[[ xX]\]\s*/, "").trim();
      const text = stripMarkdownInline(rawText).toLowerCase();
      if (text.includes(normalizedLabel) || normalizedLabel.includes(text)) {
        if (checked) {
          lines[i] = line.replace(/\[ \]/, "[x]");
        } else {
          lines[i] = line.replace(/\[x\]/i, "[ ]");
        }
        return lines.join("\n");
      }
    }
  }
  return md;
}

// ── FilePreviewInline ────────────────────────────────────────────

const PREVIEWABLE = new Set(["md", "txt", "csv", "json", "html", "xml", "yaml", "yml", "toml", "excalidraw"]);

function FilePreviewInline({ relativePath, extension, onClose, fillHeight, onCheckboxToggle, editable, clientId }: {
  relativePath: string;
  extension: string;
  onClose: () => void;
  fillHeight?: boolean;
  /** Called when a checkbox in the markdown is toggled. Receives the text label and new checked state. */
  onCheckboxToggle?: (label: string, checked: boolean) => void;
  /** Allow inline editing of the file content */
  editable?: boolean;
  /** Optional task workspace override for preview/download/edit calls. */
  clientId?: string | null;
}) {
  const router = useRouter();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const previewUrl = useMemo(
    () => appendClientId(`/api/files/preview?path=${encodeURIComponent(relativePath)}`, clientId ?? null),
    [clientId, relativePath],
  );
  const fileUrl = useMemo(
    () => appendClientId(`/api/files/${relativePath}`, clientId ?? null),
    [clientId, relativePath],
  );

  useEffect(() => {
    setLoading(true);
    fetch(previewUrl)
      .then((r) => r.json())
      .then((data) => { setContent(data.content ?? null); })
      .catch(() => setContent(null))
      .finally(() => setLoading(false));
  }, [previewUrl]);

  const parts = relativePath.split("/").filter(Boolean);
  const dirParts = parts.slice(0, -1);
  const fileName = parts[parts.length - 1] || relativePath;

  const openPath = (subPath: string) => {
    router.push(appendClientId(`/?tab=docs&file=${encodeURIComponent(subPath)}`, clientId ?? null));
  };

  return (
    <div style={{
      background: "var(--muted)",
      border: fillHeight ? "none" : "1px solid var(--border)",
      borderRadius: fillHeight ? 0 : 8,
      overflow: "hidden",
      ...(fillHeight ? { flex: 1, minHeight: 0 } : { maxHeight: 400 }),
      display: "flex",
      flexDirection: "column",
    }}>
      <div style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 8,
        padding: "8px 12px",
        borderBottom: "1px solid var(--border)",
        background: "var(--muted)",
      }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {dirParts.length > 0 && (
            <div
              style={{
                fontSize: 10,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                color: "var(--muted-foreground)",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 4,
                letterSpacing: "0.02em",
              }}
            >
              {dirParts.map((segment, i) => {
                const segPath = dirParts.slice(0, i + 1).join("/");
                return (
                  <span key={segPath} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <button
                      onClick={() => openPath(segPath)}
                      title={`Reveal ${segPath} in file explorer`}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        color: "var(--primary)",
                        fontFamily: "inherit",
                        fontSize: "inherit",
                        textDecoration: "underline",
                        textDecorationColor: "color-mix(in srgb, var(--foreground) 30%, transparent)",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.textDecorationColor = "var(--primary)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.textDecorationColor = "color-mix(in srgb, var(--foreground) 30%, transparent)"; }}
                    >
                      {segment}
                    </button>
                    {i < dirParts.length - 1 && <span style={{ color: "var(--muted-foreground)" }}>›</span>}
                  </span>
                );
              })}
            </div>
          )}
          <button
            onClick={() => openPath(relativePath)}
            title={`Open ${fileName} in Docs`}
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--foreground)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              textAlign: "left",
              textDecoration: "underline",
              textDecorationColor: "color-mix(in srgb, var(--foreground) 25%, transparent)",
              textUnderlineOffset: 2,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.textDecorationColor = "var(--primary)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.textDecorationColor = "color-mix(in srgb, var(--foreground) 25%, transparent)"; }}
          >
            {fileName}
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {editable && !editing && (
            <button
              onClick={() => { setEditContent(content ?? ""); setEditing(true); }}
              title="Edit"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", display: "flex", padding: 4 }}
            >
              <Pencil size={12} />
            </button>
          )}
          {editing && (
            <>
              <button
                onClick={() => setEditing(false)}
                title="Cancel"
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", fontSize: 10, fontFamily: "var(--font-inter), Inter, sans-serif", padding: "4px 8px" }}
              >
                Cancel
              </button>
              <button
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await fetch(fileUrl, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ content: editContent }),
                    });
                    setContent(editContent);
                    setEditing(false);
                  } catch { /* ignore */ }
                  setSaving(false);
                }}
                title="Save"
                style={{
                  background: "var(--primary)",
                  border: "none",
                  cursor: saving ? "wait" : "pointer",
                  color: "var(--card)",
                  fontSize: 10,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  padding: "4px 8px",
                  borderRadius: 3,
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </>
          )}
          <button
            onClick={onClose}
            title="Close preview"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", display: "flex", padding: 4 }}
          >
            <X size={12} />
          </button>
        </div>
      </div>
      {editing ? (
        <textarea
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          style={{
            flex: 1,
            minHeight: 0,
            padding: fillHeight ? "24px 32px" : 12,
            fontSize: 12,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            lineHeight: 1.6,
            color: "var(--foreground)",
            border: "none",
            outline: "none",
            resize: "none",
            background: "var(--muted)",
            width: "100%",
            boxSizing: "border-box",
          }}
        />
      ) : (
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: fillHeight ? "24px 32px" : 12,
        fontSize: 12,
        fontFamily: extension === "md" ? "inherit" : "var(--font-inter), Inter, sans-serif",
        lineHeight: 1.6,
        color: "var(--foreground)",
        whiteSpace: extension !== "md" ? "pre" : undefined,
        wordBreak: "break-word",
      }}>
        {loading ? (
          <span style={{ color: "var(--muted-foreground)" }}>Loading...</span>
        ) : content ? (
          extension === "md" ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
              ...(mdComponents as Record<string, unknown>),
              ...(onCheckboxToggle ? {
                li: ({ children, node }: { children?: React.ReactNode; node?: { children?: Array<{ tagName?: string; properties?: { checked?: boolean; type?: string } }> } }) => {
                  // Detect task-list items (contain an input[type=checkbox] child)
                  const inputChild = node?.children?.find(
                    (c: { tagName?: string; properties?: { type?: string } }) => c.tagName === "input" && c.properties?.type === "checkbox"
                  );
                  if (!inputChild) {
                    return <li style={{ margin: "2px 0" }}>{children}</li>;
                  }
                  const isChecked = !!(inputChild as { properties?: { checked?: boolean } }).properties?.checked;
                  // Extract the text label from the children (skip the input element)
                  const textLabel = extractTextFromChildren(children);
                  return (
                    <li style={{ margin: "2px 0", listStyle: "none", marginLeft: -20 }}>
                      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            // Optimistically update local content so the checkbox re-renders immediately
                            if (content) {
                              setContent(toggleCheckboxInMarkdown(content, textLabel, !isChecked));
                            }
                            onCheckboxToggle(textLabel, !isChecked);
                          }}
                          style={{ marginTop: 4, cursor: "pointer", accentColor: "var(--primary)" }}
                        />
                        <span style={{ textDecoration: isChecked ? "line-through" : undefined, color: isChecked ? "var(--muted-foreground)" : undefined }}>
                          {/* Render children but strip the original disabled checkbox */}
                          {filterCheckboxFromChildren(children)}
                        </span>
                      </label>
                    </li>
                  );
                },
              } : {}),
            } as never}>
              {content}
            </ReactMarkdown>
          ) : content
        ) : (
          <span style={{ color: "var(--muted-foreground)" }}>Preview unavailable</span>
        )}
      </div>
      )}
    </div>
  );
}

// ── DetailPanel ──────────────────────────────────────────────────

function DetailPanel({
  task,
  onClose,
  onMarkDone,
  onSelectSubtask,
  onNavigateToParent,
  isFullscreen = false,
  onToggleFullscreen,
  drawerWidth,
  onStartDrawerDrag,
  pendingScope,
  onScopeComplete,
}: {
  task: Task;
  onClose: () => void;
  onMarkDone: (id: string) => void;
  onSelectSubtask?: (id: string) => void;
  onNavigateToParent?: (parentId: string) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  /** Current drawer width in px (managed by parent FeedView). */
  drawerWidth?: number | null;
  /** Callback to start a left-edge drag resize. */
  onStartDrawerDrag?: (e: React.MouseEvent) => void;
  /** Scope data for project planning wizard (shown inline) */
  pendingScope?: { scope: ScopeResult; goal: string } | null;
  /** Called when the scoping wizard finishes creating the project */
  onScopeComplete?: () => void;
}) {
  const logEntries = useTaskStore((s) => s.logEntries[task.id]) ?? [];
  const outputFiles = useTaskStore((s) => s.outputFiles[task.id]) ?? [];
  const allTasks = useTaskStore((s) => s.tasks);
  const fetchLogEntries = useTaskStore((s) => s.fetchLogEntries);
  const fetchOutputFiles = useTaskStore((s) => s.fetchOutputFiles);
  const appendLogEntry = useTaskStore((s) => s.appendLogEntry);

  // Subtasks: child tasks for Level 2/GSD parent tasks
  const subtasks = useMemo(() => {
    if (task.level === "task") return [];
    return allTasks
      .filter((t) => t.parentId === task.id)
      .sort((a, b) => a.columnOrder - b.columnOrder);
  }, [allTasks, task.id, task.level]);

  const [replyText, setReplyText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [replyAttachments, setReplyAttachments] = useState<{ fileName: string; relativePath: string }[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [showInlineTagMenu, setShowInlineTagMenu] = useState(false);
  const [inlineTagQuery, setInlineTagQuery] = useState("");
  const [inlinePromptTags, setInlinePromptTags] = useState<TagItem[]>([]);
  const [replyMirrorScroll, setReplyMirrorScroll] = useState({ top: 0, left: 0 });
  const [pastedChips, setPastedChips] = useState<PastedChip[]>([]);
  const [previewFile, setPreviewFile] = useState<{ relativePath: string; extension: string } | null>(null);
  const [planningFiles, setPlanningFiles] = useState<{ projectFiles: PlanningFile[]; phases: { phaseNumber: number; dirName: string; files: PlanningFile[] }[]; researchFiles: PlanningFile[] } | null>(null);
  const [viewingPlanningDoc, setViewingPlanningDoc] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<"chat" | "files" | "plan">("chat");
  const [planDocked, setPlanDocked] = useState(false);
  const [showDraftPlanModal, setShowDraftPlanModal] = useState(false);
  const replyMinHeight = 60;
  const replyMaxHeight = 320;
  const {
    composerHeight: replyComposerHeight,
    hasUserResized: hasReplyComposerResize,
    handleResizePointerDown: handleReplyResizePointerDown,
  } = useComposerResize({
    minHeight: replyMinHeight,
    maxHeight: replyMaxHeight,
    initialHeight: replyMinHeight,
  });

  // ── Docked plan panel resize ──────────────────────────────────
  const [dockedPlanPct, setDockedPlanPct] = useState(50); // percentage of container width
  const dockedContainerRef = useRef<HTMLDivElement>(null);
  const planDraggingRef = useRef(false);

  useEffect(() => {
    syncComposerTextareaHeight(replyTextareaRef.current, {
      minHeight: replyMinHeight,
      maxHeight: replyMaxHeight,
      targetHeight: hasReplyComposerResize ? replyComposerHeight : null,
    });
  }, [hasReplyComposerResize, replyComposerHeight, replyMaxHeight, replyMinHeight, replyText]);

  const syncReplyMirrorScroll = useCallback(() => {
    const textarea = replyTextareaRef.current;
    if (!textarea) return;
    setReplyMirrorScroll((current) => {
      const next = { top: textarea.scrollTop, left: textarea.scrollLeft };
      return current.top === next.top && current.left === next.left ? current : next;
    });
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => syncReplyMirrorScroll());
  }, [replyText, syncReplyMirrorScroll]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!planDraggingRef.current || !dockedContainerRef.current) return;
      const rect = dockedContainerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      // Clamp between 25% and 75%
      setDockedPlanPct(Math.max(25, Math.min(75, 100 - pct)));
    };
    const onUp = () => {
      if (!planDraggingRef.current) return;
      planDraggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);
  const [activePermissionMode, setActivePermissionMode] = useState<PermissionMode>(
    normalizePermissionMode(task.permissionMode, "bypassPermissions"),
  );
  const [executionPermissionMode, setExecutionPermissionMode] = useState<PermissionMode>(
    getExecutionPermissionMode(task.executionPermissionMode ?? task.permissionMode, "bypassPermissions"),
  );
  const [model, setModel] = useState<ClaudeModel | null>(task.model ?? null);
  const [thinkingEffort, setThinkingEffort] = useState<ClaudeThinkingEffort | null>(task.thinkingEffort ?? "auto");
  const [changedOnly, setChangedOnly] = useState(false);
  const [scrollToTaskId, setScrollToTaskId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const activityRef = useRef<HTMLDivElement>(null);
  const permissionMode = useMemo(
    () => getPickerPermissionMode(activePermissionMode, executionPermissionMode, task.status),
    [activePermissionMode, executionPermissionMode, task.status],
  );

  // ── VS Code-style multi-pane state ──────────────────────────────
  const {
    paneState,
    hasPanesOpen,
    
    visiblePanes,
    handleOpenChat,
    handleOpenTerminal,
    handleOpenSubtaskPane,
    handleAddToViewport,
    handleClosePane,
    handleRemovePane,
    handleFocusPane,
    handleFocusMainChat,
    handleSplitWithNew,
    handleSetLayout,
    handleToggleSidebar,
    handleCloseAllPanes,
    handleRenamePane,
    handleAssignTaskToPane,
  } = usePaneState(task.id);

  // All tasks get the multi-pane UI (open subtask chats, terminals, etc.)
  const isParentTask = true;

  // Main pane — always the first visible pane for parent tasks
  const mainPane: PaneItem = useMemo(() => ({
    id: MAIN_PANE_ID,
    type: "chat" as const,
    label: task.title.length > 40 ? task.title.slice(0, 37) + "..." : task.title,
    taskId: task.id,
  }), [task.id, task.title]);

  // Effective visible panes:
  // - No panes in viewport → show main pane solo (default view)
  // - Panes in viewport → resolve MAIN_PANE_ID to the real mainPane with taskId
  const effectiveVisiblePanes = useMemo(() => {
    if (visiblePanes.length === 0) return [mainPane];
    return visiblePanes.map((p) => p.id === MAIN_PANE_ID ? mainPane : p);
  }, [mainPane, visiblePanes]);

  // Keyboard shortcuts for panes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && hasPanesOpen) {
        handleCloseAllPanes();
        e.stopPropagation();
        return;
      }
      if (e.key === "\\" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSplitWithNew();
      }
      if (["1", "2", "3", "4"].includes(e.key) && (e.metaKey || e.ctrlKey) && visiblePanes.length > 1) {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        const target = visiblePanes[idx];
        if (target) handleFocusPane(target.id);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [hasPanesOpen, handleCloseAllPanes, visiblePanes, handleFocusPane, handleSplitWithNew]);

  // Drawer width + resize are managed by the parent FeedView so the grid
  // layout can respond. We receive them as props.

  // Re-sync picker state when switching to a different task
  useEffect(() => {
    setActivePermissionMode(normalizePermissionMode(task.permissionMode, "bypassPermissions"));
    setExecutionPermissionMode(
      getExecutionPermissionMode(task.executionPermissionMode ?? task.permissionMode, "bypassPermissions"),
    );
    setModel(task.model ?? null);
    setThinkingEffort(task.thinkingEffort ?? "auto");
  }, [task.id, task.permissionMode, task.executionPermissionMode, task.model, task.thinkingEffort]);

  // Derive latest TodoWrite snapshot from streamed log entries.
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

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    // Handle image paste
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find((i) => i.type.startsWith("image/"));
    if (imageItem) {
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (file) {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUri = reader.result as string;
          setPastedChips((prev) => [...prev, {
            id: crypto.randomUUID(),
            kind: "image",
            label: buildImagePasteLabel(file.name),
            content: dataUri,
          }]);
        };
        reader.readAsDataURL(file);
      }
      return;
    }
    // Handle large text paste
    const text = e.clipboardData.getData("text/plain");
    if (shouldCapturePastedText(text)) {
      e.preventDefault();
      setPastedChips((prev) => [...prev, {
        id: crypto.randomUUID(),
        kind: "text",
        label: "",
        content: text,
      }]);
    }
  }, []);

  useEffect(() => {
    fetchLogEntries(task.id);
    fetchOutputFiles(task.id);
  }, [task.id, fetchLogEntries, fetchOutputFiles]);

  // Fetch .planning/ files for GSD tasks only; reset when switching tasks
  useEffect(() => {
    setPlanningFiles(null);
    setViewingPlanningDoc(null);
    if (task.level !== "gsd") return;
    fetch("/api/gsd/files")
      .then((r) => r.json())
      .then((data) => {
        if (data.projectFiles) setPlanningFiles(data);
      })
      .catch(() => {});
  }, [task.id, task.level]);

  const router = useRouter();
  const createTask = useTaskStore((s) => s.createTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const needsInput = taskNeedsInput(task);
  const isDone = isAchieved(task);
  const pendingApprovedBrief = extractPendingApprovedBriefFromLogs(logEntries);

  // Plan checkbox toggle: check/uncheck deliverable in brief.md + update matching subtask
  const handlePlanCheckboxToggle = useCallback(async (label: string, checked: boolean) => {
    if (!task.projectSlug) return;

    // 1. Update the brief.md checkbox
    try {
      await fetch("/api/briefs/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mark-deliverable",
          projectSlug: task.projectSlug,
          subtaskTitle: label,
          checked,
          parentId: task.id,
          clientId: task.clientId ?? null,
        }),
      });
    } catch { /* non-critical */ }

    // Note: subtask status is managed by the running processes themselves.
    // Plan checkboxes only update the brief.md file.
  }, [task.projectSlug, task.id, task.clientId, subtasks, updateTask]);

  // Fetch log entries for all subtasks so we can show question previews.
  // The subtask IDs list is stable across re-renders except when the set changes.
  const subtaskIdsKey = subtasks.map((s) => s.id).join(",");
  useEffect(() => {
    if (subtasks.length === 0) return;
    for (const st of subtasks) {
      fetchLogEntries(st.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtaskIdsKey, fetchLogEntries]);

  // Also fetch log entries for any tasks assigned to panes (may not be in subtasks yet)
  const paneTaskIds = paneState.openPanes.map((p) => p.taskId).filter(Boolean) as string[];
  const paneTaskIdsKey = paneTaskIds.join(",");
  useEffect(() => {
    for (const id of paneTaskIds) {
      fetchLogEntries(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneTaskIdsKey, fetchLogEntries]);

  const allLogEntries = useTaskStore((s) => s.logEntries);
  const childLogEntries: Record<string, LogEntry[]> = {};
  for (const st of subtasks) {
    childLogEntries[st.id] = allLogEntries[st.id] ?? [];
  }

  // For project/gsd parents: merge the parent's scoping log with every
  // subtask's run log, sorted by timestamp. Because all subtasks resume
  // into the parent's claudeSessionId, these are literally the same
  // conversation — the merged feed is what the user is actually talking to.
  // Each entry is tagged with sourceTaskId so we can scroll to a subtask's
  // section when clicking it.
  const anyChildRunning = subtasks.some((s) => s.status === "running");

  // Run a single subtask: POST /execute, fall back to direct queue update.
  const handleRunSubtask = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/tasks/${id}/execute`, { method: "POST" });
        if (res.ok) return;
      } catch { /* fall through */ }
      await updateTask(id, { status: "queued", needsInput: false, errorMessage: null });
    },
    [updateTask],
  );

  const handleRunAllSubtasks = useCallback(async () => {
    const backlog = subtasks.filter((s) => s.status === "backlog");
    for (const s of backlog) {
      await handleRunSubtask(s.id);
    }
  }, [subtasks, handleRunSubtask]);

  const parentOfCurrent = task.parentId ? allTasks.find((t) => t.id === task.parentId) : null;

  const handleFileUpload = useCallback(async (file: File) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("dir", "projects");
      const res = await fetch("/api/files/upload", { method: "POST", body: formData });
      if (!res.ok) return;
      const result = await res.json();
      setReplyAttachments((prev) => [...prev, { fileName: result.fileName, relativePath: result.relativePath }]);
    } catch { /* silently fail */ }
    finally { setIsUploading(false); }
  }, []);

  const handleSlashSelect = useCallback((cmd: SlashCommand) => {
    setShowSlashMenu(false);
    setSlashQuery("");
    setReplyText(cmd.command + " ");
  }, []);

  // Fetch prompt tags for inline reply @-tag menu
  useEffect(() => {
    fetch("/api/prompt-tags")
      .then((r) => r.json())
      .then((data) => setInlinePromptTags((data.tags ?? []).map((t: { name: string; body: string; category?: string; description?: string }) => ({ name: t.name, body: t.body, category: t.category, description: t.description }))))
      .catch(() => {});
  }, []);

  const handleReplyChange = useCallback((value: string) => {
    setReplyText(value);
    if (value.startsWith("/")) {
      setShowSlashMenu(true);
      setSlashQuery(value);
      setShowInlineTagMenu(false);
    } else {
      setShowSlashMenu(false);
      setSlashQuery("");
    }
    // Detect @tag trigger in inline reply (cursor-aware)
    const el = replyTextareaRef.current;
    if (!value.startsWith("/")) {
      const cursor = el?.selectionStart ?? value.length;
      const before = value.slice(0, cursor);
      const match = before.match(/(^|[\s])@([\w\/-]*)$/);
      if (match) {
        setShowInlineTagMenu(true);
        setInlineTagQuery(match[2]);
        setShowSlashMenu(false);
      } else {
        setShowInlineTagMenu(false);
        setInlineTagQuery("");
      }
    }
  }, []);

  const handleInsertPastedText = useCallback((chip: PastedChip) => {
    const textarea = replyTextareaRef.current;
    const selectionStart = textarea?.selectionStart ?? replyText.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    const insertion = insertPastedTextAtSelection(
      replyText,
      chip.content,
      selectionStart,
      selectionEnd,
    );

    setReplyText(insertion.value);
    setPastedChips((prev) => removePendingPastedText(prev, chip.id));
    requestAnimationFrame(() => {
      replyTextareaRef.current?.focus();
      replyTextareaRef.current?.setSelectionRange(insertion.selectionStart, insertion.selectionEnd);
      syncComposerTextareaHeight(replyTextareaRef.current, {
        minHeight: replyMinHeight,
        maxHeight: replyMaxHeight,
        targetHeight: hasReplyComposerResize ? replyComposerHeight : null,
      });
      syncReplyMirrorScroll();
    });
  }, [hasReplyComposerResize, replyComposerHeight, replyMaxHeight, replyMinHeight, replyText, syncReplyMirrorScroll]);

  const handlePermissionModeChange = useCallback((nextMode: "bypassPermissions" | "default" | "plan") => {
    const nextState = getPermissionStateForPickerChange(
      nextMode,
      activePermissionMode,
      executionPermissionMode,
      "bypassPermissions",
    );
    setActivePermissionMode(nextState.permissionMode);
    setExecutionPermissionMode(nextState.executionPermissionMode);
    void updateTask(task.id, nextState);
  }, [activePermissionMode, executionPermissionMode, task.id, updateTask]);

  const handleModelChange = useCallback((nextModel: ClaudeModel | null) => {
    const nextThinkingEffort = normalizeClaudeThinkingEffortForModel(nextModel, thinkingEffort) ?? "auto";
    setModel(nextModel);
    setThinkingEffort(nextThinkingEffort);
    saveClaudeLlmPreference({
      model: nextModel,
      reasoningEffort: nextThinkingEffort,
    });
    void updateTask(task.id, { model: nextModel, thinkingEffort: nextThinkingEffort });
  }, [task.id, thinkingEffort, updateTask]);

  const handleThinkingEffortChange = useCallback((nextThinkingEffort: ClaudeThinkingEffort) => {
    const normalizedThinkingEffort =
      normalizeClaudeThinkingEffortForModel(model, nextThinkingEffort) ?? "auto";
    setThinkingEffort(normalizedThinkingEffort);
    saveClaudeLlmPreference({
      model: model ?? undefined,
      reasoningEffort: normalizedThinkingEffort,
    });
    void updateTask(task.id, { thinkingEffort: normalizedThinkingEffort });
  }, [model, task.id, updateTask]);

  const handleReply = async () => {
    const trimmed = replyText.trim();
    if ((!trimmed && replyAttachments.length === 0 && pastedChips.length === 0) || isSending) return;
    setIsSending(true);

    let fullMessage = appendPendingPastedText(
      trimmed,
      pastedChips
        .filter((chip) => chip.kind === "text")
        .map((chip) => ({ id: chip.id, text: chip.content })),
    );

    // Append pasted images as data URIs
    const pastedImages = pastedChips.filter((c) => c.kind === "image");
    if (pastedImages.length > 0) {
      const imageBlock = pastedImages.map((c) => `[Pasted image: ${c.label}]\n${c.content}`).join("\n\n");
      fullMessage = fullMessage ? `${fullMessage}\n\n${imageBlock}` : imageBlock;
    }

    if (replyAttachments.length > 0) {
      const paths = replyAttachments.map((a) => `- ${a.relativePath}`).join("\n");
      fullMessage = fullMessage ? `${fullMessage}\n\nAttached files:\n${paths}` : `Attached files:\n${paths}`;
    }

    setReplyText("");
    setReplyAttachments([]);
    setPastedChips([]);

    appendLogEntry(task.id, {
      id: "local-" + crypto.randomUUID(),
      type: "user_reply",
      content: fullMessage,
      timestamp: new Date().toISOString(),
      permissionMode: activePermissionMode === "plan" ? "plan" : permissionMode,
    });

    try {
      await fetch(`/api/tasks/${task.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: fullMessage,
          permissionMode: activePermissionMode === "plan" ? "plan" : permissionMode,
          executionPermissionMode,
          model,
          thinkingEffort,
        }),
      });
    } catch { /* silently fail */ }
    finally {
      setIsSending(false);
    }
  };

  return (
    <div
      data-card
      style={
        isFullscreen
          ? {
              // Full-screen overlay mode — cover the viewport so the user can
              // focus entirely on the conversation + files for a tall task.
              position: "fixed",
              top: 16,
              left: 16,
              right: 16,
              bottom: 16,
              background: "white",
              border: "1.5px solid var(--border)",
              borderRadius: 10,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              zIndex: 1000,
              boxShadow: "0 20px 60px color-mix(in srgb, var(--foreground) 25%, transparent)",
            }
          : {
              // Drawer mode — fixed overlay covering the full viewport height
              // including the nav and goal bar. The page content reflows via
              // marginRight on the FeedView wrapper.
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: drawerWidth ?? 720,
              maxWidth: "100vw",
              background: "white",
              borderLeft: "1px solid var(--border)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              zIndex: 100,
              boxShadow: "-4px 0 24px color-mix(in srgb, var(--foreground) 8%, transparent)",
            }
      }
    >
      {/* Left-edge resize handle (drawer mode only) */}
      {!isFullscreen && onStartDrawerDrag && (
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

      {/* Header bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 16px",
        borderBottom: "1px solid var(--border)",
        background: "var(--card)",
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flex: 1,
          minWidth: 0,
        }}>
          {parentOfCurrent && onNavigateToParent ? (
            <button
              onClick={() => onNavigateToParent(parentOfCurrent.id)}
              title={`Back to ${parentOfCurrent.title}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 8px",
                fontSize: 10,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                color: "var(--primary)",
                background: "color-mix(in srgb, var(--foreground) 6%, transparent)",
                border: "1px solid color-mix(in srgb, var(--foreground) 20%, transparent)",
                borderRadius: 5,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <ArrowLeft size={10} />
              parent
            </button>
          ) : (
            <InlineTitle title={task.title} taskId={task.id} color="var(--foreground)" />
          )}
          {task.level === "gsd" && task.phaseNumber != null && task.gsdStep && parentOfCurrent && (
            <span style={{
              display: "inline-block",
              fontSize: 10,
              fontWeight: 600,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              padding: "4px 8px",
              borderRadius: 4,
              backgroundColor: "var(--muted)",
              color: "var(--muted-foreground)",
              flexShrink: 0,
            }}>
              Phase {task.phaseNumber} · {task.gsdStep}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {task.model && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "4px 8px",
                fontSize: 10,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontWeight: 500,
                color: "var(--muted-foreground)",
                background: "color-mix(in srgb, var(--foreground) 12%, transparent)",
                borderRadius: 4,
                cursor: "default",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {task.model}
            </span>
          )}
          {task.thinkingEffort && task.thinkingEffort !== "auto" && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "4px 8px",
                fontSize: 10,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontWeight: 500,
                color: "var(--muted-foreground)",
                background: "color-mix(in srgb, var(--foreground) 10%, transparent)",
                borderRadius: 4,
                cursor: "default",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {task.thinkingEffort}
            </span>
          )}
          {onToggleFullscreen && (
            <button
              onClick={onToggleFullscreen}
              title={isFullscreen ? "Exit full screen" : "Full screen"}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--muted-foreground)",
                padding: "4px",
                display: "flex",
                alignItems: "center",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--foreground)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--border)"; }}
            >
              {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          )}
          <button
            onClick={onClose}
            title="Close"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--muted-foreground)",
              padding: "4px",
              display: "flex",
              alignItems: "center",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--foreground)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--border)"; }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Subtask status strip removed — subtasks accessible from bottom of chat */}

      {/* Scoping wizard — shown inline when a project goal needs planning */}
      {pendingScope && (
        <ScopingWizardInline
          scope={pendingScope.scope}
          goal={pendingScope.goal}
          clientId={task.clientId ?? undefined}
          onClose={onClose}
          onCreated={async (result) => {
            // Update this task to point at the new project
            await updateTask(task.id, { projectSlug: result.projectSlug });
            onScopeComplete?.();
          }}
        />
      )}

      {/* Body: tabbed — Chat / Subtasks / Files. Each tab fills the full
          drawer height. Chat lays out as flex column so the conversation
          scrolls and the reply input pins to the bottom. */}
      {!pendingScope && (<div style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        flex: 1,
      }}>
        {/* Tab bar */}
        <div style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid var(--border)",
          padding: "0 16px",
          flexShrink: 0,
        }}>
          {([
            { key: "chat" as const, label: "Chat" },
            { key: "files" as const, label: `Files (${(task.projectSlug ? 1 : 0) + outputFiles.length + (task.level === "gsd" && planningFiles ? planningFiles.projectFiles.length + planningFiles.phases.reduce((n, p) => n + p.files.length, 0) + planningFiles.researchFiles.length : 0)})` },
            ...(task.projectSlug ? [{ key: "plan" as const, label: "Plan" }] : []),
          ]).map((t) => (
            <div key={t.key} style={{ display: "flex", alignItems: "center" }}>
              <button
                onClick={() => {
                  if (t.key === "plan" && planDocked) {
                    // Clicking Plan tab text when docked → undock (full-screen plan view)
                    setPlanDocked(false);
                  }
                  setMainTab(t.key);
                }}
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: mainTab === t.key || (t.key === "plan" && planDocked) ? "var(--foreground)" : "var(--border)",
                  background: "transparent",
                  border: "none",
                  borderBottom: mainTab === t.key ? "2px solid var(--primary)" : (t.key === "plan" && planDocked ? "2px solid color-mix(in srgb, var(--foreground) 30%, transparent)" : "2px solid transparent"),
                  padding: "8px 12px 8px",
                  cursor: "pointer",
                  marginBottom: -1,
                }}
              >
                {t.label}
              </button>
              {t.key === "plan" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (planDocked) {
                      setPlanDocked(false);
                    } else {
                      setPlanDocked(true);
                      setMainTab("chat");
                    }
                  }}
                  title={planDocked ? "Undock plan" : "Dock plan to chat"}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: planDocked ? "var(--primary)" : "var(--border)",
                    padding: "4px 4px 4px 0",
                    display: "flex",
                    alignItems: "center",
                    marginBottom: -1,
                  }}
                >
                  {planDocked ? <PanelRightClose size={13} /> : <PanelRight size={13} />}
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Chat tab */}
        {mainTab === "chat" && (
        <div
          ref={dockedContainerRef}
          style={{
          minWidth: 0,
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: planDocked && task.projectSlug ? "row" : "column",
          position: "relative",
        }}>
        <div style={{
          padding: 16,
          minWidth: 0,
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}>
          {isParentTask ? (
            (() => {
              return (
                <>
                {/* Main content area: always PaneContainer */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", minHeight: 0 }}>
                  <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
                  <div
                    ref={activityRef}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      overflow: "hidden",
                      minWidth: 0,
                      background: "var(--card)",
                      minHeight: 0,
                    }}
                  >
                    <PaneContainer
                      visiblePanes={effectiveVisiblePanes}
                      allTasks={allTasks}
                      logEntriesByTask={allLogEntries}
                      activePaneId={paneState.activePaneId}
                      layout={paneState.layout}
                      parentTask={task}
                      onFocusPane={handleFocusPane}
                      onClosePane={handleClosePane}
                      onSetLayout={handleSetLayout}
                      onDropPane={handleAddToViewport}
                      onPreviewFile={(f) => setPreviewFile({ relativePath: f.relativePath, extension: f.extension })}
                      onRenamePane={handleRenamePane}
                      onAssignTaskToPane={handleAssignTaskToPane}
                      subtasks={subtasks.map((s) => ({ id: s.id, title: s.title, status: s.status, phaseNumber: s.phaseNumber, gsdStep: s.gsdStep, needsInput: s.needsInput }))}
                      onSelectSubtask={(id) => {
                        setMainTab("chat");
                        handleOpenSubtaskPane(id, subtasks.find((s) => s.id === id)?.title ?? "Subtask");
                      }}
                      onRunSubtask={handleRunSubtask}
                      onRunAll={handleRunAllSubtasks}
                      onMarkTaskDone={(taskId) => updateTask(taskId, { status: "done", needsInput: false })}
                    />
                  </div>

                  {/* Pane sidebar — shows open panes, + to add new chat/terminal */}
                  {isParentTask && (
                    <ChatList
                      openPanes={paneState.openPanes}
                      activePaneId={paneState.activePaneId}
                      visiblePaneIds={paneState.visiblePaneIds}
                      collapsed={paneState.sidebarCollapsed}
                      parentTaskTitle={task.title}
                      onToggleCollapse={handleToggleSidebar}
                      onFocusPane={handleFocusPane}
                      onFocusMainChat={handleFocusMainChat}
                      onRemovePane={handleRemovePane}
                      onAddToViewport={handleAddToViewport}
                      onRenamePane={handleRenamePane}
                      onOpenChat={handleOpenChat}
                      onOpenTerminal={handleOpenTerminal}
                      mainTaskId={task.id}
                    />
                  )}
                  </div>
                </div>
                </>
              );
            })()
          ) : logEntries.length > 0 || task.status === "running" ? (
            <>
            <div style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
              border: "1px solid var(--border)",
              borderRadius: 8,
              overflow: "hidden",
              background: "var(--card)",
            }}>
              <ModalChat
                taskId={task.id}
                logEntries={logEntries}
                isRunning={task.status === "running"}
                needsInput={needsInput}
                status={task.status}
                childTasks={[]}
                childLogEntries={{}}
                activePreviewPath={previewFile?.relativePath ?? null}
                onPreviewFile={(f) => setPreviewFile({ relativePath: f.relativePath, extension: f.extension })}
                readOnly
                permissionMode={task.permissionMode}
                activityLabel={task.activityLabel}
                startedAt={task.startedAt}
                lastReplyAt={task.lastReplyAt}
                costUsd={task.costUsd}
                tokensUsed={task.tokensUsed}
                errorMessage={task.errorMessage}
                durationMs={task.durationMs}
                onRefresh={() => fetchLogEntries(task.id)}
              />
            </div>
            </>
          ) : (
            <SuggestedActions
              status={task.status}
              onSelect={(prompt) => {
                setReplyText(prompt);
                requestAnimationFrame(() => replyTextareaRef.current?.focus());
              }}
            />
          )}

          {/* Leaf reply input — always shown for leaf tasks so the user can
              reply/follow up whenever the detail panel is open. Covers every
              state (needsInput, running, review, done, queued, backlog,
              error), including edge cases like queued-with-needsInput. */}
          {!isParentTask && (
            <div style={{
              marginTop: 12,
              flexShrink: 0,
              background: "var(--muted)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              overflow: "visible",
            }}>
              {/* Attachment + pasted chips */}
              {(replyAttachments.length > 0 || pastedChips.length > 0) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 10px 0" }}>
                  {pastedChips.some((chip) => chip.kind === "text") && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {pastedChips.filter((chip) => chip.kind === "text").map((chip) => (
                        <PastedTextCard
                          key={chip.id}
                          text={chip.content}
                          onInsert={() => handleInsertPastedText(chip)}
                          onRemove={() => setPastedChips((prev) => removePendingPastedText(prev, chip.id))}
                        />
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {replyAttachments.map((a) => (
                      <div key={a.relativePath} style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "4px 8px",
                        borderRadius: 4,
                        backgroundColor: "var(--muted)",
                        fontSize: 11,
                        color: "var(--muted-foreground)",
                      }}>
                        <Paperclip size={10} />
                        <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {a.fileName}
                        </span>
                        <button
                          onClick={() => setReplyAttachments((prev) => prev.filter((x) => x.relativePath !== a.relativePath))}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", color: "var(--muted-foreground)" }}
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                    {pastedChips.filter((chip) => chip.kind === "image").map((chip) => (
                      <div key={chip.id} style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "4px 8px",
                        borderRadius: 4,
                        backgroundColor: "color-mix(in srgb, var(--foreground) 6%, transparent)",
                        fontSize: 11,
                        color: "var(--primary)",
                        fontFamily: "var(--font-inter), Inter, sans-serif",
                      }}>
                        <span style={{ fontSize: 10 }}>&var(--muted-foreground);</span>
                        <span>Pasted {chip.label}</span>
                        <button
                          onClick={() => setPastedChips((prev) => removePendingPastedText(prev, chip.id))}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", color: "var(--muted-foreground)" }}
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Hidden file input */}
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

              {/* Textarea on top */}
              <div style={{ position: "relative", padding: "10px 12px 6px" }}>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
                  <button
                    type="button"
                    aria-label="Drag to resize input"
                    onPointerDown={handleReplyResizePointerDown}
                    style={{
                      width: 44,
                      height: 8,
                      border: "none",
                      borderRadius: 999,
                      backgroundColor: "color-mix(in srgb, var(--foreground) 32%, transparent)",
                      cursor: "ns-resize",
                    }}
                  />
                </div>
                {showInlineTagMenu && inlinePromptTags.length > 0 && (
                  <SlashCommandMenu
                    query={inlineTagQuery}
                    onSelect={() => {}}
                    onClose={() => { setShowInlineTagMenu(false); setInlineTagQuery(""); }}
                    anchor="above"
                    mode="tag"
                    tagItems={inlinePromptTags.filter((t) => !inlineTagQuery || t.name.toLowerCase().includes(inlineTagQuery.toLowerCase()))}
                    onTagSelect={(tag) => {
                      const el = replyTextareaRef.current;
                      const cursor = el?.selectionStart ?? replyText.length;
                      const before = replyText.slice(0, cursor);
                      const after = replyText.slice(cursor);
                      const replaced = before.replace(/(^|[\s])@[\w\/-]*$/, `$1@${tag.name} `);
                      setReplyText(replaced + after);
                      setShowInlineTagMenu(false);
                      setInlineTagQuery("");
                      el?.focus();
                    }}
                  />
                )}
                <div style={{ position: "relative", minWidth: 0, overflow: "hidden" }}>
                  {(replyText.includes("@") || replyText.includes("/")) && (
                    <HighlightMirror
                      text={replyText}
                      scrollTop={replyMirrorScroll.top}
                      scrollLeft={replyMirrorScroll.left}
                      style={{
                        fontSize: 13,
                        fontFamily: "inherit",
                        padding: "4px 0",
                        lineHeight: 1.5,
                      }}
                    />
                  )}
                  <textarea
                    ref={replyTextareaRef}
                    value={replyText}
                    onChange={(e) => handleReplyChange(e.target.value)}
                    onPaste={handlePaste}
                    onScroll={syncReplyMirrorScroll}
                    onKeyDown={(e) => {
                      if ((showSlashMenu || showInlineTagMenu) && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) return;
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleReply();
                      }
                    }}
                    placeholder="Reply...  Type / for commands, @ for tags"
                    rows={3}
                    style={{
                      width: "100%",
                      fontSize: 13,
                      fontFamily: "inherit",
                      padding: "4px 0",
                      minHeight: replyMinHeight,
                      maxHeight: hasReplyComposerResize ? replyComposerHeight : replyMaxHeight,
                      backgroundColor: "transparent",
                      border: "none",
                      color: (replyText.includes("@") || replyText.includes("/")) ? "transparent" : "var(--foreground)",
                      caretColor: "var(--foreground)",
                      outline: "none",
                      resize: "none",
                      boxSizing: "border-box" as const,
                      lineHeight: 1.5,
                      maxWidth: "100%",
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                      wordBreak: "break-word",
                      position: "relative",
                      zIndex: 1,
                      overflowX: "hidden",
                      overflowY: "auto",
                    }}
                  />
                </div>
                {showSlashMenu && (
                  <SlashCommandMenu
                    query={slashQuery}
                    onSelect={handleSlashSelect}
                    onClose={() => { setShowSlashMenu(false); setSlashQuery(""); }}
                    anchor="above"
                  />
                )}
              </div>

              {/* Controls strip — bottom */}
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "8px 8px",
                borderTop: "1px solid var(--border)",
              }}>
                {/* Attach (left, primary) */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  title="Attach file"
                  style={{
                    width: 28,
                    height: 26,
                    borderRadius: 6,
                    border: "none",
                    background: replyAttachments.length > 0 ? "color-mix(in srgb, var(--foreground) 8%, transparent)" : "transparent",
                    color: replyAttachments.length > 0 ? "var(--primary)" : "var(--muted-foreground)",
                    cursor: isUploading ? "wait" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    opacity: isUploading ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!isUploading && replyAttachments.length === 0)
                      e.currentTarget.style.background = "color-mix(in srgb, var(--foreground) 4%, transparent)";
                  }}
                  onMouseLeave={(e) => {
                    if (replyAttachments.length === 0)
                      e.currentTarget.style.background = "transparent";
                  }}
                >
                  <Paperclip size={14} />
                </button>

                <ModelPicker value={model} onChange={handleModelChange} />
                <ThinkingEffortPicker value={thinkingEffort} model={model} onChange={handleThinkingEffortChange} />
                <PermissionPicker value={permissionMode} onChange={handlePermissionModeChange} />
                {task.level !== "task" && (
                <TasksPopover
                  todos={latestTodos}
                  subtasks={subtasks.map((s) => ({ id: s.id, title: s.title, status: s.status, phaseNumber: s.phaseNumber, gsdStep: s.gsdStep, needsInput: s.needsInput }))}
                  onSelectSubtask={onSelectSubtask}
                />
                )}

                <div style={{ flex: 1 }} />

                <button
                  type="button"
                  onClick={handleReply}
                  disabled={(!replyText.trim() && replyAttachments.length === 0 && pastedChips.length === 0) || isSending}
                  title="Send"
                  style={{
                    width: 28,
                    height: 26,
                    borderRadius: 6,
                    border: "none",
                    background: (replyText.trim() || replyAttachments.length > 0 || pastedChips.length > 0) && !isSending
                      ? "linear-gradient(135deg, var(--primary), var(--primary))"
                      : "var(--border)",
                    color: (replyText.trim() || replyAttachments.length > 0 || pastedChips.length > 0) && !isSending ? "var(--card)" : "var(--muted-foreground)",
                    cursor: (replyText.trim() || replyAttachments.length > 0 || pastedChips.length > 0) && !isSending ? "pointer" : "default",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    fontSize: 14,
                  }}
                >
                  &#8593;
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Docked plan panel — shown alongside chat */}
        {planDocked && task.projectSlug && (
          <>
          {/* Drag handle between chat and plan */}
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              planDraggingRef.current = true;
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
            style={{
              width: 6,
              cursor: "col-resize",
              flexShrink: 0,
              position: "relative",
              zIndex: 10,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget.firstChild as HTMLElement | null)?.style?.setProperty("background", "var(--primary)");
            }}
            onMouseLeave={(e) => {
              if (!planDraggingRef.current) {
                (e.currentTarget.firstChild as HTMLElement | null)?.style?.setProperty("background", "transparent");
              }
            }}
          >
            <div style={{
              position: "absolute",
              left: 2,
              top: 0,
              bottom: 0,
              width: 2,
              borderRadius: 1,
              background: "transparent",
              transition: "background 150ms",
            }} />
          </div>
          <div style={{
            width: `${dockedPlanPct}%`,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 12px",
              borderBottom: "1px solid var(--border)",
              background: "var(--muted)",
              flexShrink: 0,
            }}>
              <span style={{
                fontSize: 10,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--muted-foreground)",
              }}>Plan</span>
              <button
                onClick={() => setPlanDocked(false)}
                title="Undock plan"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--muted-foreground)",
                  display: "flex",
                  padding: 4,
                }}
              >
                <PanelRightClose size={13} />
              </button>
            </div>
            {pendingApprovedBrief ? (
              <DraftPlanPreviewPanel
                content={pendingApprovedBrief}
                onExpand={() => setShowDraftPlanModal(true)}
              />
            ) : (
              <FilePreviewInline
                relativePath={`projects/briefs/${task.projectSlug}/brief.md`}
                extension="md"
                clientId={task.clientId}
                onClose={() => setPlanDocked(false)}
                fillHeight
                onCheckboxToggle={handlePlanCheckboxToggle}
                editable
              />
            )}
          </div>
          </>
        )}
        </div>

        )}

        {/* Plan tab — show brief.md for project tasks (full-screen) */}
        {mainTab === "plan" && task.projectSlug && (
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {pendingApprovedBrief ? (
              <DraftPlanPreviewPanel
                content={pendingApprovedBrief}
                onExpand={() => setShowDraftPlanModal(true)}
              />
            ) : (
              <FilePreviewInline
                relativePath={`projects/briefs/${task.projectSlug}/brief.md`}
                extension="md"
                clientId={task.clientId}
                onClose={() => setMainTab("chat")}
                fillHeight
                onCheckboxToggle={handlePlanCheckboxToggle}
                editable
              />
            )}
            {!planDocked && (
              <div style={{ padding: "8px 12px", borderTop: "1px solid var(--border)", background: "var(--muted)", flexShrink: 0 }}>
                <button
                  onClick={() => { setPlanDocked(true); setMainTab("chat"); }}
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    color: "var(--primary)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <PanelRight size={13} />
                  Dock to chat
                </button>
              </div>
            )}
          </div>
        )}

        {/* Subtasks tab removed — subtasks accessible from bottom of chat */}

        {/* Files tab */}
        {mainTab === "files" && (
        <div style={{
          padding: 16,
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Brief / Plan file — pinned at top for project tasks */}
              {task.projectSlug && (
                <div style={{ marginBottom: 4 }}>
                  <div style={{ fontSize: 9, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--muted-foreground)", letterSpacing: "0.06em", marginBottom: 4, textTransform: "uppercase" }}>
                    Plan
                  </div>
                  <button
                    onClick={() => {
                      const briefPath = `projects/briefs/${task.projectSlug}/brief.md`;
                      setPreviewFile(previewFile?.relativePath === briefPath ? null : { relativePath: briefPath, extension: "md" });
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, width: "100%",
                      background: previewFile?.relativePath === `projects/briefs/${task.projectSlug}/brief.md` ? "color-mix(in srgb, var(--foreground) 6%, transparent)" : "transparent",
                      border: "none", borderRadius: 4, cursor: "pointer",
                      padding: "4px 8px", fontSize: 11, color: "var(--muted-foreground)", textAlign: "left",
                      fontFamily: "var(--font-inter), Inter, sans-serif", transition: "background 100ms ease",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--foreground) 3%, transparent)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = previewFile?.relativePath === `projects/briefs/${task.projectSlug}/brief.md` ? "color-mix(in srgb, var(--foreground) 6%, transparent)" : "transparent"; }}
                  >
                    <FileText size={10} color="var(--primary)" />
                    brief.md
                  </button>
                </div>
              )}
              {/* Planning files for GSD tasks only */}
              {task.level === "gsd" && planningFiles && (
                <>
                  {/* Project-level docs */}
                  {planningFiles.projectFiles.length > 0 && (
                    <div style={{ marginBottom: 4 }}>
                      <div style={{ fontSize: 9, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--muted-foreground)", letterSpacing: "0.06em", marginBottom: 4, textTransform: "uppercase" }}>
                        Project
                      </div>
                      {planningFiles.projectFiles.map((f) => (
                        <div key={f.relativePath}>
                          <button
                            onClick={() => setViewingPlanningDoc(viewingPlanningDoc === f.relativePath ? null : f.relativePath)}
                            style={{
                              display: "flex", alignItems: "center", gap: 8, width: "100%",
                              background: viewingPlanningDoc === f.relativePath ? "color-mix(in srgb, var(--foreground) 6%, transparent)" : "transparent",
                              border: "none", borderRadius: 4, cursor: "pointer",
                              padding: "4px 8px", fontSize: 11, color: "var(--muted-foreground)", textAlign: "left",
                              fontFamily: "var(--font-inter), Inter, sans-serif", transition: "background 100ms ease",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--foreground) 3%, transparent)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = viewingPlanningDoc === f.relativePath ? "color-mix(in srgb, var(--foreground) 6%, transparent)" : "transparent"; }}
                          >
                            <FileText size={10} color="var(--border)" />
                            {f.name}
                          </button>
                          {viewingPlanningDoc === f.relativePath && (
                            <PlanningDocViewer relativePath={f.relativePath} onClose={() => setViewingPlanningDoc(null)} />
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Per-phase docs */}
                  {planningFiles.phases.map((phase) => (
                    <div key={phase.phaseNumber} style={{ marginBottom: 4 }}>
                      <div style={{ fontSize: 9, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--muted-foreground)", letterSpacing: "0.06em", marginBottom: 4, textTransform: "uppercase" }}>
                        Phase {phase.phaseNumber}
                      </div>
                      {phase.files.map((f) => (
                        <div key={f.relativePath}>
                          <button
                            onClick={() => setViewingPlanningDoc(viewingPlanningDoc === f.relativePath ? null : f.relativePath)}
                            style={{
                              display: "flex", alignItems: "center", gap: 8, width: "100%",
                              background: viewingPlanningDoc === f.relativePath ? "color-mix(in srgb, var(--foreground) 6%, transparent)" : "transparent",
                              border: "none", borderRadius: 4, cursor: "pointer",
                              padding: "4px 8px", fontSize: 11, color: "var(--muted-foreground)", textAlign: "left",
                              fontFamily: "var(--font-inter), Inter, sans-serif", transition: "background 100ms ease",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--foreground) 3%, transparent)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = viewingPlanningDoc === f.relativePath ? "color-mix(in srgb, var(--foreground) 6%, transparent)" : "transparent"; }}
                          >
                            <FileText size={10} color="var(--border)" />
                            {f.name}
                          </button>
                          {viewingPlanningDoc === f.relativePath && (
                            <PlanningDocViewer relativePath={f.relativePath} onClose={() => setViewingPlanningDoc(null)} />
                          )}
                        </div>
                      ))}
                    </div>
                  ))}

                  {/* Research docs */}
                  {planningFiles.researchFiles.length > 0 && (
                    <div style={{ marginBottom: 4 }}>
                      <div style={{ fontSize: 9, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--muted-foreground)", letterSpacing: "0.06em", marginBottom: 4, textTransform: "uppercase" }}>
                        Research
                      </div>
                      {planningFiles.researchFiles.map((f) => (
                        <div key={f.relativePath}>
                          <button
                            onClick={() => setViewingPlanningDoc(viewingPlanningDoc === f.relativePath ? null : f.relativePath)}
                            style={{
                              display: "flex", alignItems: "center", gap: 8, width: "100%",
                              background: viewingPlanningDoc === f.relativePath ? "color-mix(in srgb, var(--foreground) 6%, transparent)" : "transparent",
                              border: "none", borderRadius: 4, cursor: "pointer",
                              padding: "4px 8px", fontSize: 11, color: "var(--muted-foreground)", textAlign: "left",
                              fontFamily: "var(--font-inter), Inter, sans-serif", transition: "background 100ms ease",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--foreground) 3%, transparent)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = viewingPlanningDoc === f.relativePath ? "color-mix(in srgb, var(--foreground) 6%, transparent)" : "transparent"; }}
                          >
                            <FileText size={10} color="var(--border)" />
                            {f.name}
                          </button>
                          {viewingPlanningDoc === f.relativePath && (
                            <PlanningDocViewer relativePath={f.relativePath} onClose={() => setViewingPlanningDoc(null)} />
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Separator between planning files and output files */}
                  {outputFiles.length > 0 && (
                    <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                  )}
                </>
              )}

              {/* Regular output files — with diff status badges + filter */}
              {outputFiles.length === 0 && !(task.level === "gsd" && planningFiles) ? (
                <div style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "var(--font-inter), Inter, sans-serif", padding: "8px 0" }}>
                  No files yet
                </div>
              ) : (
                <>
                {outputFiles.some((f) => f.diffStatus && f.diffStatus !== "unchanged") && (
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
                    <button
                      onClick={() => setChangedOnly(!changedOnly)}
                      style={{
                        fontSize: 10,
                        fontFamily: "var(--font-inter), Inter, sans-serif",
                        padding: "4px 8px",
                        borderRadius: 4,
                        border: changedOnly ? "1px solid color-mix(in srgb, var(--foreground) 30%, transparent)" : "1px solid var(--border)",
                        background: changedOnly ? "color-mix(in srgb, var(--foreground) 6%, transparent)" : "transparent",
                        color: changedOnly ? "var(--primary)" : "var(--muted-foreground)",
                        cursor: "pointer",
                        transition: "all 120ms ease",
                      }}
                    >
                      {changedOnly ? "Show all" : "Changed only"}
                    </button>
                  </div>
                )}
                {(changedOnly ? outputFiles.filter((f) => f.diffStatus !== "unchanged") : outputFiles).map((file) => {
                  const canPreview = PREVIEWABLE.has(file.extension);
                  const isActive = previewFile?.relativePath === file.relativePath;
                  const diffBadge = file.diffStatus === "added" ? { label: "A", color: "var(--muted-foreground)", bg: "color-mix(in srgb, var(--foreground) 10%, transparent)" }
                    : file.diffStatus === "modified" ? { label: "M", color: "var(--muted-foreground)", bg: "color-mix(in srgb, var(--foreground) 10%, transparent)" }
                    : null;
                  // Build breadcrumb from path
                  const pathParts = file.relativePath.split("/").filter(Boolean);
                  const breadcrumb = pathParts.length > 1 ? pathParts.slice(0, -1).join(" / ") : "";
                  const docsHref = `/?tab=docs&file=${encodeURIComponent(file.relativePath)}`;
                  return (
                    <div key={file.id}>
                      <div style={{
                        padding: "8px 12px",
                        borderRadius: 8,
                        backgroundColor: isActive ? "color-mix(in srgb, var(--foreground) 5%, transparent)" : "var(--muted)",
                        border: isActive ? "1px solid color-mix(in srgb, var(--foreground) 20%, transparent)" : "1px solid color-mix(in srgb, var(--foreground) 15%, transparent)",
                        transition: "background 150ms ease",
                      }}>
                        {/* Main row: icon + name + extension + size */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{
                            width: 28, height: 28, borderRadius: 5, backgroundColor: "var(--border)",
                            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                          }}>
                            <span style={{ fontSize: 8, color: "var(--muted-foreground)", fontFamily: "var(--font-inter), Inter, sans-serif" }}>
                              .{file.extension.length > 6 ? file.extension.slice(0, 5) + "\u2026" : file.extension}
                            </span>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{
                                fontSize: 12, fontWeight: 500, color: "var(--foreground)", overflow: "hidden",
                                textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
                              }}>
                                {file.fileName}
                              </span>
                              {diffBadge && (
                                <span style={{
                                  fontSize: 9, fontWeight: 700, fontFamily: "var(--font-inter), Inter, sans-serif",
                                  color: diffBadge.color, background: diffBadge.bg,
                                  padding: "0 4px", borderRadius: 3, flexShrink: 0,
                                }}>
                                  {diffBadge.label}
                                </span>
                              )}
                            </div>
                            {breadcrumb && (
                              <div style={{
                                fontSize: 10, color: "var(--muted-foreground)", fontFamily: "var(--font-inter), Inter, sans-serif",
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 4,
                              }}>
                                {breadcrumb}
                              </div>
                            )}
                          </div>
                        </div>
                        {/* Action row: preview, docs, download */}
                        <div style={{
                          display: "flex", alignItems: "center", gap: 4,
                          marginTop: 8, paddingTop: 8, borderTop: "1px solid color-mix(in srgb, var(--foreground) 15%, transparent)",
                        }}>
                          {canPreview && (
                            <button
                              onClick={() => setPreviewFile(isActive ? null : { relativePath: file.relativePath, extension: file.extension })}
                              title="Preview"
                              style={{
                                display: "flex", alignItems: "center", gap: 4,
                                background: "none", border: "none", cursor: "pointer",
                                color: isActive ? "var(--primary)" : "var(--muted-foreground)", fontSize: 10,
                                fontFamily: "var(--font-inter), Inter, sans-serif", padding: "4px 8px", borderRadius: 4,
                                transition: "color 0.15s, background 0.15s",
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--primary)"; e.currentTarget.style.background = "color-mix(in srgb, var(--foreground) 6%, transparent)"; }}
                              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = "var(--muted-foreground)"; e.currentTarget.style.background = "transparent"; }}
                            >
                              <Eye size={11} /> Preview
                            </button>
                          )}
                          <a
                            href={docsHref}
                            title="Open in Docs"
                            style={{
                              display: "flex", alignItems: "center", gap: 4,
                              color: "var(--muted-foreground)", fontSize: 10, textDecoration: "none",
                              fontFamily: "var(--font-inter), Inter, sans-serif", padding: "4px 8px", borderRadius: 4,
                              transition: "color 0.15s, background 0.15s",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--primary)"; e.currentTarget.style.background = "color-mix(in srgb, var(--foreground) 6%, transparent)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--muted-foreground)"; e.currentTarget.style.background = "transparent"; }}
                          >
                            <ExternalLink size={11} /> Docs
                          </a>
                          <button
                            onClick={() => window.open(
                              appendClientId(`/api/files/download?path=${encodeURIComponent(file.relativePath)}`, task.clientId),
                              "_blank",
                            )}
                            title="Download"
                            style={{
                              display: "flex", alignItems: "center", gap: 4,
                              background: "none", border: "none", cursor: "pointer",
                              color: "var(--muted-foreground)", fontSize: 10,
                              fontFamily: "var(--font-inter), Inter, sans-serif", padding: "4px 8px", borderRadius: 4,
                              transition: "color 0.15s, background 0.15s",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--primary)"; e.currentTarget.style.background = "color-mix(in srgb, var(--foreground) 6%, transparent)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--muted-foreground)"; e.currentTarget.style.background = "transparent"; }}
                          >
                            <Download size={11} /> Download
                          </button>
                        </div>
                      </div>
                    {/* Inline preview — rendered directly under the clicked file */}
                    {previewFile && previewFile.relativePath === file.relativePath && (
                      <FilePreviewInline
                        relativePath={previewFile.relativePath}
                        extension={previewFile.extension}
                        clientId={task.clientId}
                        onClose={() => setPreviewFile(null)}
                        fillHeight
                        onCheckboxToggle={previewFile.relativePath.endsWith("brief.md") ? handlePlanCheckboxToggle : undefined}
                        editable={previewFile.relativePath.endsWith("brief.md")}
                      />
                    )}
                    </div>
                  );
                })}
                </>
              )}
          </div>
        </div>
        )}
      </div>
      )}
      {showDraftPlanModal && pendingApprovedBrief && (
        <DraftPlanPreviewModal
          content={pendingApprovedBrief}
          onClose={() => setShowDraftPlanModal(false)}
        />
      )}
    </div>
  );
}

// ── AchievedRow ──────────────────────────────────────────────────

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const taskDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today.getTime() - taskDay.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function groupByDate(tasks: Task[]): { label: string; tasks: Task[]; sortKey: number }[] {
  const groups = new Map<string, Task[]>();
  for (const t of tasks) {
    const ts = t.completedAt || t.updatedAt;
    const d = new Date(ts);
    const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  return [...groups.entries()]
    .map(([, tasks]) => {
      const ts = tasks[0].completedAt || tasks[0].updatedAt;
      return {
        label: formatDateLabel(ts),
        tasks,
        sortKey: new Date(ts).getTime(),
      };
    })
    .sort((a, b) => b.sortKey - a.sortKey); // newest date group first
}

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function AchievedChip({
  task,
  isSelected,
  onSelect,
}: {
  task: Task;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const borderColor = task.level === "gsd"
    ? "color-mix(in srgb, var(--foreground) 35%, transparent)"
    : task.level === "project"
    ? "color-mix(in srgb, var(--foreground) 35%, transparent)"
    : "color-mix(in srgb, var(--foreground) 30%, transparent)";
  return (
    <div
      data-card
      onClick={() => onSelect(task.id)}
      title={`${task.title} · click to reopen`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 12px",
        borderRadius: 6,
        border: isSelected
          ? `1px solid ${task.level === "gsd" ? "var(--muted-foreground)" : task.level === "project" ? "var(--primary)" : "color-mix(in srgb, var(--foreground) 35%, transparent)"}`
          : `1px dashed ${borderColor}`,
        background: isSelected ? "white" : "var(--muted)",
        cursor: "pointer",
        fontSize: 12,
        color: "var(--muted-foreground)",
        transition: "border-color 0.15s, background 0.15s",
        opacity: 0.85,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "white"; e.currentTarget.style.opacity = "1"; }}
      onMouseLeave={(e) => { if (!isSelected) { e.currentTarget.style.background = "var(--muted)"; e.currentTarget.style.opacity = "0.85"; } }}
    >
      <Check size={10} color="var(--muted-foreground)" />
      <span style={{
        maxWidth: 180,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>
        {task.title}
      </span>
      <LevelBadge level={task.level} />
    </div>
  );
}

/** Check if a task's completion date falls within the last N days */
function daysAgo(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const taskDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((today.getTime() - taskDay.getTime()) / 86400000);
}

function AchievedRow({
  goals,
  selectedId,
  onSelect,
  compact,
}: {
  goals: Task[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** When true (detail panel open), only show today above the fold. When false, show up to 5 days. */
  compact: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [levelFilter, setLevelFilter] = useState<TaskLevel | "all">("all");

  // Count per level for the filter chip labels (use the unfiltered set)
  const levelCounts = useMemo(() => {
    const counts: Record<TaskLevel | "all", number> = { all: goals.length, task: 0, project: 0, gsd: 0 };
    for (const g of goals) counts[g.level as TaskLevel]++;
    return counts;
  }, [goals]);

  const filteredGoals = useMemo(
    () => (levelFilter === "all" ? goals : goals.filter((g) => g.level === levelFilter)),
    [goals, levelFilter],
  );

  const allGroups = useMemo(() => groupByDate(filteredGoals), [filteredGoals]);

  // "Above the fold" groups: compact mode = today only, normal = today + yesterday
  const { aboveFold, belowFold } = useMemo(() => {
    const maxDays = compact ? 0 : 1; // 0 = today only, 1 = today + yesterday
    const above: typeof allGroups = [];
    const below: typeof allGroups = [];
    for (const group of allGroups) {
      const age = daysAgo(group.tasks[0].completedAt || group.tasks[0].updatedAt);
      if (age <= maxDays) above.push(group);
      else below.push(group);
    }
    return { aboveFold: above, belowFold: below };
  }, [allGroups, compact]);

  if (goals.length === 0) return null;

  const belowFoldCount = belowFold.reduce((n, g) => n + g.tasks.length, 0);

  return (
    <div>
      <div style={{
        fontFamily: "var(--font-inter), Inter, sans-serif",
        fontSize: 10,
        color: "var(--muted-foreground)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 8,
      }}>
        <div style={{ flex: 1, height: 1, borderTop: "1px dashed var(--border)" }} />
        <span>Achieved ({goals.length})</span>
        <div style={{ flex: 1, height: 1, borderTop: "1px dashed var(--border)" }} />
      </div>

      {/* Above the fold — date-grouped */}
      {aboveFold.map((group) => (
        <div key={group.label} style={{ marginBottom: 8 }}>
          <div style={{
            fontSize: 9,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            color: "var(--muted-foreground)",
            letterSpacing: "0.06em",
            marginBottom: 4,
            paddingLeft: 4,
          }}>
            {group.label}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {group.tasks.map((t) => (
              <AchievedChip key={t.id} task={t} isSelected={selectedId === t.id} onSelect={onSelect} />
            ))}
          </div>
        </div>
      ))}

      {/* Below the fold — behind expand toggle */}
      {belowFoldCount > 0 && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 12px",
              borderRadius: 6,
              border: "1px dashed color-mix(in srgb, var(--foreground) 30%, transparent)",
              background: "var(--muted)",
              cursor: "pointer",
              fontSize: 11,
              color: "var(--muted-foreground)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              marginTop: aboveFold.length > 0 ? 6 : 0,
              marginBottom: expanded ? 8 : 0,
            }}
          >
            <span style={{
              display: "inline-block",
              transition: "transform 150ms ease",
              transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
              fontSize: 8,
            }}>&#9654;</span>
            {belowFoldCount} older
          </button>

          {expanded && belowFold.map((group) => (
            <div key={group.label} style={{ marginBottom: 8 }}>
              <div style={{
                fontSize: 9,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                color: "var(--muted-foreground)",
                letterSpacing: "0.06em",
                marginBottom: 4,
                paddingLeft: 4,
              }}>
                {group.label}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {group.tasks.map((t) => (
                  <AchievedChip key={t.id} task={t} isSelected={selectedId === t.id} onSelect={onSelect} />
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ── ScheduledSection ────────────────────────────────────────────

function ScheduledSection({ jobs, onNavigate, dimmed }: { jobs: CronJob[]; onNavigate?: () => void; dimmed?: boolean }) {
  const activeJobs = jobs.filter((j) => j.active);

  return (
    <div data-card style={{
      background: "white",
      borderRadius: 10,
      padding: 16,
      border: "1px solid var(--muted)",
      opacity: dimmed ? 0.4 : 1,
      filter: dimmed ? "saturate(0.3)" : "none",
      transition: "opacity 0.2s, filter 0.2s",
    }}>
      <div
        onClick={onNavigate}
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 10,
          textTransform: "uppercase" as const,
          letterSpacing: "0.1em",
          color: "var(--muted-foreground)",
          marginBottom: 8,
          cursor: onNavigate ? "pointer" : "default",
        }}
      >
        Scheduled ({activeJobs.length})
      </div>
      {activeJobs.map((job) => {
        const isRunning = false;
        const lastResult = job.lastRun?.result;
        return (
          <div
            key={job.slug}
            onClick={onNavigate}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "4px 0",
              borderBottom: "1px dashed var(--border)",
              fontSize: 12,
              color: "var(--muted-foreground)",
              cursor: onNavigate ? "pointer" : "default",
              transition: "background 0.1s",
              borderRadius: 4,
              margin: "0 -4px",
              paddingLeft: 4,
              paddingRight: 4,
            }}
            onMouseEnter={(e) => { if (onNavigate) e.currentTarget.style.background = "color-mix(in srgb, var(--foreground) 3%, transparent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <span style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: isRunning ? "var(--foreground)" : "var(--border)",
              flexShrink: 0,
              marginTop: 4,
              alignSelf: "flex-start",
              animation: isRunning ? "pulse-dot 2s ease-in-out infinite" : undefined,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap" as const,
              }}>
                {job.name}
              </div>
              <div style={{
                fontSize: 9,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                color: "var(--muted-foreground)",
                display: "flex",
                gap: 8,
                marginTop: 4,
              }}>
                <span>{formatScheduleCompact(job.days, job.time)}</span>
                {job.lastRun && (
                  <span>last: {formatNextRun(job.lastRun.lastRun)}</span>
                )}
                {job.nextRun && (
                  <span>next: {formatNextRun(job.nextRun)}</span>
                )}
              </div>
            </div>
            {lastResult && (
              <span style={{
                fontSize: 8,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                padding: "0 4px",
                borderRadius: 3,
                background: lastResult === "success"
                  ? "color-mix(in srgb, var(--foreground) 15%, transparent)"
                  : lastResult === "timeout"
                    ? "color-mix(in srgb, var(--foreground) 12%, transparent)"
                    : "color-mix(in srgb, var(--foreground) 10%, transparent)",
                color: lastResult === "success"
                  ? "var(--border)"
                  : lastResult === "timeout"
                    ? "var(--muted-foreground)"
                    : "var(--destructive)",
                flexShrink: 0,
              }}>
                {lastResult === "success" ? "OK" : lastResult === "timeout" ? "TIMEOUT" : "FAIL"}
              </span>
            )}
          </div>
        );
      })}
      {activeJobs.length === 0 && (
        <div style={{
          fontSize: 11,
          color: "var(--muted-foreground)",
          fontFamily: "var(--font-inter), Inter, sans-serif",
          padding: "4px 0",
        }}>
          No scheduled tasks
        </div>
      )}
    </div>
  );
}

function formatScheduleCompact(days: string, time: string): string {
  const dayMap: Record<string, string> = {
    daily: "Daily", weekdays: "Wkdays", weekends: "Wkends",
    mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
  };
  const parts = days.split(",").map((d) => dayMap[d.trim()] || d.trim());
  return `${parts.join(",")} ${time}`;
}

function formatNextRun(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "--";
  const now = Date.now();
  const diffMs = d.getTime() - now;
  if (diffMs < 0) return "overdue";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `in ${days}d`;
}

// ── RecentOutputsSection ────────────────────────────────────────

interface RecentOutput {
  id: string;
  taskId: string;
  fileName: string;
  relativePath: string;
  extension: string;
  sizeBytes: number | null;
  createdAt: string;
  taskTitle: string;
  taskLevel: string;
  projectSlug: string | null;
  clientId?: string | null;
}

function RecentOutputsSection({
  outputs,
  onSelectTask,
  dimmed,
  foldLimit,
}: {
  outputs: RecentOutput[];
  onSelectTask: (taskId: string) => void;
  dimmed?: boolean;
  /** When set, show only the first N outputs with an expand toggle. */
  foldLimit?: number;
}) {
  const [previewOutput, setPreviewOutput] = useState<RecentOutput | null>(null);
  const [expanded, setExpanded] = useState(false);
  const visibleOutputs = foldLimit != null && !expanded ? outputs.slice(0, foldLimit) : outputs;
  const hiddenCount = outputs.length - visibleOutputs.length;

  return (
    <div data-card style={{
      background: "white",
      borderRadius: 10,
      padding: 16,
      border: "1px solid var(--muted)",
      opacity: dimmed ? 0.4 : 1,
      filter: dimmed ? "saturate(0.3)" : "none",
      transition: "opacity 0.2s, filter 0.2s",
    }}>
      <div style={{
        fontFamily: "var(--font-inter), Inter, sans-serif",
        fontSize: 10,
        textTransform: "uppercase" as const,
        letterSpacing: "0.1em",
        color: "var(--muted-foreground)",
        marginBottom: 8,
      }}>
        Recent outputs ({outputs.length})
      </div>
      {outputs.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "var(--font-inter), Inter, sans-serif", padding: "4px 0" }}>
          No outputs yet
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {visibleOutputs.map((o) => {
            const canPreview = PREVIEWABLE.has(o.extension);
            const isActive = previewOutput?.id === o.id;
            return (
              <div key={o.id}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "4px 4px", borderBottom: "1px dashed var(--border)",
                  borderRadius: 4, margin: "0 -4px", paddingLeft: 4, paddingRight: 4,
                  transition: "background 0.1s",
                  cursor: "pointer",
                }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--foreground) 3%, transparent)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <FileText size={12} color="var(--border)" style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      onClick={() => {
                        if (canPreview) {
                          setPreviewOutput(isActive ? null : o);
                        } else {
                          window.open(
                            appendClientId(`/api/files/download?path=${encodeURIComponent(o.relativePath)}`, o.clientId ?? null),
                            "_blank",
                          );
                        }
                      }}
                      style={{
                        fontSize: 12, color: "var(--muted-foreground)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const,
                      }}
                    >
                      {o.fileName}
                    </div>
                    <div style={{
                      fontSize: 9, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--muted-foreground)",
                      display: "flex", gap: 8, marginTop: 4,
                    }}>
                      <span
                        onClick={() => onSelectTask(o.taskId)}
                        style={{ cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted" as const }}
                      >
                        {o.taskTitle.length > 30 ? o.taskTitle.slice(0, 30) + "..." : o.taskTitle}
                      </span>
                      <span>{timeAgo(o.createdAt)}</span>
                    </div>
                  </div>
                  <span style={{
                    fontSize: 8, fontFamily: "var(--font-inter), Inter, sans-serif",
                    padding: "0 4px", borderRadius: 3,
                    background: "color-mix(in srgb, var(--foreground) 4%, transparent)", color: "var(--muted-foreground)", flexShrink: 0,
                  }}>
                    .{o.extension}
                  </span>
                </div>
                {isActive && canPreview && (
                  <div style={{ marginTop: 4, marginBottom: 4 }}>
                    <FilePreviewInline
                      relativePath={o.relativePath}
                      extension={o.extension}
                      clientId={o.clientId ?? null}
                      onClose={() => setPreviewOutput(null)}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {hiddenCount > 0 && (
            <button
              onClick={() => setExpanded(true)}
              style={{
                marginTop: 8,
                padding: "4px 8px",
                border: "1px dashed color-mix(in srgb, var(--foreground) 40%, transparent)",
                borderRadius: 5,
                background: "transparent",
                fontSize: 10,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                color: "var(--muted-foreground)",
                cursor: "pointer",
                alignSelf: "flex-start",
              }}
            >
              + {hiddenCount} older
            </button>
          )}
          {expanded && foldLimit != null && (
            <button
              onClick={() => setExpanded(false)}
              style={{
                marginTop: 4,
                padding: "4px 8px",
                border: "none",
                background: "transparent",
                fontSize: 10,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                color: "var(--muted-foreground)",
                cursor: "pointer",
                alignSelf: "flex-start",
              }}
            >
              show fewer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── FeedView (main export) ───────────────────────────────────────

export function FeedView({
  onSwitchTab,
}: {
  onSwitchTab?: (tab: string) => void;
}) {
  const tasks = useTaskStore((s) => s.tasks);
  const updateTask = useTaskStore((s) => s.updateTask);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailFullscreen, setDetailFullscreen] = useState(false);
  // Track which needsInput tasks have been opened so we can show a notification dot
  const seenTaskIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!selectedId) return;
    seenTaskIdsRef.current.add(selectedId);
    // Also mark children as seen so the parent's unseen dot clears
    for (const t of tasks) {
      if (t.parentId === selectedId) seenTaskIdsRef.current.add(t.id);
    }
  }, [selectedId, tasks]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropZoneOver, setDropZoneOver] = useState(false);
  // Drop-between-cards indicator: which card is being hovered and which half
  const [dropTarget, setDropTarget] = useState<{ id: string; position: "before" | "after" } | null>(null);
  const [routingDecision, setRoutingDecision] = useState<{ scope: ScopeResult; goal: string } | null>(null);
  const [gsdGuardrail, setGsdGuardrail] = useState<{ scope: ScopeResult; goal: string } | null>(null);
  const [showNewGoalPanel, setShowNewGoalPanel] = useState(false);
  const [goalDraftPanelState, setGoalDraftPanelState] = useState(() => createGoalDraftPanelState());
  const [goalDrafts, setGoalDrafts] = useState<GoalDraftPayload[]>([]);
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const createTaskAction = useTaskStore((s) => s.createTask);
  // Scope data for a task that needs project planning in the detail panel
  const [pendingScope, setPendingScope] = useState<{ taskId: string; scope: ScopeResult; goal: string } | null>(null);

  // ── Drawer width (shared with DetailPanel so grid columns respond) ───
  const DRAWER_STORAGE_KEY = "command-centre.detail-drawer-width";
  const DRAWER_MIN = 480;
  const DRAWER_MAX_RATIO = 0.6; // never wider than 60% of viewport
  const [drawerWidth, setDrawerWidth] = useState<number | null>(null);
  const drawerDraggingRef = useRef(false);

  useEffect(() => {
    setGoalDrafts(loadGoalDrafts());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(DRAWER_STORAGE_KEY);
    const initial = stored ? parseInt(stored, 10) : NaN;
    const maxW = Math.floor(window.innerWidth * DRAWER_MAX_RATIO);
    const fallback = Math.max(DRAWER_MIN, Math.min(maxW, window.innerWidth - 396));
    const next = !Number.isNaN(initial) ? Math.min(maxW, initial) : fallback;
    setDrawerWidth(Math.max(DRAWER_MIN, next));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drawerDraggingRef.current) return;
      const maxW = Math.floor(window.innerWidth * DRAWER_MAX_RATIO);
      const next = Math.max(
        DRAWER_MIN,
        Math.min(maxW, window.innerWidth - e.clientX)
      );
      setDrawerWidth(next);
    };
    const onUp = () => {
      if (!drawerDraggingRef.current) return;
      drawerDraggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setDrawerWidth((w) => {
        if (w != null) {
          try {
            window.localStorage.setItem(DRAWER_STORAGE_KEY, String(w));
          } catch { /* ignore */ }
        }
        return w;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startDrawerDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    drawerDraggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const editingGoalDraft = useMemo(
    () => goalDrafts.find((draft) => draft.id === goalDraftPanelState.activeDraftId) ?? null,
    [goalDraftPanelState.activeDraftId, goalDrafts],
  );

  const handleOpenNewGoal = useCallback(() => {
    setSelectedId(null);
    setDetailFullscreen(false);
    setGoalDraftPanelState((current) => openBlankGoalDraftPanel(current));
    setShowNewGoalPanel(true);
  }, []);

  const handleOpenGoalDraft = useCallback((draftId: string) => {
    setSelectedId(null);
    setDetailFullscreen(false);
    setGoalDraftPanelState((current) => openSavedGoalDraftPanel(current, draftId));
    setShowNewGoalPanel(true);
  }, []);

  const handleGoalDraftSaved = useCallback((draft: GoalDraftPayload) => {
    setGoalDrafts(saveGoalDraft(draft));
    setGoalDraftPanelState((current) => saveDraftInOpenGoalPanel(current, draft.id));
  }, []);

  const handleGoalDraftDiscarded = useCallback(async (draftId: string | null) => {
    if (draftId) {
      const draft = goalDrafts.find((candidate) => candidate.id === draftId);
      if (draft?.attachments.length) {
        try {
          await fetch("/api/goal-drafts/attachments", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              draftId,
              clientId: draft.clientId,
            }),
          });
        } catch {
          // Best effort cleanup only.
        }
      }
      setGoalDrafts(removeGoalDraft(draftId));
    }
    if (goalDraftPanelState.activeDraftId === draftId) {
      setGoalDraftPanelState((current) => clearActiveGoalDraftPanel(current));
    }
    setShowNewGoalPanel(false);
  }, [goalDraftPanelState.activeDraftId, goalDrafts]);

  const handleGoalDraftSubmitted = useCallback((draftId: string | null | undefined) => {
    if (draftId) {
      setGoalDrafts(removeGoalDraft(draftId));
    }
    if (goalDraftPanelState.activeDraftId === draftId) {
      setGoalDraftPanelState((current) => clearActiveGoalDraftPanel(current));
    }
  }, [goalDraftPanelState.activeDraftId]);

  const toggleSelect = useCallback((id: string) => {
    setShowNewGoalPanel(false);
    setGoalDraftPanelState((current) => clearActiveGoalDraftPanel(current));
    setSelectedId((prev) => {
      if (prev === id) {
        setDetailFullscreen(false);
        return null;
      }
      return id;
    });
  }, []);

  // Drop-between-cards reorder: given a dragged task id, the target card id
  // in the level list, and a position ("before" or "after"), compute a new
  // columnOrder that slots the dragged row into that gap. Effective order
  // is sorted DESC, so "before" means "higher rank" (bigger columnOrder).
  const dropCardAt = useCallback(async (
    draggedId: string,
    targetId: string,
    position: "before" | "after",
    levelTasks: Task[],
  ) => {
    if (draggedId === targetId) return;
    const targetIdx = levelTasks.findIndex((t) => t.id === targetId);
    if (targetIdx < 0) return;

    const orderOf = (t: Task) =>
      t.columnOrder && t.columnOrder > 0 ? t.columnOrder : new Date(t.updatedAt).getTime();

    // Neighbor on the other side of the drop gap (may be undefined at edges)
    const neighborIdx = position === "before" ? targetIdx - 1 : targetIdx + 1;
    const neighbor = levelTasks[neighborIdx];
    const target = levelTasks[targetIdx];

    const targetOrder = orderOf(target);
    let nextOrder: number;
    if (!neighbor) {
      // Dropping at the very top/bottom of the level
      nextOrder = position === "before" ? targetOrder + 1000 : targetOrder - 1000;
    } else {
      const neighborOrder = orderOf(neighbor);
      nextOrder = Math.round((targetOrder + neighborOrder) / 2);
      // Guarantee strict movement even when the midpoint collapses
      if (nextOrder === targetOrder || nextOrder === neighborOrder) {
        nextOrder = position === "before" ? targetOrder + 1 : targetOrder - 1;
      }
    }
    await updateTask(draggedId, { columnOrder: nextOrder });
  }, [updateTask]);

  const activeClientSlugs = useClientStore((s) => s.activeClientSlugs);
  const isClientActive = useClientStore((s) => s.isClientActive);
  const clients = useClientStore((s) => s.clients);
  const rootName = useClientStore((s) => s.rootName);

  const filtered = useMemo(() => {
    // null = "All", [] = nothing selected (empty board)
    if (activeClientSlugs !== null && activeClientSlugs.length === 0) return [];
    return tasks.filter((t) => {
      // Multi-select client filtering
      if (activeClientSlugs !== null) {
        const slug = t.clientId || "_root";
        if (!activeClientSlugs.includes(slug)) return false;
      }
      // Tag filtering — when a tag is selected, show only tasks with that tag
      // (plus their children, so subtasks aren't orphaned)
      if (activeTagFilter) {
        const matchesTag = t.tag === activeTagFilter;
        const parentMatchesTag = t.parentId && tasks.some(
          (p) => p.id === t.parentId && p.tag === activeTagFilter
        );
        if (!matchesTag && !parentMatchesTag) return false;
      }
      if (isTerminalTask(t)) return false;
      return true;
    });
  }, [tasks, activeClientSlugs, activeTagFilter]);

  const visibleGoalDrafts = useMemo(() => {
    return goalDrafts
      .filter((draft) => {
        if (activeClientSlugs !== null) {
          const slug = draft.clientId || "_root";
          if (!activeClientSlugs.includes(slug)) return false;
        }
        if (activeTagFilter && draft.tag !== activeTagFilter) {
          return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [activeClientSlugs, activeTagFilter, goalDrafts]);

  // Slugs of projects (or GSD roots) that have a materialized parent row in
  // the feed. Any sibling task sharing that slug should be hidden from the
  // top-level feed and only appear inside the project parent's drill-in.
  const projectParentSlugs = useMemo(() => {
    const set = new Set<string>();
    for (const t of filtered) {
      if (!t.parentId && (t.level === "project" || t.level === "gsd") && t.projectSlug) {
        set.add(t.projectSlug);
      }
    }
    return set;
  }, [filtered]);

  const topLevelTasks = useMemo(() => {
    return filtered.filter((t) => {
      if (t.parentId) return false;
      // Hide flat siblings of a project parent (wizard subtasks, manual
      // Level-1 tasks tagged with the project slug, etc.).
      if (
        t.projectSlug &&
        projectParentSlugs.has(t.projectSlug) &&
        t.level !== "project" &&
        t.level !== "gsd"
      ) {
        return false;
      }
      return true;
    });
  }, [filtered, projectParentSlugs]);

  const [doneFilter, setDoneFilter] = useState<DoneFilter>("1d");
  const [groupByTag, setGroupByTag] = useState(false);

  const activeGoals = useMemo(() => {
    return topLevelTasks
      .filter((t) => t.status !== "done")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [topLevelTasks]);

  const achievedGoals = useMemo(() => {
    const doneFilterMs: Record<string, number> = {
      "1d": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
      "90d": 90 * 24 * 60 * 60 * 1000,
    };
    const cutoff = Date.now() - (doneFilterMs[doneFilter] ?? doneFilterMs["90d"]);
    return topLevelTasks
      .filter((t) => {
        if (t.status !== "done") return false;
        const doneTime = t.completedAt ? new Date(t.completedAt).getTime() : new Date(t.updatedAt).getTime();
        return doneTime >= cutoff;
      })
      .sort((a, b) => {
        const aTime = a.completedAt ? new Date(a.completedAt).getTime() : new Date(a.updatedAt).getTime();
        const bTime = b.completedAt ? new Date(b.completedAt).getTime() : new Date(b.updatedAt).getTime();
        return bTime - aTime;
      });
  }, [topLevelTasks, doneFilter]);

  // ── 3-column bucketing: inProgress / inReview / done ──────────
  const isInReview = useCallback((t: Task): boolean => {
    return effectiveNeedsInput(t, filtered);
  }, [filtered]);

  const bucketedLanes = useMemo(() => {
    const allTopLevel = [...activeGoals, ...achievedGoals];

    // Group by clientSlug
    const byClient = new Map<string, { tasks: Task[]; drafts: GoalDraftPayload[] }>();
    for (const t of allTopLevel) {
      const key = t.clientId || "_root";
      if (!byClient.has(key)) byClient.set(key, { tasks: [], drafts: [] });
      byClient.get(key)!.tasks.push(t);
    }
    for (const draft of visibleGoalDrafts) {
      const key = draft.clientId || "_root";
      if (!byClient.has(key)) byClient.set(key, { tasks: [], drafts: [] });
      byClient.get(key)!.drafts.push(draft);
    }

    const lanes: SwimLane[] = [];

    for (const [slug, entry] of byClient) {
      const tasks = entry.tasks;
      const client = slug !== "_root" ? clients.find((c) => c.slug === slug) : null;
      const goals: Task[] = [];
      const done: Task[] = [];

      for (const t of tasks) {
        // User explicitly marked done → always in done column, even if children still need input
        if (t.status === "done") {
          done.push(t);
        } else {
          goals.push(t);
        }
      }

      // Sort goals: pinned first (reorderable via columnOrder), then newest-created first
      goals.sort((a, b) => {
        const aPinned = !!a.pinnedAt;
        const bPinned = !!b.pinnedAt;
        // Pinned tasks always stay above non-pinned
        if (aPinned !== bPinned) return aPinned ? -1 : 1;
        // Among pinned: use columnOrder (set by drag-reorder) DESC, fall back to pinnedAt ASC
        if (aPinned && bPinned) {
          const aOrder = a.columnOrder && a.columnOrder > 0 ? a.columnOrder : 0;
          const bOrder = b.columnOrder && b.columnOrder > 0 ? b.columnOrder : 0;
          if (aOrder || bOrder) return bOrder - aOrder;
          return new Date(a.pinnedAt!).getTime() - new Date(b.pinnedAt!).getTime();
        }
        // Among non-pinned: newest created first so new tasks appear at top
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      lanes.push({
        clientSlug: slug === "_root" ? null : slug,
        clientName: client?.name || (slug === "_root" ? rootName : slug),
        clientColor: client?.color || "var(--muted-foreground)",
        goalDrafts: entry.drafts.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
        goals,
        done,
      });
    }

    // Show swim lane headers when multiple clients have active goals
    // (done-only lanes don't count — they shouldn't trigger headers by themselves)
    const lanesWithActiveWork = lanes.filter((lane) => lane.goals.length > 0 || lane.goalDrafts.length > 0);
    const singleLane = lanesWithActiveWork.length <= 1 && lanes.length <= 1;

    return { lanes, singleLane };
  }, [activeGoals, achievedGoals, clients, rootName, visibleGoalDrafts]);

  const [dropOverColumn, setDropOverColumn] = useState<"goals" | "done" | null>(null);

  const selectedTask = (selectedId ? tasks.find((t) => t.id === selectedId) : null) ?? null;

  // If a subtask is selected, find the project parent so we can hoist the
  // parent card (with the subtask row highlighted) rather than the bare
  // subtask. Falls back to the selected task itself if no parent exists.
  const focusCardTask = useMemo(() => {
    if (!selectedTask) return null;
    if (!selectedTask.parentId && selectedTask.level !== "task") return selectedTask;
    if (selectedTask.parentId) {
      const parent = tasks.find((t) => t.id === selectedTask.parentId);
      if (parent) return parent;
    }
    if (selectedTask.projectSlug) {
      const projectParent = tasks.find(
        (t) => !t.parentId && t.projectSlug === selectedTask.projectSlug && (t.level === "project" || t.level === "gsd")
      );
      if (projectParent) return projectParent;
    }
    return selectedTask;
  }, [selectedTask, tasks]);


  const handleDragStart = useCallback((id: string, e: React.DragEvent) => {
    setDraggingId(id);
    setSelectedId(null);
    setDetailFullscreen(false);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setDropZoneOver(false);
    setDropTarget(null);
    setDropOverColumn(null);
  }, []);

  const handleDropColumn = useCallback((column: "goals" | "done", e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || draggingId;
    if (!id) return;
    console.log(`[feed-view] handleDropColumn: column=${column}, id=${id?.slice(0,8)}`);
    if (column === "done") {
      updateTask(id, { status: "done", needsInput: false, errorMessage: null, completedAt: new Date().toISOString() });
    } else {
      // Moving to goals: re-queue and clear done state
      updateTask(id, { status: "queued", needsInput: false, errorMessage: null, completedAt: null });
    }
    setDraggingId(null);
    setDropZoneOver(false);
    setDropOverColumn(null);
  }, [draggingId, updateTask]);

  const handleDragOverColumn = useCallback((_column: "goals" | "done", e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropOverColumn(_column);
    setDropZoneOver(true);
  }, []);

  const handleDragLeaveColumn = useCallback((_column: "goals" | "done") => {
    setDropOverColumn((prev) => prev === _column ? null : prev);
  }, []);

  const fetchClients = useClientStore((s) => s.fetchClients);
  const selectedClientId = useClientStore((s) => s.selectedClientId);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const syncProjects = useTaskStore((s) => s.syncProjects);

  const cronJobs = useCronStore((s) => s.jobs);
  const fetchCronJobs = useCronStore((s) => s.fetchJobs);

  const [recentOutputs, setRecentOutputs] = useState<RecentOutput[]>([]);

  const fetchRecentOutputs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "30" });
      // Use single active client for output filtering when available
      if (activeClientSlugs && activeClientSlugs.length === 1 && activeClientSlugs[0] !== "_root") {
        params.set("clientId", activeClientSlugs[0]);
      }
      const res = await fetch(`/api/files/recent?${params}`);
      if (res.ok) setRecentOutputs(await res.json());
    } catch { /* ignore */ }
  }, [activeClientSlugs]);

  useEffect(() => { fetchClients(); }, [fetchClients]);
  useEffect(() => { fetchTasks(); }, [fetchTasks, activeClientSlugs]);
  useEffect(() => { fetchCronJobs(); }, [fetchCronJobs]);
  useEffect(() => { fetchRecentOutputs(); }, [fetchRecentOutputs]);
  useEffect(() => { syncProjects(); }, [syncProjects, activeClientSlugs]);

  // Click-to-deselect: if click lands on a "blank" area (not inside a card, button, or input), deselect
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (!selectedId) return;
    const target = e.target as HTMLElement;
    // Check if click is inside an interactive element
    if (target.closest("[data-card], button, input, textarea, a, [role='button']")) return;
    setSelectedId(null);
  }, [selectedId]);

  // When the drawer is open, push the page content left so it doesn't sit
  // underneath the fixed-position drawer.
  const feedMarginRight = (selectedTask || showNewGoalPanel) && drawerWidth ? drawerWidth + 12 : 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        marginRight: feedMarginRight || undefined,
        transition: drawerDraggingRef.current ? undefined : "margin-right 200ms ease",
      }}
      onDragEnd={handleDragEnd}
      onMouseDown={handleBackdropClick}
    >
      {/* Unified toolbar: client filters + New Goal */}
      <ClientFilterBar
        onNewGoal={handleOpenNewGoal}
      />

      <TagFilterBar
        tasks={tasks}
        activeTag={activeTagFilter}
        onTagChange={setActiveTagFilter}
      />

      {routingDecision && (
        <RoutingDecisionCard
          goal={routingDecision.goal}
          decision={{
            level: routingDecision.scope.level,
            confidence: routingDecision.scope.confidence,
            reasoning: routingDecision.scope.questions?.[0]?.prompt,
            bullets: routingDecision.scope.suggestedSubtasks?.map((s) => s.title),
            overlaps: routingDecision.scope.overlaps?.map((o) => ({
              taskId: o.slug,
              title: o.name,
            })),
            clarifications: routingDecision.scope.questions?.map((q) => q.prompt),
          }}
          onProceed={async () => {
            const { scope, goal } = routingDecision;
            if (scope.level === "task") {
              const firstLine = goal.split("\n")[0];
              const title = firstLine.length <= 60
                ? firstLine
                : firstLine.slice(0, 57).replace(/\s+\S*$/, "") + "...";
              await createTaskAction(title, goal, "task");
              setRoutingDecision(null);
            } else if (scope.level === "project") {
              // Create a placeholder parent task, open it, and show wizard inline
              const firstLine = goal.split("\n")[0];
              const title = firstLine.length <= 60
                ? firstLine
                : firstLine.slice(0, 57).replace(/\s+\S*$/, "") + "...";
              const taskId = await createTaskAction(title, goal, "project", null, null, undefined, "backlog");
              if (taskId) {
                setPendingScope({ taskId, scope, goal });
                setSelectedId(taskId);
              }
              setRoutingDecision(null);
            } else if (scope.level === "gsd") {
              setGsdGuardrail({ scope, goal });
              setRoutingDecision(null);
            }
          }}
          onChangeLevel={() => {
            setRoutingDecision(null);
            handleOpenNewGoal();
          }}
          onDismiss={() => setRoutingDecision(null)}
        />
      )}

      {gsdGuardrail && (
        <GsdGuardrailModal
          open
          scope={gsdGuardrail.scope}
          goal={gsdGuardrail.goal}
          clientId={selectedClientId ?? undefined}
          onClose={() => setGsdGuardrail(null)}
          onCreated={async () => {
            setGsdGuardrail(null);
            await fetchTasks();
          }}
        />
      )}

      <KanbanBoard
        lanes={bucketedLanes.lanes}
        singleLane={bucketedLanes.singleLane}
        draggingId={draggingId}
        onDropColumn={handleDropColumn}
        onDragOverColumn={handleDragOverColumn}
        onDragLeaveColumn={handleDragLeaveColumn}
        dropOverColumn={dropOverColumn}
        isEmpty={activeGoals.length === 0 && achievedGoals.length === 0 && visibleGoalDrafts.length === 0}
        hideDone={false}
        doneFilter={doneFilter}
        onDoneFilterChange={setDoneFilter}
        groupByTag={groupByTag}
        onToggleGroupByTag={() => setGroupByTag((v) => !v)}
        renderDraftCard={(draft) => (
          <GoalDraftCard
            key={draft.id}
            draft={draft}
            isActive={goalDraftPanelState.activeDraftId === draft.id && showNewGoalPanel}
            onOpen={handleOpenGoalDraft}
            onDiscard={(draftId) => { void handleGoalDraftDiscarded(draftId); }}
          />
        )}
        renderCard={(task, column) => {
          const focusId = focusCardTask?.id ?? null;
          const isFocus = task.id === focusId;
          const allColTasks = column === "done"
            ? achievedGoals
            : bucketedLanes.lanes.flatMap((l) => l.goals);
          const dropIndicator =
            dropTarget && dropTarget.id === task.id && draggingId && draggingId !== task.id
              ? dropTarget.position
              : null;
          return (
            <GoalCard
              key={task.id}
              task={task}
              allTasks={filtered}
              clients={clients}
              isSelected={isFocus}
              dimmed={!!focusId && !isFocus}
              isDragging={draggingId === task.id}
              dropIndicator={dropIndicator}
              unseen={
                (taskNeedsInput(task) && !seenTaskIdsRef.current.has(task.id))
                || filtered.some((t) => t.parentId === task.id && taskNeedsInput(t) && !seenTaskIdsRef.current.has(t.id))
              }
              onSelect={toggleSelect}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOverCard={(id, position) => {
                if (!draggingId || draggingId === id) {
                  setDropTarget(null);
                  return;
                }
                setDropTarget((prev) =>
                  prev && prev.id === id && prev.position === position
                    ? prev
                    : { id, position }
                );
              }}
              onDropOnCard={(id) => {
                if (!draggingId || draggingId === id) return;
                const position = dropTarget && dropTarget.id === id ? dropTarget.position : "after";
                // When dropping onto a card in a different column, change status too
                const draggedTask = filtered.find((t) => t.id === draggingId);
                if (draggedTask) {
                  const draggedColumn = draggedTask.status === "done" ? "done" : "goals";
                  if (draggedColumn !== column) {
                    // Cross-column drop: update status to match destination
                    if (column === "done") {
                      updateTask(draggingId, { status: "done", needsInput: false, errorMessage: null, completedAt: new Date().toISOString() });
                    } else {
                      updateTask(draggingId, { status: "queued", needsInput: false, errorMessage: null, completedAt: null });
                    }
                  }
                }
                dropCardAt(draggingId, id, position, allColTasks);
                setDraggingId(null);
                setDropTarget(null);
                setDropZoneOver(false);
              }}
              onMarkDone={(id) => {
                updateTask(id, { status: "done", needsInput: false, errorMessage: null, completedAt: new Date().toISOString() });
              }}
            />
          );
        }}
      />

      {/* Detail drawer — fixed-position overlay covering the full viewport
          height (including nav/goal bar). The feed content is pushed left
          via marginRight on the outermost wrapper. */}
      {/* New Goal panel — shown when creating, hidden when a task is selected */}
      {showNewGoalPanel && !selectedTask && (
        <NewGoalPanel
          key={goalDraftPanelState.panelKey}
          drawerWidth={drawerWidth}
          draft={editingGoalDraft}
          onClose={() => {
            setShowNewGoalPanel(false);
            setGoalDraftPanelState((current) => clearActiveGoalDraftPanel(current));
          }}
          onDraftSaved={handleGoalDraftSaved}
          onDiscarded={(draftId) => { void handleGoalDraftDiscarded(draftId); }}
          onCreated={(taskId, draftId) => {
            handleGoalDraftSubmitted(draftId);
            setShowNewGoalPanel(false);
            setGoalDraftPanelState((current) => clearActiveGoalDraftPanel(current));
            setSelectedId(taskId);
          }}
          onStartDrawerDrag={startDrawerDrag}
        />
      )}

      {selectedTask && (
        <DetailPanel
          task={selectedTask}
          onClose={() => { setSelectedId(null); setDetailFullscreen(false); setPendingScope(null); }}
          onMarkDone={(id) => {
            updateTask(id, { status: "done", needsInput: false, errorMessage: null, completedAt: new Date().toISOString() });
            setSelectedId(null);
            setDetailFullscreen(false);
          }}
          onSelectSubtask={(id) => setSelectedId(id)}
          onNavigateToParent={(parentId) => setSelectedId(parentId)}
          isFullscreen={detailFullscreen}
          onToggleFullscreen={() => setDetailFullscreen((v) => !v)}
          drawerWidth={drawerWidth}
          onStartDrawerDrag={startDrawerDrag}
          pendingScope={pendingScope?.taskId === selectedTask.id ? { scope: pendingScope.scope, goal: pendingScope.goal } : null}
          onScopeComplete={async () => {
            setPendingScope(null);
            await syncProjects();
            await fetchTasks();
          }}
        />
      )}
    </div>
  );
}

function ResumeClipButton({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false);
  const command = `claude --resume ${sessionId}`;

  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(command);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      title={command}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 8px",
        fontSize: 10,
        fontFamily: "var(--font-inter), Inter, sans-serif",
        fontWeight: 500,
        border: "1px solid",
        borderColor: copied ? "color-mix(in srgb, var(--foreground) 30%, transparent)" : "color-mix(in srgb, var(--foreground) 20%, transparent)",
        borderRadius: 4,
        background: copied ? "color-mix(in srgb, var(--foreground) 8%, transparent)" : "color-mix(in srgb, var(--foreground) 6%, transparent)",
        color: copied ? "var(--muted-foreground)" : "var(--primary)",
        cursor: "pointer",
        transition: "all 150ms ease",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        if (!copied) e.currentTarget.style.background = "color-mix(in srgb, var(--foreground) 12%, transparent)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = copied
          ? "color-mix(in srgb, var(--foreground) 8%, transparent)"
          : "color-mix(in srgb, var(--foreground) 6%, transparent)";
      }}
    >
      {copied ? <Copy size={10} /> : <Terminal size={10} />}
      {copied ? "copied" : "resume"}
    </button>
  );
}

const SUGGESTED_ACTIONS = [
  {
    label: "Manage skills",
    prompt: "I want to work with skills. Show me what's currently installed with `bash scripts/list-skills.sh`, then ask me whether I want to: (1) install a new skill from the catalog, (2) edit or improve an existing skill, or (3) import/create a brand new skill from scratch. Use /meta-skill-creator for editing or creating skills.",
  },
  {
    label: "Create a scheduled task",
    prompt: "/ops-cron Create a new scheduled cron job. Ask me what I want to automate and how often it should run.",
  },
  {
    label: "Use a skill...",
    prompt: "List all my installed skills with `bash scripts/list-skills.sh` and briefly describe what each one does, so I can pick one to use.",
  },
  {
    label: "Connect to your apps (MCP)...",
    prompt: "I want to connect an external app via MCP. Show me what MCP servers are currently configured in .claude/settings.json, and help me add a new one. Ask which app or service I want to connect.",
  },
  {
    label: "Add a client",
    prompt: "I want to add a new client. Ask me for the client name, then run `bash scripts/add-client.sh` with it.",
  },
  {
    label: "Perform some research",
    prompt: "/str-trending-research Research what's trending in my industry. Ask me what topic or niche to focus on.",
  },
];

function SuggestedActions({
  status,
  onSelect,
}: {
  status: string;
  onSelect: (prompt: string) => void;
}) {
  if (status === "running") {
    return (
      <div style={{
        fontSize: 13,
        color: "var(--muted-foreground)",
        fontFamily: "var(--font-inter), Inter, sans-serif",
        padding: "12px 0",
      }}>
        Working...
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 0" }}>
      <div style={{
        fontSize: 10,
        fontFamily: "var(--font-inter), Inter, sans-serif",
        color: "var(--muted-foreground)",
        textTransform: "uppercase" as const,
        letterSpacing: "0.06em",
        marginBottom: 8,
      }}>
        Get started
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {SUGGESTED_ACTIONS.map((action) => (
          <button
            key={action.label}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(action.prompt);
            }}
            style={{
              display: "block",
              width: "100%",
              padding: "8px 12px",
              fontSize: 12,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontWeight: 500,
              border: "1px solid color-mix(in srgb, var(--foreground) 15%, transparent)",
              borderRadius: 6,
              backgroundColor: "transparent",
              color: "var(--muted-foreground)",
              cursor: "pointer",
              textAlign: "left" as const,
              transition: "all 120ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 4%, transparent)";
              e.currentTarget.style.borderColor = "color-mix(in srgb, var(--foreground) 40%, transparent)";
              e.currentTarget.style.color = "var(--primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.borderColor = "color-mix(in srgb, var(--foreground) 15%, transparent)";
              e.currentTarget.style.color = "var(--muted-foreground)";
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

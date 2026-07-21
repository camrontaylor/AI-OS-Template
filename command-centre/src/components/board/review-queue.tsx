"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  ArrowUp, ChevronLeft, ChevronRight, X, MessageCircle,
  Paperclip, FileText, Wrench, CheckCircle2, Clock, ExternalLink,
} from "lucide-react";
import type { Task, LogEntry } from "@/types/task";
import { useTaskStore } from "@/store/task-store";
import { parseQuestionSpecs, type QuestionSpec } from "@/types/question-spec";
import {
  PermissionApprovalActions,
  PlanApprovalActions,
} from "@/components/shared/task-approval-actions";
import { PastedTextCard } from "@/components/shared/pasted-text-card";
import { isTaskWaitingOnPermission } from "@/lib/task-permissions";
import { syncComposerTextareaHeight } from "@/lib/composer";
import {
  appendPendingPastedText,
  insertPastedTextAtSelection,
  removePendingPastedText,
  shouldCapturePastedText,
} from "@/lib/pasted-text";
import { CHAT_ATTACHMENT_ACCEPT_ATTR } from "@/lib/chat-attachment-policy";

// ── Paste handling ──────────────────────────────────────────────
interface PastedChip {
  id: string;
  kind: "text" | "image";
  label: string;
  content: string;
}
function buildImagePasteLabel(name: string): string {
  return name || "screenshot.png";
}

function timeAgo(dateStr: string): string {
  const ts = new Date(dateStr).getTime();
  if (isNaN(ts)) return "--";
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return `${min}m ${rem.toString().padStart(2, "0")}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${(min % 60)}m`;
}

const SHORT_AFFIRMATION = /^(yes|no|ok|okay|sure|go\s*ahead|looks?\s*good|that'?s?\s*(fine|great|it)|perfect|great|thanks|y|n|approve|continue|proceed|done|ship\s*it|lgtm)\s*[.!?]*$/i;

/** Turn technical error messages into plain English */
function cleanErrorMessage(msg: string): string {
  if (/Claude CLI exited with code/i.test(msg)) return "The task ran into a problem and couldn\u2019t finish.";
  if (/timeout/i.test(msg)) return "The task took too long and was stopped.";
  if (/SIGTERM|SIGKILL|killed/i.test(msg)) return "The task was interrupted.";
  if (/ENOENT|not found/i.test(msg)) return "A required file or tool couldn\u2019t be found.";
  if (/permission denied/i.test(msg)) return "The task was blocked by a permission issue.";
  if (/rate limit/i.test(msg)) return "Hit an API rate limit - try again shortly.";
  return cleanText(msg);
}

/** Clean noise from raw text */
function cleanText(text: string): string {
  return text
    .replace(/^Working directory:\s*.+$/gm, "")
    .replace(/^You are running as a scheduled job.*/gm, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\[SILENT\]/gi, "")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/(?:\/[\w.-]+){2,}/g, "")
    .replace(/[\w.-]+\/[\w.-]+\/[\w.-]+/g, "")
    .replace(/\b\w+\.(md|json|ts|tsx|js|py|sh|yaml|csv|txt|log)\b/gi, "")
    .replace(/\n{2,}/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function oneLiner(text: string, max = 80): string {
  const cleaned = cleanText(text);
  if (!cleaned) return "";
  const lines = cleaned.split(/[.\n]/)
    .map((l) => l.trim())
    .filter((l) => l.length > 10)
    .filter((l) => !/^(Saved|Wrote|Created|Report saved|Output saved)\s+(to|at|in)\b/i.test(l));
  const sentence = lines[0] || cleaned.split("\n")[0]?.trim() || cleaned;
  return sentence.length > max ? sentence.slice(0, max - 1) + "\u2026" : sentence;
}

/** Get the FIRST user message — the original goal */
function getOriginalGoal(entries: LogEntry[]): string | null {
  for (const e of entries) {
    if (e.type === "user_reply" && e.content.trim().length > 10) {
      const raw = e.content.trim();
      // Return the first substantive message, not an affirmation
      if (!SHORT_AFFIRMATION.test(raw)) {
        return raw.length > 200 ? raw.slice(0, 197) + "\u2026" : raw;
      }
    }
  }
  return null;
}

/** Find the last substantive user reply (skip short affirmations) */
function getLastUserIntent(entries: LogEntry[]): { text: string | null; timestamp: string | null } {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type === "user_reply" && e.content.trim()) {
      const raw = e.content.trim();
      if (!SHORT_AFFIRMATION.test(raw)) {
        return { text: oneLiner(raw, 80), timestamp: e.timestamp };
      }
    }
  }
  return { text: null, timestamp: null };
}

/** Count conversation turns (user replies) */
function countTurns(entries: LogEntry[]): number {
  return entries.filter((e) => e.type === "user_reply").length;
}

// ─── Styles ──────────────────────────────────────────────────

const LABEL = {
  fontSize: 9, fontWeight: 600 as const,
  fontFamily: "var(--font-inter), Inter, sans-serif",
  color: "var(--border)", textTransform: "uppercase" as const, letterSpacing: "0.04em",
};

const BODY_TEXT = {
  fontSize: 12, fontFamily: "var(--font-inter), Inter, sans-serif",
  color: "var(--muted-foreground)", lineHeight: 1.5,
};

// ─── Component ───────────────────────────────────────────────

export function ReviewQueue({ tasks, allTasks }: { tasks: Task[]; allTasks?: Task[] }) {
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [markedDone, setMarkedDone] = useState<Set<string>>(new Set());
  const [justSent, setJustSent] = useState(false);
  const [attachedFile, setAttachedFile] = useState<{ name: string; path: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pastedChips, setPastedChips] = useState<PastedChip[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const appendLogEntry = useTaskStore((s) => s.appendLogEntry);
  const fetchLogEntries = useTaskStore((s) => s.fetchLogEntries);
  const allLogEntries = useTaskStore((s) => s.logEntries);
  const openPanel = useTaskStore((s) => s.openPanel);
  const updateTask = useTaskStore((s) => s.updateTask);
  const fetchOutputFiles = useTaskStore((s) => s.fetchOutputFiles);
  const allOutputFiles = useTaskStore((s) => s.outputFiles);

  const [viewingId, setViewingId] = useState<string | null>(null);

  const queue = tasks.filter((t) => !markedDone.has(t.id)).sort((a, b) => {
    const p = (t: Task) => t.needsInput ? 0 : (t.errorMessage && t.status !== "done") ? 1 : 2;
    return p(a) !== p(b) ? p(a) - p(b) : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  const viewingIndex = viewingId ? queue.findIndex((t) => t.id === viewingId) : -1;
  const effectiveIndex = currentIndex === -1 ? 0 : currentIndex;
  const safeIndex = viewingIndex >= 0 ? viewingIndex : Math.min(effectiveIndex, Math.max(0, queue.length - 1));
  const current = queue[safeIndex] ?? null;

  useEffect(() => {
    if (queue.length > 0 && currentIndex === -1) setViewingId(queue[0].id);
  }, [queue.length]);

  useEffect(() => { if (current && current.id !== viewingId) setViewingId(current.id); }, [current?.id]);
  useEffect(() => { if (current) { fetchLogEntries(current.id); fetchOutputFiles(current.id); } }, [current?.id, fetchLogEntries, fetchOutputFiles]);
  useEffect(() => { if (safeIndex !== currentIndex) setCurrentIndex(safeIndex); }, [safeIndex, currentIndex]);
  useEffect(() => { if (current && textareaRef.current) textareaRef.current.focus(); setAttachedFile(null); setPastedChips([]); }, [current?.id]);
  useEffect(() => { if (!justSent) return; const t = setTimeout(() => setJustSent(false), 1500); return () => clearTimeout(t); }, [justSent]);
  useEffect(() => {
    syncComposerTextareaHeight(textareaRef.current, { minHeight: 40, maxHeight: 220 });
  }, [message]);

  const logEntries = current ? (allLogEntries[current.id] ?? []) : [];
  const lastInteracted = getLastUserIntent(logEntries).timestamp || current?.lastReplyAt;
  const pendingStructured = useMemo((): QuestionSpec[] => {
    if (!current || current.needsInput !== true) return [];
    for (let i = logEntries.length - 1; i >= 0; i--) {
      const entry = logEntries[i];
      if (entry.type !== "structured_question" || entry.questionAnswers) continue;
      if (!entry.questionSpec) return [];
      try {
        return parseQuestionSpecs(JSON.parse(entry.questionSpec));
      } catch {
        return [];
      }
    }
    return [];
  }, [current, logEntries]);
  const planApprovalQuestion =
    pendingStructured.find(
      (question) => question.intent === "plan_approval" || question.id === "plan_action",
    ) ?? null;
  const isInput = current.needsInput === true;
  const isPermissionWaiting =
    !planApprovalQuestion &&
    isTaskWaitingOnPermission({
      needsInput: isInput,
      activityLabel: current?.activityLabel,
      errorMessage: current?.errorMessage,
    });

  // ── Derived data ──

  const projectContext = useMemo(() => {
    if (!current || !allTasks) return null;
    if (current.parentId) {
      const parent = allTasks.find(t => t.id === current.parentId);
      if (parent) {
        const siblings = allTasks.filter(t => t.parentId === parent.id);
        const done = siblings.filter(t => t.status === "done").length;
        return { name: parent.title, done, total: siblings.length };
      }
    }
    if (current.projectSlug) {
      const projectTasks = allTasks.filter(t => t.projectSlug === current.projectSlug && t.parentId);
      if (projectTasks.length > 0) {
        const parent = allTasks.find(t => t.projectSlug === current.projectSlug && !t.parentId);
        const done = projectTasks.filter(t => t.status === "done").length;
        return { name: parent?.title || current.projectSlug, done, total: projectTasks.length };
      }
    }
    return null;
  }, [current, allTasks]);

  // Original goal: from the task description (what the user typed), or first log entry
  const originalGoal = current?.description || getOriginalGoal(logEntries) || current?.title || "";

  // Claude's latest status
  const claudeStatus = (() => {
    const label = current?.activityLabel;
    if (label && label !== "Waiting for input" && label !== "Processing reply...") {
      return label.length > 140 ? label.slice(0, 137) + "\u2026" : label;
    }
    for (let i = logEntries.length - 1; i >= 0; i--) {
      if (logEntries[i].type === "text" && logEntries[i].content.trim()) {
        return oneLiner(logEntries[i].content, 140);
      }
    }
    return null;
  })();

  // Key actions: substantive things Claude said/did
  const keyActions = useMemo(() => {
    const actions: string[] = [];
    for (const entry of logEntries) {
      if (entry.type === "text" && entry.content.trim()) {
        const cleaned = oneLiner(entry.content, 140);
        if (cleaned && cleaned.length > 15 && !actions.includes(cleaned)) {
          actions.push(cleaned);
        }
      }
    }
    return actions.slice(-6);
  }, [logEntries]);

  // Output files
  const outputFiles = current ? (allOutputFiles[current.id] ?? []) : [];

  // Tools used
  const toolsSummary = useMemo(() => {
    const toolCounts = new Map<string, number>();
    for (const entry of logEntries) {
      if (entry.type === "tool_use" && entry.toolName) {
        toolCounts.set(entry.toolName, (toolCounts.get(entry.toolName) || 0) + 1);
      }
    }
    return Array.from(toolCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => ({ name, count }));
  }, [logEntries]);

  // Stats
  const turns = countTurns(logEntries);
  const totalToolCalls = logEntries.filter((e) => e.type === "tool_use").length;

  // ── Handlers ──

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find((i) => i.type.startsWith("image/"));
    if (imageItem) {
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (file) {
        const reader = new FileReader();
        reader.onload = () => {
          setPastedChips((prev) => [...prev, {
            id: crypto.randomUUID(),
            kind: "image",
            label: buildImagePasteLabel(file.name),
            content: reader.result as string,
          }]);
        };
        reader.readAsDataURL(file);
      }
      return;
    }
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

  const handleInsertPastedText = useCallback((chip: PastedChip) => {
    const textarea = textareaRef.current;
    const selectionStart = textarea?.selectionStart ?? message.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    const insertion = insertPastedTextAtSelection(
      message,
      chip.content,
      selectionStart,
      selectionEnd,
    );

    setMessage(insertion.value);
    setPastedChips((prev) => removePendingPastedText(prev, chip.id));
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(insertion.selectionStart, insertion.selectionEnd);
      syncComposerTextareaHeight(textareaRef.current, { minHeight: 40, maxHeight: 220 });
    });
  }, [message]);

  const handleSubmit = useCallback(async () => {
    if (!current || (!message.trim() && pastedChips.length === 0) || isSending) return;
    let trimmed = appendPendingPastedText(
      message.trim(),
      pastedChips
        .filter((chip) => chip.kind === "text")
        .map((chip) => ({ id: chip.id, text: chip.content })),
    );

    // Append pasted images
    const pastedImages = pastedChips.filter((c) => c.kind === "image");
    if (pastedImages.length > 0) {
      const block = pastedImages.map((c) => `[Pasted image: ${c.label}]\n${c.content}`).join("\n\n");
      trimmed = trimmed ? `${trimmed}\n\n${block}` : block;
    }

    if (attachedFile) trimmed = `[Attached: ${attachedFile.name} at ${attachedFile.path}]\n\n${trimmed}`;
    setIsSending(true);
    appendLogEntry(current.id, { id: "local-" + crypto.randomUUID(), type: "user_reply", timestamp: new Date().toISOString(), content: trimmed });
    setMessage(""); setAttachedFile(null); setPastedChips([]);
    try {
      const res = await fetch(`/api/tasks/${current.id}/reply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: trimmed }) });
      if (!res.ok) console.error(`[review-queue] Reply failed: ${res.status}`);
    } catch { console.error("[review-queue] Reply failed"); }
    finally {
      setIsSending(false); setJustSent(true);
      if (queue.length > 1) { const n = safeIndex < queue.length - 1 ? safeIndex + 1 : 0; setCurrentIndex(n); setViewingId(queue[n]?.id ?? null); }
    }
  }, [current, message, isSending, appendLogEntry, queue, safeIndex, attachedFile, pastedChips]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  }, [handleSubmit]);

  const nav = useCallback((dir: 1 | -1) => {
    if (queue.length <= 1) return;
    const n = (safeIndex + dir + queue.length) % queue.length;
    setCurrentIndex(n); setViewingId(queue[n]?.id ?? null); setMessage("");
  }, [queue, safeIndex]);

  const handleFileUpload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/files/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      const r = await res.json();
      setAttachedFile({ name: r.fileName, path: r.relativePath });
    } catch (err) { console.error("[review-queue] Upload failed:", err); }
    finally { setUploading(false); }
  }, []);

  if (!current || queue.length === 0) return null;

  const isError = !!(current.errorMessage && current.status !== "done");
  const accentColor = isError ? "var(--destructive)" : isInput ? "var(--primary)" : "var(--primary)";
  const labelText = isError
    ? "Error"
    : planApprovalQuestion
      ? "Plan ready"
      : isPermissionWaiting
        ? "Needs permission"
        : isInput
          ? "Needs input"
          : "Review";

  const rawPrompt = isError
    ? cleanErrorMessage(current.errorMessage || "Something went wrong.")
    : planApprovalQuestion
      ? planApprovalQuestion.prompt
      : isPermissionWaiting
        ? cleanText(current.activityLabel || "Claude is waiting for permission to continue.")
        : isInput
          ? cleanText(current.errorMessage || current.activityLabel || "Claude needs your input.")
          : null;
  const prompt = rawPrompt && rawPrompt !== claudeStatus
    ? (rawPrompt.length > 200 ? rawPrompt.slice(0, 197) + "\u2026" : rawPrompt)
    : null;

  return (
    <div style={{
      marginBottom: 12, borderRadius: 10, overflow: "hidden",
      border: "1px solid var(--border)",
      backgroundColor: isInput || isError ? "color-mix(in srgb, var(--foreground) 2%, transparent)" : "color-mix(in srgb, var(--foreground) 2%, transparent)",
    }}>
      {/* ── Header: status + nav ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: accentColor, flexShrink: 0, animation: isInput || isError ? "pulse-dot 2s ease-in-out infinite" : undefined }} />
          <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "var(--font-inter), Inter, sans-serif", color: accentColor, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {labelText}
          </span>
          {queue.length > 1 && (
            <span style={{ fontSize: 10, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--muted-foreground)" }}>
              {safeIndex + 1}/{queue.length}
            </span>
          )}
          {lastInteracted && (
            <span style={{ fontSize: 10, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--border)" }}>
              · {timeAgo(lastInteracted)}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {queue.length > 1 && (<>
            <Btn onClick={() => nav(-1)} label="Previous"><ChevronLeft size={14} /></Btn>
            <Btn onClick={() => nav(1)} label="Next"><ChevronRight size={14} /></Btn>
          </>)}
          <Btn onClick={() => {
            if (!current) return;
            updateTask(current.id, { status: "done" });
            setMarkedDone((p) => new Set(p).add(current.id));
            setMessage("");
            // Advance to next item
            const remaining = queue.filter((t) => t.id !== current.id);
            if (remaining.length > 0) {
              const nextIdx = Math.min(safeIndex, remaining.length - 1);
              setCurrentIndex(nextIdx);
              setViewingId(remaining[nextIdx]?.id ?? null);
            }
          }} label="Done" hover="var(--muted-foreground)"><CheckCircle2 size={14} /></Btn>
        </div>
      </div>

      {/* ── Project breadcrumb ── */}
      {projectContext && (
        <div style={{
          padding: "4px 12px",
          borderBottom: "1px solid var(--border)",
          fontSize: 10, fontFamily: "var(--font-inter), Inter, sans-serif",
          color: "var(--muted-foreground)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ color: "var(--border)" }}>Project:</span>
          <span style={{ color: "var(--muted-foreground)", fontWeight: 500 }}>{projectContext.name}</span>
          <span>&middot;</span>
          <span>{projectContext.done}/{projectContext.total} done</span>
        </div>
      )}

      {/* ── Body ── */}
      <div style={{ padding: "12px 12px 8px" }}>

        {/* Goal — the original task, always visible */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...LABEL, marginBottom: 4 }}>Goal</div>
          <div
            onClick={() => openPanel(current.id)}
            style={{
              ...BODY_TEXT,
              fontSize: 14, fontWeight: 600, color: "var(--foreground)",
              cursor: "pointer",
              lineHeight: 1.4,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical" as const,
              overflow: "hidden",
            }}
            title="Open full conversation"
          >
            {originalGoal}
          </div>
        </div>

        {/* Error / Input prompt — prominent when present */}
        {prompt && (
          <div style={{
            padding: "8px 12px", marginBottom: 12,
            backgroundColor: isError ? "color-mix(in srgb, var(--foreground) 6%, transparent)" : "color-mix(in srgb, var(--foreground) 6%, transparent)",
            borderRadius: 6, borderLeft: `3px solid ${accentColor}`,
          }}>
            {isInput && <div style={{ ...LABEL, color: accentColor, marginBottom: 4 }}>Claude is asking</div>}
            {isError && <div style={{ ...LABEL, color: "var(--destructive)", marginBottom: 4 }}>Error</div>}
            <div style={{ ...BODY_TEXT, fontSize: 13, color: isError ? "var(--muted-foreground)" : "var(--muted-foreground)" }}>
              {prompt}
            </div>
          </div>
        )}

        {/* Claude's status — what it last reported */}
        {claudeStatus && !prompt && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ ...LABEL, marginBottom: 4 }}>Status</div>
            <div style={{
              ...BODY_TEXT,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical" as const,
              overflow: "hidden",
            }}>
              {claudeStatus}
            </div>
          </div>
        )}

        {/* What happened — action timeline */}
        {keyActions.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ ...LABEL, marginBottom: 4 }}>What happened</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {keyActions.map((action, i) => (
                <div key={i} style={{
                  ...BODY_TEXT,
                  fontSize: 11,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  paddingLeft: 8,
                  borderLeft: i === keyActions.length - 1
                    ? `2px solid ${accentColor}`
                    : "2px solid var(--border)",
                }}>
                  {action}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Outputs — clickable file chips */}
        {outputFiles.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ ...LABEL, marginBottom: 4 }}>Outputs</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {outputFiles.map((f) => (
                <span
                  key={f.id}
                  onClick={(e) => { e.stopPropagation(); openPanel(current.id); }}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    fontSize: 11,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    color: "var(--primary)",
                    backgroundColor: "color-mix(in srgb, var(--foreground) 6%, transparent)",
                    padding: "4px 8px",
                    borderRadius: 4,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    transition: "background 100ms ease",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 12%, transparent)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 6%, transparent)"; }}
                  title={f.relativePath}
                >
                  <FileText size={10} />
                  {f.fileName}
                  <ExternalLink size={8} style={{ opacity: 0.5 }} />
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Stats bar — turns, duration, tool calls */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "4px 0",
          borderTop: "1px solid var(--border)",
          fontSize: 10, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--border)",
        }}>
          {turns > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <MessageCircle size={9} /> {turns} {turns === 1 ? "turn" : "turns"}
            </span>
          )}
          {(current.durationMs ?? 0) > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Clock size={9} /> {formatDuration(current.durationMs!)}
            </span>
          )}
          {totalToolCalls > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Wrench size={9} /> {totalToolCalls} tool {totalToolCalls === 1 ? "call" : "calls"}
            </span>
          )}
          {toolsSummary.length > 0 && (
            <span style={{ color: "var(--border)", marginLeft: "auto" }}>
              {toolsSummary.slice(0, 3).map((t) => t.name).join(", ")}
            </span>
          )}
        </div>
      </div>

      {/* ── Input ── */}
      <div style={{ padding: "8px 12px 12px", borderTop: "1px solid var(--border)" }}>
        {(planApprovalQuestion || isInput || current.status === "review") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {planApprovalQuestion && (
              <PlanApprovalActions
                taskId={current.id}
                question={planApprovalQuestion}
                message={message}
                onSubmitted={() => {
                  setMessage("");
                  fetchLogEntries(current.id);
                }}
              />
            )}
            <PermissionApprovalActions
              taskId={current.id}
              isPermissionWaiting={isPermissionWaiting}
              activityLabel={current.activityLabel}
              errorMessage={current.errorMessage}
              onResolved={() => {
                fetchLogEntries(current.id);
              }}
            />
          </div>
        )}
        {justSent ? (
          <div style={{ fontSize: 12, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--muted-foreground)", padding: "4px 0", display: "flex", alignItems: "center", gap: 8 }}>
            <MessageCircle size={12} /> Sent{queue.length > 1 ? " - next" : ""}
          </div>
        ) : (
          <>
            {(attachedFile || pastedChips.length > 0) && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
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
                {attachedFile && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 8px", backgroundColor: "color-mix(in srgb, var(--foreground) 6%, transparent)", borderRadius: 4, fontSize: 11, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--primary)" }}>
                    <Paperclip size={9} /> {attachedFile.name}
                    <button onClick={() => setAttachedFile(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--muted-foreground)", display: "flex" }}><X size={9} /></button>
                  </div>
                )}
                {pastedChips.filter((chip) => chip.kind === "image").map((chip) => (
                  <div key={chip.id} style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "4px 8px", borderRadius: 4, fontSize: 11,
                    fontFamily: "'DM Mono', monospace",
                    backgroundColor: chip.kind === "image" ? "color-mix(in srgb, var(--foreground) 6%, transparent)" : "color-mix(in srgb, var(--foreground) 6%, transparent)",
                    color: chip.kind === "image" ? "var(--primary)" : "var(--muted-foreground)",
                  }}>
                    {chip.kind === "image" ? <span style={{ fontSize: 10 }}>&var(--muted-foreground);</span> : <FileText size={9} />}
                    <span>Pasted {chip.label}</span>
                    <button onClick={() => setPastedChips((prev) => removePendingPastedText(prev, chip.id))} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--muted-foreground)", display: "flex" }}><X size={9} /></button>
                  </div>
                ))}
                </div>
              </div>
            )}
            <div style={{ position: "relative" }}>
              <input ref={fileInputRef} type="file" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = ""; }} style={{ display: "none" }} accept={CHAT_ATTACHMENT_ACCEPT_ATTR} />
              <textarea
                ref={textareaRef} value={message} onChange={(e) => setMessage(e.target.value)} onPaste={handlePaste} onKeyDown={handleKeyDown}
                placeholder={
                  planApprovalQuestion
                    ? "Add changes or context before choosing an action..."
                    : isPermissionWaiting
                      ? "Add context or follow up..."
                      : isInput
                        ? "Reply to Claude..."
                        : "Follow up..."
                }
                rows={1}
                style={{
                  width: "100%", fontSize: 13, fontFamily: "var(--font-inter), Inter, sans-serif",
                  padding: "8px 64px 8px 12px", backgroundColor: "var(--card)",
                  outline: "1px solid color-mix(in srgb, var(--foreground) 20%, transparent)", borderRadius: 8,
                  border: "none", resize: "none", lineHeight: 1.5, color: "var(--foreground)", boxSizing: "border-box",
                  minHeight: 40, maxHeight: 220, maxWidth: "100%",
                  whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word",
                  overflowX: "hidden", overflowY: "auto",
                }}
                onFocus={(e) => { (e.target as HTMLTextAreaElement).style.outlineColor = accentColor; }}
                onBlur={(e) => { (e.target as HTMLTextAreaElement).style.outlineColor = "color-mix(in srgb, var(--foreground) 30%, transparent)"; }}
              />
              <div style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 4 }}>
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading} title="Attach file"
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 6, border: "none", background: "none", cursor: uploading ? "wait" : "pointer", color: attachedFile ? "var(--primary)" : "var(--border)", transition: "color 100ms ease" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--primary)"; }} onMouseLeave={(e) => { e.currentTarget.style.color = attachedFile ? "var(--primary)" : "var(--border)"; }}
                >{uploading ? <span style={{ width: 11, height: 11, borderRadius: "50%", border: "2px solid var(--border)", borderTopColor: "var(--primary)", animation: "spin 1s linear infinite", display: "inline-block" }} /> : <Paperclip size={14} />}</button>
                <button onClick={handleSubmit} disabled={(!message.trim() && !attachedFile && pastedChips.length === 0) || isSending}
                  style={{
                    width: 26, height: 26, borderRadius: 5, border: "none",
                    background: (message.trim() || attachedFile || pastedChips.length > 0) && !isSending ? accentColor : "transparent",
                    color: (message.trim() || attachedFile || pastedChips.length > 0) && !isSending ? "var(--card)" : "var(--border)",
                    cursor: (message.trim() || attachedFile || pastedChips.length > 0) && !isSending ? "pointer" : "default",
                    display: "flex", alignItems: "center", justifyContent: "center", transition: "all 150ms ease",
                  }}
                ><ArrowUp size={13} /></button>
              </div>
            </div>
          </>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function Btn({ onClick, label, children, hover }: { onClick: () => void; label: string; children: React.ReactNode; hover?: string }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} title={label}
      style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 4, color: "var(--muted-foreground)", transition: "color 100ms ease" }}
      onMouseEnter={(e) => { e.currentTarget.style.color = hover || "var(--muted-foreground)"; }} onMouseLeave={(e) => { e.currentTarget.style.color = "var(--muted-foreground)"; }}
    >{children}</button>
  );
}

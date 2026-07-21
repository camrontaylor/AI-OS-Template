"use client";

import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { ArrowUp, FileText, Search, Terminal, Globe, Wrench, ListChecks, ChevronDown, ChevronRight, Check, Circle, MessageSquare } from "lucide-react";
import type { Task, LogEntry, PermissionMode, Todo } from "@/types/task";
import { ChatEntry, TextGroup, FileOutputCard, SkillInvocationCard, isFileOutputEntry, isSkillEntry, parseFileOutput } from "./chat-entry";
import { parseTodosFromInput } from "@/lib/claude-parser";
import { shouldShowTaskErrorBanner } from "@/lib/task-logs";
import {
  PermissionApprovalActions,
  PlanApprovalActions,
} from "@/components/shared/task-approval-actions";
import {
  DraftPlanPreviewCard,
  DraftPlanPreviewModal,
} from "@/components/shared/draft-plan-preview";
import {
  getPendingPlanReviewData,
  stripApprovedBriefBlockFromText,
} from "@/lib/plan-brief";
import {
  parseQuestionSpecs,
  extractQuestionSpecsFromText,
  stripQuestionSpecsFromText,
} from "@/types/question-spec";
import { isTaskWaitingOnPermission } from "@/lib/task-permissions";
import { hasVisibleAssistantResponse, shouldShowInitialTaskSpinner } from "@/lib/task-chat";

/* ── Claude-style spinner verbs ─────────────────────────────────────── */

const SPINNER_VERBS = [
  "Accomplishing", "Actioning", "Actualizing", "Architecting", "Baking",
  "Beaming", "Beboppin'", "Befuddling", "Billowing", "Blanching",
  "Bloviating", "Boogieing", "Boondoggling", "Booping", "Bootstrapping",
  "Brewing", "Bunning", "Burrowing", "Calculating", "Canoodling",
  "Caramelizing", "Cascading", "Catapulting", "Cerebrating", "Channeling",
  "Choreographing", "Churning", "Clauding", "Coalescing", "Cogitating",
  "Combobulating", "Composing", "Computing", "Concocting", "Considering",
  "Contemplating", "Cooking", "Crafting", "Creating", "Crunching",
  "Crystallizing", "Cultivating", "Deciphering", "Deliberating",
  "Dilly-dallying", "Discombobulating", "Doodling", "Drizzling",
  "Ebbing", "Effecting", "Elucidating", "Embellishing", "Enchanting",
  "Envisioning", "Evaporating", "Fermenting", "Fiddle-faddling",
  "Finagling", "Flambe-ing", "Flibbertigibbeting", "Flowing",
  "Flummoxing", "Fluttering", "Forging", "Forming", "Frolicking",
  "Frosting", "Gallivanting", "Galloping", "Garnishing", "Generating",
  "Gesticulating", "Germinating", "Grooving", "Gusting", "Harmonizing",
  "Hashing", "Hatching", "Herding", "Honking", "Hullaballooing",
  "Hyperspacing", "Ideating", "Imagining", "Improvising", "Incubating",
  "Inferring", "Infusing", "Ionizing", "Jitterbugging", "Julienning",
  "Kneading", "Leavening", "Levitating", "Lollygagging", "Manifesting",
  "Marinating", "Meandering", "Metamorphosing", "Misting", "Moonwalking",
  "Moseying", "Mulling", "Mustering", "Musing", "Nebulizing", "Nesting",
  "Noodling", "Nucleating", "Orbiting", "Orchestrating", "Osmosing",
  "Perambulating", "Percolating", "Perusing", "Philosophising",
  "Photosynthesizing", "Pollinating", "Pondering", "Pontificating",
  "Pouncing", "Precipitating", "Prestidigitating", "Processing",
  "Proofing", "Propagating", "Puttering", "Puzzling", "Quantumizing",
  "Razzle-dazzling", "Razzmatazzing", "Recombobulating", "Reticulating",
  "Roosting", "Ruminating", "Sauteing", "Scampering", "Schlepping",
  "Scurrying", "Seasoning", "Shenaniganing", "Shimmying", "Simmering",
  "Skedaddling", "Sketching", "Slithering", "Smooshing", "Sock-hopping",
  "Spelunking", "Spinning", "Sprouting", "Stewing", "Sublimating",
  "Swirling", "Swooping", "Symbioting", "Synthesizing", "Tempering",
  "Thinking", "Thundering", "Tinkering", "Tomfoolering", "Topsy-turvying",
  "Transfiguring", "Transmuting", "Twisting", "Undulating", "Unfurling",
  "Unravelling", "Vibing", "Waddling", "Wandering", "Warping",
  "Whatchamacalliting", "Whirlpooling", "Whirring", "Whisking",
  "Wibbling", "Working", "Wrangling", "Zesting", "Zigzagging",
];

function randomVerb(): string {
  return SPINNER_VERBS[Math.floor(Math.random() * SPINNER_VERBS.length)];
}

/** Claude-style spinner: cycles through random verbs with a spinning asterisk.
 *  `turnStartedAt` is the most recent turn start (last user reply or task start). */
function SpinnerVerb({ startedAt, lastReplyAt, activityLabel }: { startedAt?: string | null; lastReplyAt?: string | null; activityLabel?: string | null }) {
  const [verb, setVerb] = useState(randomVerb);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setVerb(randomVerb()), 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const origin = lastReplyAt || startedAt;
    if (!origin) return;
    const start = new Date(origin).getTime();
    if (isNaN(start)) return;
    setElapsed(0);
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [lastReplyAt, startedAt]);

  return (
    <>
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 2px",
      }}
    >
      <span
        style={{
          display: "inline-block",
          fontSize: 16,
          color: "var(--border)",
          animation: "spin 1.5s linear infinite",
        }}
      >
        ✳
      </span>
      <span
        style={{
          fontSize: 14,
          fontFamily: "'DM Mono', monospace",
          color: "var(--border)",
          fontWeight: 500,
        }}
      >
        {verb}…
      </span>
      {elapsed > 0 && (
        <span
          style={{
            fontSize: 12,
            fontFamily: "'DM Mono', monospace",
            color: "var(--muted-foreground)",
            fontWeight: 400,
          }}
        >
          {formatDuration(elapsed)}
        </span>
      )}
    </div>
    {activityLabel && (
      <div
        style={{
          fontSize: 11,
          fontFamily: "'DM Mono', monospace",
          color: "var(--muted-foreground)",
          paddingLeft: 24,
          marginTop: -4,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {activityLabel}
      </div>
    )}
    </>
  );
}

/** Format seconds into "Xm Ys" or "Xs". */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** Convert "Sauteing" → "Sautéed", "Cooking" → "Cooked", etc. */
function toPastTense(verb: string): string {
  // Special cases
  const specials: Record<string, string> = {
    "Sauteing": "Sautéed", "Beboppin'": "Bebopped", "Clauding": "Clauded",
    "Flambe-ing": "Flambéed", "Sock-hopping": "Sock-hopped",
  };
  if (specials[verb]) return specials[verb];
  // Remove "ing" and figure out the past tense
  let stem = verb.replace(/ing$/, "");
  // Double consonant: "Running" → "Runn" → "Ran" (but we just add "ed")
  // Words ending in consonant+consonant: "Hashing" → "Hash" → "Hashed"
  if (stem.endsWith("ll") || stem.endsWith("tt") || stem.endsWith("pp") || stem.endsWith("rr") || stem.endsWith("ss") || stem.endsWith("zz") || stem.endsWith("nn") || stem.endsWith("mm") || stem.endsWith("dd") || stem.endsWith("gg") || stem.endsWith("bb")) {
    return stem + "ed";
  }
  // Words like "Cascading" → "Cascad" → need "Cascaded"
  // Words like "Creating" → "Creat" → "Created"
  // If stem ends in consonant, check if the original word had a trailing "e" before "ing"
  const lastChar = stem.slice(-1);
  if (!"aeiou".includes(lastChar.toLowerCase())) {
    // Try adding "ed" directly
    return stem + "ed";
  }
  // Stem ends in vowel — likely had trailing "e": "Composing" → "Compos" → "Composed"
  return stem + "d";
}

/** Persist random verbs across re-renders by taskId */
const completedVerbCache = new Map<string, string>();

/** "Sautéed for Xm Ys · 2,847 tokens · $0.47" — shown after a task completes. */
function CompletedVerb({
  durationSeconds,
  costUsd,
  tokensUsed,
  taskId,
  isReview,
}: {
  durationSeconds: number;
  costUsd?: number | null;
  tokensUsed?: number | null;
  taskId?: string;
  isReview?: boolean;
}) {
  const [verb] = useState(() => {
    if (taskId && completedVerbCache.has(taskId)) return completedVerbCache.get(taskId)!;
    const v = randomVerb();
    if (taskId) completedVerbCache.set(taskId, v);
    return v;
  });

  const accentColor = "var(--primary)";
  const mutedColor = "var(--muted-foreground)";
  const color = isReview ? accentColor : mutedColor;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 2px",
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontSize: 14, color }}>✳</span>
      <span
        style={{
          fontSize: 14,
          fontFamily: "'DM Mono', monospace",
          color,
          fontWeight: isReview ? 500 : 400,
        }}
      >
        {isReview ? "Your turn · " : ""}{toPastTense(verb)} for {formatDuration(durationSeconds)}
        {tokensUsed != null && tokensUsed > 0 && (
          <span style={{ color: mutedColor, fontWeight: 400 }}> · {tokensUsed.toLocaleString()} tokens</span>
        )}
        {costUsd != null && costUsd > 0 && (
          <span style={{ color: mutedColor, fontWeight: 400 }}> · ${costUsd.toFixed(2)}</span>
        )}
      </span>
    </div>
  );
}

/** Red error banner shown when a task fails. */
function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      style={{
        background: "var(--card)",
        borderLeft: "3px solid var(--destructive)",
        borderRadius: "0 0.5rem 0.5rem 0",
        padding: "10px 14px",
        marginBottom: 4,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontWeight: 600,
          color: "var(--destructive)",
          marginBottom: 4,
        }}
      >
        Error
      </div>
      <div
        style={{
          fontSize: 12,
          fontFamily: "'DM Mono', monospace",
          color: "var(--foreground)",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {message}
      </div>
    </div>
  );
}

/* ─────────────────── Vibe Kanban-style tool rows ─────────────────── */

/** Icon + color mapping for tool compact rows */
function toolRowVisual(toolName: string): { Icon: React.ComponentType<{ size?: number; color?: string; style?: React.CSSProperties }>; label: string } {
  const n = (toolName || "").toLowerCase();
  if (n === "read") return { Icon: FileText, label: "Read" };
  if (n === "glob") return { Icon: Search, label: "Search" };
  if (n === "grep") return { Icon: Search, label: "Search" };
  if (n === "bash") return { Icon: Terminal, label: "Bash" };
  if (n === "webfetch") return { Icon: Globe, label: "Fetch" };
  if (n === "websearch") return { Icon: Globe, label: "Web Search" };
  return { Icon: Wrench, label: toolName || "Tool" };
}

/** Extract a short detail string from tool args */
function toolRowDetail(entry: LogEntry): string | null {
  if (!entry.toolArgs) return null;
  try {
    const args = JSON.parse(entry.toolArgs) as Record<string, unknown>;
    const name = (entry.toolName || "").toLowerCase();
    if (typeof args.file_path === "string") {
      return args.file_path.split("/").pop() || args.file_path;
    }
    if (typeof args.path === "string") {
      return args.path.split("/").pop() || args.path;
    }
    if (typeof args.pattern === "string") {
      return args.pattern.length > 40 ? args.pattern.slice(0, 40) + "…" : args.pattern;
    }
    if (typeof args.query === "string") {
      return args.query.length > 40 ? args.query.slice(0, 40) + "…" : args.query;
    }
    if (typeof args.url === "string") {
      try { return new URL(args.url).hostname.replace(/^www\./, ""); } catch { return args.url.slice(0, 40); }
    }
    if (typeof args.command === "string") {
      const cmd = args.command.trim();
      return cmd.length > 50 ? cmd.slice(0, 50) + "…" : cmd;
    }
    if (typeof args.description === "string") {
      return args.description.length > 50 ? args.description.slice(0, 50) + "…" : args.description;
    }
    return null;
  } catch { return null; }
}

/** Compact single-line row for a tool call — or aggregated "Read · 4 files" */
function ToolCompactRow({ toolName, entries }: { toolName: string; entries: LogEntry[] }) {
  const { Icon, label } = toolRowVisual(toolName);
  const count = entries.length;

  // Single entry: show detail (e.g. "Read README.md")
  if (count === 1) {
    const detail = toolRowDetail(entries[0]);
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "3px 2px",
          fontSize: 13,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          color: "var(--border)",
          lineHeight: 1.4,
        }}
      >
        <Icon size={13} color="var(--muted-foreground)" style={{ flexShrink: 0 }} />
        <span>{label}</span>
        {detail && (
          <span style={{ color: "var(--muted-foreground)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {detail}
          </span>
        )}
      </div>
    );
  }

  // Multiple entries: "Read · 4 files"
  const noun = label === "Search" ? "searches" : label === "Bash" ? "commands" : "files";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "3px 2px",
        fontSize: 13,
        fontFamily: "var(--font-inter), Inter, sans-serif",
        color: "var(--border)",
        lineHeight: 1.4,
      }}
    >
      <Icon size={13} color="var(--muted-foreground)" style={{ flexShrink: 0 }} />
      <span>{label}</span>
      <span style={{ color: "var(--muted-foreground)" }}>· {count} {noun}</span>
    </div>
  );
}

/** Collapsible thinking-group: collapses tool activity + narration into
 *  an indented, expandable block. Shows a summary line when collapsed. */
function ThinkingGroup({
  items,
  onPreviewFile,
  activePreviewPath,
  permissionMode,
  taskId,
  readOnly,
}: {
  items: RenderItem[];
  onPreviewFile?: (file: { relativePath: string; extension: string; fileName: string }) => void;
  activePreviewPath?: string | null;
  permissionMode?: PermissionMode;
  taskId?: string;
  readOnly?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  // Count tools and narration lines for the summary
  const toolCount = items.filter((it) =>
    it.kind === "tool-row" || it.kind === "file-output" || it.kind === "todo-update" || it.kind === "skill-invocation"
  ).length;
  const textCount = items.filter((it) => it.kind === "text-group").length;

  // Build summary label
  const parts: string[] = [];
  if (toolCount > 0) parts.push(`${toolCount} tool${toolCount === 1 ? "" : "s"}`);
  if (textCount > 0) parts.push(`${textCount} step${textCount === 1 ? "" : "s"}`);
  const summary = parts.length > 0 ? parts.join(", ") : "Activity";

  return (
    <div style={{ marginTop: 4, marginBottom: 4 }}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 2px",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: 12,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          color: "var(--muted-foreground)",
          fontWeight: 500,
          lineHeight: 1.4,
        }}
      >
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <MessageSquare size={12} style={{ flexShrink: 0 }} />
        <span>Thinking</span>
        {!expanded && (
          <span style={{ color: "var(--border)" }}>{summary}</span>
        )}
      </button>
      {expanded && (
        <div
          style={{
            borderLeft: "2px solid color-mix(in srgb, var(--foreground) 40%, transparent)",
            marginLeft: 6,
            paddingLeft: 14,
            marginTop: 4,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {items.map((sub, idx) => {
            if (sub.kind === "text-group") {
              return (
                <div key={sub.entries[0].id} style={{ marginTop: 2, marginBottom: 2 }}>
                  <TextGroup entries={sub.entries} onPreviewFile={onPreviewFile} variant="narration" />
                </div>
              );
            }
            if (sub.kind === "tool-row") {
              return (
                <div key={sub.entries[0].id}>
                  <ToolCompactRow toolName={sub.toolName} entries={sub.entries} />
                </div>
              );
            }
            if (sub.kind === "file-output") {
              const info = parseFileOutput(sub.entry);
              const active = !!info && activePreviewPath === info.relativePath;
              return (
                <div key={sub.entry.id} style={{ marginTop: 4, marginBottom: 4 }}>
                  <FileOutputCard
                    entry={sub.entry}
                    isActive={active}
                    onPreview={
                      onPreviewFile && info
                        ? (p) => onPreviewFile({ ...p, fileName: info.fileName })
                        : undefined
                    }
                  />
                </div>
              );
            }
            if (sub.kind === "skill-invocation") {
              return (
                <div key={sub.entry.id} style={{ marginTop: 4, marginBottom: 4 }}>
                  <SkillInvocationCard entry={sub.entry} />
                </div>
              );
            }
            if (sub.kind === "todo-update") {
              return (
                <div key={sub.entry.id}>
                  <TodoUpdateCard entry={sub.entry} />
                </div>
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}

/** Collapsible "Updated Todos" card — shows todo items when expanded */
function TodoUpdateCard({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);

  const todos: Todo[] = useMemo(() => {
    if (!entry.toolArgs) return [];
    try {
      const args = JSON.parse(entry.toolArgs);
      return parseTodosFromInput(args) || [];
    } catch { return []; }
  }, [entry.toolArgs]);

  return (
    <div style={{ width: "100%" }}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "3px 2px",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: 12,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          color: "var(--muted-foreground)",
          fontWeight: 500,
          lineHeight: 1.4,
        }}
      >
        <ListChecks size={13} color="var(--muted-foreground)" style={{ flexShrink: 0 }} />
        <span>Updated Todos</span>
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </button>
      {expanded && todos.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            paddingLeft: 22,
            marginTop: 2,
            marginBottom: 4,
          }}
        >
          {todos.map((todo, i) => {
            const isDone = todo.status === "completed";
            const isActive = todo.status === "in_progress";
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  color: isDone ? "var(--muted-foreground)" : isActive ? "var(--border)" : "var(--muted-foreground)",
                  lineHeight: 1.4,
                }}
              >
                {isDone ? (
                  <Check size={12} color="var(--muted-foreground)" style={{ flexShrink: 0 }} />
                ) : (
                  <Circle size={12} color={isActive ? "var(--border)" : "var(--muted-foreground)"} style={{ flexShrink: 0 }} />
                )}
                <span>{todo.content}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Group consecutive entries for Vibe Kanban-style rendering:
 * - Consecutive text entries → TextGroup (merged prose)
 * - Consecutive same-type tool calls → ToolCompactRow (aggregated)
 * - TodoWrite → TodoUpdateCard (collapsible)
 * - File writes → FileOutputCard
 * - Skill invocations → SkillInvocationCard
 * - Everything else → individual ChatEntry
 */
type RenderItem =
  | { kind: "text-group"; entries: LogEntry[] }
  | { kind: "tool-group"; entries: LogEntry[] }
  | { kind: "tool-row"; toolName: string; entries: LogEntry[] }
  | { kind: "todo-update"; entry: LogEntry }
  | { kind: "file-output"; entry: LogEntry }
  | { kind: "skill-invocation"; entry: LogEntry }
  | { kind: "thinking-group"; items: RenderItem[] }
  | { kind: "single"; entry: LogEntry }
  | { kind: "child-question"; childTask: Task; entry: LogEntry }
  | { kind: "child-review"; childTask: Task }
  | { kind: "phase-divider"; childTask: Task };

/** A merged timeline entry with a sort key */
type TimelineEntry =
  | { kind: "parent"; entry: LogEntry }
  | { kind: "child-question"; childTask: Task; entry: LogEntry }
  | { kind: "child-review"; childTask: Task; timestamp: string }
  | { kind: "phase-divider"; childTask: Task; timestamp: string };

/** Normalize a tool name to a grouping key for aggregation.
 *  e.g. "Read" and "Read" → same key, "Grep" and "Glob" → both "Search" */
function toolGroupKey(toolName: string): string {
  const n = (toolName || "").toLowerCase();
  if (n === "grep" || n === "glob") return "search";
  return n;
}

/** True when a tool_use is a TodoWrite call */
function isTodoEntry(entry: LogEntry): boolean {
  return entry.type === "tool_use" && (entry.toolName || "").toLowerCase() === "todowrite";
}

function groupEntries(entries: LogEntry[]): RenderItem[] {
  const items: RenderItem[] = [];
  let currentTextGroup: LogEntry[] = [];
  // Buffer for consecutive same-type tool calls to aggregate
  let currentToolBuffer: LogEntry[] = [];
  let currentToolKey: string | null = null;

  const flushTextGroup = () => {
    if (currentTextGroup.length > 0) {
      items.push({ kind: "text-group", entries: [...currentTextGroup] });
      currentTextGroup = [];
    }
  };

  const flushToolBuffer = () => {
    if (currentToolBuffer.length > 0 && currentToolKey) {
      items.push({
        kind: "tool-row",
        toolName: currentToolBuffer[0].toolName || "",
        entries: [...currentToolBuffer],
      });
      currentToolBuffer = [];
      currentToolKey = null;
    }
  };

  for (const originalEntry of entries) {
    let entry = originalEntry;
    if (entry.type === "text") {
      const extracted = extractQuestionSpecsFromText(entry.content);
      if (extracted) {
        const cleaned = stripQuestionSpecsFromText(entry.content, extracted.matchedText);
        if (!cleaned) {
          continue;
        }
        if (cleaned !== entry.content) {
          entry = { ...entry, content: cleaned };
        }
      }
      const cleanedApprovedBrief = stripApprovedBriefBlockFromText(entry.content);
      if (!cleanedApprovedBrief) {
        continue;
      }
      if (cleanedApprovedBrief !== entry.content) {
        entry = { ...entry, content: cleanedApprovedBrief };
      }
    }

    if (entry.type === "text" || entry.type === "question") {
      flushToolBuffer();
      currentTextGroup.push(entry);
    } else if (entry.type === "tool_result") {
      // tool_result entries are hidden — their content is noise
      continue;
    } else if (entry.type === "tool_use") {
      flushTextGroup();
      // File writes/edits get their own inline card
      if (isFileOutputEntry(entry)) {
        flushToolBuffer();
        items.push({ kind: "file-output", entry });
      } else if (isSkillEntry(entry)) {
        flushToolBuffer();
        items.push({ kind: "skill-invocation", entry });
      } else if (isTodoEntry(entry)) {
        flushToolBuffer();
        items.push({ kind: "todo-update", entry });
      } else {
        // Aggregate consecutive same-type tool calls
        const key = toolGroupKey(entry.toolName || "");
        if (currentToolKey && currentToolKey === key) {
          currentToolBuffer.push(entry);
        } else {
          flushToolBuffer();
          currentToolKey = key;
          currentToolBuffer = [entry];
        }
      }
    } else if (
      entry.type === "system" &&
      currentToolBuffer.length > 0 &&
      /permission|approved|denied|waiting for|plan approval/i.test(entry.content)
    ) {
      // Absorb permission system messages silently
      continue;
    } else {
      flushTextGroup();
      flushToolBuffer();
      items.push({ kind: "single", entry });
    }
  }
  flushTextGroup();
  flushToolBuffer();

  return items;
}

/**
 * Build a merged timeline of parent log entries and child task events,
 * then group the parent entries as before while inserting child events
 * at the correct chronological position.
 */
function buildMergedTimeline(
  parentEntries: LogEntry[],
  childTasks: Task[],
  childLogEntries: Record<string, LogEntry[]>,
): RenderItem[] {
  // Collect all timeline entries
  const timeline: TimelineEntry[] = [];

  // Add all parent entries
  for (const entry of parentEntries) {
    timeline.push({ kind: "parent", entry });
  }

  // Add child question entries, review banners, and phase dividers
  const seenPhases = new Set<string>();
  for (const child of childTasks) {
    const childLogs = childLogEntries[child.id] || [];

    // Insert a phase divider before the first log entry from each child
    if (childLogs.length > 0 && !seenPhases.has(child.id)) {
      seenPhases.add(child.id);
      timeline.push({
        kind: "phase-divider",
        childTask: child,
        timestamp: childLogs[0].timestamp,
      });
    }

    for (const entry of childLogs) {
      if (entry.type === "question") {
        timeline.push({ kind: "child-question", childTask: child, entry });
      }
    }
    // If child is in review status, add a review banner
    if (child.status === "review") {
      timeline.push({
        kind: "child-review",
        childTask: child,
        timestamp: child.updatedAt,
      });
    }
  }

  // Sort by timestamp
  timeline.sort((a, b) => {
    const tsA = a.kind === "parent" ? a.entry.timestamp
      : a.kind === "child-question" ? a.entry.timestamp
      : a.timestamp;
    const tsB = b.kind === "parent" ? b.entry.timestamp
      : b.kind === "child-question" ? b.entry.timestamp
      : b.timestamp;
    return tsA.localeCompare(tsB);
  });

  // Now group: collect consecutive parent entries and group them,
  // insert child events as standalone items
  const result: RenderItem[] = [];
  let parentBuffer: LogEntry[] = [];

  const flushParentBuffer = () => {
    if (parentBuffer.length > 0) {
      result.push(...groupEntries(parentBuffer));
      parentBuffer = [];
    }
  };

  for (const item of timeline) {
    if (item.kind === "parent") {
      parentBuffer.push(item.entry);
    } else if (item.kind === "child-question") {
      flushParentBuffer();
      result.push({ kind: "child-question", childTask: item.childTask, entry: item.entry });
    } else if (item.kind === "child-review") {
      flushParentBuffer();
      result.push({ kind: "child-review", childTask: item.childTask });
    } else if (item.kind === "phase-divider") {
      flushParentBuffer();
      result.push({ kind: "phase-divider", childTask: item.childTask });
    }
  }
  flushParentBuffer();

  return result;
}

function isPendingPlanApprovalEntry(entry: LogEntry): boolean {
  if (entry.type !== "structured_question" || entry.questionAnswers || !entry.questionSpec) {
    return false;
  }

  try {
    const specs = parseQuestionSpecs(JSON.parse(entry.questionSpec));
    return specs.some((question) => question.intent === "plan_approval" || question.id === "plan_action");
  } catch {
    return false;
  }
}

/** Compact inline reply input for child task questions */
function ChildReplyInput({ childTaskId, onReplySent }: { childTaskId: string; onReplySent: (childId: string, message: string) => void }) {
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);

  const handleSubmit = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed || isSending) return;

    setIsSending(true);
    setMessage("");

    try {
      const res = await fetch(`/api/tasks/${childTaskId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      if (res.ok) {
        onReplySent(childTaskId, trimmed);
      }
    } catch {
      // Silently fail
    } finally {
      setIsSending(false);
    }
  }, [message, isSending, childTaskId, onReplySent]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
      <input
        type="text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder="Reply to this subtask..."
        style={{
          flex: 1,
          fontSize: 13,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          padding: "6px 10px",
          backgroundColor: "var(--card)",
          border: "1px solid color-mix(in srgb, var(--foreground) 40%, transparent)",
          borderRadius: "0.375rem",
          color: "var(--foreground)",
          outline: "none",
          lineHeight: 1.4,
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = "var(--primary)"; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = "color-mix(in srgb, var(--foreground) 40%, transparent)"; }}
      />
      <button
        onClick={handleSubmit}
        disabled={!message.trim() || isSending}
        style={{
          width: 28,
          height: 28,
          borderRadius: "0.375rem",
          border: "none",
          background: message.trim() && !isSending
            ? "linear-gradient(135deg, var(--primary), var(--primary))"
            : "var(--border)",
          color: message.trim() && !isSending ? "var(--card)" : "var(--muted-foreground)",
          cursor: message.trim() && !isSending ? "pointer" : "default",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          transition: "background 150ms ease",
        }}
      >
        <ArrowUp size={14} />
      </button>
    </div>
  );
}

interface ModalChatProps {
  taskId: string;
  logEntries: LogEntry[];
  isRunning: boolean;
  needsInput: boolean;
  status: string;
  childTasks?: Task[];
  childLogEntries?: Record<string, LogEntry[]>;
  onPreviewFile?: (file: { relativePath: string; extension: string; fileName: string }) => void;
  activePreviewPath?: string | null;
  /**
   * Read-only mode: used when this chat is rendered as a parent "aggregated
   * activity" surface. Hides inline child reply inputs — the user replies to
   * subtasks by drilling into them directly.
   */
  readOnly?: boolean;
  /** When set, scroll to the first log entry from this source task ID. */
  scrollToTaskId?: string | null;
  /** Called after the scroll completes (so parent can clear the state). */
  onScrollComplete?: () => void;
  /** Permission mode of the task — shown on user reply bubbles. */
  permissionMode?: PermissionMode;
  /** Current activity label from Claude (e.g. "Reading file...", "Writing code...") */
  activityLabel?: string | null;
  /** ISO timestamp when the task started running — used for elapsed timer */
  startedAt?: string | null;
  /** ISO timestamp of the most recent user reply — resets the thinking timer */
  lastReplyAt?: string | null;
  /** Cost in USD from Claude API */
  costUsd?: number | null;
  /** Total tokens used */
  tokensUsed?: number | null;
  /** Error message if the task failed */
  errorMessage?: string | null;
  /** Actual Claude CLI compute time in ms (accumulated across turns) */
  durationMs?: number | null;
  /** Re-fetch parent state after inline approval actions */
  onRefresh?: () => void;
}

export function ModalChat({
  taskId,
  logEntries,
  isRunning,
  needsInput,
  status,
  childTasks = [],
  childLogEntries = {},
  onPreviewFile,
  activePreviewPath,
  readOnly = false,
  scrollToTaskId,
  onScrollComplete,
  permissionMode,
  activityLabel,
  startedAt,
  lastReplyAt,
  costUsd,
  tokensUsed,
  errorMessage,
  durationMs,
  onRefresh,
}: ModalChatProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const [showDraftPlanModal, setShowDraftPlanModal] = useState(false);
  const prevLengthRef = useRef(logEntries.length);
  const pendingPlanReview = useMemo(() => getPendingPlanReviewData(logEntries), [logEntries]);
  const planApprovalQuestion = pendingPlanReview?.question ?? null;
  const pendingApprovedBrief = pendingPlanReview?.briefContent ?? null;
  const showInlinePlanReview = Boolean(planApprovalQuestion || pendingApprovedBrief);
  const displayLogEntries = useMemo(() => {
    if (!pendingPlanReview) {
      return logEntries;
    }

    const hiddenEntryIds = new Set(pendingPlanReview.turnTextEntryIds);
    if (hiddenEntryIds.size === 0) {
      return logEntries;
    }

    const summaryInsertId = pendingPlanReview.turnTextEntryIds[0] ?? pendingPlanReview.questionEntryId;
    const summaryAnchor = logEntries.find((entry) => entry.id === summaryInsertId)
      ?? logEntries.find((entry) => entry.id === pendingPlanReview.questionEntryId)
      ?? logEntries[0];
    const summaryEntry = pendingPlanReview.summaryText && summaryAnchor
      ? {
          id: `${pendingPlanReview.questionEntryId}:plan-summary`,
          type: "text" as const,
          timestamp: summaryAnchor.timestamp,
          content: pendingPlanReview.summaryText,
        }
      : null;

    const rebuilt: LogEntry[] = [];
    let insertedSummary = false;

    for (const entry of logEntries) {
      if (!insertedSummary && summaryEntry && entry.id === summaryInsertId) {
        rebuilt.push(summaryEntry);
        insertedSummary = true;
      }

      if (hiddenEntryIds.has(entry.id)) {
        continue;
      }

      rebuilt.push(entry);
    }

    if (!insertedSummary && summaryEntry) {
      rebuilt.push(summaryEntry);
    }

    return rebuilt;
  }, [logEntries, pendingPlanReview]);
  const isPermissionWaiting = useMemo(
    () => !planApprovalQuestion && isTaskWaitingOnPermission({ needsInput, activityLabel, errorMessage }),
    [activityLabel, errorMessage, needsInput, planApprovalQuestion],
  );

  // Use the actual Claude CLI compute time (durationMs) when available.
  // Falls back to log-based estimation, capped per-turn to avoid wall-clock inflation.
  const totalWorkSeconds = useMemo(() => {
    if (durationMs != null && durationMs > 0) {
      return Math.round(durationMs / 1000);
    }
    // Fallback: estimate from log timestamps, but cap each turn at 30 min
    // to avoid counting idle time as compute time.
    const MAX_TURN_MS = 30 * 60 * 1000;
    if (logEntries.length === 0) return 0;
    let total = 0;
    let runStart: number | null = null;
    for (const entry of logEntries) {
      const ts = new Date(entry.timestamp).getTime();
      if (isNaN(ts)) continue;
      if (entry.type === "user_reply") {
        if (runStart !== null) {
          total += Math.min(ts - runStart, MAX_TURN_MS);
          runStart = null;
        }
      } else {
        if (runStart === null) runStart = ts;
      }
    }
    // If still in a run, cap it too
    if (runStart !== null) {
      total += Math.min(Date.now() - runStart, MAX_TURN_MS);
    }
    return Math.round(total / 1000);
  }, [durationMs, logEntries]);
  // Ref mirror of auto-scroll state — read synchronously inside effects
  // and scroll handlers so we don't fight the user with stale closure state
  // while entries stream in rapidly.
  const isAutoScrollingRef = useRef(true);
  // Flag set just before programmatic scrolls so the onScroll handler
  // knows to ignore them (otherwise they'd be misread as user input).
  const isProgrammaticScrollRef = useRef(false);

  // Auto-scroll on new entries
  useEffect(() => {
    if (logEntries.length > prevLengthRef.current && isAutoScrollingRef.current) {
      const el = scrollRef.current;
      if (el) {
        isProgrammaticScrollRef.current = true;
        el.scrollTop = el.scrollHeight;
      }
    }
    prevLengthRef.current = logEntries.length;
  }, [logEntries.length]);

  // Jump to the bottom (most recent message) when the chat first mounts
  // and when the user switches to a different task. Otherwise opening a
  // long transcript would start at the top, hiding recent context.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Defer to next frame so the log entries have laid out.
    requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      isProgrammaticScrollRef.current = true;
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      isAutoScrollingRef.current = true;
      prevLengthRef.current = logEntries.length;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // Detect user scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Ignore scroll events triggered by our own programmatic scrolling
    if (isProgrammaticScrollRef.current) {
      isProgrammaticScrollRef.current = false;
      return;
    }
    const isNearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
    isAutoScrollingRef.current = isNearBottom;
    setShowJumpButton(!isNearBottom);
  }, []);

  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      isProgrammaticScrollRef.current = true;
      el.scrollTop = el.scrollHeight;
    }
    isAutoScrollingRef.current = true;
    setShowJumpButton(false);
  }, []);

  // Scroll to a specific subtask's entries when scrollToTaskId is set
  useEffect(() => {
    if (!scrollToTaskId || !scrollRef.current) return;
    const target = scrollRef.current.querySelector(`[data-source-task="${scrollToTaskId}"]`);
    if (target) {
      isProgrammaticScrollRef.current = true;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      // Briefly highlight the target
      (target as HTMLElement).style.outline = "2px solid color-mix(in srgb, var(--foreground) 30%, transparent)";
      (target as HTMLElement).style.borderRadius = "8px";
      setTimeout(() => {
        (target as HTMLElement).style.outline = "none";
      }, 2000);
    }
    onScrollComplete?.();
  }, [scrollToTaskId, onScrollComplete]);

  // Track child replies sent inline so they appear immediately
  const [childReplies, setChildReplies] = useState<Record<string, string[]>>({});

  const handleChildReplySent = useCallback((childId: string, message: string) => {
    setChildReplies((prev) => ({
      ...prev,
      [childId]: [...(prev[childId] || []), message],
    }));
  }, []);

  const hasChildren = childTasks.length > 0;
  const hasEntries = displayLogEntries.length > 0;
  const neverStarted = status === "backlog" || status === "queued";
  const showEmpty = !hasEntries && !hasChildren && neverStarted;
  const isTerminal = status === "done" || status === "review" || status === "error";
  const showLoading = !hasEntries && !hasChildren && !neverStarted && !isRunning && !isTerminal;
  const hasVisibleResponse = useMemo(
    () => hasVisibleAssistantResponse(displayLogEntries) || showInlinePlanReview,
    [displayLogEntries, showInlinePlanReview],
  );
  const showInitialSpinner = useMemo(
    () => shouldShowInitialTaskSpinner({
      status,
      isRunning,
      needsInput,
      hasVisibleResponse,
    }),
    [hasVisibleResponse, isRunning, needsInput, status],
  );

  // Determine if Claude is actively working right now. Use the last log entry
  // timestamp as a staleness check — if the last entry was > 60s ago and there's
  // no activityLabel, Claude has likely stopped and we shouldn't show the spinner.
  const isActivelyWorking = useMemo(() => {
    if (!isRunning || needsInput) return false;
    if (!hasEntries) return true; // just started, no entries yet
    if (activityLabel) return true; // has a fresh activity label from SSE
    const lastEntry = logEntries[logEntries.length - 1];
    if (!lastEntry) return true;
    const lastTs = new Date(lastEntry.timestamp).getTime();
    if (isNaN(lastTs)) return true;
    const age = Date.now() - lastTs;
    return age < 60_000; // active if last entry was within 60 seconds
  }, [isRunning, needsInput, hasEntries, activityLabel, displayLogEntries]);
  const showWorkingSpinner = isActivelyWorking && !showInitialSpinner;

  // Build merged timeline when there are child tasks, otherwise use simple grouping
  const renderItems = useMemo(() => {
    const grouped = hasChildren
      ? buildMergedTimeline(displayLogEntries, childTasks, childLogEntries)
      : groupEntries(displayLogEntries);

    // Collapse thinking into collapsible groups, working at the TURN level.
    // A "turn" = everything between user messages (single items like user_reply).
    // Within each turn, if there's any tool activity, everything except the
    // last text-group (the actual answer) gets collapsed into a thinking-group.
    // When the task is still running, even the last text-group in the final
    // turn is absorbed since the real answer hasn't arrived yet.
    const TOOL_KINDS = new Set(["tool-row", "file-output", "todo-update", "skill-invocation"]);
    const TURN_BREAK_KINDS = new Set(["single", "child-question", "child-review", "phase-divider"]);

    // Split into turns (separated by user messages / structural items)
    const turns: RenderItem[][] = [];
    let currentTurn: RenderItem[] = [];
    const breakItems: { index: number; item: RenderItem }[] = [];

    for (const item of grouped) {
      if (TURN_BREAK_KINDS.has(item.kind)) {
        if (currentTurn.length > 0) {
          turns.push(currentTurn);
          currentTurn = [];
        }
        breakItems.push({ index: turns.length, item });
        turns.push([]); // placeholder — will be replaced by the break item
      } else {
        currentTurn.push(item);
      }
    }
    if (currentTurn.length > 0) {
      turns.push(currentTurn);
    }

    // Process each turn: collapse thinking, promote the answer
    const result: RenderItem[] = [];
    for (let t = 0; t < turns.length; t++) {
      const turn = turns[t];

      // Check if this is a break-item placeholder
      const breakItem = breakItems.find((b) => b.index === t);
      if (breakItem) {
        result.push(breakItem.item);
        continue;
      }

      // Does this turn have any tool activity?
      const hasTools = turn.some((it) => TOOL_KINDS.has(it.kind));
      if (!hasTools) {
        // Pure text turn (no tools) — show as-is, no collapsing needed
        result.push(...turn);
        continue;
      }

      // Find the last text-group that comes AFTER the last tool — that's the answer.
      // If the last text-group is before all tools, it's narration (no answer yet).
      const isLastTurn = t === turns.length - 1;
      let answerIdx = -1;
      if (!isRunning || !isLastTurn) {
        // Find the index of the last tool-kind item
        let lastToolIdx = -1;
        for (let k = turn.length - 1; k >= 0; k--) {
          if (TOOL_KINDS.has(turn[k].kind)) { lastToolIdx = k; break; }
        }
        // Only promote a text-group as the answer if it comes after tool activity
        for (let k = turn.length - 1; k >= 0; k--) {
          if (turn[k].kind === "text-group" && k > lastToolIdx) {
            answerIdx = k;
            break;
          }
        }
      }
      // If running + last turn: answerIdx stays -1 (everything is thinking)
      // If no text after tools: answerIdx stays -1 (no answer to promote)

      // Split: everything except the answer → thinking-group
      const thinkingItems: RenderItem[] = [];
      for (let k = 0; k < turn.length; k++) {
        if (k === answerIdx) continue;
        thinkingItems.push(turn[k]);
      }

      if (thinkingItems.length > 0) {
        result.push({ kind: "thinking-group", items: thinkingItems });
      }
      if (answerIdx >= 0) {
        result.push(turn[answerIdx]);
      }
    }

    return result;
  }, [hasChildren, displayLogEntries, childTasks, childLogEntries, isRunning]);

  // Set of child task IDs that currently need input (have unanswered questions)
  const childrenNeedingInput = new Set(
    childTasks.filter((c) => c.needsInput).map((c) => c.id)
  );

  const hasPendingStructuredQuestion = useMemo(() => {
    for (let i = displayLogEntries.length - 1; i >= 0; i--) {
      const e = displayLogEntries[i];
      if (e.type === "structured_question" && !e.questionAnswers) {
        return true;
      }
    }
    return false;
  }, [displayLogEntries]);
  const showErrorBanner = shouldShowTaskErrorBanner(displayLogEntries, errorMessage);

  return (
    <div
      style={{
        flex: 1,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minWidth: 0,
        minHeight: 0,
      }}
    >
      {/* "Waiting for your reply" banner removed — the reply input box is sufficient */}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "24px 24px 16px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          minWidth: 0,
          minHeight: 0,
        }}
      >
        {/* Empty state */}
        {showEmpty && !showInitialSpinner && (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                fontSize: 14,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                color: "var(--muted-foreground)",
              }}
            >
              Task has not been executed yet
            </span>
          </div>
        )}

        {/* Loading state */}
        {showLoading && (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                fontSize: 14,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                color: "var(--muted-foreground)",
              }}
            >
              Loading logs...
            </span>
          </div>
        )}

        {/* Empty state for terminal tasks with no log entries */}
        {!hasEntries && !hasChildren && isTerminal && (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                color: "var(--muted-foreground)",
              }}
            >
              No conversation history
            </span>
          </div>
        )}

        {/* Log entries — business-focused grouping with child task events */}
        {renderItems.map((item, index) => {
          // Derive source task ID from the first entry in each group
          const sourceId =
            "entries" in item ? item.entries[0]?.sourceTaskId
            : "entry" in item ? item.entry?.sourceTaskId
            : undefined;

          if (item.kind === "thinking-group") {
            return (
              <div key={`thinking-${index}`}>
                <ThinkingGroup
                  items={item.items}
                  onPreviewFile={onPreviewFile}
                  activePreviewPath={activePreviewPath}
                  permissionMode={permissionMode}
                  taskId={taskId}
                  readOnly={readOnly}
                />
              </div>
            );
          }

          if (item.kind === "text-group") {
            return (
              <div key={item.entries[0].id} data-source-task={sourceId} style={{ marginTop: 14, marginBottom: 6 }}>
                <TextGroup
                  entries={item.entries}
                  onPreviewFile={onPreviewFile}
                />
              </div>
            );
          }
          if (item.kind === "tool-group") {
            // Legacy fallback — should not be produced by new grouping
            return null;
          }
          if (item.kind === "tool-row") {
            return (
              <div key={item.entries[0].id} data-source-task={sourceId} style={{ borderLeft: "2px solid color-mix(in srgb, var(--foreground) 40%, transparent)", paddingLeft: 10, marginLeft: 2 }}>
                <ToolCompactRow toolName={item.toolName} entries={item.entries} />
              </div>
            );
          }
          if (item.kind === "todo-update") {
            return (
              <div key={item.entry.id} data-source-task={sourceId} style={{ marginTop: 4, marginBottom: 4 }}>
                <TodoUpdateCard entry={item.entry} />
              </div>
            );
          }
          if (item.kind === "file-output") {
            const info = parseFileOutput(item.entry);
            const active = !!info && activePreviewPath === info.relativePath;
            return (
              <div key={item.entry.id} data-source-task={sourceId} style={{ marginTop: 10, marginBottom: 10 }}>
                <FileOutputCard
                  entry={item.entry}
                  isActive={active}
                  onPreview={
                    onPreviewFile && info
                      ? (p) => onPreviewFile({ ...p, fileName: info.fileName })
                      : undefined
                  }
                />
              </div>
            );
          }
          if (item.kind === "skill-invocation") {
            return (
              <div key={item.entry.id} data-source-task={sourceId} style={{ marginTop: 10, marginBottom: 10 }}>
                <SkillInvocationCard entry={item.entry} />
              </div>
            );
          }
          if (item.kind === "child-question") {
            const replied = (childReplies[item.childTask.id] || []).length > 0;
            const showReplyInput = !readOnly && childrenNeedingInput.has(item.childTask.id) && !replied;
            return (
              <div
                key={`child-q-${item.entry.id}`}
                style={{
                  width: "100%",
                  backgroundColor: "var(--muted)",
                  borderLeft: "3px solid var(--primary)",
                  borderRadius: "0 0.5rem 0.5rem 0",
                  padding: "12px 16px",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontWeight: 600,
                    color: "var(--primary)",
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: "0.02em",
                  }}
                >
                  {item.childTask.title} is asking:
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    color: "var(--foreground)",
                    lineHeight: 1.6,
                  }}
                >
                  {item.entry.content}
                </div>
                {/* Show inline replies already sent */}
                {(childReplies[item.childTask.id] || []).map((reply, ri) => (
                  <div
                    key={`cr-${ri}`}
                    style={{
                      marginTop: 8,
                      display: "flex",
                      justifyContent: "flex-end",
                    }}
                  >
                    <div
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--foreground) 6%, transparent)",
                        border: "1px solid var(--border)",
                        color: "var(--foreground)",
                        borderRadius: "0.5rem 0.5rem 0.25rem 0.5rem",
                        padding: "8px 12px",
                        fontSize: 13,
                        fontFamily: "var(--font-inter), Inter, sans-serif",
                        maxWidth: "80%",
                      }}
                    >
                      {reply}
                    </div>
                  </div>
                ))}
                {showReplyInput && (
                  <ChildReplyInput
                    childTaskId={item.childTask.id}
                    onReplySent={handleChildReplySent}
                  />
                )}
              </div>
            );
          }
          if (item.kind === "phase-divider") {
            const child = item.childTask;
            const statusLabel =
              child.status === "done" ? "Done"
              : child.status === "running" ? "In Progress"
              : child.status === "review" ? "Needs Review"
              : child.status === "queued" ? "Queued"
              : "Not Started";
            const statusColor =
              child.status === "done" ? "var(--muted-foreground)"
              : child.status === "running" ? "var(--border)"
              : child.status === "review" ? "var(--primary)"
              : "var(--muted-foreground)";
            const isPhase = child.phaseNumber != null;
            const label = isPhase
              ? `Phase ${child.phaseNumber}: ${child.title}`
              : child.title;

            return (
              <div
                key={`phase-div-${child.id}`}
                data-phase-number={child.phaseNumber ?? undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 0 6px",
                  margin: "8px 0 4px",
                }}
              >
                <div style={{ flex: 1, height: 1, backgroundColor: "var(--border)" }} />
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontWeight: 600,
                    color: "var(--muted-foreground)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontWeight: 500,
                    color: statusColor,
                    padding: "1px 6px",
                    borderRadius: 4,
                    backgroundColor: `${statusColor}11`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {statusLabel}
                </span>
                <div style={{ flex: 1, height: 1, backgroundColor: "var(--border)" }} />
              </div>
            );
          }
          if (item.kind === "child-review") {
            return (
              <div
                key={`child-rev-${item.childTask.id}`}
                style={{
                  width: "100%",
                  backgroundColor: "var(--muted)",
                  borderLeft: "3px solid var(--primary)",
                  borderRadius: "0 0.5rem 0.5rem 0",
                  padding: "10px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    color: "var(--foreground)",
                    lineHeight: 1.5,
                  }}
                >
                  <strong style={{ color: "var(--primary)" }}>{item.childTask.title}</strong> is ready for review
                </span>
              </div>
            );
          }
          if (item.kind === "single") {
            if (showInlinePlanReview && isPendingPlanApprovalEntry(item.entry)) {
              return null;
            }
            return (
              <div key={item.entry.id} data-source-task={sourceId} style={{ marginTop: 20, marginBottom: 10 }}>
                <ChatEntry entry={item.entry} permissionMode={permissionMode} taskId={taskId} readOnly={readOnly} />
              </div>
            );
          }
          return null;
        })}

        {/* First-turn spinner — show after the user's first message, before later review/actions */}
        {showInitialSpinner && <SpinnerVerb startedAt={startedAt} lastReplyAt={lastReplyAt} activityLabel={activityLabel} />}

        {showInlinePlanReview && (
          <div style={{ marginTop: 8, marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {pendingApprovedBrief && (
              <DraftPlanPreviewCard
                content={pendingApprovedBrief}
                onExpand={() => setShowDraftPlanModal(true)}
                compact
              />
            )}
            {planApprovalQuestion && (
              <PlanApprovalActions
                taskId={taskId}
                question={planApprovalQuestion}
                onSubmitted={onRefresh}
              />
            )}
          </div>
        )}

        <PermissionApprovalActions
          taskId={taskId}
          isPermissionWaiting={isPermissionWaiting}
          activityLabel={activityLabel}
          errorMessage={errorMessage}
          onResolved={onRefresh}
        />

        {/* Spinner verb — shown while Claude is actively working */}
        {showWorkingSpinner && <SpinnerVerb startedAt={startedAt} lastReplyAt={lastReplyAt} activityLabel={activityLabel} />}

        {/* Error banner — shown when task failed */}
        {showErrorBanner && errorMessage && <ErrorBanner message={errorMessage} />}

        {/* Completed verb — shown when task is done, with total work time */}
        {!isRunning && (status === "done" || status === "review") && totalWorkSeconds != null && totalWorkSeconds > 0 && (
          <CompletedVerb
            durationSeconds={totalWorkSeconds}
            costUsd={costUsd}
            tokensUsed={tokensUsed}
            taskId={taskId}
            isReview={status === "review"}
          />
        )}

        {/* Question indicator — hide when the structured question is already
            rendered inline in the timeline entry itself. */}
        {/* Removed: "Waiting for your reply..." text — the reply input itself is sufficient */}
      </div>

      {/* Jump to latest button */}
      {showJumpButton && hasEntries && (
        <button
          onClick={jumpToLatest}
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10,
            backgroundColor: "color-mix(in srgb, var(--card) 90%, transparent)",
            backdropFilter: "blur(8px)",
            border: "1px solid var(--border)",
            borderRadius: "1rem",
            padding: "8px 16px",
            fontSize: 12,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            color: "var(--primary)",
            cursor: "pointer",
          }}
        >
          Jump to latest
        </button>
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

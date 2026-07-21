"use client";

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Timer, CheckCircle2, AlertCircle, Clock, ChevronLeft, ChevronRight,
  ChevronDown, MessageSquare, Wrench, FileText, ExternalLink, Eye,
  ArrowUpDown, ArrowUp, ArrowDown, Filter, X, GripVertical, ArrowLeft, Layers,
  Activity, Cpu, Settings,
} from "lucide-react";
import type { Task, TaskLevel, LogEntry, OutputFile } from "@/types/task";
import { LEVEL_LABELS } from "@/lib/levels";
import { useTaskStore } from "@/store/task-store";

const PAGE_SIZE = 50;
const STORAGE_KEY = "cc-history-columns";

// ─── Column definitions ──────────────────────────────────────────────────────

type ColumnId = "task" | "level" | "status" | "startedAt" | "completedAt" | "durationMs" | "tokensUsed" | "costUsd";
type SortField = "completedAt" | "startedAt" | "durationMs" | "tokensUsed" | "costUsd" | "level";

interface ColumnDef {
  id: ColumnId;
  label: string;
  defaultWidth: number;
  minWidth: number;
  sortField?: SortField;
  align?: "left" | "right";
}

const ALL_COLUMNS: ColumnDef[] = [
  { id: "task",        label: "Task",      defaultWidth: 0,   minWidth: 150 },
  { id: "level",       label: "Type",      defaultWidth: 100, minWidth: 60,  sortField: "level" },
  { id: "status",      label: "Status",    defaultWidth: 110, minWidth: 70 },
  { id: "startedAt",   label: "Started",   defaultWidth: 150, minWidth: 90,  sortField: "startedAt" },
  { id: "completedAt", label: "Completed", defaultWidth: 150, minWidth: 90,  sortField: "completedAt" },
  { id: "durationMs",  label: "Duration",  defaultWidth: 100, minWidth: 60,  sortField: "durationMs",  align: "right" },
  { id: "tokensUsed",  label: "Tokens",    defaultWidth: 90,  minWidth: 50,  sortField: "tokensUsed",  align: "right" },
  { id: "costUsd",     label: "Cost",      defaultWidth: 90,  minWidth: 50,  sortField: "costUsd",     align: "right" },
];

const DEFAULT_ORDER: ColumnId[] = ALL_COLUMNS.map((c) => c.id);
const DEFAULT_WIDTHS: Record<string, number> = Object.fromEntries(ALL_COLUMNS.map((c) => [c.id, c.defaultWidth]));

function getColumnDef(id: ColumnId): ColumnDef {
  return ALL_COLUMNS.find((c) => c.id === id)!;
}

// ─── Persistence ─────────────────────────────────────────────────────────────

interface ColumnPrefs {
  order: ColumnId[];
  widths: Record<string, number>;
}

function loadColumnPrefs(): ColumnPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ColumnPrefs;
      // Validate: ensure all columns present
      const knownIds = new Set(DEFAULT_ORDER);
      const validOrder = parsed.order.filter((id) => knownIds.has(id));
      // Add any missing columns
      for (const id of DEFAULT_ORDER) {
        if (!validOrder.includes(id)) validOrder.push(id);
      }
      return {
        order: validOrder,
        widths: { ...DEFAULT_WIDTHS, ...parsed.widths },
      };
    }
  } catch { /* ignore */ }
  return { order: [...DEFAULT_ORDER], widths: { ...DEFAULT_WIDTHS } };
}

function saveColumnPrefs(prefs: ColumnPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch { /* ignore */ }
}

// ─── Filter/Sort types ───────────────────────────────────────────────────────

type SortDir = "asc" | "desc";
type DateRange = "" | "today" | "week" | "month" | "90days";
type TypeFilter = "" | "task" | "project" | "gsd";
type StatusFilter = "" | "done" | "review" | "failed";
type GroupMode = "flat" | "project" | "day";

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  "": "All time",
  today: "Today",
  week: "This week",
  month: "This month",
  "90days": "Last 90 days",
};

const TYPE_LABELS: Record<TypeFilter, string> = {
  "": "All types",
  task: "Task",
  project: "Project",
  gsd: "GSD",
};

const STATUS_LABELS: Record<StatusFilter, string> = {
  "": "All statuses",
  done: "Done",
  review: "Review",
  failed: "Failed",
};

const GROUP_LABELS: Record<GroupMode, string> = {
  flat: "No grouping",
  project: "By project",
  day: "By day",
};

function groupTasks(tasks: Task[], mode: GroupMode): { key: string; label: string; tasks: Task[] }[] {
  if (mode === "flat") return [{ key: "__all__", label: "", tasks }];

  const groups = new Map<string, Task[]>();

  for (const task of tasks) {
    let key: string;
    if (mode === "project") {
      key = task.projectSlug || "__ungrouped__";
    } else {
      // day
      const dateStr = task.completedAt || task.updatedAt;
      const d = new Date(dateStr);
      key = isNaN(d.getTime()) ? "__unknown__" : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(task);
  }

  return Array.from(groups.entries()).map(([key, tasks]) => ({
    key,
    label: mode === "project"
      ? (key === "__ungrouped__" ? "Ungrouped tasks" : key)
      : key === "__unknown__" ? "Unknown date" : key,
    tasks,
  }));
}

// ─── Formatters ──────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "--";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "--";
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return tokens.toString();
}

// ─── Chat digest ─────────────────────────────────────────────────────────────

type DigestEntry = { type: "text" | "tools" | "question" | "reply"; label: string; time: string };

function buildChatDigest(logEntries: LogEntry[]): DigestEntry[] {
  const digest: DigestEntry[] = [];
  let pendingTools: { reads: number; writes: number; actions: number; lastTime: string } | null = null;

  const flushTools = () => {
    if (!pendingTools) return;
    const parts: string[] = [];
    if (pendingTools.reads > 0) parts.push(`${pendingTools.reads} read${pendingTools.reads !== 1 ? "s" : ""}`);
    if (pendingTools.writes > 0) parts.push(`${pendingTools.writes} write${pendingTools.writes !== 1 ? "s" : ""}`);
    if (pendingTools.actions > 0) parts.push(`${pendingTools.actions} action${pendingTools.actions !== 1 ? "s" : ""}`);
    digest.push({ type: "tools", label: parts.join(", "), time: pendingTools.lastTime });
    pendingTools = null;
  };

  for (const entry of logEntries) {
    if (entry.type === "tool_use") {
      if (!pendingTools) pendingTools = { reads: 0, writes: 0, actions: 0, lastTime: entry.timestamp };
      pendingTools.lastTime = entry.timestamp;
      const name = (entry.toolName || "").toLowerCase();
      if (["read", "glob", "grep", "webfetch", "websearch"].includes(name)) pendingTools.reads++;
      else if (["write", "edit"].includes(name)) pendingTools.writes++;
      else pendingTools.actions++;
      continue;
    }
    flushTools();
    if (entry.type === "text" && entry.content.length > 30) {
      digest.push({ type: "text", label: entry.content.length > 140 ? entry.content.slice(0, 140).trimEnd() + "..." : entry.content, time: entry.timestamp });
    } else if (entry.type === "question") {
      digest.push({ type: "question", label: entry.content.length > 140 ? entry.content.slice(0, 140).trimEnd() + "..." : entry.content, time: entry.timestamp });
    } else if (entry.type === "user_reply") {
      digest.push({ type: "reply", label: entry.content.length > 100 ? entry.content.slice(0, 100).trimEnd() + "..." : entry.content, time: entry.timestamp });
    }
  }
  flushTools();
  return digest;
}

// ─── Small components ────────────────────────────────────────────────────────

function StatusBadge({ status, hasError }: { status: string; hasError: boolean }) {
  if (hasError) {
    return (
      <span style={{ ...badgeBase, backgroundColor: "color-mix(in srgb, var(--foreground) 10%, transparent)", color: "var(--destructive)" }}>
        <AlertCircle size={12} /> Failed
      </span>
    );
  }
  if (status === "review") {
    return (
      <span style={{ ...badgeBase, backgroundColor: "color-mix(in srgb, var(--foreground) 10%, transparent)", color: "var(--primary)" }}>
        <Clock size={12} /> Review
      </span>
    );
  }
  return (
    <span style={{ ...badgeBase, backgroundColor: "color-mix(in srgb, var(--foreground) 10%, transparent)", color: "var(--muted-foreground)" }}>
      <CheckCircle2 size={12} /> Done
    </span>
  );
}

function DigestIcon({ type }: { type: DigestEntry["type"] }) {
  const s = { flexShrink: 0, marginTop: 4 } as const;
  switch (type) {
    case "text": return <MessageSquare size={13} color="var(--muted-foreground)" style={s} />;
    case "tools": return <Wrench size={13} color="var(--muted-foreground)" style={s} />;
    case "question": return <Eye size={13} color="var(--primary)" style={s} />;
    case "reply": return <MessageSquare size={13} color="var(--primary)" style={s} />;
  }
}

// ─── Filter dropdown ─────────────────────────────────────────────────────────

function FilterSelect<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Record<T, string>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      style={{
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        backgroundColor: value ? "var(--muted)" : "var(--card)",
        color: value ? "var(--primary)" : "var(--muted-foreground)",
        fontFamily: "var(--font-inter), Inter, sans-serif",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
        outline: "none",
        appearance: "none",
        WebkitAppearance: "none",
        paddingRight: 28,
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%235E5E65' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 12px center",
      }}
    >
      {Object.entries(options).map(([k, label]) => (
        <option key={k} value={k}>
          {label as string}
        </option>
      ))}
    </select>
  );
}

// ─── Cell renderers ──────────────────────────────────────────────────────────

function renderCell(colId: ColumnId, task: Task, expanded: boolean): React.ReactNode {
  switch (colId) {
    case "task":
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ChevronDown
            size={14}
            color="var(--muted-foreground)"
            style={{
              flexShrink: 0,
              transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
              transition: "transform 150ms ease",
            }}
          />
          <div style={{ overflow: "hidden", minWidth: 0 }}>
            <div
              style={{
                fontWeight: 500,
                color: "var(--foreground)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {task.title}
            </div>
            {task.description && !expanded && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--muted-foreground)",
                  marginTop: 4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {task.description}
              </div>
            )}
          </div>
        </div>
      );
    case "level":
      return task.cronJobSlug ? (
        <span style={{ ...badgeBase, backgroundColor: "color-mix(in srgb, var(--foreground) 10%, transparent)", color: "var(--muted-foreground)" }}>
          <Timer size={10} /> Scheduled
        </span>
      ) : (
        <span
          style={{
            fontSize: 12, fontWeight: 500,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            padding: "4px 8px", borderRadius: 4,
            backgroundColor: "color-mix(in srgb, var(--foreground) 8%, transparent)", color: "var(--muted-foreground)",
          }}
        >
          {LEVEL_LABELS[task.level as TaskLevel] || task.level}
        </span>
      );
    case "status":
      return <StatusBadge status={task.status} hasError={task.errorMessage !== null} />;
    case "startedAt":
      return <span style={monoCell}>{formatDate(task.startedAt)}</span>;
    case "completedAt":
      return <span style={monoCell}>{formatDate(task.completedAt)}</span>;
    case "durationMs":
      return <span style={monoCell}>{task.durationMs ? formatDuration(task.durationMs) : "--"}</span>;
    case "tokensUsed":
      return <span style={monoCell}>{task.tokensUsed != null && task.tokensUsed > 0 ? formatTokens(task.tokensUsed) : "--"}</span>;
    case "costUsd":
      return <span style={monoCell}>{task.costUsd != null && task.costUsd > 0 ? `$${task.costUsd.toFixed(2)}` : "--"}</span>;
  }
}

// ─── Expandable row ──────────────────────────────────────────────────────────

function HistoryRow({ task, columnOrder, columnWidths }: { task: Task; columnOrder: ColumnId[]; columnWidths: Record<string, number> }) {
  const [expanded, setExpanded] = useState(false);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [outputFiles, setOutputFiles] = useState<OutputFile[]>([]);
  const [detailLoaded, setDetailLoaded] = useState(false);
  const openPanel = useTaskStore((s) => s.openPanel);

  useEffect(() => {
    if (!expanded || detailLoaded) return;
    setDetailLoaded(true);

    fetch(`/api/tasks/${task.id}/logs`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setLogEntries)
      .catch(() => {});

    fetch(`/api/tasks/${task.id}/outputs`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setOutputFiles)
      .catch(() => {});
  }, [expanded, detailLoaded, task.id]);

  const digest = expanded ? buildChatDigest(logEntries) : [];

  return (
    <>
      <tr
        onClick={() => setExpanded(!expanded)}
        style={{
          borderBottom: expanded ? "none" : "1px solid var(--border)",
          cursor: "pointer",
          transition: "background 100ms ease",
          backgroundColor: expanded ? "color-mix(in srgb, var(--foreground) 6%, transparent)" : "transparent",
        }}
        onMouseEnter={(e) => { if (!expanded) e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 6%, transparent)"; }}
        onMouseLeave={(e) => { if (!expanded) e.currentTarget.style.backgroundColor = "transparent"; }}
      >
        {columnOrder.map((colId) => {
          const def = getColumnDef(colId);
          const w = columnWidths[colId] || def.defaultWidth;
          return (
            <td
              key={colId}
              style={{
                ...tdStyle,
                textAlign: def.align || "left",
                width: w > 0 ? w : undefined,
              }}
            >
              {renderCell(colId, task, expanded)}
            </td>
          );
        })}
      </tr>

      {expanded && (
        <tr style={{ borderBottom: "1px solid var(--border)" }}>
          <td colSpan={columnOrder.length} style={{ padding: 0 }}>
            <div
              style={{
                padding: "16px 24px 20px 48px",
                backgroundColor: "var(--muted)",
                borderTop: "1px solid var(--border)",
              }}
            >
              {/* Stats row */}
              <div style={{ display: "flex", gap: 24, marginBottom: 16, flexWrap: "wrap" }}>
                <StatPill label="Duration" value={task.durationMs ? formatDuration(task.durationMs) : "--"} />
                <StatPill label="Cost" value={task.costUsd != null && task.costUsd > 0 ? `$${task.costUsd.toFixed(2)}` : "--"} />
                <StatPill label="Tokens" value={task.tokensUsed != null && task.tokensUsed > 0 ? formatTokens(task.tokensUsed) : "--"} />
                {task.cronJobSlug && <StatPill label="Scheduled Task" value={task.cronJobSlug} />}
              </div>

              {task.errorMessage && (
                <div
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 8,
                    padding: "8px 16px", backgroundColor: "var(--card)",
                    borderRadius: 8, marginBottom: 16,
                  }}
                >
                  <AlertCircle size={14} color="var(--destructive)" style={{ flexShrink: 0, marginTop: 0 }} />
                  <span style={{ fontSize: 13, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--destructive)", lineHeight: 1.4 }}>
                    {task.errorMessage}
                  </span>
                </div>
              )}

              {task.description && (
                <p
                  style={{
                    fontSize: 13, fontFamily: "var(--font-inter), Inter, sans-serif",
                    color: "var(--muted-foreground)", margin: "0 0 16px 0", lineHeight: 1.5,
                  }}
                >
                  {task.description}
                </p>
              )}

              {digest.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={sectionLabel}>Activity</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {digest.slice(-6).map((item, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "4px 0" }}>
                        <span style={{ fontSize: 10, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--muted-foreground)", minWidth: 40, flexShrink: 0, marginTop: 4 }}>
                          {formatTime(item.time)}
                        </span>
                        <DigestIcon type={item.type} />
                        <span
                          style={{
                            fontSize: 13, fontFamily: "var(--font-inter), Inter, sans-serif",
                            color: item.type === "tools" ? "var(--muted-foreground)" : item.type === "reply" ? "var(--primary)" : "var(--foreground)",
                            fontWeight: item.type === "question" ? 500 : 400,
                            lineHeight: 1.4, flex: 1,
                            overflow: "hidden", display: "-webkit-box",
                            WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
                          }}
                        >
                          {item.label}
                        </span>
                      </div>
                    ))}
                    {digest.length > 6 && (
                      <div style={{ fontSize: 12, color: "var(--muted-foreground)", fontFamily: "var(--font-inter), Inter, sans-serif", paddingTop: 4 }}>
                        +{digest.length - 6} more entries
                      </div>
                    )}
                  </div>
                </div>
              )}

              {outputFiles.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={sectionLabel}>Output Files ({outputFiles.length})</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {outputFiles.slice(0, 6).map((file) => (
                      <span
                        key={file.id}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          padding: "4px 12px", borderRadius: 6,
                          backgroundColor: "var(--muted)", fontSize: 12,
                          fontFamily: "var(--font-inter), Inter, sans-serif",
                          fontWeight: 500, color: "var(--foreground)",
                        }}
                      >
                        <FileText size={12} color="var(--primary)" />
                        {file.fileName}
                        <span style={{ fontSize: 10, color: "var(--muted-foreground)", backgroundColor: "var(--card)", padding: "0px 4px", borderRadius: 3 }}>
                          .{file.extension}
                        </span>
                      </span>
                    ))}
                    {outputFiles.length > 6 && (
                      <span style={{ fontSize: 12, color: "var(--muted-foreground)", fontFamily: "var(--font-inter), Inter, sans-serif", padding: "4px 0", alignSelf: "center" }}>
                        +{outputFiles.length - 6} more
                      </span>
                    )}
                  </div>
                </div>
              )}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openPanel(task.id);
                }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "8px 16px", borderRadius: 8,
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--card)", color: "var(--primary)",
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 13, fontWeight: 500, cursor: "pointer",
                  transition: "all 150ms ease",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--muted)"; e.currentTarget.style.borderColor = "var(--primary)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--card)"; e.currentTarget.style.borderColor = "var(--border)"; }}
              >
                <ExternalLink size={13} />
                View full log
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 11, fontFamily: "var(--font-inter), Inter, sans-serif", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted-foreground)", fontWeight: 600 }}>
        {label}
      </span>
      <span style={{ fontSize: 14, fontFamily: "var(--font-inter), Inter, sans-serif", fontWeight: 600, color: "var(--foreground)" }}>
        {value}
      </span>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const fetchStoreTasks = useTaskStore((s) => s.fetchTasks);

  // Filters
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [dateRange, setDateRange] = useState<DateRange>("");
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [groupMode, setGroupMode] = useState<GroupMode>("flat");
  const [projectSlugs, setProjectSlugs] = useState<string[]>([]);

  // Sort
  const [sortBy, setSortBy] = useState<SortField>("startedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Column prefs (order + widths)
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(DEFAULT_ORDER);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // Load prefs from localStorage on mount
  useEffect(() => {
    const prefs = loadColumnPrefs();
    setColumnOrder(prefs.order);
    setColumnWidths(prefs.widths);
    setPrefsLoaded(true);
  }, []);

  // Save prefs whenever they change (after initial load)
  useEffect(() => {
    if (prefsLoaded) {
      saveColumnPrefs({ order: columnOrder, widths: columnWidths });
    }
  }, [columnOrder, columnWidths, prefsLoaded]);

  // Column resize
  const resizingRef = useRef<{ colId: ColumnId; startX: number; startWidth: number } | null>(null);

  const handleResizeStart = useCallback((e: React.MouseEvent, colId: ColumnId) => {
    e.preventDefault();
    e.stopPropagation();
    const def = getColumnDef(colId);
    const startWidth = columnWidths[colId] || def.defaultWidth;
    resizingRef.current = { colId, startX: e.clientX, startWidth };

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = ev.clientX - resizingRef.current.startX;
      const def = getColumnDef(resizingRef.current.colId);
      const newWidth = Math.max(def.minWidth, resizingRef.current.startWidth + delta);
      setColumnWidths((prev) => ({ ...prev, [resizingRef.current!.colId]: newWidth }));
    };

    const onMouseUp = () => {
      resizingRef.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [columnWidths]);

  // Column drag-reorder
  const dragColRef = useRef<ColumnId | null>(null);
  const [dragOverCol, setDragOverCol] = useState<ColumnId | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, colId: ColumnId) => {
    dragColRef.current = colId;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", colId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, colId: ColumnId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragColRef.current && dragColRef.current !== colId) {
      setDragOverCol(colId);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetColId: ColumnId) => {
    e.preventDefault();
    const sourceColId = dragColRef.current;
    if (!sourceColId || sourceColId === targetColId) {
      setDragOverCol(null);
      dragColRef.current = null;
      return;
    }
    setColumnOrder((prev) => {
      const next = [...prev];
      const srcIdx = next.indexOf(sourceColId);
      const tgtIdx = next.indexOf(targetColId);
      if (srcIdx === -1 || tgtIdx === -1) return prev;
      next.splice(srcIdx, 1);
      next.splice(tgtIdx, 0, sourceColId);
      return next;
    });
    setDragOverCol(null);
    dragColRef.current = null;
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragOverCol(null);
    dragColRef.current = null;
  }, []);

  // Load all tasks into Zustand store so the TaskModal can find them
  useEffect(() => {
    fetchStoreTasks();
  }, [fetchStoreTasks]);

  // Fetch distinct project slugs for the project filter
  useEffect(() => {
    fetch("/api/tasks/history?limit=500&offset=0&sortBy=startedAt&sortDir=desc")
      .then((r) => r.ok ? r.json() : { tasks: [] })
      .then((data) => {
        const slugs = new Set<string>();
        for (const t of (data.tasks || []) as Task[]) {
          if (t.projectSlug) slugs.add(t.projectSlug);
        }
        setProjectSlugs(Array.from(slugs).sort());
      })
      .catch(() => {});
  }, []);

  const hasActiveFilters = typeFilter !== "" || statusFilter !== "" || dateRange !== "" || projectFilter !== "";

  const fetchHistory = useCallback(async (pageNum: number) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(pageNum * PAGE_SIZE),
        sortBy,
        sortDir,
      });
      if (typeFilter) params.set("type", typeFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (dateRange) params.set("dateRange", dateRange);
      if (projectFilter) params.set("projectSlug", projectFilter);

      const res = await fetch(`/api/tasks/history?${params}`);
      if (!res.ok) throw new Error("Failed to fetch history");
      const data = await res.json();
      setTasks(data.tasks);
      setTotal(data.total);
    } catch (err) {
      console.error("History fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [sortBy, sortDir, typeFilter, statusFilter, dateRange, projectFilter]);

  useEffect(() => {
    setPage(0);
  }, [typeFilter, statusFilter, dateRange, projectFilter, sortBy, sortDir]);

  useEffect(() => {
    fetchHistory(page);
  }, [page, fetchHistory]);

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
  };

  const clearFilters = () => {
    setTypeFilter("");
    setStatusFilter("");
    setDateRange("");
    setProjectFilter("");
  };

  const resetColumns = () => {
    setColumnOrder([...DEFAULT_ORDER]);
    setColumnWidths({ ...DEFAULT_WIDTHS });
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const isCustomised = JSON.stringify(columnOrder) !== JSON.stringify(DEFAULT_ORDER)
    || JSON.stringify(columnWidths) !== JSON.stringify(DEFAULT_WIDTHS);

  const taskGroups = useMemo(() => groupTasks(tasks, groupMode), [tasks, groupMode]);

  const tabs: { key: string; label: string; icon: typeof Activity; href: string }[] = [
    { key: "feed", label: "Feed", icon: Activity, href: "/" },
    { key: "scheduled", label: "Scheduled", icon: Clock, href: "/" },
    { key: "skills", label: "Skills", icon: Cpu, href: "/" },
    { key: "docs", label: "Docs", icon: FileText, href: "/" },
    { key: "settings", label: "Settings", icon: Settings, href: "/" },
    { key: "history", label: "History", icon: Layers, href: "/history" },
  ];

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--card)" }}>
      {/* Top bar — same as main page */}
      <header className="px-4 sm:px-6" style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 52,
        position: "sticky",
        top: 0,
        zIndex: 50,
        backgroundColor: "color-mix(in srgb, var(--card) 92%, transparent)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid color-mix(in srgb, var(--foreground) 10%, transparent)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20, minWidth: 0 }}>
          <h1 style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontWeight: 700,
            fontSize: 18,
            color: "var(--primary)",
            letterSpacing: "-0.02em",
            margin: 0,
            whiteSpace: "nowrap",
          }}>
            AI-OS
          </h1>
          <div style={{ width: 1, height: 20, backgroundColor: "var(--border)" }} />
          <nav className="overflow-x-auto" style={{ display: "flex", alignItems: "center", gap: 0, minWidth: 0 }}>
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = tab.key === "history";
              return (
                <button
                  key={tab.key}
                  onClick={() => router.push(tab.href)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "8px 12px",
                    fontSize: 12,
                    fontWeight: isActive ? 600 : 500,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    border: "none",
                    borderRadius: 6,
                    backgroundColor: isActive ? "color-mix(in srgb, var(--foreground) 8%, transparent)" : "transparent",
                    color: isActive ? "var(--primary)" : "var(--muted-foreground)",
                    cursor: "pointer",
                    transition: "all 120ms ease",
                    whiteSpace: "nowrap",
                  }}
                >
                  <Icon size={13} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
        <div />
      </header>

      <main className="p-4 sm:px-6 sm:pb-6 sm:pt-4">
      <div style={{ width: "100%", boxSizing: "border-box" }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 24, fontWeight: 700, color: "var(--foreground)",
              letterSpacing: "-0.02em", margin: 0,
            }}
          >
            Task History
          </h1>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13, color: "var(--muted-foreground)", marginTop: 8,
            }}
          >
            {total} task{total !== 1 ? "s" : ""}{hasActiveFilters ? " (filtered)" : ""}
          </p>
        </div>

        {/* Filter bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          <Filter size={14} color="var(--muted-foreground)" style={{ flexShrink: 0 }} />
          <FilterSelect value={dateRange} onChange={setDateRange} options={DATE_RANGE_LABELS} />
          <FilterSelect value={typeFilter} onChange={setTypeFilter} options={TYPE_LABELS} />
          <FilterSelect value={statusFilter} onChange={setStatusFilter} options={STATUS_LABELS} />
          {projectSlugs.length > 0 && (
            <FilterSelect
              value={projectFilter}
              onChange={setProjectFilter}
              options={Object.fromEntries([
                ["", "All projects"],
                ["__none__", "Ungrouped"],
                ...projectSlugs.map((s) => [s, s]),
              ]) as Record<string, string>}
            />
          )}
          <span style={{ width: 1, height: 20, backgroundColor: "var(--border)", flexShrink: 0 }} />
          <FilterSelect value={groupMode} onChange={setGroupMode as (v: string) => void} options={GROUP_LABELS} />
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "8px 12px",
                borderRadius: 8,
                border: "none",
                backgroundColor: "color-mix(in srgb, var(--foreground) 8%, transparent)",
                color: "var(--destructive)",
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              <X size={12} />
              Clear
            </button>
          )}
          <div style={{ flex: 1 }} />
          {isCustomised && (
            <button
              onClick={resetColumns}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                backgroundColor: "transparent",
                color: "var(--muted-foreground)",
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 11,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Reset columns
            </button>
          )}
        </div>

        {/* Table */}
        <div
          className="overflow-x-auto"
          style={{
            backgroundColor: "var(--card)", borderRadius: 12,
            border: "1px solid var(--border)",
          }}
        >
          <table
            style={{
              width: "100%", minWidth: 900, borderCollapse: "collapse",
              fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 14,
              tableLayout: "fixed",
            }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", backgroundColor: "var(--muted)" }}>
                {columnOrder.map((colId) => {
                  const def = getColumnDef(colId);
                  const w = columnWidths[colId] || def.defaultWidth;
                  const isActive = def.sortField ? sortBy === def.sortField : false;
                  const Icon = isActive ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                  const isDragTarget = dragOverCol === colId;

                  return (
                    <th
                      key={colId}
                      draggable
                      onDragStart={(e) => handleDragStart(e, colId)}
                      onDragOver={(e) => handleDragOver(e, colId)}
                      onDrop={(e) => handleDrop(e, colId)}
                      onDragEnd={handleDragEnd}
                      onClick={() => def.sortField && handleSort(def.sortField)}
                      style={{
                        ...thStyle,
                        width: w > 0 ? w : undefined,
                        textAlign: def.align || "left",
                        cursor: def.sortField ? "pointer" : "grab",
                        userSelect: "none",
                        color: isActive ? "var(--primary)" : "var(--muted-foreground)",
                        position: "relative",
                        borderLeft: isDragTarget ? "2px solid var(--primary)" : "none",
                        transition: "border-color 100ms ease",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          justifyContent: def.align === "right" ? "flex-end" : "flex-start",
                          width: "100%",
                        }}
                      >
                        <GripVertical size={10} color="var(--border)" style={{ flexShrink: 0, cursor: "grab" }} />
                        {def.label}
                        {def.sortField && (
                          <Icon size={12} style={{ opacity: isActive ? 1 : 0.4, flexShrink: 0 }} />
                        )}
                      </div>
                      {/* Resize handle */}
                      <div
                        onMouseDown={(e) => handleResizeStart(e, colId)}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          position: "absolute",
                          top: 0,
                          right: -2,
                          bottom: 0,
                          width: 5,
                          cursor: "col-resize",
                          zIndex: 1,
                        }}
                        onMouseEnter={(e) => { (e.currentTarget.style.backgroundColor) = "color-mix(in srgb, var(--foreground) 20%, transparent)"; }}
                        onMouseLeave={(e) => { (e.currentTarget.style.backgroundColor) = "transparent"; }}
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {isLoading && tasks.length === 0 ? (
                <tr>
                  <td colSpan={columnOrder.length} style={{ padding: 40, textAlign: "center", color: "var(--muted-foreground)" }}>
                    Loading...
                  </td>
                </tr>
              ) : tasks.length === 0 ? (
                <tr>
                  <td colSpan={columnOrder.length} style={{ padding: 40, textAlign: "center", color: "var(--muted-foreground)" }}>
                    {hasActiveFilters ? "No tasks match these filters" : "No completed tasks yet"}
                  </td>
                </tr>
              ) : (
                taskGroups.map((group) => (
                  <React.Fragment key={group.key}>
                    {groupMode !== "flat" && (
                      <tr>
                        <td
                          colSpan={columnOrder.length}
                          style={{
                            padding: "12px 16px 8px",
                            backgroundColor: "var(--muted)",
                            borderBottom: "1px solid var(--border)",
                          }}
                        >
                          <div style={{
                            display: "flex", alignItems: "center", gap: 8,
                          }}>
                            <Layers size={12} color="var(--primary)" />
                            <span style={{
                              fontFamily: "var(--font-inter), Inter, sans-serif",
                              fontSize: 13, fontWeight: 700, color: "var(--foreground)",
                            }}>
                              {group.label}
                            </span>
                            <span style={{
                              fontFamily: "var(--font-inter), Inter, sans-serif",
                              fontSize: 11, color: "var(--muted-foreground)",
                            }}>
                              {group.tasks.length} task{group.tasks.length !== 1 ? "s" : ""}
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}
                    {group.tasks.map((task) => (
                      <HistoryRow
                        key={task.id}
                        task={task}
                        columnOrder={columnOrder}
                        columnWidths={columnWidths}
                      />
                    ))}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 16, marginTop: 24,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 14, color: "var(--muted-foreground)",
            }}
          >
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              style={paginationBtnStyle}
            >
              <ChevronLeft size={16} /> Prev
            </button>
            <span>Page {page + 1} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              style={paginationBtnStyle}
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
      </main>
    </div>
  );
}

// ─── Shared styles ───────────────────────────────────────────────────────────

const badgeBase: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4,
  fontSize: 12, fontWeight: 500,
  fontFamily: "var(--font-inter), Inter, sans-serif",
  padding: "4px 8px", borderRadius: 6,
};

const thStyle: React.CSSProperties = {
  padding: "12px 16px", textAlign: "left",
  fontFamily: "var(--font-inter), Inter, sans-serif",
  fontSize: 12, fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.06em", color: "var(--muted-foreground)",
};

const tdStyle: React.CSSProperties = {
  padding: "14px 16px",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const monoCell: React.CSSProperties = {
  fontFamily: "var(--font-inter), Inter, sans-serif",
  fontSize: 13, color: "var(--muted-foreground)",
};

const sectionLabel: React.CSSProperties = {
  fontSize: 11, fontFamily: "var(--font-inter), Inter, sans-serif",
  textTransform: "uppercase", letterSpacing: "0.08em",
  color: "var(--muted-foreground)", fontWeight: 600, marginBottom: 8,
};

const paginationBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4,
  padding: "8px 16px", borderRadius: 8,
  border: "1px solid var(--border)",
  backgroundColor: "var(--card)", color: "var(--muted-foreground)", cursor: "pointer",
  fontFamily: "var(--font-inter), Inter, sans-serif",
  fontSize: 13, fontWeight: 500,
};

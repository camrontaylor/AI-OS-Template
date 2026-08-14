"use client";

import { useState, useEffect } from "react";
import { Play, Pause, Trash2, ChevronDown, ChevronRight, Zap, Loader2, FileText, Clock, Pencil } from "lucide-react";
import { getCronJobKey, useCronStore } from "@/store/cron-store";
import { useClientStore } from "@/store/client-store";
import { RunHistory } from "./run-history";
import type { CronJob, CronRun } from "@/types/cron";
import type { ScheduledOperation } from "@/lib/marketing-scheduled-operations";
import { Badge } from "@/components/ui/badge";

interface CronRowProps {
  job: CronJob;
  index: number;
  onDragStart: (e: React.DragEvent, index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDrop: (e: React.DragEvent, index: number) => void;
  onDragEnd: () => void;
  isDragOver: boolean;
  isDragging: boolean;
  operation?: ScheduledOperation;
}

function formatSchedule(days: string, time: string): string {
  const dayMap: Record<string, string> = {
    daily: "Daily",
    weekdays: "Weekdays",
    weekends: "Weekends",
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    sat: "Saturday",
    sun: "Sunday",
  };

  const dayParts = days.split(",").map((d) => dayMap[d.trim()] || d.trim());
  const dayLabel = dayParts.join(", ");
  return `${dayLabel} at ${time}`;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "--";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "--";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const future = diffMs < 0;
  const absDiffMs = Math.abs(diffMs);
  const diffMin = Math.floor(absDiffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffMin < 1) return future ? "in < 1m" : "just now";
  if (diffMin < 60) return future ? `in ${diffMin}m` : `${diffMin}m ago`;
  if (diffHr < 24) return future ? `in ${diffHr}h` : `${diffHr}h ago`;
  if (diffDays < 30) return future ? `in ${diffDays}d` : `${diffDays}d ago`;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const min = Math.floor(sec / 60);
  const remaining = Math.round(sec % 60);
  return `${min}m ${remaining}s`;
}

function getResultBadge(result: "success" | "failure" | "timeout") {
  if (result === "success") {
    return { label: "OK", backgroundColor: "var(--card)", color: "var(--border)" };
  }

  if (result === "timeout") {
    return { label: "Timeout", backgroundColor: "var(--card)", color: "var(--muted-foreground)" };
  }

  return { label: "Fail", backgroundColor: "var(--muted)", color: "var(--destructive)" };
}

function getLatestRunTruthLabel(run: CronRun | undefined): string | null {
  if (!run || !run.resultSource) {
    return null;
  }

  if (run.resultSource === "inferred") {
    return "Recovered result";
  }

  return "Observed result";
}

export function CronRow({
  job,
  index,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragOver,
  isDragging,
  operation,
}: CronRowProps) {
  const expandedJob = useCronStore((s) => s.expandedJob);
  const runHistory = useCronStore((s) => s.runHistory);
  const expandJob = useCronStore((s) => s.expandJob);
  const toggleJob = useCronStore((s) => s.toggleJob);
  const deleteJob = useCronStore((s) => s.deleteJob);
  const runJobNow = useCronStore((s) => s.runJobNow);
  const setEditingJob = useCronStore((s) => s.setEditingJob);
  const jobKey = getCronJobKey(job.slug, job.clientId);
  const isPinned = useCronStore((s) => s.pinnedSlugs.includes(job.slug));
  const activeRun = useCronStore((s) => s.activeRuns[jobKey]);
  const systemStatus = useCronStore((s) => s.systemStatus);
  const selectedClientId = useClientStore((s) => s.selectedClientId);
  const [expandedTab, setExpandedTab] = useState<"file" | "history">("history");
  const [rawFile, setRawFile] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  const isActiveRun = !!activeRun;
  const isExpanded = expandedJob === jobKey;

  // Auto-fetch job file when expanded
  useEffect(() => {
    if (isExpanded && rawFile === null && !loadingFile) {
      setLoadingFile(true);
      const query = selectedClientId ? `?clientId=${encodeURIComponent(selectedClientId)}` : "";
      fetch(`/api/cron/${job.slug}/source${query}`)
        .then((r) => r.json())
        .then((d) => setRawFile(d.content || "(empty)"))
        .catch(() => setRawFile("(failed to load file)"))
        .finally(() => setLoadingFile(false));
    }
  }, [isExpanded, job.slug, jobKey, rawFile, loadingFile, selectedClientId]);
  const runs = runHistory[jobKey] || [];
  const latestRun = runs[0];
  const latestRunTruthLabel = getLatestRunTruthLabel(latestRun);
  const lastRunBadge = job.lastRun ? getResultBadge(job.lastRun.result) : null;

  // Derive a human-friendly status label for the active run
  const runStatusLabel =
    activeRun?.status === "queued"
      ? "Queued..."
      : activeRun?.status === "running"
        ? activeRun.activityLabel || "Running..."
        : null;
  const statusLabel =
    operation?.statusLabel ??
    (isActiveRun ? (activeRun?.status === "queued" ? "Queued" : "Running") : job.active ? "Active" : "Paused");
  const statusBadgeVariant =
    operation?.statusBadgeVariant ?? (isActiveRun ? "default" : job.active ? "secondary" : "outline");

  return (
    <div
      style={{ marginBottom: 12 }}
      draggable={!isPinned}
      onDragStart={(e) => { if (isPinned) { e.preventDefault(); return; } onDragStart(e, index); }}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={(e) => onDrop(e, index)}
      onDragEnd={onDragEnd}
    >
      {/* Main row */}
      <div
        onClick={() => expandJob(isExpanded ? null : job.slug)}
        style={{
          display: "grid",
          gridTemplateColumns: "1.5fr 1fr 0.8fr 0.8fr 0.7fr 90px 280px",
          gap: 12,
          alignItems: "center",
          padding: "16px 16px",
          backgroundColor: isActiveRun ? "var(--card)" : isPinned ? "var(--card)" : "var(--card)",
          borderRadius: isExpanded ? "0.5rem 0.5rem 0 0" : "0.5rem",
          cursor: isPinned ? "default" : "grab",
          transition: "background-color 150ms ease, opacity 150ms ease",
          fontFamily: "var(--font-inter), Inter, sans-serif",
          opacity: isDragging ? 0.4 : 1,
          borderTop: isDragOver ? "2px solid var(--primary)" : "2px solid transparent",
          borderLeft: isPinned ? "3px solid var(--primary)" : "3px solid transparent",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = isActiveRun ? "var(--muted)" : "var(--muted)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = isActiveRun ? "var(--card)" : "var(--card)";
        }}
      >
        {/* Name */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isExpanded ? (
            <ChevronDown size={14} color="var(--muted-foreground)" />
          ) : (
            <ChevronRight size={14} color="var(--muted-foreground)" />
          )}
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--foreground)" }}>
              {job.name}
            </div>
            {/* Show activity label when running, otherwise show description */}
            {isActiveRun && runStatusLabel ? (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--primary)",
                  marginTop: 4,
                  fontStyle: "italic",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: 280,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Loader2
                  size={11}
                  style={{
                    animation: "spin 1s linear infinite",
                    flexShrink: 0,
                  }}
                />
                {runStatusLabel}
              </div>
            ) : (
              <>
                {job.description && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--muted-foreground)",
                      marginTop: 4,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 280,
                    }}
                  >
                    {job.description}
                  </div>
                )}
                {operation && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--muted-foreground)",
                      marginTop: 4,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 280,
                    }}
                  >
                    {operation.workflowTitle} - {operation.categoryLabel} - {operation.nextActionLabel}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Schedule */}
        <div>
          <div
            style={{
              fontSize: 13,
              color: "var(--foreground)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
            }}
          >
            {formatSchedule(job.days, job.time)}
          </div>
        </div>

        {/* Last Run */}
        <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
          {job.lastRun ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>{formatRelativeTime(job.lastRun.lastRun)}</span>
                <span
                  style={{
                    display: "inline-block",
                    padding: "4px 8px",
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 500,
                    backgroundColor: lastRunBadge?.backgroundColor,
                    color: lastRunBadge?.color,
                  }}
                >
                  {lastRunBadge?.label}
                </span>
              </div>
              {latestRunTruthLabel && (
                <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 4 }}>
                  {latestRunTruthLabel}
                </div>
              )}
            </div>
          ) : (
            "--"
          )}
        </div>

        {/* Next Run */}
        <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
          {job.active ? formatRelativeTime(job.nextRun) : "Paused"}
        </div>

        {/* Avg Duration */}
        <div
          style={{
            fontSize: 13,
            color: "var(--muted-foreground)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
          }}
        >
          {job.stats.totalRuns > 0
            ? formatDuration(job.stats.avgDurationSec)
            : "--"}
        </div>

        {/* Status chip */}
        <div>
          <Badge variant={statusBadgeVariant} title={systemStatus?.statusSummary}>
            {statusLabel}
          </Badge>
        </div>

        {/* Actions */}
        <div
          style={{ display: "flex", gap: 4 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => runJobNow(job.slug)}
            disabled={isActiveRun}
            style={{
              background: "none",
              border: "none",
              cursor: isActiveRun ? "not-allowed" : "pointer",
              padding: "4px 8px",
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              gap: 4,
              color: isActiveRun ? "var(--primary)" : "var(--muted-foreground)",
              fontSize: 11,
              fontWeight: 500,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              transition: "color 150ms ease",
              opacity: isActiveRun ? 0.5 : 1,
            }}
            onMouseEnter={(e) => {
              if (!isActiveRun) e.currentTarget.style.color = "var(--primary)";
            }}
            onMouseLeave={(e) => {
              if (!isActiveRun) e.currentTarget.style.color = "var(--muted-foreground)";
            }}
          >
            <Zap size={13} />
            Run
          </button>
          <button
            onClick={() => toggleJob(job.slug)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              gap: 4,
              color: "var(--muted-foreground)",
              fontSize: 11,
              fontWeight: 500,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              transition: "color 150ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--muted-foreground)";
            }}
          >
            {job.active ? <Pause size={13} /> : <Play size={13} />}
            {job.active ? "Pause" : "Resume"}
          </button>
          <button
            onClick={() => setEditingJob(job)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              gap: 4,
              color: "var(--muted-foreground)",
              fontSize: 11,
              fontWeight: 500,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              transition: "color 150ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--muted-foreground)";
            }}
          >
            <Pencil size={13} />
            Edit
          </button>
          <button
            onClick={() => deleteJob(job.slug)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              gap: 4,
              color: "var(--muted-foreground)",
              fontSize: 11,
              fontWeight: 500,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              transition: "color 150ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--destructive)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--muted-foreground)";
            }}
          >
            <Trash2 size={13} />
            Delete
          </button>
        </div>
      </div>

      {/* Expanded panel with tabs */}
      {isExpanded && (
        <div
          style={{
            backgroundColor: "var(--muted)",
            borderRadius: "0 0 0.5rem 0.5rem",
          }}
        >
          {/* Tab bar */}
          <div
            style={{
              display: "flex",
              gap: 0,
              borderBottom: "1px solid var(--border)",
              padding: "0 16px",
            }}
          >
            <button
              onClick={() => setExpandedTab("history")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 16px",
                background: "none",
                border: "none",
                borderBottom: expandedTab === "history" ? "2px solid var(--primary)" : "2px solid transparent",
                cursor: "pointer",
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 13,
                fontWeight: expandedTab === "history" ? 600 : 400,
                color: expandedTab === "history" ? "var(--primary)" : "var(--muted-foreground)",
                transition: "color 150ms ease",
              }}
            >
              <Clock size={14} />
              Run History
              {runs.length > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    backgroundColor: "var(--border)",
                    color: "var(--muted-foreground)",
                    padding: "4px 8px",
                    borderRadius: 10,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                  }}
                >
                  {runs.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setExpandedTab("file")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 16px",
                background: "none",
                border: "none",
                borderBottom: expandedTab === "file" ? "2px solid var(--primary)" : "2px solid transparent",
                cursor: "pointer",
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 13,
                fontWeight: expandedTab === "file" ? 600 : 400,
                color: expandedTab === "file" ? "var(--primary)" : "var(--muted-foreground)",
                transition: "color 150ms ease",
              }}
            >
              <FileText size={14} />
              Job File
            </button>
          </div>

          {/* Tab content */}
          {expandedTab === "file" ? (
            <div style={{ padding: 16 }}>
              {loadingFile ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: 24,
                    fontSize: 13,
                    color: "var(--muted-foreground)",
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                  }}
                >
                  Loading...
                </div>
              ) : rawFile ? (
                <pre
                  style={{
                    padding: 16,
                    backgroundColor: "var(--card)",
                    color: "var(--foreground)",
                    border: "1px solid var(--border)",
                    borderRadius: "0.375rem",
                    fontFamily: "var(--font-inter), Inter, monospace",
                    fontSize: 12,
                    lineHeight: 1.6,
                    maxHeight: 500,
                    overflowY: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    margin: 0,
                  }}
                >
                  {rawFile}
                </pre>
              ) : (
                <div
                  style={{
                    textAlign: "center",
                    padding: 24,
                    fontSize: 13,
                    color: "var(--muted-foreground)",
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                  }}
                >
                  No job file found
                </div>
              )}
            </div>
          ) : (
            <RunHistory runs={runs} jobSlug={job.slug} prompt={job.prompt} />
          )}
        </div>
      )}

      {/* CSS for spinner animation */}
      <style jsx global>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

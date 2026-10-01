"use client";

import { useState } from "react";
import { FileText, Image, FileType, ExternalLink } from "lucide-react";
import { useClientStore } from "@/store/client-store";
import type { CronRun, CronRunOutput } from "@/types/cron";

interface RunHistoryProps {
  runs: CronRun[];
  jobSlug: string;
  prompt?: string;
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "--";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDuration(sec: number | null): string {
  if (sec === null) return "--";
  if (sec < 60) return `${Math.round(sec)}s`;
  const min = Math.floor(sec / 60);
  const remaining = Math.round(sec % 60);
  return `${min}m ${remaining}s`;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const RUN_COMPLETION_REASON_LABELS: Record<string, string> = {
  completed: "Normal completion",
  failed: "Normal failure",
  needs_input: "Needs input",
  timed_out: "Normal timeout",
  recovered_inferred_state: "Recovered state",
  recovered_missing_task: "Recovered missing job",
  recovered_orphaned_task: "Recovered orphaned run",
  recovered_from_terminal_task_state: "Recovered finished task",
  recovered_from_stuck_needs_input: "Recovered stuck input",
};

function getFileIcon(ext: string) {
  if (IMAGE_EXTENSIONS.has(ext)) return Image;
  if (PDF_EXTENSIONS.has(ext)) return FileType;
  return FileText;
}

function truncateFilename(name: string, maxLen = 28): string {
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 3) + "...";
}

function getRunResultBadge(run: CronRun) {
  if (run.completionReason === "needs_input") {
    return {
      label: "Needs input",
      backgroundColor: "var(--cc-surface)7ED",
      color: "var(--cc-status-warning-bright)",
    };
  }

  switch (run.result) {
    case "success":
      return { label: "Success", backgroundColor: "var(--cc-surface-success)", color: "var(--cc-palette-green)" };
    case "failure":
      return { label: "Failed", backgroundColor: "var(--cc-surface-danger-soft)", color: "var(--cc-status-danger-alt)" };
    case "timeout":
      return { label: "Timeout", backgroundColor: "var(--cc-surface)7ED", color: "var(--cc-status-warning-bright)" };
    default:
      return { label: "Running", backgroundColor: "var(--cc-surface-info)", color: "var(--cc-status-info)" };
  }
}

function getRunTruthLabel(run: CronRun): string | null {
  if (!run.resultSource && !run.completionReason) {
    return null;
  }

  const sourceLabel =
    run.resultSource === "inferred"
      ? "Inferred"
      : run.resultSource === "observed"
        ? "Observed"
        : null;
  const reasonLabel = run.completionReason
    ? RUN_COMPLETION_REASON_LABELS[run.completionReason] || run.completionReason
    : null;

  if (sourceLabel && reasonLabel) {
    return `${sourceLabel} · ${reasonLabel}`;
  }

  return sourceLabel || reasonLabel;
}

function OutputLink({ output }: { output: CronRunOutput }) {
  const Icon = getFileIcon(output.extension);

  return (
    <a
      href={`vscode://file${output.filePath}`}
      onClick={(e) => {
        e.preventDefault();
        // Copy path to clipboard and open via the API
        navigator.clipboard.writeText(output.filePath).catch(() => {});
        window.open(`vscode://file${output.filePath}`, "_blank");
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
        padding: "2px 8px",
        borderRadius: 4,
        backgroundColor: "var(--cc-brand-soft)",
        color: "var(--cc-brand-strong)",
        lineHeight: "16px",
        textDecoration: "none",
        cursor: "pointer",
        transition: "background-color 150ms ease",
      }}
      title={output.filePath}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "var(--cc-brand-soft)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "var(--cc-brand-soft)";
      }}
    >
      <Icon size={10} />
      {truncateFilename(output.fileName)}
      <ExternalLink size={9} style={{ opacity: 0.6 }} />
    </a>
  );
}

export function RunHistory({ runs, jobSlug, prompt }: RunHistoryProps) {
  const [log, setLog] = useState<string | null>(null);
  const [loadingLog, setLoadingLog] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const selectedClientId = useClientStore((s) => s.selectedClientId);

  const toggleLog = async () => {
    if (log !== null) {
      setLog(null);
      return;
    }
    setLoadingLog(true);
    try {
      const query = selectedClientId ? `?clientId=${encodeURIComponent(selectedClientId)}` : "";
      const res = await fetch(`/api/cron/${jobSlug}/logs${query}`);
      if (res.ok) {
        const data = await res.json();
        setLog(data.log || "(empty log)");
      } else {
        setLog("(failed to load log)");
      }
    } catch {
      setLog("(failed to load log)");
    } finally {
      setLoadingLog(false);
    }
  };

  if (runs.length === 0) {
    return (
      <div
        style={{
          backgroundColor: "var(--cc-surface-muted)",
          padding: 16,
          borderRadius: "0 0 0.5rem 0.5rem",
          textAlign: "center",
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 13,
          color: "var(--cc-text-secondary)",
        }}
      >
        No run history yet
      </div>
    );
  }

  return (
    <div
      style={{
        backgroundColor: "var(--cc-surface-muted)",
        padding: 16,
        borderRadius: "0 0 0.5rem 0.5rem",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 80px 120px 100px 80px 1fr",
          gap: 8,
          padding: "0 8px 8px",
          fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          color: "var(--cc-text-secondary)",
        }}
      >
        <span>Date</span>
        <span>Trigger</span>
        <span>Result</span>
        <span>Duration</span>
        <span>Cost</span>
        <span>Outputs</span>
      </div>

      {/* Rows */}
      {runs.map((run) => {
        const badge = getRunResultBadge(run);
        return (
          <div
            key={run.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 80px 120px 100px 80px 1fr",
              gap: 8,
              padding: "6px 8px",
              alignItems: "center",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
            }}
          >
            <span style={{ color: "var(--cc-text-primary)" }}>
              {formatRelativeTime(run.startedAt)}
            </span>
            <span>
              <span
                style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 500,
                  backgroundColor:
                    run.trigger === "manual" ? "var(--cc-surface)BEB" : "var(--cc-canvas-subtle)",
                  color:
                    run.trigger === "manual" ? "var(--cc-status-warning-bright)" : "var(--cc-text-secondary)",
                }}
              >
                {run.trigger === "manual" ? "Manual" : "Scheduled"}
              </span>
            </span>
            <span>
              <span
                style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 500,
                  backgroundColor: badge.backgroundColor,
                  color: badge.color,
                }}
              >
                {badge.label}
              </span>
              {getRunTruthLabel(run) && (
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--cc-text-secondary)",
                    marginTop: 4,
                    lineHeight: 1.3,
                  }}
                >
                  {getRunTruthLabel(run)}
                </div>
              )}
            </span>
            <span
              style={{
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                color: "var(--cc-text-secondary)",
              }}
            >
              {formatDuration(run.durationSec)}
            </span>
            <span
              style={{
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                color: "var(--cc-text-secondary)",
              }}
            >
              {run.costUsd !== null && run.costUsd > 0
                ? `$${run.costUsd.toFixed(2)}`
                : "--"}
            </span>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {run.outputs.length > 0 ? (
                <>
                  {run.outputs.slice(0, 2).map((output, i) => (
                    <OutputLink key={i} output={output} />
                  ))}
                  {run.outputs.length > 2 && (
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--cc-text-secondary)",
                        fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                        lineHeight: "20px",
                      }}
                    >
                      +{run.outputs.length - 2} more
                    </span>
                  )}
                </>
              ) : (
                <span style={{ fontSize: 11, color: "var(--cc-text-tertiary)" }}>--</span>
              )}
            </div>
          </div>
        );
      })}

      {/* Action buttons row */}
      <div style={{ marginTop: 8, paddingLeft: 8, display: "flex", gap: 16 }}>
        {prompt && (
          <button
            onClick={() => setShowPrompt(!showPrompt)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px 0",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 12,
              fontWeight: 500,
              color: "var(--cc-brand-primary)",
            }}
          >
            <FileText size={13} />
            {showPrompt ? "Hide Prompt" : "View Prompt"}
          </button>
        )}
        <button
          onClick={toggleLog}
          disabled={loadingLog}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "none",
            border: "none",
            cursor: loadingLog ? "wait" : "pointer",
            padding: "4px 0",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 12,
            fontWeight: 500,
            color: "var(--cc-brand-primary)",
          }}
        >
          <FileText size={13} />
          {loadingLog ? "Loading..." : log !== null ? "Hide Log" : "View Log"}
        </button>
      </div>

      {/* Prompt content */}
      {showPrompt && prompt && (
        <pre
          style={{
            marginTop: 8,
            padding: 12,
            backgroundColor: "var(--cc-surface)",
            color: "var(--cc-text-primary)",
            border: "1px solid var(--cc-control-bg)",
            borderRadius: "0.375rem",
            fontFamily: "var(--font-space-grotesk), Space Grotesk, monospace",
            fontSize: 11,
            lineHeight: 1.5,
            maxHeight: 300,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {prompt}
        </pre>
      )}

      {/* Log output */}
      {log !== null && (
        <pre
          style={{
            marginTop: 8,
            padding: 12,
            backgroundColor: "var(--cc-surface-muted)",
            color: "var(--cc-text-primary)",
            border: "1px solid var(--cc-control-bg)",
            borderRadius: "0.375rem",
            fontFamily: "var(--font-space-grotesk), Space Grotesk, monospace",
            fontSize: 11,
            lineHeight: 1.5,
            maxHeight: 300,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {log}
        </pre>
      )}
    </div>
  );
}

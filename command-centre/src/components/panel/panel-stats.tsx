"use client";

import type { Task } from "@/types/task";

const statusColorMap: Record<string, string> = {
  backlog: "var(--cc-text-secondary)",
  queued: "var(--cc-text-secondary)",
  running: "var(--cc-brand-primary)",
  review: "var(--cc-brand-hover)",
  done: "var(--cc-status-success)",
};

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return tokens.toString();
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PanelStats({ task }: { task: Task }) {
  const statusColor = statusColorMap[task.status] || "var(--cc-text-secondary)";

  return (
    <div style={{ padding: "0 24px" }}>
      <div
        style={{
          backgroundColor: "var(--cc-surface-muted)",
          padding: 20,
          borderRadius: "0.5rem",
        }}
      >
        {/* 2x2 grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}
        >
          {/* Status */}
          <StatCell
            label="Status"
            value={
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    backgroundColor: statusColor,
                    flexShrink: 0,
                    animation:
                      task.status === "running"
                        ? "pulse-dot 2s ease-in-out infinite"
                        : undefined,
                  }}
                />
                <span>
                  {task.status.charAt(0).toUpperCase() + task.status.slice(1)}
                </span>
              </div>
            }
          />

          {/* Duration */}
          <StatCell
            label="Duration"
            value={
              task.durationMs !== null ? formatDuration(task.durationMs) : "--"
            }
          />

          {/* Cost */}
          <StatCell
            label="Cost"
            value={
              task.costUsd !== null ? `$${task.costUsd.toFixed(2)}` : "$0.00"
            }
          />

          {/* Tokens */}
          <StatCell
            label="Tokens"
            value={
              task.tokensUsed !== null
                ? formatTokens(task.tokensUsed)
                : "--"
            }
          />
        </div>

        {/* Timestamps */}
        {(task.startedAt || task.completedAt) && (
          <div
            style={{
              marginTop: 12,
              fontSize: 12,
              fontFamily:
                "var(--font-space-grotesk), Space Grotesk, sans-serif",
              color: "var(--cc-text-secondary)",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            {task.startedAt && (
              <span>Started: {formatTimestamp(task.startedAt)}</span>
            )}
            {task.completedAt && (
              <span>Completed: {formatTimestamp(task.completedAt)}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--cc-text-secondary)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: "var(--cc-text-primary)",
          fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
        }}
      >
        {value}
      </div>
    </div>
  );
}

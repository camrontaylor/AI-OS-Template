"use client";

import Link from "next/link";
import { CheckCircle2, ArrowRight } from "lucide-react";
import type { DashboardSummary } from "@/types/dashboard";

interface RecentCompletionsProps {
  recentTasks: DashboardSummary["recentTasks"];
}

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

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function RecentCompletions({ recentTasks }: RecentCompletionsProps) {
  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <CheckCircle2 size={16} color="var(--cc-brand-primary)" />
        <span style={labelStyle}>Recent Completions</span>
      </div>
      {recentTasks.length > 0 ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {recentTasks.map((task) => (
              <div key={task.id} style={taskRowStyle}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={taskTitleStyle}>{task.title}</div>
                  <div style={taskMetaStyle}>
                    {task.completedAt && timeAgo(task.completedAt)}
                    {task.durationMs != null && (
                      <span> · {formatDuration(task.durationMs)}</span>
                    )}
                    {task.costUsd != null && (
                      <span> · ${task.costUsd.toFixed(2)}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Link href="/history" style={viewAllStyle}>
            View all history <ArrowRight size={13} />
          </Link>
        </>
      ) : (
        <p style={emptyStyle}>No completed tasks yet.</p>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  backgroundColor: "var(--cc-surface-muted)",
  borderRadius: 12,
  padding: "20px 24px",
  flex: 1,
  minWidth: 0,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 12,
};

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--cc-text-secondary)",
};

const taskRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const taskTitleStyle: React.CSSProperties = {
  fontFamily: "var(--font-inter), Inter, sans-serif",
  fontSize: 14,
  fontWeight: 500,
  color: "var(--cc-text-primary)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const taskMetaStyle: React.CSSProperties = {
  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
  fontSize: 12,
  color: "var(--cc-text-tertiary)",
  marginTop: 2,
};

const viewAllStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  marginTop: 14,
  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
  fontSize: 12,
  fontWeight: 500,
  color: "var(--cc-brand-primary)",
  textDecoration: "none",
};

const emptyStyle: React.CSSProperties = {
  fontFamily: "var(--font-inter), Inter, sans-serif",
  fontSize: 14,
  color: "var(--cc-text-tertiary)",
  margin: 0,
};

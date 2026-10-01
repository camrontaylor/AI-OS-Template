"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTaskStore } from "@/store/task-store";
import { getVisibleEditedTasks } from "@/lib/task-branch-ui";

interface StatsBarData {
  cronActive: number;
  cronTotal: number;
  weekTokens: number;
  todayTokens: number;
}

// Persist last-known data across mounts so tab switches don't flash
let cachedData: StatsBarData | null = null;

function formatTokens(n: number): string {
  if (n === 0) return "0";
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function StatsBar() {
  const tasks = useTaskStore((s) => s.tasks);
  const visibleTasks = useMemo(() => getVisibleEditedTasks(tasks), [tasks]);
  const [data, setData] = useState<StatsBarData | null>(cachedData);
  const fetchedRef = useRef(false);

  useEffect(() => {
    // Skip re-fetch if we already have cached data from a recent mount
    if (cachedData && !fetchedRef.current) {
      fetchedRef.current = true;
      // Still refresh in background, but no flash
      fetch("/api/dashboard/summary")
        .then((r) => r.ok ? r.json() : null)
        .then((d) => {
          if (d) {
            const next = {
              cronActive: d.system?.cronActive ?? 0,
              cronTotal: d.system?.cronTotal ?? 0,
              weekTokens: d.claudeUsage?.weekTokens ?? 0,
              todayTokens: d.claudeUsage?.todayTokens ?? 0,
            };
            cachedData = next;
            setData(next);
          }
        })
        .catch(() => {});
      return;
    }

    fetch("/api/dashboard/summary")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d) {
          const next = {
            cronActive: d.system?.cronActive ?? 0,
            cronTotal: d.system?.cronTotal ?? 0,
            weekTokens: d.claudeUsage?.weekTokens ?? 0,
            todayTokens: d.claudeUsage?.todayTokens ?? 0,
          };
          cachedData = next;
          setData(next);
        }
      })
      .catch(() => {});
  }, []);

  const runningCount = visibleTasks.filter((t) => t.status === "running" && !t.needsInput).length;
  const awaitingCount = visibleTasks.filter(
    (t) => t.status === "review" || (t.status === "running" && t.needsInput === true) || t.errorMessage !== null
  ).length;
  const doneCount = visibleTasks.filter((t) => t.status === "done").length;

  return (
    <div
      style={{
        height: 64,
        backgroundColor: "var(--cc-surface-muted)",
        display: "flex",
        alignItems: "center",
        padding: "0 24px",
        gap: 0,
        flexShrink: 0,
        borderRadius: 10,
      }}
    >
      <StatItem
        label="Running"
        value={runningCount.toString()}
        showDot={runningCount > 0}
      />
      <Separator />
      <StatItem
        label="Awaiting Input"
        value={awaitingCount.toString()}
        color={awaitingCount > 0 ? "var(--cc-status-warning)" : undefined}
      />
      <Separator />
      <StatItem label="Completed" value={doneCount.toString()} />
      <Separator />
      <StatItem
        label="Active Schedules"
        value={data ? `${data.cronActive}` : "--"}
      />
      <Separator />
      <TokenStat
        label="Tokens This Week"
        weekTokens={data?.weekTokens ?? 0}
        todayTokens={data?.todayTokens ?? 0}
      />
    </div>
  );
}

function Separator() {
  return (
    <div
      style={{
        width: 1,
        height: 32,
        backgroundColor: "var(--cc-line-alpha-20)",
        margin: "0 20px",
      }}
    />
  );
}

function StatItem({
  label,
  value,
  showDot,
  color,
}: {
  label: string;
  value: string;
  showDot?: boolean;
  color?: string;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {showDot && (
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: "var(--cc-brand-primary)",
              animation: "pulse-dot 2s ease-in-out infinite",
              flexShrink: 0,
            }}
          />
        )}
        <span
          style={{
            fontSize: 20,
            fontWeight: 600,
            color: color || "var(--cc-text-primary)",
            fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
            lineHeight: 1,
          }}
        >
          {value}
        </span>
      </div>
      <div
        style={{
          fontSize: 11,
          fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--cc-text-secondary)",
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function TokenStat({
  label,
  weekTokens,
  todayTokens,
}: {
  label: string;
  weekTokens: number;
  todayTokens: number;
}) {
  return (
    <div style={{ minWidth: 120 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span
          style={{
            fontSize: 20,
            fontWeight: 600,
            color: "var(--cc-text-primary)",
            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
            lineHeight: 1,
          }}
        >
          {formatTokens(weekTokens)}
        </span>
        {todayTokens > 0 && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "var(--cc-text-secondary)",
              fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
              lineHeight: 1,
            }}
          >
            ({formatTokens(todayTokens)} today)
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: 11,
          fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--cc-text-secondary)",
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  );
}

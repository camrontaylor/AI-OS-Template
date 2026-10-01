"use client";

import { useState, useEffect } from "react";

function formatElapsed(startedAt: string | null): string {
  if (!startedAt) return "0s";
  const start = new Date(startedAt).getTime();
  if (isNaN(start)) return "0s";
  const ms = Math.max(0, Date.now() - start);
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return `${min}m ${rem.toString().padStart(2, "0")}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h ${remMin}m`;
}

interface TaskProgressProps {
  logEntries?: unknown[];
  status: string;
  startedAt?: string | null;
  noBorder?: boolean;
}

export function TaskProgress({ status, startedAt, noBorder }: TaskProgressProps) {
  const [, setTick] = useState(0);
  const isRunning = status === "running";
  const isComplete = status === "done" || status === "review";

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  if (status === "backlog" || status === "queued") return null;

  const elapsed = formatElapsed(startedAt ?? null);

  return (
    <div
      style={{
        padding: "10px 24px",
        borderBottom: noBorder ? "none" : "1px solid var(--cc-control-bg)",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      {isRunning && (
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: "var(--cc-brand-primary)",
            animation: "progress-pulse 1.5s ease-in-out infinite",
            flexShrink: 0,
          }}
        />
      )}
      <span
        style={{
          fontSize: 13,
          fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
          fontWeight: 600,
          color: isRunning ? "var(--cc-brand-primary)" : isComplete ? "var(--cc-status-success)" : "var(--cc-text-secondary)",
        }}
      >
        {isRunning ? `Running — ${elapsed}` : isComplete ? `Completed in ${elapsed}` : elapsed}
      </span>

      <style>{`
        @keyframes progress-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

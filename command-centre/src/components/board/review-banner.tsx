"use client";

import { useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import type { Task } from "@/types/task";
import { useTaskStore } from "@/store/task-store";

interface ReviewBannerProps {
  task: Task;
  onIterate: (prefill: string) => void;
  /** Called after Approve succeeds — parent should close the detail view. */
  onApprove?: () => void;
}

export function ReviewBanner({ task, onIterate, onApprove }: ReviewBannerProps) {
  const [isApproving, setIsApproving] = useState(false);
  const updateTask = useTaskStore((s) => s.updateTask);

  if (task.status !== "review") return null;

  const handleApprove = async () => {
    setIsApproving(true);
    try {
      await updateTask(task.id, { status: "done", needsInput: false, completedAt: new Date().toISOString() });
      onApprove?.();
    } catch {
      setIsApproving(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 14px",
        margin: "0 0 8px",
        background: "var(--cc-status-warning-bg)",
        border: "1px solid var(--cc-border-warning)",
        borderRadius: 8,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontFamily: "'DM Mono', monospace",
          color: "var(--cc-status-warning-strong)",
          fontWeight: 600,
        }}
      >
        Ready for review
      </span>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={() => onIterate("Iterate on the above: ")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "5px 10px",
            fontSize: 11,
            fontFamily: "'DM Mono', monospace",
            border: "1px solid var(--cc-border-warning)",
            borderRadius: 6,
            background: "var(--cc-status-warning-bg)",
            color: "var(--cc-status-warning-strong)",
            cursor: "pointer",
            transition: "all 150ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--cc-status-warning-bg)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--cc-status-warning-bg)";
          }}
        >
          <RotateCcw size={11} />
          Iterate
        </button>
        <button
          onClick={handleApprove}
          disabled={isApproving}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "5px 10px",
            fontSize: 11,
            fontFamily: "'DM Mono', monospace",
            border: "1px solid var(--cc-border-success)",
            borderRadius: 6,
            background: "var(--cc-status-success-bg-soft)",
            color: "var(--cc-status-success-strong)",
            cursor: isApproving ? "wait" : "pointer",
            opacity: isApproving ? 0.6 : 1,
            transition: "all 150ms ease",
          }}
          onMouseEnter={(e) => {
            if (!isApproving) e.currentTarget.style.background = "var(--cc-status-success-bg)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--cc-status-success-bg-soft)";
          }}
        >
          <CheckCircle2 size={11} />
          Approve
        </button>
      </div>
    </div>
  );
}

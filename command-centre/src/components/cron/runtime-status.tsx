"use client";

import { Activity, ShieldCheck, ShieldAlert } from "lucide-react";
import { useCronStore } from "@/store/cron-store";

function formatHeartbeat(iso: string | null): string {
  if (!iso) return "n/a";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "n/a";

  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

export function RuntimeStatus() {
  const systemStatus = useCronStore((s) => s.systemStatus);

  if (!systemStatus) {
    return null;
  }

  const isHealthyLeader = systemStatus.leaderState === "active";
  const Icon = isHealthyLeader ? ShieldCheck : ShieldAlert;
  const accentColor = isHealthyLeader ? "var(--cc-palette-green)" : "var(--cc-brand-hover)";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1.6fr 0.8fr 0.8fr 0.8fr",
        gap: 12,
        backgroundColor: "var(--cc-surface)",
        borderRadius: "0.5rem",
        padding: "14px 16px",
        marginBottom: 16,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 4,
            color: accentColor,
            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          <Icon size={14} />
          Runtime Ownership
        </div>
        <div
          style={{
            fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
            fontSize: 15,
            fontWeight: 600,
            color: "var(--cc-text-primary)",
            marginBottom: 4,
          }}
        >
          {systemStatus.statusSummary}
        </div>
        <div
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 12,
            color: "var(--cc-text-secondary)",
          }}
        >
          Reason: <span style={{ color: "var(--cc-text-primary)" }}>{systemStatus.ownershipReason}</span>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 10, color: "var(--cc-text-secondary)", textTransform: "uppercase", letterSpacing: "0.12em" }}>
          Runtime
        </div>
        <div style={{ fontSize: 13, color: "var(--cc-text-primary)", marginTop: 6 }}>{systemStatus.runtime}</div>
        <div style={{ fontSize: 11, color: "var(--cc-text-secondary)", marginTop: 4 }}>
          Local runtime: {systemStatus.localRuntimePresent ? "present" : "not present"}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 10, color: "var(--cc-text-secondary)", textTransform: "uppercase", letterSpacing: "0.12em" }}>
          Leader
        </div>
        <div style={{ fontSize: 13, color: "var(--cc-text-primary)", marginTop: 6 }}>
          {systemStatus.leader ? "local owner" : "standby"}
        </div>
        <div style={{ fontSize: 11, color: "var(--cc-text-secondary)", marginTop: 4 }}>
          State: {systemStatus.leaderState}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 10, color: "var(--cc-text-secondary)", textTransform: "uppercase", letterSpacing: "0.12em" }}>
          Process
        </div>
        <div style={{ fontSize: 13, color: "var(--cc-text-primary)", marginTop: 6 }}>
          PID {systemStatus.pid ?? "n/a"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--cc-text-secondary)", marginTop: 4 }}>
          <Activity size={11} />
          Heartbeat {formatHeartbeat(systemStatus.heartbeatAt)}
        </div>
      </div>
    </div>
  );
}

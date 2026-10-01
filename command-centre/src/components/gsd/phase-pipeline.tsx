"use client";

import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { GsdPhase, PhaseStatus } from "@/types/gsd";

const statusConfig: Record<PhaseStatus, { color: string; bg: string; border: string; label: string }> = {
  complete: { color: "var(--cc-status-success)", bg: "var(--cc-surface-success)", border: "var(--cc-status-success)", label: "Complete" },
  "in-progress": { color: "var(--cc-brand-primary)", bg: "var(--cc-surface)8F5", border: "var(--cc-brand-primary)", label: "In Progress" },
  "not-started": { color: "var(--cc-text-tertiary)", bg: "var(--cc-canvas-subtle)", border: "var(--cc-control-bg-active)", label: "Not Started" },
};

interface PhasePipelineProps {
  phases: GsdPhase[];
  selectedPhase: number | null;
  onSelectPhase: (num: number) => void;
}

export function PhasePipeline({ phases, selectedPhase, onSelectPhase }: PhasePipelineProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: 2,
        overflowX: "auto",
        padding: "4px 0",
      }}
    >
      {phases.map((phase, i) => {
        const config = statusConfig[phase.status];
        const isSelected = selectedPhase === phase.number;

        return (
          <div key={phase.number} style={{ display: "flex", alignItems: "center" }}>
            <button
              onClick={() => onSelectPhase(phase.number)}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: "12px 16px",
                minWidth: 160,
                border: isSelected ? `2px solid ${config.border}` : "1px solid var(--cc-line-alpha-20)",
                borderRadius: 8,
                backgroundColor: isSelected ? config.bg : "var(--cc-surface)",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 150ms ease",
                boxShadow: isSelected ? `0 2px 8px var(--cc-brand-alpha-08)` : "none",
              }}
            >
              {/* Phase number + status icon */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span
                  style={{
                    fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                    fontSize: 11,
                    fontWeight: 600,
                    color: config.color,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  Phase {phase.number}
                </span>
                {phase.status === "complete" && <CheckCircle2 size={14} style={{ color: "var(--cc-status-success)" }} />}
                {phase.status === "in-progress" && (
                  <Loader2
                    size={14}
                    style={{ color: "var(--cc-brand-primary)", animation: "spin 2s linear infinite" }}
                  />
                )}
                {phase.status === "not-started" && <Circle size={14} style={{ color: "var(--cc-palette-slate-soft)" }} />}
              </div>

              {/* Name */}
              <span
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--cc-text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {phase.name}
              </span>

              {/* Plan progress */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    flex: 1,
                    height: 4,
                    backgroundColor: "var(--cc-control-bg)",
                    borderRadius: 2,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${phase.plansTotal > 0 ? (phase.plansComplete / phase.plansTotal) * 100 : 0}%`,
                      background: phase.status === "complete"
                        ? "var(--cc-status-success)"
                        : "linear-gradient(135deg, var(--cc-brand-primary) 0%, var(--cc-brand-hover) 100%)",
                      borderRadius: 2,
                      transition: "width 300ms ease",
                    }}
                  />
                </div>
                <span
                  style={{
                    fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                    fontSize: 11,
                    color: "var(--cc-text-secondary)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {phase.plansComplete}/{phase.plansTotal}
                </span>
              </div>
            </button>

            {/* Connector arrow */}
            {i < phases.length - 1 && (
              <div
                style={{
                  width: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--cc-palette-slate-soft)",
                  fontSize: 12,
                  flexShrink: 0,
                }}
              >
                &#8594;
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import type { Task } from "@/types/task";

interface PhaseProgressStripProps {
  task: Task;
  childTasks: Task[];
  onScrollToPhase?: (phaseNumber: number) => void;
}

const STATUS_COLORS: Record<string, string> = {
  backlog: "var(--cc-text-tertiary)",
  queued: "var(--cc-text-tertiary)",
  running: "var(--cc-palette-terracotta-light)",
  review: "var(--cc-brand-hover)",
  done: "var(--cc-status-success)",
};

const GSD_STEP_LABELS: Record<string, string> = {
  discuss: "Discuss",
  plan: "Plan",
  execute: "Execute",
  verify: "Verify",
};

/**
 * Sticky progress strip at the top of the chat scroll area.
 * GSD projects: horizontal phase pills with progress bar.
 * Planned projects: progress bar with subtask status dots.
 */
export function PhaseProgressStrip({
  task,
  childTasks,
  onScrollToPhase,
}: PhaseProgressStripProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(false);

  const isGsd = task.level === "gsd";
  const doneCount = childTasks.filter((c) => c.status === "done").length;
  const total = childTasks.length;
  const progressPct = total > 0 ? (doneCount / total) * 100 : 0;

  // Find the active phase (first non-done) for GSD
  const activePhase = isGsd
    ? childTasks.find((c) => c.status !== "done")
    : null;

  const updateFades = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setShowLeftFade(el.scrollLeft > 4);
    setShowRightFade(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    updateFades();
    const el = scrollContainerRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateFades, { passive: true });
    return () => el.removeEventListener("scroll", updateFades);
  }, [updateFades, childTasks.length]);

  if (total === 0) return null;

  if (isGsd) {
    // GSD: phase pills + progress bar
    return (
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          backgroundColor: "var(--cc-surface-overlay)",
          backdropFilter: "blur(8px)",
          borderBottom: "1px solid var(--cc-control-bg)",
          padding: "8px 24px 10px",
        }}
      >
        {/* Phase pills row */}
        <div style={{ position: "relative" }}>
          {showLeftFade && (
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: 24,
                background: "linear-gradient(to right, var(--cc-surface-overlay), transparent)",
                zIndex: 1,
                pointerEvents: "none",
              }}
            />
          )}
          {showRightFade && (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: 0,
                bottom: 0,
                width: 24,
                background: "linear-gradient(to left, var(--cc-surface-overlay), transparent)",
                zIndex: 1,
                pointerEvents: "none",
              }}
            />
          )}
          <div
            ref={scrollContainerRef}
            style={{
              display: "flex",
              gap: 6,
              overflowX: "auto",
              scrollbarWidth: "none",
              msOverflowStyle: "none",
              paddingBottom: 2,
            }}
          >
            {childTasks.map((child) => {
              const isActive = activePhase?.id === child.id;
              const statusColor = STATUS_COLORS[child.status] ?? "var(--cc-text-tertiary)";
              const stepLabel = child.gsdStep
                ? GSD_STEP_LABELS[child.gsdStep] ?? child.gsdStep
                : "";

              return (
                <button
                  key={child.id}
                  onClick={() => {
                    if (child.phaseNumber != null) {
                      onScrollToPhase?.(child.phaseNumber);
                    }
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "4px 10px",
                    borderRadius: 6,
                    border: isActive
                      ? "1.5px solid var(--cc-brand-primary)"
                      : "1px solid var(--cc-control-bg)",
                    backgroundColor: isActive
                      ? "var(--cc-brand-alpha-04)"
                      : "transparent",
                    cursor: "pointer",
                    flexShrink: 0,
                    transition: "all 120ms ease",
                    outline: "none",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.borderColor = "var(--cc-brand-alpha-30)";
                      e.currentTarget.style.backgroundColor = "var(--cc-brand-alpha-02)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.borderColor = "var(--cc-control-bg)";
                      e.currentTarget.style.backgroundColor = "transparent";
                    }
                  }}
                >
                  {/* Status dot */}
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      backgroundColor: statusColor,
                      flexShrink: 0,
                      animation: child.status === "running"
                        ? "pulse 1.5s ease-in-out infinite"
                        : undefined,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                      fontWeight: isActive ? 600 : 500,
                      color: isActive ? "var(--cc-brand-primary)" : "var(--cc-text-secondary)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {child.phaseNumber != null ? `P${child.phaseNumber}` : ""}
                    {stepLabel ? ` · ${stepLabel}` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              backgroundColor: "var(--cc-control-bg)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progressPct}%`,
                borderRadius: 2,
                backgroundColor: "var(--cc-brand-primary)",
                transition: "width 300ms ease",
              }}
            />
          </div>
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
              color: "var(--cc-text-tertiary)",
              whiteSpace: "nowrap",
            }}
          >
            {doneCount}/{total} phases
          </span>
        </div>

        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
        `}</style>
      </div>
    );
  }

  // Planned project: progress bar + status dots
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 5,
        backgroundColor: "var(--cc-surface-overlay)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid var(--cc-control-bg)",
        padding: "10px 24px 12px",
      }}
    >
      {/* Progress bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            flex: 1,
            height: 3,
            borderRadius: 2,
            backgroundColor: "var(--cc-control-bg)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progressPct}%`,
              borderRadius: 2,
              backgroundColor: "var(--cc-brand-primary)",
              transition: "width 300ms ease",
            }}
          />
        </div>
        <span
          style={{
            fontSize: 10,
            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
            color: "var(--cc-text-tertiary)",
            whiteSpace: "nowrap",
          }}
        >
          {doneCount}/{total} subtasks
        </span>
      </div>

      {/* Status dots row */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginTop: 6,
          flexWrap: "wrap",
        }}
      >
        {childTasks.map((child) => (
          <span
            key={child.id}
            title={child.title}
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              backgroundColor: STATUS_COLORS[child.status] ?? "var(--cc-text-tertiary)",
              flexShrink: 0,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Floating badge that appears when PhaseProgressStrip scrolls out of view.
 * Shows "Phase N of M · StepName".
 */
export function PhaseFloatingBadge({
  task,
  childTasks,
  visible,
  onJump,
}: {
  task: Task;
  childTasks: Task[];
  visible: boolean;
  onJump: () => void;
}) {
  if (!visible || childTasks.length === 0) return null;

  const isGsd = task.level === "gsd";
  const doneCount = childTasks.filter((c) => c.status === "done").length;
  const total = childTasks.length;

  // Find active phase
  const activePhase = isGsd
    ? childTasks.find((c) => c.status !== "done")
    : null;

  const label = isGsd && activePhase
    ? `Phase ${activePhase.phaseNumber ?? "?"} of ${total} · ${GSD_STEP_LABELS[activePhase.gsdStep ?? ""] ?? ""}`
    : `${doneCount}/${total} subtasks`;

  return (
    <button
      onClick={onJump}
      style={{
        position: "absolute",
        top: 8,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10,
        backgroundColor: "var(--cc-canvas-overlay-92)",
        backdropFilter: "blur(8px)",
        border: "1px solid var(--cc-line-alpha-30)",
        borderRadius: "1rem",
        padding: "5px 14px",
        fontSize: 11,
        fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
        fontWeight: 500,
        color: "var(--cc-brand-primary)",
        cursor: "pointer",
        transition: "opacity 200ms ease",
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      {label}
    </button>
  );
}

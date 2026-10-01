"use client";

import { useState, useCallback } from "react";
import { CheckCircle2, Circle, FileText, ChevronDown, ChevronRight, MessageSquare, FileEdit, Rocket, ShieldCheck, Check } from "lucide-react";
import type { GsdPhase, GsdPlan } from "@/types/gsd";
import { useTaskStore } from "@/store/task-store";

interface PhaseDetailProps {
  phase: GsdPhase;
  onViewFile: (path: string) => void;
  onPhaseUpdated?: () => void;
  /** When provided, phase action buttons fill a command bar instead of creating tasks directly. */
  onCommand?: (command: string, label: string) => void;
}

function PlanRow({ plan, phaseDir, onViewFile }: { plan: GsdPlan; phaseDir: string; onViewFile: (p: string) => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 0",
        borderBottom: "1px solid var(--cc-line-alpha-12)",
      }}
    >
      {plan.completed ? (
        <CheckCircle2 size={16} style={{ color: "var(--cc-status-success)", flexShrink: 0 }} />
      ) : (
        <Circle size={16} style={{ color: "var(--cc-palette-slate-soft)", flexShrink: 0 }} />
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--cc-brand-primary)",
            marginRight: 8,
          }}
        >
          {plan.id}
        </span>
        <span
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            color: "var(--cc-text-primary)",
          }}
        >
          {plan.description}
        </span>
      </div>

      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        {plan.hasPlanFile && (
          <button
            onClick={() => onViewFile(`${phaseDir}/${plan.id}-PLAN.md`)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 8px",
              border: "none",
              borderRadius: 4,
              backgroundColor: "var(--cc-surface-muted)",
              color: "var(--cc-text-secondary)",
              fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
              fontSize: 11,
              cursor: "pointer",
              transition: "all 150ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--cc-brand-soft)"; e.currentTarget.style.color = "var(--cc-brand-strong)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--cc-surface-muted)"; e.currentTarget.style.color = "var(--cc-text-secondary)"; }}
          >
            <FileText size={12} /> Plan
          </button>
        )}
        {plan.hasSummaryFile && (
          <button
            onClick={() => onViewFile(`${phaseDir}/${plan.id}-SUMMARY.md`)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 8px",
              border: "none",
              borderRadius: 4,
              backgroundColor: "var(--cc-surface-muted)",
              color: "var(--cc-text-secondary)",
              fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
              fontSize: 11,
              cursor: "pointer",
              transition: "all 150ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--cc-brand-soft)"; e.currentTarget.style.color = "var(--cc-brand-strong)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--cc-surface-muted)"; e.currentTarget.style.color = "var(--cc-text-secondary)"; }}
          >
            <FileText size={12} /> Summary
          </button>
        )}
      </div>
    </div>
  );
}

const gsdActions: ReadonlyArray<{
  key: string; label: string; icon: typeof MessageSquare; command: string;
  color: string; bg: string; optional?: boolean;
}> = [
  { key: "discuss", label: "Discuss", icon: MessageSquare, command: "discuss-phase", color: "var(--cc-text-secondary)", bg: "var(--cc-surface-muted)", optional: true },
  { key: "plan", label: "Plan", icon: FileEdit, command: "plan-phase", color: "var(--cc-brand-primary)", bg: "var(--cc-brand-alpha-08)" },
  { key: "execute", label: "Execute", icon: Rocket, command: "execute-phase", color: "var(--cc-status-info)", bg: "var(--cc-status-info-bg)" },
  { key: "verify", label: "Verify", icon: ShieldCheck, command: "verify-work", color: "var(--cc-status-success)", bg: "var(--cc-status-success-bg-soft)" },
];

export function PhaseDetail({ phase, onViewFile, onPhaseUpdated, onCommand }: PhaseDetailProps) {
  const [criteriaExpanded, setCriteriaExpanded] = useState(false);
  const [launchingAction, setLaunchingAction] = useState<string | null>(null);
  const [markingComplete, setMarkingComplete] = useState(false);
  const createTask = useTaskStore((s) => s.createTask);
  const updateTask = useTaskStore((s) => s.updateTask);

  const handleMarkComplete = useCallback(async () => {
    if (markingComplete) return;
    setMarkingComplete(true);
    try {
      const res = await fetch("/api/gsd/phase-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phaseNumber: phase.number, status: "complete" }),
      });
      if (res.ok) {
        onPhaseUpdated?.();
      }
    } finally {
      setMarkingComplete(false);
    }
  }, [phase.number, markingComplete, onPhaseUpdated]);

  const handleGsdAction = useCallback(async (action: (typeof gsdActions)[number]) => {
    const phaseNum = phase.number;
    const command = `/gsd-${action.command} ${phaseNum}`;
    const label = `${action.label} Phase ${phaseNum}: ${phase.name}`;

    // If parent provides a command handler, fill the command bar instead
    if (onCommand) {
      onCommand(command, label);
      return;
    }

    // Fallback: create + queue a task directly
    if (launchingAction) return;
    setLaunchingAction(action.key);
    try {
      await createTask(label, command, "task");
      const tasks = useTaskStore.getState().tasks;
      const newTask = tasks.find((t) => t.title === label && t.status === "backlog");
      if (newTask) {
        await updateTask(newTask.id, { status: "queued" });
      }
    } finally {
      setLaunchingAction(null);
    }
  }, [phase.number, phase.name, createTask, updateTask, launchingAction, onCommand]);

  const statusLabel = phase.status === "complete" ? "Complete" : phase.status === "in-progress" ? "In Progress" : "Not Started";
  const statusColor = phase.status === "complete" ? "var(--cc-status-success)" : phase.status === "in-progress" ? "var(--cc-brand-primary)" : "var(--cc-text-tertiary)";

  return (
    <div
      style={{
        backgroundColor: "var(--cc-surface)",
        border: "1px solid var(--cc-line-alpha-20)",
        borderRadius: 12,
        padding: 24,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span
              style={{
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                fontSize: 12,
                fontWeight: 600,
                color: statusColor,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Phase {phase.number}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                padding: "2px 8px",
                borderRadius: 4,
                backgroundColor: phase.status === "complete" ? "var(--cc-surface-success)" : phase.status === "in-progress" ? "var(--cc-surface)8F5" : "var(--cc-surface-muted)",
                color: statusColor,
              }}
            >
              {statusLabel}
            </span>
            {phase.completedDate && (
              <span
                style={{
                  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                  fontSize: 11,
                  color: "var(--cc-text-tertiary)",
                }}
              >
                {phase.completedDate}
              </span>
            )}
          </div>
          <h3
            style={{
              fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
              fontWeight: 700,
              fontSize: 18,
              color: "var(--cc-text-primary)",
              margin: 0,
            }}
          >
            {phase.name}
          </h3>
        </div>

        {/* Phase file links + mark complete */}
        <div style={{ display: "flex", gap: 6 }}>
          {phase.phaseDir && (
            <button
              onClick={() => onViewFile(`${phase.phaseDir}/${String(phase.number).padStart(2, "0")}-CONTEXT.md`)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "6px 10px",
                border: "none",
                borderRadius: 6,
                backgroundColor: "var(--cc-surface-muted)",
                color: "var(--cc-text-secondary)",
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                fontSize: 11,
                cursor: "pointer",
                transition: "all 150ms ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--cc-brand-soft)"; e.currentTarget.style.color = "var(--cc-brand-strong)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--cc-surface-muted)"; e.currentTarget.style.color = "var(--cc-text-secondary)"; }}
            >
              <FileText size={12} /> Context
            </button>
          )}
          {phase.status !== "complete" && (
            <button
              onClick={handleMarkComplete}
              disabled={markingComplete}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "6px 10px",
                border: "none",
                borderRadius: 6,
                backgroundColor: "var(--cc-status-success-bg)",
                color: "var(--cc-status-success)",
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                fontSize: 11,
                cursor: markingComplete ? "not-allowed" : "pointer",
                opacity: markingComplete ? 0.6 : 1,
                transition: "all 150ms ease",
              }}
              onMouseEnter={(e) => { if (!markingComplete) { e.currentTarget.style.backgroundColor = "var(--cc-status-success-bg)"; } }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--cc-status-success-bg)"; }}
            >
              <Check size={12} />
              {markingComplete ? "Saving..." : "Mark Complete"}
            </button>
          )}
        </div>
      </div>

      {/* GSD Actions */}
      {phase.status !== "complete" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {gsdActions.map((action) => {
            const Icon = action.icon;
            const isLaunching = launchingAction === action.key;
            return (
              <button
                key={action.key}
                onClick={() => handleGsdAction(action)}
                disabled={isLaunching || launchingAction !== null}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 14px",
                  fontSize: 12,
                  fontWeight: 500,
                  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                  border: `1px solid ${action.color}25`,
                  borderRadius: 6,
                  backgroundColor: action.bg,
                  color: action.color,
                  cursor: isLaunching || launchingAction !== null ? "not-allowed" : "pointer",
                  opacity: launchingAction !== null && !isLaunching ? 0.4 : 1,
                  transition: "all 150ms ease",
                }}
              >
                <Icon size={13} />
                {isLaunching ? "Queued..." : action.label}
                {action.optional && (
                  <span style={{ fontSize: 10, opacity: 0.6, fontWeight: 400 }}>(optional)</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Goal */}
      <div style={{ marginBottom: 20 }}>
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 14,
            color: "var(--cc-text-secondary)",
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          {phase.goal}
        </p>
      </div>

      {/* Metadata chips */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        {phase.dependsOn && (
          <span
            style={{
              fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
              fontSize: 11,
              color: "var(--cc-text-secondary)",
              backgroundColor: "var(--cc-surface-muted)",
              padding: "4px 10px",
              borderRadius: 4,
            }}
          >
            Depends: {phase.dependsOn}
          </span>
        )}
        {phase.requirements.length > 0 && (
          <span
            style={{
              fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
              fontSize: 11,
              color: "var(--cc-text-secondary)",
              backgroundColor: "var(--cc-surface-muted)",
              padding: "4px 10px",
              borderRadius: 4,
            }}
          >
            {phase.requirements.length} requirements
          </span>
        )}
      </div>

      {/* Success Criteria (collapsible) */}
      {phase.successCriteria.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <button
            onClick={() => setCriteriaExpanded(!criteriaExpanded)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--cc-text-primary)",
              padding: 0,
              marginBottom: criteriaExpanded ? 8 : 0,
            }}
          >
            {criteriaExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Success Criteria ({phase.successCriteria.length})
          </button>
          {criteriaExpanded && (
            <div style={{ paddingLeft: 20 }}>
              {phase.successCriteria.map((sc, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 8,
                    padding: "4px 0",
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 13,
                    color: "var(--cc-text-secondary)",
                    lineHeight: 1.5,
                  }}
                >
                  <span style={{ color: "var(--cc-text-tertiary)", flexShrink: 0 }}>{i + 1}.</span>
                  <span>{sc}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Plans */}
      <div>
        <h4
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--cc-text-primary)",
            margin: "0 0 8px",
          }}
        >
          Plans ({phase.plansComplete}/{phase.plansTotal})
        </h4>
        <div>
          {phase.plans.map((plan) => (
            <PlanRow key={plan.id} plan={plan} phaseDir={phase.phaseDir} onViewFile={onViewFile} />
          ))}
          {phase.plans.length === 0 && (
            <p
              style={{
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 13,
                color: "var(--cc-text-tertiary)",
                fontStyle: "italic",
              }}
            >
              No plans created yet
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

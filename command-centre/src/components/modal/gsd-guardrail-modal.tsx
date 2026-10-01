"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Rocket, X } from "lucide-react";
import type { ScopeResult } from "@/app/api/tasks/scope-goal/route";

// ── Types ──

interface GsdStatus {
  exists: boolean;
  projectName?: string;
  currentPhase?: number | null;
  totalPhases?: number;
  completedPhases?: number;
}

interface GsdGuardrailModalProps {
  open: boolean;
  goal: string;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  scope: ScopeResult;
  clientId?: string;
  onClose: () => void;
  onCreated: (result: { projectSlug: string }) => void;
}

// ── Helpers ──

function slugifyGoal(goal: string): string {
  const base = goal
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return base || `gsd-project-${Date.now()}`;
}

function titleFromGoal(goal: string): string {
  const firstLine = goal.trim().split("\n")[0];
  if (firstLine.length <= 70) return firstLine;
  return firstLine.slice(0, 67).replace(/\s+\S*$/, "") + "...";
}

// ── Component ──

export function GsdGuardrailModal({
  open,
  goal,
  scope: _scope,
  clientId,
  onClose,
  onCreated,
}: GsdGuardrailModalProps) {
  const [status, setStatus] = useState<GsdStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // Fetch status on open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setStatus(null);
    setArchiveConfirm(false);

    fetch("/api/gsd/status")
      .then((res) => res.json())
      .then((data: GsdStatus) => {
        if (cancelled) return;
        setStatus(data);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not check GSD status. Try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting && !archiving) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose, submitting, archiving]);

  const handleCreate = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const slug = slugifyGoal(goal);
    const name = titleFromGoal(goal);

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          name,
          goal,
          level: 3,
          clientId,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || "Failed to create GSD project");
      }
      const project = await res.json();
      onCreated({ projectSlug: project.slug ?? slug });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setSubmitting(false);
    }
  }, [goal, clientId, submitting, onCreated, onClose]);

  const handleOpenGsd = useCallback(() => {
    window.open("/gsd", "_blank");
  }, []);

  const handleArchive = useCallback(async () => {
    if (!status?.projectName || archiving) return;
    setArchiving(true);
    setError(null);

    // The archive endpoint takes a project slug. We don't know the slug
    // from status alone (it returns the human name), so we do a best
    // effort slugify of the project name.
    const slug = slugifyGoal(status.projectName);

    try {
      const res = await fetch("/api/gsd/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(
          payload?.error ||
            "Could not archive the active GSD project automatically. Open /gsd to archive it manually."
        );
      }
      // After archiving, refetch status so the modal flips into the
      // create-new state.
      setArchiveConfirm(false);
      setLoading(true);
      const statusRes = await fetch("/api/gsd/status");
      const statusData = (await statusRes.json()) as GsdStatus;
      setStatus(statusData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setArchiving(false);
      setLoading(false);
    }
  }, [status, archiving]);

  if (!open) return null;

  return (
    <>
      {/* Overlay */}
      <div
        onClick={() => {
          if (!submitting && !archiving) onClose();
        }}
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "var(--cc-neutral-alpha-35)",
          zIndex: 200,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "min(560px, 92vw)",
            maxHeight: "90vh",
            overflowY: "auto",
            backgroundColor: "var(--cc-surface)",
            borderRadius: 12,
            boxShadow: "0px 20px 48px var(--cc-neutral-alpha-20)",
            display: "flex",
            flexDirection: "column",
            fontFamily: "var(--font-inter), Inter, sans-serif",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "18px 24px",
              borderBottom: "1px solid var(--cc-control-bg)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  backgroundColor: "var(--cc-surface-info)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--cc-status-info-strong)",
                }}
              >
                <Rocket size={16} />
              </div>
              <span
                style={{
                  fontFamily:
                    "var(--font-epilogue), Epilogue, sans-serif",
                  fontSize: 16,
                  fontWeight: 600,
                  color: "var(--cc-text-primary)",
                }}
              >
                GSD Pre-Flight Check
              </span>
            </div>
            <button
              onClick={onClose}
              disabled={submitting || archiving}
              aria-label="Close"
              style={{
                background: "none",
                border: "none",
                cursor: submitting || archiving ? "default" : "pointer",
                color: "var(--cc-text-tertiary)",
                padding: 4,
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: submitting || archiving ? 0.5 : 1,
              }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
            {loading && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  color: "var(--cc-text-secondary)",
                  fontSize: 13,
                  padding: "20px 0",
                }}
              >
                <Loader2
                  size={16}
                  style={{ animation: "spin 1s linear infinite" }}
                />
                Checking for active deep build…
              </div>
            )}

            {!loading && status && status.exists === false && (
              <CreateView
                goal={goal}
                error={error}
                submitting={submitting}
                onCancel={onClose}
                onConfirm={handleCreate}
              />
            )}

            {!loading && status && status.exists === true && (
              <BlockedView
                projectName={status.projectName ?? "Unknown project"}
                currentPhase={status.currentPhase ?? null}
                totalPhases={status.totalPhases ?? null}
                completedPhases={status.completedPhases ?? null}
                archiveConfirm={archiveConfirm}
                archiving={archiving}
                error={error}
                onCancel={onClose}
                onOpenGsd={handleOpenGsd}
                onRequestArchive={() => setArchiveConfirm(true)}
                onConfirmArchive={handleArchive}
                onCancelArchive={() => setArchiveConfirm(false)}
              />
            )}

            {!loading && !status && error && (
              <div
                style={{
                  color: "var(--cc-status-danger-hover)",
                  fontSize: 13,
                  padding: "12px 14px",
                  backgroundColor: "var(--cc-surface)1F0",
                  borderRadius: 8,
                  border: "1px solid var(--cc-border-danger)",
                }}
              >
                {error}
              </div>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}

// ── Sub-views ──

function CreateView({
  goal,
  error,
  submitting,
  onCancel,
  onConfirm,
}: {
  goal: string;
  error: string | null;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <div>
        <Label>Goal</Label>
        <div
          style={{
            padding: "10px 12px",
            fontSize: 13,
            color: "var(--cc-text-primary)",
            backgroundColor: "var(--cc-surface-muted)",
            borderRadius: 8,
            border: "1px solid var(--cc-line-alpha-25)",
            whiteSpace: "pre-wrap",
            lineHeight: 1.5,
          }}
        >
          {goal}
        </div>
      </div>

      <div
        style={{
          padding: "12px 14px",
          borderRadius: 8,
          backgroundColor: "var(--cc-surface-info)",
          border: "1px solid var(--cc-status-info-bg)",
          fontSize: 13,
          color: "var(--cc-status-info-strong)",
          lineHeight: 1.55,
        }}
      >
        <strong style={{ fontWeight: 600 }}>Start a GSD project.</strong>{" "}
        This will create a brief in <code>projects/briefs/</code> and
        reserve the <code>.planning/</code> workspace for multi-phase
        execution. Only one GSD project can run at a time.
      </div>

      {error && (
        <div
          style={{
            color: "var(--cc-status-danger-hover)",
            fontSize: 13,
            padding: "10px 12px",
            backgroundColor: "var(--cc-surface)1F0",
            borderRadius: 8,
            border: "1px solid var(--cc-border-danger)",
          }}
        >
          {error}
        </div>
      )}

      <ButtonRow>
        <SecondaryButton onClick={onCancel} disabled={submitting}>
          Cancel
        </SecondaryButton>
        <PrimaryButton onClick={onConfirm} disabled={submitting}>
          {submitting ? "Creating…" : "Create GSD project"}
        </PrimaryButton>
      </ButtonRow>
    </>
  );
}

function BlockedView({
  projectName,
  currentPhase,
  totalPhases,
  completedPhases,
  archiveConfirm,
  archiving,
  error,
  onCancel,
  onOpenGsd,
  onRequestArchive,
  onConfirmArchive,
  onCancelArchive,
}: {
  projectName: string;
  currentPhase: number | null;
  totalPhases: number | null;
  completedPhases: number | null;
  archiveConfirm: boolean;
  archiving: boolean;
  error: string | null;
  onCancel: () => void;
  onOpenGsd: () => void;
  onRequestArchive: () => void;
  onConfirmArchive: () => void;
  onCancelArchive: () => void;
}) {
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "12px 14px",
          borderRadius: 8,
          backgroundColor: "var(--cc-surface)7E6",
          border: "1px solid var(--cc-border-warning)",
        }}
      >
        <AlertTriangle size={16} style={{ color: "var(--cc-status-warning-bright)", marginTop: 2, flexShrink: 0 }} />
        <div style={{ fontSize: 13, color: "var(--cc-status-warning-strong)", lineHeight: 1.5 }}>
          <strong style={{ fontWeight: 600 }}>Active deep build detected.</strong>{" "}
          Only one GSD project can be active at a time. Finish or archive
          the current one before starting a new deep build.
        </div>
      </div>

      <div>
        <Label>Active project</Label>
        <div
          style={{
            padding: "12px 14px",
            fontSize: 13,
            color: "var(--cc-text-primary)",
            backgroundColor: "var(--cc-surface-muted)",
            borderRadius: 8,
            border: "1px solid var(--cc-line-alpha-25)",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
            {projectName}
          </div>
          <div style={{ color: "var(--cc-text-secondary)", fontSize: 12 }}>
            {currentPhase != null && totalPhases != null
              ? `Phase ${currentPhase} of ${totalPhases}`
              : currentPhase != null
              ? `Current phase: ${currentPhase}`
              : "Status unknown"}
            {completedPhases != null && totalPhases != null
              ? ` · ${completedPhases}/${totalPhases} phases complete`
              : ""}
          </div>
        </div>
      </div>

      {archiveConfirm && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 8,
            backgroundColor: "var(--cc-surface)1F0",
            border: "1px solid var(--cc-border-danger)",
            fontSize: 13,
            color: "var(--cc-status-danger-strong)",
            lineHeight: 1.5,
          }}
        >
          <strong style={{ fontWeight: 600 }}>Archive this project?</strong>{" "}
          This will leave <code>.planning/</code> in place and mark the
          brief as complete. You can&apos;t undo this from the UI.
        </div>
      )}

      {error && (
        <div
          style={{
            color: "var(--cc-status-danger-hover)",
            fontSize: 13,
            padding: "10px 12px",
            backgroundColor: "var(--cc-surface)1F0",
            borderRadius: 8,
            border: "1px solid var(--cc-border-danger)",
          }}
        >
          {error}
        </div>
      )}

      <ButtonRow>
        <SecondaryButton onClick={onCancel} disabled={archiving}>
          Cancel
        </SecondaryButton>
        <SecondaryButton onClick={onOpenGsd} disabled={archiving}>
          Open /gsd
        </SecondaryButton>
        {archiveConfirm ? (
          <>
            <SecondaryButton onClick={onCancelArchive} disabled={archiving}>
              Keep it
            </SecondaryButton>
            <DangerButton onClick={onConfirmArchive} disabled={archiving}>
              {archiving ? "Archiving…" : "Confirm archive"}
            </DangerButton>
          </>
        ) : (
          <DangerButton onClick={onRequestArchive} disabled={archiving}>
            Archive current project
          </DangerButton>
        )}
      </ButtonRow>
    </>
  );
}

// ── Tiny presentational primitives ──

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--cc-text-secondary)",
        marginBottom: 6,
        fontWeight: 600,
      }}
    >
      {children}
    </div>
  );
}

function ButtonRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        gap: 8,
        flexWrap: "wrap",
        marginTop: 4,
      }}
    >
      {children}
    </div>
  );
}

function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "8px 16px",
        fontSize: 13,
        fontWeight: 500,
        fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
        border: "1px solid var(--cc-line-alpha-40)",
        borderRadius: 6,
        backgroundColor: "transparent",
        color: "var(--cc-text-secondary)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "all 150ms ease",
      }}
    >
      {children}
    </button>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "8px 16px",
        fontSize: 13,
        fontWeight: 600,
        fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
        border: "none",
        borderRadius: 6,
        background: disabled
          ? "var(--cc-control-border)"
          : "linear-gradient(135deg, var(--cc-brand-primary), var(--cc-brand-hover))",
        color: "var(--cc-surface)",
        cursor: disabled ? "default" : "pointer",
        transition: "all 150ms ease",
      }}
    >
      {children}
    </button>
  );
}

function DangerButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "8px 16px",
        fontSize: 13,
        fontWeight: 600,
        fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
        border: "1px solid var(--cc-border-danger)",
        borderRadius: 6,
        backgroundColor: disabled ? "var(--cc-surface-soft)" : "var(--cc-surface)1F0",
        color: disabled ? "var(--cc-text-tertiary)" : "var(--cc-status-danger-hover)",
        cursor: disabled ? "default" : "pointer",
        transition: "all 150ms ease",
      }}
    >
      {children}
    </button>
  );
}

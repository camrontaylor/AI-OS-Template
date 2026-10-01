"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, ArrowLeft, X, ArrowUp } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { PhasePipeline } from "@/components/gsd/phase-pipeline";
import { PhaseDetail } from "@/components/gsd/phase-detail";
import { ContentViewer } from "@/components/context/content-viewer";
import { useTaskStore } from "@/store/task-store";
import type { GsdProject } from "@/types/gsd";

export default function GsdPage() {
  const router = useRouter();
  const [project, setProject] = useState<GsdProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPhase, setSelectedPhase] = useState<number | null>(null);
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [pendingCommand, setPendingCommand] = useState("");
  const [pendingLabel, setPendingLabel] = useState("");
  const [isSendingCommand, setIsSendingCommand] = useState(false);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const createTask = useTaskStore((s) => s.createTask);
  const updateTask = useTaskStore((s) => s.updateTask);

  const loadProject = useCallback((keepSelection?: boolean) => {
    fetch("/api/gsd")
      .then((r) => r.json())
      .then((data) => {
        setProject(data as GsdProject);
        if (data.hasPlanning && data.phases?.length > 0 && !keepSelection) {
          const current = data.phases.find((p: { status: string }) => p.status !== "complete");
          setSelectedPhase(current?.number ?? data.phases[data.phases.length - 1].number);
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  const handleViewFile = useCallback((path: string) => {
    setViewingFile(path);
  }, []);

  const handlePhaseUpdated = useCallback(() => {
    loadProject(true);
  }, [loadProject]);

  const handleArchive = useCallback(async () => {
    if (!project?.briefSlug) return;
    setArchiving(true);
    try {
      const res = await fetch("/api/gsd/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: project.briefSlug }),
      });
      if (res.ok) {
        setShowArchiveConfirm(false);
        router.push("/");
      }
    } finally {
      setArchiving(false);
    }
  }, [project?.briefSlug, router]);

  const handlePhaseCommand = useCallback((command: string, label: string) => {
    setPendingCommand(command);
    setPendingLabel(label);
    // Focus the input after React renders
    setTimeout(() => commandInputRef.current?.focus(), 0);
  }, []);

  const handleSendCommand = useCallback(async () => {
    const cmd = pendingCommand.trim();
    if (!cmd || isSendingCommand) return;
    setIsSendingCommand(true);
    try {
      const title = pendingLabel || cmd;
      await createTask(title, cmd, "task");
      const tasks = useTaskStore.getState().tasks;
      const newTask = tasks.find((t) => t.title === title && t.status === "backlog");
      if (newTask) {
        await updateTask(newTask.id, { status: "queued" });
      }
      setPendingCommand("");
      setPendingLabel("");
    } finally {
      setIsSendingCommand(false);
    }
  }, [pendingCommand, pendingLabel, isSendingCommand, createTask, updateTask]);

  if (loading) {
    return (
      <AppShell title="GSD">
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          {[300, 720, 500].map((w, i) => (
            <div
              key={i}
              style={{
                height: i === 1 ? 80 : 20,
                width: Math.min(w, 720),
                backgroundColor: "var(--cc-control-bg)",
                borderRadius: 8,
                animation: "pulse-dot 1.5s ease-in-out infinite",
              }}
            />
          ))}
        </div>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell title="GSD">
        <div style={{ padding: 24 }}>
          <div style={{ backgroundColor: "var(--cc-surface-danger-soft)", padding: 16, borderRadius: 8 }}>
            <p style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 14, color: "var(--cc-status-danger-alt)", margin: 0 }}>
              Failed to load GSD data: {error}
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!project?.hasPlanning) {
    return (
      <AppShell title="GSD">
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 400,
            gap: 12,
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 14,
              color: "var(--cc-text-secondary)",
            }}
          >
            No GSD project found. Start one with{" "}
            <code
              style={{
                fontFamily: "var(--font-space-grotesk), Space Grotesk, monospace",
                backgroundColor: "var(--cc-surface-muted)",
                padding: "2px 6px",
                borderRadius: 4,
                fontSize: 13,
              }}
            >
              /gsd-new-project
            </code>
          </p>
        </div>
      </AppShell>
    );
  }

  const selectedPhaseData = project.phases.find((p) => p.number === selectedPhase);

  // File viewer overlay
  if (viewingFile) {
    return (
      <AppShell title="GSD">
        <div>
          {/* Back button */}
          <button
            onClick={() => setViewingFile(null)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              margin: "0 0 16px",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              fontWeight: 500,
              color: "var(--cc-brand-primary)",
            }}
          >
            &#8592; Back to GSD
          </button>
          <div
            style={{
              backgroundColor: "var(--cc-surface)",
              border: "1px solid var(--cc-line-alpha-20)",
              borderRadius: 12,
              minHeight: 400,
            }}
          >
            <ContentViewer selectedPath={viewingFile} />
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="GSD">
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Back to overview */}
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
            fontSize: 13,
            fontWeight: 500,
            color: "var(--cc-brand-primary)",
            textDecoration: "none",
            marginBottom: -16,
          }}
        >
          <ArrowLeft size={14} />
          Overview
        </Link>

        {/* Project header */}
        <div
          style={{
            backgroundColor: "var(--cc-surface)",
            border: "1px solid var(--cc-line-alpha-20)",
            borderRadius: 12,
            padding: 20,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h2
                style={{
                  fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
                  fontWeight: 700,
                  fontSize: 20,
                  color: "var(--cc-text-primary)",
                  margin: "0 0 4px",
                }}
              >
                {project.name}
              </h2>
              {project.coreValue && (
                <p
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 13,
                    color: "var(--cc-text-secondary)",
                    margin: 0,
                    maxWidth: 600,
                  }}
                >
                  {project.coreValue}
                </p>
              )}
            </div>

            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              {/* Archive button */}
              {project.briefSlug && (
                <button
                  onClick={() => setShowArchiveConfirm(true)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: 500,
                    fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                    border: "1px solid var(--cc-status-info-bg)",
                    borderRadius: 6,
                    backgroundColor: "var(--cc-status-info-bg)",
                    color: "var(--cc-status-info)",
                    cursor: "pointer",
                    transition: "background-color 150ms ease",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--cc-status-info-bg)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--cc-status-info-bg)"; }}
                >
                  <Archive size={13} />
                  Archive
                </button>
              )}
              <div style={{ textAlign: "right" }}>
                <span
                  style={{
                    fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                    fontSize: 11,
                    color: "var(--cc-text-tertiary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    display: "block",
                  }}
                >
                  {project.milestone}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                    fontSize: 22,
                    fontWeight: 700,
                    color: "var(--cc-brand-primary)",
                  }}
                >
                  {project.completedPhases}/{project.totalPhases}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                    fontSize: 11,
                    color: "var(--cc-text-tertiary)",
                    display: "block",
                  }}
                >
                  phases
                </span>
              </div>

              {/* Overall progress ring */}
              <div style={{ position: "relative", width: 48, height: 48 }}>
                <svg width="48" height="48" viewBox="0 0 48 48">
                  <circle cx="24" cy="24" r="20" fill="none" stroke="var(--cc-control-bg)" strokeWidth="4" />
                  <circle
                    cx="24"
                    cy="24"
                    r="20"
                    fill="none"
                    stroke="var(--cc-brand-primary)"
                    strokeWidth="4"
                    strokeDasharray={`${(project.completedPhases / project.totalPhases) * 125.6} 125.6`}
                    strokeLinecap="round"
                    transform="rotate(-90 24 24)"
                    style={{ transition: "stroke-dasharray 500ms ease" }}
                  />
                </svg>
                <span
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "var(--cc-brand-primary)",
                  }}
                >
                  {Math.round((project.completedPhases / project.totalPhases) * 100)}%
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Phase pipeline */}
        <PhasePipeline
          phases={project.phases}
          selectedPhase={selectedPhase}
          onSelectPhase={setSelectedPhase}
        />

        {/* Phase detail */}
        {selectedPhaseData && (
          <PhaseDetail phase={selectedPhaseData} onViewFile={handleViewFile} onPhaseUpdated={handlePhaseUpdated} onCommand={handlePhaseCommand} />
        )}

        {/* Command bar — appears when a phase action is clicked */}
        {pendingCommand && (
          <div
            style={{
              position: "sticky",
              bottom: 16,
              background: "var(--cc-surface-soft)",
              border: "1px solid var(--cc-control-bg-active)",
              borderRadius: 10,
              padding: "10px 12px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              boxShadow: "0 -4px 20px var(--cc-neutral-alpha-06)",
            }}
          >
            <input
              ref={commandInputRef}
              value={pendingCommand}
              onChange={(e) => setPendingCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); handleSendCommand(); }
                if (e.key === "Escape") { setPendingCommand(""); setPendingLabel(""); }
              }}
              style={{
                flex: 1,
                fontSize: 14,
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                fontWeight: 500,
                color: "var(--cc-status-purple)",
                backgroundColor: "transparent",
                border: "none",
                outline: "none",
                padding: "4px 0",
              }}
            />
            <button
              type="button"
              onClick={() => { setPendingCommand(""); setPendingLabel(""); }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 4,
                color: "var(--cc-text-tertiary)",
                display: "flex",
                alignItems: "center",
              }}
            >
              <X size={14} />
            </button>
            <button
              type="button"
              onClick={handleSendCommand}
              disabled={isSendingCommand}
              style={{
                width: 28,
                height: 26,
                borderRadius: 6,
                border: "none",
                background: isSendingCommand
                  ? "var(--cc-control-bg-hover)"
                  : "linear-gradient(135deg, var(--cc-brand-primary), var(--cc-brand-hover))",
                color: isSendingCommand ? "var(--cc-text-secondary)" : "var(--cc-surface)",
                cursor: isSendingCommand ? "default" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <ArrowUp size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Archive confirmation modal */}
      {showArchiveConfirm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "var(--cc-neutral-alpha-40)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowArchiveConfirm(false)}
        >
          <div
            style={{
              backgroundColor: "var(--cc-surface)",
              borderRadius: 14,
              padding: "28px 32px",
              maxWidth: 480,
              width: "90%",
              boxShadow: "0 20px 60px var(--cc-neutral-alpha-20)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 16, fontWeight: 600, color: "var(--cc-text-primary)" }}>
                Archive GSD Project
              </span>
              <button
                onClick={() => setShowArchiveConfirm(false)}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 4, border: "none", backgroundColor: "transparent", color: "var(--cc-text-tertiary)", cursor: "pointer", borderRadius: 4 }}
              >
                <X size={16} />
              </button>
            </div>

            <p style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 14, color: "var(--cc-text-secondary)", lineHeight: 1.6, margin: "0 0 8px" }}>
              This will archive the GSD project for <strong>{project.name}</strong>. Here&apos;s what happens:
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "16px 0", padding: "16px 20px", backgroundColor: "var(--cc-surface-muted)", borderRadius: 10 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={stepNumStyle}>1</span>
                <span style={stepTextStyle}>
                  The brief&apos;s status changes from <strong>active</strong> to <strong>complete</strong>
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={stepNumStyle}>2</span>
                <span style={stepTextStyle}>
                  <strong>projects/briefs/{project.briefSlug}/.planning/</strong> stays in place as a self-contained historical record
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={stepNumStyle}>3</span>
                <span style={stepTextStyle}>
                  The project disappears from Active Projects. You can start another GSD project anytime — each one owns its own planning folder.
                </span>
              </div>
            </div>

            <p style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 13, color: "var(--cc-text-tertiary)", lineHeight: 1.6, margin: "0 0 4px" }}>
              Nothing moves or is deleted. Every planning artifact stays exactly where it already lives inside the brief folder.
            </p>

            <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowArchiveConfirm(false)}
                style={{
                  padding: "8px 16px", fontSize: 13, fontWeight: 500,
                  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                  border: "1px solid var(--cc-line-alpha-30)", borderRadius: 8,
                  backgroundColor: "transparent", color: "var(--cc-text-secondary)", cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleArchive}
                disabled={archiving}
                style={{
                  padding: "8px 16px", fontSize: 13, fontWeight: 600,
                  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                  border: "none", borderRadius: 8,
                  backgroundColor: "var(--cc-status-info)", color: "var(--cc-surface)", cursor: archiving ? "not-allowed" : "pointer",
                  opacity: archiving ? 0.6 : 1,
                }}
              >
                {archiving ? "Archiving..." : "Yes, archive this project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

const stepNumStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 20,
  height: 20,
  borderRadius: "50%",
  backgroundColor: "var(--cc-status-info-bg)",
  color: "var(--cc-status-info)",
  fontSize: 11,
  fontWeight: 700,
  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
  flexShrink: 0,
};

const stepTextStyle: React.CSSProperties = {
  fontFamily: "var(--font-inter), Inter, sans-serif",
  fontSize: 13,
  color: "var(--cc-text-primary)",
  lineHeight: 1.5,
};

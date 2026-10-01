"use client";

interface SubtaskDot {
  id: string;
  title: string;
  status: string;
}

interface SubtaskStatusStripProps {
  subtasks: SubtaskDot[];
  onJump: (id: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  running: "var(--cc-status-info)",
  review: "var(--cc-status-warning-bright)",
  done: "var(--cc-status-success-bright)",
  error: "var(--cc-status-danger-alt)",
  queued: "var(--cc-status-info)",
  backlog: "var(--cc-palette-slate-soft)",
};

export function SubtaskStatusStrip({ subtasks, onJump }: SubtaskStatusStripProps) {
  if (subtasks.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 16px 4px",
        flexShrink: 0,
      }}
    >
      {subtasks.map((s) => {
        const color = STATUS_COLORS[s.status] || "var(--cc-palette-slate-soft)";
        const isRunning = s.status === "running";
        return (
          <button
            key={s.id}
            onClick={() => onJump(s.id)}
            title={`${s.title} (${s.status})`}
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              backgroundColor: color,
              border: "none",
              padding: 0,
              cursor: "pointer",
              flexShrink: 0,
              animation: isRunning ? "pulse-dot 2s ease-in-out infinite" : undefined,
              transition: "transform 100ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.4)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
          />
        );
      })}
    </div>
  );
}

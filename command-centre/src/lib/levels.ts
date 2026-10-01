import type { TaskLevel } from "@/types/task";

/**
 * Shared level constants for UI routing across the app.
 *
 * Colors are kept in sync with the values used inline in
 * `src/components/board/task-create-input.tsx` — update both if they change.
 */

export const LEVEL_COLORS: Record<TaskLevel, { bg: string; text: string }> = {
  task: { bg: "var(--cc-control-bg-hover)", text: "var(--cc-text-secondary)" },
  project: { bg: "var(--cc-brand-soft)", text: "var(--cc-brand-strong)" },
  gsd: { bg: "var(--cc-surface-info)", text: "var(--cc-status-info-strong)" },
};

export const LEVEL_LABELS: Record<TaskLevel, string> = {
  task: "Task",
  project: "Planned project",
  gsd: "GSD project",
};

export const LEVEL_HINTS: Record<TaskLevel, string> = {
  task: "One-off deliverable",
  project: "Brief + subtasks",
  gsd: "Phases + verification",
};

export const LEVEL_ICONS: Record<TaskLevel, string> = {
  task: "•",
  project: "▣",
  gsd: "◆",
};

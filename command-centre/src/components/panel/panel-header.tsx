"use client";

import { X } from "lucide-react";
import type { Task } from "@/types/task";
import { LevelBadge } from "../board/level-badge";
import { useTaskStore } from "@/store/task-store";
import { PermissionPicker, type PermissionPickerMode } from "@/components/shared/permission-picker";
import { getPermissionStateForPickerChange, getPickerPermissionMode } from "@/lib/permission-mode";

function getSkillLabel(activityLabel: string | null): string {
  if (!activityLabel) return "General";
  // Match skill name patterns like mkt-*, str-*, viz-*, tool-*, ops-*, meta-*, acc-*
  const match = activityLabel.match(
    /\b(mkt|str|viz|tool|ops|meta|acc)-[a-z0-9-]+/i
  );
  return match ? match[0] : "General";
}

export function PanelHeader({
  task,
  onClose,
}: {
  task: Task;
  onClose: () => void;
}) {
  const updateTask = useTaskStore((s) => s.updateTask);
  const pickerMode = getPickerPermissionMode(
    task.permissionMode,
    task.executionPermissionMode,
    task.status,
  );

  const handlePermissionModeChange = (mode: PermissionPickerMode) => {
    void updateTask(
      task.id,
      getPermissionStateForPickerChange(
        mode,
        task.permissionMode,
        task.executionPermissionMode,
        "bypassPermissions",
      ),
    );
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          height: 56,
          padding: "0 24px",
        }}
      >
        {/* Left side: title + meta */}
        <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
              color: "var(--cc-text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {task.title}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 2,
            }}
          >
            <LevelBadge level={task.level} />
            <span
              style={{
                fontSize: 11,
                fontFamily:
                  "var(--font-space-grotesk), Space Grotesk, sans-serif",
                color: "var(--cc-text-secondary)",
              }}
            >
              {getSkillLabel(task.activityLabel)}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
              <PermissionPicker value={pickerMode} model={task.model} onChange={handlePermissionModeChange} />
              {task.permissionMode === "plan" && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "2px 8px",
                    borderRadius: 999,
                    backgroundColor: "var(--cc-surface-info)",
                    color: "var(--cc-status-purple)",
                    fontSize: 10,
                    fontWeight: 600,
                    fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                    letterSpacing: "0.03em",
                    textTransform: "uppercase",
                  }}
                >
                  Plan active
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right side: close button */}
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "0.25rem",
            color: "var(--cc-text-secondary)",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor =
              "var(--cc-surface-muted)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor =
              "transparent";
          }}
        >
          <X size={20} />
        </button>
      </div>

      {/* Bottom separator: bg shift, not a border line (No-Line Rule) */}
      <div style={{ height: 1, backgroundColor: "var(--cc-control-bg)" }} />
    </div>
  );
}

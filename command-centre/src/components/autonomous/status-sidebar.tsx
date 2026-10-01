"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Play, HelpCircle, CheckCircle, Loader } from "lucide-react";
import { useTaskStore } from "@/store/task-store";
import type { Task } from "@/types/task";
import { getVisibleEditedTasks } from "@/lib/task-branch-ui";

interface StatusSidebarProps {
  conversationId: string | null;
}

function TaskRow({ task, onClick }: { task: Task; onClick: (id: string) => void }) {
  const statusIcon = {
    running: <Loader size={12} style={{ color: "var(--cc-brand-primary)", animation: "spin 2s linear infinite" }} />,
    queued: <Play size={12} style={{ color: "var(--cc-text-secondary)" }} />,
    review: <HelpCircle size={12} style={{ color: "var(--cc-status-warning-soft)" }} />,
    done: <CheckCircle size={12} style={{ color: "var(--cc-status-success)" }} />,
    backlog: <Play size={12} style={{ color: "var(--cc-text-tertiary)" }} />,
  };

  return (
    <button
      onClick={() => onClick(task.id)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        width: "100%",
        border: "none",
        background: "transparent",
        cursor: "pointer",
        borderRadius: 6,
        fontSize: 12,
        fontFamily: "var(--font-inter), Inter, sans-serif",
        color: "var(--cc-text-primary)",
        textAlign: "left",
        transition: "background 120ms ease",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cc-brand-alpha-04)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      {statusIcon[task.status]}
      <span style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flex: 1,
      }}>
        {task.title}
      </span>
    </button>
  );
}

function StatusGroup({ label, tasks, color, onTaskClick }: {
  label: string;
  tasks: Task[];
  color: string;
  onTaskClick: (id: string) => void;
}) {
  if (tasks.length === 0) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 12px",
        marginBottom: 4,
      }}>
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color,
        }}>
          {label}
        </span>
        <span style={{
          fontSize: 10,
          fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
          color: "var(--cc-text-tertiary)",
        }}>
          ({tasks.length})
        </span>
      </div>
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} onClick={onTaskClick} />
      ))}
    </div>
  );
}

export function StatusSidebar({ conversationId }: StatusSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const tasks = useTaskStore((s) => s.tasks);
  const visibleTasks = useMemo(() => getVisibleEditedTasks(tasks), [tasks]);
  const openPanel = useTaskStore((s) => s.openPanel);

  // Filter tasks linked to this conversation, or show all active if no conversation
  const relevantTasks = conversationId
    ? visibleTasks.filter((t) => t.conversationId === conversationId || t.status === "running" || t.status === "review")
    : visibleTasks.filter((t) => t.status !== "backlog");

  const running = relevantTasks.filter((t) => t.status === "running" || t.status === "queued");
  const needsInput = relevantTasks.filter((t) => t.status === "review" || t.needsInput);
  const done = relevantTasks.filter((t) => t.status === "done").slice(0, 5);

  if (collapsed) {
    return (
      <div style={{
        width: 40,
        flexShrink: 0,
        borderRight: "1px solid var(--cc-line-alpha-15)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: 12,
        backgroundColor: "var(--cc-canvas-subtle)",
      }}>
        <button
          onClick={() => setCollapsed(false)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
            color: "var(--cc-text-secondary)",
            borderRadius: 4,
          }}
          title="Expand sidebar"
        >
          <ChevronRight size={16} />
        </button>
        {running.length > 0 && (
          <div style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: "var(--cc-brand-primary)",
            marginTop: 12,
            animation: "pulse-dot 2s ease-in-out infinite",
          }} />
        )}
        {needsInput.length > 0 && (
          <div style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: "var(--cc-status-warning-soft)",
            marginTop: 8,
          }} />
        )}
      </div>
    );
  }

  return (
    <div style={{
      width: 240,
      flexShrink: 0,
      borderRight: "1px solid var(--cc-line-alpha-15)",
      backgroundColor: "var(--cc-canvas-subtle)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 12px 8px",
        borderBottom: "1px solid var(--cc-line-alpha-10)",
      }}>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--cc-text-secondary)",
        }}>
          Active Work
        </span>
        <button
          onClick={() => setCollapsed(true)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 2,
            color: "var(--cc-text-tertiary)",
            borderRadius: 4,
          }}
          title="Collapse sidebar"
        >
          <ChevronLeft size={14} />
        </button>
      </div>

      {/* Task groups */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        <StatusGroup label="Running" tasks={running} color="var(--cc-brand-primary)" onTaskClick={openPanel} />
        <StatusGroup label="Needs Your Input" tasks={needsInput} color="var(--cc-status-warning-soft)" onTaskClick={openPanel} />
        <StatusGroup label="History" tasks={done} color="var(--cc-status-success)" onTaskClick={openPanel} />

        {running.length === 0 && needsInput.length === 0 && done.length === 0 && (
          <div style={{
            padding: "24px 16px",
            textAlign: "center",
            fontSize: 12,
            color: "var(--cc-text-tertiary)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
          }}>
            No active work yet.
            <br />
            Send a message to get started.
          </div>
        )}
      </div>
    </div>
  );
}

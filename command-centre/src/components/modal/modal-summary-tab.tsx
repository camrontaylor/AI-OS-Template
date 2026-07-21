"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  AlertCircle, FileText, Eye, CheckCircle2, Clock, Loader2, Inbox,
  ChevronRight, ChevronDown, MessageSquare, Wrench, Plus, Play,
  ArrowUp, Rocket, Terminal, Copy, Check,
} from "lucide-react";
import Link from "next/link";
import type { Task, TaskUpdateInput, OutputFile, LogEntry } from "@/types/task";
import { useTaskStore } from "@/store/task-store";
import { TaskProgress } from "./task-progress";

const statusConfig: Record<string, { icon: typeof CheckCircle2; color: string; bg: string; label: string }> = {
  backlog: { icon: Inbox, color: "var(--muted-foreground)", bg: "var(--muted)", label: "In Backlog" },
  queued: { icon: Clock, color: "var(--muted-foreground)", bg: "var(--muted)", label: "Queued" },
  running: { icon: Loader2, color: "var(--primary)", bg: "var(--muted)", label: "Running" },
  review: { icon: Eye, color: "var(--primary)", bg: "var(--muted)", label: "Needs Review" },
  done: { icon: CheckCircle2, color: "var(--muted-foreground)", bg: "var(--card)", label: "Complete" },
};

/** Extract a condensed chat log: text messages + tool summaries + skill invocations */
function buildChatDigest(logEntries: LogEntry[]): { type: "text" | "tools" | "question" | "reply" | "skill"; label: string; time: string }[] {
  const digest: { type: "text" | "tools" | "question" | "reply" | "skill"; label: string; time: string }[] = [];
  let pendingTools: { reads: number; writes: number; actions: number; lastTime: string } | null = null;

  const flushTools = () => {
    if (!pendingTools) return;
    const parts: string[] = [];
    if (pendingTools.reads > 0) parts.push(`${pendingTools.reads} read${pendingTools.reads !== 1 ? "s" : ""}`);
    if (pendingTools.writes > 0) parts.push(`${pendingTools.writes} write${pendingTools.writes !== 1 ? "s" : ""}`);
    if (pendingTools.actions > 0) parts.push(`${pendingTools.actions} action${pendingTools.actions !== 1 ? "s" : ""}`);
    digest.push({ type: "tools", label: parts.join(", "), time: pendingTools.lastTime });
    pendingTools = null;
  };

  for (const entry of logEntries) {
    if (entry.type === "tool_use") {
      const name = (entry.toolName || "").toLowerCase();

      // Surface Skill invocations as distinct entries
      if (name === "skill" && entry.toolArgs) {
        flushTools();
        try {
          const args = JSON.parse(entry.toolArgs);
          const skillName = args.skill || args.name || "unknown";
          digest.push({ type: "skill", label: `Invoked /${skillName}`, time: entry.timestamp });
        } catch {
          digest.push({ type: "skill", label: "Invoked skill", time: entry.timestamp });
        }
        continue;
      }

      if (!pendingTools) pendingTools = { reads: 0, writes: 0, actions: 0, lastTime: entry.timestamp };
      pendingTools.lastTime = entry.timestamp;
      if (["read", "glob", "grep", "webfetch", "websearch"].includes(name)) pendingTools.reads++;
      else if (["write", "edit"].includes(name)) pendingTools.writes++;
      else pendingTools.actions++;
      continue;
    }

    // Non-tool entry — flush any pending tools first
    flushTools();

    if (entry.type === "text" && entry.content.length > 30) {
      const truncated = entry.content.length > 120
        ? entry.content.slice(0, 120).trimEnd() + "…"
        : entry.content;
      digest.push({ type: "text", label: truncated, time: entry.timestamp });
    } else if (entry.type === "question") {
      const truncated = entry.content.length > 120
        ? entry.content.slice(0, 120).trimEnd() + "…"
        : entry.content;
      digest.push({ type: "question", label: truncated, time: entry.timestamp });
    } else if (entry.type === "user_reply") {
      const truncated = entry.content.length > 80
        ? entry.content.slice(0, 80).trimEnd() + "…"
        : entry.content;
      digest.push({ type: "reply", label: truncated, time: entry.timestamp });
    }
  }

  flushTools();
  return digest;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

interface SectionHeaderProps {
  label: string;
  count?: number;
  onClick?: () => void;
}

function SectionHeader({ label, count, onClick }: SectionHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--muted-foreground)",
            fontWeight: 600,
          }}
        >
          {label}
        </span>
        {count !== undefined && (
          <span
            style={{
              fontSize: 11,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              color: "var(--muted-foreground)",
            }}
          >
            ({count})
          </span>
        )}
      </div>
      {onClick && (
        <button
          onClick={onClick}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 12,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            color: "var(--primary)",
            fontWeight: 500,
            padding: "2px 4px",
          }}
        >
          View all <ChevronRight size={12} />
        </button>
      )}
    </div>
  );
}

export function ModalSummaryTab({
  task,
  logEntries,
  onDrillChat,
  onDrillOutputs,
  onFileClick,
  onViewSubtask,
}: {
  task: Task;
  logEntries: LogEntry[];
  onDrillChat: () => void;
  onDrillOutputs: () => void;
  onFileClick: (file: OutputFile) => void;
  onViewSubtask?: (childId: string) => void;
}) {
  const allOutputFiles = useTaskStore((s) => s.outputFiles);
  const outputFiles = allOutputFiles[task.id] ?? [];
  const fetchOutputFiles = useTaskStore((s) => s.fetchOutputFiles);
  const getChildTasks = useTaskStore((s) => s.getChildTasks);
  const createTask = useTaskStore((s) => s.createTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const syncPhases = useTaskStore((s) => s.syncPhases);
  const [isSyncing, setIsSyncing] = useState(false);
  const isParent = task.level !== "task";
  const childTasks = isParent ? getChildTasks(task.id) : [];

  // Fetch output files for parent + all children
  useEffect(() => {
    fetchOutputFiles(task.id);
    if (isParent) {
      childTasks.forEach((child) => fetchOutputFiles(child.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, fetchOutputFiles, isParent, childTasks.length]);

  // Aggregate: parent outputs + child outputs grouped by child
  const childOutputGroups = isParent
    ? childTasks
        .map((child) => ({
          child,
          files: allOutputFiles[child.id] ?? [],
        }))
        .filter((g) => g.files.length > 0)
    : [];
  const totalOutputCount = outputFiles.length + childOutputGroups.reduce((sum, g) => sum + g.files.length, 0);

  const cfg = statusConfig[task.status] || statusConfig.backlog;
  const StatusIcon = cfg.icon;
  const isRunning = task.status === "running";
  const hasStarted = task.status !== "backlog" && task.status !== "queued";
  const chatDigest = buildChatDigest(logEntries);

  // Subtask progress metrics
  const completedChildren = childTasks.filter((c) => c.status === "done").length;
  const runningChildren = childTasks.filter((c) => c.status === "running").length;
  const reviewChildren = childTasks.filter((c) => c.status === "review").length;

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      {/* Status banner */}
      <div
        style={{
          margin: "24px 24px 0 24px",
          padding: "16px 20px",
          backgroundColor: cfg.bg,
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <StatusIcon
          size={24}
          color={cfg.color}
          style={{
            flexShrink: 0,
            animation: isRunning ? "spin-slow 2s linear infinite" : undefined,
          }}
        />
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              color: cfg.color,
            }}
          >
            {cfg.label}
          </div>
          {task.status === "review" && (
            <div style={{ fontSize: 12, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--muted-foreground)", marginTop: 2 }}>
              Claude has finished — check the outputs and mark as done.
            </div>
          )}
          {isRunning && task.activityLabel && (
            <div style={{ fontSize: 12, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--muted-foreground)", marginTop: 2 }}>
              {task.activityLabel}
            </div>
          )}
        </div>
      </div>

      {/* GSD project actions */}
      {task.level === "gsd" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            margin: "12px 24px 0 24px",
          }}
        >
          <Link
            href="/gsd"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              borderRadius: 6,
              backgroundColor: "color-mix(in srgb, var(--foreground) 6%, transparent)",
              color: "var(--primary)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              fontWeight: 500,
              textDecoration: "none",
              transition: "background 150ms ease",
              flex: 1,
              justifyContent: "center",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 12%, transparent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 6%, transparent)"; }}
          >
            <Rocket size={13} />
            View Phases
          </Link>
          <button
            onClick={async () => {
              setIsSyncing(true);
              try { await syncPhases(task.id); } finally { setIsSyncing(false); }
            }}
            disabled={isSyncing}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              backgroundColor: "transparent",
              color: "var(--primary)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              fontWeight: 500,
              cursor: isSyncing ? "not-allowed" : "pointer",
              opacity: isSyncing ? 0.6 : 1,
              whiteSpace: "nowrap",
            }}
          >
            {isSyncing ? "Syncing..." : "Sync Phases"}
          </button>
        </div>
      )}

      {/* Resume in terminal — for session-linked tasks that aren't currently running */}
      {task.claudeSessionId && task.status !== "running" && (
        <ResumeSessionButton sessionId={task.claudeSessionId} />
      )}

      {/* Progress bar */}
      {hasStarted && (
        <div style={{ margin: "0 24px" }}>
          <TaskProgress logEntries={logEntries} status={task.status} startedAt={task.startedAt} noBorder />
        </div>
      )}

      {/* Chat log digest — hidden for project/gsd parents (those surface their
          subtasks as the main content and clicking a subtask drills straight
          into that child's own full conversation). */}
      {!isParent && (
      <div style={{ padding: "20px 24px 0 24px" }}>
        <SectionHeader
          label="Activity"
          count={logEntries.length > 0 ? logEntries.length : undefined}
          onClick={logEntries.length > 0 ? onDrillChat : undefined}
        />

        {chatDigest.length === 0 ? (
          <div
            style={{
              padding: "16px 0",
              textAlign: "center",
              color: "var(--muted-foreground)",
              fontSize: 13,
              fontFamily: "var(--font-inter), Inter, sans-serif",
            }}
          >
            {isRunning ? "Activity will appear here..." : "No activity yet"}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {chatDigest.slice(-8).map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "6px 0",
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    color: "var(--muted-foreground)",
                    minWidth: 40,
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  {formatTime(item.time)}
                </span>
                <DigestIcon type={item.type} />
                <span
                  style={{
                    fontSize: 13,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    color: item.type === "tools" ? "var(--muted-foreground)" : item.type === "reply" || item.type === "skill" ? "var(--primary)" : "var(--foreground)",
                    fontWeight: item.type === "question" || item.type === "skill" ? 500 : 400,
                    lineHeight: 1.4,
                    flex: 1,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical" as const,
                  }}
                >
                  {item.label}
                </span>
              </div>
            ))}
            {chatDigest.length > 8 && (
              <button
                onClick={onDrillChat}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  color: "var(--primary)",
                  fontWeight: 500,
                  padding: "6px 0",
                  textAlign: "center",
                }}
              >
                View full conversation
              </button>
            )}
          </div>
        )}
      </div>
      )}

      {/* Output files (parent + aggregated child outputs) — under activity */}
      <div style={{ padding: "16px 24px 0 24px" }}>
        <SectionHeader
          label="Output Files"
          count={totalOutputCount}
          onClick={totalOutputCount > 0 ? onDrillOutputs : undefined}
        />

        {totalOutputCount === 0 ? (
          <div
            style={{
              padding: "16px 0",
              textAlign: "center",
              color: "var(--muted-foreground)",
              fontSize: 13,
              fontFamily: "var(--font-inter), Inter, sans-serif",
            }}
          >
            {isRunning ? "Files will appear here as they're created..." : "No output files"}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {/* Parent's own outputs */}
            {outputFiles.slice(0, 4).map((file) => (
              <OutputFileRow key={file.id} file={file} onFileClick={onFileClick} />
            ))}
            {outputFiles.length > 4 && (
              <button
                onClick={onDrillOutputs}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  color: "var(--primary)",
                  fontWeight: 500,
                  padding: "6px 0",
                  textAlign: "center",
                }}
              >
                +{outputFiles.length - 4} more files
              </button>
            )}

            {/* Child task output groups */}
            {childOutputGroups.map(({ child, files }) => (
              <div key={`child-outputs-${child.id}`} style={{ marginTop: outputFiles.length > 0 ? 8 : 0 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    color: "var(--muted-foreground)",
                    fontWeight: 500,
                    marginBottom: 4,
                    paddingLeft: 2,
                  }}
                >
                  From: {child.title}
                </div>
                {files.slice(0, 3).map((file) => (
                  <OutputFileRow key={file.id} file={file} onFileClick={onFileClick} />
                ))}
                {files.length > 3 && (
                  <button
                    onClick={onDrillOutputs}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: 11,
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      color: "var(--primary)",
                      fontWeight: 500,
                      padding: "4px 0",
                      textAlign: "center",
                    }}
                  >
                    +{files.length - 3} more
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Project brief link */}
      {task.projectSlug && (
        <div style={{ padding: "16px 24px 0 24px" }}>
          <SectionHeader label="Project" />
          <button
            onClick={() => {
              // Open brief.md as a file preview
              onFileClick({
                id: `brief-${task.projectSlug}`,
                taskId: task.id,
                fileName: "brief.md",
                filePath: `projects/briefs/${task.projectSlug}/brief.md`,
                relativePath: `projects/briefs/${task.projectSlug}/brief.md`,
                extension: "md",
                sizeBytes: null,
                createdAt: task.createdAt,
              });
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 8,
              backgroundColor: "var(--card)",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
              width: "100%",
              transition: "background 150ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--muted)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--card)"; }}
          >
            <FileText size={16} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                color: "var(--foreground)",
                flex: 1,
              }}
            >
              {task.projectSlug} — brief.md
            </span>
            <ChevronRight size={14} color="var(--muted-foreground)" />
          </button>
        </div>
      )}

      {/* Subtask progress metrics */}
      {isParent && childTasks.length > 0 && (
        <div style={{ padding: "16px 24px 0 24px" }}>
          <SectionHeader label="Progress" />
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <div
              style={{
                flex: 1,
                height: 6,
                backgroundColor: "var(--border)",
                borderRadius: 3,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${childTasks.length > 0 ? (completedChildren / childTasks.length) * 100 : 0}%`,
                  backgroundColor: "var(--muted-foreground)",
                  borderRadius: 3,
                  transition: "width 300ms ease",
                }}
              />
            </div>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                color: "var(--foreground)",
                flexShrink: 0,
              }}
            >
              {completedChildren}/{childTasks.length}
            </span>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {completedChildren > 0 && (
              <span style={{ fontSize: 12, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--muted-foreground)", fontWeight: 500 }}>
                {completedChildren} complete
              </span>
            )}
            {runningChildren > 0 && (
              <span style={{ fontSize: 12, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--primary)", fontWeight: 500 }}>
                {runningChildren} running
              </span>
            )}
            {reviewChildren > 0 && (
              <span style={{ fontSize: 12, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--primary)", fontWeight: 500 }}>
                {reviewChildren} awaiting review
              </span>
            )}
            {childTasks.length - completedChildren - runningChildren - reviewChildren > 0 && (
              <span style={{ fontSize: 12, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--muted-foreground)", fontWeight: 500 }}>
                {childTasks.length - completedChildren - runningChildren - reviewChildren} pending
              </span>
            )}
          </div>
        </div>
      )}

      {/* Subtasks for project/gsd */}
      {isParent && (
        <div style={{ padding: "20px 24px 0 24px" }}>
          <SectionHeader label="Subtasks" count={childTasks.length} />
          {childTasks.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {childTasks.map((child) => (
                <ExpandableSubtaskRow
                  key={child.id}
                  child={child}
                  onViewFull={onViewSubtask ? (id: string) => onViewSubtask(id) : undefined}
                  updateTask={updateTask}
                />
              ))}
            </div>
          ) : (
            <div
              style={{
                padding: "12px 0",
                textAlign: "center",
                color: "var(--muted-foreground)",
                fontSize: 13,
                fontFamily: "var(--font-inter), Inter, sans-serif",
              }}
            >
              No subtasks yet
            </div>
          )}
          <ModalSubtaskInput parentId={task.id} projectSlug={task.projectSlug} createTask={createTask} />
        </div>
      )}


      {/* Description (collapsed at bottom) */}
      {task.description && (
        <div style={{ padding: "20px 24px 0 24px" }}>
          <SectionHeader label="Description" />
          <p
            style={{
              fontSize: 13,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              color: "var(--muted-foreground)",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            {task.description}
          </p>
        </div>
      )}

      {/* Error */}
      {task.errorMessage && (
        <div
          style={{
            margin: "20px 24px 0 24px",
            padding: "14px 16px",
            backgroundColor: "var(--card)",
            borderRadius: 8,
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <AlertCircle size={16} color="var(--destructive)" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 13, fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--destructive)", lineHeight: 1.4 }}>
            {task.errorMessage}
          </span>
        </div>
      )}

      {/* Bottom padding */}
      <div style={{ height: 24 }} />

      <style>{`
        @keyframes spin-slow {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function ResumeSessionButton({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false);
  const command = `claude --resume ${sessionId}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ margin: "12px 24px 0 24px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 16px",
          borderRadius: 8,
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
        }}
      >
        <Terminal size={14} style={{ color: "var(--primary)", flexShrink: 0 }} />
        <code
          style={{
            flex: 1,
            fontSize: 12,
            fontFamily: "var(--font-inter), Inter, monospace",
            color: "var(--muted-foreground)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {command}
        </code>
        <button
          onClick={handleCopy}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 12px",
            borderRadius: 5,
            border: "1px solid var(--border)",
            backgroundColor: copied ? "color-mix(in srgb, var(--foreground) 8%, transparent)" : "color-mix(in srgb, var(--foreground) 6%, transparent)",
            color: copied ? "var(--muted-foreground)" : "var(--primary)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 150ms ease",
            flexShrink: 0,
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}


function DigestIcon({ type }: { type: "text" | "tools" | "question" | "reply" | "skill" }) {
  const size = 14;
  const style = { flexShrink: 0, marginTop: 2 } as const;

  switch (type) {
    case "text":
      return <MessageSquare size={size} color="var(--muted-foreground)" style={style} />;
    case "tools":
      return <Wrench size={size} color="var(--muted-foreground)" style={style} />;
    case "skill":
      return <Play size={size} color="var(--primary)" style={style} />;
    case "question":
      return <Eye size={size} color="var(--primary)" style={style} />;
    case "reply":
      return <MessageSquare size={size} color="var(--primary)" style={style} />;
  }
}

function ModalSubtaskInput({
  parentId,
  projectSlug,
  createTask,
}: {
  parentId: string;
  projectSlug: string | null;
  createTask: (title: string, description: string | null, level: "task" | "project" | "gsd", projectSlug?: string | null, parentId?: string | null) => Promise<string | null>;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isAdding && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isAdding]);

  const handleSubmit = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setValue("");
    await createTask(trimmed, null, "task", projectSlug, parentId);
  };

  if (!isAdding) {
    return (
      <button
        onClick={() => setIsAdding(true)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          color: "var(--muted-foreground)",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "8px 0",
          marginTop: 4,
        }}
      >
        <Plus size={12} />
        Add subtask
      </button>
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
          if (e.key === "Escape") { setIsAdding(false); setValue(""); }
        }}
        onBlur={() => {
          if (!value.trim()) { setIsAdding(false); setValue(""); }
        }}
        placeholder="Subtask title..."
        style={{
          width: "100%",
          fontSize: 13,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          padding: "8px 10px",
          border: "1px solid color-mix(in srgb, var(--foreground) 40%, transparent)",
          borderRadius: 6,
          outline: "none",
          backgroundColor: "var(--muted)",
          color: "var(--foreground)",
        }}
      />
    </div>
  );
}

function ExpandableSubtaskRow({
  child,
  onViewFull,
  updateTask,
}: {
  child: Task;
  onViewFull?: (id: string) => void;
  updateTask: (id: string, updates: TaskUpdateInput) => Promise<void>;
}) {
  const childCfg = statusConfig[child.status] || statusConfig.backlog;

  return (
    <div>
      {/* Row — click drills straight into the child's full conversation */}
      <button
        onClick={() => onViewFull?.(child.id)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          borderRadius: 6,
          backgroundColor: "var(--muted)",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          width: "100%",
          transition: "background 150ms ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--muted)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--muted)"; }}
      >
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: childCfg.color,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            color: "var(--foreground)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {child.title}
        </span>
        <span
          style={{
            fontSize: 10,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            color: "var(--muted-foreground)",
            textTransform: "capitalize",
          }}
        >
          {child.status}
        </span>
        {child.status === "backlog" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              updateTask(child.id, { status: "queued" });
            }}
            title="Queue this task"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              padding: "4px 8px",
              borderRadius: 4,
              border: "none",
              backgroundColor: "color-mix(in srgb, var(--foreground) 8%, transparent)",
              color: "var(--primary)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 500,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              flexShrink: 0,
              transition: "background 100ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 20%, transparent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 8%, transparent)"; }}
          >
            <Play size={10} />
            Queue
          </button>
        )}
        {child.status !== "done" ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              updateTask(child.id, { status: "done", completedAt: new Date().toISOString() });
            }}
            title="Mark as done"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              padding: "4px 8px",
              borderRadius: 4,
              border: "none",
              backgroundColor: "color-mix(in srgb, var(--foreground) 8%, transparent)",
              color: "var(--muted-foreground)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 500,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              flexShrink: 0,
              transition: "background 100ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 20%, transparent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 8%, transparent)"; }}
          >
            <CheckCircle2 size={10} />
            Done
          </button>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              updateTask(child.id, { status: "backlog" });
            }}
            title="Undo — move back to backlog"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              padding: "4px 8px",
              borderRadius: 4,
              border: "none",
              backgroundColor: "color-mix(in srgb, var(--foreground) 8%, transparent)",
              color: "var(--muted-foreground)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 500,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              flexShrink: 0,
              transition: "background 100ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 20%, transparent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 8%, transparent)"; }}
          >
            Undo
          </button>
        )}
      </button>
    </div>
  );
}

function OutputFileRow({ file, onFileClick }: { file: OutputFile; onFileClick: (file: OutputFile) => void }) {
  return (
    <button
      onClick={() => onFileClick(file)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 8,
        backgroundColor: "var(--muted)",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        transition: "background 150ms ease",
        marginBottom: 2,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--muted)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--muted)"; }}
    >
      <FileText size={16} style={{ color: "var(--primary)", flexShrink: 0 }} />
      <span
        style={{
          fontSize: 13,
          fontWeight: 500,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          color: "var(--foreground)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
        }}
      >
        {file.fileName}
      </span>
      <span
        style={{
          fontSize: 10,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          color: "var(--muted-foreground)",
          backgroundColor: "var(--card)",
          padding: "2px 8px",
          borderRadius: 4,
          flexShrink: 0,
        }}
      >
        .{file.extension}
      </span>
    </button>
  );
}

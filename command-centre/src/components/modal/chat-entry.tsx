"use client";

import { useState, useEffect, useMemo, useRef, isValidElement } from "react";
import {
  Check,
  Copy,
  FileText,
  FilePlus2,
  FileEdit,
  FolderOpen,
  Search,
  Terminal,
  Globe,
  Sparkles,
  Zap,
  ListChecks,
  MessageSquare,
  Pencil,
  User as UserIcon,
  Info,
  ChevronDown,
  ChevronRight,
  Wrench,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { LogEntry, PermissionMode, Task } from "@/types/task";
import { PERMISSION_MODE_LABELS } from "@/types/task";
import {
  parseQuestionSpecs,
  type QuestionSpec,
  type QuestionAnswers,
} from "@/types/question-spec";
import { QuestionModal } from "@/components/shared/question-modal";
import { ComposerEditorModal } from "@/components/shared/composer-editor-modal";
import { useTaskStore } from "@/store/task-store";
import type { BranchCreatedContext } from "@/lib/task-branch-ui";
import {
  hasWorkspaceDirectoryHint,
  resolveWorkspaceFileOutputPath,
  resolveWorkspaceFileReference,
} from "@/lib/workspace-file-reference";
import { parseStructuredBriefItems } from "./structured-brief-items";
import { isWorkspacePolicyDenialText } from "@/lib/task-permissions";

/* ─────────────────────────────── shared bits ─────────────────────────────── */

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function Timestamp({ iso }: { iso: string }) {
  return (
    <span
      data-chat-meta
      style={{
        fontSize: 10,
        fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
        color: "var(--cc-text-tertiary)",
        opacity: 0.8,
      }}
    >
      {formatTime(iso)}
    </span>
  );
}

function useHoverFocusVisibility() {
  const [isVisible, setIsVisible] = useState(false);

  return {
    isVisible,
    bind: {
      onMouseEnter: () => setIsVisible(true),
      onMouseLeave: () => setIsVisible(false),
      onFocusCapture: () => setIsVisible(true),
      onBlurCapture: (event: React.FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsVisible(false);
        }
      },
    },
  };
}

function extractNodeText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractNodeText).join("");
  if (isValidElement<{ children?: React.ReactNode }>(node)) {
    return extractNodeText(node.props.children);
  }
  return "";
}

function CopyActionButton({
  text,
  label,
  visible,
  style,
}: {
  text: string;
  label: string;
  visible: boolean;
  style?: React.CSSProperties;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeoutId = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [copied]);

  return (
    <button
      type="button"
      aria-label={copied ? `${label} copied` : label}
      title={copied ? "Copied" : label}
      onClick={async (event) => {
        event.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          // Ignore clipboard failures silently; the button state stays unchanged.
        }
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        border: "1px solid var(--cc-line-alpha-70)",
        borderRadius: 6,
        background: copied ? "var(--cc-status-success-bg)" : "var(--cc-surface-overlay)",
        color: copied ? "var(--cc-status-success)" : "var(--cc-brand-primary)",
        boxShadow: "0 1px 2px var(--cc-neutral-alpha-08)",
        cursor: "pointer",
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 120ms ease, color 120ms ease, background 120ms ease",
        ...style,
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

function CopyableCodeBlock({ children }: { children?: React.ReactNode }) {
  const copyVisibility = useHoverFocusVisibility();
  const codeText = useMemo(() => extractNodeText(children), [children]);
  const languageClassName = isValidElement<{ className?: string }>(children)
    ? children.props.className
    : undefined;
  const structuredItems = useMemo(
    () => parseStructuredBriefItems(codeText, languageClassName),
    [codeText, languageClassName],
  );

  return (
    <div
      style={{ position: "relative" }}
      {...copyVisibility.bind}
    >
      <CopyActionButton
        text={codeText}
        label="Copy code block"
        visible={copyVisibility.isVisible}
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          zIndex: 1,
        }}
      />
      {structuredItems ? (
        <div
          aria-label="Deliverables"
          style={{
            display: "grid",
            gap: 1,
            margin: "16px 0",
            padding: "6px 42px 6px 6px",
            border: "1px solid var(--cc-line-alpha-20)",
            borderRadius: 8,
            background: "var(--cc-surface-muted)",
          }}
        >
          {structuredItems.map((item, index) => (
            <div key={`${item.title}-${index}`} style={{ display: "grid", gridTemplateColumns: "20px minmax(0, 1fr)", gap: 8, padding: "9px 8px", borderRadius: 6, background: "var(--cc-surface)" }}>
              <span aria-hidden style={{ display: "grid", placeItems: "center", width: 18, height: 18, border: "1px solid var(--cc-line-alpha-40)", borderRadius: 5, color: "var(--cc-text-tertiary)", font: "600 9px/1 var(--cc-font-label)" }}>{index + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "var(--cc-text-primary)", font: "600 12.5px/1.35 var(--cc-font-body)" }}>{item.title}</div>
                {item.description ? <div style={{ marginTop: 3, color: "var(--cc-text-secondary)", font: "400 12px/1.5 var(--cc-font-body)" }}>{item.description}</div> : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <pre
          style={{
            backgroundColor: "var(--cc-neutral-alpha-04)",
            padding: 16,
            paddingRight: 46,
            borderRadius: 6,
            overflow: "auto",
            margin: "16px 0",
            fontSize: 13,
          }}
        >
          {children}
        </pre>
      )}
    </div>
  );
}

const markdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p style={{ margin: "12px 0" }}>{children}</p>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      style={{ color: "var(--cc-brand-primary)", textDecoration: "underline" }}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  code: ({
    children,
    className: cn,
  }: {
    children?: React.ReactNode;
    className?: string;
  }) =>
    cn ? (
      <code
        style={{
          fontFamily:
            "var(--font-space-grotesk), Space Grotesk, monospace",
          fontSize: 13,
        }}
      >
        {children}
      </code>
    ) : (
      <code
        style={{
          backgroundColor: "var(--cc-neutral-alpha-06)",
          padding: "1px 5px",
          borderRadius: 3,
          fontFamily:
            "var(--font-space-grotesk), Space Grotesk, monospace",
          fontSize: 13,
        }}
      >
        {children}
      </code>
    ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul style={{ paddingLeft: 20, margin: "10px 0" }}>{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol style={{ paddingLeft: 20, margin: "10px 0" }}>{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li style={{ margin: "4px 0" }}>{children}</li>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 style={{ fontSize: 20, fontWeight: 700, margin: "24px 0 10px" }}>
      {children}
    </h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 style={{ fontSize: 17, fontWeight: 700, margin: "20px 0 8px" }}>
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 style={{ fontSize: 15, fontWeight: 600, margin: "16px 0 6px" }}>
      {children}
    </h3>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote
      style={{
        borderLeft: "3px solid var(--cc-brand-primary)",
        padding: 14,
        margin: "14px 0",
        color: "var(--cc-text-secondary)",
        fontStyle: "italic",
      }}
    >
      {children}
    </blockquote>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        margin: "8px 0",
        fontSize: 13,
      }}
    >
      {children}
    </table>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th
      style={{
        padding: "4px 8px",
        textAlign: "left" as const,
        fontWeight: 600,
        borderBottom: "1px solid var(--cc-neutral-alpha-10)",
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td
      style={{
        padding: "4px 8px",
        borderBottom: "1px solid var(--cc-neutral-alpha-05)",
      }}
    >
      {children}
    </td>
  ),
  hr: () => (
    <hr
      style={{
        border: "none",
        borderTop: "1px solid var(--cc-line-alpha-30)",
        margin: "12px 0",
      }}
    />
  ),
};

/** Single compact row used for tool calls, system events, thinking, etc.
 *  Matches the Vibe Kanban style: small icon + one-line label, muted. */
function CompactRow({
  icon: Icon,
  label,
  detail,
  accent,
  rightSlot,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; color?: string; style?: React.CSSProperties }>;
  label: string;
  detail?: string | null;
  accent?: string;
  rightSlot?: React.ReactNode;
  onClick?: () => void;
}) {
  const color = accent ?? "var(--cc-text-secondary)";
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "4px 2px",
        fontSize: 13,
        fontFamily: "var(--font-inter), Inter, sans-serif",
        color: "var(--cc-text-primary)",
        cursor: onClick ? "pointer" : "default",
        lineHeight: 1.4,
      }}
    >
      <Icon size={14} color={color} style={{ flexShrink: 0 }} />
      <span style={{ color: "var(--cc-text-primary)" }}>{label}</span>
      {detail && (
        <span style={{ color: "var(--cc-text-tertiary)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {detail}
        </span>
      )}
      {rightSlot}
    </div>
  );
}

/* ─────────────────────────────── text group ─────────────────────────────── */

/**
 * Render a group of consecutive Claude text entries.
 * Vibe-Kanban style: plain prose, no bubble, no background — the assistant's
 * voice is the "default" voice of the stream. User messages are the only
 * thing that gets a box.
 */
export function TextGroup({
  entries,
  onPreviewFile,
  variant = "answer",
  presentation = "default",
}: {
  entries: LogEntry[];
  onPreviewFile?: (file: { relativePath: string; extension: string; fileName: string; directoryHint?: boolean }) => void;
  variant?: "answer" | "narration";
  presentation?: "default" | "feed";
}) {
  const feedPresentation = presentation === "feed";
  const copyVisibility = useHoverFocusVisibility();
  const messageCopyText = useMemo(
    () => entries.map((entry) => entry.content).filter(Boolean).join("\n\n"),
    [entries],
  );

  // Build markdown components with file-path-aware inline code
  const components = {
    ...markdownComponents,
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      const relativePath = onPreviewFile ? resolveWorkspaceFileReference(href) : null;
      if (!relativePath) return markdownComponents.a({ href, children });
      const fileName = relativePath.split("/").pop() || relativePath;
      const extension = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() ?? "" : "";
      const directoryHint = hasWorkspaceDirectoryHint(href);
      return (
        <a
          href={href}
          title={`Open ${relativePath} in ${directoryHint ? "Files panel" : "File viewer"}`}
          style={{ color: "var(--cc-brand-primary)", textDecoration: "underline" }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            onPreviewFile?.({ relativePath, extension, fileName, directoryHint });
          }}
        >
          {children}
        </a>
      );
    },
    pre: ({ children }: { children?: React.ReactNode }) => (
      <CopyableCodeBlock>{children}</CopyableCodeBlock>
    ),
    code: ({
      children,
      className: cn,
    }: {
      children?: React.ReactNode;
      className?: string;
    }) => {
      const text = typeof children === "string" ? children : String(children ?? "");
      const relativePath = !cn && onPreviewFile ? resolveWorkspaceFileReference(text) : null;
      if (relativePath) {
        const parts = relativePath.split("/");
        const fileName = parts[parts.length - 1];
        const dot = fileName.lastIndexOf(".");
        const ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
        const directoryHint = hasWorkspaceDirectoryHint(text);
        const destination = directoryHint ? "Files panel" : "File viewer";
        const openFile = () => onPreviewFile?.({ relativePath, extension: ext, fileName, directoryHint });
        return (
          <code
            role="button"
            tabIndex={0}
            aria-label={`Open ${fileName} in ${destination}`}
            title={`Open ${relativePath} in ${destination}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={openFile}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openFile();
              }
            }}
            style={{
              backgroundColor: "var(--cc-brand-alpha-06)",
              padding: "1px 5px",
              borderRadius: 3,
              fontFamily: "var(--font-space-grotesk), Space Grotesk, monospace",
              fontSize: 13,
              color: "var(--cc-brand-primary)",
              cursor: "pointer",
              textDecoration: "underline",
              textDecorationColor: "var(--cc-brand-alpha-30)",
              textUnderlineOffset: 2,
            }}
          >
            {children}
          </code>
        );
      }
      // Default inline code rendering
      return cn ? (
        <code style={{ fontFamily: "var(--font-space-grotesk), Space Grotesk, monospace", fontSize: 13 }}>
          {children}
        </code>
      ) : (
        <code style={{ backgroundColor: "var(--cc-neutral-alpha-06)", padding: "1px 5px", borderRadius: 3, fontFamily: "var(--font-space-grotesk), Space Grotesk, monospace", fontSize: 13 }}>
          {children}
        </code>
      );
    },
  };

  if (variant === "narration") {
    return (
      <div style={{ padding: "2px 0" }}>
        {entries.map((entry) => {
          const isActiveQuestion = entry.type === "question";
          return (
            <div
              key={entry.id}
              className="chat-markdown"
              style={{
                width: "100%",
                fontSize: 12,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                color: "var(--cc-palette-neutral-600)",
                lineHeight: 1.5,
                ...(isActiveQuestion ? { fontWeight: 600 } : {}),
              }}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {entry.content}
              </ReactMarkdown>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      data-feed-type="message"
      data-feed-chat-turn={feedPresentation ? "assistant" : undefined}
      data-chat-role="assistant"
      {...copyVisibility.bind}
      style={{
        width: "100%",
        maxWidth: 720,
        alignSelf: "flex-start",
      }}
    >
      {feedPresentation && entries[0] && (
        <div
          data-feed-chat-meta="assistant"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            marginBottom: 6,
            color: "var(--cc-text-tertiary)",
          }}
        >
          <span style={{ fontFamily: "var(--cc-font-label)", fontSize: 11.5, fontWeight: 600 }}>
            AI-OS
          </span>
          <Timestamp iso={entries[entries.length - 1].timestamp} />
        </div>
      )}
      <div
        data-feed-chat-bubble={feedPresentation ? "assistant" : undefined}
        style={{
          backgroundColor: feedPresentation ? "transparent" : "var(--cc-palette-neutral-100)",
          borderLeft: feedPresentation ? "none" : "3px solid var(--cc-line-alpha-50)",
          borderRadius: feedPresentation ? 0 : "0 6px 6px 0",
          padding: feedPresentation ? 0 : "14px 18px",
          textAlign: "left",
        }}
      >
        {entries.map((entry) => {
          const isActiveQuestion = entry.type === "question";
          return (
            <div
              key={entry.id}
              className="chat-markdown"
              style={{
                width: "100%",
                fontSize: 14,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                color: "var(--cc-text-primary)",
                lineHeight: 1.7,
                ...(isActiveQuestion ? { fontWeight: 600 } : {}),
              }}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {entry.content}
              </ReactMarkdown>
            </div>
          );
        })}
      </div>
      {messageCopyText && (
        <div
          data-feed-chat-actions={feedPresentation ? "assistant" : undefined}
          style={{
            display: "flex",
            justifyContent: "flex-start",
            marginTop: 6,
            paddingLeft: 2,
          }}
        >
          <CopyActionButton
            text={messageCopyText}
            label="Copy message"
            visible={copyVisibility.isVisible}
          />
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── file output ─────────────────────────────── */

/** True when the tool_use represents a file write or edit that we want to
 *  surface as its own inline card. */
export function isFileOutputEntry(entry: LogEntry): boolean {
  if (entry.type !== "tool_use") return false;
  const name = (entry.toolName || "").toLowerCase();
  return (
    name === "write" ||
    name === "edit" ||
    name === "multiedit" ||
    name === "notebookedit"
  );
}

/** True when the tool_use represents a skill invocation. */
export function isSkillEntry(entry: LogEntry): boolean {
  if (entry.type !== "tool_use") return false;
  return (entry.toolName || "").toLowerCase() === "skill";
}

/** Extract the skill name from a Skill tool_use entry. */
export function parseSkillName(entry: LogEntry): string | null {
  if (!entry.toolArgs) return null;
  try {
    const args = JSON.parse(entry.toolArgs) as Record<string, unknown>;
    if (typeof args.skill === "string") return args.skill;
  } catch { /* ignore */ }
  return null;
}

type FileOutputInfo = {
  absolutePath: string;
  relativePath: string;
  breadcrumb: string[];
  fileName: string;
  extension: string;
  op: "create" | "edit";
  linesAdded: number | null;
  linesChanged: number | null;
};

export function parseFileOutput(entry: LogEntry): FileOutputInfo | null {
  if (!entry.toolArgs) return null;
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(entry.toolArgs);
  } catch {
    return null;
  }

  const absolutePath =
    typeof args.file_path === "string"
      ? args.file_path
      : typeof args.path === "string"
      ? args.path
      : null;
  if (!absolutePath) return null;

  const relativePath = resolveWorkspaceFileOutputPath(absolutePath)
    ?? absolutePath.replace(/\\/g, "/");

  const parts = relativePath.split("/").filter(Boolean);
  const fileName = parts[parts.length - 1] || relativePath;
  const breadcrumb = parts.slice(0, -1);
  const extDot = fileName.lastIndexOf(".");
  const extension = extDot >= 0 ? fileName.slice(extDot + 1).toLowerCase() : "";

  const name = (entry.toolName || "").toLowerCase();
  const op: "create" | "edit" = name === "write" ? "create" : "edit";

  let linesAdded: number | null = null;
  let linesChanged: number | null = null;

  if (op === "create" && typeof args.content === "string") {
    linesAdded = args.content.split("\n").length;
  } else if (op === "edit") {
    if (typeof args.new_string === "string") {
      const newLines = args.new_string.split("\n").length;
      const oldLines =
        typeof args.old_string === "string"
          ? args.old_string.split("\n").length
          : 0;
      linesChanged = Math.max(newLines, oldLines);
      linesAdded = newLines - oldLines;
    } else if (Array.isArray(args.edits)) {
      let total = 0;
      for (const edit of args.edits as Array<{
        new_string?: string;
        old_string?: string;
      }>) {
        const n =
          typeof edit.new_string === "string"
            ? edit.new_string.split("\n").length
            : 0;
        const o =
          typeof edit.old_string === "string"
            ? edit.old_string.split("\n").length
            : 0;
        total += Math.max(n, o);
      }
      linesChanged = total;
    }
  }

  return {
    absolutePath,
    relativePath,
    breadcrumb,
    fileName,
    extension,
    op,
    linesAdded,
    linesChanged,
  };
}

export function FileOutputCard({
  entry,
  onPreview,
  isActive,
}: {
  entry: LogEntry;
  onPreview?: (info: { relativePath: string; extension: string }) => void;
  isActive?: boolean;
}) {
  const info = parseFileOutput(entry);
  if (!info) return null;
  const relativePath = resolveWorkspaceFileReference(info.relativePath);

  const Icon = info.op === "create" ? FilePlus2 : FileEdit;
  const accentColor = info.op === "create" ? "var(--cc-palette-success-medium)" : "var(--cc-brand-primary)";
  const lineBadge =
    info.op === "create" && info.linesAdded != null
      ? `+${info.linesAdded} lines`
      : info.linesAdded != null
      ? `${info.linesAdded >= 0 ? "+" : ""}${info.linesAdded} lines`
      : info.linesChanged != null
      ? `~${info.linesChanged} lines`
      : null;

  return (
    <div style={{ width: "100%" }}>
      <button
        onClick={() => relativePath && onPreview?.({ relativePath, extension: info.extension })}
        disabled={!relativePath || !onPreview}
        title={relativePath && onPreview ? `Open ${info.fileName} in File viewer` : `File is outside the available workspace`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "8px 12px",
          border: isActive
            ? `1px solid ${accentColor}`
            : "1px solid var(--cc-control-bg)",
          borderRadius: 6,
          background: "var(--cc-palette-neutral-100)",
          cursor: relativePath && onPreview ? "pointer" : "default",
          textAlign: "left",
          transition: "border-color 120ms ease, background 120ms ease",
        }}
      >
        <Icon size={14} color={accentColor} style={{ flexShrink: 0 }} />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            fontFamily:
              "var(--font-space-grotesk), Space Grotesk, monospace",
            color: "var(--cc-text-primary)",
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {info.fileName}
        </span>
        {lineBadge && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: accentColor,
              fontFamily:
                "var(--font-space-grotesk), Space Grotesk, monospace",
              flexShrink: 0,
            }}
          >
            {lineBadge}
          </span>
        )}
        {relativePath && onPreview ? <ChevronRight size={14} color="var(--cc-text-tertiary)" style={{ flexShrink: 0 }} /> : null}
      </button>
    </div>
  );
}

/* ─────────────────────────────── tool rows ─────────────────────────────── */

type ToolVisual = {
  Icon: React.ComponentType<{ size?: number; color?: string; style?: React.CSSProperties }>;
  label: string;
  color: string;
};

function toolVisual(name: string): ToolVisual {
  const n = name.toLowerCase();
  if (n === "read") return { Icon: FileText, label: "Read", color: "var(--cc-text-secondary)" };
  if (n === "glob") return { Icon: Search, label: "Search", color: "var(--cc-text-secondary)" };
  if (n === "grep") return { Icon: Search, label: "Search", color: "var(--cc-text-secondary)" };
  if (n === "ls") return { Icon: FolderOpen, label: "List", color: "var(--cc-text-secondary)" };
  if (n === "bash") return { Icon: Terminal, label: "Bash", color: "var(--cc-text-secondary)" };
  if (n === "webfetch") return { Icon: Globe, label: "Fetch", color: "var(--cc-text-secondary)" };
  if (n === "websearch") return { Icon: Globe, label: "Search", color: "var(--cc-text-secondary)" };
  if (n === "todowrite") return { Icon: ListChecks, label: "Updated Todos", color: "var(--cc-text-secondary)" };
  if (n === "task" || n === "agent") return { Icon: Sparkles, label: "Agent", color: "var(--cc-status-purple)" };
  if (n === "skill") return { Icon: Sparkles, label: "Skill", color: "var(--cc-status-purple)" };
  return { Icon: Wrench, label: name || "Tool", color: "var(--cc-text-secondary)" };
}

/** Extract a short human-readable detail from a tool_use entry (file path,
 *  command, pattern, etc.). Returns null when there's nothing useful. */
function toolDetail(entry: LogEntry): string | null {
  if (!entry.toolArgs) return null;
  try {
    const args = JSON.parse(entry.toolArgs) as Record<string, unknown>;
    const name = (entry.toolName || "").toLowerCase();

    if (name === "todowrite") {
      if (Array.isArray(args.todos)) return `${args.todos.length} items`;
      return null;
    }
    if (typeof args.file_path === "string") {
      const p = args.file_path.split("/").slice(-2).join("/");
      return p;
    }
    if (typeof args.path === "string") {
      const p = args.path.split("/").slice(-2).join("/");
      return p;
    }
    if (typeof args.pattern === "string") return args.pattern;
    if (typeof args.query === "string")
      return args.query.length > 60 ? args.query.slice(0, 60) + "…" : args.query;
    if (typeof args.url === "string") {
      try {
        return new URL(args.url).hostname.replace(/^www\./, "");
      } catch {
        return args.url;
      }
    }
    if (typeof args.skill === "string") return args.skill;
    if (typeof args.command === "string") {
      const cmd = args.command.trim();
      return cmd.length > 60 ? cmd.slice(0, 60) + "…" : cmd;
    }
    if (typeof args.description === "string") {
      const d = args.description.trim();
      return d.length > 60 ? d.slice(0, 60) + "…" : d;
    }
    if (typeof args.subagent_type === "string") return args.subagent_type;
    return null;
  } catch {
    return null;
  }
}

/** A compact single-line row for a tool_use entry (used inside expanded
 *  tool summary blocks — intentionally small/muted). */
function ToolRow({ entry }: { entry: LogEntry }) {
  const visual = toolVisual(entry.toolName || "");
  const detail = toolDetail(entry);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "2px 0",
        fontSize: 11,
        fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
        color: "var(--cc-text-muted)",
        lineHeight: 1.3,
      }}
    >
      <visual.Icon size={11} color="var(--cc-palette-neutral-450)" style={{ flexShrink: 0 }} />
      <span>{visual.label}</span>
      {detail && (
        <span style={{ color: "var(--cc-palette-neutral-450)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          · {detail}
        </span>
      )}
    </div>
  );
}

/** Renders a skill invocation as a distinct accent card. */
export function SkillInvocationCard({ entry }: { entry: LogEntry }) {
  const skillName = parseSkillName(entry) ?? "Unknown skill";
  // Format skill name: "meta-wrap-up" → "Meta Wrap Up"
  const displayName = skillName
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderLeft: "3px solid var(--cc-status-purple-bright)",
          backgroundColor: "var(--cc-status-purple-bg)",
          borderRadius: "0 6px 6px 0",
        }}
      >
        <Zap size={13} color="var(--cc-status-purple-bright)" style={{ flexShrink: 0 }} />
        <span
          style={{
            fontSize: 12,
            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
            fontWeight: 600,
            color: "var(--cc-status-purple-bright)",
          }}
        >
          Skill invoked
        </span>
        <span
          style={{
            fontSize: 12,
            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
            fontWeight: 500,
            color: "var(--cc-status-purple)",
          }}
        >
          {displayName}
        </span>
      </div>
    </div>
  );
}

/** Renders a group of consecutive tool_use / tool_result entries as a
 *  collapsible summary. Collapsed by default — shows "Used N tools" with
 *  a short preview of tool names. Expand to see the full list. */
export function ToolSummaryBlock({ entries }: { entries: LogEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const rows = entries.filter(
    (e) => e.type === "tool_use" && !isFileOutputEntry(e),
  );
  if (rows.length === 0) return null;

  // Build a compact summary: "Read, Search, Bash" (deduplicated)
  const toolNames: string[] = [];
  const seen = new Set<string>();
  for (const entry of rows) {
    const v = toolVisual(entry.toolName || "");
    if (!seen.has(v.label)) {
      seen.add(v.label);
      toolNames.push(v.label);
    }
  }
  const summary = toolNames.length <= 4
    ? toolNames.join(", ")
    : toolNames.slice(0, 3).join(", ") + ` +${toolNames.length - 3} more`;

  return (
    <div style={{ width: "100%" }}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "2px 2px",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: 11,
          fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
          color: "var(--cc-text-muted)",
          fontWeight: 500,
          lineHeight: 1.4,
        }}
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <Wrench size={10} style={{ flexShrink: 0 }} />
        <span>
          Used {rows.length} tool{rows.length === 1 ? "" : "s"}
        </span>
        {!expanded && (
          <span style={{ color: "var(--cc-palette-neutral-450)" }}>
            {summary}
          </span>
        )}
      </button>
      {expanded && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 1,
            paddingLeft: 18,
            marginTop: 2,
          }}
        >
          {rows.map((entry) => (
            <ToolRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── questions ─────────────────────────────── */

function QuestionEntry({ entry }: { entry: LogEntry }) {
  return (
    <div style={{ width: "100%" }}>
      <div
        className="chat-markdown"
        style={{
          borderLeft: "3px solid var(--cc-brand-primary)",
          backgroundColor: "var(--cc-surface)5F3",
          padding: "12px 16px",
          borderRadius: "0 0.5rem 0.5rem 0",
          fontSize: 13,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          color: "var(--cc-text-primary)",
          lineHeight: 1.6,
        }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {entry.content}
        </ReactMarkdown>
      </div>
      <Timestamp iso={entry.timestamp} />
    </div>
  );
}

function StructuredQuestionEntry({
  entry,
  taskId,
  readOnly,
}: {
  entry: LogEntry;
  taskId?: string;
  readOnly?: boolean;
}) {
  const [submitted, setSubmitted] = useState(false);

  const specs = useMemo(() => {
    try {
      if (entry.questionSpec) {
        return parseQuestionSpecs(JSON.parse(entry.questionSpec));
      }
    } catch {
      /* ignore */
    }
    return [] as QuestionSpec[];
  }, [entry.questionSpec]);

  const answered = entry.questionAnswers != null || submitted;

  // Once answered (either from DB or just submitted), hide the entire block
  if (specs.length === 0 || answered) return null;

  const count = specs.length;

  const handleSubmit = async (formAnswers: QuestionAnswers) => {
    if (!taskId) return;
    try {
      await fetch(`/api/tasks/${taskId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ structuredAnswers: formAnswers }),
      });
      setSubmitted(true);
    } catch {
      /* allow retry */
    }
  };

  const summary = `${count} question${count === 1 ? "" : "s"} — waiting for your reply`;

  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          borderLeft: "3px solid var(--cc-brand-primary)",
          backgroundColor: "var(--cc-surface)5F3",
          padding: "10px 14px",
          borderRadius: "0 0.5rem 0.5rem 0",
          fontFamily: "var(--font-inter), Inter, sans-serif",
          color: "var(--cc-text-primary)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            fontWeight: 600,
            color: "var(--cc-brand-primary)",
            fontFamily:
              "var(--font-space-grotesk), Space Grotesk, sans-serif",
            marginBottom: 12,
          }}
        >
          <ChevronDown size={14} />
          {summary}
        </div>

        {/* Interactive form */}
        {taskId && (
          <QuestionModal
            questions={specs}
            variant="inline"
            hideFooter={false}
            submitLabel="Reply"
            onSubmit={handleSubmit}
          />
        )}
      </div>
      <Timestamp iso={entry.timestamp} />
    </div>
  );
}

/* ─────────────────────────────── user reply ─────────────────────────────── */

/** Vibe-Kanban-style user message: full-width bordered card, header with
 *  a person icon + "You" label, content below in a clean block. */
/** Strip injected context blocks (brand context, user context, system prompts) from user messages */
function stripInjectedContext(text: string): string {
  let cleaned = text;
  // Remove brand/user context blocks: --- BRAND & USER CONTEXT --- ... --- END CONTEXT ---
  cleaned = cleaned.replace(/\n*--- BRAND & USER CONTEXT ---[\s\S]*?--- END CONTEXT ---\n*/g, "");
  // Remove session activity summary prefix injected for wrap-up tasks
  cleaned = cleaned.replace(/^IMPORTANT: The following session activity summary[\s\S]*?Now proceed with the task:\n*/m, "");
  // Remove structured question addendum
  cleaned = cleaned.replace(/\n*---\nWhen you need clarification from the user[\s\S]*$/m, "");
  // Remove project scoping system prompt prefix
  cleaned = cleaned.replace(/^You are scoping a Level \d+ (?:planned |GSD )?project[\s\S]*?(?:CRITICAL:.*\n)*/m, "");
  // Remove GSD project prompt prefix
  cleaned = cleaned.replace(/^Run \/gsd-new-project[\s\S]*$/m, "");
  // Remove any remaining brand context blocks that weren't in the standard wrapper
  cleaned = cleaned.replace(/\n*--- (?:BRAND|USER) (?:&|AND) [\s\S]*?---\n*/gi, "");
  return cleaned.trim();
}

function UserReplyEntry({
  entry,
  permissionMode,
  taskId,
  readOnly,
  onBranchCreated,
  presentation = "default",
}: {
  entry: LogEntry;
  permissionMode?: PermissionMode;
  taskId?: string;
  readOnly?: boolean;
  onBranchCreated?: (task: Task, context: BranchCreatedContext) => void;
  presentation?: "default" | "feed";
}) {
  const feedPresentation = presentation === "feed";
  const [collapsed, setCollapsed] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [isBranching, setIsBranching] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const copyVisibility = useHoverFocusVisibility();
  const branchTask = useTaskStore((s) => s.branchTask);
  const displayContent = stripInjectedContext(entry.content);
  const canBranch = Boolean(taskId && !readOnly);
  // Prefer the permission mode stored on the log entry (snapshot at send time)
  // over the task-level mode (which reflects the latest value)
  const effectiveMode = (entry.permissionMode as PermissionMode) || permissionMode;

  const openEdit = () => {
    setEditedContent(displayContent);
    setBranchError(null);
    setIsEditing(true);
  };

  const handleCreateBranch = async () => {
    if (!taskId || isBranching) return;
    const trimmed = editedContent.trim();
    if (!trimmed) {
      setBranchError("Message cannot be empty.");
      return;
    }

    setIsBranching(true);
    setBranchError(null);
    const branch = await branchTask(taskId, entry.id, trimmed);
    setIsBranching(false);

    if (!branch) {
      const storeError = useTaskStore.getState().error?.trim();
      setBranchError(storeError || "Could not send the edited message.");
      return;
    }

    setIsEditing(false);
    onBranchCreated?.(branch, { sourceTaskId: taskId });
  };

  return (
    <div
      data-feed-chat-turn={feedPresentation ? "user" : undefined}
      data-chat-role="user"
      {...copyVisibility.bind}
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: feedPresentation ? "flex-end" : "stretch",
      }}
    >
      <div
        data-feed-chat-bubble={feedPresentation ? "user" : undefined}
        style={{
          width: feedPresentation ? "fit-content" : "100%",
          maxWidth: feedPresentation ? "min(85%, 560px)" : undefined,
          border: feedPresentation ? "none" : "1px solid var(--cc-control-bg)",
          borderRadius: feedPresentation ? "16px 16px 4px 16px" : 8,
          backgroundColor: feedPresentation ? "var(--cc-chat-user-bubble)" : "var(--cc-surface)",
          padding: feedPresentation ? "9px 13px 10px" : "10px 14px 12px",
          textAlign: "left",
          overflowWrap: "anywhere",
        }}
      >
        {/* Header: icon + You label + permission mode + (collapse) */}
        <div
          data-feed-chat-meta={feedPresentation ? "user" : undefined}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: collapsed ? 0 : 6,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <UserIcon size={14} color="var(--cc-text-secondary)" />
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                fontFamily:
                  "var(--font-space-grotesk), Space Grotesk, sans-serif",
                color: "var(--cc-text-primary)",
              }}
            >
              You
            </span>
            {effectiveMode && (
              <span
                style={{
                  fontSize: 10,
                  fontFamily: "'DM Mono', monospace",
                  fontWeight: 500,
                  color:
                    effectiveMode === "bypassPermissions"
                      ? "var(--cc-status-warning-strong)"
                      : "var(--cc-text-secondary)",
                  background:
                    effectiveMode === "bypassPermissions"
                      ? "var(--cc-status-warning-bg)"
                      : "var(--cc-neutral-alpha-05)",
                  padding: "2px 6px",
                  borderRadius: 3,
                }}
              >
                {PERMISSION_MODE_LABELS[effectiveMode]?.toLowerCase() ?? effectiveMode} mode
              </span>
            )}
            <Timestamp iso={entry.timestamp} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              title={collapsed ? "Expand" : "Collapse"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 22,
                height: 22,
                border: "none",
                borderRadius: 4,
                background: "transparent",
                color: "var(--cc-text-tertiary)",
                cursor: "pointer",
              }}
            >
              {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>
        {!collapsed && (
          <div
            style={{
              fontSize: 13,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              color: "var(--cc-text-primary)",
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              textAlign: "left",
              overflowWrap: "anywhere",
            }}
          >
            {displayContent}
          </div>
        )}
      </div>
      {displayContent && (
        <div
          data-feed-chat-actions={feedPresentation ? "user" : undefined}
          style={{
            display: "flex",
            gap: 4,
            justifyContent: feedPresentation ? "flex-end" : "flex-start",
            marginTop: 6,
            paddingLeft: feedPresentation ? 0 : 2,
            paddingRight: feedPresentation ? 2 : 0,
          }}
        >
          <CopyActionButton
            text={displayContent}
            label="Copy message"
            visible={copyVisibility.isVisible}
          />
          {canBranch && (
            <button
              type="button"
              aria-label="Edit message"
              title="Edit message"
              onClick={(event) => {
                event.stopPropagation();
                openEdit();
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 24,
                height: 24,
                border: "1px solid var(--cc-line-alpha-70)",
                borderRadius: 6,
                background: "var(--cc-surface-overlay)",
                color: "var(--cc-brand-primary)",
                boxShadow: "0 1px 2px var(--cc-neutral-alpha-08)",
                cursor: "pointer",
                opacity: copyVisibility.isVisible ? 1 : 0,
                pointerEvents: copyVisibility.isVisible ? "auto" : "none",
                transition: "opacity 120ms ease, color 120ms ease, background 120ms ease",
              }}
            >
              <Pencil size={12} />
            </button>
          )}
        </div>
      )}
      {isEditing && (
        <ComposerEditorModal
          title="Edit message"
          initialExpanded={false}
          closeLabel="Cancel"
          submitLabel="Send"
          submittingLabel="Sending..."
          submitting={isBranching}
          submitDisabled={editedContent.trim().length === 0}
          onClose={() => setIsEditing(false)}
          onSubmit={() => { void handleCreateBranch(); }}
          error={branchError}
          editor={(
            <textarea
              value={editedContent}
              onChange={(event) => setEditedContent(event.target.value)}
              autoFocus
              disabled={isBranching}
              style={{
                width: "100%",
                height: "100%",
                resize: "none",
                border: 0,
                background: "transparent",
                color: "var(--cc-text-primary)",
                fontSize: 13,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                lineHeight: 1.55,
                padding: "12px 56px 12px 12px",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          )}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────── system ─────────────────────────────── */

type ContextNoticeSource = {
  type?: string;
  label: string;
  path?: string;
  status?: "loaded" | "available";
  title?: string | null;
  size?: number;
};

function parseContextSources(value?: string | null): ContextNoticeSource[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): ContextNoticeSource[] => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      if (typeof record.label !== "string" || record.label.trim() === "") return [];
      return [{
        type: typeof record.type === "string" ? record.type : undefined,
        label: record.label,
        path: typeof record.path === "string" ? record.path : undefined,
        status: record.status === "available" ? "available" : "loaded",
        title: typeof record.title === "string" ? record.title : null,
        size: typeof record.size === "number" ? record.size : undefined,
      }];
    });
  } catch {
    return [];
  }
}

function parseLegacyContextSources(content: string): ContextNoticeSource[] {
  const sources: ContextNoticeSource[] = [];
  for (const line of content.split(/\r?\n/)) {
    const loaded = line.match(/^Context loaded:\s*(.+)$/);
    const value = loaded?.[1] ?? "";
    if (!loaded || !value.trim()) continue;
    for (const rawLabel of value.split(",").map((part) => part.trim()).filter(Boolean)) {
      sources.push({ label: rawLabel, status: "loaded" });
    }
  }
  return sources;
}

function parseLoadedContextReadyCount(content: string): number | null {
  const loadedOnly = content.match(/^Context ready:\s*(\d+)\s+files?\s+loaded\.?$/);
  if (loadedOnly) return Number(loadedOnly[1]);
  const previousCompact = content.match(/^Context ready:\s*(\d+)\s+loaded,\s*\d+\s+available\.?$/);
  return previousCompact ? Number(previousCompact[1]) : null;
}

function isContextNotice(content: string): boolean {
  return parseLoadedContextReadyCount(content) !== null ||
    /^Context loaded:/m.test(content) ||
    /^Context available:/m.test(content);
}

function formatLoadedContextCount(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"} loaded`;
}

function contextSourceGroupTitle(source: ContextNoticeSource): string {
  const label = source.label.toLowerCase();
  const sourcePath = (source.path ?? source.label).toLowerCase();
  const isInstructionFile = ["agents.md", "claude.md"].some(
    (fileName) => sourcePath === fileName || sourcePath.endsWith(`/${fileName}`),
  );
  const isSoulFile = sourcePath === "context/soul.md" || sourcePath.endsWith("/context/soul.md");
  if (label.startsWith("system base:") || isInstructionFile || isSoulFile) {
    return "SYSTEM BASE";
  }
  if (label.startsWith("brand/team:") || label.startsWith("client brand:") || sourcePath.includes("brand_context/")) {
    return "BRAND";
  }
  if (label.startsWith("team:") || sourcePath.startsWith("team_context/")) {
    return "TEAM";
  }
  if (
    label.startsWith("private user:") ||
    sourcePath === "user.md" ||
    sourcePath === "memory.md" ||
    sourcePath.startsWith("context/") ||
    sourcePath.includes("/context/")
  ) {
    return "USER";
  }
  if (source.type === "project" || sourcePath.startsWith("projects/")) {
    return "PROJECT";
  }
  return "OTHER";
}

function displayContextSourceLabel(source: ContextNoticeSource): string {
  const prefixMatch = source.label.match(/^(System base|Brand\/team|Client brand|Team|Private user|Client):\s*(.+)$/i);
  return prefixMatch?.[2] ?? source.path ?? source.label;
}

function groupLoadedContextSources(sources: ContextNoticeSource[]): Array<{ title: string; sources: ContextNoticeSource[] }> {
  const order = ["SYSTEM BASE", "BRAND", "TEAM", "USER", "PROJECT", "OTHER"];
  const groups = new Map<string, ContextNoticeSource[]>();
  for (const source of sources) {
    const title = contextSourceGroupTitle(source);
    groups.set(title, [...(groups.get(title) ?? []), source]);
  }
  return order
    .filter((title) => groups.has(title))
    .map((title) => ({ title, sources: groups.get(title) ?? [] }));
}

function ContextSourceGroup({ title, sources }: { title: string; sources: ContextNoticeSource[] }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--cc-text-tertiary)",
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      <ul
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 3,
          margin: 0,
          paddingLeft: 14,
        }}
      >
        {sources.map((source, index) => (
          <li
            key={`${title}:${source.path ?? source.label}:${index}`}
            style={{
              color: "var(--cc-text-secondary)",
              fontFamily: "'JetBrains Mono', 'DM Mono', monospace",
              fontSize: 10,
              lineHeight: 1.35,
              wordBreak: "break-word",
            }}
          >
            {displayContextSourceLabel(source)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ContextNoticeEntry({
  entry,
  contextSources,
}: {
  entry: LogEntry;
  contextSources?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const sources = useMemo(() => {
    const fromTask = parseContextSources(contextSources);
    return fromTask.length > 0 ? fromTask : parseLegacyContextSources(entry.content);
  }, [contextSources, entry.content]);
  const loaded = sources.filter((source) => source.status !== "available");
  const loadedCount = loaded.length > 0 ? loaded.length : parseLoadedContextReadyCount(entry.content) ?? 0;
  const groups = groupLoadedContextSources(loaded);
  const hasDetails = groups.length > 0;
  if (loadedCount === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "6px 8px",
        border: "1px solid var(--cc-line-alpha-20)",
        borderRadius: 8,
        background: "var(--cc-canvas-subtle)",
        fontSize: 11,
        fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
        color: "var(--cc-text-muted)",
        lineHeight: 1.4,
      }}
    >
      <Info size={12} color="var(--cc-palette-neutral-450)" style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span style={{ color: "var(--cc-text-secondary)", wordBreak: "break-word" }}>
            Context ready: {formatLoadedContextCount(loadedCount)}
          </span>
          {hasDetails && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                border: "1px solid var(--cc-line-alpha-20)",
                borderRadius: 6,
                background: "var(--cc-surface)",
                color: "var(--cc-text-secondary)",
                cursor: "pointer",
                flexShrink: 0,
                fontSize: 10,
                fontWeight: 600,
                padding: "2px 6px",
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
              }}
            >
              {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              {expanded ? "Hide" : "Details"}
            </button>
          )}
        </div>
        {expanded && hasDetails && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              marginTop: 8,
              maxHeight: 260,
              overflowY: "auto",
            }}
          >
            {groups.map((group) => (
              <ContextSourceGroup key={group.title} title={group.title} sources={group.sources} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SystemEntry({
  entry,
  contextSources,
}: {
  entry: LogEntry;
  contextSources?: string | null;
}) {
  if (isContextNotice(entry.content)) {
    return <ContextNoticeEntry entry={entry} contextSources={contextSources} />;
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "2px 2px",
        fontSize: 11,
        fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
        color: "var(--cc-text-muted)",
        lineHeight: 1.4,
      }}
    >
      <Info size={11} color="var(--cc-palette-neutral-450)" style={{ flexShrink: 0 }} />
      <span>{entry.content}</span>
    </div>
  );
}

function WorkspacePolicyBlockedEntry({ entry }: { entry: LogEntry }) {
  const detail = entry.toolResult || entry.content;
  return (
    <div
      role="status"
      style={{
        width: "100%",
        border: "1px solid var(--cc-line-alpha-35)",
        borderRadius: 8,
        background: "var(--cc-surface)",
        padding: "10px 12px",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--cc-text-primary)" }}>
        Blocked by workspace policy
      </div>
      <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.5, color: "var(--cc-text-secondary)" }}>
        This action is blocked by the workspace rules and cannot be approved from this subchat.
      </div>
      {detail && (
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--cc-text-muted)", wordBreak: "break-word" }}>
          {detail}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── dispatch ─────────────────────────────── */

/** Single entry renderer — used for non-grouped entries. */
export function ChatEntry({
  entry,
  permissionMode,
  taskId,
  readOnly,
  contextSources,
  onPreviewFile,
  onBranchCreated,
  presentation = "default",
}: {
  entry: LogEntry;
  permissionMode?: PermissionMode;
  taskId?: string;
  readOnly?: boolean;
  contextSources?: string | null;
  onPreviewFile?: (file: { relativePath: string; extension: string; fileName: string; directoryHint?: boolean }) => void;
  onBranchCreated?: (task: Task, context: BranchCreatedContext) => void;
  presentation?: "default" | "feed";
}) {
  switch (entry.type) {
    case "text":
      return <TextGroup entries={[entry]} onPreviewFile={onPreviewFile} presentation={presentation} />;
    case "tool_use":
      // Handled by ToolSummaryBlock in grouped rendering
      return null;
    case "tool_result":
      return isWorkspacePolicyDenialText(entry.toolResult || entry.content)
        ? <WorkspacePolicyBlockedEntry entry={entry} />
        : null;
    case "question":
      // Prose-detected questions render as normal text — they're usually
      // rhetorical (Claude kept going). Only structured_question gets
      // interactive treatment.
      return <TextGroup entries={[entry]} onPreviewFile={onPreviewFile} presentation={presentation} />;
    case "structured_question":
      return <StructuredQuestionEntry entry={entry} taskId={taskId} readOnly={readOnly} />;
    case "user_reply":
      return (
        <UserReplyEntry
          entry={entry}
          permissionMode={permissionMode}
          taskId={taskId}
          readOnly={readOnly}
          onBranchCreated={onBranchCreated}
          presentation={presentation}
        />
      );
    case "system":
      return <SystemEntry entry={entry} contextSources={contextSources} />;
    default:
      return null;
  }
}

/** Small helper used by MessageSquare icon imports (avoid unused warning). */
export const _thinkingIcon = MessageSquare;

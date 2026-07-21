"use client";

import { useState, useEffect, useMemo, isValidElement } from "react";
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
  User as UserIcon,
  Info,
  ChevronDown,
  ChevronRight,
  Wrench,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { LogEntry, PermissionMode } from "@/types/task";
import { PERMISSION_MODE_LABELS } from "@/types/task";
import {
  parseQuestionSpecs,
  serializeAnswersToProse,
  type QuestionSpec,
  type QuestionAnswers,
} from "@/types/question-spec";
import { QuestionModal } from "@/components/shared/question-modal";

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
      style={{
        fontSize: 10,
        fontFamily: "var(--font-inter), Inter, sans-serif",
        color: "var(--muted-foreground)",
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
        border: "1px solid color-mix(in srgb, var(--foreground) 70%, transparent)",
        borderRadius: 6,
        background: copied ? "color-mix(in srgb, var(--foreground) 12%, transparent)" : "color-mix(in srgb, var(--card) 95%, transparent)",
        color: copied ? "var(--muted-foreground)" : "var(--primary)",
        boxShadow: "0 1px 2px color-mix(in srgb, var(--foreground) 8%, transparent)",
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
      <pre
        style={{
          backgroundColor: "color-mix(in srgb, var(--foreground) 4%, transparent)",
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
      style={{ color: "var(--primary)", textDecoration: "underline" }}
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
            "var(--font-inter), Inter, monospace",
          fontSize: 13,
        }}
      >
        {children}
      </code>
    ) : (
      <code
        style={{
          backgroundColor: "color-mix(in srgb, var(--foreground) 6%, transparent)",
          padding: "1px 5px",
          borderRadius: 3,
          fontFamily:
            "var(--font-inter), Inter, monospace",
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
        borderLeft: "3px solid var(--primary)",
        padding: 14,
        margin: "14px 0",
        color: "var(--muted-foreground)",
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
        borderBottom: "1px solid color-mix(in srgb, var(--foreground) 10%, transparent)",
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td
      style={{
        padding: "4px 8px",
        borderBottom: "1px solid color-mix(in srgb, var(--foreground) 5%, transparent)",
      }}
    >
      {children}
    </td>
  ),
  hr: () => (
    <hr
      style={{
        border: "none",
        borderTop: "1px solid color-mix(in srgb, var(--foreground) 30%, transparent)",
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
  const color = accent ?? "var(--muted-foreground)";
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
        color: "var(--foreground)",
        cursor: onClick ? "pointer" : "default",
        lineHeight: 1.4,
      }}
    >
      <Icon size={14} color={color} style={{ flexShrink: 0 }} />
      <span style={{ color: "var(--foreground)" }}>{label}</span>
      {detail && (
        <span style={{ color: "var(--muted-foreground)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
/** Detect whether an inline code string looks like a file path. */
const FILE_PATH_RE = /^[.\w/ -]+\.\w{1,15}$/;
const SKIP_CODE_EXTS = new Set([
  "com", "org", "net", "io", "dev", "app",  // domains, not files
]);

function looksLikeFilePath(text: string): boolean {
  if (!FILE_PATH_RE.test(text)) return false;
  // Must contain at least one slash (directory separator)
  if (!text.includes("/")) return false;
  const dot = text.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = text.slice(dot + 1).toLowerCase();
  return !SKIP_CODE_EXTS.has(ext);
}

export function TextGroup({
  entries,
  onPreviewFile,
  variant = "answer",
}: {
  entries: LogEntry[];
  onPreviewFile?: (file: { relativePath: string; extension: string; fileName: string }) => void;
  variant?: "answer" | "narration";
}) {
  const [previewingPath, setPreviewingPath] = useState<{ relativePath: string; extension: string } | null>(null);
  const copyVisibility = useHoverFocusVisibility();
  const messageCopyText = useMemo(
    () => entries.map((entry) => entry.content).filter(Boolean).join("\n\n"),
    [entries],
  );

  // Build markdown components with file-path-aware inline code
  const components = {
    ...markdownComponents,
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
      // Inline code (not inside a pre/code block) that looks like a file path
      if (!cn && looksLikeFilePath(text)) {
        const parts = text.split("/");
        const fileName = parts[parts.length - 1];
        const dot = fileName.lastIndexOf(".");
        const ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
        const isActive = previewingPath?.relativePath === text;
        return (
          <code
            onClick={() => {
              if (isActive) {
                setPreviewingPath(null);
              } else {
                setPreviewingPath({ relativePath: text, extension: ext });
              }
            }}
            style={{
              backgroundColor: isActive ? "color-mix(in srgb, var(--foreground) 12%, transparent)" : "color-mix(in srgb, var(--foreground) 6%, transparent)",
              padding: "1px 5px",
              borderRadius: 3,
              fontFamily: "var(--font-inter), Inter, monospace",
              fontSize: 13,
              color: "var(--primary)",
              cursor: "pointer",
              textDecoration: "underline",
              textDecorationColor: "color-mix(in srgb, var(--foreground) 30%, transparent)",
              textUnderlineOffset: 2,
            }}
          >
            {children}
          </code>
        );
      }
      // Default inline code rendering
      return cn ? (
        <code style={{ fontFamily: "var(--font-inter), Inter, monospace", fontSize: 13 }}>
          {children}
        </code>
      ) : (
        <code style={{ backgroundColor: "color-mix(in srgb, var(--foreground) 6%, transparent)", padding: "1px 5px", borderRadius: 3, fontFamily: "var(--font-inter), Inter, monospace", fontSize: 13 }}>
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
                color: "var(--muted-foreground)",
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
      {...copyVisibility.bind}
      style={{
        maxWidth: 720,
      }}
    >
      <div
        style={{
          backgroundColor: "var(--card)",
          borderLeft: "3px solid color-mix(in srgb, var(--foreground) 50%, transparent)",
          borderRadius: "0 6px 6px 0",
          padding: "16px 20px",
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
                color: "var(--foreground)",
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
        {previewingPath && (
          <div style={{ width: "100%", marginTop: 4, marginBottom: 4 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 10px",
                background: "var(--muted)",
                border: "1px solid var(--primary)",
                borderBottom: "none",
                borderRadius: "6px 6px 0 0",
                fontSize: 11,
                fontFamily: "var(--font-inter), Inter, monospace",
                color: "var(--primary)",
                fontWeight: 500,
              }}
            >
              <span>{previewingPath.relativePath.split("/").pop()}</span>
              <button
                onClick={() => setPreviewingPath(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)", padding: 0, display: "flex" }}
              >
                <ChevronDown size={12} />
              </button>
            </div>
            <InlinePreviewPanel
              relativePath={previewingPath.relativePath}
              extension={previewingPath.extension}
              accentColor="var(--primary)"
              borderRadius="0 0 6px 6px"
            />
          </div>
        )}
      </div>
      {messageCopyText && (
        <div
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

  const rootMarker = "/AI-OS/";
  const idx = absolutePath.indexOf(rootMarker);
  const relativePath =
    idx >= 0 ? absolutePath.slice(idx + rootMarker.length) : absolutePath;

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

const PREVIEWABLE_EXTS = new Set(["md", "txt", "csv", "json", "html", "htm", "log", "xml", "yaml", "yml", "toml", "excalidraw"]);
const HTML_EXTS = new Set(["html", "htm"]);

/** Shared inline preview panel used by FileOutputCard and TextGroup. */
function InlinePreviewPanel({
  relativePath,
  extension,
  accentColor,
  borderRadius,
}: {
  relativePath: string;
  extension: string;
  accentColor: string;
  borderRadius?: string;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const isHtml = HTML_EXTS.has(extension);

  useEffect(() => {
    if (isHtml) { setLoading(false); return; }
    fetch(`/api/files/preview?path=${encodeURIComponent(relativePath)}`)
      .then(async (r) => {
        if (!r.ok) { setContent(null); return; }
        const ct = r.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const j = await r.json();
          setContent(j.content ?? null);
        } else {
          setContent(await r.text());
        }
      })
      .catch(() => setContent(null))
      .finally(() => setLoading(false));
  }, [relativePath, isHtml]);

  return (
    <div
      style={{
        border: `1px solid ${accentColor}`,
        borderTop: "none",
        borderRadius: borderRadius ?? "0 0 6px 6px",
        background: "var(--card)",
        maxHeight: isHtml ? 500 : 300,
        overflowY: isHtml ? "hidden" : "auto",
        padding: isHtml ? 0 : 12,
        fontSize: 12,
        fontFamily: extension === "md" ? "var(--font-inter), Inter, sans-serif" : "var(--font-inter), Inter, monospace",
        lineHeight: 1.6,
        color: "var(--foreground)",
      }}
    >
      {loading ? (
        <span style={{ color: "var(--muted-foreground)", fontSize: 11, padding: isHtml ? 12 : 0 }}>Loading…</span>
      ) : isHtml ? (
        <iframe
          src={`/api/files/preview?path=${encodeURIComponent(relativePath)}`}
          title={relativePath}
          sandbox="allow-scripts allow-same-origin"
          style={{
            width: "100%",
            height: 500,
            border: "none",
            borderRadius: borderRadius ?? "0 0 6px 6px",
            display: "block",
          }}
        />
      ) : content != null ? (
        extension === "md" ? (
          <div className="chat-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {content}
            </ReactMarkdown>
          </div>
        ) : (
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{content}</pre>
        )
      ) : (
        <span style={{ color: "var(--muted-foreground)", fontSize: 11 }}>Unable to load preview</span>
      )}
    </div>
  );
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
  const [expanded, setExpanded] = useState(false);

  const info = parseFileOutput(entry);
  if (!info) return null;

  const Icon = info.op === "create" ? FilePlus2 : FileEdit;
  const accentColor = info.op === "create" ? "var(--border)" : "var(--primary)";
  const lineBadge =
    info.op === "create" && info.linesAdded != null
      ? `+${info.linesAdded} lines`
      : info.linesAdded != null
      ? `${info.linesAdded >= 0 ? "+" : ""}${info.linesAdded} lines`
      : info.linesChanged != null
      ? `~${info.linesChanged} lines`
      : null;

  const previewable = PREVIEWABLE_EXTS.has(info.extension);

  return (
    <div style={{ width: "100%" }}>
      <button
        onClick={() => {
          if (previewable) setExpanded((e) => !e);
        }}
        disabled={!previewable}
        title={
          previewable
            ? `Preview ${info.fileName}`
            : `Preview not available for .${info.extension || "?"} files`
        }
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "8px 12px",
          border: expanded || isActive
            ? `1px solid ${accentColor}`
            : "1px solid var(--border)",
          borderRadius: expanded ? "6px 6px 0 0" : 6,
          background: "var(--card)",
          cursor: previewable ? "pointer" : "default",
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
              "var(--font-inter), Inter, monospace",
            color: "var(--foreground)",
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
                "var(--font-inter), Inter, monospace",
              flexShrink: 0,
            }}
          >
            {lineBadge}
          </span>
        )}
        {previewable && (
          expanded
            ? <ChevronDown size={14} color="var(--muted-foreground)" style={{ flexShrink: 0 }} />
            : <ChevronRight size={14} color="var(--muted-foreground)" style={{ flexShrink: 0 }} />
        )}
      </button>
      {expanded && (
        <InlinePreviewPanel
          relativePath={info.relativePath}
          extension={info.extension}
          accentColor={accentColor}
        />
      )}
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
  if (n === "read") return { Icon: FileText, label: "Read", color: "var(--muted-foreground)" };
  if (n === "glob") return { Icon: Search, label: "Search", color: "var(--muted-foreground)" };
  if (n === "grep") return { Icon: Search, label: "Search", color: "var(--muted-foreground)" };
  if (n === "ls") return { Icon: FolderOpen, label: "List", color: "var(--muted-foreground)" };
  if (n === "bash") return { Icon: Terminal, label: "Bash", color: "var(--muted-foreground)" };
  if (n === "webfetch") return { Icon: Globe, label: "Fetch", color: "var(--muted-foreground)" };
  if (n === "websearch") return { Icon: Globe, label: "Search", color: "var(--muted-foreground)" };
  if (n === "todowrite") return { Icon: ListChecks, label: "Updated Todos", color: "var(--muted-foreground)" };
  if (n === "task" || n === "agent") return { Icon: Sparkles, label: "Agent", color: "var(--muted-foreground)" };
  if (n === "skill") return { Icon: Sparkles, label: "Skill", color: "var(--muted-foreground)" };
  return { Icon: Wrench, label: name || "Tool", color: "var(--muted-foreground)" };
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
        fontFamily: "var(--font-inter), Inter, sans-serif",
        color: "var(--muted-foreground)",
        lineHeight: 1.3,
      }}
    >
      <visual.Icon size={11} color="var(--border)" style={{ flexShrink: 0 }} />
      <span>{visual.label}</span>
      {detail && (
        <span style={{ color: "var(--border)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
          borderLeft: "3px solid var(--muted-foreground)",
          backgroundColor: "color-mix(in srgb, var(--foreground) 4%, transparent)",
          borderRadius: "0 6px 6px 0",
        }}
      >
        <Zap size={13} color="var(--muted-foreground)" style={{ flexShrink: 0 }} />
        <span
          style={{
            fontSize: 12,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontWeight: 600,
            color: "var(--muted-foreground)",
          }}
        >
          Skill invoked
        </span>
        <span
          style={{
            fontSize: 12,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontWeight: 500,
            color: "var(--foreground)",
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
          fontFamily: "var(--font-inter), Inter, sans-serif",
          color: "var(--muted-foreground)",
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
          <span style={{ color: "var(--border)" }}>
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
          borderLeft: "3px solid var(--primary)",
          backgroundColor: "var(--card)",
          padding: "12px 16px",
          borderRadius: "0 0.5rem 0.5rem 0",
          fontSize: 13,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          color: "var(--foreground)",
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
    const prose = serializeAnswersToProse(specs, formAnswers);
    try {
      await fetch(`/api/tasks/${taskId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prose, structuredAnswers: formAnswers }),
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
          borderLeft: "3px solid var(--primary)",
          backgroundColor: "var(--card)",
          padding: "10px 14px",
          borderRadius: "0 0.5rem 0.5rem 0",
          fontFamily: "var(--font-inter), Inter, sans-serif",
          color: "var(--foreground)",
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
            color: "var(--primary)",
            fontFamily:
              "var(--font-inter), Inter, sans-serif",
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

function UserReplyEntry({ entry, permissionMode }: { entry: LogEntry; permissionMode?: PermissionMode }) {
  const [collapsed, setCollapsed] = useState(false);
  const copyVisibility = useHoverFocusVisibility();
  const displayContent = stripInjectedContext(entry.content);
  // Prefer the permission mode stored on the log entry (snapshot at send time)
  // over the task-level mode (which reflects the latest value)
  const effectiveMode = (entry.permissionMode as PermissionMode) || permissionMode;

  return (
    <div
      {...copyVisibility.bind}
      style={{
        width: "100%",
      }}
    >
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          backgroundColor: "var(--card)",
          padding: "10px 14px 12px",
        }}
      >
        {/* Header: icon + You label + permission mode + (collapse) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: collapsed ? 0 : 6,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <UserIcon size={14} color="var(--muted-foreground)" />
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                fontFamily:
                  "var(--font-inter), Inter, sans-serif",
                color: "var(--foreground)",
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
                    effectiveMode === "plan" ? "var(--muted-foreground)"
                    : effectiveMode === "bypassPermissions" || effectiveMode === "acceptEdits" || effectiveMode === "auto" ? "var(--destructive)"
                    : "var(--muted-foreground)",
                  background:
                    effectiveMode === "plan" ? "color-mix(in srgb, var(--foreground) 8%, transparent)"
                    : effectiveMode === "bypassPermissions" || effectiveMode === "acceptEdits" || effectiveMode === "auto" ? "color-mix(in srgb, var(--foreground) 8%, transparent)"
                    : "color-mix(in srgb, var(--foreground) 8%, transparent)",
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
                color: "var(--muted-foreground)",
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
              color: "var(--foreground)",
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
            }}
          >
            {displayContent}
          </div>
        )}
      </div>
      {displayContent && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-start",
            marginTop: 6,
            paddingLeft: 2,
          }}
        >
          <CopyActionButton
            text={displayContent}
            label="Copy message"
            visible={copyVisibility.isVisible}
          />
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── system ─────────────────────────────── */

function SystemEntry({ entry }: { entry: LogEntry }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "2px 2px",
        fontSize: 11,
        fontFamily: "var(--font-inter), Inter, sans-serif",
        color: "var(--muted-foreground)",
        lineHeight: 1.4,
      }}
    >
      <Info size={11} color="var(--border)" style={{ flexShrink: 0 }} />
      <span>{entry.content}</span>
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
}: {
  entry: LogEntry;
  permissionMode?: PermissionMode;
  taskId?: string;
  readOnly?: boolean;
}) {
  switch (entry.type) {
    case "text":
      return <TextGroup entries={[entry]} />;
    case "tool_use":
    case "tool_result":
      // Handled by ToolSummaryBlock in grouped rendering
      return null;
    case "question":
      // Prose-detected questions render as normal text — they're usually
      // rhetorical (Claude kept going). Only structured_question gets
      // interactive treatment.
      return <TextGroup entries={[entry]} />;
    case "structured_question":
      return <StructuredQuestionEntry entry={entry} taskId={taskId} readOnly={readOnly} />;
    case "user_reply":
      return <UserReplyEntry entry={entry} permissionMode={permissionMode} />;
    case "system":
      return <SystemEntry entry={entry} />;
    default:
      return null;
  }
}

/** Small helper used by MessageSquare icon imports (avoid unused warning). */
export const _thinkingIcon = MessageSquare;

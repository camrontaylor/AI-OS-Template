"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { memo } from "react";
import { resolveWorkspaceFileReference } from "@/lib/workspace-file-reference";

interface MarkdownPreviewProps {
  content: string;
  className?: string;
  showFrontmatter?: boolean;
  variant?: "document" | "panel";
  onOpenFile?: (relativePath: string) => void;
  sourcePath?: string | null;
}

/**
 * Parse YAML frontmatter from markdown content.
 * Returns the parsed key-value pairs and the remaining body.
 */
function parseFrontmatter(raw: string): { meta: Record<string, string | string[]> | null; body: string; bodyStartLine: number } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { meta: null, body: raw, bodyStartLine: 1 };

  const yamlBlock = match[1];
  const body = match[2];
  const meta: Record<string, string | string[]> = {};

  let currentKey: string | null = null;
  let currentArray: string[] | null = null;
  let foldedKey: string | null = null;
  let foldedLines: string[] = [];

  const flushFolded = () => {
    if (foldedKey && foldedLines.length > 0) {
      meta[foldedKey] = foldedLines.join(" ").trim();
    }
    foldedKey = null;
    foldedLines = [];
  };

  for (const line of yamlBlock.split("\n")) {
    // If we're collecting a folded scalar (> or |), indented lines belong to it
    if (foldedKey) {
      if (line.match(/^\s+/) && !line.match(/^(\w[\w\s]*?):\s/)) {
        foldedLines.push(line.trim());
        continue;
      } else {
        flushFolded();
      }
    }

    // Array item (e.g., "  - value")
    const arrayItem = line.match(/^\s+-\s+(.+)/);
    if (arrayItem && currentKey) {
      if (!currentArray) {
        currentArray = [];
        meta[currentKey] = currentArray;
      }
      currentArray.push(arrayItem[1].replace(/^["']|["']$/g, ""));
      continue;
    }

    // Key-value pair (e.g., "name: value")
    const kv = line.match(/^(\w[\w\s]*?):\s*(.*)/);
    if (kv) {
      currentKey = kv[1].trim();
      currentArray = null;
      const val = kv[2].trim().replace(/^["']|["']$/g, "");
      // Folded (>) or literal (|) scalar — collect subsequent indented lines
      if (val === ">" || val === "|") {
        foldedKey = currentKey;
        foldedLines = [];
      } else if (val) {
        meta[currentKey] = val;
      }
    }
  }

  flushFolded();

  const prefixLength = raw.length - body.length;
  return { meta, body, bodyStartLine: raw.slice(0, prefixLength).split("\n").length };
}

function MarkdownPreviewComponent({
  content,
  className,
  showFrontmatter = true,
  variant = "document",
  onOpenFile,
  sourcePath,
}: MarkdownPreviewProps) {
  const { meta, body, bodyStartLine } = parseFrontmatter(content);
  const compact = variant === "panel";
  const sourceLine = (node: { position?: { start?: { line?: number } } } | null | undefined) =>
    bodyStartLine + (node?.position?.start?.line ?? 1) - 1;

  return (
    <div className={className} style={{ width: "100%", lineHeight: 1.6, fontFamily: "var(--font-inter), Inter, sans-serif" }}>
      {showFrontmatter && meta && Object.keys(meta).length > 0 && (
        <div
          data-source-line={1}
          style={{
            backgroundColor: "var(--cc-surface-muted)",
            borderRadius: "0.375rem",
            padding: compact ? "8px 10px" : "12px 16px",
            marginBottom: compact ? 12 : 20,
            border: "1px solid var(--cc-line-alpha-20)",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {Object.entries(meta).map(([key, value]) => (
                <tr key={key}>
                  <td
                    style={{
                      padding: "3px 12px 3px 0",
                      fontFamily: "var(--font-space-grotesk), Space Grotesk, monospace",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--cc-text-secondary)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      verticalAlign: "top",
                      whiteSpace: "nowrap",
                      width: 1,
                    }}
                  >
                    {key}
                  </td>
                  <td
                    style={{
                      padding: "3px 0",
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 13,
                      color: "var(--cc-text-primary)",
                      verticalAlign: "top",
                    }}
                  >
                    {Array.isArray(value) ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {value.map((v, i) => (
                          <span
                            key={i}
                            style={{
                              backgroundColor: "var(--cc-brand-soft)",
                              color: "var(--cc-brand-strong)",
                              padding: "1px 8px",
                              borderRadius: 4,
                              fontSize: 11,
                              fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                            }}
                          >
                            {v}
                          </span>
                        ))}
                      </div>
                    ) : (
                      value
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children, node }) => (
            <h1 data-source-line={sourceLine(node)} style={{ fontFamily: "var(--font-epilogue), Epilogue, sans-serif", color: "var(--cc-text-primary)", fontSize: compact ? 20 : 28, fontWeight: 700, margin: compact ? "4px 0 10px" : "24px 0 12px" }}>
              {children}
            </h1>
          ),
          h2: ({ children, node }) => (
            <h2 data-source-line={sourceLine(node)} style={{ fontFamily: "var(--font-epilogue), Epilogue, sans-serif", color: "var(--cc-text-primary)", fontSize: compact ? 15 : 22, fontWeight: 700, margin: compact ? "16px 0 8px" : "20px 0 10px" }}>
              {children}
            </h2>
          ),
          h3: ({ children, node }) => (
            <h3 data-source-line={sourceLine(node)} style={{ fontFamily: "var(--font-epilogue), Epilogue, sans-serif", color: "var(--cc-text-primary)", fontSize: compact ? 13 : 18, fontWeight: 600, margin: compact ? "14px 0 7px" : "16px 0 8px" }}>
              {children}
            </h3>
          ),
          p: ({ children, node }) => (
            <p data-source-line={sourceLine(node)} style={{ margin: compact ? "0 0 10px" : "8px 0", color: "var(--cc-text-primary)", fontSize: compact ? 13 : undefined }}>{children}</p>
          ),
          a: ({ href, children }) => {
            const localPath = onOpenFile ? resolveWorkspaceFileReference(href, sourcePath) : null;
            return (
              <a
                href={href}
                style={{ color: "var(--cc-brand-primary)", textDecoration: "underline" }}
                target={localPath ? undefined : "_blank"}
                rel={localPath ? undefined : "noopener noreferrer"}
                onClick={localPath ? (event) => {
                  event.preventDefault();
                  onOpenFile?.(localPath);
                } : undefined}
              >
                {children}
              </a>
            );
          },
          code: ({ children, className: codeClassName }) => {
            const isInline = !codeClassName;
            if (isInline) {
              const text = String(children).trim();
              const localPath = onOpenFile
                ? resolveWorkspaceFileReference(text, sourcePath)
                : null;
              if (localPath) {
                return (
                  <button
                    type="button"
                    onClick={() => onOpenFile?.(localPath)}
                    title={`Open ${localPath} in File viewer`}
                    style={{
                      display: "inline",
                      border: 0,
                      backgroundColor: "var(--cc-surface-muted)",
                      color: "var(--cc-brand-primary)",
                      padding: "2px 6px",
                      borderRadius: "0.25rem",
                      fontFamily: "var(--font-space-grotesk), Space Grotesk, monospace",
                      fontSize: 13,
                      textDecoration: "underline",
                      textUnderlineOffset: 2,
                      cursor: "pointer",
                    }}
                  >
                    {children}
                  </button>
                );
              }
              return (
                <code style={{ backgroundColor: "var(--cc-surface-muted)", padding: "2px 6px", borderRadius: "0.25rem", fontFamily: "var(--font-space-grotesk), Space Grotesk, monospace", fontSize: 13 }}>
                  {children}
                </code>
              );
            }
            return (
              <code style={{ fontFamily: "var(--font-space-grotesk), Space Grotesk, monospace", fontSize: 13 }}>
                {children}
              </code>
            );
          },
          pre: ({ children, node }) => (
            <pre data-source-line={sourceLine(node)} style={{ backgroundColor: "var(--cc-surface-muted)", padding: 16, borderRadius: "0.375rem", overflow: "auto", margin: "12px 0" }}>
              {children}
            </pre>
          ),
          table: ({ children, node }) => (
            <table data-source-line={sourceLine(node)} style={{ width: "100%", borderCollapse: "collapse", margin: "12px 0" }}>
              {children}
            </table>
          ),
          thead: ({ children }) => (
            <thead style={{ backgroundColor: "var(--cc-surface-muted)" }}>{children}</thead>
          ),
          tr: ({ children }) => (
            <tr style={{ borderBottom: "1px solid var(--cc-line-alpha-20)" }}>{children}</tr>
          ),
          th: ({ children }) => (
            <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 13 }}>{children}</th>
          ),
          td: ({ children }) => (
            <td style={{ padding: "8px 12px", fontSize: 14 }}>{children}</td>
          ),
          ul: ({ children, node }) => (
            <ul data-source-line={sourceLine(node)} style={{ paddingLeft: 24, margin: "8px 0" }}>{children}</ul>
          ),
          ol: ({ children, node }) => (
            <ol data-source-line={sourceLine(node)} style={{ paddingLeft: 24, margin: "8px 0" }}>{children}</ol>
          ),
          li: ({ children, node }) => (
            <li data-source-line={sourceLine(node)} style={{ margin: "4px 0" }}>{children}</li>
          ),
          blockquote: ({ children, node }) => (
            <blockquote data-source-line={sourceLine(node)} style={{ borderLeft: "3px solid var(--cc-brand-primary)", paddingLeft: 16, margin: "12px 0", color: "var(--cc-text-secondary)", fontStyle: "italic" }}>
              {children}
            </blockquote>
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownPreview = memo(MarkdownPreviewComponent);
MarkdownPreview.displayName = "MarkdownPreview";

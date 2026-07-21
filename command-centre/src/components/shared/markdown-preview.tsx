"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

/**
 * Parse YAML frontmatter from markdown content.
 * Returns the parsed key-value pairs and the remaining body.
 */
function parseFrontmatter(raw: string): { meta: Record<string, string | string[]> | null; body: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { meta: null, body: raw };

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

  return { meta, body };
}

export function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  const { meta, body } = parseFrontmatter(content);

  return (
    <div className={className} style={{ width: "100%", lineHeight: 1.6, fontFamily: "var(--font-inter), Inter, sans-serif" }}>
      {meta && Object.keys(meta).length > 0 && (
        <div
          style={{
            backgroundColor: "var(--muted)",
            borderRadius: "0.375rem",
            padding: "12px 16px",
            marginBottom: 20,
            border: "1px solid var(--border)",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {Object.entries(meta).map(([key, value]) => (
                <tr key={key}>
                  <td
                    style={{
                      padding: "4px 12px 4px 0",
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--muted-foreground)",
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
                      padding: "4px 0",
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 13,

                      color: "var(--foreground)",
                      verticalAlign: "top",
                    }}
                  >
                    {Array.isArray(value) ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {value.map((v, i) => (
                          <Badge key={i} variant="secondary" className="px-2 py-0 text-[11px] font-normal">
                            {v}
                          </Badge>
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
          h1: ({ children }) => (
            <h1 style={{ fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--foreground)", fontSize: 28, fontWeight: 700, margin: "24px 0 12px" }}>
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 style={{ fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--foreground)", fontSize: 22, fontWeight: 700, margin: "20px 0 12px" }}>
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 style={{ fontFamily: "var(--font-inter), Inter, sans-serif", color: "var(--foreground)", fontSize: 18, fontWeight: 600, margin: "16px 0 8px" }}>
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p style={{ margin: "8px 0", color: "var(--foreground)" }}>{children}</p>
          ),
          a: ({ href, children }) => (
            <a href={href} style={{ color: "var(--primary)", textDecoration: "underline" }} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          code: ({ children, className: codeClassName }) => {
            const isInline = !codeClassName;
            if (isInline) {
              return (
                <code style={{ backgroundColor: "var(--muted)", padding: "4px 8px", borderRadius: "0.25rem", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 13 }}>
                  {children}
                </code>
              );
            }
            return (
              <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 13 }}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre style={{ backgroundColor: "var(--muted)", padding: 16, borderRadius: "0.375rem", overflow: "auto", margin: "12px 0" }}>
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div style={{ overflowX: "auto", margin: "12px 0" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead style={{ backgroundColor: "var(--muted)" }}>{children}</thead>
          ),
          tr: ({ children }) => (
            <tr style={{ borderBottom: "1px solid var(--border)" }}>{children}</tr>
          ),
          th: ({ children }) => (
            <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 13 }}>{children}</th>
          ),
          td: ({ children }) => (
            <td style={{ padding: "8px 12px", fontSize: 14 }}>{children}</td>
          ),
          ul: ({ children }) => (
            <ul style={{ paddingLeft: 24, margin: "8px 0" }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol style={{ paddingLeft: 24, margin: "8px 0" }}>{children}</ol>
          ),
          li: ({ children }) => (
            <li style={{ margin: "4px 0" }}>{children}</li>
          ),
          blockquote: ({ children }) => (
            <blockquote style={{ borderLeft: "3px solid var(--primary)", paddingLeft: 16, margin: "12px 0", color: "var(--muted-foreground)", fontStyle: "italic" }}>
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

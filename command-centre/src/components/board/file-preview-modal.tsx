"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { X, Download, ExternalLink } from "lucide-react";
import Link from "next/link";
import type { OutputFile } from "@/types/task";
import { downloadAuthenticatedFile, useAuthenticatedFileUrl } from "@/hooks/use-authenticated-file";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"]);

interface PreviewResponse {
  content: string | null;
  truncated: boolean;
  size: number;
  extension: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function CsvTable({ content }: { content: string }) {
  const rows = content
    .trim()
    .split("\n")
    .map((line) => line.split(","));
  if (rows.length === 0) return null;

  const [header, ...body] = rows;

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 13,
          fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
        }}
      >
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th
                key={i}
                style={{
                  textAlign: "left",
                  padding: "8px 12px",
                  backgroundColor: "var(--cc-surface-muted)",
                  color: "var(--cc-text-primary)",
                  fontWeight: 600,
                }}
              >
                {cell.trim()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  style={{
                    padding: "8px 12px",
                    backgroundColor: ri % 2 === 0 ? "var(--cc-surface)" : "var(--cc-control-bg)",
                    color: "var(--cc-text-primary)",
                  }}
                >
                  {cell.trim()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FilePreviewModal({
  file,
  onClose,
}: {
  file: OutputFile | null;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [binaryUrl, setBinaryUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const isBinary = file ? (IMAGE_EXTENSIONS.has(file.extension) || file.extension === "pdf") : false;

  useEffect(() => {
    if (!file) {
      setPreview(null);
      setBinaryUrl(null);
      setError(false);
      return;
    }

    setLoading(true);
    setError(false);

    const ext = file.extension.toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext) || ext === "pdf") {
      // Binary files: just build a URL to the preview endpoint
      setBinaryUrl(`/api/files/preview?path=${encodeURIComponent(file.relativePath)}`);
      setPreview(null);
      setLoading(false);
    } else {
      setBinaryUrl(null);
      fetch(`/api/files/preview?path=${encodeURIComponent(file.relativePath)}`)
        .then((res) => {
          if (!res.ok) throw new Error("Failed to load preview");
          return res.json();
        })
        .then((data: PreviewResponse) => {
          setPreview(data);
          setLoading(false);
        })
        .catch(() => {
          setError(true);
          setLoading(false);
        });
    }
  }, [file]);

  const authenticatedBinaryUrl = useAuthenticatedFileUrl(binaryUrl);

  if (!file) return null;

  const handleDownload = () => void downloadAuthenticatedFile(
    `/api/files/download?path=${encodeURIComponent(file.relativePath)}`,
  );

  const docsLink = `/docs?file=${encodeURIComponent(file.relativePath)}`;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "var(--cc-canvas-overlay-80)",
        backdropFilter: "blur(12px)",
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "var(--cc-surface)",
          boxShadow: "0px 12px 32px var(--cc-brand-alpha-06)",
          borderRadius: "0.75rem",
          padding: 24,
          maxWidth: 720,
          width: "90%",
          maxHeight: "80vh",
          overflowY: "auto",
          position: "relative",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: 16,
                fontWeight: 600,
                fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
                color: "var(--cc-text-primary)",
              }}
            >
              {file.fileName}
            </span>
            <span
              style={{
                fontSize: 11,
                fontFamily:
                  "var(--font-space-grotesk), Space Grotesk, sans-serif",
                padding: "2px 6px",
                borderRadius: 4,
                backgroundColor: "var(--cc-surface-muted)",
                color: "var(--cc-text-secondary)",
              }}
            >
              .{file.extension}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Link
              href={docsLink}
              onClick={onClose}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--cc-brand-primary)",
                fontSize: 13,
                fontFamily:
                  "var(--font-space-grotesk), Space Grotesk, sans-serif",
                textDecoration: "none",
              }}
            >
              <ExternalLink size={14} />
              Open in Docs
            </Link>
            <button
              onClick={handleDownload}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--cc-text-secondary)",
                fontSize: 13,
                fontFamily:
                  "var(--font-space-grotesk), Space Grotesk, sans-serif",
              }}
            >
              <Download size={14} />
              Download
            </button>
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--cc-text-secondary)",
                padding: 4,
                display: "flex",
                alignItems: "center",
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        {loading && (
          <div
            style={{
              padding: 32,
              textAlign: "center",
              color: "var(--cc-text-secondary)",
              fontSize: 14,
            }}
          >
            Loading preview...
          </div>
        )}

        {error && (
          <div style={{ padding: 32, textAlign: "center" }}>
            <p style={{ color: "var(--cc-text-secondary)", fontSize: 14, marginBottom: 12 }}>
              Unable to preview this file
            </p>
            <button
              onClick={handleDownload}
              style={{
                background: "none",
                border: "1px solid var(--cc-brand-primary)",
                borderRadius: 6,
                padding: "8px 16px",
                color: "var(--cc-brand-primary)",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Download instead
            </button>
          </div>
        )}

        {/* Image preview */}
        {authenticatedBinaryUrl && IMAGE_EXTENSIONS.has(file.extension.toLowerCase()) && (
          <div style={{ textAlign: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={authenticatedBinaryUrl}
              alt={file.fileName}
              style={{
                maxWidth: "100%",
                maxHeight: "60vh",
                borderRadius: 8,
                objectFit: "contain",
              }}
            />
          </div>
        )}

        {/* PDF preview */}
        {authenticatedBinaryUrl && file.extension.toLowerCase() === "pdf" && (
          <iframe
            src={authenticatedBinaryUrl}
            title={file.fileName}
            style={{
              width: "100%",
              height: "60vh",
              border: "none",
              borderRadius: 8,
            }}
          />
        )}

        {preview && preview.truncated && (
          <div
            style={{
              padding: 16,
              backgroundColor: "var(--cc-surface)8F0",
              borderRadius: 8,
              textAlign: "center",
            }}
          >
            <p style={{ fontSize: 14, color: "var(--cc-text-secondary)", marginBottom: 8 }}>
              File too large to preview ({formatFileSize(preview.size)}).
              Download to view full content.
            </p>
            <button
              onClick={handleDownload}
              style={{
                background: "none",
                border: "1px solid var(--cc-brand-primary)",
                borderRadius: 6,
                padding: "8px 16px",
                color: "var(--cc-brand-primary)",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Download file
            </button>
          </div>
        )}

        {preview && !preview.truncated && preview.content !== null && (
          <>
            {preview.extension === "md" && (
              <div
                className="prose-preview"
                style={{
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: "var(--cc-text-primary)",
                }}
              >
                <ReactMarkdown
                  components={{
                    h1: ({ children }) => (
                      <h1
                        style={{
                          fontSize: 24,
                          fontWeight: 700,
                          margin: "16px 0 8px",
                          fontFamily:
                            "var(--font-epilogue), Epilogue, sans-serif",
                        }}
                      >
                        {children}
                      </h1>
                    ),
                    h2: ({ children }) => (
                      <h2
                        style={{
                          fontSize: 20,
                          fontWeight: 600,
                          margin: "14px 0 6px",
                          fontFamily:
                            "var(--font-epilogue), Epilogue, sans-serif",
                        }}
                      >
                        {children}
                      </h2>
                    ),
                    h3: ({ children }) => (
                      <h3
                        style={{
                          fontSize: 16,
                          fontWeight: 600,
                          margin: "12px 0 4px",
                          fontFamily:
                            "var(--font-epilogue), Epilogue, sans-serif",
                        }}
                      >
                        {children}
                      </h3>
                    ),
                    p: ({ children }) => (
                      <p style={{ margin: "8px 0" }}>{children}</p>
                    ),
                    code: ({ children }) => (
                      <code
                        style={{
                          backgroundColor: "var(--cc-surface-muted)",
                          padding: "2px 6px",
                          borderRadius: 4,
                          fontSize: 13,
                          fontFamily: "JetBrains Mono, monospace",
                        }}
                      >
                        {children}
                      </code>
                    ),
                    pre: ({ children }) => (
                      <pre
                        style={{
                          backgroundColor: "var(--cc-surface-muted)",
                          padding: 16,
                          borderRadius: "0.5rem",
                          overflowX: "auto",
                          fontSize: 13,
                          fontFamily: "JetBrains Mono, monospace",
                        }}
                      >
                        {children}
                      </pre>
                    ),
                  }}
                >
                  {preview.content}
                </ReactMarkdown>
              </div>
            )}

            {preview.extension === "csv" && (
              <CsvTable content={preview.content} />
            )}

            {["txt", "log", "json", "html"].includes(preview.extension) && (
              <pre
                style={{
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: 13,
                  color: "var(--cc-text-primary)",
                  backgroundColor: "var(--cc-surface-muted)",
                  padding: 16,
                  borderRadius: "0.5rem",
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {preview.content}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}

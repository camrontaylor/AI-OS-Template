"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { X, Download, ExternalLink } from "lucide-react";
import Link from "next/link";
import type { OutputFile } from "@/types/task";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
          fontFamily: "var(--font-inter), Inter, sans-serif",
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
                  backgroundColor: "var(--muted)",
                  color: "var(--foreground)",
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
                    backgroundColor: ri % 2 === 0 ? "var(--card)" : "var(--muted)",
                    color: "var(--foreground)",
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

  if (!file) return null;

  const handleDownload = () => {
    window.open(
      `/api/files/download?path=${encodeURIComponent(file.relativePath)}`,
      "_blank"
    );
  };

  const docsLink = `/docs?file=${encodeURIComponent(file.relativePath)}`;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "color-mix(in srgb, var(--card) 80%, transparent)",
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
          backgroundColor: "var(--card)",
          boxShadow: "0px 12px 32px color-mix(in srgb, var(--foreground) 6%, transparent)",
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
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-foreground">
              {file.fileName}
            </span>
            <Badge variant="secondary" className="px-2 py-0 text-[11px] font-normal">
              .{file.extension}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="gap-1 text-foreground"
            >
              <Link href={docsLink} onClick={onClose}>
                <ExternalLink size={14} />
                Open in Docs
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDownload}
              className="gap-1 text-muted-foreground"
            >
              <Download size={14} />
              Download
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="size-8 text-muted-foreground"
            >
              <X size={18} />
            </Button>
          </div>
        </div>

        {/* Content */}
        {loading && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Loading preview...
          </div>
        )}

        {error && (
          <div className="p-8 text-center">
            <p className="mb-3 text-sm text-muted-foreground">
              Unable to preview this file
            </p>
            <Button variant="outline" size="sm" onClick={handleDownload}>
              Download instead
            </Button>
          </div>
        )}

        {/* Image preview */}
        {binaryUrl && IMAGE_EXTENSIONS.has(file.extension.toLowerCase()) && (
          <div style={{ textAlign: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={binaryUrl}
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
        {binaryUrl && file.extension.toLowerCase() === "pdf" && (
          <iframe
            src={binaryUrl}
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
          <div className="rounded-lg border border-border p-4 text-center">
            <p className="mb-2 text-sm text-muted-foreground">
              File too large to preview ({formatFileSize(preview.size)}).
              Download to view full content.
            </p>
            <Button variant="outline" size="sm" onClick={handleDownload}>
              Download file
            </Button>
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
                  color: "var(--foreground)",
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
                            "var(--font-inter), Inter, sans-serif",
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
                          margin: "16px 0 8px",
                          fontFamily:
                            "var(--font-inter), Inter, sans-serif",
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
                            "var(--font-inter), Inter, sans-serif",
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
                          backgroundColor: "var(--muted)",
                          padding: "4px 8px",
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
                          backgroundColor: "var(--muted)",
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
                  color: "var(--foreground)",
                  backgroundColor: "var(--muted)",
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

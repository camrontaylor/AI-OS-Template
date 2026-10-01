"use client";

import { useEffect, useState } from "react";
import { FileText, Image, FileType, Download, ExternalLink, Eye } from "lucide-react";
import { useTaskStore } from "@/store/task-store";
import type { OutputFile } from "@/types/task";
import { slugToName, getClientColor } from "@/types/client";
import { appendClientId } from "@/hooks/use-client-id";
import { downloadAuthenticatedFile, useAuthenticatedFileUrl } from "@/hooks/use-authenticated-file";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const PDF_EXTENSIONS = new Set(["pdf"]);

function AuthenticatedThumbnail({ url }: { url: string }) {
  const source = useAuthenticatedFileUrl(url);
  if (!source) return <div style={{ width: 32, height: 32, flexShrink: 0 }} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={source} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: "cover", flexShrink: 0, backgroundColor: "var(--cc-surface-muted)" }} />;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "--";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(ext: string) {
  if (IMAGE_EXTENSIONS.has(ext)) return Image;
  if (PDF_EXTENSIONS.has(ext)) return FileType;
  return FileText;
}

/** Shorten the extension for display when it's very long (e.g. "excalidraw" → "excali…") */
function displayExtension(ext: string): string {
  if (ext.length > 6) return ext.slice(0, 5) + "\u2026";
  return ext;
}

/**
 * Build a display breadcrumb from the relative path.
 * If the file belongs to a client, strip the `clients/{slug}/` prefix
 * so the breadcrumb shows the path relative to the client workspace.
 */
function buildBreadcrumb(relativePath: string, clientId?: string | null): string {
  let cleanPath = relativePath;
  if (clientId) {
    const prefix = `clients/${clientId}/`;
    if (cleanPath.startsWith(prefix)) {
      cleanPath = cleanPath.slice(prefix.length);
    }
  }
  const parts = cleanPath.split("/").filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join(" / ");
}

export function PanelOutputs({ taskId, clientId, projectSlug, taskLevel, onFileClick }: {
  taskId: string;
  clientId?: string | null;
  projectSlug?: string | null;
  taskLevel?: string | null;
  onFileClick?: (file: OutputFile) => void;
}) {
  const outputFiles = useTaskStore((s) => s.outputFiles[taskId]) ?? [];
  const fetchOutputFiles = useTaskStore((s) => s.fetchOutputFiles);
  const [hoveredFileId, setHoveredFileId] = useState<string | null>(null);

  useEffect(() => {
    fetchOutputFiles(taskId);
  }, [taskId, fetchOutputFiles]);

  // Build plan file entry if this task has a project brief
  const planFile: OutputFile | null = projectSlug ? (() => {
    const isGsd = taskLevel === "gsd";
    const fileName = isGsd ? "ROADMAP.md" : "brief.md";
    const relativePath = isGsd
      ? `projects/briefs/${projectSlug}/.planning/ROADMAP.md`
      : `projects/briefs/${projectSlug}/brief.md`;
    return {
      id: `plan-${projectSlug}`,
      taskId,
      fileName,
      filePath: relativePath,
      relativePath,
      extension: "md",
      sizeBytes: null,
      createdAt: new Date().toISOString(),
    };
  })() : null;

  return (
    <div>
      {/* Plan file — pinned at top when project has a brief */}
      {planFile && (
        <div style={{ padding: "16px 24px 0 24px" }}>
          <button
            onClick={() => onFileClick?.(planFile)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              padding: "10px 12px",
              border: "1px solid var(--cc-surface-purple)",
              borderRadius: 8,
              background: "var(--cc-status-purple-bg)",
              cursor: onFileClick ? "pointer" : "default",
              textAlign: "left",
              transition: "background 120ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cc-status-purple-bg)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--cc-status-purple-bg)"; }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: 4,
              backgroundColor: "var(--cc-status-purple-bg)",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <FileText size={16} color="var(--cc-status-purple)" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                fontSize: 13, fontWeight: 600,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                color: "var(--cc-status-purple)",
              }}>
                {planFile.fileName}
              </span>
              <div style={{
                fontSize: 11,
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                color: "var(--cc-text-tertiary)", marginTop: 1,
              }}>
                Project {taskLevel === "gsd" ? "roadmap" : "brief"}
              </div>
            </div>
          </button>
        </div>
      )}

      {/* Section header */}
      <div
        style={{
          padding: "24px 24px 12px 24px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
            color: "var(--cc-text-primary)",
          }}
        >
          Output Files
        </span>
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
            color: "var(--cc-text-secondary)",
          }}
        >
          {outputFiles.length}
        </span>
      </div>

      {/* Empty state */}
      {outputFiles.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "32px 24px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          <FileText size={32} color="var(--cc-control-border)" />
          <span
            style={{
              fontSize: 14,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              color: "var(--cc-text-secondary)",
            }}
          >
            No output files yet
          </span>
        </div>
      )}

      {/* File list */}
      {outputFiles.length > 0 && (
        <div
          style={{
            padding: "0 24px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {outputFiles.map((file) => {
            const Icon = getFileIcon(file.extension);
            const docsHref = `/docs?file=${encodeURIComponent(file.relativePath)}`;
            const previewUrl = appendClientId(`/api/files/preview?path=${encodeURIComponent(file.relativePath)}`, clientId ?? null);
            const downloadUrl = appendClientId(`/api/files/download?path=${encodeURIComponent(file.relativePath)}`, clientId ?? null);
            const isImage = IMAGE_EXTENSIONS.has(file.extension);
            const isHovered = hoveredFileId === file.id;
            const breadcrumb = buildBreadcrumb(file.relativePath, clientId);

            return (
              <div
                key={file.id}
                style={{
                  borderRadius: 8,
                  border: "1px solid var(--cc-control-bg)",
                  backgroundColor: isHovered ? "var(--cc-canvas-subtle)" : "var(--cc-surface)",
                  transition: "background 120ms ease, border-color 120ms ease",
                  overflow: "hidden",
                }}
                onMouseEnter={() => setHoveredFileId(file.id)}
                onMouseLeave={() => setHoveredFileId(null)}
              >
                {/* Main row: clickable to preview */}
                <button
                  onClick={() => onFileClick?.(file)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "10px 12px",
                    border: "none",
                    background: "none",
                    cursor: onFileClick ? "pointer" : "default",
                    textAlign: "left",
                  }}
                >
                  {/* Thumbnail or icon */}
                  {isImage ? (
                    <AuthenticatedThumbnail url={previewUrl} />
                  ) : (
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 4,
                        backgroundColor: "var(--cc-surface-muted)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Icon size={16} color="var(--cc-text-secondary)" />
                    </div>
                  )}

                  {/* File info: name + breadcrumb */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          fontFamily: "var(--font-inter), Inter, sans-serif",
                          color: "var(--cc-text-primary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          minWidth: 0,
                        }}
                      >
                        {file.fileName}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                          color: "var(--cc-text-secondary)",
                          backgroundColor: "var(--cc-control-bg)",
                          padding: "1px 5px",
                          borderRadius: 3,
                          flexShrink: 0,
                          whiteSpace: "nowrap",
                        }}
                        title={`.${file.extension}`}
                      >
                        .{displayExtension(file.extension)}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                          color: "var(--cc-text-tertiary)",
                          flexShrink: 0,
                        }}
                      >
                        {formatBytes(file.sizeBytes)}
                      </span>
                    </div>
                    {(breadcrumb || clientId) && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 11,
                          fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                          color: "var(--cc-text-tertiary)",
                          marginTop: 2,
                          overflow: "hidden",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {clientId && (
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 600,
                              color: getClientColor(clientId),
                              backgroundColor: getClientColor(clientId) + "14",
                              padding: "1px 5px",
                              borderRadius: 3,
                              flexShrink: 0,
                            }}
                          >
                            {slugToName(clientId)}
                          </span>
                        )}
                        {breadcrumb && (
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                            {breadcrumb}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </button>

                {/* Action bar: visible on hover */}
                {isHovered && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 2,
                      padding: "4px 12px 8px",
                      borderTop: "1px solid var(--cc-palette-neutral-250)",
                    }}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); onFileClick?.(file); }}
                      title="Preview"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 11,
                        fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                        color: "var(--cc-brand-primary)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: "4px 8px",
                        borderRadius: 4,
                      }}
                    >
                      <Eye size={12} />
                      Preview
                    </button>
                    <a
                      href={docsHref}
                      onClick={(e) => e.stopPropagation()}
                      title="Open in Docs"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 11,
                        fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                        color: "var(--cc-text-secondary)",
                        textDecoration: "none",
                        padding: "4px 8px",
                        borderRadius: 4,
                      }}
                    >
                      <ExternalLink size={12} />
                      Docs
                    </a>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void downloadAuthenticatedFile(downloadUrl);
                      }}
                      title="Download"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 11,
                        fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                        color: "var(--cc-text-secondary)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: "4px 8px",
                        borderRadius: 4,
                      }}
                    >
                      <Download size={12} />
                      Download
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

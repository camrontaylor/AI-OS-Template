"use client";

import { useEffect, useState } from "react";
import { FileText, Image, FileType, Download, ExternalLink, Eye } from "lucide-react";
import { useTaskStore } from "@/store/task-store";
import type { OutputFile } from "@/types/task";
import { slugToName, getClientColor } from "@/types/client";
import { appendClientId } from "@/hooks/use-client-id";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const PDF_EXTENSIONS = new Set(["pdf"]);

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
        <div className="px-6 pt-4">
          <button
            onClick={() => onFileClick?.(planFile)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg border border-border bg-muted/40 p-3 text-left transition-colors hover:bg-muted/70",
              onFileClick ? "cursor-pointer" : "cursor-default",
            )}
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded bg-muted">
              <FileText size={16} color="var(--muted-foreground)" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[13px] font-semibold text-muted-foreground">
                {planFile.fileName}
              </span>
              <div className="mt-1 text-xs text-muted-foreground">
                Project {taskLevel === "gsd" ? "roadmap" : "brief"}
              </div>
            </div>
          </button>
        </div>
      )}

      {/* Section header */}
      <div className="flex items-center gap-2 px-6 pb-3 pt-6">
        <span className="text-sm font-semibold text-foreground">
          Output Files
        </span>
        <span className="text-xs text-muted-foreground">
          {outputFiles.length}
        </span>
      </div>

      {/* Empty state */}
      {outputFiles.length === 0 && (
        <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
          <FileText size={32} className="text-muted-foreground/50" />
          <span className="text-sm text-muted-foreground">
            No output files yet
          </span>
        </div>
      )}

      {/* File list */}
      {outputFiles.length > 0 && (
        <div className="flex flex-col gap-1 px-6">
          {outputFiles.map((file) => {
            const Icon = getFileIcon(file.extension);
            const docsHref = `/?tab=docs&file=${encodeURIComponent(file.relativePath)}`;
            const previewUrl = appendClientId(`/api/files/preview?path=${encodeURIComponent(file.relativePath)}`, clientId ?? null);
            const downloadUrl = appendClientId(`/api/files/download?path=${encodeURIComponent(file.relativePath)}`, clientId ?? null);
            const isImage = IMAGE_EXTENSIONS.has(file.extension);
            const isHovered = hoveredFileId === file.id;
            const breadcrumb = buildBreadcrumb(file.relativePath, clientId);

            return (
              <div
                key={file.id}
                className={cn(
                  "overflow-hidden rounded-lg border border-border transition-colors",
                  isHovered ? "bg-muted" : "bg-card",
                )}
                onMouseEnter={() => setHoveredFileId(file.id)}
                onMouseLeave={() => setHoveredFileId(null)}
              >
                {/* Main row: clickable to preview */}
                <button
                  onClick={() => onFileClick?.(file)}
                  className={cn(
                    "flex w-full items-center gap-3 p-3 text-left",
                    onFileClick ? "cursor-pointer" : "cursor-default",
                  )}
                >
                  {/* Thumbnail or icon */}
                  {isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewUrl}
                      alt=""
                      className="size-8 shrink-0 rounded bg-muted object-cover"
                    />
                  ) : (
                    <div className="flex size-8 shrink-0 items-center justify-center rounded bg-muted">
                      <Icon size={16} color="var(--muted-foreground)" />
                    </div>
                  )}

                  {/* File info: name + breadcrumb */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 truncate text-[13px] font-medium text-foreground">
                        {file.fileName}
                      </span>
                      <Badge
                        variant="secondary"
                        className="shrink-0 px-2 py-0 text-[10px] font-normal text-muted-foreground"
                        title={`.${file.extension}`}
                      >
                        .{displayExtension(file.extension)}
                      </Badge>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatBytes(file.sizeBytes)}
                      </span>
                    </div>
                    {(breadcrumb || clientId) && (
                      <div className="mt-1 flex items-center gap-1 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
                        {clientId && (
                          <span
                            className="shrink-0 rounded-sm px-2 py-px text-[10px] font-semibold"
                            style={{
                              color: getClientColor(clientId),
                              backgroundColor: getClientColor(clientId) + "14",
                            }}
                          >
                            {slugToName(clientId)}
                          </span>
                        )}
                        {breadcrumb && (
                          <span className="truncate">
                            {breadcrumb}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </button>

                {/* Action bar: visible on hover */}
                {isHovered && (
                  <div className="flex items-center gap-1 border-t border-border px-3 pb-2 pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); onFileClick?.(file); }}
                      title="Preview"
                      className="h-7 gap-1 px-2 text-xs text-primary hover:text-primary"
                    >
                      <Eye size={12} />
                      Preview
                    </Button>
                    <Button
                      asChild
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                    >
                      <a
                        href={docsHref}
                        onClick={(e) => e.stopPropagation()}
                        title="Open in Docs"
                      >
                        <ExternalLink size={12} />
                        Docs
                      </a>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(
                          downloadUrl,
                          "_blank"
                        );
                      }}
                      title="Download"
                      className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                    >
                      <Download size={12} />
                      Download
                    </Button>
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

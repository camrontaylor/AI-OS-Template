"use client";

import { useState, useEffect, useCallback } from "react";
import { Pencil, Eye, Trash2, Download } from "lucide-react";
import { MarkdownPreview } from "@/components/shared/markdown-preview";
import { MarkdownEditor } from "@/components/shared/markdown-editor";
import { useClientId, appendClientId } from "@/hooks/use-client-id";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { FileContent } from "@/types/file";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"]);
const BINARY_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, "pdf"]);
const HTML_EXTENSIONS = new Set(["html", "htm"]);

interface ContentViewerProps {
  selectedPath: string | null;
  onFileDeleted?: () => void;
}

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ContentViewer({ selectedPath, onFileDeleted }: ContentViewerProps) {
  const clientId = useClientId();
  const [file, setFile] = useState<FileContent | null>(null);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getExtension = (p: string) => {
    const parts = p.split(".");
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
  };

  const isBinaryFile = selectedPath ? BINARY_EXTENSIONS.has(getExtension(selectedPath)) : false;
  const isHtmlFile = selectedPath ? HTML_EXTENSIONS.has(getExtension(selectedPath)) : false;
  const [htmlView, setHtmlView] = useState<"preview" | "source">("preview");
  // Treat paths without a file extension as directories — don't try to fetch as a file.
  const isDirectoryPath = selectedPath ? getExtension(selectedPath) === "" : false;

  const fetchFile = useCallback(async (filePath: string) => {
    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    if (BINARY_EXTENSIONS.has(ext)) {
      // Binary files don't need text content fetch
      setFile({
        path: filePath,
        content: "",
        lastModified: new Date().toISOString(),
      });
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setConflict(false);
    setMode("preview");
    try {
      const res = await fetch(appendClientId(`/api/files/${encodeURIComponent(filePath)}`, clientId));
      if (!res.ok) throw new Error("Failed to load file");
      const data: FileContent = await res.json();
      setFile(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load file");
      setFile(null);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    if (selectedPath && !isDirectoryPath) {
      fetchFile(selectedPath);
      setHtmlView("preview");
    } else {
      setFile(null);
      setError(null);
      setMode("preview");
    }
  }, [selectedPath, fetchFile, isDirectoryPath]);

  const handleSave = async (content: string) => {
    if (!file || !selectedPath) return;
    setIsSaving(true);
    setConflict(false);
    try {
      const res = await fetch(appendClientId(`/api/files/${encodeURIComponent(selectedPath)}`, clientId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, lastModified: file.lastModified }),
      });
      if (res.status === 409) {
        setConflict(true);
        return;
      }
      if (!res.ok) throw new Error("Save failed");
      const updated: FileContent = await res.json();
      setFile(updated);
      setMode("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedPath) return;
    setIsDeleting(true);
    try {
      const res = await fetch(appendClientId(`/api/files/${encodeURIComponent(selectedPath)}`, clientId), {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      setFile(null);
      setShowDeleteConfirm(false);
      onFileDeleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setIsDeleting(false);
    }
  };

  // Empty state
  if (!selectedPath) {
    return (
      <div className="flex h-full min-h-[400px] items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Select a file from the tree to view its contents
        </p>
      </div>
    );
  }

  // Directory placeholder — the tree highlights the folder, viewer waits for a file pick.
  if (isDirectoryPath) {
    const folderName = selectedPath.split("/").filter(Boolean).pop() || selectedPath;
    return (
      <div className="flex h-full min-h-[400px] items-center justify-center p-4 sm:p-6">
        <p className="text-center text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{folderName}</span>
          <br />
          Select a file from this folder in the tree to view it
        </p>
      </div>
    );
  }

  // Loading
  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-4 sm:p-6">
        {[720, 200, 500, 350].map((w, i) => (
          <Skeleton key={i} className="h-4 max-w-full" style={{ width: Math.min(w, 720) }} />
        ))}
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <Card className="gap-0 rounded-lg p-4 shadow-none">
          <p className="text-sm font-medium text-destructive">Unable to read file</p>
          <p className="mt-2 mb-3 text-[13px] text-muted-foreground">{error}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => selectedPath && fetchFile(selectedPath)}
            className="h-auto self-start px-0 py-0 text-[13px] font-medium text-primary underline hover:bg-transparent"
          >
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  if (!file) return null;

  const fileName = selectedPath.split("/").pop() || selectedPath;
  const ext = getExtension(selectedPath);

  const handleDownload = () => {
    window.open(
      `/api/files/download?path=${encodeURIComponent(selectedPath)}`,
      "_blank"
    );
  };

  return (
    <div className="flex h-full flex-col p-4 sm:p-6">
      {/* Header */}
      <div className="mb-4 flex flex-col items-start justify-between gap-3 border-b border-border pb-4 sm:flex-row sm:gap-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground break-words">{fileName}</h3>
          <p className="mt-1 text-xs text-muted-foreground break-all">{selectedPath}</p>
          {!isBinaryFile && (
            <p className="mt-1 text-xs text-muted-foreground">
              last modified: {formatRelativeTime(file.lastModified)}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {isBinaryFile ? (
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download size={14} /> Download
            </Button>
          ) : isHtmlFile ? (
            <div className="flex gap-1">
              {(["preview", "source"] as const).map((v) => (
                <Button
                  key={v}
                  variant={htmlView === v ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setHtmlView(v)}
                >
                  {v === "preview" ? <><Eye size={14} /> Preview</> : <><Pencil size={14} /> Source</>}
                </Button>
              ))}
            </div>
          ) : (
            <Button
              variant={mode === "edit" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setMode(mode === "preview" ? "edit" : "preview")}
            >
              {mode === "preview" ? (
                <>
                  <Pencil size={14} /> Edit
                </>
              ) : (
                <>
                  <Eye size={14} /> Preview
                </>
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDeleteConfirm(true)}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 size={14} /> Delete
          </Button>
        </div>
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <Card className="mb-4 flex-row flex-wrap items-center justify-between gap-3 rounded-lg p-4 shadow-none">
          <p className="text-[13px] text-destructive">
            Delete {fileName}? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDeleteConfirm(false)}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </Card>
      )}

      {/* Conflict warning */}
      {conflict && (
        <Card className="mb-4 flex-row flex-wrap items-center justify-between gap-3 rounded-lg p-4 shadow-none">
          <p className="text-[13px] text-muted-foreground">
            This file was modified by another process. Reload?
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => selectedPath && fetchFile(selectedPath)}
            className="h-auto px-0 py-0 text-[13px] font-semibold text-primary underline hover:bg-transparent"
          >
            Reload
          </Button>
        </Card>
      )}

      {/* Content */}
      <div className="flex min-h-0 flex-1 flex-col">
        {isBinaryFile ? (
          <>
            {/* Image rendering */}
            {IMAGE_EXTENSIONS.has(ext) && (
              <div style={{ textAlign: "center", padding: "16px 0" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/files/preview?path=${encodeURIComponent(selectedPath)}`}
                  alt={fileName}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "70vh",
                    borderRadius: 8,
                    objectFit: "contain",
                    boxShadow: "0 2px 12px color-mix(in srgb, var(--foreground) 8%, transparent)",
                  }}
                />
              </div>
            )}

            {/* PDF rendering */}
            {ext === "pdf" && (
              <iframe
                src={`/api/files/preview?path=${encodeURIComponent(selectedPath)}`}
                title={fileName}
                style={{
                  width: "100%",
                  height: "70vh",
                  border: "none",
                  borderRadius: 8,
                }}
              />
            )}
          </>
        ) : isHtmlFile ? (
          htmlView === "preview" ? (
            <iframe
              src={`/api/files/preview?path=${encodeURIComponent(selectedPath)}`}
              title={fileName}
              sandbox="allow-scripts allow-same-origin"
              style={{
                flex: 1,
                width: "100%",
                minHeight: "70vh",
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--card)",
              }}
            />
          ) : (
            <MarkdownEditor
              content={file.content}
              onSave={handleSave}
              onCancel={() => setHtmlView("preview")}
              isSaving={isSaving}
            />
          )
        ) : mode === "preview" ? (
          <MarkdownPreview content={file.content} />
        ) : (
          <MarkdownEditor
            content={file.content}
            onSave={handleSave}
            onCancel={() => setMode("preview")}
            isSaving={isSaving}
          />
        )}
      </div>
    </div>
  );
}

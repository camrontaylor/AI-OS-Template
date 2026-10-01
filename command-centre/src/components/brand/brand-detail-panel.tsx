"use client";

import { useState, useEffect, useCallback } from "react";
import { Pencil, Eye } from "lucide-react";
import { SlideOutPanel } from "@/components/shared/slide-out-panel";
import { MarkdownPreview } from "@/components/shared/markdown-preview";
import { MarkdownEditor } from "@/components/shared/markdown-editor";
import { DeleteConfirmButton } from "@/components/shared/delete-confirm-button";
import { useClientId, appendClientId } from "@/hooks/use-client-id";
import type { FileContent } from "@/types/file";

interface BrandDetailPanelProps {
  path: string | null;
  onClose: () => void;
  onFileDeleted?: () => void;
}

function toTitleCase(name: string): string {
  return name
    .replace(/\.md$/, "")
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
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

export function BrandDetailPanel({ path, onClose, onFileDeleted }: BrandDetailPanelProps) {
  const clientId = useClientId();
  const [file, setFile] = useState<FileContent | null>(null);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFile = useCallback(async (filePath: string) => {
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
    if (path) {
      fetchFile(path);
    } else {
      setFile(null);
      setMode("preview");
    }
  }, [path, fetchFile]);

  const handleSave = async (content: string) => {
    if (!file || !path) return;
    setIsSaving(true);
    setConflict(false);
    try {
      const res = await fetch(appendClientId(`/api/files/${encodeURIComponent(path)}`, clientId), {
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
    if (!path) return;
    try {
      const res = await fetch(appendClientId(`/api/files/${encodeURIComponent(path)}`, clientId), {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      setFile(null);
      onClose();
      onFileDeleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const fileName = path ? path.split("/").pop() || path : "";
  const title = toTitleCase(fileName);

  return (
    <SlideOutPanel isOpen={!!path} onClose={onClose} title={title}>
      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[300, 180, 260].map((w, i) => (
            <div
              key={i}
              style={{
                height: 16,
                width: w,
                maxWidth: "100%",
                backgroundColor: "var(--cc-control-bg)",
                borderRadius: 4,
                animation: "pulse-dot 1.5s ease-in-out infinite",
              }}
            />
          ))}
        </div>
      )}

      {error && (
        <div
          style={{
            backgroundColor: "var(--cc-surface-danger-soft)",
            padding: 16,
            borderRadius: "0.375rem",
          }}
        >
          <p style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 14, color: "var(--cc-status-danger-alt)", fontWeight: 500, margin: 0 }}>
            {error}
          </p>
          <button
            onClick={() => path && fetchFile(path)}
            style={{
              background: "none",
              border: "none",
              color: "var(--cc-brand-primary)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              padding: 0,
              marginTop: 8,
              textDecoration: "underline",
            }}
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && file && (
        <>
          {/* File path + mode toggle */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
              paddingBottom: 12,
              borderBottom: "1px solid var(--cc-line-alpha-20)",
            }}
          >
            <div>
              <p
                style={{
                  fontFamily: "var(--font-space-grotesk), Space Grotesk, monospace",
                  fontSize: 11,
                  color: "var(--cc-text-secondary)",
                  margin: 0,
                }}
              >
                {path}
              </p>
              <p
                style={{
                  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                  fontSize: 11,
                  color: "var(--cc-text-secondary)",
                  margin: "2px 0 0",
                }}
              >
                last modified: {formatRelativeTime(file.lastModified)}
              </p>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setMode(mode === "preview" ? "edit" : "preview")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 14px",
                  border: "none",
                  borderRadius: "0.25rem",
                  backgroundColor: mode === "edit" ? "var(--cc-brand-soft)" : "var(--cc-surface-muted)",
                  color: mode === "edit" ? "var(--cc-brand-strong)" : "var(--cc-text-secondary)",
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "background 150ms ease",
                }}
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
              </button>
              <DeleteConfirmButton
                ariaLabel={`Delete ${fileName}`}
                onConfirm={handleDelete}
                variant="labeled"
                size="labeled"
                idleColor="var(--cc-text-secondary)"
                idleBackground="var(--cc-surface-muted)"
                hoverBackground="var(--cc-surface-danger-soft)"
              />
            </div>
          </div>

          {/* Conflict warning */}
          {conflict && (
            <div
              style={{
                backgroundColor: "var(--cc-surface)BEB",
                padding: 12,
                borderRadius: "0.375rem",
                marginBottom: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <p style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 13, color: "var(--cc-status-warning-strong)", margin: 0 }}>
                This file was modified by another process. Reload?
              </p>
              <button
                onClick={() => path && fetchFile(path)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--cc-brand-primary)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                Reload
              </button>
            </div>
          )}

          {/* Content */}
          {mode === "preview" ? (
            <MarkdownPreview content={file.content} />
          ) : (
            <MarkdownEditor
              content={file.content}
              onSave={handleSave}
              onCancel={() => setMode("preview")}
              isSaving={isSaving}
            />
          )}
        </>
      )}
    </SlideOutPanel>
  );
}

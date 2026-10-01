"use client";

import { useState, useEffect, useCallback } from "react";
import { Pencil, Eye, Download, UploadCloud } from "lucide-react";
import { MarkdownPreview } from "@/components/shared/markdown-preview";
import { MarkdownEditor } from "@/components/shared/markdown-editor";
import { DeleteConfirmButton } from "@/components/shared/delete-confirm-button";
import { SyncConflictModal, type SyncConflict } from "@/components/team/sync-conflict-modal";
import { useClientId, appendClientId } from "@/hooks/use-client-id";
import type { FileContent } from "@/types/file";
import { downloadAuthenticatedFile, useAuthenticatedFileUrl } from "@/hooks/use-authenticated-file";
import type { SkillOrigin } from "@/types/file";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"]);
const BINARY_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, "pdf"]);
const HTML_EXTENSIONS = new Set(["html", "htm"]);

interface ContentViewerProps {
  selectedPath: string | null;
  onFileDeleted?: () => void;
  apiSurface?: "docs";
  clientIdOverride?: string | null;
  enableTeamPush?: boolean;
  onFilePushed?: () => void;
  onFileChanged?: () => void;
  skillOrigin?: SkillOrigin;
  readOnly?: boolean;
}

interface TeamPushTarget {
  endpoint: "/api/team/brand-context" | "/api/team/sync-client";
  body: Record<string, unknown>;
}

export function getTeamPushTargetForDocs(input: {
  enableTeamPush: boolean;
  apiSurface?: "docs";
  filePath: string | null;
  clientId: string | null;
  isDirectoryPath: boolean;
}): TeamPushTarget | null {
  const { enableTeamPush, apiSurface, filePath, clientId, isDirectoryPath } = input;
  if (!enableTeamPush || apiSurface !== "docs" || !filePath || isDirectoryPath) return null;
  if (clientId && !isRootWorkspacePath(filePath)) {
    return { endpoint: "/api/team/sync-client", body: { client: clientId, path: filePath } };
  }
  if (filePath.startsWith("clients/")) {
    const [, slug, ...rest] = filePath.split("/");
    if (!slug || rest.length === 0) return null;
    return { endpoint: "/api/team/sync-client", body: { client: slug, path: filePath } };
  }
  if (filePath.startsWith("brand_context/") || filePath.startsWith("team_context/")) {
    return { endpoint: "/api/team/brand-context", body: { path: filePath } };
  }
  return null;
}

function appendParam(url: string, key: string, value: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function isRootWorkspacePath(filePath: string | null): boolean {
  return filePath === "clients" || Boolean(filePath?.startsWith("clients/"));
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

export function ContentViewer({
  selectedPath,
  onFileDeleted,
  apiSurface,
  clientIdOverride,
  enableTeamPush = false,
  onFilePushed,
  onFileChanged,
  skillOrigin,
  readOnly = false,
}: ContentViewerProps) {
  const storeClientId = useClientId();
  const clientId = clientIdOverride === undefined ? storeClientId : clientIdOverride;
  const [file, setFile] = useState<FileContent | null>(null);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushNotice, setPushNotice] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushReview, setPushReview] = useState<{ conflicts: SyncConflict[] } | null>(null);

  const getExtension = (p: string) => {
    const parts = p.split(".");
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
  };

  const isBinaryFile = selectedPath ? BINARY_EXTENSIONS.has(getExtension(selectedPath)) : false;
  const isHtmlFile = selectedPath ? HTML_EXTENSIONS.has(getExtension(selectedPath)) : false;
  const [htmlView, setHtmlView] = useState<"preview" | "source">("preview");
  // Treat paths without a file extension as directories — don't try to fetch as a file.
  const isDirectoryPath = selectedPath ? getExtension(selectedPath) === "" : false;
  const fileApiUrl = useCallback((url: string, filePath: string | null = selectedPath) => {
    const effectiveClientId = apiSurface === "docs" && isRootWorkspacePath(filePath) ? null : clientId;
    const withClient = appendClientId(url, effectiveClientId);
    const withSurface = apiSurface ? appendParam(withClient, "surface", apiSurface) : withClient;
    return skillOrigin ? appendParam(withSurface, "skillOrigin", skillOrigin) : withSurface;
  }, [apiSurface, clientId, selectedPath, skillOrigin]);

  const getPushTarget = useCallback((filePath: string | null): TeamPushTarget | null => {
    return getTeamPushTargetForDocs({ enableTeamPush, apiSurface, filePath, clientId, isDirectoryPath });
  }, [apiSurface, clientId, enableTeamPush, isDirectoryPath]);

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
      const res = await fetch(fileApiUrl(`/api/files/${encodeURIComponent(filePath)}`, filePath));
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => null);
        const message =
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Failed to load file";
        throw new Error(message);
      }
      const data: FileContent = await res.json();
      setFile(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load file");
      setFile(null);
    } finally {
      setLoading(false);
    }
  }, [fileApiUrl]);

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

  useEffect(() => {
    setPushNotice(null);
    setPushError(null);
    setPushReview(null);
  }, [selectedPath]);

  const runFilePush = async (overwrite = false) => {
    const target = getPushTarget(selectedPath);
    if (!target) return;
    setPushBusy(true);
    setPushNotice(null);
    setPushError(null);
    try {
      const response = await fetch(target.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...target.body, action: "push", overwrite }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 409 && Array.isArray(body.conflicts)) {
        setPushReview({ conflicts: body.conflicts });
        return;
      }
      if (!response.ok) throw new Error(body.error || "Push failed");
      const pushed = Number(body.filesPushed ?? 0);
      const deleted = Number(body.filesDeleted ?? 0);
      setPushNotice(body.upToDate
        ? "Already up to date."
        : `Pushed ${pushed} file${pushed === 1 ? "" : "s"}${deleted ? ` and deleted ${deleted}` : ""}.`);
      onFilePushed?.();
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "Push failed");
    } finally {
      setPushBusy(false);
    }
  };

  const handleSave = async (content: string) => {
    if (!file || !selectedPath || readOnly) return;
    setIsSaving(true);
    setConflict(false);
    try {
      const res = await fetch(fileApiUrl(`/api/files/${encodeURIComponent(selectedPath)}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, lastModified: file.lastModified }),
      });
      if (res.status === 409) {
        setConflict(true);
        return;
      }
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => null);
        const message =
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Save failed";
        throw new Error(message);
      }
      const updated: FileContent = await res.json();
      setFile(updated);
      setMode("preview");
      onFileChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedPath || readOnly) return;
    try {
      const res = await fetch(fileApiUrl(`/api/files/${encodeURIComponent(selectedPath)}`), {
        method: "DELETE",
      });
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => null);
        const message =
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Delete failed";
        throw new Error(message);
      }
      setFile(null);
      onFileDeleted?.();
      onFileChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const authenticatedPreviewUrl = useAuthenticatedFileUrl(
    selectedPath && /\.(?:png|jpe?g|gif|webp|svg|ico|pdf|html?)$/i.test(selectedPath)
      ? fileApiUrl(`/api/files/preview?path=${encodeURIComponent(selectedPath)}`)
      : null,
  );

  // Empty state
  if (!selectedPath) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          minHeight: 400,
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 14,
            color: "var(--cc-text-secondary)",
          }}
        >
          Select a file from the tree to view its contents
        </p>
      </div>
    );
  }

  // Directory placeholder — the tree highlights the folder, viewer waits for a file pick.
  if (isDirectoryPath) {
    const folderName = selectedPath.split("/").filter(Boolean).pop() || selectedPath;
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          minHeight: 400,
          padding: 24,
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 14,
            color: "var(--cc-text-secondary)",
            textAlign: "center",
          }}
        >
          <span style={{ fontWeight: 600, color: "var(--cc-text-primary)" }}>{folderName}</span>
          <br />
          Select a file from this folder in the tree to view it
        </p>
      </div>
    );
  }

  // Loading
  if (loading) {
    return (
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
        {[720, 200, 500, 350].map((w, i) => (
          <div
            key={i}
            style={{
              height: 16,
              width: Math.min(w, 720),
              maxWidth: "100%",
              backgroundColor: "var(--cc-control-bg)",
              borderRadius: 4,
              animation: "pulse-dot 1.5s ease-in-out infinite",
            }}
          />
        ))}
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <div
          style={{
            backgroundColor: "var(--cc-surface-danger-soft)",
            padding: 16,
            borderRadius: "0.5rem",
          }}
        >
          <p style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 14, color: "var(--cc-status-danger-alt)", fontWeight: 500, margin: 0 }}>
            Unable to read file
          </p>
          <p style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 13, color: "var(--cc-text-secondary)", margin: "8px 0 12px" }}>
            {error.includes("local-only action") || error.includes("hosted team mode")
              ? "This file is local only, so it is hidden while you are connected to the remote Team OS server. Sign out to edit local files, or use Team sync for granted client files."
              : error}
          </p>
          <button
            onClick={() => selectedPath && fetchFile(selectedPath)}
            style={{
              background: "none",
              border: "none",
              color: "var(--cc-brand-primary)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              padding: 0,
              textDecoration: "underline",
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!file) return null;

  const fileName = selectedPath.split("/").pop() || selectedPath;
  const ext = getExtension(selectedPath);
  const pushTarget = getPushTarget(selectedPath);

  const handleDownload = () => void downloadAuthenticatedFile(
    fileApiUrl(`/api/files/download?path=${encodeURIComponent(selectedPath)}`),
  );

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 16,
          paddingBottom: 16,
          borderBottom: "1px solid var(--cc-line-alpha-20)",
        }}
      >
        <div>
          <h3
            style={{
              fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
              fontWeight: 700,
              fontSize: 16,
              color: "var(--cc-text-primary)",
              margin: 0,
            }}
          >
            {fileName}
          </h3>
          <p
            style={{
              fontFamily: "var(--font-space-grotesk), Space Grotesk, monospace",
              fontSize: 11,
              color: "var(--cc-text-secondary)",
              margin: "4px 0 0",
            }}
          >
            {selectedPath}
          </p>
          {!isBinaryFile && (
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
          )}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {isBinaryFile ? (
            <button
              onClick={handleDownload}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 14px",
                border: "none",
                borderRadius: "0.25rem",
                backgroundColor: "var(--cc-surface-muted)",
                color: "var(--cc-text-secondary)",
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                transition: "background 150ms ease",
              }}
            >
              <Download size={14} /> Download
            </button>
          ) : isHtmlFile && !readOnly ? (
            <div style={{ display: "flex", gap: 4 }}>
              {(["preview", "source"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setHtmlView(v)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 14px",
                    border: "none",
                    borderRadius: "0.25rem",
                    backgroundColor: htmlView === v ? "var(--cc-brand-soft)" : "var(--cc-surface-muted)",
                    color: htmlView === v ? "var(--cc-brand-strong)" : "var(--cc-text-secondary)",
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "background 150ms ease",
                  }}
                >
                  {v === "preview" ? <><Eye size={14} /> Preview</> : <><Pencil size={14} /> Source</>}
                </button>
              ))}
            </div>
          ) : !isHtmlFile && !readOnly ? (
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
          ) : null}
          {pushTarget && (
            <button
              onClick={() => runFilePush(false)}
              disabled={pushBusy}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 14px",
                border: "1px solid var(--cc-line-alpha-25)",
                borderRadius: "0.25rem",
                backgroundColor: "var(--cc-surface-muted)",
                color: "var(--cc-text-secondary)",
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 13,
                fontWeight: 500,
                cursor: pushBusy ? "not-allowed" : "pointer",
                opacity: pushBusy ? 0.6 : 1,
              }}
            >
              <UploadCloud size={14} /> {pushBusy ? "Pushing..." : "Push file"}
            </button>
          )}
          {!readOnly && (
            <DeleteConfirmButton
              ariaLabel={`Delete ${fileName}`}
              onConfirm={handleDelete}
              variant="labeled"
              size="labeled"
              idleColor="var(--cc-text-secondary)"
              idleBackground="var(--cc-surface-muted)"
              hoverBackground="var(--cc-surface-danger-soft)"
            />
          )}
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
            onClick={() => selectedPath && fetchFile(selectedPath)}
            style={{
              background: "none",
              border: "none",
              color: "var(--cc-brand-primary)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
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

      {(pushNotice || pushError) && (
        <div
          style={{
            backgroundColor: pushError ? "var(--cc-surface-danger-soft)" : "rgba(111, 111, 111, 0.08)",
            padding: 12,
            borderRadius: "0.375rem",
            marginBottom: 16,
            color: pushError ? "var(--cc-status-danger-alt)" : "#6F6F6F",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {pushError || pushNotice}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {isBinaryFile ? (
          <>
            {/* Image rendering */}
            {IMAGE_EXTENSIONS.has(ext) && (
              <div style={{ textAlign: "center", padding: "16px 0" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={authenticatedPreviewUrl ?? undefined}
                  alt={fileName}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "70vh",
                    borderRadius: 8,
                    objectFit: "contain",
                    boxShadow: "0 2px 12px var(--cc-neutral-alpha-08)",
                  }}
                />
              </div>
            )}

            {/* PDF rendering */}
            {ext === "pdf" && (
              <iframe
                src={authenticatedPreviewUrl ?? undefined}
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
          htmlView === "preview" || readOnly ? (
            <iframe
              src={authenticatedPreviewUrl ?? undefined}
              title={fileName}
              sandbox="allow-scripts allow-same-origin"
              style={{
                flex: 1,
                width: "100%",
                minHeight: "70vh",
                border: "1px solid var(--cc-control-bg)",
                borderRadius: 8,
                background: "var(--cc-surface)",
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
        ) : mode === "preview" || readOnly ? (
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
      {pushReview && (
        <SyncConflictModal
          title="Review push diff"
          direction="push"
          conflicts={pushReview.conflicts}
          busy={pushBusy}
          confirmLabel="Push to server"
          onCancel={() => setPushReview(null)}
          onOverwrite={() => {
            setPushReview(null);
            void runFilePush(true);
          }}
        />
      )}
    </div>
  );
}

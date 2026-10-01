"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Plus,
  ArrowLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { MarkdownPreview } from "../shared/markdown-preview";
import { ResizablePane } from "../shared/resizable-pane";
import { ScopedFileTree } from "../shared/scoped-file-tree";
import { getFileIcon, getFileIconColor } from "@/lib/file-icons";
import { appendClientId } from "@/hooks/use-client-id";
import { downloadAuthenticatedFile, useAuthenticatedFileUrl } from "@/hooks/use-authenticated-file";

interface ModalFilePreviewProps {
  fileName: string;
  relativePath: string;
  clientId?: string | null;
  onBack: () => void;
  onNewTask: (fileName: string, relativePath: string) => void;
  /** Optional: called when the user picks a sibling file in the sidebar. */
  onSelectFile?: (relativePath: string) => void;
}

const SIDEBAR_OPEN_KEY = "modal-file-sidebar-open";

/** Pick a sensible tree root so the sidebar shows relevant siblings, not the whole workspace. */
function computeRootDir(relativePath: string): string {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length === 0) return "";
  // projects/briefs/{slug}/… → root at the project folder
  if (parts[0] === "projects" && parts[1] === "briefs" && parts.length >= 3) {
    return `projects/briefs/${parts[2]}`;
  }
  // projects/{category}-{type}/… → root at that category folder
  if (parts[0] === "projects" && parts.length >= 2) {
    return `projects/${parts[1]}`;
  }
  // Any other top-level section (context, brand_context, docs, …)
  return parts[0];
}

export function ModalFilePreview({
  fileName,
  relativePath,
  clientId = null,
  onBack,
  onNewTask,
  onSelectFile,
}: ModalFilePreviewProps) {
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const stored = window.localStorage.getItem(SIDEBAR_OPEN_KEY);
      if (stored === "false") return false;
      if (stored === "true") return true;
    } catch {
      // ignore
    }
    return true;
  });

  const isHtml = /\.(html?|htm)$/i.test(fileName);
  const fileUrl = useMemo(
    () => appendClientId(`/api/files/${relativePath}`, clientId),
    [clientId, relativePath],
  );
  const previewUrl = useMemo(
    () => appendClientId(`/api/files/preview?path=${encodeURIComponent(relativePath)}`, clientId),
    [clientId, relativePath],
  );
  const downloadUrl = useMemo(
    () => appendClientId(`/api/files/download?path=${encodeURIComponent(relativePath)}`, clientId),
    [clientId, relativePath],
  );
  const authenticatedPreviewUrl = useAuthenticatedFileUrl(
    isHtml || /\.(?:png|jpe?g|gif|webp|svg|pdf)$/i.test(fileName) ? previewUrl : null,
  );

  useEffect(() => {
    // HTML files are rendered directly in an iframe — no need to fetch content.
    if (isHtml) {
      setIsLoading(false);
      setError(null);
      setContent("");
      return;
    }
    setIsLoading(true);
    setError(null);
    fetch(fileUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load file");
        const json = await res.json();
        setContent(json.content);
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [fileUrl, isHtml]);

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_OPEN_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const isMarkdown = fileName.endsWith(".md") || fileName.endsWith(".mdx");
  const isImage = /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(fileName);

  const rootDir = useMemo(() => computeRootDir(relativePath), [relativePath]);

  const breadcrumbSegments = useMemo(() => {
    const parts = relativePath.split("/").filter(Boolean);
    return parts.map((segment, i) => ({
      label: segment,
      isLast: i === parts.length - 1,
    }));
  }, [relativePath]);

  const FileTypeIcon = getFileIcon(fileName);
  const fileTypeColor = getFileIconColor(fileName);

  const sidebar = sidebarOpen ? (
    <div
      style={{
        backgroundColor: "var(--cc-canvas-subtle)",
        borderRight: "1px solid var(--cc-control-bg)",
        display: "flex",
        flexDirection: "column",
        width: "100%",
        overflow: "hidden",
      }}
    >
      <ScopedFileTree
        rootDir={rootDir}
        selectedPath={relativePath}
        clientId={clientId}
        onSelectFile={(path) => onSelectFile?.(path)}
      />
    </div>
  ) : null;

  const mainContent = (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        width: "100%",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 20px",
          borderBottom: "1px solid var(--cc-control-bg)",
          backgroundColor: "var(--cc-canvas-subtle)",
          flexShrink: 0,
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          <button
            onClick={toggleSidebar}
            title={sidebarOpen ? "Hide file tree" : "Show file tree"}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              padding: 4,
              borderRadius: 4,
              color: "var(--cc-text-secondary)",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cc-control-bg)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
          >
            {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <button
            onClick={onBack}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 13,
              fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
              color: "var(--cc-brand-primary)",
              padding: "4px 8px",
              borderRadius: 4,
              flexShrink: 0,
            }}
          >
            <ArrowLeft size={14} />
            Back
          </button>

          {/* Breadcrumbs */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              minWidth: 0,
              overflow: "hidden",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 12,
              color: "var(--cc-text-secondary)",
            }}
            title={relativePath}
          >
            {breadcrumbSegments.map((seg, i) => (
              <span
                key={i}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 2,
                  minWidth: 0,
                  flexShrink: i === breadcrumbSegments.length - 1 ? 1 : 0,
                }}
              >
                {i > 0 && (
                  <ChevronRight
                    size={12}
                    style={{ color: "var(--cc-text-tertiary)", flexShrink: 0, margin: "0 1px" }}
                  />
                )}
                {seg.isLast ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontWeight: 600,
                      color: "var(--cc-text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <FileTypeIcon
                      size={13}
                      style={{ color: fileTypeColor, flexShrink: 0 }}
                    />
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {seg.label}
                    </span>
                  </span>
                ) : (
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {seg.label}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => onNewTask(fileName, relativePath)}
            title="New task from this output"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
              color: "var(--cc-brand-primary)",
              backgroundColor: "var(--cc-brand-alpha-08)",
              border: "none",
              borderRadius: 6,
              padding: "6px 12px",
              cursor: "pointer",
              transition: "background 150ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--cc-brand-alpha-15)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--cc-brand-alpha-08)"; }}
          >
            <Plus size={12} />
            New task from output
          </button>
          <button
            onClick={() => {
              void downloadAuthenticatedFile(downloadUrl);
            }}
            title="Download"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
              color: "var(--cc-text-secondary)",
              backgroundColor: "var(--cc-control-bg)",
              border: "none",
              borderRadius: 6,
              padding: "6px 12px",
              cursor: "pointer",
              transition: "background 150ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--cc-palette-neutral-400)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--cc-control-bg)"; }}
          >
            <Download size={12} />
            Download
          </button>
        </div>
      </div>

      {/* Content area */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "24px",
          minHeight: 0,
        }}
      >
        {isLoading && (
          <div style={{ textAlign: "center", padding: 32, color: "var(--cc-text-secondary)", fontSize: 14, fontFamily: "var(--font-inter), Inter, sans-serif" }}>
            Loading file...
          </div>
        )}

        {error && (
          <div style={{ textAlign: "center", padding: 32, color: "var(--cc-status-danger)", fontSize: 14, fontFamily: "var(--font-inter), Inter, sans-serif" }}>
            {error}
          </div>
        )}

        {!isLoading && !error && isHtml && (
          <iframe
            src={authenticatedPreviewUrl ?? undefined}
            title={fileName}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            style={{
              width: "100%",
              height: "100%",
              minHeight: "70vh",
              border: "1px solid var(--cc-control-bg)",
              borderRadius: 8,
              backgroundColor: "var(--cc-surface)",
            }}
          />
        )}

        {!isLoading && !error && !isHtml && content !== null && (
          <>
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={authenticatedPreviewUrl ?? undefined}
                alt={fileName}
                style={{ maxWidth: "100%", borderRadius: 8 }}
              />
            ) : isMarkdown ? (
              <MarkdownPreview content={content} />
            ) : (
              <pre
                style={{
                  fontSize: 13,
                  fontFamily: "var(--font-space-grotesk), Space Grotesk, monospace",
                  color: "var(--cc-text-primary)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  lineHeight: 1.6,
                }}
              >
                {content}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  );

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minHeight: 0,
      }}
    >
      {sidebarOpen && onSelectFile ? (
        <ResizablePane
          storageKey="modal-file-sidebar-width"
          initialLeft={220}
          minLeft={160}
          maxLeft={420}
          style={{ flex: 1, minHeight: 0 }}
          left={sidebar!}
          right={mainContent}
        />
      ) : (
        mainContent
      )}
    </div>
  );
}

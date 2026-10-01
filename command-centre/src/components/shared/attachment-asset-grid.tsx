"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, FileType, Image as ImageIcon, LoaderCircle, RotateCcw, X } from "lucide-react";
import type { ChatComposerSurface } from "@/types/chat-composer";
import { useAuthenticatedFileUrl } from "@/hooks/use-authenticated-file";

export interface AttachmentAssetItem {
  id: string;
  fileName: string;
  extension?: string;
  sizeBytes?: number | null;
  contentType?: string | null;
  previewPath?: string | null;
  previewSurface?: ChatComposerSurface | null;
  previewScopeId?: string | null;
  previewClientId?: string | null;
  status?: "ready" | "uploading" | "failed";
  error?: string;
}

interface AttachmentAssetGridProps {
  items: AttachmentAssetItem[];
  compact?: boolean;
  padding?: string;
  onRemoveItem?: (itemId: string) => void;
  onRetryItem?: (itemId: string) => void;
}

interface PreviewState {
  status: "idle" | "loading" | "ready" | "error";
  content: string | null;
  message: string | null;
}

interface PdfPreviewState {
  status: "idle" | "loading" | "ready" | "error";
  imageUrl: string | null;
  message: string | null;
}

type ResolvedPdfPreview =
  | { status: "ready"; imageUrl: string }
  | { status: "error"; message: string };

type CachedPdfPreview =
  | { status: "ready"; imageUrl: string }
  | { status: "error"; message: string }
  | { status: "loading"; promise: Promise<ResolvedPdfPreview> };

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"]);
const MONO = "'DM Mono', monospace";
const pdfPreviewCache = new Map<string, CachedPdfPreview>();
let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

function getAttachmentExtension(item: AttachmentAssetItem): string {
  if (item.extension) return item.extension.toLowerCase();
  const lastDot = item.fileName.lastIndexOf(".");
  return lastDot >= 0 ? item.fileName.slice(lastDot + 1).toLowerCase() : "";
}

function isImageAsset(item: AttachmentAssetItem): boolean {
  const extension = getAttachmentExtension(item);
  return IMAGE_EXTENSIONS.has(extension) || item.contentType?.startsWith("image/") === true;
}

function isPdfAsset(item: AttachmentAssetItem): boolean {
  return getAttachmentExtension(item) === "pdf" || item.contentType === "application/pdf";
}

function formatBytes(sizeBytes?: number | null): string {
  if (!sizeBytes || sizeBytes <= 0) return "Unknown size";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getAttachmentIcon(item: AttachmentAssetItem) {
  if (isImageAsset(item)) return ImageIcon;
  if (isPdfAsset(item)) return FileType;
  return FileText;
}

function getAttachmentTypeLabel(item: AttachmentAssetItem): string {
  const extension = getAttachmentExtension(item);
  return extension ? extension.toUpperCase() : "FILE";
}

function buildPreviewUrl(item: AttachmentAssetItem): string | null {
  if (!item.previewPath) return null;

  const params = new URLSearchParams();
  params.set("path", item.previewPath);
  if (item.previewSurface) params.set("surface", item.previewSurface);
  if (item.previewScopeId) params.set("scopeId", item.previewScopeId);
  if (item.previewClientId) params.set("clientId", item.previewClientId);
  return `/api/files/preview?${params.toString()}`;
}

async function readPreviewError(response: Response): Promise<string> {
  const responseType = response.headers.get("content-type") ?? "";
  let message = "Preview is not available for this file.";

  try {
    if (responseType.includes("application/json")) {
      const data = await response.json();
      if (typeof data.error === "string" && data.error) {
        return data.error;
      }
      if (typeof data.message === "string" && data.message) {
        return data.message;
      }
      return message;
    }

    const text = await response.text();
    if (text.trim()) {
      return text.trim();
    }
  } catch {
    return message;
  }

  return message;
}

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((module) => {
      if (typeof window !== "undefined") {
        const workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
        if (module.GlobalWorkerOptions.workerSrc !== workerSrc) {
          module.GlobalWorkerOptions.workerSrc = workerSrc;
        }
      }
      return module;
    });
  }

  return pdfJsModulePromise;
}

async function renderPdfPreview(previewUrl: string): Promise<ResolvedPdfPreview> {
  const cached = pdfPreviewCache.get(previewUrl);
  if (cached?.status === "ready") {
    return { status: "ready", imageUrl: cached.imageUrl };
  }
  if (cached?.status === "error") {
    return { status: "error", message: cached.message };
  }
  if (cached?.status === "loading") {
    return cached.promise;
  }

  const promise = (async () => {
    try {
      const response = await fetch(previewUrl);
      if (!response.ok) {
        return {
          status: "error" as const,
          message: await readPreviewError(response),
        };
      }

      const pdfjs = await loadPdfJs();
      const pdfBytes = await response.arrayBuffer();
      const loadingTask = pdfjs.getDocument({ data: pdfBytes });

      try {
        const pdfDocument = await loadingTask.promise;
        const page = await pdfDocument.getPage(1);
        const baseViewport = page.getViewport({ scale: 1 });
        const targetWidth = 920;
        const scale = Math.min(2.2, Math.max(1.1, targetWidth / baseViewport.width));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { alpha: false });

        if (!context) {
          return {
            status: "error" as const,
            message: "PDF preview is not available in this browser.",
          };
        }

        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        context.fillStyle = "var(--cc-surface)";
        context.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({
          canvas,
          canvasContext: context,
          viewport,
        }).promise;

        const imageUrl = canvas.toDataURL("image/jpeg", 0.9);
        page.cleanup();
        pdfDocument.cleanup();

        return {
          status: "ready" as const,
          imageUrl,
        };
      } finally {
        void loadingTask.destroy();
      }
    } catch {
      return {
        status: "error" as const,
        message: "PDF preview failed to load.",
      };
    }
  })();

  pdfPreviewCache.set(previewUrl, { status: "loading", promise });
  const result = await promise;
  pdfPreviewCache.set(previewUrl, result);
  return result;
}

function getInitialPdfPreviewState(previewUrl: string | null, enabled: boolean): PdfPreviewState {
  if (!previewUrl || !enabled) {
    return { status: "idle", imageUrl: null, message: null };
  }

  const cached = pdfPreviewCache.get(previewUrl);
  if (cached?.status === "ready") {
    return { status: "ready", imageUrl: cached.imageUrl, message: null };
  }
  if (cached?.status === "error") {
    return { status: "error", imageUrl: null, message: cached.message };
  }

  return { status: "loading", imageUrl: null, message: null };
}

function usePdfPreview(previewUrl: string | null, enabled: boolean): PdfPreviewState {
  const [state, setState] = useState<PdfPreviewState>(() => getInitialPdfPreviewState(previewUrl, enabled));

  useEffect(() => {
    setState(getInitialPdfPreviewState(previewUrl, enabled));

    if (!previewUrl || !enabled) {
      return;
    }

    let isCancelled = false;

    void renderPdfPreview(previewUrl).then((result) => {
      if (isCancelled) return;
      if (result.status === "ready") {
        setState({ status: "ready", imageUrl: result.imageUrl, message: null });
        return;
      }
      setState({ status: "error", imageUrl: null, message: result.message });
    });

    return () => {
      isCancelled = true;
    };
  }, [enabled, previewUrl]);

  return state;
}

function AttachmentPreviewFallback({
  item,
  compact,
  accentColor,
}: {
  item: AttachmentAssetItem;
  compact?: boolean;
  accentColor: string;
}) {
  const Icon = getAttachmentIcon(item);

  return (
    <div
      style={{
        flex: 1,
        minHeight: compact ? 64 : 76,
        borderRadius: 10,
        background:
          item.status === "failed"
            ? "linear-gradient(180deg, var(--cc-surface-overlay), var(--cc-surface-overlay))"
            : "linear-gradient(180deg, var(--cc-surface-overlay), var(--cc-surface-overlay))",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "10px 12px",
        textAlign: "center",
        overflow: "hidden",
      }}
    >
      <Icon size={compact ? 22 : 26} style={{ color: accentColor, flexShrink: 0 }} />
      <span
        style={{
          fontSize: compact ? 10 : 11,
          lineHeight: 1.35,
          fontFamily: MONO,
          color: item.status === "failed" ? "var(--cc-status-danger)" : "var(--cc-palette-neutral-650)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: compact ? 2 : 3,
          wordBreak: "break-word",
        }}
      >
        {item.fileName}
      </span>
    </div>
  );
}

function AttachmentPreviewLoading({
  compact,
  label,
}: {
  compact?: boolean;
  label?: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: compact ? 64 : 76,
        borderRadius: 10,
        background: "linear-gradient(180deg, var(--cc-surface-overlay), var(--cc-surface-overlay))",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "10px 12px",
        color: "var(--cc-palette-neutral-650)",
        textAlign: "center",
      }}
    >
      <LoaderCircle size={compact ? 18 : 20} style={{ animation: "spin 1s linear infinite" }} />
      <span
        style={{
          fontSize: compact ? 10 : 11,
          lineHeight: 1.35,
          fontFamily: MONO,
        }}
      >
        {label ?? "Loading preview..."}
      </span>
    </div>
  );
}

function PdfAttachmentPreviewFrame({
  item,
  previewUrl,
  compact,
}: {
  item: AttachmentAssetItem;
  previewUrl: string;
  compact?: boolean;
}) {
  const pdfPreview = usePdfPreview(previewUrl, true);

  if (pdfPreview.status === "loading" || pdfPreview.status === "idle") {
    return <AttachmentPreviewLoading compact={compact} label="Rendering PDF..." />;
  }

  if (pdfPreview.status === "ready" && pdfPreview.imageUrl) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: compact ? 64 : 76,
          borderRadius: 10,
          backgroundColor: "var(--cc-surface-soft)",
          padding: compact ? 6 : 7,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        <img
          src={pdfPreview.imageUrl}
          alt={`${item.fileName} preview`}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            borderRadius: 8,
            backgroundColor: "var(--cc-surface)",
            boxShadow: "0 10px 26px var(--cc-neutral-alpha-12)",
          }}
        />
      </div>
    );
  }

  return <AttachmentPreviewFallback item={item} compact={compact} accentColor="var(--cc-brand-primary)" />;
}

function AttachmentPreviewFrame({
  item,
  previewUrl,
  compact,
}: {
  item: AttachmentAssetItem;
  previewUrl: string;
  compact?: boolean;
}) {
  const authenticatedImageUrl = useAuthenticatedFileUrl(isImageAsset(item) ? previewUrl : null);
  if (isImageAsset(item)) {
    if (!authenticatedImageUrl) return <AttachmentPreviewFallback item={item} compact={compact} accentColor="var(--cc-brand-primary)" />;
    return (
      <img
        src={authenticatedImageUrl}
        alt={item.fileName}
        style={{
          width: "100%",
          flex: 1,
          minHeight: compact ? 64 : 76,
          borderRadius: 10,
          objectFit: "cover",
          backgroundColor: "var(--cc-surface-soft)",
          pointerEvents: "none",
        }}
      />
    );
  }

  if (isPdfAsset(item)) {
    return <PdfAttachmentPreviewFrame item={item} previewUrl={previewUrl} compact={compact} />;
  }

  return <AttachmentPreviewFallback item={item} compact={compact} accentColor="var(--cc-palette-neutral-650)" />;
}

function AttachmentPreviewModal({
  item,
  open,
  onClose,
}: {
  item: AttachmentAssetItem;
  open: boolean;
  onClose: () => void;
}) {
  const previewUrl = useMemo(() => buildPreviewUrl(item), [item]);
  const isImage = isImageAsset(item);
  const isPdf = isPdfAsset(item);
  const authenticatedImageUrl = useAuthenticatedFileUrl(isImage && open ? previewUrl : null);
  const pdfPreview = usePdfPreview(previewUrl, open && isPdf);
  const [previewState, setPreviewState] = useState<PreviewState>({
    status: "idle",
    content: null,
    message: null,
  });

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open || !previewUrl || isImage || isPdf) {
      setPreviewState({ status: "idle", content: null, message: null });
      return;
    }

    let isCancelled = false;
    setPreviewState({ status: "loading", content: null, message: null });

    void fetch(previewUrl)
      .then(async (response) => {
        const responseType = response.headers.get("content-type") ?? "";

        if (!response.ok) {
          if (!isCancelled) {
            setPreviewState({
              status: "error",
              content: null,
              message: await readPreviewError(response),
            });
          }
          return;
        }

        if (responseType.includes("application/json")) {
          const data = await response.json();
          if (typeof data.content === "string") {
            if (!isCancelled) {
              setPreviewState({ status: "ready", content: data.content, message: null });
            }
            return;
          }

          const message =
            data?.truncated
              ? "Preview is too large to show inline."
              : "Preview is not available for this file.";
          if (!isCancelled) {
            setPreviewState({ status: "error", content: null, message });
          }
          return;
        }

        const text = await response.text();
        if (!isCancelled) {
          setPreviewState({ status: "ready", content: text, message: null });
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setPreviewState({
            status: "error",
            content: null,
            message: "Preview failed to load.",
          });
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isImage, isPdf, open, previewUrl]);

  if (!open) return null;

  if ((isImage && authenticatedImageUrl) || isPdf) {
    const media = isImage && authenticatedImageUrl ? (
      <img
        src={authenticatedImageUrl}
        alt={item.fileName}
        style={{
          display: "block",
          maxWidth: "100%",
          maxHeight: "calc(100vh - 180px)",
          objectFit: "contain",
          borderRadius: 18,
          boxShadow: "0 18px 48px var(--cc-neutral-alpha-25)",
        }}
      />
    ) : pdfPreview.status === "ready" && pdfPreview.imageUrl ? (
      <div
        style={{
          padding: 16,
          borderRadius: 22,
          background: "linear-gradient(180deg, var(--cc-surface-overlay), var(--cc-surface-overlay))",
          boxShadow: "0 18px 48px var(--cc-neutral-alpha-25)",
        }}
      >
        <img
          src={pdfPreview.imageUrl}
          alt={`${item.fileName} first page`}
          style={{
            display: "block",
            maxWidth: "min(82vw, 720px)",
            maxHeight: "calc(100vh - 220px)",
            objectFit: "contain",
            borderRadius: 14,
            backgroundColor: "var(--cc-surface)",
          }}
        />
      </div>
    ) : pdfPreview.status === "error" ? (
      <div
        style={{
          minWidth: 280,
          maxWidth: 420,
          padding: "24px 28px",
          borderRadius: 18,
          backgroundColor: "var(--cc-surface-overlay)",
          color: "var(--cc-palette-code-bg)",
          textAlign: "center",
          lineHeight: 1.5,
          fontFamily: "var(--font-inter), Inter, sans-serif",
        }}
      >
        {pdfPreview.message || "PDF preview failed to load."}
      </div>
    ) : (
      <div
        style={{
          minWidth: 220,
          minHeight: 220,
          borderRadius: 18,
          backgroundColor: "var(--cc-surface-overlay)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--cc-palette-neutral-650)",
          fontFamily: MONO,
          padding: 24,
        }}
      >
        <LoaderCircle size={20} style={{ animation: "spin 1s linear infinite" }} />
      </div>
    );

    return (
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "var(--cc-neutral-alpha-40)",
          backdropFilter: "blur(8px)",
          zIndex: 320,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${item.fileName} preview`}
          onClick={(event) => event.stopPropagation()}
          style={{
            width: "min(1100px, 94vw)",
            maxWidth: "94vw",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 18,
          }}
        >
          <div
            style={{
              width: "100%",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 16,
              color: "var(--cc-surface-muted)",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  fontFamily: MONO,
                  color: "var(--cc-canvas-overlay-80)",
                }}
              >
                {getAttachmentTypeLabel(item)}
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 16,
                  lineHeight: 1.4,
                  fontWeight: 600,
                  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                  wordBreak: "break-word",
                }}
              >
                {item.fileName}
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 11,
                  lineHeight: 1.45,
                  color: "var(--cc-canvas-overlay-80)",
                  fontFamily: MONO,
                }}
              >
                {formatBytes(item.sizeBytes)}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 38,
                height: 38,
                borderRadius: 999,
                border: "1px solid var(--cc-neutral-alpha-15)",
                backgroundColor: "var(--cc-neutral-alpha-08)",
                color: "var(--cc-surface-muted)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <X size={18} />
            </button>
          </div>
          <div
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 0,
            }}
          >
            {media}
          </div>
        </div>
      </div>
    );
  }

  const previewContent = (() => {
    if (previewState.status === "loading") {
      return (
        <div
          style={{
            flex: 1,
            minHeight: 280,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            color: "var(--cc-palette-neutral-650)",
            fontFamily: MONO,
          }}
        >
          <LoaderCircle size={18} style={{ animation: "spin 1s linear infinite" }} />
          Loading preview...
        </div>
      );
    }

    if (previewState.status === "ready" && previewState.content !== null) {
      return (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: "20px 24px 24px",
            backgroundColor: "var(--cc-surface)",
          }}
        >
          <pre
            style={{
              margin: 0,
              fontSize: 12,
              lineHeight: 1.55,
              color: "var(--cc-palette-code-bg)",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
              fontFamily: MONO,
            }}
          >
            {previewState.content}
          </pre>
        </div>
      );
    }

    return (
      <div
        style={{
          flex: 1,
          minHeight: 280,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
          textAlign: "center",
          color: "var(--cc-palette-neutral-650)",
          fontFamily: "var(--font-inter), Inter, sans-serif",
          lineHeight: 1.5,
          backgroundColor: "var(--cc-surface)",
        }}
      >
        {previewState.message || "Preview is not available for this file."}
      </div>
    );
  })();

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "var(--cc-canvas-overlay-82)",
        backdropFilter: "blur(10px)",
        zIndex: 320,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${item.fileName} preview`}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(900px, 94vw)",
          maxHeight: "86vh",
          backgroundColor: "var(--cc-surface)",
          borderRadius: 14,
          boxShadow: "0 20px 60px var(--cc-brand-alpha-12)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            padding: "18px 20px 14px",
            borderBottom: "1px solid var(--cc-line-alpha-22)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--cc-brand-primary)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
              }}
            >
              {getAttachmentTypeLabel(item)}
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 13,
                color: "var(--cc-palette-code-bg)",
                lineHeight: 1.45,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                wordBreak: "break-word",
              }}
            >
              {item.fileName}
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                color: "var(--cc-palette-neutral-600)",
                lineHeight: 1.45,
                fontFamily: MONO,
              }}
            >
              {formatBytes(item.sizeBytes)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: 8,
              border: "none",
              backgroundColor: "transparent",
              color: "var(--cc-text-secondary)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <X size={18} />
          </button>
        </div>
        {previewContent}
      </div>
    </div>
  );
}

export function AttachmentAssetCard({
  item,
  compact,
  onRemoveItem,
  onRetryItem,
}: {
  item: AttachmentAssetItem;
  compact?: boolean;
  onRemoveItem?: (itemId: string) => void;
  onRetryItem?: (itemId: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const previewUrl = useMemo(() => buildPreviewUrl(item), [item]);
  const showActions = hovered || focused || item.status === "failed";
  const isReady = (item.status ?? "ready") === "ready";
  const accentColor = item.status === "failed" ? "var(--cc-status-danger)" : "var(--cc-brand-primary)";
  const canPreview = Boolean(previewUrl) && isReady;

  return (
    <>
      <div
        role={canPreview ? "button" : undefined}
        tabIndex={canPreview ? 0 : -1}
        onClick={() => {
          if (canPreview) setShowPreview(true);
        }}
        onKeyDown={(event) => {
          if (!canPreview) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setShowPreview(true);
          }
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          flex: compact ? "0 1 148px" : "0 1 164px",
          maxWidth: compact ? 148 : 164,
          minWidth: 0,
          minHeight: compact ? 118 : 132,
          padding: compact ? 9 : 10,
          borderRadius: 12,
          border: showActions
            ? `1px solid ${item.status === "failed" ? "var(--cc-border-danger)" : "var(--cc-brand-alpha-30)"}`
            : "1px solid var(--cc-line-alpha-34)",
          background:
            item.status === "failed"
              ? "linear-gradient(180deg, var(--cc-surface-overlay), var(--cc-surface-overlay))"
              : "linear-gradient(180deg, var(--cc-surface-overlay), var(--cc-canvas-overlay-92))",
          boxShadow: showActions
            ? "0 8px 24px var(--cc-brand-alpha-08)"
            : "0 1px 4px var(--cc-neutral-alpha-04)",
          cursor: canPreview ? "pointer" : "default",
          outline: "none",
          transition: "border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease",
          transform: showActions ? "translateY(-1px)" : "translateY(0)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: 20,
              padding: "0 7px",
              borderRadius: 999,
              backgroundColor:
                item.status === "failed" ? "var(--cc-status-danger-bg)" : "var(--cc-neutral-alpha-08)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: item.status === "failed" ? "var(--cc-status-danger)" : "var(--cc-palette-neutral-700)",
              fontFamily: MONO,
              textTransform: "uppercase",
            }}
          >
            {getAttachmentTypeLabel(item)}
          </span>
          {onRemoveItem ? (
            <button
              type="button"
              aria-label={`Remove ${item.fileName}`}
              onClick={(event) => {
                event.stopPropagation();
                onRemoveItem(item.id);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 22,
                height: 22,
                borderRadius: 999,
                border: "none",
                backgroundColor: showActions ? "var(--cc-neutral-alpha-08)" : "transparent",
                color: item.status === "failed" ? "var(--cc-status-danger)" : "var(--cc-palette-neutral-550)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <X size={13} />
            </button>
          ) : null}
        </div>

        {previewUrl && isReady ? (
          <AttachmentPreviewFrame item={item} previewUrl={previewUrl} compact={compact} />
        ) : (
          <AttachmentPreviewFallback item={item} compact={compact} accentColor={accentColor} />
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span
            style={{
              fontSize: compact ? 11 : 12,
              lineHeight: 1.35,
              color: "var(--cc-palette-code-bg)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={item.fileName}
          >
            {item.fileName}
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minHeight: 20,
            }}
          >
            <span
              style={{
                fontSize: 10,
                color: item.status === "failed" ? "var(--cc-status-danger)" : "var(--cc-palette-neutral-550)",
                fontFamily: MONO,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
              }}
              title={item.error || formatBytes(item.sizeBytes)}
            >
              {item.status === "uploading"
                ? "Uploading..."
                : item.status === "failed"
                  ? item.error || "Upload failed"
                  : formatBytes(item.sizeBytes)}
            </span>
            {item.status === "uploading" ? (
              <LoaderCircle size={13} style={{ color: "var(--cc-brand-primary)", animation: "spin 1s linear infinite" }} />
            ) : null}
            {item.status === "failed" && onRetryItem ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onRetryItem(item.id);
                }}
                style={{
                  border: "none",
                  backgroundColor: "transparent",
                  color: "var(--cc-status-danger)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  padding: 0,
                  opacity: showActions ? 1 : 0.6,
                }}
                title="Retry upload"
              >
                <RotateCcw size={13} />
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <AttachmentPreviewModal item={item} open={showPreview} onClose={() => setShowPreview(false)} />
    </>
  );
}

export function AttachmentAssetGrid({
  items,
  compact,
  padding,
  onRemoveItem,
  onRetryItem,
}: AttachmentAssetGridProps) {
  if (items.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        gap: compact ? 7 : 8,
        flexWrap: "wrap",
        padding: padding ?? (compact ? "4px 8px" : "4px 12px 6px"),
      }}
    >
      {items.map((item) => (
        <AttachmentAssetCard
          key={item.id}
          item={item}
          compact={compact}
          onRemoveItem={onRemoveItem}
          onRetryItem={onRetryItem}
        />
      ))}
    </div>
  );
}

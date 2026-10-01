"use client";

import type { CSSProperties } from "react";
import { Maximize2, X } from "lucide-react";
import { MarkdownPreview } from "@/components/shared/markdown-preview";

const FRONTMATTER_BLOCK = /^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n*/;

const SHELL_STYLE: CSSProperties = {
  border: "1px solid var(--cc-line-alpha-25)",
  borderRadius: 10,
  backgroundColor: "var(--cc-surface)AF8",
  overflow: "hidden",
};

const HEADER_LABEL_STYLE: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "var(--cc-brand-primary)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
};

function Header({
  title,
  subtitle,
  onExpand,
}: {
  title: string;
  subtitle: string;
  onExpand?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 14px 10px",
        borderBottom: "1px solid var(--cc-line-alpha-20)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={HEADER_LABEL_STYLE}>{title}</div>
        <div
          style={{
            marginTop: 4,
            fontSize: 13,
            color: "var(--cc-text-secondary)",
            lineHeight: 1.45,
            fontFamily: "var(--font-inter), Inter, sans-serif",
          }}
        >
          {subtitle}
        </div>
      </div>
      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid var(--cc-line-alpha-30)",
            backgroundColor: "var(--cc-surface)",
            color: "var(--cc-text-secondary)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
            flexShrink: 0,
          }}
        >
          <Maximize2 size={13} />
          Expand
        </button>
      )}
    </div>
  );
}

function getCompactPreviewContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return content;

  const withoutFrontmatter = trimmed.replace(FRONTMATTER_BLOCK, "").trim();
  return withoutFrontmatter || trimmed;
}

export function DraftPlanPreviewCard({
  content,
  onExpand,
  compact = false,
}: {
  content: string;
  onExpand?: () => void;
  compact?: boolean;
}) {
  const previewContent = compact ? getCompactPreviewContent(content) : content;

  return (
    <div style={SHELL_STYLE}>
      <Header
        title="Draft preview - not saved yet"
        subtitle="This is the generated plan preview. It becomes the real brief only after approval."
        onExpand={onExpand}
      />
      <div
        style={{
          maxHeight: compact ? 260 : 280,
          overflowY: compact ? "hidden" : "auto",
          padding: "12px 14px 14px",
          position: "relative",
        }}
      >
        <MarkdownPreview content={previewContent} />
        {compact && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 36,
              background: "linear-gradient(180deg, transparent 0%, var(--cc-surface)AF8 100%)",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
    </div>
  );
}

export function DraftPlanPreviewPanel({
  content,
  onExpand,
}: {
  content: string;
  onExpand?: () => void;
}) {
  return (
    <div style={{ ...SHELL_STYLE, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <Header
        title="Draft preview - not saved yet"
        subtitle="You are previewing the generated plan before approval. The saved brief appears here after approval."
        onExpand={onExpand}
      />
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 18px 20px" }}>
        <MarkdownPreview content={content} />
      </div>
    </div>
  );
}

export function DraftPlanPreviewModal({
  content,
  onClose,
}: {
  content: string;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "var(--cc-canvas-overlay-82)",
        backdropFilter: "blur(12px)",
        zIndex: 70,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(960px, 92vw)",
          maxHeight: "85vh",
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
          <div>
            <div style={HEADER_LABEL_STYLE}>Draft preview - not saved yet</div>
            <div
              style={{
                marginTop: 6,
                fontSize: 14,
                color: "var(--cc-text-secondary)",
                lineHeight: 1.5,
                fontFamily: "var(--font-inter), Inter, sans-serif",
              }}
            >
              Review the generated plan in full. Approving the plan writes it to <code>brief.md</code>.
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
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 24px 28px" }}>
          <MarkdownPreview content={content} />
        </div>
      </div>
    </div>
  );
}

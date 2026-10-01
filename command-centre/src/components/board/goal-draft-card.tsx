"use client";

import { Paperclip } from "lucide-react";
import type { GoalDraftPayload } from "@/types/goal-draft";
import { DeleteConfirmButton } from "@/components/shared/delete-confirm-button";

const MONO = "'DM Mono', 'JetBrains Mono', 'SF Mono', ui-monospace, monospace";
const DRAFT_ACCENT = "var(--cc-status-info)";

function timeAgo(dateStr: string): string {
  const timestamp = new Date(dateStr).getTime();
  if (Number.isNaN(timestamp)) return "--";
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getDraftBodyPreview(draft: GoalDraftPayload): string {
  const trimmedMessage = draft.message.trim();
  if (trimmedMessage) {
    const firstLine = trimmedMessage.split("\n").find((line) => line.trim().length > 0) ?? trimmedMessage;
    return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
  }
  if (draft.attachments.length > 0) {
    return draft.attachments.length === 1
      ? `1 attached file`
      : `${draft.attachments.length} attached files`;
  }
  return "No details yet";
}

export function GoalDraftCard({
  draft,
  isActive,
  onOpen,
  onDiscard,
}: {
  draft: GoalDraftPayload;
  isActive?: boolean;
  onOpen: (draftId: string) => void;
  onDiscard: (draftId: string) => void | Promise<void>;
}) {
  const title = draft.title.trim() || "Untitled draft";
  const preview = getDraftBodyPreview(draft);

  return (
    <div
      data-card
      role="button"
      tabIndex={0}
      onClick={() => onOpen(draft.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(draft.id);
        }
      }}
      style={{
        background: "linear-gradient(180deg, var(--cc-surface-overlay), var(--cc-surface-overlay))",
        borderTop: `1px solid ${isActive ? "var(--cc-border-brand-strong)" : "var(--cc-status-info-bg)"}`,
        borderRight: `1px solid ${isActive ? "var(--cc-border-brand-strong)" : "var(--cc-status-info-bg)"}`,
        borderBottom: "none",
        borderLeft: `3px solid ${DRAFT_ACCENT}`,
        borderRadius: 0,
        padding: "8px 12px",
        cursor: "pointer",
        position: "relative",
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        boxShadow: isActive ? "inset 0 0 0 0.5px var(--cc-status-info-bg)" : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: 18,
                padding: "0 7px",
                borderRadius: 999,
                backgroundColor: "var(--cc-status-info-bg)",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
                color: DRAFT_ACCENT,
                fontFamily: MONO,
                textTransform: "uppercase",
                flexShrink: 0,
              }}
            >
              Draft
            </span>
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                color: "var(--cc-palette-neutral-900)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
                flex: 1,
              }}
              title={title}
            >
              {title}
            </span>
          </div>
          <div
            style={{
              marginTop: 5,
              fontSize: 12,
              lineHeight: 1.45,
              color: "var(--cc-text-secondary)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={preview}
          >
            {preview}
          </div>
          <div
            style={{
              marginTop: 7,
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            {draft.attachments.length > 0 ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 10,
                  fontFamily: MONO,
                  color: "var(--cc-text-tertiary)",
                }}
              >
                <Paperclip size={11} />
                {draft.attachments.length}
              </span>
            ) : null}
            <span
              style={{
                fontSize: 10,
                fontFamily: MONO,
                color: "var(--cc-text-tertiary)",
              }}
            >
              updated {timeAgo(draft.updatedAt)}
            </span>
          </div>
        </div>

        <DeleteConfirmButton
          ariaLabel={`Discard ${title}`}
          onConfirm={() => onDiscard(draft.id)}
          size="standard"
        />
      </div>
    </div>
  );
}

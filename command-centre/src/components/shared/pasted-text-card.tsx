"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  buildPastedTextLabel,
  buildPastedTextPreview,
} from "@/lib/pasted-text";

interface PastedTextCardProps {
  text: string;
  onInsert: () => void;
  onRemove: () => void;
}

function PastedTextPreviewModal({
  open,
  label,
  text,
  onClose,
}: {
  open: boolean;
  label: string;
  text: string;
  onClose: () => void;
}) {
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

  if (!open) return null;

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
        aria-label="Pasted text preview"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(760px, 92vw)",
          maxHeight: "84vh",
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
              Pasted text
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 12,
                color: "var(--cc-palette-neutral-600)",
                lineHeight: 1.45,
                fontFamily: "'DM Mono', monospace",
              }}
            >
              {label}
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
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "20px 24px 24px",
          }}
        >
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.55,
              color: "var(--cc-palette-code-bg)",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
              fontFamily: "'DM Mono', monospace",
            }}
          >
            {text}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PastedTextCard({
  text,
  onInsert,
  onRemove,
}: PastedTextCardProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const preview = useMemo(
    () => buildPastedTextPreview(text, { maxLines: 5, maxChars: 170 }),
    [text],
  );
  const label = useMemo(() => buildPastedTextLabel(text), [text]);
  const showActions = hovered || focused;

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setShowPreview(true)}
        onKeyDown={(event) => {
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
          flex: "0 1 164px",
          maxWidth: 164,
          minWidth: 0,
          minHeight: 128,
          padding: 10,
          borderRadius: 12,
          border: showActions
            ? "1px solid var(--cc-brand-alpha-30)"
            : "1px solid var(--cc-line-alpha-34)",
          background:
            "linear-gradient(180deg, var(--cc-surface-overlay), var(--cc-canvas-overlay-92))",
          boxShadow: showActions
            ? "0 8px 24px var(--cc-brand-alpha-08)"
            : "0 1px 4px var(--cc-neutral-alpha-04)",
          cursor: "pointer",
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
              backgroundColor: "var(--cc-neutral-alpha-08)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "var(--cc-palette-neutral-700)",
              fontFamily: "'DM Mono', monospace",
            }}
          >
            PASTED
          </span>
          <button
            type="button"
            aria-label="Remove pasted text"
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              borderRadius: 999,
              border: "none",
              backgroundColor: hovered || focused ? "var(--cc-neutral-alpha-08)" : "transparent",
              color: "var(--cc-palette-neutral-550)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <X size={13} />
          </button>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            padding: "2px 2px 0",
            fontSize: 12,
            lineHeight: 1.35,
            color: "var(--cc-palette-neutral-600)",
            whiteSpace: "pre-wrap",
            overflow: "hidden",
            overflowWrap: "anywhere",
            wordBreak: "break-word",
          }}
        >
          {preview}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span
            style={{
              fontSize: 10,
              color: "var(--cc-palette-neutral-550)",
              fontFamily: "'DM Mono', monospace",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </span>
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              display: "flex",
              alignItems: "center",
              minHeight: 30,
            }}
          >
            <button
              type="button"
              onClick={onInsert}
              style={{
                border: "none",
                borderRadius: 999,
                padding: "5px 12px",
                backgroundColor: "var(--cc-brand-alpha-12)",
                color: "var(--cc-brand-primary)",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
                opacity: showActions ? 1 : 0,
                pointerEvents: showActions ? "auto" : "none",
                transition: "opacity 140ms ease",
              }}
            >
              Insert into input
            </button>
          </div>
        </div>
      </div>
      <PastedTextPreviewModal
        open={showPreview}
        label={label}
        text={text}
        onClose={() => setShowPreview(false)}
      />
    </>
  );
}

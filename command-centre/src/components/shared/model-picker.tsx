"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Sparkles } from "lucide-react";
import {
  CLAUDE_MODEL_OPTIONS,
  getClaudeModelLabel,
  isKnownClaudeModel,
  normalizeClaudeModel,
} from "@/lib/claude-options";
import { getAutoModeModelError } from "@/lib/claude-auto-mode";
import type { ClaudeModel } from "@/types/task";
import { POPOVER_LAYER_Z_INDEX, resolvePopoverPosition } from "./popover-position";

interface ModelPickerProps {
  value: ClaudeModel | null;
  onChange: (value: ClaudeModel) => void;
  disabled?: boolean;
  autoModeActive?: boolean;
}

type DropdownPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

const DROPDOWN_MIN_WIDTH = 226;
const DROPDOWN_MAX_HEIGHT = 360;
const DROPDOWN_GAP = 6;
const VIEWPORT_PADDING = 8;
const DEFAULT_DROPDOWN_POSITION: DropdownPosition = {
  top: 0,
  left: 0,
  width: DROPDOWN_MIN_WIDTH,
  maxHeight: 320,
};

export function ModelPicker({ value, onChange, disabled, autoModeActive }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition>(DEFAULT_DROPDOWN_POSITION);
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const current: ClaudeModel = normalizeClaudeModel(value) ?? "opus";
  const currentLabel = getClaudeModelLabel(current);

  const updateDropdownPosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect || typeof window === "undefined") return;

    const resolved = resolvePopoverPosition({
      anchor: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      popoverWidth: Math.max(DROPDOWN_MIN_WIDTH, rect.width),
      contentHeight: dropdownRef.current?.scrollHeight ?? 260,
      maxHeight: DROPDOWN_MAX_HEIGHT,
      preferredPlacement: "above",
      gap: DROPDOWN_GAP,
      viewportPadding: VIEWPORT_PADDING,
    });

    setDropdownPosition({
      top: resolved.top,
      left: resolved.left,
      width: resolved.width,
      maxHeight: resolved.maxHeight,
    });
  }, []);

  function commitCustomModel() {
    const normalized = normalizeClaudeModel(customValue);
    if (!normalized) {
      setCustomError("Use a model alias or ID without spaces.");
      return;
    }
    const autoModeError = autoModeActive ? getAutoModeModelError(normalized) : null;
    if (autoModeError) {
      setCustomError(autoModeError);
      return;
    }
    onChange(normalized);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const clickedTrigger = triggerRef.current?.contains(target);
      const clickedDropdown = dropdownRef.current?.contains(target);
      if (!clickedTrigger && !clickedDropdown) setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    updateDropdownPosition();
    const handleWindowChange = () => updateDropdownPosition();
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);
    return () => {
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [open, updateDropdownPosition]);

  useEffect(() => {
    if (!open) return;
    const frameId = requestAnimationFrame(updateDropdownPosition);
    return () => cancelAnimationFrame(frameId);
  }, [customError, open, updateDropdownPosition]);

  useEffect(() => {
    if (!open) return;
    setCustomValue(isKnownClaudeModel(current) ? "" : current);
    setCustomError(null);
  }, [current, open]);

  return (
    <div ref={triggerRef} style={{ position: "relative" }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!open) updateDropdownPosition();
          setOpen((v) => !v);
        }}
        title="Model"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          height: 26,
          padding: "0 8px",
          borderRadius: 6,
          border: "none",
          background: "transparent",
          color: "var(--cc-text-secondary)",
          fontSize: 12,
          fontWeight: 500,
          fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.background = "var(--cc-neutral-alpha-04)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        <Sparkles size={13} />
        <span
          style={{
            display: "inline-block",
            maxWidth: 120,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {currentLabel}
        </span>
        <ChevronDown size={11} />
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={dropdownRef}
          data-composer-popover-open="true"
          style={{
            position: "fixed",
            top: dropdownPosition.top,
            left: dropdownPosition.left,
            width: dropdownPosition.width,
            boxSizing: "border-box",
            maxHeight: dropdownPosition.maxHeight,
            overflowY: "auto",
            backgroundColor: "var(--cc-surface-soft)",
            border: "1px solid var(--cc-control-bg-active)",
            borderRadius: 10,
            boxShadow: "0 12px 28px var(--cc-neutral-alpha-20)",
            zIndex: POPOVER_LAYER_Z_INDEX,
            padding: 6,
          }}
        >
          <div
            style={{
              padding: "4px 10px 8px",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--cc-text-secondary)",
              fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
            }}
          >
            Model
          </div>
          {CLAUDE_MODEL_OPTIONS.map((opt) => {
            const isSelected = opt.value === current;
            const autoModeError = autoModeActive ? getAutoModeModelError(opt.value) : null;
            return (
              <button
                key={opt.value}
                type="button"
                aria-disabled={Boolean(autoModeError)}
                title={autoModeError ?? undefined}
                onClick={() => {
                  if (autoModeError) return;
                  onChange(opt.value);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  border: "none",
                  borderRadius: 6,
                  cursor: autoModeError ? "not-allowed" : "pointer",
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                  color: autoModeError ? "var(--cc-text-muted)" : "var(--cc-text-primary)",
                  opacity: autoModeError ? 0.58 : 1,
                  backgroundColor: isSelected ? "var(--cc-neutral-alpha-05)" : "transparent",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--cc-neutral-alpha-05)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = isSelected ? "var(--cc-neutral-alpha-05)" : "transparent";
                }}
              >
                {opt.label}
              </button>
            );
          })}
          <div
            style={{
              height: 1,
              margin: "6px 4px",
              backgroundColor: "var(--cc-line-alpha-40)",
            }}
          />
          <div style={{ padding: "4px" }}>
            <div
              style={{
                padding: "0 6px 6px",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--cc-text-tertiary)",
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
              }}
            >
              Custom
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={customValue}
                onChange={(event) => {
                  setCustomValue(event.target.value);
                  setCustomError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitCustomModel();
                  }
                  if (event.key === "Escape") {
                    setOpen(false);
                  }
                }}
                placeholder="claude-fable-5"
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 30,
                  padding: "0 8px",
                  borderRadius: 6,
                  border: "1px solid var(--cc-control-border)",
                  backgroundColor: "var(--cc-surface)",
                  color: "var(--cc-text-primary)",
                  caretColor: "var(--cc-text-primary)",
                  fontSize: 12,
                  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                  outline: "none",
                }}
              />
              <button
                type="button"
                onClick={commitCustomModel}
                style={{
                  height: 30,
                  padding: "0 10px",
                  border: "none",
                  borderRadius: 6,
                  backgroundColor: "var(--cc-brand-primary)",
                  color: "var(--cc-text-inverse)",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.backgroundColor = "var(--cc-brand-hover)";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.backgroundColor = "var(--cc-brand-primary)";
                }}
              >
                Use
              </button>
            </div>
            {customError && (
              <div
                style={{
                  padding: "6px 6px 0",
                  color: "var(--cc-status-danger)",
                  fontSize: 11,
                  lineHeight: 1.3,
                  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                }}
              >
                {customError}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

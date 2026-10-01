"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Brain, ChevronDown } from "lucide-react";
import {
  getSupportedClaudeThinkingEfforts,
  normalizeClaudeThinkingEffortForModel,
} from "@/lib/claude-options";
import type { ClaudeModel, ClaudeThinkingEffort } from "@/types/task";
import { POPOVER_LAYER_Z_INDEX, resolvePopoverPosition } from "./popover-position";

const MENU_WIDTH = 150;
const MENU_MAX_HEIGHT = 320;
const MENU_GAP = 6;
const VIEWPORT_PADDING = 8;

interface Option {
  value: ClaudeThinkingEffort;
  label: string;
}

const OPTIONS: Option[] = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "XHigh" },
  { value: "max", label: "Max" },
];

interface ThinkingEffortPickerProps {
  value: ClaudeThinkingEffort | null;
  model?: ClaudeModel | null;
  onChange: (value: ClaudeThinkingEffort) => void;
  disabled?: boolean;
}

export function ThinkingEffortPicker({ value, model, onChange, disabled }: ThinkingEffortPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: MENU_WIDTH, maxHeight: MENU_MAX_HEIGHT });

  const supportedValues = getSupportedClaudeThinkingEfforts(model);
  const visibleOptions = OPTIONS.filter((option) => supportedValues.includes(option.value));
  const current = normalizeClaudeThinkingEffortForModel(model, value ?? "auto") ?? "auto";
  const currentLabel = visibleOptions.find((option) => option.value === current)?.label || "Auto";

  useEffect(() => {
    const rawCurrent = value ?? "auto";
    if (current !== rawCurrent) {
      onChange(current);
    }
  }, [current, onChange, value]);

  const positionMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const resolved = resolvePopoverPosition({
      anchor: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      popoverWidth: MENU_WIDTH,
      contentHeight: menuRef.current?.scrollHeight ?? 50 + visibleOptions.length * 36,
      maxHeight: MENU_MAX_HEIGHT,
      preferredPlacement: "above",
      gap: MENU_GAP,
      viewportPadding: VIEWPORT_PADDING,
    });
    setMenuPosition({
      top: resolved.top,
      left: resolved.left,
      width: resolved.width,
      maxHeight: resolved.maxHeight,
    });
  }, [visibleOptions.length]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    positionMenu();
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open, positionMenu]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        title="Thinking effort"
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
        onMouseEnter={(event) => {
          if (!disabled) event.currentTarget.style.background = "var(--cc-neutral-alpha-04)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = "transparent";
        }}
      >
        <Brain size={13} />
        {currentLabel}
        <ChevronDown size={11} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          data-composer-popover-open="true"
          role="menu"
          style={{
            position: "fixed",
            left: menuPosition.left,
            top: menuPosition.top,
            width: menuPosition.width,
            boxSizing: "border-box",
            backgroundColor: "var(--cc-surface-soft)",
            border: "1px solid var(--cc-control-bg-active)",
            borderRadius: 10,
            boxShadow: "0 8px 24px var(--cc-neutral-alpha-08)",
            zIndex: POPOVER_LAYER_Z_INDEX,
            maxHeight: menuPosition.maxHeight,
            overflowY: "auto",
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
            Thinking
          </div>
          {visibleOptions.map((option) => {
            const isSelected = option.value === current;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                onClick={() => {
                  onChange(option.value);
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
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                  color: "var(--cc-text-primary)",
                  backgroundColor: isSelected ? "var(--cc-neutral-alpha-05)" : "transparent",
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.backgroundColor = "var(--cc-neutral-alpha-05)";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.backgroundColor = isSelected ? "var(--cc-neutral-alpha-05)" : "transparent";
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      , document.body)}
    </div>
  );
}

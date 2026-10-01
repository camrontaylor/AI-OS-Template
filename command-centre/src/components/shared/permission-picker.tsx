"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  FilePenLine,
  Hand,
  ListTree,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { POPOVER_LAYER_Z_INDEX, resolvePopoverPosition } from "./popover-position";
import { useClaudeCapabilities } from "@/lib/claude-capabilities-client";
import {
  AUTO_MODE_MINIMUM_CLI_VERSION,
  getAutoModeModelError,
} from "@/lib/claude-auto-mode";
import type { ClaudeModel, PermissionMode } from "@/types/task";

export type PermissionPickerMode = Extract<
  PermissionMode,
  "default" | "auto" | "bypassPermissions" | "plan"
>;

interface PermissionOption {
  value: PermissionPickerMode | "acceptEdits";
  label: string;
  description: string;
  Icon: typeof Hand;
  legacy?: boolean;
}

const OPTIONS: PermissionOption[] = [
  {
    value: "default",
    label: "Ask",
    description: "Claude asks before actions that need permission.",
    Icon: Hand,
  },
  {
    value: "auto",
    label: "Auto",
    description: "Works independently, with background checks for unsafe actions.",
    Icon: ShieldCheck,
  },
  {
    value: "bypassPermissions",
    label: "Full access",
    description: "Runs without asking or permission checks.",
    Icon: ShieldAlert,
  },
  {
    value: "plan",
    label: "Plan",
    description: "Creates a plan first, then waits for your approval.",
    Icon: ListTree,
  },
];

const LEGACY_OPTION: PermissionOption = {
  value: "acceptEdits",
  label: "Auto-edit (legacy)",
  description: "Automatically accepts file edits; commands can still ask.",
  Icon: FilePenLine,
  legacy: true,
};

const DROPDOWN_WIDTH = 320;
const DROPDOWN_GAP = 6;
const VIEWPORT_PADDING = 8;

interface PermissionPickerProps {
  value: PermissionMode;
  onChange: (value: PermissionPickerMode) => void;
  model?: ClaudeModel | null;
  disabled?: boolean;
}

type DropdownPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

export function PermissionPicker({ value, onChange, model, disabled }: PermissionPickerProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<DropdownPosition>({
    top: 0,
    left: 0,
    width: DROPDOWN_WIDTH,
    maxHeight: 420,
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const { capabilities } = useClaudeCapabilities();

  const visibleOptions = useMemo(
    () => value === "acceptEdits" ? [LEGACY_OPTION, ...OPTIONS] : OPTIONS,
    [value],
  );
  const currentOption = visibleOptions.find((option) => option.value === value) ?? OPTIONS[0];
  const CurrentIcon = currentOption.Icon;
  const isFullAccess = value === "bypassPermissions";

  const autoUnavailableMessage = useMemo(() => {
    if (capabilities?.autoMode.reason === "cli_missing") {
      return `Auto needs Claude Code ${AUTO_MODE_MINIMUM_CLI_VERSION} or later. Claude Code was not found.`;
    }
    if (capabilities?.autoMode.reason === "cli_too_old") {
      return `Auto needs Claude Code ${AUTO_MODE_MINIMUM_CLI_VERSION} or later. Installed: ${capabilities.cli.version ?? "unknown"}.`;
    }
    return getAutoModeModelError(model);
  }, [capabilities, model]);

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect || typeof window === "undefined") return;

    const resolved = resolvePopoverPosition({
      anchor: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      popoverWidth: DROPDOWN_WIDTH,
      contentHeight: dropdownRef.current?.scrollHeight ?? 312,
      maxHeight: 420,
      preferredPlacement: "above",
      gap: DROPDOWN_GAP,
      viewportPadding: VIEWPORT_PADDING,
    });

    setPosition({
      top: resolved.top,
      left: resolved.left,
      width: resolved.width,
      maxHeight: resolved.maxHeight,
    });
  }, []);

  const closeMenu = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const selectOption = useCallback((option: PermissionOption) => {
    if (option.legacy || (option.value === "auto" && autoUnavailableMessage)) return;
    onChange(option.value as PermissionPickerMode);
    closeMenu();
  }, [autoUnavailableMessage, closeMenu, onChange]);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const handleWindowChange = () => updatePosition();
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        closeMenu(false);
      }
    };
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [closeMenu, open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      updatePosition();
      const selectedIndex = visibleOptions.findIndex((option) => option.value === value);
      itemRefs.current[Math.max(0, selectedIndex)]?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, updatePosition, value, visibleOptions]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }

    const focusableItems = itemRefs.current.filter((item): item is HTMLButtonElement => Boolean(item));
    if (focusableItems.length === 0) return;
    const currentIndex = Math.max(0, focusableItems.indexOf(document.activeElement as HTMLButtonElement));
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % focusableItems.length;
    if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + focusableItems.length) % focusableItems.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = focusableItems.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      focusableItems[nextIndex]?.focus();
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Permissions: ${currentOption.label}`}
        title="Permission mode"
        onClick={() => {
          if (!open) updatePosition();
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          height: 26,
          padding: "0 8px",
          borderRadius: 6,
          border: "none",
          background: isFullAccess ? "var(--cc-status-warning-bg)" : "transparent",
          color: isFullAccess ? "var(--cc-status-warning-strong)" : "var(--cc-text-secondary)",
          fontSize: 12,
          fontWeight: 500,
          fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.5 : 1,
          outline: "none",
        }}
        onFocus={(event) => {
          event.currentTarget.style.outline = "2px solid var(--cc-brand-primary)";
          event.currentTarget.style.outlineOffset = "2px";
        }}
        onBlur={(event) => {
          event.currentTarget.style.outline = "none";
        }}
        onMouseEnter={(event) => {
          if (!disabled) {
            event.currentTarget.style.background = isFullAccess
              ? "var(--cc-status-warning-bg)"
              : "var(--cc-neutral-alpha-04)";
          }
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = isFullAccess
            ? "var(--cc-status-warning-bg)"
            : "transparent";
        }}
      >
        <CurrentIcon size={13} aria-hidden="true" />
        <span>{currentOption.label}</span>
        <ChevronDown size={11} aria-hidden="true" />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={dropdownRef}
          data-composer-popover-open="true"
          role="menu"
          aria-label="Permissions"
          onKeyDown={handleMenuKeyDown}
          style={{
            position: "fixed",
            top: position.top,
            left: position.left,
            width: position.width,
            boxSizing: "border-box",
            maxHeight: position.maxHeight,
            overflowY: "auto",
            backgroundColor: "var(--cc-surface-soft)",
            border: "1px solid var(--cc-control-bg-active)",
            borderRadius: 10,
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
            Permissions
          </div>

          {visibleOptions.map((option, index) => {
            const Icon = option.Icon;
            const selected = option.value === value;
            const unavailable = option.value === "auto" ? autoUnavailableMessage : null;
            const isWarning = option.value === "bypassPermissions";
            const isDisabled = Boolean(option.legacy || unavailable);
            return (
              <button
                key={option.value}
                ref={(node) => { itemRefs.current[index] = node; }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                aria-disabled={isDisabled}
                title={unavailable ?? undefined}
                onClick={() => selectOption(option)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "20px minmax(0, 1fr) 16px",
                  alignItems: "start",
                  gap: 8,
                  width: "100%",
                  padding: "8px 10px",
                  border: "none",
                  borderRadius: 6,
                  textAlign: "left",
                  cursor: isDisabled ? "not-allowed" : "pointer",
                  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                  color: isWarning ? "var(--cc-status-warning-strong)" : "var(--cc-text-primary)",
                  backgroundColor: selected && isWarning ? "var(--cc-status-warning-bg)" : "transparent",
                  opacity: isDisabled && !selected ? 0.58 : 1,
                  outline: "none",
                }}
                onFocus={(event) => {
                  event.currentTarget.style.outline = "2px solid var(--cc-brand-primary)";
                  event.currentTarget.style.outlineOffset = "-2px";
                  if (!(selected && isWarning)) event.currentTarget.style.backgroundColor = "var(--cc-neutral-alpha-05)";
                }}
                onBlur={(event) => {
                  event.currentTarget.style.outline = "none";
                  event.currentTarget.style.backgroundColor = selected && isWarning
                    ? "var(--cc-status-warning-bg)"
                    : "transparent";
                }}
                onMouseEnter={(event) => {
                  if (!(selected && isWarning)) event.currentTarget.style.backgroundColor = "var(--cc-neutral-alpha-05)";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.backgroundColor = selected && isWarning
                    ? "var(--cc-status-warning-bg)"
                    : "transparent";
                }}
              >
                <Icon
                  size={16}
                  aria-hidden="true"
                  color={isWarning ? "var(--cc-status-warning-bright)" : "var(--cc-text-secondary)"}
                  style={{ marginTop: 2 }}
                />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600, lineHeight: 1.25 }}>
                    {option.label}
                  </span>
                  <span
                    style={{
                      display: "block",
                      marginTop: 2,
                      fontSize: 11,
                      fontWeight: 400,
                      lineHeight: 1.4,
                      color: unavailable ? "var(--cc-status-warning-strong)" : "var(--cc-text-tertiary)",
                    }}
                  >
                    {unavailable ?? option.description}
                  </span>
                </span>
                {selected ? <Check size={15} aria-hidden="true" style={{ marginTop: 1 }} /> : <span />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

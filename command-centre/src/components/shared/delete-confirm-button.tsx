"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { CSSProperties } from "react";

export type DeleteConfirmButtonVariant = "icon" | "labeled";
export type DeleteConfirmButtonSize = "compact" | "standard" | "labeled";

export interface DeleteConfirmButtonProps {
  ariaLabel: string;
  onConfirm: () => void | Promise<void>;
  variant?: DeleteConfirmButtonVariant;
  size?: DeleteConfirmButtonSize;
  label?: string;
  confirmLabel?: string;
  loadingLabel?: string;
  disabled?: boolean;
  confirmSide?: "left" | "right";
  idleColor?: string;
  idleBackground?: string;
  hoverBackground?: string;
  style?: CSSProperties;
}

const RESET_DELAY_MS = 3000;

const SIZE_STYLES: Record<
  DeleteConfirmButtonSize,
  {
    height: number;
    iconSize: number;
    padding: string;
    gap: number;
    fontSize: number;
    borderRadius: number;
    confirmWidth: number;
  }
> = {
  compact: {
    height: 18,
    iconSize: 11,
    padding: "0",
    gap: 0,
    fontSize: 10,
    borderRadius: 3,
    confirmWidth: 62,
  },
  standard: {
    height: 28,
    iconSize: 15,
    padding: "0",
    gap: 0,
    fontSize: 11,
    borderRadius: 5,
    confirmWidth: 70,
  },
  labeled: {
    height: 26,
    iconSize: 13,
    padding: "0 8px",
    gap: 4,
    fontSize: 11,
    borderRadius: 6,
    confirmWidth: 72,
  },
};

export function DeleteConfirmButton({
  ariaLabel,
  onConfirm,
  variant = "icon",
  size = variant === "labeled" ? "labeled" : "standard",
  label = "Delete",
  confirmLabel = "Confirm",
  loadingLabel = "Deleting...",
  disabled = false,
  confirmSide = "right",
  idleColor = "var(--cc-text-tertiary)",
  idleBackground = "transparent",
  hoverBackground = "var(--cc-status-danger-bg)",
  style,
}: DeleteConfirmButtonProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const mountedRef = useRef(true);
  const sizing = SIZE_STYLES[size];
  const isIconOnly = variant === "icon";

  const reset = useCallback(() => {
    if (isBusy) return;
    setIsConfirming(false);
  }, [isBusy]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isConfirming || isBusy) return;

    const timeout = window.setTimeout(reset, RESET_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [isBusy, isConfirming, reset]);

  useEffect(() => {
    if (!isConfirming || isBusy) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        reset();
      }
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  }, [isBusy, isConfirming, reset]);

  const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (disabled || isBusy) return;

    if (!isConfirming) {
      setIsConfirming(true);
      return;
    }

    setIsBusy(true);
    try {
      await onConfirm();
    } finally {
      if (mountedRef.current) {
        setIsBusy(false);
        setIsConfirming(false);
      }
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      reset();
    }
  };

  const active = isConfirming || isBusy;
  const triggerWidth = isIconOnly ? sizing.height : undefined;
  const buttonWidth = active ? sizing.confirmWidth : "100%";
  const buttonColor = active
    ? "var(--cc-text-inverse)"
    : isHovered || isFocused
      ? "var(--cc-status-danger)"
      : idleColor;

  return (
    <span
      ref={rootRef}
      onMouseLeave={reset}
      style={{
        position: "relative",
        display: "inline-flex",
        width: triggerWidth,
        height: sizing.height,
        flexShrink: 0,
        overflow: "visible",
        zIndex: active ? 100 : undefined,
        ...style,
      }}
    >
      {!isIconOnly && (
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sizing.gap,
            height: sizing.height,
            padding: sizing.padding,
            visibility: "hidden",
            whiteSpace: "nowrap",
            fontSize: sizing.fontSize,
            fontWeight: 500,
          }}
        >
          <Trash2 size={sizing.iconSize} />
          {label}
        </span>
      )}

      <button
        type="button"
        aria-label={active ? `${confirmLabel}: ${ariaLabel}` : ariaLabel}
        aria-expanded={active}
        title={active ? confirmLabel : ariaLabel}
        disabled={disabled || isBusy}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          reset();
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          position: "absolute",
          top: 0,
          [confirmSide]: 0,
          width: buttonWidth,
          height: sizing.height,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: sizing.gap,
          padding: active ? "0 10px" : sizing.padding,
          border: "none",
          borderRadius: sizing.borderRadius,
          backgroundColor: active
            ? "var(--cc-status-danger)"
            : isHovered || isFocused
              ? hoverBackground
              : idleBackground,
          color: buttonColor,
          cursor: disabled || isBusy ? "not-allowed" : "pointer",
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: sizing.fontSize,
          fontWeight: active ? 600 : 500,
          lineHeight: 1,
          whiteSpace: "nowrap",
          opacity: disabled ? 0.45 : 1,
          overflow: "hidden",
          zIndex: active ? 101 : 1,
          transition:
            "width 160ms ease, background-color 120ms ease, color 120ms ease, opacity 120ms ease",
        }}
      >
        <span
          aria-hidden={active}
          style={{
            position: active ? "absolute" : "static",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: sizing.gap,
            opacity: active ? 0 : 1,
            visibility: active ? "hidden" : "visible",
            transform: active ? "translateX(8px)" : "translateX(0)",
            transition: "opacity 100ms ease, transform 160ms ease",
          }}
        >
          <Trash2 size={sizing.iconSize} />
          {!isIconOnly && label}
        </span>
        <span
          aria-hidden={!active}
          style={{
            position: active ? "static" : "absolute",
            opacity: active ? 1 : 0,
            visibility: active ? "visible" : "hidden",
            transform: active ? "translateX(0)" : "translateX(8px)",
            transition: "opacity 120ms ease 40ms, transform 160ms ease",
          }}
        >
          {isBusy ? loadingLabel : confirmLabel}
        </span>
      </button>
    </span>
  );
}

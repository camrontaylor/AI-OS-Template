"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

interface ResizablePaneProps {
  left: ReactNode;
  right: ReactNode;
  /** Initial left-pane width in pixels. */
  initialLeft?: number;
  /** Minimum left-pane width in pixels. */
  minLeft?: number;
  /** Maximum left-pane width in pixels. */
  maxLeft?: number;
  /** localStorage key for persisting the width. Omit for non-persistent. */
  storageKey?: string;
  /** Optional wrapper style (applied to the flex container). */
  style?: React.CSSProperties;
  className?: string;
}

/**
 * A simple two-pane horizontal split with a draggable handle between.
 * Width is persisted to localStorage when a storageKey is provided.
 */
export function ResizablePane({
  left,
  right,
  initialLeft = 260,
  minLeft = 160,
  maxLeft = 600,
  storageKey,
  style,
  className,
}: ResizablePaneProps) {
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    if (typeof window === "undefined" || !storageKey) return initialLeft;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!Number.isNaN(parsed)) {
          return Math.max(minLeft, Math.min(maxLeft, parsed));
        }
      }
    } catch {
      // ignore
    }
    return initialLeft;
  });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const persist = useCallback(
    (width: number) => {
      if (!storageKey) return;
      try {
        window.localStorage.setItem(storageKey, String(width));
      } catch {
        // ignore
      }
    },
    [storageKey]
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const next = Math.max(minLeft, Math.min(maxLeft, e.clientX - rect.left));
      setLeftWidth(next);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setLeftWidth((w) => {
        persist(w);
        return w;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [minLeft, maxLeft, persist]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        minHeight: 0,
        ...style,
      }}
    >
      <div style={{ width: leftWidth, flexShrink: 0, minWidth: 0, display: "flex" }}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={handleMouseDown}
        style={{
          width: 6,
          cursor: "col-resize",
          flexShrink: 0,
          position: "relative",
          background: "transparent",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget.firstChild as HTMLElement | null)?.style?.setProperty(
            "background",
            "var(--cc-brand-primary)"
          );
        }}
        onMouseLeave={(e) => {
          (e.currentTarget.firstChild as HTMLElement | null)?.style?.setProperty(
            "background",
            "var(--cc-control-bg)"
          );
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 2,
            width: 2,
            background: "var(--cc-control-bg)",
            transition: "background 150ms ease",
            borderRadius: 1,
          }}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex" }}>{right}</div>
    </div>
  );
}

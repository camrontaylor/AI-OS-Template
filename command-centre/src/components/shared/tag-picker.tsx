"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Tag, X, Check } from "lucide-react";
import { POPOVER_LAYER_Z_INDEX, resolvePopoverPosition } from "./popover-position";

const MONO = "'DM Mono', monospace";

interface TagPickerProps {
  value: string | null;
  onChange: (tag: string | null) => void;
  /** Inline mode renders just the pill (click to edit). Panel mode renders the full dropdown. */
  mode?: "inline" | "panel";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

type DropdownPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

const DROPDOWN_GAP = 4;
const DROPDOWN_MAX_HEIGHT = 240;
const DROPDOWN_MIN_WIDTH = 200;
const VIEWPORT_PADDING = 8;
const DEFAULT_DROPDOWN_POSITION: DropdownPosition = {
  top: 0,
  left: 0,
  width: DROPDOWN_MIN_WIDTH,
  maxHeight: DROPDOWN_MAX_HEIGHT,
};

export function TagPicker({ value, onChange, mode = "inline", open, onOpenChange }: TagPickerProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition>(DEFAULT_DROPDOWN_POSITION);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isOpen = open ?? internalOpen;
  const setOpen = useCallback((next: boolean) => {
    if (open === undefined) {
      setInternalOpen(next);
    }
    onOpenChange?.(next);
  }, [onOpenChange, open]);

  const updateDropdownPosition = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || typeof window === "undefined") return;
    const resolved = resolvePopoverPosition({
      anchor: {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
      },
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      popoverWidth: Math.max(rect.width, DROPDOWN_MIN_WIDTH),
      contentHeight: dropdownRef.current?.scrollHeight ?? DROPDOWN_MAX_HEIGHT,
      maxHeight: DROPDOWN_MAX_HEIGHT,
      preferredPlacement: "below",
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

  // Fetch existing tags when dropdown opens
  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/tasks/tags")
      .then((r) => r.json())
      .then((data: string[]) => setTags(data))
      .catch(() => {});
    // Focus input after opening
    requestAnimationFrame(() => {
      updateDropdownPosition();
      inputRef.current?.focus();
    });
  }, [isOpen, updateDropdownPosition]);

  useEffect(() => {
    if (!isOpen) return;
    const handleWindowChange = () => updateDropdownPosition();
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);
    return () => {
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [isOpen, updateDropdownPosition]);

  useEffect(() => {
    if (!isOpen || typeof ResizeObserver === "undefined") return;
    const dropdown = dropdownRef.current;
    if (!dropdown) return;
    const observer = new ResizeObserver(() => updateDropdownPosition());
    observer.observe(dropdown);
    return () => observer.disconnect();
  }, [isOpen, updateDropdownPosition]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const clickedTrigger = containerRef.current?.contains(target);
      const clickedMenu = dropdownRef.current?.contains(target);
      if (!clickedTrigger && !clickedMenu) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen, setOpen]);

  const filtered = tags.filter(
    (t) => !query || t.toLowerCase().includes(query.toLowerCase())
  );
  const exactMatch = tags.some((t) => t.toLowerCase() === query.toLowerCase());
  const showCreate = query.trim().length > 0 && !exactMatch;

  const selectTag = useCallback(
    (tag: string) => {
      onChange(tag);
      setOpen(false);
      setQuery("");
    },
    [onChange]
  );

  const clearTag = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange(null);
    },
    [onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && query.trim()) {
        e.preventDefault();
        selectTag(query.trim());
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setQuery("");
      }
    },
    [query, selectTag]
  );

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-flex" }}>
      {/* Trigger — tag pill or "add tag" button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!isOpen);
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "3px 8px",
          fontSize: 11,
          fontFamily: MONO,
          fontWeight: 500,
          border: "1px solid var(--cc-line-alpha-40)",
          borderRadius: 5,
          backgroundColor: value ? "var(--cc-line-alpha-10)" : "transparent",
          color: value ? "var(--cc-text-secondary)" : "var(--cc-text-muted)",
          cursor: "pointer",
          transition: "all 120ms ease",
          whiteSpace: "nowrap",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "var(--cc-line-alpha-70)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "var(--cc-line-alpha-40)";
        }}
      >
        <Tag size={11} />
        {value || "tag"}
        {value && (
          <span
            onClick={clearTag}
            style={{
              display: "inline-flex",
              alignItems: "center",
              marginLeft: 1,
              cursor: "pointer",
            }}
          >
            <X size={10} />
          </span>
        )}
      </button>

      {isOpen && typeof document !== "undefined" && createPortal(
        <div
          ref={dropdownRef}
          data-composer-popover-open="true"
          style={{
            position: "fixed",
            top: dropdownPosition.top,
            left: dropdownPosition.left,
            backgroundColor: "var(--cc-surface)",
            borderRadius: 8,
            boxShadow: "0 12px 28px var(--cc-neutral-alpha-20)",
            border: "1px solid var(--cc-control-bg-active)",
            padding: 4,
            zIndex: POPOVER_LAYER_Z_INDEX,
            width: dropdownPosition.width,
            boxSizing: "border-box",
            maxHeight: dropdownPosition.maxHeight,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            opacity: 1,
          }}
        >
          <div style={{ padding: "4px 6px", flexShrink: 0 }}>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search or create..."
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                fontSize: 12,
                fontFamily: MONO,
                border: "1px solid var(--cc-control-bg-active)",
                borderRadius: 5,
                padding: "5px 8px",
                outline: "none",
                color: "var(--cc-text-primary)",
                background: "var(--cc-canvas-muted)",
              }}
            />
          </div>

          <div style={{ flex: "1 1 auto", minHeight: 0, maxHeight: 160, overflowY: "auto" }}>
            {filtered.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  selectTag(tag);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "5px 10px",
                  fontSize: 12,
                  fontFamily: MONO,
                  border: "none",
                  borderRadius: 5,
                  backgroundColor: value === tag ? "var(--cc-surface-soft)" : "transparent",
                  color: "var(--cc-text-primary)",
                  cursor: "pointer",
                  textAlign: "left" as const,
                }}
                onMouseEnter={(e) => {
                  if (value !== tag) e.currentTarget.style.backgroundColor = "var(--cc-canvas-muted)";
                }}
                onMouseLeave={(e) => {
                  if (value !== tag) e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <span>{tag}</span>
                {value === tag && <Check size={12} color="var(--cc-brand-primary)" />}
              </button>
            ))}

            {showCreate && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  selectTag(query.trim());
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%",
                  padding: "5px 10px",
                  fontSize: 12,
                  fontFamily: MONO,
                  border: "none",
                  borderRadius: 5,
                  backgroundColor: "transparent",
                  color: "var(--cc-brand-primary)",
                  cursor: "pointer",
                  textAlign: "left" as const,
                  fontWeight: 500,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--cc-canvas-muted)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                Create &quot;{query.trim()}&quot;
              </button>
            )}

            {filtered.length === 0 && !showCreate && (
              <div
                style={{
                  padding: "8px 10px",
                  fontSize: 11,
                  fontFamily: MONO,
                  color: "var(--cc-text-tertiary)",
                  textAlign: "center",
                }}
              >
                No tags yet
              </div>
            )}
          </div>

          {value && (
            <div style={{ borderTop: "1px solid var(--cc-control-bg-active)", marginTop: 2, paddingTop: 2, flexShrink: 0 }}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                  setOpen(false);
                  setQuery("");
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%",
                  padding: "5px 10px",
                  fontSize: 11,
                  fontFamily: MONO,
                  border: "none",
                  borderRadius: 5,
                  backgroundColor: "transparent",
                  color: "var(--cc-text-tertiary)",
                  cursor: "pointer",
                  textAlign: "left" as const,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--cc-canvas-muted)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <X size={10} />
                Remove tag
              </button>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Simple display-only tag pill (no editing). */
export function TagPill({ tag }: { tag: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "1px 5px",
        fontSize: 10,
        fontFamily: MONO,
        fontWeight: 500,
        border: "1px solid var(--cc-line-alpha-25)",
        borderRadius: 4,
        backgroundColor: "var(--cc-line-alpha-08)",
        color: "var(--cc-text-tertiary)",
        whiteSpace: "nowrap",
      }}
    >
      <Tag size={8} />
      {tag}
    </span>
  );
}

/** Tag filter bar — shows all distinct tags as toggle chips. */
export function TagFilterBar({
  tasks,
  activeTag,
  onTagChange,
}: {
  tasks: Array<{ tag: string | null }>;
  activeTag: string | null;
  onTagChange: (tag: string | null) => void;
}) {
  const distinctTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (t.tag) set.add(t.tag);
    }
    return Array.from(set).sort();
  }, [tasks]);

  if (distinctTags.length === 0) return null;

  return (
    <div
      data-feed-tag-filter-bar
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        flexWrap: "wrap",
        flexShrink: 0,
        padding: "8px 12px",
        borderBottom: "1px solid var(--cc-line-alpha-15)",
        background: "var(--cc-canvas-subtle)",
      }}
    >
      <button
        onClick={() => onTagChange(null)}
        style={{
          padding: "2px 8px",
          fontSize: 11,
          fontFamily: MONO,
          fontWeight: activeTag === null ? 600 : 400,
          border: "1px solid var(--cc-line-alpha-30)",
          borderRadius: 4,
          backgroundColor: activeTag === null ? "var(--cc-line-alpha-15)" : "transparent",
          color: activeTag === null ? "var(--cc-text-primary)" : "var(--cc-text-tertiary)",
          cursor: "pointer",
          transition: "all 120ms ease",
        }}
      >
        All
      </button>
      {distinctTags.map((tag) => (
        <button
          key={tag}
          onClick={() => onTagChange(activeTag === tag ? null : tag)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 8px",
            fontSize: 11,
            fontFamily: MONO,
            fontWeight: activeTag === tag ? 600 : 400,
            border: "1px solid var(--cc-line-alpha-30)",
            borderRadius: 4,
            backgroundColor: activeTag === tag ? "var(--cc-line-alpha-15)" : "transparent",
            color: activeTag === tag ? "var(--cc-text-primary)" : "var(--cc-text-tertiary)",
            cursor: "pointer",
            transition: "all 120ms ease",
          }}
        >
          <Tag size={9} />
          {tag}
        </button>
      ))}
    </div>
  );
}

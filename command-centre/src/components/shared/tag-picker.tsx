"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Tag, X, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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
};

const DEFAULT_DROPDOWN_POSITION: DropdownPosition = {
  top: 0,
  left: 0,
  width: 200,
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
    if (!rect) return;
    setDropdownPosition({
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 200),
    });
  }, []);

  // Fetch existing tags when dropdown opens
  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/tasks/tags")
      .then((r) => r.json())
      .then((data: string[]) => setTags(data))
      .catch(() => {});
    updateDropdownPosition();
    // Focus input after opening
    requestAnimationFrame(() => inputRef.current?.focus());
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
        className={cn(
          "inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-medium transition-colors hover:border-foreground/30",
          value
            ? "border-border bg-muted text-muted-foreground"
            : "border-border bg-transparent text-muted-foreground",
        )}
      >
        <Tag size={11} />
        {value || "tag"}
        {value && (
          <span
            onClick={clearTag}
            className="ml-px inline-flex cursor-pointer items-center"
          >
            <X size={10} />
          </span>
        )}
      </button>

      {isOpen && typeof document !== "undefined" && createPortal(
        <div
          ref={dropdownRef}
          className="border border-border"
          style={{
            position: "fixed",
            top: dropdownPosition.top,
            left: dropdownPosition.left,
            backgroundColor: "var(--popover)",
            borderRadius: 8,
            boxShadow: "0 12px 28px color-mix(in srgb, var(--foreground) 10%, transparent)",
            padding: 4,
            zIndex: 1000,
            width: dropdownPosition.width,
            opacity: 1,
          }}
        >
          <div style={{ padding: "4px 8px" }}>
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search or create..."
              onClick={(e) => e.stopPropagation()}
              className="h-8 text-xs"
            />
          </div>

          <div style={{ maxHeight: 160, overflowY: "auto" }}>
            {filtered.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  selectTag(tag);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-muted",
                  value === tag && "bg-muted",
                )}
              >
                <span>{tag}</span>
                {value === tag && <Check size={12} className="text-foreground" />}
              </button>
            ))}

            {showCreate && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  selectTag(query.trim());
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                Create &quot;{query.trim()}&quot;
              </button>
            )}

            {filtered.length === 0 && !showCreate && (
              <div className="px-3 py-2 text-center text-xs text-muted-foreground">
                No tags yet
              </div>
            )}
          </div>

          {value && (
            <div className="mt-1 border-t border-border pt-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                  setOpen(false);
                  setQuery("");
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted"
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
    <Badge variant="secondary" className="gap-1 px-2 py-0 text-[10px] font-medium">
      <Tag size={8} />
      {tag}
    </Badge>
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
    <div className="flex flex-wrap items-center gap-1">
      <button
        onClick={() => onTagChange(null)}
        className={cn(
          "cursor-pointer rounded-md border border-border px-2 py-1 text-[11px] transition-colors hover:bg-muted",
          activeTag === null
            ? "bg-muted font-semibold text-foreground"
            : "bg-transparent font-normal text-muted-foreground",
        )}
      >
        All
      </button>
      {distinctTags.map((tag) => (
        <button
          key={tag}
          onClick={() => onTagChange(activeTag === tag ? null : tag)}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] transition-colors hover:bg-muted",
            activeTag === tag
              ? "bg-muted font-semibold text-foreground"
              : "bg-transparent font-normal text-muted-foreground",
          )}
        >
          <Tag size={9} />
          {tag}
        </button>
      ))}
    </div>
  );
}


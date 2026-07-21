"use client";

import { useRef, useEffect, useState } from "react";
import { ChevronRight, FolderOpen, FileText } from "lucide-react";
import { filterCommands, CATEGORY_LABELS, type SlashCommand } from "@/lib/slash-commands";

export interface TagItem {
  name: string;
  body: string;
  category?: string;
  description?: string;
}

interface SlashCommandMenuProps {
  query: string;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
  /** Position the menu above or below the input */
  anchor?: "above" | "below";
  /** When "tag", renders prompt tags instead of slash commands. */
  mode?: "slash" | "tag";
  /** Tag items to render when mode === "tag". */
  tagItems?: TagItem[];
  /** Called when a tag is selected (mode === "tag"). */
  onTagSelect?: (tag: TagItem) => void;
}

/** A collapsible category folder for the slash command menu. */
function SlashCategoryFolder({
  label,
  commands,
  onSelect,
  count,
}: {
  label: string;
  commands: SlashCommand[];
  onSelect: (cmd: SlashCommand) => void;
  count: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          textAlign: "left",
          padding: "8px 12px",
          border: "none",
          cursor: "pointer",
          background: "transparent",
          transition: "background 80ms ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--foreground) 3%, transparent)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <FolderOpen size={14} color="var(--primary)" style={{ flexShrink: 0 }} />
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            color: "var(--foreground)",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "var(--muted-foreground)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
          }}
        >
          {count}
        </span>
        <ChevronRight
          size={12}
          color="var(--muted-foreground)"
          style={{
            flexShrink: 0,
            transition: "transform 150ms ease",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
          }}
        />
      </button>
      {open && (
        <div style={{ paddingLeft: 12 }}>
          {commands.map((cmd) => (
            <button
              key={cmd.command}
              type="button"
              onClick={() => onSelect(cmd)}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                border: "none",
                cursor: "pointer",
                background: "transparent",
                transition: "background 80ms ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--foreground) 6%, transparent)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  color: "var(--primary)",
                  whiteSpace: "nowrap",
                }}
              >
                {cmd.command}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  color: "var(--muted-foreground)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {cmd.description}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A collapsible category folder for the tag menu. */
function TagCategoryFolder({
  label,
  tags,
  onTagSelect,
}: {
  label: string;
  tags: TagItem[];
  onTagSelect?: (tag: TagItem) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          textAlign: "left",
          padding: "8px 12px",
          border: "none",
          cursor: "pointer",
          background: "transparent",
          transition: "background 80ms ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--foreground) 3%, transparent)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <FolderOpen size={14} color="var(--primary)" style={{ flexShrink: 0 }} />
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            color: "var(--foreground)",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "var(--muted-foreground)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
          }}
        >
          {tags.length}
        </span>
        <ChevronRight
          size={12}
          color="var(--muted-foreground)"
          style={{
            flexShrink: 0,
            transition: "transform 150ms ease",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
          }}
        />
      </button>
      {open && (
        <div style={{ paddingLeft: 12 }}>
          {tags.map((tag) => (
            <button
              key={tag.name}
              type="button"
              onClick={() => onTagSelect?.(tag)}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                border: "none",
                cursor: "pointer",
                background: "transparent",
                transition: "background 80ms ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--foreground) 6%, transparent)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <FileText size={12} color="var(--muted-foreground)" style={{ flexShrink: 0 }} />
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    color: "var(--primary)",
                  }}
                >
                  @{tag.name}
                </span>
              </div>
              {tag.description && (
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    color: "var(--muted-foreground)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    paddingLeft: 20,
                  }}
                >
                  {tag.description.slice(0, 70)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SlashCommandMenu({
  query,
  onSelect,
  onClose,
  anchor = "above",
  mode = "slash",
  tagItems,
  onTagSelect,
}: SlashCommandMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  const isTagMode = mode === "tag";
  const filteredTags = isTagMode
    ? (tagItems ?? []).filter((t) => {
        const q = query.replace(/^@/, "").toLowerCase();
        return !q || t.name.toLowerCase().includes(q);
      })
    : [];
  const filtered = isTagMode ? [] : filterCommands(query);
  const itemCount = isTagMode ? filteredTags.length : filtered.length;

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    const el = itemRefs.current.get(selectedIndex);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Keyboard nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, itemCount - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (
        (e.key === "Enter" || e.key === "Tab") &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        if (isTagMode) {
          if (filteredTags[selectedIndex]) onTagSelect?.(filteredTags[selectedIndex]);
        } else {
          if (filtered[selectedIndex]) onSelect(filtered[selectedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [filtered, filteredTags, selectedIndex, onSelect, onTagSelect, onClose, isTagMode, itemCount]);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  if (itemCount === 0) return null;

  if (isTagMode) {
    const TAG_CATEGORY_LABELS: Record<string, string> = {
      context: "Context Tags",
      brand: "Brand Context",
      brief: "Project Briefs",
      memory: "Memory",
    };
    const TAG_CATEGORY_ORDER = ["context", "brand", "brief", "memory"];

    // Group tags by category
    const categories = new Map<string, TagItem[]>();
    for (const tag of filteredTags) {
      const cat = tag.category || "context";
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat)!.push(tag);
    }

    // Determine if we're filtering into a specific category (e.g. "brand/" or "brief/")
    const q = query.replace(/^@/, "").toLowerCase();
    const isDeepFilter = q.includes("/") || (q.length > 0 && categories.size <= 1);

    // When no deep filter, show collapsed category folders.
    // When deep-filtering (user typed "brand/" or a specific query), show flat items.
    const menuStyle = {
      position: "absolute" as const,
      left: 0,
      right: 0,
      ...(anchor === "above" ? { bottom: "100%", marginBottom: 4 } : { top: "100%", marginTop: 4 }),
      backgroundColor: "var(--popover)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      boxShadow: "0 8px 24px color-mix(in srgb, var(--foreground) 10%, transparent)",
      maxHeight: 360,
      overflowY: "auto" as const,
      zIndex: 60,
      padding: "4px 0",
    };

    if (!isDeepFilter) {
      // Category folder view — show expandable folders
      return (
        <div ref={menuRef} style={menuStyle}>
          {TAG_CATEGORY_ORDER.filter((cat) => categories.has(cat)).map((cat) => (
            <TagCategoryFolder
              key={cat}
              label={TAG_CATEGORY_LABELS[cat] || cat}
              tags={categories.get(cat)!}
              onTagSelect={onTagSelect}
            />
          ))}
        </div>
      );
    }

    // Deep filter — flat list of matching items
    let flatIdx = 0;
    return (
      <div ref={menuRef} style={menuStyle}>
        {filteredTags.map((tag) => {
          const idx = flatIdx++;
          return (
            <button
              key={tag.name}
              ref={(el) => { if (el) itemRefs.current.set(idx, el); }}
              onClick={() => onTagSelect?.(tag)}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                border: "none",
                cursor: "pointer",
                backgroundColor: idx === selectedIndex ? "color-mix(in srgb, var(--foreground) 6%, transparent)" : "transparent",
                transition: "background 80ms ease",
              }}
              onMouseEnter={() => setSelectedIndex(idx)}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  color: "var(--primary)",
                }}
              >
                @{tag.name}
              </span>
              {(tag.description || tag.body) && (
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    color: "var(--muted-foreground)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {(tag.description || tag.body.split("\n")[0]).slice(0, 80)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  const SLASH_CATEGORY_ORDER = ["session", "skill", "gsd", "system"];
  const q = query.replace(/^\//, "").toLowerCase();
  const isDeepFilter = q.length > 0;

  const menuStyle = {
    position: "absolute" as const,
    left: 0,
    right: 0,
    ...(anchor === "above" ? { bottom: "100%", marginBottom: 4 } : { top: "100%", marginTop: 4 }),
    backgroundColor: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    boxShadow: "0 8px 24px color-mix(in srgb, var(--foreground) 10%, transparent)",
    maxHeight: 360,
    overflowY: "auto" as const,
    zIndex: 60,
    padding: "4px 0",
  };

  // No query — show collapsible category folders
  if (!isDeepFilter) {
    const categories = new Map<string, SlashCommand[]>();
    for (const cmd of filtered) {
      if (!categories.has(cmd.category)) categories.set(cmd.category, []);
      categories.get(cmd.category)!.push(cmd);
    }

    return (
      <div ref={menuRef} style={menuStyle}>
        {SLASH_CATEGORY_ORDER.filter((cat) => categories.has(cat)).map((cat) => (
          <SlashCategoryFolder
            key={cat}
            label={CATEGORY_LABELS[cat] || cat}
            commands={categories.get(cat)!}
            onSelect={onSelect}
            count={categories.get(cat)!.length}
          />
        ))}
      </div>
    );
  }

  // Typing a query — flat filtered list with highlighted selection
  return (
    <div ref={menuRef} style={menuStyle}>
      {filtered.map((cmd, i) => (
        <button
          key={cmd.command}
          ref={(el) => { if (el) itemRefs.current.set(i, el); }}
          onClick={() => onSelect(cmd)}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            width: "100%",
            textAlign: "left",
            padding: "8px 12px",
            border: "none",
            cursor: "pointer",
            backgroundColor: i === selectedIndex ? "color-mix(in srgb, var(--foreground) 6%, transparent)" : "transparent",
            transition: "background 80ms ease",
          }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              color: "var(--primary)",
              whiteSpace: "nowrap",
            }}
          >
            {cmd.command}
          </span>
          <span
            style={{
              fontSize: 12,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              color: "var(--muted-foreground)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {cmd.description}
          </span>
        </button>
      ))}
    </div>
  );
}

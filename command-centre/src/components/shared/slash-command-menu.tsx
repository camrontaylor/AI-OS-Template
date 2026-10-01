"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, FolderOpen, FileText } from "lucide-react";
import { filterCommands, CATEGORY_LABELS, type SlashCommand } from "@/lib/slash-commands";
import { POPOVER_LAYER_Z_INDEX, resolvePopoverPosition } from "./popover-position";

const MENU_GAP = 4;
const MENU_MAX_HEIGHT = 360;
const VIEWPORT_PADDING = 8;

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
  /** Preferred position. The menu flips automatically when that side cannot fit it. */
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
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cc-neutral-alpha-03)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <FolderOpen size={14} color="var(--cc-brand-primary)" style={{ flexShrink: 0 }} />
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
            color: "var(--cc-text-primary)",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "var(--cc-text-muted)",
            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
          }}
        >
          {count}
        </span>
        <ChevronRight
          size={12}
          color="var(--cc-text-muted)"
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
                padding: "6px 12px",
                border: "none",
                cursor: "pointer",
                background: "transparent",
                transition: "background 80ms ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cc-brand-alpha-06)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                  color: "var(--cc-brand-primary)",
                  whiteSpace: "nowrap",
                }}
              >
                {cmd.command}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  color: "var(--cc-text-muted)",
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
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cc-neutral-alpha-03)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <FolderOpen size={14} color="var(--cc-brand-primary)" style={{ flexShrink: 0 }} />
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
            color: "var(--cc-text-primary)",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "var(--cc-text-muted)",
            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
          }}
        >
          {tags.length}
        </span>
        <ChevronRight
          size={12}
          color="var(--cc-text-muted)"
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
                gap: 1,
                width: "100%",
                textAlign: "left",
                padding: "5px 12px",
                border: "none",
                cursor: "pointer",
                background: "transparent",
                transition: "background 80ms ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cc-brand-alpha-06)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <FileText size={12} color="var(--cc-text-muted)" style={{ flexShrink: 0 }} />
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                    color: "var(--cc-brand-primary)",
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
                    color: "var(--cc-text-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    paddingLeft: 18,
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
  const [allowedSkillNames, setAllowedSkillNames] = useState<string[] | null>(null);
  const [menuPosition, setMenuPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: MENU_MAX_HEIGHT,
    positioned: false,
  });
  const anchorRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  const isTagMode = mode === "tag";
  const filteredTags = isTagMode
    ? (tagItems ?? []).filter((t) => {
        const q = query.replace(/^@/, "").toLowerCase();
        return !q || t.name.toLowerCase().includes(q);
      })
    : [];
  useEffect(() => {
    if (isTagMode) return;
    let canceled = false;
    fetch("/api/skills")
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (canceled || !Array.isArray(body)) return;
        setAllowedSkillNames(
          body
            .map((skill: { folderName?: unknown }) =>
              typeof skill.folderName === "string" ? skill.folderName : null,
            )
            .filter((name): name is string => Boolean(name)),
        );
      })
      .catch(() => {});
    return () => {
      canceled = true;
    };
  }, [isTagMode]);

  const filtered = isTagMode ? [] : filterCommands(query, allowedSkillNames);
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
      const target = e.target as Node;
      const anchorContainer = anchorRef.current?.parentElement;
      const clickedMenu = menuRef.current?.contains(target);
      const clickedAnchor = anchorContainer?.contains(target);
      if (!clickedMenu && !clickedAnchor) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const updateMenuPosition = useCallback(() => {
    const menu = menuRef.current;
    const anchorElement = anchorRef.current;
    if (!menu || !anchorElement || typeof window === "undefined") return;
    const rect = anchorElement.getBoundingClientRect();
    const measurementWidth = Math.min(
      Math.max(0, rect.width),
      Math.max(0, window.innerWidth - VIEWPORT_PADDING * 2),
    );
    menu.style.width = `${measurementWidth}px`;
    const resolved = resolvePopoverPosition({
      anchor: {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
      },
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      popoverWidth: rect.width,
      contentHeight: menu.scrollHeight,
      maxHeight: MENU_MAX_HEIGHT,
      preferredPlacement: anchor,
      gap: MENU_GAP,
      viewportPadding: VIEWPORT_PADDING,
    });

    setMenuPosition({
      top: resolved.top,
      left: resolved.left,
      width: resolved.width,
      maxHeight: resolved.maxHeight,
      positioned: true,
    });
  }, [anchor]);

  useLayoutEffect(() => {
    if (itemCount === 0) return;
    updateMenuPosition();
    const handleWindowChange = () => updateMenuPosition();
    const menu = menuRef.current;
    const anchorElement = anchorRef.current;
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => updateMenuPosition());
    if (menu) observer?.observe(menu);
    if (anchorElement) observer?.observe(anchorElement);
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [itemCount, updateMenuPosition]);

  if (itemCount === 0) return null;

  const menuStyle = {
    position: "fixed" as const,
    top: menuPosition.top,
    left: menuPosition.left,
    width: menuPosition.width,
    boxSizing: "border-box" as const,
    backgroundColor: "var(--cc-surface)",
    border: "1px solid var(--cc-line-alpha-30)",
    borderRadius: 8,
    boxShadow: "0 8px 24px var(--cc-brand-alpha-10)",
    maxHeight: menuPosition.maxHeight,
    overflowY: "auto" as const,
    zIndex: POPOVER_LAYER_Z_INDEX,
    padding: "4px 0",
    visibility: menuPosition.positioned ? "visible" as const : "hidden" as const,
  };

  const renderMenu = (children: ReactNode) => (
    <>
      <span
        ref={anchorRef}
        aria-hidden
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      />
      {typeof document !== "undefined" && createPortal(
        <div ref={menuRef} data-composer-popover-open="true" role="menu" style={menuStyle}>
          {children}
        </div>,
        document.body,
      )}
    </>
  );

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
    if (!isDeepFilter) {
      // Category folder view — show expandable folders
      return renderMenu(
        <>
          {TAG_CATEGORY_ORDER.filter((cat) => categories.has(cat)).map((cat) => (
            <TagCategoryFolder
              key={cat}
              label={TAG_CATEGORY_LABELS[cat] || cat}
              tags={categories.get(cat)!}
              onTagSelect={onTagSelect}
            />
          ))}
        </>
      );
    }

    // Deep filter — flat list of matching items
    let flatIdx = 0;
    return renderMenu(
      <>
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
                gap: 2,
                width: "100%",
                textAlign: "left",
                padding: "6px 12px",
                border: "none",
                cursor: "pointer",
                backgroundColor: idx === selectedIndex ? "var(--cc-brand-alpha-06)" : "transparent",
                transition: "background 80ms ease",
              }}
              onMouseEnter={() => setSelectedIndex(idx)}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                  color: "var(--cc-brand-primary)",
                }}
              >
                @{tag.name}
              </span>
              {(tag.description || tag.body) && (
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    color: "var(--cc-text-muted)",
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
      </>
    );
  }

  const SLASH_CATEGORY_ORDER = ["session", "skill", "gsd", "system"];
  const q = query.replace(/^\//, "").toLowerCase();
  const isDeepFilter = q.length > 0;

  // No query — show collapsible category folders
  if (!isDeepFilter) {
    const categories = new Map<string, SlashCommand[]>();
    for (const cmd of filtered) {
      if (!categories.has(cmd.category)) categories.set(cmd.category, []);
      categories.get(cmd.category)!.push(cmd);
    }

    return renderMenu(
      <>
        {SLASH_CATEGORY_ORDER.filter((cat) => categories.has(cat)).map((cat) => (
          <SlashCategoryFolder
            key={cat}
            label={CATEGORY_LABELS[cat] || cat}
            commands={categories.get(cat)!}
            onSelect={onSelect}
            count={categories.get(cat)!.length}
          />
        ))}
      </>
    );
  }

  // Typing a query — flat filtered list with highlighted selection
  return renderMenu(
    <>
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
            backgroundColor: i === selectedIndex ? "var(--cc-brand-alpha-06)" : "transparent",
            transition: "background 80ms ease",
          }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
              color: "var(--cc-brand-primary)",
              whiteSpace: "nowrap",
            }}
          >
            {cmd.command}
          </span>
          <span
            style={{
              fontSize: 12,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              color: "var(--cc-text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {cmd.description}
          </span>
        </button>
      ))}
    </>
  );
}

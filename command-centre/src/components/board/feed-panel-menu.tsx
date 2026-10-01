"use client";

import {
  Files,
  GitCompareArrows,
  ListTree,
  MessageSquare,
  PanelsTopLeft,
  Check,
  Plus,
  ScrollText,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { AVAILABLE_FEED_PANELS } from "./feed-panel-registry";
import type { FeedPanelType } from "./feed-canvas-state";
import { useFeedMenuNavigation } from "./use-feed-menu-navigation";
import menuStyles from "./feed-menu.module.css";

const ICONS: Record<FeedPanelType, LucideIcon> = {
  chat: MessageSquare,
  terminal: TerminalSquare,
  subchats: ListTree,
  file: ScrollText,
  files: Files,
  plan: PanelsTopLeft,
  changes: GitCompareArrows,
};

export function FeedPanelMenu({
  onAddPanel,
  onOpenMainChat,
  mainChatOpen,
  disabled = false,
  openPanelTypes = [],
}: {
  onAddPanel: (type: FeedPanelType) => void;
  onOpenMainChat: () => void;
  mainChatOpen: boolean;
  disabled?: boolean;
  openPanelTypes?: Iterable<FeedPanelType>;
}) {
  const [open, setOpen] = useState(false);
  const openTypes = new Set(openPanelTypes);
  const {
    triggerRef,
    menuRef,
    registerItem,
    closeMenu,
    onMenuKeyDown,
    onTriggerKeyDown,
  } = useFeedMenuNavigation({ open, setOpen });

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        className={menuStyles.trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onTriggerKeyDown}
        style={{
          height: 28,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "0 10px",
          border: "1px solid var(--cc-line-alpha-50)",
          borderRadius: 7,
          background: "var(--cc-surface)",
          color: "var(--cc-text-secondary)",
          font: "600 11.5px/1 var(--cc-font-label)",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.45 : 1,
        }}
      >
        <Plus size={13} aria-hidden /> Panel
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Add panel"
          onKeyDown={onMenuKeyDown}
          style={{
            position: "absolute",
            top: 34,
            right: 0,
            zIndex: 100,
            width: 190,
            padding: 4,
            border: "1px solid var(--cc-line-alpha-20)",
            borderRadius: 8,
            background: "var(--cc-surface)",
            boxShadow: "var(--cc-shadow-popover)",
          }}
        >
          <button
            ref={registerItem(0)}
            className={menuStyles.item}
            type="button"
            role="menuitem"
            onClick={() => {
              onOpenMainChat();
              closeMenu();
            }}
            style={{
              width: "100%",
              height: 32,
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "0 10px",
              border: 0,
              borderRadius: 6,
              background: "transparent",
              color: mainChatOpen ? "var(--cc-text-tertiary)" : "var(--cc-text-primary)",
              font: "400 12.5px/1 var(--cc-font-body)",
              cursor: "pointer",
              textAlign: "left",
              opacity: mainChatOpen ? 0.72 : 1,
            }}
          >
            <MessageSquare size={14} aria-hidden style={{ color: "var(--cc-text-secondary)" }} />
            <span style={{ flex: 1, minWidth: 0 }}>Main chat</span>
            {mainChatOpen ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600 }}>
                <Check size={11} aria-hidden /> Open
              </span>
            ) : null}
          </button>
          {AVAILABLE_FEED_PANELS.map((descriptor, index) => {
            const type = descriptor.type;
            const Icon = ICONS[type];
            const comingSoon = descriptor.availability === "coming-soon";
            const alreadyOpen = descriptor.singleton && openTypes.has(type);
            return (
              <button
                key={type}
                ref={registerItem(index + 1)}
                className={menuStyles.item}
                type="button"
                role="menuitem"
                disabled={comingSoon}
                aria-disabled={comingSoon}
                onClick={() => {
                  if (comingSoon) return;
                  onAddPanel(type);
                  closeMenu();
                }}
                style={{
                  width: "100%",
                  height: 32,
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "0 10px",
                  border: 0,
                  borderRadius: 6,
                  background: "transparent",
                  color: comingSoon || alreadyOpen ? "var(--cc-text-tertiary)" : "var(--cc-text-primary)",
                  font: "400 12.5px/1 var(--cc-font-body)",
                  cursor: comingSoon ? "not-allowed" : "pointer",
                  textAlign: "left",
                  opacity: comingSoon ? 0.55 : alreadyOpen ? 0.72 : 1,
                }}
              >
                <Icon size={14} aria-hidden style={{ color: "var(--cc-text-secondary)" }} />
                <span style={{ flex: 1, minWidth: 0 }}>{descriptor.title}</span>
                {alreadyOpen ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600 }}>
                    <Check size={11} aria-hidden /> Open
                  </span>
                ) : null}
                {comingSoon ? (
                  <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: ".02em" }}>Coming soon</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

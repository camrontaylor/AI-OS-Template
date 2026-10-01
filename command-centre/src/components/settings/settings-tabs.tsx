"use client";

import { Terminal, KeyRound, Plug, FileCode, Palette } from "lucide-react";
import type { ComponentType } from "react";

export type SettingsTabId = "scripts" | "env" | "mcp" | "claude" | "appearance";

interface Tab {
  id: SettingsTabId;
  label: string;
  icon: ComponentType<{ size?: number }>;
}

const tabs: Tab[] = [
  { id: "scripts", label: "Local Scripts", icon: Terminal },
  { id: "env", label: "Local Environment", icon: KeyRound },
  { id: "mcp", label: "Local MCP", icon: Plug },
  { id: "claude", label: "Local Claude", icon: FileCode },
  { id: "appearance", label: "Appearance", icon: Palette },
];

interface SettingsTabsProps {
  activeTab: SettingsTabId;
  onTabChange: (tab: SettingsTabId) => void;
}

export function SettingsTabs({ activeTab, onTabChange }: SettingsTabsProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: 0,
        borderBottom: "1px solid var(--cc-line-alpha-20)",
        padding: "0 24px",
        overflowX: "auto",
        scrollbarWidth: "thin",
      }}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={{
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
              padding: "12px 20px",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 14,
              fontWeight: 500,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: isActive ? "var(--cc-brand-primary)" : "var(--cc-text-secondary)",
              borderBottom: isActive
                ? "2px solid var(--cc-brand-primary)"
                : "2px solid transparent",
              transition: "color 150ms ease, border-color 150ms ease",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = "var(--cc-text-primary)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = "var(--cc-text-secondary)";
              }
            }}
          >
            <Icon size={16} />
            <span style={{ marginLeft: 8 }}>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

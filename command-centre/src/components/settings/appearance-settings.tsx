"use client";

import { useState } from "react";
import { useThemePreference } from "@/components/theme-provider";
import type { ThemePreference } from "@/design-system/theme-preference";

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "System default" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function AppearanceSettings() {
  const { preference, resolvedTheme, setPreference } = useThemePreference();
  const [selectFocused, setSelectFocused] = useState(false);
  const systemDescription =
    preference === "system"
      ? `Uses your system setting. Currently ${resolvedTheme}.`
      : "Choose the theme used by Command Centre.";

  return (
    <div>
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--cc-line-alpha-20)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
            fontSize: 16,
            fontWeight: 600,
            color: "var(--cc-text-primary)",
          }}
        >
          Appearance
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 13,
            color: "var(--cc-text-secondary)",
          }}
        >
          Control how Command Centre looks on this device
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--cc-space-6)",
          padding: "var(--cc-space-5)",
          borderBottom: "1px solid var(--cc-line-alpha-10)",
        }}
      >
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <label
            htmlFor="command-centre-theme-select"
            style={{
              display: "block",
              fontSize: 14,
              fontWeight: 600,
              color: "var(--cc-text-primary)",
            }}
          >
            Theme
          </label>
          <div
            style={{
              marginTop: 3,
              fontSize: 13,
              lineHeight: 1.5,
              color: "var(--cc-text-secondary)",
            }}
          >
            {systemDescription}
          </div>
        </div>

        <select
          id="command-centre-theme-select"
          value={preference}
          onChange={(event) => setPreference(event.target.value as ThemePreference)}
          onFocus={() => setSelectFocused(true)}
          onBlur={() => setSelectFocused(false)}
          aria-label="Command Centre theme"
          style={{
            flex: "1 1 180px",
            width: "100%",
            maxWidth: 240,
            minHeight: 40,
            padding: "8px 36px 8px 12px",
            border: `1px solid ${
              selectFocused
                ? "var(--cc-brand-primary)"
                : "var(--cc-control-border)"
            }`,
            borderRadius: "var(--cc-radius-md)",
            backgroundColor: "var(--cc-surface)",
            color: "var(--cc-text-primary)",
            fontFamily: "var(--cc-font-body)",
            fontSize: 14,
            cursor: "pointer",
            outline: "none",
            boxShadow: selectFocused ? "var(--cc-focus-ring)" : "none",
            transition:
              "border-color var(--cc-motion-standard), box-shadow var(--cc-motion-standard), background-color var(--cc-motion-standard)",
          }}
        >
          {THEME_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

"use client";

import { useState, useCallback } from "react";

interface ScheduleValue {
  time: string;
  days: string;
}

interface ScheduleSelectorProps {
  value: ScheduleValue;
  onChange: (value: ScheduleValue) => void;
}

type Preset = "daily" | "weekdays" | "weekly" | "custom";

const PRESETS: { label: string; value: Preset }[] = [
  { label: "Daily", value: "daily" },
  { label: "Weekdays", value: "weekdays" },
  { label: "Weekly", value: "weekly" },
  { label: "Custom", value: "custom" },
];

const DAYS_OF_WEEK = [
  { label: "Mon", value: "mon" },
  { label: "Tue", value: "tue" },
  { label: "Wed", value: "wed" },
  { label: "Thu", value: "thu" },
  { label: "Fri", value: "fri" },
  { label: "Sat", value: "sat" },
  { label: "Sun", value: "sun" },
];

function getPresetFromDays(days: string): Preset {
  if (days === "daily") return "daily";
  if (days === "weekdays") return "weekdays";
  if (DAYS_OF_WEEK.some((d) => d.value === days)) return "weekly";
  return "custom";
}

export function ScheduleSelector({ value, onChange }: ScheduleSelectorProps) {
  const [preset, setPreset] = useState<Preset>(() => getPresetFromDays(value.days));

  const handlePresetChange = useCallback(
    (p: Preset) => {
      setPreset(p);
      let days = value.days;
      switch (p) {
        case "daily":
          days = "daily";
          break;
        case "weekdays":
          days = "weekdays";
          break;
        case "weekly":
          days = "mon";
          break;
        case "custom":
          // Keep current days
          break;
      }
      onChange({ time: value.time, days });
    },
    [value, onChange]
  );

  const chipBase: React.CSSProperties = {
    padding: "6px 14px",
    borderRadius: "0.375rem",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    border: "none",
    transition: "all 150ms ease",
    fontFamily: "var(--font-inter), Inter, sans-serif",
  };

  const selectedChip: React.CSSProperties = {
    ...chipBase,
    backgroundColor: "var(--cc-brand-soft)",
    color: "var(--cc-brand-strong)",
  };

  const unselectedChip: React.CSSProperties = {
    ...chipBase,
    backgroundColor: "var(--cc-control-bg)",
    color: "var(--cc-text-secondary)",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Preset chips */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            style={preset === p.value ? selectedChip : unselectedChip}
            onClick={() => handlePresetChange(p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Time picker -- always visible */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label
          style={{
            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "var(--cc-text-secondary)",
          }}
        >
          Time
        </label>
        <input
          type="time"
          value={value.time}
          onChange={(e) => onChange({ ...value, time: e.target.value })}
          style={{
            padding: "6px 10px",
            borderRadius: "0.375rem",
            border: "1px solid var(--cc-line-alpha-20)",
            backgroundColor: "var(--cc-surface)",
            fontSize: 14,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            color: "var(--cc-text-primary)",
            outline: "none",
          }}
        />
      </div>

      {/* Weekly: day selector */}
      {preset === "weekly" && (
        <div style={{ display: "flex", gap: 6 }}>
          {DAYS_OF_WEEK.map((d) => (
            <button
              key={d.value}
              type="button"
              style={
                value.days === d.value ? selectedChip : unselectedChip
              }
              onClick={() => onChange({ ...value, days: d.value })}
            >
              {d.label}
            </button>
          ))}
        </div>
      )}

      {/* Custom: day checkboxes */}
      {preset === "custom" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {DAYS_OF_WEEK.map((d) => {
            const selected = value.days.split(",").includes(d.value);
            return (
              <label
                key={d.value}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  cursor: "pointer",
                  fontSize: 13,
                  color: "var(--cc-text-primary)",
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                }}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => {
                    const current = value.days
                      .split(",")
                      .filter((v) => v.length > 0);
                    const next = selected
                      ? current.filter((v) => v !== d.value)
                      : [...current, d.value];
                    onChange({
                      ...value,
                      days: next.length > 0 ? next.join(",") : "daily",
                    });
                  }}
                />
                {d.label}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

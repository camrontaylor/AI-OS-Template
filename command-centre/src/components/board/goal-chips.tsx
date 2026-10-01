"use client";

import { useEffect, useState } from "react";
import { profileStorageKey } from "@/lib/profile-storage";

interface PromptTag {
  name: string;
  body: string;
  starter: boolean;
}

const RECENT_TAGS_KEY = "cc.recent-tags";
const MAX_RECENT = 3;

function getRecentTags(): string[] {
  try {
    const raw = localStorage.getItem(profileStorageKey(RECENT_TAGS_KEY));
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export function recordTagUsage(name: string) {
  try {
    const recent = getRecentTags().filter((n) => n !== name);
    recent.unshift(name);
    localStorage.setItem(profileStorageKey(RECENT_TAGS_KEY), JSON.stringify(recent.slice(0, MAX_RECENT)));
  } catch {
    // ignore
  }
}

interface GoalChipsProps {
  onInsert: (text: string) => void;
}

export function GoalChips({ onInsert }: GoalChipsProps) {
  const [tags, setTags] = useState<PromptTag[]>([]);

  useEffect(() => {
    fetch("/api/prompt-tags")
      .then((r) => r.json())
      .then((data) => setTags(data.tags ?? []))
      .catch(() => {});
  }, []);

  if (tags.length === 0) return null;

  const starters = tags.filter((t) => t.starter);
  const recentNames = getRecentTags();
  const recentTags = recentNames
    .map((name) => tags.find((t) => t.name === name))
    .filter((t): t is PromptTag => !!t && !t.starter);

  const chips = [...starters, ...recentTags].slice(0, 5);
  if (chips.length === 0) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "4px 0 2px" }}>
      {chips.map((chip) => (
        <button
          key={chip.name}
          onClick={() => {
            onInsert(`@${chip.name} `);
            recordTagUsage(chip.name);
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            padding: "3px 8px",
            fontSize: 10,
            fontFamily: "'DM Mono', monospace",
            color: "var(--cc-brand-primary)",
            background: "var(--cc-brand-alpha-05)",
            border: "1px solid var(--cc-brand-alpha-15)",
            borderRadius: 4,
            cursor: "pointer",
            transition: "all 120ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--cc-brand-alpha-12)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--cc-brand-alpha-05)";
          }}
        >
          @{chip.name}
        </button>
      ))}
    </div>
  );
}

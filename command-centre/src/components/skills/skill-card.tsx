"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { InstalledSkill } from "@/types/file";

interface SkillCardProps {
  skill: InstalledSkill;
}

export function SkillCard({ skill }: SkillCardProps) {
  const [depsExpanded, setDepsExpanded] = useState(false);
  const hasDeps = skill.dependencies.length > 0;

  return (
    <div
      style={{
        backgroundColor: "var(--cc-surface)",
        borderRadius: "0.5rem",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        transition: "box-shadow 200ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "0px 12px 32px var(--cc-brand-alpha-06)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {/* Header: category chip + name */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            backgroundColor: "var(--cc-brand-soft)",
            color: "var(--cc-brand-strong)",
            padding: "2px 8px",
            borderRadius: 4,
            fontWeight: 500,
          }}
        >
          {skill.category}
        </span>
        <span
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 14,
            fontWeight: 600,
            color: "var(--cc-text-primary)",
          }}
        >
          {skill.name}
        </span>
      </div>

      {/* Description */}
      <p
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 13,
          color: "var(--cc-text-secondary)",
          margin: 0,
          lineHeight: 1.4,
        }}
      >
        {skill.description}
      </p>

      {/* Trigger chips */}
      {skill.triggers.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
          {skill.triggers.map((trigger) => (
            <span
              key={trigger}
              style={{
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                fontSize: 10,
                backgroundColor: "var(--cc-control-bg)",
                color: "var(--cc-text-secondary)",
                padding: "2px 8px",
                borderRadius: 4,
              }}
            >
              {trigger}
            </span>
          ))}
        </div>
      )}

      {/* Dependencies section (collapsible) */}
      {hasDeps && (
        <div style={{ marginTop: 4 }}>
          <button
            onClick={() => setDepsExpanded(!depsExpanded)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
              fontSize: 11,
              color: "var(--cc-text-secondary)",
              fontWeight: 500,
            }}
          >
            {depsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Dependencies ({skill.dependencies.length})
          </button>

          {depsExpanded && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              {skill.dependencies.map((dep) => (
                <div key={dep.skill} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                      style={{
                        fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                        fontSize: 11,
                        backgroundColor: dep.required ? "var(--cc-brand-soft)" : "var(--cc-control-bg)",
                        color: dep.required ? "var(--cc-brand-strong)" : "var(--cc-text-secondary)",
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontWeight: 500,
                      }}
                    >
                      {dep.skill}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                        fontSize: 10,
                        color: dep.required ? "var(--cc-brand-primary)" : "var(--cc-text-secondary)",
                      }}
                    >
                      {dep.required ? "Required" : "Optional"}
                    </span>
                  </div>
                  <p
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 12,
                      color: "var(--cc-text-secondary)",
                      margin: 0,
                      paddingLeft: 4,
                    }}
                  >
                    {dep.description}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

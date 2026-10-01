"use client";

import { useState, useEffect, useMemo } from "react";
import { Search, Cpu, ChevronDown, ChevronUp, Plus } from "lucide-react";
import type { SkillCatalogEntry, SkillFileSelection } from "@/types/file";
import { appendClientId, useClientId } from "@/hooks/use-client-id";
import { primarySkillFileSelection } from "@/lib/skill-navigation";

interface SkillsSummaryProps {
  onSelectSkill: (selection: SkillFileSelection) => void;
  onAddSkill: () => void;
}

function friendlySkillLoadMessage(message: string | null): string | null {
  if (!message) return null;
  if (message.includes("teamId is required") || message.includes("local-only action")) {
    return "Sign in to a Team OS server to view granted team skills, or sign out to view local skills.";
  }
  return message;
}

const stateChipBase = {
  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
  fontSize: 10,
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  padding: "2px 8px",
  borderRadius: 4,
  fontWeight: 500,
};

function SkillSummaryCard({
  skill,
  onSelect,
}: {
  skill: SkillCatalogEntry;
  onSelect: () => void;
}) {
  const [depsExpanded, setDepsExpanded] = useState(false);
  const hasDeps = skill.dependencies.length > 0;

  return (
    <div
      onClick={onSelect}
      style={{
        backgroundColor: "var(--cc-surface)",
        borderRadius: "0.5rem",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        cursor: "pointer",
        transition: "box-shadow 200ms ease",
        opacity: skill.hiddenByClient ? 0.55 : 1,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "0px 12px 32px var(--cc-brand-alpha-06)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {/* Header */}
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
        {skill.effectiveOrigin === "client" && (
          <span
            style={{
              ...stateChipBase,
              border: "1px solid var(--cc-brand-strong)",
              color: "var(--cc-brand-strong)",
              backgroundColor: "transparent",
            }}
          >
            client-only
          </span>
        )}
        {skill.clientOverride && (
          <span
            style={{
              ...stateChipBase,
              backgroundColor: "var(--cc-brand-soft)",
              color: "var(--cc-brand-strong)",
            }}
          >
            customized
          </span>
        )}
        {skill.hiddenByClient && (
          <span
            style={{
              ...stateChipBase,
              backgroundColor: "var(--cc-control-bg)",
              color: "var(--cc-text-secondary)",
            }}
          >
            off for this client
          </span>
        )}
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
        {skill.description.length > 100
          ? skill.description.slice(0, 100).trimEnd() + "…"
          : skill.description}
      </p>

      {/* Triggers */}
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

      {/* Dependencies */}
      {hasDeps && (
        <div style={{ marginTop: 4 }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDepsExpanded(!depsExpanded);
            }}
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

export function SkillsSummary({ onSelectSkill, onAddSkill }: SkillsSummaryProps) {
  const clientId = useClientId();
  const [skills, setSkills] = useState<SkillCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadMessage, setLoadMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    setLoading(true);
    setLoadMessage(null);
    fetch(appendClientId("/api/skills", clientId))
      .then(async (r) => {
        const data: unknown = await r.json().catch(() => null);
        if (!r.ok) {
          const message =
            data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : "Skills are not available right now.";
          setLoadMessage(message);
          return [];
        }
        if (!Array.isArray(data)) {
          setLoadMessage("Skills are not available right now.");
          return [];
        }
        return data as SkillCatalogEntry[];
      })
      .then((data) => {
        setSkills(data);
        setLoading(false);
      })
      .catch(() => {
        setLoadMessage("Skills are not available right now.");
        setLoading(false);
      });
  }, [clientId]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return skills;
    const q = searchQuery.toLowerCase();
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.triggers.some((t) => t.toLowerCase().includes(q))
    );
  }, [skills, searchQuery]);

  const grouped = useMemo(() => {
    const map: Record<string, SkillCatalogEntry[]> = {};
    for (const skill of filtered) {
      if (!map[skill.category]) map[skill.category] = [];
      map[skill.category].push(skill);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ height: 40, backgroundColor: "var(--cc-control-bg)", borderRadius: 8, marginBottom: 24, animation: "pulse-dot 1.5s ease-in-out infinite" }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "1rem" }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ backgroundColor: "var(--cc-surface)", borderRadius: "0.5rem", padding: 16, minHeight: 100 }}>
              <div style={{ height: 16, width: "50%", backgroundColor: "var(--cc-control-bg)", borderRadius: 4, marginBottom: 8, animation: "pulse-dot 1.5s ease-in-out infinite" }} />
              <div style={{ height: 32, width: "100%", backgroundColor: "var(--cc-control-bg)", borderRadius: 4, animation: "pulse-dot 1.5s ease-in-out infinite" }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px" }}>
        <Cpu size={48} style={{ color: "var(--cc-text-secondary)", margin: "0 auto 16px", display: "block" }} />
        <h4
          style={{
            fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
            fontWeight: 600,
            fontSize: 16,
            color: "var(--cc-text-primary)",
            margin: "0 0 8px 0",
          }}
        >
          No skills installed
        </h4>
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 14,
            color: "var(--cc-text-secondary)",
            maxWidth: 360,
            margin: "0 auto 16px",
          }}
        >
          {friendlySkillLoadMessage(loadMessage) || "Add skills to extend your assistant's capabilities."}
        </p>
        {!loadMessage && (
          <button
            onClick={onAddSkill}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              backgroundColor: "var(--cc-brand-primary)",
              color: "var(--cc-surface)",
              border: "none",
              borderRadius: "0.375rem",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <Plus size={14} /> Add Skill
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      {/* Header with count, search, and add button */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <p
            style={{
              fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
              fontSize: 13,
              color: "var(--cc-text-secondary)",
              margin: 0,
            }}
          >
            {skills.length} skills installed
          </p>
          <button
            onClick={onAddSkill}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              backgroundColor: "var(--cc-brand-primary)",
              color: "var(--cc-surface)",
              border: "none",
              borderRadius: "0.375rem",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              transition: "opacity 150ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.9"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
          >
            <Plus size={14} /> Add Skill
          </button>
        </div>

        <div style={{ position: "relative" }}>
          <Search
            size={16}
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--cc-text-secondary)",
              pointerEvents: "none",
            }}
          />
          <input
            type="text"
            placeholder="Search skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px 10px 36px",
              backgroundColor: "var(--cc-surface)",
              border: "1px solid var(--cc-line-alpha-20)",
              borderRadius: 8,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 14,
              color: "var(--cc-text-primary)",
              outline: "none",
              transition: "border-color 200ms ease",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "var(--cc-brand-primary)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "var(--cc-line-alpha-20)"; }}
          />
        </div>
      </div>

      {/* Grouped skills */}
      {grouped.map(([category, categorySkills], idx) => (
        <div key={category} style={{ marginBottom: 28 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 14,
              paddingBottom: 10,
              borderBottom: "1px solid var(--cc-line-alpha-25)",
            }}
          >
            <h4
              style={{
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: "var(--cc-text-primary)",
                margin: 0,
                fontWeight: 600,
              }}
            >
              {category}
            </h4>
            <span
              style={{
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                fontSize: 10,
                color: "var(--cc-text-tertiary)",
                fontWeight: 500,
              }}
            >
              ({categorySkills.length})
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "1rem" }}>
            {categorySkills.map((skill) => (
              <SkillSummaryCard
                key={skill.folderName}
                skill={skill}
                onSelect={() => onSelectSkill(primarySkillFileSelection(skill))}
              />
            ))}
          </div>
        </div>
      ))}

      {filtered.length === 0 && searchQuery && (
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 14,
            color: "var(--cc-text-secondary)",
            textAlign: "center",
            padding: 40,
          }}
        >
          No skills match &quot;{searchQuery}&quot;
        </p>
      )}
    </div>
  );
}

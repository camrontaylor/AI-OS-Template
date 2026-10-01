"use client";

import { Users, FolderOpen, AlertCircle, Globe } from "lucide-react";
import { useClientStore } from "@/store/client-store";
import type { ClientStats } from "@/types/dashboard";

interface ClientBreakdownProps {
  clientStats: ClientStats[];
}

export function ClientBreakdown({ clientStats }: ClientBreakdownProps) {
  const setSelectedClient = useClientStore((s) => s.setSelectedClient);

  if (clientStats.length === 0) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={headerStyle}>
        <Users size={16} color="var(--cc-brand-primary)" />
        <span style={labelStyle}>By Client</span>
        <span style={countStyle}>{clientStats.filter(c => c.slug !== "root").length} client{clientStats.filter(c => c.slug !== "root").length !== 1 ? "s" : ""}</span>
      </div>
      <div style={gridStyle}>
        {clientStats.map((client) => (
          <div
            key={client.slug}
            style={cardStyle}
            onClick={() => setSelectedClient(client.slug === "root" ? null : client.slug)}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = "0 2px 12px var(--cc-brand-alpha-08)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            {/* Client name with color dot / icon */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              {client.slug === "root" ? (
                <Globe size={14} style={{ color: "var(--cc-brand-primary)", flexShrink: 0 }} />
              ) : (
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    backgroundColor: client.color,
                    flexShrink: 0,
                  }}
                />
              )}
              <span style={nameStyle}>{client.name}</span>
              {client.reviewCount > 0 && (
                <span style={attentionBadgeStyle}>
                  <AlertCircle size={11} />
                  {client.reviewCount}
                </span>
              )}
            </div>

            {/* Stats row */}
            <div style={statsRowStyle}>
              <div style={statStyle}>
                <span style={statValueStyle}>{client.activeTasks}</span>
                <span style={statLabelStyle}>active</span>
              </div>
              <div style={dividerStyle} />
              <div style={statStyle}>
                <span style={statValueStyle}>{client.completedTasks}</span>
                <span style={statLabelStyle}>done (30d)</span>
              </div>
              {client.activeProjects > 0 && (
                <>
                  <div style={dividerStyle} />
                  <div style={statStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <FolderOpen size={12} color="var(--cc-brand-primary)" />
                      <span style={statValueStyle}>{client.activeProjects}</span>
                    </div>
                    <span style={statLabelStyle}>project{client.activeProjects !== 1 ? "s" : ""}</span>
                  </div>
                </>
              )}
              {client.totalCostUsd > 0 && (
                <>
                  <div style={dividerStyle} />
                  <div style={statStyle}>
                    <span style={statValueStyle}>${client.totalCostUsd.toFixed(2)}</span>
                    <span style={statLabelStyle}>cost</span>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 16,
};

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--cc-text-secondary)",
};

const countStyle: React.CSSProperties = {
  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
  fontSize: 11,
  fontWeight: 500,
  color: "var(--cc-text-tertiary)",
  marginLeft: "auto",
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
  gap: 12,
};

const cardStyle: React.CSSProperties = {
  backgroundColor: "var(--cc-surface-muted)",
  borderRadius: 12,
  padding: "16px 20px",
  cursor: "pointer",
  transition: "box-shadow 150ms ease",
};

const nameStyle: React.CSSProperties = {
  fontFamily: "var(--font-inter), Inter, sans-serif",
  fontSize: 15,
  fontWeight: 600,
  color: "var(--cc-text-primary)",
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const attentionBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
  fontSize: 10,
  fontWeight: 700,
  color: "var(--cc-status-warning-bright)",
  backgroundColor: "var(--cc-status-warning-bg)",
  padding: "2px 6px",
  borderRadius: 4,
  flexShrink: 0,
};

const statsRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const statStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const statValueStyle: React.CSSProperties = {
  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
  fontSize: 16,
  fontWeight: 600,
  color: "var(--cc-text-primary)",
  lineHeight: 1,
};

const statLabelStyle: React.CSSProperties = {
  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
  fontSize: 10,
  fontWeight: 500,
  color: "var(--cc-text-tertiary)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const dividerStyle: React.CSSProperties = {
  width: 1,
  height: 24,
  backgroundColor: "var(--cc-line-alpha-30)",
};

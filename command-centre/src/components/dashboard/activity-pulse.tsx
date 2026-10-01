"use client";

import Link from "next/link";
import { Activity, ArrowRight, Zap } from "lucide-react";
import type { DashboardSummary } from "@/types/dashboard";

interface ActivityPulseProps {
  weekStats: DashboardSummary["weekStats"];
  claudeUsage: DashboardSummary["claudeUsage"];
}

function formatTokens(n: number): string {
  if (n === 0) return "0";
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function ActivityPulse({ weekStats, claudeUsage }: ActivityPulseProps) {
  const hasActivity = claudeUsage.weekSessions > 0 || weekStats.tasksCompleted > 0;
  const hasBudget = claudeUsage.dailyTokenBudget > 0;
  const todayPct = hasBudget
    ? Math.min(100, Math.round((claudeUsage.todayTokens / claudeUsage.dailyTokenBudget) * 100))
    : 0;
  const isHigh = todayPct >= 80;
  const isMid = todayPct >= 50 && todayPct < 80;
  const barColor = isHigh ? "var(--cc-status-danger)" : isMid ? "var(--cc-status-warning)" : "var(--cc-brand-primary)";

  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <Activity size={16} color="var(--cc-brand-primary)" />
        <span style={labelStyle}>Token Usage</span>
      </div>
      {hasActivity ? (
        <>
          {/* Today */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={sectionLabelStyle}>Today</span>
              {hasBudget ? (
                <span style={{
                  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                  fontSize: 20,
                  fontWeight: 600,
                  color: isHigh ? "var(--cc-status-danger)" : "var(--cc-text-primary)",
                  lineHeight: 1,
                }}>
                  {todayPct}%
                </span>
              ) : (
                <div style={totalValueStyle}>
                  <Zap size={13} color="var(--cc-brand-primary)" />
                  {formatTokens(claudeUsage.todayTokens)}
                </div>
              )}
            </div>
            {hasBudget && (
              <>
                {/* Progress bar */}
                <div style={{
                  height: 6,
                  backgroundColor: "var(--cc-line-alpha-30)",
                  borderRadius: 3,
                  overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%",
                    width: `${todayPct}%`,
                    backgroundColor: barColor,
                    borderRadius: 3,
                    transition: "width 300ms ease",
                  }} />
                </div>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: 4,
                }}>
                  <span style={subtextStyle}>
                    {formatTokens(claudeUsage.todayTokens)} used
                  </span>
                  <span style={subtextStyle}>
                    {formatTokens(claudeUsage.dailyTokenBudget)} daily budget
                  </span>
                </div>
              </>
            )}
            {!hasBudget && (
              <span style={subtextStyle}>
                {claudeUsage.todaySessions} session{claudeUsage.todaySessions !== 1 ? "s" : ""} today
              </span>
            )}
          </div>

          {/* Week + Month totals */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}>
            <div>
              <span style={sectionLabelStyle}>This week</span>
              <div style={totalValueStyle}>
                <Zap size={13} color="var(--cc-brand-primary)" />
                {formatTokens(claudeUsage.weekTokens)}
              </div>
              <span style={subtextStyle}>tokens used</span>
              <div style={{ marginTop: 2 }}>
                <span style={subtextStyle}>
                  {claudeUsage.weekSessions} session{claudeUsage.weekSessions !== 1 ? "s" : ""}
                  {weekStats.tasksCompleted > 0 && ` / ${weekStats.tasksCompleted} task${weekStats.tasksCompleted !== 1 ? "s" : ""}`}
                </span>
              </div>
            </div>
            <div>
              <span style={sectionLabelStyle}>This month</span>
              <div style={totalValueStyle}>
                <Zap size={13} color="var(--cc-brand-primary)" />
                {formatTokens(claudeUsage.monthTokens)}
              </div>
              <span style={subtextStyle}>tokens used</span>
              {weekStats.totalCostUsd > 0 && (
                <div style={{ marginTop: 2 }}>
                  <span style={subtextStyle}>
                    ${weekStats.totalCostUsd.toFixed(2)} task cost
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Last updated + budget hint */}
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            {claudeUsage.lastUpdated && (
              <span style={subtextStyle}>
                Last synced: {claudeUsage.lastUpdated === new Date().toISOString().slice(0, 10) ? "today" : claudeUsage.lastUpdated}
              </span>
            )}
          </div>

          <Link href="/history" style={viewAllStyle}>
            View history <ArrowRight size={13} />
          </Link>
        </>
      ) : (
        <p style={{ ...sectionLabelStyle, color: "var(--cc-text-tertiary)", margin: 0 }}>
          No activity yet today.
        </p>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  backgroundColor: "var(--cc-surface-muted)",
  borderRadius: 12,
  padding: "20px 24px",
  flex: 1,
  minWidth: 0,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 12,
};

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--cc-text-secondary)",
};

const sectionLabelStyle: React.CSSProperties = {
  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--cc-text-tertiary)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const subtextStyle: React.CSSProperties = {
  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
  fontSize: 11,
  fontWeight: 500,
  color: "var(--cc-text-tertiary)",
};

const totalValueStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
  fontSize: 18,
  fontWeight: 600,
  color: "var(--cc-text-primary)",
  lineHeight: 1,
  marginTop: 4,
  marginBottom: 4,
};

const viewAllStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  marginTop: 16,
  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
  fontSize: 12,
  fontWeight: 500,
  color: "var(--cc-brand-primary)",
  textDecoration: "none",
};

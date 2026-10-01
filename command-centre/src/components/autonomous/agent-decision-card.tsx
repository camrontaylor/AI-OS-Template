"use client";

import { Lightbulb, GitBranch, Zap } from "lucide-react";
import type { AgentDecision } from "@/types/chat";

interface AgentDecisionCardProps {
  decision: AgentDecision;
}

const DECISION_ICONS: Record<string, typeof Lightbulb> = {
  scope: Lightbulb,
  decompose: GitBranch,
  delegate: Zap,
  clarify: Lightbulb,
  complete_inline: Zap,
};

const DECISION_LABELS: Record<string, string> = {
  scope: "Scoped",
  decompose: "Decomposed",
  delegate: "Delegated",
  clarify: "Clarifying",
  complete_inline: "Handled inline",
};

export function AgentDecisionCard({ decision }: AgentDecisionCardProps) {
  const Icon = DECISION_ICONS[decision.decisionType] || Lightbulb;
  const label = DECISION_LABELS[decision.decisionType] || decision.decisionType;

  return (
    <div style={{
      border: "1px solid var(--cc-brand-alpha-12)",
      borderRadius: 10,
      padding: "10px 14px",
      backgroundColor: "var(--cc-brand-alpha-02)",
      maxWidth: 480,
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: decision.reasoning ? 6 : 0,
      }}>
        <Icon size={13} style={{ color: "var(--cc-brand-primary)" }} />
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--cc-brand-primary)",
        }}>
          {label}
          {decision.level ? ` — Level ${decision.level}` : ""}
        </span>
      </div>

      {decision.reasoning && (
        <p style={{
          fontSize: 12,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          color: "var(--cc-text-secondary)",
          lineHeight: 1.5,
          margin: 0,
        }}>
          {decision.reasoning}
        </p>
      )}
    </div>
  );
}

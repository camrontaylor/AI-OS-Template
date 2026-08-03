"use client";

import { AppShell } from "@/components/layout/app-shell";
import { MarketingSurface } from "@/components/marketing/marketing-surface";

export default function AnalyticsPage() {
  return (
    <AppShell title="Analytics">
      <MarketingSurface
        title="Analytics"
        description="Marketing impact, acquisition, revenue, AI visibility, audits, and source drilldowns."
        sections={[
          {
            title: "Impact",
            description: "Proof-of-work ledger and plan movement.",
            items: [
              { label: "Marketing health", value: "Score history and channel movement.", status: "build" },
              { label: "Plan movement", value: "Completed, running, approval, and blocked counts.", status: "build" },
              { label: "Recent shipped artifacts", value: "Posts, PRs, pages, ads, emails, and SMS.", status: "build" },
            ],
          },
          {
            title: "Sources",
            description: "Connector-backed analytics drilldowns.",
            items: [
              { label: "Google Analytics", value: "Sessions, users, conversions, engaged sessions.", status: "connect" },
              { label: "Google Search Console", value: "Impressions, clicks, CTR, rank buckets.", status: "connect" },
              { label: "AI Assistant referrals", value: "chatgpt.com and copilot.com referral traffic when present.", status: "connect" },
              { label: "Stripe and PostHog", value: "Revenue and product funnel source pages.", status: "connect" },
            ],
          },
        ]}
      />
    </AppShell>
  );
}

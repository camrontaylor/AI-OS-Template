"use client";

import { AppShell } from "@/components/layout/app-shell";
import { MarketingSurface } from "@/components/marketing/marketing-surface";

export default function PlanPage() {
  return (
    <AppShell title="Plan">
      <MarketingSurface
        title="Plan"
        description="Current operating plan, next best actions, evidence, and open decisions."
        sections={[
          {
            title: "Execution",
            description: "A compact view of active work and the next move to take.",
            items: [
              { label: "Next best action", value: "One recommended task with the source evidence beside it.", status: "build" },
              { label: "Plan stages", value: "Ready, planned, blocked, and shipped items grouped by outcome.", status: "build" },
              { label: "Decision ledger", value: "Open approvals and reversible calls that shaped the plan.", status: "build" },
            ],
          },
          {
            title: "Evidence",
            description: "The inputs used to rebuild the plan and judge progress.",
            items: [
              { label: "Audit provenance", value: "Source files, run timestamps, and metrics used in the latest compile.", status: "build" },
              { label: "Metric baselines", value: "Current, target, and trend fields for the tracked outcomes.", status: "connect" },
              { label: "Recent activity", value: "Plan compiler events, completed tasks, and stale inputs.", status: "build" },
            ],
          },
        ]}
      />
    </AppShell>
  );
}

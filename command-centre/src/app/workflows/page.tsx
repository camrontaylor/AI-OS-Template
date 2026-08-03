"use client";

import { AppShell } from "@/components/layout/app-shell";
import { MarketingSurface } from "@/components/marketing/marketing-surface";

export default function WorkflowsPage() {
  return (
    <AppShell title="Workflows">
      <MarketingSurface
        title="Workflows"
        description="Skill-backed workflows with inputs, required integrations, schedules, run history, and emit-finding terminators."
        sections={[
          {
            title: "System Loops",
            description: "The five recurring loops that make the marketing engine autonomous.",
            items: [
              { label: "Standard brief", value: "Daily 08:00 local, capped action list.", status: "build" },
              { label: "Audit refresh", value: "Monday 07:00, refreshes evidence and score snapshots.", status: "build" },
              { label: "Impact checkpoint", value: "Monday 07:30, samples linked metrics.", status: "build" },
              { label: "Plan execution", value: "Monday 08:00, claims due plan tasks.", status: "build" },
              { label: "Tracker check-ins", value: "Monday 09:00, records deltas and at-risk findings.", status: "build" },
            ],
          },
          {
            title: "Compiler",
            description: "The route from local AI-OS skills into scheduled operating procedures.",
            items: [
              { label: "SKILL.md import", value: "Inputs, focus skills, required integrations, and steps.", status: "build" },
              { label: "Run transcript", value: "Inputs, step outputs, tool calls, final artifact, and finding.", status: "build" },
              { label: "Schedule editor", value: "Frequency, timezone, start, limits, pause, and resume.", status: "native" },
            ],
          },
        ]}
      />
    </AppShell>
  );
}

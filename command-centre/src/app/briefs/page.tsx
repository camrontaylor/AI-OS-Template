"use client";

import { AppShell } from "@/components/layout/app-shell";
import { MarketingSurface } from "@/components/marketing/marketing-surface";

export default function BriefsPage() {
  return (
    <AppShell title="Briefs">
      <MarketingSurface
        title="Briefs"
        description="Daily and weekly brief archive anchored to the previous send time."
        sections={[
          {
            title: "Daily Brief",
            description: "One focused operating note, not a digest dump.",
            items: [
              { label: "Previous-send anchor", value: "All deltas read from the last sent brief time.", status: "build" },
              { label: "Priority rubric", value: "Approvals, anomalies, lagging trackers, due tasks, next planned content.", status: "build" },
              { label: "Action cap", value: "Today list capped at three items.", status: "build" },
            ],
          },
          {
            title: "Archive",
            description: "Durable sent briefs and skipped/failed send states.",
            items: [
              { label: "Brief files", value: "Rendered brief plus source data.", status: "build" },
              { label: "Email delivery", value: "Send, cap skipped, and send failed states.", status: "connect" },
            ],
          },
        ]}
      />
    </AppShell>
  );
}

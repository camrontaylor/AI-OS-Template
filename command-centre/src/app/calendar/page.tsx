"use client";

import { AppShell } from "@/components/layout/app-shell";
import { MarketingSurface } from "@/components/marketing/marketing-surface";

export default function CalendarPage() {
  return (
    <AppShell title="Calendar">
      <MarketingSurface
        title="Calendar"
        description="Executable dated work across workflows, chats, emails, plan tasks, briefs, and social posts."
        sections={[
          {
            title: "Event Types",
            description: "Calendar items are work objects, not decorative reminders.",
            items: [
              { label: "Workflows", value: "Scheduled and manual workflow runs.", status: "build" },
              { label: "Plan tasks", value: "Due roadmap items with execution entry points.", status: "build" },
              { label: "Social posts", value: "Draft, scheduled, and published items.", status: "connect" },
              { label: "Briefs", value: "Daily and weekly sends.", status: "build" },
            ],
          },
          {
            title: "Controls",
            description: "Inline schedule controls copied from the workflow runtime contract.",
            items: [
              { label: "Pause and resume", value: "Pause after the current action, resume from the active step.", status: "build" },
              { label: "Run again", value: "Repeat completed or failed runs with saved inputs.", status: "build" },
            ],
          },
        ]}
      />
    </AppShell>
  );
}

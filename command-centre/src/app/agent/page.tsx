"use client";

import { AppShell } from "@/components/layout/app-shell";
import { FeedView } from "@/components/board/feed-view";

export default function AgentPage() {
  return (
    <AppShell title="Agent">
      <FeedView />
    </AppShell>
  );
}

"use client";

import { AppShell } from "@/components/layout/app-shell";
import { WorkflowsView } from "@/components/marketing/workflows-view";

export default function WorkflowsPage() {
  return (
    <AppShell title="Workflows">
      <WorkflowsView />
    </AppShell>
  );
}

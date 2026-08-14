"use client";

import { AppShell } from "@/components/layout/app-shell";
import { IntegrationsView } from "@/components/marketing/integrations-view";

export default function IntegrationsPage() {
  return (
    <AppShell title="Integrations">
      <IntegrationsView />
    </AppShell>
  );
}

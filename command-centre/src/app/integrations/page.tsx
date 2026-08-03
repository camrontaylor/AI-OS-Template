"use client";

import { AppShell } from "@/components/layout/app-shell";
import { ConnectorsView } from "@/components/connectors/connectors-view";

export default function IntegrationsPage() {
  return (
    <AppShell title="Integrations">
      <ConnectorsView />
    </AppShell>
  );
}

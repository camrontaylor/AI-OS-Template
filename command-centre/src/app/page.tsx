"use client";

import { AppShell } from "@/components/layout/app-shell";
import { MarketingOverview } from "@/components/marketing/marketing-overview";

export default function CommandCentrePage() {
  return (
    <AppShell title="Overview">
      <MarketingOverview />
    </AppShell>
  );
}

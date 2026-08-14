"use client";

import { AppShell } from "@/components/layout/app-shell";
import { MarketingPlanView } from "@/components/marketing/marketing-plan-view";

export default function PlanPage() {
  return (
    <AppShell title="Plan">
      <MarketingPlanView />
    </AppShell>
  );
}

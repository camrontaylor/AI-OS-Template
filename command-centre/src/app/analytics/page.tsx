"use client";

import { AppShell } from "@/components/layout/app-shell";
import { AnalyticsView } from "@/components/marketing/analytics-view";

export default function AnalyticsPage() {
  return (
    <AppShell title="Analytics">
      <AnalyticsView />
    </AppShell>
  );
}

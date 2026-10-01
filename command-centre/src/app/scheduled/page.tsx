"use client";

import { CronJobsView } from "@/components/cron/cron-table";
import { TopNavShell } from "@/components/layout/top-nav-shell";

export default function ScheduledPage() {
  return (
    <TopNavShell activeTab="scheduled">
      <CronJobsView />
    </TopNavShell>
  );
}

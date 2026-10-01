"use client";

import { TopNavShell } from "@/components/layout/top-nav-shell";
import { TeamOverview } from "@/components/team/team-overview";

export default function TeamPage() {
  return (
    <TopNavShell activeTab="team">
      <TeamOverview />
    </TopNavShell>
  );
}

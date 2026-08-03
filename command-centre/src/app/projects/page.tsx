"use client";

import { AppShell } from "@/components/layout/app-shell";
import { ProjectsView } from "@/components/projects/projects-view";

export default function ProjectsPage() {
  return (
    <AppShell title="Projects">
      <ProjectsView />
    </AppShell>
  );
}

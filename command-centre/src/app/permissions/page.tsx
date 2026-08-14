"use client";

import { AppShell } from "@/components/layout/app-shell";
import { PermissionsView } from "@/components/marketing/permissions-view";

export default function PermissionsPage() {
  return (
    <AppShell title="Permissions">
      <PermissionsView />
    </AppShell>
  );
}

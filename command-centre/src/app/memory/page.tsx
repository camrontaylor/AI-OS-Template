"use client";

import { AppShell } from "@/components/layout/app-shell";
import { MemoryView } from "@/components/memory/memory-view";

export default function MemoryPage() {
  return (
    <AppShell title="Memory">
      <MemoryView />
    </AppShell>
  );
}

"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { DocsWorkspace } from "@/components/docs/docs-workspace";

function AssetsPageBody() {
  const searchParams = useSearchParams();
  return (
    <AppShell title="Assets">
      <DocsWorkspace initialFile={searchParams.get("file") || "projects/briefs/magister-command-centre/brief.md"} />
    </AppShell>
  );
}

export default function AssetsPage() {
  return (
    <Suspense>
      <AssetsPageBody />
    </Suspense>
  );
}

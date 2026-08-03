"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { DocsWorkspace } from "@/components/docs/docs-workspace";

function DocsPageBody() {
  const searchParams = useSearchParams();

  return (
    <AppShell title="Docs">
      <DocsWorkspace initialFile={searchParams.get("file")} />
    </AppShell>
  );
}

export default function DocsPage() {
  return (
    <Suspense>
      <DocsPageBody />
    </Suspense>
  );
}

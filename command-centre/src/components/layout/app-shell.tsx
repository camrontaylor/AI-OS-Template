"use client";

import { Suspense, useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { Sidebar } from "./sidebar";
import { ClientSwitcher } from "./client-switcher";
import { OperationsRail } from "./operations-rail";
import { TaskDeepLinkHandler } from "./task-deep-link-handler";
import { BrandContextBanner } from "@/components/board/brand-context-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useGsdSync } from "@/hooks/use-gsd-sync";

export function AppShell({ children, title }: { children: React.ReactNode; title?: string }) {
  useGsdSync();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Auto-collapse sidebar on narrow viewports
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1280px)");
    const handler = (e: MediaQueryListEvent | MediaQueryList) => {
      setSidebarCollapsed(e.matches);
    };
    handler(mq);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Suspense fallback={null}>
        <TaskDeepLinkHandler />
      </Suspense>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <main style={{ flex: 1, minWidth: 0, minHeight: "100vh" }}>
        <header
          className="sticky top-0 z-50 flex min-h-14 flex-wrap items-center justify-between gap-3 border-b bg-background/90 px-4 py-2 backdrop-blur-xl sm:px-6"
        >
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="m-0 truncate text-lg font-semibold text-foreground">
              {title || "Command Centre"}
            </h2>
            <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
              Local
            </Badge>
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <div className="hidden w-full max-w-[280px] md:block">
              <ClientSwitcher direction="down" />
            </div>
            <Badge variant="secondary" className="hidden shrink-0 lg:inline-flex">
              Context ready
            </Badge>
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => window.location.reload()}
            >
              <RefreshCw data-icon="inline-start" />
              Refresh context
            </Button>
          </div>
        </header>
        <BrandContextBanner />
        <div className="flex min-h-[calc(100vh-3.5rem)]">
          <div className="flex min-w-0 flex-1 flex-col gap-4 px-4 pb-4 pt-4 sm:px-6 sm:pb-6">
            {children}
          </div>
          <OperationsRail />
        </div>
      </main>
    </div>
  );
}

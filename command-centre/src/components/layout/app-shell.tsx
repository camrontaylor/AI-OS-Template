"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "./sidebar";

export function AppShell({ children, title }: { children: React.ReactNode; title?: string }) {
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
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <main style={{ flex: 1, minWidth: 0, minHeight: "100vh" }}>
        {/* Sticky header */}
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0 24px",
            height: 56,
            position: "sticky",
            top: 0,
            zIndex: 50,
            backgroundColor: "var(--cc-canvas-overlay-80)",
            backdropFilter: "blur(12px)",
          }}
        >
          <h2
            style={{
              fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
              fontWeight: 700,
              fontSize: 20,
              color: "var(--cc-brand-primary)",
              margin: 0,
            }}
          >
            {title || "Command Centre"}
          </h2>
        </header>
        <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
          {children}
        </div>
      </main>
    </div>
  );
}

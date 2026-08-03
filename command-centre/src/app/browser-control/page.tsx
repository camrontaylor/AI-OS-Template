"use client";

import { AppShell } from "@/components/layout/app-shell";
import { MarketingSurface } from "@/components/marketing/marketing-surface";

export default function BrowserControlPage() {
  return (
    <AppShell title="Browser Control">
      <MarketingSurface
        title="Browser Control"
        description="Live browser captures, DOM snapshots, and research evidence used to ground marketing decisions."
        sections={[
          {
            title: "Magister Reference Captures",
            description: "Saved screenshots and DOM snapshots from the logged-in in-app browser session.",
            items: [
              { label: "Chat shell", value: "Agent workspace, health score, prompt starters, and chat history.", status: "native" },
              { label: "Plan, Analytics, Briefs, Calendar", value: "Primary Magister workspaces captured for layout and behavior.", status: "native" },
              { label: "Right rail panels", value: "Assets, integrations, workflows, permissions, skills, email, browser control.", status: "native" },
            ],
          },
          {
            title: "Command Center Use",
            description: "How browser-backed evidence should feed AI-OS workflows.",
            items: [
              { label: "Current-page audit", value: "Capture screenshots and DOM before diagnosing UI or marketing state.", status: "build" },
              { label: "Evidence attachment", value: "Link each generated finding to the capture or source document it came from.", status: "build" },
              { label: "Account safety", value: "Block upgrade, billing, or account-changing clicks unless explicitly approved.", status: "native" },
            ],
          },
        ]}
      />
    </AppShell>
  );
}

"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, Clock, Cpu, FileText, Settings, UsersRound } from "lucide-react";
import { useGsdSync } from "@/hooks/use-gsd-sync";
import { BrandContextBanner } from "@/components/board/brand-context-banner";
import { ClientSwitcher } from "@/components/layout/client-switcher";
import { OnboardingModal } from "@/components/onboarding/onboarding-modal";
import { TeamConnectionIndicator } from "@/components/team/team-connection-indicator";
import { isTeamNavigationAvailable, useTeamNavigationStore } from "@/store/team-navigation-store";

export type TopNavTab = "feed" | "scheduled" | "team" | "skills" | "docs" | "settings";

const tabs: { key: TopNavTab; label: string; href: string; icon: typeof Activity }[] = [
  { key: "feed", label: "Feed", href: "/", icon: Activity },
  { key: "scheduled", label: "Scheduled", href: "/scheduled", icon: Clock },
  { key: "team", label: "Team", href: "/team", icon: UsersRound },
  { key: "skills", label: "Skills", href: "/skills", icon: Cpu },
  { key: "docs", label: "Docs", href: "/docs", icon: FileText },
  { key: "settings", label: "Settings", href: "/settings", icon: Settings },
];

export function hrefForTopNavTab(tab: string): string {
  return tabs.find((item) => item.key === tab)?.href ?? "/";
}

export function TopNavShell({
  activeTab,
  children,
  workspaceContext = true,
  flush = false,
}: {
  activeTab: TopNavTab;
  children: ReactNode;
  workspaceContext?: boolean;
  flush?: boolean;
}) {
  useGsdSync();
  const router = useRouter();
  const teamNavigationAvailable = useTeamNavigationStore((state) => isTeamNavigationAvailable(state.status));

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--cc-canvas)" }}>
      <OnboardingModal />

      <header style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 10, textDecoration: "none" }}
          >
            <Cpu size={26} aria-hidden="true" />
            <h1 style={brandTitleStyle}>AI-OS</h1>
          </a>

          <div style={{ width: 1, height: 20, backgroundColor: "var(--cc-line-alpha-30)" }} />

          <nav style={{ display: "flex", alignItems: "center", gap: 0 }}>
            {tabs.filter((tab) => tab.key !== "team" || teamNavigationAvailable).map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <Link key={tab.key} href={tab.href} style={tabStyle(isActive)}>
                  <Icon size={13} />
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <TeamConnectionIndicator onOpenTeam={(path) => router.push(path || "/team")} />
      </header>

      {workspaceContext ? (
        <>
          <div style={{ padding: "12px 24px 0" }}>
            <div style={{ maxWidth: 280 }}>
              <ClientSwitcher direction="down" />
            </div>
          </div>
          <BrandContextBanner />
        </>
      ) : null}

      <main style={flush ? { padding: 0 } : { padding: "16px 24px 24px" }}>
        {children}
      </main>
    </div>
  );
}

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 24px",
  height: 52,
  position: "sticky",
  top: 0,
  zIndex: 260,
  backgroundColor: "var(--cc-canvas-overlay-92)",
  backdropFilter: "blur(12px)",
  borderBottom: "1px solid var(--cc-line-alpha-10)",
  overflowX: "auto",
  overflowY: "visible",
};

const brandTitleStyle: CSSProperties = {
  fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
  fontWeight: 700,
  fontSize: 18,
  color: "var(--cc-text-primary)",
  letterSpacing: 0,
  margin: 0,
  marginTop: 4,
  whiteSpace: "nowrap",
  lineHeight: 1,
};

function tabStyle(isActive: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: isActive ? 600 : 500,
    fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
    border: "none",
    borderRadius: 6,
    backgroundColor: isActive ? "var(--cc-brand-alpha-08)" : "transparent",
    color: isActive ? "var(--cc-brand-primary)" : "var(--cc-text-secondary)",
    cursor: "pointer",
    transition: "all 120ms ease",
    whiteSpace: "nowrap",
    textDecoration: "none",
  };
}

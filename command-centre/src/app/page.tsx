"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Activity, Clock, Cpu, FileText, Settings, FolderKanban, Brain,
} from "lucide-react";
import { useGsdSync } from "@/hooks/use-gsd-sync";
import { FeedView } from "@/components/board/feed-view";
import { ThemeToggle } from "@/components/theme-toggle";
import { BrandContextBanner } from "@/components/board/brand-context-banner";
import { AiOsLogomark } from "@/components/layout/ai-os-logomark";
import { CronJobsView } from "@/components/cron/cron-table";
import { SkillsWorkspace } from "@/components/skills/skills-workspace";
import { ContentViewer } from "@/components/context/content-viewer";
import { ProjectsView } from "@/components/projects/projects-view";
import { MemoryView } from "@/components/memory/memory-view";
import { ConnectorsView } from "@/components/connectors/connectors-view";
import { DocsFileTree } from "@/components/docs/docs-file-tree";
import { ResizablePane } from "@/components/shared/resizable-pane";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { ScriptList } from "@/components/settings/script-list";
import { EnvEditor } from "@/components/settings/env-editor";
import { JsonEditor } from "@/components/settings/json-editor";
import { ClientSwitcher } from "@/components/layout/client-switcher";
import { useTaskStore } from "@/store/task-store";
import { useClientStore } from "@/store/client-store";
type Tab = "feed" | "projects" | "scheduled" | "skills" | "memory" | "docs" | "settings";

/** Skills tab content */
function SkillsTab() {
  return <SkillsWorkspace minHeight="calc(100vh - 140px)" />;
}

/** Docs tab content */
function DocsTab({ initialFile }: { initialFile?: string | null }) {
  const [selectedPath, setSelectedPath] = useState<string | null>(
    initialFile || "AGENTS.md"
  );
  const [refreshKey, setRefreshKey] = useState(0);

  // Keep selection in sync with URL param when it changes (e.g. clicking
  // another output while already on the Docs tab).
  useEffect(() => {
    if (initialFile) setSelectedPath(initialFile);
  }, [initialFile]);

  return (
    <ResizablePane
      storageKey="docs-sidebar-width"
      initialLeft={260}
      minLeft={180}
      maxLeft={600}
      style={{ minHeight: "calc(100vh - 140px)", gap: 0 }}
      left={
        <div
          className="border border-border"
          style={{
            backgroundColor: "var(--muted)",
            borderRadius: 8,
            overflowY: "auto",
            maxHeight: "calc(100vh - 140px)",
            width: "100%",
          }}
        >
          <DocsFileTree key={refreshKey} onSelectFile={setSelectedPath} selectedPath={selectedPath} />
        </div>
      }
      right={
        <div
          className="border border-border"
          style={{
            backgroundColor: "var(--card)",
            borderRadius: 8,
            minHeight: 400,
            width: "100%",
          }}
        >
          <ContentViewer
            selectedPath={selectedPath}
            onFileDeleted={() => { setSelectedPath(null); setRefreshKey((k) => k + 1); }}
          />
        </div>
      }
    />
  );
}

/** Settings tab content */
function SettingsTab() {
  const [activeSubTab, setActiveSubTab] = useState<string>("scripts");

  return (
    <div>
      <SettingsTabs activeTab={activeSubTab} onTabChange={setActiveSubTab} />
      <div style={{ minHeight: 400 }}>
        {activeSubTab === "connectors" && <ConnectorsView />}
        {activeSubTab === "env" && <EnvEditor />}
        {activeSubTab === "mcp" && (
          <JsonEditor
            apiEndpoint="/api/settings/mcp"
            title="MCP Configuration"
            description="Edit .mcp.json - MCP server connections and their environment variables"
            emptyMessage="No .mcp.json file found. Create one to configure MCP servers."
            maskSecrets
          />
        )}
        {activeSubTab === "claude" && (
          <JsonEditor
            apiEndpoint="/api/settings/claude-settings"
            title="Claude Settings"
            description="Edit .claude/settings.json - permissions, allowed tools, and deny patterns"
            emptyMessage="No .claude/settings.json file found. Create one to configure Claude CLI settings."
          />
        )}
        {activeSubTab === "scripts" && <ScriptList />}
      </div>
    </div>
  );
}

const VALID_TABS: Tab[] = ["feed", "projects", "scheduled", "skills", "memory", "docs", "settings"];

function CommandCentreBody() {
  useGsdSync();
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabParam = searchParams.get("tab");
  const fileParam = searchParams.get("file");
  const taskParam = searchParams.get("task");
  const searchParamsString = searchParams.toString();
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const openPanel = useTaskStore((s) => s.openPanel);
  const setSelectedClient = useClientStore((s) => s.setSelectedClient);

  const [activeTab, setActiveTab] = useState<Tab>(
    (VALID_TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "feed")
  );

  // If the URL params change (e.g. another tab clicked an output link
  // while already on this page), re-sync the active tab.
  useEffect(() => {
    if (tabParam && VALID_TABS.includes(tabParam as Tab)) {
      setActiveTab(tabParam as Tab);
    }
  }, [tabParam]);

  useEffect(() => {
    if (!taskParam) return;

    let cancelled = false;

    const openDeepLinkedTask = async () => {
      setActiveTab("feed");

      try {
        const res = await fetch(`/api/tasks/${encodeURIComponent(taskParam)}`);
        if (!res.ok) return;

        const task = await res.json();
        if (cancelled) return;

        setSelectedClient(task.clientId ?? null);
        await fetchTasks();
        if (cancelled) return;

        openPanel(task.id);
      } finally {
        if (cancelled) return;

        const params = new URLSearchParams(searchParamsString);
        params.delete("task");
        params.set("tab", "feed");
        const nextQuery = params.toString();
        router.replace(nextQuery ? `/?${nextQuery}` : "/");
      }
    };

    void openDeepLinkedTask();

    return () => {
      cancelled = true;
    };
  }, [taskParam, searchParamsString, router, fetchTasks, openPanel, setSelectedClient]);
  const switchTab = useCallback(
    (tab: string) => {
      setActiveTab(tab as Tab);
      // Clear stale query params (like ?file=) when the user manually
      // navigates away from docs.
      if (tab !== "docs" && (tabParam || fileParam)) {
        router.replace("/");
      }
    },
    [router, tabParam, fileParam]
  );

  const tabs: { key: Tab; label: string; icon: typeof Activity }[] = [
    { key: "feed", label: "Feed", icon: Activity },
    { key: "projects", label: "Projects", icon: FolderKanban },
    { key: "scheduled", label: "Scheduled", icon: Clock },
    { key: "skills", label: "Skills", icon: Cpu },
    { key: "memory", label: "Memory", icon: Brain },
    { key: "docs", label: "Docs", icon: FileText },
    { key: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--card)" }}>
      {/* Top bar */}
      <header
        className="px-4 sm:px-6"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          height: 52,
          position: "sticky",
          top: 0,
          zIndex: 50,
          backgroundColor: "color-mix(in srgb, var(--card) 92%, transparent)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {/* Left: branding + tabs */}
        <div className="gap-3 sm:gap-5" style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
          <a
            href="https://github.com/camrontaylor/AI-OS"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 12, textDecoration: "none" }}
          >
            <span style={{ color: "var(--foreground)", display: "inline-flex" }}>
              <AiOsLogomark size={24} />
            </span>
            <h1
              className="hidden sm:block"
              style={{
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontWeight: 700,
                fontSize: 18,
                color: "var(--foreground)",
                letterSpacing: "-0.02em",
                margin: 0,
                whiteSpace: "nowrap",
                lineHeight: 1,
              }}
            >
              AI-OS
            </h1>
          </a>

          <div style={{
            width: 1,
            height: 20,
            backgroundColor: "var(--border)",
          }} />

          <nav
            className="overflow-x-auto"
            style={{ display: "flex", alignItems: "center", gap: 0, minWidth: 0 }}
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => switchTab(tab.key)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "8px 12px",
                    fontSize: 12,
                    fontWeight: isActive ? 600 : 500,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    border: "none",
                    borderRadius: 6,
                    backgroundColor: isActive ? "color-mix(in srgb, var(--foreground) 8%, transparent)" : "transparent",
                    color: isActive ? "var(--primary)" : "var(--muted-foreground)",
                    cursor: "pointer",
                    transition: "all 120ms ease",
                    whiteSpace: "nowrap",
                  }}
                >
                  <Icon size={13} />
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right: theme toggle */}
        <ThemeToggle />
      </header>

      <div className="px-4 pt-3 sm:px-6">
        <div className="w-full sm:max-w-[280px]">
          <ClientSwitcher direction="down" />
        </div>
      </div>
      <BrandContextBanner />

      {/* Content */}
      <main className="px-4 pb-6 pt-4 sm:px-6">
        {activeTab === "feed" && (
          <FeedView onSwitchTab={switchTab} />
        )}
        {activeTab === "projects" && <ProjectsView />}
        {activeTab === "scheduled" && <CronJobsView />}
        {activeTab === "skills" && <SkillsTab />}
        {activeTab === "memory" && <MemoryView />}
        {activeTab === "docs" && <DocsTab initialFile={fileParam} />}
        {activeTab === "settings" && <SettingsTab />}
      </main>
    </div>
  );
}

export default function CommandCentrePage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", backgroundColor: "var(--card)" }} />}>
      <CommandCentreBody />
    </Suspense>
  );
}

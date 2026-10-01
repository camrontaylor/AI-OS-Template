"use client";

import { useState } from "react";
import {
  SettingsTabs,
  type SettingsTabId,
} from "@/components/settings/settings-tabs";
import { ScriptList } from "@/components/settings/script-list";
import { EnvEditor } from "@/components/settings/env-editor";
import { JsonEditor } from "@/components/settings/json-editor";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { TopNavShell } from "@/components/layout/top-nav-shell";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTabId>("scripts");

  return (
    <TopNavShell activeTab="settings">
      <SettingsTabs activeTab={activeTab} onTabChange={setActiveTab} />
      <div style={{ minHeight: 400 }}>
        {activeTab === "env" && <EnvEditor />}
        {activeTab === "mcp" && (
          <JsonEditor
            apiEndpoint="/api/settings/mcp"
            title="MCP Configuration"
            description="Edit .mcp.json — MCP server connections and their environment variables"
            emptyMessage="No .mcp.json file found. Create one to configure MCP servers."
            maskSecrets
          />
        )}
        {activeTab === "claude" && (
          <JsonEditor
            apiEndpoint="/api/settings/claude-settings"
            title="Claude Settings"
            description="Edit .claude/settings.json — permissions, allowed tools, and deny patterns"
            emptyMessage="No .claude/settings.json file found. Create one to configure Claude CLI settings."
          />
        )}
        {activeTab === "scripts" && <ScriptList />}
        {activeTab === "appearance" && <AppearanceSettings />}
      </div>
    </TopNavShell>
  );
}

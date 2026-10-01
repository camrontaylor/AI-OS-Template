"use client";

import { Suspense, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import { DownloadCloud, RefreshCw, UploadCloud } from "lucide-react";
import { ContentViewer } from "@/components/context/content-viewer";
import { DocsFileTree } from "@/components/docs/docs-file-tree";
import { TopNavShell } from "@/components/layout/top-nav-shell";
import { ResizablePane } from "@/components/shared/resizable-pane";
import { SyncConflictModal, type SyncConflict } from "@/components/team/sync-conflict-modal";
import { useClientStore } from "@/store/client-store";
import type { SyncItemStatus, SyncStateFile, SyncStateSummary } from "@/lib/sync-state";

interface BrandSyncStatus {
  signedIn: boolean;
  writable: boolean;
  serverFiles: number;
  localFiles: number;
  localStatus?: string;
  syncState?: SyncStateSummary;
  error?: string;
}

interface ClientSyncStatus {
  signedIn: boolean;
  client?: {
    slug: string;
    name?: string | null;
    access?: "read" | "write";
    writable?: boolean;
    localStatus?: string;
  };
  serverFiles: number;
  localFiles: number;
  localSecretFiles?: number;
  unsupportedFiles?: number;
  secretFilesHidden?: number;
  syncState?: SyncStateSummary;
  error?: string;
}

function DocsContent() {
  const searchParams = useSearchParams();
  const fileParam = searchParams.get("file");
  const clientId = useClientStore((state) => state.selectedClientId);
  const [selectedPath, setSelectedPath] = useState<string | null>(fileParam || "AGENTS.md");
  const [refreshKey, setRefreshKey] = useState(0);
  const [syncRefreshKey, setSyncRefreshKey] = useState(0);
  const [syncState, setSyncState] = useState<SyncStateSummary | null>(null);

  useEffect(() => {
    if (fileParam) setSelectedPath(fileParam);
  }, [fileParam]);

  useEffect(() => {
    if (fileParam) return;
    setSelectedPath(clientId ? null : "AGENTS.md");
    setRefreshKey((key) => key + 1);
    setSyncState(null);
  }, [clientId, fileParam]);

  const refreshDocs = () => {
    setRefreshKey((key) => key + 1);
    setSyncRefreshKey((key) => key + 1);
  };

  return (
    <TopNavShell activeTab="docs">
      <ResizablePane
        storageKey="docs-sidebar-width"
        initialLeft={260}
        minLeft={180}
        maxLeft={600}
        style={{ minHeight: "calc(100vh - 140px)", gap: 0 }}
        left={
          <div style={sidebarStyle}>
            <WorkspaceSyncBar
              selectedPath={selectedPath}
              refreshKey={syncRefreshKey}
              onSynced={refreshDocs}
              onStatus={setSyncState}
            />
            <DocsFileTree
              key={refreshKey}
              onSelectFile={setSelectedPath}
              selectedPath={selectedPath}
              syncFiles={syncFilesForTree(syncState, clientId)}
            />
          </div>
        }
        right={
          <div style={viewerStyle}>
            <ContentViewer
              selectedPath={selectedPath}
              apiSurface="docs"
              clientIdOverride={clientId}
              enableTeamPush
              onFilePushed={refreshDocs}
              onFileChanged={refreshDocs}
              onFileDeleted={() => {
                setSelectedPath(null);
                refreshDocs();
              }}
            />
          </div>
        }
      />
    </TopNavShell>
  );
}

function WorkspaceSyncBar({
  selectedPath,
  refreshKey,
  onSynced,
  onStatus,
}: {
  selectedPath: string | null;
  refreshKey: number;
  onSynced: () => void;
  onStatus: (syncState: SyncStateSummary | null) => void;
}) {
  const clientId = useClientStore((state) => state.selectedClientId);
  const clients = useClientStore((state) => state.clients);
  const selectedClient = clientId ? clients.find((client) => client.slug === clientId) : null;
  const [brandStatus, setBrandStatus] = useState<BrandSyncStatus | null>(null);
  const [clientStatus, setClientStatus] = useState<ClientSyncStatus | null>(null);
  const [busy, setBusy] = useState<"pull" | "push" | "refresh" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [conflictState, setConflictState] = useState<{
    action: "pull" | "push";
    conflicts: SyncConflict[];
    path?: string | null;
  } | null>(null);

  const refresh = async () => {
    setBusy((value) => value || "refresh");
    setError(null);
    try {
      const url = clientId
        ? `/api/team/sync-client?client=${encodeURIComponent(clientId)}`
        : "/api/team/brand-context";
      const response = await fetch(url, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || "Sync status unavailable");
      if (clientId) {
        setClientStatus(body);
        setBrandStatus(null);
      } else {
        setBrandStatus(body);
        setClientStatus(null);
      }
      onStatus(body?.syncState ?? null);
      setCheckedAt(new Date().toLocaleTimeString());
    } catch (refreshError) {
      if (clientId) setClientStatus(null);
      else setBrandStatus(null);
      onStatus(null);
      setError(refreshError instanceof Error ? refreshError.message : "Sync status unavailable");
    } finally {
      setBusy((value) => (value === "refresh" ? null : value));
    }
  };

  useEffect(() => {
    setNotice(null);
    setError(null);
    setConflictState(null);
    void refresh();
  }, [clientId, refreshKey]);

  const runSync = async (action: "pull" | "push", overwrite = false, path?: string | null) => {
    const isClientSync = Boolean(clientId);
    const secretCount = clientStatus?.localSecretFiles ?? 0;
    if (action === "push" && isClientSync && secretCount > 0 && !overwrite && !window.confirm(`Push ${secretCount} secret file${secretCount === 1 ? "" : "s"} to the team server?`)) {
      return;
    }
    setBusy(action);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(isClientSync ? "/api/team/sync-client" : "/api/team/brand-context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(isClientSync ? { action, client: clientId, overwrite, ...(path ? { path } : {}) } : { action, overwrite }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 409 && Array.isArray(body.conflicts)) {
        setConflictState({ action, conflicts: body.conflicts, path });
        return;
      }
      if (!response.ok) throw new Error(body.error || "Sync failed");
      if (isClientSync) {
        const changed = Number(body.filesChanged ?? body.filesPushed ?? 0);
        const deleted = Number(body.filesDeleted ?? 0);
        setNotice(body.upToDate ? "Already up to date." : action === "pull" ? `Pulled ${changed} file${changed === 1 ? "" : "s"}${deleted ? ` and deleted ${deleted}` : ""}.` : `Pushed ${changed} file${changed === 1 ? "" : "s"}${deleted ? ` and deleted ${deleted}` : ""}.`);
      } else {
        setNotice(action === "pull" ? `Pulled ${body.filesPulled ?? 0} files.` : `Pushed ${body.filesPushed ?? 0} files.`);
      }
      await refresh();
      onSynced();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Sync failed");
    } finally {
      setBusy(null);
    }
  };

  const status = clientId ? clientStatus : brandStatus;
  if (!status?.signedIn) return null;
  const syncState = status.syncState ?? null;
  const selectedSyncFile = findSyncFile(syncState, clientId, selectedPath);
  const writable = clientId ? clientStatus?.client?.writable === true : brandStatus?.writable === true;
  const title = clientId ? `${selectedClient?.name ?? clientStatus?.client?.name ?? clientId}` : "Brand & Team context";
  const meta = clientId
    ? `${clientStatus?.localFiles ?? 0} local / ${clientStatus?.serverFiles ?? 0} server files`
    : `${brandStatus?.localFiles ?? 0} local / ${brandStatus?.serverFiles ?? 0} server files`;
  const permission = clientId
    ? writable
      ? "Client Editor"
      : "Client Viewer: pull only"
    : writable
      ? "Owner/Admin"
      : "Read only";

  return (
    <div style={brandSyncStyle}>
      <div style={brandSyncHeaderStyle}>
        <div>
          <div style={brandSyncTitleStyle}>{title}</div>
          <div style={brandSyncMetaStyle}>{meta} · {permission}</div>
        </div>
        <button type="button" onClick={refresh} disabled={busy !== null} style={iconButtonStyle} aria-label="Check sync status" title="Check sync status">
          <RefreshCw size={14} style={{ animation: busy === "refresh" ? "spin 1s linear infinite" : undefined }} />
        </button>
      </div>
      {syncState && (
        <div style={brandSyncStatusRowStyle}>
          <SyncStatusPill status={syncState.status} />
          <span style={brandSyncMetaStyle}>{syncSummaryText(syncState)}</span>
        </div>
      )}
      {selectedSyncFile && selectedSyncFile.status !== "synced" && (
        <div style={selectedFileSyncStyle}>
          <span>Selected file</span>
          <SyncStatusPill status={selectedSyncFile.status} compact />
        </div>
      )}
      <div style={brandSyncActionsStyle}>
        <button type="button" onClick={() => runSync("pull")} disabled={busy !== null} style={syncButtonStyle}>
          <DownloadCloud size={14} />
          {busy === "pull" ? "Pulling..." : "Pull"}
        </button>
        <button
          type="button"
          onClick={() => runSync("push")}
          disabled={busy !== null || !writable}
          style={{ ...syncButtonStyle, opacity: writable ? 1 : 0.45, cursor: writable ? "pointer" : "not-allowed" }}
          title={writable ? "Push local files to the server" : "Push requires Client Editor, Admin, or Owner access"}
        >
          <UploadCloud size={14} />
          {busy === "push" ? "Pushing..." : "Push"}
        </button>
        {clientId && selectedPath && selectedPath.split("/").pop()?.includes(".") && (
          <button
            type="button"
            onClick={() => runSync("push", false, selectedPath)}
            disabled={busy !== null || !writable}
            style={{ ...syncButtonStyle, opacity: writable ? 1 : 0.45, cursor: writable ? "pointer" : "not-allowed" }}
            title={writable ? "Push only the selected file after review" : "Push requires Client Editor, Admin, or Owner access"}
          >
            <UploadCloud size={14} />
            {busy === "push" ? "Pushing..." : "Push file"}
          </button>
        )}
      </div>
      {clientId && clientStatus?.secretFilesHidden ? <div style={brandSyncMetaStyle}>Secret files require Client Editor access.</div> : null}
      {clientId && clientStatus?.unsupportedFiles ? <div style={brandSyncMetaStyle}>{clientStatus.unsupportedFiles} unsupported file{clientStatus.unsupportedFiles === 1 ? "" : "s"} skipped.</div> : null}
      {checkedAt && <div style={brandSyncMetaStyle}>Checked {checkedAt}. Refresh checks status only.</div>}
      {notice && <div style={brandSyncNoticeStyle}>{notice}</div>}
      {(error || status.error) && <div style={brandSyncErrorStyle}>{error || status.error}</div>}
      {conflictState && (
        <SyncConflictModal
          title={conflictState.action === "pull" ? "Review pull conflicts" : "Review push conflicts"}
          direction={conflictState.action}
          conflicts={conflictState.conflicts}
          busy={busy !== null}
          confirmLabel={conflictState.action === "push" ? "Push to server" : undefined}
          onCancel={() => setConflictState(null)}
          onOverwrite={() => {
            const action = conflictState.action;
            const path = conflictState.path;
            setConflictState(null);
            void runSync(action, true, path);
          }}
        />
      )}
    </div>
  );
}

function syncFilesForTree(syncState: SyncStateSummary | null, clientId: string | null): Record<string, SyncItemStatus> {
  if (!syncState) return {};
  const out: Record<string, SyncItemStatus> = {};
  for (const file of syncState.files) {
    const treePath = treePathForSyncPath(file.path, clientId);
    if (treePath) out[treePath] = file.status;
  }
  return out;
}

function findSyncFile(syncState: SyncStateSummary | null, clientId: string | null, selectedPath: string | null): SyncStateFile | null {
  if (!syncState || !selectedPath) return null;
  return syncState.files.find((file) => treePathForSyncPath(file.path, clientId) === selectedPath) ?? null;
}

function treePathForSyncPath(filePath: string, clientId: string | null): string {
  if (!clientId) return filePath;
  const prefix = `clients/${clientId}/`;
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
}

function SyncStatusPill({ status, compact = false }: { status: SyncItemStatus; compact?: boolean }) {
  return <span style={syncPillStyle(status, compact)}>{syncStatusLabel(status)}</span>;
}

function syncStatusLabel(status: SyncItemStatus): string {
  if (status === "local_changes") return "Local changes";
  if (status === "server_changes") return "Server updates";
  if (status === "diverged") return "Both changed";
  if (status === "not_synced") return "Not synced";
  return "Synced";
}

function syncSummaryText(syncState: SyncStateSummary): string {
  if (syncState.changedFiles === 0) return "Local files match the server.";
  return `${syncState.changedFiles} file${syncState.changedFiles === 1 ? "" : "s"} need sync.`;
}

export default function DocsPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", backgroundColor: "var(--cc-canvas)" }} />}>
      <DocsContent />
    </Suspense>
  );
}

const sidebarStyle: CSSProperties = {
  backgroundColor: "var(--cc-surface-muted)",
  borderRadius: 8,
  overflowY: "auto",
  maxHeight: "calc(100vh - 140px)",
  width: "100%",
};

const viewerStyle: CSSProperties = {
  backgroundColor: "var(--cc-surface)",
  borderRadius: 8,
  minHeight: 400,
  width: "100%",
};

const brandSyncStyle: CSSProperties = {
  margin: 10,
  padding: 10,
  border: "1px solid var(--cc-line-alpha-15)",
  borderRadius: 8,
  background: "var(--cc-surface)",
};

const brandSyncHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

const brandSyncTitleStyle: CSSProperties = {
  color: "var(--cc-text-primary)",
  fontSize: 13,
  fontWeight: 800,
};

const brandSyncMetaStyle: CSSProperties = {
  marginTop: 2,
  color: "var(--cc-text-tertiary)",
  fontSize: 11,
};

const brandSyncStatusRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginTop: 8,
  flexWrap: "wrap",
};

const selectedFileSyncStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  marginTop: 8,
  padding: "7px 8px",
  border: "1px solid var(--cc-line-alpha-12)",
  borderRadius: 6,
  background: "var(--cc-surface-muted)",
  color: "var(--cc-text-secondary)",
  fontSize: 11,
  fontWeight: 700,
};

const brandSyncActionsStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 8,
  marginTop: 10,
};

const syncButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  minHeight: 32,
  padding: "0 10px",
  border: "1px solid var(--cc-line-alpha-20)",
  borderRadius: 6,
  background: "var(--cc-surface-muted)",
  color: "var(--cc-text-secondary)",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
};

const iconButtonStyle: CSSProperties = {
  width: 30,
  height: 30,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid var(--cc-line-alpha-15)",
  borderRadius: 6,
  background: "var(--cc-surface-muted)",
  color: "var(--cc-text-secondary)",
  cursor: "pointer",
};

const brandSyncNoticeStyle: CSSProperties = {
  marginTop: 8,
  color: "#6F6F6F",
  fontSize: 12,
  lineHeight: 1.35,
};

const brandSyncErrorStyle: CSSProperties = {
  marginTop: 8,
  color: "var(--cc-status-danger-bright)",
  fontSize: 12,
  lineHeight: 1.35,
};

function syncPillStyle(status: SyncItemStatus, compact: boolean): CSSProperties {
  const problem = status === "diverged" || status === "not_synced";
  const local = status === "local_changes";
  const server = status === "server_changes";
  return {
    display: "inline-flex",
    alignItems: "center",
    minHeight: compact ? 20 : 22,
    padding: compact ? "0 6px" : "0 8px",
    borderRadius: 999,
    border: problem
      ? "1px solid var(--cc-border-warning)"
      : local
        ? "1px solid rgba(131, 131, 131, 0.3)"
        : server
          ? "1px solid rgba(124, 124, 124, 0.25)"
          : "1px solid var(--cc-border-success)",
    background: problem
      ? "var(--cc-status-warning-bg)"
      : local
        ? "rgba(131, 131, 131, 0.08)"
        : server
          ? "rgba(124, 124, 124, 0.08)"
          : "var(--cc-status-success-bg)",
    color: problem
      ? "var(--cc-status-warning-strong)"
      : local
        ? "#717171"
        : server
          ? "var(--cc-brand-primary)"
          : "var(--cc-status-success-strong)",
    fontSize: compact ? 10 : 11,
    fontWeight: 800,
    whiteSpace: "nowrap",
  };
}

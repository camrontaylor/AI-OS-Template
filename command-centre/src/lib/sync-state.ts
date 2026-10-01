export type SyncItemStatus = "synced" | "local_changes" | "server_changes" | "diverged" | "not_synced";

export interface SyncStateFile {
  path: string;
  status: SyncItemStatus;
  localSha256?: string;
  remoteSha256?: string;
  localSize?: number;
  remoteSize?: number;
  localUpdatedAt?: string;
  remoteUpdatedAt?: string;
  secret?: boolean;
}

export interface SyncStateSummary {
  status: SyncItemStatus;
  counts: Record<SyncItemStatus, number>;
  files: SyncStateFile[];
  changedFiles: number;
  checkedAt: string;
}

export const SYNC_ITEM_STATUSES: readonly SyncItemStatus[] = [
  "synced",
  "local_changes",
  "server_changes",
  "diverged",
  "not_synced",
] as const;

export function emptySyncCounts(): Record<SyncItemStatus, number> {
  return {
    synced: 0,
    local_changes: 0,
    server_changes: 0,
    diverged: 0,
    not_synced: 0,
  };
}

export function classifySyncHashes(input: {
  localSha256?: string | null;
  remoteSha256?: string | null;
  lastSyncedSha256?: string | null;
}): SyncItemStatus {
  const localSha256 = cleanHash(input.localSha256);
  const remoteSha256 = cleanHash(input.remoteSha256);
  const lastSyncedSha256 = cleanHash(input.lastSyncedSha256);
  const hasLocal = localSha256 != null;
  const hasRemote = remoteSha256 != null;

  if (hasLocal && hasRemote && localSha256 === remoteSha256) return "synced";

  if (!lastSyncedSha256) {
    if (hasLocal && !hasRemote) return "local_changes";
    if (!hasLocal && hasRemote) return "server_changes";
    return "not_synced";
  }

  const localMatchesLast = localSha256 === lastSyncedSha256;
  const remoteMatchesLast = remoteSha256 === lastSyncedSha256;

  if (localMatchesLast && remoteMatchesLast) return "synced";
  if (!localMatchesLast && remoteMatchesLast) return "local_changes";
  if (localMatchesLast && !remoteMatchesLast) return "server_changes";
  return "diverged";
}

export function summarizeSyncFiles(files: SyncStateFile[], checkedAt = new Date().toISOString()): SyncStateSummary {
  const counts = emptySyncCounts();
  for (const file of files) {
    counts[file.status] += 1;
  }
  const changedFiles = files.length - counts.synced;
  return {
    status: summarizeSyncStatus(counts),
    counts,
    files,
    changedFiles,
    checkedAt,
  };
}

export function syncStatusToLocalStatus(status: SyncItemStatus): "ready" | "not_synced" {
  return status === "synced" ? "ready" : "not_synced";
}

function summarizeSyncStatus(counts: Record<SyncItemStatus, number>): SyncItemStatus {
  if (counts.diverged > 0) return "diverged";
  if (counts.local_changes > 0 && counts.server_changes > 0) return "diverged";
  if (counts.not_synced > 0) return "not_synced";
  if (counts.local_changes > 0) return "local_changes";
  if (counts.server_changes > 0) return "server_changes";
  return "synced";
}

function cleanHash(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { clearCronTaskSyncProfile } from "./cron-task-sync";
import { resetCronSchedulerProfile } from "./cron-scheduler";
import { closeLocalProfileHandle, getDb, runWithLocalProfile } from "./db";
import { closeProfileEventStreams } from "./event-bus";
import { fileWatcher } from "./file-watcher";
import type { LocalProfileDescriptorV1 } from "./local-profile";
import { cleanupManagedMaterializedCredentials } from "./materialized-file-ownership";
import {
  activateLocalProfile,
  beginLocalProfileClosing,
  finishLocalProfileClosing,
} from "./local-profile-lifecycle";
import { processManager } from "./process-manager";
import { cleanupManagedTeamSecrets } from "./team-secrets-env";
import { shutdownTerminalSessionsForProfile } from "./terminal-sessions";
import { killProcessTreeByPid } from "./subprocess";

export type LocalProfileCleanupWarningCode =
  | "remote_revoke_failed"
  | "process_force_stopped"
  | "process_cleanup_pending"
  | "database_cleanup_pending"
  | "temporary_cleanup_pending"
  | "managed_credentials_cleanup_pending";

export interface LocalProfileCleanupResultV1 {
  version: 1;
  status: "complete" | "complete_with_warnings";
  warnings: Array<{
    code: LocalProfileCleanupWarningCode;
    retry: "startup" | "next_login" | "not_required";
  }>;
}

interface ShutdownOptions {
  workspaceRoot: string;
  revokeRemote?: () => Promise<void>;
}

function revokeWithTimeout(revokeRemote: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 5000);
    revokeRemote().then(
      () => { clearTimeout(timer); resolve(); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function removeProfileTemporaryData(profile: LocalProfileDescriptorV1): void {
  if (profile.mode !== "team") return;
  const targets = [
    path.join(profile.tempDir, "runtime"),
    path.join(profile.tempDir, "context-overlays"),
    path.join(profile.tempDir, "chat-drafts", "drafts"),
    path.join(profile.tempDir, "goal-drafts"),
  ];
  for (const target of targets) fs.rmSync(target, { recursive: true, force: true });

  for (const entry of fs.readdirSync(os.tmpdir(), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith("cc-session-") || !entry.name.endsWith(".json")) continue;
    const mappingPath = path.join(os.tmpdir(), entry.name);
    try {
      const mapping = JSON.parse(fs.readFileSync(mappingPath, "utf8")) as { profileKey?: unknown };
      if (mapping.profileKey === profile.profileKey) fs.rmSync(mappingPath, { force: true });
    } catch {
      // Legacy/corrupt mappings are not adopted by another profile.
    }
  }
  for (const entry of fs.readdirSync(os.tmpdir(), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith("claude-ctx-") || !entry.name.endsWith(".json") || entry.name.endsWith("-warned.json")) continue;
    const bridgePath = path.join(os.tmpdir(), entry.name);
    try {
      const bridge = JSON.parse(fs.readFileSync(bridgePath, "utf8")) as { profileKey?: unknown };
      if (bridge.profileKey !== profile.profileKey) continue;
      fs.rmSync(bridgePath, { force: true });
      fs.rmSync(bridgePath.replace(/\.json$/, "-warned.json"), { force: true });
    } catch {
      // Owner-light legacy bridges expire through their existing age policy.
    }
  }
}

function closeCronDatabase(dbPath: string): void {
  const runtime = require("./cron-runtime.js") as { closeCronProfileDatabase?: (path: string) => boolean };
  runtime.closeCronProfileDatabase?.(dbPath);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopProfileCronDaemon(
  workspaceRoot: string,
  profile: LocalProfileDescriptorV1,
): Promise<boolean> {
  const markerPath = path.join(workspaceRoot, ".command-centre", "cron-daemon-profile-v1.json");
  let marker: { profileKey?: unknown; pid?: unknown };
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, "utf8")) as { profileKey?: unknown; pid?: unknown };
  } catch {
    return false;
  }
  const pid = Number(marker.pid);
  if (marker.profileKey !== profile.profileKey || !Number.isInteger(pid) || pid <= 0) return false;
  killProcessTreeByPid(pid, "SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 300));
  let forced = false;
  if (processIsAlive(pid)) {
    forced = true;
    killProcessTreeByPid(pid, "SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  fs.rmSync(markerPath, { force: true });
  return forced;
}

async function stopPersistedProfileProcesses(profile: LocalProfileDescriptorV1): Promise<void> {
  const pids = runWithLocalProfile(profile, () => {
    const db = getDb();
    return db.prepare("SELECT claudePid FROM tasks WHERE claudePid IS NOT NULL")
      .all()
      .map((row: unknown) => Number((row as { claudePid?: unknown }).claudePid))
      .filter((pid: number) => Number.isInteger(pid) && pid > 0);
  });
  for (const pid of pids) killProcessTreeByPid(pid, "SIGKILL");
  if (pids.length > 0) await new Promise((resolve) => setTimeout(resolve, 200));
  runWithLocalProfile(profile, () => {
    getDb().prepare("UPDATE tasks SET claudePid = NULL WHERE claudePid IS NOT NULL").run();
  });
}

export async function shutdownLocalProfile(
  profile: LocalProfileDescriptorV1,
  options: ShutdownOptions,
): Promise<LocalProfileCleanupResultV1> {
  beginLocalProfileClosing(profile);
  closeProfileEventStreams(profile.profileKey);

  const warnings: LocalProfileCleanupResultV1["warnings"] = [];
  const pending: string[] = [];
  const remoteRevocation = options.revokeRemote
    ? revokeWithTimeout(options.revokeRemote).catch(() => {
        warnings.push({ code: "remote_revoke_failed", retry: "not_required" });
      })
    : Promise.resolve();

  const [processResult, terminalResult] = await Promise.all([
    processManager.shutdownProfile(profile.profileKey, { gracefulMs: 3000, forceMs: 2000 }),
    shutdownTerminalSessionsForProfile(profile.profileKey, { gracefulMs: 3000, forceMs: 2000 }),
  ]);
  if (processResult.forced + terminalResult.forced > 0) {
    warnings.push({ code: "process_force_stopped", retry: "not_required" });
  }
  if (await stopProfileCronDaemon(options.workspaceRoot, profile)) {
    if (!warnings.some((warning) => warning.code === "process_force_stopped")) {
      warnings.push({ code: "process_force_stopped", retry: "not_required" });
    }
  }
  if (processResult.pending + terminalResult.pending > 0) {
    warnings.push({ code: "process_cleanup_pending", retry: "startup" });
    pending.push("processes");
  }

  await fileWatcher.cleanupProfile(profile.profileKey);
  clearCronTaskSyncProfile(profile.profileKey);
  resetCronSchedulerProfile(profile.profileKey);
  try { closeCronDatabase(profile.dbPath); } catch {
    warnings.push({ code: "database_cleanup_pending", retry: "startup" });
    pending.push("cron_database");
  }
  if (!closeLocalProfileHandle(profile.profileKey)) {
    warnings.push({ code: "database_cleanup_pending", retry: "startup" });
    pending.push("profile_database");
  }

  try {
    removeProfileTemporaryData(profile);
  } catch {
    warnings.push({ code: "temporary_cleanup_pending", retry: "startup" });
    pending.push("temporary_data");
  }
  try {
    await cleanupManagedTeamSecrets(options.workspaceRoot, profile);
    if (profile.mode === "team") cleanupManagedMaterializedCredentials(profile);
  } catch {
    warnings.push({ code: "managed_credentials_cleanup_pending", retry: "next_login" });
    pending.push("managed_credentials");
  }

  await remoteRevocation;
  finishLocalProfileClosing(profile, pending);
  return {
    version: 1,
    status: warnings.length === 0 ? "complete" : "complete_with_warnings",
    warnings,
  };
}

export async function recoverLocalProfileCleanup(
  profile: LocalProfileDescriptorV1,
  workspaceRoot: string,
): Promise<LocalProfileCleanupResultV1> {
  const markerPath = path.join(profile.stateDir, "cleanup-pending-v1.json");
  if (!fs.existsSync(markerPath)) {
    activateLocalProfile(profile);
    return { version: 1, status: "complete", warnings: [] };
  }
  await stopPersistedProfileProcesses(profile);
  const result = await shutdownLocalProfile(profile, { workspaceRoot });
  if (!result.warnings.some((warning) => warning.retry !== "not_required")) {
    activateLocalProfile(profile, { rotate: true });
  }
  return result;
}

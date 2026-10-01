"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

test("logout cleanup removes volatile data, preserves sent attachments, and tolerates offline revoke", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aios-profile-shutdown-"));
  const profile = {
    version: 1,
    mode: "team",
    profileKey: "profile-a",
    identity: { version: 1, serverId: "server", userId: "user-a" },
    dataDir: path.join(root, "profile-a"),
    stateDir: path.join(root, "profile-a", "state"),
    tempDir: path.join(root, "profile-a", "tmp"),
    dbPath: path.join(root, "profile-a", "data.db"),
  };
  const draft = path.join(profile.tempDir, "chat-drafts", "drafts", "draft-1", "file.txt");
  const sent = path.join(profile.tempDir, "chat-drafts", "sent", "conversation", "message", "file.txt");
  const goalDraft = path.join(profile.tempDir, "goal-drafts", "goal-1", "file.txt");
  const runtime = path.join(profile.tempDir, "runtime", "context.json");
  for (const file of [draft, sent, goalDraft, runtime]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "test");
  }

  const lifecycle = loadTsModule(path.join(__dirname, "local-profile-lifecycle.ts"));
  lifecycle.resetLocalProfileLifecycleForTesting();
  const calls = [];
  try {
    const coordinator = loadTsModule(path.join(__dirname, "profile-shutdown-coordinator.ts"), {
      stubs: {
        "./cron-task-sync": { clearCronTaskSyncProfile: (key) => calls.push(`cron-sync:${key}`) },
        "./cron-scheduler": { resetCronSchedulerProfile: (key) => calls.push(`cron-scheduler:${key}`) },
        "./db": { closeLocalProfileHandle: () => true, getDb: () => null, runWithLocalProfile: (_profile, operation) => operation() },
        "./event-bus": { closeProfileEventStreams: (key) => calls.push(`sse:${key}`) },
        "./file-watcher": { fileWatcher: { cleanupProfile: async (key) => calls.push(`watcher:${key}`) } },
        "./local-profile-lifecycle": lifecycle,
        "./materialized-file-ownership": { cleanupManagedMaterializedCredentials: () => calls.push("credentials") },
        "./process-manager": { processManager: { shutdownProfile: async () => ({ stopped: 1, forced: 1, pending: 0 }) } },
        "./team-secrets-env": { cleanupManagedTeamSecrets: async () => ({ filesChanged: 1 }) },
        "./terminal-sessions": { shutdownTerminalSessionsForProfile: async () => ({ stopped: 1, forced: 0, pending: 0 }) },
        "./subprocess": { killProcessTreeByPid: () => {} },
        "./cron-runtime.js": { closeCronProfileDatabase: () => true },
      },
    });

    const result = await coordinator.shutdownLocalProfile(profile, {
      workspaceRoot: root,
      revokeRemote: async () => { throw new Error("offline"); },
    });
    assert.equal(result.status, "complete_with_warnings");
    assert.deepEqual(result.warnings.map((warning) => warning.code).sort(), ["process_force_stopped", "remote_revoke_failed"]);
    assert.equal(fs.existsSync(draft), false);
    assert.equal(fs.existsSync(goalDraft), false);
    assert.equal(fs.existsSync(runtime), false);
    assert.equal(fs.existsSync(sent), true);
    assert.equal(fs.existsSync(path.join(profile.stateDir, lifecycle.LOCAL_PROFILE_CLEANUP_MARKER)), false);
    assert.ok(calls.includes("credentials"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

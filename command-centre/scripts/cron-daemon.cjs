#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");
const cronRuntime = require("../src/lib/cron-runtime.js");
const {
  removeFileIfMatchesAtomically,
  writeFileAtomically,
} = require("../src/lib/owned-file.cjs");
const daemonStartup = require("./cron-daemon-startup.cjs");
const { findWorkspaceRoot } = require("./workspace-root.cjs");
const { resolveLocalRuntimeProfile } = require("./local-profile-runtime.cjs");

const TICK_INTERVAL_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const QUEUE_POLL_INTERVAL_MS = 2_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const aiOsDir = cronRuntime.resolveAiOsRoot(
  process.env.AI_OS_DIR || findWorkspaceRoot(__dirname)
);
const command = process.argv[2] || "status";
const runtimeProfile = resolveLocalRuntimeProfile(aiOsDir);

function withProfileDb(operation) {
  return cronRuntime.runWithDbPath(runtimeProfile.dbPath, operation);
}

function profileMarkerPath() {
  return path.join(cronRuntime.getRuntimePaths(aiOsDir).dataDir, "cron-daemon-profile-v1.json");
}

function startupTestHookEnabled(name) {
  return process.env.NODE_ENV === "test" && process.env[name] === "1";
}

function startupTestAckPath(startToken) {
  const safeToken = String(startToken || "").replace(/[^a-zA-Z0-9-]/g, "");
  return path.join(
    cronRuntime.getRuntimePaths(aiOsDir).dataDir,
    `cron-daemon-test-first-confirmation-${safeToken}.ack`,
  );
}

function startupTestCleanupRequestPath(startToken) {
  const safeToken = String(startToken || "").replace(/[^a-zA-Z0-9-]/g, "");
  return path.join(
    cronRuntime.getRuntimePaths(aiOsDir).dataDir,
    `cron-daemon-test-cleanup-${safeToken}.request`,
  );
}

function armExitAfterFirstConfirmationTestHook() {
  if (!startupTestHookEnabled("AI_OS_CRON_TEST_EXIT_AFTER_FIRST_CONFIRMATION")) return;
  const startToken = process.env.AI_OS_CRON_START_TOKEN || "";
  const ackPath = startupTestAckPath(startToken);
  const handle = setInterval(() => {
    if (!fs.existsSync(ackPath)) return;
    clearInterval(handle);
    console.error(
      `[cron-daemon] Test hook stopping pid ${process.pid} after the first readiness confirmation.`,
    );
    process.exit(86);
  }, 1);
}

function writeProfileMarker() {
  writeFileAtomically(
    profileMarkerPath(),
    JSON.stringify({
      version: 1,
      profileKey: runtimeProfile.profileKey,
      pid: process.pid,
      startToken: process.env.AI_OS_CRON_START_TOKEN || null,
      readyAt: new Date().toISOString(),
    }),
  );
}

function readProfileMarker() {
  try {
    return JSON.parse(fs.readFileSync(profileMarkerPath(), "utf8"));
  } catch {
    return null;
  }
}

function removeProfileMarker() {
  const startToken = process.env.AI_OS_CRON_START_TOKEN || null;
  try {
    removeFileIfMatchesAtomically(profileMarkerPath(), (contents) => {
      try {
        const marker = JSON.parse(contents);
        return (
          marker?.profileKey === runtimeProfile.profileKey &&
          marker?.pid === process.pid &&
          marker?.startToken === startToken
        );
      } catch {
        return false;
      }
    });
  } catch (error) {
    // Exit cleanup must not hide the daemon's original result. A failed
    // conditional claim remains isolated and recoverable.
    console.error(
      `[cron-daemon] Could not safely remove this daemon's readiness marker: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function profileStillActive() {
  try {
    return resolveLocalRuntimeProfile(aiOsDir).profileKey === runtimeProfile.profileKey;
  } catch {
    return false;
  }
}

function readOwnershipRegistry() {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(aiOsDir, ".command-centre", "materialized-ownership-v1.json"), "utf8"),
    );
    return parsed?.version === 1 && parsed.files && typeof parsed.files === "object" ? parsed.files : {};
  } catch {
    return {};
  }
}

function isJobPathAccessible(workspaceDir, slug, owners = readOwnershipRegistry()) {
  const jobPath = path.join(workspaceDir, "cron", "jobs", `${slug}.md`);
  const relativePath = path.relative(aiOsDir, jobPath).replace(/\\/g, "/");
  const owner = owners[relativePath];
  if (!owner) return runtimeProfile.mode === "solo";
  return owner.profileKey === runtimeProfile.profileKey;
}

function isJobAccessible(job, owners = readOwnershipRegistry()) {
  return isJobPathAccessible(job.workspaceDir, job.slug, owners);
}

function listAccessibleJobs() {
  const owners = readOwnershipRegistry();
  const jobs = [];
  for (const workspace of cronRuntime.listWorkspaceDescriptors(aiOsDir)) {
    const jobsDir = path.join(workspace.workspaceDir, "cron", "jobs");
    let fileNames = [];
    try {
      fileNames = fs.readdirSync(jobsDir).filter((fileName) => fileName.endsWith(".md"));
    } catch {
      continue;
    }
    for (const fileName of fileNames) {
      const slug = fileName.slice(0, -3);
      if (!isJobPathAccessible(workspace.workspaceDir, slug, owners)) continue;
      const job = withProfileDb(() => cronRuntime.getCronJob(aiOsDir, slug, workspace.clientId));
      if (job) jobs.push(job);
    }
  }
  return jobs;
}

function parseArgs(argv) {
  const args = { clientId: null, slug: null };
  for (let index = 3; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--client") {
      args.clientId = argv[index + 1] || null;
      index += 1;
      continue;
    }
    if (!args.slug) {
      args.slug = value;
    }
  }
  return args;
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function formatStatus(status) {
  return [
    `runtime: ${status.runtime}`,
    `leader: ${status.leader}`,
    `leaderState: ${status.leaderState}`,
    `statusSummary: ${status.statusSummary}`,
    `ownershipReason: ${status.ownershipReason}`,
    `identifier: ${status.identifier || "none"}`,
    `pid: ${status.pid || "none"}`,
    `workspaceCount: ${status.workspaceCount}`,
    `heartbeatAt: ${status.heartbeatAt || "n/a"}`,
    `startCommand: ${status.startCommand}`,
    `stopCommand: ${status.stopCommand}`,
    `logsCommand: ${status.logsCommand}`,
  ].join("\n");
}

async function runServe() {
  const identifier = `daemon-${process.pid}`;
  const startToken = process.env.AI_OS_CRON_START_TOKEN || null;
  const runtimePaths = cronRuntime.getRuntimePaths(aiOsDir);

  if (!cronRuntime.claimDaemonPid(aiOsDir, process.pid)) {
    throw new Error(
      "Another managed cron daemon claimed the runtime before this process became ready.",
    );
  }

  // Opening the profile database applies legacy compatibility columns before
  // schema.sql. Do not publish readiness until that upgrade succeeds.
  try {
    withProfileDb(() => cronRuntime.getDb(aiOsDir, runtimeProfile.dbPath));
  } catch (error) {
    cronRuntime.removeDaemonPid(aiOsDir, process.pid);
    throw error;
  }

  let tickHandle = null;
  let heartbeatHandle = null;
  let queueHandle = null;
  let cleanupRequestHandle = null;
  let stopHandshakeResponder = null;
  let isLeader = false;
  let lastSweepAt = null;
  let currentExecution = null;

  const cleanup = () => {
    if (tickHandle) clearInterval(tickHandle);
    if (heartbeatHandle) clearInterval(heartbeatHandle);
    if (queueHandle) clearInterval(queueHandle);
    if (cleanupRequestHandle) clearInterval(cleanupRequestHandle);
    if (stopHandshakeResponder) stopHandshakeResponder();
    cronRuntime.releaseRuntimeLeadership(aiOsDir, identifier, {
      pid: process.pid,
      profileKey: runtimeProfile.profileKey,
      startToken,
    });
    cronRuntime.removeDaemonPid(aiOsDir, process.pid);
    removeProfileMarker();
  };

  const tick = () => {
    if (!profileStillActive()) {
      cleanup();
      process.exit(0);
    }
    const accessibleJobs = listAccessibleJobs();
    const workspaceCount = new Set(accessibleJobs.map((job) => job.workspaceKey)).size;
    if (!accessibleJobs.some((job) => job.active)) {
      if (isLeader) {
        cronRuntime.releaseRuntimeLeadership(aiOsDir, identifier, {
          pid: process.pid,
          profileKey: runtimeProfile.profileKey,
          startToken,
        });
        isLeader = false;
        lastSweepAt = null;
      }
      return;
    }

    const claim = cronRuntime.claimRuntimeLeadership(aiOsDir, {
      runtime: "daemon",
      identifier,
      pid: process.pid,
      workspaceCount,
      lastSweepAt,
      profileKey: runtimeProfile.profileKey,
      startToken,
    });

    if (!claim) {
      isLeader = false;
      return;
    }

    isLeader = true;
    const now = new Date();
    const activeJobs = accessibleJobs.filter((job) => job.active && job.prompt);

    if (lastSweepAt) {
      const previous = new Date(lastSweepAt);
      for (const job of activeJobs) {
        for (const missedAt of cronRuntime.getMissedFixedRuns(job.time, job.days, previous, now)) {
          withProfileDb(() => cronRuntime.enqueueCronJob(aiOsDir, job, {
            trigger: "scheduled",
            dedupeByMinute: true,
            activityLabel: "Queued — catch-up",
            scheduledFor: missedAt.toISOString(),
          }));
        }
      }
    }

    for (const job of activeJobs) {
      if (!cronRuntime.shouldDispatchNow(now, job)) {
        continue;
      }

      withProfileDb(() => cronRuntime.enqueueCronJob(aiOsDir, job, {
        trigger: "scheduled",
        dedupeByMinute: true,
        activityLabel: "Queued — scheduled",
        scheduledFor: cronRuntime.toMinuteIso(now),
      }));
    }

    lastSweepAt = now.toISOString();
    const refreshed = cronRuntime.refreshRuntimeHeartbeat(
      aiOsDir,
      identifier,
      {
        runtime: "daemon",
        workspaceCount,
        lastSweepAt,
      },
      {
        pid: process.pid,
        profileKey: runtimeProfile.profileKey,
        startToken,
      },
    );
    if (!refreshed) {
      isLeader = false;
      lastSweepAt = null;
    }
  };

  const processQueuedCronTask = async () => {
    if (!isLeader || currentExecution) {
      return;
    }

    if (!profileStillActive()) {
      cleanup();
      process.exit(0);
    }
    const db = cronRuntime.getDb(aiOsDir, runtimeProfile.dbPath);
    const task = db
      .prepare(
        `SELECT * FROM tasks
         WHERE status = 'queued'
           AND cronJobSlug IS NOT NULL
         ORDER BY createdAt ASC
         LIMIT 1`
      )
      .get();

    if (!task) {
      return;
    }

    currentExecution = withProfileDb(() => cronRuntime.executeCronTask(aiOsDir, task.id));
    try {
      await currentExecution;
    } catch (error) {
      console.error("[cron-daemon] Failed to execute queued cron task:", error);
    } finally {
      currentExecution = null;
    }
  };

  process.on("exit", cleanup);
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  tick();
  tickHandle = setInterval(tick, TICK_INTERVAL_MS);
  heartbeatHandle = setInterval(() => {
    if (!isLeader) return;
    const refreshed = cronRuntime.refreshRuntimeHeartbeat(
      aiOsDir,
      identifier,
      {
        runtime: "daemon",
        lastSweepAt,
      },
      {
        pid: process.pid,
        profileKey: runtimeProfile.profileKey,
        startToken,
      },
    );
    if (!refreshed) {
      isLeader = false;
      lastSweepAt = null;
    }
  }, HEARTBEAT_INTERVAL_MS);
  queueHandle = setInterval(() => {
    processQueuedCronTask().catch((error) => {
      console.error("[cron-daemon] Queue poll failed:", error);
    });
  }, QUEUE_POLL_INTERVAL_MS);

  if (startupTestHookEnabled("AI_OS_CRON_TEST_OMIT_READY_MARKER")) {
    console.error(`[cron-daemon] Test hook omitted the readiness marker for pid ${process.pid}.`);
  } else {
    if (!profileStillActive()) {
      cleanup();
      throw new Error(
        `The active profile changed before cron daemon ${process.pid} could publish readiness.`,
      );
    }
    writeProfileMarker();
    stopHandshakeResponder = daemonStartup.startDaemonHandshakeResponder({
      dataDir: runtimePaths.dataDir,
      pid: process.pid,
      profileKey: runtimeProfile.profileKey,
      startToken,
      isCurrentOwner: () => {
        const marker = readProfileMarker();
        const lock = cronRuntime.readRuntimeRecord(aiOsDir);
        return (
          profileStillActive() &&
          daemonStartup.hasValidExistingDaemonOwnership({
            pid: process.pid,
            recordedPid: cronRuntime.readDaemonPid(aiOsDir),
            marker,
            lock,
            lockPresent: fs.existsSync(runtimePaths.lockPath),
            profileKey: runtimeProfile.profileKey,
            isLockStale: cronRuntime.isRuntimeRecordStale,
          })
        );
      },
    });
    armExitAfterFirstConfirmationTestHook();
    if (startupTestHookEnabled("AI_OS_CRON_TEST_CLEANUP_REQUEST")) {
      const requestPath = startupTestCleanupRequestPath(startToken);
      cleanupRequestHandle = setInterval(() => {
        if (!fs.existsSync(requestPath)) return;
        fs.rmSync(requestPath, { force: true });
        cleanup();
        process.exit(0);
      }, 1);
    }
  }
  console.log(`[cron-daemon] Serving ${aiOsDir} as ${identifier}`);
}

function startupTimeoutMs() {
  const configured = Number.parseInt(process.env.AI_OS_CRON_STARTUP_TIMEOUT_MS || "", 10);
  return Number.isFinite(configured) && configured > 0
    ? Math.min(configured, DEFAULT_STARTUP_TIMEOUT_MS)
    : DEFAULT_STARTUP_TIMEOUT_MS;
}

function readLogTail(logPath, maxLines = 20) {
  try {
    return fs
      .readFileSync(logPath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-maxLines)
      .join("\n");
  } catch {
    return "";
  }
}

function inspectExistingDaemon(status = cronRuntime.getManagedRuntimeStatus(aiOsDir)) {
  const runtimePaths = cronRuntime.getRuntimePaths(aiOsDir);
  const markerPath = profileMarkerPath();
  const recordedPid = cronRuntime.readDaemonPid(aiOsDir);
  const marker = readProfileMarker();
  const lock = cronRuntime.readRuntimeRecord(aiOsDir);
  const statusPid =
    status.runtime === "daemon" && Number.isFinite(status.pid) ? status.pid : null;
  const markerPid = Number.isFinite(marker?.pid) ? marker.pid : null;
  const pid = recordedPid || statusPid || markerPid || null;
  const alive = Boolean(pid && isPidAlive(pid));
  const owned = daemonStartup.hasValidExistingDaemonOwnership({
    pid,
    recordedPid,
    marker,
    lock,
    lockPresent: fs.existsSync(runtimePaths.lockPath),
    profileKey: runtimeProfile.profileKey,
    isLockStale: cronRuntime.isRuntimeRecordStale,
    allowStaleLock: !alive,
  });
  const legacyOwned = daemonStartup.hasCompatibleLegacyDaemonOwnership({
    pid,
    recordedPid,
    marker,
    markerPresent: fs.existsSync(markerPath),
    lock,
    lockPresent: fs.existsSync(runtimePaths.lockPath),
    profileKey: runtimeProfile.profileKey,
    allowMarkerless: runtimeProfile.mode === "solo",
  });
  return {
    status,
    pid,
    recordedPid,
    marker,
    markerPresent: fs.existsSync(markerPath),
    lock,
    alive,
    owned,
    legacyOwned,
  };
}

function removeDeadOwnedDaemonState(state) {
  const runtimePaths = cronRuntime.getRuntimePaths(aiOsDir);
  daemonStartup.removeOwnedStartupArtifacts({
    pid: state.pid,
    startToken: state.marker.startToken,
    profileKey: runtimeProfile.profileKey,
    markerPath: profileMarkerPath(),
    pidPath: runtimePaths.pidPath,
    lockPath: runtimePaths.lockPath,
    isPidAlive,
  });
}

function removeDeadLegacyDaemonState(state) {
  const runtimePaths = cronRuntime.getRuntimePaths(aiOsDir);
  daemonStartup.removeOwnedLegacyArtifacts({
    pid: state.pid,
    profileKey: runtimeProfile.profileKey,
    markerPath: profileMarkerPath(),
    pidPath: runtimePaths.pidPath,
    lockPath: runtimePaths.lockPath,
    isPidAlive,
  });
}

function unverifiedDaemonError(action, pid) {
  return new Error(
    `Refusing to ${action} the managed cron daemon because PID ${pid} is not ` +
      "proven to be a ready daemon for the active profile.",
  );
}

async function proveExistingDaemonIsLive(state, action) {
  if (!state?.owned || !state.alive || !state.pid) {
    throw unverifiedDaemonError(action, state?.pid || "unknown");
  }
  try {
    await daemonStartup.requestDaemonHandshake({
      dataDir: cronRuntime.getRuntimePaths(aiOsDir).dataDir,
      pid: state.pid,
      profileKey: runtimeProfile.profileKey,
      startToken: state.marker.startToken,
      action,
      isPidAlive,
    });
  } catch (error) {
    throw new Error(
      `Refusing to ${action} the managed cron daemon because its live handshake failed: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const confirmed = inspectExistingDaemon();
  if (
    !confirmed.owned ||
    !confirmed.alive ||
    confirmed.pid !== state.pid ||
    confirmed.recordedPid !== state.pid ||
    confirmed.marker?.profileKey !== state.marker?.profileKey ||
    confirmed.marker?.startToken !== state.marker?.startToken
  ) {
    throw unverifiedDaemonError(action, state.pid);
  }
  return confirmed;
}

function legacyOwnershipSnapshot() {
  const current = inspectExistingDaemon();
  return {
    ...current,
    owned: current.legacyOwned,
  };
}

function proveLegacyDaemonIsLive(state, action) {
  if (!state?.legacyOwned || !state.alive || !state.pid) {
    throw unverifiedDaemonError(action, state?.pid || "unknown");
  }
  try {
    daemonStartup.proveLegacyDaemonProcess(state.pid, {
      execPath: process.execPath,
      scriptPath: __filename,
    });
  } catch (error) {
    throw new Error(
      `Refusing to ${action} legacy cron daemon PID ${state.pid}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const confirmed = inspectExistingDaemon();
  const sameLegacyMarker =
    state.markerPresent === true
      ? daemonStartup.isLegacyReadinessMarker(confirmed.marker, {
          pid: state.pid,
          profileKey: runtimeProfile.profileKey,
        })
      : confirmed.markerPresent === false &&
        (confirmed.marker === null || confirmed.marker === undefined);
  if (
    !confirmed.legacyOwned ||
    !confirmed.alive ||
    confirmed.pid !== state.pid ||
    confirmed.recordedPid !== state.pid ||
    !sameLegacyMarker
  ) {
    throw unverifiedDaemonError(action, state.pid);
  }
  return confirmed;
}

async function stopLegacyDaemon(existing, action) {
  proveLegacyDaemonIsLive(existing, action);
  await daemonStartup.stopVerifiedDaemon({
    pid: existing.pid,
    expectedOwner: {
      legacy: true,
      profileKey: runtimeProfile.profileKey,
      markerPresent: existing.markerPresent,
    },
    inspectOwnership: legacyOwnershipSnapshot,
    isPidAlive,
    signalProcess: (pid, signal) => process.kill(pid, signal),
    proveLiveness: async () => {
      proveLegacyDaemonIsLive(existing, action);
    },
  });
  removeDeadLegacyDaemonState(existing);
}

async function startDaemon() {
  let status = cronRuntime.getManagedRuntimeStatus(aiOsDir);
  let existing = inspectExistingDaemon(status);
  let replacingLegacyDaemon = false;
  if (existing.pid) {
    if (existing.alive) {
      if (existing.legacyOwned) {
        replacingLegacyDaemon = true;
        await stopLegacyDaemon(existing, "restart");
        status = cronRuntime.getManagedRuntimeStatus(aiOsDir);
        existing = inspectExistingDaemon(status);
      } else {
        const confirmed = inspectExistingDaemon();
        if (
          !confirmed.owned ||
          !confirmed.alive ||
          confirmed.pid !== existing.pid
        ) {
          throw unverifiedDaemonError("start", existing.pid);
        }
        const live = await proveExistingDaemonIsLive(confirmed, "start");
        console.log(formatStatus(live.status));
        return;
      }
    } else if (existing.legacyOwned) {
      replacingLegacyDaemon = true;
      removeDeadLegacyDaemonState(existing);
      status = cronRuntime.getManagedRuntimeStatus(aiOsDir);
      existing = inspectExistingDaemon(status);
    } else {
      const confirmed = inspectExistingDaemon();
      if (confirmed.owned && !confirmed.alive && confirmed.pid === existing.pid) {
        removeDeadOwnedDaemonState(confirmed);
      } else if (!existing.marker && !existing.lock && existing.recordedPid === existing.pid) {
        // A plain dead PID left by a pre-marker release is safe to discard.
        cronRuntime.removeDaemonPid(aiOsDir, existing.pid);
      } else {
        throw unverifiedDaemonError("replace", existing.pid);
      }
      status = cronRuntime.getManagedRuntimeStatus(aiOsDir);
      existing = inspectExistingDaemon(status);
    }
  }

  if (existing.marker || (existing.lock && existing.lock.runtime === "daemon")) {
    throw unverifiedDaemonError("replace", existing.pid || "unknown");
  }
  if (
    !replacingLegacyDaemon &&
    status.leaderState === "active" &&
    status.runtime !== "daemon"
  ) {
    console.log(formatStatus(status));
    return;
  }

  const runtimePaths = cronRuntime.getRuntimePaths(aiOsDir);
  fs.mkdirSync(runtimePaths.dataDir, { recursive: true });
  const startToken = randomUUID();
  const timeoutMs = startupTimeoutMs();
  // Keep the entire failed start, including TERM/KILL cleanup, inside the
  // configured ceiling. The small safety margin covers final error formatting
  // and process shutdown outside the asynchronous waits below.
  const startupDeadlineAt =
    Date.now() +
    Math.max(
      1,
      timeoutMs - Math.min(750, Math.max(100, Math.floor(timeoutMs / 10))),
    );
  const cleanupReserveMs = Math.min(
    1_000,
    Math.max(25, Math.floor(timeoutMs / 5)),
  );
  const readinessTimeoutMs = Math.max(
    1,
    startupDeadlineAt - Date.now() - cleanupReserveMs,
  );
  const exitAfterFirstConfirmation = startupTestHookEnabled(
    "AI_OS_CRON_TEST_EXIT_AFTER_FIRST_CONFIRMATION",
  );
  const firstConfirmationAckPath = exitAfterFirstConfirmation
    ? startupTestAckPath(startToken)
    : null;
  let child = null;
  try {
    child = daemonStartup.spawnWithLogFile({
      logPath: runtimePaths.logPath,
      command: process.execPath,
      args: [__filename, "serve"],
      spawnProcess: spawn,
      spawnOptions: {
        cwd: aiOsDir,
        detached: true,
        windowsHide: true,
        env: {
          ...process.env,
          AI_OS_DIR: aiOsDir,
          AI_OS_CRON_START_TOKEN: startToken,
        },
      },
    });
    await daemonStartup.waitForDaemonReady({
      child,
      startToken,
      profileKey: runtimeProfile.profileKey,
      readMarker: readProfileMarker,
      readPid: () => cronRuntime.readDaemonPid(aiOsDir),
      isProfileActive: profileStillActive,
      isPidAlive,
      timeoutMs: readinessTimeoutMs,
      onFirstConfirmation: exitAfterFirstConfirmation
        ? () => fs.writeFileSync(firstConfirmationAckPath, "confirmed\n", "utf8")
        : null,
    });
  } catch (error) {
    let failedChildCleanup = null;
    if (child) {
      failedChildCleanup = await daemonStartup.settleFailedStartedChild({
        child,
        isPidAlive,
        deadlineAt: startupDeadlineAt,
        artifactOptions: {
          startToken,
          profileKey: runtimeProfile.profileKey,
          markerPath: profileMarkerPath(),
          pidPath: runtimePaths.pidPath,
          lockPath: runtimePaths.lockPath,
        },
      });
    }
    if (firstConfirmationAckPath) fs.rmSync(firstConfirmationAckPath, { force: true });
    if (failedChildCleanup && !failedChildCleanup.stopped) {
      throw daemonStartup.buildFailedStartError({
        startupError: error,
        child,
        cleanup: failedChildCleanup,
      });
    }
    // The child is confirmed stopped, so buffered startup errors are complete.
    const logTail = readLogTail(runtimePaths.logPath);
    throw daemonStartup.buildFailedStartError({
      startupError: error,
      child,
      cleanup: failedChildCleanup,
      logTail,
    });
  }

  if (firstConfirmationAckPath) fs.rmSync(firstConfirmationAckPath, { force: true });
  child.unref();
  console.log(`started daemon pid ${child.pid}`);
  console.log(`logs: ${runtimePaths.logPath}`);
}

async function stopDaemon() {
  const existing = inspectExistingDaemon();
  if (!existing.pid) {
    console.log("stopped daemon");
    return;
  }
  if (!existing.owned && !existing.legacyOwned) {
    throw unverifiedDaemonError("stop", existing.pid);
  }

  if (existing.alive) {
    if (existing.legacyOwned) {
      await stopLegacyDaemon(existing, "stop");
    } else {
      await daemonStartup.stopVerifiedDaemon({
        pid: existing.pid,
        expectedOwner: {
          profileKey: runtimeProfile.profileKey,
          startToken: existing.marker.startToken,
        },
        inspectOwnership: inspectExistingDaemon,
        isPidAlive,
        signalProcess: (pid, signal) => process.kill(pid, signal),
        proveLiveness: async () => {
          await proveExistingDaemonIsLive(existing, "stop");
        },
      });
      // Use the captured ownership proof, but re-check every file inside the
      // conditional cleanup so replacements from another process survive.
      removeDeadOwnedDaemonState(existing);
    }
  } else {
    if (existing.legacyOwned) {
      removeDeadLegacyDaemonState(existing);
    } else {
      removeDeadOwnedDaemonState(existing);
    }
  }

  console.log("stopped daemon");
}

// Printed as the last line so the status wrappers can downgrade their success
// message; the exit code stays 0 because the status check itself succeeded.
const NO_RUNTIME_WARNING_PREFIX = "warning: ";

function showStatus() {
  const status = cronRuntime.getManagedRuntimeStatus(aiOsDir);
  console.log(formatStatus(status));
  if (status.leaderState !== "active" && cronRuntime.hasActiveCronJobs(aiOsDir)) {
    console.log(
      `${NO_RUNTIME_WARNING_PREFIX}active cron jobs exist but no live runtime owns scheduling, ` +
        `so they will not run until the Command Centre or the cron daemon is running ` +
        `(start: ${status.startCommand}).`,
    );
  }
}

function showLogs() {
  const logPath = cronRuntime.getRuntimePaths(aiOsDir).logPath;
  if (!fs.existsSync(logPath)) {
    console.log("(no daemon log)");
    return;
  }

  const lines = fs.readFileSync(logPath, "utf-8").split(/\r?\n/);
  console.log(lines.slice(-200).join("\n"));
}

async function runJob() {
  const args = parseArgs(process.argv);
  if (!args.slug) {
    throw new Error("Usage: cron-daemon.cjs run-job <job-slug> [--client <client-id>]");
  }

  const job = withProfileDb(() => cronRuntime.getCronJob(aiOsDir, args.slug, args.clientId));
  if (!job || !isJobAccessible(job)) throw new Error("Cron job not found");
  const result = await withProfileDb(() => cronRuntime.runCronJobNow(aiOsDir, args.slug, args.clientId));
  console.log(
    JSON.stringify(
      {
        taskId: result.task.id,
        result: result.result,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      },
      null,
      2
    )
  );
}

async function main() {
  switch (command) {
    case "start":
      await startDaemon();
      break;
    case "serve":
      await runServe();
      break;
    case "stop":
      await stopDaemon();
      break;
    case "status":
      showStatus();
      break;
    case "logs":
      showLogs();
      break;
    case "run-job":
      await runJob();
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

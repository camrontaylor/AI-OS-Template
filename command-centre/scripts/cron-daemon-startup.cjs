"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { removeFileIfMatchesAtomically } = require("../src/lib/owned-file.cjs");

const DEFAULT_CONFIRMATION_INTERVAL_MS = 50;
const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_TERMINATION_GRACE_MS = 500;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 3_000;
const DEFAULT_HANDSHAKE_STALE_MS = 5_000;
const DEFAULT_HANDSHAKE_FALLBACK_INTERVAL_MS = 2_000;
const DEFAULT_HANDSHAKE_WATCH_DEBOUNCE_MS = 10;
const HANDSHAKE_PREFIX = "cron-daemon-handshake-";

function childExitDetail(child, observedExit) {
  const exitCode = observedExit?.code ?? child?.exitCode;
  const signal = observedExit?.signal ?? child?.signalCode;
  if (exitCode !== null && exitCode !== undefined) {
    return `exit code ${exitCode}`;
  }
  if (signal) {
    return `signal ${signal}`;
  }
  return null;
}

function readinessMarkerMatches(marker, expected) {
  return (
    marker?.version === 1 &&
    marker?.profileKey === expected.profileKey &&
    marker?.pid === expected.pid &&
    marker?.startToken === expected.startToken &&
    typeof marker.readyAt === "string"
  );
}

function hasValidExistingDaemonOwnership(options) {
  const {
    pid,
    recordedPid,
    marker,
    lock,
    lockPresent = Boolean(lock),
    profileKey,
    isLockStale,
    allowStaleLock = false,
  } = options;
  if (!pid || recordedPid !== pid) return false;
  if (
    marker?.version !== 1 ||
    marker?.profileKey !== profileKey ||
    marker?.pid !== pid ||
    typeof marker?.startToken !== "string" ||
    !marker.startToken.trim() ||
    typeof marker?.readyAt !== "string" ||
    !Number.isFinite(Date.parse(marker.readyAt))
  ) {
    return false;
  }

  // A daemon can remain alive in standby while an in-process runtime owns the
  // shared scheduling lock. PID + marker identify the daemon candidate; the
  // live challenge/ack below is the final proof. A foreign lock is therefore
  // preserved and does not invalidate the daemon.
  if (!lock) return !lockPresent;
  const lockClaimsThisDaemon =
    lock.runtime === "daemon" &&
    (lock.pid === pid || lock.identifier === `daemon-${pid}`);
  if (!lockClaimsThisDaemon) return true;

  // If the lock claims this daemon, all of its ownership fields must agree.
  if (
    lock.runtime !== "daemon" ||
    lock.leader !== true ||
    lock.identifier !== `daemon-${pid}` ||
    lock.pid !== pid ||
    lock.profileKey !== profileKey ||
    lock.startToken !== marker.startToken ||
    (!allowStaleLock && typeof isLockStale === "function" && isLockStale(lock))
  ) {
    return false;
  }
  return true;
}

function isLegacyReadinessMarker(marker, expected) {
  return Boolean(
    marker?.version === 1 &&
      marker?.profileKey === expected.profileKey &&
      marker?.pid === expected.pid &&
      !Object.prototype.hasOwnProperty.call(marker, "startToken") &&
      !Object.prototype.hasOwnProperty.call(marker, "readyAt"),
  );
}

function hasCompatibleLegacyDaemonOwnership(options) {
  const {
    pid,
    recordedPid,
    marker,
    markerPresent = Boolean(marker),
    lock,
    lockPresent = Boolean(lock),
    profileKey,
    allowMarkerless = false,
  } = options;
  if (!pid || recordedPid !== pid) {
    return false;
  }
  const hasLegacyMarker = isLegacyReadinessMarker(marker, { pid, profileKey });
  const isSafeMarkerlessCandidate =
    allowMarkerless && !markerPresent && (marker === null || marker === undefined);
  if (!hasLegacyMarker && !isSafeMarkerlessCandidate) return false;

  if (!lock) return !lockPresent;
  const lockClaimsThisDaemon =
    lock.runtime === "daemon" &&
    (lock.pid === pid || lock.identifier === `daemon-${pid}`);
  // A legacy daemon may also be alive in standby while Command Centre owns
  // the active in-process lock. Its exact executable and argv are proved
  // separately before any signal is sent, so preserve the foreign lock here.
  if (!lockClaimsThisDaemon) return true;
  return Boolean(
    lock.runtime === "daemon" &&
      lock.leader === true &&
      lock.identifier === `daemon-${pid}` &&
      lock.pid === pid &&
      (lock.profileKey === undefined ||
        lock.profileKey === null ||
        lock.profileKey === profileKey) &&
      (lock.startToken === undefined || lock.startToken === null),
  );
}

function parseWindowsCommandLine(commandLine) {
  if (typeof commandLine !== "string") return [];
  const args = [];
  let index = 0;

  while (index < commandLine.length) {
    while (index < commandLine.length && /[ \t]/.test(commandLine[index])) index += 1;
    if (index >= commandLine.length) break;

    let argument = "";
    let inQuotes = false;
    while (index < commandLine.length) {
      if (!inQuotes && /[ \t]/.test(commandLine[index])) break;

      let slashCount = 0;
      while (commandLine[index] === "\\") {
        slashCount += 1;
        index += 1;
      }
      if (commandLine[index] === '"') {
        argument += "\\".repeat(Math.floor(slashCount / 2));
        if (slashCount % 2 === 1) {
          argument += '"';
          index += 1;
          continue;
        }
        if (inQuotes && commandLine[index + 1] === '"') {
          argument += '"';
          index += 2;
          continue;
        }
        inQuotes = !inQuotes;
        index += 1;
        continue;
      }
      argument += "\\".repeat(slashCount);
      if (index >= commandLine.length || (!inQuotes && /[ \t]/.test(commandLine[index]))) {
        break;
      }
      argument += commandLine[index];
      index += 1;
    }
    args.push(argument);
    while (index < commandLine.length && /[ \t]/.test(commandLine[index])) index += 1;
  }
  return args;
}

function inspectProcessCommand(pid, options = {}) {
  const {
    platform = process.platform,
    fsImpl = fs,
    execFile = execFileSync,
  } = options;
  if (!Number.isInteger(pid) || pid <= 0) return null;

  if (platform === "linux") {
    try {
      const executablePath = fsImpl.readlinkSync(`/proc/${pid}/exe`);
      const argv = fsImpl
        .readFileSync(`/proc/${pid}/cmdline`)
        .toString("utf8")
        .split("\0")
        .filter((value, index, values) => value || index < values.length - 1);
      return { executablePath, argv };
    } catch {
      return null;
    }
  }

  if (platform === "win32") {
    const script =
      `$ErrorActionPreference = 'Stop'; ` +
      `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; ` +
      `if ($null -eq $p) { exit 3 }; ` +
      `[pscustomobject]@{ExecutablePath=$p.ExecutablePath;CommandLine=$p.CommandLine} ` +
      `| ConvertTo-Json -Compress`;
    try {
      const output = execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { encoding: "utf8", windowsHide: true },
      );
      const parsed = JSON.parse(output);
      if (!parsed?.ExecutablePath || !parsed?.CommandLine) return null;
      return {
        executablePath: parsed.ExecutablePath,
        argv: parseWindowsCommandLine(parsed.CommandLine),
      };
    } catch {
      return null;
    }
  }

  // There is no portable, exact argv API on the remaining supported
  // platforms. Failing closed is safer than trusting a recycled PID.
  return null;
}

function normalizeProcessPath(value, platform, fsImpl = fs) {
  if (typeof value !== "string" || !value) return null;
  let normalized = path.resolve(value);
  try {
    normalized =
      typeof fsImpl.realpathSync?.native === "function"
        ? fsImpl.realpathSync.native(normalized)
        : fsImpl.realpathSync(normalized);
  } catch {
    // A process may exit while its command is being inspected.
  }
  normalized = path.normalize(normalized);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function processCommandMatchesDaemon(processInfo, expected, options = {}) {
  const { platform = process.platform, fsImpl = fs } = options;
  if (!processInfo || !Array.isArray(processInfo.argv) || processInfo.argv.length !== 3) {
    return false;
  }
  const executablePath = normalizeProcessPath(processInfo.executablePath, platform, fsImpl);
  const argvExecutable = normalizeProcessPath(processInfo.argv[0], platform, fsImpl);
  const expectedExecutable = normalizeProcessPath(expected.execPath, platform, fsImpl);
  const scriptPath = normalizeProcessPath(processInfo.argv[1], platform, fsImpl);
  const expectedScript = normalizeProcessPath(expected.scriptPath, platform, fsImpl);
  return Boolean(
    executablePath &&
      executablePath === expectedExecutable &&
      argvExecutable === expectedExecutable &&
      scriptPath === expectedScript &&
      processInfo.argv[2] === "serve",
  );
}

function proveLegacyDaemonProcess(pid, expected, options = {}) {
  const processInfo = inspectProcessCommand(pid, options);
  if (!processCommandMatchesDaemon(processInfo, expected, options)) {
    const platform = options.platform || process.platform;
    if (platform === "darwin") {
      throw new Error(
        `PID ${pid} cannot be verified safely as the legacy cron daemon on macOS, ` +
          `so no signal was sent.\n` +
          `Inspect it first:\n  ps -p ${pid} -o pid=,ppid=,command=\n` +
          `Only if that output shows Node running cron-daemon.cjs serve, stop it with:\n` +
          `  kill -TERM ${pid}\n` +
          `Wait for it to exit, then repeat cron:start:\n` +
          `  bash scripts/start-crons.sh`,
      );
    }
    throw new Error(
      `PID ${pid} could not be verified as the legacy cron daemon process ` +
        `(${expected.execPath} ${expected.scriptPath} serve).`,
    );
  }
  return processInfo;
}

function daemonHandshakePaths(dataDir, nonce) {
  const safeNonce = String(nonce || "").replace(/[^a-zA-Z0-9-]/g, "");
  if (!safeNonce || safeNonce !== nonce) {
    throw new Error("Invalid cron daemon handshake nonce.");
  }
  return {
    requestPath: path.join(dataDir, `${HANDSHAKE_PREFIX}${safeNonce}.request.json`),
    processingPath: path.join(dataDir, `${HANDSHAKE_PREFIX}${safeNonce}.processing.json`),
    ackPath: path.join(dataDir, `${HANDSHAKE_PREFIX}${safeNonce}.ack.json`),
  };
}

function handshakePayloadMatches(payload, expected) {
  return (
    payload?.version === 1 &&
    payload?.nonce === expected.nonce &&
    payload?.pid === expected.pid &&
    payload?.profileKey === expected.profileKey &&
    payload?.startToken === expected.startToken &&
    payload?.action === expected.action
  );
}

async function requestDaemonHandshake(options) {
  const {
    dataDir,
    pid,
    profileKey,
    startToken,
    action,
    isPidAlive,
    timeoutMs = DEFAULT_HANDSHAKE_TIMEOUT_MS,
    pollIntervalMs = 25,
    nonce = randomUUID(),
    onRequestWritten = null,
    fsImpl = fs,
  } = options;
  if (!["start", "stop"].includes(action)) {
    throw new Error(`Unsupported cron daemon handshake action: ${action}`);
  }
  const expected = { nonce, pid, profileKey, startToken, action };
  const paths = daemonHandshakePaths(dataDir, nonce);
  const request = {
    version: 1,
    ...expected,
    requestedAt: new Date().toISOString(),
  };
  fsImpl.mkdirSync(dataDir, { recursive: true });

  try {
    fsImpl.writeFileSync(
      paths.requestPath,
      JSON.stringify(request),
      { encoding: "utf8", flag: "wx" },
    );
    if (typeof onRequestWritten === "function") {
      await onRequestWritten({ ...paths, request });
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!isPidAlive(pid)) {
        throw new Error(`Cron daemon PID ${pid} exited during its live handshake.`);
      }
      const ack = readJsonFile(paths.ackPath, fsImpl);
      if (
        handshakePayloadMatches(ack, expected) &&
        typeof ack.respondedAt === "string" &&
        Number.isFinite(Date.parse(ack.respondedAt))
      ) {
        return ack;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(pollIntervalMs, Math.max(1, deadline - Date.now()))),
      );
    }
    throw new Error(`Cron daemon PID ${pid} did not answer its live handshake within ${timeoutMs}ms.`);
  } finally {
    fsImpl.rmSync(paths.requestPath, { force: true });
    fsImpl.rmSync(paths.processingPath, { force: true });
    fsImpl.rmSync(paths.ackPath, { force: true });
  }
}

function startDaemonHandshakeResponder(options) {
  const {
    dataDir,
    pid,
    profileKey,
    startToken,
    isCurrentOwner,
    fallbackIntervalMs = DEFAULT_HANDSHAKE_FALLBACK_INTERVAL_MS,
    watchDebounceMs = DEFAULT_HANDSHAKE_WATCH_DEBOUNCE_MS,
    createWatcher = null,
    staleAfterMs = DEFAULT_HANDSHAKE_STALE_MS,
    beforeAckWrite = null,
    afterAckWrite = null,
    fsImpl = fs,
  } = options;
  if (!startToken) return () => {};

  let stopped = false;
  let watchHandle = null;
  let watchDebounceHandle = null;

  const scanHandshakeFiles = () => {
    if (stopped) return;
    let names = [];
    try {
      names = fsImpl.readdirSync(dataDir);
    } catch {
      return;
    }

    const nowMs = Date.now();
    for (const name of names) {
      if (
        !name.startsWith(HANDSHAKE_PREFIX) ||
        ![".request.json", ".processing.json", ".ack.json"].some((suffix) =>
          name.endsWith(suffix))
      ) {
        continue;
      }
      const filePath = path.join(dataDir, name);
      try {
        if (nowMs - fsImpl.statSync(filePath).mtimeMs > staleAfterMs) {
          fsImpl.rmSync(filePath, { force: true });
        }
      } catch {
        // Another process may consume or remove the handshake file.
      }
    }

    for (const name of names) {
      if (!name.startsWith(HANDSHAKE_PREFIX) || !name.endsWith(".request.json")) continue;
      const nonce = name.slice(HANDSHAKE_PREFIX.length, -".request.json".length);
      let paths;
      try {
        paths = daemonHandshakePaths(dataDir, nonce);
      } catch {
        continue;
      }
      const request = readJsonFile(paths.requestPath, fsImpl);
      if (
        !handshakePayloadMatches(request, {
          nonce,
          pid,
          profileKey,
          startToken,
          action: request?.action,
        }) ||
        !["start", "stop"].includes(request?.action)
      ) {
        continue;
      }
      try {
        // Claiming by rename consumes the request exactly once. Repeated polls
        // cannot rewrite the ack, and a requester crash leaves only a bounded
        // orphan that the age sweep above will remove.
        fsImpl.renameSync(paths.requestPath, paths.processingPath);
      } catch {
        continue;
      }
      const claimedRequest = readJsonFile(paths.processingPath, fsImpl);
      if (
        !handshakePayloadMatches(claimedRequest, {
          nonce,
          pid,
          profileKey,
          startToken,
          action: claimedRequest?.action,
        }) ||
        !["start", "stop"].includes(claimedRequest?.action) ||
        !isCurrentOwner()
      ) {
        fsImpl.rmSync(paths.processingPath, { force: true });
        continue;
      }
      if (typeof beforeAckWrite === "function") {
        beforeAckWrite({ ...paths, request: claimedRequest });
      }
      const stillOwnsClaim = () => {
        const currentClaim = readJsonFile(paths.processingPath, fsImpl);
        return (
          handshakePayloadMatches(currentClaim, {
            nonce,
            pid,
            profileKey,
            startToken,
            action: claimedRequest.action,
          }) &&
          currentClaim?.requestedAt === claimedRequest.requestedAt &&
          isCurrentOwner()
        );
      };
      if (!stillOwnsClaim()) continue;
      const ackContents = JSON.stringify({
        version: 1,
        nonce,
        pid,
        profileKey,
        startToken,
        action: claimedRequest.action,
        respondedAt: new Date().toISOString(),
      });
      fsImpl.writeFileSync(paths.ackPath, ackContents, "utf8");
      if (!stillOwnsClaim()) {
        removeFileIfMatchesAtomically(
          paths.ackPath,
          (contents) => contents === ackContents,
          { fsImpl },
        );
        continue;
      }
      if (typeof afterAckWrite === "function") {
        afterAckWrite({ ...paths, request: claimedRequest });
      }
      removeFileIfMatchesAtomically(
        paths.processingPath,
        (contents) => {
          try {
            const currentClaim = JSON.parse(contents);
            return (
              handshakePayloadMatches(currentClaim, {
                nonce,
                pid,
                profileKey,
                startToken,
                action: claimedRequest.action,
              }) && currentClaim?.requestedAt === claimedRequest.requestedAt
            );
          } catch {
            return false;
          }
        },
        { fsImpl },
      );
    }
  };

  const scheduleWatchScan = () => {
    if (stopped || watchDebounceHandle) return;
    watchDebounceHandle = setTimeout(() => {
      watchDebounceHandle = null;
      scanHandshakeFiles();
    }, watchDebounceMs);
  };

  const watchFactory =
    typeof createWatcher === "function"
      ? createWatcher
      : typeof fsImpl.watch === "function"
        ? (watchPath, listener) => fsImpl.watch(watchPath, listener)
        : null;
  if (watchFactory) {
    try {
      watchHandle = watchFactory(dataDir, (_eventType, fileName) => {
        if (stopped) return;
        if (fileName !== null && fileName !== undefined) {
          const normalizedName = Buffer.isBuffer(fileName)
            ? fileName.toString("utf8")
            : String(fileName);
          if (!normalizedName.startsWith(HANDSHAKE_PREFIX)) return;
        }
        scheduleWatchScan();
      });
      if (typeof watchHandle?.on === "function") {
        watchHandle.on("error", () => {
          const failedWatchHandle = watchHandle;
          watchHandle = null;
          try {
            failedWatchHandle?.close();
          } catch {
            // The periodic fallback remains active if the watcher cannot close.
          }
        });
      }
    } catch {
      // Some filesystems do not support reliable watch handles. The periodic
      // fallback below remains active for those environments.
      watchHandle = null;
    }
  }

  // Close the race between responder setup and watcher activation, then retain
  // a slow safety scan in case the platform drops a filesystem notification.
  scanHandshakeFiles();
  const fallbackHandle = setInterval(scanHandshakeFiles, fallbackIntervalMs);
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(fallbackHandle);
    if (watchDebounceHandle) {
      clearTimeout(watchDebounceHandle);
      watchDebounceHandle = null;
    }
    try {
      watchHandle?.close();
    } catch {
      // Shutdown cleanup must remain best effort.
    }
    watchHandle = null;
  };
}

async function waitForDaemonReady(options) {
  const {
    child,
    startToken,
    profileKey,
    readMarker,
    readPid = () => child?.pid,
    isProfileActive = () => true,
    isPidAlive,
    timeoutMs,
    confirmationIntervalMs = DEFAULT_CONFIRMATION_INTERVAL_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    onFirstConfirmation = null,
    now = Date.now,
  } = options;

  if (!child || typeof child.on !== "function" || typeof child.off !== "function") {
    throw new TypeError("A spawned child process is required.");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("A positive daemon startup timeout is required.");
  }

  const deadline = now() + timeoutMs;
  let spawnError = null;
  let observedExit = null;
  let wakeWaiter = null;

  const wake = () => {
    if (wakeWaiter) {
      const resolve = wakeWaiter;
      wakeWaiter = null;
      resolve();
    }
  };
  const onError = (error) => {
    spawnError = error;
    wake();
  };
  const onExit = (code, signal) => {
    observedExit = { code, signal };
    wake();
  };

  const waitForEventOrDelay = async (delayMs) => {
    if (delayMs <= 0) return;
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (wakeWaiter === finish) wakeWaiter = null;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, delayMs);
      wakeWaiter = finish;
      if (spawnError || observedExit) finish();
    });
  };

  const assertChildRunning = () => {
    if (spawnError) throw spawnError;
    const exitDetail = childExitDetail(child, observedExit);
    if (exitDetail) {
      throw new Error(`The cron daemon stopped before it became ready (${exitDetail}).`);
    }
    if (!child.pid || !isPidAlive(child.pid)) {
      throw new Error("The cron daemon stopped before it became ready.");
    }
  };

  child.on("error", onError);
  child.on("exit", onExit);

  try {
    let firstConfirmationAt = null;
    while (now() < deadline) {
      assertChildRunning();
      const marker = readMarker();
      const markerMatches = readinessMarkerMatches(marker, {
        profileKey,
        pid: child.pid,
        startToken,
      });

      if (!markerMatches) {
        firstConfirmationAt = null;
      } else {
        // This liveness check and the marker read form one readiness
        // confirmation. A second matching confirmation must occur after the
        // stability interval before startup can be reported as successful.
        assertChildRunning();
        if (!isProfileActive()) {
          throw new Error(
            `The active profile changed before cron daemon ${child.pid} became ready.`,
          );
        }
        const recordedPid = readPid();
        if (recordedPid !== child.pid) {
          throw new Error(
            `The cron daemon lost its exclusive PID ownership before it became ready ` +
              `(expected ${child.pid}, found ${recordedPid ?? "no PID"}).`,
          );
        }
        if (firstConfirmationAt === null) {
          firstConfirmationAt = now();
          if (typeof onFirstConfirmation === "function") {
            onFirstConfirmation(marker);
          }
        } else if (now() - firstConfirmationAt >= confirmationIntervalMs) {
          // Check once more immediately before returning. This catches an exit
          // event already delivered as well as a process that died before its
          // event reached the parent.
          assertChildRunning();
          if (!isProfileActive()) {
            throw new Error(
              `The active profile changed before cron daemon ${child.pid} became ready.`,
            );
          }
          const finalRecordedPid = readPid();
          if (finalRecordedPid !== child.pid) {
            throw new Error(
              `The cron daemon lost its exclusive PID ownership before it became ready ` +
                `(expected ${child.pid}, found ${finalRecordedPid ?? "no PID"}).`,
            );
          }
          return marker;
        }
      }

      const remainingMs = deadline - now();
      if (remainingMs <= 0) break;
      const confirmationRemainingMs =
        firstConfirmationAt === null
          ? pollIntervalMs
          : Math.max(1, confirmationIntervalMs - (now() - firstConfirmationAt));
      await waitForEventOrDelay(Math.min(pollIntervalMs, confirmationRemainingMs, remainingMs));
    }
    // Prefer the concrete process failure when it arrived at the timeout
    // boundary; otherwise report the timeout below.
    assertChildRunning();
  } finally {
    child.off("error", onError);
    child.off("exit", onExit);
  }

  throw new Error(`The cron daemon did not become ready within ${timeoutMs}ms.`);
}

function childHasExited(child) {
  return (
    (child?.exitCode !== null && child?.exitCode !== undefined) ||
    Boolean(child?.signalCode)
  );
}

async function waitForChildStop(child, options) {
  const {
    isPidAlive,
    timeoutMs,
    pollIntervalMs = 25,
  } = options;
  if (!child?.pid || childHasExited(child) || !isPidAlive(child.pid)) {
    return true;
  }

  let observedExit = false;
  let wakeWaiter = null;
  const onExit = () => {
    observedExit = true;
    if (wakeWaiter) wakeWaiter();
  };
  child.on("exit", onExit);
  const deadline = Date.now() + timeoutMs;

  try {
    while (Date.now() < deadline) {
      if (observedExit || childHasExited(child) || !isPidAlive(child.pid)) {
        return true;
      }
      const remainingMs = Math.max(1, deadline - Date.now());
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (wakeWaiter === finish) wakeWaiter = null;
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(finish, Math.min(pollIntervalMs, remainingMs));
        wakeWaiter = finish;
        if (observedExit) finish();
      });
    }
    return observedExit || childHasExited(child) || !isPidAlive(child.pid);
  } finally {
    child.off("exit", onExit);
  }
}

async function terminateStartedChild(child, options) {
  const {
    isPidAlive,
    graceMs = DEFAULT_TERMINATION_GRACE_MS,
    deadlineAt = Number.POSITIVE_INFINITY,
  } = options;
  if (!child?.pid || childHasExited(child) || !isPidAlive(child.pid)) {
    return { forced: false, stopped: true };
  }

  // Keep a listener installed while signalling so a late ChildProcess error
  // cannot become an uncaught event in the startup command.
  const ignoreSignalError = () => {};
  const remainingMs = () =>
    Number.isFinite(deadlineAt)
      ? Math.max(0, deadlineAt - Date.now())
      : graceMs;
  const boundedGraceMs = () => Math.min(graceMs, remainingMs());
  child.on("error", ignoreSignalError);
  try {
    try {
      child.kill("SIGTERM");
    } catch {
      // The child may have stopped between the liveness check and the signal.
    }
    if (await waitForChildStop(child, { isPidAlive, timeoutMs: boundedGraceMs() })) {
      return { forced: false, stopped: true };
    }

    try {
      child.kill("SIGKILL");
    } catch {
      // The child may have stopped immediately before the forced signal.
    }
    const stopped = await waitForChildStop(child, {
      isPidAlive,
      timeoutMs: boundedGraceMs(),
    });
    return { forced: true, stopped };
  } finally {
    child.off("error", ignoreSignalError);
  }
}

async function settleFailedStartedChild(options) {
  const {
    child,
    isPidAlive,
    artifactOptions,
    deadlineAt = Number.POSITIVE_INFINITY,
    terminateChild = terminateStartedChild,
    removeArtifacts = removeOwnedStartupArtifacts,
  } = options;
  if (!child) {
    return { stopped: true, forced: false, terminationError: null };
  }

  let termination = null;
  let terminationError = null;
  try {
    termination = await terminateChild(child, { isPidAlive, deadlineAt });
  } catch (error) {
    terminationError = error;
  }
  const stopped =
    termination?.stopped === true ||
    !child.pid ||
    !isPidAlive(child.pid);
  if (stopped) {
    removeArtifacts({
      ...artifactOptions,
      pid: child.pid,
      isPidAlive,
    });
  }
  if (typeof child.unref === "function") child.unref();
  return {
    stopped,
    forced: termination?.forced === true,
    terminationError,
  };
}

function buildFailedStartError(options) {
  const {
    startupError,
    child,
    cleanup,
    logTail = "",
  } = options;
  const detail =
    startupError instanceof Error ? startupError.message : String(startupError);
  if (cleanup && !cleanup.stopped) {
    const terminationDetail = cleanup.terminationError
      ? ` Cleanup also failed: ${
          cleanup.terminationError instanceof Error
            ? cleanup.terminationError.message
            : String(cleanup.terminationError)
        }.`
      : "";
    return new Error(
      `Failed to start the managed cron daemon: ${detail}\n` +
        `The started child PID ${child?.pid || "unknown"} is still running after cleanup attempts.` +
        terminationDetail +
        " Its PID, readiness marker, and runtime lock were preserved for safe recovery.",
    );
  }
  return new Error(
    `Failed to start the managed cron daemon: ${detail}` +
      (logTail ? `\nRecent daemon log:\n${logTail}` : ""),
  );
}

async function waitForPidStop(pid, options) {
  const {
    isPidAlive,
    timeoutMs,
    pollIntervalMs = 25,
  } = options;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(pollIntervalMs, Math.max(1, deadline - Date.now()))),
    );
  }
  return !isPidAlive(pid);
}

async function stopVerifiedDaemon(options) {
  const {
    pid,
    expectedOwner,
    inspectOwnership,
    isPidAlive,
    signalProcess,
    proveLiveness,
    graceMs = DEFAULT_TERMINATION_GRACE_MS,
    waitForExit = (targetPid, timeoutMs) =>
      waitForPidStop(targetPid, { isPidAlive, timeoutMs }),
  } = options;
  if (typeof proveLiveness !== "function") {
    throw new TypeError("A live cron daemon handshake is required before stopping.");
  }
  if (!expectedOwner || typeof expectedOwner !== "object") {
    throw new TypeError("The expected cron daemon owner is required before stopping.");
  }

  const assertSameLiveDaemon = () => {
    const current = inspectOwnership();
    let sameOwner =
      current?.pid !== pid ||
      current?.recordedPid !== pid ||
      current?.owned !== true ||
      current?.alive !== true ||
      !isPidAlive(pid)
        ? false
        : true;
    if (sameOwner && expectedOwner.legacy === true) {
      sameOwner =
        expectedOwner.markerPresent === true
          ? isLegacyReadinessMarker(current.marker, {
              pid,
              profileKey: expectedOwner.profileKey,
            })
          : current.markerPresent === false &&
            (current.marker === null || current.marker === undefined);
    } else if (sameOwner) {
      sameOwner =
        readinessMarkerMatches(current.marker, {
          pid,
          profileKey: expectedOwner.profileKey,
          startToken: expectedOwner.startToken,
        }) &&
        current.marker.startToken === expectedOwner.startToken;
    }
    if (!sameOwner) {
      throw new Error(
        `Daemon ownership changed while waiting to stop PID ${pid}; no forced signal was sent.`,
      );
    }
  };

  assertSameLiveDaemon();
  await proveLiveness("SIGTERM");
  assertSameLiveDaemon();
  let termError = null;
  try {
    if (signalProcess(pid, "SIGTERM") === false) {
      termError = new Error("SIGTERM was not accepted");
    }
  } catch (error) {
    termError = error;
  }
  if (termError) {
    if (!isPidAlive(pid)) return { forced: false };
    throw new Error(
      `Failed to stop cron daemon PID ${pid} with SIGTERM while it is still running: ` +
        `${termError instanceof Error ? termError.message : String(termError)}`,
    );
  }

  await waitForExit(pid, graceMs);
  if (!isPidAlive(pid)) {
    return { forced: false };
  }

  // The PID may have been reused or its files may have been replaced while
  // waiting. Never send a forceful signal until all ownership proof matches
  // again.
  assertSameLiveDaemon();
  await proveLiveness("SIGKILL");
  assertSameLiveDaemon();
  let killError = null;
  try {
    if (signalProcess(pid, "SIGKILL") === false) {
      killError = new Error("SIGKILL was not accepted");
    }
  } catch (error) {
    killError = error;
  }
  if (killError) {
    if (!isPidAlive(pid)) return { forced: true };
    throw new Error(
      `Failed to force-stop cron daemon PID ${pid} while it is still running: ` +
        `${killError instanceof Error ? killError.message : String(killError)}`,
    );
  }

  await waitForExit(pid, graceMs);
  if (isPidAlive(pid)) {
    throw new Error(`Cron daemon PID ${pid} is still running after SIGKILL.`);
  }
  return { forced: true };
}

function readJsonFile(filePath, fsImpl = fs) {
  try {
    return JSON.parse(fsImpl.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readPidFile(filePath, fsImpl = fs) {
  try {
    const pid = Number.parseInt(fsImpl.readFileSync(filePath, "utf8").trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function removeOwnedStartupArtifacts(options) {
  const {
    pid,
    startToken,
    profileKey,
    markerPath,
    pidPath,
    lockPath,
    isPidAlive,
    fsImpl = fs,
  } = options;
  if (!pid) return;
  const childIsStopped = () =>
    typeof isPidAlive !== "function" || !isPidAlive(pid);
  const childStopped = childIsStopped();

  removeFileIfMatchesAtomically(
    markerPath,
    (contents) => {
      let marker;
      try {
        marker = JSON.parse(contents);
      } catch {
        return false;
      }
      return (
        marker?.pid === pid &&
        marker?.profileKey === profileKey &&
        marker?.startToken === startToken
      );
    },
    { fsImpl },
  );

  if (childStopped) {
    removeFileIfMatchesAtomically(
      pidPath,
      (contents) =>
        childIsStopped() &&
        Number.parseInt(String(contents).trim(), 10) === pid,
      { fsImpl },
    );
  }

  if (childStopped) {
    removeFileIfMatchesAtomically(
      lockPath,
      (contents) => {
        let lock;
        try {
          lock = JSON.parse(contents);
        } catch {
          return false;
        }
        return (
          childIsStopped() &&
          lock?.pid === pid &&
          lock?.identifier === `daemon-${pid}` &&
          lock.profileKey === profileKey &&
          lock.startToken === startToken
        );
      },
      { fsImpl },
    );
  }
}

function removeOwnedLegacyArtifacts(options) {
  const {
    pid,
    profileKey,
    markerPath,
    pidPath,
    lockPath,
    isPidAlive,
    fsImpl = fs,
  } = options;
  const childIsStopped = () =>
    typeof isPidAlive !== "function" || !isPidAlive(pid);
  if (!pid || !childIsStopped()) return false;

  removeFileIfMatchesAtomically(
    markerPath,
    (contents) => {
      try {
        return isLegacyReadinessMarker(JSON.parse(contents), { pid, profileKey });
      } catch {
        return false;
      }
    },
    { fsImpl },
  );
  removeFileIfMatchesAtomically(
    pidPath,
    (contents) =>
      childIsStopped() &&
      Number.parseInt(String(contents).trim(), 10) === pid,
    { fsImpl },
  );
  removeFileIfMatchesAtomically(
    lockPath,
    (contents) => {
      let lock;
      try {
        lock = JSON.parse(contents);
      } catch {
        return false;
      }
      return Boolean(
        childIsStopped() &&
          lock?.runtime === "daemon" &&
          lock.leader === true &&
          lock.identifier === `daemon-${pid}` &&
          lock.pid === pid &&
          (lock.profileKey === undefined ||
            lock.profileKey === null ||
            lock.profileKey === profileKey) &&
          (lock.startToken === undefined || lock.startToken === null),
      );
    },
    { fsImpl },
  );
  return true;
}

function spawnWithLogFile(options) {
  const {
    logPath,
    command,
    args,
    spawnProcess,
    spawnOptions,
    fsImpl = fs,
  } = options;
  const logFd = fsImpl.openSync(logPath, "a");
  try {
    return spawnProcess(command, args, {
      ...spawnOptions,
      stdio: ["ignore", logFd, logFd],
    });
  } finally {
    fsImpl.closeSync(logFd);
  }
}

module.exports = {
  DEFAULT_CONFIRMATION_INTERVAL_MS,
  DEFAULT_TERMINATION_GRACE_MS,
  DEFAULT_HANDSHAKE_TIMEOUT_MS,
  DEFAULT_HANDSHAKE_STALE_MS,
  DEFAULT_HANDSHAKE_FALLBACK_INTERVAL_MS,
  DEFAULT_HANDSHAKE_WATCH_DEBOUNCE_MS,
  readinessMarkerMatches,
  hasValidExistingDaemonOwnership,
  isLegacyReadinessMarker,
  hasCompatibleLegacyDaemonOwnership,
  parseWindowsCommandLine,
  inspectProcessCommand,
  processCommandMatchesDaemon,
  proveLegacyDaemonProcess,
  daemonHandshakePaths,
  requestDaemonHandshake,
  startDaemonHandshakeResponder,
  waitForDaemonReady,
  terminateStartedChild,
  settleFailedStartedChild,
  buildFailedStartError,
  stopVerifiedDaemon,
  removeOwnedStartupArtifacts,
  removeOwnedLegacyArtifacts,
  spawnWithLogFile,
};

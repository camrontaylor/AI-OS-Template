"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const startup = require("./cron-daemon-startup.cjs");
const {
  removeFileIfMatchesAtomically,
  replaceFileIfMatchesAtomically,
} = require("../src/lib/owned-file.cjs");

class FakeChild extends EventEmitter {
  constructor(pid = 4242) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.signalCode = null;
    this.signals = [];
    this.onKill = null;
    this.unrefCalled = false;
  }

  kill(signal) {
    this.signals.push(signal);
    if (this.onKill) this.onKill(signal);
    return true;
  }

  unref() {
    this.unrefCalled = true;
  }
}

function readyMarker(child, overrides = {}) {
  return {
    version: 1,
    profileKey: "solo",
    pid: child.pid,
    startToken: "start-token",
    readyAt: new Date().toISOString(),
    ...overrides,
  };
}

async function waitForCondition(predicate, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

function createManualWatcher() {
  let listener = null;
  let errorListener = null;
  let closed = false;
  return {
    create(_watchPath, nextListener) {
      listener = nextListener;
      return {
        on(eventName, nextErrorListener) {
          if (eventName === "error") errorListener = nextErrorListener;
          return this;
        },
        close() {
          closed = true;
        },
      };
    },
    emit(fileName) {
      if (!closed && listener) listener("rename", fileName);
    },
    fail() {
      if (!closed && errorListener) errorListener(new Error("watch failed"));
    },
    get closed() {
      return closed;
    },
  };
}

test("hasValidExistingDaemonOwnership requires marker and PID while preserving foreign locks", () => {
  const child = new FakeChild();
  const marker = readyMarker(child);
  const base = {
    pid: child.pid,
    recordedPid: child.pid,
    marker,
    profileKey: "solo",
    isLockStale: () => false,
  };

  assert.equal(
    startup.hasValidExistingDaemonOwnership({ ...base, lock: null }),
    true,
  );
  assert.equal(
    startup.hasValidExistingDaemonOwnership({
      ...base,
      lock: null,
      lockPresent: true,
    }),
    false,
  );
  assert.equal(
    startup.hasValidExistingDaemonOwnership({
      ...base,
      marker: { ...marker, profileKey: "foreign-profile" },
      lock: null,
    }),
    false,
  );
  assert.equal(
    startup.hasValidExistingDaemonOwnership({
      ...base,
      lock: {
        runtime: "in-process",
        leader: true,
        identifier: "in-process-foreign",
        pid: 9001,
      },
    }),
    true,
  );
  assert.equal(
    startup.hasValidExistingDaemonOwnership({
      ...base,
      lock: {
        runtime: "daemon",
        leader: true,
        identifier: `daemon-${child.pid}`,
        pid: child.pid,
        profileKey: "solo",
        startToken: marker.startToken,
      },
    }),
    true,
  );
  assert.equal(
    startup.hasValidExistingDaemonOwnership({
      ...base,
      lock: {
        runtime: "daemon",
        leader: true,
        identifier: `daemon-${child.pid}`,
        pid: child.pid,
      },
      isLockStale: () => true,
    }),
    false,
  );
  assert.equal(
    startup.hasValidExistingDaemonOwnership({
      ...base,
      lock: {
        runtime: "daemon",
        leader: true,
        identifier: `daemon-${child.pid}`,
        pid: child.pid,
        profileKey: "solo",
        startToken: marker.startToken,
      },
      isLockStale: () => true,
      allowStaleLock: true,
    }),
    true,
  );
});

test("legacy ownership accepts known states and preserves a foreign standby lock", () => {
  const pid = 4242;
  const base = {
    pid,
    recordedPid: pid,
    profileKey: "solo",
    lock: null,
  };
  assert.equal(
    startup.hasCompatibleLegacyDaemonOwnership({
      ...base,
      marker: null,
      markerPresent: false,
      allowMarkerless: true,
    }),
    true,
  );
  assert.equal(
    startup.hasCompatibleLegacyDaemonOwnership({
      ...base,
      marker: null,
      markerPresent: false,
      allowMarkerless: true,
      lock: null,
      lockPresent: true,
    }),
    false,
  );
  assert.equal(
    startup.hasCompatibleLegacyDaemonOwnership({
      ...base,
      marker: null,
      markerPresent: true,
      allowMarkerless: true,
    }),
    false,
  );
  assert.equal(
    startup.hasCompatibleLegacyDaemonOwnership({
      ...base,
      marker: { version: 1, profileKey: "solo", pid },
      markerPresent: true,
    }),
    true,
  );
  assert.equal(
    startup.hasCompatibleLegacyDaemonOwnership({
      ...base,
      marker: { version: 1, profileKey: "foreign", pid },
      markerPresent: true,
      allowMarkerless: true,
    }),
    false,
  );
  assert.equal(
    startup.hasCompatibleLegacyDaemonOwnership({
      ...base,
      marker: null,
      markerPresent: false,
      allowMarkerless: true,
      lock: {
        runtime: "in-process",
        leader: true,
        identifier: "foreign",
        pid: 9001,
      },
    }),
    true,
  );
  assert.equal(
    startup.hasCompatibleLegacyDaemonOwnership({
      ...base,
      marker: { version: 1, profileKey: "solo", pid },
      markerPresent: true,
      lock: {
        runtime: "in-process",
        leader: true,
        identifier: "foreign",
        pid: 9001,
      },
    }),
    true,
  );
});

test("legacy process proof requires the exact executable, script, and serve argv", () => {
  const expected = {
    execPath: process.execPath,
    scriptPath: path.resolve(__dirname, "cron-daemon.cjs"),
  };
  const exact = {
    executablePath: process.execPath,
    argv: [process.execPath, expected.scriptPath, "serve"],
  };
  assert.equal(startup.processCommandMatchesDaemon(exact, expected), true);
  assert.equal(
    startup.processCommandMatchesDaemon(
      { ...exact, argv: [process.execPath, expected.scriptPath, "status"] },
      expected,
    ),
    false,
  );
  assert.equal(
    startup.processCommandMatchesDaemon(
      { ...exact, argv: [process.execPath, path.resolve(__dirname, "other.cjs"), "serve"] },
      expected,
    ),
    false,
  );
  assert.deepEqual(
    startup.parseWindowsCommandLine(
      '"C:\\Program Files\\nodejs\\node.exe" "C:\\AI-OS\\cron-daemon.cjs" serve',
    ),
    [
      "C:\\Program Files\\nodejs\\node.exe",
      "C:\\AI-OS\\cron-daemon.cjs",
      "serve",
    ],
  );
});

test("legacy process proof fails closed with actionable macOS recovery instructions", () => {
  const pid = 43210;
  const expected = {
    execPath: process.execPath,
    scriptPath: path.resolve(__dirname, "cron-daemon.cjs"),
  };
  const execFile = () => {
    throw new Error("must not inspect a legacy daemon through a lossy shell command");
  };

  assert.equal(
    startup.inspectProcessCommand(pid, { platform: "darwin", execFile }),
    null,
  );
  assert.throws(
    () =>
      startup.proveLegacyDaemonProcess(pid, expected, {
        platform: "darwin",
        execFile,
      }),
    (error) => {
      assert.match(error.message, /PID 43210/);
      assert.match(error.message, /no signal was sent/);
      assert.match(error.message, /ps -p 43210 -o pid=,ppid=,command=/);
      assert.match(error.message, /kill -TERM 43210/);
      assert.match(error.message, /repeat cron:start/);
      assert.match(error.message, /bash scripts\/start-crons\.sh/);
      return true;
    },
  );
});

test("atomic conditional removal never deletes a replacement owner", async (t) => {
  await t.test("matching claim is removed while a later canonical replacement survives", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cron-owned-remove-"));
    const filePath = path.join(root, "owner.json");
    const own = JSON.stringify({ owner: "own" });
    const replacement = JSON.stringify({ owner: "replacement" });
    try {
      fs.writeFileSync(filePath, own, "utf8");
      assert.equal(
        removeFileIfMatchesAtomically(
          filePath,
          (contents) => contents === own,
          {
            claimToken: "matching-replacement",
            afterClaim: () => fs.writeFileSync(filePath, replacement, "utf8"),
          },
        ),
        true,
      );
      assert.equal(fs.readFileSync(filePath, "utf8"), replacement);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("a file replaced before the atomic claim is restored without overwrite", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cron-owned-restore-"));
    const filePath = path.join(root, "owner.json");
    const own = JSON.stringify({ owner: "own" });
    const foreign = JSON.stringify({ owner: "foreign" });
    try {
      fs.writeFileSync(filePath, own, "utf8");
      assert.equal(
        removeFileIfMatchesAtomically(
          filePath,
          (contents) => contents === own,
          {
            claimToken: "restore-mismatch",
            beforeClaim: () => fs.writeFileSync(filePath, foreign, "utf8"),
          },
        ),
        false,
      );
      assert.equal(fs.readFileSync(filePath, "utf8"), foreign);
      assert.deepEqual(fs.readdirSync(root), ["owner.json"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("a newer winner and the unmatched isolated entry are both preserved", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cron-owned-winner-"));
    const filePath = path.join(root, "owner.json");
    const own = JSON.stringify({ owner: "own" });
    const foreign = JSON.stringify({ owner: "foreign" });
    const winner = JSON.stringify({ owner: "winner" });
    try {
      fs.writeFileSync(filePath, own, "utf8");
      assert.throws(
        () =>
          removeFileIfMatchesAtomically(
            filePath,
            (contents) => contents === own,
            {
              claimToken: "winner-mismatch",
              beforeClaim: () => fs.writeFileSync(filePath, foreign, "utf8"),
              afterClaim: () => fs.writeFileSync(filePath, winner, "utf8"),
            },
          ),
        /recoverable copy remains/,
      );
      assert.equal(fs.readFileSync(filePath, "utf8"), winner);
      const isolated = fs
        .readdirSync(root)
        .find((name) => name.endsWith(".claim"));
      assert.ok(isolated);
      assert.equal(fs.readFileSync(path.join(root, isolated), "utf8"), foreign);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("restore failure leaves the isolated entry recoverable", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cron-owned-fail-"));
    const filePath = path.join(root, "owner.json");
    const own = JSON.stringify({ owner: "own" });
    const foreign = JSON.stringify({ owner: "foreign" });
    const failingFs = Object.create(fs);
    failingFs.linkSync = () => {
      const error = new Error("links unavailable");
      error.code = "EPERM";
      throw error;
    };
    failingFs.copyFileSync = () => {
      const error = new Error("copy unavailable");
      error.code = "EPERM";
      throw error;
    };
    try {
      fs.writeFileSync(filePath, own, "utf8");
      assert.throws(
        () =>
          removeFileIfMatchesAtomically(
            filePath,
            (contents) => contents === own,
            {
              fsImpl: failingFs,
              claimToken: "failed-restore",
              beforeClaim: () => fs.writeFileSync(filePath, foreign, "utf8"),
            },
          ),
        /recoverable copy remains/,
      );
      assert.equal(fs.existsSync(filePath), false);
      const isolated = fs
        .readdirSync(root)
        .find((name) => name.endsWith(".claim"));
      assert.ok(isolated);
      assert.equal(fs.readFileSync(path.join(root, isolated), "utf8"), foreign);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

test("atomic conditional replacement restores old state on write or publish failure", async (t) => {
  await t.test("a foreign canonical winner is preserved without an orphaned claim", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cron-replace-winner-"));
    const filePath = path.join(root, "owner.json");
    const own = JSON.stringify({ owner: "own" });
    const foreign = JSON.stringify({ owner: "foreign" });
    try {
      fs.writeFileSync(filePath, own, "utf8");
      assert.equal(
        replaceFileIfMatchesAtomically(
          filePath,
          (contents) => contents === own,
          () => JSON.stringify({ owner: "updated" }),
          {
            claimToken: "foreign-winner",
            tempToken: "foreign-winner",
            afterClaim: () => fs.writeFileSync(filePath, foreign, "utf8"),
          },
        ),
        false,
      );
      assert.equal(fs.readFileSync(filePath, "utf8"), foreign);
      assert.deepEqual(fs.readdirSync(root), ["owner.json"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("replacement write failure restores the canonical file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cron-replace-write-"));
    const filePath = path.join(root, "owner.json");
    const own = JSON.stringify({ owner: "own" });
    const failingFs = Object.create(fs);
    failingFs.writeFileSync = (target, ...args) => {
      if (String(target).includes(".replacement-")) {
        throw new Error("replacement write failed");
      }
      return fs.writeFileSync(target, ...args);
    };
    try {
      fs.writeFileSync(filePath, own, "utf8");
      assert.throws(
        () =>
          replaceFileIfMatchesAtomically(
            filePath,
            (contents) => contents === own,
            () => JSON.stringify({ owner: "updated" }),
            {
              fsImpl: failingFs,
              claimToken: "write-failure",
              tempToken: "write-failure",
            },
          ),
        /replacement write failed/,
      );
      assert.equal(fs.readFileSync(filePath, "utf8"), own);
      assert.deepEqual(fs.readdirSync(root), ["owner.json"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("publish and restore failure retains the recoverable claim", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cron-replace-publish-"));
    const filePath = path.join(root, "owner.json");
    const own = JSON.stringify({ owner: "own" });
    const failingFs = Object.create(fs);
    failingFs.linkSync = () => {
      const error = new Error("links unavailable");
      error.code = "EPERM";
      throw error;
    };
    failingFs.copyFileSync = () => {
      const error = new Error("copy unavailable");
      error.code = "EPERM";
      throw error;
    };
    try {
      fs.writeFileSync(filePath, own, "utf8");
      assert.throws(
        () =>
          replaceFileIfMatchesAtomically(
            filePath,
            (contents) => contents === own,
            () => JSON.stringify({ owner: "updated" }),
            {
              fsImpl: failingFs,
              claimToken: "publish-failure",
              tempToken: "publish-failure",
            },
          ),
        /recoverable copy remains/,
      );
      assert.equal(fs.existsSync(filePath), false);
      const isolated = fs
        .readdirSync(root)
        .find((name) => name.endsWith(".claim"));
      assert.ok(isolated);
      assert.equal(fs.readFileSync(path.join(root, isolated), "utf8"), own);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

test("requestDaemonHandshake accepts only the exact live response and cleans its files", async (t) => {
  await t.test("matching response", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cron-handshake-match-"));
    const nonce = "11111111-1111-4111-8111-111111111111";
    try {
      const ack = await startup.requestDaemonHandshake({
        dataDir: root,
        pid: 4242,
        profileKey: "solo",
        startToken: "start-token",
        action: "start",
        nonce,
        isPidAlive: () => true,
        timeoutMs: 100,
        pollIntervalMs: 5,
        onRequestWritten: ({ ackPath, request }) => {
          fs.writeFileSync(
            ackPath,
            JSON.stringify({
              ...request,
              respondedAt: new Date().toISOString(),
            }),
            "utf8",
          );
        },
      });
      assert.equal(ack.nonce, nonce);
      assert.deepEqual(fs.readdirSync(root), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("wrong response", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cron-handshake-wrong-"));
    const nonce = "22222222-2222-4222-8222-222222222222";
    try {
      await assert.rejects(
        startup.requestDaemonHandshake({
          dataDir: root,
          pid: 4242,
          profileKey: "solo",
          startToken: "start-token",
          action: "stop",
          nonce,
          isPidAlive: () => true,
          timeoutMs: 20,
          pollIntervalMs: 5,
          onRequestWritten: ({ ackPath, request }) => {
            fs.writeFileSync(
              ackPath,
              JSON.stringify({
                ...request,
                pid: 9001,
                respondedAt: new Date().toISOString(),
              }),
              "utf8",
            );
          },
        }),
        /did not answer its live handshake within 20ms/,
      );
      assert.deepEqual(fs.readdirSync(root), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("late responder does not leave an orphaned ack", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cron-handshake-late-"));
    const nonce = "33333333-3333-4333-8333-333333333333";
    const paths = startup.daemonHandshakePaths(root, nonce);
    let stopResponder = null;
    try {
      stopResponder = startup.startDaemonHandshakeResponder({
        dataDir: root,
        pid: 4242,
        profileKey: "solo",
        startToken: "start-token",
        isCurrentOwner: () => true,
        fallbackIntervalMs: 1,
        staleAfterMs: 5,
        beforeAckWrite: () => fs.rmSync(paths.processingPath, { force: true }),
      });
      fs.writeFileSync(
        paths.requestPath,
        JSON.stringify({
          version: 1,
          nonce,
          pid: 4242,
          profileKey: "solo",
          startToken: "start-token",
          action: "start",
          requestedAt: new Date().toISOString(),
        }),
        "utf8",
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(fs.existsSync(paths.requestPath), false);
      assert.equal(fs.existsSync(paths.ackPath), false);
    } finally {
      if (stopResponder) stopResponder();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("responder consumes a request and writes its ack only once", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cron-handshake-once-"));
    const nonce = "44444444-4444-4444-8444-444444444444";
    const paths = startup.daemonHandshakePaths(root, nonce);
    let responses = 0;
    let stopResponder = null;
    try {
      stopResponder = startup.startDaemonHandshakeResponder({
        dataDir: root,
        pid: 4242,
        profileKey: "solo",
        startToken: "start-token",
        isCurrentOwner: () => true,
        fallbackIntervalMs: 1,
        staleAfterMs: 1_000,
        afterAckWrite: () => {
          responses += 1;
        },
      });
      fs.writeFileSync(
        paths.requestPath,
        JSON.stringify({
          version: 1,
          nonce,
          pid: 4242,
          profileKey: "solo",
          startToken: "start-token",
          action: "start",
          requestedAt: new Date().toISOString(),
        }),
        "utf8",
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(responses, 1);
      assert.equal(fs.existsSync(paths.requestPath), false);
      assert.equal(fs.existsSync(paths.processingPath), false);
      assert.equal(fs.existsSync(paths.ackPath), true);
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(responses, 1);
    } finally {
      if (stopResponder) stopResponder();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("responder removes abandoned handshake files by age", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cron-handshake-stale-"));
    const requestPaths = startup.daemonHandshakePaths(
      root,
      "55555555-5555-4555-8555-555555555555",
    );
    const ackPaths = startup.daemonHandshakePaths(
      root,
      "66666666-6666-4666-8666-666666666666",
    );
    const processingPaths = startup.daemonHandshakePaths(
      root,
      "77777777-7777-4777-8777-777777777777",
    );
    let stopResponder = null;
    try {
      fs.writeFileSync(requestPaths.requestPath, "{}", "utf8");
      fs.writeFileSync(ackPaths.ackPath, "{}", "utf8");
      fs.writeFileSync(processingPaths.processingPath, "{}", "utf8");
      const old = new Date(Date.now() - 10_000);
      for (const filePath of [
        requestPaths.requestPath,
        ackPaths.ackPath,
        processingPaths.processingPath,
      ]) {
        fs.utimesSync(filePath, old, old);
      }
      stopResponder = startup.startDaemonHandshakeResponder({
        dataDir: root,
        pid: 4242,
        profileKey: "solo",
        startToken: "start-token",
        isCurrentOwner: () => true,
        fallbackIntervalMs: 1,
        staleAfterMs: 5,
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.deepEqual(fs.readdirSync(root), []);
    } finally {
      if (stopResponder) stopResponder();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

test("daemon handshake responder is event-driven with a bounded fallback", async (t) => {
  await t.test("watch events are filtered, debounced, and stopped cleanly", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cron-handshake-watch-"));
    const watcher = createManualWatcher();
    const nonce = "88888888-8888-4888-8888-888888888888";
    const paths = startup.daemonHandshakePaths(root, nonce);
    let directoryScans = 0;
    let stopResponder = null;
    const countingFs = {
      ...fs,
      readdirSync(...args) {
        directoryScans += 1;
        return fs.readdirSync(...args);
      },
    };
    try {
      stopResponder = startup.startDaemonHandshakeResponder({
        dataDir: root,
        pid: 4242,
        profileKey: "solo",
        startToken: "start-token",
        isCurrentOwner: () => true,
        fallbackIntervalMs: 500,
        watchDebounceMs: 1,
        createWatcher: watcher.create,
        fsImpl: countingFs,
      });

      assert.equal(directoryScans, 1, "responder should perform one initial safety scan");
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(directoryScans, 1, "idle responder must not retain the old 25ms polling");

      watcher.emit("data.db-wal");
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(directoryScans, 1, "unrelated filesystem events must be ignored");

      fs.writeFileSync(
        paths.requestPath,
        JSON.stringify({
          version: 1,
          nonce,
          pid: 4242,
          profileKey: "solo",
          startToken: "start-token",
          action: "start",
          requestedAt: new Date().toISOString(),
        }),
        "utf8",
      );
      watcher.emit(path.basename(paths.requestPath));
      watcher.emit(path.basename(paths.requestPath));
      await waitForCondition(() => fs.existsSync(paths.ackPath));
      assert.equal(directoryScans, 2, "nearby handshake events should share one scan");

      stopResponder();
      assert.equal(watcher.closed, true);
      const stoppedNonce = "99999999-9999-4999-8999-999999999999";
      const stoppedPaths = startup.daemonHandshakePaths(root, stoppedNonce);
      fs.writeFileSync(
        stoppedPaths.requestPath,
        JSON.stringify({
          version: 1,
          nonce: stoppedNonce,
          pid: 4242,
          profileKey: "solo",
          startToken: "start-token",
          action: "stop",
          requestedAt: new Date().toISOString(),
        }),
        "utf8",
      );
      watcher.emit(path.basename(stoppedPaths.requestPath));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(fs.existsSync(stoppedPaths.ackPath), false);
      assert.equal(directoryScans, 2, "stopped responder must not scan again");
    } finally {
      if (stopResponder) stopResponder();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("fallback handles a missed or unavailable watcher", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cron-handshake-fallback-"));
    const watcher = createManualWatcher();
    const nonce = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const paths = startup.daemonHandshakePaths(root, nonce);
    let stopResponder = null;
    try {
      stopResponder = startup.startDaemonHandshakeResponder({
        dataDir: root,
        pid: 4242,
        profileKey: "solo",
        startToken: "start-token",
        isCurrentOwner: () => true,
        fallbackIntervalMs: 10,
        createWatcher: watcher.create,
      });
      watcher.fail();
      assert.equal(watcher.closed, true);
      fs.writeFileSync(
        paths.requestPath,
        JSON.stringify({
          version: 1,
          nonce,
          pid: 4242,
          profileKey: "solo",
          startToken: "start-token",
          action: "stop",
          requestedAt: new Date().toISOString(),
        }),
        "utf8",
      );
      await waitForCondition(() => fs.existsSync(paths.ackPath));
    } finally {
      if (stopResponder) stopResponder();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

test("stopVerifiedDaemon confirms death and re-proves ownership before KILL", async (t) => {
  const expectedOwner = {
    profileKey: "solo",
    startToken: "start-token",
  };
  const ownedState = (overrides = {}) => ({
    pid: 4242,
    recordedPid: 4242,
    owned: true,
    alive: true,
    marker: {
      version: 1,
      pid: 4242,
      profileKey: "solo",
      startToken: "start-token",
      readyAt: new Date().toISOString(),
    },
    ...overrides,
  });

  await t.test("TERM ignored, KILL succeeds", async () => {
    let alive = true;
    let state = ownedState();
    const signals = [];
    let proofs = 0;
    const result = await startup.stopVerifiedDaemon({
      pid: 4242,
      expectedOwner,
      inspectOwnership: () => state,
      isPidAlive: () => alive,
      signalProcess: (_pid, signal) => {
        signals.push(signal);
        if (signal === "SIGKILL") {
          alive = false;
          state = { ...state, alive: false };
        }
        return true;
      },
      proveLiveness: async () => {
        proofs += 1;
      },
      waitForExit: async () => !alive,
    });
    assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
    assert.equal(proofs, 2);
    assert.deepEqual(result, { forced: true });
  });

  await t.test("TERM signal fails while process survives", async () => {
    await assert.rejects(
      startup.stopVerifiedDaemon({
        pid: 4242,
        expectedOwner,
        inspectOwnership: () => ownedState(),
        isPidAlive: () => true,
        signalProcess: () => {
          throw new Error("access denied");
        },
        proveLiveness: async () => {},
        waitForExit: async () => false,
      }),
      /Failed to stop cron daemon PID 4242 with SIGTERM.*access denied/,
    );
  });

  await t.test("ownership changes before KILL", async () => {
    let state = ownedState();
    const signals = [];
    let proofs = 0;
    await assert.rejects(
      startup.stopVerifiedDaemon({
        pid: 4242,
        expectedOwner,
        inspectOwnership: () => state,
        isPidAlive: () => true,
        signalProcess: (_pid, signal) => {
          signals.push(signal);
          return true;
        },
        proveLiveness: async () => {
          proofs += 1;
        },
        waitForExit: async () => {
          state = ownedState({
            marker: {
              ...ownedState().marker,
              startToken: "replacement-token",
            },
          });
          return false;
        },
      }),
      /ownership changed.*no forced signal was sent/i,
    );
    assert.deepEqual(signals, ["SIGTERM"]);
    assert.equal(proofs, 1);
  });

  await t.test("process survives KILL", async () => {
    const signals = [];
    await assert.rejects(
      startup.stopVerifiedDaemon({
        pid: 4242,
        expectedOwner,
        inspectOwnership: () => ownedState(),
        isPidAlive: () => true,
        signalProcess: (_pid, signal) => {
          signals.push(signal);
          return true;
        },
        proveLiveness: async () => {},
        waitForExit: async () => false,
      }),
      /still running after SIGKILL/,
    );
    assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  });

  await t.test("KILL signal fails while process survives", async () => {
    const signals = [];
    await assert.rejects(
      startup.stopVerifiedDaemon({
        pid: 4242,
        expectedOwner,
        inspectOwnership: () => ownedState(),
        isPidAlive: () => true,
        signalProcess: (_pid, signal) => {
          signals.push(signal);
          if (signal === "SIGKILL") {
            throw new Error("access denied");
          }
          return true;
        },
        proveLiveness: async () => {},
        waitForExit: async () => false,
      }),
      /Failed to force-stop cron daemon PID 4242.*access denied/,
    );
    assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  });
});

test("waitForDaemonReady requires two live matching confirmations", async () => {
  const child = new FakeChild();
  let markerReads = 0;
  let livenessChecks = 0;

  const marker = await startup.waitForDaemonReady({
    child,
    startToken: "start-token",
    profileKey: "solo",
    readMarker: () => {
      markerReads += 1;
      return readyMarker(child);
    },
    readPid: () => child.pid,
    isPidAlive: () => {
      livenessChecks += 1;
      return true;
    },
    timeoutMs: 500,
    confirmationIntervalMs: 20,
    pollIntervalMs: 5,
  });

  assert.equal(marker.pid, child.pid);
  assert.ok(markerReads >= 2);
  assert.ok(livenessChecks >= 5);
});

test("waitForDaemonReady rejects missing or replaced exclusive PID ownership", async (t) => {
  await t.test("missing PID", async () => {
    const child = new FakeChild();
    await assert.rejects(
      startup.waitForDaemonReady({
        child,
        startToken: "start-token",
        profileKey: "solo",
        readMarker: () => readyMarker(child),
        readPid: () => null,
        isPidAlive: () => true,
        timeoutMs: 500,
        pollIntervalMs: 5,
      }),
      /lost its exclusive PID ownership.*found no PID/,
    );
  });

  await t.test("PID replaced between confirmations", async () => {
    const child = new FakeChild();
    let reads = 0;
    await assert.rejects(
      startup.waitForDaemonReady({
        child,
        startToken: "start-token",
        profileKey: "solo",
        readMarker: () => readyMarker(child),
        readPid: () => {
          reads += 1;
          return reads === 1 ? child.pid : child.pid + 1;
        },
        isPidAlive: () => true,
        timeoutMs: 500,
        confirmationIntervalMs: 10,
        pollIntervalMs: 5,
      }),
      /lost its exclusive PID ownership.*found 4243/,
    );
  });
});

test("waitForDaemonReady rejects an active profile change between confirmations", async () => {
  const child = new FakeChild();
  let checks = 0;
  await assert.rejects(
    startup.waitForDaemonReady({
      child,
      startToken: "start-token",
      profileKey: "solo",
      readMarker: () => readyMarker(child),
      readPid: () => child.pid,
      isProfileActive: () => {
        checks += 1;
        return checks === 1;
      },
      isPidAlive: () => true,
      timeoutMs: 500,
      confirmationIntervalMs: 10,
      pollIntervalMs: 5,
    }),
    /active profile changed before cron daemon 4242 became ready/,
  );
});

test("waitForDaemonReady rejects when the daemon dies after its first ready marker", async () => {
  const child = new FakeChild();
  let markerReads = 0;

  await assert.rejects(
    startup.waitForDaemonReady({
      child,
      startToken: "start-token",
      profileKey: "solo",
      readMarker: () => {
        markerReads += 1;
        if (markerReads === 1) {
          setImmediate(() => {
            child.signalCode = "SIGTERM";
            child.emit("exit", null, "SIGTERM");
          });
        }
        return readyMarker(child);
      },
      isPidAlive: () => child.signalCode === null,
      timeoutMs: 500,
      confirmationIntervalMs: 50,
      pollIntervalMs: 5,
    }),
    /stopped before it became ready \(signal SIGTERM\)/,
  );

  assert.equal(markerReads, 1);
});

test("waitForDaemonReady observes spawn errors and process exits", async (t) => {
  await t.test("spawn error", async () => {
    const child = new FakeChild();
    const expected = new Error("spawn failed");
    setImmediate(() => child.emit("error", expected));

    await assert.rejects(
      startup.waitForDaemonReady({
        child,
        startToken: "start-token",
        profileKey: "solo",
        readMarker: () => null,
        isPidAlive: () => true,
        timeoutMs: 500,
        pollIntervalMs: 5,
      }),
      (error) => error === expected,
    );
  });

  await t.test("exit code", async () => {
    const child = new FakeChild();
    setImmediate(() => {
      child.exitCode = 7;
      child.emit("exit", 7, null);
    });

    await assert.rejects(
      startup.waitForDaemonReady({
        child,
        startToken: "start-token",
        profileKey: "solo",
        readMarker: () => null,
        isPidAlive: () => true,
        timeoutMs: 500,
        pollIntervalMs: 5,
      }),
      /stopped before it became ready \(exit code 7\)/,
    );
  });
});

test("waitForDaemonReady rejects a vanished PID and a real timeout", async (t) => {
  await t.test("vanished PID", async () => {
    const child = new FakeChild();
    let checks = 0;
    await assert.rejects(
      startup.waitForDaemonReady({
        child,
        startToken: "start-token",
        profileKey: "solo",
        readMarker: () => null,
        isPidAlive: () => {
          checks += 1;
          return checks === 1;
        },
        timeoutMs: 500,
        pollIntervalMs: 5,
      }),
      /stopped before it became ready/,
    );
  });

  await t.test("timeout", async () => {
    const child = new FakeChild();
    await assert.rejects(
      startup.waitForDaemonReady({
        child,
        startToken: "start-token",
        profileKey: "solo",
        readMarker: () => null,
        isPidAlive: () => true,
        timeoutMs: 20,
        pollIntervalMs: 5,
      }),
      /did not become ready within 20ms/,
    );
  });
});

test("terminateStartedChild escalates from TERM to KILL after the grace period", async () => {
  const child = new FakeChild();
  child.onKill = (signal) => {
    if (signal === "SIGKILL") {
      child.signalCode = signal;
      setImmediate(() => child.emit("exit", null, signal));
    }
  };

  const result = await startup.terminateStartedChild(child, {
    isPidAlive: () => child.signalCode === null,
    graceMs: 10,
  });

  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  assert.deepEqual(result, { forced: true, stopped: true });
});

test("failed startup preserves ownership files and reports a child that could not be stopped", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cron-startup-unstoppable-"));
  const markerPath = path.join(root, "marker.json");
  const pidPath = path.join(root, "daemon.pid");
  const lockPath = path.join(root, "lock.json");
  const child = new FakeChild();
  try {
    fs.writeFileSync(markerPath, JSON.stringify(readyMarker(child)), "utf8");
    fs.writeFileSync(pidPath, String(child.pid), "utf8");
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        runtime: "daemon",
        leader: true,
        pid: child.pid,
        identifier: `daemon-${child.pid}`,
        profileKey: "solo",
        startToken: "start-token",
      }),
      "utf8",
    );

    const cleanup = await startup.settleFailedStartedChild({
      child,
      isPidAlive: () => true,
      terminateChild: async () => ({ forced: true, stopped: false }),
      artifactOptions: {
        startToken: "start-token",
        profileKey: "solo",
        markerPath,
        pidPath,
        lockPath,
      },
    });

    assert.deepEqual(cleanup, {
      stopped: false,
      forced: true,
      terminationError: null,
    });
    assert.equal(child.unrefCalled, true);
    assert.equal(fs.existsSync(markerPath), true);
    assert.equal(fs.existsSync(pidPath), true);
    assert.equal(fs.existsSync(lockPath), true);

    const failure = startup.buildFailedStartError({
      startupError: new Error("readiness timeout"),
      child,
      cleanup,
      logTail: "must not be presented as a completed log",
    });
    assert.match(failure.message, /PID 4242 is still running/);
    assert.match(failure.message, /were preserved for safe recovery/);
    assert.doesNotMatch(failure.message, /Recent daemon log/);
    assert.doesNotMatch(failure.message, /must not be presented/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("removeOwnedStartupArtifacts removes only records owned by the new child", async (t) => {
  await t.test("owned records", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cron-startup-owned-"));
    const markerPath = path.join(root, "marker.json");
    const pidPath = path.join(root, "daemon.pid");
    const lockPath = path.join(root, "lock.json");
    try {
      fs.writeFileSync(markerPath, JSON.stringify(readyMarker({ pid: 4242 })), "utf8");
      fs.writeFileSync(pidPath, "4242", "utf8");
      fs.writeFileSync(
        lockPath,
        JSON.stringify({
          pid: 4242,
          identifier: "daemon-4242",
          profileKey: "solo",
          startToken: "start-token",
        }),
        "utf8",
      );

      startup.removeOwnedStartupArtifacts({
        pid: 4242,
        startToken: "start-token",
        profileKey: "solo",
        markerPath,
        pidPath,
        lockPath,
      });

      assert.equal(fs.existsSync(markerPath), false);
      assert.equal(fs.existsSync(pidPath), false);
      assert.equal(fs.existsSync(lockPath), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("foreign records", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cron-startup-foreign-"));
    const markerPath = path.join(root, "marker.json");
    const pidPath = path.join(root, "daemon.pid");
    const lockPath = path.join(root, "lock.json");
    const marker = readyMarker({ pid: 4242 }, { startToken: "foreign-token" });
    const lock = { pid: 4242, identifier: "daemon-from-another-start" };
    try {
      fs.writeFileSync(markerPath, JSON.stringify(marker), "utf8");
      fs.writeFileSync(pidPath, "9001", "utf8");
      fs.writeFileSync(lockPath, JSON.stringify(lock), "utf8");

      startup.removeOwnedStartupArtifacts({
        pid: 4242,
        startToken: "start-token",
        profileKey: "solo",
        markerPath,
        pidPath,
        lockPath,
      });

      assert.deepEqual(JSON.parse(fs.readFileSync(markerPath, "utf8")), marker);
      assert.equal(fs.readFileSync(pidPath, "utf8"), "9001");
      assert.deepEqual(JSON.parse(fs.readFileSync(lockPath, "utf8")), lock);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

test("spawnWithLogFile closes the log descriptor when spawn throws", () => {
  const calls = [];
  const fsImpl = {
    openSync(logPath, mode) {
      calls.push(["open", logPath, mode]);
      return 73;
    },
    closeSync(fd) {
      calls.push(["close", fd]);
    },
  };

  assert.throws(
    () => startup.spawnWithLogFile({
      logPath: "daemon.log",
      command: "node",
      args: ["daemon.cjs"],
      spawnProcess: () => {
        throw new Error("synchronous spawn failure");
      },
      spawnOptions: {},
      fsImpl,
    }),
    /synchronous spawn failure/,
  );
  assert.deepEqual(calls, [
    ["open", "daemon.log", "a"],
    ["close", 73],
  ]);
});

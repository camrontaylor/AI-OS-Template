const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const schedulerSourcePath = path.resolve(__dirname, "cron-scheduler.ts");

class LocalProfileLockedError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

class LocalProfileRequestError extends Error {}

function loadScheduler(stubs) {
  const source = fs.readFileSync(schedulerSourcePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} };
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return require(request);
  };
  const compiled = new Function("require", "module", "exports", "__dirname", "__filename", outputText);
  compiled(localRequire, module, module.exports, path.dirname(schedulerSourcePath), schedulerSourcePath);
  return module.exports;
}

test("cron scheduler pauses for every profile lock state and resumes without replaying missed jobs", () => {
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  const originalProcessOn = process.on;
  const intervals = [];
  const calls = {
    claim: 0,
    enqueue: 0,
    event: 0,
    hasActive: 0,
    heartbeat: 0,
    missed: 0,
    release: 0,
  };
  const profile = {
    version: 1,
    mode: "team",
    profileKey: "profile-a",
    dataDir: "C:/profile-a",
    stateDir: "C:/profile-a/state",
    tempDir: "C:/profile-a/tmp",
    dbPath: "C:/profile-a/data.db",
  };
  let profileError = new LocalProfileLockedError("corrupt_context");

  try {
    delete global.__managed_cron_scheduler__;
    global.setInterval = (callback, delay) => {
      const handle = { callback, delay };
      intervals.push(handle);
      return handle;
    };
    global.clearInterval = () => {};
    process.on = () => process;

    const scheduler = loadScheduler({
      "./config": { getConfig: () => ({}) },
      "./cron-service": {
        claimCronLeadership: () => { calls.claim += 1; return true; },
        enqueueCronJob: () => {
          calls.enqueue += 1;
          return {
            duplicate: false,
            task: {
              id: `task-${calls.enqueue}`,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          };
        },
        getCronWorkspaceCount: () => 1,
        getMissedFixedRuns: () => { calls.missed += 1; return []; },
        hasActiveCronJobs: () => { calls.hasActive += 1; return true; },
        listAllCronJobs: () => [{ active: true, prompt: "Run", time: "12:00", days: "daily" }],
        shouldDispatchNow: () => true,
        refreshCronHeartbeat: () => { calls.heartbeat += 1; },
        releaseCronLeadership: () => { calls.release += 1; },
        toCronMinuteIso: () => "2026-07-13T12:00:00.000Z",
      },
      "./event-bus": { emitTaskEvent: () => { calls.event += 1; } },
      "./db": {
        getActiveLocalProfileDescriptor: () => {
          if (profileError) throw profileError;
          return profile;
        },
      },
      "./local-profile": { LocalProfileLockedError },
      "./local-profile-lifecycle": {
        LocalProfileRequestError,
        assertLocalProfileActive: () => {
          if (profileError) throw profileError;
        },
      },
    });

    assert.doesNotThrow(() => scheduler.initCronScheduler());
    assert.equal(scheduler.isCronSchedulerRunning(), true);
    assert.deepEqual(intervals.map((entry) => entry.delay), [60_000, 15_000]);

    const tick = intervals[0].callback;
    const heartbeat = intervals[1].callback;
    for (const reason of [
      "identity_incomplete",
      "reauthentication_required",
      "profile_metadata_invalid",
      "profile_missing",
      "profile_migration_failed",
    ]) {
      profileError = new LocalProfileLockedError(reason);
      assert.doesNotThrow(tick);
    }
    profileError = new LocalProfileRequestError("profile closing");
    assert.doesNotThrow(tick);
    assert.equal(calls.hasActive, 0);
    assert.equal(calls.claim, 0);
    assert.equal(calls.enqueue, 0);

    profileError = null;
    tick();
    tick();
    assert.equal(calls.enqueue, 2);
    assert.equal(calls.missed, 1);

    profileError = new LocalProfileLockedError("identity_incomplete");
    assert.doesNotThrow(tick);
    assert.equal(calls.release, 1);

    profileError = null;
    tick();
    assert.equal(calls.enqueue, 3);
    assert.equal(calls.missed, 1, "the locked interval must not be replayed");

    profileError = new LocalProfileRequestError("profile closing");
    assert.doesNotThrow(heartbeat);
    assert.equal(calls.release, 2);

    profileError = new Error("unexpected profile failure");
    assert.throws(tick, /unexpected profile failure/);
  } finally {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
    process.on = originalProcessOn;
    delete global.__managed_cron_scheduler__;
  }
});

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./lib/test-utils/load-ts-module.cjs");

class LocalProfileLockedError extends Error {}
class LocalProfileRequestError extends Error {}

function loadInstrumentation(profileError, calls) {
  return loadTsModule(path.resolve(__dirname, "instrumentation.ts"), {
    stubs: {
      "./lib/config": { getConfig: () => ({ aiOsDir: "C:/workspace" }) },
      "./lib/local-profile": {
        LocalProfileLockedError,
        resolveLocalProfileDescriptor: () => { throw profileError; },
      },
      "./lib/local-profile-lifecycle": { LocalProfileRequestError },
      "./lib/profile-shutdown-coordinator": { recoverLocalProfileCleanup: async () => {} },
      "./lib/queue-watcher": { initQueueWatcher: () => calls.push("queue") },
      "./lib/cron-scheduler": { initCronScheduler: () => calls.push("cron") },
      "./lib/file-watcher": { fileWatcher: { cleanupAll: () => {} } },
      "./lib/workspace-file-watcher": { workspaceFileWatcher: { cleanupAll: () => {} } },
      fs: { mkdirSync: () => {}, writeFileSync: () => {} },
      path: { join: (...segments) => segments.join("/") },
    },
  });
}

test("instrumentation reports one concise pause warning and still starts background retry loops", async () => {
  const originalRuntime = process.env.NEXT_RUNTIME;
  const originalProcessOn = process.on;
  const originalWarn = console.warn;
  const warnings = [];
  const calls = [];

  try {
    process.env.NEXT_RUNTIME = "nodejs";
    process.on = () => process;
    console.warn = (...args) => warnings.push(args);
    const instrumentation = loadInstrumentation(
      new LocalProfileLockedError("Reconnect Team OS."),
      calls,
    );

    await instrumentation.register();

    assert.deepEqual(calls, ["queue", "cron"]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].join(" "), /background work is paused/i);
    assert.doesNotMatch(warnings[0].join(" "), /stack/i);
  } finally {
    if (originalRuntime == null) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = originalRuntime;
    process.on = originalProcessOn;
    console.warn = originalWarn;
  }
});

test("instrumentation keeps the existing warning for unexpected cleanup failures", async () => {
  const originalRuntime = process.env.NEXT_RUNTIME;
  const originalProcessOn = process.on;
  const originalWarn = console.warn;
  const warnings = [];

  try {
    process.env.NEXT_RUNTIME = "nodejs";
    process.on = () => process;
    console.warn = (...args) => warnings.push(args);
    const instrumentation = loadInstrumentation(new Error("disk failure"), []);

    await instrumentation.register();

    assert.equal(warnings.length, 1);
    assert.match(warnings[0].join(" "), /startup cleanup remains pending/i);
    assert.match(warnings[0].join(" "), /disk failure/i);
  } finally {
    if (originalRuntime == null) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = originalRuntime;
    process.on = originalProcessOn;
    console.warn = originalWarn;
  }
});

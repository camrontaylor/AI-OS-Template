"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../../../../lib/test-utils/load-ts-module.cjs");

class LocalProfileLockedError extends Error {
  constructor(status, reason, message) {
    super(message);
    this.status = status;
    this.reason = reason;
    this.code = "profile_locked";
  }
}

class LocalProfileRequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function createHarness() {
  const state = {
    context: { baseDir: "C:/workspace" },
    descriptorError: null,
    requestError: null,
    guardCalls: 0,
    watcherSubscription: null,
    unsubscribeCalls: 0,
    profileCloser: null,
    unregisterCalls: 0,
  };
  const descriptor = { version: 1, mode: "team", profileKey: "profile-a" };
  const route = loadTsModule(path.join(__dirname, "route.ts"), {
    stubs: {
      "@/lib/event-bus": {
        registerProfileEventStream: (profileKey, close) => {
          assert.equal(profileKey, descriptor.profileKey);
          state.profileCloser = close;
          return () => { state.unregisterCalls += 1; };
        },
      },
      "@/lib/local-profile": {
        LocalProfileLockedError,
        localProfileErrorBody: (error) => ({ error: { code: error.code, reason: error.reason, message: error.message } }),
        resolveLocalProfileDescriptor: () => {
          if (state.descriptorError) throw state.descriptorError;
          return descriptor;
        },
      },
      "@/lib/local-profile-lifecycle": {
        assertLocalProfileRequest: () => {
          state.guardCalls += 1;
          if (state.requestError) throw state.requestError;
        },
        LocalProfileRequestError,
        localProfileRequestErrorBody: (error) => ({ error: { code: error.code, message: error.message } }),
      },
      "@/lib/task-file-access": {
        resolveTaskWorkspace: () => state.context,
      },
      "@/lib/workspace-file-watcher": {
        workspaceFileWatcher: {
          subscribe: (subscription) => {
            state.watcherSubscription = subscription;
            return () => { state.unsubscribeCalls += 1; };
          },
        },
      },
    },
  });
  return { route, state };
}

function request(signal = new AbortController().signal) {
  return { headers: new Headers(), signal };
}

test("workspace file event stream is task-scoped and emits only relative parent directories", async () => {
  const harness = createHarness();
  const controller = new AbortController();
  const response = await harness.route.GET(request(controller.signal), { params: Promise.resolve({ id: "task-a" }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.equal(harness.state.guardCalls, 1);
  assert.deepEqual(
    { profileKey: harness.state.watcherSubscription.profileKey, baseDir: harness.state.watcherSubscription.baseDir },
    { profileKey: "profile-a", baseDir: "C:/workspace" },
  );

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const connected = decoder.decode((await reader.read()).value);
  assert.match(connected, /^event: connected\n/);

  harness.state.watcherSubscription.onChange({
    type: "workspace:directory-changed",
    directory: "projects/briefs/demo",
  });
  const changed = decoder.decode((await reader.read()).value);
  assert.equal(
    changed,
    "event: workspace:directory-changed\ndata: {\"directory\":\"projects/briefs/demo\"}\n\n",
  );
  assert.doesNotMatch(changed, /C:\\|C:\//);

  await reader.cancel();
  controller.abort();
  harness.state.profileCloser();
  assert.equal(harness.state.unsubscribeCalls, 1);
  assert.equal(harness.state.unregisterCalls, 1);
});

test("workspace file event stream rejects stale profiles and missing tasks", async () => {
  const harness = createHarness();
  harness.state.requestError = new LocalProfileRequestError(409, "stale_profile_session", "Reload the application.");
  let response = await harness.route.GET(request(), { params: Promise.resolve({ id: "task-a" }) });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: { code: "stale_profile_session", message: "Reload the application." } });

  harness.state.requestError = null;
  harness.state.context = null;
  response = await harness.route.GET(request(), { params: Promise.resolve({ id: "missing" }) });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Task not found" });
});

"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../lib/test-utils/load-ts-module.cjs");

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
  const descriptor = {
    version: 1,
    mode: "team",
    profileKey: "profile-a",
  };
  const state = {
    descriptorError: null,
    requestError: null,
    guardCalls: [],
    taskHandlers: new Set(),
    chatHandlers: new Set(),
    profileCloser: null,
    offTaskCalls: 0,
    offChatCalls: 0,
    unregisterCalls: 0,
  };

  const route = loadTsModule(path.join(__dirname, "route.ts"), {
    stubs: {
      "@/lib/cron-task-sync": {
        startCronTaskSync: () => {},
      },
      "@/lib/event-bus": {
        onTaskEvent: (handler) => state.taskHandlers.add(handler),
        offTaskEvent: (handler) => {
          state.offTaskCalls += 1;
          state.taskHandlers.delete(handler);
        },
        onChatEvent: (handler) => state.chatHandlers.add(handler),
        offChatEvent: (handler) => {
          state.offChatCalls += 1;
          state.chatHandlers.delete(handler);
        },
        registerProfileEventStream: (profileKey, close) => {
          assert.equal(profileKey, descriptor.profileKey);
          state.profileCloser = close;
          return () => {
            state.unregisterCalls += 1;
            if (state.profileCloser === close) state.profileCloser = null;
          };
        },
      },
      "@/lib/local-profile": {
        LocalProfileLockedError,
        localProfileErrorBody: (error) => ({
          error: {
            code: error.code,
            reason: error.reason,
            message: error.message,
          },
        }),
        resolveLocalProfileDescriptor: () => {
          if (state.descriptorError) throw state.descriptorError;
          return descriptor;
        },
      },
      "@/lib/local-profile-lifecycle": {
        assertLocalProfileRequest: (resolvedDescriptor, headers) => {
          state.guardCalls.push({ descriptor: resolvedDescriptor, headers });
          if (state.requestError) throw state.requestError;
        },
        LocalProfileRequestError,
        localProfileRequestErrorBody: (error) => ({
          error: { code: error.code, message: error.message },
        }),
      },
    },
  });

  return {
    route,
    descriptor,
    state,
    emitTask(event) {
      for (const handler of [...state.taskHandlers]) handler(event);
    },
  };
}

function request(signal = new AbortController().signal, headers = new Headers()) {
  return { headers, signal };
}

async function openStream(harness, abortController = new AbortController()) {
  const headers = new Headers({ "x-test-profile": "profile-a" });
  const response = await harness.route.GET(request(abortController.signal, headers));
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  assert.match(new TextDecoder().decode(first.value), /^event: connected\n/);
  return { abortController, headers, reader, response };
}

function assertCleanedUp(state) {
  assert.equal(state.taskHandlers.size, 0);
  assert.equal(state.chatHandlers.size, 0);
  assert.equal(state.offTaskCalls, 1);
  assert.equal(state.offChatCalls, 1);
  assert.equal(state.unregisterCalls, 1);
}

test("events route applies the same local-profile request guard and safe errors as the proxy", async () => {
  const harness = createHarness();
  const stale = new LocalProfileRequestError(
    409,
    "stale_profile_session",
    "Reload the application.",
  );
  harness.state.requestError = stale;

  let response = await harness.route.GET(request());
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: { code: "stale_profile_session", message: "Reload the application." },
  });

  harness.state.requestError = new LocalProfileRequestError(
    423,
    "profile_closing",
    "The profile is closing.",
  );
  response = await harness.route.GET(request());
  assert.equal(response.status, 423);
  assert.deepEqual(await response.json(), {
    error: { code: "profile_closing", message: "The profile is closing." },
  });

  harness.state.requestError = null;
  harness.state.descriptorError = new LocalProfileLockedError(
    423,
    "identity_incomplete",
    "Reconnect the profile.",
  );
  response = await harness.route.GET(request());
  assert.equal(response.status, 423);
  assert.deepEqual(await response.json(), {
    error: {
      code: "profile_locked",
      reason: "identity_incomplete",
      message: "Reconnect the profile.",
    },
  });
});

test("events route does not hide unexpected profile errors", async () => {
  const harness = createHarness();
  harness.state.descriptorError = new Error("unexpected profile failure");

  await assert.rejects(
    () => harness.route.GET(request()),
    /unexpected profile failure/,
  );
});

test("stream cancellation runs cleanup once", async () => {
  const harness = createHarness();
  const { abortController, headers, reader } = await openStream(harness);
  const registeredCloser = harness.state.profileCloser;

  assert.equal(harness.state.guardCalls.length, 1);
  assert.equal(harness.state.guardCalls[0].descriptor, harness.descriptor);
  assert.equal(harness.state.guardCalls[0].headers, headers);
  await reader.cancel("client disconnected");
  abortController.abort();
  registeredCloser();

  assertCleanedUp(harness.state);
});

test("request abort lets the HTTP adapter close the stream and runs cleanup once", async () => {
  const harness = createHarness();
  const { abortController, reader } = await openStream(harness);
  const registeredCloser = harness.state.profileCloser;

  abortController.abort();
  assertCleanedUp(harness.state);
  await reader.cancel("transport closed");
  registeredCloser();
});

test("profile shutdown closes the stream and runs cleanup once", async () => {
  const harness = createHarness();
  const { abortController, reader } = await openStream(harness);
  const registeredCloser = harness.state.profileCloser;

  registeredCloser();
  registeredCloser();
  abortController.abort();
  assert.deepEqual(await reader.read(), { value: undefined, done: true });

  assertCleanedUp(harness.state);
});

test("enqueue failure closes the stream and releases every subscription", async () => {
  const NativeReadableStream = global.ReadableStream;
  global.ReadableStream = class FailingReadableStream extends NativeReadableStream {
    constructor(source, strategy) {
      let enqueueCount = 0;
      super({
        start(controller) {
          const enqueue = controller.enqueue.bind(controller);
          controller.enqueue = (chunk) => {
            enqueueCount += 1;
            if (enqueueCount === 2) throw new Error("forced enqueue failure");
            return enqueue(chunk);
          };
          return source.start?.(controller);
        },
        pull(controller) {
          return source.pull?.(controller);
        },
        cancel(reason) {
          return source.cancel?.(reason);
        },
      }, strategy);
    }
  };

  const harness = createHarness();
  let registeredCloser;
  try {
    const { reader } = await openStream(harness);
    registeredCloser = harness.state.profileCloser;
    harness.emitTask({
      profileKey: "profile-a",
      type: "task:updated",
      task: { id: "task-1" },
      timestamp: "2026-07-14T00:00:00.000Z",
    });

    assert.deepEqual(await reader.read(), { value: undefined, done: true });
    assertCleanedUp(harness.state);
  } finally {
    registeredCloser?.();
    global.ReadableStream = NativeReadableStream;
  }
});

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../lib/test-utils/load-ts-module.cjs");

function loadStore() {
  return loadTsModule(path.resolve(__dirname, "task-store.ts"), {
    stubs: {
      "@/types/task": {},
      "@/lib/event-bus": {},
      "@/lib/task-logs": {
        isLegacyCronFallbackLogEntry: () => false,
        isLegacyCronFallbackLogSet: () => false,
      },
      "@/lib/permission-mode": {
        getActivePermissionMode: (value, fallback) => value ?? fallback,
        getExecutionPermissionMode: (value, fallback) => value ?? fallback,
      },
      "@/lib/api-error": {
        async readApiError(response, fallback) {
          try {
            const body = await response.clone().json();
            return typeof body.error === "string" ? body.error : fallback;
          } catch {
            return fallback;
          }
        },
      },
      "@/lib/task-branch-ui": {
        getEditedLineageRootTaskId: (id) => id,
        getVisibleEditedTasks: (tasks) => tasks,
      },
      "@/lib/task-archive": {
        isTaskReadOnly: () => false,
        selectActiveGoals: (tasks) => tasks.filter((task) => !task.parentId && !task.archivedAt),
        selectArchivedGoals: (tasks) => tasks.filter((task) => !task.parentId && Boolean(task.archivedAt)),
      },
      "./client-store": {
        useClientStore: {
          getState: () => ({ activeClientSlugs: null, selectedClientId: null }),
        },
      },
    },
  }).useTaskStore;
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    clone() { return response(body, status); },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function taskRow(id, overrides = {}) {
  return {
    id,
    title: "Chat",
    description: null,
    status: "review",
    level: "task",
    parentId: null,
    projectSlug: null,
    columnOrder: 0,
    createdAt: "2026-07-22T10:00:00.000Z",
    updatedAt: "2026-07-22T10:00:00.000Z",
    costUsd: null,
    tokensUsed: null,
    durationMs: null,
    activityLabel: null,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    archivedAt: null,
    hasMainChat: true,
    clientId: null,
    workScope: { mode: "solo", version: 1, clientId: null },
    needsInput: false,
    phaseNumber: null,
    gsdStep: null,
    contextSources: null,
    cronJobSlug: null,
    claudeSessionId: null,
    permissionMode: "bypassPermissions",
    executionPermissionMode: "bypassPermissions",
    model: null,
    thinkingEffort: null,
    lastReplyAt: null,
    goalGroup: null,
    tag: null,
    pinnedAt: null,
    ...overrides,
  };
}

test("create replaces the exact temporary ID when SSE wins the race", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const store = loadStore();
  const pending = deferred();
  global.fetch = async () => pending.promise;

  const create = store.getState().createTask("Same title", null, "task");
  const tempId = store.getState().tasks[0].id;
  const permanent = taskRow("permanent-1", { title: "Same title", status: "queued" });
  store.getState().applySSEEvent({
    type: "task:created",
    task: permanent,
    timestamp: permanent.updatedAt,
    profileKey: "solo",
  });
  assert.deepEqual(store.getState().tasks.map((task) => task.id).sort(), ["permanent-1", tempId].sort());

  pending.resolve(response(permanent, 201));
  assert.equal(await create, "permanent-1");
  assert.deepEqual(store.getState().tasks.map((task) => task.id), ["permanent-1"]);
});

test("same-title concurrent creates retain both permanent IDs", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const store = loadStore();
  const requests = [deferred(), deferred()];
  let requestIndex = 0;
  global.fetch = async () => requests[requestIndex++].promise;

  const first = store.getState().createTask("Duplicate", null, "task");
  const second = store.getState().createTask("Duplicate", null, "task");
  const secondPermanent = taskRow("permanent-2", { title: "Duplicate", status: "queued" });
  store.getState().applySSEEvent({
    type: "task:created",
    task: secondPermanent,
    timestamp: secondPermanent.updatedAt,
    profileKey: "solo",
  });
  requests[1].resolve(response(secondPermanent, 201));
  requests[0].resolve(response(taskRow("permanent-1", { title: "Duplicate", status: "queued" }), 201));

  assert.deepEqual((await Promise.all([first, second])).sort(), ["permanent-1", "permanent-2"]);
  assert.deepEqual(store.getState().tasks.map((task) => task.id).sort(), ["permanent-1", "permanent-2"]);
});

test("archive deduplicates requests and normalizes serialized work scope", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const store = loadStore();
  const goal = taskRow("goal");
  store.setState({ tasks: [goal] });
  const pending = deferred();
  let calls = 0;
  global.fetch = async () => { calls += 1; return pending.promise; };

  const first = store.getState().archiveGoal("goal");
  const second = store.getState().archiveGoal("goal");
  assert.equal(first, second);
  assert.deepEqual(store.getState().archivePendingIds, ["goal"]);
  pending.resolve(response({
    tasks: [{
      ...goal,
      status: "done",
      archivedAt: "2026-07-22T11:00:00.000Z",
      updatedAt: "2026-07-22T11:00:00.000Z",
      workScope: JSON.stringify(goal.workScope),
    }],
  }));

  const result = await first;
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  assert.equal(store.getState().tasks[0].workScope.mode, "solo");
  assert.deepEqual(store.getState().archivePendingIds, []);
});

test("older fetch and SSE snapshots cannot undo an archive", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const store = loadStore();
  const goal = taskRow("goal", { status: "done" });
  const archived = taskRow("goal", {
    status: "done",
    archivedAt: "2026-07-22T12:00:00.000Z",
    updatedAt: "2026-07-22T12:00:00.000Z",
  });
  store.setState({ tasks: [goal] });
  const staleFetch = deferred();
  global.fetch = async (url) => url.includes("/archive")
    ? response({ tasks: [archived] })
    : staleFetch.promise;

  const fetchRequest = store.getState().fetchTasks();
  assert.equal((await store.getState().archiveGoal("goal")).ok, true);
  staleFetch.resolve(response([goal]));
  await fetchRequest;
  assert.equal(store.getState().tasks[0].archivedAt, archived.archivedAt);

  store.getState().applySSEEvent({
    type: "task:updated",
    task: goal,
    timestamp: goal.updatedAt,
    profileKey: "solo",
  });
  assert.equal(store.getState().tasks[0].archivedAt, archived.archivedAt);
});

test("restore clears recent done protection without discarding loaded chat history", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const store = loadStore();
  const sessionId = "session-before-archive";
  const goal = taskRow("goal", { claudeSessionId: sessionId });
  const done = taskRow("goal", {
    status: "done",
    claudeSessionId: sessionId,
    updatedAt: "2026-07-22T11:00:00.000Z",
  });
  const archived = taskRow("goal", {
    status: "done",
    archivedAt: "2026-07-22T12:00:00.000Z",
    claudeSessionId: sessionId,
    updatedAt: "2026-07-22T12:00:00.000Z",
  });
  const restored = taskRow("goal", {
    status: "review",
    needsInput: true,
    claudeSessionId: sessionId,
    updatedAt: "2026-07-22T13:00:00.000Z",
  });
  const history = [
    { id: 1, taskId: "goal", type: "user", content: "Original prompt" },
    { id: 2, taskId: "goal", type: "assistant", content: "Original response" },
  ];
  store.setState({
    tasks: [goal],
    logEntries: { goal: history },
    logLoadStatus: { goal: "loaded" },
  });
  global.fetch = async (url, options = {}) => {
    if (url.endsWith("/archive")) return response({ tasks: [archived] });
    if (url.endsWith("/restore")) return response({ tasks: [restored] });
    if (options.method === "PATCH") return response(done);
    return response([restored]);
  };

  await store.getState().updateTask("goal", { status: "done" });
  await store.getState().archiveGoal("goal");
  await store.getState().restoreGoal("goal");
  await store.getState().fetchTasks();
  assert.equal(store.getState().tasks[0].status, "review");
  assert.equal(store.getState().tasks[0].needsInput, true);
  assert.equal(store.getState().tasks[0].claudeSessionId, sessionId);
  assert.deepEqual(store.getState().logEntries.goal, history);
  assert.equal(store.getState().logLoadStatus.goal, "loaded");
});

test("stop and archive failures return durable operation results", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const store = loadStore();
  store.setState({ tasks: [taskRow("goal")] });
  global.fetch = async (url) => url.endsWith("/cancel")
    ? response({ error: "Process is still running" }, 409)
    : response({ code: "task_stop_failed", error: "Agent could not be stopped" }, 503);

  assert.equal(await store.getState().cancelTask("goal"), false);
  const result = await store.getState().archiveGoal("goal");
  assert.deepEqual(result, { ok: false, error: "Agent could not be stopped" });
  assert.ok(store.getState().tasks[0].archivingAt);
  assert.deepEqual(store.getState().archivePendingIds, []);
});

test("log loading distinguishes loaded-empty, error, and retry", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const store = loadStore();
  const first = deferred();
  let call = 0;
  global.fetch = async () => {
    call += 1;
    if (call === 1) return first.promise;
    if (call === 2) return response({ error: "Chat not found" }, 404);
    return response([]);
  };

  const initial = store.getState().fetchLogEntries("goal");
  assert.equal(store.getState().logLoadStatus.goal, "loading");
  first.resolve(response([]));
  await initial;
  assert.equal(store.getState().logLoadStatus.goal, "loaded");
  assert.deepEqual(store.getState().logEntries.goal, []);

  await store.getState().fetchLogEntries("goal");
  assert.equal(store.getState().logLoadStatus.goal, "error");
  assert.equal(store.getState().logLoadErrors.goal, "Chat not found");

  await store.getState().fetchLogEntries("goal");
  assert.equal(store.getState().logLoadStatus.goal, "loaded");
  assert.equal(store.getState().logLoadErrors.goal, null);
});

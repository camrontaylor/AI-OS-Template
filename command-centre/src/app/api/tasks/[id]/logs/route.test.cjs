const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../../../lib/test-utils/load-ts-module.cjs");

function loadRoute(task) {
  return loadTsModule(path.resolve(__dirname, "route.ts"), {
    stubs: {
      "@/lib/process-manager": {
        processManager: { getLogEntries: () => [] },
      },
      "@/lib/db": {
        getDb: () => ({
          prepare: () => ({ get: () => task }),
        }),
      },
      "@/lib/config": { getClientAiOsDir: () => null },
      "@/lib/event-bus": { emitTaskEvent: () => {} },
      "@/lib/task-logs": {
        buildCronTaskLogEntries: () => [],
        mergeTaskLogsWithConversation: (entries) => entries,
      },
      "@/lib/identity/work-scope": {
        isWorkScopeError: () => false,
        readWorkScopeFromRow: () => ({ mode: "solo", version: 1, clientId: null }),
        workScopeErrorBody: () => ({}),
      },
      "@/lib/materialized-file-ownership": {
        isMaterializedPathAccessible: () => true,
      },
      "@/lib/task-archive": { isTaskArchived: () => false },
    },
  });
}

test("missing chat logs return a clear 404 instead of a loaded empty transcript", async () => {
  const route = loadRoute(undefined);
  const response = await route.GET(new Request("http://localhost/api/tasks/missing/logs"), {
    params: Promise.resolve({ id: "missing" }),
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Chat not found" });
});

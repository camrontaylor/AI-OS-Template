const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../lib/test-utils/load-ts-module.cjs");

function request(url = "http://localhost/api/test", body = {}, signal = new AbortController().signal) {
  const parsed = new URL(url);
  return {
    url,
    nextUrl: { searchParams: parsed.searchParams },
    json: async () => body,
    signal,
  };
}

function forbiddenResponse() {
  return Response.json({ error: "hosted blocked" }, { status: 403 });
}

function loadHostedRoute(routePath, stubs = {}) {
  let localCalls = 0;
  const count = () => {
    localCalls += 1;
  };
  const route = loadTsModule(routePath, {
    stubs: {
      "@/lib/team-mode": {
        isHostedTeamMode: () => true,
        isTeamScopedRequest: () => true,
        hostedModeForbiddenResponse: forbiddenResponse,
      },
      "@/lib/config": {
        getConfig: () => {
          count();
          return { aiOsDir: "should-not-be-read" };
        },
        getClientAiOsDir: () => {
          count();
          return "should-not-be-read";
        },
      },
      "@/lib/team-api-context": {
        fetchTeamContextSnapshot: async () => ({ markdown: "" }),
      },
      "@/lib/materialized-file-ownership": {
        isMaterializedPathAccessible: () => true,
        assertMaterializedPathAccessible: () => {},
        assertMaterializedPathWritable: () => {},
        MaterializedFileAccessError: class MaterializedFileAccessError extends Error {},
      },
      "@/lib/identity/request-principal": {
        RequestPrincipalError: class RequestPrincipalError extends Error {},
      },
      "@/lib/skill-catalog": {
        parseSkillOrigin: () => null,
        resolveSkillFileTarget: async () => { throw new Error("unexpected skill target"); },
      },
      ...stubs,
    },
  });
  return { route, localCalls: () => localCalls, count };
}

test("hosted mode blocks .env reads and writes before local config is loaded", async () => {
  const { route, localCalls } = loadHostedRoute(path.resolve(__dirname, "../settings/env/route.ts"));

  const get = await route.GET();
  assert.equal(get.status, 403);

  const put = await route.PUT(request("http://localhost/api/settings/env", { content: "SECRET=value" }));
  assert.equal(put.status, 403);

  assert.equal(localCalls(), 0);
});

test("hosted mode keeps existing terminal sessions local and usable", async () => {
  let terminalCalls = 0;
  let boundaryCalls = 0;
  const { route } = loadHostedRoute(path.resolve(__dirname, "../terminal/exec/route.ts"), {
    "@/lib/task-archive": {
      isTaskArchived: () => {
        boundaryCalls += 1;
        return false;
      },
    },
    "@/lib/task-file-access": {
      resolveTaskWorkspace: () => {
        boundaryCalls += 1;
        return null;
      },
    },
    "@/lib/terminal-sessions": {
      createSession: () => { terminalCalls += 1; },
      getSession: () => { terminalCalls += 1; },
      sendInput: () => { terminalCalls += 1; return true; },
      subscribe: () => {
        terminalCalls += 1;
        return () => {};
      },
      destroySession: () => { terminalCalls += 1; },
      resolveTaskTerminalCwd: () => {
        boundaryCalls += 1;
        return "should-not-resolve";
      },
    },
    "@/lib/clients": { assertValidClientId: (value) => value ?? null },
    "@/lib/db": {
      getActiveLocalProfileDescriptor: () => ({ mode: "team", profileKey: "profile-a" }),
      getDb: () => {
        boundaryCalls += 1;
        throw new Error("database should not be read for terminal input");
      },
    },
    "@/lib/identity/work-scope": {
      assertNoWorkScopeInput() {},
      captureNewWorkScope: async () => { throw new Error("scope should not be captured for terminal input"); },
      inheritWorkScope: () => { throw new Error("scope should not be inherited for terminal input"); },
      isWorkScopeError: () => false,
      workScopeErrorBody: (error) => ({ code: error.code, error: error.message }),
    },
  });

  const response = await route.POST(request("http://localhost/api/terminal/exec", {
    action: "input",
    sessionId: "hosted-local",
    input: "pwd\n",
  }));

  assert.equal(response.status, 200);
  assert.equal(terminalCalls, 1);
  assert.equal(boundaryCalls, 0);
});

test("Team terminal creation rejects an arbitrary browser directory", async () => {
  let terminalCalls = 0;
  const { route } = loadHostedRoute(path.resolve(__dirname, "../terminal/exec/route.ts"), {
    "@/lib/terminal-sessions": {
      createSession: () => { terminalCalls += 1; },
      getSession: () => undefined,
      sendInput: () => false,
      subscribe: () => () => {},
      destroySession: () => {},
    },
    "@/lib/config": {
      getConfig: () => ({ aiOsDir: process.cwd() }),
      getClientAiOsDir: () => process.cwd(),
    },
    "@/lib/clients": { assertValidClientId: () => null },
    "@/lib/task-archive": { isTaskArchived: () => false },
    "@/lib/task-file-access": { resolveTaskWorkspace: () => null },
    "@/lib/db": {
      getActiveLocalProfileDescriptor: () => ({ mode: "team", profileKey: "profile-a" }),
      getDb: () => { throw new Error("task database should not be read"); },
    },
    "@/lib/identity/work-scope": {
      assertNoWorkScopeInput() {},
      captureNewWorkScope: async () => ({
        clientId: null,
        serialized: "{}",
        scope: {
          mode: "team",
          scope: { version: 1, serverId: "server-1", userId: "user-1", teamId: "team-a", clientId: null },
        },
      }),
      inheritWorkScope: () => { throw new Error("task scope should not be inherited"); },
      isWorkScopeError: () => false,
      workScopeErrorBody: (error) => ({ code: error.code, error: error.message }),
    },
  });

  const response = await route.POST(request("http://localhost/api/terminal/exec", {
    action: "create",
    sessionId: "team-terminal",
    cwd: path.resolve(process.cwd(), ".."),
  }));

  assert.equal(response.status, 400);
  assert.equal(terminalCalls, 0);
});

test("Team terminal creation allows the server-validated client directory", async () => {
  let createdOptions = null;
  const { route } = loadHostedRoute(path.resolve(__dirname, "../terminal/exec/route.ts"), {
    "@/lib/terminal-sessions": {
      createSession: (_id, options) => {
        createdOptions = options;
        throw new Error("stop before opening a real stream");
      },
      getSession: () => undefined,
      sendInput: () => false,
      subscribe: () => () => {},
      destroySession: () => {},
      resolveTaskTerminalCwd: () => "unused",
    },
    "@/lib/config": {
      getConfig: () => ({ aiOsDir: process.cwd() }),
      getClientAiOsDir: () => process.cwd(),
    },
    "@/lib/clients": { assertValidClientId: (value) => value ?? null },
    "@/lib/task-archive": { isTaskArchived: () => false },
    "@/lib/task-file-access": { resolveTaskWorkspace: () => null },
    "@/lib/db": {
      getActiveLocalProfileDescriptor: () => ({ mode: "team", profileKey: "profile-a" }),
      getDb: () => { throw new Error("task database should not be read"); },
    },
    "@/lib/identity/work-scope": {
      assertNoWorkScopeInput() {},
      captureNewWorkScope: async (clientId) => ({
        clientId,
        scope: {
          mode: "team",
          scope: { version: 1, serverId: "server-1", userId: "user-1", teamId: "team-a", clientId },
        },
      }),
      inheritWorkScope: () => { throw new Error("task scope should not be inherited"); },
      isWorkScopeError: () => false,
      workScopeErrorBody: (error) => ({ code: error.code, error: error.message }),
    },
  });

  const response = await route.POST(request("http://localhost/api/terminal/exec", {
    action: "create",
    sessionId: "team-terminal",
    clientId: "acme",
  }));

  assert.equal(response.status, 400);
  assert.equal(createdOptions.cwd, process.cwd());
  assert.equal(createdOptions.workScope.scope.teamId, "team-a");
  assert.equal(createdOptions.workScope.scope.clientId, "acme");
});

test("terminal session creation can use a validated client without a taskId", async () => {
  let dbCalls = 0;
  let capturedClientId = "unset";
  let createdOptions = null;
  const { route } = loadHostedRoute(path.resolve(__dirname, "../terminal/exec/route.ts"), {
    "@/lib/config": {
      getConfig: () => ({ aiOsDir: process.cwd() }),
      getClientAiOsDir: () => process.cwd(),
    },
    "@/lib/clients": {
      assertValidClientId: (value) => value ?? null,
    },
    "@/lib/db": {
      getActiveLocalProfileDescriptor: () => ({ mode: "solo", profileKey: "solo" }),
      getDb: () => {
        dbCalls += 1;
        return { prepare: () => ({ get: () => null }) };
      },
    },
    "@/lib/task-archive": { isTaskArchived: () => false },
    "@/lib/task-file-access": { resolveTaskWorkspace: () => null },
    "@/lib/identity/work-scope": {
      assertNoWorkScopeInput() {},
      captureNewWorkScope: async (clientId) => {
        capturedClientId = clientId;
        return {
          clientId,
          scope: { mode: "solo", version: 1, clientId },
        };
      },
      inheritWorkScope: () => { throw new Error("task scope should not be inherited"); },
      isWorkScopeError: () => false,
      workScopeErrorBody: (error) => ({ code: error.code, error: error.message }),
    },
    "@/lib/terminal-sessions": {
      createSession: (_id, options) => {
        createdOptions = options;
        throw new Error("stop before opening a real stream");
      },
      getSession: () => null,
      sendInput: () => false,
      subscribe: () => () => {},
      destroySession: () => {},
      resolveTaskTerminalCwd: () => "unused",
    },
  });

  const response = await route.POST(request("http://localhost/api/terminal/exec", {
    action: "create",
    sessionId: "client-scoped",
    clientId: "acme",
  }));

  assert.equal(response.status, 400);
  assert.equal(dbCalls, 0);
  assert.equal(capturedClientId, "acme");
  assert.equal(createdOptions.cwd, process.cwd());
  assert.equal(createdOptions.workScope.clientId, "acme");
});

test("aborting a terminal stream destroys the session for its original profile", async () => {
  const controller = new AbortController();
  const destroyed = [];
  let subscribed = 0;
  let unsubscribed = 0;
  const { route } = loadHostedRoute(path.resolve(__dirname, "../terminal/exec/route.ts"), {
    "@/lib/config": {
      getConfig: () => ({ aiOsDir: process.cwd() }),
      getClientAiOsDir: () => process.cwd(),
    },
    "@/lib/clients": { assertValidClientId: (value) => value ?? null },
    "@/lib/db": {
      getActiveLocalProfileDescriptor: () => ({ mode: "solo", profileKey: "profile-original" }),
      getDb: () => { throw new Error("free terminal must not read task data"); },
    },
    "@/lib/task-archive": { isTaskArchived: () => false },
    "@/lib/task-file-access": { resolveTaskWorkspace: () => null },
    "@/lib/identity/work-scope": {
      assertNoWorkScopeInput() {},
      captureNewWorkScope: async (clientId) => ({
        clientId,
        scope: { mode: "solo", version: 1, clientId },
      }),
      inheritWorkScope: () => { throw new Error("free scope should not be inherited"); },
      isWorkScopeError: () => false,
      workScopeErrorBody: (error) => ({ code: error.code, error: error.message }),
    },
    "@/lib/terminal-sessions": {
      createSession: () => {},
      getSession: () => ({}),
      sendInput: () => false,
      subscribe: () => {
        subscribed += 1;
        return () => { unsubscribed += 1; };
      },
      destroySession: (sessionId, profileKey) => destroyed.push([sessionId, profileKey]),
      resolveTaskTerminalCwd: () => "unused",
    },
  });

  const response = await route.POST(request("http://localhost/api/terminal/exec", {
    action: "create",
    sessionId: "abort-me",
    clientId: null,
  }, controller.signal));

  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /event: ready/);
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(destroyed, [["abort-me", "profile-original"]]);
  assert.equal(subscribed, 1);
  assert.equal(unsubscribed, 1);
  await reader.cancel();
  assert.equal(destroyed.length, 1);
});

test("free terminal creation rejects junctions that escape the workspace", async (t) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aios-terminal-route-root-"));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aios-terminal-route-outside-"));
  const escapedClient = path.join(workspaceRoot, "clients", "escaped");
  fs.mkdirSync(path.dirname(escapedClient), { recursive: true });
  fs.symlinkSync(outsideRoot, escapedClient, process.platform === "win32" ? "junction" : "dir");
  t.after(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  });

  let terminalCalls = 0;
  const { route } = loadHostedRoute(path.resolve(__dirname, "../terminal/exec/route.ts"), {
    "@/lib/config": {
      getConfig: () => ({ aiOsDir: workspaceRoot }),
      getClientAiOsDir: (clientId) => clientId ? escapedClient : workspaceRoot,
    },
    "@/lib/clients": { assertValidClientId: (value) => value ?? null },
    "@/lib/db": {
      getActiveLocalProfileDescriptor: () => ({ mode: "solo", profileKey: "solo" }),
      getDb: () => { throw new Error("free terminal must not read task data"); },
    },
    "@/lib/task-archive": { isTaskArchived: () => false },
    "@/lib/task-file-access": { resolveTaskWorkspace: () => null },
    "@/lib/identity/work-scope": {
      assertNoWorkScopeInput() {},
      captureNewWorkScope: async (clientId) => ({
        clientId,
        scope: { mode: "solo", version: 1, clientId },
      }),
      inheritWorkScope: () => { throw new Error("free scope should not be inherited"); },
      isWorkScopeError: () => false,
      workScopeErrorBody: (error) => ({ code: error.code, error: error.message }),
    },
    "@/lib/terminal-sessions": {
      createSession: () => { terminalCalls += 1; },
      getSession: () => null,
      sendInput: () => false,
      subscribe: () => () => {},
      destroySession: () => {},
      resolveTaskTerminalCwd: () => "unused",
    },
  });

  const clientResponse = await route.POST(request("http://localhost/api/terminal/exec", {
    action: "create",
    sessionId: "escaped-client",
    clientId: "escaped",
  }));
  const cwdResponse = await route.POST(request("http://localhost/api/terminal/exec", {
    action: "create",
    sessionId: "escaped-cwd",
    cwd: escapedClient,
  }));

  assert.equal(clientResponse.status, 400);
  assert.equal(cwdResponse.status, 400);
  assert.equal(terminalCalls, 0);
});

test("terminal creation derives client scope from the root Goal", async () => {
  let terminalTask = null;
  let createdOptions = null;
  const { route } = loadHostedRoute(path.resolve(__dirname, "../terminal/exec/route.ts"), {
    "@/lib/config": {
      getConfig: () => ({ aiOsDir: process.cwd() }),
      getClientAiOsDir: () => process.cwd(),
    },
    "@/lib/clients": {
      assertValidClientId: (value) => value ?? null,
    },
    "@/lib/db": {
      getActiveLocalProfileDescriptor: () => ({ mode: "solo", profileKey: "solo" }),
      getDb: () => ({
        prepare: () => ({
          get: () => ({ id: "child", clientId: "client-b", workScope: null, worktreePath: "C:/root/.worktrees/child" }),
        }),
      }),
    },
    "@/lib/task-archive": { isTaskArchived: () => false },
    "@/lib/task-file-access": {
      resolveTaskWorkspace: () => ({ root: { clientId: "client-a" } }),
    },
    "@/lib/identity/work-scope": {
      assertNoWorkScopeInput() {},
      captureNewWorkScope: async () => { throw new Error("free scope should not be captured"); },
      inheritWorkScope: () => ({
        clientId: "client-a",
        scope: { mode: "solo", version: 1, clientId: "client-a" },
      }),
      isWorkScopeError: () => false,
      workScopeErrorBody: (error) => ({ code: error.code, error: error.message }),
    },
    "@/lib/terminal-sessions": {
      createSession: (_id, options) => {
        createdOptions = options;
        throw new Error("stop before opening a real stream");
      },
      getSession: () => null,
      sendInput: () => false,
      subscribe: () => () => {},
      destroySession: () => {},
      resolveTaskTerminalCwd: (task) => {
        terminalTask = task;
        return process.cwd();
      },
    },
  });

  const response = await route.POST(request("http://localhost/api/terminal/exec", {
    action: "create",
    sessionId: "root-scoped",
    taskId: "child",
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(terminalTask, {
    clientId: "client-a",
    worktreePath: "C:/root/.worktrees/child",
  });
  assert.equal(createdOptions.cwd, process.cwd());
  assert.equal(createdOptions.workScope.clientId, "client-a");
});

test("terminal creation fails closed when the task tree has no valid root", async () => {
  let terminalCalls = 0;
  const { route } = loadHostedRoute(path.resolve(__dirname, "../terminal/exec/route.ts"), {
    "@/lib/clients": { assertValidClientId: (value) => value ?? null },
    "@/lib/db": {
      getActiveLocalProfileDescriptor: () => ({ mode: "solo", profileKey: "solo" }),
      getDb: () => ({
        prepare: () => ({ get: () => ({ id: "cyclic", clientId: null, worktreePath: null }) }),
      }),
    },
    "@/lib/task-archive": { isTaskArchived: () => false },
    "@/lib/task-file-access": { resolveTaskWorkspace: () => null },
    "@/lib/identity/work-scope": {
      assertNoWorkScopeInput() {},
      captureNewWorkScope: async () => { throw new Error("free scope should not be captured"); },
      inheritWorkScope: () => { throw new Error("scope should not be inherited for an invalid tree"); },
      isWorkScopeError: () => false,
      workScopeErrorBody: (error) => ({ code: error.code, error: error.message }),
    },
    "@/lib/terminal-sessions": {
      createSession: () => { terminalCalls += 1; },
      getSession: () => null,
      sendInput: () => false,
      subscribe: () => () => {},
      destroySession: () => {},
      resolveTaskTerminalCwd: () => { terminalCalls += 1; return "unused"; },
    },
  });

  const response = await route.POST(request("http://localhost/api/terminal/exec", {
    action: "create",
    sessionId: "invalid-tree",
    taskId: "cyclic",
  }));

  assert.equal(response.status, 404);
  assert.match(await response.text(), /Task workspace not found/);
  assert.equal(terminalCalls, 0);
});

test("hosted mode blocks script listing and execution before registry or subprocess access", async () => {
  let registryCalls = 0;
  let subprocessCalls = 0;

  const list = loadHostedRoute(path.resolve(__dirname, "../settings/scripts/route.ts"), {
    "@/lib/script-registry": {
      SCRIPT_REGISTRY: [{ id: "memory-setup" }],
    },
  });
  const listResponse = await list.route.GET();
  assert.equal(listResponse.status, 403);

  const run = loadHostedRoute(path.resolve(__dirname, "../settings/scripts/run/route.ts"), {
    "@/lib/script-registry": {
      getScriptById: () => {
        registryCalls += 1;
        return { id: "memory-setup", file: "setup-memory.sh", args: [] };
      },
    },
    "@/lib/subprocess": {
      spawnUiProcess: () => {
        subprocessCalls += 1;
        throw new Error("should not spawn");
      },
    },
  });
  const runResponse = await run.route.POST(request("http://localhost/api/settings/scripts/run", {
    scriptId: "memory-setup",
  }));

  assert.equal(runResponse.status, 403);
  assert.equal(registryCalls, 0);
  assert.equal(subprocessCalls, 0);
});

test("hosted mode blocks broad file listing and preview before filesystem helpers run", async () => {
  let fileCalls = 0;

  const files = loadHostedRoute(path.resolve(__dirname, "../files/route.ts"), {
    "@/lib/file-service": {
      listDirectory: () => {
        fileCalls += 1;
        return [];
      },
      normalizeRelativePath: (value) => String(value),
    },
  });
  const listResponse = await files.route.GET(request("http://localhost/api/files?dir=context"));
  assert.equal(listResponse.status, 403);

  const preview = loadHostedRoute(path.resolve(__dirname, "../files/preview/route.ts"), {
    "@/lib/db": {
      getActiveLocalProfileDescriptor: () => ({
        version: 1,
        mode: "solo",
        profileKey: "solo",
        dataDir: "C:/workspace/.command-centre",
      }),
      getDb: () => {
        fileCalls += 1;
        return { prepare: () => ({ get: () => null }) };
      },
    },
    "@/lib/identity/work-scope": {
      isWorkScopeError: () => false,
      readWorkScopeFromRow: () => ({ mode: "solo", version: 1, clientId: null }),
      workScopeErrorBody: (error) => ({ code: error.code, error: error.message }),
    },
  });
  const previewResponse = await preview.route.GET(
    request("http://localhost/api/files/preview?path=context/MEMORY.md"),
  );
  assert.equal(previewResponse.status, 403);

  assert.equal(fileCalls, 0);
});

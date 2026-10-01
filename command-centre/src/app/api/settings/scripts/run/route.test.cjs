const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../../../lib/test-utils/load-ts-module.cjs");

function createProcessHarness() {
  const processes = [];

  return {
    processes,
    spawnUiProcess(command, args, options) {
      const proc = new EventEmitter();
      proc.command = command;
      proc.args = args;
      proc.options = options;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdin = {
        end() {},
      };
      processes.push(proc);
      return proc;
    },
  };
}

const teamModeStub = {
  isHostedTeamMode: () => false,
  hostedModeForbiddenResponse: () => ({ status: 403 }),
};

function createFsHarness({ envExists = true, envContent = "" } = {}) {
  let nextEnvContent = envContent;
  let tempContent = "";

  return {
    get envContent() {
      return nextEnvContent;
    },
    existsSync(file) {
      if (String(file).endsWith(".env")) return envExists;
      return true;
    },
    readFileSync(file) {
      if (String(file).endsWith(".env")) return nextEnvContent;
      return "";
    },
    writeFileSync(file, content) {
      if (String(file).endsWith(".env.tmp")) {
        tempContent = content;
      }
    },
    renameSync(from, to) {
      if (String(from).endsWith(".env.tmp") && String(to).endsWith(".env")) {
        nextEnvContent = tempContent;
      }
    },
  };
}

function loadRouteWithScript({ scriptId, scriptFile, scriptArgs = [], harness, fsHarness }) {
  const modulePath = path.resolve(__dirname, "route.ts");
  return loadTsModule(modulePath, {
    stubs: {
      "next/server": createNextServerStub(),
      "fs": fsHarness || {
        existsSync() {
          return true;
        },
      },
      "@/lib/config": {
        getConfig() {
          return { aiOsDir: "/AI-OS" };
        },
      },
      "@/lib/script-registry": {
        getScriptById(id) {
          if (id !== scriptId) return undefined;
          return {
            id: scriptId,
            file: scriptFile,
            args: scriptArgs,
          };
        },
      },
      "@/lib/subprocess": {
        spawnUiProcess: harness.spawnUiProcess,
      },
      "@/lib/team-mode": teamModeStub,
    },
  });
}

function createNextServerStub() {
  return {
    NextRequest: class {},
    NextResponse: {
      json(body, init = {}) {
        return {
          status: init.status ?? 200,
          body,
          async json() {
            return body;
          },
        };
      },
    },
  };
}

function createRequest(body) {
  return {
    async json() {
      return body;
    },
  };
}

test("settings script route rejects concurrent runs but clears after process close", async () => {
  const harness = createProcessHarness();
  const modulePath = path.resolve(__dirname, "route.ts");
  const route = loadTsModule(modulePath, {
    stubs: {
      "next/server": createNextServerStub(),
      "fs": {
        existsSync() {
          return true;
        },
      },
      "@/lib/config": {
        getConfig() {
          return { aiOsDir: "/AI-OS" };
        },
      },
      "@/lib/script-registry": {
        getScriptById(scriptId) {
          if (scriptId !== "add-client") return undefined;
          return {
            id: "add-client",
            file: "add-client.sh",
            args: [{ name: "clientName", label: "Client Name", required: true }],
          };
        },
      },
      "@/lib/subprocess": {
        spawnUiProcess: harness.spawnUiProcess,
      },
      "@/lib/team-mode": teamModeStub,
    },
  });

  const firstResponse = await route.POST(createRequest({
    scriptId: "add-client",
    args: { clientName: "Acme" },
  }));
  assert.equal(firstResponse.status, 200);

  const concurrentResponse = await route.POST(createRequest({
    scriptId: "add-client",
    args: { clientName: "Beta" },
  }));
  assert.equal(concurrentResponse.status, 409);
  assert.deepEqual(await concurrentResponse.json(), { error: "Script already running" });

  harness.processes[0].emit("close", 0);
  if (firstResponse.body) {
    await firstResponse.body.cancel().catch(() => {});
  }

  const secondResponse = await route.POST(createRequest({
    scriptId: "add-client",
    args: { clientName: "Beta" },
  }));
  assert.equal(secondResponse.status, 200);
});

test("settings script route finalizes safely when error and close both fire", async () => {
  const harness = createProcessHarness();
  const modulePath = path.resolve(__dirname, "route.ts");
  const route = loadTsModule(modulePath, {
    stubs: {
      "next/server": createNextServerStub(),
      "fs": {
        existsSync() {
          return true;
        },
      },
      "@/lib/config": {
        getConfig() {
          return { aiOsDir: "/AI-OS" };
        },
      },
      "@/lib/script-registry": {
        getScriptById(scriptId) {
          if (scriptId !== "add-client") return undefined;
          return {
            id: "add-client",
            file: "add-client.sh",
            args: [{ name: "clientName", label: "Client Name", required: true }],
          };
        },
      },
      "@/lib/subprocess": {
        spawnUiProcess: harness.spawnUiProcess,
      },
      "@/lib/team-mode": teamModeStub,
    },
  });

  const response = await route.POST(createRequest({
    scriptId: "add-client",
    args: { clientName: "Gamma" },
  }));
  assert.equal(response.status, 200);

  harness.processes[0].emit("error", new Error("boom"));
  harness.processes[0].emit("close", 0);
  if (response.body) {
    await response.body.cancel().catch(() => {});
  }

  const nextResponse = await route.POST(createRequest({
    scriptId: "add-client",
    args: { clientName: "Delta" },
  }));
  assert.equal(nextResponse.status, 200);
});

test("settings script route passes update token through env only", async () => {
  const harness = createProcessHarness();
  const modulePath = path.resolve(__dirname, "route.ts");
  const route = loadTsModule(modulePath, {
    stubs: {
      "next/server": createNextServerStub(),
      "fs": {
        existsSync() {
          return true;
        },
      },
      "@/lib/config": {
        getConfig() {
          return { aiOsDir: "/AI-OS" };
        },
      },
      "@/lib/script-registry": {
        getScriptById(scriptId) {
          if (scriptId !== "update") return undefined;
          return {
            id: "update",
            file: "update.sh",
            args: [],
          };
        },
      },
      "@/lib/subprocess": {
        spawnUiProcess: harness.spawnUiProcess,
      },
      "@/lib/team-mode": teamModeStub,
    },
  });

  const response = await route.POST(createRequest({
    scriptId: "update",
    env: {
      AI_OS_UPDATE_TOKEN: "  new-token-123  ",
      UNSAFE_TOKEN_TEST: "do-not-pass",
    },
  }));
  assert.equal(response.status, 200);
  assert.equal(harness.processes.length, 1);

  const spawned = harness.processes[0];
  assert.equal(spawned.command, "bash");
  assert.deepEqual(spawned.args.slice(1), []);
  assert.equal(spawned.options.env.AI_OS_UPDATE_TOKEN, "new-token-123");
  assert.equal(spawned.options.env.UNSAFE_TOKEN_TEST, undefined);
  assert.equal(JSON.stringify(spawned.args).includes("new-token-123"), false);

  spawned.emit("close", 0);
  if (response.body) {
    await response.body.cancel().catch(() => {});
  }
});

test("settings script route runs memory setup status check mode", async () => {
  const harness = createProcessHarness();
  const route = loadRouteWithScript({
    scriptId: "memory-setup",
    scriptFile: "setup-memory.sh",
    harness,
    fsHarness: createFsHarness(),
  });

  const response = await route.POST(createRequest({
    scriptId: "memory-setup",
    args: { mode: "check" },
  }));
  assert.equal(response.status, 200);
  assert.equal(harness.processes.length, 1);

  const spawned = harness.processes[0];
  assert.equal(spawned.command, "bash");
  assert.deepEqual(spawned.args.slice(1), ["--check"]);
  assert.equal(spawned.options.env.MEMORY_DATABASE_URL, undefined);

  spawned.emit("close", 0);
  if (response.body) {
    await response.body.cancel().catch(() => {});
  }
});

test("settings script route runs memory setup local mode", async () => {
  const harness = createProcessHarness();
  const route = loadRouteWithScript({
    scriptId: "memory-setup",
    scriptFile: "setup-memory.sh",
    harness,
    fsHarness: createFsHarness(),
  });

  const response = await route.POST(createRequest({
    scriptId: "memory-setup",
    args: { mode: "local" },
  }));
  assert.equal(response.status, 200);
  assert.equal(harness.processes.length, 1);

  const spawned = harness.processes[0];
  assert.equal(spawned.command, "bash");
  assert.deepEqual(spawned.args.slice(1), ["--backend", "local", "--yes"]);

  spawned.emit("close", 0);
  if (response.body) {
    await response.body.cancel().catch(() => {});
  }
});

test("settings script route runs memory setup hosted mode and saves URL to env", async () => {
  const harness = createProcessHarness();
  const fsHarness = createFsHarness({
    envContent: "# Add your API keys here.\nOTHER_KEY=value\n",
  });
  const route = loadRouteWithScript({
    scriptId: "memory-setup",
    scriptFile: "setup-memory.sh",
    harness,
    fsHarness,
  });
  const url = "postgres://user:pass@db.example.com:5432/ai_memory";

  const response = await route.POST(createRequest({
    scriptId: "memory-setup",
    args: {
      mode: "postgres",
      memoryDatabaseUrl: `  ${url}  `,
    },
    env: {
      UNSAFE_MEMORY_ENV_TEST: "do-not-pass",
    },
  }));
  assert.equal(response.status, 200);
  assert.equal(harness.processes.length, 1);

  const spawned = harness.processes[0];
  assert.equal(spawned.command, "bash");
  assert.deepEqual(spawned.args.slice(1), ["--backend", "postgres", "--yes"]);
  assert.equal(spawned.options.env.MEMORY_DATABASE_URL, url);
  assert.equal(spawned.options.env.UNSAFE_MEMORY_ENV_TEST, undefined);
  assert.equal(JSON.stringify(spawned.args).includes(url), false);
  assert.match(fsHarness.envContent, /^MEMORY_DATABASE_URL=postgres:\/\/user:pass@db\.example\.com:5432\/ai_memory$/m);
  assert.match(fsHarness.envContent, /^OTHER_KEY=value$/m);

  spawned.emit("close", 0);
  if (response.body) {
    await response.body.cancel().catch(() => {});
  }
});

test("settings script route rejects invalid memory setup mode", async () => {
  const harness = createProcessHarness();
  const route = loadRouteWithScript({
    scriptId: "memory-setup",
    scriptFile: "setup-memory.sh",
    harness,
    fsHarness: createFsHarness(),
  });

  const response = await route.POST(createRequest({
    scriptId: "memory-setup",
    args: { mode: "remote" },
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid memory setup mode" });
  assert.equal(harness.processes.length, 0);
});

test("settings script route allows only safe memory setup env values", async () => {
  const harness = createProcessHarness();
  const route = loadRouteWithScript({
    scriptId: "memory-setup",
    scriptFile: "setup-memory.sh",
    harness,
    fsHarness: createFsHarness(),
  });
  const url = "postgres://user:pass@db.example.com:5432/ai_memory";

  const response = await route.POST(createRequest({
    scriptId: "memory-setup",
    args: { mode: "local" },
    env: {
      MEMORY_DATABASE_URL: ` ${url} `,
      UNSAFE_MEMORY_ENV_TEST: "do-not-pass",
    },
  }));
  assert.equal(response.status, 200);
  assert.equal(harness.processes.length, 1);

  const spawned = harness.processes[0];
  assert.deepEqual(spawned.args.slice(1), ["--backend", "local", "--yes"]);
  assert.equal(spawned.options.env.MEMORY_DATABASE_URL, url);
  assert.equal(spawned.options.env.UNSAFE_MEMORY_ENV_TEST, undefined);
  assert.equal(JSON.stringify(spawned.args).includes(url), false);

  spawned.emit("close", 0);
  if (response.body) {
    await response.body.cancel().catch(() => {});
  }
});

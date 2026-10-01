const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");

const { loadTsModule: loadTsModuleRaw } = require("./test-utils/load-ts-module.cjs");

const taskArchive = loadTsModuleRaw(path.resolve(__dirname, "task-archive.ts"));
const routesRoot = path.resolve(__dirname, "../app/api");

function createDb(tasks) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'backlog',
      level TEXT NOT NULL DEFAULT 'task',
      parentId TEXT,
      projectSlug TEXT,
      columnOrder INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      archivedAt TEXT,
      clientId TEXT,
      workScope TEXT,
      needsInput INTEGER NOT NULL DEFAULT 0,
      phaseNumber INTEGER,
      gsdStep TEXT,
      costUsd REAL,
      tokensUsed INTEGER,
      durationMs INTEGER,
      activityLabel TEXT,
      errorMessage TEXT,
      startedAt TEXT,
      completedAt TEXT,
      cronJobSlug TEXT,
      dependsOnTaskIds TEXT,
      permissionMode TEXT,
      executionPermissionMode TEXT,
      model TEXT,
      thinkingEffort TEXT
    );
  `);

  const insert = db.prepare(`
    INSERT INTO tasks (
      id, title, status, level, parentId, projectSlug, columnOrder,
      createdAt, updatedAt, archivedAt, clientId, needsInput, phaseNumber,
      gsdStep, activityLabel, completedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
  `);

  for (const task of tasks) {
    insert.run(
      task.id,
      task.title ?? task.id,
      task.status ?? "backlog",
      task.level ?? "project",
      task.parentId ?? null,
      task.projectSlug ?? null,
      task.columnOrder ?? 0,
      task.createdAt ?? "2026-07-13T00:00:00.000Z",
      task.updatedAt ?? "2026-07-13T00:00:00.000Z",
      task.archivedAt ?? null,
      task.clientId ?? null,
      task.phaseNumber ?? null,
      task.gsdStep ?? null,
      task.activityLabel ?? null,
      task.completedAt ?? null,
    );
  }

  return db;
}

function totalChanges(db) {
  return db.prepare("SELECT total_changes() AS count").get().count;
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-archived-routes-"));
}

function writeBrief(rootDir, slug, content) {
  const briefPath = path.join(rootDir, "projects", "briefs", slug, "brief.md");
  fs.mkdirSync(path.dirname(briefPath), { recursive: true });
  fs.writeFileSync(briefPath, content);
  return briefPath;
}

function jsonRequest(url, body) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function normalizeClientId(clientId) {
  return !clientId || clientId === "root" ? null : clientId;
}

function soloWorkScope(clientId) {
  return { mode: "solo", version: 1, clientId: normalizeClientId(clientId) };
}

function inheritTestScope(row) {
  const scope = row?.workScope
    ? typeof row.workScope === "string" ? JSON.parse(row.workScope) : row.workScope
    : soloWorkScope(row?.clientId);
  const clientId = scope.mode === "team" ? scope.scope.clientId : scope.clientId;
  return { scope, serialized: JSON.stringify(scope), clientId };
}

const workScopeStubs = {
  assertNoWorkScopeInput() {},
  async captureNewWorkScope(clientId) {
    const scope = soloWorkScope(clientId);
    return { scope, serialized: JSON.stringify(scope), clientId: scope.clientId };
  },
  getTeamIdForWorkScope: () => null,
  inheritWorkScope: inheritTestScope,
  isWorkScopeError: () => false,
  readWorkScopeFromRow: (row) => inheritTestScope(row).scope,
  workScopeErrorBody: (error) => ({ code: error.code, error: error.message }),
};

class MaterializedFileAccessError extends Error {}

const materializedFileStubs = {
  assertMaterializedPathAccessible() {},
  isMaterializedPathAccessible: () => true,
  registerMaterializedFiles() {},
  MaterializedFileAccessError,
};

function loadTsModule(modulePath, options = {}) {
  return loadTsModuleRaw(modulePath, {
    ...options,
    stubs: {
      "@/lib/identity/work-scope": workScopeStubs,
      "@/lib/materialized-file-ownership": materializedFileStubs,
      ...(options.stubs ?? {}),
    },
  });
}

function commonRouteStubs(db, rootDir, events) {
  return {
    "@/lib/db": { getDb: () => db },
    "@/lib/config": {
      getConfig: () => ({ aiOsDir: rootDir }),
      getClientAiOsDir: () => rootDir,
    },
    "@/lib/event-bus": { emitTaskEvent: (event) => events.push(event) },
    "@/lib/permission-mode": {
      getActivePermissionMode: (mode, fallback) => mode ?? fallback,
      getExecutionPermissionMode: (mode, fallback) => mode ?? fallback,
    },
    "@/lib/task-archive": taskArchive,
    "@/lib/clients": { normalizeClientId },
    "@/lib/identity/work-scope": workScopeStubs,
    "@/lib/materialized-file-ownership": materializedFileStubs,
  };
}

test("brief sync actions return 409 for an archived Goal without file or database writes", async () => {
  const db = createDb([{
    id: "goal-archived",
    projectSlug: "archived-project",
    archivedAt: "2026-07-13T01:00:00.000Z",
  }]);
  const writes = [];
  const before = totalChanges(db);
  const route = loadTsModule(path.join(routesRoot, "briefs", "sync", "route.ts"), {
    stubs: {
      "@/lib/db": { getDb: () => db },
      "@/lib/config": { getClientAiOsDir: () => "C:/workspace" },
      "@/lib/file-service": {
        readFile: () => ({ content: "## Deliverables\n- [ ] Existing", lastModified: "old" }),
        writeFile: (...args) => writes.push(args),
      },
      "@/lib/brief-sync": {
        parseDeliverables: () => ["Existing"],
        appendDeliverable: (content) => `${content}\n- [ ] New`,
        findNewDeliverables: () => ["New"],
        toggleDeliverableCheckbox: (content) => content.replace("[ ]", "[x]"),
      },
      "@/lib/task-archive": taskArchive,
      "@/lib/clients": { normalizeClientId },
    },
  });

  try {
    const actions = [
      { action: "sync-deliverables-to-tasks" },
      { action: "add-to-brief", deliverable: "New" },
      { action: "mark-deliverable", subtaskTitle: "Existing", checked: true },
    ];

    for (const action of actions) {
      const response = await route.POST(jsonRequest("http://localhost/api/briefs/sync", {
        ...action,
        projectSlug: "archived-project",
        parentId: "goal-archived",
      }));
      const body = await response.json();
      assert.equal(response.status, 409);
      assert.match(body.error, /Restore this Goal/);
    }

    assert.equal(totalChanges(db), before);
    assert.equal(writes.length, 0);
  } finally {
    db.close();
  }
});

test("tasks-from-brief returns 409 for an archived Goal before inserting subtasks", async () => {
  const rootDir = tempRoot();
  const db = createDb([{
    id: "goal-archived",
    projectSlug: "archived-project",
    archivedAt: "2026-07-13T01:00:00.000Z",
  }]);
  const events = [];

  try {
    const before = totalChanges(db);
    const route = loadTsModule(
      path.join(routesRoot, "projects", "[slug]", "tasks-from-brief", "route.ts"),
      { stubs: commonRouteStubs(db, rootDir, events) },
    );

    const response = await route.POST(
      jsonRequest("http://localhost/api/projects/archived-project/tasks-from-brief", {}),
      { params: Promise.resolve({ slug: "archived-project" }) },
    );
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.match(body.error, /Restore this Goal/);
    assert.equal(totalChanges(db), before);
    assert.equal(events.length, 0);
  } finally {
    db.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("tasks-from-scope returns 409 for an archived Goal before creating a parent or child", async () => {
  const rootDir = tempRoot();
  const db = createDb([{
    id: "goal-archived",
    projectSlug: "archived-project",
    archivedAt: "2026-07-13T01:00:00.000Z",
  }]);
  const events = [];

  try {
    const before = totalChanges(db);
    const route = loadTsModule(
      path.join(routesRoot, "projects", "[slug]", "tasks-from-scope", "route.ts"),
      { stubs: commonRouteStubs(db, rootDir, events) },
    );

    const response = await route.POST(
      jsonRequest("http://localhost/api/projects/archived-project/tasks-from-scope", {
        scope: { suggestedSubtasks: [{ title: "Should not exist" }] },
      }),
      { params: Promise.resolve({ slug: "archived-project" }) },
    );
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.match(body.error, /Restore this Goal/);
    assert.equal(totalChanges(db), before);
    assert.equal(events.length, 0);
  } finally {
    db.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("phase-status returns 409 for an archived Goal before changing ROADMAP.md or tasks", async () => {
  const rootDir = tempRoot();
  const planningDir = path.join(rootDir, "projects", "briefs", "archived-gsd", ".planning");
  const roadmapPath = path.join(planningDir, "ROADMAP.md");
  const originalRoadmap = [
    "# Roadmap: Archived GSD",
    "",
    "## Progress",
    "| Phase | Status | Date |",
    "| 1. First phase | work | Not Started | - |",
    "",
    "- [ ] **Phase 1: First phase**",
  ].join("\n");
  fs.mkdirSync(planningDir, { recursive: true });
  fs.writeFileSync(roadmapPath, originalRoadmap);

  const db = createDb([{
    id: "goal-archived",
    level: "gsd",
    projectSlug: "archived-gsd",
    archivedAt: "2026-07-13T01:00:00.000Z",
  }]);
  const events = [];
  const before = totalChanges(db);
  const route = loadTsModule(path.join(routesRoot, "gsd", "phase-status", "route.ts"), {
    stubs: {
      "@/lib/config": {
        resolvePlanningDir: () => ({ planningDir, projectSlug: "archived-gsd" }),
      },
      "@/lib/db": { getDb: () => db },
      "@/lib/event-bus": { emitTaskEvent: (event) => events.push(event) },
      "@/lib/task-archive": taskArchive,
      "@/lib/clients": { normalizeClientId },
    },
  });

  try {
    const response = await route.PATCH({
      json: async () => ({ phaseNumber: 1, status: "complete" }),
      nextUrl: new URL("http://localhost/api/gsd/phase-status?project=archived-gsd"),
    });
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.match(body.error, /Restore this Goal/);
    assert.equal(fs.readFileSync(roadmapPath, "utf-8"), originalRoadmap);

    fs.unlinkSync(roadmapPath);
    const missingRoadmapResponse = await route.PATCH({
      json: async () => ({ phaseNumber: 1, status: "complete" }),
      nextUrl: new URL("http://localhost/api/gsd/phase-status?project=archived-gsd"),
    });
    assert.equal(missingRoadmapResponse.status, 409);
    assert.equal(totalChanges(db), before);
    assert.equal(events.length, 0);
  } finally {
    db.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("sync-projects skips archived Goals, continues other projects, and reports the count", async () => {
  const rootDir = tempRoot();
  const brief = (name, deliverable) => [
    "---",
    `project: ${name}`,
    "status: active",
    "level: 2",
    "---",
    `# ${name}`,
    "",
    "## Goal",
    "Keep going.",
    "",
    "## Deliverables",
    `- [ ] ${deliverable}`,
    "",
    "## Acceptance criteria",
    "- Complete",
  ].join("\n");
  writeBrief(rootDir, "archived-project", brief("Archived project", "Archived result"));
  writeBrief(rootDir, "active-project", brief("Active project", "Active result"));

  const db = createDb([
    {
      id: "goal-archived",
      projectSlug: "archived-project",
      archivedAt: "2026-07-13T01:00:00.000Z",
    },
    {
      id: "goal-active",
      projectSlug: "active-project",
    },
  ]);
  const events = [];
  const before = totalChanges(db);
  const route = loadTsModule(path.join(routesRoot, "tasks", "sync-projects", "route.ts"), {
    stubs: {
      ...commonRouteStubs(db, rootDir, events),
      "@/lib/config": {
        getConfig: () => ({ aiOsDir: rootDir }),
        getClientAiOsDir: () => rootDir,
        resolvePlanningDir: () => null,
      },
      "@/lib/gsd-parser": { parseRoadmap: () => [] },
      "@/lib/task-status-transitions": { getGsdSyncedTaskStatus: () => "backlog" },
    },
  });

  try {
    const response = await route.POST(
      jsonRequest("http://localhost/api/tasks/sync-projects", {}),
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { synced: 0, skippedArchived: 1 });
    assert.equal(totalChanges(db), before + 1);
    assert.deepEqual(
      db.prepare("SELECT parentId, title FROM tasks WHERE parentId IS NOT NULL ORDER BY title").all(),
      [{ parentId: "goal-active", title: "Active result" }],
    );
    assert.equal(events.length, 0);
  } finally {
    db.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("ensure-task returns the archived result without updating the Goal or creating phase tasks", async () => {
  const rootDir = tempRoot();
  const briefDir = path.join(rootDir, "projects", "briefs", "archived-gsd");
  const planningDir = path.join(briefDir, ".planning");
  fs.mkdirSync(planningDir, { recursive: true });
  fs.writeFileSync(path.join(briefDir, "brief.md"), "---\nstatus: active\nlevel: 3\n---\n# Archived GSD\n");
  fs.writeFileSync(path.join(planningDir, "ROADMAP.md"), "# Roadmap: Archived GSD\n");

  const db = createDb([{
    id: "goal-archived",
    title: "Archived GSD",
    status: "done",
    level: "gsd",
    projectSlug: "archived-gsd",
    archivedAt: "2026-07-13T01:00:00.000Z",
  }]);
  const events = [];
  const before = totalChanges(db);
  const route = loadTsModule(path.join(routesRoot, "gsd", "ensure-task", "route.ts"), {
    stubs: {
      "@/lib/db": { getDb: () => db },
      "@/lib/config": {
        getConfig: () => ({ aiOsDir: rootDir }),
        resolvePlanningDir: () => ({ planningDir, projectSlug: "archived-gsd" }),
      },
      "@/lib/gsd-parser": {
        parseRoadmap: () => [{ number: 1, name: "First phase", status: "not-started", plans: [] }],
      },
      "@/lib/event-bus": { emitTaskEvent: (event) => events.push(event) },
      "@/lib/permission-mode": {
        getActivePermissionMode: (mode, fallback) => mode ?? fallback,
        getExecutionPermissionMode: (mode, fallback) => mode ?? fallback,
      },
      "@/lib/task-status-transitions": {
        getGsdSyncedTaskStatus: () => "backlog",
        shouldApplySyncedTaskStatus: () => false,
      },
      "@/lib/task-archive": taskArchive,
      "@/lib/clients": { normalizeClientId },
    },
  });

  try {
    const response = await route.POST(
      new Request("http://localhost/api/gsd/ensure-task?project=archived-gsd", { method: "POST" }),
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      synced: false,
      reason: "archived",
      parentTaskId: "goal-archived",
    });

    fs.unlinkSync(path.join(planningDir, "ROADMAP.md"));
    const missingRoadmapResponse = await route.POST(
      new Request("http://localhost/api/gsd/ensure-task?project=archived-gsd", { method: "POST" }),
    );
    assert.deepEqual(await missingRoadmapResponse.json(), {
      synced: false,
      reason: "archived",
      parentTaskId: "goal-archived",
    });
    assert.equal(totalChanges(db), before);
    assert.equal(events.length, 0);
  } finally {
    db.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("tasks-from-brief selects the Goal for the requested client and inherits its scope", async () => {
  const rootDir = tempRoot();
  const db = createDb([
    { id: "root-goal", projectSlug: "shared-project", clientId: null },
    { id: "client-goal", projectSlug: "shared-project", clientId: "client-a" },
  ]);
  const events = [];

  try {
    writeBrief(
      rootDir,
      "shared-project",
      "# Shared project\n\n## Deliverables\n- Client result\n\n## Acceptance criteria\n- Complete\n",
    );
    const route = loadTsModule(
      path.join(routesRoot, "projects", "[slug]", "tasks-from-brief", "route.ts"),
      { stubs: commonRouteStubs(db, rootDir, events) },
    );

    const response = await route.POST(
      jsonRequest("http://localhost/api/projects/shared-project/tasks-from-brief", {
        clientId: "client-a",
      }),
      { params: Promise.resolve({ slug: "shared-project" }) },
    );
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.taskIds.length, 1);
    assert.deepEqual(
      db.prepare("SELECT parentId, projectSlug, clientId FROM tasks WHERE id = ?").get(body.taskIds[0]),
      { parentId: "client-goal", projectSlug: "shared-project", clientId: "client-a" },
    );
    assert.equal(events.length, 1);
  } finally {
    db.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("explicit parent IDs cannot cross client or project boundaries", async () => {
  const rootDir = tempRoot();
  const db = createDb([
    { id: "root-goal", projectSlug: "shared-project", clientId: null },
    { id: "other-project", projectSlug: "other-project", clientId: "client-a" },
  ]);
  const events = [];
  const reads = [];
  const writes = [];

  try {
    const scopeRoute = loadTsModule(
      path.join(routesRoot, "projects", "[slug]", "tasks-from-scope", "route.ts"),
      { stubs: commonRouteStubs(db, rootDir, events) },
    );
    const scopeResponse = await scopeRoute.POST(
      jsonRequest("http://localhost/api/projects/shared-project/tasks-from-scope", {
        clientId: "client-a",
        parentTaskId: "root-goal",
        scope: { suggestedSubtasks: [{ title: "Must not be created" }] },
      }),
      { params: Promise.resolve({ slug: "shared-project" }) },
    );
    assert.equal(scopeResponse.status, 404);

    const briefRoute = loadTsModule(path.join(routesRoot, "briefs", "sync", "route.ts"), {
      stubs: {
        "@/lib/db": { getDb: () => db },
        "@/lib/config": { getClientAiOsDir: () => rootDir },
        "@/lib/file-service": {
          readFile: (...args) => {
            reads.push(args);
            return { content: "## Deliverables\n- [ ] Existing", lastModified: "old" };
          },
          writeFile: (...args) => writes.push(args),
        },
        "@/lib/brief-sync": {
          parseDeliverables: () => ["Existing"],
          appendDeliverable: (content) => content,
          findNewDeliverables: () => [],
          toggleDeliverableCheckbox: (content) => content,
        },
        "@/lib/task-archive": taskArchive,
        "@/lib/clients": { normalizeClientId },
      },
    });
    const briefResponse = await briefRoute.POST(jsonRequest("http://localhost/api/briefs/sync", {
      action: "add-to-brief",
      projectSlug: "other-project",
      parentId: "root-goal",
      clientId: "client-a",
      deliverable: "Must not be written",
    }));

    assert.equal(briefResponse.status, 404);
    assert.equal(reads.length, 0);
    assert.equal(writes.length, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE parentId IS NOT NULL").get().count, 0);
    assert.equal(events.length, 0);
  } finally {
    db.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("sync-projects scopes same-slug Goals to the normalized client", async () => {
  const rootDir = tempRoot();
  const brief = [
    "---",
    "project: Shared project",
    "status: active",
    "level: 2",
    "---",
    "# Shared project",
    "",
    "## Goal",
    "Keep client work isolated.",
    "",
    "## Deliverables",
    "- [ ] Client-only result",
    "",
    "## Acceptance criteria",
    "- Complete",
  ].join("\n");
  writeBrief(rootDir, "shared-project", brief);
  const db = createDb([
    {
      id: "root-archived",
      projectSlug: "shared-project",
      clientId: null,
      archivedAt: "2026-07-13T01:00:00.000Z",
    },
    { id: "client-active", projectSlug: "shared-project", clientId: "client-a" },
  ]);
  const events = [];
  const route = loadTsModule(path.join(routesRoot, "tasks", "sync-projects", "route.ts"), {
    stubs: {
      ...commonRouteStubs(db, rootDir, events),
      "@/lib/config": {
        getConfig: () => ({ aiOsDir: rootDir }),
        getClientAiOsDir: () => rootDir,
        resolvePlanningDir: () => null,
      },
      "@/lib/gsd-parser": { parseRoadmap: () => [] },
      "@/lib/task-status-transitions": { getGsdSyncedTaskStatus: () => "backlog" },
    },
  });

  try {
    const response = await route.POST(
      jsonRequest("http://localhost/api/tasks/sync-projects?clientId=client-a", {}),
    );
    const body = await response.json();

    assert.deepEqual(body, { synced: 0, skippedArchived: 0 });
    assert.deepEqual(
      db.prepare("SELECT parentId, clientId FROM tasks WHERE parentId IS NOT NULL").all(),
      [{ parentId: "client-active", clientId: "client-a" }],
    );
  } finally {
    db.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("phase-status updates only the selected root Goal's phase tasks", async () => {
  const rootDir = tempRoot();
  const planningDir = path.join(rootDir, "projects", "briefs", "target-gsd", ".planning");
  const roadmapPath = path.join(planningDir, "ROADMAP.md");
  fs.mkdirSync(planningDir, { recursive: true });
  fs.writeFileSync(roadmapPath, [
    "# Roadmap: Target GSD",
    "",
    "## Progress",
    "| Phase | Status | Date |",
    "| 1. First phase | work | Not Started | - |",
    "",
    "- [ ] **Phase 1: First phase**",
  ].join("\n"));

  const db = createDb([
    { id: "target-goal", level: "gsd", projectSlug: "target-gsd", clientId: null },
    { id: "client-goal", level: "gsd", projectSlug: "target-gsd", clientId: "client-a" },
    { id: "other-goal", level: "gsd", projectSlug: "other-gsd", clientId: null },
    { id: "target-phase", parentId: "target-goal", projectSlug: "target-gsd", phaseNumber: 1, gsdStep: "execute" },
    { id: "client-phase", parentId: "client-goal", projectSlug: "target-gsd", clientId: "client-a", phaseNumber: 1, gsdStep: "execute" },
    { id: "other-phase", parentId: "other-goal", projectSlug: "other-gsd", phaseNumber: 1, gsdStep: "execute" },
  ]);
  const events = [];
  const route = loadTsModule(path.join(routesRoot, "gsd", "phase-status", "route.ts"), {
    stubs: {
      "@/lib/config": {
        getClientAiOsDir: () => rootDir,
        resolvePlanningDir: () => ({ planningDir, projectSlug: "target-gsd" }),
      },
      "@/lib/clients": { normalizeClientId },
      "@/lib/db": { getDb: () => db },
      "@/lib/event-bus": { emitTaskEvent: (event) => events.push(event) },
      "@/lib/task-archive": taskArchive,
    },
  });

  try {
    const response = await route.PATCH({
      json: async () => ({ phaseNumber: 1, status: "complete" }),
      nextUrl: new URL("http://localhost/api/gsd/phase-status?project=target-gsd"),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.updatedTaskCount, 1);
    assert.deepEqual(
      db.prepare("SELECT id, status FROM tasks WHERE id LIKE '%-phase' ORDER BY id").all(),
      [
        { id: "client-phase", status: "backlog" },
        { id: "other-phase", status: "backlog" },
        { id: "target-phase", status: "done" },
      ],
    );
    assert.equal(events.length, 1);
  } finally {
    db.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("ensure-task ignores same-title and same-slug rows outside the root workspace Goal", async () => {
  const rootDir = tempRoot();
  const briefDir = path.join(rootDir, "projects", "briefs", "target-gsd");
  const planningDir = path.join(briefDir, ".planning");
  fs.mkdirSync(planningDir, { recursive: true });
  fs.writeFileSync(path.join(briefDir, "brief.md"), "---\nstatus: active\nlevel: 3\n---\n# Target GSD\n");
  fs.writeFileSync(path.join(planningDir, "ROADMAP.md"), "# Roadmap: Target GSD\n");

  const db = createDb([
    {
      id: "client-same-slug",
      title: "Target GSD",
      level: "gsd",
      projectSlug: "target-gsd",
      clientId: "client-a",
      archivedAt: "2026-07-13T01:00:00.000Z",
    },
    {
      id: "root-same-title",
      title: "Target GSD",
      level: "gsd",
      projectSlug: "other-gsd",
      clientId: null,
      archivedAt: "2026-07-13T01:00:00.000Z",
    },
  ]);
  const events = [];
  const route = loadTsModule(path.join(routesRoot, "gsd", "ensure-task", "route.ts"), {
    stubs: {
      "@/lib/db": { getDb: () => db },
      "@/lib/config": {
        getConfig: () => ({ aiOsDir: rootDir }),
        resolvePlanningDir: () => ({ planningDir, projectSlug: "target-gsd" }),
      },
      "@/lib/gsd-parser": {
        parseRoadmap: () => [{ number: 1, name: "First phase", status: "not-started", plans: [] }],
      },
      "@/lib/event-bus": { emitTaskEvent: (event) => events.push(event) },
      "@/lib/permission-mode": {
        getActivePermissionMode: (mode, fallback) => mode ?? fallback,
        getExecutionPermissionMode: (mode, fallback) => mode ?? fallback,
      },
      "@/lib/task-status-transitions": {
        getGsdSyncedTaskStatus: () => "backlog",
        shouldApplySyncedTaskStatus: () => false,
      },
      "@/lib/task-archive": taskArchive,
    },
  });

  try {
    const response = await route.POST(
      new Request("http://localhost/api/gsd/ensure-task?project=target-gsd", { method: "POST" }),
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.synced, true);
    assert.notEqual(body.parentTaskId, "client-same-slug");
    assert.notEqual(body.parentTaskId, "root-same-title");
    assert.deepEqual(
      db.prepare("SELECT projectSlug, clientId, parentId FROM tasks WHERE id = ?").get(body.parentTaskId),
      { projectSlug: "target-gsd", clientId: null, parentId: null },
    );
    assert.equal(body.newSubtasks, 4);
    assert.equal(events.length, 5);
  } finally {
    db.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

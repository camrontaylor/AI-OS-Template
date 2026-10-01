const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const access = loadTsModule(path.resolve(__dirname, "task-file-access.ts"), {
  stubs: {
    "./config": {},
    "./db": {},
  },
});

function loadAccessWithTasks(tasks, roots) {
  const rows = new Map(tasks.map((task) => [task.id, task]));
  return loadTsModule(path.resolve(__dirname, "task-file-access.ts"), {
    stubs: {
      "./config": {
        getConfig: () => ({ aiOsDir: roots.root }),
        getClientAiOsDir: (clientId) => roots.clients[clientId],
      },
      "./db": {
        getDb: () => ({
          prepare: () => ({ get: (id) => rows.get(id) }),
        }),
      },
    },
  });
}

test("allows only relative files inside the approved Task workspace roots", () => {
  for (const value of ["projects/briefs/demo/brief.md", "context/USER.md", ".claude/skills/demo/SKILL.md", "README.md"]) {
    assert.equal(access.isAllowedTaskFilePath(value), true, value);
  }
  for (const value of ["../secret.txt", "projects/../../secret.txt", "C:/secret.txt", "/etc/passwd", ".env"]) {
    assert.equal(access.isAllowedTaskFilePath(value), false, value);
  }
});

test("normalizes separators without accepting traversal", () => {
  assert.equal(access.normalizeTaskRelativePath("projects\\briefs\\demo\\brief.md"), "projects/briefs/demo/brief.md");
  assert.equal(access.isAllowedTaskFilePath("projects\\..\\secret.txt"), false);
});

test("the root Goal owns client and project scope for every child", () => {
  const scoped = loadAccessWithTasks([
    { id: "child", parentId: "root", clientId: "client-b", projectSlug: "wrong-project" },
    { id: "root", parentId: null, clientId: "client-a", projectSlug: "real-project" },
  ], {
    root: "C:/AI-OS",
    clients: { "client-a": "C:/AI-OS/clients/client-a", "client-b": "C:/AI-OS/clients/client-b" },
  });

  const context = scoped.resolveTaskWorkspace("child");
  assert.equal(context.clientId, "client-a");
  assert.equal(context.projectSlug, "real-project");
  assert.equal(context.baseDir, "C:/AI-OS/clients/client-a");
});

test("child metadata cannot fill an empty root Goal scope", () => {
  const scoped = loadAccessWithTasks([
    { id: "child", parentId: "root", clientId: "client-b", projectSlug: "child-project" },
    { id: "root", parentId: null, clientId: null, projectSlug: null },
  ], {
    root: "C:/AI-OS",
    clients: { "client-b": "C:/AI-OS/clients/client-b" },
  });

  const context = scoped.resolveTaskWorkspace("child");
  assert.equal(context.clientId, null);
  assert.equal(context.projectSlug, null);
  assert.equal(context.baseDir, "C:/AI-OS");
});

test("missing parents and parent cycles fail closed", () => {
  const roots = { root: "C:/AI-OS", clients: {} };
  const missingParent = loadAccessWithTasks([
    { id: "child", parentId: "missing", clientId: null, projectSlug: "demo" },
  ], roots);
  assert.equal(missingParent.resolveTaskWorkspace("child"), null);

  const cyclic = loadAccessWithTasks([
    { id: "a", parentId: "b", clientId: null, projectSlug: "demo" },
    { id: "b", parentId: "a", clientId: null, projectSlug: "demo" },
  ], roots);
  assert.equal(cyclic.resolveTaskWorkspace("a"), null);
});

test("resolveTaskFile rejects an allowed-looking junction that escapes the workspace", (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "aios-task-files-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "aios-task-files-outside-"));
  t.after(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  fs.mkdirSync(path.join(workspace, "projects", "briefs"), { recursive: true });
  const linkedProject = path.join(workspace, "projects", "briefs", "escaped");
  fs.symlinkSync(outside, linkedProject, process.platform === "win32" ? "junction" : "dir");

  const scoped = loadAccessWithTasks([
    { id: "root", parentId: null, clientId: null, projectSlug: "escaped" },
  ], { root: workspace, clients: {} });

  assert.equal(scoped.resolveTaskFile("root", "projects/briefs/escaped/secret.md"), null);
});

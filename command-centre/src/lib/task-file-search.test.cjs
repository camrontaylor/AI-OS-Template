const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const search = loadTsModule(path.resolve(__dirname, "task-file-search.ts"), {
  stubs: {
    "./config": {
      getConfig: () => ({ aiOsDir: "" }),
    },
    "./materialized-file-ownership": {
      assertMaterializedPathAccessible: () => {},
      assertMaterializedPathWritable: () => {},
      isMaterializedPathAccessible: () => true,
      registerMaterializedFiles: () => {},
      removeMaterializedOwnership: () => {},
    },
  },
});

function createWorkspace(t) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "task-file-search-"));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  return baseDir;
}

function write(baseDir, relativePath, content = "test") {
  const absolutePath = path.join(baseDir, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

function node(baseDir, relativePath, type = "directory") {
  const stat = fs.statSync(path.join(baseDir, ...relativePath.split("/")));
  return {
    name: relativePath.split("/").at(-1),
    path: relativePath,
    type,
    lastModified: stat.mtime.toISOString(),
    size: stat.size,
  };
}

function collectPaths(nodes, type) {
  const paths = [];
  const walk = (items) => {
    for (const item of items) {
      if (item.type === type) paths.push(item.path);
      if (item.children) walk(item.children);
    }
  };
  walk(nodes);
  return paths;
}

test("finds case-insensitive filename matches inside unopened folders and keeps their ancestors", (t) => {
  const baseDir = createWorkspace(t);
  write(baseDir, "context/notes/BRIEFING.md");
  write(baseDir, "projects/briefs/demo/brief.md");
  write(baseDir, "projects/other/notes.txt");
  write(baseDir, "projects/.hidden/private-brief.md");

  const result = search.searchTaskWorkspaceFiles({
    baseDir,
    roots: [node(baseDir, "context"), node(baseDir, "projects")],
    query: "BrIeF",
  });

  assert.deepEqual(collectPaths(result.nodes, "file"), [
    "context/notes/BRIEFING.md",
    "projects/briefs/demo/brief.md",
  ]);
  assert.deepEqual(collectPaths(result.nodes, "directory"), [
    "context",
    "context/notes",
    "projects",
    "projects/briefs",
    "projects/briefs/demo",
  ]);
  assert.equal(result.truncated, false);
});

test("matches the full relative file path and prunes unrelated branches", (t) => {
  const baseDir = createWorkspace(t);
  write(baseDir, "projects/briefs/demo/plan.md");
  write(baseDir, "projects/other/plan.md");

  const result = search.searchTaskWorkspaceFiles({
    baseDir,
    roots: [node(baseDir, "projects")],
    query: "projects/briefs",
  });

  assert.deepEqual(collectPaths(result.nodes, "file"), ["projects/briefs/demo/plan.md"]);
  assert.equal(collectPaths(result.nodes, "directory").includes("projects/other"), false);
});

test("returns only the configured number of files and reports more matches", (t) => {
  const baseDir = createWorkspace(t);
  for (let index = 1; index <= 5; index += 1) {
    write(baseDir, `projects/results/match-${index}.md`);
  }

  const result = search.searchTaskWorkspaceFiles({
    baseDir,
    roots: [node(baseDir, "projects")],
    query: "match-",
    limit: 3,
  });

  assert.equal(collectPaths(result.nodes, "file").length, 3);
  assert.equal(result.truncated, true);
});

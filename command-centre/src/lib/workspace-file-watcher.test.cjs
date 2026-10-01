"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");
const watcherModule = loadTsModule(path.resolve(__dirname, "workspace-file-watcher.ts"));

class FakeWatcher {
  constructor() {
    this.handlers = new Map();
    this.closeCalls = 0;
  }

  on(event, handler) {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
    return this;
  }

  emit(event, value) {
    for (const handler of this.handlers.get(event) ?? []) handler(value);
  }

  async close() {
    this.closeCalls += 1;
  }
}

function createHarness(debounceMs = 5) {
  const calls = [];
  const factory = (target, options) => {
    const watcher = new FakeWatcher();
    calls.push({ target, options, watcher });
    return watcher;
  };
  return {
    calls,
    service: new watcherModule.WorkspaceFileWatcherService(factory, debounceMs),
  };
}

test("workspace watcher ignores paths outside the permitted roots and heavy descendants", () => {
  const baseDir = path.resolve("C:/workspace");
  assert.equal(watcherModule.shouldIgnoreWorkspaceWatchPath(baseDir, baseDir), false);
  assert.equal(watcherModule.shouldIgnoreWorkspaceWatchPath(baseDir, path.join(baseDir, ".claude")), false);
  assert.equal(watcherModule.shouldIgnoreWorkspaceWatchPath(baseDir, path.join(baseDir, ".claude", "skills", "demo", "SKILL.md")), false);
  assert.equal(watcherModule.shouldIgnoreWorkspaceWatchPath(baseDir, path.join(baseDir, "projects", "demo", ".secret")), true);
  assert.equal(watcherModule.shouldIgnoreWorkspaceWatchPath(baseDir, path.join(baseDir, "projects", "demo", "node_modules", "pkg.js")), true);
  assert.equal(watcherModule.shouldIgnoreWorkspaceWatchPath(baseDir, path.join(baseDir, "projects", "demo", ".next", "build.js")), true);
  assert.equal(watcherModule.shouldIgnoreWorkspaceWatchPath(baseDir, path.join(baseDir, "private", "secret.md")), true);
});

test("workspace watcher exposes only the relative parent directory", () => {
  const baseDir = path.resolve("C:/workspace");
  assert.equal(
    watcherModule.workspaceDirectoryForFileEvent(baseDir, path.join(baseDir, "projects", "briefs", "demo", "brief.md")),
    "projects/briefs/demo",
  );
  assert.equal(
    watcherModule.workspaceDirectoryForFileEvent(baseDir, path.join(baseDir, "README.md")),
    "",
  );
  assert.equal(
    watcherModule.workspaceDirectoryForFileEvent(baseDir, path.resolve(baseDir, "..", "outside.md")),
    null,
  );
});

test("workspace watcher shares one watcher, batches changes by directory, and closes after the last subscriber", async () => {
  const { calls, service } = createHarness();
  const baseDir = path.resolve("C:/workspace");
  const firstEvents = [];
  const secondEvents = [];
  const unsubscribeFirst = service.subscribe({ profileKey: "profile-a", baseDir, onChange: (event) => firstEvents.push(event) });
  const unsubscribeSecond = service.subscribe({ profileKey: "profile-a", baseDir, onChange: (event) => secondEvents.push(event) });

  assert.equal(calls.length, 1);
  const watcher = calls[0].watcher;
  watcher.emit("add", path.join(baseDir, "projects", "demo", "one.md"));
  watcher.emit("change", path.join(baseDir, "projects", "demo", "one.md"));
  watcher.emit("unlink", path.join(baseDir, "projects", "demo", "two.md"));
  watcher.emit("addDir", path.join(baseDir, "projects", "other"));
  watcher.emit("unlinkDir", path.join(baseDir, "projects", "old"));
  watcher.emit("unlink", path.join(baseDir, "projects", "before", "renamed.md"));
  watcher.emit("add", path.join(baseDir, "projects", "after", "renamed.md"));
  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.deepEqual(firstEvents, [
    { type: "workspace:directory-changed", directory: "projects/demo" },
    { type: "workspace:directory-changed", directory: "projects" },
    { type: "workspace:directory-changed", directory: "projects/before" },
    { type: "workspace:directory-changed", directory: "projects/after" },
  ]);
  assert.deepEqual(secondEvents, firstEvents);

  unsubscribeFirst();
  assert.equal(watcher.closeCalls, 0);
  unsubscribeSecond();
  unsubscribeSecond();
  assert.equal(watcher.closeCalls, 1);
});

test("workspace watcher isolates profiles and workspace roots", () => {
  const { calls, service } = createHarness();
  const unsubscribeA = service.subscribe({ profileKey: "profile-a", baseDir: "C:/workspace", onChange: () => {} });
  const unsubscribeB = service.subscribe({ profileKey: "profile-b", baseDir: "C:/workspace", onChange: () => {} });
  const unsubscribeC = service.subscribe({ profileKey: "profile-a", baseDir: "C:/other", onChange: () => {} });
  assert.equal(calls.length, 3);
  unsubscribeA();
  unsubscribeB();
  unsubscribeC();
});

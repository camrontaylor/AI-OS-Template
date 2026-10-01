const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");
const migration = loadTsModule(path.resolve(__dirname, "permission-mode-migration.ts"));

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      permissionMode TEXT,
      executionPermissionMode TEXT
    );
    CREATE TABLE task_logs (
      id TEXT PRIMARY KEY,
      permissionMode TEXT
    );
  `);
  return db;
}

test("one-time permission migration converts every legacy Auto location", () => {
  const db = createDb();
  db.prepare("INSERT INTO tasks VALUES (?, ?, ?)").run("legacy", "auto", "auto");
  db.prepare("INSERT INTO tasks VALUES (?, ?, ?)").run("edit", "acceptEdits", "acceptEdits");
  db.prepare("INSERT INTO task_logs VALUES (?, ?)").run("log", "auto");

  assert.equal(migration.migrateLegacyAutoPermissionModes(db), true);
  assert.deepEqual(db.prepare("SELECT permissionMode, executionPermissionMode FROM tasks WHERE id = 'legacy'").get(), {
    permissionMode: "bypassPermissions",
    executionPermissionMode: "bypassPermissions",
  });
  assert.equal(db.prepare("SELECT permissionMode FROM task_logs WHERE id = 'log'").get().permissionMode, "bypassPermissions");
  assert.deepEqual(db.prepare("SELECT permissionMode, executionPermissionMode FROM tasks WHERE id = 'edit'").get(), {
    permissionMode: "acceptEdits",
    executionPermissionMode: "acceptEdits",
  });

  db.close();
});

test("post-marker native Auto values survive later database opens", () => {
  const db = createDb();
  migration.migrateLegacyAutoPermissionModes(db);
  db.prepare("INSERT INTO tasks VALUES (?, ?, ?)").run("native", "auto", "auto");
  db.prepare("INSERT INTO task_logs VALUES (?, ?)").run("native-log", "auto");

  assert.equal(migration.migrateLegacyAutoPermissionModes(db), false);
  assert.deepEqual(db.prepare("SELECT permissionMode, executionPermissionMode FROM tasks WHERE id = 'native'").get(), {
    permissionMode: "auto",
    executionPermissionMode: "auto",
  });
  assert.equal(db.prepare("SELECT permissionMode FROM task_logs WHERE id = 'native-log'").get().permissionMode, "auto");

  db.close();
});

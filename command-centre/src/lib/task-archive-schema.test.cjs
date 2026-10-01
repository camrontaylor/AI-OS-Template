const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");
const archive = loadTsModule(path.resolve(__dirname, "task-archive.ts"), {
  stubs: {
    "@/lib/identity/work-scope": { normalizeWorkScopedRow: (row) => row },
  },
});

test("fresh databases include archive state, its lookup index, and the child barrier", () => {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(path.resolve(__dirname, "schema.sql"), "utf8"));

  const columns = db.prepare("PRAGMA table_info(tasks)").all();
  const indexes = db.prepare("PRAGMA index_list(tasks)").all();
  assert.ok(columns.some((column) => column.name === "archivedAt"));
  assert.ok(columns.some((column) => column.name === "archivingAt"));
  assert.ok(indexes.some((index) => index.name === "idx_tasks_archivedAt"));
  const triggerNames = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all()
    .map((trigger) => trigger.name);
  assert.ok(triggerNames.includes("block_children_of_read_only_task_tree"));
  assert.ok(triggerNames.includes("block_reparent_into_read_only_task_tree"));
  db.close();
});

test("legacy task tables can add archivedAt without changing existing rows", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL); INSERT INTO tasks VALUES ('goal', 'Existing Goal');");
  db.exec("ALTER TABLE tasks ADD COLUMN archivedAt TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_archivedAt ON tasks(archivedAt)");

  assert.deepEqual(db.prepare("SELECT id, title, archivedAt FROM tasks").get(), {
    id: "goal",
    title: "Existing Goal",
    archivedAt: null,
  });
  db.close();
});

test("legacy databases add indexed and scoped columns before the full schema", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      parentId TEXT
    );
    INSERT INTO tasks VALUES ('goal', 'Existing Goal', 'queued', NULL);
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      status TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    INSERT INTO conversations VALUES (
      'conversation',
      'Existing Conversation',
      'active',
      '2025-01-01T00:00:00.000Z',
      '2025-01-01T00:00:00.000Z'
    );
  `);

  archive.prepareLegacySchemaCompatibility(db);
  db.exec(fs.readFileSync(path.resolve(__dirname, "schema.sql"), "utf8"));

  assert.deepEqual(
    db.prepare("SELECT id, title, archivedAt, archivingAt FROM tasks WHERE id = 'goal'").get(),
    {
      id: "goal",
      title: "Existing Goal",
      archivedAt: null,
      archivingAt: null,
    },
  );
  assert.deepEqual(
    db.prepare("SELECT id, title FROM conversations WHERE id = 'conversation'").get(),
    {
      id: "conversation",
      title: "Existing Conversation",
    },
  );
  assert.ok(db.prepare("PRAGMA index_list(tasks)").all().some((index) => index.name === "idx_tasks_archivedAt"));
  const taskColumns = db.prepare("PRAGMA table_info(tasks)").all().map((column) => column.name);
  const conversationColumns = db.prepare("PRAGMA table_info(conversations)").all().map((column) => column.name);
  assert.ok(taskColumns.includes("archivedAt"));
  assert.ok(taskColumns.includes("clientId"));
  assert.ok(taskColumns.includes("workScope"));
  assert.ok(taskColumns.includes("archivingAt"));
  assert.ok(conversationColumns.includes("clientId"));
  assert.ok(conversationColumns.includes("workScope"));
  const triggerNames = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all()
    .map((trigger) => trigger.name);
  assert.ok(triggerNames.includes("block_children_of_read_only_task_tree"));
  assert.ok(triggerNames.includes("block_reparent_into_read_only_task_tree"));
  db.close();
});

test("database barrier blocks descendants while archiving or archived", () => {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(path.resolve(__dirname, "schema.sql"), "utf8"));
  const insert = db.prepare(`
    INSERT INTO tasks (id, title, status, level, parentId, createdAt, updatedAt)
    VALUES (?, ?, 'backlog', 'task', ?, 'now', 'now')
  `);
  insert.run("goal", "Goal", null);
  insert.run("child", "Child", "goal");
  insert.run("movable", "Movable", null);

  db.prepare("UPDATE tasks SET archivingAt = 'barrier' WHERE id = 'goal'").run();
  assert.throws(() => insert.run("blocked-grandchild", "Blocked", "child"), /task_tree_read_only/);
  assert.throws(
    () => db.prepare("UPDATE tasks SET parentId = 'child' WHERE id = 'movable'").run(),
    /task_tree_read_only/,
  );

  db.prepare("UPDATE tasks SET archivingAt = NULL, archivedAt = 'archived' WHERE id = 'goal'").run();
  assert.throws(() => insert.run("blocked-child", "Blocked", "goal"), /task_tree_read_only/);
  assert.throws(
    () => db.prepare("UPDATE tasks SET parentId = 'goal' WHERE id = 'movable'").run(),
    /task_tree_read_only/,
  );
  db.close();
});

import type Database from "better-sqlite3";
import type { Task } from "@/types/task";
import {
  interpretStoredWorkScope,
  type StoredWorkScopeV1,
} from "./identity/session-scope";

type TaskDatabase = Database.Database;
type StoredTaskRow = Omit<Task, "needsInput" | "workScope"> & {
  needsInput: boolean | number;
  workScope?: Task["workScope"] | string | null;
  archivingAt?: string | null;
};

export class TaskArchiveError extends Error {
  status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = "TaskArchiveError";
    this.status = status;
  }
}

export class TaskArchiveStopError extends TaskArchiveError {
  readonly code = "task_stop_failed";

  constructor(message: string) {
    super(message, 503);
    this.name = "TaskArchiveStopError";
  }
}

export function isTaskTreeReadOnlyError(error: unknown): boolean {
  return error instanceof Error && /task_tree_read_only/.test(error.message);
}

function normalizeTask(row: StoredTaskRow): Task {
  let storedScope: unknown = row.workScope;
  if (typeof storedScope === "string") {
    try {
      storedScope = JSON.parse(storedScope) as unknown;
    } catch {
      throw new TaskArchiveError("The saved work scope is corrupted and cannot be used safely.", 409);
    }
  }

  let workScope: StoredWorkScopeV1;
  try {
    workScope = interpretStoredWorkScope(storedScope, { legacyClientId: row.clientId });
  } catch (error) {
    throw new TaskArchiveError(
      error instanceof Error
        ? `The saved work scope is invalid: ${error.message}`
        : "The saved work scope is invalid.",
      409,
    );
  }
  const normalizedClientId = !row.clientId || row.clientId === "root" ? null : row.clientId;
  const scopeClientId = workScope.mode === "team" ? workScope.scope.clientId : workScope.clientId;
  if (normalizedClientId !== scopeClientId) {
    throw new TaskArchiveError("The saved client does not match the immutable work scope.", 409);
  }

  return {
    ...row,
    workScope,
    needsInput: Boolean(row.needsInput),
  } as Task;
}

function prepareColumnsBeforeFullSchema(
  db: TaskDatabase,
  table: "tasks" | "conversations",
  columns: Array<{ name: string; definition: string }>,
): void {
  const existingTable = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { present: number } | undefined;
  if (!existingTable) return;

  const existingColumns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  for (const column of columns) {
    if (!existingColumns.some((candidate) => candidate.name === column.name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column.definition}`);
    }
  }
}

export function prepareLegacySchemaCompatibility(db: TaskDatabase): void {
  // schema.sql creates indexes and immutable-scope triggers immediately. Add
  // columns referenced by those objects before executing the full schema so
  // databases from before client/work scoping can still upgrade normally.
  prepareColumnsBeforeFullSchema(db, "tasks", [
    { name: "archivedAt", definition: "archivedAt TEXT" },
    { name: "archivingAt", definition: "archivingAt TEXT" },
    { name: "clientId", definition: "clientId TEXT" },
    { name: "workScope", definition: "workScope TEXT" },
  ]);
  prepareColumnsBeforeFullSchema(db, "conversations", [
    { name: "clientId", definition: "clientId TEXT" },
    { name: "workScope", definition: "workScope TEXT" },
  ]);
}

export function getTaskTree(db: TaskDatabase, rootId: string): Task[] {
  return (db.prepare(`
    WITH RECURSIVE task_tree AS (
      SELECT * FROM tasks WHERE id = ?
      UNION ALL
      SELECT child.*
      FROM tasks child
      JOIN task_tree parent ON child.parentId = parent.id
    )
    SELECT * FROM task_tree
  `).all(rootId) as StoredTaskRow[]).map(normalizeTask);
}

export function getRootTask(db: TaskDatabase, taskId: string): Task | null {
  const visited = new Set<string>();
  let task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as StoredTaskRow | undefined;
  while (task?.parentId && !visited.has(task.id)) {
    visited.add(task.id);
    task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.parentId) as StoredTaskRow | undefined;
  }
  return task ? normalizeTask(task) : null;
}

export function isTaskArchived(db: TaskDatabase, taskId: string): boolean {
  const root = getRootTask(db, taskId) as (Task & { archivingAt?: string | null }) | null;
  return Boolean(root?.archivedAt || root?.archivingAt);
}

export function assertTaskMutable(db: TaskDatabase, taskId: string): void {
  if (isTaskArchived(db, taskId)) {
    throw new TaskArchiveError("Restore this Goal before making changes.");
  }
}

function setArchiveBarrier(db: TaskDatabase, goalId: string, requestedAt: string): Task[] {
  return db.transaction(() => {
    const root = db.prepare("SELECT * FROM tasks WHERE id = ?").get(goalId) as StoredTaskRow | undefined;
    if (!root) throw new TaskArchiveError("Goal not found.", 404);
    if (root.parentId) throw new TaskArchiveError("Only a top-level Goal can be archived.", 400);

    db.prepare(`
      UPDATE tasks
      SET archivingAt = COALESCE(archivingAt, ?)
      WHERE id = ?
    `).run(requestedAt, goalId);
    db.prepare(`
      WITH RECURSIVE task_tree(id) AS (
        SELECT id FROM tasks WHERE id = ?
        UNION ALL
        SELECT child.id FROM tasks child JOIN task_tree parent ON child.parentId = parent.id
      )
      UPDATE tasks
      SET cancelRequestedAt = COALESCE(cancelRequestedAt, ?)
      WHERE id IN (SELECT id FROM task_tree)
    `).run(goalId, requestedAt);

    return getTaskTree(db, goalId);
  })();
}

function stopFailureMessage(failures: unknown[]): string {
  const details = failures
    .map((failure) => failure instanceof Error ? failure.message : String(failure))
    .filter(Boolean);
  return details.length > 0
    ? `The Goal could not be archived because active work did not stop: ${details.join("; ")}`
    : "The Goal could not be archived because active work did not stop.";
}

export async function archiveGoal(options: {
  db: TaskDatabase;
  goalId: string;
  stopTask: (taskId: string) => Promise<void>;
  now?: string;
}): Promise<Task[]> {
  const { db, goalId, stopTask } = options;
  const barrierAt = new Date().toISOString();
  let tree = setArchiveBarrier(db, goalId, barrierAt);
  const attempted = new Set<string>();
  const failures: unknown[] = [];

  // Stop every row, not only rows whose persisted status says "running".
  // A process may be starting or finishing while its status is queued, review,
  // done, or already archived. allSettled ensures one failed shutdown never
  // prevents the remaining processes from being stopped.
  while (true) {
    const pending = tree.filter((task) => !attempted.has(task.id));
    if (pending.length === 0) break;
    pending.forEach((task) => attempted.add(task.id));
    const results = await Promise.allSettled(pending.map((task) => stopTask(task.id)));
    for (const result of results) {
      if (result.status === "rejected") failures.push(result.reason);
    }

    // Re-query after asynchronous shutdown. The root archive barrier blocks
    // normal child creation, while this also repairs rows from older versions
    // that may have slipped into the tree during archiving.
    tree = setArchiveBarrier(db, goalId, barrierAt);
  }

  if (failures.length > 0) {
    // Keep the archive barrier in place so a failed stop cannot resume or add
    // work. A retry is idempotent and repairs the same tree.
    throw new TaskArchiveStopError(stopFailureMessage(failures));
  }

  // This timestamp must be newer than every asynchronous stop operation.
  const now = options.now ?? new Date().toISOString();

  db.transaction(() => {
    tree = getTaskTree(db, goalId);
    for (const task of tree) {
      db.prepare(
        "UPDATE task_permission_rules SET revokedAt = ? WHERE taskId = ? AND revokedAt IS NULL",
      ).run(now, task.id);
      db.prepare(`
        UPDATE approval_requests
        SET status = 'denied', decision = 'deny', decisionMessage = ?, resolvedAt = ?
        WHERE taskId = ? AND status = 'pending'
      `).run("Goal archived", now, task.id);
    }
    db.prepare(`
      WITH RECURSIVE task_tree(id) AS (
        SELECT id FROM tasks WHERE id = ?
        UNION ALL
        SELECT child.id FROM tasks child JOIN task_tree parent ON child.parentId = parent.id
      )
      UPDATE tasks
      SET needsInput = 0,
          errorMessage = NULL,
          activityLabel = NULL,
          claudePid = NULL,
          archivingAt = NULL,
          updatedAt = ?
      WHERE id IN (SELECT id FROM task_tree)
    `).run(goalId, now);

    db.prepare(`
      UPDATE tasks
      SET status = 'done', completedAt = COALESCE(completedAt, ?),
          archivedAt = COALESCE(archivedAt, ?), updatedAt = ?
      WHERE id = ?
    `).run(now, now, now, goalId);

    db.prepare(`
      WITH RECURSIVE task_tree(id) AS (
        SELECT id FROM tasks WHERE id = ?
        UNION ALL
        SELECT child.id FROM tasks child JOIN task_tree parent ON child.parentId = parent.id
      )
      UPDATE tasks
      SET status = 'done', completedAt = COALESCE(completedAt, ?), updatedAt = ?
      WHERE id IN (SELECT id FROM task_tree)
        AND id <> ?
        AND status IN ('queued', 'running', 'review')
    `).run(goalId, now, now, goalId);
  })();

  return getTaskTree(db, goalId);
}

export function restoreGoal(options: {
  db: TaskDatabase;
  goalId: string;
  now?: string;
}): Task[] {
  const { db, goalId } = options;
  const now = options.now ?? new Date().toISOString();
  const root = db.prepare("SELECT * FROM tasks WHERE id = ?").get(goalId) as StoredTaskRow | undefined;
  if (!root) throw new TaskArchiveError("Goal not found.", 404);
  if (root.parentId) throw new TaskArchiveError("Only a top-level Goal can be restored.", 400);
  if (!root.archivedAt) return getTaskTree(db, goalId);

  db.transaction(() => {
    db.prepare(`
      WITH RECURSIVE task_tree(id) AS (
        SELECT id FROM tasks WHERE id = ?
        UNION ALL
        SELECT child.id FROM tasks child JOIN task_tree parent ON child.parentId = parent.id
      )
      UPDATE tasks
      SET cancelRequestedAt = NULL, archivingAt = NULL
      WHERE id IN (SELECT id FROM task_tree)
    `).run(goalId);
    db.prepare(`
      UPDATE tasks
      SET archivedAt = NULL,
          status = 'review',
          completedAt = NULL,
          needsInput = 1,
          errorMessage = NULL,
          activityLabel = NULL,
          updatedAt = ?
      WHERE id = ?
    `).run(now, goalId);
  })();

  return getTaskTree(db, goalId);
}

export function selectActiveGoals(tasks: Task[]): Task[] {
  return tasks.filter((task) => !task.parentId && !task.archivedAt);
}

export function selectArchivedGoals(tasks: Task[]): Task[] {
  return tasks.filter((task) => !task.parentId && Boolean(task.archivedAt));
}

export function isTaskReadOnly(tasks: Task[], taskId: string): boolean {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visited = new Set<string>();
  let current = byId.get(taskId);
  while (current && !visited.has(current.id)) {
    if (current.archivedAt || current.archivingAt) return true;
    visited.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return false;
}

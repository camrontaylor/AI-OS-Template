import Database from "better-sqlite3";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "fs";
import path from "path";
import { getConfig } from "./config";
import {
  LOCAL_PROFILE_SCHEMA_VERSION,
  type LocalProfileDescriptorV1,
  type TeamLocalProfileDescriptorV1,
  resolveLocalProfileDescriptor,
  updateLocalProfileStatus,
} from "./local-profile";
import { getExecutionPermissionMode, normalizePermissionMode } from "./permission-mode";
import { migrateLegacyAutoPermissionModes } from "./permission-mode-migration";
import { prepareLegacySchemaCompatibility } from "./task-archive";

interface LocalProfileHandleEntry {
  descriptor: LocalProfileDescriptorV1;
  db: Database.Database;
  leases: number;
  lastUsedAt: number;
}

export interface LocalProfileLease {
  readonly descriptor: LocalProfileDescriptorV1;
  readonly db: Database.Database;
  release(): void;
}

const profileContext = new AsyncLocalStorage<LocalProfileDescriptorV1>();
const profileHandles = new Map<string, LocalProfileHandleEntry>();

function cronRunsSupportsTimeout(database: Database.Database): boolean {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'cron_runs'")
    .get() as { sql?: string } | undefined;

  return row?.sql?.includes("'timeout'") ?? false;
}

function migrateCronRunsForTimeout(database: Database.Database) {
  database.exec(`
    BEGIN;
    CREATE TABLE cron_runs_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jobSlug TEXT NOT NULL,
      taskId TEXT,
      startedAt TEXT NOT NULL,
      completedAt TEXT,
      result TEXT NOT NULL DEFAULT 'running' CHECK (result IN ('success', 'failure', 'timeout', 'running')),
      durationSec REAL,
      costUsd REAL,
      exitCode INTEGER,
      trigger TEXT DEFAULT 'scheduled',
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO cron_runs_new (id, jobSlug, taskId, startedAt, completedAt, result, durationSec, costUsd, exitCode, trigger, createdAt)
    SELECT id, jobSlug, taskId, startedAt, completedAt, result, durationSec, costUsd, exitCode, trigger, createdAt
    FROM cron_runs;
    DROP TABLE cron_runs;
    ALTER TABLE cron_runs_new RENAME TO cron_runs;
    CREATE INDEX IF NOT EXISTS idx_cron_runs_jobSlug ON cron_runs(jobSlug);
    CREATE INDEX IF NOT EXISTS idx_cron_runs_startedAt ON cron_runs(startedAt);
    COMMIT;
  `);
}

function initializeDatabase(descriptor: LocalProfileDescriptorV1): Database.Database {
  const config = getConfig();
  const existedBeforeOpen = fs.existsSync(descriptor.dbPath);
  fs.mkdirSync(path.dirname(descriptor.dbPath), { recursive: true });
  const db = new Database(descriptor.dbPath);

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS local_profile_identity (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        mode TEXT NOT NULL CHECK (mode IN ('solo', 'team')),
        profileKey TEXT NOT NULL,
        serverId TEXT,
        userId TEXT,
        contractVersion INTEGER NOT NULL
      )
    `);
    const owner = db.prepare(
      "SELECT mode, profileKey, serverId, userId, contractVersion FROM local_profile_identity WHERE singleton = 1"
    ).get() as {
      mode: string;
      profileKey: string;
      serverId: string | null;
      userId: string | null;
      contractVersion: number;
    } | undefined;
    const expectedServerId = descriptor.mode === "team" ? descriptor.identity.serverId : null;
    const expectedUserId = descriptor.mode === "team" ? descriptor.identity.userId : null;

    if (owner) {
      if (
        owner.mode !== descriptor.mode ||
        owner.profileKey !== descriptor.profileKey ||
        owner.serverId !== expectedServerId ||
        owner.userId !== expectedUserId ||
        owner.contractVersion !== descriptor.version
      ) {
        throw new Error(`Local profile owner mismatch for ${descriptor.profileKey}`);
      }
    } else {
      if (descriptor.mode === "team" && existedBeforeOpen) {
        throw new Error(`Refusing to claim an existing database for Team profile ${descriptor.profileKey}`);
      }
      db.prepare(
        `INSERT INTO local_profile_identity
          (singleton, mode, profileKey, serverId, userId, contractVersion)
         VALUES (1, ?, ?, ?, ?, ?)`
      ).run(
        descriptor.mode,
        descriptor.profileKey,
        expectedServerId,
        expectedUserId,
        descriptor.version,
      );
    }

    // WAL is the production default. Tests can opt into DELETE mode so
    // Windows releases temporary database directories before the worker exits.
    const journalMode = process.env.COMMAND_CENTRE_SQLITE_JOURNAL_MODE === "DELETE"
      ? "DELETE"
      : "WAL";
    db.pragma(`journal_mode = ${journalMode}`);

  // Read and execute schema
  const schemaPath = path.join(__dirname, "schema.sql");
  let schemaSql: string;

  try {
    schemaSql = fs.readFileSync(schemaPath, "utf-8");
  } catch {
    // In Next.js bundled environment, __dirname may not resolve correctly.
    // Fall back to the repo-local command-centre source tree.
    const fallbackPath = path.join(config.aiOsDir, "command-centre", "src", "lib", "schema.sql");
    schemaSql = fs.readFileSync(fallbackPath, "utf-8");
  }

  // schema.sql creates indexes and scope triggers before the normal migration
  // section. Older databases need those referenced columns first.
  prepareLegacySchemaCompatibility(db);

  db.exec(schemaSql);

  // Migration: add clientId column if it doesn't exist
  const columns = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "clientId")) {
    db.exec("ALTER TABLE tasks ADD COLUMN clientId TEXT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_clientId ON tasks(clientId)");

  // AIOS-383: every new task/conversation persists immutable work ownership.
  // NULL remains reserved for legacy rows and is interpreted as Solo.
  const taskScopeColumns = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  if (!taskScopeColumns.some((c) => c.name === "workScope")) {
    db.exec("ALTER TABLE tasks ADD COLUMN workScope TEXT");
  }
  const conversationScopeColumns = db.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
  if (!conversationScopeColumns.some((c) => c.name === "workScope")) {
    db.exec("ALTER TABLE conversations ADD COLUMN workScope TEXT");
  }
  db.exec(`
    DROP TRIGGER IF EXISTS tasks_work_scope_immutable;
    DROP TRIGGER IF EXISTS conversations_work_scope_immutable;
    DROP TRIGGER IF EXISTS tasks_work_scope_valid;
    DROP TRIGGER IF EXISTS conversations_work_scope_valid;
    CREATE TRIGGER tasks_work_scope_immutable
    BEFORE UPDATE OF workScope, clientId ON tasks
    WHEN OLD.workScope IS NOT NEW.workScope OR OLD.clientId IS NOT NEW.clientId
    BEGIN
      SELECT RAISE(ABORT, 'work_scope_immutable');
    END;
    CREATE TRIGGER conversations_work_scope_immutable
    BEFORE UPDATE OF workScope, clientId ON conversations
    WHEN OLD.workScope IS NOT NEW.workScope OR OLD.clientId IS NOT NEW.clientId
    BEGIN
      SELECT RAISE(ABORT, 'work_scope_immutable');
    END;
    CREATE TRIGGER tasks_work_scope_valid
    BEFORE INSERT ON tasks
    WHEN NEW.workScope IS NOT NULL AND CASE
      WHEN json_valid(NEW.workScope) = 0 THEN 1
      WHEN json_extract(NEW.workScope, '$.mode') = 'solo' THEN
        json_extract(NEW.workScope, '$.version') IS NOT 1
        OR COALESCE(NEW.clientId, '') <> COALESCE(json_extract(NEW.workScope, '$.clientId'), '')
      WHEN json_extract(NEW.workScope, '$.mode') = 'team' THEN
        json_extract(NEW.workScope, '$.scope.version') IS NOT 1
        OR COALESCE(NEW.clientId, '') <> COALESCE(json_extract(NEW.workScope, '$.scope.clientId'), '')
      ELSE 1
    END
    BEGIN
      SELECT RAISE(ABORT, 'invalid_work_scope');
    END;
    CREATE TRIGGER conversations_work_scope_valid
    BEFORE INSERT ON conversations
    WHEN NEW.workScope IS NOT NULL AND CASE
      WHEN json_valid(NEW.workScope) = 0 THEN 1
      WHEN json_extract(NEW.workScope, '$.mode') = 'solo' THEN
        json_extract(NEW.workScope, '$.version') IS NOT 1
        OR COALESCE(NEW.clientId, '') <> COALESCE(json_extract(NEW.workScope, '$.clientId'), '')
      WHEN json_extract(NEW.workScope, '$.mode') = 'team' THEN
        json_extract(NEW.workScope, '$.scope.version') IS NOT 1
        OR COALESCE(NEW.clientId, '') <> COALESCE(json_extract(NEW.workScope, '$.scope.clientId'), '')
      ELSE 1
    END
    BEGIN
      SELECT RAISE(ABORT, 'invalid_work_scope');
    END;
  `);

  // Migration: add description column if it doesn't exist
  const descCol = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  if (!descCol.some((c) => c.name === "description")) {
    db.exec("ALTER TABLE tasks ADD COLUMN description TEXT");
  }

  // Migration: add projectSlug column if it doesn't exist
  const projCol = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  if (!projCol.some((c) => c.name === "projectSlug")) {
    db.exec("ALTER TABLE tasks ADD COLUMN projectSlug TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_projectSlug ON tasks(projectSlug)");
  }

  // Migration: add needsInput column if it doesn't exist
  const needsCol = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  if (!needsCol.some((c) => c.name === "needsInput")) {
    db.exec("ALTER TABLE tasks ADD COLUMN needsInput INTEGER NOT NULL DEFAULT 0");
  }

  // Migration: add claudeSessionId column for --resume support
  const sessionCol = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  if (!sessionCol.some((c) => c.name === "claudeSessionId")) {
    db.exec("ALTER TABLE tasks ADD COLUMN claudeSessionId TEXT");
  }

  // Migration: add contextSources column — JSON of what context was loaded at task start
  const ctxCol = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  if (!ctxCol.some((c) => c.name === "contextSources")) {
    db.exec("ALTER TABLE tasks ADD COLUMN contextSources TEXT");
  }

  // Migration: add phaseNumber and gsdStep columns for GSD sub-tasks
  const phaseCol = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  if (!phaseCol.some((c) => c.name === "phaseNumber")) {
    db.exec("ALTER TABLE tasks ADD COLUMN phaseNumber INTEGER");
  }
  if (!phaseCol.some((c) => c.name === "gsdStep")) {
    db.exec("ALTER TABLE tasks ADD COLUMN gsdStep TEXT CHECK (gsdStep IN ('discuss', 'plan', 'execute', 'verify'))");
  }

  // Migration: add cronJobSlug column for cron-to-task linking
  const cronCol = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  if (!cronCol.some((c) => c.name === "cronJobSlug")) {
    db.exec("ALTER TABLE tasks ADD COLUMN cronJobSlug TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_cronJobSlug ON tasks(cronJobSlug)");
  }

  // Migration: add claudePid column for process-alive reaper
  const pidCol = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  if (!pidCol.some((c) => c.name === "claudePid")) {
    db.exec("ALTER TABLE tasks ADD COLUMN claudePid INTEGER");
  }
  // PID that this Command Centre spawned. The reaper only stops a live process
  // when it equals claudePid; hooks, cron runs and legacy rows never set it.
  if (!pidCol.some((c) => c.name === "ownedClaudePid")) {
    db.exec("ALTER TABLE tasks ADD COLUMN ownedClaudePid INTEGER");
  }
  if (!pidCol.some((c) => c.name === "cancelRequestedAt")) {
    db.exec("ALTER TABLE tasks ADD COLUMN cancelRequestedAt TEXT");
  }

  // Migration: add taskId column to cron_runs for linking runs to task outputs
  const cronRunCols = db.prepare("PRAGMA table_info(cron_runs)").all() as Array<{ name: string }>;
  if (!cronRunCols.some((c) => c.name === "taskId")) {
    db.exec("ALTER TABLE cron_runs ADD COLUMN taskId TEXT");
  }

  // Migration: add trigger column to cron_runs for manual vs scheduled distinction
  const cronRunTriggerCol = db.prepare("PRAGMA table_info(cron_runs)").all() as Array<{ name: string }>;
  if (!cronRunTriggerCol.some((c) => c.name === "trigger")) {
    db.exec("ALTER TABLE cron_runs ADD COLUMN trigger TEXT DEFAULT 'scheduled'");
  }

  if (!cronRunsSupportsTimeout(db)) {
    migrateCronRunsForTimeout(db);
  }

  // Migration: add permissionMode column for controlling Claude CLI permission mode per task
  const permCol = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  if (!permCol.some((c) => c.name === "permissionMode")) {
    db.exec("ALTER TABLE tasks ADD COLUMN permissionMode TEXT DEFAULT 'bypassPermissions'");
  }
  if (!permCol.some((c) => c.name === "executionPermissionMode")) {
    db.exec("ALTER TABLE tasks ADD COLUMN executionPermissionMode TEXT DEFAULT 'bypassPermissions'");
  }

  // Fix cron tasks that were incorrectly stored with 'default' permission mode
  db.exec("UPDATE tasks SET permissionMode = 'bypassPermissions' WHERE cronJobSlug IS NOT NULL AND permissionMode = 'default'");
  db.exec("UPDATE tasks SET executionPermissionMode = permissionMode WHERE executionPermissionMode IS NULL OR executionPermissionMode = ''");

  // Normalize stored permission modes so UI and execution share the same canonical values
  const taskPermissionRows = db.prepare(
    "SELECT id, permissionMode, executionPermissionMode FROM tasks"
  ).all() as Array<{ id: string; permissionMode: string | null; executionPermissionMode: string | null }>;
  const updateTaskPerms = db.prepare(
    "UPDATE tasks SET permissionMode = ?, executionPermissionMode = ? WHERE id = ?"
  );
  for (const row of taskPermissionRows) {
    const normalizedPermission = normalizePermissionMode(row.permissionMode, "bypassPermissions");
    const normalizedExecution = getExecutionPermissionMode(row.executionPermissionMode ?? row.permissionMode, "bypassPermissions");
    if (normalizedPermission !== row.permissionMode || normalizedExecution !== row.executionPermissionMode) {
      updateTaskPerms.run(normalizedPermission, normalizedExecution, row.id);
    }
  }

  // Migration: add model column for selecting Claude model per task
  const modelCol = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  if (!modelCol.some((c) => c.name === "model")) {
    db.exec("ALTER TABLE tasks ADD COLUMN model TEXT");
  }

  // Migration: add thinkingEffort column for selecting Claude reasoning effort per task
  const effortCol = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  if (!effortCol.some((c) => c.name === "thinkingEffort")) {
    db.exec("ALTER TABLE tasks ADD COLUMN thinkingEffort TEXT CHECK (thinkingEffort IN ('auto', 'low', 'medium', 'high', 'xhigh', 'max'))");
  }

  // Migration: add conversationId column to tasks for autonomous mode linkage
  const convCol = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  if (!convCol.some((c) => c.name === "conversationId")) {
    db.exec("ALTER TABLE tasks ADD COLUMN conversationId TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_conversationId ON tasks(conversationId)");
  }

  // Migration: add originMessageId column to tasks
  if (!convCol.some((c) => c.name === "originMessageId")) {
    db.exec("ALTER TABLE tasks ADD COLUMN originMessageId TEXT");
  }

  // Migration: add teamId column to tasks for Claude teams
  if (!convCol.some((c) => c.name === "teamId")) {
    db.exec("ALTER TABLE tasks ADD COLUMN teamId TEXT");
  }

  // Migration: add coordinationLevel column to tasks
  if (!convCol.some((c) => c.name === "coordinationLevel")) {
    db.exec("ALTER TABLE tasks ADD COLUMN coordinationLevel TEXT");
  }

  // Migration: add lastReplyAt column — tracks when the user last interacted
  const replyAtCol = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  if (!replyAtCol.some((c) => c.name === "lastReplyAt")) {
    db.exec("ALTER TABLE tasks ADD COLUMN lastReplyAt TEXT");
  }

  // Migration: add surfacedToConversation to task_logs
  const logSurfCol = db.prepare("PRAGMA table_info(task_logs)").all() as Array<{ name: string }>;
  if (!logSurfCol.some((c) => c.name === "surfacedToConversation")) {
    db.exec("ALTER TABLE task_logs ADD COLUMN surfacedToConversation INTEGER DEFAULT 0");
  }

  // Migration: add goalGroup column for semantic task clustering
  const goalCol = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  if (!goalCol.some((c) => c.name === "goalGroup")) {
    db.exec("ALTER TABLE tasks ADD COLUMN goalGroup TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_goalGroup ON tasks(goalGroup)");
  }

  // Migration: add tag column for user-defined project tagging
  if (!goalCol.some((c) => c.name === "tag")) {
    db.exec("ALTER TABLE tasks ADD COLUMN tag TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_tag ON tasks(tag)");
  }

  // Migration: add pinnedAt column for pinning tasks to the top of goals
  if (!goalCol.some((c) => c.name === "pinnedAt")) {
    db.exec("ALTER TABLE tasks ADD COLUMN pinnedAt TEXT");
  }

  if (!goalCol.some((c) => c.name === "archivedAt")) {
    db.exec("ALTER TABLE tasks ADD COLUMN archivedAt TEXT");
  }
  if (!goalCol.some((c) => c.name === "archivingAt")) {
    db.exec("ALTER TABLE tasks ADD COLUMN archivingAt TEXT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_archivedAt ON tasks(archivedAt)");

  // Migration: add questionSpec + questionAnswers columns to task_logs for
  // the structured-question system (pre- and mid-execution).
  const logCols = db.prepare("PRAGMA table_info(task_logs)").all() as Array<{ name: string }>;
  if (!logCols.some((c) => c.name === "questionSpec")) {
    db.exec("ALTER TABLE task_logs ADD COLUMN questionSpec TEXT");
  }
  if (!logCols.some((c) => c.name === "questionAnswers")) {
    db.exec("ALTER TABLE task_logs ADD COLUMN questionAnswers TEXT");
  }
  if (!logCols.some((c) => c.name === "toolUseId")) {
    db.exec("ALTER TABLE task_logs ADD COLUMN toolUseId TEXT");
  }
  if (!logCols.some((c) => c.name === "parentToolUseId")) {
    db.exec("ALTER TABLE task_logs ADD COLUMN parentToolUseId TEXT");
  }

  // Migration: older installs have a CHECK constraint on task_logs.type that
  // doesn't include 'structured_question'. SQLite can't alter CHECK
  // constraints in place, so recreate the table if needed.
  try {
    const tableSql = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'task_logs'")
      .get() as { sql: string } | undefined;
    if (tableSql && !tableSql.sql.includes("structured_question")) {
      console.log("[db] Migrating task_logs CHECK constraint to include structured_question");
      db.exec("BEGIN");
      try {
        db.exec(`CREATE TABLE task_logs_new (
          id TEXT PRIMARY KEY,
          taskId TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('text', 'tool_use', 'tool_result', 'question', 'structured_question', 'user_reply', 'system')),
          timestamp TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          toolName TEXT,
          toolArgs TEXT,
          toolResult TEXT,
          toolUseId TEXT,
          parentToolUseId TEXT,
          isCollapsed INTEGER DEFAULT 0,
          surfacedToConversation INTEGER DEFAULT 0,
          questionSpec TEXT,
          questionAnswers TEXT,
          permissionMode TEXT,
          FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE
        )`);
        // Copy data — use only columns known to exist in both tables
        const oldCols = db.prepare("PRAGMA table_info(task_logs)").all() as Array<{ name: string }>;
        const colNames = oldCols.map((c) => c.name);
        const shared = [
          "id", "taskId", "type", "timestamp", "content",
          "toolName", "toolArgs", "toolResult", "toolUseId", "parentToolUseId", "isCollapsed",
          "surfacedToConversation", "questionSpec", "questionAnswers", "permissionMode",
        ].filter((c) => colNames.includes(c));
        const colList = shared.join(", ");
        db.exec(`INSERT INTO task_logs_new (${colList}) SELECT ${colList} FROM task_logs`);
        db.exec("DROP TABLE task_logs");
        db.exec("ALTER TABLE task_logs_new RENAME TO task_logs");
        db.exec("CREATE INDEX IF NOT EXISTS idx_task_logs_taskId ON task_logs(taskId)");
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    }
  } catch (err) {
    console.error("[db] Failed to migrate task_logs CHECK constraint:", err);
  }

  // Migration: add permissionMode column to task_logs — records which mode was active per user reply
  try {
    db.exec("ALTER TABLE task_logs ADD COLUMN permissionMode TEXT");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/duplicate column/i.test(msg)) throw err;
  }

  migrateLegacyAutoPermissionModes(db);

  // Migration: add dependsOnTaskIds column — JSON array of task IDs this task depends on
  try {
    db.exec("ALTER TABLE tasks ADD COLUMN dependsOnTaskIds TEXT");
  } catch (err) {
    // SQLite doesn't support IF NOT EXISTS on ADD COLUMN — swallow duplicate column error
    const msg = err instanceof Error ? err.message : String(err);
    if (!/duplicate column/i.test(msg)) throw err;
  }

  // Migration: add startSnapshot column for diff-aware Files tab
  try {
    db.exec("ALTER TABLE tasks ADD COLUMN startSnapshot TEXT");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/duplicate column/i.test(msg)) throw err;
  }

  // Migration: add task branch lineage metadata. These fields are audit-only;
  // forkedFromClaudeSessionId must never be used for task resume.
  for (const column of ["forkedFromTaskId", "forkedFromLogId", "forkedFromClaudeSessionId"]) {
    try {
      db.exec(`ALTER TABLE tasks ADD COLUMN ${column} TEXT`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/duplicate column/i.test(msg)) throw err;
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('permission')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
      title TEXT NOT NULL,
      description TEXT,
      toolName TEXT NOT NULL,
      inputJson TEXT NOT NULL,
      decision TEXT,
      decisionMessage TEXT,
      createdAt TEXT NOT NULL,
      resolvedAt TEXT,
      FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_approval_requests_taskId ON approval_requests(taskId)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status)");

    db.prepare(
      "INSERT OR IGNORE INTO command_centre_migrations (name, appliedAt) VALUES (?, ?)"
    ).run(`local-profile-v${LOCAL_PROFILE_SCHEMA_VERSION}`, new Date().toISOString());
    db.prepare(
      "INSERT OR IGNORE INTO command_centre_migrations (name, appliedAt) VALUES (?, ?)"
    ).run("immutable-work-scope-v1", new Date().toISOString());

    if (descriptor.mode === "team") {
      updateLocalProfileStatus(descriptor, "ready");
    }
    return db;
  } catch (error) {
    try { db.close(); } catch { /* preserve the original initialization error */ }
    if (descriptor.mode === "team") {
      const message = error instanceof Error ? error.message : String(error);
      try { updateLocalProfileStatus(descriptor, "migration_failed", message); } catch { /* preserve original error */ }
    }
    throw error;
  }
}

function closeEntry(entry: LocalProfileHandleEntry): void {
  try { entry.db.pragma("wal_checkpoint(TRUNCATE)"); } catch { /* best effort */ }
  entry.db.close();
  profileHandles.delete(entry.descriptor.profileKey);
}

function getOrOpenProfileHandle(descriptor: LocalProfileDescriptorV1): LocalProfileHandleEntry {
  const existing = profileHandles.get(descriptor.profileKey);
  if (existing) {
    if (existing.descriptor.dbPath !== descriptor.dbPath) {
      throw new Error(`Local profile path changed while open: ${descriptor.profileKey}`);
    }
    existing.lastUsedAt = Date.now();
    return existing;
  }

  const entry: LocalProfileHandleEntry = {
    descriptor,
    db: initializeDatabase(descriptor),
    leases: 0,
    lastUsedAt: Date.now(),
  };
  profileHandles.set(descriptor.profileKey, entry);
  return entry;
}

function closeInactiveHandles(activeProfileKey: string): void {
  for (const entry of [...profileHandles.values()]) {
    if (entry.descriptor.profileKey !== activeProfileKey && entry.leases === 0) {
      closeEntry(entry);
    }
  }
}

export function getActiveLocalProfileDescriptor(): LocalProfileDescriptorV1 {
  return profileContext.getStore() ?? resolveLocalProfileDescriptor();
}

export function getDb(): Database.Database {
  const descriptor = getActiveLocalProfileDescriptor();
  const entry = getOrOpenProfileHandle(descriptor);
  return entry.db;
}

export function acquireLocalProfileLease(
  descriptor: LocalProfileDescriptorV1 = getActiveLocalProfileDescriptor(),
): LocalProfileLease {
  const entry = getOrOpenProfileHandle(descriptor);
  entry.leases += 1;
  entry.lastUsedAt = Date.now();
  let released = false;
  return Object.freeze({
    descriptor,
    db: entry.db,
    release() {
      if (released) return;
      released = true;
      entry.leases = Math.max(0, entry.leases - 1);
      entry.lastUsedAt = Date.now();
      let activeKey = descriptor.profileKey;
      try { activeKey = resolveLocalProfileDescriptor().profileKey; } catch { /* keep leased profile as active on lock */ }
      if (entry.leases === 0 && activeKey !== descriptor.profileKey) closeEntry(entry);
    },
  });
}

export function runWithLocalProfile<T>(
  descriptor: LocalProfileDescriptorV1,
  operation: () => T,
): T {
  return profileContext.run(descriptor, operation);
}

export function closeInactiveLocalProfileHandles(): void {
  const activeKey = resolveLocalProfileDescriptor().profileKey;
  closeInactiveHandles(activeKey);
}

export function closeAllLocalProfileHandles(): void {
  for (const entry of [...profileHandles.values()]) {
    if (entry.leases > 0) {
      throw new Error(`Cannot close local profile ${entry.descriptor.profileKey} while agents are active`);
    }
    closeEntry(entry);
  }
}

export function closeLocalProfileHandle(profileKey: string): boolean {
  const entry = profileHandles.get(profileKey);
  if (!entry) return true;
  if (entry.leases > 0) return false;
  closeEntry(entry);
  return true;
}

export function getOpenLocalProfileHandlesForTesting(): Array<{
  profileKey: string;
  dbPath: string;
  leases: number;
}> {
  return [...profileHandles.values()].map((entry) => ({
    profileKey: entry.descriptor.profileKey,
    dbPath: entry.descriptor.dbPath,
    leases: entry.leases,
  }));
}

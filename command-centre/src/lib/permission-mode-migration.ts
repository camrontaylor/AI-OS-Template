import type Database from "better-sqlite3";

export const AUTO_PERMISSION_SEMANTICS_MIGRATION = "aios_371_auto_semantics_v1";

function hasColumn(
  database: Database.Database,
  table: string,
  column: string,
): boolean {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some((candidate) => candidate.name === column);
}

/**
 * Before AIOS-371, Command Centre used `auto` as an alias for unrestricted
 * execution. Convert those values once, then preserve all future `auto` values
 * as Claude's native Auto mode.
 */
export function migrateLegacyAutoPermissionModes(database: Database.Database): boolean {
  database.exec(`
    CREATE TABLE IF NOT EXISTS command_centre_migrations (
      name TEXT PRIMARY KEY,
      appliedAt TEXT NOT NULL
    )
  `);

  const alreadyApplied = database
    .prepare("SELECT 1 FROM command_centre_migrations WHERE name = ?")
    .get(AUTO_PERMISSION_SEMANTICS_MIGRATION);
  if (alreadyApplied) return false;

  const migrate = database.transaction(() => {
    if (hasColumn(database, "tasks", "permissionMode")) {
      database
        .prepare("UPDATE tasks SET permissionMode = 'bypassPermissions' WHERE permissionMode = 'auto'")
        .run();
    }
    if (hasColumn(database, "tasks", "executionPermissionMode")) {
      database
        .prepare("UPDATE tasks SET executionPermissionMode = 'bypassPermissions' WHERE executionPermissionMode = 'auto'")
        .run();
    }
    if (hasColumn(database, "task_logs", "permissionMode")) {
      database
        .prepare("UPDATE task_logs SET permissionMode = 'bypassPermissions' WHERE permissionMode = 'auto'")
        .run();
    }

    database
      .prepare("INSERT INTO command_centre_migrations (name, appliedAt) VALUES (?, ?)")
      .run(AUTO_PERMISSION_SEMANTICS_MIGRATION, new Date().toISOString());
  });

  migrate();
  return true;
}

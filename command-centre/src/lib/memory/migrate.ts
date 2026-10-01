/**
 * AIOS Memory Schema — migration loader.
 *
 * Versioned migrations applied identically against a local PGLite handle or a
 * hosted Postgres client. This deliberately departs from the ops DB's
 * imperative PRAGMA style (Postgres has no `PRAGMA table_info`): a numbered
 * migration ledger gives the deterministic, reproducible schema state the
 * no-leak tests and CI need, and the PGLite store
 * bootstraps with a single `applyMigrations(db)` call.
 *
 * This module is DB-agnostic. The store supplies a thin {@link SqlClient}
 * adapter over `@electric-sql/pglite` (or `pg` for hosted Postgres).
 */

import fs from "node:fs";
import path from "node:path";

/** Default embedding dimension. Matches BGE-M3. */
export const DEFAULT_EMBED_DIM = 1024;

/** The token substituted in migration SQL for the embedding dimension. */
const EMBED_DIM_TOKEN = ":EMBED_DIM";

/**
 * Minimal DB surface both PGLite and node-postgres satisfy via a thin adapter.
 * - `exec` runs one or more statements with no parameters (DDL, a migration file).
 * - `query` runs a single parameterized statement and returns rows.
 */
export interface SqlClient {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
  transaction?<T>(fn: (client: SqlClient) => Promise<T>): Promise<T>;
}

/** One migration: a numeric version, a name, and its SQL (with `:EMBED_DIM`). */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export interface ApplyMigrationsOptions {
  /** Embedding dimension to bake into `vector(...)` columns. Default 1024. */
  embedDim?: number;
  /** Explicit migration list (takes precedence; useful for tests). */
  migrations?: Migration[];
  /** Directory of `NNNN_name.sql` files. Defaults to the co-located `migrations/`. */
  migrationsDir?: string;
}

export interface ApplyMigrationsResult {
  from: number;
  to: number;
  applied: string[];
  embedDim: number;
}

const MIGRATION_FILE_RE = /^(\d{4})_([a-z0-9_]+)\.sql$/i;

interface ResolveMigrationsDirOptions {
  dirname?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
}

function existingDirectory(value: string | null | undefined): string | null {
  if (!value) return null;
  const dir = path.resolve(value);
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? dir : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function resolveMigrationsDir(
  explicitDir?: string,
  options: ResolveMigrationsDirOptions = {},
): string {
  if (explicitDir) return explicitDir;

  const env = options.env ?? process.env;
  const moduleDir = options.dirname ?? __dirname;
  const cwd = options.cwd ?? process.cwd();
  const commandCentreFromEnv = existingDirectory(env.AI_OS_COMMAND_CENTRE_DIR);
  const workspaceFromEnv = existingDirectory(env.AI_OS_DIR);
  const candidates = unique([
    path.join(moduleDir, "migrations"),
    path.join(cwd, "src", "lib", "memory", "migrations"),
    ...(commandCentreFromEnv
      ? [path.join(commandCentreFromEnv, "src", "lib", "memory", "migrations")]
      : []),
    ...(workspaceFromEnv
      ? [path.join(workspaceFromEnv, "command-centre", "src", "lib", "memory", "migrations")]
      : []),
  ]);

  const found = candidates.map(existingDirectory).find((dir): dir is string => dir != null);
  if (found) return found;

  throw new Error(`Memory migrations directory not found. Checked: ${candidates.join(", ")}`);
}

/** Read and parse `NNNN_name.sql` migration files from a directory, sorted by version. */
export function loadMigrationsFromDir(dir: string): Migration[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const migrations: Migration[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = MIGRATION_FILE_RE.exec(entry.name);
    if (!match) continue;
    migrations.push({
      version: Number.parseInt(match[1], 10),
      name: match[2],
      sql: fs.readFileSync(path.join(dir, entry.name), "utf-8"),
    });
  }

  return sortMigrations(migrations);
}

/** Sort by version ascending and reject duplicate versions. */
export function sortMigrations(migrations: Migration[]): Migration[] {
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].version === sorted[i - 1].version) {
      throw new Error(`Duplicate migration version ${sorted[i].version}`);
    }
  }
  return sorted;
}

/** Validate and substitute the embedding dimension into a migration's SQL. */
export function renderMigrationSql(sql: string, embedDim: number): string {
  if (!Number.isInteger(embedDim) || embedDim < 1 || embedDim > 16000) {
    throw new Error(`Invalid embedDim ${embedDim}: must be an integer in [1, 16000]`);
  }
  return sql.split(EMBED_DIM_TOKEN).join(String(embedDim));
}

const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    integer     PRIMARY KEY,
  name       text        NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  embed_dim  integer     NOT NULL
);
`;

/**
 * Apply all pending migrations in order. Idempotent: already-applied versions
 * are skipped. Fails loudly if the DB was built with a different embedding
 * dimension (changing the dimension is a full re-embed/reindex, not a
 * migration — see docs/memory/memory-schema.md).
 */
export async function applyMigrations(
  db: SqlClient,
  opts: ApplyMigrationsOptions = {},
): Promise<ApplyMigrationsResult> {
  const embedDim = opts.embedDim ?? DEFAULT_EMBED_DIM;
  const migrations = sortMigrations(
    opts.migrations ?? loadMigrationsFromDir(resolveMigrationsDir(opts.migrationsDir)),
  );

  await db.exec(SCHEMA_MIGRATIONS_DDL);

  const { rows } = await db.query<{ version: number; embed_dim: number }>(
    "SELECT version, embed_dim FROM schema_migrations ORDER BY version",
  );
  const currentVersion = rows.length ? Math.max(...rows.map((row) => row.version)) : 0;
  const appliedVersions = new Set(rows.map((row) => row.version));

  // Dimension-change guard.
  const recordedDims = [...new Set(rows.map((row) => row.embed_dim))];
  const mismatchedDim = recordedDims.find((dim) => dim !== embedDim);
  if (mismatchedDim != null) {
    throw new Error(
      `Embedding dimension mismatch: database was built with ${mismatchedDim} but ` +
        `${embedDim} was requested. Changing the embedding dimension requires a full ` +
        `re-embed and reindex, not a migration. See docs/memory/memory-schema.md.`,
    );
  }

  const applied: string[] = [];
  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;

    const sql = renderMigrationSql(migration.sql, embedDim);
    await db.exec("BEGIN");
    try {
      await db.exec(sql);
      await db.query(
        "INSERT INTO schema_migrations (version, name, embed_dim) VALUES ($1, $2, $3)",
        [migration.version, migration.name, embedDim],
      );
      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw new Error(
        `Migration ${migration.version}_${migration.name} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    appliedVersions.add(migration.version);
    applied.push(`${migration.version}_${migration.name}`);
  }

  return {
    from: currentVersion,
    to: applied.length ? migrations[migrations.length - 1].version : currentVersion,
    applied,
    embedDim,
  };
}

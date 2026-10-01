#!/usr/bin/env node
/**
 * memory-reset — rebuild the local, derived memory index schema.
 *
 * Source Markdown, durable imports, Team OS data, search history, and the
 * stable local user identity are preserved. Hosted Postgres is intentionally
 * refused because it may contain shared data that cannot be reconstructed
 * safely from this machine.
 */

const fs = require("node:fs");
const path = require("node:path");

const { findWorkspaceRoot } = require("./workspace-root.cjs");
const { loadMemoryModules } = require("./load-memory-modules.cjs");
const { ensureLocalUserId } = require("./local-memory-identity.cjs");

const { backend, adapter, migrate } = loadMemoryModules({ withCapture: false });

// IMPORTANT FOR THE NEXT MEMORY MIGRATION (0024 OR LATER):
// The reset contract is fail-closed. After adding any migration, add a NEW
// final canonical, idempotent repair migration; include the complete definition
// of every rebuildable table; update both constants below; then update catalog
// snapshots, validation, and reset tests. Do not only bump the version.
const MEMORY_REPAIR_VERSION = 23;
const MEMORY_REPAIR_NAME = "memory_index_repair";
const LEGACY_RESET_GAP_VERSIONS = new Set([1, 2, 7, 8]);
const LEGACY_RESET_MARKERS = [9, 15, 18];

const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    integer     PRIMARY KEY,
  name       text        NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  embed_dim  integer     NOT NULL
);
`;

const DROP_REBUILDABLE_MEMORY_SQL = `
DROP TABLE IF EXISTS memory_source_provenance;
DROP TABLE IF EXISTS index_jobs;
DROP TABLE IF EXISTS memory_chunks;
DROP TABLE IF EXISTS memory_sources;
`;

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    if (arg === "--yes" || arg === "-y") flags.yes = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

const USAGE = `memory-reset — rebuild the LOCAL derived memory index schema

Preserves source files, durable imports, Team OS data, search history, and
.command-centre/local-memory-user.json. Refuses hosted Postgres.

Usage:
  node scripts/memory-reset.cjs --yes`;

async function tableExists(client, tableName) {
  const { rows } = await client.query(
    `SELECT 1 AS present
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1`,
    [tableName],
  );
  return rows.length > 0;
}

function loadMigrationPlan(migrationsOverride) {
  const migrations =
    migrationsOverride ?? migrate.loadMigrationsFromDir(migrate.resolveMigrationsDir());
  const repairMigration = migrations.find(
    (migration) =>
      migration.version === MEMORY_REPAIR_VERSION &&
      migration.name === MEMORY_REPAIR_NAME,
  );
  if (!repairMigration) {
    throw new Error(
      `Required migration ${MEMORY_REPAIR_VERSION}_${MEMORY_REPAIR_NAME} is missing.`,
    );
  }

  const expectedVersions = migrations.map((migration) => migration.version);
  for (let index = 0; index < expectedVersions.length; index += 1) {
    if (expectedVersions[index] !== index + 1) {
      throw new Error(
        "Memory migrations are not a continuous sequence; refusing a reset until " +
          "the migration files are repaired.",
      );
    }
  }

  const latestMigration = migrations[migrations.length - 1];
  if (
    !latestMigration ||
    latestMigration.version !== MEMORY_REPAIR_VERSION ||
    latestMigration.name !== MEMORY_REPAIR_NAME
  ) {
    const latestLabel = latestMigration
      ? `${String(latestMigration.version).padStart(4, "0")}_${latestMigration.name}`
      : "none";
    throw new Error(
      `Memory reset contract is stale: the canonical repair migration ` +
        `${String(MEMORY_REPAIR_VERSION).padStart(4, "0")}_${MEMORY_REPAIR_NAME} ` +
        `must be the final migration, but the latest migration is ${latestLabel}.\n` +
        "Before memory-reset can run, the author of migration 0024 or later must:\n" +
        "1. Add a new canonical, idempotent repair migration after all new migrations.\n" +
        "2. Include the complete definition of every rebuildable memory index table in it.\n" +
        "3. Update MEMORY_REPAIR_VERSION and MEMORY_REPAIR_NAME to that migration.\n" +
        "4. Update the catalog snapshots, schema validation, and memory reset tests.\n" +
        "Do not only bump the constant. Automatic replay of later migrations is deliberately refused.",
    );
  }

  return { migrations, repairMigration };
}

async function readMigrationRows(client) {
  if (!(await tableExists(client, "schema_migrations"))) return [];
  const { rows } = await client.query(
    "SELECT version, name, embed_dim FROM schema_migrations ORDER BY version",
  );
  return rows.map((row) => ({
    version: Number(row.version),
    name: String(row.name),
    embedDim: Number(row.embed_dim),
  }));
}

async function listDurablePublicTables(client) {
  const { rows } = await client.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name <> 'schema_migrations'
      ORDER BY table_name`,
  );
  return rows.map((row) => row.table_name);
}

const LATER_SCHEMA_TABLE_EVIDENCE = [
  [5, "skill_grants"],
  [8, "manual_imports"],
  [11, "team_api_sessions"],
  [12, "context_documents"],
  [12, "context_document_versions"],
  [13, "team_secrets"],
  [13, "secret_grants"],
  [14, "user_config_files"],
  [15, "memory_consolidation_batches"],
  [15, "memory_capture_events"],
  [15, "memory_source_provenance"],
  [16, "memory_sync_outbox"],
  [21, "team_os_instance"],
  [22, "company_memberships"],
  [22, "company_team_access_requests"],
  [22, "company_team_access_grants"],
  [22, "company_audit_events"],
];

const LATER_SCHEMA_COLUMN_EVIDENCE = [
  [9, "memory_sources", "status"],
  [15, "memory_sources", "created_by_user_id"],
  [22, "teams", "archived_at"],
];

const LATER_AUDIT_ACTION_EVIDENCE = new Map([
  ["memory.captured", 15],
  ["memory.consolidation_claimed", 15],
  ["memory.review_requested", 15],
  ["memory.discarded", 17],
  ["memory.updated", 18],
  ["memory.deleted", 18],
]);

async function findSchemaEvidenceAfter(client, version) {
  const evidence = [];
  const publicTables = new Set(await listDurablePublicTables(client));

  for (const [introducedIn, tableName] of LATER_SCHEMA_TABLE_EVIDENCE) {
    if (introducedIn > version && publicTables.has(tableName)) {
      evidence.push(`${tableName} (migration ${introducedIn})`);
    }
  }

  const relevantColumns = LATER_SCHEMA_COLUMN_EVIDENCE.filter(
    ([introducedIn, tableName]) =>
      introducedIn > version && publicTables.has(tableName),
  );
  for (const [introducedIn, tableName, columnName] of relevantColumns) {
    const { rows } = await client.query(
      `SELECT 1 AS present
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2`,
      [tableName, columnName],
    );
    if (rows.length > 0) {
      evidence.push(`${tableName}.${columnName} (migration ${introducedIn})`);
    }
  }

  if (publicTables.has("audit_events")) {
    const { rows } = await client.query(
      "SELECT DISTINCT action FROM audit_events ORDER BY action",
    );
    for (const row of rows) {
      const introducedIn = LATER_AUDIT_ACTION_EVIDENCE.get(row.action);
      if (introducedIn && introducedIn > version) {
        evidence.push(`audit action ${row.action} (migration ${introducedIn})`);
      }
    }
  }

  return evidence;
}

/**
 * Classify the ledger before changing database state. applyMigrations normally
 * tolerates holes, but replaying an old, mixed Team OS migration is unsafe once
 * newer audit rows exist. Only the exact legacy-reset holes are repairable.
 */
function analyzeMigrationHistory(rows, migrations) {
  if (rows.length === 0) {
    return {
      kind: "continuous",
      embedDim: migrate.DEFAULT_EMBED_DIM,
      missingLegacyVersions: [],
      appliedVersions: [],
      highestApplied: 0,
    };
  }

  const knownVersions = new Set(migrations.map((migration) => migration.version));
  const unknownVersions = rows
    .map((row) => row.version)
    .filter((version) => !knownVersions.has(version));
  if (unknownVersions.length > 0) {
    throw new Error(
      `Migration history contains unknown version(s): ${unknownVersions.join(", ")}. ` +
        "Refusing to reset before any index data is changed. Restore a backup or " +
        "use an administrative repair.",
    );
  }

  const recordedDims = [...new Set(rows.map((row) => row.embedDim))];
  if (
    recordedDims.length !== 1 ||
    !Number.isInteger(recordedDims[0]) ||
    recordedDims[0] < 1 ||
    recordedDims[0] > 16000
  ) {
    throw new Error(
      "Migration history has inconsistent embedding dimensions. Refusing to reset; " +
        "restore a backup or use an administrative repair.",
    );
  }

  const appliedVersions = new Set(rows.map((row) => row.version));
  const highestApplied = Math.max(...appliedVersions);
  const internalGaps = migrations
    .map((migration) => migration.version)
    .filter((version) => version <= highestApplied && !appliedVersions.has(version));

  if (internalGaps.length === 0) {
    return {
      kind: "continuous",
      embedDim: recordedDims[0],
      missingLegacyVersions: [],
      appliedVersions: [...appliedVersions],
      highestApplied,
    };
  }

  const isKnownLegacyGap =
    internalGaps.length === LEGACY_RESET_GAP_VERSIONS.size &&
    internalGaps.every((version) => LEGACY_RESET_GAP_VERSIONS.has(version)) &&
    LEGACY_RESET_MARKERS.every((version) => appliedVersions.has(version));
  if (isKnownLegacyGap) {
    return {
      kind: "legacy-reset-gap",
      embedDim: recordedDims[0],
      missingLegacyVersions: internalGaps,
      appliedVersions: [...appliedVersions],
      highestApplied,
    };
  }

  throw new Error(
    `Migration history has an unsafe gap at version(s): ${internalGaps.join(", ")}. ` +
      "Refusing to reset before any index data is changed. Restore a backup or " +
      "use an administrative repair.",
  );
}

function renderRepairSql(repairMigration, embedDim) {
  return migrate.renderMigrationSql(repairMigration.sql, embedDim);
}

const REQUIRED_COLUMNS = {
  search_events: [
    "id",
    "team_id",
    "client_id",
    "user_id",
    "visibility_set",
    "query_text",
    "query_embedding",
    "top_k",
    "result_count",
    "result_chunk_ids",
    "latency_ms",
    "metadata",
    "created_at",
  ],
  manual_imports: [
    "id",
    "team_id",
    "client_id",
    "user_id",
    "visibility",
    "actor_user_id",
    "source_path",
    "source_type",
    "title",
    "content_date",
    "authority_weight",
    "content",
    "content_sha256",
    "status",
    "attempts",
    "source_id",
    "error_message",
    "metadata",
    "created_at",
    "updated_at",
    "indexed_at",
  ],
  memory_sources: [
    "id",
    "team_id",
    "client_id",
    "user_id",
    "visibility",
    "source_path",
    "source_type",
    "title",
    "content_date",
    "authority_weight",
    "content_sha256",
    "byte_size",
    "metadata",
    "created_at",
    "updated_at",
    "status",
    "error_message",
    "indexed_at",
    "archived_at",
    "created_by_user_id",
  ],
  memory_chunks: [
    "id",
    "source_id",
    "team_id",
    "client_id",
    "user_id",
    "visibility",
    "chunk_index",
    "content",
    "heading",
    "token_count",
    "source_path",
    "source_type",
    "content_date",
    "authority_weight",
    "embedding",
    "embedding_model",
    "embedding_dim",
    "metadata",
    "created_at",
    "start_line",
    "end_line",
    "heading_level",
    "content_hash",
    "chunk_key",
    "content_tsv",
  ],
  index_jobs: [
    "id",
    "team_id",
    "client_id",
    "user_id",
    "visibility",
    "source_path",
    "source_id",
    "reason",
    "status",
    "attempts",
    "error_message",
    "payload",
    "enqueued_at",
    "started_at",
    "finished_at",
  ],
  memory_source_provenance: [
    "id",
    "source_id",
    "capture_event_id",
    "team_id",
    "client_id",
    "actor_user_id",
    "contribution_kind",
    "metadata",
    "created_at",
  ],
};

const REQUIRED_INDEXES = [
  "uq_memory_sources_scope_path",
  "idx_memory_sources_status_updated",
  "idx_memory_sources_created_by",
  "idx_memory_chunks_embedding_hnsw",
  "idx_memory_chunks_scope",
  "idx_memory_chunks_source_id",
  "uq_memory_chunks_source_chunk_key",
  "idx_memory_chunks_source_order",
  "idx_memory_chunks_chunk_key",
  "idx_memory_chunks_content_tsv",
  "idx_index_jobs_status_enqueued",
  "uq_memory_source_provenance_source_capture",
  "idx_memory_source_provenance_team_source",
  "idx_manual_imports_team_status",
  "idx_manual_imports_source_path",
  "idx_search_events_team_created",
];

const REQUIRED_FOREIGN_KEYS = [
  ["memory_chunks", "memory_sources", "c"],
  ["index_jobs", "memory_sources", "n"],
  ["memory_source_provenance", "memory_sources", "c"],
  ["memory_source_provenance", "memory_capture_events", "c"],
];

async function validateMemoryIndexSchema(client, embedDim) {
  for (const [tableName, expectedColumns] of Object.entries(REQUIRED_COLUMNS)) {
    const { rows } = await client.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1`,
      [tableName],
    );
    const actualColumns = new Set(rows.map((row) => row.column_name));
    const missingColumns = expectedColumns.filter((column) => !actualColumns.has(column));
    if (missingColumns.length > 0) {
      throw new Error(
        `Memory schema validation failed: ${tableName} is missing column(s) ` +
          `${missingColumns.join(", ")}.`,
      );
    }
  }

  const { rows: indexRows } = await client.query(
    `SELECT indexname
       FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN (
          'manual_imports',
          'search_events',
          'memory_sources',
          'memory_chunks',
          'index_jobs',
          'memory_source_provenance'
        )`,
  );
  const actualIndexes = new Set(indexRows.map((row) => row.indexname));
  const missingIndexes = REQUIRED_INDEXES.filter((index) => !actualIndexes.has(index));
  if (missingIndexes.length > 0) {
    throw new Error(
      `Memory schema validation failed: missing index(es) ${missingIndexes.join(", ")}.`,
    );
  }

  const { rows: foreignKeyRows } = await client.query(
    `SELECT source.relname AS source_table,
            target.relname AS target_table,
            constraint_row.confdeltype AS delete_action
       FROM pg_constraint AS constraint_row
       JOIN pg_class AS source ON source.oid = constraint_row.conrelid
       JOIN pg_class AS target ON target.oid = constraint_row.confrelid
      WHERE constraint_row.contype = 'f'
        AND source.relname IN (
          'memory_chunks',
          'index_jobs',
          'memory_source_provenance'
        )`,
  );
  for (const [sourceTable, targetTable, deleteAction] of REQUIRED_FOREIGN_KEYS) {
    const present = foreignKeyRows.some(
      (row) =>
        row.source_table === sourceTable &&
        row.target_table === targetTable &&
        row.delete_action === deleteAction,
    );
    if (!present) {
      throw new Error(
        `Memory schema validation failed: missing ${sourceTable} -> ${targetTable} relation.`,
      );
    }
  }

  const { rows: vectorRows } = await client.query(
    `SELECT format_type(attribute.atttypid, attribute.atttypmod) AS column_type
       FROM pg_attribute AS attribute
       JOIN pg_class AS table_row ON table_row.oid = attribute.attrelid
       JOIN pg_namespace AS schema_row ON schema_row.oid = table_row.relnamespace
      WHERE schema_row.nspname = 'public'
        AND table_row.relname = 'memory_chunks'
        AND attribute.attname = 'embedding'
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped`,
  );
  if (vectorRows.length !== 1 || vectorRows[0].column_type !== `vector(${embedDim})`) {
    throw new Error(
      `Memory schema validation failed: memory_chunks.embedding is not vector(${embedDim}).`,
    );
  }
}

async function prepareMigrationHistory(client, migrationPlan) {
  const rows = await readMigrationRows(client);
  if (rows.length === 0) {
    const durableTables = await listDurablePublicTables(client);
    if (durableTables.length > 0) {
      throw new Error(
        "Migration history is empty but durable database tables already exist " +
          `(${durableTables.join(", ")}). Refusing to guess that this is a new ` +
          "installation or replay historical Team OS migrations. Restore a backup " +
          "or use an administrative repair.",
      );
    }
  }
  const history = analyzeMigrationHistory(rows, migrationPlan.migrations);

  const pendingMigrations = migrationPlan.migrations.filter(
    (migration) => !history.appliedVersions.includes(migration.version),
  );
  if (
    history.kind !== "legacy-reset-gap" &&
    pendingMigrations.length > 0 &&
    history.highestApplied > 0
  ) {
    const laterEvidence = await findSchemaEvidenceAfter(
      client,
      history.highestApplied,
    );
    if (laterEvidence.length > 0) {
      throw new Error(
        `Migration history ends at version ${history.highestApplied}, but the ` +
          `database contains objects or data from a later migration: ` +
          `${laterEvidence.join(", ")}. Refusing to replay historical Team OS ` +
          "migrations. Restore a backup or use an administrative repair.",
      );
    }
  }

  // This function is deliberately a read-only preflight. Applying pending
  // migrations belongs to resetLocalSchema's transaction so a later rebuild or
  // validation failure also rolls back the migration effects and ledger rows.
  return { embedDim: history.embedDim, history, pendingMigrations };
}

async function resetLocalSchema(
  client,
  embedDim,
  migrationPlan,
  history,
  hooks = {},
) {
  await client.exec("BEGIN");
  try {
    if (history.kind !== "legacy-reset-gap") {
      const appliedVersions = new Set(history.appliedVersions);
      await client.exec(SCHEMA_MIGRATIONS_DDL);
      for (const migration of migrationPlan.migrations) {
        if (appliedVersions.has(migration.version)) continue;
        await client.exec(migrate.renderMigrationSql(migration.sql, embedDim));
        await client.query(
          `INSERT INTO schema_migrations (version, name, embed_dim)
           VALUES ($1, $2, $3)`,
          [migration.version, migration.name, embedDim],
        );
        appliedVersions.add(migration.version);
      }
    }

    if (await tableExists(client, "manual_imports")) {
      // Preserve imported content while detaching source ids that are about to
      // be rebuilt.
      await client.exec(`
        UPDATE manual_imports
           SET source_id = NULL,
               status = 'queued',
               indexed_at = NULL,
               error_message = NULL,
               updated_at = now()
         WHERE source_id IS NOT NULL
      `);
    }

    await client.exec(DROP_REBUILDABLE_MEMORY_SQL);
    if (hooks.afterDrop) await hooks.afterDrop(client);

    // Use the exact same SQL as migration 0023. There is intentionally no
    // second, hand-maintained reset schema.
    await client.exec(renderRepairSql(migrationPlan.repairMigration, embedDim));

    if (history.kind === "legacy-reset-gap") {
      const originallyApplied = new Set(history.appliedVersions);
      const migrationsByVersion = new Map(
        migrationPlan.migrations.map((migration) => [migration.version, migration]),
      );
      const recordMigration = async (migration) => {
        await client.query(
          `INSERT INTO schema_migrations (version, name, embed_dim)
           VALUES ($1, $2, $3)`,
          [migration.version, migration.name, embedDim],
        );
        originallyApplied.add(migration.version);
      };

      // If the old reset was run before the newest release migrations, apply
      // that continuous tail in this same transaction. Migration 0019 expects
      // memory_chunks, so the canonical repair intentionally runs first.
      for (const migration of migrationPlan.migrations) {
        if (
          migration.version >= MEMORY_REPAIR_VERSION ||
          originallyApplied.has(migration.version) ||
          LEGACY_RESET_GAP_VERSIONS.has(migration.version)
        ) {
          continue;
        }
        await client.exec(migrate.renderMigrationSql(migration.sql, embedDim));
        await recordMigration(migration);
      }

      // 0001/0002 are superseded by the canonical schema, 0008 is repaired by
      // its CREATE IF NOT EXISTS block there, and 0007's historical audit rule
      // is superseded by the recorded later audit migrations. Record only those
      // known effects; never execute the old Team OS constraint again.
      for (const version of history.missingLegacyVersions) {
        await recordMigration(migrationsByVersion.get(version));
      }

      if (!originallyApplied.has(MEMORY_REPAIR_VERSION)) {
        await recordMigration(migrationPlan.repairMigration);
      }

      // Future migrations after the canonical repair remain normal migrations,
      // but are kept inside this transaction so no new ledger hole can escape.
      for (const migration of migrationPlan.migrations) {
        if (
          migration.version <= MEMORY_REPAIR_VERSION ||
          originallyApplied.has(migration.version)
        ) {
          continue;
        }
        await client.exec(migrate.renderMigrationSql(migration.sql, embedDim));
        await recordMigration(migration);
      }
    }

    await validateMemoryIndexSchema(client, embedDim);

    const finalRows = await readMigrationRows(client);
    const finalHistory = analyzeMigrationHistory(finalRows, migrationPlan.migrations);
    const finalVersions = new Set(finalRows.map((row) => row.version));
    const finalMissing = migrationPlan.migrations
      .map((migration) => migration.version)
      .filter((version) => !finalVersions.has(version));
    if (finalHistory.kind !== "continuous" || finalMissing.length > 0) {
      throw new Error(
        `Memory reset left an incomplete migration history: ` +
          `${finalMissing.join(", ") || "unknown gap"}.`,
      );
    }

    await client.exec("COMMIT");
  } catch (error) {
    await client.exec("ROLLBACK");
    throw error;
  }
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const flags = parseArgs(argv);
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }
  if (!flags.yes) {
    console.error("memory-reset: pass --yes to confirm rebuilding the local memory index.");
    return 2;
  }

  const rootDir = env.AI_OS_DIR
    ? path.resolve(env.AI_OS_DIR)
    : findWorkspaceRoot(__dirname);
  const dataDir = path.join(rootDir, ".command-centre", "memory");
  const resolved = backend.resolveMemoryBackend({ dataDir }, env);

  if (resolved.kind === "postgres") {
    console.error(
      "memory-reset: refusing to reset hosted Postgres. Shared TeamOS memory may not be " +
        "reconstructible from this machine. Use memory:backup/restore or an administrative rebuild.",
    );
    return 2;
  }

  // The old identity file lived inside the PGLite directory. Preserve/migrate
  // it before openPGlite is allowed to quarantine a corrupt derived store.
  ensureLocalUserId(rootDir);

  const migrationPlan = loadMigrationPlan();
  const pg = await adapter.openPGlite(resolved.dataDir, { recreateCorruptDir: true });
  try {
    const prepared = await prepareMigrationHistory(pg.client, migrationPlan);
    await resetLocalSchema(
      pg.client,
      prepared.embedDim,
      migrationPlan,
      prepared.history,
    );
  } finally {
    await pg.close();
  }

  fs.rmSync(path.join(resolved.dataDir, ".bootstrap-done"), { force: true });
  console.log("memory-reset: rebuilt the local memory schema and preserved the local user identity.");
  console.log("Next: npm run memory:reindex -- --allow-local --force");
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`\nmemory-reset failed: ${error instanceof Error ? error.message : error}`);
      if (error && error.stack) console.error(error.stack);
      console.error(`\n${USAGE}`);
      process.exitCode = 1;
    });
}

module.exports = {
  DROP_REBUILDABLE_MEMORY_SQL,
  analyzeMigrationHistory,
  loadMigrationPlan,
  main,
  prepareMigrationHistory,
  resetLocalSchema,
  validateMemoryIndexSchema,
};

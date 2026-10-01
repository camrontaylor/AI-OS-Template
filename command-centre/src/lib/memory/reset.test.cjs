const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");

const { loadMemoryModules } = require("../../../scripts/load-memory-modules.cjs");
const {
  ensureLocalUserId,
  legacyLocalUserConfigPath,
  localUserConfigPath,
} = require("../../../scripts/local-memory-identity.cjs");

const { adapter, migrate, store } = loadMemoryModules({ withCapture: false });
const BOOTSTRAP_SCRIPT = path.resolve(__dirname, "../../../scripts/memory-bootstrap.cjs");
const REINDEX_SCRIPT = path.resolve(__dirname, "../../../scripts/memory-reindex.cjs");
const RESET_SCRIPT = path.resolve(__dirname, "../../../scripts/memory-reset.cjs");
const STATUS_SCRIPT = path.resolve(__dirname, "../../../scripts/memory-status.cjs");
const resetApi = require(RESET_SCRIPT);
const MIGRATIONS_DIR = path.resolve(__dirname, "migrations");
const INDEX_TABLES = [
  "memory_sources",
  "memory_chunks",
  "index_jobs",
  "memory_source_provenance",
  "manual_imports",
  "search_events",
];

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aios-memory-reset-"));
  fs.mkdirSync(path.join(root, "context", "memory"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "context", "memory", "2026-07-23.md"),
    "# Daily\n\nReset regression fixture.\n",
  );
  fs.writeFileSync(path.join(root, "context", "learnings.md"), "# Learnings\n\nReset safely.\n");
  return root;
}

function localEnv(root, overrides = {}) {
  return {
    ...process.env,
    AI_OS_DIR: root,
    MEMORY_DATABASE_URL: "",
    DATABASE_URL: "",
    MEMORY_STORE_BACKEND: "pglite",
    MEMORY_EMBEDDER: "hash",
    ...overrides,
  };
}

function run(script, root, args = [], overrides = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: localEnv(root, overrides),
  });
}

function findQuarantinedMemoryDir(root) {
  const commandCentreDir = path.join(root, ".command-centre");
  const entry = fs
    .readdirSync(commandCentreDir)
    .find((name) => name.startsWith("memory.corrupt-"));
  return entry ? path.join(commandCentreDir, entry) : null;
}

test("memory reset refuses future migrations until its repair contract is updated", () => {
  const plan = resetApi.loadMigrationPlan();
  assert.throws(
    () =>
      resetApi.loadMigrationPlan([
        ...plan.migrations,
        { version: 24, name: "future_memory_change", sql: "SELECT 1;" },
      ]),
    (error) => {
      assert.match(error.message, /0024_future_memory_change/);
      assert.match(error.message, /canonical, idempotent repair migration/);
      assert.match(error.message, /complete definition of every rebuildable memory index table/);
      assert.match(error.message, /MEMORY_REPAIR_VERSION and MEMORY_REPAIR_NAME/);
      assert.match(error.message, /catalog snapshots, schema validation, and memory reset tests/);
      assert.match(error.message, /deliberately refused/);
      return true;
    },
  );
});

async function verifyRebuiltSchema(root) {
  const pg = await adapter.openPGlite(path.join(root, ".command-centre", "memory"));
  try {
    const sources = await pg.client.query(
      "SELECT count(*)::int AS n FROM memory_sources",
    );
    assert.equal(Number(sources.rows[0].n), 0);

    const columns = await pg.client.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'memory_sources'`,
    );
    assert.ok(columns.rows.some((row) => row.column_name === "created_by_user_id"));

    const tables = await pg.client.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'`,
    );
    assert.ok(tables.rows.some((row) => row.table_name === "memory_source_provenance"));

    const migrations = await pg.client.query(
      "SELECT min(version)::int AS first, max(version)::int AS last, count(*)::int AS n FROM schema_migrations",
    );
    assert.equal(Number(migrations.rows[0].first), 1);
    assert.ok(Number(migrations.rows[0].last) >= 22);
    assert.equal(Number(migrations.rows[0].n), Number(migrations.rows[0].last));
  } finally {
    await pg.close();
  }
}

async function openMigrated(root) {
  const pg = await adapter.openPGlite(path.join(root, ".command-centre", "memory"));
  await migrate.applyMigrations(pg.client, { migrationsDir: MIGRATIONS_DIR });
  return pg;
}

async function catalogSnapshot(client) {
  const tableList = INDEX_TABLES.map((table) => `'${table}'`).join(", ");
  const { rows: columns } = await client.query(
    `SELECT table_name,
            ordinal_position::int,
            column_name,
            data_type,
            udt_name,
            is_nullable,
            column_default,
            is_generated,
            generation_expression
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN (${tableList})
      ORDER BY table_name, ordinal_position`,
  );
  const { rows: constraints } = await client.query(
    `SELECT table_row.relname AS table_name,
            constraint_row.conname AS constraint_name,
            constraint_row.contype AS constraint_type,
            pg_get_constraintdef(constraint_row.oid, true) AS definition
       FROM pg_constraint AS constraint_row
       JOIN pg_class AS table_row ON table_row.oid = constraint_row.conrelid
       JOIN pg_namespace AS schema_row ON schema_row.oid = table_row.relnamespace
      WHERE schema_row.nspname = 'public'
        AND table_row.relname IN (${tableList})
      ORDER BY table_row.relname, constraint_row.conname`,
  );
  const { rows: indexes } = await client.query(
    `SELECT tablename AS table_name, indexname AS index_name, indexdef
       FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN (${tableList})
      ORDER BY tablename, indexname`,
  );
  return { columns, constraints, indexes };
}

async function insertPreservedFixture(client) {
  const { rows: teamRows } = await client.query(
    `INSERT INTO teams (slug, name)
     VALUES ('reset-team', 'Reset Team')
     RETURNING id`,
  );
  const teamId = teamRows[0].id;

  const { rows: sourceRows } = await client.query(
    `INSERT INTO memory_sources (
       user_id, visibility, source_path, source_type, content_sha256,
       status, created_by_user_id
     )
     VALUES (
       'local-reset-user', 'private', 'context/memory/reset.md', 'memory',
       'source-sha', 'indexed', 'local-reset-user'
     )
     RETURNING id`,
  );
  const sourceId = sourceRows[0].id;

  await client.query(
    `INSERT INTO manual_imports (
       user_id, visibility, source_path, content, content_sha256,
       status, source_id, indexed_at
     )
     VALUES (
       'local-reset-user', 'private', 'manual/reset.md', 'durable import',
       'import-sha', 'indexed', $1, now()
     )`,
    [sourceId],
  );
  await client.exec(`
    INSERT INTO search_events (
      user_id, visibility_set, query_text, result_count
    )
    VALUES (
      'local-reset-user', ARRAY['private'], 'preserve this search', 1
    );

    INSERT INTO memory_consolidation_batches (
      team_id, visibility, claim_token, capture_count
    )
    VALUES ('reset-team-id', 'team', 'reset-claim', 1);

    INSERT INTO memory_capture_events (
      team_id, actor_user_id, visibility, session_id, source_hash,
      content, content_sha256
    )
    VALUES (
      'reset-team-id', 'local-reset-user', 'team', 'reset-session',
      'capture-hash', 'durable capture', 'capture-content-sha'
    );

    INSERT INTO memory_sync_outbox (
      operation, dedupe_key, team_id, actor_user_id, visibility,
      request_path, request_body
    )
    VALUES (
      'capture_create', 'reset-outbox', 'reset-team-id', 'local-reset-user',
      'private', '/memory/capture', '{}'::jsonb
    );

    CREATE TABLE unrelated_reset_data (
      id integer PRIMARY KEY,
      value text NOT NULL
    );
    INSERT INTO unrelated_reset_data VALUES (1, 'preserve me');
  `);

  const { rows: captureRows } = await client.query(
    "SELECT id FROM memory_capture_events WHERE source_hash = 'capture-hash'",
  );
  await client.query(
    `INSERT INTO memory_source_provenance (
       source_id, capture_event_id, team_id, actor_user_id
     )
     VALUES ($1, $2, 'reset-team-id', 'local-reset-user')`,
    [sourceId, captureRows[0].id],
  );
  await client.query(
    `INSERT INTO audit_events (
       team_id, action, target_type, summary
     )
     VALUES ($1, 'memory.captured', 'memory_capture', 'preserve this audit')`,
    [teamId],
  );

  return { sourceId, teamId };
}

async function countRows(client, tableName) {
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${tableName}`);
  return Number(rows[0].n);
}

test("memory reset preserves local identity and fully rebuilds the schema twice", async () => {
  const root = tempRoot();
  try {
    const bootstrap = run(BOOTSTRAP_SCRIPT, root, ["--verbose"]);
    assert.equal(bootstrap.status, 0, bootstrap.stderr);
    const identityPath = path.join(root, ".command-centre", "local-memory-user.json");
    const sentinelPath = path.join(root, ".command-centre", "memory", ".bootstrap-done");
    const identityBefore = fs.readFileSync(identityPath, "utf8");
    assert.ok(fs.existsSync(sentinelPath));

    const first = run(RESET_SCRIPT, root, ["--yes"]);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /npm run memory:reindex -- --allow-local --force/);
    assert.equal(fs.readFileSync(identityPath, "utf8"), identityBefore);
    assert.equal(fs.existsSync(sentinelPath), false);
    await verifyRebuiltSchema(root);

    const second = run(RESET_SCRIPT, root, ["--yes"]);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(fs.readFileSync(identityPath, "utf8"), identityBefore);
    await verifyRebuiltSchema(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory reset preserves durable and Team OS data and matches a fresh catalog", async () => {
  const root = tempRoot();
  const dataDir = path.join(root, ".command-centre", "memory");
  const sentinelPath = path.join(dataDir, ".bootstrap-done");
  const modelPath = path.join(root, ".command-centre", "models", "reset-model.bin");
  let pg;
  try {
    const identity = ensureLocalUserId(root);
    pg = await openMigrated(root);
    const freshCatalog = await catalogSnapshot(pg.client);
    await insertPreservedFixture(pg.client);
    await pg.close();
    pg = null;

    fs.mkdirSync(path.dirname(modelPath), { recursive: true });
    fs.writeFileSync(modelPath, "model bytes stay outside the derived index");
    fs.writeFileSync(sentinelPath, "done\n");

    const result = run(RESET_SCRIPT, root, ["--yes"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Next: npm run memory:reindex -- --allow-local --force/);
    assert.equal(fs.existsSync(sentinelPath), false);
    assert.equal(fs.readFileSync(modelPath, "utf8"), "model bytes stay outside the derived index");
    assert.equal(ensureLocalUserId(root), identity);

    pg = await adapter.openPGlite(dataDir);
    assert.deepEqual(await catalogSnapshot(pg.client), freshCatalog);
    assert.equal(await countRows(pg.client, "memory_sources"), 0);
    assert.equal(await countRows(pg.client, "memory_chunks"), 0);
    assert.equal(await countRows(pg.client, "index_jobs"), 0);
    assert.equal(await countRows(pg.client, "memory_source_provenance"), 0);

    const { rows: importRows } = await pg.client.query(
      `SELECT content, status, source_id, indexed_at, error_message
         FROM manual_imports`,
    );
    assert.deepEqual(importRows, [
      {
        content: "durable import",
        status: "queued",
        source_id: null,
        indexed_at: null,
        error_message: null,
      },
    ]);
    const { rows: searchRows } = await pg.client.query(
      "SELECT query_text, result_count FROM search_events",
    );
    assert.deepEqual(searchRows, [{ query_text: "preserve this search", result_count: 1 }]);
    assert.equal(await countRows(pg.client, "memory_capture_events"), 1);
    assert.equal(await countRows(pg.client, "memory_consolidation_batches"), 1);
    assert.equal(await countRows(pg.client, "memory_sync_outbox"), 1);
    assert.equal(await countRows(pg.client, "teams"), 1);
    assert.equal(await countRows(pg.client, "audit_events"), 1);
    assert.equal(await countRows(pg.client, "unrelated_reset_data"), 1);

    const { rows: auditRows } = await pg.client.query(
      "SELECT action, target_type, summary FROM audit_events",
    );
    assert.deepEqual(auditRows, [
      {
        action: "memory.captured",
        target_type: "memory_capture",
        summary: "preserve this audit",
      },
    ]);
  } finally {
    if (pg) await pg.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory reset atomically repairs the exact legacy 1/2/7/8 ledger damage", async () => {
  const root = tempRoot();
  let pg;
  try {
    pg = await openMigrated(root);
    await insertPreservedFixture(pg.client);

    // Faithful shape of the former reset: durable imports/search telemetry were
    // dropped, memory_sources CASCADE removed provenance's FK but left its table,
    // and only these four migration records were deleted.
    await pg.client.exec(`
      DROP TABLE IF EXISTS search_events CASCADE;
      DROP TABLE IF EXISTS manual_imports CASCADE;
      DROP TABLE IF EXISTS index_jobs CASCADE;
      DROP TABLE IF EXISTS memory_chunks CASCADE;
      DROP TABLE IF EXISTS memory_sources CASCADE;
      DELETE FROM schema_migrations WHERE version IN (1, 2, 7, 8, 23);
    `);
    assert.equal(await countRows(pg.client, "memory_source_provenance"), 1);
    await pg.close();
    pg = null;

    const result = run(RESET_SCRIPT, root, ["--yes"]);
    assert.equal(result.status, 0, result.stderr);

    pg = await adapter.openPGlite(path.join(root, ".command-centre", "memory"));
    const { rows: migrationRows } = await pg.client.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    assert.deepEqual(
      migrationRows.map((row) => Number(row.version)),
      Array.from({ length: 23 }, (_, index) => index + 1),
    );
    assert.equal(await countRows(pg.client, "memory_sources"), 0);
    assert.equal(await countRows(pg.client, "memory_source_provenance"), 0);
    assert.equal(await countRows(pg.client, "manual_imports"), 0);
    assert.equal(await countRows(pg.client, "search_events"), 0);
    assert.equal(await countRows(pg.client, "audit_events"), 1);
    const { rows: auditRows } = await pg.client.query(
      "SELECT action, target_type FROM audit_events",
    );
    assert.deepEqual(auditRows, [
      { action: "memory.captured", target_type: "memory_capture" },
    ]);
    await resetApi.validateMemoryIndexSchema(pg.client, 1024);
    await pg.close();
    pg = null;

    const localUserId = ensureLocalUserId(root);
    const reindex = run(REINDEX_SCRIPT, root, ["--allow-local", "--force"]);
    assert.equal(reindex.status, 0, reindex.stderr);

    pg = await adapter.openPGlite(path.join(root, ".command-centre", "memory"));
    const { rows: rebuiltSources } = await pg.client.query(
      `SELECT visibility, user_id, created_by_user_id
         FROM memory_sources
        ORDER BY source_path`,
    );
    assert.ok(rebuiltSources.length >= 2);
    assert.ok(
      rebuiltSources.every(
        (row) =>
          row.visibility === "private" &&
          row.user_id === localUserId &&
          Object.prototype.hasOwnProperty.call(row, "created_by_user_id"),
      ),
    );
  } finally {
    if (pg) await pg.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory reset does not mistake a partial legacy gap for the known reset damage", () => {
  const migrationPlan = resetApi.loadMigrationPlan();
  const rows = migrationPlan.migrations
    .filter((migration) => migration.version !== 1)
    .map((migration) => ({
      version: migration.version,
      name: migration.name,
      embedDim: 1024,
    }));

  assert.throws(
    () => resetApi.analyzeMigrationHistory(rows, migrationPlan.migrations),
    /unsafe gap at version\(s\): 1/,
  );
});

test("memory reset refuses an unknown migration gap before changing index data", async () => {
  const root = tempRoot();
  const sentinelPath = path.join(root, ".command-centre", "memory", ".bootstrap-done");
  let pg;
  try {
    pg = await openMigrated(root);
    await pg.client.exec(`
      INSERT INTO memory_sources (
        user_id, visibility, source_path, source_type, content_sha256
      )
      VALUES (
        'local-gap-user', 'private', 'context/memory/gap.md', 'memory', 'gap-sha'
      );
      DELETE FROM schema_migrations WHERE version = 6;
    `);
    await pg.close();
    pg = null;
    fs.writeFileSync(sentinelPath, "done\n");

    const result = run(RESET_SCRIPT, root, ["--yes"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unsafe gap at version\(s\): 6/);
    assert.match(result.stderr, /Restore a backup or use an administrative repair/);
    assert.equal(fs.existsSync(sentinelPath), true);

    pg = await adapter.openPGlite(path.join(root, ".command-centre", "memory"));
    assert.equal(await countRows(pg.client, "memory_sources"), 1);
    const { rows: versionRows } = await pg.client.query(
      "SELECT version FROM schema_migrations WHERE version = 6",
    );
    assert.equal(versionRows.length, 0);
  } finally {
    if (pg) await pg.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory reset refuses an empty ledger when durable Team OS data exists", async () => {
  const root = tempRoot();
  const sentinelPath = path.join(root, ".command-centre", "memory", ".bootstrap-done");
  let pg;
  try {
    pg = await openMigrated(root);
    await insertPreservedFixture(pg.client);
    await pg.client.exec("DELETE FROM schema_migrations");
    await pg.close();
    pg = null;
    fs.writeFileSync(sentinelPath, "done\n");

    const result = run(RESET_SCRIPT, root, ["--yes"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Migration history is empty but durable database tables already exist/);
    assert.match(result.stderr, /Restore a backup or use an administrative repair/);
    assert.equal(fs.existsSync(sentinelPath), true);

    pg = await adapter.openPGlite(path.join(root, ".command-centre", "memory"));
    assert.equal(await countRows(pg.client, "schema_migrations"), 0);
    assert.equal(await countRows(pg.client, "memory_sources"), 1);
    assert.equal(await countRows(pg.client, "manual_imports"), 1);
    assert.equal(await countRows(pg.client, "audit_events"), 1);
    const { rows: auditRows } = await pg.client.query(
      "SELECT action, target_type FROM audit_events",
    );
    assert.deepEqual(auditRows, [
      { action: "memory.captured", target_type: "memory_capture" },
    ]);
  } finally {
    if (pg) await pg.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory reset refuses a short continuous ledger when newer Team OS data exists", async () => {
  const root = tempRoot();
  const sentinelPath = path.join(root, ".command-centre", "memory", ".bootstrap-done");
  let pg;
  try {
    pg = await openMigrated(root);
    await insertPreservedFixture(pg.client);
    await pg.client.exec("DELETE FROM schema_migrations WHERE version > 4");
    await pg.close();
    pg = null;
    fs.writeFileSync(sentinelPath, "done\n");

    const result = run(RESET_SCRIPT, root, ["--yes"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Migration history ends at version 4/);
    assert.match(result.stderr, /audit action memory\.captured \(migration 15\)/);
    assert.match(result.stderr, /Restore a backup or use an administrative repair/);
    assert.equal(fs.existsSync(sentinelPath), true);

    pg = await adapter.openPGlite(path.join(root, ".command-centre", "memory"));
    const { rows: migrationRows } = await pg.client.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    assert.deepEqual(
      migrationRows.map((row) => Number(row.version)),
      [1, 2, 3, 4],
    );
    assert.equal(await countRows(pg.client, "memory_sources"), 1);
    assert.equal(await countRows(pg.client, "manual_imports"), 1);
    assert.equal(await countRows(pg.client, "audit_events"), 1);
    const { rows: auditRows } = await pg.client.query(
      "SELECT action, target_type FROM audit_events",
    );
    assert.deepEqual(auditRows, [
      { action: "memory.captured", target_type: "memory_capture" },
    ]);
  } finally {
    if (pg) await pg.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory reset rolls back imports and index tables when rebuilding fails", async () => {
  const root = tempRoot();
  let pg;
  try {
    pg = await openMigrated(root);
    const { sourceId } = await insertPreservedFixture(pg.client);
    const migrationPlan = resetApi.loadMigrationPlan();
    const prepared = await resetApi.prepareMigrationHistory(pg.client, migrationPlan);

    await assert.rejects(
      () =>
        resetApi.resetLocalSchema(
          pg.client,
          prepared.embedDim,
          migrationPlan,
          prepared.history,
          {
            afterDrop() {
              throw new Error("injected failure after drop");
            },
          },
        ),
      /injected failure after drop/,
    );

    assert.equal(await countRows(pg.client, "memory_sources"), 1);
    assert.equal(await countRows(pg.client, "memory_source_provenance"), 1);
    const { rows: importRows } = await pg.client.query(
      "SELECT source_id, status, indexed_at IS NOT NULL AS has_indexed_at FROM manual_imports",
    );
    assert.deepEqual(importRows, [
      { source_id: sourceId, status: "indexed", has_indexed_at: true },
    ]);
    assert.equal(await countRows(pg.client, "audit_events"), 1);
  } finally {
    if (pg) await pg.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory reset rolls back migration 23 and the rebuild to the exact version 22 state", async () => {
  const root = tempRoot();
  let pg;
  try {
    pg = await adapter.openPGlite(path.join(root, ".command-centre", "memory"));
    const migrations = migrate
      .loadMigrationsFromDir(MIGRATIONS_DIR)
      .filter((migration) => migration.version <= 22);
    await migrate.applyMigrations(pg.client, { migrations });
    const { sourceId } = await insertPreservedFixture(pg.client);

    const migrationPlan = resetApi.loadMigrationPlan();
    const ledgerBefore = await pg.client.query(
      `SELECT version, name, embed_dim
         FROM schema_migrations
        ORDER BY version`,
    );
    const catalogBefore = await catalogSnapshot(pg.client);
    const importsBefore = await pg.client.query(
      `SELECT source_id, status, indexed_at IS NOT NULL AS has_indexed_at
         FROM manual_imports`,
    );

    const prepared = await resetApi.prepareMigrationHistory(pg.client, migrationPlan);
    assert.deepEqual(
      prepared.pendingMigrations.map((migration) => migration.version),
      [23],
    );
    assert.deepEqual(
      await pg.client.query(
        `SELECT version, name, embed_dim
           FROM schema_migrations
          ORDER BY version`,
      ),
      ledgerBefore,
      "preflight must not apply migration 23 or update its ledger",
    );

    await assert.rejects(
      () =>
        resetApi.resetLocalSchema(
          pg.client,
          prepared.embedDim,
          migrationPlan,
          prepared.history,
          {
            async afterDrop(client) {
              const { rows } = await client.query(
                "SELECT version FROM schema_migrations WHERE version = 23",
              );
              assert.deepEqual(rows, [{ version: 23 }]);
              throw new Error("injected failure after migration 23 and drop");
            },
          },
        ),
      /injected failure after migration 23 and drop/,
    );

    assert.deepEqual(
      await pg.client.query(
        `SELECT version, name, embed_dim
           FROM schema_migrations
          ORDER BY version`,
      ),
      ledgerBefore,
    );
    assert.deepEqual(await catalogSnapshot(pg.client), catalogBefore);
    assert.deepEqual(
      await pg.client.query(
        `SELECT source_id, status, indexed_at IS NOT NULL AS has_indexed_at
           FROM manual_imports`,
      ),
      importsBefore,
    );
    assert.equal(await countRows(pg.client, "memory_sources"), 1);
    assert.equal(await countRows(pg.client, "memory_source_provenance"), 1);
    const { rows: sourceRows } = await pg.client.query(
      "SELECT id FROM memory_sources",
    );
    assert.deepEqual(sourceRows, [{ id: sourceId }]);
  } finally {
    if (pg) await pg.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory reset refuses hosted Postgres without connecting", () => {
  const root = tempRoot();
  try {
    const result = run(RESET_SCRIPT, root, ["--yes"], {
      MEMORY_STORE_BACKEND: "postgres",
      MEMORY_DATABASE_URL: "postgres://example.invalid/ai_memory",
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /refusing to reset hosted Postgres/);
    assert.doesNotMatch(result.stderr, /getaddrinfo|ECONNREFUSED/);
    assert.equal(fs.existsSync(localUserConfigPath(root)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory reset still requires explicit --yes confirmation", () => {
  const root = tempRoot();
  try {
    const result = run(RESET_SCRIPT, root);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /pass --yes/);
    assert.equal(fs.existsSync(path.join(root, ".command-centre", "memory")), false);
    assert.equal(fs.existsSync(localUserConfigPath(root)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("local identity migrates from the legacy index directory without changing users", () => {
  const root = tempRoot();
  const legacyPath = legacyLocalUserConfigPath(root);
  const expected = {
    version: 1,
    userId: "local-existing-user",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  try {
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(legacyPath, `${JSON.stringify(expected, null, 2)}\n`);

    assert.equal(ensureLocalUserId(root), expected.userId);
    assert.deepEqual(JSON.parse(fs.readFileSync(localUserConfigPath(root), "utf8")), expected);
    assert.deepEqual(JSON.parse(fs.readFileSync(legacyPath, "utf8")), expected);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory reset preserves a legacy identity before quarantining a corrupt index", () => {
  const root = tempRoot();
  const dataDir = path.join(root, ".command-centre", "memory");
  const legacyPath = legacyLocalUserConfigPath(root);
  const expected = {
    version: 1,
    userId: "local-before-corrupt-quarantine",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(legacyPath, `${JSON.stringify(expected, null, 2)}\n`);
    // PGLite rejects an unsupported cluster version, causing the opted-in
    // derived-store quarantine path to move this directory aside.
    fs.writeFileSync(path.join(dataDir, "PG_VERSION"), "999\n");

    const result = run(RESET_SCRIPT, root, ["--yes"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(localUserConfigPath(root), "utf8")),
      expected,
    );
    assert.equal(ensureLocalUserId(root), expected.userId);

    const commandCentreDir = path.join(root, ".command-centre");
    const quarantined = fs
      .readdirSync(commandCentreDir)
      .find((entry) => entry.startsWith("memory.corrupt-"));
    assert.ok(quarantined, "corrupt index was quarantined");
    assert.deepEqual(
      JSON.parse(
        fs.readFileSync(
          path.join(commandCentreDir, quarantined, "local-user.json"),
          "utf8",
        ),
      ),
      expected,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory status promotes legacy identity before quarantining a corrupt index", () => {
  const root = tempRoot();
  const dataDir = path.join(root, ".command-centre", "memory");
  const legacyPath = legacyLocalUserConfigPath(root);
  const expected = {
    version: 1,
    userId: "local-status-before-corrupt-quarantine",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(legacyPath, `${JSON.stringify(expected, null, 2)}\n`);
    fs.writeFileSync(path.join(dataDir, "PG_VERSION"), "999\n");

    const result = run(STATUS_SCRIPT, root, ["--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(localUserConfigPath(root), "utf8")),
      expected,
    );
    const quarantined = findQuarantinedMemoryDir(root);
    assert.ok(quarantined, "corrupt index was quarantined");
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(quarantined, "local-user.json"), "utf8")),
      expected,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("openMemoryStore promotes legacy identity before its corrupt-index recovery", async () => {
  const root = tempRoot();
  const dataDir = path.join(root, ".command-centre", "memory");
  const legacyPath = legacyLocalUserConfigPath(root);
  const expected = {
    version: 1,
    userId: "local-store-before-corrupt-quarantine",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(legacyPath, `${JSON.stringify(expected, null, 2)}\n`);
    fs.writeFileSync(path.join(dataDir, "PG_VERSION"), "999\n");

    const memStore = await store.openMemoryStore({ dataDir });
    await memStore.close();

    assert.deepEqual(
      JSON.parse(fs.readFileSync(localUserConfigPath(root), "utf8")),
      expected,
    );
    assert.ok(findQuarantinedMemoryDir(root), "corrupt index was quarantined");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("invalid legacy identity stops openMemoryStore before quarantine", async () => {
  const root = tempRoot();
  const dataDir = path.join(root, ".command-centre", "memory");
  const legacyPath = legacyLocalUserConfigPath(root);
  const invalidIdentity = '{"version":1}\n';
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(legacyPath, invalidIdentity);
    fs.writeFileSync(path.join(dataDir, "PG_VERSION"), "999\n");

    await assert.rejects(
      store.openMemoryStore({ dataDir }),
      /Invalid local memory identity/,
    );
    assert.equal(fs.readFileSync(legacyPath, "utf8"), invalidIdentity);
    assert.equal(fs.existsSync(localUserConfigPath(root)), false);
    assert.equal(findQuarantinedMemoryDir(root), null);
    assert.equal(fs.readFileSync(path.join(dataDir, "PG_VERSION"), "utf8"), "999\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

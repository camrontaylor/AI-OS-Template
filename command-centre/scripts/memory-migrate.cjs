#!/usr/bin/env node
/**
 * memory-migrate — apply the shared memory schema to hosted Postgres.
 *
 * The hosted counterpart to the implicit migration openMemoryStore() runs for
 * local PGLite: connect to hosted Postgres via MEMORY_DATABASE_URL (falling
 * back to DATABASE_URL, which Railway injects), then run the same numbered
 * migrations from src/lib/memory/migrations against it. Hosted Postgres runs
 * the SAME schema as local PGLite, with pgvector enabled by the migration's
 * `CREATE EXTENSION`.
 *
 * It reuses migrate.ts and postgres-adapter.ts unchanged (loaded at runtime via
 * the same loadTsModule the other memory scripts use). Writes nothing but the
 * schema; never prints the connection password.
 *
 * Usage:
 *   MEMORY_DATABASE_URL=postgres://user:pass@host:5432/db npm run memory:migrate
 *   npm run memory:migrate -- --check          # report applied versions, no writes
 *   npm run memory:migrate -- --embed-dim 1024  # override the embedding dimension
 */

const path = require("node:path");

const { loadTsModule } = require("../src/lib/test-utils/load-ts-module.cjs");

const MEM_DIR = path.resolve(__dirname, "../src/lib/memory");
const resolve = (file) => path.join(MEM_DIR, file);

const USAGE = `memory-migrate — apply the memory schema to hosted Postgres

Reads the connection string from MEMORY_DATABASE_URL (or DATABASE_URL).

Usage:
  MEMORY_DATABASE_URL=postgres://... node scripts/memory-migrate.cjs [--check] [--embed-dim N]

Flags:
  --check          Report applied migrations without changing anything.
  --embed-dim N    Embedding dimension to bake into vector(...) columns (default 1024).
  -h, --help       Show this help.`;

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") flags.check = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--embed-dim") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("--embed-dim requires a value");
      flags.embedDim = Number.parseInt(value, 10);
      i += 1;
    } else if (arg.startsWith("--embed-dim=")) {
      flags.embedDim = Number.parseInt(arg.slice("--embed-dim=".length), 10);
    } else {
      throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return flags;
}

/** Mask the password in a connection string before logging it. */
function redact(connectionString) {
  try {
    const url = new URL(connectionString);
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "(connection string)";
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }

  const connectionString =
    process.env.MEMORY_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      "memory-migrate: no connection string. Set MEMORY_DATABASE_URL (or " +
        "DATABASE_URL) to a hosted Postgres URL, e.g. " +
        "postgres://user:password@host:5432/ai_memory.",
    );
    console.error(`\n${USAGE}`);
    return 2;
  }

  const migrate = loadTsModule(resolve("migrate.ts"));
  const adapter = loadTsModule(resolve("postgres-adapter.ts"));

  const embedDim = flags.embedDim ?? migrate.DEFAULT_EMBED_DIM;
  if (!Number.isInteger(embedDim) || embedDim < 1) {
    console.error(`memory-migrate: invalid --embed-dim "${flags.embedDim}"`);
    return 2;
  }

  const target = redact(connectionString);
  const { client, close } = await adapter.openPostgres(connectionString);
  try {
    if (flags.check) {
      const result = await client
        .query(
          "SELECT version, name, embed_dim, applied_at " +
            "FROM schema_migrations ORDER BY version",
        )
        .catch(() => null);
      console.log(`memory-migrate (check) → ${target}`);
      if (result === null) {
        console.log("  schema_migrations: not present (no migrations applied yet)");
        return 0;
      }
      if (result.rows.length === 0) {
        console.log("  applied: none");
      }
      for (const row of result.rows) {
        const version = String(row.version).padStart(4, "0");
        console.log(
          `  ${version}_${row.name}  embed_dim=${row.embed_dim}  @ ${row.applied_at}`,
        );
      }
      return 0;
    }

    const result = await migrate.applyMigrations(client, { embedDim });
    console.log(`memory-migrate → ${target}`);
    console.log(
      `  from version ${result.from} to ${result.to}  (embed_dim ${result.embedDim})`,
    );
    if (result.applied.length === 0) {
      console.log("  applied: none — schema already up to date");
    } else {
      console.log(`  applied: ${result.applied.join(", ")}`);
    }
    return 0;
  } finally {
    await close();
  }
}

main()
  .then((code) => {
    // Drain the event loop instead of process.exit(): forcing exit aborts
    // onnxruntime-node's native teardown (mutex lock failed → SIGABRT / Abort trap 6).
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(
      `\nmemory-migrate failed: ${error instanceof Error ? error.message : error}`,
    );
    if (error && error.stack) console.error(error.stack);
    console.error(`\n${USAGE}`);
    process.exitCode = 1;
  });

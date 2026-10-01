#!/usr/bin/env node
/**
 * memory-restore — restore the memory store from a backup file.
 *
 * The inverse of memory-backup. It picks what to do from the file extension and
 * cross-checks the resolved backend so a restore never silently targets the
 * wrong place:
 *   - <name>.dump      → pg_restore into the database at MEMORY_DATABASE_URL.
 *   - <name>.tar.gz    → extract into the local PGLite data dir.
 *
 * Restore is DESTRUCTIVE (it replaces the team's source of truth / local store),
 * so it requires an explicit --yes. With no --yes it prints exactly what it would
 * run and exits, following the "no silent unsafe source of truth" rule.
 *
 * The Postgres target must run a `pgvector/pgvector` image — the dump references
 * the `vector` extension. For a bad-migration recovery, use --clean to drop and
 * recreate objects in place; for a freshly provisioned empty database, omit it.
 *
 * Usage:
 *   MEMORY_DATABASE_URL=postgres://... npm run memory:restore -- backups/memory/ai_memory_<ts>.dump --yes
 *   MEMORY_DATABASE_URL=postgres://... npm run memory:restore -- <file>.dump --clean --yes   # replace in place
 *   npm run memory:restore -- backups/memory/pglite_memory_<ts>.tar.gz --yes                 # local PGLite
 *
 * Flags:
 *   --clean   pg_restore --clean --if-exists (drop+recreate objects before restoring)
 *   --local-user-id <id>  owner for a legacy PGLite backup with no identity
 *   --yes     confirm the destructive restore (required to actually run)
 *   --help
 */

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { loadTsModule } = require("../src/lib/test-utils/load-ts-module.cjs");
const { findWorkspaceRoot } = require("./workspace-root.cjs");
const {
  localUserConfigPath,
  readIdentityRecord,
  writeIdentityRecord,
} = require("./local-memory-identity.cjs");

const MEM_DIR = path.resolve(__dirname, "../src/lib/memory");
const backend = loadTsModule(path.join(MEM_DIR, "backend.ts"));
const migrate = loadTsModule(path.join(MEM_DIR, "migrate.ts"));
const pgliteAdapter = loadTsModule(path.join(MEM_DIR, "pglite-adapter.ts"), {
  stubs: { "./migrate": migrate },
});
const PGLITE_MANIFEST = "pglite-backup-manifest.json";
const PGLITE_BACKUP_FORMAT = "AI-OS-pglite-memory";
const PGLITE_BACKUP_VERSION = 1;

const USAGE = `memory-restore — restore the memory store from a backup file

Usage:
  npm run memory:restore -- <file> [--clean] --yes

Picks the strategy from the file:
  *.dump     → pg_restore into MEMORY_DATABASE_URL (must be a pgvector database)
  *.tar.gz   → extract into the local PGLite data dir

Flags:
  --clean   for *.dump: pg_restore --clean --if-exists (drop+recreate in place)
  --local-user-id <id>
            owner for a legacy PGLite backup only when ownership cannot be
            proven from its private rows
  --yes     confirm the destructive restore (required to actually run)
  --help`;

function parseArgs(argv) {
  const flags = { positionals: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--clean") flags.clean = true;
    else if (arg === "--local-user-id") flags.localUserId = argv[(i += 1)];
    else if (arg === "--yes") flags.yes = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown flag: ${arg}`);
    else flags.positionals.push(arg);
  }
  return flags;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function redact(connectionString) {
  try {
    const url = new URL(connectionString);
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "(connection string)";
  }
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function commandExists(cmd) {
  const r = spawnSync(cmd, ["--version"], { stdio: "ignore" });
  return !r.error && r.status === 0;
}

async function restorePostgres(file, flags) {
  const resolved = backend.resolveMemoryBackend({}, process.env);
  if (resolved.kind !== "postgres") {
    console.error(
      "\nmemory-restore: this is a Postgres dump (.dump), but no hosted database is\n" +
        "  configured. Set MEMORY_DATABASE_URL (or DATABASE_URL) to the target\n" +
        "  pgvector database and retry. Refusing to guess a target.",
    );
    return 2;
  }
  if (!commandExists("pg_restore")) {
    console.error(
      "\nmemory-restore: `pg_restore` not found. Install the Postgres client tools\n" +
        "  (e.g. the `postgresql-client` package, or `brew install libpq`) and retry.",
    );
    return 2;
  }

  const args = ["--no-owner", "--no-privileges", `--dbname=${resolved.connectionString}`];
  if (flags.clean) args.push("--clean", "--if-exists");
  args.push(file);

  console.log("memory-restore (postgres)");
  console.log(`  file: ${file}`);
  console.log(`  target: ${redact(resolved.connectionString)}`);
  console.log(`  mode: ${flags.clean ? "--clean --if-exists (replace in place)" : "into existing/empty database"}`);

  if (!flags.yes) {
    console.log(
      "\nDRY RUN — re-run with --yes to apply. This will run:\n" +
        `  pg_restore ${flags.clean ? "--clean --if-exists " : ""}--no-owner --no-privileges \\\n` +
        `    --dbname='${redact(resolved.connectionString)}' ${path.basename(file)}\n\n` +
        "  The target database is overwritten. Make sure it runs a pgvector image\n" +
        "  and that you have a current backup of its present state.",
    );
    return 0;
  }

  const r = spawnSync("pg_restore", args, {
    stdio: ["ignore", "inherit", "inherit"],
    env: process.env,
  });
  // pg_restore exits non-zero on benign "already exists" warnings without --clean;
  // surface the code but treat >0 as a real failure the operator should read.
  if (r.status !== 0) {
    console.error(
      `\nmemory-restore: pg_restore exited with code ${r.status ?? "(signal)"}.\n` +
        "  If restoring into a NON-empty database, re-run with --clean to replace in place.",
    );
    return 1;
  }
  console.log("\n── restore complete ────────────────────");
  console.log("  Verify: npm run memory:migrate -- --check   (schema_migrations)");
  console.log("          npm run memory:search -- \"<query>\" --system");
  return 0;
}

function listArchiveEntries(file) {
  const result = spawnSync("tar", ["-tzf", file], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`tar could not inspect the archive (exit ${result.status ?? "signal"}).`);
  }
  const entries = result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, ""))
    .filter(Boolean);
  for (const entry of entries) {
    const parts = entry.split("/");
    const allowed =
      entry === "memory" ||
      entry.startsWith("memory/") ||
      entry === "local-memory-user.json" ||
      entry === PGLITE_MANIFEST;
    if (
      path.posix.isAbsolute(entry) ||
      /^[A-Za-z]:/.test(entry) ||
      parts.includes("..") ||
      !allowed
    ) {
      throw new Error(`Unsafe or unexpected path in PGLite backup: ${entry}`);
    }
  }
  if (!entries.some((entry) => entry === "memory" || entry.startsWith("memory/"))) {
    throw new Error("PGLite backup does not contain the memory store.");
  }
  return entries;
}

function readBackupManifest(stagingDir) {
  const manifestPath = path.join(stagingDir, PGLITE_MANIFEST);
  if (!fs.existsSync(manifestPath)) return null;
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Invalid PGLite backup manifest: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    !manifest ||
    manifest.format !== PGLITE_BACKUP_FORMAT ||
    manifest.version !== PGLITE_BACKUP_VERSION ||
    manifest.paths?.store !== "memory" ||
    manifest.paths?.identity !== "local-memory-user.json" ||
    typeof manifest.identitySha256 !== "string"
  ) {
    throw new Error("Unsupported or incomplete PGLite backup manifest.");
  }
  return manifest;
}

async function discoverPrivateUserIds(dataDir) {
  const opened = await pgliteAdapter.openPGlite(dataDir);
  try {
    const candidates = [
      ["memory_sources", "user_id"],
      ["memory_chunks", "user_id"],
      ["index_jobs", "user_id"],
      ["manual_imports", "user_id"],
    ];
    const owners = new Set();
    for (const [table, column] of candidates) {
      const relation = await opened.client.query(
        "SELECT to_regclass($1) AS relation",
        [`public.${table}`],
      );
      if (!relation.rows[0]?.relation) continue;
      const { rows } = await opened.client.query(
        `SELECT DISTINCT ${column} AS user_id
           FROM ${table}
          WHERE visibility = 'private' AND ${column} IS NOT NULL`,
      );
      for (const row of rows) {
        if (row.user_id != null && String(row.user_id)) owners.add(String(row.user_id));
      }
    }
    return [...owners].sort();
  } finally {
    await opened.close();
  }
}

async function validatePGliteStore(dataDir) {
  let opened;
  try {
    opened = await pgliteAdapter.openPGlite(dataDir);
    const { rows } = await opened.client.query(
      `SELECT
         to_regclass('public.memory_sources') AS sources,
         to_regclass('public.memory_chunks') AS chunks`,
    );
    if (!rows[0]?.sources || !rows[0]?.chunks) {
      throw new Error("required memory tables are missing");
    }
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error
          ? JSON.stringify(error)
          : String(error);
    throw new Error(
      `PGLite backup does not contain a recognized AI-OS memory schema: ${detail}`,
    );
  } finally {
    if (opened) await opened.close();
  }
}

function resolveRestoredIdentity({ archiveIdentity, discoveredUserIds, localUserId }) {
  const override = typeof localUserId === "string" ? localUserId.trim() : "";
  if (archiveIdentity) {
    if (override && override !== archiveIdentity.userId) {
      throw new Error(
        `--local-user-id does not match the identity stored in the backup ` +
          `(${archiveIdentity.userId}).`,
      );
    }
    return archiveIdentity;
  }
  if (override) {
    return {
      version: 1,
      userId: override,
      createdAt: new Date().toISOString(),
      recoveredFrom: "legacy-backup-override",
    };
  }
  const unique = [...new Set(discoveredUserIds.filter(Boolean))];
  if (unique.length === 1) {
    return {
      version: 1,
      userId: unique[0],
      createdAt: new Date().toISOString(),
      recoveredFrom: "legacy-backup-private-rows",
    };
  }
  if (unique.length > 1) {
    throw new Error(
      `Legacy backup has ${unique.length} private owners (${unique.join(", ")}). ` +
        "Ownership is ambiguous; re-run with --local-user-id <id>.",
    );
  }
  throw new Error(
    "Legacy backup has no saved identity and no private owner can be proven. " +
      "Re-run with --local-user-id <id>.",
  );
}

function moveCurrentRestoreSetAside(dataDir, identityPath, parent, fileOps = fs) {
  if (!fileOps.existsSync(dataDir) && !fileOps.existsSync(identityPath)) return null;
  const aside = path.join(parent, `memory-restore-backup-${timestamp()}-${process.pid}`);
  fileOps.mkdirSync(aside);
  let movedData = false;
  let movedIdentity = false;
  try {
    if (fileOps.existsSync(dataDir)) {
      fileOps.renameSync(dataDir, path.join(aside, "memory"));
      movedData = true;
    }
    if (fileOps.existsSync(identityPath)) {
      fileOps.renameSync(identityPath, path.join(aside, "local-memory-user.json"));
      movedIdentity = true;
    }
  } catch (error) {
    if (movedIdentity) {
      fileOps.renameSync(path.join(aside, "local-memory-user.json"), identityPath);
    }
    if (movedData) fileOps.renameSync(path.join(aside, "memory"), dataDir);
    fileOps.rmSync(aside, { recursive: true, force: true });
    throw error;
  }
  return aside;
}

function rollbackRestoreSet(dataDir, identityPath, aside, fileOps = fs) {
  fileOps.rmSync(dataDir, { recursive: true, force: true });
  fileOps.rmSync(identityPath, { force: true });
  if (!aside || !fileOps.existsSync(aside)) return;
  const oldData = path.join(aside, "memory");
  const oldIdentity = path.join(aside, "local-memory-user.json");
  if (fileOps.existsSync(oldData)) fileOps.renameSync(oldData, dataDir);
  if (fileOps.existsSync(oldIdentity)) fileOps.renameSync(oldIdentity, identityPath);
  fileOps.rmSync(aside, { recursive: true, force: true });
}

function installRestoreSet({
  stagedData,
  stagedIdentity,
  dataDir,
  identityPath,
  parent,
  fileOps = fs,
}) {
  const aside = moveCurrentRestoreSetAside(dataDir, identityPath, parent, fileOps);
  try {
    fileOps.renameSync(stagedData, dataDir);
    fileOps.renameSync(stagedIdentity, identityPath);
    return aside;
  } catch (error) {
    rollbackRestoreSet(dataDir, identityPath, aside, fileOps);
    throw error;
  }
}

async function restorePglite(file, flags) {
  if (!commandExists("tar")) {
    console.error("\nmemory-restore: `tar` not found on PATH.");
    return 2;
  }
  const rootDir = process.env.AI_OS_DIR
    ? path.resolve(process.env.AI_OS_DIR)
    : findWorkspaceRoot(__dirname);
  const dataDir = path.join(rootDir, ".command-centre", "memory");
  const parent = path.dirname(dataDir);
  const identityPath = localUserConfigPath(rootDir);

  console.log("memory-restore (pglite)");
  console.log(`  file: ${file}`);
  console.log(`  target store: ${dataDir}`);
  console.log(`  target identity: ${identityPath}`);

  if (!flags.yes) {
    console.log(
      "\nDRY RUN — re-run with --yes to apply. This will:\n" +
        (fs.existsSync(dataDir) || fs.existsSync(identityPath)
          ? `  1. move the current store and identity aside as one recovery set\n`
          : "") +
        `  2. validate ${path.basename(file)} and recover its private owner\n` +
        "  3. install the restored store and identity together",
    );
    return 0;
  }

  if (flags.localUserId !== undefined && !String(flags.localUserId).trim()) {
    console.error("\nmemory-restore: --local-user-id requires a non-empty value.");
    return 2;
  }
  fs.mkdirSync(parent, { recursive: true });
  listArchiveEntries(file);
  const stagingDir = path.join(parent, `.memory-restore-stage-${process.pid}-${Date.now()}`);
  fs.mkdirSync(stagingDir);
  let aside = null;
  try {
    const r = spawnSync("tar", ["-xzf", file, "-C", stagingDir], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    if (r.status !== 0) {
      throw new Error(`tar exited with code ${r.status ?? "(signal)"}.`);
    }

    const stagedData = path.join(stagingDir, "memory");
    if (!fs.statSync(stagedData).isDirectory()) {
      throw new Error("PGLite backup memory entry is not a directory.");
    }
    const manifest = readBackupManifest(stagingDir);
    let archiveIdentity = null;
    if (manifest) {
      const stagedCanonicalIdentity = path.join(stagingDir, "local-memory-user.json");
      archiveIdentity = readIdentityRecord(stagedCanonicalIdentity);
      if (!archiveIdentity || sha256File(stagedCanonicalIdentity) !== manifest.identitySha256) {
        throw new Error("PGLite backup identity does not match its manifest.");
      }
    } else {
      // Old archives placed the identity inside the store. Older still had no
      // identity at all, in which case ownership must be proven from private rows.
      archiveIdentity = readIdentityRecord(path.join(stagedData, "local-user.json"));
    }

    await validatePGliteStore(stagedData);
    const discoveredUserIds =
      archiveIdentity || flags.localUserId
        ? []
        : await discoverPrivateUserIds(stagedData);
    const restoredIdentity = resolveRestoredIdentity({
      archiveIdentity,
      discoveredUserIds,
      localUserId: flags.localUserId,
    });
    const stagedIdentity = path.join(stagingDir, ".restored-local-memory-user.json");
    writeIdentityRecord(stagedIdentity, restoredIdentity);

    aside = installRestoreSet({
      stagedData,
      stagedIdentity,
      dataDir,
      identityPath,
      parent,
    });
    if (aside) console.log(`  moved current store and identity → ${aside}`);

    console.log(`  restored private owner: ${restoredIdentity.userId}`);
  } catch (error) {
    console.error(
      `\nmemory-restore: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  console.log("\n── restore complete ────────────────────");
  if (aside) console.log(`  previous set kept at: ${aside}`);
  console.log("  Verify: npm run memory:status");
  return 0;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }
  const file = flags.positionals[0];
  if (!file) {
    console.error("memory-restore: missing backup file.\n");
    console.error(USAGE);
    return 2;
  }
  if (!fs.existsSync(file)) {
    console.error(`memory-restore: file not found: ${file}`);
    return 2;
  }

  if (file.endsWith(".tar.gz") || file.endsWith(".tgz")) {
    return restorePglite(file, flags);
  }
  if (file.endsWith(".dump")) {
    return restorePostgres(file, flags);
  }
  console.error(
    `memory-restore: unrecognized backup file "${path.basename(file)}".\n` +
      "  Expected a .dump (Postgres) or .tar.gz (PGLite) produced by memory:backup.",
  );
  return 2;
}

module.exports = {
  discoverPrivateUserIds,
  installRestoreSet,
  moveCurrentRestoreSetAside,
  parseArgs,
  resolveRestoredIdentity,
  validatePGliteStore,
};

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`\nmemory-restore failed: ${error instanceof Error ? error.message : error}`);
      if (error && error.stack) console.error(error.stack);
      console.error(`\n${USAGE}`);
      process.exit(1);
    });
}

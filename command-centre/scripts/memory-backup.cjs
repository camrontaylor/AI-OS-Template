#!/usr/bin/env node
/**
 * memory-backup — one command to back up the memory store, whichever engine
 * is configured.
 *
 * Hosted Postgres is the team's shared source of truth. This is the recovery
 * side of that: a thin, backend-aware wrapper so an operator never has to
 * remember a long pg_dump invocation.
 *
 * It reuses the SAME pure backend seam every memory command goes through —
 * backend.resolveMemoryBackend() — so the engine choice is one inspectable rule,
 * not a per-command flag:
 *   - hosted Postgres → `pg_dump -Fc` (custom, compressed, restorable with
 *     pg_restore) to a timestamped .dump file.
 *   - local PGLite    → a gzip tar of the on-disk data dir (.command-centre/memory).
 *
 * It writes nothing to the database and never prints the connection password.
 *
 * Usage:
 *   MEMORY_DATABASE_URL=postgres://... npm run memory:backup
 *   npm run memory:backup -- --out /srv/backups        # custom destination
 *   npm run memory:backup -- --keep 14                 # prune older than the 14 newest
 *   npm run memory:backup                              # no URL set → backs up local PGLite
 *
 * Flags:
 *   --out <dir>   destination directory (default: <root>/backups/memory, or $MEMORY_BACKUP_DIR)
 *   --keep <N>    after writing, keep only the N newest backups in --out (prune the rest)
 *   --local-user-id <id>  explicitly recover a missing local owner identity
 *   --help
 */

const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { loadTsModule } = require("../src/lib/test-utils/load-ts-module.cjs");
const { findWorkspaceRoot } = require("./workspace-root.cjs");
const {
  legacyLocalUserConfigPath,
  localUserConfigPath,
  readIdentityRecord,
  writeIdentityRecord,
} = require("./local-memory-identity.cjs");
const {
  discoverPrivateUserIds,
  validatePGliteStore,
} = require("./memory-restore.cjs");

const MEM_DIR = path.resolve(__dirname, "../src/lib/memory");
// backend.ts is pure (no DB imports) — loads stub-free, like the other commands.
const backend = loadTsModule(path.join(MEM_DIR, "backend.ts"));
const PGLITE_MANIFEST = "pglite-backup-manifest.json";
const PGLITE_BACKUP_FORMAT = "AI-OS-pglite-memory";
const PGLITE_BACKUP_VERSION = 1;

const USAGE = `memory-backup — back up the memory store (hosted Postgres or local PGLite)

Backend is auto-detected: hosted Postgres when MEMORY_DATABASE_URL (or DATABASE_URL)
is set, else the local PGLite store. See docs/memory/backup-restore.md.

Usage:
  MEMORY_DATABASE_URL=postgres://... node scripts/memory-backup.cjs [--out DIR] [--keep N]

Flags:
  --out <dir>   destination directory (default: <root>/backups/memory or $MEMORY_BACKUP_DIR)
  --keep <N>    keep only the N newest backups in the destination (prune older)
  --local-user-id <id>  explicitly recover a missing local owner identity
  --help`;

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[(i += 1)];
    if (arg === "--out") flags.out = next();
    else if (arg === "--keep") flags.keep = Number.parseInt(next(), 10);
    else if (arg === "--local-user-id") flags.localUserId = next();
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

function resolveBackupIdentity({ identity, discoveredUserIds, localUserId }) {
  const override = typeof localUserId === "string" ? localUserId.trim() : "";
  if (identity) {
    if (override && override !== identity.userId) {
      throw new Error(
        `--local-user-id does not match the existing identity (${identity.userId}).`,
      );
    }
    return identity;
  }

  const unique = [...new Set(discoveredUserIds.filter(Boolean))];
  if (override) {
    if (unique.length > 0 && !unique.includes(override)) {
      throw new Error(
        `--local-user-id ${override} is not an owner of private rows in the local store.`,
      );
    }
    return {
      version: 1,
      userId: override,
      createdAt: new Date().toISOString(),
      recoveredFrom: "backup-owner-override",
    };
  }
  if (unique.length === 1) {
    return {
      version: 1,
      userId: unique[0],
      createdAt: new Date().toISOString(),
      recoveredFrom: "backup-private-rows",
    };
  }
  if (unique.length > 1) {
    throw new Error(
      "Local memory ownership is ambiguous. Refusing to create a backup with the wrong " +
        "identity. Re-run with --local-user-id <id> after verifying the intended owner.",
    );
  }
  throw new Error(
    "Local memory identity is missing and no private owner can be inferred. " +
      "Re-run with --local-user-id <id> after verifying the intended owner.",
  );
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

/** Local timestamp YYYYMMDD_HHMMSS for filenames (real runtime — Date is fine). */
function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** True if `cmd` is on PATH (probed with --version). */
function commandExists(cmd) {
  const r = spawnSync(cmd, ["--version"], { stdio: "ignore" });
  return !r.error && r.status === 0;
}

/** Database name from a connection string, for the filename. */
function dbName(connectionString) {
  try {
    const name = new URL(connectionString).pathname.replace(/^\//, "");
    return name || "ai_memory";
  } catch {
    return "ai_memory";
  }
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/** Keep only the N newest files whose name starts with `prefix`; delete the rest. */
function prune(outDir, prefix, keep) {
  if (!Number.isInteger(keep) || keep < 1) return [];
  const files = fs
    .readdirSync(outDir)
    .filter((f) => f.startsWith(prefix))
    .sort(); // timestamped names sort chronologically
  const stale = files.slice(0, Math.max(0, files.length - keep));
  for (const f of stale) fs.rmSync(path.join(outDir, f), { force: true });
  return stale;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }
  if (flags.keep !== undefined && (!Number.isInteger(flags.keep) || flags.keep < 1)) {
    console.error("memory-backup: --keep requires a positive integer.");
    return 2;
  }

  const rootDir = process.env.AI_OS_DIR
    ? path.resolve(process.env.AI_OS_DIR)
    : findWorkspaceRoot(__dirname);
  const dataDir = path.join(rootDir, ".command-centre", "memory");

  const outDir = flags.out
    ? path.resolve(flags.out)
    : process.env.MEMORY_BACKUP_DIR
      ? path.resolve(process.env.MEMORY_BACKUP_DIR)
      : path.join(rootDir, "backups", "memory");
  fs.mkdirSync(outDir, { recursive: true });

  // Same pure rule openMemoryStore() uses — back up whatever IS the store.
  const resolved = backend.resolveMemoryBackend({ dataDir }, process.env);
  console.log("memory-backup");
  console.log(`  backend: ${resolved.kind}`);
  console.log(`  out: ${outDir}`);

  let outFile;
  let prefix;

  if (resolved.kind === "postgres") {
    if (!commandExists("pg_dump")) {
      console.error(
        "\nmemory-backup: `pg_dump` not found. Install the Postgres client tools\n" +
          "  (e.g. the `postgresql-client` package, or `brew install libpq`) and retry.",
      );
      return 2;
    }
    prefix = `${dbName(resolved.connectionString)}_`;
    outFile = path.join(outDir, `${prefix}${timestamp()}.dump`);
    console.log(`  target: ${redact(resolved.connectionString)}`);
    console.log(`  running: pg_dump -Fc → ${path.basename(outFile)}`);

    // -Fc: custom format (compressed, selectively restorable). --no-owner/--no-acl:
    // portable across roles. PGSSLMODE / sslmode in the URL are honored via env.
    const r = spawnSync(
      "pg_dump",
      [
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        `--file=${outFile}`,
        `--dbname=${resolved.connectionString}`,
      ],
      { stdio: ["ignore", "inherit", "inherit"], env: process.env },
    );
    if (r.status !== 0) {
      fs.rmSync(outFile, { force: true });
      console.error(`\nmemory-backup: pg_dump exited with code ${r.status ?? "(signal)"}.`);
      return 1;
    }
  } else {
    // PGLite: package the store, its stable owner identity, and a versioned
    // manifest together. The store must be idle while it is copied.
    if (!fs.existsSync(dataDir)) {
      console.error(
        `\nmemory-backup: local PGLite data dir not found at ${dataDir}.\n` +
          "  Nothing to back up yet — run a memory command first, or set " +
          "MEMORY_DATABASE_URL to back up hosted Postgres.",
      );
      return 2;
    }
    if (!commandExists("tar")) {
      console.error("\nmemory-backup: `tar` not found on PATH.");
      return 2;
    }
    prefix = "pglite_memory_";
    outFile = path.join(outDir, `${prefix}${timestamp()}.tar.gz`);
    console.log(`  target: ${dataDir}`);
    console.log(`  running: tar -czf ${path.basename(outFile)}`);

    await validatePGliteStore(dataDir);
    const identityPath = localUserConfigPath(rootDir);
    const existingIdentity =
      readIdentityRecord(identityPath) ||
      readIdentityRecord(legacyLocalUserConfigPath(rootDir));
    const discoveredUserIds = existingIdentity
      ? []
      : await discoverPrivateUserIds(dataDir);
    const identity = resolveBackupIdentity({
      identity: existingIdentity,
      discoveredUserIds,
      localUserId: flags.localUserId,
    });

    const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-memory-backup-"));
    try {
      fs.cpSync(dataDir, path.join(stagingDir, "memory"), { recursive: true });
      writeIdentityRecord(path.join(stagingDir, "local-memory-user.json"), identity);
      const manifest = {
        format: PGLITE_BACKUP_FORMAT,
        version: PGLITE_BACKUP_VERSION,
        createdAt: new Date().toISOString(),
        paths: {
          store: "memory",
          identity: "local-memory-user.json",
        },
        identitySha256: sha256File(path.join(stagingDir, "local-memory-user.json")),
      };
      fs.writeFileSync(
        path.join(stagingDir, PGLITE_MANIFEST),
        `${JSON.stringify(manifest, null, 2)}\n`,
        { mode: 0o600 },
      );

      const r = spawnSync(
        "tar",
        [
          "-czf",
          outFile,
          "-C",
          stagingDir,
          "memory",
          "local-memory-user.json",
          PGLITE_MANIFEST,
        ],
        { stdio: ["ignore", "inherit", "inherit"] },
      );
      if (r.status !== 0) {
        fs.rmSync(outFile, { force: true });
        console.error(`\nmemory-backup: tar exited with code ${r.status ?? "(signal)"}.`);
        return 1;
      }
    } finally {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  const size = fs.statSync(outFile).size;
  console.log("\n── backup written ──────────────────────");
  console.log(`  file: ${outFile}`);
  console.log(`  size: ${humanSize(size)}`);

  if (flags.keep !== undefined) {
    const pruned = prune(outDir, prefix, flags.keep);
    console.log(`  retention: keeping ${flags.keep} newest; pruned ${pruned.length}.`);
  }

  console.log(
    "\nStore this file off-box (object storage, another host). " +
      "Restore with: npm run memory:restore -- " + path.basename(outFile),
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`\nmemory-backup failed: ${error instanceof Error ? error.message : error}`);
    if (error && error.stack) console.error(error.stack);
    console.error(`\n${USAGE}`);
    process.exit(1);
  });

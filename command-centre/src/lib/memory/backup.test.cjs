/**
 * backup.test.cjs — a backup can be restored, and the memory comes back.
 *
 * It drives the REAL scripts (memory-backup.cjs / memory-restore.cjs) end to end,
 * the same way an operator runs `npm run memory:backup` / `memory:restore`:
 *   - PGLite (default suite): a file-based store survives a tar backup → wipe →
 *     restore round-trip.
 *   - Postgres (gated on TEST_DATABASE_URL + pg_dump/pg_restore on PATH): seed a
 *     corpus, back it up, recreate the public schema, restore, and prove the
 *     rows return — the disaster-recovery path. The database must be owned and
 *     disposable.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawn, spawnSync } = require("node:child_process");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");

const SCRIPTS = path.resolve(__dirname, "../../../scripts");
const BACKUP = path.join(SCRIPTS, "memory-backup.cjs");
const RESTORE = path.join(SCRIPTS, "memory-restore.cjs");
const IDENTITY = path.join(SCRIPTS, "local-memory-identity.cjs");
const {
  ensureLocalUserId,
  localUserConfigPath,
} = require(IDENTITY);
const {
  installRestoreSet,
  moveCurrentRestoreSetAside,
  resolveRestoredIdentity,
  validatePGliteStore,
} = require(RESTORE);
const memoryMigrate = loadTsModule(path.resolve(__dirname, "migrate.ts"));
const memoryPgliteAdapter = loadTsModule(path.resolve(__dirname, "pglite-adapter.ts"), {
  stubs: { "./migrate": memoryMigrate },
});

const EMBED_DIM = 8;
const RUN_PG_TESTS =
  process.env.MEMORY_PG_TESTS === "1" ||
  process.env.npm_lifecycle_event === "test:memory:pg";
const TEST_URL = RUN_PG_TESTS ? process.env.TEST_DATABASE_URL : "";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-backup-"));
}
function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function run(args, env) {
  return spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}
function commandExists(cmd) {
  return !spawnSync(cmd, ["--version"], { stdio: "ignore" }).error;
}
function newestMatching(dir, predicate) {
  return fs
    .readdirSync(dir)
    .filter(predicate)
    .sort()
    .map((f) => path.join(dir, f))
    .pop();
}

function createTar(sourceDir, outFile, entries) {
  const result = spawnSync("tar", ["-czf", outFile, "-C", sourceDir, ...entries], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

async function seedLegacyPrivateOwners(dataDir, userIds) {
  const opened = await memoryPgliteAdapter.openPGlite(dataDir);
  try {
    await opened.client.exec(`
      CREATE TABLE memory_sources (user_id text, visibility text);
      CREATE TABLE memory_chunks (user_id text, visibility text);
    `);
    for (const userId of userIds) {
      await opened.client.query(
        "INSERT INTO memory_sources (user_id, visibility) VALUES ($1, 'private')",
        [userId],
      );
    }
  } finally {
    await opened.close();
  }
}

// ---------------------------------------------------------------------------
// PGLite — runs in the default suite. No database, no external binaries beyond
// tar; proves the script's backup → wipe → restore mechanics preserve the store.
// ---------------------------------------------------------------------------
test("backup then restore round-trips the local PGLite store", { skip: commandExists("tar") ? false : "tar not found" }, async () => {
  const root = tempDir();
  const dataDir = path.join(root, ".command-centre", "memory");
  const outDir = path.join(root, "backups", "memory");
  const identityBefore = ensureLocalUserId(root);
  await seedLegacyPrivateOwners(dataDir, [identityBefore]);
  // A known marker alongside the real PGLite files proves the whole directory
  // is restored, not only the rows used for ownership validation.
  fs.writeFileSync(path.join(dataDir, "probe.txt"), "memory-lives-here");

  const env = { AI_OS_DIR: root, MEMORY_DATABASE_URL: "", DATABASE_URL: "" };
  try {
    const b = run([BACKUP, "--out", outDir], env);
    assert.equal(b.status, 0, `backup failed:\n${b.stderr}`);
    const archive = newestMatching(outDir, (f) => f.startsWith("pglite_memory_") && f.endsWith(".tar.gz"));
    assert.ok(archive, "a pglite tar.gz backup was written");
    const entries = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" }).stdout;
    assert.match(entries, /local-memory-user\.json/);
    assert.match(entries, /pglite-backup-manifest\.json/);

    // Lose the store and its owner identity, then restore both from the archive.
    rmDir(dataDir);
    fs.rmSync(localUserConfigPath(root), { force: true });
    const r = run([RESTORE, archive, "--yes"], env);
    assert.equal(r.status, 0, `restore failed:\n${r.stderr}`);
    assert.equal(
      fs.readFileSync(path.join(dataDir, "probe.txt"), "utf8"),
      "memory-lives-here",
      "the store came back from the backup",
    );
    assert.equal(
      ensureLocalUserId(root),
      identityBefore,
      "the private owner came back with the store",
    );
  } finally {
    rmDir(root);
  }
});

test("backup and restore validation reject a directory without a real memory schema", { skip: commandExists("tar") ? false : "tar not found" }, async () => {
  const root = tempDir();
  const dataDir = path.join(root, ".command-centre", "memory");
  const outDir = path.join(root, "backups", "memory");
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "probe.txt"), "invalid-archive");
    const liveOwner = ensureLocalUserId(root);
    const env = { AI_OS_DIR: root, MEMORY_DATABASE_URL: "", DATABASE_URL: "" };
    const backup = run([BACKUP, "--out", outDir], env);
    assert.notEqual(backup.status, 0);
    assert.match(backup.stderr, /recognized AI-OS memory schema/i);
    await assert.rejects(
      () => validatePGliteStore(dataDir),
      /recognized AI-OS memory schema/i,
    );
    assert.equal(fs.readFileSync(path.join(dataDir, "probe.txt"), "utf8"), "invalid-archive");
    assert.equal(ensureLocalUserId(root), liveOwner);
  } finally {
    rmDir(root);
  }
});

test("backup infers one private owner without mutating a missing workspace identity", { skip: commandExists("tar") ? false : "tar not found" }, async () => {
  const root = tempDir();
  const dataDir = path.join(root, ".command-centre", "memory");
  const outDir = path.join(root, "backups", "memory");
  const extracted = tempDir();
  try {
    await seedLegacyPrivateOwners(dataDir, ["local-existing-owner"]);
    assert.equal(fs.existsSync(localUserConfigPath(root)), false);

    const result = run([BACKUP, "--out", outDir], {
      AI_OS_DIR: root,
      MEMORY_DATABASE_URL: "",
      DATABASE_URL: "",
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(
      fs.existsSync(localUserConfigPath(root)),
      false,
      "backup must not publish a recovered identity into the live workspace",
    );

    const archive = newestMatching(outDir, (file) => file.endsWith(".tar.gz"));
    const unpack = spawnSync("tar", ["-xzf", archive, "-C", extracted], {
      encoding: "utf8",
    });
    assert.equal(unpack.status, 0, unpack.stderr);
    assert.equal(
      readJson(path.join(extracted, "local-memory-user.json")).userId,
      "local-existing-owner",
    );
  } finally {
    rmDir(root);
    rmDir(extracted);
  }
});

test("backup refuses ambiguous private ownership without mutating the workspace", { skip: commandExists("tar") ? false : "tar not found" }, async () => {
  const root = tempDir();
  const dataDir = path.join(root, ".command-centre", "memory");
  const outDir = path.join(root, "backups", "memory");
  try {
    await seedLegacyPrivateOwners(dataDir, ["owner-a", "owner-b"]);
    const result = run([BACKUP, "--out", outDir], {
      AI_OS_DIR: root,
      MEMORY_DATABASE_URL: "",
      DATABASE_URL: "",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ambiguous/i);
    assert.equal(fs.existsSync(localUserConfigPath(root)), false);
    assert.equal(
      fs.existsSync(outDir) ? fs.readdirSync(outDir).length : 0,
      0,
      "no misleading backup should be written",
    );
  } finally {
    rmDir(root);
  }
});

test("local identity creation is concurrency-safe and never replaces invalid JSON", async () => {
  const root = tempDir();
  try {
    const script =
      `const h=require(${JSON.stringify(IDENTITY)});` +
      "process.stdout.write(h.ensureLocalUserId(process.argv[1]));";
    const runs = Array.from({ length: 12 }, () =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["-e", script, root], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => { stdout += chunk; });
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        child.on("error", reject);
        child.on("close", (code) => {
          if (code === 0) resolve(stdout);
          else reject(new Error(stderr || `identity child exited ${code}`));
        });
      }),
    );
    const ids = await Promise.all(runs);
    assert.equal(new Set(ids).size, 1, "all concurrent creators observed one winner");
    assert.equal(ensureLocalUserId(root), ids[0]);

    const identityPath = localUserConfigPath(root);
    fs.writeFileSync(identityPath, "{broken-json", "utf8");
    assert.throws(() => ensureLocalUserId(root), /Invalid local memory identity/);
    assert.equal(fs.readFileSync(identityPath, "utf8"), "{broken-json");
  } finally {
    rmDir(root);
  }
});

test("identity helper exposes --ensure --root for setup scripts", () => {
  const root = tempDir();
  try {
    const result = run([IDENTITY, "--ensure", "--root", root], {});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), ensureLocalUserId(root));
  } finally {
    rmDir(root);
  }
});

test("restore accepts a legacy archive identity stored under memory/local-user.json", { skip: commandExists("tar") ? false : "tar not found" }, async () => {
  const root = tempDir();
  const source = tempDir();
  const archive = path.join(root, "legacy.tar.gz");
  const legacyId = "local-legacy-owner";
  try {
    const memory = path.join(source, "memory");
    await seedLegacyPrivateOwners(memory, [legacyId]);
    fs.writeFileSync(path.join(memory, "probe.txt"), "legacy-store");
    fs.writeFileSync(
      path.join(memory, "local-user.json"),
      `${JSON.stringify({ version: 1, userId: legacyId })}\n`,
    );
    createTar(source, archive, ["memory"]);

    const result = run([RESTORE, archive, "--yes"], {
      AI_OS_DIR: root,
      MEMORY_DATABASE_URL: "",
      DATABASE_URL: "",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(ensureLocalUserId(root), legacyId);
    assert.equal(
      fs.readFileSync(path.join(root, ".command-centre", "memory", "probe.txt"), "utf8"),
      "legacy-store",
    );
  } finally {
    rmDir(root);
    rmDir(source);
  }
});

test("legacy restore accepts an explicit owner and rejects ambiguous inferred owners", { skip: commandExists("tar") ? false : "tar not found" }, async () => {
  assert.throws(
    () =>
      resolveRestoredIdentity({
        archiveIdentity: null,
        discoveredUserIds: ["user-a", "user-b"],
        localUserId: null,
      }),
    /ambiguous/i,
  );

  const root = tempDir();
  const source = tempDir();
  const archive = path.join(root, "legacy-no-identity.tar.gz");
  try {
    await seedLegacyPrivateOwners(path.join(source, "memory"), []);
    fs.writeFileSync(path.join(source, "memory", "probe.txt"), "legacy-no-owner");
    createTar(source, archive, ["memory"]);
    const result = run([RESTORE, archive, "--yes", "--local-user-id", "local-recovered"], {
      AI_OS_DIR: root,
      MEMORY_DATABASE_URL: "",
      DATABASE_URL: "",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(ensureLocalUserId(root), "local-recovered");
  } finally {
    rmDir(root);
    rmDir(source);
  }
});

test("legacy restore infers one private owner from the PGLite rows", { skip: commandExists("tar") ? false : "tar not found" }, async () => {
  const root = tempDir();
  const source = tempDir();
  const archive = path.join(root, "legacy-inferred-owner.tar.gz");
  try {
    await seedLegacyPrivateOwners(path.join(source, "memory"), ["local-inferred-owner"]);
    createTar(source, archive, ["memory"]);
    const result = run([RESTORE, archive, "--yes"], {
      AI_OS_DIR: root,
      MEMORY_DATABASE_URL: "",
      DATABASE_URL: "",
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(ensureLocalUserId(root), "local-inferred-owner");
  } finally {
    rmDir(root);
    rmDir(source);
  }
});

test("ambiguous legacy ownership leaves the live store and identity untouched", { skip: commandExists("tar") ? false : "tar not found" }, async () => {
  const root = tempDir();
  const source = tempDir();
  const archive = path.join(root, "legacy-ambiguous-owner.tar.gz");
  const liveData = path.join(root, ".command-centre", "memory");
  try {
    fs.mkdirSync(liveData, { recursive: true });
    fs.writeFileSync(path.join(liveData, "probe.txt"), "live-store");
    const liveOwner = ensureLocalUserId(root);
    await seedLegacyPrivateOwners(path.join(source, "memory"), ["user-a", "user-b"]);
    createTar(source, archive, ["memory"]);

    const result = run([RESTORE, archive, "--yes"], {
      AI_OS_DIR: root,
      MEMORY_DATABASE_URL: "",
      DATABASE_URL: "",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ambiguous/i);
    assert.equal(fs.readFileSync(path.join(liveData, "probe.txt"), "utf8"), "live-store");
    assert.equal(ensureLocalUserId(root), liveOwner);
  } finally {
    rmDir(root);
    rmDir(source);
  }
});

test("restore rolls back if moving the current identity aside fails", () => {
  const root = tempDir();
  const parent = path.join(root, ".command-centre");
  const dataDir = path.join(parent, "memory");
  const identityPath = localUserConfigPath(root);
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "probe.txt"), "old-store");
    fs.mkdirSync(parent, { recursive: true });
    fs.writeFileSync(identityPath, '{"userId":"old-owner"}\n');
    const failingFs = new Proxy(fs, {
      get(target, property) {
        if (property !== "renameSync") return target[property];
        return (source, destination) => {
          if (source === identityPath) throw new Error("injected aside failure");
          return target.renameSync(source, destination);
        };
      },
    });

    assert.throws(
      () => moveCurrentRestoreSetAside(dataDir, identityPath, parent, failingFs),
      /injected aside failure/,
    );
    assert.equal(fs.readFileSync(path.join(dataDir, "probe.txt"), "utf8"), "old-store");
    assert.equal(readJson(identityPath).userId, "old-owner");
  } finally {
    rmDir(root);
  }
});

test("restore rolls back exactly once if installing the new identity fails", () => {
  const root = tempDir();
  const parent = path.join(root, ".command-centre");
  const dataDir = path.join(parent, "memory");
  const identityPath = localUserConfigPath(root);
  const stagedData = path.join(parent, "staged-memory");
  const stagedIdentity = path.join(parent, "staged-identity.json");
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "probe.txt"), "old-store");
    fs.writeFileSync(identityPath, '{"userId":"old-owner"}\n');
    fs.mkdirSync(stagedData);
    fs.writeFileSync(path.join(stagedData, "probe.txt"), "new-store");
    fs.writeFileSync(stagedIdentity, '{"userId":"new-owner"}\n');
    const failingFs = new Proxy(fs, {
      get(target, property) {
        if (property !== "renameSync") return target[property];
        return (source, destination) => {
          if (source === stagedIdentity) throw new Error("injected install failure");
          return target.renameSync(source, destination);
        };
      },
    });

    assert.throws(
      () =>
        installRestoreSet({
          stagedData,
          stagedIdentity,
          dataDir,
          identityPath,
          parent,
          fileOps: failingFs,
        }),
      /injected install failure/,
    );
    assert.equal(fs.readFileSync(path.join(dataDir, "probe.txt"), "utf8"), "old-store");
    assert.equal(readJson(identityPath).userId, "old-owner");
  } finally {
    rmDir(root);
  }
});

test("restore refuses without --yes (dry run writes nothing)", { skip: commandExists("tar") ? false : "tar not found" }, async () => {
  const root = tempDir();
  const dataDir = path.join(root, ".command-centre", "memory");
  const outDir = path.join(root, "backups", "memory");
  const owner = ensureLocalUserId(root);
  await seedLegacyPrivateOwners(dataDir, [owner]);
  fs.writeFileSync(path.join(dataDir, "probe.txt"), "v1");
  const env = { AI_OS_DIR: root, MEMORY_DATABASE_URL: "", DATABASE_URL: "" };
  try {
    const backup = run([BACKUP, "--out", outDir], env);
    assert.equal(backup.status, 0, `${backup.stdout}\n${backup.stderr}`);
    const archive = newestMatching(outDir, (f) => f.endsWith(".tar.gz"));
    fs.writeFileSync(path.join(dataDir, "probe.txt"), "v2-uncommitted");
    const dry = run([RESTORE, archive], env); // no --yes
    assert.equal(dry.status, 0);
    assert.match(dry.stdout, /DRY RUN/);
    assert.equal(
      fs.readFileSync(path.join(dataDir, "probe.txt"), "utf8"),
      "v2-uncommitted",
      "dry run left the live store untouched",
    );
  } finally {
    rmDir(root);
  }
});

// ---------------------------------------------------------------------------
// Hosted Postgres — the engine this backup/restore path actually protects.
// Gated on TEST_DATABASE_URL (a throwaway pgvector database) AND the client tools.
// ---------------------------------------------------------------------------
const pgSkip = !TEST_URL
  ? "set TEST_DATABASE_URL to run against a real Postgres"
  : !commandExists("pg_dump") || !commandExists("pg_restore")
    ? "pg_dump/pg_restore not on PATH"
    : false;

test("backup then restore brings the hosted corpus back (Postgres)", { skip: pgSkip }, async () => {
  // Build the same leaf-first module graph the other memory tests use.
  const types = { ALL_VISIBILITIES: ["private", "client", "team", "system"] };
  const embedding = loadTsModule(path.resolve(__dirname, "embedding.ts"));
  const scope = loadTsModule(path.resolve(__dirname, "scope.ts"), { stubs: { "./types": types } });
  const migrate = loadTsModule(path.resolve(__dirname, "migrate.ts"));
  const adapter = loadTsModule(path.resolve(__dirname, "pglite-adapter.ts"));
  const postgresAdapter = loadTsModule(path.resolve(__dirname, "postgres-adapter.ts"));
  const backend = loadTsModule(path.resolve(__dirname, "backend.ts"));
  const rowMappers = loadTsModule(path.resolve(__dirname, "row-mappers.ts"), {
    stubs: { "./types": types, "./embedding": embedding },
  });
  const store = loadTsModule(path.resolve(__dirname, "store.ts"), {
    stubs: {
      "./types": types, "./migrate": migrate, "./scope": scope, "./embedding": embedding,
      "./row-mappers": rowMappers, "./pglite-adapter": adapter,
      "./postgres-adapter": postgresAdapter, "./backend": backend,
    },
  });
  const embedder = loadTsModule(path.resolve(__dirname, "embedder.ts"));
  const chunker = loadTsModule(path.resolve(__dirname, "chunker.ts"));
  const ingest = loadTsModule(path.resolve(__dirname, "ingest.ts"), {
    stubs: { "./scope": scope, "./embedding": embedding, "./chunker": chunker },
  });
  const discovery = loadTsModule(path.resolve(__dirname, "discovery.ts"));
  const indexer = loadTsModule(path.resolve(__dirname, "indexer.ts"), {
    stubs: { "./scope": scope, "./ingest": ingest, "./discovery": discovery },
  });

  const sysScope = { teamId: null, clientId: null, userId: null, visibility: "system" };
  const corpus = tempDir();
  const memoryDir = path.join(corpus, "context", "memory");
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.writeFileSync(path.join(memoryDir, "note.md"), "# Note\n\nThe hosted backup restores the team memory.");
  const outDir = tempDir();

  async function chunkCount() {
    const s = await store.openMemoryStore({ backend: "postgres", connectionString: TEST_URL, embedDim: EMBED_DIM });
    try {
      const { rows } = await s.client.query("SELECT count(*)::int AS n FROM memory_chunks");
      return Number(rows[0].n);
    } finally {
      await s.close();
    }
  }
  async function resetDatabase() {
    const raw = await postgresAdapter.openPostgres(TEST_URL);
    try {
      await raw.client.exec("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public");
    } finally {
      await raw.close();
    }
  }

  const env = { MEMORY_DATABASE_URL: TEST_URL };
  try {
    await resetDatabase();

    // Seed a real corpus into the hosted DB.
    const s = await store.openMemoryStore({ backend: "postgres", connectionString: TEST_URL, embedDim: EMBED_DIM });
    try {
      await indexer.indexSources({
        store: s, embedder: new embedder.HashEmbedder({ dim: EMBED_DIM }),
        scope: sysScope, rootDir: corpus, reason: "backfill",
      });
    } finally {
      await s.close();
    }
    const before = await chunkCount();
    assert.ok(before > 0, "seeded chunks exist");

    // Back up via the real script.
    const b = run([BACKUP, "--out", outDir], env);
    assert.equal(b.status, 0, `backup failed:\n${b.stderr}`);
    const dump = newestMatching(outDir, (f) => f.endsWith(".dump"));
    assert.ok(dump, "a .dump backup was written");

    // Disaster: lose everything. Then restore from the dump.
    await resetDatabase();
    const r = run([RESTORE, dump, "--yes"], env);
    assert.equal(r.status, 0, `restore failed:\n${r.stdout}\n${r.stderr}`);

    assert.equal(await chunkCount(), before, "the corpus came back after restore");
  } finally {
    await resetDatabase().catch(() => {});
    rmDir(corpus);
    rmDir(outDir);
  }
});

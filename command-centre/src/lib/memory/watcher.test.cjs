/**
 * watcher.ts tests — live sync for changed memory source files.
 *
 * Integration-style (real chokidar against a real temp dir + real PGLite), the
 * codebase pattern for fs/PGLite-driven modules. Every test waits for an
 * observable effect (a log line, or final DB state after close()) rather than a
 * fixed sleep, then closes the watcher before opening a second store handle —
 * PGLite is single-process, so a verification store opens only once the
 * watcher's handle is closed.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");
const SCRIPTS = path.resolve(__dirname, "../../../scripts");
const memoryWatchCli = require(path.join(SCRIPTS, "memory-watch.cjs"));
const { ensureLocalUserId } = require(path.join(SCRIPTS, "local-memory-identity.cjs"));

// Leaf-first loading, same graph as capture.test.cjs + indexer.test.cjs, plus watcher.ts.
const types = { ALL_VISIBILITIES: ["private", "client", "team", "system"] };
const embedding = loadTsModule(path.resolve(__dirname, "embedding.ts"));
const scope = loadTsModule(path.resolve(__dirname, "scope.ts"), {
  stubs: { "./types": types },
});
const migrate = loadTsModule(path.resolve(__dirname, "migrate.ts"));
const adapter = loadTsModule(path.resolve(__dirname, "pglite-adapter.ts"));
const postgresAdapter = loadTsModule(path.resolve(__dirname, "postgres-adapter.ts"));
const backend = loadTsModule(path.resolve(__dirname, "backend.ts"));
const rowMappers = loadTsModule(path.resolve(__dirname, "row-mappers.ts"), {
  stubs: { "./types": types, "./embedding": embedding },
});
const store = loadTsModule(path.resolve(__dirname, "store.ts"), {
  stubs: {
    "./types": types,
    "./migrate": migrate,
    "./scope": scope,
    "./embedding": embedding,
    "./row-mappers": rowMappers,
    "./pglite-adapter": adapter,
    "./postgres-adapter": postgresAdapter,
    "./backend": backend,
  },
});
const embedder = loadTsModule(path.resolve(__dirname, "embedder.ts"));
const chunker = loadTsModule(path.resolve(__dirname, "chunker.ts"));
const discovery = loadTsModule(path.resolve(__dirname, "discovery.ts"));
const ingest = loadTsModule(path.resolve(__dirname, "ingest.ts"), {
  stubs: { "./scope": scope, "./embedding": embedding, "./chunker": chunker },
});
const indexer = loadTsModule(path.resolve(__dirname, "indexer.ts"), {
  stubs: { "./scope": scope, "./ingest": ingest, "./discovery": discovery },
});
const capture = loadTsModule(path.resolve(__dirname, "capture.ts"), {
  stubs: { "./indexer": indexer },
});
const watcher = loadTsModule(path.resolve(__dirname, "watcher.ts"), {
  stubs: { "./store": store, "./capture": capture, "./ingest": ingest, "./discovery": discovery },
});

const EMBED_DIM = 8;
const ROOTS = ["context/memory", "context/learnings.md"];

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-watch-"));
}
/**
 * chokidar doesn't reliably pick up a watch target that doesn't exist at
 * watch()-start. In real usage the roots (context/memory/, context/learnings.md)
 * already exist as tracked files, so tests pre-create them to match that precondition.
 */
function setupRoots(rootDir) {
  fs.mkdirSync(path.join(rootDir, "context", "memory"), { recursive: true });
  // Empty: present on disk (so chokidar has a real path to watch) but zero-byte,
  // so discovery's isIndexable() excludes it — keeps "indexed N source(s)" counts
  // scoped to what each test adds.
  fs.writeFileSync(path.join(rootDir, "context", "learnings.md"), "");
}
function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function sysScope(overrides = {}) {
  return { teamId: null, clientId: null, userId: null, visibility: "system", ...overrides };
}
function newEmbedder() {
  return new embedder.HashEmbedder({ dim: EMBED_DIM });
}
function writeFile(rootDir, relPath, content) {
  const abs = path.join(rootDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitFor(predicate, { timeoutMs = 8000, intervalMs = 100 } = {}) {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - start >= timeoutMs) {
      throw new Error("waitFor: timed out");
    }
    await sleep(intervalMs);
  }
}

/** Pre-index a source directly, bypassing the watcher (used to seed state before a delete test). */
async function seedSource(dataDir, sourcePath, content) {
  const s = await store.openMemoryStore({ dataDir, embedDim: EMBED_DIM });
  try {
    return await ingest.ingestContent({
      store: s,
      embedder: newEmbedder(),
      scope: sysScope(),
      sourcePath,
      sourceType: "memory",
      content,
    });
  } finally {
    await s.close();
  }
}

async function countSources(dataDir, sourcePath) {
  const s = await store.openMemoryStore({ dataDir, embedDim: EMBED_DIM });
  try {
    const { rows } = await s.client.query(
      "SELECT count(*)::int AS n FROM memory_sources WHERE source_path = $1",
      [sourcePath],
    );
    return Number(rows[0].n);
  } finally {
    await s.close();
  }
}

test("local watcher default stays private and reindexes under one stable owner", async () => {
  const rootDir = tempDir();
  setupRoots(rootDir);
  const dataDir = path.join(rootDir, ".command-centre", "memory");
  const relPath = "context/memory/private-default.md";
  const baseScope = memoryWatchCli.buildScope(
    {},
    { backendKind: "pglite", rootDir },
  );
  const owner = ensureLocalUserId(rootDir);

  async function runWatcherAndWrite(content) {
    const logs = [];
    const memWatcher = watcher.startMemoryWatcher({
      embedder: newEmbedder(),
      scope: baseScope,
      rootDir,
      roots: ROOTS,
      dataDir,
      debounceMs: 200,
      log: (msg) => logs.push(msg),
    });
    try {
      await memWatcher.ready();
      writeFile(rootDir, relPath, content);
      await waitFor(() => logs.some((message) => /indexed 1 source/.test(message)));
    } finally {
      await memWatcher.close();
    }
  }

  try {
    await runWatcherAndWrite("# Private\n\nfirst version");
    await runWatcherAndWrite("# Private\n\nsecond version");

    const s = await store.openMemoryStore({ dataDir, embedDim: EMBED_DIM });
    try {
      const { rows } = await s.client.query(
        `SELECT visibility, user_id, count(*)::int AS n
           FROM memory_sources
          WHERE source_path = $1
          GROUP BY visibility, user_id`,
        [relPath],
      );
      assert.deepEqual(rows, [{ visibility: "private", user_id: owner, n: 1 }]);
      const systemRows = await s.client.query(
        "SELECT count(*)::int AS n FROM memory_sources WHERE visibility = 'system'",
      );
      assert.equal(Number(systemRows.rows[0].n), 0);
    } finally {
      await s.close();
    }
  } finally {
    rmDir(rootDir);
  }
});

test("add triggers a debounced reindex, making the new file's content searchable", async () => {
  const rootDir = tempDir();
  setupRoots(rootDir);
  const dataDir = path.join(rootDir, ".command-centre", "memory");
  const logs = [];
  const memWatcher = watcher.startMemoryWatcher({
    embedder: newEmbedder(),
    scope: sysScope(),
    rootDir,
    roots: ROOTS,
    dataDir,
    debounceMs: 200,
    log: (msg) => logs.push(msg),
  });
  try {
    await memWatcher.ready();
    writeFile(rootDir, "context/memory/2026-06-20.md", "# Note\n\nlive sync works");

    await waitFor(() => logs.some((m) => /indexed 1 source/.test(m)));
    await memWatcher.close();

    assert.equal(await countSources(dataDir, "context/memory/2026-06-20.md"), 1);
  } finally {
    rmDir(rootDir);
  }
});

test("unlink removes the source and its chunks", async () => {
  const rootDir = tempDir();
  setupRoots(rootDir);
  const dataDir = path.join(rootDir, ".command-centre", "memory");
  const relPath = "context/memory/2026-06-21.md";
  const absPath = writeFile(rootDir, relPath, "# Note\n\nto be deleted");
  const seeded = await seedSource(dataDir, relPath, "# Note\n\nto be deleted");
  assert.ok(seeded.sourceId);

  const logs = [];
  const memWatcher = watcher.startMemoryWatcher({
    embedder: newEmbedder(),
    scope: sysScope(),
    rootDir,
    roots: ROOTS,
    dataDir,
    debounceMs: 200,
    log: (msg) => logs.push(msg),
  });
  try {
    await memWatcher.ready();
    fs.unlinkSync(absPath);

    await waitFor(() => logs.some((m) => m.includes(`removed ${relPath}`)));
    await memWatcher.close();

    assert.equal(await countSources(dataDir, relPath), 0);
  } finally {
    rmDir(rootDir);
  }
});

test("a simulated move (unlink old path + add new path) leaves no orphan", async () => {
  const rootDir = tempDir();
  setupRoots(rootDir);
  const dataDir = path.join(rootDir, ".command-centre", "memory");
  const oldRel = "context/memory/old-name.md";
  const newRel = "context/memory/new-name.md";
  const oldAbs = writeFile(rootDir, oldRel, "# Moved\n\nsame content, new path");
  await seedSource(dataDir, oldRel, "# Moved\n\nsame content, new path");

  const logs = [];
  const memWatcher = watcher.startMemoryWatcher({
    embedder: newEmbedder(),
    scope: sysScope(),
    rootDir,
    roots: ROOTS,
    dataDir,
    debounceMs: 200,
    log: (msg) => logs.push(msg),
  });
  try {
    await memWatcher.ready();
    fs.unlinkSync(oldAbs);
    writeFile(rootDir, newRel, "# Moved\n\nsame content, new path");

    await waitFor(() => logs.some((m) => m.includes(`removed ${oldRel}`)));
    await waitFor(() => logs.some((m) => /indexed 1 source/.test(m)));
    await memWatcher.close();

    assert.equal(await countSources(dataDir, oldRel), 0, "old path must not remain");
    assert.equal(await countSources(dataDir, newRel), 1, "new path must be indexed");
  } finally {
    rmDir(rootDir);
  }
});

test("non-indexable files are ignored", async () => {
  const rootDir = tempDir();
  setupRoots(rootDir);
  const dataDir = path.join(rootDir, ".command-centre", "memory");
  const logs = [];
  const memWatcher = watcher.startMemoryWatcher({
    embedder: newEmbedder(),
    scope: sysScope(),
    rootDir,
    roots: ROOTS,
    dataDir,
    debounceMs: 200,
    log: (msg) => logs.push(msg),
  });
  try {
    await memWatcher.ready();
    writeFile(rootDir, "context/memory/notes.json", JSON.stringify({ not: "markdown" }));
    // Give chokidar's awaitWriteFinish + debounce window time to fire if it were going to.
    await sleep(1500);

    assert.equal(logs.length, 0, "a non-indexable file must never trigger a reindex");
    assert.equal(await countSources(dataDir, "context/memory/notes.json"), 0);
  } finally {
    await memWatcher.close();
    rmDir(rootDir);
  }
});

test("two add events within the debounce window collapse into one reindex pass", async () => {
  const rootDir = tempDir();
  setupRoots(rootDir);
  const dataDir = path.join(rootDir, ".command-centre", "memory");
  const logs = [];
  const memWatcher = watcher.startMemoryWatcher({
    embedder: newEmbedder(),
    scope: sysScope(),
    rootDir,
    roots: ROOTS,
    dataDir,
    debounceMs: 400,
    log: (msg) => logs.push(msg),
  });
  try {
    await memWatcher.ready();
    writeFile(rootDir, "context/memory/a.md", "# A\n\nfirst file");
    writeFile(rootDir, "context/memory/b.md", "# B\n\nsecond file, written right after");

    await waitFor(() => logs.some((m) => /indexed 2 source/.test(m)));
    await memWatcher.close();

    const indexedLogs = logs.filter((m) => /^memory-watcher: indexed/.test(m));
    assert.equal(indexedLogs.length, 1, "the burst must collapse into a single reindex pass");
    assert.equal(await countSources(dataDir, "context/memory/a.md"), 1);
    assert.equal(await countSources(dataDir, "context/memory/b.md"), 1);
  } finally {
    rmDir(rootDir);
  }
});

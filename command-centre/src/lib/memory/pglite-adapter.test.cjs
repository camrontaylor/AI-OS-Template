/**
 * pglite-adapter.test.cjs — self-heal of an orphaned PGLite lock.
 *
 * A persisted PGLite store refuses to reopen if a previous process exited without
 * releasing its lock (orphaned postmaster.pid). openPGlite clears a *stale* lock
 * and retries, so the local store recovers instead of aborting forever. These
 * cover the clearing logic (stale vs. live PID) and a full reopen round-trip.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");
const adapter = loadTsModule(path.resolve(__dirname, "pglite-adapter.ts"));

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-pglite-"));
}
function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  // Also drop the sibling advisory open-lock openPGlite may have left.
  fs.rmSync(`${dir}.aios-open.lock`, { force: true });
}

test("clearStaleLock removes an orphaned lock (PGLite sentinel PID)", () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, "postmaster.pid"), "-42\n/tmp/pglite/base\n5432\n");
    fs.writeFileSync(path.join(dir, ".s.PGSQL.5432.lock"), "");
    fs.writeFileSync(path.join(dir, ".s.PGSQL.5432.lock.out"), "");

    assert.equal(adapter.clearStaleLock(dir), true, "stale lock cleared");
    assert.ok(!fs.existsSync(path.join(dir, "postmaster.pid")), "postmaster.pid removed");
    assert.ok(!fs.existsSync(path.join(dir, ".s.PGSQL.5432.lock")), "socket lock removed");
    assert.equal(adapter.clearStaleLock(dir), false, "nothing left to clear");
  } finally {
    rmDir(dir);
  }
});

test("clearStaleLock refuses a lock held by a live process", () => {
  const dir = tempDir();
  try {
    // This test process's PID stands in for a live server.
    fs.writeFileSync(path.join(dir, "postmaster.pid"), `${process.pid}\n/data\n5432\n`);
    assert.equal(adapter.clearStaleLock(dir), false, "live PID → refuse to clear");
    assert.ok(fs.existsSync(path.join(dir, "postmaster.pid")), "lock left intact");
  } finally {
    rmDir(dir);
  }
});

test("quarantineDir moves a corrupt dir aside (reversible, contents preserved)", () => {
  const parent = tempDir();
  const dir = path.join(parent, "memory");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "marker"), "x");
  try {
    assert.equal(adapter.quarantineDir(dir), true, "moved aside");
    assert.ok(!fs.existsSync(dir), "original path freed for a fresh store");
    const moved = fs.readdirSync(parent).find((f) => f.startsWith("memory.corrupt-"));
    assert.ok(moved, "quarantined copy exists for inspection");
    assert.equal(
      fs.readFileSync(path.join(parent, moved, "marker"), "utf8"),
      "x",
      "the corrupt cluster is preserved, not deleted",
    );
    assert.equal(adapter.quarantineDir(dir), false, "missing dir → nothing to move");
  } finally {
    rmDir(parent);
  }
});

test("openPGlite reopens a persisted store left with an orphaned lock", async () => {
  const dir = tempDir();
  try {
    // 1) Create a real persisted store and write a row.
    let h = await adapter.openPGlite(dir);
    await h.client.exec("CREATE TABLE probe (v text); INSERT INTO probe VALUES ('lives')");
    await h.close();

    // 2) Simulate an unclean shutdown: drop an orphaned lock back into the dir.
    fs.writeFileSync(path.join(dir, "postmaster.pid"), "-42\n/tmp/pglite/base\n5432\n");

    // 3) Reopen — must succeed and the data must still be there.
    h = await adapter.openPGlite(dir);
    const { rows } = await h.client.query("SELECT v FROM probe");
    assert.equal(rows[0].v, "lives", "data survived; store reopened despite the lock");
    await h.close();
  } finally {
    rmDir(dir);
  }
});

test("openPGlite creates missing parent directories for a fresh persisted store", async () => {
  const parent = tempDir();
  const dir = path.join(parent, "nested", "memory");
  try {
    const h = await adapter.openPGlite(dir);
    await h.close();
    assert.ok(fs.existsSync(dir), "fresh persisted store created");
    assert.ok(!fs.existsSync(`${dir}.aios-open.lock`), "advisory lock released");
  } finally {
    rmDir(parent);
  }
});

test("openPGlite refuses a second concurrent open of the same dir", async () => {
  const dir = tempDir();
  try {
    const h1 = await adapter.openPGlite(dir);

    // A second open while the first is live must be refused, not allowed to
    // corrupt the single-user store. (This process's own live pid stands in for
    // the concurrent opener via the advisory lock.)
    await assert.rejects(
      () => adapter.openPGlite(dir),
      /held by another AI-OS process/,
      "concurrent open rejected",
    );

    // After the holder closes, the advisory lock is released and reopen works.
    await h1.close();
    assert.ok(
      !fs.existsSync(`${dir}.aios-open.lock`),
      "advisory lock removed on close",
    );

    const h2 = await adapter.openPGlite(dir);
    await h2.close();
  } finally {
    rmDir(dir);
  }
});

test("openPGlite reclaims an advisory lock left by a dead process", async () => {
  const dir = tempDir();
  try {
    // A crashed opener leaves a lock file naming a pid that is no longer alive.
    // Pid 0x7FFFFFFF is not a real running process — it must be reclaimed, not
    // treated as a live holder (so kill -9 never wedges the local store).
    fs.writeFileSync(`${dir}.aios-open.lock`, "2147483647\n");
    const h = await adapter.openPGlite(dir);
    await h.close();
    assert.ok(!fs.existsSync(`${dir}.aios-open.lock`), "stale lock reclaimed and released");
  } finally {
    rmDir(dir);
  }
});

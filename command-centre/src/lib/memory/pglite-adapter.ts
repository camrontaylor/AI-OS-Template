/**
 * AIOS Memory Schema — PGLite adapter & bootstrap.
 *
 * Wraps a live PGLite handle as the engine-agnostic {@link SqlClient} that
 * migrate.ts (and the store) talk to. Keeping the DB behind this thin interface
 * is what makes the schema "one shape for local PGLite and hosted Postgres":
 * a hosted `pg` adapter implements the same two methods and drops in with no
 * change to migrate.ts, scope.ts, or store.ts.
 *
 * The PGLite API already matches the interface closely — `query(sql, params)`
 * returns `{ rows }` and `exec(sql)` runs multiple statements — so the adapter
 * is a passthrough. The `vector` extension is registered at construction time
 * (pgvector cannot be loaded with a runtime `CREATE EXTENSION` unless the WASM
 * module is present), per docs/memory/memory-schema.md.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";

import type { SqlClient } from "./migrate";

/** Adapts a PGLite handle to the migrate.ts {@link SqlClient} interface. */
export class PGliteSqlClient implements SqlClient {
  constructor(private readonly db: PGlite) {}

  exec(sql: string): Promise<unknown> {
    return this.db.exec(sql);
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ rows: T[] }> {
    const result = await this.db.query<T>(sql, params as unknown[]);
    return { rows: result.rows };
  }
}

export interface OpenPGliteResult {
  /** The raw handle — reachable for advanced use (transactions). */
  db: PGlite;
  /** The handle wrapped as a {@link SqlClient}. */
  client: PGliteSqlClient;
  /**
   * Close the handle AND release the advisory open-lock (see openPGlite).
   * Idempotent. Prefer this over `db.close()` directly — calling only `db.close()`
   * would leave the persisted store's advisory lock behind.
   */
  close(): Promise<void>;
}

/**
 * Construct a PGLite handle with the `vector` extension registered and wait
 * until it is ready.
 *
 * @param dataDir Filesystem directory for a persisted database. Omit for an
 *                ephemeral in-memory database (data is lost on `close()`).
 */
export interface OpenPGliteOptions {
  /**
   * If a persisted store cannot be opened even after clearing a stale lock —
   * i.e. the cluster itself is corrupt (an interrupted write, a crash) — move the
   * bad directory aside and start fresh instead of failing. Use ONLY for a
   * derived/regenerable store (the memory index), never where the data is the
   * source of truth. Off by default so generic callers never silently drop data.
   */
  recreateCorruptDir?: boolean;
}

export async function openPGlite(
  dataDir?: string,
  opts: OpenPGliteOptions = {},
): Promise<OpenPGliteResult> {
  if (!dataDir) {
    const db = new PGlite({ extensions: { vector } });
    await db.waitReady;
    return { db, client: new PGliteSqlClient(db), close: buildClose(db, null) };
  }

  // Cross-process mutual exclusion for a PERSISTED store. PGLite is single-user:
  // two processes opening the same data dir at once corrupt it. We cannot detect
  // a concurrent opener from postmaster.pid — PGLite writes a *sentinel* PID, so
  // its lock always looks dead (that is exactly what makes clearStaleLock safe to
  // run). So AIOS processes coordinate through a separate advisory lock that
  // carries the opener's REAL OS pid. Holding it is also what makes the recovery
  // below safe: clearStaleLock / quarantineDir only ever run while WE own the
  // lock, so they can never wipe a store another live process is actively using.
  const lockPath = ownerLockPath(dataDir);
  if (!acquireOwnerLock(lockPath)) {
    throw new Error(
      `openPGlite: the local memory store at ${dataDir} is held by another ` +
        "AI-OS process (PGLite is single-user). Not opening a second " +
        "connection — retry in a moment.",
    );
  }

  try {
    const { db, client } = await openPersisted(dataDir, opts);
    return { db, client, close: buildClose(db, lockPath) };
  } catch (err) {
    releaseOwnerLock(lockPath);
    throw err;
  }
}

/**
 * Open the persisted cluster, recovering from an unclean prior shutdown. The
 * caller holds the advisory lock, so the destructive steps here are safe.
 */
async function openPersisted(
  dataDir: string,
  opts: OpenPGliteOptions,
): Promise<{ db: PGlite; client: PGliteSqlClient }> {
  try {
    return await openAt(dataDir);
  } catch (firstErr) {
    // 1) Orphaned lock from an unclean shutdown — a postmaster.pid left by a
    //    detached capture killed mid-write, a machine sleep, a crash. PGLite runs
    //    Postgres single-user in WASM (it writes a sentinel PID, never a live
    //    server), so such a lock is always stale. Clear it and retry once.
    if (clearStaleLock(dataDir)) {
      try {
        return await openAt(dataDir);
      } catch {
        // The lock was not the whole story — fall through to recreate.
      }
    }
    // 2) The cluster itself will not open (corruption). The memory store is a
    //    DERIVED index, so quarantine the bad dir and start fresh; the next
    //    index / capture / bootstrap repopulates it. Opt-in only.
    if (opts.recreateCorruptDir && quarantineDir(dataDir)) {
      return await openAt(dataDir);
    }
    throw firstErr;
  }
}

async function openAt(dataDir: string): Promise<{ db: PGlite; client: PGliteSqlClient }> {
  const db = new PGlite(dataDir, { extensions: { vector } });
  await db.waitReady;
  return { db, client: new PGliteSqlClient(db) };
}

/** A `close()` that shuts the handle and releases its advisory lock, once. */
function buildClose(db: PGlite, lockPath: string | null): () => Promise<void> {
  let closed = false;
  return async () => {
    if (closed) return;
    closed = true;
    try {
      await db.close();
    } finally {
      if (lockPath) releaseOwnerLock(lockPath);
    }
  };
}

// ── Advisory open-lock (real-pid, sibling of the data dir) ───────────────────

/**
 * Path of the advisory open-lock for a data dir. A SIBLING of the dir (not a
 * file inside it) so it survives quarantineDir() moving the dir aside, and so it
 * uniquely guards this exact path.
 */
export function ownerLockPath(dataDir: string): string {
  return `${dataDir.replace(/[/\\]+$/, "")}.aios-open.lock`;
}

/**
 * Claim the advisory lock for a data dir, writing our REAL pid with O_EXCL.
 * Returns false iff a LIVE process already holds it. A lock left by a crashed
 * process (dead pid, or an unreadable file) is reclaimed and the claim retried,
 * so a `kill -9` / power loss never wedges the local store permanently.
 */
function acquireOwnerLock(lockPath: string): boolean {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx"); // O_CREAT | O_EXCL | O_WRONLY
      fs.writeSync(fd, `${process.pid}\n`);
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err;
      const ownerPid = readLockPid(lockPath);
      if (ownerPid !== null && isProcessAlive(ownerPid)) return false;
      // Stale (dead owner / unreadable) — reclaim and retry once.
      try {
        fs.rmSync(lockPath, { force: true });
      } catch {
        // Lost the race to another reclaimer; the next iteration re-evaluates.
      }
    }
  }
  return false;
}

/** Release our advisory lock — only if it still names us (never steal another's). */
function releaseOwnerLock(lockPath: string): void {
  try {
    if (readLockPid(lockPath) === process.pid) {
      fs.rmSync(lockPath, { force: true });
    }
  } catch {
    // Best effort.
  }
}

/** Read a positive pid from a lock file, or null if absent/unreadable/invalid. */
function readLockPid(lockPath: string): number | null {
  try {
    const pid = Number.parseInt(fs.readFileSync(lockPath, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Remove an orphaned PGLite lock so a persisted store can reopen after an
 * unclean shutdown. Returns true if a stale lock was cleared (worth a retry).
 *
 * Refuses to touch the lock if `postmaster.pid` names a real, live OS process —
 * defensive against being pointed at an actual running Postgres data dir. PGLite
 * always writes a sentinel PID (e.g. -42), so for a real PGLite store this guard
 * never blocks the clear.
 */
export function clearStaleLock(dataDir: string): boolean {
  try {
    const pidFile = path.join(dataDir, "postmaster.pid");
    if (!fs.existsSync(pidFile)) return false;
    const firstLine = fs.readFileSync(pidFile, "utf8").split("\n", 1)[0]?.trim() ?? "";
    const pid = Number.parseInt(firstLine, 10);
    if (Number.isInteger(pid) && pid > 0 && isProcessAlive(pid)) return false;
    fs.rmSync(pidFile, { force: true });
    // Best effort: drop leftover socket lock files (.s.PGSQL.5432.lock[.out]).
    for (const entry of fs.readdirSync(dataDir)) {
      if (entry.startsWith(".s.PGSQL.")) {
        fs.rmSync(path.join(dataDir, entry), { force: true });
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** True if `pid` is a live OS process (EPERM — exists but not ours — counts). */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

/**
 * Move a corrupt data directory aside (to `<dir>.corrupt-<timestamp>`) so a fresh
 * one can be created in its place. Renames rather than deletes — the bad cluster
 * is preserved for inspection and the operation is reversible. Returns true on a
 * successful move.
 */
export function quarantineDir(dataDir: string): boolean {
  try {
    if (!fs.existsSync(dataDir)) return false;
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const stamp =
      `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
      `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    fs.renameSync(dataDir, `${dataDir}.corrupt-${stamp}`);
    return true;
  } catch {
    return false;
  }
}

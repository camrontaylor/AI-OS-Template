/**
 * Memory Schema — hosted Postgres adapter & bootstrap.
 *
 * The hosted counterpart to pglite-adapter.ts: wraps a live node-postgres
 * connection as the engine-agnostic {@link SqlClient} that migrate.ts (and the
 * store) talk to. This is the "drop-in" the schema was designed for — one
 * schema, one SQL dialect, one vector engine across local PGLite and hosted
 * Postgres (see docs/memory/memory-schema.md and pglite-adapter.ts).
 *
 * IMPORTANT — a single connection, NOT a Pool. migrate.ts drives transactions
 * by issuing `BEGIN` / `COMMIT` / `ROLLBACK` as separate `exec()` calls. A
 * `pg.Pool` hands a different physical connection to each query, which would
 * scatter those statements across connections and silently break the
 * transaction. So this adapter pins one `pg.Client` for the lifetime of the
 * SqlClient. Concurrent, pooled access for the hosted server is handled
 * separately (see {@link openPostgresPool}); the migration runner and tests are
 * sequential and want exactly one connection.
 *
 * pgvector: unlike PGLite (where the WASM extension is registered at
 * construction), hosted Postgres ships pgvector in the image
 * (pgvector/pgvector:pgNN) and the migration's own
 * `CREATE EXTENSION IF NOT EXISTS vector` enables it — so this adapter needs no
 * special vector setup. It is a thin passthrough, exactly like PGliteSqlClient.
 */

import { Client, Pool, type PoolClient } from "pg";
import type { ClientConfig } from "pg";

import type { SqlClient } from "./migrate";

/** Adapts a single connected node-postgres Client to the {@link SqlClient} interface. */
export class PostgresSqlClient implements SqlClient {
  constructor(private readonly client: Client | PoolClient) {}

  async exec(sql: string): Promise<unknown> {
    // Simple query protocol: runs one or more `;`-separated statements (DDL,
    // a whole migration file) on the single pinned connection.
    return this.client.query(sql);
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ rows: T[] }> {
    // No generic on `pg`'s query (its `QueryResultRow` constraint conflicts with
    // the unconstrained `T`); cast the rows instead, like PGliteSqlClient.
    const result = await this.client.query(sql, params as unknown[]);
    return { rows: result.rows as T[] };
  }
}

export interface OpenPostgresOptions {
  /**
   * Explicit SSL config, overriding {@link resolveSsl}. Pass `false` to force
   * plaintext, or a `pg` ssl object (e.g. `{ rejectUnauthorized: false }`).
   */
  ssl?: ClientConfig["ssl"];
  /** Connection timeout (ms). Default 10s. */
  connectionTimeoutMillis?: number;
}

export interface OpenPostgresResult {
  /** The raw node-postgres Client — for advanced use and tests. */
  raw: Client;
  /** The connection wrapped as a {@link SqlClient}. */
  client: PostgresSqlClient;
  /** Disconnect the underlying client (`client.end()`). Always call when done. */
  close(): Promise<void>;
}

/**
 * Decide the SSL setting for a connection, in priority order:
 *   1. an explicit `ssl` option,
 *   2. the `PGSSLMODE` env var (`disable` → off, anything else → on),
 *   3. an `sslmode=` query param on the URL,
 *   4. the host — localhost/loopback → off, any remote host → on.
 *
 * "On" means `{ rejectUnauthorized: false }` because managed providers (Railway
 * included) serve certificates this client cannot chain-verify; transport is
 * still encrypted. Set `PGSSLMODE=disable` (or `?sslmode=disable`) for a
 * Railway private/internal URL, which does not offer SSL.
 */
export function resolveSsl(
  connectionString: string,
  explicit?: ClientConfig["ssl"],
): ClientConfig["ssl"] {
  if (explicit !== undefined) return explicit;

  const fromMode = (mode: string | null | undefined): ClientConfig["ssl"] | undefined => {
    if (!mode) return undefined;
    return mode.toLowerCase() === "disable" ? false : { rejectUnauthorized: false };
  };

  const envSsl = fromMode(process.env.PGSSLMODE);
  if (envSsl !== undefined) return envSsl;

  let host = "";
  let urlMode: string | null = null;
  try {
    const url = new URL(connectionString);
    host = url.hostname;
    urlMode = url.searchParams.get("sslmode");
  } catch {
    // Non-URL DSN (e.g. "host=... dbname=..."): no clear signal, default off.
    return false;
  }

  const urlSsl = fromMode(urlMode);
  if (urlSsl !== undefined) return urlSsl;

  const isLocal =
    host === "" || host === "localhost" || host === "127.0.0.1" || host === "::1";
  return isLocal ? false : { rejectUnauthorized: false };
}

/**
 * Connect to hosted Postgres and wrap the connection as a {@link SqlClient}.
 *
 * Pins a single `pg.Client` (see the file header for why not a Pool). The
 * caller owns the lifetime — always `close()`.
 */
export async function openPostgres(
  connectionString: string,
  opts: OpenPostgresOptions = {},
): Promise<OpenPostgresResult> {
  if (!connectionString || typeof connectionString !== "string") {
    throw new Error("openPostgres: a non-empty connection string is required");
  }

  const client = new Client({
    connectionString,
    ssl: resolveSsl(connectionString, opts.ssl),
    connectionTimeoutMillis: opts.connectionTimeoutMillis ?? 10_000,
  });
  await client.connect();

  return {
    raw: client,
    client: new PostgresSqlClient(client),
    close: () => client.end(),
  };
}

// ── Pooled access (the hosted API server path) ───────────────────────────────

const TXN_CONTROL_RE = /^\s*(BEGIN|COMMIT|ROLLBACK)\b[\s;]*$/i;

/**
 * Adapts a `pg.Pool` to the {@link SqlClient} interface.
 *
 * Why a pool at all: a long-lived server on a single pinned `pg.Client` dies
 * with its connection — node-postgres does not reconnect a dropped Client. A
 * Pool replaces broken connections transparently and lets concurrent requests
 * proceed in parallel.
 *
 * Why it is safe here: every serving-path statement (insertSource, insertChunk,
 * vectorSearch, search_events, index_jobs) is a single self-contained query, so
 * which physical connection runs it does not matter. What is NOT safe is
 * driving a transaction with separate `BEGIN`/`COMMIT` exec calls (each lands
 * on a different connection) — exactly what applyMigrations does. So `exec`
 * REFUSES bare transaction-control statements, loudly: migrations must run on a
 * dedicated single connection BEFORE the pool serves (see openMemoryStore).
 */
export class PostgresPoolSqlClient implements SqlClient {
  constructor(private readonly pool: Pool) {}

  async exec(sql: string): Promise<unknown> {
    if (TXN_CONTROL_RE.test(sql)) {
      throw new Error(
        "PostgresPoolSqlClient.exec: bare transaction-control statements " +
          "(BEGIN/COMMIT/ROLLBACK) are not supported on a pool — each exec may " +
          "run on a different connection. Run migrations on a dedicated single " +
          "connection (openPostgres) before serving from the pool.",
      );
    }
    // A single multi-statement string still runs on ONE pooled connection.
    return this.pool.query(sql);
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ rows: T[] }> {
    const result = await this.pool.query(sql, params as unknown[]);
    return { rows: result.rows as T[] };
  }

  async transaction<T>(fn: (client: SqlClient) => Promise<T>): Promise<T> {
    const raw = await this.pool.connect();
    const client = new PostgresSqlClient(raw);
    try {
      await raw.query("BEGIN");
      const result = await fn(client);
      await raw.query("COMMIT");
      return result;
    } catch (error) {
      await raw.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      raw.release();
    }
  }
}

export interface OpenPostgresPoolOptions extends OpenPostgresOptions {
  /** Max pooled connections. Default 5 — modest; the memory API is not a fan-out service. */
  max?: number;
  /**
   * Called when an IDLE pooled connection errors (e.g. the database restarted).
   * Default: log a warning. The pool replaces the broken connection on the next
   * checkout either way — but WITHOUT a listener node-postgres re-emits the
   * error on the Pool, and an unhandled 'error' event kills the process. This
   * handler existing at all is what keeps a database restart from taking the
   * server down with it.
   */
  onIdleError?: (error: Error) => void;
}

export interface OpenPostgresPoolResult {
  /** The raw node-postgres Pool — for advanced use and tests. */
  raw: Pool;
  /** The pool wrapped as a {@link SqlClient}. */
  client: PostgresPoolSqlClient;
  /** Drain and end the pool. Always call when done. */
  close(): Promise<void>;
}

/**
 * Open a connection POOL to hosted Postgres and wrap it as a {@link SqlClient}.
 *
 * For long-lived servers (the hosted memory API). Pings the database once so a
 * bad URL fails here, not on the first request. Run {@link openPostgres} +
 * applyMigrations FIRST — this client refuses transaction-control exec calls.
 */
export async function openPostgresPool(
  connectionString: string,
  opts: OpenPostgresPoolOptions = {},
): Promise<OpenPostgresPoolResult> {
  if (!connectionString || typeof connectionString !== "string") {
    throw new Error("openPostgresPool: a non-empty connection string is required");
  }

  const pool = new Pool({
    connectionString,
    ssl: resolveSsl(connectionString, opts.ssl),
    connectionTimeoutMillis: opts.connectionTimeoutMillis ?? 10_000,
    max: opts.max ?? 5,
  });

  // Survive idle-connection failures (database restarts, network blips): see
  // OpenPostgresPoolOptions.onIdleError. Without this listener the process dies.
  const onIdleError =
    opts.onIdleError ??
    ((error: Error) =>
      console.warn(`[memory] idle Postgres connection errored (pool will replace it): ${error.message}`));
  pool.on("error", onIdleError);

  try {
    await pool.query("SELECT 1");
  } catch (error) {
    await pool.end().catch(() => {});
    throw error;
  }

  return {
    raw: pool,
    client: new PostgresPoolSqlClient(pool),
    close: () => pool.end(),
  };
}

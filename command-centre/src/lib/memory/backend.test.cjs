"use strict";
/**
 * backend — unit tests for resolveMemoryBackend (pure, always run).
 *
 * Backend selection is a leak boundary: hosted mode must never silently fall
 * back to an unsafe local source of truth. The resolver is pure and takes an
 * injected `env`, so every rule below is checked with no database and no
 * mutation of process.env.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");

const { resolveMemoryBackend } = loadTsModule(path.resolve(__dirname, "backend.ts"));

const URL_A = "postgres://u:p@host-a:5432/mem";
const URL_B = "postgres://u:p@host-b:5432/mem";

// ── auto (default) ──────────────────────────────────────────────────────────

test("auto: no connection string → local PGLite, dataDir passthrough", () => {
  const r = resolveMemoryBackend({ dataDir: "/tmp/mem" }, {});
  assert.deepEqual(r, { kind: "pglite", dataDir: "/tmp/mem" });
});

test("auto: MEMORY_DATABASE_URL present → Postgres", () => {
  const r = resolveMemoryBackend({}, { MEMORY_DATABASE_URL: URL_A });
  assert.deepEqual(r, { kind: "postgres", connectionString: URL_A });
});

test("auto: DATABASE_URL is the fallback when MEMORY_DATABASE_URL is unset", () => {
  const r = resolveMemoryBackend({}, { DATABASE_URL: URL_A });
  assert.deepEqual(r, { kind: "postgres", connectionString: URL_A });
});

test("auto: MEMORY_DATABASE_URL wins over DATABASE_URL", () => {
  const r = resolveMemoryBackend({}, { MEMORY_DATABASE_URL: URL_A, DATABASE_URL: URL_B });
  assert.equal(r.connectionString, URL_A);
});

test("auto: empty-string env values are treated as unset → PGLite", () => {
  const r = resolveMemoryBackend({}, { MEMORY_DATABASE_URL: "", DATABASE_URL: "  " });
  assert.equal(r.kind, "pglite");
});

// ── explicit postgres (the no-silent-fallback guarantee) ────────────────────

test("explicit postgres + URL → Postgres", () => {
  const r = resolveMemoryBackend({}, { MEMORY_STORE_BACKEND: "postgres", MEMORY_DATABASE_URL: URL_A });
  assert.deepEqual(r, { kind: "postgres", connectionString: URL_A });
});

test("explicit postgres + NO URL → throws (never falls back to PGLite)", () => {
  assert.throws(
    () => resolveMemoryBackend({}, { MEMORY_STORE_BACKEND: "postgres" }),
    /no connection string|Refusing to fall back/,
  );
});

test("explicit postgres is case/whitespace insensitive", () => {
  const r = resolveMemoryBackend({}, { MEMORY_STORE_BACKEND: "  PostGres  ", MEMORY_DATABASE_URL: URL_A });
  assert.equal(r.kind, "postgres");
});

// ── explicit pglite ─────────────────────────────────────────────────────────

test("explicit pglite ignores any connection string", () => {
  const r = resolveMemoryBackend(
    { dataDir: "/tmp/mem" },
    { MEMORY_STORE_BACKEND: "pglite", MEMORY_DATABASE_URL: URL_A },
  );
  assert.deepEqual(r, { kind: "pglite", dataDir: "/tmp/mem" });
});

// ── precedence: opts over env ───────────────────────────────────────────────

test("opts.backend overrides MEMORY_STORE_BACKEND", () => {
  const r = resolveMemoryBackend(
    { backend: "pglite" },
    { MEMORY_STORE_BACKEND: "postgres", MEMORY_DATABASE_URL: URL_A },
  );
  assert.equal(r.kind, "pglite");
});

test("opts.connectionString overrides the environment URLs", () => {
  const r = resolveMemoryBackend(
    { backend: "postgres", connectionString: URL_B },
    { MEMORY_DATABASE_URL: URL_A },
  );
  assert.equal(r.connectionString, URL_B);
});

// ── validation ──────────────────────────────────────────────────────────────

test("an unknown selector throws", () => {
  assert.throws(
    () => resolveMemoryBackend({ backend: "mysql" }, {}),
    /Invalid memory backend/,
  );
});

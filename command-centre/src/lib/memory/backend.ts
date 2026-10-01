/**
 * Memory Schema — backend selection (PGLite vs hosted Postgres).
 *
 * One memory store interface, two engines. The same schema and migrations run
 * identically on local PGLite and hosted Postgres; this module is the seam that
 * picks which one `openMemoryStore()` opens — explicitly, and without ever
 * silently substituting an unsafe local source of truth for a hosted one.
 *
 * It is deliberately PURE: no database imports, no I/O. It maps a small set of
 * inputs (an explicit selector + a connection string, from opts or the
 * environment) to a resolved decision the store then acts on. That keeps backend
 * selection trivial to unit-test (see backend.test.cjs) and keeps the leak
 * boundary — "hosted mode never falls back to local" — a single, inspectable
 * rule rather than scattered try/catch.
 *
 * Selection axis. `MEMORY_STORE_BACKEND` chooses the storage ENGINE
 * (pglite | postgres). The older `MEMORY_BACKEND=memsearch` recall path has
 * been removed; use scripts/setup-memory.sh to migrate legacy data.
 */

/** Explicit engine selector. `auto` picks Postgres iff a connection URL is present. */
export type MemoryBackendSelector = "auto" | "pglite" | "postgres";

export const MEMORY_BACKEND_SELECTORS: readonly MemoryBackendSelector[] = [
  "auto",
  "pglite",
  "postgres",
];

/** Caller-supplied overrides; each falls back to the environment when omitted. */
export interface ResolveMemoryBackendInput {
  /** Explicit engine. Overrides `MEMORY_STORE_BACKEND`. Default: `auto`. */
  backend?: MemoryBackendSelector;
  /** Explicit Postgres URL. Overrides `MEMORY_DATABASE_URL` / `DATABASE_URL`. */
  connectionString?: string;
  /** PGLite data directory (ignored by the Postgres engine). */
  dataDir?: string;
}

/** The resolved decision the store acts on — a discriminated union by `kind`. */
export type ResolvedMemoryBackend =
  | { kind: "pglite"; dataDir?: string }
  | { kind: "postgres"; connectionString: string };

/** Minimal env shape — just the keys this resolver reads. */
type Env = Record<string, string | undefined>;

function normalizeSelector(value: string | undefined): MemoryBackendSelector {
  const selector = (value ?? "auto").trim().toLowerCase();
  if (selector === "") return "auto";
  if (!MEMORY_BACKEND_SELECTORS.includes(selector as MemoryBackendSelector)) {
    throw new Error(
      `Invalid memory backend "${value}": set MEMORY_STORE_BACKEND (or opts.backend) ` +
        `to one of ${MEMORY_BACKEND_SELECTORS.join(", ")}.`,
    );
  }
  return selector as MemoryBackendSelector;
}

/** Read the hosted connection string from opts, then the env, treating "" as unset. */
function resolveConnectionString(input: ResolveMemoryBackendInput, env: Env): string | undefined {
  const candidate =
    input.connectionString ?? env.MEMORY_DATABASE_URL ?? env.DATABASE_URL ?? undefined;
  const trimmed = typeof candidate === "string" ? candidate.trim() : "";
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Decide which engine to open. Pure — no connection is made here.
 *
 * Rules:
 *   - `postgres` (explicit) REQUIRES a connection string; a missing one throws.
 *     This is the no-silent-fallback guarantee: a deployment that asks for hosted
 *     memory never quietly serves the local PGLite store instead.
 *   - `pglite` (explicit) always opens local PGLite and ignores any URL.
 *   - `auto` (default) opens Postgres iff a connection string is present, else
 *     PGLite — the convenient default, consistent with `memory:migrate`.
 */
export function resolveMemoryBackend(
  input: ResolveMemoryBackendInput = {},
  env: Env = process.env,
): ResolvedMemoryBackend {
  const selector = normalizeSelector(input.backend ?? env.MEMORY_STORE_BACKEND);
  const connectionString = resolveConnectionString(input, env);

  if (selector === "postgres") {
    if (!connectionString) {
      throw new Error(
        "Hosted memory backend selected (MEMORY_STORE_BACKEND=postgres) but no " +
          "connection string is set. Provide MEMORY_DATABASE_URL (or DATABASE_URL). " +
          "Refusing to fall back to the local PGLite store.",
      );
    }
    return { kind: "postgres", connectionString };
  }

  if (selector === "pglite") {
    return { kind: "pglite", dataDir: input.dataDir };
  }

  // auto
  return connectionString
    ? { kind: "postgres", connectionString }
    : { kind: "pglite", dataDir: input.dataDir };
}

/**
 * AIOS Memory Schema — scope invariants & the scoped-search WHERE builder.
 *
 * This module is the SINGLE source of the memory leak boundary. The DB CHECK
 * constraints in ./migrations/0001_init.sql enforce the same invariants at the
 * storage layer; this file enforces them in application code (defense in depth)
 * and builds the exact WHERE clause the scoped search runs. The
 * no-leak tests import this module so they cover the real filter,
 * not a copy of it.
 *
 * Scope rules (must match the DB CHECK exactly):
 *   private => userId   present
 *   client  => clientId present
 *   team    => teamId   present
 *   system  => baseline within a tenant (no extra column required)
 */

import type { Scope, SearchScope, Visibility } from "./types";
import { ALL_VISIBILITIES } from "./types";

/** A parameterized SQL fragment plus its ordered positional params. */
export interface ScopeWhere {
  /** Boolean SQL expression (unqualified column names, single-table search). */
  sql: string;
  /** Positional params in `$n` order, matching the placeholders in `sql`. */
  params: unknown[];
}

/**
 * Remove identifiers that do not define the selected visibility. This keeps
 * the unique source key stable when callers carry an authenticated user id
 * into a shared scope.
 */
export function normalizeScope(scope: Scope): Scope {
  switch (scope.visibility) {
    case "private":
      return { ...scope, clientId: null };
    case "client":
      return { ...scope, userId: null };
    case "team":
    case "system":
      return { ...scope, clientId: null, userId: null };
    default:
      return scope;
  }
}

/**
 * Non-throwing predicate form of the scope invariants. Used by the no-leak
 * tests and by callers that want to validate before constructing a row.
 */
export function isValidScope(scope: Scope): boolean {
  switch (scope.visibility) {
    case "private":
      return scope.userId != null;
    case "client":
      return scope.clientId != null;
    case "team":
      return scope.teamId != null;
    case "system":
      return true;
    default:
      // Unknown visibility — reject. (Exhaustiveness guard.)
      return false;
  }
}

/**
 * Throwing form of {@link isValidScope}. Call before any INSERT so a bad scope
 * fails with a typed error long before the DB CHECK rejects it.
 */
export function assertValidScope(scope: Scope): void {
  if (!isValidScope(scope)) {
    throw new Error(
      `Invalid memory scope: visibility="${scope.visibility}" requires ` +
        `${requiredColumnFor(scope.visibility)} to be present ` +
        `(teamId=${fmt(scope.teamId)}, clientId=${fmt(scope.clientId)}, userId=${fmt(scope.userId)})`,
    );
  }
}

/**
 * Assert a chunk's denormalized scope exactly matches its parent source's
 * scope. Chunks copy scope from their source for the pre-filter hot path; this
 * guard prevents drift that would silently widen a chunk's visibility.
 */
export function assertChunkMatchesSource(chunk: Scope, source: Scope): void {
  const mismatches: string[] = [];
  if (chunk.teamId !== source.teamId) mismatches.push("teamId");
  if (chunk.clientId !== source.clientId) mismatches.push("clientId");
  if (chunk.userId !== source.userId) mismatches.push("userId");
  if (chunk.visibility !== source.visibility) mismatches.push("visibility");
  if (mismatches.length > 0) {
    throw new Error(
      `Chunk scope does not match its source on: ${mismatches.join(", ")}. ` +
        `A chunk must never have a wider scope than its source.`,
    );
  }
}

/**
 * Build the parameterized scope WHERE fragment for a scoped search.
 *
 * The returned `sql` is a boolean expression over the (single) memory_chunks
 * table using unqualified column names, suitable to drop into:
 *
 *   SELECT ... FROM memory_chunks
 *   WHERE ${sql} AND embedding IS NOT NULL
 *   ORDER BY embedding <=> $k LIMIT $k
 *
 * Leak-safety behavior:
 *  - The team predicate is ALWAYS emitted. A null teamId yields `team_id IS
 *    NULL` (local); a non-null teamId yields `team_id = $n`. Forgetting the
 *    team thus returns nothing in a hosted multi-team DB — never everything.
 *  - The `private` branch is emitted only when a userId is supplied (never
 *    `user_id = NULL`); the `client` branch only when a clientId is supplied.
 *  - `team` and `system` are included whenever present in `include`.
 *  - If no visibility branch is emitted, the block degrades to `FALSE`
 *    (match nothing) rather than matching everything.
 *
 * @param scope        who is asking
 * @param paramOffset  number of positional params already consumed before this
 *                     fragment (so placeholders start at `$${paramOffset + 1}`)
 */
export function buildScopeWhere(scope: SearchScope, paramOffset = 0): ScopeWhere {
  const params: unknown[] = [];
  let next = paramOffset;
  const placeholder = (value: unknown): string => {
    params.push(value);
    next += 1;
    return `$${next}`;
  };

  // Team predicate — always present.
  const teamSql =
    scope.teamId == null ? "team_id IS NULL" : `team_id = ${placeholder(scope.teamId)}`;

  // Visibility OR-block, limited to the requested layers.
  const include = scope.include ?? ALL_VISIBILITIES;
  const want = (v: Visibility): boolean => include.includes(v);
  const branches: string[] = [];

  if (want("system")) {
    branches.push("visibility = 'system'");
  }
  if (want("team")) {
    branches.push("visibility = 'team'");
  }
  if (want("client") && scope.clientId != null) {
    branches.push(`(visibility = 'client' AND client_id = ${placeholder(scope.clientId)})`);
  }
  if (want("private") && scope.userId != null) {
    branches.push(`(visibility = 'private' AND user_id = ${placeholder(scope.userId)})`);
  }

  const visibilitySql = branches.length > 0 ? `(${branches.join(" OR ")})` : "FALSE";

  return { sql: `${teamSql} AND ${visibilitySql}`, params };
}

function requiredColumnFor(visibility: Visibility): string {
  switch (visibility) {
    case "private":
      return "userId";
    case "client":
      return "clientId";
    case "team":
      return "teamId";
    default:
      return "(none)";
  }
}

function fmt(value: string | null): string {
  return value == null ? "null" : `"${value}"`;
}

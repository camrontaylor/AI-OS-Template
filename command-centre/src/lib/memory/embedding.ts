/**
 * AIOS Memory Schema — embedding (de)serialization helpers.
 *
 * pgvector accepts a vector literal as a bound text parameter of the form
 * `'[0.1,0.2,0.3]'` (cast `$n::vector`), and PGLite returns a vector column as
 * that same string. These pure helpers isolate that single, high-risk mapping
 * so it can be unit-tested without a database and reused by a future hosted
 * `pg` adapter. They live apart from the store on purpose — no DB import.
 */

/**
 * Serialize an embedding to the pgvector literal form `'[0.1,0.2,0.3]'`.
 * Bind the result as a parameter and cast it `$n::vector` in SQL.
 *
 * Throws on an empty array or any non-finite value — a bad embedding must fail
 * in application code with a clear message, not as an opaque pgvector error.
 */
export function toVectorLiteral(embedding: number[]): string {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("toVectorLiteral: embedding must be a non-empty number[]");
  }
  for (const value of embedding) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(
        "toVectorLiteral: embedding must contain only finite numbers",
      );
    }
  }
  return `[${embedding.join(",")}]`;
}

/**
 * Parse a vector column value back to `number[]`.
 *
 * - `null`/`undefined` → `null` (an un-embedded chunk).
 * - a native array → returned as-is (a future hosted-`pg` type parser may
 *   already hydrate it).
 * - the PGLite string form `'[0.1,0.2,0.3]'` → parsed via `JSON.parse` (the
 *   literal is valid JSON).
 */
export function parseVectorLiteral(value: unknown): number[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value as number[];
  if (typeof value === "string") {
    return JSON.parse(value) as number[];
  }
  throw new Error(
    `parseVectorLiteral: unexpected vector value type "${typeof value}"`,
  );
}

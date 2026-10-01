const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");

// scope.ts imports ALL_VISIBILITIES from ./types (type-only imports are erased).
// loadTsModule does not recursively transpile sibling .ts files, so stub the
// single runtime value scope.ts needs from ./types.
const scope = loadTsModule(path.resolve(__dirname, "scope.ts"), {
  stubs: {
    "./types": { ALL_VISIBILITIES: ["private", "client", "team", "system"] },
  },
});

const migrate = loadTsModule(path.resolve(__dirname, "migrate.ts"));

function mk(visibility, overrides = {}) {
  return { teamId: null, clientId: null, userId: null, visibility, ...overrides };
}

// ---------------------------------------------------------------------------
// Scope invariants (mirror the DB CHECK constraints).
// ---------------------------------------------------------------------------

test("isValidScope enforces the required column per visibility", () => {
  assert.equal(scope.isValidScope(mk("private", { userId: "u1" })), true);
  assert.equal(scope.isValidScope(mk("private")), false);

  assert.equal(scope.isValidScope(mk("client", { clientId: "acme" })), true);
  assert.equal(scope.isValidScope(mk("client")), false);

  assert.equal(scope.isValidScope(mk("team", { teamId: "t1" })), true);
  assert.equal(scope.isValidScope(mk("team")), false);

  // system is a baseline — valid even with all scope columns null.
  assert.equal(scope.isValidScope(mk("system")), true);

  // Unknown visibility is rejected.
  assert.equal(scope.isValidScope(mk("bogus")), false);
});

test("normalizeScope removes identifiers that do not define the visibility", () => {
  assert.deepEqual(
    scope.normalizeScope(mk("private", { teamId: "t1", clientId: "acme", userId: "u1" })),
    mk("private", { teamId: "t1", clientId: null, userId: "u1" }),
  );
  assert.deepEqual(
    scope.normalizeScope(mk("client", { teamId: "t1", clientId: "acme", userId: "u1" })),
    mk("client", { teamId: "t1", clientId: "acme", userId: null }),
  );
  assert.deepEqual(
    scope.normalizeScope(mk("team", { teamId: "t1", clientId: "acme", userId: "u1" })),
    mk("team", { teamId: "t1", clientId: null, userId: null }),
  );
  assert.deepEqual(
    scope.normalizeScope(mk("system", { teamId: "t1", clientId: "acme", userId: "u1" })),
    mk("system", { teamId: "t1", clientId: null, userId: null }),
  );
});

test("assertValidScope throws on a violated invariant and names the column", () => {
  assert.doesNotThrow(() => scope.assertValidScope(mk("team", { teamId: "t1" })));
  assert.throws(() => scope.assertValidScope(mk("private")), /userId/);
  assert.throws(() => scope.assertValidScope(mk("client")), /clientId/);
  assert.throws(() => scope.assertValidScope(mk("team")), /teamId/);
});

test("assertChunkMatchesSource rejects scope drift", () => {
  const source = mk("client", { clientId: "acme", teamId: "t1" });
  assert.doesNotThrow(() => scope.assertChunkMatchesSource({ ...source }, source));

  assert.throws(
    () => scope.assertChunkMatchesSource(mk("client", { clientId: "other", teamId: "t1" }), source),
    /clientId/,
  );
  assert.throws(
    () => scope.assertChunkMatchesSource(mk("team", { clientId: "acme", teamId: "t1" }), source),
    /visibility/,
  );
});

// ---------------------------------------------------------------------------
// buildScopeWhere — the leak boundary.
// ---------------------------------------------------------------------------

test("local search (team_id null) includes system/team and own client+private only", () => {
  const { sql, params } = scope.buildScopeWhere({
    teamId: null,
    clientId: "acme",
    userId: "u1",
  });

  assert.match(sql, /^team_id IS NULL AND \(/);
  assert.match(sql, /visibility = 'system'/);
  assert.match(sql, /visibility = 'team'/);
  assert.match(sql, /\(visibility = 'client' AND client_id = \$1\)/);
  assert.match(sql, /\(visibility = 'private' AND user_id = \$2\)/);
  assert.deepEqual(params, ["acme", "u1"]);
});

test("a team search without a user NEVER includes any private row", () => {
  const { sql, params } = scope.buildScopeWhere({ teamId: "t1" });

  assert.equal(sql, "team_id = $1 AND (visibility = 'system' OR visibility = 'team')");
  assert.deepEqual(params, ["t1"]);
  assert.doesNotMatch(sql, /private/);
  assert.doesNotMatch(sql, /client/);
});

test("forgetting the team filters to IS NULL, never matches a hosted team's rows", () => {
  // teamId omitted/null => team_id IS NULL => returns nothing in a hosted DB,
  // never everything. This is the catastrophic-default safeguard.
  const { sql } = scope.buildScopeWhere({ teamId: null });
  assert.match(sql, /^team_id IS NULL AND /);
});

test("asking for private without a userId degrades to FALSE (matches nothing)", () => {
  const { sql, params } = scope.buildScopeWhere({ teamId: "t1", include: ["private"] });
  assert.equal(sql, "team_id = $1 AND FALSE");
  assert.deepEqual(params, ["t1"]);
});

test("paramOffset shifts placeholders for composition with other clauses", () => {
  const { sql, params } = scope.buildScopeWhere(
    { teamId: "t1", clientId: "acme", include: ["system", "team", "client"] },
    2,
  );
  assert.equal(
    sql,
    "team_id = $3 AND (visibility = 'system' OR visibility = 'team' OR (visibility = 'client' AND client_id = $4))",
  );
  assert.deepEqual(params, ["t1", "acme"]);
});

test("include limits the visibility layers searched", () => {
  const { sql } = scope.buildScopeWhere({
    teamId: null,
    clientId: "acme",
    userId: "u1",
    include: ["client"],
  });
  assert.equal(sql, "team_id IS NULL AND ((visibility = 'client' AND client_id = $1))");
});

// ---------------------------------------------------------------------------
// migrate.ts — pure helpers + apply flow against a fake SqlClient.
// ---------------------------------------------------------------------------

test("renderMigrationSql substitutes :EMBED_DIM and validates the dimension", () => {
  assert.equal(migrate.renderMigrationSql("vector(:EMBED_DIM)", 384), "vector(384)");
  assert.equal(
    migrate.renderMigrationSql("a :EMBED_DIM b :EMBED_DIM", 768),
    "a 768 b 768",
  );
  assert.throws(() => migrate.renderMigrationSql("x", 0), /Invalid embedDim/);
  assert.throws(() => migrate.renderMigrationSql("x", 1.5), /Invalid embedDim/);
  assert.throws(() => migrate.renderMigrationSql("x", 99999), /Invalid embedDim/);
});

test("sortMigrations orders by version and rejects duplicates", () => {
  const sorted = migrate.sortMigrations([
    { version: 2, name: "b", sql: "" },
    { version: 1, name: "a", sql: "" },
  ]);
  assert.deepEqual(
    sorted.map((m) => m.version),
    [1, 2],
  );
  assert.throws(
    () =>
      migrate.sortMigrations([
        { version: 1, name: "a", sql: "" },
        { version: 1, name: "dup", sql: "" },
      ]),
    /Duplicate migration version 1/,
  );
});

/** In-memory SqlClient that simulates the schema_migrations ledger. */
function fakeDb() {
  const ledger = [];
  const execLog = [];
  return {
    ledger,
    execLog,
    async exec(sql) {
      execLog.push(sql.trim().split(/\s+/).slice(0, 2).join(" "));
      return undefined;
    },
    async query(sql, params = []) {
      if (sql.includes("SELECT version, embed_dim FROM schema_migrations")) {
        return { rows: [...ledger].sort((a, b) => a.version - b.version) };
      }
      if (sql.startsWith("INSERT INTO schema_migrations")) {
        ledger.push({ version: params[0], name: params[1], embed_dim: params[2] });
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

test("applyMigrations applies pending migrations and is idempotent", async () => {
  const migrations = [
    { version: 1, name: "init", sql: "CREATE TABLE t (e vector(:EMBED_DIM));" },
    { version: 2, name: "more", sql: "CREATE TABLE u (x int);" },
  ];
  const db = fakeDb();

  const first = await migrate.applyMigrations(db, { embedDim: 384, migrations });
  assert.deepEqual(first.applied, ["1_init", "2_more"]);
  assert.equal(first.from, 0);
  assert.equal(first.to, 2);
  assert.equal(first.embedDim, 384);
  assert.deepEqual(
    db.ledger.map((r) => r.version),
    [1, 2],
  );

  // Re-running applies nothing.
  const second = await migrate.applyMigrations(db, { embedDim: 384, migrations });
  assert.deepEqual(second.applied, []);
  assert.equal(second.from, 2);
});

test("applyMigrations fills missing lower-version ledger gaps", async () => {
  const migrations = [
    { version: 1, name: "init", sql: "CREATE TABLE t (e vector(:EMBED_DIM));" },
    { version: 2, name: "more", sql: "CREATE TABLE u (x int);" },
    { version: 3, name: "later", sql: "CREATE TABLE v (x int);" },
  ];
  const db = fakeDb();
  db.ledger.push({ version: 3, name: "later", embed_dim: 384 });

  const result = await migrate.applyMigrations(db, { embedDim: 384, migrations });

  assert.deepEqual(result.applied, ["1_init", "2_more"]);
  assert.equal(result.from, 3);
  assert.equal(result.to, 3);
  assert.deepEqual(
    db.ledger.map((r) => r.version).sort((a, b) => a - b),
    [1, 2, 3],
  );
});

test("applyMigrations refuses a different embedding dimension", async () => {
  const migrations = [{ version: 1, name: "init", sql: "CREATE TABLE t (e vector(:EMBED_DIM));" }];
  const db = fakeDb();

  await migrate.applyMigrations(db, { embedDim: 384, migrations });
  await assert.rejects(
    () => migrate.applyMigrations(db, { embedDim: 1536, migrations }),
    /Embedding dimension mismatch/,
  );
});

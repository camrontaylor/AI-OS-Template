const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, after } = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");

// loadTsModule transpiles a SINGLE .ts file and does not recurse into sibling
// imports, so each leaf module is loaded first and injected as a stub into the
// identity store. The memory modules (migrate/adapters/backend) and the identity
// row-mappers/types load stub-free: their only cross-file imports are `import
// type` (erased) or third-party/node builtins that fall through to real require.
const MEM = (file) => path.resolve(__dirname, "../memory", file);
const ID = (file) => path.resolve(__dirname, file);

const migrate = loadTsModule(MEM("migrate.ts"));
const adapter = loadTsModule(MEM("pglite-adapter.ts"));
const postgresAdapter = loadTsModule(MEM("postgres-adapter.ts"));
const backend = loadTsModule(MEM("backend.ts"));
const rowMappers = loadTsModule(ID("row-mappers.ts"));
const store = loadTsModule(ID("store.ts"), {
  stubs: {
    "../memory/migrate": migrate,
    "../memory/pglite-adapter": adapter,
    "../memory/postgres-adapter": postgresAdapter,
    "../memory/backend": backend,
    "./row-mappers": rowMappers,
  },
});

// Small embedding dimension keeps the 0001 vector columns cheap; the team-platform
// tables have no vectors. Force PGLite so a stray MEMORY_DATABASE_URL in the env
// can't redirect the suite at a real Postgres.
const EMBED_DIM = 8;

/** @type {import("./store").IdentityStore} */
let s;
let teamSeq = 0;
let companyOwnerUser;

/** A fresh team (+ optional members) per test, so tests never collide in the shared store. */
async function freshTeam() {
  teamSeq += 1;
  return s.createTeam({ slug: `team-${teamSeq}`, name: `Team ${teamSeq}` });
}

before(async () => {
  s = await store.openIdentityStore({ backend: "pglite", embedDim: EMBED_DIM });
});

after(async () => {
  await s.close();
});

// ---------------------------------------------------------------------------
// Identity migrations apply after the memory migrations in the same database.
// ---------------------------------------------------------------------------

test("openIdentityStore applies the team-platform migration", async () => {
  for (const tbl of [
    "users",
    "teams",
    "memberships",
    "clients",
    "client_grants",
    "skill_grants",
    "team_secrets",
    "secret_grants",
    "user_config_files",
    "workstations",
    "audit_events",
    "team_os_instance",
    "company_memberships",
    "company_team_access_requests",
    "company_team_access_grants",
    "company_audit_events",
  ]) {
    const reg = await s.client.query(`SELECT to_regclass('${tbl}') AS reg`);
    assert.notEqual(reg.rows[0].reg, null, `table ${tbl} should exist`);
  }

  const led = await s.client.query(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  const versions = led.rows.map((r) => Number(r.version));
  assert.ok(versions.includes(1), "memory migration applied");
  assert.ok(versions.includes(2), "chunk provenance migration applied");
  assert.ok(versions.includes(3), "keyword FTS migration applied");
  assert.ok(versions.includes(4), "team-platform migration applied");
  assert.ok(versions.includes(5), "team-os phase 1 migration applied");
  assert.ok(versions.includes(21), "stable Team OS server identity migration applied");
  assert.ok(versions.includes(22), "company permissions migration applied");
});

test("company migration selects the oldest active Team Owner deterministically", async () => {
  const opened = await adapter.openPGlite();
  try {
    const migrations = migrate.loadMigrationsFromDir(MEM("migrations"));
    await migrate.applyMigrations(opened.client, {
      embedDim: EMBED_DIM,
      migrations: migrations.filter((migration) => migration.version < 22),
    });
    await opened.client.exec(`
      INSERT INTO users (id, email, status) VALUES
        ('00000000-0000-0000-0000-000000000101', 'older-date@example.com', 'active'),
        ('00000000-0000-0000-0000-000000000102', 'tie-high@example.com', 'active'),
        ('00000000-0000-0000-0000-000000000103', 'tie-low@example.com', 'active');
      INSERT INTO teams (id, slug, name, status) VALUES
        ('00000000-0000-0000-0000-000000000201', 'migration-team', 'Migration Team', 'active');
      INSERT INTO memberships (id, team_id, user_id, role, status, created_at) VALUES
        ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101', 'owner', 'active', '2026-01-02T00:00:00Z'),
        ('00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000102', 'owner', 'active', '2026-01-01T00:00:00Z'),
        ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000103', 'owner', 'active', '2026-01-01T00:00:00Z');
    `);
    await migrate.applyMigrations(opened.client, { embedDim: EMBED_DIM, migrations });
    const result = await opened.client.query(
      `SELECT user_id::text AS user_id FROM company_memberships
       WHERE role = 'owner' AND status = 'active'`,
    );
    assert.deepEqual(result.rows, [{ user_id: "00000000-0000-0000-0000-000000000103" }]);
  } finally {
    await opened.close();
  }
});

test("server identity is a stable database-backed UUID", async () => {
  const first = await s.getServerIdentity();
  const second = await s.getServerIdentity();
  assert.match(first.serverId, /^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
  assert.equal(second.serverId, first.serverId);
  assert.equal(second.createdAt, first.createdAt);
});

test("Team slugs are normalized and unique without case ambiguity", async () => {
  const team = await s.createTeam({ slug: "  Mixed-Case  ", name: "  Mixed Case  " });
  assert.equal(team.slug, "mixed-case");
  assert.equal(team.name, "Mixed Case");
  assert.equal((await s.getTeamBySlug("MIXED-CASE")).id, team.id);
  await assert.rejects(
    s.createTeam({ slug: "mixed-case", name: "Duplicate" }),
    /unique|duplicate/i,
  );
});

test("Company Owner recovery is atomic and protects the active Owner", async () => {
  const disabled = await s.upsertUser({ email: "disabled-owner@example.com", status: "disabled" });
  await assert.rejects(
    s.recoverCompanyOwner({ userId: disabled.id }),
    /active user is required/,
  );
  await assert.rejects(
    s.upsertCompanyMembership({ userId: disabled.id, role: "admin", status: "active" }),
    /active user is required/,
  );

  companyOwnerUser = await s.upsertUser({ email: "company-owner@example.com" });
  const owner = await s.recoverCompanyOwner({ userId: companyOwnerUser.id });
  assert.equal(owner.role, "owner");
  assert.equal(owner.status, "active");

  const other = await s.upsertUser({ email: "second-owner@example.com" });
  await assert.rejects(
    s.recoverCompanyOwner({ userId: other.id }),
    /active Company Owner already exists/,
  );
  await assert.rejects(
    s.upsertCompanyMembership({
      userId: companyOwnerUser.id,
      role: "admin",
      status: "active",
    }),
    /transferCompanyOwnership/,
  );
  assert.equal((await s.getCompanyMembership(companyOwnerUser.id)).role, "owner");
});

test("ownership transfer is atomic and preserves explicit access for the previous Owner", async () => {
  const team = await freshTeam();
  const nextOwner = await s.upsertUser({ email: "next-company-owner@example.com" });
  await s.upsertCompanyMembership({ userId: nextOwner.id, role: "admin", status: "active" });

  const result = await s.transferCompanyOwnership({
    currentOwnerUserId: companyOwnerUser.id,
    newOwnerUserId: nextOwner.id,
    actorUserId: companyOwnerUser.id,
  });
  assert.equal(result.owner.userId, nextOwner.id);
  assert.equal(result.owner.role, "owner");
  assert.equal(result.previousOwner.role, "admin");
  assert.ok(await s.getActiveCompanyTeamAccessGrant(team.id, companyOwnerUser.id));
  companyOwnerUser = nextOwner;

  const disabledCandidate = await s.upsertUser({ email: "disabled-next-company-owner@example.com" });
  await s.upsertCompanyMembership({ userId: disabledCandidate.id, role: "admin", status: "active" });
  await s.client.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [disabledCandidate.id]);
  await assert.rejects(
    s.transferCompanyOwnership({
      currentOwnerUserId: companyOwnerUser.id,
      newOwnerUserId: disabledCandidate.id,
      actorUserId: companyOwnerUser.id,
    }),
    /active users/,
  );
  assert.equal((await s.getCompanyMembership(companyOwnerUser.id)).role, "owner");
  assert.equal((await s.getCompanyMembership(disabledCandidate.id)).role, "admin");
});

test("Company Admin promotion is atomic and never converts direct Team memberships", async () => {
  const team = await freshTeam();
  const user = await s.upsertUser({ email: `promoted-company-admin-${team.slug}@example.com` });
  await s.upsertMembership({ teamId: team.id, userId: user.id, role: "owner", status: "active" });
  const directBefore = await s.listMembershipsForUser(user.id);

  const promoted = await s.promoteCompanyAdmin({
    userId: user.id,
    actorUserId: companyOwnerUser.id,
  });
  assert.equal(promoted.role, "admin");
  assert.equal(promoted.status, "active");
  assert.deepEqual(await s.listMembershipsForUser(user.id), directBefore);
  await assert.rejects(
    s.promoteCompanyAdmin({ userId: user.id, actorUserId: companyOwnerUser.id }),
    /already an active or invited Company Admin/,
  );

  const removed = await s.removeCompanyAdmin({
    userId: user.id,
    actorUserId: companyOwnerUser.id,
  });
  const reactivated = await s.promoteCompanyAdmin({
    userId: user.id,
    actorUserId: companyOwnerUser.id,
  });
  assert.equal(reactivated.id, removed.id);
  assert.equal(reactivated.status, "active");
  assert.deepEqual(await s.listMembershipsForUser(user.id), directBefore);

  const audit = await s.listCompanyAuditEvents({
    targetType: "company_membership",
    targetId: promoted.id,
  });
  assert.equal(audit.filter((event) => event.action === "company_membership.promoted").length, 2);

  await assert.rejects(
    s.promoteCompanyAdmin({ userId: companyOwnerUser.id, actorUserId: companyOwnerUser.id }),
    /Company Owner cannot be promoted/,
  );
  const invited = await s.upsertUser({ email: `invited-company-admin-${team.slug}@example.com` });
  await s.upsertCompanyMembership({
    userId: invited.id,
    role: "admin",
    status: "invited",
    invitedBy: companyOwnerUser.id,
    inviteTokenHash: "invited-company-admin-token",
    inviteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await assert.rejects(
    s.promoteCompanyAdmin({ userId: invited.id, actorUserId: companyOwnerUser.id }),
    /already an active or invited Company Admin/,
  );
  const disabled = await s.upsertUser({
    email: `disabled-company-admin-${team.slug}@example.com`,
    status: "disabled",
  });
  await assert.rejects(
    s.promoteCompanyAdmin({ userId: disabled.id, actorUserId: companyOwnerUser.id }),
    /requires an active user/,
  );
});

test("disabled users cannot accept Company invitations and the token remains pending", async () => {
  const user = await s.upsertUser({ email: "disabled-company-invite@example.com" });
  await s.upsertCompanyMembership({
    userId: user.id,
    role: "admin",
    status: "invited",
    inviteTokenHash: "pending-token-hash",
    inviteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await s.client.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [user.id]);

  await assert.rejects(
    s.claimCompanyInvitation({
      userId: user.id,
      tokenHash: "pending-token-hash",
      claimId: "disabled-user-claim",
    }),
    /active user is required/,
  );
  const membership = await s.getCompanyMembership(user.id);
  assert.equal(membership.status, "invited");
  assert.equal(membership.inviteTokenHash, "pending-token-hash");
});

test("Team lifecycle keeps an active Owner and only minimal audit after deletion", async () => {
  const initialOwner = await s.upsertUser({ email: `team-owner-${++teamSeq}@example.com` });
  const secondOwner = await s.upsertUser({ email: `team-owner-second-${teamSeq}@example.com` });
  const created = await s.createTeamWithOwner({
    slug: `managed-${teamSeq}`,
    name: "Managed Team",
    ownerUserId: initialOwner.id,
    creatorUserId: companyOwnerUser.id,
  });
  await s.addTeamOwner({
    teamId: created.team.id,
    userId: secondOwner.id,
    actorUserId: companyOwnerUser.id,
  });
  await s.removeTeamOwner({
    teamId: created.team.id,
    userId: secondOwner.id,
    actorUserId: companyOwnerUser.id,
  });
  await assert.rejects(
    s.removeTeamOwner({
      teamId: created.team.id,
      userId: initialOwner.id,
      actorUserId: companyOwnerUser.id,
    }),
    /at least one active Team Owner/,
  );

  const archived = await s.archiveTeam({
    teamId: created.team.id,
    actorUserId: companyOwnerUser.id,
  });
  await assert.rejects(
    s.deleteTeamPermanently({
      teamId: created.team.id,
      actorUserId: companyOwnerUser.id,
      expectedName: created.team.name,
      now: new Date(archived.archivedAt),
    }),
    /archived for 30 days/,
  );
  const deleted = await s.deleteTeamPermanently({
    teamId: created.team.id,
    actorUserId: companyOwnerUser.id,
    expectedName: created.team.name,
    now: new Date(new Date(archived.archivedAt).getTime() + 31 * 24 * 60 * 60 * 1000),
  });
  assert.equal(deleted.id, created.team.id);
  assert.equal(await s.getTeam(created.team.id), null);
  const audit = await s.listCompanyAuditEvents({ teamId: created.team.id });
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, "team.deleted");
});

test("existing Team members are added atomically and suspended memberships reactivate in place", async () => {
  const team = await freshTeam();
  const user = await s.upsertUser({ email: `existing-member-${team.slug}@example.com` });

  const added = await s.addTeamMember({
    teamId: team.id,
    userId: user.id,
    actorUserId: companyOwnerUser.id,
    role: "member",
  });
  assert.equal(added.status, "active");
  assert.equal(added.role, "member");
  await assert.rejects(
    s.addTeamMember({
      teamId: team.id,
      userId: user.id,
      actorUserId: companyOwnerUser.id,
      role: "admin",
    }),
    /active or invited membership/,
  );

  await s.setMembershipStatus(team.id, user.id, "suspended");
  await s.client.query(
    `UPDATE memberships SET metadata = $3::jsonb WHERE team_id = $1 AND user_id = $2`,
    [team.id, user.id, JSON.stringify({ inviteTokenHash: "stale-token", _inviteClaimId: "stale-claim" })],
  );
  const reactivated = await s.addTeamMember({
    teamId: team.id,
    userId: user.id,
    actorUserId: companyOwnerUser.id,
    role: "admin",
  });
  assert.equal(reactivated.id, added.id);
  assert.equal(reactivated.status, "active");
  assert.equal(reactivated.role, "admin");
  assert.deepEqual(reactivated.metadata, {});

  const events = await s.listCompanyAuditEvents({
    teamId: team.id,
    targetType: "membership",
    targetId: added.id,
  });
  assert.deepEqual(
    new Set(events.map((event) => event.action)),
    new Set(["team_member.added", "team_member.reactivated"]),
  );
  assert.equal(events[0].metadata.previousStatus, "suspended");
});

test("existing Team member addition rejects invited, disabled, protected, and archived targets", async () => {
  const team = await freshTeam();
  const invited = await s.upsertUser({ email: `existing-invited-${team.slug}@example.com` });
  await s.upsertMembership({ teamId: team.id, userId: invited.id, role: "member", status: "invited" });
  await assert.rejects(
    s.addTeamMember({
      teamId: team.id,
      userId: invited.id,
      actorUserId: companyOwnerUser.id,
      role: "member",
    }),
    /active or invited membership/,
  );

  const disabled = await s.upsertUser({
    email: `existing-disabled-${team.slug}@example.com`,
    status: "disabled",
  });
  await assert.rejects(
    s.addTeamMember({
      teamId: team.id,
      userId: disabled.id,
      actorUserId: companyOwnerUser.id,
      role: "member",
    }),
    /active user/,
  );

  await assert.rejects(
    s.addTeamMember({
      teamId: team.id,
      userId: companyOwnerUser.id,
      actorUserId: companyOwnerUser.id,
      role: "admin",
    }),
    /Company-protected access/,
  );

  await s.archiveTeam({ teamId: team.id, actorUserId: companyOwnerUser.id });
  const archivedTarget = await s.upsertUser({ email: `archived-target-${team.slug}@example.com` });
  await assert.rejects(
    s.addTeamMember({
      teamId: team.id,
      userId: archivedTarget.id,
      actorUserId: companyOwnerUser.id,
      role: "member",
    }),
    /active Team is required/,
  );
  await assert.rejects(s.setRole(team.id, invited.id, "admin"), /active Team is required/);
  await assert.rejects(s.setMembershipStatus(team.id, invited.id, "active"), /active Team is required/);
});

test("Team Owner mutations are blocked while a Team is archived", async () => {
  const team = await freshTeam();
  const first = await s.upsertUser({ email: `archived-owner-first-${team.slug}@example.com` });
  const second = await s.upsertUser({ email: `archived-owner-second-${team.slug}@example.com` });
  await s.addTeamOwner({ teamId: team.id, userId: first.id, actorUserId: companyOwnerUser.id });
  await s.addTeamOwner({ teamId: team.id, userId: second.id, actorUserId: companyOwnerUser.id });
  await s.archiveTeam({ teamId: team.id, actorUserId: companyOwnerUser.id });

  const third = await s.upsertUser({ email: `archived-owner-third-${team.slug}@example.com` });
  await assert.rejects(
    s.addTeamOwner({ teamId: team.id, userId: third.id, actorUserId: companyOwnerUser.id }),
    /active Team is required/,
  );
  await assert.rejects(
    s.removeTeamOwner({
      teamId: team.id,
      userId: second.id,
      actorUserId: companyOwnerUser.id,
      replacementRole: "member",
    }),
    /active Team is required/,
  );
  assert.equal((await s.getMembership(team.id, second.id)).role, "owner");
});

test("stores encrypted private user config files per user", async () => {
  const team = await freshTeam();
  const user = await s.upsertUser({ email: `config-${team.slug}@example.com` });
  const other = await s.upsertUser({ email: `config-other-${team.slug}@example.com` });

  const first = await s.upsertUserConfigFile({
    teamId: team.id,
    userId: user.id,
    path: ".mcp.json",
    encryptedValue: "cipher-1",
    encryptionKeyId: "v1",
    nonce: "nonce-1",
    authTag: "tag-1",
    valueSha256: "sha-1",
    actorUserId: user.id,
  });
  assert.equal(first.path, ".mcp.json");
  assert.equal(first.valueSha256, "sha-1");

  const updated = await s.upsertUserConfigFile({
    teamId: team.id,
    userId: user.id,
    path: ".mcp.json",
    encryptedValue: "cipher-2",
    encryptionKeyId: "v1",
    nonce: "nonce-2",
    authTag: "tag-2",
    valueSha256: "sha-2",
    actorUserId: user.id,
  });
  assert.equal(updated.id, first.id);
  assert.equal(updated.encryptedValue, "cipher-2");

  await s.upsertUserConfigFile({
    teamId: team.id,
    userId: other.id,
    path: ".mcp.json",
    encryptedValue: "cipher-other",
    encryptionKeyId: "v1",
    nonce: "nonce-other",
    authTag: "tag-other",
    valueSha256: "sha-other",
    actorUserId: other.id,
  });

  assert.equal((await s.getUserConfigFile(team.id, user.id, ".mcp.json"))?.valueSha256, "sha-2");
  assert.equal((await s.getUserConfigFile(team.id, other.id, ".mcp.json"))?.valueSha256, "sha-other");
});

// ---------------------------------------------------------------------------
// Users — upsert is idempotent on a case-insensitive email.
// ---------------------------------------------------------------------------

test("upsertUser is idempotent on case-insensitive email", async () => {
  const legacyCredential = { algo: "scrypt-sha256", salt: "legacy-salt", hash: "legacy-hash" };
  const a = await s.upsertUser({
    email: "Casey@Example.com",
    displayName: "Casey",
    metadata: { teamOsPassword: legacyCredential },
  });
  const b = await s.upsertUser({ email: "casey@example.com" });
  assert.equal(a.id, b.id, "same user row regardless of email case");
  assert.equal(b.displayName, "Casey", "existing display name preserved when omitted");
  assert.deepEqual(b.metadata.teamOsPassword, legacyCredential, "metadata is preserved when omitted");

  const found = await s.getUserByEmail("CASEY@EXAMPLE.COM");
  assert.equal(found?.id, a.id);
});

// ---------------------------------------------------------------------------
// The model can represent team membership.
// ---------------------------------------------------------------------------

test("represents team membership with a role", async () => {
  const team = await freshTeam();
  const user = await s.upsertUser({ email: `m-${team.slug}@example.com` });

  const m = await s.upsertMembership({
    teamId: team.id,
    userId: user.id,
    role: "admin",
  });
  assert.equal(m.role, "admin");
  assert.equal(m.status, "active");

  assert.equal(await s.isActiveMember(team.id, user.id), true);

  const listed = await s.listMemberships(team.id);
  assert.equal(listed.length, 1);

  // Suspending a membership withdraws active access without deleting the row.
  await s.setMembershipStatus(team.id, user.id, "suspended");
  assert.equal(await s.isActiveMember(team.id, user.id), false);
  assert.equal((await s.getMembership(team.id, user.id))?.status, "suspended");
});

// ---------------------------------------------------------------------------
// The model can represent client-level access; resolve a slug to a client.
// ---------------------------------------------------------------------------

test("createClient normalizes the slug and never replaces an existing client", async () => {
  const team = await freshTeam();
  const created = await s.createClient({
    teamId: team.id,
    slug: "  Acme.Client  ",
    name: "Original client",
    metadata: { source: "first" },
  });
  assert.equal(created?.slug, "acme.client");

  const duplicate = await s.createClient({
    teamId: team.id,
    slug: "ACME.CLIENT",
    name: "Replacement client",
    metadata: { source: "second" },
  });
  assert.equal(duplicate, null);

  const persisted = await s.getClientBySlug(team.id, "acme.client");
  assert.equal(persisted?.id, created?.id);
  assert.equal(persisted?.name, "Original client");
  assert.deepEqual(persisted?.metadata, { source: "first" });
  assert.equal((await s.listClients(team.id)).length, 1);
});

test("createClient does not duplicate a mixed-case slug written by an older release", async () => {
  const team = await freshTeam();
  const legacy = await s.upsertClient({
    teamId: team.id,
    slug: "Acme.Client",
    name: "Legacy client",
    metadata: { source: "legacy" },
  });

  const duplicate = await s.createClient({
    teamId: team.id,
    slug: "acme.client",
    name: "Replacement client",
    metadata: { source: "new" },
  });

  assert.equal(duplicate, null);
  const clients = await s.listClients(team.id);
  assert.equal(clients.length, 1);
  assert.equal(clients[0].id, legacy.id);
  assert.equal(clients[0].slug, "Acme.Client");
  assert.equal(clients[0].name, "Legacy client");
  assert.deepEqual(clients[0].metadata, { source: "legacy" });
});

test("createClient rejects the reserved root slug", async () => {
  const team = await freshTeam();
  await assert.rejects(
    s.createClient({ teamId: team.id, slug: " ROOT ", name: "Reserved" }),
    /reserved/i,
  );
  assert.equal((await s.listClients(team.id)).length, 0);
});

test("createClient rejects slugs that cannot be used as cross-platform client folders", async () => {
  const team = await freshTeam();
  for (const slug of ["con", "aux.txt", "client.", "a".repeat(61)]) {
    await assert.rejects(
      s.createClient({ teamId: team.id, slug, name: "Unsafe" }),
      /Windows|dot|characters or fewer/i,
    );
  }
  assert.equal((await s.listClients(team.id)).length, 0);
});

test("createClient admits only one concurrent insert for the same slug", async () => {
  const team = await freshTeam();
  const results = await Promise.all([
    s.createClient({ teamId: team.id, slug: "acme", name: "First contender" }),
    s.createClient({ teamId: team.id, slug: "ACME", name: "Second contender" }),
  ]);

  assert.equal(results.filter(Boolean).length, 1);
  const clients = await s.listClients(team.id);
  assert.equal(clients.length, 1);
  assert.equal(clients[0].slug, "acme");
  assert.ok(["First contender", "Second contender"].includes(clients[0].name));
});

test("represents client-level read/write access", async () => {
  const team = await freshTeam();
  const user = await s.upsertUser({ email: `g-${team.slug}@example.com` });
  const client = await s.upsertClient({ teamId: team.id, slug: "acme", name: "Acme" });

  // The slug → client resolve chain the enforcement layer relies on.
  const bySlug = await s.getClientBySlug(team.id, "acme");
  assert.equal(bySlug?.id, client.id);

  const grant = await s.grantClientAccess({
    teamId: team.id,
    clientId: client.id,
    userId: user.id,
    access: "read",
    grantedBy: user.id,
  });
  assert.equal(grant.access, "read");
  assert.equal(grant.status, "active");

  const active = await s.getActiveGrant(team.id, client.id, user.id);
  assert.equal(active?.id, grant.id);
  assert.equal(active?.access, "read");
});

// ---------------------------------------------------------------------------
// Revoked grants can be checked without deleting history.
// ---------------------------------------------------------------------------

test("revoke flips status without deleting history; re-grant supersedes", async () => {
  const team = await freshTeam();
  const user = await s.upsertUser({ email: `r-${team.slug}@example.com` });
  const client = await s.upsertClient({ teamId: team.id, slug: "beta", name: "Beta" });

  await s.grantClientAccess({ teamId: team.id, clientId: client.id, userId: user.id, access: "read" });

  const revoked = await s.revokeClientAccess({
    teamId: team.id,
    clientId: client.id,
    userId: user.id,
    revokedBy: user.id,
  });
  assert.equal(revoked?.status, "revoked");
  assert.notEqual(revoked?.revokedAt, null);

  // No active grant now …
  assert.equal(await s.getActiveGrant(team.id, client.id, user.id), null);
  // … but the revoked row is still on record (history preserved).
  let history = await s.listGrants({ teamId: team.id, clientId: client.id, userId: user.id });
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "revoked");

  // Re-granting after a revoke works and keeps the old row as history.
  const regranted = await s.grantClientAccess({
    teamId: team.id,
    clientId: client.id,
    userId: user.id,
    access: "write",
  });
  assert.equal(regranted.access, "write");
  assert.equal((await s.getActiveGrant(team.id, client.id, user.id))?.access, "write");

  history = await s.listGrants({ teamId: team.id, clientId: client.id, userId: user.id });
  assert.equal(history.length, 2, "revoked + active rows both retained");
  assert.equal(history.filter((g) => g.status === "active").length, 1);
});

test("at most one active grant per (team, client, user)", async () => {
  const team = await freshTeam();
  const user = await s.upsertUser({ email: `u-${team.slug}@example.com` });
  const client = await s.upsertClient({ teamId: team.id, slug: "gamma", name: "Gamma" });

  await s.grantClientAccess({ teamId: team.id, clientId: client.id, userId: user.id, access: "read" });

  // A second raw active grant for the same triple must violate the partial unique index.
  await assert.rejects(
    s.client.query(
      `INSERT INTO client_grants (team_id, client_id, user_id, access, status)
       VALUES ($1, $2, $3, 'write', 'active')`,
      [team.id, client.id, user.id],
    ),
  );
});

test("skill grants preserve history and write audit events", async () => {
  const team = await freshTeam();
  const admin = await s.upsertUser({ email: `skill-admin-${team.slug}@example.com` });
  const user = await s.upsertUser({ email: `skill-user-${team.slug}@example.com` });

  const grant = await s.grantSkillAccess({
    teamId: team.id,
    skillName: "mkt-copywriting",
    userId: user.id,
    permission: "skill.read",
    grantedBy: admin.id,
  });
  assert.equal(grant.status, "active");
  assert.equal(grant.permission, "skill.read");

  const active = await s.listActiveSkillGrants(team.id, "mkt-copywriting", user.id);
  assert.equal(active.length, 1);
  assert.equal(active[0].id, grant.id);

  const revoked = await s.revokeSkillAccess({
    teamId: team.id,
    skillName: "mkt-copywriting",
    userId: user.id,
    permission: "skill.read",
    revokedBy: admin.id,
  });
  assert.equal(revoked.length, 1);
  assert.equal(revoked[0].status, "revoked");

  assert.equal((await s.listActiveSkillGrants(team.id, "mkt-copywriting", user.id)).length, 0);
  const history = await s.listSkillGrants({
    teamId: team.id,
    skillName: "mkt-copywriting",
    userId: user.id,
  });
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "revoked");

  const events = await s.listAuditEvents({ teamId: team.id });
  const actions = events.map((e) => e.action);
  assert.ok(actions.includes("skill.granted"));
  assert.ok(actions.includes("skill.revoked"));
});

// ---------------------------------------------------------------------------
// Sensitive actions can be recorded in audit events, queryable by team + target.
// ---------------------------------------------------------------------------

test("grant/revoke write audit events queryable by team and target", async () => {
  const team = await freshTeam();
  const admin = await s.upsertUser({ email: `admin-${team.slug}@example.com` });
  const member = await s.upsertUser({ email: `member-${team.slug}@example.com` });
  const client = await s.upsertClient({ teamId: team.id, slug: "delta", name: "Delta" });

  const grant = await s.grantClientAccess({
    teamId: team.id,
    clientId: client.id,
    userId: member.id,
    access: "read",
    grantedBy: admin.id,
  });
  await s.revokeClientAccess({
    teamId: team.id,
    clientId: client.id,
    userId: member.id,
    revokedBy: admin.id,
  });

  const byTeam = await s.listAuditEvents({ teamId: team.id });
  const actions = byTeam.map((e) => e.action);
  assert.ok(actions.includes("grant.granted"));
  assert.ok(actions.includes("grant.revoked"));
  assert.equal(byTeam[0].actorUserId, admin.id, "newest-first ordering");

  // Narrowed to a single target (the grant row).
  const byTarget = await s.listAuditEvents({
    teamId: team.id,
    targetType: "grant",
    targetId: grant.id,
  });
  assert.equal(byTarget.length, 2, "both grant + revoke target the same grant id");
});

test("recordAuditEvent stores a standalone sensitive action", async () => {
  const team = await freshTeam();
  const admin = await s.upsertUser({ email: `inv-admin-${team.slug}@example.com` });
  const invited = await s.upsertUser({ email: `invited-${team.slug}@example.com` });
  const membership = await s.upsertMembership({
    teamId: team.id,
    userId: invited.id,
    status: "invited",
    invitedBy: admin.id,
  });

  const event = await s.recordAuditEvent({
    teamId: team.id,
    actorUserId: admin.id,
    action: "membership.invited",
    targetType: "membership",
    targetId: membership.id,
    summary: "invited a member",
  });
  assert.equal(event.action, "membership.invited");

  const found = await s.listAuditEvents({
    teamId: team.id,
    targetType: "membership",
    targetId: membership.id,
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].id, event.id);
});

// ---------------------------------------------------------------------------
// Atomicity: a failed grant rolls back, leaving the prior active grant intact.
// ---------------------------------------------------------------------------

test("a failed grant rolls back and preserves the prior active grant", async () => {
  const team = await freshTeam();
  const user = await s.upsertUser({ email: `tx-${team.slug}@example.com` });
  const client = await s.upsertClient({ teamId: team.id, slug: "epsilon", name: "Epsilon" });

  const original = await s.grantClientAccess({
    teamId: team.id,
    clientId: client.id,
    userId: user.id,
    access: "read",
  });

  // An invalid access value trips the CHECK constraint on INSERT — after the
  // transaction has already revoked the prior active grant. The rollback must
  // restore it.
  await assert.rejects(
    s.grantClientAccess({
      teamId: team.id,
      clientId: client.id,
      userId: user.id,
      access: "owner", // not in ('read','write')
    }),
  );

  const active = await s.getActiveGrant(team.id, client.id, user.id);
  assert.equal(active?.id, original.id, "prior grant restored by rollback");
  assert.equal(active?.access, "read");
  const history = await s.listGrants({ teamId: team.id, clientId: client.id, userId: user.id });
  assert.equal(history.length, 1, "no orphan row from the failed insert");
});

// ---------------------------------------------------------------------------
// Workstations — minimal model: register, supersede a fingerprint, revoke.
// ---------------------------------------------------------------------------

test("workstations register, supersede a fingerprint, and revoke", async () => {
  const team = await freshTeam();
  const user = await s.upsertUser({ email: `w-${team.slug}@example.com` });

  const w1 = await s.registerWorkstation({
    teamId: team.id,
    userId: user.id,
    name: "Laptop",
    fingerprint: "fp-1",
  });
  assert.equal(w1.status, "active");

  // Re-registering the same fingerprint supersedes the old active registration.
  const w2 = await s.registerWorkstation({
    teamId: team.id,
    userId: user.id,
    name: "Laptop (reinstalled)",
    fingerprint: "fp-1",
  });
  assert.notEqual(w2.id, w1.id);

  const all = await s.listWorkstations(team.id, user.id);
  assert.equal(all.length, 2);
  assert.equal(all.filter((w) => w.status === "active").length, 1);

  const revoked = await s.revokeWorkstation(w2.id);
  assert.equal(revoked?.status, "revoked");
  assert.notEqual(revoked?.revokedAt, null);
});

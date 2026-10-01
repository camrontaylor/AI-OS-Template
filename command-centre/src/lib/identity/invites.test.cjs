const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, after } = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");

// Leaf-first loading (see store.test.cjs). invites.ts value-imports ./permissions,
// so that module is loaded first and injected as a stub; everything else it needs
// from ./store and ./types is `import type` (erased) or a node builtin.
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
const permissions = loadTsModule(ID("permissions.ts"));
const invites = loadTsModule(ID("invites.ts"), {
  stubs: { "./permissions": permissions },
});

const EMBED_DIM = 8;

/** @type {import("./store").IdentityStore} */
let s;
let seq = 0;

/** A fresh team with one active admin who can issue invites. */
async function freshTeamWithAdmin() {
  seq += 1;
  const team = await s.createTeam({ slug: `inv-${seq}`, name: `Team ${seq}` });
  const admin = await s.upsertUser({ email: `admin-${seq}@example.com`, displayName: "Admin" });
  await s.upsertMembership({ teamId: team.id, userId: admin.id, role: "admin", status: "active" });
  return { team, admin };
}

async function acceptWithTestCredential(input) {
  let credentialCreatedFor = null;
  const membership = await invites.acceptInviteWithCredential(s, input, async (user) => {
    credentialCreatedFor = user.id;
  });
  assert.equal(credentialCreatedFor, membership.userId);
  return membership;
}

before(async () => {
  s = await store.openIdentityStore({ backend: "pglite", embedDim: EMBED_DIM });
});

after(async () => {
  await s.close();
});

test("admin invites a member; stores only a token hash and audits the invite", async () => {
  const { team, admin } = await freshTeamWithAdmin();

  const res = await invites.inviteMember(s, {
    teamId: team.id,
    actorUserId: admin.id,
    email: "dev@example.com",
  });
  assert.equal(res.membership.status, "invited");
  assert.equal(res.membership.role, "member");
  assert.ok(res.token.length > 20, "a raw token is returned");

  // The raw token is never persisted — only its hash plus an expiry.
  const stored = await s.getMembership(team.id, res.user.id);
  assert.equal(typeof stored?.metadata.inviteTokenHash, "string");
  assert.notEqual(stored?.metadata.inviteTokenHash, res.token, "raw token never stored");
  assert.equal(typeof stored?.metadata.inviteExpiresAt, "string");

  const audit = await s.listAuditEvents({
    teamId: team.id,
    targetType: "membership",
    targetId: res.membership.id,
  });
  assert.ok(audit.some((e) => e.action === "membership.invited"));
});

test("Company Admin with Full access can invite without a Team membership", async () => {
  const team = await s.createTeam({ slug: `inv-company-${++seq}`, name: "Company Access" });
  const admin = await s.upsertUser({ email: `company-inviter-${seq}@example.com` });
  await s.upsertCompanyMembership({ userId: admin.id, role: "admin", status: "active" });
  await s.grantCompanyTeamAccess({ teamId: team.id, userId: admin.id });

  const result = await invites.inviteMember(s, {
    teamId: team.id,
    actorUserId: admin.id,
    email: `company-invitee-${seq}@example.com`,
  });
  assert.equal(result.membership.status, "invited");
  assert.equal(result.membership.role, "member");
});

test("Company authority and a Team Owner anywhere cannot receive a normal Team invitation", async () => {
  const { team, admin } = await freshTeamWithAdmin();
  const companyOwner = await s.upsertUser({ email: `protected-owner-${seq}@example.com` });
  await s.recoverCompanyOwner({ userId: companyOwner.id });
  const companyAdmin = await s.upsertUser({ email: `protected-company-admin-${seq}@example.com` });
  await s.upsertCompanyMembership({ userId: companyAdmin.id, role: "admin", status: "active" });
  await s.grantCompanyTeamAccess({ teamId: team.id, userId: companyAdmin.id });

  for (const user of [companyOwner, companyAdmin]) {
    await assert.rejects(
      invites.inviteMember(s, {
        teamId: team.id,
        actorUserId: admin.id,
        email: user.email,
      }),
      (err) => err instanceof invites.InvalidInviteError,
    );
    assert.equal(await s.getMembership(team.id, user.id), null);
  }

  const otherTeam = await s.createTeam({ slug: `protected-other-${seq}`, name: "Protected Other" });
  const crossTeamOwner = await s.upsertUser({ email: `protected-cross-owner-${seq}@example.com` });
  await s.upsertMembership({
    teamId: otherTeam.id,
    userId: crossTeamOwner.id,
    role: "owner",
    status: "active",
  });
  await assert.rejects(
    invites.inviteMember(s, {
      teamId: team.id,
      actorUserId: admin.id,
      email: crossTeamOwner.email,
    }),
    (err) => err instanceof invites.InvalidInviteError,
  );
  assert.equal(await s.getMembership(team.id, crossTeamOwner.id), null);

  const denied = await s.listAuditEvents({ teamId: team.id, targetType: "team", targetId: team.id });
  assert.equal(
    denied.filter((event) => event.metadata.reason === "protected_credential_authority").length,
    3,
  );
});

test("a pending Team invite cannot be accepted after Company authority is granted", async () => {
  const { team, admin } = await freshTeamWithAdmin();
  const invited = await invites.inviteMember(s, {
    teamId: team.id,
    actorUserId: admin.id,
    email: `protected-after-invite-${seq}@example.com`,
  });
  await s.upsertCompanyMembership({ userId: invited.user.id, role: "admin", status: "active" });

  await assert.rejects(
    acceptWithTestCredential({
      teamId: team.id,
      email: invited.user.email,
      token: invited.token,
    }),
    (err) => err instanceof invites.InvalidInviteError,
  );
  assert.equal((await s.getMembership(team.id, invited.user.id)).status, "invited");
});

test("a plain member cannot invite, and no invitee is created", async () => {
  const { team } = await freshTeamWithAdmin();
  const member = await s.upsertUser({ email: `plain-${seq}@example.com` });
  await s.upsertMembership({ teamId: team.id, userId: member.id, role: "member", status: "active" });

  await assert.rejects(
    invites.inviteMember(s, { teamId: team.id, actorUserId: member.id, email: "ghost@example.com" }),
    (err) => err instanceof permissions.PermissionError,
  );

  // The role gate runs before any user is created.
  assert.equal(await s.getUserByEmail("ghost@example.com"), null);
  const denied = await s.listAuditEvents({
    teamId: team.id,
    targetType: "team",
    targetId: team.id,
  });
  assert.ok(denied.some((e) => e.action === "membership.invite_denied"));
  assert.ok(denied.some((e) => e.metadata.reason === "insufficient_role"));
});

test("owner is not an invitable role", async () => {
  const { team, admin } = await freshTeamWithAdmin();
  await assert.rejects(
    invites.inviteMember(s, {
      teamId: team.id,
      actorUserId: admin.id,
      email: "noown@example.com",
      role: "owner",
    }),
    (err) => err instanceof permissions.PermissionError,
  );
  const denied = await s.listAuditEvents({
    teamId: team.id,
    targetType: "team",
    targetId: team.id,
  });
  assert.ok(denied.some((e) => e.action === "membership.invite_denied"));
  assert.ok(denied.some((e) => e.metadata.reason === "invalid_role"));
});

test("invited member joins with the correct token; the token is single-use", async () => {
  const { team, admin } = await freshTeamWithAdmin();
  const { token, user } = await invites.inviteMember(s, {
    teamId: team.id,
    actorUserId: admin.id,
    email: "join@example.com",
    role: "member",
  });

  const joined = await acceptWithTestCredential({ teamId: team.id, email: "join@example.com", token });
  assert.equal(joined.status, "active");
  assert.equal(await s.isActiveMember(team.id, user.id), true);

  // Token cleared on join.
  const after = await s.getMembership(team.id, user.id);
  assert.equal(after?.metadata.inviteTokenHash, undefined, "token consumed on join");

  const audit = await s.listAuditEvents({
    teamId: team.id,
    targetType: "membership",
    targetId: joined.id,
  });
  assert.ok(audit.some((e) => e.action === "membership.joined"));

  // Single use: the same token cannot be redeemed again.
  await assert.rejects(
    acceptWithTestCredential({ teamId: team.id, email: "join@example.com", token }),
    (err) => err instanceof invites.InvalidInviteError,
  );
});

test("a wrong token is rejected and the invite stays pending", async () => {
  const { team, admin } = await freshTeamWithAdmin();
  const { user } = await invites.inviteMember(s, {
    teamId: team.id,
    actorUserId: admin.id,
    email: "wrong@example.com",
  });

  await assert.rejects(
    acceptWithTestCredential({ teamId: team.id, email: "wrong@example.com", token: "not-the-token" }),
    (err) => err instanceof invites.InvalidInviteError,
  );
  assert.equal((await s.getMembership(team.id, user.id))?.status, "invited");
  const denied = await s.listAuditEvents({
    teamId: team.id,
    targetType: "team",
    targetId: team.id,
  });
  assert.ok(denied.some((e) => e.action === "membership.join_denied"));
  assert.ok(denied.some((e) => e.metadata.reason === "token_mismatch"));
});

test("an expired invite does not grant access", async () => {
  const { team, admin } = await freshTeamWithAdmin();
  const past = new Date("2020-01-01T00:00:00.000Z");
  const { token, user } = await invites.inviteMember(s, {
    teamId: team.id,
    actorUserId: admin.id,
    email: "expired@example.com",
    expiresInDays: 1,
    now: past,
  });

  await assert.rejects(
    acceptWithTestCredential({
      teamId: team.id,
      email: "expired@example.com",
      token,
      now: new Date("2020-02-01T00:00:00.000Z"),
    }),
    (err) => err instanceof invites.InvalidInviteError,
  );
  assert.equal(await s.isActiveMember(team.id, user.id), false);
  const denied = await s.listAuditEvents({
    teamId: team.id,
    targetType: "team",
    targetId: team.id,
  });
  assert.ok(denied.some((e) => e.action === "membership.join_denied"));
  assert.ok(denied.some((e) => e.metadata.reason === "expired"));
});

test("cannot invite someone who is already an active member", async () => {
  const { team, admin } = await freshTeamWithAdmin();
  const { token } = await invites.inviteMember(s, {
    teamId: team.id,
    actorUserId: admin.id,
    email: "dup@example.com",
  });
  await acceptWithTestCredential({ teamId: team.id, email: "dup@example.com", token });

  await assert.rejects(
    invites.inviteMember(s, { teamId: team.id, actorUserId: admin.id, email: "dup@example.com" }),
    (err) => err instanceof invites.InvalidInviteError,
  );
  const denied = await s.listAuditEvents({
    teamId: team.id,
    targetType: "team",
    targetId: team.id,
  });
  assert.ok(denied.some((e) => e.metadata.reason === "already_active_member"));
});

test("a rejected invite preserves an existing legacy credential metadata record", async () => {
  const { team, admin } = await freshTeamWithAdmin();
  const legacyCredential = { algo: "scrypt-sha256", salt: "invite-salt", hash: "invite-hash" };
  const user = await s.upsertUser({
    email: `legacy-preserved-${seq}@example.com`,
    metadata: { teamOsPassword: legacyCredential, note: "keep" },
  });
  await s.upsertMembership({ teamId: team.id, userId: user.id, role: "member", status: "active" });

  await assert.rejects(
    invites.inviteMember(s, { teamId: team.id, actorUserId: admin.id, email: user.email }),
    (error) => error instanceof invites.InvalidInviteError,
  );
  const after = await s.getUserById(user.id);
  assert.deepEqual(after.metadata.teamOsPassword, legacyCredential);
  assert.equal(after.metadata.note, "keep");
});

test("the same user can be invited to multiple teams independently", async () => {
  const a = await freshTeamWithAdmin();
  const b = await freshTeamWithAdmin();
  const email = `multi-${seq}@example.com`;

  const r1 = await invites.inviteMember(s, {
    teamId: a.team.id,
    actorUserId: a.admin.id,
    email,
    role: "member",
  });
  const r2 = await invites.inviteMember(s, {
    teamId: b.team.id,
    actorUserId: b.admin.id,
    email,
    role: "admin",
  });
  assert.equal(r1.user.id, r2.user.id, "one global user identity across teams");

  await acceptWithTestCredential({ teamId: a.team.id, email, token: r1.token });

  // Active in team A, still only invited in team B — memberships are independent.
  assert.equal(await s.isActiveMember(a.team.id, r1.user.id), true);
  assert.equal(await s.isActiveMember(b.team.id, r1.user.id), false);
  const mB = await s.getMembership(b.team.id, r1.user.id);
  assert.equal(mB?.status, "invited");
  assert.equal(mB?.role, "admin", "role differs per team");
});

test("joining with no pending invite is rejected", async () => {
  const { team, admin } = await freshTeamWithAdmin();

  // (a) An email that was never invited — there is no user and no membership.
  await assert.rejects(
    acceptWithTestCredential({ teamId: team.id, email: "nobody@example.com", token: "whatever" }),
    (err) => err instanceof invites.InvalidInviteError,
  );

  // (b) A user who already exists and is active (not `invited`) cannot "join".
  await assert.rejects(
    acceptWithTestCredential({ teamId: team.id, email: admin.email, token: "whatever" }),
    (err) => err instanceof invites.InvalidInviteError,
  );
});

test("an invite issued as admin joins as an active admin", async () => {
  const { team, admin } = await freshTeamWithAdmin();
  const { token, user } = await invites.inviteMember(s, {
    teamId: team.id,
    actorUserId: admin.id,
    email: "newadmin@example.com",
    role: "admin",
  });

  const joined = await acceptWithTestCredential({ teamId: team.id, email: "newadmin@example.com", token });
  assert.equal(joined.status, "active");
  assert.equal(joined.role, "admin", "the granted role carries through to the active membership");
  assert.equal(await s.isActiveMember(team.id, user.id), true);
});

test("re-inviting a still-pending member replaces the token", async () => {
  const { team, admin } = await freshTeamWithAdmin();
  const first = await invites.inviteMember(s, {
    teamId: team.id,
    actorUserId: admin.id,
    email: "repeat@example.com",
  });
  const second = await invites.inviteMember(s, {
    teamId: team.id,
    actorUserId: admin.id,
    email: "repeat@example.com",
  });
  assert.equal(first.user.id, second.user.id, "same invitee");
  assert.notEqual(first.token, second.token, "a fresh token is issued");

  // The superseded token no longer works …
  await assert.rejects(
    acceptWithTestCredential({ teamId: team.id, email: "repeat@example.com", token: first.token }),
    (err) => err instanceof invites.InvalidInviteError,
  );

  // … but the latest one does.
  const joined = await acceptWithTestCredential({ teamId: team.id, email: "repeat@example.com", token: second.token });
  assert.equal(joined.status, "active");
});

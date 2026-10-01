const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, after } = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");

// Same leaf-first loading the store test uses: load each sibling module and inject
// it as a stub into the modules that value-import it. permissions.ts imports the
// store/types as `import type` only (erased), so it loads stub-free.
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

const EMBED_DIM = 8;

/** @type {import("./store").IdentityStore} */
let s;
let seq = 0;
let companyOwnerPromise;

function companyOwner() {
  if (!companyOwnerPromise) {
    companyOwnerPromise = (async () => {
      seq += 1;
      const user = await s.upsertUser({ email: `company-owner-${seq}@example.com` });
      const membership = await s.recoverCompanyOwner({ userId: user.id });
      return { user, membership };
    })();
  }
  return companyOwnerPromise;
}

/** A fresh team plus one member at the given role/status, for isolated checks. */
async function teamWith(role, status = "active") {
  seq += 1;
  const team = await s.createTeam({ slug: `perm-${seq}`, name: `Perm ${seq}` });
  const user = await s.upsertUser({ email: `perm-${seq}@example.com` });
  await s.upsertMembership({ teamId: team.id, userId: user.id, role, status });
  return { team, user };
}

before(async () => {
  s = await store.openIdentityStore({ backend: "pglite", embedDim: EMBED_DIM });
});

after(async () => {
  await s.close();
});

test("requireTeamRole passes when the active role meets the minimum", async () => {
  const { team, user } = await teamWith("admin");
  const m = await permissions.requireTeamRole(s, team.id, user.id, "admin");
  assert.equal(m.role, "admin");

  // owner outranks admin.
  const owner = await teamWith("owner");
  const om = await permissions.requireTeamRole(s, owner.team.id, owner.user.id, "admin");
  assert.equal(om.role, "owner");
});

test("requireTeamRole rejects an insufficient role", async () => {
  const { team, user } = await teamWith("member");
  await assert.rejects(
    permissions.requireTeamRole(s, team.id, user.id, "admin"),
    (err) => err instanceof permissions.PermissionError,
  );
});

test("requireTeamRole rejects a non-active membership", async () => {
  const invited = await teamWith("admin", "invited");
  await assert.rejects(
    permissions.requireTeamRole(s, invited.team.id, invited.user.id, "admin"),
    (err) => err instanceof permissions.PermissionError,
  );

  const suspended = await teamWith("owner", "suspended");
  await assert.rejects(
    permissions.requireTeamRole(s, suspended.team.id, suspended.user.id, "member"),
    (err) => err instanceof permissions.PermissionError,
  );
});

test("requireTeamRole rejects a non-member", async () => {
  seq += 1;
  const team = await s.createTeam({ slug: `perm-none-${seq}`, name: "No Members" });
  const stranger = await s.upsertUser({ email: `stranger-${seq}@example.com` });
  await assert.rejects(
    permissions.requireTeamRole(s, team.id, stranger.id, "member"),
    (err) => err instanceof permissions.PermissionError,
  );
});

test("resolvePrincipal returns the active membership for backend-trusted identity", async () => {
  const { team, user } = await teamWith("member");
  const principal = await permissions.resolvePrincipal(s, {
    teamId: team.id,
    userId: user.id,
    authSource: "test",
  });
  assert.equal(principal.teamId, team.id);
  assert.equal(principal.userId, user.id);
  assert.equal(principal.membership.role, "member");
  assert.equal(principal.authSource, "test");
});

test("EffectiveTeamAccess applies Company and Team precedence", async () => {
  const owner = await companyOwner();
  const ownerTeam = await s.createTeam({ slug: `company-owner-${++seq}`, name: "Owner Team" });
  const ownerAccess = await permissions.resolveEffectiveTeamAccess(s, ownerTeam.id, owner.user.id);
  assert.deepEqual(
    {
      source: ownerAccess.source,
      role: ownerAccess.effectiveRole,
      fullAccess: ownerAccess.fullAccess,
      protected: ownerAccess.protected,
      membership: ownerAccess.membership,
    },
    {
      source: "company_owner",
      role: "owner",
      fullAccess: true,
      protected: true,
      membership: null,
    },
  );

  const team = await s.createTeam({ slug: `company-admin-${++seq}`, name: "Admin Team" });
  const admin = await s.upsertUser({ email: `company-admin-${seq}@example.com` });
  await s.upsertCompanyMembership({ userId: admin.id, role: "admin", status: "active" });
  await s.upsertMembership({ teamId: team.id, userId: admin.id, role: "member", status: "active" });
  await s.grantCompanyTeamAccess({
    teamId: team.id,
    userId: admin.id,
    grantedBy: owner.user.id,
  });
  const grantedAccess = await permissions.resolveEffectiveTeamAccess(s, team.id, admin.id);
  assert.equal(grantedAccess.source, "company_grant");
  assert.equal(grantedAccess.effectiveRole, "admin");
  assert.equal(grantedAccess.membership.role, "member");
  assert.equal(grantedAccess.fullAccess, true);
  assert.equal(grantedAccess.protected, true);

  await s.client.query(
    `UPDATE memberships SET role = 'admin' WHERE team_id = $1 AND user_id = $2`,
    [team.id, admin.id],
  );
  const directAdminAccess = await permissions.resolveEffectiveTeamAccess(s, team.id, admin.id);
  assert.equal(directAdminAccess.source, "membership");
  assert.equal(directAdminAccess.effectiveRole, "admin");
  assert.equal(directAdminAccess.protected, false);
});

test("archived Teams are blocked at runtime but resolvable for Company management", async () => {
  const owner = await companyOwner();
  const team = await s.createTeam({ slug: `archived-access-${++seq}`, name: "Archived Access" });
  await s.archiveTeam({ teamId: team.id, actorUserId: owner.user.id });

  assert.equal(await permissions.resolveEffectiveTeamAccess(s, team.id, owner.user.id), null);
  const managementAccess = await permissions.resolveEffectiveTeamAccess(
    s,
    team.id,
    owner.user.id,
    { includeArchived: true },
  );
  assert.equal(managementAccess.source, "company_owner");
});

test("Full access bypasses client and skill grants", async () => {
  const owner = await companyOwner();
  const team = await s.createTeam({ slug: `full-access-${++seq}`, name: "Full Access" });
  const principal = await permissions.resolvePrincipal(s, {
    teamId: team.id,
    userId: owner.user.id,
    authSource: "test",
  });
  const client = await s.upsertClient({ teamId: team.id, slug: "protected", name: "Protected" });

  assert.equal(await permissions.requireClientAccess(s, principal, client.id, "write"), null);
  assert.equal(
    await permissions.requireSkillAccess(s, principal, "mkt-copywriting", "skill.admin"),
    null,
  );
});

test("requireClientAccess honors read/write hierarchy and revocation", async () => {
  const { team, user } = await teamWith("member");
  const principal = await permissions.resolvePrincipal(s, {
    teamId: team.id,
    userId: user.id,
    authSource: "test",
  });
  const client = await s.upsertClient({ teamId: team.id, slug: "acme", name: "Acme" });

  await s.grantClientAccess({
    teamId: team.id,
    clientId: client.id,
    userId: user.id,
    access: "read",
  });
  await permissions.requireClientAccess(s, principal, client.id, "read");
  await assert.rejects(
    permissions.requireClientAccess(s, principal, client.id, "write"),
    (err) => err instanceof permissions.PermissionError,
  );

  await s.grantClientAccess({
    teamId: team.id,
    clientId: client.id,
    userId: user.id,
    access: "write",
  });
  await permissions.requireClientAccess(s, principal, client.id, "write");

  await s.revokeClientAccess({ teamId: team.id, clientId: client.id, userId: user.id });
  await assert.rejects(
    permissions.requireClientAccess(s, principal, client.id, "read"),
    (err) => err instanceof permissions.PermissionError,
  );
});

test("requireSkillAccess honors permission hierarchy and revocation", async () => {
  const { team, user } = await teamWith("member");
  const principal = await permissions.resolvePrincipal(s, {
    teamId: team.id,
    userId: user.id,
    authSource: "test",
  });

  await s.grantSkillAccess({
    teamId: team.id,
    skillName: "mkt-copywriting",
    userId: user.id,
    permission: "skill.admin",
  });

  for (const permission of ["skill.use", "skill.read", "skill.edit", "skill.admin"]) {
    const grant = await permissions.requireSkillAccess(
      s,
      principal,
      "mkt-copywriting",
      permission,
    );
    assert.equal(grant.permission, "skill.admin");
  }

  await s.revokeSkillAccess({
    teamId: team.id,
    skillName: "mkt-copywriting",
    userId: user.id,
  });
  await assert.rejects(
    permissions.requireSkillAccess(s, principal, "mkt-copywriting", "skill.use"),
    (err) => err instanceof permissions.PermissionError,
  );
});

test("skill.use permits invocation but not skill editing", async () => {
  const { team, user } = await teamWith("member");
  const principal = await permissions.resolvePrincipal(s, {
    teamId: team.id,
    userId: user.id,
    authSource: "test",
  });

  await s.grantSkillAccess({
    teamId: team.id,
    skillName: "mkt-copywriting",
    userId: user.id,
    permission: "skill.use",
  });

  await permissions.requireSkillAccess(s, principal, "mkt-copywriting", "skill.use");
  await assert.rejects(
    permissions.requireSkillAccess(s, principal, "mkt-copywriting", "skill.edit"),
    (err) => err instanceof permissions.PermissionError,
  );
});

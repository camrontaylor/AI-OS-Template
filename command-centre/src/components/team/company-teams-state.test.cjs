const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../lib/test-utils/load-ts-module.cjs");

const state = loadTsModule(path.resolve(__dirname, "company-teams-state.ts"));

test("company Teams state normalizes access and merges duplicate people", () => {
  const result = state.normalizeCompanyTeamsState({
    companyMembership: { id: "company-1", role: "admin", status: "active" },
    pendingAccessRequestCount: 3,
    existingUsers: [
      { id: "user-2", email: "sam@example.com", displayName: "Sam", status: "active" },
    ],
    teams: [{
      id: "team-1",
      slug: "design",
      name: "Design",
      memberCount: 2,
      access: {
        companyRole: "admin",
        source: "company_grant",
        effectiveRole: "admin",
        fullAccess: true,
        protected: true,
      },
      members: [
        { id: "member-1", userId: "user-1", email: "alex@example.com", displayName: "Alex", role: "member" },
        { id: "grant-1", userId: "user-1", email: "alex@example.com", displayName: "Alex", effectiveRole: "admin", source: "company_grant", protected: true },
      ],
    }],
  });

  assert.equal(result.companyMembership.role, "admin");
  assert.equal(result.pendingAccessRequestCount, 3);
  assert.equal(result.teams[0].access.source, "company_grant");
  assert.equal(result.teams[0].members.length, 1);
  assert.equal(result.teams[0].members[0].protected, true);
  assert.equal(result.teams[0].members[0].accessSource, "company_grant");
  assert.equal(result.existingUsers[0].userId, "user-2");
});

test("company Teams state falls back to eligible owners for existing-user controls", () => {
  const result = state.normalizeCompanyTeamsState({
    eligibleOwners: [{ id: "user-1", email: "owner@example.com", status: "active" }],
  });

  assert.equal(result.existingUsers.length, 1);
  assert.equal(result.existingUsers[0].userId, "user-1");
});

test("company Team filters include owner identity and access state", () => {
  const teams = state.normalizeCompanyTeamsState({
    teams: [
      {
        id: "team-1",
        slug: "alpha",
        name: "Alpha",
        owners: [{ userId: "owner-1", email: "maria@example.com", displayName: "Maria" }],
        access: { source: "company_owner", effectiveRole: "owner", fullAccess: true, protected: true, companyRole: "owner" },
      },
      { id: "team-2", slug: "beta", name: "Beta", archivedAt: "2026-05-01T00:00:00.000Z" },
    ],
  }).teams;

  assert.deepEqual(state.filterCompanyTeams(teams, "maria", "all", "all").map((team) => team.id), ["team-1"]);
  assert.deepEqual(state.filterCompanyTeams(teams, "", "active", "full").map((team) => team.id), ["team-1"]);
  assert.deepEqual(state.filterCompanyTeams(teams, "", "archived", "none").map((team) => team.id), ["team-2"]);
});

test("existing-user search stays closed for an empty query and returns at most eight matches", () => {
  const people = Array.from({ length: 12 }, (_, index) => ({
    id: `person-${index}`,
    userId: `user-${index}`,
    displayName: index === 11 ? "Different Person" : `Alex Person ${index}`,
    email: index === 11 ? "alex-special@example.com" : `person-${index}@example.com`,
    status: "active",
  }));

  assert.deepEqual(state.filterExistingUsers(people, "   "), []);
  assert.equal(state.filterExistingUsers(people, "alex").length, 8);
  assert.deepEqual(
    state.filterExistingUsers(people, "SPECIAL").map((person) => person.userId),
    ["user-11"],
  );
});

test("slug creation and permanent deletion follow the Brief constraints", () => {
  assert.equal(state.slugifyTeamName("  Criação & Estratégia  "), "criacao-estrategia");

  const archived = state.normalizeCompanyTeam({
    id: "team-1",
    name: "Old Team",
    archivedAt: "2026-06-01T00:00:00.000Z",
  });
  assert.equal(state.canPermanentlyDeleteTeam(archived, Date.parse("2026-06-30T23:59:59.000Z")), false);
  assert.equal(state.canPermanentlyDeleteTeam(archived, Date.parse("2026-07-01T00:00:00.000Z")), true);
});

test("access and Company Admin notices distinguish member access and promotion", () => {
  assert.equal(state.accessLabel({
    companyRole: "admin",
    source: "membership",
    effectiveRole: "member",
    fullAccess: false,
    protected: false,
  }), "Member access");
  assert.equal(state.companyAdminMutationNotice({ promoted: true }), "Company Admin added.");
  assert.equal(state.companyAdminMutationNotice({ promoted: false, inviteUrl: "https://example.test/invite" }), "Company Admin invite created.");
});

test("company access keeps resolved request timestamps and direct Team access sources", () => {
  const result = state.normalizeCompanyAccessState({
    requests: [{
      id: "request-1",
      teamId: "team-1",
      status: "approved",
      resolvedAt: "2026-07-14T15:00:00.000Z",
    }],
    adminTeamAccess: [
      { userId: "admin-1", teamId: "team-1", source: "team_admin" },
      { userId: "admin-1", teamId: "team-1", source: "company_grant" },
      { userId: "admin-1", teamId: "team-2", source: "company_grant" },
      { userId: "admin-1", teamId: "team-2", source: "team_owner" },
      { userId: "", teamId: "team-3", source: "team_owner" },
      { userId: "admin-1", teamId: "team-4", source: "unknown" },
    ],
  });

  assert.equal(result.requests[0].resolvedAt, "2026-07-14T15:00:00.000Z");
  assert.deepEqual(result.adminTeamAccess, [
    { userId: "admin-1", teamId: "team-1", source: "team_admin" },
    { userId: "admin-1", teamId: "team-2", source: "team_owner" },
  ]);
});

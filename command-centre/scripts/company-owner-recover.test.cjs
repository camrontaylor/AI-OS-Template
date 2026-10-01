const assert = require("node:assert/strict");
const test = require("node:test");

const recovery = require("./company-owner-recover.cjs");
const teamCreate = require("./team-create.cjs");

test("company owner recovery promotes an active user with a usable account", async () => {
  const user = { id: "user-1", email: "owner@example.com", status: "active" };
  let recoveredUserId = null;
  const result = await recovery.recoverCompanyOwner({
    store: {
      recoverCompanyOwner: async ({ userId }) => {
        recoveredUserId = userId;
        return { id: "company-1", userId, role: "owner", status: "active" };
      },
    },
    teamAuth: { hasUsablePlatformCredential: async () => true },
    userRef: user.email,
    resolveUser: async (_store, ref) => {
      assert.equal(ref, user.email);
      return user;
    },
  });

  assert.equal(recoveredUserId, user.id);
  assert.equal(result.membership.role, "owner");
});

test("company owner recovery rejects a database-only user without a login", async () => {
  const user = { id: "user-1", email: "pending@example.com", status: "active" };
  await assert.rejects(
    recovery.recoverCompanyOwner({
      store: { recoverCompanyOwner: async () => assert.fail("must not promote") },
      teamAuth: { hasUsablePlatformCredential: async () => false },
      userRef: user.email,
      resolveUser: async () => user,
    }),
    /does not have a usable platform account/,
  );
});

test("team creation assigns the first Company Owner only when none exists", async () => {
  const existing = { id: "company-existing", userId: "owner-1", role: "owner", status: "active" };
  let recoverCalls = 0;
  const unchanged = await teamCreate.ensureInitialCompanyOwner({
    listCompanyMemberships: async () => [existing],
    recoverCompanyOwner: async () => {
      recoverCalls += 1;
      return null;
    },
  }, "owner-2");
  assert.equal(unchanged.created, false);
  assert.equal(unchanged.membership, existing);
  assert.equal(recoverCalls, 0);

  const created = await teamCreate.ensureInitialCompanyOwner({
    listCompanyMemberships: async () => [],
    recoverCompanyOwner: async ({ userId }) => {
      recoverCalls += 1;
      return { id: "company-new", userId, role: "owner", status: "active" };
    },
  }, "owner-2");
  assert.equal(created.created, true);
  assert.equal(created.membership.userId, "owner-2");
  assert.equal(recoverCalls, 1);
});

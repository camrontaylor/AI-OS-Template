const assert = require("node:assert/strict");
const test = require("node:test");

const teamClient = require("./team-client.cjs");

function cliDeps(createClient) {
  const auditEvents = [];
  return {
    auditEvents,
    permissions: {
      requireTeamRole: async (_store, teamId, userId, role) => {
        assert.equal(teamId, "team-1");
        assert.equal(userId, "user-1");
        assert.equal(role, "admin");
      },
    },
    store: {
      getTeamBySlug: async (slug) => (
        slug === "demo" ? { id: "team-1", slug: "demo", name: "Demo" } : null
      ),
      getUserByEmail: async (email) => (
        email === "admin@example.com" ? { id: "user-1", email } : null
      ),
      createClient,
      recordAuditEvent: async (event) => auditEvents.push(event),
    },
  };
}

test("team-client create normalizes the slug and uses createClient", async () => {
  let received = null;
  const deps = cliDeps(async (input) => {
    received = input;
    return { id: "client-1", slug: input.slug, name: input.name };
  });

  const created = await teamClient.createClient(deps.store, deps.permissions, {
    team: "demo",
    by: "admin@example.com",
    slug: "  Acme.Client  ",
    name: "Acme",
  });

  assert.deepEqual(received, {
    teamId: "team-1",
    slug: "acme.client",
    name: "Acme",
  });
  assert.equal(created.id, "client-1");
  assert.equal(deps.auditEvents.length, 1);
});

test("team-client create reports a collision without writing an audit event", async () => {
  const deps = cliDeps(async () => null);

  await assert.rejects(
    teamClient.createClient(deps.store, deps.permissions, {
      team: "demo",
      by: "admin@example.com",
      slug: "ACME",
      name: "Replacement",
    }),
    /client already exists: acme/i,
  );
  assert.equal(deps.auditEvents.length, 0);
});

test("team-client create uses the shared cross-platform slug validation", async () => {
  let createCalls = 0;
  const deps = cliDeps(async () => {
    createCalls += 1;
    return null;
  });

  for (const slug of ["root", "con", "client.", "a".repeat(61)]) {
    await assert.rejects(
      teamClient.createClient(deps.store, deps.permissions, {
        team: "demo",
        by: "admin@example.com",
        slug,
        name: "Unsafe",
      }),
      /reserved|Windows|dot|characters or fewer/i,
    );
  }
  assert.equal(createCalls, 0);
});

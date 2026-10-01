#!/usr/bin/env node
/**
 * team-test-bootstrap - prepare the multi-user Team OS chat memory test data.
 *
 * This is intentionally idempotent. It can run on every test deployment before
 * the hosted memory API starts, creating any missing teams, users, clients, and
 * grants without printing passwords or invite tokens.
 */

const {
  loadIdentityModules,
  openLocalIdentityStore,
} = require("./load-identity-modules.cjs");

const USAGE = `team-test-bootstrap - prepare Team OS chat memory test data

Usage:
  node scripts/team-test-bootstrap.cjs --run-id <RUN_ID> [--json]

Environment fallback:
  TEAM_OS_TEST_RUN_ID=<RUN_ID> node scripts/team-test-bootstrap.cjs`;

const RUN_ID_RE = /^[a-z0-9][a-z0-9._-]{2,80}$/i;

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      i += 1;
      return value;
    };
    if (arg === "--run-id") flags.runId = take();
    else if (arg === "--json") flags.json = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

function normalizeRunId(raw) {
  const runId = String(raw || "").trim();
  if (!runId) throw new Error("--run-id is required");
  if (!RUN_ID_RE.test(runId)) {
    throw new Error("--run-id must use only letters, numbers, dots, underscores, or hyphens");
  }
  return runId.toLowerCase();
}

function buildSpec(runId) {
  const teamA = `team-a-${runId}`;
  const teamB = `team-b-${runId}`;
  const clientA = `acme-a-${runId}`;
  const clientB = `acme-b-${runId}`;

  return {
    runId,
    teams: {
      teamA: { slug: teamA, name: `Team A ${runId}` },
      teamB: { slug: teamB, name: `Team B ${runId}` },
    },
    users: {
      ownerA: {
        email: `owner-a-${runId}@example.test`,
        name: `Owner Team A ${runId}`,
        password: `owner-pass-${runId}`,
        role: "owner",
      },
      adminA: {
        email: `admin-a-${runId}@example.test`,
        name: `Admin Team A ${runId}`,
        password: `admin-pass-${runId}`,
        role: "admin",
      },
      memberA: {
        email: `member-a-${runId}@example.test`,
        name: `Member Team A ${runId}`,
        password: `member-pass-${runId}`,
        role: "member",
      },
      ownerB: {
        email: `owner-b-bootstrap-${runId}@example.test`,
        name: `Owner Bootstrap Team B ${runId}`,
        password: `owner-b-bootstrap-pass-${runId}`,
        role: "owner",
      },
      adminB: {
        email: `admin-b-${runId}@example.test`,
        name: `Admin Team B ${runId}`,
        password: `admin-b-pass-${runId}`,
        role: "admin",
      },
    },
    clients: {
      clientA: { slug: clientA, name: `Acme A ${runId}` },
      clientB: { slug: clientB, name: `Acme B ${runId}` },
    },
  };
}

function makeSummary(runId) {
  return {
    runId,
    teamsCreated: 0,
    usersEnsured: 0,
    membershipsEnsured: 0,
    clientsEnsured: 0,
    grantsEnsured: 0,
  };
}

async function ensureTeam(store, summary, input) {
  const existing = await store.getTeamBySlug(input.slug);
  if (existing) return existing;
  const team = await store.createTeam({ slug: input.slug, name: input.name });
  summary.teamsCreated += 1;
  return team;
}

async function ensureUser(store, teamAuth, summary, input) {
  const user = await store.upsertUser({
    email: input.email,
    displayName: input.name,
  });
  const ensuredUser = await teamAuth.ensureUserPassword(store, user, input.password);
  summary.usersEnsured += 1;
  return ensuredUser;
}

async function ensureMembership(store, summary, input) {
  await store.upsertMembership({
    teamId: input.team.id,
    userId: input.user.id,
    role: input.role,
    status: "active",
    invitedBy: input.invitedBy?.id ?? null,
    metadata: {
      testRunId: input.runId,
      managedBy: "team-test-bootstrap",
    },
  });
  summary.membershipsEnsured += 1;
}

async function ensureClient(store, summary, team, input, runId) {
  const client = await store.upsertClient({
    teamId: team.id,
    slug: input.slug,
    name: input.name,
    status: "active",
    metadata: {
      testRunId: runId,
      managedBy: "team-test-bootstrap",
    },
  });
  summary.clientsEnsured += 1;
  return client;
}

async function ensureClientGrant(store, summary, input) {
  const existing = await store.getActiveGrant(input.team.id, input.client.id, input.user.id);
  if (existing?.access === input.access) return existing;
  const grant = await store.grantClientAccess({
    teamId: input.team.id,
    clientId: input.client.id,
    userId: input.user.id,
    access: input.access,
    grantedBy: input.grantedBy.id,
    metadata: {
      testRunId: input.runId,
      managedBy: "team-test-bootstrap",
    },
  });
  summary.grantsEnsured += 1;
  return grant;
}

function buildPublicSummary(summary, spec) {
  return {
    ...summary,
    teams: {
      teamA: spec.teams.teamA.slug,
      teamB: spec.teams.teamB.slug,
    },
    clients: {
      teamA: spec.clients.clientA.slug,
      teamB: spec.clients.clientB.slug,
    },
    users: {
      ownerTeamA: spec.users.ownerA.email,
      adminTeamA: spec.users.adminA.email,
      memberTeamA: spec.users.memberA.email,
      adminTeamB: spec.users.adminB.email,
    },
    multiTeamUser: {
      email: spec.users.adminA.email,
      initialTeam: spec.teams.teamA.slug,
      teams: [spec.teams.teamA.slug, spec.teams.teamB.slug],
      clients: [spec.clients.clientA.slug, spec.clients.clientB.slug],
    },
  };
}

function printSummary(summary, spec, json) {
  const publicSummary = buildPublicSummary(summary, spec);
  if (json) {
    console.log(JSON.stringify(publicSummary, null, 2));
    return;
  }

  console.log(`team-test-bootstrap -> ready for ${summary.runId}`);
  console.log(`  teams   : ${publicSummary.teams.teamA}, ${publicSummary.teams.teamB}`);
  console.log(`  clients : ${publicSummary.clients.teamA}, ${publicSummary.clients.teamB}`);
  console.log("  users   : owner-team-a, admin-team-a, member-team-a, admin-team-b");
  console.log(`  multi   : ${publicSummary.multiTeamUser.email}`);
  console.log(`            teams=${publicSummary.multiTeamUser.teams.join(",")} clients=${publicSummary.multiTeamUser.clients.join(",")}`);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }

  const runId = normalizeRunId(flags.runId || process.env.TEAM_OS_TEST_RUN_ID);
  const spec = buildSpec(runId);
  const summary = makeSummary(runId);

  const { store, teamAuth } = loadIdentityModules();
  const s = await openLocalIdentityStore(store);
  try {
    const teamA = await ensureTeam(s, summary, spec.teams.teamA);
    const teamB = await ensureTeam(s, summary, spec.teams.teamB);

    const ownerA = await ensureUser(s, teamAuth, summary, spec.users.ownerA);
    const adminA = await ensureUser(s, teamAuth, summary, spec.users.adminA);
    const memberA = await ensureUser(s, teamAuth, summary, spec.users.memberA);
    const ownerB = await ensureUser(s, teamAuth, summary, spec.users.ownerB);
    const adminB = await ensureUser(s, teamAuth, summary, spec.users.adminB);

    await ensureMembership(s, summary, { runId, team: teamA, user: ownerA, role: "owner" });
    await ensureMembership(s, summary, { runId, team: teamA, user: adminA, role: "admin", invitedBy: ownerA });
    await ensureMembership(s, summary, { runId, team: teamA, user: memberA, role: "member", invitedBy: ownerA });
    await ensureMembership(s, summary, { runId, team: teamB, user: ownerB, role: "owner" });
    await ensureMembership(s, summary, { runId, team: teamB, user: adminB, role: "admin", invitedBy: ownerB });
    await ensureMembership(s, summary, { runId, team: teamB, user: adminA, role: "member", invitedBy: ownerB });

    const clientA = await ensureClient(s, summary, teamA, spec.clients.clientA, runId);
    const clientB = await ensureClient(s, summary, teamB, spec.clients.clientB, runId);

    await ensureClientGrant(s, summary, {
      runId,
      team: teamA,
      client: clientA,
      user: memberA,
      access: "write",
      grantedBy: adminA,
    });
    await ensureClientGrant(s, summary, {
      runId,
      team: teamA,
      client: clientA,
      user: adminA,
      access: "write",
      grantedBy: adminA,
    });
    await ensureClientGrant(s, summary, {
      runId,
      team: teamB,
      client: clientB,
      user: adminB,
      access: "write",
      grantedBy: ownerB,
    });
    await ensureClientGrant(s, summary, {
      runId,
      team: teamB,
      client: clientB,
      user: adminA,
      access: "write",
      grantedBy: ownerB,
    });

    printSummary(summary, spec, flags.json === true);
    return 0;
  } finally {
    await s.close();
  }
}

module.exports = {
  buildPublicSummary,
  buildSpec,
  ensureUser,
  normalizeRunId,
};

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`\nteam-test-bootstrap failed: ${error instanceof Error ? error.message : error}`);
      if (error && error.stack) console.error(error.stack);
      console.error(`\n${USAGE}`);
      process.exit(1);
    });
}

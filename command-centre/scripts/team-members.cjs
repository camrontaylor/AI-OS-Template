#!/usr/bin/env node
/**
 * team-members — list a team's memberships (email, role, status).
 *
 * Read-only. Useful to confirm an invite landed (status `invited`) and a join took
 * effect (status `active`). Makes no network calls and writes nothing.
 *
 * Usage:
 *   node scripts/team-members.cjs --team acme [--json]
 */

const {
  loadIdentityModules,
  openLocalIdentityStore,
  resolveTeamRef,
} = require("./load-identity-modules.cjs");

const USAGE = `team-members — list a team's memberships

Usage:
  node scripts/team-members.cjs --team <slug|id> [--json]`;

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${arg} requires a value`);
      i += 1;
      return v;
    };
    if (arg === "--team") flags.team = take();
    else if (arg === "--json") flags.json = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }
  if (!flags.team) {
    console.error("team-members: --team is required.\n");
    console.error(USAGE);
    return 2;
  }

  const { store } = loadIdentityModules();
  const s = await openLocalIdentityStore(store);
  try {
    const team = await resolveTeamRef(s, flags.team);
    const memberships = await s.listMemberships(team.id);

    const rows = [];
    for (const m of memberships) {
      const u = await s.getUserById(m.userId);
      rows.push({ email: u ? u.email : m.userId, role: m.role, status: m.status });
    }

    if (flags.json) {
      console.log(JSON.stringify({ team: team.slug, members: rows }, null, 2));
      return 0;
    }

    console.log(`team-members → ${team.name} (${team.slug})`);
    if (rows.length === 0) {
      console.log("  (no members)");
    }
    for (const r of rows) {
      console.log(`  ${r.status.padEnd(9)} ${r.role.padEnd(6)} ${r.email}`);
    }
    return 0;
  } finally {
    await s.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`\nteam-members failed: ${error instanceof Error ? error.message : error}`);
    if (error && error.stack) console.error(error.stack);
    console.error(`\n${USAGE}`);
    process.exit(1);
  });

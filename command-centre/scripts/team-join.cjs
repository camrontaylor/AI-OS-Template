#!/usr/bin/env node
/**
 * team-join — admin/server helper to redeem an invite token and join a team.
 *
 * Verifies the token against the stored hash and checks its expiry, then activates
 * the membership. The token is single-use: redeeming it clears it. An unknown,
 * used, mismatched, or expired token is rejected and grants no access.
 *
 * Usage (admin/server setup):
 *   node scripts/team-join.cjs --team acme --email dev@acme.com --token <token> [--password <password>]
 */

const {
  loadIdentityModules,
  openLocalIdentityStore,
  resolveTeamRef,
} = require("./load-identity-modules.cjs");

const USAGE = `team-join — admin/server helper to redeem an invite token

Usage:
  node scripts/team-join.cjs --team <slug|id> --email <invitee> --token <token> [--password <password>]

This script reads the identity database directly. For hosted Team OS, run it
inside the server container or set MEMORY_DATABASE_URL/DATABASE_URL. Normal
invited users should join through the hosted invite/reset flow, then login.`;

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
    else if (arg === "--email") flags.email = take();
    else if (arg === "--token") flags.token = take();
    else if (arg === "--password") flags.password = take();
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

function usesLocalStore(env = process.env) {
  return String(env.MEMORY_DATABASE_URL || env.DATABASE_URL || "").trim() === "";
}

function joinErrorMessage(error, env = process.env) {
  const message = error instanceof Error ? error.message : String(error);
  if (/^team not found:/i.test(message) && usesLocalStore(env)) {
    return `${message}\n\n` +
      "This command is reading the local AI-OS store, not the hosted Team OS server.\n" +
      "For hosted Team OS, run it inside the server container or set MEMORY_DATABASE_URL/DATABASE_URL.\n" +
      "For a normal invited user, use the hosted invite/reset flow and then login.";
  }
  return message;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }
  if (!flags.team || !flags.email || !flags.token) {
    console.error("team-join: --team, --email and --token are required.\n");
    console.error(USAGE);
    return 2;
  }

  const { store, invites, teamAuth } = loadIdentityModules();
  const s = await openLocalIdentityStore(store);
  try {
    const team = await resolveTeamRef(s, flags.team);
    if (!flags.password) {
      throw new Error("--password is required so the invite cannot activate without a login credential");
    }
    const membership = await invites.acceptInviteWithCredential(
      s,
      {
        teamId: team.id,
        email: flags.email,
        token: flags.token,
      },
      async (user) => teamAuth.setUserPassword(s, user, flags.password),
    );
    console.log(
      `team-join → ${flags.email} joined "${team.name}" as ${membership.role} (status: ${membership.status})`,
    );
    console.log("team-join → password set for Team OS login");
    return 0;
  } finally {
    await s.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`\nteam-join failed: ${joinErrorMessage(error)}`);
    if (error && error.stack) console.error(error.stack);
    console.error(`\n${USAGE}`);
    process.exit(1);
  });

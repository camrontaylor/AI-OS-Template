#!/usr/bin/env node
/**
 * team-invite — invite a member to a team by email.
 *
 * Authorizes the inviter (must be an active admin or owner), creates or reuses the
 * invitee, and records a pending invite. Prints the one-time join token: it is the
 * only time the raw token is shown — only a hash is stored. Hosted users should
 * join through the invite/reset flow; team-join is an admin/server setup helper.
 *
 * Usage:
 *   node scripts/team-invite.cjs --team acme --email dev@acme.com --by owner@acme.com [--role member|admin] [--expires-days 7]
 */

const {
  loadIdentityModules,
  openLocalIdentityStore,
  resolveTeamRef,
  resolveUserRef,
} = require("./load-identity-modules.cjs");

const USAGE = `team-invite — invite a member to a team

Usage:
  node scripts/team-invite.cjs --team <slug|id> --email <invitee> --by <inviter email|id> [--role member|admin] [--expires-days N]`;

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
    else if (arg === "--by") flags.by = take();
    else if (arg === "--role") flags.role = take();
    else if (arg === "--expires-days") flags.expiresDays = Number.parseInt(take(), 10);
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
  if (!flags.team || !flags.email || !flags.by) {
    console.error("team-invite: --team, --email and --by are required.\n");
    console.error(USAGE);
    return 2;
  }
  if (flags.expiresDays !== undefined && !Number.isInteger(flags.expiresDays)) {
    console.error("team-invite: --expires-days must be an integer.");
    return 2;
  }

  const { store, invites, teamAuth } = loadIdentityModules();
  const s = await openLocalIdentityStore(store);
  try {
    const team = await resolveTeamRef(s, flags.team);
    const inviter = await resolveUserRef(s, flags.by);
    if (await teamAuth.hasUsablePlatformCredential(s, flags.email)) {
      throw new Error("this user already has a platform credential and cannot receive an invitation token");
    }

    const result = await invites.inviteMember(s, {
      teamId: team.id,
      actorUserId: inviter.id,
      email: flags.email,
      role: flags.role,
      expiresInDays: flags.expiresDays,
    });

    console.log(
      `team-invite → invited ${result.user.email} to "${team.name}" as ${result.membership.role}`,
    );
    console.log(`  expires : ${result.expiresAt}`);
    console.log(`  token   : ${result.token}`);
    console.log(
      `  admin join: npm run team:join -- --team ${team.slug} --email ${result.user.email} --token ${result.token}`,
    );
    console.log("  manual    : use this only from the server/container for admin setup or testing");
    return 0;
  } finally {
    await s.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`\nteam-invite failed: ${error instanceof Error ? error.message : error}`);
    if (error && error.stack) console.error(error.stack);
    console.error(`\n${USAGE}`);
    process.exit(1);
  });

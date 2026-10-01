#!/usr/bin/env node
/**
 * team-skill — manage Team OS skill grants.
 *
 * Direct admin/bootstrap command, like team:client. The actor passed with --by
 * must be an active team admin/owner, or hold skill.admin for the target skill.
 */

const {
  loadIdentityModules,
  openLocalIdentityStore,
  resolveTeamRef,
  resolveUserRef,
} = require("./load-identity-modules.cjs");

const USAGE = `team-skill — manage skill grants

Usage:
  node scripts/team-skill.cjs grants --team <slug|id> [--skill <name>] [--user <email|id>] [--json]
  node scripts/team-skill.cjs grant --team <slug|id> --skill <name> --user <email|id> --permission <skill.use|skill.read|skill.edit|skill.admin> --by <admin email|id>
  node scripts/team-skill.cjs revoke --team <slug|id> --skill <name> --user <email|id> [--permission <permission>] --by <admin email|id>`;

const VALID_PERMISSIONS = new Set(["skill.use", "skill.read", "skill.edit", "skill.admin"]);
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = { command };
  if (command === "--help" || command === "-h") {
    flags.help = true;
    flags.command = undefined;
  }
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const take = () => {
      const value = rest[i + 1];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      i += 1;
      return value;
    };
    if (arg === "--team") flags.team = take();
    else if (arg === "--skill") flags.skill = take();
    else if (arg === "--user") flags.user = take();
    else if (arg === "--permission") flags.permission = take();
    else if (arg === "--by") flags.by = take();
    else if (arg === "--json") flags.json = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

function requireFlag(flags, key, message) {
  const value = flags[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(message);
  }
  return value.trim();
}

function requireSkillName(flags) {
  const skillName = requireFlag(flags, "skill", "--skill is required");
  if (!SKILL_NAME_RE.test(skillName)) {
    throw new Error("--skill must start with a letter/number and contain only letters, numbers, dots, underscores, or hyphens");
  }
  return skillName;
}

function requirePermission(flags, optional = false) {
  const permission = optional ? flags.permission : requireFlag(flags, "permission", "--permission is required");
  if (permission == null || permission === "") return null;
  if (!VALID_PERMISSIONS.has(permission)) {
    throw new Error(`--permission must be one of ${[...VALID_PERMISSIONS].join(", ")}`);
  }
  return permission;
}

async function requireSkillAdmin(store, permissions, teamId, skillName, actorRef) {
  const actor = await resolveUserRef(store, actorRef);
  try {
    await permissions.requireTeamRole(store, teamId, actor.id, "admin");
    return actor;
  } catch (roleError) {
    try {
      const principal = await permissions.resolvePrincipal(store, {
        teamId,
        userId: actor.id,
        authSource: "test",
      });
      await permissions.requireSkillAccess(store, principal, skillName, "skill.admin");
      return actor;
    } catch {
      throw roleError;
    }
  }
}

async function userLabel(store, userId) {
  const user = await store.getUserById(userId);
  return user ? user.email : userId;
}

async function listGrants(store, flags) {
  const team = await resolveTeamRef(store, requireFlag(flags, "team", "--team is required"));
  const user = flags.user ? await resolveUserRef(store, flags.user) : null;
  const grants = await store.listSkillGrants({
    teamId: team.id,
    ...(flags.skill ? { skillName: flags.skill } : {}),
    ...(user ? { userId: user.id } : {}),
  });

  const rows = [];
  for (const grant of grants) {
    rows.push({
      id: grant.id,
      skill: grant.skillName,
      user: await userLabel(store, grant.userId),
      permission: grant.permission,
      status: grant.status,
      grantedAt: grant.grantedAt,
      revokedAt: grant.revokedAt,
    });
  }

  if (flags.json) {
    console.log(JSON.stringify({ team: team.slug, grants: rows }, null, 2));
    return;
  }

  console.log(`team-skill → grants for ${team.name} (${team.slug})`);
  if (rows.length === 0) {
    console.log("  (no grants)");
    return;
  }
  for (const row of rows) {
    const revoked = row.revokedAt ? ` revoked ${row.revokedAt}` : "";
    console.log(`  ${row.status.padEnd(8)} ${row.permission.padEnd(11)} ${row.skill.padEnd(24)} ${row.user}${revoked}`);
  }
}

async function grantSkill(store, permissions, flags) {
  const team = await resolveTeamRef(store, requireFlag(flags, "team", "--team is required"));
  const skillName = requireSkillName(flags);
  const actor = await requireSkillAdmin(store, permissions, team.id, skillName, requireFlag(flags, "by", "--by is required"));
  const user = await resolveUserRef(store, requireFlag(flags, "user", "--user is required"));
  const permission = requirePermission(flags);
  if (!(await store.isActiveMember(team.id, user.id))) {
    throw new Error("target user must be an active team member before skill access can be granted");
  }

  const grant = await store.grantSkillAccess({
    teamId: team.id,
    skillName,
    userId: user.id,
    permission,
    grantedBy: actor.id,
  });

  console.log(`team-skill → granted ${grant.permission} on ${skillName} to ${user.email}`);
}

async function revokeSkill(store, permissions, flags) {
  const team = await resolveTeamRef(store, requireFlag(flags, "team", "--team is required"));
  const skillName = requireSkillName(flags);
  const actor = await requireSkillAdmin(store, permissions, team.id, skillName, requireFlag(flags, "by", "--by is required"));
  const user = await resolveUserRef(store, requireFlag(flags, "user", "--user is required"));
  const permission = requirePermission(flags, true);
  const grants = await store.revokeSkillAccess({
    teamId: team.id,
    skillName,
    userId: user.id,
    ...(permission ? { permission } : {}),
    revokedBy: actor.id,
  });
  if (grants.length === 0) {
    throw new Error(`no active skill grant for ${user.email} on ${skillName}`);
  }
  console.log(`team-skill → revoked ${grants.length} grant${grants.length === 1 ? "" : "s"} on ${skillName} from ${user.email}`);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (!flags.command || flags.help) {
    console.log(USAGE);
    return 0;
  }

  const { store, permissions } = loadIdentityModules();
  const s = await openLocalIdentityStore(store);
  try {
    if (flags.command === "grants") await listGrants(s, flags);
    else if (flags.command === "grant") await grantSkill(s, permissions, flags);
    else if (flags.command === "revoke") await revokeSkill(s, permissions, flags);
    else throw new Error(`Unknown command: ${flags.command}`);
    return 0;
  } finally {
    await s.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`\nteam-skill failed: ${error instanceof Error ? error.message : error}`);
    if (error && error.stack) console.error(error.stack);
    console.error(`\n${USAGE}`);
    process.exit(1);
  });

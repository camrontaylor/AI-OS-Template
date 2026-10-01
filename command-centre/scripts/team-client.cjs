#!/usr/bin/env node
/**
 * team-client — manage Team OS clients and client grants.
 *
 * Direct admin/bootstrap command, like team:create and team:invite. It writes to
 * the same local PGLite store, or hosted Postgres when MEMORY_DATABASE_URL is
 * set. The actor passed with --by must be an active admin or owner.
 */

const {
  loadClientSlugModule,
  loadIdentityModules,
  openLocalIdentityStore,
  resolveClientRef,
  resolveTeamRef,
  resolveUserRef,
} = require("./load-identity-modules.cjs");

const {
  clientSlugValidationError,
  normalizeClientSlug,
} = loadClientSlugModule();

const USAGE = `team-client — manage clients and client grants

Usage:
  node scripts/team-client.cjs create --team <slug|id> --slug <client-slug> --name <name> --by <admin email|id>
  node scripts/team-client.cjs list --team <slug|id> [--json]
  node scripts/team-client.cjs grants --team <slug|id> [--client <slug|id>] [--user <email|id>] [--json]
  node scripts/team-client.cjs grant --team <slug|id> --client <slug|id> --user <email|id> --access <read|write> --by <admin email|id>
  node scripts/team-client.cjs revoke --team <slug|id> --client <slug|id> --user <email|id> --by <admin email|id>`;

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
    else if (arg === "--slug") flags.slug = take();
    else if (arg === "--name") flags.name = take();
    else if (arg === "--client") flags.client = take();
    else if (arg === "--user") flags.user = take();
    else if (arg === "--access") flags.access = take();
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

async function requireAdmin(store, permissions, teamId, actorRef) {
  const actor = await resolveUserRef(store, actorRef);
  await permissions.requireTeamRole(store, teamId, actor.id, "admin");
  return actor;
}

async function userLabel(store, userId) {
  const user = await store.getUserById(userId);
  return user ? user.email : userId;
}

async function clientLabel(store, clientId) {
  const client = await store.getClientById(clientId);
  return client ? client.slug : clientId;
}

async function createClient(store, permissions, flags) {
  const team = await resolveTeamRef(store, requireFlag(flags, "team", "--team is required"));
  const actor = await requireAdmin(store, permissions, team.id, requireFlag(flags, "by", "--by is required"));
  const requestedSlug = requireFlag(flags, "slug", "--slug is required");
  const name = requireFlag(flags, "name", "--name is required");
  const validationError = clientSlugValidationError(requestedSlug);
  if (validationError) {
    throw new Error(`--slug ${validationError}`);
  }
  const slug = normalizeClientSlug(requestedSlug);

  const client = await store.createClient({ teamId: team.id, slug, name });
  if (!client) throw new Error(`client already exists: ${slug}`);
  await store.recordAuditEvent({
    teamId: team.id,
    actorUserId: actor.id,
    action: "client.created",
    targetType: "client",
    targetId: client.id,
    summary: `created client ${client.slug}`,
    metadata: { slug: client.slug, name: client.name },
  });

  console.log(`team-client → created client "${client.name}" (${client.slug})`);
  console.log(`  client id : ${client.id}`);
  console.log(`  team      : ${team.slug}`);
  return client;
}

async function listClients(store, flags) {
  const team = await resolveTeamRef(store, requireFlag(flags, "team", "--team is required"));
  const clients = await store.listClients(team.id);
  const rows = [];
  for (const client of clients) {
    const grants = await store.listGrants({ teamId: team.id, clientId: client.id });
    const active = grants.filter((grant) => grant.status === "active");
    rows.push({
      id: client.id,
      slug: client.slug,
      name: client.name,
      status: client.status,
      activeGrants: active.length,
    });
  }

  if (flags.json) {
    console.log(JSON.stringify({ team: team.slug, clients: rows }, null, 2));
    return;
  }

  console.log(`team-client → clients for ${team.name} (${team.slug})`);
  if (rows.length === 0) {
    console.log("  (no clients)");
    return;
  }
  for (const row of rows) {
    console.log(`  ${row.status.padEnd(8)} ${row.slug.padEnd(18)} ${row.name} (${row.activeGrants} active grants)`);
  }
}

async function listGrants(store, flags) {
  const team = await resolveTeamRef(store, requireFlag(flags, "team", "--team is required"));
  const client = flags.client ? await resolveClientRef(store, team.id, flags.client) : null;
  const user = flags.user ? await resolveUserRef(store, flags.user) : null;
  const grants = await store.listGrants({
    teamId: team.id,
    ...(client ? { clientId: client.id } : {}),
    ...(user ? { userId: user.id } : {}),
  });

  const rows = [];
  for (const grant of grants) {
    rows.push({
      id: grant.id,
      client: await clientLabel(store, grant.clientId),
      user: await userLabel(store, grant.userId),
      access: grant.access,
      status: grant.status,
      grantedAt: grant.grantedAt,
      revokedAt: grant.revokedAt,
    });
  }

  if (flags.json) {
    console.log(JSON.stringify({ team: team.slug, grants: rows }, null, 2));
    return;
  }

  console.log(`team-client → grants for ${team.name} (${team.slug})`);
  if (rows.length === 0) {
    console.log("  (no grants)");
    return;
  }
  for (const row of rows) {
    const revoked = row.revokedAt ? ` revoked ${row.revokedAt}` : "";
    console.log(`  ${row.status.padEnd(8)} ${row.access.padEnd(5)} ${row.client.padEnd(18)} ${row.user}${revoked}`);
  }
}

async function grantClient(store, permissions, flags) {
  const team = await resolveTeamRef(store, requireFlag(flags, "team", "--team is required"));
  const actor = await requireAdmin(store, permissions, team.id, requireFlag(flags, "by", "--by is required"));
  const client = await resolveClientRef(store, team.id, requireFlag(flags, "client", "--client is required"));
  const user = await resolveUserRef(store, requireFlag(flags, "user", "--user is required"));
  const access = requireFlag(flags, "access", "--access is required");
  if (access !== "read" && access !== "write") {
    throw new Error("--access must be read or write");
  }
  if (!(await store.isActiveMember(team.id, user.id))) {
    throw new Error("target user must be an active team member before client access can be granted");
  }

  const grant = await store.grantClientAccess({
    teamId: team.id,
    clientId: client.id,
    userId: user.id,
    access,
    grantedBy: actor.id,
  });

  console.log(`team-client → granted ${grant.access} on ${client.slug} to ${user.email}`);
}

async function revokeClient(store, permissions, flags) {
  const team = await resolveTeamRef(store, requireFlag(flags, "team", "--team is required"));
  const actor = await requireAdmin(store, permissions, team.id, requireFlag(flags, "by", "--by is required"));
  const client = await resolveClientRef(store, team.id, requireFlag(flags, "client", "--client is required"));
  const user = await resolveUserRef(store, requireFlag(flags, "user", "--user is required"));
  const grant = await store.revokeClientAccess({
    teamId: team.id,
    clientId: client.id,
    userId: user.id,
    revokedBy: actor.id,
  });
  if (!grant) {
    throw new Error(`no active grant for ${user.email} on ${client.slug}`);
  }
  console.log(`team-client → revoked access on ${client.slug} from ${user.email}`);
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
    if (flags.command === "create") await createClient(s, permissions, flags);
    else if (flags.command === "list") await listClients(s, flags);
    else if (flags.command === "grants") await listGrants(s, flags);
    else if (flags.command === "grant") await grantClient(s, permissions, flags);
    else if (flags.command === "revoke") await revokeClient(s, permissions, flags);
    else throw new Error(`Unknown command: ${flags.command}`);
    return 0;
  } finally {
    await s.close();
  }
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`\nteam-client failed: ${error instanceof Error ? error.message : error}`);
      if (error && error.stack) console.error(error.stack);
      console.error(`\n${USAGE}`);
      process.exit(1);
    });
}

module.exports = {
  createClient,
  parseArgs,
};

#!/usr/bin/env node
/**
 * team-owner-reset — print a hosted password reset link for a Team OS owner.
 *
 * Designed for Docker recovery:
 *   docker exec -it <container> npm run team:owner-reset
 */

const {
  loadIdentityModules,
  openLocalIdentityStore,
  resolveTeamRef,
} = require("./load-identity-modules.cjs");
const fs = require("node:fs");

const USAGE = `team-owner-reset — create an owner password reset link

Usage:
  node scripts/team-owner-reset.cjs [--team <slug|id>] [--email <owner email>] [--base-url <url>] [--ttl <duration>]

TTL:
  Defaults to 1h. Accepts seconds, minutes, or hours, e.g. 1800, 30m, 4h.
  Maximum: 24h.

Env fallbacks:
  team     MEMORY_API_TEAM_SLUG, MEMORY_API_BOOTSTRAP_TEAM_SLUG, MEMORY_API_TEAM_ID
  email    MEMORY_API_BOOTSTRAP_OWNER_EMAIL, MEMORY_API_USER_EMAIL, MEMORY_API_USER_ID
  base URL MEMORY_API_PUBLIC_URL, TEAM_OS_PUBLIC_URL, SERVICE_URL_*, SERVICE_FQDN_*, BETTER_AUTH_URL`;

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
    if (arg === "--team") flags.team = take();
    else if (arg === "--email") flags.email = take();
    else if (arg === "--base-url") flags.baseUrl = take();
    else if (arg === "--ttl") flags.ttl = take();
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

function parseTtlSeconds(raw) {
  if (raw == null || raw === "") return 3600;
  const value = String(raw).trim().toLowerCase();
  const match = /^(\d+)(s|m|h)?$/.exec(value);
  if (!match) throw new Error("--ttl must be a duration like 1800, 30m, or 4h");
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2] || "s";
  const multiplier = unit === "h" ? 3600 : unit === "m" ? 60 : 1;
  const seconds = amount * multiplier;
  if (!Number.isInteger(seconds) || seconds < 1) {
    throw new Error("--ttl must be at least 1 second");
  }
  if (seconds > 24 * 3600) {
    throw new Error("--ttl must be 24h or less");
  }
  return seconds;
}

function envValue(key, env = process.env) {
  return (env[key] ?? "").trim();
}

function normalizePublicBaseUrl(value) {
  const trimmed = String(value ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

function normalizeServiceFqdn(value) {
  const trimmed = String(value ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9.-]+(?::\d+)?$/i.test(trimmed)) return `https://${trimmed}`;
  return "";
}

function firstWildcardPublicBaseUrl(prefix, env = process.env, normalizer = normalizePublicBaseUrl) {
  return Object.keys(env)
    .filter((key) => key.startsWith(prefix))
    .sort()
    .map((key) => normalizer(envValue(key, env)))
    .find(Boolean) || "";
}

function isDockerOrProduction(env = process.env) {
  return env.NODE_ENV === "production" || fs.existsSync("/.dockerenv");
}

function defaultPublicBaseUrl(flags, env = process.env) {
  const explicit = normalizePublicBaseUrl(flags.baseUrl);
  if (explicit) return explicit;
  for (const key of ["MEMORY_API_PUBLIC_URL", "TEAM_OS_PUBLIC_URL"]) {
    const url = normalizePublicBaseUrl(envValue(key, env));
    if (url) return url;
  }
  const serviceUrl = firstWildcardPublicBaseUrl("SERVICE_URL_", env, normalizePublicBaseUrl);
  if (serviceUrl) return serviceUrl;
  const serviceFqdn = firstWildcardPublicBaseUrl("SERVICE_FQDN_", env, normalizeServiceFqdn);
  if (serviceFqdn) return serviceFqdn;
  const authUrl = normalizePublicBaseUrl(envValue("BETTER_AUTH_URL", env));
  if (authUrl) return authUrl;
  if (isDockerOrProduction(env)) {
    throw new Error(
      "public base URL is required in Docker/production; pass --base-url or set MEMORY_API_PUBLIC_URL, TEAM_OS_PUBLIC_URL, SERVICE_URL_*, SERVICE_FQDN_*, or BETTER_AUTH_URL",
    );
  }
  const port = envValue("MEMORY_API_PORT", env) || envValue("PORT", env) || "8787";
  return `http://localhost:${port}`;
}

function buildResetUrl(baseUrl, email, token) {
  const url = new URL("/team/reset-password", `${baseUrl}/`);
  url.searchParams.set("email", email);
  url.searchParams.set("token", token);
  return url.href;
}

async function resolveOwner(store, team, flags, env = process.env) {
  const emailOrId =
    flags.email ||
    envValue("MEMORY_API_BOOTSTRAP_OWNER_EMAIL", env) ||
    envValue("MEMORY_API_USER_EMAIL", env) ||
    envValue("MEMORY_API_USER_ID", env);

  if (emailOrId) {
    const user = emailOrId.includes("@")
      ? await store.getUserByEmail(emailOrId)
      : await store.getUserById(emailOrId);
    if (!user) throw new Error(`owner user not found: ${emailOrId}`);
    const membership = await store.getMembership(team.id, user.id);
    if (!membership || membership.status !== "active") {
      throw new Error(`${user.email} is not an active member of ${team.slug}`);
    }
    if (membership.role !== "owner") {
      throw new Error(`${user.email} is ${membership.role}, not owner`);
    }
    return user;
  }

  const memberships = await store.listMemberships(team.id);
  const owners = memberships.filter((membership) => (
    membership.status === "active" && membership.role === "owner"
  ));
  if (owners.length === 0) throw new Error(`no active owner found for ${team.slug}`);
  if (owners.length > 1) {
    throw new Error("multiple active owners found; pass --email to choose one");
  }
  const owner = await store.getUserById(owners[0].userId);
  if (!owner) throw new Error(`owner user not found: ${owners[0].userId}`);
  return owner;
}

async function createOwnerResetLink({
  store,
  teamAuth,
  flags,
  env = process.env,
  resolveTeam = resolveTeamRef,
}) {
  const teamRef =
    flags.team ||
    envValue("MEMORY_API_TEAM_SLUG", env) ||
    envValue("MEMORY_API_BOOTSTRAP_TEAM_SLUG", env) ||
    envValue("MEMORY_API_TEAM_ID", env);
  if (!teamRef) throw new Error("team is required; pass --team or configure MEMORY_API_TEAM_SLUG");

  const team = await resolveTeam(store, teamRef);
  const owner = await resolveOwner(store, team, flags, env);
  const reset = await teamAuth.createPasswordResetTokenForUser(
    store,
    owner,
    {
      teamId: team.id,
      expiresInSeconds: parseTtlSeconds(flags.ttl),
      allowProtectedAuthority: true,
    },
  );
  const url = buildResetUrl(defaultPublicBaseUrl(flags, env), owner.email, reset.token);
  return { team, owner, reset, url };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }

  const { store, teamAuth } = loadIdentityModules();
  const s = await openLocalIdentityStore(store);
  try {
    const { team, owner, reset, url } = await createOwnerResetLink({ store: s, teamAuth, flags });

    console.log(`team-owner-reset → ${owner.email}`);
    console.log(`  team    : ${team.name} (${team.slug})`);
    console.log(`  expires : ${reset.expiresAt}`);
    console.log(`  reset   : ${url}`);
    return 0;
  } finally {
    await s.close();
  }
}

module.exports = {
  buildResetUrl,
  createOwnerResetLink,
  defaultPublicBaseUrl,
  parseArgs,
  resolveOwner,
  normalizeServiceFqdn,
  parseTtlSeconds,
};

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`\nteam-owner-reset failed: ${error instanceof Error ? error.message : error}`);
      if (error && error.stack) console.error(error.stack);
      console.error(`\n${USAGE}`);
      process.exit(1);
    });
}

/**
 * Shared loader for the identity (team-platform) module graph.
 *
 * Mirrors load-memory-modules.cjs: the repo has no build step, so the .ts identity
 * modules are loaded at runtime via loadTsModule, leaf-first, each injected as a
 * stub into the modules that import it. The team CLI scripts (create/invite/join/
 * members) all need the same graph, so it lives here once.
 *
 * Also exposes openLocalIdentityStore — which points the store at the workspace's
 * local PGLite directory (the same database the memory store uses) unless a hosted
 * Postgres URL is configured — plus resolveTeamRef / resolveUserRef so the CLIs can
 * accept either a slug/email/client slug or a raw id.
 */

const fs = require("node:fs");
const path = require("node:path");

const { loadTsModule } = require("../src/lib/test-utils/load-ts-module.cjs");
const { findWorkspaceRoot } = require("./workspace-root.cjs");

const MEM = (file) => path.resolve(__dirname, "../src/lib/memory", file);
const ID = (file) => path.resolve(__dirname, "../src/lib/identity", file);
const CLIENT_SLUG = path.resolve(__dirname, "../src/lib/client-slug.ts");

function loadClientSlugModule() {
  return loadTsModule(CLIENT_SLUG);
}

function loadIdentityModules() {
  const migrate = loadTsModule(MEM("migrate.ts"));
  const adapter = loadTsModule(MEM("pglite-adapter.ts"));
  const postgresAdapter = loadTsModule(MEM("postgres-adapter.ts"));
  const backend = loadTsModule(MEM("backend.ts"));
  const clientSlug = loadClientSlugModule();
  const rowMappers = loadTsModule(ID("row-mappers.ts"));
  const store = loadTsModule(ID("store.ts"), {
    stubs: {
      "../memory/migrate": migrate,
      "../memory/pglite-adapter": adapter,
      "../memory/postgres-adapter": postgresAdapter,
      "../memory/backend": backend,
      "../client-slug": clientSlug,
      "./row-mappers": rowMappers,
    },
  });
  const permissions = loadTsModule(ID("permissions.ts"));
  const invites = loadTsModule(ID("invites.ts"), {
    stubs: { "./permissions": permissions },
  });
  const teamAuth = loadTsModule(ID("team-auth.ts"), {
    stubs: {
      "./permissions": permissions,
      "./store": store,
    },
  });
  return {
    migrate,
    adapter,
    postgresAdapter,
    backend,
    clientSlug,
    rowMappers,
    store,
    permissions,
    invites,
    teamAuth,
  };
}

/**
 * Open the identity store. Uses hosted Postgres automatically when
 * MEMORY_DATABASE_URL / DATABASE_URL is set; otherwise the workspace's local
 * PGLite directory — the same store the memory commands use.
 */
async function openLocalIdentityStore(storeModule) {
  const hostedUrl = (process.env.MEMORY_DATABASE_URL || process.env.DATABASE_URL || "").trim();
  if (hostedUrl) {
    return storeModule.openIdentityStore({});
  }
  const rootDir = process.env.AI_OS_DIR
    ? path.resolve(process.env.AI_OS_DIR)
    : findWorkspaceRoot(__dirname);
  const dataDir = path.join(rootDir, ".command-centre", "memory");
  fs.mkdirSync(dataDir, { recursive: true }); // PGLite's own mkdir is not recursive
  return storeModule.openIdentityStore({ backend: "pglite", dataDir });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve a team by raw id (uuid) or by slug. Throws if not found. */
async function resolveTeamRef(store, ref) {
  if (!ref) throw new Error("a team (--team <slug|id>) is required");
  const team = UUID_RE.test(ref) ? await store.getTeam(ref) : await store.getTeamBySlug(ref);
  if (!team) throw new Error(`team not found: ${ref}`);
  return team;
}

/** Resolve a user by raw id (uuid) or by email. Throws if not found. */
async function resolveUserRef(store, ref) {
  if (!ref) throw new Error("a user reference is required");
  const user = UUID_RE.test(ref) ? await store.getUserById(ref) : await store.getUserByEmail(ref);
  if (!user) throw new Error(`user not found: ${ref}`);
  return user;
}

/** Resolve a client by raw id (uuid) or by slug within one team. Throws if not found. */
async function resolveClientRef(store, teamId, ref) {
  if (!ref) throw new Error("a client (--client <slug|id>) is required");
  const client = UUID_RE.test(ref) ? await store.getClientById(ref) : await store.getClientBySlug(teamId, ref);
  if (!client || client.teamId !== teamId) throw new Error(`client not found: ${ref}`);
  return client;
}

module.exports = {
  loadClientSlugModule,
  loadIdentityModules,
  openLocalIdentityStore,
  resolveClientRef,
  resolveTeamRef,
  resolveUserRef,
};

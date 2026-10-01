/**
 * Shared loader for the PGLite memory module graph.
 *
 * The repo has no build step: the .ts memory modules are loaded at runtime via
 * loadTsModule, leaf-first, each injected as a stub into the modules that import
 * it (the same pattern the tests use). memory-index/search/capture/status all
 * need the same graph, so it lives here once.
 *
 * Returns the loaded modules. Pass { withSearch: true } to also load the
 * reranker + search modules (memory-search), { withCapture: false } to skip
 * capture.ts when a caller does not need it, { withApi: true } to load the
 * hosted API handlers + server (memory-api; implies withSearch), and
 * { withWatcher: true } to load watcher.ts (memory-watch; implies withCapture).
 */

const fs = require("node:fs");
const path = require("node:path");

function addRootCandidate(candidates, value) {
  if (!value || typeof value !== "string") return;
  const resolved = path.resolve(value);
  candidates.push(resolved);
  candidates.push(path.join(resolved, "command-centre"));
}

function isCommandCentreRoot(candidate) {
  return (
    fs.existsSync(path.join(candidate, "src", "lib", "memory", "embedding.ts")) &&
    fs.existsSync(path.join(candidate, "src", "lib", "test-utils", "load-ts-module.cjs"))
  );
}

function resolveCommandCentreRoot(options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const startDir = options.startDir || __dirname;
  const candidates = [];

  addRootCandidate(candidates, env.AI_OS_DIR);
  addRootCandidate(candidates, cwd);
  addRootCandidate(candidates, path.resolve(startDir, ".."));
  addRootCandidate(candidates, startDir);

  const seen = new Set();
  for (const candidate of candidates) {
    const normalized = path.normalize(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (isCommandCentreRoot(normalized)) return normalized;
  }

  throw new Error(
    `Could not resolve command-centre root. Checked: ${[...seen].join(", ")}`,
  );
}

const COMMAND_CENTRE_ROOT = resolveCommandCentreRoot();
const loadTsModulePath = path.join(
  /*turbopackIgnore: true*/ COMMAND_CENTRE_ROOT,
  "src",
  "lib",
  "test-utils",
  "load-ts-module.cjs",
);
const runtimeRequire = eval("require");
const { loadTsModule } = runtimeRequire(loadTsModulePath);

const MEM_DIR = path.join(/*turbopackIgnore: true*/ COMMAND_CENTRE_ROOT, "src", "lib", "memory");
const ID_DIR = path.join(/*turbopackIgnore: true*/ COMMAND_CENTRE_ROOT, "src", "lib", "identity");
const resolve = (file) => path.join(MEM_DIR, file);
const resolveIdentity = (file) => path.join(ID_DIR, file);

function loadMemoryModules(opts = {}) {
  const { withSearch = false, withCapture = true, withApi = false, withImport = false, withWatcher = false } = opts;

  // Leaf-first: a module is loaded before anything that stubs it.
  const types = { ALL_VISIBILITIES: ["private", "client", "team", "system"] };
  const embedding = loadTsModule(resolve("embedding.ts"));
  const scope = loadTsModule(resolve("scope.ts"), { stubs: { "./types": types } });
  const migrate = loadTsModule(resolve("migrate.ts"));
  const adapter = loadTsModule(resolve("pglite-adapter.ts"));
  // postgres-adapter only imports the `pg` Client class (no connection opened at
  // load) + type-only ./migrate; backend.ts is pure. Both load stub-free.
  const postgresAdapter = loadTsModule(resolve("postgres-adapter.ts"));
  const backend = loadTsModule(resolve("backend.ts"));
  const rowMappers = loadTsModule(resolve("row-mappers.ts"), {
    stubs: { "./types": types, "./embedding": embedding },
  });
  const store = loadTsModule(resolve("store.ts"), {
    stubs: {
      "./types": types,
      "./migrate": migrate,
      "./scope": scope,
      "./embedding": embedding,
      "./row-mappers": rowMappers,
      "./pglite-adapter": adapter,
      "./postgres-adapter": postgresAdapter,
      "./backend": backend,
    },
  });
  const embedder = loadTsModule(resolve("embedder.ts"));
  const chunker = loadTsModule(resolve("chunker.ts"));
  const discovery = loadTsModule(resolve("discovery.ts"));
  const connectors = loadTsModule(resolve("connectors.ts"));
  // ingest.ts is the shared single-source pipeline; the indexer and the hosted
  // API both ingest through it.
  const ingest = loadTsModule(resolve("ingest.ts"), {
    stubs: { "./scope": scope, "./embedding": embedding, "./chunker": chunker },
  });
  const indexer = loadTsModule(resolve("indexer.ts"), {
    stubs: { "./scope": scope, "./ingest": ingest, "./discovery": discovery },
  });

  const modules = { types, embedding, scope, migrate, adapter, postgresAdapter, backend, rowMappers, store, embedder, chunker, discovery, connectors, ingest, indexer };

  if (withCapture || withImport || withWatcher) {
    // capture.ts value-imports only ./indexer; the rest are type-only (erased).
    modules.capture = loadTsModule(resolve("capture.ts"), { stubs: { "./indexer": indexer } });
  }

  if (withImport) {
    // session-import.ts value-imports ./capture (the rest is type-only).
    modules.sessionImport = loadTsModule(resolve("session-import.ts"), {
      stubs: { "./capture": modules.capture },
    });
  }

  if (withWatcher) {
    // watcher.ts value-imports ./store, ./capture, ./ingest, ./discovery (+ chokidar).
    modules.watcher = loadTsModule(resolve("watcher.ts"), {
      stubs: { "./store": store, "./capture": modules.capture, "./ingest": ingest, "./discovery": discovery },
    });
  }

  if (withSearch || withApi) {
    modules.reranker = loadTsModule(resolve("reranker.ts"));
    modules.search = loadTsModule(resolve("search.ts"), {
      stubs: { "./types": types, "./reranker": modules.reranker, "./row-mappers": rowMappers },
    });
  }

  if (withApi) {
    modules.scopedAccess = loadTsModule(resolve("scoped-access.ts"), {
      stubs: { "./scope": scope, "./row-mappers": rowMappers },
    });
    modules.expand = loadTsModule(resolve("expand.ts"), {
      stubs: { "./scoped-access": modules.scopedAccess },
    });
    const identityRowMappers = loadTsModule(resolveIdentity("row-mappers.ts"));
    const identityStore = loadTsModule(resolveIdentity("store.ts"), {
      stubs: {
        "../memory/migrate": migrate,
        "../memory/pglite-adapter": adapter,
        "../memory/postgres-adapter": postgresAdapter,
        "../memory/backend": backend,
        "./row-mappers": identityRowMappers,
      },
    });
    const permissions = loadTsModule(resolveIdentity("permissions.ts"));
    const invites = loadTsModule(resolveIdentity("invites.ts"), {
      stubs: { "./permissions": permissions },
    });
    const teamAuth = loadTsModule(resolveIdentity("team-auth.ts"), {
      stubs: {
        "./permissions": permissions,
        "./store": identityStore,
      },
    });
    // api.ts value-imports ./search, ./ingest, ./scope; server.ts only ./api.
    modules.api = loadTsModule(resolve("api.ts"), {
      stubs: {
        "./types": types,
        "./search": modules.search,
        "./expand": modules.expand,
        "./ingest": ingest,
        "./connectors": connectors,
        "./scope": scope,
        "../identity/invites": invites,
        "../identity/permissions": permissions,
        "../identity/team-auth": teamAuth,
      },
    });
    modules.server = loadTsModule(resolve("server.ts"), {
      stubs: { "./api": modules.api },
    });
  }

  return modules;
}

module.exports = { loadMemoryModules, resolveCommandCentreRoot };

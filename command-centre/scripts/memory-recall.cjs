#!/usr/bin/env node
/**
 * memory-recall - primary recall entry point.
 *
 * Recall delegates to one rung script:
 *   - search: Team OS API in auto/team mode, local PGLite in local mode
 *   - expand: Team OS API in auto/team mode, local PGLite in local mode
 *   - transcript: local-only for now because raw transcripts live on disk
 *
 * The legacy MemSearch rollback was removed because it was not scope-isolated.
 */

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { readConfigOptional } = require("./lib/team-config.cjs");
const { requestedMemoryMode } = require("./lib/team-memory-routing.cjs");

const VALID_BACKENDS = ["pglite"];

// Flags that consume the following token as their value. We must know these so a
// value like `acme` in `--client acme` is not mistaken for the positional query.
const VALUE_FLAGS = [
  "--team",
  "--client",
  "--user",
  "--include",
  "--embedder",
  "--embedding-mode",
  "--top-k",
  "--radius",
  "--limit",
  "--max-chars",
];

const USAGE = `memory-recall - primary recall (Team OS API or local PGLite)

Usage:
  node scripts/memory-recall.cjs "<query>" [scope] [options]             # rung: search (default)
  node scripts/memory-recall.cjs --expand <chunk-id> [scope] [options]       # rung: expand
  node scripts/memory-recall.cjs --transcript <chunk-id> <scope> [options]   # rung: transcript (local only)

Scope:
  Team OS search/expand default to system + team + private for the signed-in user.
  Local search defaults to this machine's private local user + system.
  Local expand/transcript require an explicit scope.
  --system               search the local system baseline
  --team <id>            search as this team (adds system + team)
  --client <slug>        search as this client (adds system + client)
  --user <id>            include this user's private rows (adds system + private)
  --include <list>       set visibility layers explicitly (system,team,client,private)

Rung selection (mutually exclusive; default is search):
  --expand <chunk-id>    expand this chunk to its surrounding source context
  --transcript <chunk-id>   drill into this chunk's local raw transcript window

Options:
  --top-k <n>            results to return (search rung; default 10)
  --radius <n>           context radius for expand/transcript
  --limit <n>            hard row cap for expand
  --max-chars <n>        cap on expanded/transcript output
  --team-api             force hosted Team OS Memory API for search/expand
  --local                force local PGLite memory
  --embedding-mode <auto|server|client>
                         search rung only: Team OS query embedding mode
  --embedder <bge-m3|hash>   local search default: bge-m3 (or $MEMORY_EMBEDDER); hash is explicit offline mode
  --json                 emit results as JSON (machine output)
  --store-query-text     persist the query text on the audit row (off by default)
  --no-events            skip the local search_events audit row
  --backend <pglite>     compatibility option; memsearch is no longer supported
  --help

Run scripts/setup-memory.sh to migrate old .memsearch data into the new store.`;

/**
 * Split argv into the chosen backend/rung and passthrough argv handed
 * verbatim to the rung's script. `--backend`, `--expand`, and `--transcript`
 * are consumed here and not forwarded.
 */
function parseArgs(argv) {
  const passthrough = [];
  const positional = [];
  let backend;
  let topK;
  let json = false;
  let help = false;
  let expandChunkId;
  let transcriptChunkId;
  let flagsTeamApi = false;
  let flagsLocal = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--backend") {
      backend = argv[(i += 1)];
      continue;
    }
    if (arg === "--expand") {
      expandChunkId = argv[(i += 1)];
      continue;
    }
    if (arg === "--transcript") {
      transcriptChunkId = argv[(i += 1)];
      continue;
    }
    if (arg === "--top-k") {
      topK = Number(argv[i + 1]);
      passthrough.push(arg, argv[(i += 1)]);
      continue;
    }
    if (arg === "--json") {
      json = true;
      passthrough.push(arg);
      continue;
    }
    if (arg === "--team-api") {
      flagsTeamApi = true;
      passthrough.push(arg);
      continue;
    }
    if (arg === "--local") {
      flagsLocal = true;
      passthrough.push(arg);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (VALUE_FLAGS.includes(arg)) {
      passthrough.push(arg, argv[(i += 1)]);
      continue;
    }
    if (arg.startsWith("--")) {
      passthrough.push(arg); // bare flags + unknowns: let the rung's script judge
      continue;
    }
    positional.push(arg);
    passthrough.push(arg);
  }

  const bothGiven = expandChunkId !== undefined && transcriptChunkId !== undefined;
  const rung = expandChunkId !== undefined ? "expand" : transcriptChunkId !== undefined ? "transcript" : "search";
  const rungChunkId = expandChunkId ?? transcriptChunkId;

  return {
    backend,
    topK,
    json,
    help,
    teamApi: flagsTeamApi,
    local: flagsLocal,
    rung,
    rungChunkId,
    bothGiven,
    query: positional.join(" ").trim(),
    passthrough,
  };
}

function hasSavedTeamLogin() {
  const config = readConfigOptional();
  return Boolean(config);
}

/**
 * The dispatch decision, factored out and dependency-injected so it can be unit
 * tested without spawning real processes. `runPrimary(args, rung)` returns
 * `{ code, stdout, stderr }`.
 */
function decideAndRun({ flags, env, runPrimary, out, err, hasTeamLogin = () => false }) {
  const write = out ?? ((s) => process.stdout.write(s));
  const warn = err ?? ((s) => process.stderr.write(s.endsWith("\n") ? s : `${s}\n`));

  if (flags.bothGiven) {
    warn("memory-recall: --expand and --transcript are mutually exclusive.");
    return 1;
  }

  let memoryMode;
  try {
    memoryMode = requestedMemoryMode(flags, env);
  } catch (error) {
    warn(`memory-recall: ${error instanceof Error ? error.message : error}`);
    return 1;
  }

  const rung = flags.rung ?? "search";
  const signedIn = hasTeamLogin();
  const willUseTeamApi = memoryMode === "team" || (memoryMode === "auto" && signedIn);

  if (rung === "transcript" && willUseTeamApi) {
    warn(
      "memory-recall: --transcript reads local transcript files only in this phase. " +
        "Use --local to run transcript drill-down against local PGLite.",
    );
    return 1;
  }

  if (!willUseTeamApi) {
    const backend = (flags.backend ?? env.MEMORY_BACKEND ?? "pglite").toLowerCase();
    if (backend === "memsearch") {
      warn(
        "memory-recall: the legacy memsearch backend has been removed. " +
          "Run scripts/setup-memory.sh to migrate old .memsearch data into PGLite/Postgres.",
      );
      return 2;
    }
    if (!VALID_BACKENDS.includes(backend)) {
      warn(
        `memory-recall: --backend / MEMORY_BACKEND must be ${VALID_BACKENDS.join(", ")} ` +
          `(got "${backend}")`,
      );
      return 1;
    }
  }

  const args = rung === "search" ? flags.passthrough : [flags.rungChunkId, ...flags.passthrough];
  const primary = runPrimary(args, rung);
  if (primary.code === 0) {
    write(primary.stdout ?? "");
    return 0;
  }

  if (primary.stderr) warn(primary.stderr.trimEnd());
  if (primary.code === 3) {
    warn("memory-recall: memory store unavailable. Run scripts/setup-memory.sh to set it up.");
  }
  return primary.code;
}

/** Spawn the rung's CLI and capture its result. */
function runPrimary(args, rung, { searchScript, expandScript, transcriptScript }) {
  const script = rung === "expand" ? expandScript : rung === "transcript" ? transcriptScript : searchScript;
  const res = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  if (res.error) {
    return {
      code: 1,
      stdout: "",
      stderr: `memory-recall: failed to run ${path.basename(script)}: ${res.error.message}\n`,
    };
  }
  return { code: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const scripts = {
    searchScript: path.join(__dirname, "memory-search.cjs"),
    expandScript: path.join(__dirname, "memory-expand.cjs"),
    transcriptScript: path.join(__dirname, "memory-transcript.cjs"),
  };

  return decideAndRun({
    flags,
    env: process.env,
    runPrimary: (args, rung) => runPrimary(args, rung, scripts),
    hasTeamLogin: hasSavedTeamLogin,
  });
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { parseArgs, decideAndRun, runPrimary };

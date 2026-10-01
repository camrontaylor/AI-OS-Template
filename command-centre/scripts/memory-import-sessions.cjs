#!/usr/bin/env node
/**
 * memory-import-sessions — import prior Claude Code sessions into memory.
 *
 * Live capture (the Stop hook) only records the current session as it happens.
 * This backfills history: it discovers Claude Code's own transcripts under
 * `~/.claude/projects/`, this repo's existing archives under
 * `context/transcripts/`, or any explicit path, summarizes each session into the
 * same machine-owned `context/memory/{date}.aos.md` blocks the live hook writes,
 * then runs the existing indexer so the result is searchable.
 *
 * It is USER-CONTROLLED — it never imports old conversations silently:
 *   - `--dry-run` (or a bare non-TTY run) only reports what is available.
 *   - A bare TTY run opens an interactive menu (source → size → confirm).
 *   - Explicit flags drive a scriptable, non-interactive import.
 *
 * Idempotent: re-running skips already-imported, unchanged sessions, and even a
 * forced re-run cannot duplicate a block (capture's `source:${hash}` dedup).
 *
 * The .ts library is loaded via the shared leaf-first loader (no build step).
 */

const path = require("node:path");
const readline = require("node:readline/promises");

const { findWorkspaceRoot } = require("./workspace-root.cjs");
const { loadMemoryModules } = require("./load-memory-modules.cjs");
const {
  ensureLocalUserId,
  readLocalUserId,
} = require("./local-memory-identity.cjs");

// ── Load the memory module graph (incl. capture + session-import). ──────────
const { backend, scope, store, embedder, indexer, sessionImport } = loadMemoryModules({
  withImport: true,
});

const KIND_BY_FROM = {
  current: "current-workspace",
  global: "global",
  archive: "aos-archive",
  other: "other",
};
const SUMMARY_MODES = ["session", "turn", "none"];

const USAGE = `memory-import-sessions — import prior Claude Code sessions into memory

A bare run in a terminal opens an interactive menu. Otherwise use flags.

Source:
  --from <current|global|archive|other>   default: current  (which history to import)
  --source <path>                         explicit file/folder for --from other (repeatable)

Size (newest first; default: most recent 30):
  --all                                   all unimported sessions in the source
  --sessions <N>                          most recent N
  --days <N>                              sessions from the past N days
  --since <YYYY-MM-DD>  --until <YYYY-MM-DD>   explicit date range

Summary:
  --summary <session|turn|none>           default: session (one summary per session)
                                          turn = one block per turn; none = raw digest (no LLM)

Scope (local PGLite defaults to the stable private owner):
  --visibility <system|team|client|private>
  --team <id> | --client <slug> | --user <id>
  Hosted Postgres requires an explicit --visibility.
  --allow-shared                          allow system/team/client import into a HOSTED store

Other:
  --copy-raw                              also copy raw transcripts locally (gitignored)
  --force / --reimport                    re-import already-imported sessions
  --embedder <bge-m3|hash>                default: bge-m3 (or $MEMORY_EMBEDDER)
  --dry-run                               report counts only; no writes
  --interactive                           force the interactive menu
  --json                                  machine-readable detection output
  --yes / -y                              skip the confirmation prompt
  --help`;

// ── Flag parsing. ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const flags = { sources: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[(i += 1)];
    switch (arg) {
      case "--from": flags.from = next(); break;
      case "--source": case "--root": flags.sources.push(next()); break;
      case "--all": flags.all = true; break;
      case "--sessions": case "--max": flags.sessions = Number(next()); break;
      case "--days": flags.days = Number(next()); break;
      case "--since": flags.since = next(); break;
      case "--until": flags.until = next(); break;
      case "--summary": flags.summary = next(); break;
      case "--visibility": flags.visibility = next(); break;
      case "--team": flags.team = next(); break;
      case "--client": flags.client = next(); break;
      case "--user": flags.user = next(); break;
      case "--allow-shared": flags.allowShared = true; break;
      case "--copy-raw": flags.copyRaw = true; break;
      case "--force": case "--reimport": flags.force = true; break;
      case "--embedder": flags.embedder = next(); break;
      case "--dry-run": flags.dryRun = true; break;
      case "--interactive": flags.interactive = true; break;
      case "--json": flags.json = true; break;
      case "--yes": case "-y": flags.yes = true; break;
      case "--help": case "-h": flags.help = true; break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return flags;
}

function buildScope(flags, { backendKind, rootDir, readOnly = false }) {
  if (backendKind === "postgres" && !flags.visibility) {
    throw new Error(
      "Hosted Postgres requires an explicit --visibility. Refusing to guess where personal sessions belong.",
    );
  }
  const visibility = flags.visibility ?? "private";
  const valid = ["system", "team", "client", "private"];
  if (!valid.includes(visibility)) {
    throw new Error(`--visibility must be one of: ${valid.join(", ")}`);
  }
  let userId = flags.user ?? null;
  if (backendKind === "pglite" && visibility === "private" && !userId) {
    userId = readOnly
      ? readLocalUserId(rootDir) || "local-dry-run"
      : ensureLocalUserId(rootDir);
  }
  const s = scope.normalizeScope({
    teamId: flags.team ?? null,
    clientId: flags.client ?? null,
    userId,
    visibility,
  });
  scope.assertValidScope(s); // throws if a required id is missing
  return s;
}

function isSharedHostedScope(backendKind, normalizedScope) {
  return (
    backendKind === "postgres" &&
    ["system", "team", "client"].includes(normalizedScope.visibility)
  );
}

function parseDateMs(value, endOfDay) {
  if (!value) return undefined;
  const ms = Date.parse(endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59Z` : value);
  if (Number.isNaN(ms)) throw new Error(`Invalid date: ${value}`);
  return ms;
}

/** A limit spec from flags. Default: most recent 30. */
function limitFromFlags(flags) {
  if (flags.all) return { mode: "all" };
  if (Number.isFinite(flags.sessions)) return { mode: "recent", count: flags.sessions };
  if (Number.isFinite(flags.days)) return { mode: "days", days: flags.days };
  if (flags.since || flags.until) {
    return { mode: "range", sinceMs: parseDateMs(flags.since, false), untilMs: parseDateMs(flags.until, true) };
  }
  return { mode: "recent", count: 30 };
}

function hasSelectionFlags(flags) {
  return Boolean(
    flags.from || flags.all || flags.sessions != null || flags.days != null ||
      flags.since || flags.until || (flags.sources?.length ?? 0) > 0,
  );
}

function shouldUseReadOnlyScope(flags, isTTY) {
  return Boolean(
    flags.dryRun ||
      flags.json ||
      (!flags.interactive && !hasSelectionFlags(flags) && !isTTY),
  );
}

function printReports(reports) {
  if (reports.length === 0) {
    console.log("  (no candidate sessions detected)");
    return;
  }
  const label = {
    "current-workspace": "Current workspace",
    global: "All Claude Code history",
    "aos-archive": "Existing AI-OS archives",
    other: "Other path",
  };
  for (const r of reports) {
    console.log(
      `  ${label[r.sourceKind].padEnd(30)} ${r.total} total, ` +
        `${r.alreadyImported} imported, ${r.available} available`,
    );
  }
}

// ── Interactive menu (the required 7-step flow). ────────────────────────────
async function interactiveFlow(rl, ctx) {
  const present = ctx.reports.filter((r) => r.available > 0 || r.total > 0);
  if (present.length === 0) {
    console.log("\nNothing to import — no candidate sessions detected.");
    return null;
  }

  // Steps 1-3: choose a source, show its counts.
  console.log("\nWhich sessions would you like to import?");
  const labels = {
    "current-workspace": "Current workspace sessions",
    global: "All Claude Code history (every project)",
    "aos-archive": "Existing AI-OS archives",
    other: "Other path you provide",
  };
  present.forEach((r, i) => {
    console.log(`  ${i + 1}) ${labels[r.sourceKind]} — ${r.available} available (${r.total} total)`);
  });
  const sourceAns = await rl.question(`Choose a source [1-${present.length}]: `);
  const chosen = present[Number(sourceAns) - 1];
  if (!chosen) {
    console.log("Cancelled.");
    return null;
  }

  let available = sessionImport.candidatesForKind(ctx.candidates, chosen.sourceKind);
  available = available.filter((c) => sessionImport.importStatus(ctx.ledger, c) !== "imported");
  if (available.length === 0) {
    console.log("All sessions from that source are already imported. Nothing to do.");
    return null;
  }

  // Step 4: warn.
  console.log(
    "\nHeads up:\n" +
      "  • Importing older conversations can take a while.\n" +
      "  • Summarization may use your Claude subscription usage.\n" +
      "  • You can import a few now and more later — nothing is lost.",
  );

  // Step 5: choose size.
  console.log("\nHow many? (newest first)");
  console.log("  1) All unimported");
  console.log("  2) Most recent 30");
  console.log("  3) Past 30 days");
  console.log("  4) Custom number");
  console.log("  5) Custom days");
  const sizeAns = (await rl.question("Choose [1-5]: ")).trim();
  let spec;
  if (sizeAns === "1") spec = { mode: "all" };
  else if (sizeAns === "2") spec = { mode: "recent", count: 30 };
  else if (sizeAns === "3") spec = { mode: "days", days: 30 };
  else if (sizeAns === "4") spec = { mode: "recent", count: Number((await rl.question("How many sessions? ")).trim()) };
  else if (sizeAns === "5") spec = { mode: "days", days: Number((await rl.question("How many days? ")).trim()) };
  else {
    console.log("Cancelled.");
    return null;
  }

  const selected = sessionImport.selectSessions(available, spec, ctx.now);
  if (selected.length === 0) {
    console.log("That selection matched no sessions. Nothing to do.");
    return null;
  }

  // Step 6: final preview + confirm.
  console.log(
    `\nDetected ${chosen.total} sessions, ${chosen.alreadyImported} already imported, ` +
      `${chosen.available} available. Import ${selected.length} from "${labels[chosen.sourceKind]}"? ` +
      "This may take time and use Claude subscription usage.",
  );
  const confirm = (await rl.question("Proceed? [y/N]: ")).trim().toLowerCase();
  if (confirm !== "y" && confirm !== "yes") {
    console.log("Cancelled.");
    return null;
  }
  return { selected };
}

async function runIndex(rootDir, baseScope, embedderKind, dataDir) {
  const emb = await embedder.createEmbedder({ kind: embedderKind });
  const memStore = await store.openMemoryStore({ dataDir, embedDim: emb.dim });
  try {
    return await indexer.indexSources({
      store: memStore,
      embedder: emb,
      scope: baseScope,
      rootDir,
      reason: "backfill", // reuse the existing backfill reason for imported memory
      log: (msg) => console.log(`  ${msg}`),
    });
  } finally {
    await memStore.close();
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }

  const summaryMode = flags.summary ?? "session";
  if (!SUMMARY_MODES.includes(summaryMode)) {
    throw new Error(`--summary must be one of: ${SUMMARY_MODES.join(", ")}`);
  }

  const rootDir = process.env.AI_OS_DIR
    ? path.resolve(process.env.AI_OS_DIR)
    : findWorkspaceRoot(__dirname);
  process.env.MEMORY_MODEL_CACHE_DIR =
    process.env.MEMORY_MODEL_CACHE_DIR || path.join(rootDir, ".command-centre", "models");
  const dataDir = path.join(rootDir, ".command-centre", "memory");
  const resolvedBackend = backend.resolveMemoryBackend({ dataDir }, process.env);
  const readOnlyScope = shouldUseReadOnlyScope(flags, Boolean(process.stdin.isTTY));
  const baseScope = buildScope(flags, {
    backendKind: resolvedBackend.kind,
    rootDir,
    readOnly: readOnlyScope,
  });
  const now = new Date();

  // Detect candidates across every source + load the import ledger.
  const candidates = sessionImport.discoverSessions({ rootDir, extraPaths: flags.sources });
  const ledger = sessionImport.loadLedger(rootDir);
  const reports = sessionImport.reportSources(candidates, ledger);

  if (flags.json) {
    console.log(JSON.stringify({ rootDir, reports }, null, 2));
    return 0;
  }

  console.log(`memory-import-sessions → ${rootDir}`);
  console.log(`  backend: ${resolvedBackend.kind}`);
  console.log(
    `  scope: visibility=${baseScope.visibility} team=${baseScope.teamId ?? "-"} ` +
      `client=${baseScope.clientId ?? "-"} user=${baseScope.userId ?? "-"}`,
  );
  console.log("\nDetected sources:");
  printReports(reports);

  if (flags.dryRun) {
    console.log("\n[dry-run] No data written.");
    return 0;
  }

  // Privacy guard: do not push personal history into a SHARED hosted scope
  // without explicit consent. Local PGLite 'system' is just the local baseline.
  const sharedHosted = isSharedHostedScope(resolvedBackend.kind, baseScope);
  if (sharedHosted && !flags.allowShared) {
    console.error(
      "\nmemory-import-sessions: refusing to import into a SHARED hosted scope.\n" +
        `  A hosted Postgres store is configured and --visibility is ` +
        `${baseScope.visibility}, so imported personal sessions would be shared.\n` +
        "  Re-run with --allow-shared to confirm, or use --visibility private --user <id>.",
    );
    return 2;
  }

  // Decide selection: interactive menu vs flag-driven.
  const wantInteractive =
    flags.interactive || (!hasSelectionFlags(flags) && Boolean(process.stdin.isTTY));

  let selected;
  if (wantInteractive) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const result = await interactiveFlow(rl, { candidates, ledger, reports, now });
      if (!result) return 0;
      selected = result.selected;
    } finally {
      rl.close();
    }
  } else {
    if (!hasSelectionFlags(flags) && !process.stdin.isTTY) {
      console.log(
        "\nNothing imported. Re-run with a source/size selection (e.g. --from current --sessions 30)\n" +
          "or in a terminal for the interactive menu. Use --help for options.",
      );
      return 0;
    }
    const kind = KIND_BY_FROM[flags.from ?? "current"];
    if (!kind) throw new Error(`--from must be one of: ${Object.keys(KIND_BY_FROM).join(", ")}`);
    let available = sessionImport.candidatesForKind(candidates, kind);
    if (!flags.force) {
      available = available.filter((c) => sessionImport.importStatus(ledger, c) !== "imported");
    }
    selected = sessionImport.selectSessions(available, limitFromFlags(flags), now);
    if (selected.length === 0) {
      console.log("\nNothing to import for that source/size (already imported, or none matched).");
      return 0;
    }
    console.log(
      `\nImporting ${selected.length} session(s) from "${flags.from ?? "current"}" ` +
        `(summary=${summaryMode}). This may take time and use Claude subscription usage.`,
    );
    if (!flags.yes && process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        const confirm = (await rl.question("Proceed? [y/N]: ")).trim().toLowerCase();
        if (confirm !== "y" && confirm !== "yes") {
          console.log("Cancelled.");
          return 0;
        }
      } finally {
        rl.close();
      }
    }
  }

  // Import (writes blocks + ledger). The real summarizer runs unless mode=none.
  console.log("\nImporting…");
  const summary = await sessionImport.importSessions({
    rootDir,
    candidates: selected,
    summaryMode,
    copyRaw: flags.copyRaw === true,
    force: flags.force === true,
    ledger,
    now,
    log: (msg) => console.log(msg),
  });

  console.log("\n── import summary ──────────────────────");
  console.log(`  imported : ${summary.imported}`);
  console.log(`  skipped  : ${summary.skipped}`);
  console.log(`  failed   : ${summary.failed}`);
  console.log(`  turns    : ${summary.turnsImported}`);
  console.log(`  blocks   : ${summary.blocksWritten}`);

  if (summary.blocksWritten === 0) {
    console.log("\nNo new memory blocks — nothing to index. Memory is already up to date.");
    return summary.failed > 0 ? 1 : 0;
  }

  // Index so the imported memory is searchable (same path as memory:index).
  console.log("\nIndexing imported memory…");
  try {
    const indexSummary = await runIndex(rootDir, baseScope, flags.embedder, dataDir);
    console.log(
      `  indexed ${indexSummary.sourcesIndexed} source(s), ` +
        `${indexSummary.chunksInserted} chunk(s). Memory is now searchable.`,
    );
  } catch (error) {
    console.error(`  indexing failed: ${error instanceof Error ? error.message : error}`);
    console.error("  Blocks were written — run `npm run memory:index` to make them searchable.");
    return 1;
  }

  return summary.failed > 0 ? 1 : 0;
}

module.exports = {
  buildScope,
  isSharedHostedScope,
  parseArgs,
  shouldUseReadOnlyScope,
};

if (require.main === module) {
  main()
    .then((code) => {
      // Drain the event loop instead of process.exit(): forcing exit aborts
      // onnxruntime-node's native teardown (mutex lock failed → SIGABRT).
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`\nmemory-import-sessions failed: ${error instanceof Error ? error.message : error}`);
      if (error && error.stack) console.error(error.stack);
      console.error(`\n${USAGE}`);
      process.exitCode = 1;
    });
}

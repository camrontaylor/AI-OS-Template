#!/usr/bin/env node
/**
 * memory-warmup — download/load the production embedding model.
 *
 * Setup and update call this before reindexing so users can see that the BGE-M3
 * model may download and that the wait is expected.
 */

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { findWorkspaceRoot } = require("./workspace-root.cjs");
const { loadMemoryModules } = require("./load-memory-modules.cjs");

const { embedder } = loadMemoryModules({ withCapture: false });

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    if (arg === "--quiet") flags.quiet = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

const USAGE = `memory-warmup — download/load the BGE-M3 embedding model

Usage:
  node scripts/memory-warmup.cjs [--quiet]`;

const FRESH_RETRY_ENV = "AI_OS_MEMORY_WARMUP_FRESH_RETRY";

function progressBar(percent) {
  const width = 28;
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
}

function makeProgressLogger({ quiet }) {
  if (quiet) return () => {};
  let lastShown = -1;
  return (event) => {
    const status = event?.status ?? "model";
    const file = event?.file ?? event?.name ?? "";
    const progress = Number(event?.progress);
    if (status === "cache-repair") {
      lastShown = -1;
      process.stderr.write(`  repairing cached ${file || "BGE-M3"} model files...\n`);
      return;
    }
    if (Number.isFinite(progress)) {
      const percent = Math.max(0, Math.min(100, Math.floor(progress)));
      if (percent === lastShown) return;
      lastShown = percent;
      const line = `  ${progressBar(percent)} ${String(percent).padStart(3)}% ${file || status}`;
      if (process.stderr.isTTY) {
        process.stderr.write(`\r${line}`);
        if (percent >= 100) process.stderr.write("\n");
      } else {
        process.stderr.write(`${line}\n`);
      }
      return;
    }
    if (status === "initiate" || status === "download") {
      process.stderr.write(`  downloading ${file || "model files"}...\n`);
    }
  };
}

function shouldRetryInFreshProcess(error) {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  return /cache repair retry failed|Protobuf parsing failed|Load model from .* failed/i.test(message);
}

function retryInFreshProcess() {
  const child = spawnSync(process.execPath, [__filename, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, [FRESH_RETRY_ENV]: "1" },
  });
  return child.status ?? 1;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }

  const rootDir = process.env.AI_OS_DIR
    ? path.resolve(process.env.AI_OS_DIR)
    : findWorkspaceRoot(__dirname);
  const cacheDir = process.env.MEMORY_MODEL_CACHE_DIR || path.join(rootDir, ".command-centre", "models");
  process.env.MEMORY_MODEL_CACHE_DIR = cacheDir;

  if (!flags.quiet) {
    console.log("memory-warmup → BGE-M3 embedding model");
    console.log(`  cache: ${cacheDir}`);
    console.log("  If the model is not cached yet, it will be downloaded now.");
  }

  const emb = await embedder.createEmbedder({
    kind: "bge-m3",
    cacheDir,
    progress: makeProgressLogger(flags),
  });
  await emb.embed(["AI-OS memory warmup"]);

  if (!flags.quiet) {
    console.log(`  ready: ${emb.model} (dim ${emb.dim})`);
  }
  return 0;
}

main()
  .then((code) => {
    // Drain the event loop instead of process.exit(): forcing exit aborts
    // onnxruntime-node's native teardown (mutex lock failed → SIGABRT / Abort trap 6).
    process.exitCode = code;
  })
  .catch((error) => {
    const quiet = process.argv.includes("--quiet");
    if (!process.env[FRESH_RETRY_ENV] && shouldRetryInFreshProcess(error)) {
      if (!quiet) {
        console.error("\nmemory-warmup repaired the model cache; retrying in a fresh Node process.");
      }
      process.exitCode = retryInFreshProcess();
      return;
    }
    console.error(`\nmemory-warmup failed: ${error instanceof Error ? error.message : error}`);
    if (error && error.stack) console.error(error.stack);
    console.error(`\n${USAGE}`);
    process.exitCode = 1;
  });

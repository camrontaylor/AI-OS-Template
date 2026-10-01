"use strict";

const path = require("node:path");
const identity = require("../src/lib/memory/local-identity.cjs");

module.exports = identity;

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--ensure") flags.ensure = true;
    else if (arg === "--root") flags.root = argv[(i += 1)];
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

const USAGE = `local-memory-identity

Usage:
  node scripts/local-memory-identity.cjs --ensure --root <AI-OS-root>

Flags:
  --ensure       create or read the stable local memory identity
  --root <path>  AI-OS workspace root
  --help`;

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }
  if (!flags.ensure || !flags.root) {
    console.error(USAGE);
    return 2;
  }
  console.log(identity.ensureLocalUserId(path.resolve(flags.root)));
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(
      `local-memory-identity failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

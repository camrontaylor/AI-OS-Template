#!/usr/bin/env bash
# Fails when command-centre/package.json or its lockfile carry a version that
# differs from VERSION. npm prints the package.json version in every
# `npm run` banner, so drift makes an up-to-date install look outdated.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

EXPECTED="$(head -n 1 VERSION | tr -d '\r[:space:]')"
if [[ -z "$EXPECTED" ]]; then
    printf 'ERROR: VERSION is empty\n' >&2
    exit 1
fi

node - "$EXPECTED" <<'EOF'
const fs = require("fs");
const expected = process.argv[2];
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const pkg = read("command-centre/package.json");
const lock = read("command-centre/package-lock.json");
const fields = [
  ["command-centre/package.json version", pkg.version],
  ["command-centre/package-lock.json version", lock.version],
  ['command-centre/package-lock.json packages[""].version', lock.packages?.[""]?.version],
];
let failures = 0;
for (const [label, actual] of fields) {
  if (actual !== expected) {
    console.error(`ERROR: ${label} is ${actual}, expected ${expected} (from VERSION)`);
    failures++;
  }
}
if (failures) {
  console.error("Fix: cd command-centre && npm version $(cat ../VERSION) --no-git-tag-version --allow-same-version");
  process.exit(1);
}
console.log(`Version sync OK: ${expected}`);
EOF

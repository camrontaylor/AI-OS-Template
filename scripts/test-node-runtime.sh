#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/lib/node-runtime.sh"

resolved="$(aios_resolve_node "$ROOT")"
actual_version="$("$resolved" --version)"
expected_version="v$(tr -d '[:space:]' < "$ROOT/.nvmrc")"

if [[ "$actual_version" != "$expected_version" ]]; then
  echo "expected $expected_version, got $actual_version from $resolved" >&2
  exit 1
fi

if [[ "$resolved" == "$(command -v node)" && "$(node --version)" != "$expected_version" ]]; then
  echo "resolver incorrectly selected the mismatched PATH runtime" >&2
  exit 1
fi

if [[ "$(cd "$ROOT/command-centre" && npm config get engine-strict)" != "true" ]]; then
  echo "npm engine-strict guard is not active for Command Centre" >&2
  exit 1
fi

if [[ "$(cd "$ROOT/scripts/cron" && npm config get engine-strict)" != "true" ]]; then
  echo "npm engine-strict guard is not active for the cron runtime" >&2
  exit 1
fi

if node "$ROOT/scripts/lib/assert-node-version.cjs" >/dev/null 2>&1; then
  if [[ "$(node --version)" != "$expected_version" ]]; then
    echo "mismatched PATH Node bypassed the executable version guard" >&2
    exit 1
  fi
fi

"$resolved" "$ROOT/scripts/lib/assert-node-version.cjs" >/dev/null

echo "node runtime resolver: passed ($actual_version via $resolved)"

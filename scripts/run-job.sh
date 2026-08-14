#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_PATH="$REPO_ROOT/scripts/cron/cron-daemon.cjs"
source "$REPO_ROOT/scripts/lib/node-runtime.sh"
NODE_BIN="$(aios_resolve_node "$REPO_ROOT")"

"$NODE_BIN" "$SCRIPT_PATH" run-job "$@"

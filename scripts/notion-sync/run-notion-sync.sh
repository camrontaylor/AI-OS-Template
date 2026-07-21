#!/usr/bin/env bash
#
# run-notion-sync.sh — run the credit-free Notion sync.
#
# This is the entry point used by the launchd job. It runs notion_sync.py
# (plain Python, no model credits), which writes context/notion/.
#
# It does NOT index memsearch. A single indexer owns the vector store: the
# nightly memsearch index job (cron/jobs/nightly-memsearch-index.md) picks up
# context/notion/ on its next run. Keeping one indexer avoids two processes
# writing the single-process Milvus Lite database at once, which can corrupt it.
#
# It is safe to run by hand at any time. Output is idempotent.

set -euo pipefail

# Resolve the repo root from this script's location:
#   scripts/notion-sync/run-notion-sync.sh -> scripts/notion-sync -> scripts -> repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "${REPO_ROOT}"

# Load NOTION_API_KEY from .env if it is not already in the environment.
# (notion_sync.py also reads .env directly; this makes the key available to any
# child process and to the log line below.)
if [ -z "${NOTION_API_KEY:-}" ] && [ -f "${REPO_ROOT}/.env" ]; then
  # shellcheck disable=SC1090
  set -a
  # Only export the key we need; do not source the whole file blindly.
  NOTION_API_KEY="$(grep -E '^NOTION_API_KEY=' "${REPO_ROOT}/.env" | head -n1 | cut -d= -f2- | tr -d '"'"'"'')"
  export NOTION_API_KEY
  set +a
fi

PYTHON_BIN="$(command -v python3 || true)"
if [ -z "${PYTHON_BIN}" ]; then
  echo "python3 not found on PATH" >&2
  exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] notion-sync: starting"

# Incremental sync only asks Notion for pages edited since the last run. That is
# cheap, but it can never see anything older than the first run and never notices
# a page deleted or archived in Notion. So roughly weekly, do a full reconcile
# against the live databases. This is the guard against the mirror silently
# drifting away from the source - it was 11 percent complete once.
#
# Gated by a stamp file, NOT by weekday: this script runs every 15 minutes, so a
# weekday test would fire a full resync ~96 times that day.
FULL_STAMP="${SCRIPT_DIR}/.last-full-sync"
FULL_EVERY_SECONDS=$((7 * 24 * 60 * 60))
SYNC_ARGS=""
now_epoch="$(date +%s)"
last_full=0
[ -f "${FULL_STAMP}" ] && last_full="$(cat "${FULL_STAMP}" 2>/dev/null || echo 0)"
case "${last_full}" in ''|*[!0-9]*) last_full=0 ;; esac
if [ $((now_epoch - last_full)) -ge ${FULL_EVERY_SECONDS} ]; then
  SYNC_ARGS="--full"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] notion-sync: weekly FULL reconcile against live Notion"
fi

# shellcheck disable=SC2086
"${PYTHON_BIN}" "${SCRIPT_DIR}/notion_sync.py" ${SYNC_ARGS}
# Only stamp after a full run actually succeeded, so a failure retries next time.
if [ -n "${SYNC_ARGS}" ]; then
  echo "${now_epoch}" > "${FULL_STAMP}"
fi
echo "[$(date '+%Y-%m-%d %H:%M:%S')] notion-sync: markdown written to context/notion/"

# Rebuild the browsable, categorised front page (context/notion/CATALOG.md) from
# the items just written. Makes zero Notion API calls, so it is credit-free and
# never blocks the sync (it exits 0 even on its own error).
"${PYTHON_BIN}" "${SCRIPT_DIR}/build_catalog.py" || true
echo "[$(date '+%Y-%m-%d %H:%M:%S')] notion-sync: catalog rebuilt (context/notion/CATALOG.md)"

# Intentionally no memsearch index here. The nightly memsearch index job is the
# single owner of the vector store and will pick up context/notion/ on its next
# run. See the header comment for why.

echo "[$(date '+%Y-%m-%d %H:%M:%S')] notion-sync: done"

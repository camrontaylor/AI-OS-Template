#!/usr/bin/env bash
# memsearch-search.sh - canonical AI-OS semantic memory search wrapper.
#
# This wrapper resolves the AI-OS collection and turns common Milvus Lite access
# failures into actionable messages. It cannot grant sandbox permissions itself.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="$(git -C "$SCRIPT_ROOT" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ]; then
  ROOT="$SCRIPT_ROOT"
fi

if [ -n "${HOME:-}" ] && [ -d "$HOME/.local/bin" ]; then
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) PATH="$PATH:$HOME/.local/bin" ;;
  esac
  export PATH
fi

usage() {
  echo "Usage: bash scripts/memsearch-search.sh \"query\" [top-k] [--scope root|client|clients|all|workspace] [--client slug]" >&2
}

if [ $# -lt 1 ] || [ -z "${1:-}" ]; then
  usage
  exit 64
fi

QUERY="$1"
shift

TOP_K="10"
MEMSEARCH_TIMEOUT_SECONDS="${AI_OS_MEMSEARCH_TIMEOUT_SECONDS:-12}"
if [ $# -gt 0 ] && [[ "${1:-}" =~ ^[0-9]+$ ]]; then
  TOP_K="$1"
  shift
fi

if ! [[ "$TOP_K" =~ ^[0-9]+$ ]] || [ "$TOP_K" -lt 1 ]; then
  echo "top-k must be a positive integer." >&2
  exit 64
fi

# Retrieve a wider candidate pool before authority reranking and reciprocal-rank
# fusion. Fetching only the requested final count meant a durable learning that
# ranked fourth semantically could never be promoted into a top-three answer,
# even when its source carried more authority than duplicate session notes.
CANDIDATE_K=$((TOP_K * 8))
[ "$CANDIDATE_K" -lt 24 ] && CANDIDATE_K=24
[ "$CANDIDATE_K" -gt 100 ] && CANDIDATE_K=100

client_from_path() {
  local path="$1"
  case "$path" in
    "$ROOT"/clients/*)
      local rest="${path#"$ROOT"/clients/}"
      printf '%s\n' "${rest%%/*}"
      ;;
    *)
      return 1
      ;;
  esac
}

DEFAULT_CLIENT="$(client_from_path "$PWD" 2>/dev/null || client_from_path "$SCRIPT_ROOT" 2>/dev/null || true)"
if [ -n "${AI_OS_MEMORY_SCOPE:-}" ]; then
  SCOPE="$AI_OS_MEMORY_SCOPE"
elif [ -n "$DEFAULT_CLIENT" ]; then
  # workspace = this client plus the root layer, never other clients. The old
  # "client" default walled client sessions off from root learnings/MEMORY
  # (2026-07-28 memory diagnosis), so cross-client voice rules and root facts
  # were unreachable exactly where most client work happens.
  SCOPE="workspace"
else
  SCOPE="root"
fi
CLIENT="${AI_OS_MEMORY_CLIENT:-$DEFAULT_CLIENT}"

while [ $# -gt 0 ]; do
  case "$1" in
    --scope)
      SCOPE="${2:-}"
      shift 2
      ;;
    --scope=*)
      SCOPE="${1#*=}"
      shift
      ;;
    --client)
      CLIENT="${2:-}"
      shift 2
      ;;
    --client=*)
      CLIENT="${1#*=}"
      shift
      ;;
    root|client|clients|all|workspace)
      SCOPE="$1"
      shift
      ;;
    *)
      echo "Unknown memory search option: $1" >&2
      exit 64
      ;;
  esac
done

if [ "$SCOPE" = "client" ] && [ -z "$CLIENT" ]; then
  echo "--scope client requires --client when not running from a client folder." >&2
  exit 64
fi

# Retrieval observability (best-effort, invisible to callers). Tag who asked so the
# usage readout can separate organic recall from eval/cron noise. See
# projects/briefs/memory-observability/brief.md.
if [ -n "${AI_OS_RECALL_CALLER:-}" ]; then
  LOG_CALLER="$AI_OS_RECALL_CALLER"
elif [ "${AI_OS_AUTONOMOUS:-}" = "1" ]; then
  LOG_CALLER="cron"
else
  LOG_CALLER="manual"
fi

# emit: print the final JSON results to stdout, then best-effort log them. Logging
# never changes stdout and runs in the BACKGROUND from its own copy, so a slow or
# contended append can never eat the caller's timeout budget (auto-recall runs this
# inside a 9s execFileSync), and the EXIT-trap cleanup of the shared temps cannot
# race the logger.
emit() {
  cat "$1"
  [ "${AI_OS_RECALL_LOG_DISABLE:-}" = "1" ] && return 0
  [ -f "$ROOT/scripts/lib/recall-log.py" ] || return 0
  command -v python3 >/dev/null 2>&1 || return 0
  local logcopy
  logcopy="$(mktemp "${TMPDIR:-/tmp}/aios-recall-log.XXXXXX" 2>/dev/null)" || return 0
  cp "$1" "$logcopy" 2>/dev/null || { rm -f "$logcopy"; return 0; }
  ( python3 "$ROOT/scripts/lib/recall-log.py" \
      --query "$QUERY" --scope "$SCOPE" --caller "$LOG_CALLER" --results-file "$logcopy" \
      >/dev/null 2>&1
    rm -f "$logcopy" ) >/dev/null 2>&1 &
}

run_markdown_fallback() {
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/aios-memsearch.md.XXXXXX")"
  if [ -x "$ROOT/scripts/memory-search.sh" ] || [ -f "$ROOT/scripts/memory-search.sh" ]; then
    args=("$QUERY" "$TOP_K" --scope "$SCOPE")
    [ -n "$CLIENT" ] && args+=(--client "$CLIENT")
    bash "$ROOT/scripts/memory-search.sh" "${args[@]}" >"$tmp" || echo "[]" >"$tmp"
  else
    echo "[]" >"$tmp"
  fi
  emit "$tmp"
  rm -f "$tmp"
}

if command -v memsearch >/dev/null 2>&1; then
  MEMSEARCH_CMD=(memsearch)
elif command -v uvx >/dev/null 2>&1; then
  MEMSEARCH_CMD=(uvx memsearch)
else
  echo "memsearch not installed - returning sandbox-safe markdown recall instead." >&2
  run_markdown_fallback
  exit 0
fi

COLLECTION="$(bash "$ROOT/scripts/lib/memsearch-collection.sh" "$ROOT")"
RAW_OUT="$(mktemp "${TMPDIR:-/tmp}/aios-memsearch.XXXXXX")"
ERR_OUT="$(mktemp "${TMPDIR:-/tmp}/aios-memsearch.err.XXXXXX")"
SEMANTIC_OUT="$(mktemp "${TMPDIR:-/tmp}/aios-memsearch.semantic.XXXXXX")"
FILTERED_SEMANTIC_OUT="$(mktemp "${TMPDIR:-/tmp}/aios-memsearch.semantic-filtered.XXXXXX")"
MARKDOWN_OUT="$(mktemp "${TMPDIR:-/tmp}/aios-memsearch.markdown.XXXXXX")"
MERGED_OUT="$(mktemp "${TMPDIR:-/tmp}/aios-memsearch.merged.XXXXXX")"
cleanup() {
  rm -f "$RAW_OUT" "$ERR_OUT" "$SEMANTIC_OUT" "$FILTERED_SEMANTIC_OUT" "$MARKDOWN_OUT" "$MERGED_OUT"
}
trap cleanup EXIT

set +e
python3 - "$MEMSEARCH_TIMEOUT_SECONDS" "${MEMSEARCH_CMD[@]}" search "$QUERY" \
  --top-k "$CANDIDATE_K" \
  --json-output \
  --collection "$COLLECTION" \
  >"$RAW_OUT" 2>"$ERR_OUT" <<'PY'
import os
import subprocess
import sys

timeout = float(sys.argv[1])
cmd = sys.argv[2:]
env = dict(os.environ)
env["GLOG_minloglevel"] = "3"
env["GRPC_VERBOSITY"] = "NONE"

try:
    completed = subprocess.run(cmd, env=env, timeout=timeout)
except subprocess.TimeoutExpired:
    print(f"AI_OS_TIMEOUT: semantic MemSearch exceeded {timeout:g}s", file=sys.stderr)
    raise SystemExit(124)

raise SystemExit(completed.returncode)
PY
STATUS=$?
set -e

if [ "$STATUS" -ne 0 ]; then
  if grep -qiE 'AI_OS_TIMEOUT|Operation not permitted|Failed to bind to address|Open local milvus failed|/LOCK|127\.0\.0\.1|DataDirLockedError|another process holds the lock' "$ERR_OUT"; then
    {
      if grep -qi 'AI_OS_TIMEOUT' "$ERR_OUT"; then
        echo "MemSearch semantic search timed out."
      else
        echo "MemSearch semantic search was blocked by Milvus Lite access."
      fi
      echo "Milvus Lite needs access to its LOCK file and a local 127.0.0.1 port even for read-only search."
      echo ""
      echo "Returning sandbox-safe markdown recall results instead."
      echo "For semantic recall, rerun this command in a shell with access to Milvus Lite."
      echo ""
      echo "Original error excerpt:"
      sed -n '1,24p' "$ERR_OUT"
    } >&2
    run_markdown_fallback
    exit 0
  fi

  cat "$ERR_OUT" >&2
  exit "$STATUS"
fi

# Scope-filter the RAW semantic results BEFORE reranking. The reranker's
# Stage 3 floor-gate derives its cutoff from the top-scoring result, so a
# high-scoring out-of-scope (wrong-client) hit would raise the gate and drop a
# correct in-scope result before scope was ever applied. Filtering first keeps
# recall scope-honest at any client count. (SCOPE=all skips the filter.)
if [ "$SCOPE" != "all" ] && [ -f "$ROOT/scripts/lib/filter-memory-results.py" ]; then
  python3 "$ROOT/scripts/lib/filter-memory-results.py" "$ROOT" "$SCOPE" "$CLIENT" "$RAW_OUT" >"$FILTERED_SEMANTIC_OUT"
else
  cp "$RAW_OUT" "$FILTERED_SEMANTIC_OUT"
fi

# Rerank the in-scope set (authority boost, recency decay, floor gating).
if [ -f "$ROOT/scripts/lib/reranker.py" ]; then
  python3 "$ROOT/scripts/lib/reranker.py" "$QUERY" <"$FILTERED_SEMANTIC_OUT" >"$SEMANTIC_OUT"
else
  cp "$FILTERED_SEMANTIC_OUT" "$SEMANTIC_OUT"
fi

if [ -f "$ROOT/scripts/memory-search.sh" ]; then
  args=("$QUERY" "$CANDIDATE_K" --scope "$SCOPE")
  [ -n "$CLIENT" ] && args+=(--client "$CLIENT")
  bash "$ROOT/scripts/memory-search.sh" "${args[@]}" >"$MARKDOWN_OUT" 2>/dev/null || printf '[]\n' >"$MARKDOWN_OUT"
else
  printf '[]\n' >"$MARKDOWN_OUT"
fi

# Merge the filtered+reranked semantic set with markdown recall, then emit + log.
if [ -f "$ROOT/scripts/lib/merge-memory-results.py" ]; then
  python3 "$ROOT/scripts/lib/merge-memory-results.py" "$SEMANTIC_OUT" "$MARKDOWN_OUT" "$TOP_K" >"$MERGED_OUT"
else
  cp "$SEMANTIC_OUT" "$MERGED_OUT"
fi
emit "$MERGED_OUT"

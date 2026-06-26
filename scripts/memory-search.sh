#!/usr/bin/env bash
# memory-search.sh - sandbox-safe markdown recall for AI-OS memory.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ $# -lt 1 ] || [ -z "${1:-}" ]; then
  echo "Usage: bash scripts/memory-search.sh \"query\" [top-k] [--scope current|root|client|clients|all] [--client slug]" >&2
  exit 64
fi

QUERY="$1"
shift

TOP_K="10"
if [ $# -gt 0 ] && [[ "${1:-}" =~ ^[0-9]+$ ]]; then
  TOP_K="$1"
  shift
fi

SCOPE="${AI_OS_MEMORY_SCOPE:-current}"
CLIENT="${AI_OS_MEMORY_CLIENT:-}"

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
    current|root|client|clients|all)
      SCOPE="$1"
      shift
      ;;
    *)
      echo "Unknown memory search option: $1" >&2
      exit 64
      ;;
  esac
done

args=("$QUERY" "$TOP_K" --root "$ROOT" --scope "$SCOPE")
if [ -n "$CLIENT" ]; then
  args+=(--client "$CLIENT")
fi

python3 "$ROOT/scripts/memory-search.py" "${args[@]}"

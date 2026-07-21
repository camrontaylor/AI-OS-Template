#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${AI_OS_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
PYTHON_BIN="${PYTHON_BIN:-$(command -v python3 || true)}"

load_env_key() {
  local file="$1"
  local key_name="$2"
  [[ -f "$file" ]] || return 0
  [[ -z "${!key_name:-}" ]] || return 0

  local line name value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "${line:0:1}" == "#" ]] && continue
    [[ "$line" == export\ * ]] && line="${line#export }"
    [[ "$line" == *=* ]] || continue

    name="${line%%=*}"
    value="${line#*=}"
    name="${name%"${name##*[![:space:]]}"}"
    [[ "$name" == "$key_name" ]] || continue

    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ "$value" == \"*\" && "$value" == *\" ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
      value="${value:1:${#value}-2}"
    fi

    export "$key_name=$value"
    return 0
  done < "$file"
}

if [[ -z "$PYTHON_BIN" ]]; then
  echo "python3 not found on PATH" >&2
  exit 1
fi

load_env_key "${AI_KEYS_ENV_FILE:-$HOME/.config/ai-keys.env}" "NOTION_API_KEY"
load_env_key "${REPO_ROOT}/.env" "NOTION_API_KEY"

AI_OS_DIR="$REPO_ROOT" "$PYTHON_BIN" "$SCRIPT_DIR/notion-resource-health.py" "$@"

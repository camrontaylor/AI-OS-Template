#!/usr/bin/env bash

# Resolve the Node runtime pinned by the AI-OS repository. Callers should use
# the returned absolute binary path instead of whichever `node` happens to be
# first on a non-interactive shell's PATH.
aios_resolve_node() {
  local root="$1"
  local pinned_version=""
  local candidate=""
  local candidate_version=""

  if [[ -f "$root/.nvmrc" ]]; then
    pinned_version="$(tr -d '[:space:]' < "$root/.nvmrc")"
  fi

  for candidate in \
    "${AI_OS_NODE_BIN:-}" \
    "$(command -v node 2>/dev/null || true)" \
    "${HOME:-}/.nvm/versions/node/v${pinned_version}/bin/node"
  do
    [[ -n "$candidate" && -x "$candidate" ]] || continue
    candidate_version="$("$candidate" --version 2>/dev/null || true)"
    if [[ -z "$pinned_version" || "$candidate_version" == "v$pinned_version" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if [[ -n "$pinned_version" ]]; then
    printf 'Pinned Node v%s is unavailable. Install the version from %s/.nvmrc.\n' \
      "$pinned_version" "$root" >&2
  else
    printf 'Node is unavailable. Install Node and retry.\n' >&2
  fi
  return 1
}

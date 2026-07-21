#!/usr/bin/env bash
# Read-only audit for the single-source client runtime link contract.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLIENTS_DIR="$ROOT/clients"
STRICT=0

if [[ "${1:-}" == "--strict" ]]; then
  STRICT=1
fi

warn_count=0

warn() {
  warn_count=$((warn_count + 1))
  printf 'WARN: %s\n' "$1"
}

info() {
  printf '%s\n' "$1"
}

canonical_path() {
  local value="$1"
  if [[ -d "$value" ]]; then
    (cd "$value" && pwd -P)
  else
    local parent
    parent="$(cd "$(dirname "$value")" && pwd -P)"
    printf '%s/%s\n' "$parent" "$(basename "$value")"
  fi
}

link_points_to() {
  local link="$1"
  local expected="$2"
  local raw
  local candidate

  [[ -L "$link" ]] || return 1
  raw="$(readlink "$link")"
  if [[ "$raw" == /* ]]; then
    candidate="$raw"
  else
    candidate="$(dirname "$link")/$raw"
  fi
  [[ -e "$candidate" ]] || return 1
  [[ "$(canonical_path "$candidate")" == "$(canonical_path "$expected")" ]]
}

check_link() {
  local expected="$1"
  local actual="$2"
  local label="$3"

  if [[ ! -L "$actual" ]]; then
    if [[ -e "$actual" ]]; then
      warn "$label is a copied path; expected a symlink to ${expected#"$ROOT/"}"
    else
      warn "$label missing"
    fi
    return
  fi

  if ! link_points_to "$actual" "$expected"; then
    warn "$label points to the wrong target: $(readlink "$actual")"
  fi
}

compare_file() {
  local src="$1"
  local dest="$2"
  local label="$3"

  if [[ ! -f "$src" ]]; then
    warn "root missing $label"
  elif [[ ! -f "$dest" ]]; then
    warn "$label missing"
  elif ! cmp -s "$src" "$dest"; then
    warn "$label differs"
  fi
}

if [[ ! -d "$CLIENTS_DIR" ]]; then
  info "No clients directory found."
  exit 0
fi

info "AI-OS client runtime link audit"
info "Root: $ROOT"
info ""

shopt -s nullglob
for client_dir in "$CLIENTS_DIR"/*/; do
  [[ -d "$client_dir" ]] || continue
  client="$(basename "$client_dir")"
  info "Client: $client"

  client_only=0
  for client_skill in "$client_dir"/.claude/skills/*; do
    [[ -d "$client_skill" ]] || continue
    skill="$(basename "$client_skill")"
    [[ "$skill" == _catalog || "$skill" == _archived ]] && continue
    if [[ ! -f "$ROOT/.claude/skills/$skill/SKILL.md" ]]; then
      client_only=$((client_only + 1))
      info "  client-only skill: $skill"
    fi
  done

  for root_skill in "$ROOT"/.claude/skills/*/; do
    [[ -f "$root_skill/SKILL.md" ]] || continue
    skill="$(basename "$root_skill")"
    check_link "$root_skill" "$client_dir/.claude/skills/$skill" "  $client/.claude/skills/$skill"
  done

  for shared_meta in _catalog _archived; do
    if [[ -d "$ROOT/.claude/skills/$shared_meta" ]]; then
      check_link "$ROOT/.claude/skills/$shared_meta" "$client_dir/.claude/skills/$shared_meta" "  $client/.claude/skills/$shared_meta"
    fi
  done

  check_link "$ROOT/.claude/settings.json" "$client_dir/.claude/settings.json" "  $client/.claude/settings.json"
  check_link "$ROOT/.claude/hooks" "$client_dir/.claude/hooks" "  $client/.claude/hooks"
  check_link "$ROOT/.claude/commands" "$client_dir/.claude/commands" "  $client/.claude/commands"
  check_link "$ROOT/cron/templates" "$client_dir/cron/templates" "  $client/cron/templates"

  for root_entry in "$ROOT"/scripts/*; do
    entry="$(basename "$root_entry")"
    case "$entry" in
      start-crons.sh|stop-crons.sh|status-crons.sh|logs-crons.sh|run-job.sh|\
      start-crons.ps1|stop-crons.ps1|status-crons.ps1|logs-crons.ps1|run-job.ps1) continue ;;
    esac
    check_link "$root_entry" "$client_dir/scripts/$entry" "  $client/scripts/$entry"
  done

  for proxy in \
    start-crons.sh stop-crons.sh status-crons.sh logs-crons.sh run-job.sh \
    start-crons.ps1 stop-crons.ps1 status-crons.ps1 logs-crons.ps1 run-job.ps1
  do
    if [[ ! -f "$client_dir/scripts/$proxy" ]]; then
      warn "  $client/scripts/$proxy missing client cron proxy"
    elif [[ -L "$client_dir/scripts/$proxy" ]]; then
      warn "  $client/scripts/$proxy must remain a real client cron proxy, not a root link"
    fi
  done

  if [[ -d "$ROOT/.claude/hooks_info" ]]; then
    for shared_info in "$ROOT"/.claude/hooks_info/*; do
      [[ -f "$shared_info" ]] || continue
      case "$(basename "$shared_info")" in
        ccnotify.db|ccnotify.log*|footer-misses.log) continue ;;
      esac
      compare_file "$shared_info" "$client_dir/.claude/hooks_info/$(basename "$shared_info")" "  $client/.claude/hooks_info/$(basename "$shared_info")"
    done
  fi

  if [[ "$client_only" -eq 0 ]]; then
    info "  client-only skill: none"
  fi
  info ""
done
shopt -u nullglob

if [[ "$warn_count" -eq 0 ]]; then
  info "OK: every shared client runtime path resolves to the root source."
else
  info "Summary: $warn_count runtime link issue(s) detected."
fi

if [[ "$STRICT" -eq 1 && "$warn_count" -gt 0 ]]; then
  exit 1
fi

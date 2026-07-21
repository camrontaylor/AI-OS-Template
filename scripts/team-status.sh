#!/usr/bin/env bash
# team-status.sh - show AI-OS team-sharing state and run the local safety gate.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) REPO_ROOT="$(cygpath -m "$REPO_ROOT")" ;; esac
source "$REPO_ROOT/scripts/lib/team.sh"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { printf "  ${GREEN}✓ %b${NC}\n" "$1"; }
warn() { printf "  ${YELLOW}→ %b${NC}\n" "$1"; }
fail() { printf "  ${RED}✗ %b${NC}\n" "$1"; }
info() { printf "  ${CYAN}%b${NC}\n" "$1"; }

read_team_field() {
  local field="$1"
  sed -n "s/.*\"$field\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$REPO_ROOT/.aios-team.json" 2>/dev/null | head -n1
}

echo ""
printf "${CYAN}${BOLD}  AI-OS Team Sharing Status${NC}\n"
echo ""

if ! git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  fail "This folder is not a git checkout."
  exit 1
fi

TEAM_SLUG=""
TEAM_BRANCH="main"
if [[ -f "$REPO_ROOT/.aios-team.json" ]]; then
  TEAM_SLUG="$(read_team_field team_slug)"
  TEAM_BRANCH="$(read_team_field team_branch)"
  [[ -z "$TEAM_BRANCH" ]] && TEAM_BRANCH="main"
  ok ".aios-team.json present"
  [[ -n "$TEAM_SLUG" ]] && info "Team repo: $TEAM_SLUG"
  info "Team branch: $TEAM_BRANCH"
else
  warn "No .aios-team.json stamp in this checkout."
fi

TEAM_REMOTE_URL="$(git -C "$REPO_ROOT" remote get-url team 2>/dev/null || true)"
if [[ -n "$TEAM_REMOTE_URL" ]]; then
  ok "Remote 'team' configured: $(team_slug_from_url "$TEAM_REMOTE_URL")"
else
  warn "No 'team' remote configured."
fi

ORIGIN_URL="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || true)"
if [[ -n "$ORIGIN_URL" ]]; then
  info "Origin: $(team_slug_from_url "$ORIGIN_URL")"
fi

if [[ -n "$TEAM_SLUG" && -n "$ORIGIN_URL" && "$ORIGIN_URL" == *"$TEAM_SLUG"* ]]; then
  warn "Origin points at the team repo. Teammates should add their own private backup later."
fi

DIRTY_COUNT="$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
if [[ "${DIRTY_COUNT:-0}" -gt 0 ]]; then
  warn "Working tree has $DIRTY_COUNT local change(s). Publish uses a clean export, but commit shared system changes first when practical."
else
  ok "Working tree clean"
fi

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aios-team-status.XXXXXX")"
cleanup() {
  [[ -n "${TMP_ROOT:-}" && -d "$TMP_ROOT" ]] && rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

echo ""
info "Running clean export leak check..."
if team_copy_shared_tree "$REPO_ROOT" "$TMP_ROOT/export"; then
  if [[ -n "$TEAM_SLUG" ]]; then
    team_write_config "$TMP_ROOT/export" "$TEAM_SLUG" "$TEAM_BRANCH"
  fi
  if team_leak_verify "$TMP_ROOT/export"; then
    ok "Clean export safety gate passes"
  else
    fail "Clean export safety gate failed"
    exit 1
  fi
else
  fail "Could not build clean export"
  exit 1
fi

echo ""
if [[ -n "$TEAM_REMOTE_URL" ]]; then
  echo "Publish with:"
  echo "  bash scripts/team-publish.sh --dry-run"
  echo "  bash scripts/team-publish.sh"
else
  echo "First publish with:"
  echo "  bash scripts/make-team-copy.sh ../AI-OS-team-starter <team-repo-url>"
  echo ""
  echo "Later publishes use:"
  echo "  bash scripts/team-publish.sh <team-repo-url>"
fi

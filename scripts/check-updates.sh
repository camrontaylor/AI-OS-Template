#!/usr/bin/env bash
set -euo pipefail

# ==========================================================
# AI-OS — Check for Updates
# Shows if upstream has new commits without pulling them.
#
# Usage: bash scripts/check-updates.sh
# ==========================================================

# ---------- Colors ----------
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

# ---------- Helpers ----------
info()    { printf "${CYAN}  %s${NC}\n" "$1"; }
success() { printf "${GREEN}  ✓ %s${NC}\n" "$1"; }
warn()    { printf "${YELLOW}  → %s${NC}\n" "$1"; }
fail()    { printf "${RED}  ✗ %s${NC}\n" "$1"; }

# ---------- Repo root from script location ----------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) REPO_ROOT="$(cygpath -m "$REPO_ROOT")" ;; esac
cd "$REPO_ROOT"

# Team checkout: follow the team repo for updates (no-op on a solo install).
if [[ -f "$REPO_ROOT/scripts/lib/team-config.sh" ]]; then
    source "$REPO_ROOT/scripts/lib/team-config.sh"
fi

# ---------- Verify git repo ----------
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
    fail "Not a git repository. Run this from the AI-OS root."
    exit 1
fi

echo ""
printf "${CYAN}${BOLD}  AI-OS — Checking for updates...${NC}\n"
echo ""

# ---------- Resolve the canonical update remote by URL ----------
# Updates come from the Camron-owned public AI-OS template, never a user's backup fork.
# Mirrors resolve_update_remote() in scripts/lib/common.sh.
UPSTREAM_SLUG="${AGENTIC_OS_UPSTREAM_SLUG:-camrontaylor/AI-OS-Template}"
UPSTREAM_BRANCH="${AGENTIC_OS_UPSTREAM_BRANCH:-main}"
UPDATE_REMOTE=""
for _remote in upstream origin $(git remote 2>/dev/null); do
    [[ "$_remote" == "$UPDATE_REMOTE" ]] && continue
    _url="$(git remote get-url "$_remote" 2>/dev/null || echo "")"
    if [[ "$_url" == *"$UPSTREAM_SLUG"* ]]; then
        UPDATE_REMOTE="$_remote"
        break
    fi
done
if [[ -z "$UPDATE_REMOTE" ]]; then
    UPDATE_URL="${AGENTIC_OS_UPSTREAM_URL:-https://github.com/$UPSTREAM_SLUG.git}"
    if ! git remote get-url upstream >/dev/null 2>&1; then
        git remote add upstream "$UPDATE_URL" 2>/dev/null || true
        UPDATE_REMOTE="upstream"
    else
        git remote add ai-os-upstream "$UPDATE_URL" 2>/dev/null || git remote set-url ai-os-upstream "$UPDATE_URL" 2>/dev/null || true
        UPDATE_REMOTE="ai-os-upstream"
    fi
    if [[ -n "$UPDATE_REMOTE" ]]; then
        success "Connected this AI-OS folder to updates from $UPSTREAM_SLUG using remote $UPDATE_REMOTE."
    fi
fi
if [[ -z "$UPDATE_REMOTE" ]]; then
    fail "No git remote points at the AI-OS update repo ($UPSTREAM_SLUG)."
    info "Run this from inside the existing AI-OS folder: bash scripts/update.sh --dry-run"
    exit 1
fi

# ---------- Fetch latest from the update remote ----------
info "Fetching from $UPDATE_REMOTE ($UPSTREAM_SLUG)..."
if ! git fetch "$UPDATE_REMOTE" "$UPSTREAM_BRANCH" --quiet 2>/dev/null; then
    fail "Could not reach $UPDATE_REMOTE. Check your connection or access token."
    exit 1
fi

# ---------- Compare local vs remote ----------
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "$UPDATE_REMOTE/$UPSTREAM_BRANCH" 2>/dev/null) || {
    fail "Could not find $UPDATE_REMOTE/$UPSTREAM_BRANCH. Is the remote configured?"
    exit 1
}

if [[ "$LOCAL" == "$REMOTE" ]]; then
    echo ""
    success "You're up to date!"
    echo ""
    exit 0
fi

BEHIND=$(git rev-list --count "HEAD..$UPDATE_REMOTE/$UPSTREAM_BRANCH" 2>/dev/null || echo 0)

if [[ "$BEHIND" -eq 0 ]]; then
    success "You're up to date! (local is ahead or diverged)"
    echo ""
    exit 0
fi

echo ""
printf "${YELLOW}  You are ${BOLD}%s commit(s)${NC}${YELLOW} behind %s/%s.${NC}\n" "$BEHIND" "$UPDATE_REMOTE" "$UPSTREAM_BRANCH"
echo ""
info "New commits:"
git log --oneline "HEAD..$UPDATE_REMOTE/$UPSTREAM_BRANCH" | while IFS= read -r line; do
    printf "    ${BOLD}•${NC} %s\n" "$line"
done
echo ""
printf "  Run ${BOLD}bash scripts/update.sh --dry-run${NC} to preview the update.\n"
printf "  Run ${BOLD}bash scripts/update.sh${NC} to apply it.\n"
echo ""

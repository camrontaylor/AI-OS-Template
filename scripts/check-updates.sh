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

trim_update_value() {
    local value="${1:-}"
    value="${value//$'\r'/}"
    value="${value//$'\n'/}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    printf "%s" "$value"
}

read_update_env_value() {
    local key="$1"

    # Update source settings intentionally come only from the root .env.
    # Long-lived shells and the Command Centre may inherit stale values.
    if [[ -f "$REPO_ROOT/.env" ]]; then
        awk -v key="$key" '
            /^[[:space:]]*#/ { next }
            {
                line = $0
                sub(/^[[:space:]]*export[[:space:]]+/, "", line)
                pattern = "^[[:space:]]*" key "[[:space:]]*="
                if (line ~ pattern) {
                    sub(pattern, "", line)
                    sub(/[[:space:]]*$/, "", line)
                    gsub(/^"|"$/, "", line)
                    gsub(/^'\''|'\''$/, "", line)
                    print line
                    exit
                }
            }
        ' "$REPO_ROOT/.env"
    fi
}

resolve_update_setting() {
    local key="$1"
    local default_value="$2"
    local value

    value="$(read_update_env_value "$key" | head -n 1)"
    value="$(trim_update_value "$value")"
    if [[ -n "$value" ]]; then
        printf '%s\n' "$value"
    else
        printf '%s\n' "$default_value"
    fi
}

validate_update_branch() {
    local branch="${1:-}"
    if [[ -z "$branch" || "$branch" == -* ]] ||
        ! git check-ref-format --branch "$branch" >/dev/null 2>&1; then
        fail "Invalid AI_OS_UPSTREAM_BRANCH: $branch"
        info "Use a valid Git branch name, for example: main, dev, or feature/test-update."
        return 1
    fi
}

# ---------- Verify git repo ----------
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
    fail "Not a git repository. Run this from the AI-OS root."
    exit 1
fi

echo ""
printf "${CYAN}${BOLD}  AI-OS — Checking for updates...${NC}\n"
echo ""

# ---------- Resolve the canonical update remote by URL ----------
# Updates come from OWNER/REPO, never a user's backup fork.
# Mirrors resolve_update_remote() in scripts/lib/common.sh.
UPSTREAM_SLUG="$(resolve_update_setting AI_OS_UPSTREAM_SLUG "")"
if [[ -z "$UPSTREAM_SLUG" ]]; then
    info "Upstream updates are disabled for this independent AI-OS copy."
    exit 0
fi
UPSTREAM_BRANCH="$(resolve_update_setting AI_OS_UPSTREAM_BRANCH main)"
validate_update_branch "$UPSTREAM_BRANCH" || exit 1
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
    fail "No git remote points at the AI-OS update repo ($UPSTREAM_SLUG)."
    info "Add one with: git remote add upstream https://<TOKEN>@github.com/$UPSTREAM_SLUG.git"
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
printf "  Run ${BOLD}bash scripts/update.sh${NC} to update.\n"
echo ""

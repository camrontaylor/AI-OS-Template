#!/usr/bin/env bash
set -euo pipefail

# revoke-access.sh — Remove a GitHub collaborator
# Usage:
#   bash scripts/admin/revoke-access.sh <github-username>
#   bash scripts/admin/revoke-access.sh <github-username> --yes

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

error() { echo -e "${RED}ERROR:${NC} $1" >&2; exit 1; }
ok()    { echo -e "${GREEN}OK:${NC} $1"; }

usage() {
  cat <<EOF
Usage:
  $(basename "$0") <github-username> [--yes]

Options:
  --yes    Skip confirmation prompt (for automation)
  --help   Show this help message

Removes a collaborator from the repository.
Requires the GitHub CLI (gh) to be installed and authenticated.
EOF
  exit 0
}

# ── Preflight ────────────────────────────────────────────────────────────────

command -v gh >/dev/null 2>&1 || error "GitHub CLI (gh) is not installed. Install it: https://cli.github.com"

if ! gh auth status >/dev/null 2>&1; then
  error "GitHub CLI is not authenticated. Run 'gh auth login' first."
fi

REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null) \
  || error "Could not detect repository. Run this from inside the repo directory."

# ── Parse args ───────────────────────────────────────────────────────────────

[[ $# -eq 0 ]] && usage

USERNAME=""
SKIP_CONFIRM=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h) usage ;;
    --yes|-y)  SKIP_CONFIRM=true ;;
    -*)        error "Unknown option: $1" ;;
    *)         USERNAME="$1" ;;
  esac
  shift
done

[[ -z "$USERNAME" ]] && error "No username provided."

# ── Confirm ──────────────────────────────────────────────────────────────────

echo -e "Repository: ${GREEN}${REPO}${NC}"

if [[ "$SKIP_CONFIRM" == false ]]; then
  echo -en "${YELLOW}Remove ${USERNAME} from ${REPO}? (y/N):${NC} "
  read -r ANSWER
  case "$ANSWER" in
    [yY]|[yY][eE][sS]) ;;
    *) echo "Aborted."; exit 0 ;;
  esac
fi

# ── Remove ───────────────────────────────────────────────────────────────────

echo -n "Removing ${USERNAME}... "

if gh api \
  --method DELETE \
  -H "Accept: application/vnd.github+json" \
  "repos/${REPO}/collaborators/${USERNAME}" \
  --silent 2>/dev/null; then
  ok "Removed ${USERNAME} from ${REPO}"
else
  error "Failed to remove ${USERNAME}. They may not be a collaborator."
fi

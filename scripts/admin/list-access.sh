#!/usr/bin/env bash
set -euo pipefail

# list-access.sh — List all collaborators and pending invitations
# Usage: bash scripts/admin/list-access.sh

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

error() { echo -e "${RED}ERROR:${NC} $1" >&2; exit 1; }

# ── Preflight ────────────────────────────────────────────────────────────────

command -v gh >/dev/null 2>&1 || error "GitHub CLI (gh) is not installed. Install it: https://cli.github.com"

if ! gh auth status >/dev/null 2>&1; then
  error "GitHub CLI is not authenticated. Run 'gh auth login' first."
fi

REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null) \
  || error "Could not detect repository. Run this from inside the repo directory."

echo -e "Repository: ${GREEN}${REPO}${NC}"
echo ""

# ── Active collaborators ─────────────────────────────────────────────────────

echo -e "${BOLD}Active Collaborators${NC}"
echo "──────────────────────────────────────────────────"
printf "${CYAN}%-25s %-15s %-10s${NC}\n" "USERNAME" "PERMISSION" "STATUS"
echo "──────────────────────────────────────────────────"

COLLAB_COUNT=0

gh api \
  -H "Accept: application/vnd.github+json" \
  "repos/${REPO}/collaborators" \
  --paginate \
  -q '.[] | "\(.login)\t\(.role_name)\taccepted"' 2>/dev/null | \
while IFS=$'\t' read -r login role status; do
  printf "%-25s %-15s ${GREEN}%-10s${NC}\n" "$login" "$role" "$status"
  ((COLLAB_COUNT++)) || true
done

# ── Pending invitations ──────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}Pending Invitations${NC}"
echo "──────────────────────────────────────────────────"
printf "${CYAN}%-25s %-15s %-10s${NC}\n" "USERNAME" "PERMISSION" "STATUS"
echo "──────────────────────────────────────────────────"

PENDING_COUNT=0

gh api \
  -H "Accept: application/vnd.github+json" \
  "repos/${REPO}/invitations" \
  --paginate \
  -q '.[] | "\(.invitee.login)\t\(.permissions)\tpending"' 2>/dev/null | \
while IFS=$'\t' read -r login permissions status; do
  printf "%-25s %-15s ${YELLOW}%-10s${NC}\n" "$login" "$permissions" "$status"
  ((PENDING_COUNT++)) || true
done

echo ""
echo "──────────────────────────────────────────────────"
echo -e "Run ${CYAN}bash scripts/admin/grant-access.sh <username>${NC} to add users"
echo -e "Run ${CYAN}bash scripts/admin/revoke-access.sh <username>${NC} to remove users"

#!/usr/bin/env bash
set -euo pipefail

# grant-access.sh — Add GitHub collaborator(s) with read (pull) access
# Usage:
#   bash scripts/admin/grant-access.sh <github-username>
#   bash scripts/admin/grant-access.sh --file users.txt

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# ── Helpers ──────────────────────────────────────────────────────────────────

error() { echo -e "${RED}ERROR:${NC} $1" >&2; exit 1; }
warn()  { echo -e "${YELLOW}WARN:${NC} $1" >&2; }
ok()    { echo -e "${GREEN}OK:${NC} $1"; }

usage() {
  cat <<EOF
Usage:
  $(basename "$0") <github-username>
  $(basename "$0") --file <path-to-usernames-file>

Options:
  --file <file>   Read one GitHub username per line from <file>
  --help          Show this help message

Adds user(s) as collaborators with pull (read-only) permission.
Requires the GitHub CLI (gh) to be installed and authenticated.
EOF
  exit 0
}

# ── Preflight ────────────────────────────────────────────────────────────────

command -v gh >/dev/null 2>&1 || error "GitHub CLI (gh) is not installed. Install it: https://cli.github.com"

if ! gh auth status >/dev/null 2>&1; then
  error "GitHub CLI is not authenticated. Run 'gh auth login' first."
fi

# Detect repo from current git remote / gh context
REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null) \
  || error "Could not detect repository. Run this from inside the repo directory."

echo -e "Repository: ${GREEN}${REPO}${NC}"

# ── Invite a single user ────────────────────────────────────────────────────

invite_user() {
  local username="$1"

  # Skip blank lines and comments
  [[ -z "$username" || "$username" == \#* ]] && return 0

  echo -n "Inviting ${username}... "

  HTTP_CODE=$(gh api \
    --method PUT \
    -H "Accept: application/vnd.github+json" \
    "repos/${REPO}/collaborators/${username}" \
    -f permission=pull \
    --silent \
    2>&1) && true

  STATUS=$?

  if [[ $STATUS -eq 0 ]]; then
    ok "Invited ${username} to ${REPO} with read access"
  else
    warn "Failed to invite ${username} — ${HTTP_CODE}"
  fi
}

# ── Parse args ───────────────────────────────────────────────────────────────

[[ $# -eq 0 ]] && usage

MODE="single"
TARGET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h) usage ;;
    --file)
      MODE="batch"
      shift
      [[ $# -eq 0 ]] && error "--file requires a path argument"
      TARGET="$1"
      ;;
    -*)
      error "Unknown option: $1"
      ;;
    *)
      TARGET="$1"
      ;;
  esac
  shift
done

[[ -z "$TARGET" ]] && error "No username or file provided."

# ── Execute ──────────────────────────────────────────────────────────────────

if [[ "$MODE" == "batch" ]]; then
  [[ -f "$TARGET" ]] || error "File not found: ${TARGET}"
  COUNT=0
  while IFS= read -r line; do
    username=$(echo "$line" | xargs) # trim whitespace
    if [[ -n "$username" && "$username" != \#* ]]; then
      invite_user "$username"
      ((COUNT++)) || true
    fi
  done < "$TARGET"
  echo ""
  ok "Processed ${COUNT} username(s) from ${TARGET}"
else
  invite_user "$TARGET"
fi

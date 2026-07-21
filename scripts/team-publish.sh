#!/usr/bin/env bash
# team-publish.sh - publish a clean AI-OS system snapshot to the team repo.
#
# Usage:
#   bash scripts/team-publish.sh <team-repo-url> [--branch main] [--dry-run]
#
# This never pushes from the maintainer's working repo. It builds a temporary
# clean checkout, copies only the shared system into it, runs the leak verifier,
# commits there, and pushes that isolated tree.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) REPO_ROOT="$(cygpath -m "$REPO_ROOT")" ;; esac
source "$REPO_ROOT/scripts/lib/team.sh"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { printf "  ${GREEN}✓ %b${NC}\n" "$1"; }
warn() { printf "  ${YELLOW}→ %b${NC}\n" "$1"; }
info() { printf "  ${CYAN}%b${NC}\n" "$1"; }

usage() {
  cat <<'EOF'
Usage:
  bash scripts/team-publish.sh <team-repo-url> [--branch main] [--dry-run] [--allow-dirty]

Examples:
  bash scripts/team-publish.sh git@github.com:your-org/ai-os-team.git
  bash scripts/team-publish.sh git@github.com:your-org/ai-os-team.git --dry-run

If <team-repo-url> is omitted, the script tries the local 'team' remote.
EOF
}

TEAM_URL=""
TEAM_BRANCH="main"
DRY_RUN=false
ALLOW_DIRTY=false
COMMIT_MESSAGE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)
      TEAM_BRANCH="${2:-}"
      [[ -n "$TEAM_BRANCH" ]] || { echo "ERROR: --branch needs a value" >&2; exit 2; }
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    --allow-dirty)
      ALLOW_DIRTY=true
      ;;
    -m|--message)
      COMMIT_MESSAGE="${2:-}"
      [[ -n "$COMMIT_MESSAGE" ]] || { echo "ERROR: --message needs a value" >&2; exit 2; }
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "ERROR: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ -n "$TEAM_URL" ]]; then
        echo "ERROR: unexpected extra argument: $1" >&2
        usage >&2
        exit 2
      fi
      TEAM_URL="$1"
      ;;
  esac
  shift
done

if [[ -z "$TEAM_URL" ]]; then
  TEAM_URL="$(git -C "$REPO_ROOT" remote get-url team 2>/dev/null || true)"
fi

if [[ -z "$TEAM_URL" ]]; then
  echo "ERROR: no team repo URL found." >&2
  echo "Pass one explicitly, for example:" >&2
  echo "  bash scripts/team-publish.sh git@github.com:your-org/ai-os-team.git" >&2
  exit 2
fi

TEAM_SLUG="$(team_slug_from_url "$TEAM_URL")"
if [[ -z "$COMMIT_MESSAGE" ]]; then
  COMMIT_MESSAGE="Publish AI-OS team system $(date +%Y-%m-%d)"
fi

if ! git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: run this from inside an AI-OS git checkout." >&2
  exit 1
fi

if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]] && ! $ALLOW_DIRTY; then
  echo "ERROR: working tree has uncommitted changes." >&2
  echo "Commit the shared system changes first, or rerun with --allow-dirty if this is deliberate." >&2
  exit 1
fi

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aios-team-publish.XXXXXX")"
cleanup() {
  [[ -n "${TMP_ROOT:-}" && -d "$TMP_ROOT" ]] && rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

PUBLISH_REPO="$TMP_ROOT/repo"
mkdir -p "$PUBLISH_REPO"

echo ""
printf "${CYAN}${BOLD}  Publishing clean AI-OS team copy${NC}\n"
echo ""
info "Source:      $REPO_ROOT"
info "Team repo:   $TEAM_SLUG"
info "Branch:      $TEAM_BRANCH"
$DRY_RUN && warn "Dry run only - no commit will be pushed."
echo ""

git -C "$PUBLISH_REPO" init -q
git -C "$PUBLISH_REPO" remote add team "$TEAM_URL"

if git -C "$PUBLISH_REPO" fetch team "$TEAM_BRANCH" --quiet 2>/dev/null; then
  git -C "$PUBLISH_REPO" checkout -q -B "$TEAM_BRANCH" "FETCH_HEAD"
else
  warn "No existing $TEAM_BRANCH branch fetched from team remote - preparing a fresh branch."
  git -C "$PUBLISH_REPO" checkout -q --orphan "$TEAM_BRANCH"
fi

find "$PUBLISH_REPO" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
team_copy_shared_tree "$REPO_ROOT" "$PUBLISH_REPO"
team_write_config "$PUBLISH_REPO" "$TEAM_SLUG" "$TEAM_BRANCH"

if ! team_leak_verify "$PUBLISH_REPO"; then
  echo ""
  echo "ABORTING: private data found in the clean publish tree (see above)."
  echo "Nothing was committed or pushed."
  exit 1
fi
ok "Leak check passed"

git -C "$PUBLISH_REPO" add -A

if git -C "$PUBLISH_REPO" diff --cached --quiet; then
  ok "Team repo already matches the current clean system export."
  exit 0
fi

if $DRY_RUN; then
  ok "Dry run passed. Pending publish diff:"
  git -C "$PUBLISH_REPO" diff --cached --stat
  exit 0
fi

git -C "$PUBLISH_REPO" \
  -c user.name="AI-OS" \
  -c user.email="noreply@ai-os.local" \
  commit -qm "$COMMIT_MESSAGE"

git -C "$PUBLISH_REPO" push -u team "$TEAM_BRANCH"

echo ""
ok "Published clean team system to $TEAM_SLUG ($TEAM_BRANCH)."
echo "  Teammates can update with: bash scripts/update.sh"

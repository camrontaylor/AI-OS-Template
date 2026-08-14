#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/lib/path-match.sh"

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok() { printf "${GREEN}  ✓ %s${NC}\n" "$1"; }
fail() { printf "${RED}  ✗ %s${NC}\n" "$1" >&2; exit 1; }
info() { printf "${CYAN}%s${NC}\n" "$1"; }

info "Running path matcher tests..."

path_matches_pattern \
  ".claude/skills/coreyhaines-marketing-ads/references/google-search-playbook.md" \
  ".claude/skills/*/references/" \
  || fail "wildcard directory prefix did not match nested skill reference"
ok "wildcard directory prefixes match nested skill support files"

path_matches_pattern \
  ".claude/skills/coreyhaines-marketing-ads/SKILL.md" \
  ".claude/skills/*/SKILL.md" \
  || fail "wildcard file pattern did not match skill file"
ok "wildcard file patterns match skill files"

if path_matches_pattern \
  ".claude/skills/coreyhaines-marketing-ads/SKILL.local.md" \
  ".claude/skills/*/SKILL.md"; then
  fail "SKILL.local.md should not match SKILL.md pattern"
fi
ok "nearby local override does not match SKILL.md pattern"

patterns="$(mktemp "${TMPDIR:-/tmp}/aios-path-match.XXXXXX")"
trap 'rm -f "$patterns"' EXIT
printf '%s\n' ".claude/skills/*/references/" "docs/" > "$patterns"

path_matches_any_file \
  ".claude/skills/coreyhaines-skills-pm/references/boards.md" \
  "$patterns" \
  || fail "pattern-file matcher did not match skill reference"
ok "pattern-file matcher uses the same wildcard directory behavior"

ok "path matcher tests passed"

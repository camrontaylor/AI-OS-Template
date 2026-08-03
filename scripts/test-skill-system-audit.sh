#!/usr/bin/env bash
set -euo pipefail

REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="${TMPDIR:-/tmp}/aios-skill-system-audit-test"
trap 'rm -rf "$TEST_ROOT"' EXIT

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok() { printf "${GREEN}  ✓ %s${NC}\n" "$1"; }
fail() { printf "${RED}  ✗ %s${NC}\n" "$1" >&2; exit 1; }
info() { printf "${CYAN}%s${NC}\n" "$1"; }

make_fixture() {
  rm -rf "$TEST_ROOT"
  mkdir -p \
    "$TEST_ROOT/repo/scripts" \
    "$TEST_ROOT/repo/context" \
    "$TEST_ROOT/repo/config" \
    "$TEST_ROOT/repo/.claude/skills/demo" \
    "$TEST_ROOT/repo/.claude/skills/_catalog" \
    "$TEST_ROOT/repo/projects/system-health"
  cp "$REAL_REPO/scripts/skill-system-audit.sh" "$TEST_ROOT/repo/scripts/skill-system-audit.sh"
  # The audit reads config/update-manifest.json for its never_publish exemption
  # set; without it the audit crashes instead of emitting the intended warning.
  printf '{"never_publish":[]}\n' > "$TEST_ROOT/repo/config/update-manifest.json"
  cat > "$TEST_ROOT/repo/.claude/skills/demo/SKILL.md" <<'EOF'
---
name: demo
description: Fixture skill.
---
# Demo
## Context Needs
None.
EOF
  printf '# Learnings\n\n## demo\n' > "$TEST_ROOT/repo/context/learnings.md"
  printf '{"core_skills":[],"skills":{}}\n' > "$TEST_ROOT/repo/.claude/skills/_catalog/catalog.json"
  printf '{"installed_skills":[],"removed_skills":[]}\n' > "$TEST_ROOT/repo/.claude/skills/_catalog/installed.json"
  cat > "$TEST_ROOT/repo/scripts/gen-skills-catalog.py" <<'EOF'
raise SystemExit(0)
EOF
  for helper in link-skills.sh client-sync-audit.sh; do
    printf '#!/usr/bin/env bash\nexit 0\n' > "$TEST_ROOT/repo/scripts/$helper"
    chmod +x "$TEST_ROOT/repo/scripts/$helper"
  done
}

info "Running skill system audit strict-mode tests..."
make_fixture

if ! bash "$TEST_ROOT/repo/scripts/skill-system-audit.sh" > "$TEST_ROOT/advisory.out"; then
  fail "advisory skill audit should report warnings without failing"
fi
grep -Fq '1 warning(s)' "$TEST_ROOT/advisory.out" || fail "fixture did not create the expected warning"
ok "advisory mode reports warnings without failing"

if bash "$TEST_ROOT/repo/scripts/skill-system-audit.sh" --strict > "$TEST_ROOT/strict.out"; then
  fail "strict skill audit must fail when warnings are present"
fi
grep -Fq '1 warning(s)' "$TEST_ROOT/strict.out" || fail "strict output lost the warning summary"
ok "strict skill audit fails on warnings"

ok "skill system audit strict-mode tests passed"

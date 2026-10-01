#!/usr/bin/env bash
set -euo pipefail

TEST_ROOT="${TMPDIR:-/tmp}/AI-OS-client-gitignore-test"
REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
TEST_REPO="${TEST_ROOT}/repo"

pass() {
  printf "  \033[0;32m✓ %s\033[0m\n" "$1"
}

fail() {
  printf "  \033[0;31m✗ %s\033[0m\n" "$1" >&2
  exit 1
}

assert_ignored() {
  local path="$1"
  local message="$2"

  git -C "$TEST_REPO" check-ignore -q "$path" || fail "$message"
  pass "$message"
}

assert_not_ignored() {
  local path="$1"
  local message="$2"

  if git -C "$TEST_REPO" check-ignore -q "$path"; then
    fail "$message"
  fi
  pass "$message"
}

assert_status_contains() {
  local path="$1"
  local message="$2"
  local status

  status="$(git -C "$TEST_REPO" status --porcelain --untracked-files=all)"
  grep -Fq "?? ${path}" <<< "$status" || fail "$message"
  pass "$message"
}

assert_no_copied_shared_skills() {
  local client_rel="$1"
  local message="$2"
  local root_skill
  local skill_name

  for root_skill in "${TEST_REPO}/.claude/skills"/*/; do
    [[ -d "$root_skill" ]] || continue
    skill_name=$(basename "$root_skill")
    [[ "$skill_name" == "_catalog" ]] && continue
    if [[ -f "${TEST_REPO}/${client_rel}/.claude/skills/${skill_name}/SKILL.md" ]]; then
      fail "$message (found copied ${skill_name}/SKILL.md)"
    fi
  done
  if [[ -d "${TEST_REPO}/${client_rel}/.claude/skills/_catalog" ]]; then
    fail "$message (found copied _catalog)"
  fi
  pass "$message"
}

assert_status_not_contains() {
  local path="$1"
  local message="$2"
  local status

  status="$(git -C "$TEST_REPO" status --porcelain --untracked-files=all)"
  if grep -Fq "$path" <<< "$status"; then
    fail "$message"
  fi
  pass "$message"
}

trap 'rm -rf "$TEST_ROOT"' EXIT
rm -rf "$TEST_ROOT"

mkdir -p \
  "${TEST_REPO}/scripts" \
  "${TEST_REPO}/.claude/skills/example-shared" \
  "${TEST_REPO}/.claude/skills/_catalog" \
  "${TEST_REPO}/.claude/hooks" \
  "${TEST_REPO}/.claude/hooks_info" \
  "${TEST_REPO}/cron/templates" \
  "${TEST_REPO}/context"

cp "${REAL_REPO}/scripts/add-client.sh" "${TEST_REPO}/scripts/add-client.sh"
mkdir -p "${TEST_REPO}/scripts/lib"
cp "${REAL_REPO}/scripts/lib/python.sh" "${TEST_REPO}/scripts/lib/python.sh"

cat > "${TEST_REPO}/.claude/skills/example-shared/SKILL.md" <<'EOF'
# Example Shared Skill
EOF

cat > "${TEST_REPO}/.claude/skills/_catalog/catalog.json" <<'EOF'
{
  "skills": {
    "example-shared": {
      "description": "Example shared skill"
    }
  }
}
EOF

cat > "${TEST_REPO}/.claude/settings.json" <<'EOF'
{
  "hooks": {}
}
EOF

echo "root hook" > "${TEST_REPO}/.claude/hooks/root-hook.js"
echo "root hook info" > "${TEST_REPO}/.claude/hooks_info/root-info.md"
echo "root cron template" > "${TEST_REPO}/cron/templates/example.md"
echo "# Learnings" > "${TEST_REPO}/context/learnings.md"

git -C "$TEST_REPO" init --quiet

bash "${TEST_REPO}/scripts/add-client.sh" "Acme" > "${TEST_ROOT}/add-client.out" 2>&1

mkdir -p \
  "${TEST_REPO}/clients/acme/.claude/skills/client-only" \
  "${TEST_REPO}/clients/acme/.claude/skills/example-shared" \
  "${TEST_REPO}/clients/acme/brand_context" \
  "${TEST_REPO}/clients/acme/context/memory" \
  "${TEST_REPO}/clients/acme/projects" \
  "${TEST_REPO}/clients/acme/cron/jobs" \
  "${TEST_REPO}/clients/acme/cron/logs" \
  "${TEST_REPO}/clients/acme/cron/status"

echo "client override" > "${TEST_REPO}/clients/acme/.claude/skills/example-shared/SKILL.local.md"
echo "client-only skill" > "${TEST_REPO}/clients/acme/.claude/skills/client-only/SKILL.md"
echo '{ "skillOverrides": { "example-shared": "off" } }' > "${TEST_REPO}/clients/acme/.claude/settings.local.json"
echo "brand note" > "${TEST_REPO}/clients/acme/brand_context/profile.md"
echo "memory note" > "${TEST_REPO}/clients/acme/context/memory/2026-06-26.md"
echo "project output" > "${TEST_REPO}/clients/acme/projects/output.md"
echo "cron job" > "${TEST_REPO}/clients/acme/cron/jobs/job.md"
echo "cron log" > "${TEST_REPO}/clients/acme/cron/logs/job.log"
echo "cron status" > "${TEST_REPO}/clients/acme/cron/status/job.status"

assert_ignored \
  "clients/acme/scripts/add-client.sh" \
  "copied client scripts are ignored"

assert_ignored \
  "clients/acme/.claude/hooks/root-hook.js" \
  "copied client hooks are ignored"

assert_ignored \
  "clients/acme/.claude/settings.json" \
  "copied client shared settings are ignored"

assert_ignored \
  "clients/acme/cron/templates/example.md" \
  "copied client cron templates are ignored"

assert_ignored \
  "clients/acme/cron/logs/job.log" \
  "client cron logs are ignored"

assert_ignored \
  "clients/acme/cron/status/job.status" \
  "client cron status files are ignored"

assert_not_ignored \
  "clients/acme/.claude/skills/example-shared/SKILL.local.md" \
  "shared-skill SKILL.local.md is trackable"

assert_not_ignored \
  "clients/acme/.claude/skills/client-only/SKILL.md" \
  "client-only skills are trackable"

assert_not_ignored \
  "clients/acme/brand_context/profile.md" \
  "client brand context is trackable"

assert_not_ignored \
  "clients/acme/context/memory/2026-06-26.md" \
  "client memory is trackable"

assert_not_ignored \
  "clients/acme/projects/output.md" \
  "client projects are trackable"

assert_not_ignored \
  "clients/acme/cron/jobs/job.md" \
  "client cron jobs are trackable"

assert_status_contains \
  "clients/acme/.gitignore" \
  "generated client .gitignore appears in git status"

assert_status_contains \
  "clients/acme/.claude/skills/example-shared/SKILL.local.md" \
  "shared-skill SKILL.local.md appears in git status"

assert_status_contains \
  "clients/acme/.claude/skills/client-only/SKILL.md" \
  "client-only skill appears in git status"

assert_ignored \
  "clients/acme/.claude/settings.local.json" \
  "client settings.local.json stays local (ignored by the root .gitignore)"

assert_no_copied_shared_skills \
  "clients/acme" \
  "no shared skill is copied into the client"

echo ""
pass "client gitignore keeps regenerated files quiet and client skill work visible"

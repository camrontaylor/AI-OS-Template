#!/usr/bin/env bash
set -euo pipefail

TEST_ROOT="${TMPDIR:-/tmp}/AI-OS-update-clients-preserve-test"
REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
TEST_REPO="${TEST_ROOT}/repo"
OUTPUT_FILE="${TEST_ROOT}/update-clients.out"

pass() {
  printf "  \033[0;32m✓ %s\033[0m\n" "$1"
}

fail() {
  printf "  \033[0;31m✗ %s\033[0m\n" "$1" >&2
  if [[ -f "$OUTPUT_FILE" ]]; then
    echo ""
    echo "update-clients.sh output:" >&2
    sed -n '1,220p' "$OUTPUT_FILE" >&2
  fi
  exit 1
}

assert_file_exists() {
  local path="$1"
  local message="$2"
  [[ -f "$path" ]] || fail "$message"
  pass "$message"
}

assert_file_contains() {
  local path="$1"
  local expected="$2"
  local message="$3"
  grep -Fq "$expected" "$path" || fail "$message"
  pass "$message"
}

assert_files_match() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  cmp -s "$expected" "$actual" || fail "$message"
  pass "$message"
}

assert_file_not_contains() {
  local path="$1"
  local unexpected="$2"
  local message="$3"
  if grep -Fq "$unexpected" "$path"; then
    fail "$message"
  fi
  pass "$message"
}

assert_path_absent() {
  local path="$1"
  local message="$2"
  if [[ -e "$path" ]]; then
    fail "$message"
  fi
  pass "$message"
}

trap 'rm -rf "$TEST_ROOT"' EXIT
rm -rf "$TEST_ROOT"

mkdir -p \
  "${TEST_REPO}/scripts" \
  "${TEST_REPO}/.claude/skills/example-skill/references" \
  "${TEST_REPO}/.claude/skills/_catalog" \
  "${TEST_REPO}/clients/acme/.claude/skills/example-skill/references" \
  "${TEST_REPO}/clients/acme/.claude/skills/_catalog" \
  "${TEST_REPO}/clients/acme/.claude/skills/client-only"

cp "${REAL_REPO}/scripts/update-clients.sh" "${TEST_REPO}/scripts/update-clients.sh"
mkdir -p "${TEST_REPO}/scripts/lib"
cp "${REAL_REPO}/scripts/lib/python.sh" "${TEST_REPO}/scripts/lib/python.sh"

# The root starts at the version the client was last synced against, and that
# version is committed. This is what a real install looks like before an update.
cat > "${TEST_REPO}/.claude/skills/example-skill/SKILL.md" <<'EOF'
# Example Skill

Old client base version that should be replaced.
EOF

cat > "${TEST_REPO}/.claude/skills/example-skill/references/root-note.md" <<'EOF'
Root reference copied during sync.
EOF

git -C "$TEST_REPO" init --quiet
git -C "$TEST_REPO" config user.email "test@example.com"
git -C "$TEST_REPO" config user.name "Test"
git -C "$TEST_REPO" add -A --force >/dev/null 2>&1
git -C "$TEST_REPO" commit --quiet -m "root at the version the client copied" >/dev/null 2>&1

# Now the root moves on, exactly as an AI-OS update would move it.
cat > "${TEST_REPO}/.claude/skills/example-skill/SKILL.md" <<'EOF'
# Example Skill

Root version after update.
EOF

git -C "$TEST_REPO" add -A --force >/dev/null 2>&1
git -C "$TEST_REPO" commit --quiet -m "root skill updated" >/dev/null 2>&1

cat > "${TEST_REPO}/.claude/skills/_catalog/catalog.json" <<'EOF'
{
  "version": "root-catalog-v2",
  "skills": {
    "example-skill": {
      "category": "utility",
      "description": "Example root skill"
    }
  }
}
EOF

cat > "${TEST_REPO}/.claude/skills/_catalog/installed.json" <<'EOF'
{
  "installed_skills": ["root-default"],
  "removed_skills": []
}
EOF

cat > "${TEST_REPO}/clients/acme/.claude/skills/example-skill/SKILL.md" <<'EOF'
# Example Skill

Old client base version that should be replaced.
EOF

cat > "${TEST_ROOT}/expected-skill-local.md" <<'EOF'
## Rules

- Keep this client-specific override exactly.
EOF
cp "${TEST_ROOT}/expected-skill-local.md" "${TEST_REPO}/clients/acme/.claude/skills/example-skill/SKILL.local.md"

cat > "${TEST_REPO}/clients/acme/.claude/skills/client-only/SKILL.md" <<'EOF'
# Client-only Skill

This skill only exists in the client workspace.
EOF

cat > "${TEST_ROOT}/expected-installed.json" <<'EOF'
{
  "installed_skills": ["client-selected"],
  "removed_skills": ["root-default"]
}
EOF
cp "${TEST_ROOT}/expected-installed.json" "${TEST_REPO}/clients/acme/.claude/skills/_catalog/installed.json"

cat > "${TEST_REPO}/clients/acme/.claude/skills/_catalog/catalog.json" <<'EOF'
{
  "version": "old-client-catalog"
}
EOF

bash "${TEST_REPO}/scripts/update-clients.sh" > "$OUTPUT_FILE" 2>&1

CLIENT_SKILL_DIR="${TEST_REPO}/clients/acme/.claude/skills/example-skill"
CLIENT_CATALOG_DIR="${TEST_REPO}/clients/acme/.claude/skills/_catalog"

assert_files_match \
  "${TEST_ROOT}/expected-skill-local.md" \
  "${CLIENT_SKILL_DIR}/SKILL.local.md" \
  "client SKILL.local.md keeps its original content"

assert_path_absent \
  "${CLIENT_SKILL_DIR}/SKILL.md" \
  "root SKILL.md is not copied into the client (inherited from the root instead)"

assert_path_absent \
  "${CLIENT_SKILL_DIR}/references" \
  "root skill reference files are not copied into the client"

assert_file_exists \
  "${TEST_REPO}/clients/acme/.claude/skills/client-only/SKILL.md" \
  "client-only skill survives client sync"

assert_path_absent \
  "$CLIENT_CATALOG_DIR" \
  "stale client _catalog copy is pruned (the root catalog is the only one)"

assert_file_contains \
  "$OUTPUT_FILE" \
  "local override(s)" \
  "sync output reports preserved local overrides"

assert_file_contains \
  "$OUTPUT_FILE" \
  "stale root skill copy" \
  "sync output reports the stale copies it pruned"

mkdir -p \
  "${TEST_REPO}/.claude/skills/future-root" \
  "${TEST_REPO}/clients/acme/.claude/skills/future-root"

cat > "${TEST_REPO}/.claude/skills/future-root/SKILL.md" <<'EOF'
# Future Root Skill

Root skill that arrived after a client-only skill already existed.
EOF

cat > "${TEST_REPO}/clients/acme/.claude/skills/future-root/SKILL.md" <<'EOF'
# Client-Owned Future Root Skill

This client-owned skill must not be overwritten by update-clients.sh.
EOF

bash "${TEST_REPO}/scripts/update-clients.sh" > "$OUTPUT_FILE" 2>&1

assert_file_contains \
  "${TEST_REPO}/clients/acme/.claude/skills/future-root/SKILL.md" \
  "client-owned skill must not be overwritten" \
  "client-owned skill is preserved when a root skill later uses the same name"

assert_file_contains \
  "$OUTPUT_FILE" \
  "shadowing a root skill of the same name" \
  "sync output warns about a client-owned skill/root skill name collision"

assert_file_not_contains \
  "${TEST_REPO}/clients/acme/.gitignore" \
  ".claude/skills/future-root/*" \
  "colliding client-owned skill is not added to generated gitignore"

# Regression: a real update stashes the untracked clients/ tree before merging
# (scripts/lib/backup.sh), which writes every client file into the object
# database as a loose object. A prune that asks only "does git have this
# content" would then classify the user's own skills as disposable root copies
# and delete them. That is invisible when update-clients.sh is called directly,
# which is why it escaped this suite. Reproduce the stash round-trip here.
mkdir -p "${TEST_REPO}/clients/acme/.claude/skills/acme-authored/references"

cat > "${TEST_REPO}/clients/acme/.claude/skills/acme-authored/SKILL.md" <<'EOF'
# Acme Authored Skill

Written by the user inside the client. It exists nowhere at the root.
EOF

cat > "${TEST_REPO}/clients/acme/.claude/skills/acme-authored/references/notes.md" <<'EOF'
Supporting file the user wrote by hand.
EOF

# Compared with line endings normalised: the stash round-trip itself rewrites
# LF to CRLF on Windows when core.autocrlf is on, which is a separate defect in
# the update flow and not something this prune controls. What matters here is
# that the content survives.
ACME_AUTHORED_SUM="$(tr -d '\r' < "${TEST_REPO}/clients/acme/.claude/skills/acme-authored/SKILL.md" | git hash-object --stdin)"

# Put the user's files into the object database exactly the way an update does,
# then drop the stash so the objects are present but unreachable.
git -C "$TEST_REPO" stash push --all --quiet -- "clients/acme/.claude/skills/acme-authored" >/dev/null 2>&1 || true
git -C "$TEST_REPO" stash pop --quiet >/dev/null 2>&1 || true

ACME_AUTHORED_BLOB="$(git -C "$TEST_REPO" hash-object "${TEST_REPO}/clients/acme/.claude/skills/acme-authored/SKILL.md")"
if ! git -C "$TEST_REPO" cat-file -e "$ACME_AUTHORED_BLOB" 2>/dev/null; then
  fail "test setup: the stash round-trip did not put the client file in the object database"
fi
pass "test setup: user-authored client file is present in the object database"

bash "${TEST_REPO}/scripts/update-clients.sh" > "$OUTPUT_FILE" 2>&1

assert_file_exists \
  "${TEST_REPO}/clients/acme/.claude/skills/acme-authored/SKILL.md" \
  "user-authored client skill survives when its content is in the object database"

assert_file_exists \
  "${TEST_REPO}/clients/acme/.claude/skills/acme-authored/references/notes.md" \
  "its supporting files survive too"

if [[ "$(tr -d '\r' < "${TEST_REPO}/clients/acme/.claude/skills/acme-authored/SKILL.md" | git hash-object --stdin)" != "$ACME_AUTHORED_SUM" ]]; then
  fail "user-authored client skill keeps its exact content"
fi
pass "user-authored client skill keeps its exact content"

echo ""
pass "update-clients preserves client overrides and skill selection state"

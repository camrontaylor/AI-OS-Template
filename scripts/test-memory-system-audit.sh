#!/usr/bin/env bash
set -euo pipefail

REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="${TMPDIR:-/tmp}/aios-memory-system-audit-test"
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
    "$TEST_ROOT/repo/scripts/lib" \
    "$TEST_ROOT/repo/context/memory" \
    "$TEST_ROOT/repo/clients/acme/context/memory" \
    "$TEST_ROOT/repo/.codex" \
    "$TEST_ROOT/repo/.claude/hooks" \
    "$TEST_ROOT/repo/cron/jobs"

  cp "$REAL_REPO/scripts/memory-system-audit.sh" "$TEST_ROOT/repo/scripts/memory-system-audit.sh"
  printf '# Memory\n' > "$TEST_ROOT/repo/context/MEMORY.md"
  printf '# Client memory\n' > "$TEST_ROOT/repo/clients/acme/context/MEMORY.md"
  : > "$TEST_ROOT/repo/.codex/config.toml"
  : > "$TEST_ROOT/repo/scripts/codex-hook.sh"
  : > "$TEST_ROOT/repo/.claude/hooks/session-memory-finalizer.js"
  : > "$TEST_ROOT/repo/.claude/hooks/skills-parity-check.js"
  : > "$TEST_ROOT/repo/scripts/lib/skills-parity-check.sh"
  : > "$TEST_ROOT/repo/scripts/test-session-memory-finalizer.sh"

  printf '{"hooks":["session-memory-finalizer.js","skills-parity-check.js"]}\n' > "$TEST_ROOT/repo/.codex/hooks.json"
  printf '{"hooks":["session-memory-finalizer.js","skills-parity-check.js"]}\n' > "$TEST_ROOT/repo/.claude/settings.json"

  cat > "$TEST_ROOT/repo/.claude/hooks/load-memory-snapshot.js" <<'EOF'
process.stdout.write('### SOUL - agent identity\n### USER - profile and preferences\n### MEMORY - curated working scratchpad\n');
EOF

  cat > "$TEST_ROOT/repo/scripts/client-sync-audit.sh" <<'EOF'
#!/usr/bin/env bash
echo 'WARN: fixture client drift'
exit 1
EOF
  chmod +x "$TEST_ROOT/repo/scripts/client-sync-audit.sh"

  for job in \
    client-memory-distill client-memory-gaps client-memory-evaluator \
    client-memory-curator semantic-memory-health meta-doc-drift \
    skill-eval-coverage notion-docs-coverage workspace-health-steward \
    notion-resource-health nightly-memsearch-index nightly-memory-backup; do
    : > "$TEST_ROOT/repo/cron/jobs/$job.md"
  done

  cat > "$TEST_ROOT/repo/scripts/notion-resource-health.sh" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  chmod +x "$TEST_ROOT/repo/scripts/notion-resource-health.sh"
  printf 'runner: shell\ncommand: bash scripts/notion-resource-health.sh\n' > "$TEST_ROOT/repo/cron/jobs/notion-resource-health.md"

  cat > "$TEST_ROOT/repo/scripts/memsearch-reindex.sh" <<'EOF'
for client_dir in clients/*/; do
  echo context/MEMORY.md context/learnings.md
done
EOF
}

info "Running memory system audit strict-mode tests..."
make_fixture

if ! bash "$TEST_ROOT/repo/scripts/memory-system-audit.sh" > "$TEST_ROOT/advisory.out"; then
  fail "advisory audit should report warnings without failing"
fi
grep -Fq '1 warning(s)' "$TEST_ROOT/advisory.out" || fail "fixture did not create the expected warning"
ok "advisory mode reports warnings without failing"

if bash "$TEST_ROOT/repo/scripts/memory-system-audit.sh" --strict > "$TEST_ROOT/strict.out"; then
  fail "strict audit must fail when warnings are present"
fi
grep -Fq '1 warning(s)' "$TEST_ROOT/strict.out" || fail "strict output lost the warning summary"
ok "strict mode fails on warnings"

ok "memory system audit strict-mode tests passed"

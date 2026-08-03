#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/health-rollup-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
FAKE="$WORK/root"

mkdir -p "$FAKE/projects/system-health" "$FAKE/projects/ops-cron" "$FAKE/.command-centre"
cat > "$FAKE/projects/ops-cron/narrative.md" <<'EOF'
# Proposal
# Trigger: every prior run failed
This paragraph explains why a historical approach failed every run.
EOF
cat > "$FAKE/projects/system-health/real.md" <<'EOF'
# Health
- Critical: active regression requires repair
EOF

AI_OS_ROOT="$FAKE" AI_OS_HEALTH_ESCALATE_DISABLE=1 python3 "$ROOT/scripts/health-rollup.py" >/dev/null

grep -q 'active regression requires repair' "$FAKE/.command-centre/health-rollup.md"
if grep -qE 'historical approach|every prior run' "$FAKE/.command-centre/health-rollup.md"; then
  echo "narrative prose was incorrectly promoted to a health finding" >&2
  exit 1
fi

echo "health-rollup report parsing: passed"

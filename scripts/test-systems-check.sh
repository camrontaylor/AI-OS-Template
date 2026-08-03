#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK="$ROOT/.claude/skills/meta-systems-check/scripts/check.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/systems-check-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
FAKE="$WORK/root"

mkdir -p \
  "$FAKE/cron/status" "$FAKE/cron/jobs" \
  "$FAKE/skills-library/backlog/promoted" \
  "$FAKE/skills-library/resources"

cat > "$FAKE/cron/status/disabled-job.json" <<'EOF'
{"consecutive_fail_count": 9}
EOF
cat > "$FAKE/cron/jobs/disabled-job.md" <<'EOF'
---
active: 'false'
---
EOF
cat > "$FAKE/cron/status/live-job.json" <<'EOF'
{"consecutive_fail_count": 3}
EOF
cat > "$FAKE/cron/jobs/live-job.md" <<'EOF'
---
active: 'true'
---
EOF
cat > "$FAKE/skills-library/sources.json" <<'EOF'
{
  "sources": [],
  "candidates": [
    {"repo": "example/promoted", "vendored_to": "backlog/promoted"}
  ],
  "resources": []
}
EOF

AI_OS_ROOT="$FAKE" bash "$CHECK" > "$WORK/out.txt"

grep -q 'live-job(3x)' "$WORK/out.txt"
if grep -q 'disabled-job' "$WORK/out.txt"; then
  echo "disabled cron status was incorrectly reported" >&2
  exit 1
fi
if grep -q 'orphan: backlog/promoted' "$WORK/out.txt"; then
  echo "registered candidate was incorrectly reported as orphaned" >&2
  exit 1
fi

echo "systems-check regressions: passed"

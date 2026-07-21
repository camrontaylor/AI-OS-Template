#!/usr/bin/env bash
# Tests the passive distiller: reads `### Corrections` from daily logs and
# promotes them into the scope-correct learnings.md, skipping placeholders,
# deduping on re-run.
set -euo pipefail

REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
ok() { printf "${GREEN}  ✓ %s${NC}\n" "$1"; }
fail() { printf "${RED}  ✗ %s${NC}\n" "$1" >&2; exit 1; }
info() { printf "${CYAN}%s${NC}\n" "$1"; }

TODAY="$(date +%F)"
TMP="${TMPDIR:-/tmp}/cc-distill-test.$$"
mkdir -p "$TMP/.claude" "$TMP/context/memory" "$TMP/clients/acme/context/memory" "$TMP/scripts"
printf '# AI-OS\n' > "$TMP/AGENTS.md"
printf '# Client: Acme\n' > "$TMP/clients/acme/AGENTS.md"
# the distiller calls the real writer via $ROOT/scripts/capture-correction.sh
cp "$REAL_REPO/scripts/capture-correction.sh" "$TMP/scripts/capture-correction.sh"
cleanup() { trash "$TMP" 2>/dev/null || /bin/rm -rf "$TMP"; }
trap cleanup EXIT

# root daily log: one real correction, one placeholder, one template hint
cat > "$TMP/context/memory/$TODAY.md" <<EOF
# $TODAY

## Session 1
<!-- aios-session-id: test -->

### Goal
Build the thing

### Corrections
- Wrong: claimed the daemon needs a restart to see new jobs. Actual: it re-scans the jobs dir each tick. Lesson: check readdir cadence before claiming a restart is needed.
- None yet.
- [Only when you were confirmed wrong this session. Omit otherwise.]

### Open threads
- more to do
EOF

# client daily log: one real client correction
cat > "$TMP/clients/acme/context/memory/$TODAY.md" <<EOF
# $TODAY

## Session 1
<!-- aios-session-id: test2 -->

### Corrections
- Wrong: assumed Acme wanted long replies. Actual: they want short ones. Lesson: keep Acme replies short.
EOF

info "Running correction-distill tests..."
out="$(bash "$REAL_REPO/scripts/correction-distill.sh" "$TMP")"

# 1) real root correction promoted to root learnings
grep -Fq "check readdir cadence before claiming a restart is needed" "$TMP/context/learnings.md" \
  || fail "root correction was not promoted to root learnings.md"
ok "real root correction promoted to root learnings.md"

# 2) placeholder + template hint skipped (not in learnings)
grep -Fq "None yet" "$TMP/context/learnings.md" 2>/dev/null && fail "placeholder 'None yet' leaked into learnings"
grep -Fq "Only when you were confirmed wrong" "$TMP/context/learnings.md" 2>/dev/null && fail "template hint leaked into learnings"
ok "placeholder and template-hint bullets skipped"

# 3) client correction promoted to CLIENT learnings, not root
grep -Fq "keep Acme replies short" "$TMP/clients/acme/context/learnings.md" \
  || fail "client correction not promoted to client learnings.md"
grep -Fq "keep Acme replies short" "$TMP/context/learnings.md" 2>/dev/null && fail "client correction leaked into ROOT learnings"
ok "client correction stays in the client folder"

# 4) summary line present
[[ "$out" == *"captured"* ]] || fail "no summary line in output"
ok "prints a summary line"

# 5) dedup on re-run: second run captures 0
out2="$(bash "$REAL_REPO/scripts/correction-distill.sh" "$TMP")"
[[ "$out2" == *"0 captured"* ]] || fail "re-run should capture 0 (dedup), got: $out2"
ok "re-run is idempotent (dedup holds)"

ok "correction-distill tests passed"

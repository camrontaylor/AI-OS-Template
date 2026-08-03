#!/usr/bin/env bash
# test-decision-ledger.sh - stress tests for the Decision Ledger.
#
# Proves the surfacer (scripts/lib/decision_ledger.py, used by the current-state
# brief) and the health guard (scripts/decision-ledger-check.sh) behave under
# every input a hand-written ledger can throw at them: missing file, empty file,
# retired-only, clean-settled, gated, chronic churn, proposed, malformed, and
# adversarial values (colon in value, non-numeric count, unicode, stray bullet).
# Hermetic: temp fixtures only, never touches a real decisions.md.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$SCRIPT_DIR/lib/decision_ledger.py"
GUARD="$SCRIPT_DIR/decision-ledger-check.sh"
PY="${AI_OS_PYTHON:-python3}"

PASS=0
FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/dltest.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
echo "workdir: $WORK"

surface() { "$PY" "$LIB" surface "$1" 2>&1; }
check()   { "$PY" "$LIB" check "$1" 2>&1; }

# --- 1. missing file: no crash, empty surface, clean check -----------------
echo "test 1: missing ledger file"
out="$(surface "$WORK/nope.md")"; rc=$?
{ [ "$rc" -eq 0 ] && [ -z "$out" ]; } && ok "surface empty, exit 0" || bad "surface rc=$rc out=[$out]"
out="$(check "$WORK/nope.md")"; rc=$?
{ [ "$rc" -eq 0 ] && [ -z "$out" ]; } && ok "check clean, exit 0" || bad "check rc=$rc out=[$out]"

# --- 2. empty file ---------------------------------------------------------
echo "test 2: empty ledger"
: > "$WORK/empty.md"
[ -z "$(surface "$WORK/empty.md")" ] && ok "no section" || bad "surfaced something"
[ -z "$(check "$WORK/empty.md")" ] && ok "clean" || bad "flagged something"

# --- 3. retired-only: hidden and exempt ------------------------------------
echo "test 3: retired entry is hidden and not checked"
cat > "$WORK/retired.md" <<'EOF'
# Ledger
## Old thing
- Status: Retired
- Call: we used to do X
EOF
[ -z "$(surface "$WORK/retired.md")" ] && ok "retired not surfaced" || bad "retired surfaced"
[ -z "$(check "$WORK/retired.md")" ] && ok "retired not flagged (exempt)" || bad "retired flagged"

# --- 4. clean settled decision: hidden, clean ------------------------------
echo "test 4: clean settled decision is hidden"
cat > "$WORK/clean.md" <<'EOF'
# Ledger
## Naming
- Status: Decided
- Decided: 2026-07-23
- Call: Grow / Pro / Scale
- Reopen gate: the offer changes on Orchestra, verified live
- Gate met: n/a
- Reopened: 0
EOF
[ -z "$(surface "$WORK/clean.md")" ] && ok "settled not surfaced" || bad "settled surfaced"
[ -z "$(check "$WORK/clean.md")" ] && ok "settled clean" || bad "settled flagged"

# --- 5. gated decision (gate met: no) surfaces -----------------------------
echo "test 5: gated decision surfaces"
cat > "$WORK/gated.md" <<'EOF'
# Ledger
## Positioning
- Status: Decided
- Call: AI workflow implementation
- Reopen gate: 10 qualified buyer replies
- Gate met: no
- Reopened: 0
EOF
surface "$WORK/gated.md" | grep -q "Open Decisions" && ok "surfaced" || bad "not surfaced"
surface "$WORK/gated.md" | grep -q "Positioning" && ok "names the decision" || bad "missing topic"

# --- 6. chronic churn (reopened 4) surfaces and is flagged CHRONIC ----------
echo "test 6: chronic churn flagged"
cat > "$WORK/chronic.md" <<'EOF'
# Ledger
## Positioning
- Status: Reopened
- Call: rewritten again
- Reopen gate: a paid buyer
- Gate met: no
- Reopened: 4 (rewritten four times)
EOF
surface "$WORK/chronic.md" | grep -q "Reopened 4x" && ok "surfacer shows 4x" || bad "count wrong"
out="$(check "$WORK/chronic.md")"; rc=$?
echo "$out" | grep -q "^CHRONIC|" && ok "check flags CHRONIC" || bad "no CHRONIC ($out)"
[ "$rc" -eq 1 ] && ok "check exit 1 on chronic" || bad "check exit $rc"

# --- 7. proposed decision surfaces (user owns it) --------------------------
echo "test 7: proposed decision surfaces"
cat > "$WORK/proposed.md" <<'EOF'
# Ledger
## Offer
- Status: Proposed
- Call: wedge-first
- Reopen gate: pick the wedge
- Gate met: n/a
- Reopened: 0
EOF
surface "$WORK/proposed.md" | grep -q "Offer" && ok "proposed surfaced" || bad "proposed hidden"

# --- 7b. escalated chronic decision stays visible but is not re-flagged -----
echo "test 7b: escalated chronic decision is visible and exempt from churn alarm"
cat > "$WORK/escalated.md" <<'EOF'
# Ledger
## Positioning
- Status: Escalated
- Call: hold current language
- Reopen gate: buyer evidence
- Gate met: no
- Reopened: 4
EOF
surface "$WORK/escalated.md" | grep -q "Positioning" && ok "escalated surfaced" || bad "escalated hidden"
[ -z "$(check "$WORK/escalated.md")" ] && ok "escalated not re-flagged chronic" || bad "escalated re-flagged"

# --- 8. malformed entry flagged, no crash ----------------------------------
echo "test 8: malformed entry flagged but does not crash"
cat > "$WORK/malformed.md" <<'EOF'
# Ledger
## Half an entry
- Status: Decided
- Reopened: 0
EOF
out="$(surface "$WORK/malformed.md")"; rc=$?
[ "$rc" -eq 0 ] && ok "surface did not crash" || bad "surface crashed rc=$rc"
# Capture first: `check` exits 1 on findings, and pipefail would propagate that
# through `check | grep` even when grep matches.
cout="$(check "$WORK/malformed.md")"
echo "$cout" | grep -q "^MALFORMED|" && ok "check flags MALFORMED" || bad "no MALFORMED"
echo "$cout" | grep -q "missing field" && ok "names missing fields" || bad "no field detail"

# --- 9. adversarial values do not crash or mis-parse -----------------------
echo "test 9: adversarial values"
cat > "$WORK/adver.md" <<'EOF'
# Ledger
## Pricing decisiön
- Status: Decided
- Call: use a 1:1 credit ratio; see http://x.test/a:b
- Reopen gate: n/a
- Gate met: no
- Reopened: many times
- a stray bullet with no colon
EOF
out="$(surface "$WORK/adver.md")"; rc=$?
[ "$rc" -eq 0 ] && ok "no crash on adversarial input" || bad "crashed rc=$rc"
echo "$out" | grep -q "1:1 credit ratio" && ok "colon-in-value preserved" || bad "value mangled"
echo "$out" | grep -q "Reopened 0x" && ok "non-numeric count parses to 0" || bad "count parse wrong"

# --- 10. no doubled period when a field value ends in a period --------------
echo "test 10: no doubled period"
cat > "$WORK/period.md" <<'EOF'
# Ledger
## Thing
- Status: Decided
- Call: whatever
- Reopen gate: something
- Gate met: no. Tracker shows 0 replies.
- Reopened: 0
EOF
surface "$WORK/period.md" | grep -q '\.\.' && bad "doubled period present" || ok "no doubled period"

# --- 11. guard end-to-end on a temp ROOT -----------------------------------
echo "test 11: guard aggregates across a temp ROOT and writes a report"
FAKE="$WORK/root"; mkdir -p "$FAKE/context" "$FAKE/clients/acme/context"
cat > "$FAKE/context/decisions.md" <<'EOF'
# Ledger
## System thing
- Status: Decided
- Call: x
- Reopen gate: y
- Gate met: n/a
- Reopened: 0
EOF
cp "$WORK/chronic.md" "$FAKE/clients/acme/context/decisions.md"
AI_OS_ROOT="$FAKE" bash "$GUARD" >"$WORK/guard.out" 2>&1; rc=$?
grep -q "1 chronic" "$WORK/guard.out" && ok "guard counts the chronic client" || bad "guard miscounted ($(cat "$WORK/guard.out"))"
[ "$rc" -eq 1 ] && ok "guard exit 1 on chronic" || bad "guard exit $rc"
ls "$FAKE/projects/system-health/"*_decision-ledger-check.md >/dev/null 2>&1 && ok "report written to system-health" || bad "no report written"

# --- 12. guard --strict exits nonzero only under --strict for malformed -----
echo "test 12: guard --strict on malformed"
FAKE2="$WORK/root2"; mkdir -p "$FAKE2/context"
cp "$WORK/malformed.md" "$FAKE2/context/decisions.md"
AI_OS_ROOT="$FAKE2" bash "$GUARD" >/dev/null 2>&1; rc_default=$?
AI_OS_ROOT="$FAKE2" bash "$GUARD" --strict >/dev/null 2>&1; rc_strict=$?
[ "$rc_default" -eq 0 ] && ok "malformed alone: exit 0 by default" || bad "default exit $rc_default"
[ "$rc_strict" -eq 1 ] && ok "malformed under --strict: exit 1" || bad "strict exit $rc_strict"

# --- 13. bad python is a loud failure, never a silent pass ------------------
echo "test 13: missing python fails loudly"
FAKE3="$WORK/root3"; mkdir -p "$FAKE3/context"; cp "$WORK/clean.md" "$FAKE3/context/decisions.md"
AI_OS_ROOT="$FAKE3" AI_OS_PYTHON=/nonexistent/python3 bash "$GUARD" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 2 ] && ok "exit 2 when python missing" || bad "did not fail loudly (exit $rc)"

echo ""
echo "==================================="
echo "PASS: $PASS   FAIL: $FAIL"
echo "==================================="
[ "$FAIL" -eq 0 ]

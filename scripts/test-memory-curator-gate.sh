#!/usr/bin/env bash
# test-memory-curator-gate.sh - stress tests for the deterministic MEMORY.md curator.
#
# Runs entirely on temp fixtures; never touches the real context/MEMORY.md.
# Proves the cap holds AND that no active fact is ever silently lost: resolved
# false-positives stay hot, wrapped entries survive intact, unknown sections are
# preserved, eviction takes the stalest first, and every failure is loud.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$SCRIPT_DIR/memory-curator-gate.sh"
HYGIENE="$SCRIPT_DIR/lib/memory-hygiene.py"
CAP=2500
TARGET=2300

PASS=0
FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

padstr() { printf '%*s' "$1" '' | tr ' ' x; }
sizeof() { wc -c < "$1" | tr -d ' '; }
curate() { python3 "$HYGIENE" curate --file "$1" --cap "$CAP" --target "$TARGET" --archive "$2"; }

run_gate() {
  local dir="$1"; shift
  env AI_OS_MEMORY_FILE="$dir/MEMORY.md" \
      AI_OS_MEMORY_ARCHIVE="$dir/archive/MEMORY-archive.md" \
      AI_OS_MEMORY_STATUS="$dir/status.json" \
      "$@" bash "$GATE"
}

# Dated fixture: three active threads (old/mid/new), one env note, one decision.
# $2 pads the OLDEST thread so it alone can push the file over cap.
gen() {
  local f="$1" pad="$2"
  {
    echo "<!-- Cap: 2,500 chars. Curated scratchpad. -->"
    echo "# Working Memory"
    echo ""
    echo "## Active Threads"
    echo "- T-OLD (2026-06-01): oldest active thread $(padstr "$pad")"
    echo "- T-MID (2026-07-10): middle active thread"
    echo "- T-NEW (2026-07-22): newest active thread"
    echo ""
    echo "## Environment Notes"
    echo "- ENV-1: Melbourne AEST for all date reasoning"
    echo ""
    echo "## Pending Decisions"
    echo "- DEC-1: notion vs obsidian direction still pending"
  } > "$f"
}

WORK="$(mktemp -d "${TMPDIR:-/tmp}/memtest.XXXXXX")"
echo "workdir: $WORK"

# --- 1. under target: silent, untouched -----------------------------------
echo "test 1: under target stays silent and untouched"
d="$WORK/t1"; mkdir -p "$d"; gen "$d/MEMORY.md" 900
before="$(sizeof "$d/MEMORY.md")"
out="$(run_gate "$d" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "exit 0" || bad "exit $rc"
[ "$before" -le "$TARGET" ] && ok "fixture under target ($before)" || bad "fixture not under target ($before)"
[ "$before" -eq "$(sizeof "$d/MEMORY.md")" ] && ok "file untouched" || bad "file changed"
echo "$out" | grep -q "SILENT" && ok "reported SILENT" || bad "did not report SILENT"

# --- 2. resolved detection is STRICT: markers go, look-alikes stay (C1) ----
echo "test 2: only explicit markers are resolved; active look-alikes stay hot"
d="$WORK/t2"; mkdir -p "$d"
{
  echo "<!-- x -->"; echo "# Working Memory"; echo ""
  echo "## Active Threads"
  echo "- KEEP-1: Payment refund path is broken, needs to be fixed"
  echo "- KEEP-2: This migration is far from done"
  echo "- KEEP-3: Follow up on the ticket the vendor closed"
  echo "- GONE-1: [done] shipped the pricing page"
  echo "- GONE-2: ✅ deployed the worker"
  echo ""; echo "## Environment Notes"; echo "## Pending Decisions"
} > "$d/MEMORY.md"
curate "$d/MEMORY.md" "$d/archive/a.md" >/dev/null 2>&1
for t in KEEP-1 KEEP-2 KEEP-3; do
  grep -q "$t" "$d/MEMORY.md" && ok "$t (active, ends in fixed/done/closed) stayed hot" || bad "$t was wrongly evicted"
done
grep -q "GONE-1\|GONE-2" "$d/MEMORY.md" && bad "explicit marker not removed" || ok "explicit [done]/✅ removed from file"
grep -q "GONE-1" "$d/archive/a.md" && grep -q "GONE-2" "$d/archive/a.md" && ok "resolved entries archived (recoverable)" || bad "resolved entries not archived"

# --- 3. exact duplicate collapsed -----------------------------------------
echo "test 3: exact duplicate collapsed"
d="$WORK/t3"; mkdir -p "$d"; gen "$d/MEMORY.md" 100
# inject a duplicate of T-MID
python3 - "$d/MEMORY.md" <<'PY'
import sys
p=sys.argv[1]; t=open(p).read()
open(p,"w").write(t.replace("- T-NEW (2026-07-22): newest active thread",
  "- T-MID (2026-07-10): middle active thread\n- T-NEW (2026-07-22): newest active thread"))
PY
curate "$d/MEMORY.md" "$d/archive/a.md" >/dev/null 2>&1
[ "$(grep -c 'T-MID' "$d/MEMORY.md")" -eq 1 ] && ok "duplicate collapsed to one" || bad "duplicate not collapsed"

# --- 4. eviction: stalest active thread first, env+decisions protected (M3) -
echo "test 4: evicts oldest active thread first; env notes and decisions kept"
d="$WORK/t4"; mkdir -p "$d"; gen "$d/MEMORY.md" 2200
curate "$d/MEMORY.md" "$d/archive/a.md" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "exit 0" || bad "exit $rc"
[ "$(sizeof "$d/MEMORY.md")" -le "$CAP" ] && ok "under cap ($(sizeof "$d/MEMORY.md"))" || bad "over cap"
grep -q "T-OLD" "$d/MEMORY.md" && bad "oldest thread still hot" || ok "oldest (2026-06-01) evicted first"
grep -q "T-OLD" "$d/archive/a.md" && ok "oldest thread recoverable in archive" || bad "oldest thread lost"
grep -q "T-NEW" "$d/MEMORY.md" && ok "newest thread kept hot" || bad "newest wrongly evicted"
grep -q "ENV-1" "$d/MEMORY.md" && ok "environment note preserved" || bad "env note wrongly evicted"
grep -q "DEC-1" "$d/MEMORY.md" && ok "pending decision preserved" || bad "decision wrongly evicted"

# --- 4b. over target but under cap: cleaned, NOT evicted (recall-first) ----
echo "test 4b: entries in the 2300-2500 band are kept hot, not evicted"
d="$WORK/t4b"; mkdir -p "$d"; gen "$d/MEMORY.md" 2050
sz="$(sizeof "$d/MEMORY.md")"
curate "$d/MEMORY.md" "$d/archive/a.md" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "exit 0" || bad "exit $rc"
{ [ "$sz" -gt "$TARGET" ] && [ "$sz" -le "$CAP" ]; } && ok "fixture in the band ($sz)" || bad "fixture not in band ($sz)"
grep -q "T-OLD" "$d/MEMORY.md" && ok "oldest thread kept hot (no eviction under cap)" || bad "evicted while under cap"
[ ! -f "$d/archive/a.md" ] && ok "nothing archived under cap" || bad "archived when under cap"

# --- 5. way over cap still lands under cap ---------------------------------
echo "test 5: way over cap lands under cap"
d="$WORK/t5"; mkdir -p "$d"; gen "$d/MEMORY.md" 4600
before="$(sizeof "$d/MEMORY.md")"
curate "$d/MEMORY.md" "$d/archive/a.md" >/dev/null 2>&1; rc=$?
[ "$before" -gt 4000 ] && ok "fixture way over ($before)" || bad "fixture too small"
[ "$rc" -eq 0 ] && ok "exit 0" || bad "exit $rc"
[ "$(sizeof "$d/MEMORY.md")" -le "$CAP" ] && ok "under cap ($(sizeof "$d/MEMORY.md"))" || bad "over cap"

# --- 6. wrapped multi-line entry survives as one unit (C3) -----------------
echo "test 6: a wrapped multi-line entry is one unit (no orphaned fragment)"
d="$WORK/t6"; mkdir -p "$d"
{
  echo "<!-- x -->"; echo "# Working Memory"; echo ""
  echo "## Active Threads"
  echo "- T-WRAP (2026-06-01): first line of the wrapped thread $(padstr 2400)"
  echo "  continuation-line belongs to T-WRAP"
  echo "- T-KEEP (2026-07-22): keep me"
  echo ""; echo "## Environment Notes"; echo "## Pending Decisions"
} > "$d/MEMORY.md"
curate "$d/MEMORY.md" "$d/archive/a.md" >/dev/null 2>&1
grep -q "continuation-line" "$d/MEMORY.md" && bad "continuation left dangling in hot file" || ok "no orphaned fragment in hot file"
grep -q "continuation-line" "$d/archive/a.md" && ok "continuation moved to archive WITH its parent" || bad "continuation lost from archive"
grep -q "T-KEEP" "$d/MEMORY.md" && ok "sibling entry kept" || bad "sibling entry lost"

# --- 6b. wrapped entry under cap round-trips intact ------------------------
echo "test 6b: wrapped entry under cap round-trips intact"
d="$WORK/t6b"; mkdir -p "$d"
{
  echo "<!-- x -->"; echo "# Working Memory"; echo ""
  echo "## Active Threads"
  echo "- T-WRAP (2026-07-22): first line"
  echo "  second line of same entry"
  echo ""; echo "## Environment Notes"; echo "## Pending Decisions"
} > "$d/MEMORY.md"
curate "$d/MEMORY.md" "$d/archive/a.md" >/dev/null 2>&1
grep -q "first line" "$d/MEMORY.md" && grep -q "second line of same entry" "$d/MEMORY.md" && ok "both lines preserved" || bad "wrapped entry mangled under cap"

# --- 7. unknown 4th heading preserved verbatim (M4) -----------------------
echo "test 7: an unknown 4th heading is preserved, not folded or evicted"
d="$WORK/t7"; mkdir -p "$d"
{
  echo "<!-- x -->"; echo "# Working Memory"; echo ""
  echo "## Active Threads"; echo "- A1 (2026-07-22): active one"
  echo ""; echo "## Blockers"; echo "- B1 is urgent"; echo "- B2 also"
  echo ""; echo "## Environment Notes"; echo "- ENV-1: keep"
  echo ""; echo "## Pending Decisions"; echo "- DEC-1: keep"
} > "$d/MEMORY.md"
curate "$d/MEMORY.md" "$d/archive/a.md" >/dev/null 2>&1
grep -q "^## Blockers" "$d/MEMORY.md" && ok "unknown heading preserved as a heading" || bad "unknown heading lost/folded"
grep -q "B1 is urgent" "$d/MEMORY.md" && ok "unknown-section content preserved" || bad "unknown-section content lost"
# A1 must remain the only Active Threads bullet - B1/B2 must NOT be folded into it
python3 - "$d/MEMORY.md" <<'PY' && echo "  ok: Active Threads not polluted by unknown section" || echo "  FAIL: unknown section folded into Active Threads"
import sys,re
t=open(sys.argv[1]).read()
at=re.search(r"## Active Threads\n(.*?)\n## ",t,re.S).group(1)
sys.exit(0 if ("A1" in at and "B1 is urgent" not in at) else 1)
PY

# --- 8. gate surfaces curate's nonzero exit (M1) --------------------------
echo "test 8: a no-sections file over target fails loudly (gate reads exit code)"
d="$WORK/t8"; mkdir -p "$d"
{ echo "just prose, no section headers at all"; padstr 2400; } > "$d/MEMORY.md"
run_gate "$d" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 1 ] && ok "gate exit 1 on curate refusal" || bad "gate hid the failure (exit $rc)"
grep -q "just prose" "$d/MEMORY.md" && ok "unparseable file left intact" || bad "clobbered a file it could not parse"

# --- 9. idempotence on an OVER-CAP fixture --------------------------------
echo "test 9: curate is idempotent after real eviction"
d="$WORK/t9"; mkdir -p "$d"; gen "$d/MEMORY.md" 2200
curate "$d/MEMORY.md" "$d/archive/a.md" >/dev/null 2>&1
cp "$d/MEMORY.md" "$d/first"
curate "$d/MEMORY.md" "$d/archive/a.md" >/dev/null 2>&1
diff -q "$d/first" "$d/MEMORY.md" >/dev/null 2>&1 && ok "second run identical" || bad "not idempotent after eviction"

# --- 10. CRLF input round-trips to a valid LF file ------------------------
echo "test 10: CRLF line endings are handled"
d="$WORK/t10"; mkdir -p "$d"
printf '<!-- x -->\r\n# Working Memory\r\n\r\n## Active Threads\r\n- CR-1 (2026-07-22): crlf thread\r\n\r\n## Environment Notes\r\n## Pending Decisions\r\n' > "$d/MEMORY.md"
curate "$d/MEMORY.md" "$d/archive/a.md" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "curate handled CRLF" || bad "curate failed on CRLF (exit $rc)"
grep -q "CR-1" "$d/MEMORY.md" && ok "content preserved through CRLF normalize" || bad "content lost on CRLF"
grep -q $'\r' "$d/MEMORY.md" && bad "carriage returns left in output" || ok "output normalized to LF"

# --- 11. failed write leaves the original intact (atomic) -----------------
echo "test 11: a failed write leaves the original byte-identical"
d="$WORK/t11"; mkdir -p "$d/mem" "$d/arch"; gen "$d/mem/MEMORY.md" 2200
before="$(sizeof "$d/mem/MEMORY.md")"
chmod 500 "$d/mem"
curate "$d/mem/MEMORY.md" "$d/arch/a.md" >/dev/null 2>&1; rc=$?
chmod 700 "$d/mem"
[ "$rc" -ne 0 ] && ok "curate reported the write failure (exit $rc)" || bad "silent on write failure"
[ "$before" -eq "$(sizeof "$d/mem/MEMORY.md")" ] && ok "original byte-identical" || bad "original changed on failed write"
ls "$d/mem"/.memtmp-* >/dev/null 2>&1 && bad "left a temp turd behind" || ok "no temp file left behind"

# --- 12. no temp artifact after a normal curation -------------------------
echo "test 12: normal curation leaves no temp artifact"
d="$WORK/t12"; mkdir -p "$d"; gen "$d/MEMORY.md" 2200
curate "$d/MEMORY.md" "$d/archive/a.md" >/dev/null 2>&1
ls "$d"/.memtmp-* >/dev/null 2>&1 && bad "temp file left behind" || ok "no temp artifact"

# --- 13. missing python fails loudly --------------------------------------
echo "test 13: missing python is a loud failure, not silent drift"
d="$WORK/t13"; mkdir -p "$d"; gen "$d/MEMORY.md" 2200
run_gate "$d" AI_OS_PYTHON=/nonexistent/python3 >/dev/null 2>&1; rc=$?
[ "$rc" -eq 1 ] && ok "exit 1 when python missing" || bad "did not fail loudly (exit $rc)"

# --- 14. health status json written ---------------------------------------
echo "test 14: health status json written"
d="$WORK/t14"; mkdir -p "$d"; gen "$d/MEMORY.md" 900
run_gate "$d" >/dev/null 2>&1
[ -f "$d/status.json" ] && grep -q '"over_cap"' "$d/status.json" && ok "status json present" || bad "status json missing"

# --- 15. irreducible over-cap (huge unknown section) fails cleanly (M5) ----
echo "test 15: bloat outside curatable sections is a clean failure, not silent"
d="$WORK/t15"; mkdir -p "$d"
{
  echo "<!-- x -->"; echo "# Working Memory"; echo ""
  echo "## Active Threads"; echo "- A1 (2026-07-22): small"
  echo ""; echo "## Environment Notes"; echo "## Pending Decisions"
  echo ""; echo "## Notes"; echo "- $(padstr 2600)"
} > "$d/MEMORY.md"
curate "$d/MEMORY.md" "$d/archive/a.md" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 2 ] && ok "curate returns 2 (still over cap) - not a false success" || bad "did not report irreducible over-cap (exit $rc)"
grep -q "^## Notes" "$d/MEMORY.md" && ok "unknown bloat section preserved, not mangled" || bad "clobbered the unknown section"

echo ""
echo "==================================="
echo "PASS: $PASS   FAIL: $FAIL"
echo "==================================="
[ "$FAIL" -eq 0 ]

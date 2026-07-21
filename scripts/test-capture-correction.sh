#!/usr/bin/env bash
# Tests the backend writer for the Correction Capture (Learning Loop):
# scope resolution (root vs client), section creation, dedup, append-only.
set -euo pipefail

REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
ok() { printf "${GREEN}  ✓ %s${NC}\n" "$1"; }
fail() { printf "${RED}  ✗ %s${NC}\n" "$1" >&2; exit 1; }
info() { printf "${CYAN}%s${NC}\n" "$1"; }

TMP="${TMPDIR:-/tmp}/cc-writer-test.$$"
mkdir -p "$TMP/.claude" "$TMP/context" "$TMP/clients/acme/context"
printf '# AI-OS\n' > "$TMP/AGENTS.md"
printf '# Client: Acme Co\n' > "$TMP/clients/acme/AGENTS.md"
cleanup() { trash "$TMP" 2>/dev/null || /bin/rm -rf "$TMP"; }
trap cleanup EXIT

W="$REAL_REPO/scripts/capture-correction.sh"

info "Running capture-correction writer tests..."

# 1) root general
bash "$W" --cwd "$TMP" --wrong "asserted X" --actual "it was Y" \
  --confirmed "read the file" --lesson "verify before asserting AAA" >/dev/null
grep -Fq "verify before asserting AAA" "$TMP/context/learnings.md" \
  || fail "did not log to root learnings.md"
grep -q "## What doesn't work well" "$TMP/context/learnings.md" \
  || fail "did not create the General corrections section"
ok "root general correction lands under '## What doesn't work well'"

# 2) skill-specific -> creates skill section under # Individual Skills
bash "$W" --cwd "$TMP" --skill q-question --lesson "research first for feasibility BBB" >/dev/null
awk '/# Individual Skills/{f=1} f&&/## q-question/{found=1} END{exit !found}' "$TMP/context/learnings.md" \
  || fail "did not create the q-question skill section"
ok "skill-specific correction routes to the skill section"

# 3) dedup
out="$(bash "$W" --cwd "$TMP" --lesson "verify before asserting AAA")"
[[ "$out" == *"duplicate lesson already logged"* ]] || fail "dedup did not fire"
ok "duplicate lesson is skipped"

# 4) client routing from inside the client folder
bash "$W" --cwd "$TMP/clients/acme" --lesson "acme wants short replies CCC" >/dev/null
grep -Fq "acme wants short replies CCC" "$TMP/clients/acme/context/learnings.md" \
  || fail "did not route to client learnings.md from inside the folder"
! grep -Fq "acme wants short replies CCC" "$TMP/context/learnings.md" \
  || fail "client correction leaked into root learnings.md"
ok "client correction stays in the client folder"

# 5) client routing from root via --client
bash "$W" --cwd "$TMP" --client acme --lesson "acme prefers email over slack DDD" >/dev/null
grep -Fq "acme prefers email over slack DDD" "$TMP/clients/acme/context/learnings.md" \
  || fail "--client did not route to the client folder"
ok "--client routes a root-run correction to the client folder"

# 6) append-only: earlier entries survive
grep -Fq "verify before asserting AAA" "$TMP/context/learnings.md" \
  || fail "append-only violated: earlier root entry gone"
ok "append-only: earlier entries preserved"

ok "capture-correction writer tests passed"

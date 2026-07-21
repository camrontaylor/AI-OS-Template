#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok() { printf "${GREEN}  ✓ %s${NC}\n" "$1"; }
fail() { printf "${RED}  ✗ %s${NC}\n" "$1" >&2; exit 1; }
info() { printf "${CYAN}%s${NC}\n" "$1"; }

info "Running memory index policy tests..."

python3 - "$ROOT" <<'PY' || exit 1
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
policy = json.loads((root / "config" / "memory-index-policy.json").read_text(encoding="utf-8"))
tiers = policy.get("tiers", {})
required_tiers = {"routine_semantic", "selective_semantic_candidates", "deep_search_only", "excluded"}
missing = required_tiers - set(tiers)
if missing:
    raise SystemExit(f"Missing policy tiers: {sorted(missing)}")

routine = set(tiers["routine_semantic"].get("paths", []))
required_routine = {
    "context/MEMORY.md",
    "context/memory/",
    "context/learnings.md",
    "clients/*/context/MEMORY.md",
    "clients/*/context/memory/",
    "clients/*/context/learnings.md",
}
if not required_routine <= routine:
    raise SystemExit(f"Routine semantic tier missing: {sorted(required_routine - routine)}")

deep = set(tiers["deep_search_only"].get("paths", []))
for path in ["clients/*/context/inbox/", "clients/*/context/intake/", "clients/*/projects/"]:
    if path not in deep:
        raise SystemExit(f"Deep-search tier missing: {path}")

selective = set(tiers["selective_semantic_candidates"].get("paths", []))
if "clients/*/context/reference/**/*.md" not in selective:
    raise SystemExit("Client reference files must be selective semantic candidates.")

script = (root / "scripts" / "memsearch-reindex.sh").read_text(encoding="utf-8")
for snippet in [
    "add_source context/MEMORY.md",
    "add_source context/memory/",
    "add_source context/learnings.md",
    'add_source "${client_dir}context/MEMORY.md"',
    'add_source "${client_dir}context/memory/"',
    'add_source "${client_dir}context/learnings.md"',
]:
    if snippet not in script:
        raise SystemExit(f"memsearch-reindex.sh missing expected routine source: {snippet}")

for forbidden in [
    "context/inbox/",
    "context/reference/",
    "clients/*/context/inbox/",
    "clients/*/context/reference/",
    "brand_context",
]:
    if f"add_source {forbidden}" in script:
        raise SystemExit(f"memsearch-reindex.sh should not routine-index {forbidden}")

print("policy ok")
PY

ok "memory index policy tests passed"

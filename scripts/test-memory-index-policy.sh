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
for path in [
    "context/agency/",
    "clients/*/context/inbox/",
    "clients/*/context/intake/",
    "clients/*/context/directives/",
    "clients/*/context/docs/",
    "clients/*/projects/",
]:
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

# Durable synthesis layer (2026-07-27): the top-level context/*.md files must be
# routine-indexed in policy AND reindex.sh, and the markdown fallback must cover
# the same surfaces, so semantic and fallback recall stay in parity and this
# coverage cannot silently drift back out.
for required in ["context/*.md", "clients/*/context/*.md", "context/wiki/", "context/notion/CATALOG.md"]:
    if required not in routine:
        raise SystemExit(f"Routine semantic tier missing durable-synthesis path: {required}")

# Client topic wiki (2026-07-29): the per-client context/wiki/ synthesis must be
# routine-indexed in policy AND the semantic indexer, symmetric to the root
# context/wiki/. The markdown fallback already covers it via MEMORY_SOURCE_DIRS,
# so listing it in the indexer keeps the two paths at parity.
if "clients/*/context/wiki/" not in routine:
    raise SystemExit("Routine semantic tier missing client wiki: clients/*/context/wiki/")
if 'add_source "${client_dir}context/wiki/"' not in script:
    raise SystemExit("memsearch-reindex.sh must index client wiki: ${client_dir}context/wiki/")

for snippet in [
    "for f in context/*.md; do",
    'for f in "${client_dir}context"/*.md; do add_source',
]:
    if snippet not in script:
        raise SystemExit(f"memsearch-reindex.sh missing durable-synthesis indexing: {snippet}")

fallback = (root / "scripts" / "memory-search.py").read_text(encoding="utf-8")
for snippet in ["MEMORY_TOPLEVEL_MD_DIRS", '"context/notion/CATALOG.md"']:
    if snippet not in fallback:
        raise SystemExit(f"memory-search.py fallback missing parity source: {snippet}")

# Curated knowledge subfolders (2026-07-29): a knowledge folder one level down
# inside context/ (first: myob-exo/) must be declared in policy AND indexed by
# BOTH the semantic indexer and the markdown fallback, or it becomes a silent
# recall blind spot again (context/*.md is non-recursive by design). The three
# lists must agree on the folder name, and both indexers must skip the noisy
# topic-index map so it never drowns recall.
ks = tiers["routine_semantic"].get("knowledge_subfolders", {})
policy_ks = set(ks.get("names", []))
required_ks = {"myob-exo", "operator"}
if not required_ks <= policy_ks:
    raise SystemExit(
        "routine_semantic.knowledge_subfolders.names missing: "
        f"{sorted(required_ks - policy_ks)}"
    )
if not any("topic-index.md" in x for x in ks.get("knowledge_subfolder_excludes", [])):
    raise SystemExit("knowledge_subfolder_excludes must skip the topic-index map")
for required in [
    "context/myob-exo/**/*.md",
    "clients/*/context/myob-exo/**/*.md",
    "context/operator/**/*.md",
    "clients/*/context/operator/**/*.md",
]:
    if required not in routine:
        raise SystemExit(f"Routine semantic tier missing knowledge-subfolder path: {required}")

for snippet in [
    "KNOWLEDGE_SUBFOLDERS=(myob-exo operator)",
    "add_knowledge_subfolder()",
    "add_knowledge_subfolder context",
    'add_knowledge_subfolder "${client_dir}context"',
    "official-help/topic-index.md",
]:
    if snippet not in script:
        raise SystemExit(f"memsearch-reindex.sh missing knowledge-subfolder wiring: {snippet}")

for snippet in [
    "KNOWLEDGE_SUBFOLDERS",
    '"myob-exo"',
    '"operator"',
    "KNOWLEDGE_SUBFOLDER_SKIP_RE",
    "topic-index",
]:
    if snippet not in fallback:
        raise SystemExit(f"memory-search.py missing knowledge-subfolder parity: {snippet}")

print("policy ok")
PY

ok "memory index policy tests passed"

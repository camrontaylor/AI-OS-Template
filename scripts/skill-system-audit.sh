#!/usr/bin/env bash
# Deterministic integrity audit for the live AI-OS skill system.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TODAY="$(date +%F)"
REPORT_DIR="$ROOT/projects/system-health"
REPORT="$REPORT_DIR/${TODAY}_skill-system-audit.md"
FAIL=0
WARN=0
PASS=0
DETAILS=()
CONTEXT_MISSING=()
STRICT=0
DESC_TARGET=500  # frontmatter description char target; see AGENTS.md "Description format"
DESC_LONG=()
DESC_PHRASELIST=()

for arg in "$@"; do
  case "$arg" in
    --strict) STRICT=1 ;;
    -h|--help)
      echo "Usage: bash scripts/skill-system-audit.sh [--strict]"
      echo "  --strict  exit non-zero when warnings or failures are found"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 64
      ;;
  esac
done

pass() { PASS=$((PASS + 1)); DETAILS+=("OK|$1"); }
warn() { WARN=$((WARN + 1)); DETAILS+=("WARN|$1"); }
fail() { FAIL=$((FAIL + 1)); DETAILS+=("FAIL|$1"); }

mkdir -p "$REPORT_DIR"

mapfile_compat() {
  while IFS= read -r line; do
    printf '%s\0' "$line"
  done
}

skill_count=0
while IFS= read -r -d '' skill_md; do
  skill_dir="$(dirname "$skill_md")"
  folder="$(basename "$skill_dir")"
  frontmatter_name="$(awk '
    NR == 1 && $0 == "---" { in_frontmatter=1; next }
    in_frontmatter && $0 == "---" { exit }
    in_frontmatter && /^name:[[:space:]]*/ {
      sub(/^name:[[:space:]]*/, "")
      gsub(/^['\"']|['\"']$/, "")
      print
      exit
    }
  ' "$skill_md")"
  skill_count=$((skill_count + 1))

  if [[ -z "$frontmatter_name" ]]; then
    fail "$folder has no frontmatter name."
  elif [[ "$frontmatter_name" != "$folder" ]]; then
    fail "$folder frontmatter name is '$frontmatter_name'."
  fi

  if ! grep -q '^## Context Needs[[:space:]]*$' "$skill_md"; then
    CONTEXT_MISSING+=("$folder")
  fi

  if grep -qxF "## $folder" "$ROOT/context/learnings.md"; then
    :
  else
    warn "$folder has no exact section in context/learnings.md."
  fi

  desc_len="$(awk '
    NR == 1 && $0 == "---" { fm=1; next }
    fm && $0 == "---" { exit }
    fm && /^description:/ {
      d=1; line=$0
      sub(/^description:[[:space:]]*[>|]?[+-]?[[:space:]]*/, "", line)
      buf=line; next
    }
    fm && d && /^[[:space:]]/ {
      s=$0; sub(/^[[:space:]]+/, "", s); buf=buf " " s; next
    }
    fm && d && /^[^[:space:]]/ { exit }
    END { gsub(/^[[:space:]]+|[[:space:]]+$/, "", buf); print length(buf) }
  ' "$skill_md")"
  if [[ -n "$desc_len" && "$desc_len" -gt "$DESC_TARGET" ]]; then
    DESC_LONG+=("$folder (${desc_len})")
  fi

  # A description must describe the skill, not list the phrases that invoke it.
  desc_text="$(awk '
    NR == 1 && $0 == "---" { fm=1; next }
    fm && $0 == "---" { exit }
    fm && /^description:/ { d=1; line=$0; sub(/^description:[[:space:]]*[>|]?[+-]?[[:space:]]*/, "", line); buf=line; next }
    fm && d && /^[[:space:]]/ { s=$0; sub(/^[[:space:]]+/, "", s); buf=buf " " s; next }
    fm && d && /^[^[:space:]]/ { exit }
    END { print buf }
  ' "$skill_md")"
  if printf '%s' "$desc_text" | grep -qiE "Triggers?:|Trigger phrases|Triggers on|Triggers when|Also use when|When (the user|you) want|Fires automatically on"; then
    DESC_PHRASELIST+=("$folder")
  fi
done < <(find "$ROOT/.claude/skills" -mindepth 2 -maxdepth 2 -type f -name SKILL.md ! -path '*/_*/*' -print0 | sort -z)

if [[ "${#DESC_LONG[@]}" -gt 0 ]]; then
  warn "Descriptions over ${DESC_TARGET} chars (tighten per AGENTS.md 'Description format'): ${DESC_LONG[*]}"
else
  pass "Every live skill description is within the ${DESC_TARGET}-char target."
fi

if [[ "${#DESC_PHRASELIST[@]}" -gt 0 ]]; then
  warn "Descriptions that list invoking phrases instead of describing the skill (rewrite per AGENTS.md 'Description format'): ${DESC_PHRASELIST[*]}"
else
  pass "Every live skill description reads as a description, not a trigger-phrase list."
fi

if [[ "${#CONTEXT_MISSING[@]}" -gt 0 ]]; then
  fail "Live skills missing an explicit Context Needs contract: ${CONTEXT_MISSING[*]}"
else
  pass "Every live skill declares its own Context Needs."
fi

if [[ "$skill_count" -gt 0 ]]; then
  pass "$skill_count live skills discovered from .claude/skills/*/SKILL.md."
else
  fail "No live skills were discovered."
fi

if python3 "$ROOT/scripts/gen-skills-catalog.py" --check >/tmp/aios-skill-catalog-check.out 2>&1; then
  pass "Generated docs/skills-catalog.md matches the live filesystem."
else
  fail "Generated skills catalog is stale. Run: python3 scripts/gen-skills-catalog.py"
fi
rm -f /tmp/aios-skill-catalog-check.out

if bash "$ROOT/scripts/link-skills.sh" --check >/tmp/aios-skill-adapter-check.out 2>&1; then
  pass "Project tool adapter resolves to the canonical .claude/skills source."
else
  fail "Project tool adapter is broken. Run: bash scripts/link-skills.sh"
fi
rm -f /tmp/aios-skill-adapter-check.out

if bash "$ROOT/scripts/client-sync-audit.sh" --strict >/tmp/aios-skill-client-check.out 2>&1; then
  pass "Client skill discovery links resolve to the canonical root skills."
else
  fail "Client skill topology is broken. Run: bash scripts/client-sync-audit.sh"
fi
rm -f /tmp/aios-skill-client-check.out

if python3 - "$ROOT" <<'PY'
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
catalog = json.loads((root / ".claude/skills/_catalog/catalog.json").read_text())
installed = json.loads((root / ".claude/skills/_catalog/installed.json").read_text())
offered = set(catalog.get("core_skills", [])) | set(catalog.get("skills", {}))
selected = set(installed.get("installed_skills", [])) | set(installed.get("removed_skills", []))
unknown = sorted(selected - offered)
if unknown:
    print("installer state references entries absent from its setup menu: " + ", ".join(unknown))
    raise SystemExit(1)
PY
then
  pass "Optional-skill installer state is internally consistent."
else
  warn "Optional-skill installer state needs review; it is setup metadata, not the live registry."
fi

{
  printf '# Skill System Audit - %s\n\n' "$TODAY"
  printf 'The live filesystem is authoritative. `docs/skills-catalog.md` is generated from it. `_catalog/catalog.json` and `installed.json` are first-run installer state only.\n\n'
  printf '## Summary\n\n'
  printf -- '- Failures: %s\n' "$FAIL"
  printf -- '- Warnings: %s\n' "$WARN"
  printf -- '- Passed checks: %s\n\n' "$PASS"
  printf '## Findings\n\n'
  for item in "${DETAILS[@]}"; do
    status="${item%%|*}"
    message="${item#*|}"
    printf -- '- `%s`: %s\n' "$status" "$message"
  done
  printf '\n## Source Of Truth\n\n'
  printf '1. Live capability: `.claude/skills/*/SKILL.md`\n'
  printf '2. Tool and client discovery: symlinks to the live capability\n'
  printf '3. Human reference: generated `docs/skills-catalog.md`\n'
  printf '4. First-run selection only: `.claude/skills/_catalog/`\n'
} > "$REPORT"

printf 'Skill system audit saved to %s\n' "$REPORT"
printf 'Summary: %s failure(s), %s warning(s), %s passed check(s).\n' "$FAIL" "$WARN" "$PASS"

if [[ "$FAIL" -gt 0 || ( "$STRICT" -eq 1 && "$WARN" -gt 0 ) ]]; then
  exit 1
fi

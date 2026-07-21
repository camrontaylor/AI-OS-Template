#!/usr/bin/env bash
# Generate a durable, read-only report for AI-OS meta documentation drift.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TODAY="$(date +%F)"
REPORT_DIR="$ROOT/projects/system-health"
REPORT="$REPORT_DIR/${TODAY}_meta-doc-drift.md"
FAIL=0
WARN=0
PASS=0
DETAILS=()

mkdir -p "$REPORT_DIR"

pass() {
  PASS=$((PASS + 1))
  DETAILS+=("OK|$1")
}

warn() {
  WARN=$((WARN + 1))
  DETAILS+=("WARN|$1")
}

fail() {
  FAIL=$((FAIL + 1))
  DETAILS+=("FAIL|$1")
}

require_file() {
  local rel="$1"
  local label="$2"
  if [[ -f "$ROOT/$rel" ]]; then
    pass "$label exists: $rel"
  else
    fail "$label missing: $rel"
  fi
}

require_text() {
  local rel="$1"
  local pattern="$2"
  local label="$3"
  if [[ ! -f "$ROOT/$rel" ]]; then
    fail "$label cannot be checked because $rel is missing"
    return
  fi
  if grep -qiF "$pattern" "$ROOT/$rel"; then
    pass "$label"
  else
    fail "$label missing expected text: $pattern"
  fi
}

warn_text() {
  local rel="$1"
  local pattern="$2"
  local label="$3"
  if [[ ! -f "$ROOT/$rel" ]]; then
    warn "$label cannot be checked because $rel is missing"
    return
  fi
  if grep -qiF "$pattern" "$ROOT/$rel"; then
    pass "$label"
  else
    warn "$label missing expected text: $pattern"
  fi
}

forbid_text() {
  local rel="$1"
  local pattern="$2"
  local label="$3"
  if [[ ! -f "$ROOT/$rel" ]]; then
    fail "$label cannot be checked because $rel is missing"
    return
  fi
  if grep -qF "$pattern" "$ROOT/$rel"; then
    fail "$label still contains retired text: $pattern"
  else
    pass "$label"
  fi
}

for rel in \
  docs/meta/README.md \
  docs/meta/design-philosophy.md \
  docs/meta/system-architecture.md \
  docs/meta/memory-architecture.md \
  docs/meta/health-and-regression.md \
  docs/meta/evolution-log.md \
  projects/system-health/self-sustaining-health-plan.md
do
  require_file "$rel" "Meta source"
done

require_text "AGENTS.md" "docs/meta/" "AGENTS.md points agents to the meta docs"
require_text "README.md" "docs/meta/" "README.md surfaces the meta docs"
require_text "docs/README.md" "meta/health-and-regression.md" "Docs index links health and regression"
require_text "docs/meta/README.md" "Current Source Of Truth Map" "Meta README has source-of-truth map"
require_text "docs/meta/README.md" "MemSearch architecture" "Meta README preserves MemSearch reference"
require_text "docs/meta/memory-architecture.md" "Milvus Lite" "Memory architecture covers Milvus Lite"
require_text "docs/meta/memory-architecture.md" "Markdown Fallback" "Memory architecture covers markdown fallback"
require_text "docs/meta/memory-architecture.md" "semantic index is derived" "Memory architecture says semantic index is derived"
require_text "docs/meta/memory-architecture.md" "Scheduled automation is not a human session" "Memory architecture excludes cron prompts from human memory"
require_text "docs/meta/system-architecture.md" "Discovery Links" "System architecture documents linked client discovery"
require_text "docs/meta/system-architecture.md" "first-run optional-skill" "System architecture separates setup inventory from live skills"
require_text "AGENTS.md" "## Skill Source Of Truth" "AGENTS.md has a single-source skill contract"
forbid_text "AGENTS.md" "## Skill Registry" "AGENTS.md has no hand-written Skill Registry"
forbid_text "AGENTS.md" "## Context Matrix" "AGENTS.md has no hand-written Context Matrix"
forbid_text "AGENTS.md" "### Service Registry" "AGENTS.md has no duplicate Service Registry"
forbid_text "docs/meta/system-architecture.md" "Client Copies" "System architecture has no retired copy model"
require_text "docs/meta/health-and-regression.md" "What Counts As A Regression" "Health doc defines regressions"
require_text "docs/meta/evolution-log.md" "Self-Sustaining Health Loops" "Evolution log records self-sustaining health loop decision"
require_text "projects/system-health/self-sustaining-health-plan.md" "Requirement Status" "Self-sustaining plan has requirement status"
require_text "projects/system-health/self-sustaining-health-plan.md" "External Action Plan" "Self-sustaining plan keeps external action plan"
require_text "projects/system-health/self-sustaining-health-plan.md" "Next Improvement Backlog" "Self-sustaining plan keeps improvement backlog"

for rel in \
  scripts/client-memory-maintenance.sh \
  scripts/client-sync-audit.sh \
  scripts/memory-system-audit.sh \
  scripts/memsearch-health.sh \
  scripts/memsearch-maintain.sh \
  scripts/workspace-health-report.sh \
  scripts/branch-triage-report.sh \
  scripts/skill-eval-coverage-report.sh \
  scripts/notion-docs-coverage-report.sh \
  scripts/meta-doc-drift-report.sh \
  scripts/skill-system-audit.sh
do
  require_file "$rel" "Health script"
done

for rel in \
  cron/jobs/client-memory-evaluator.md \
  cron/jobs/client-memory-curator.md \
  cron/jobs/client-memory-distill.md \
  cron/jobs/client-memory-gaps.md \
  cron/jobs/semantic-memory-health.md \
  cron/jobs/workspace-health-steward.md \
  cron/jobs/skill-eval-coverage.md \
  cron/jobs/notion-docs-coverage.md \
  cron/jobs/notion-resource-health.md \
  cron/jobs/nightly-memsearch-index.md \
  cron/jobs/nightly-memory-backup.md \
  cron/jobs/meta-doc-drift.md \
  cron/jobs/skill-update-check.md
do
  require_file "$rel" "Health job"
done

warn_text "docs/meta/health-and-regression.md" "meta-doc-drift" "Health doc lists meta-doc drift job"
warn_text "projects/system-health/self-sustaining-health-plan.md" "meta-doc-drift" "Self-sustaining plan lists meta-doc drift loop"
warn_text "docs/meta/health-and-regression.md" "notion-docs-coverage" "Health doc lists Notion docs coverage job"
warn_text "projects/system-health/self-sustaining-health-plan.md" "notion-docs-coverage" "Self-sustaining plan lists Notion docs coverage loop"
require_text "cron/jobs/weekly-memsearch-rebuild.md" "active: 'false'" "Duplicate weekly MemSearch schedule stays inactive"
require_text "cron/jobs/nightly-memsearch-index.md" "command: bash scripts/memsearch-maintain.sh" "Nightly semantic maintenance owns ordered index plus health"
require_text "cron/jobs/semantic-memory-health.md" "active: 'false'" "Time-based semantic health duplicate stays inactive"

if python3 "$ROOT/scripts/gen-skills-catalog.py" --check >/dev/null 2>&1; then
  pass "Generated skills catalog matches the live filesystem"
else
  fail "Generated skills catalog is stale"
fi

# AGENTS.md loads in full at every session start; catch silent regrowth past the diet budget.
AGENTS_BYTES="$(wc -c < "$ROOT/AGENTS.md" | tr -d ' ')"
if [[ "$AGENTS_BYTES" -le 51200 ]]; then
  pass "AGENTS.md size within budget: ${AGENTS_BYTES} bytes (cap 51200)"
else
  fail "AGENTS.md size over budget: ${AGENTS_BYTES} bytes (cap 51200)"
fi

# Absolute paths mentioned in the always-loaded instruction files must exist on disk.
for rel in AGENTS.md CLAUDE.md; do
  if [[ ! -f "$ROOT/$rel" ]]; then
    fail "Absolute-path check cannot run because $rel is missing"
    continue
  fi
  ABS_PATHS="$(grep -oE '/Users/[a-z]+[A-Za-z0-9._/-]*' "$ROOT/$rel" | sort -u || true)"
  if [[ -z "$ABS_PATHS" ]]; then
    pass "$rel mentions no absolute /Users paths"
    continue
  fi
  while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    if [[ -e "$p" ]]; then
      pass "Absolute path in $rel exists: $p"
    else
      fail "Absolute path in $rel does not exist: $p"
    fi
  done <<< "$ABS_PATHS"
done

{
  printf '# Meta Doc Drift - %s\n\n' "$TODAY"
  printf 'This is a read-only AI-OS report. It checks whether the meta docs still line up with the runtime contract, health jobs, and source-of-truth map.\n\n'
  printf '## Summary\n\n'
  printf -- '- Failures: %s\n' "$FAIL"
  printf -- '- Warnings: %s\n' "$WARN"
  printf -- '- Passed checks: %s\n\n' "$PASS"

  printf '## Findings\n\n'
  if [[ "${#DETAILS[@]}" -eq 0 ]]; then
    printf 'No checks ran.\n'
  else
    for item in "${DETAILS[@]}"; do
      status="${item%%|*}"
      message="${item#*|}"
      printf -- '- `%s`: %s\n' "$status" "$message"
    done
  fi

  printf '\n## Fix Path\n\n'
  if [[ "$FAIL" -eq 0 && "$WARN" -eq 0 ]]; then
    printf 'No action needed.\n'
  else
    printf 'Update the missing source-of-truth doc, script, or cron job, then rerun:\n\n'
    printf '```bash\n'
    printf 'bash scripts/meta-doc-drift-report.sh\n'
    printf 'bash scripts/memory-system-audit.sh\n'
    printf '```\n'
  fi
} > "$REPORT"

printf 'Meta doc drift report saved to %s\n' "$REPORT"
printf 'Summary: %s failure(s), %s warning(s), %s passed check(s).\n' "$FAIL" "$WARN" "$PASS"

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi

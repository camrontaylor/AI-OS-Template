#!/usr/bin/env bash
# Read-only audit for AI-OS root/client memory boundaries.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WARN=0
FAIL=0
STRICT=0

for arg in "$@"; do
  case "$arg" in
    --strict) STRICT=1 ;;
    -h|--help)
      echo "Usage: bash scripts/memory-system-audit.sh [--strict]"
      echo "  --strict  exit non-zero when warnings or failures are found"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 64
      ;;
  esac
done

ok() { printf 'OK: %s\n' "$1"; }
warn() { WARN=$((WARN + 1)); printf 'WARN: %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$1"; }

file_size_check() {
  local label="$1"
  local file="$2"
  local cap="${3:-2500}"
  local missing="${4:-fail}"
  local chars

  if [[ ! -f "$file" ]]; then
    if [[ "$missing" == "warn" ]]; then
      warn "$label missing: ${file#"$ROOT/"}"
    else
      fail "$label missing: ${file#"$ROOT/"}"
    fi
    return
  fi
  chars="$(wc -c < "$file" | tr -d ' ')"
  if [[ "$chars" -gt "$cap" ]]; then
    warn "$label is $chars/$cap chars: ${file#"$ROOT/"}"
  else
    ok "$label is $chars/$cap chars."
  fi
}

printf 'AI-OS memory system audit\n'
printf 'Root: %s\n\n' "$ROOT"

file_size_check "Root MEMORY.md" "$ROOT/context/MEMORY.md" 2500 warn

if [[ -d "$ROOT/clients" ]]; then
  shopt -s nullglob
  for client_dir in "$ROOT"/clients/*/; do
    [[ -d "$client_dir/context" ]] || continue
    slug="$(basename "$client_dir")"
    file_size_check "Client $slug MEMORY.md" "$client_dir/context/MEMORY.md" 2500 warn
    if [[ ! -d "$client_dir/context/memory" ]]; then
      fail "Client $slug missing context/memory/"
    fi
    if [[ -f "$client_dir/context/MEMORY.md" ]]; then
      chars="$(wc -c < "$client_dir/context/MEMORY.md" | tr -d ' ')"
      if [[ "$chars" -gt 2500 ]]; then
        latest_health="$(find "$client_dir/context/memory" -maxdepth 1 -type f -name '????-??-??_memory-health.md' 2>/dev/null | sort | tail -1)"
        if [[ -n "$latest_health" ]]; then
          ok "Client $slug has a memory health report: ${latest_health#"$ROOT/"}"
        else
          warn "Client $slug has no memory health report for its over-budget MEMORY.md. Run: bash scripts/client-memory-maintenance.sh --mode evaluate --client $slug"
        fi
      fi
    fi
  done
  shopt -u nullglob
else
  warn "No clients directory found."
fi

printf '\nChecking runtime hook contract...\n'
for rel in \
  .codex/config.toml \
  .codex/hooks.json \
  scripts/codex-hook.sh \
  .claude/settings.json \
  .claude/hooks/session-memory-finalizer.js \
  .claude/hooks/skills-parity-check.js \
  scripts/lib/skills-parity-check.sh \
  scripts/test-session-memory-finalizer.sh
do
  if [[ -f "$ROOT/$rel" ]]; then
    ok "Runtime file present: $rel"
  else
    fail "Runtime file missing: $rel"
  fi
done

if node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$ROOT/.codex/hooks.json" >/dev/null 2>&1; then
  ok "Codex hooks JSON is valid."
else
  fail "Codex hooks JSON is invalid: .codex/hooks.json"
fi

if grep -q 'session-memory-finalizer.js' "$ROOT/.codex/hooks.json" \
  && grep -q 'skills-parity-check.js' "$ROOT/.codex/hooks.json"; then
  ok "Codex hooks include memory finalizer and parity check."
else
  fail "Codex hooks missing memory finalizer or parity check."
fi

if grep -q 'session-memory-finalizer.js' "$ROOT/.claude/settings.json" \
  && grep -q 'skills-parity-check.js' "$ROOT/.claude/settings.json"; then
  ok "Claude settings include memory finalizer and parity check."
else
  fail "Claude settings missing memory finalizer or parity check."
fi

printf '\nChecking shared skill sync...\n'
if bash "$ROOT/scripts/client-sync-audit.sh" --strict >/tmp/aios-client-sync-audit.out 2>&1; then
  ok "Client shared runtime files match root, excluding local overrides and client-only skills."
else
  warn "Client shared runtime drift detected. Run: bash scripts/client-sync-audit.sh"
  sed 's/^/  /' /tmp/aios-client-sync-audit.out
fi
rm -f /tmp/aios-client-sync-audit.out

printf '\nChecking startup memory layering...\n'
first_client=""
if [[ -d "$ROOT/clients" ]]; then
  for client_dir in "$ROOT"/clients/*/; do
    [[ -d "$client_dir/context" ]] || continue
    first_client="$client_dir"
    break
  done
fi

if [[ -n "$first_client" ]]; then
  startup_out="$(printf '{"cwd":"%s"}' "${first_client%/}" | node "$ROOT/.claude/hooks/load-memory-snapshot.js" 2>/dev/null || true)"
  if [[ "$startup_out" == *"### SOUL - agent identity"* && "$startup_out" == *"### USER - profile and preferences"* ]]; then
    if [[ -f "$first_client/context/MEMORY.md" ]]; then
      if [[ "$startup_out" == *"### MEMORY - curated working scratchpad"* ]]; then
        ok "Client startup loads root SOUL/USER plus active client MEMORY."
      else
        fail "Client startup layering did not include active client MEMORY."
      fi
    else
      warn "Client startup loaded root SOUL/USER, but active client MEMORY.md is not scaffolded yet. Run: bash scripts/update-clients.sh"
    fi
  else
    fail "Client startup layering did not include root SOUL/USER."
  fi
else
  warn "No client workspace available for startup layering check."
fi

printf '\nChecking memory maintenance jobs...\n'
for job in \
  client-memory-distill \
  client-memory-gaps \
  client-memory-evaluator \
  client-memory-curator \
  semantic-memory-health \
  meta-doc-drift \
  skill-eval-coverage \
  notion-docs-coverage \
  workspace-health-steward \
  notion-resource-health \
  nightly-memsearch-index \
  nightly-memory-backup
do
  if [[ -f "$ROOT/cron/jobs/$job.md" ]]; then
    ok "Cron job present: $job"
  else
    fail "Cron job missing: $job"
  fi
done

if [[ -x "$ROOT/scripts/notion-resource-health.sh" ]] \
  && grep -q '^runner: shell$' "$ROOT/cron/jobs/notion-resource-health.md" \
  && grep -q '^command: bash scripts/notion-resource-health.sh$' "$ROOT/cron/jobs/notion-resource-health.md"; then
  ok "Notion resource health uses a shell preflight that can fail cron when blocked."
else
  fail "Notion resource health is not wired to the shell preflight. Run: bash scripts/test-notion-resource-health.sh"
fi

printf '\nChecking memsearch source contract...\n'
if grep -q 'for client_dir in clients/\*/' "$ROOT/scripts/memsearch-reindex.sh" \
  && grep -q 'context/MEMORY.md' "$ROOT/scripts/memsearch-reindex.sh" \
  && grep -q 'context/learnings.md' "$ROOT/scripts/memsearch-reindex.sh"; then
  ok "Memsearch reindex lists root and client memory sources."
else
  fail "Memsearch reindex source contract does not visibly include root and client memory."
fi

# Durable synthesis layer (2026-07-27): the top-level context/*.md files carry
# the richest curated knowledge (relationship history, ops synthesis, Decision
# Ledger). A source-contract that lists only MEMORY.md/learnings.md would look
# healthy while leaving them invisible to recall, so verify the layer explicitly.
if grep -q 'for f in context/\*.md; do' "$ROOT/scripts/memsearch-reindex.sh" \
  && grep -q 'for f in "${client_dir}context"/\*.md; do add_source' "$ROOT/scripts/memsearch-reindex.sh"; then
  ok "Memsearch reindex covers the durable top-level context/*.md synthesis layer."
else
  fail "Memsearch reindex no longer covers the durable context/*.md synthesis layer (relationship history, ops synthesis, decisions)."
fi

printf '\nChecking likely placement drift...\n'
if [[ -f "$ROOT/context/MEMORY.md" && -d "$ROOT/clients" ]]; then
  drift_terms=()
  shopt -s nullglob
  for client_dir in "$ROOT"/clients/*/; do
    slug="$(basename "$client_dir")"
    [[ -n "$slug" ]] || continue
    drift_terms+=("$slug")
    if [[ "$slug" == *-* ]]; then
      drift_terms+=("${slug//-/ }")
    fi
    if [[ -f "$client_dir/AGENTS.md" ]]; then
      client_title="$(awk '/^# / { sub(/^# +/, ""); print; exit }' "$client_dir/AGENTS.md" | sed -E 's/ +/ /g; s/^ +//; s/ +$//')"
      if [[ -n "$client_title" && "$client_title" != "AGENTS.md" && "$client_title" != "Client AGENTS.md" ]]; then
        drift_terms+=("$client_title")
      fi
    fi
  done
  shopt -u nullglob

  drift_hits=()
  for term in "${drift_terms[@]}"; do
    [[ "${#term}" -ge 3 ]] || continue
    if grep -qiF "$term" "$ROOT/context/MEMORY.md"; then
      drift_hits+=("$term")
    fi
  done

  if [[ "${#drift_hits[@]}" -gt 0 ]]; then
    warn "Root MEMORY.md contains client-like terms (${drift_hits[*]}). Review whether they are shared-system notes."
  else
    ok "Root MEMORY.md has no obvious client placement drift markers."
  fi
else
  ok "Root MEMORY.md has no obvious client placement drift markers."
fi

printf '\nChecking daily-log hygiene...\n'
pollution_pattern='mentioned in assistant response|^- Assistant response:|Awaiting next user input; run meta-wrap-up for full session finalization\.|^You are running as a scheduled (cron )?job for AI-OS\.'
polluted_logs=()
while IFS= read -r file; do
  [[ -n "$file" ]] && polluted_logs+=("${file#"$ROOT/"}")
done < <(
  grep -RIlE --include='*.md' "$pollution_pattern" \
    "$ROOT/context/memory" "$ROOT"/clients/*/context/memory 2>/dev/null | sort -u
)

if [[ "${#polluted_logs[@]}" -gt 0 ]]; then
  warn "${#polluted_logs[@]} daily memory log(s) contain known auto-finalizer noise. Repair with: node .claude/hooks/session-memory-finalizer.js --repair context/memory/*.md clients/*/context/memory/*.md"
else
  ok "Daily memory logs contain no known auto-finalizer pollution."
fi

printf '\nSummary: %s failure(s), %s warning(s).\n' "$FAIL" "$WARN"
if [[ "$FAIL" -gt 0 || ( "$STRICT" -eq 1 && "$WARN" -gt 0 ) ]]; then
  exit 1
fi

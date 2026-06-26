#!/usr/bin/env bash
# Read-only audit for AI-OS root/client memory boundaries.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WARN=0
FAIL=0

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
  done
  shopt -u nullglob
else
  warn "No clients directory found."
fi

printf '\nChecking shared skill sync...\n'
if bash "$ROOT/scripts/client-sync-audit.sh" --strict >/tmp/aios-client-sync-audit.out 2>&1; then
  ok "Client shared skills match root, excluding local overrides."
else
  warn "Client shared skill drift detected. Run: bash scripts/client-sync-audit.sh"
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
  if [[ "$startup_out" == *"### SOUL - agent identity"* && "$startup_out" == *"### USER - profile and preferences"* && "$startup_out" == *"### MEMORY - curated working scratchpad"* ]]; then
    ok "Client startup loads root SOUL/USER plus active client MEMORY."
  else
    fail "Client startup layering did not include root SOUL/USER and client MEMORY."
  fi
else
  warn "No client workspace available for startup layering check."
fi

printf '\nChecking memory maintenance jobs...\n'
for job in client-memory-distill client-memory-gaps client-memory-curator nightly-memsearch-index nightly-memory-backup; do
  if [[ -f "$ROOT/cron/jobs/$job.md" ]]; then
    ok "Cron job present: $job"
  else
    fail "Cron job missing: $job"
  fi
done

printf '\nChecking memsearch source contract...\n'
if grep -q 'for client_dir in clients/\*/' "$ROOT/scripts/memsearch-reindex.sh" \
  && grep -q 'context/MEMORY.md' "$ROOT/scripts/memsearch-reindex.sh" \
  && grep -q 'context/learnings.md' "$ROOT/scripts/memsearch-reindex.sh"; then
  ok "Memsearch reindex lists root and client memory sources."
else
  fail "Memsearch reindex source contract does not visibly include root and client memory."
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

printf '\nSummary: %s failure(s), %s warning(s).\n' "$FAIL" "$WARN"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi

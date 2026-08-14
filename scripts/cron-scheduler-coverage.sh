#!/usr/bin/env bash
set -euo pipefail

work="$(mktemp -d "${TMPDIR:-/tmp}/cron-coverage.XXXXXX")"
trap 'rm -rf "$work"' EXIT

active_file="$work/active"
scheduled_file="$work/scheduled"
: > "$active_file"
: > "$scheduled_file"

while IFS=$'\t' read -r kind name; do
  [[ -n "${name:-}" ]] || continue
  case "$kind" in
    ACTIVE) printf '%s\n' "$name" >> "$active_file" ;;
    SCHEDULED) printf '%s\n' "$name" >> "$scheduled_file" ;;
  esac
done

sort -u "$active_file" -o "$active_file"
sort -u "$scheduled_file" -o "$scheduled_file"

missing_file="$work/missing"
if [[ -s "$active_file" ]]; then
  grep -Fvx -f "$scheduled_file" "$active_file" > "$missing_file" || true
else
  : > "$missing_file"
fi

active_count="$(wc -l < "$active_file" | tr -d ' ')"
scheduled_count="$(wc -l < "$scheduled_file" | tr -d ' ')"
missing_count="$(wc -l < "$missing_file" | tr -d ' ')"
covered_count=$((active_count - missing_count))

printf 'Active AI-OS jobs: %s; scheduler names: %s; covered: %s; missing: %s\n' \
  "$active_count" "$scheduled_count" "$covered_count" "$missing_count"

if [[ "$missing_count" -gt 0 ]]; then
  sed 's/^/MISSING /' "$missing_file"
  exit 1
fi


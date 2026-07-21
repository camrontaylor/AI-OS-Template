#!/usr/bin/env bash
# sanitize-strings.sh - the single source of truth for "what counts as private"
# when AI-OS propagates systemic (ai_os_owned) files out to the public template.
#
# This file itself ships in the template, so every private string it references is
# written with string concatenation ("foo""bar") so the literal never appears here
# and this file can neither leak a name nor flag itself.
#
# Layers:
#   1. Static personal identifiers and sub-brand names that are not client folders
#      (so they cannot be derived at runtime). Kept in sync with the static list in
#      scripts/template-release-check.sh, which is the trusted template-clean gate.
#   2. Client slugs and display names derived LIVE from clients/* at scan time, plus
#      de-hyphenated / de-spaced variants (so a hyphenated slug also catches its
#      run-together form, e.g. an email local part). clients/* is user-owned and
#      never propagates, so this derivation runs on the source install only.
#   3. A regex pass for any personal absolute path (/Users/<anyone>/, /home/<anyone>/)
#      - a template should carry no machine-specific path, not just this user's.
#
# Sourced by scripts/template-sync.sh. Kept dependency-free (bash + grep + sed).

# aios_build_needles ROOT OUTFILE
#   Writes one fixed-string needle per line to OUTFILE (deduped). Skips generic
#   stopwords that would false-positive across ordinary docs.
aios_build_needles() {
  local root="$1" out="$2"
  : > "$out"

  # --- Layer 1: static identifiers (concatenated, never literal in this file) ---
  # Personal
  printf '%s\n' "camron""stricklin" >> "$out"
  printf '%s\n' "camron""staylor" >> "$out"          # gmail local part
  printf '%s\n' "custom""aistudio" >> "$out"
  # Sub-brands / methodology names that are not client folder slugs, so they cannot
  # be derived from clients/*. Mirrors template-release-check.sh's static list.
  printf '%s\n' "Cryst""alix" >> "$out"
  printf '%s\n' "ERP""Bridge" >> "$out"
  printf '%s\n' "Sitemap ""Workshop" >> "$out"

  # Stopwords: too generic to grep safely (would hit normal prose).
  local stop="|personal|test|demo|example|sample|client|temp|template|misc|shared|main|"

  _emit_variants() {
    # emit a value plus its de-hyphenated/de-spaced lowercase variant
    local v="$1" lv vv
    [ -n "$v" ] || return 0
    lv="$(printf '%s' "$v" | tr '[:upper:]' '[:lower:]')"
    case "$stop" in *"|$lv|"*) ;; *) [ "${#v}" -ge 3 ] && printf '%s\n' "$v" >> "$out" ;; esac
    vv="$(printf '%s' "$lv" | tr -d '[:space:]_-')"
    if [ "${#vv}" -ge 5 ] && [ "$vv" != "$lv" ]; then
      case "$stop" in *"|$vv|"*) ;; *) printf '%s\n' "$vv" >> "$out" ;; esac
    fi
  }

  # --- Layer 2: live client slugs + display names (+ variants) ---
  if [ -d "$root/clients" ]; then
    local d slug name
    for d in "$root"/clients/*/; do
      [ -d "$d" ] || continue
      slug="$(basename "$d")"
      case "$slug" in _*|.*) continue ;; esac
      _emit_variants "$slug"
      if [ -f "${d}AGENTS.md" ]; then
        # First heading line, minus leading '#' and an optional "Client:" label.
        name="$(sed -n '1s/^#\{1,\}[[:space:]]*//p' "${d}AGENTS.md" \
                 | sed 's/^[Cc]lient[[:space:]]*[:.-][[:space:]]*//' | tr -d '\r')"
        [ "${#name}" -ge 3 ] && _emit_variants "$name"
      fi
    done
  fi

  grep -v '^[[:space:]]*$' "$out" | sort -u > "${out}.tmp" && mv "${out}.tmp" "$out"
}

# aios_scan_files ROOT NEEDLEFILE ALLOWFILE FILE...
#   Prints "file:line:matchedtext" for each hit (case-insensitive). Runs a
#   fixed-string pass (the needles) and a regex pass (personal absolute paths).
#   ALLOWFILE (may be missing) holds file paths to skip entirely (false positives).
#   Returns 0 if clean, 1 if any un-allowed hit was found.
aios_scan_files() {
  local root="$1" needles="$2" allow="$3"
  shift 3
  # Personal absolute paths. First segment char must be alphanumeric/underscore so
  # placeholder comments like "/Users/.../projects" (a real username never starts
  # with a dot) do not trip it.
  local path_re='/Users/[A-Za-z0-9_][A-Za-z0-9._-]*/|/home/[A-Za-z0-9_][A-Za-z0-9._-]*/'
  local hit_found=0 f
  for f in "$@"; do
    local abs="$root/$f"
    [ -f "$abs" ] || continue
    LC_ALL=C grep -Iq . "$abs" 2>/dev/null || continue        # skip binary
    case "$f" in
      scripts/lib/sanitize-strings.sh|scripts/template-release-check.sh|scripts/template-sync.sh) continue ;;
    esac
    if [ -f "$allow" ] && grep -qxF "$f" "$allow" 2>/dev/null; then continue; fi
    local line
    while IFS= read -r line; do
      printf '%s:%s\n' "$f" "$line"; hit_found=1
    done < <(LC_ALL=C grep -niF -f "$needles" "$abs" 2>/dev/null)
    while IFS= read -r line; do
      printf '%s:%s\n' "$f" "$line"; hit_found=1
    done < <(LC_ALL=C grep -niE "$path_re" "$abs" 2>/dev/null)
  done
  [ "$hit_found" -eq 0 ]
}

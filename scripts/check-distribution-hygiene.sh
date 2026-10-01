#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST="$REPO_ROOT/.github/distribution-scaffolds.git-hashes"
FAILURES=0

cd "$REPO_ROOT"

fail() {
    printf 'ERROR: %s\n' "$1" >&2
    FAILURES=$((FAILURES + 1))
}

is_allowed_distribution_path() {
    case "$1" in
        brand_context/.gitkeep \
        |projects/.gitkeep \
        |context/MEMORY.md \
        |context/SOUL.md \
        |context/USER.md \
        |context/learnings.md \
        |context/memory-config.json \
        |context/memory/.gitkeep \
        |context/prompt-tags.md \
        |context/transcripts/.gitkeep \
        |team_context/AGENTS.md \
        |team_context/README.md \
        |team_context/operating-rules.md \
        |team_context/prompt-tags.md \
        |team_context/shared-preferences.md \
        |team_context/team-profile.md)
            return 0
            ;;
    esac
    return 1
}

required_paths=(
    "brand_context/.gitkeep"
    "projects/.gitkeep"
    "context/MEMORY.md"
    "context/SOUL.md"
    "context/USER.md"
    "context/learnings.md"
    "context/memory-config.json"
    "context/memory/.gitkeep"
    "context/prompt-tags.md"
    "context/transcripts/.gitkeep"
    "team_context/AGENTS.md"
    "team_context/README.md"
    "team_context/operating-rules.md"
    "team_context/prompt-tags.md"
    "team_context/shared-preferences.md"
    "team_context/team-profile.md"
)

while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    if ! is_allowed_distribution_path "$file"; then
        fail "user-owned distribution path is tracked: $file"
    fi
done < <(git ls-files -- brand_context projects context team_context clients)

for file in "${required_paths[@]}"; do
    if ! git ls-files --error-unmatch -- "$file" >/dev/null 2>&1; then
        fail "required distribution scaffold is missing: $file"
    fi
done

while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    case "$file" in
        agents.local.md \
        |*/agents.local.md \
        |claude.local.md \
        |*/claude.local.md \
        |skill.local.md \
        |*/skill.local.md \
        |.env \
        |*/.env \
        |.mcp.json \
        |*/.mcp.json \
        |settings.local.json \
        |*/settings.local.json \
        |installed.json \
        |*/installed.json \
        |.installed.json \
        |*/.installed.json \
        |*.aos.md \
        |*.db \
        |*.sqlite \
        |*.sqlite3 \
        |*.log \
        |*.pyc \
        |*.pem \
        |*.key \
        |*/__pycache__/*)
            fail "local, generated, or sensitive artifact is tracked: $file"
            ;;
    esac
done < <(git ls-files)

if [[ ! -f "$MANIFEST" ]]; then
    fail "scaffold hash manifest is missing: ${MANIFEST#$REPO_ROOT/}"
else
    while read -r expected file; do
        [[ -z "${expected:-}" ]] && continue
        [[ "$expected" == \#* ]] && continue
        if [[ -z "${file:-}" || ! -f "$file" ]]; then
            fail "manifest scaffold is missing: ${file:-<empty path>}"
            continue
        fi
        actual="$(git hash-object --path="$file" "$file")"
        if [[ "$actual" != "$expected" ]]; then
            fail "distribution scaffold changed without a manifest update: $file"
        fi
    done < "$MANIFEST"
fi

if [[ "$FAILURES" -ne 0 ]]; then
    printf '\nDistribution hygiene failed with %d problem(s).\n' "$FAILURES" >&2
    exit 1
fi

printf 'Distribution hygiene passed.\n'

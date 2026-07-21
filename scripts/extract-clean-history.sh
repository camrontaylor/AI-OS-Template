#!/usr/bin/env bash
set -euo pipefail

# ==========================================================
# AI-OS - Clean History Extractor
#
# Creates a new local Git repository with a single Camron-owned root commit.
# By default it exports only the AI-OS/core layer and excludes active
# user-owned data paths.
#
# Usage:
#   bash scripts/extract-clean-history.sh
#   bash scripts/extract-clean-history.sh --include-user-owned
#   bash scripts/extract-clean-history.sh --dest /path/to/new-repo
#
# Default output stays inside the repo's ignored archive area:
#   .backup/exports/AI-OS-core-clean-history-YYYYMMDD-HHMMSS
# ==========================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EXPORT_ROOT="$SOURCE_ROOT/.backup/exports"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$EXPORT_ROOT/AI-OS-core-clean-history-$STAMP"
REMOTE_URL="https://github.com/camrontaylor/AI-OS.git"
INCLUDE_USER_OWNED=0

usage() {
    cat <<'EOF'
Usage: bash scripts/extract-clean-history.sh [options]

Options:
  --dest PATH              Destination folder. Must not already exist.
  --remote URL             Remote URL to add as origin.
  --include-user-owned     Include tracked user-owned paths too.
  -h, --help               Show this help.

Default destination:
  .backup/exports/AI-OS-core-clean-history-YYYYMMDD-HHMMSS

Default export excludes:
  clients/
  projects/
  brand_context/
  cron/jobs/
  context/MEMORY.md
  context/memory/
  context/learnings.md
  context/notion/
  context/transcripts/
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --dest)
            DEST="${2:?missing value for --dest}"
            shift 2
            ;;
        --remote)
            REMOTE_URL="${2:?missing value for --remote}"
            shift 2
            ;;
        --include-user-owned)
            INCLUDE_USER_OWNED=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 64
            ;;
    esac
done

if [ -e "$DEST" ]; then
    echo "Destination already exists: $DEST" >&2
    exit 1
fi

if ! git -C "$SOURCE_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "Source is not a Git repository: $SOURCE_ROOT" >&2
    exit 1
fi

mkdir -p "$DEST"

list_export_files() {
    git -C "$SOURCE_ROOT" ls-files -z | while IFS= read -r -d '' path; do
        if [ "$INCLUDE_USER_OWNED" -eq 0 ]; then
            case "$path" in
                clients/*|projects/*|brand_context/*|cron/jobs/*|context/MEMORY.md|context/memory/*|context/learnings.md|context/notion/*|context/transcripts/*)
                    continue
                    ;;
            esac
        fi

        # Skip stale gitlinks, missing paths, and directories. Clean-history
        # extraction should copy source files, not nested repository metadata.
        [ -f "$SOURCE_ROOT/$path" ] || continue
        printf '%s\0' "$path"
    done
}

FILE_LIST="$(mktemp "${TMPDIR:-/tmp}/aios-clean-history-files.XXXXXX")"
trap 'rm -f "$FILE_LIST"' EXIT
list_export_files > "$FILE_LIST"
while IFS= read -r -d '' path; do
    mkdir -p "$DEST/$(dirname "$path")"
    cp -p "$SOURCE_ROOT/$path" "$DEST/$path"
done < "$FILE_LIST"

cd "$DEST"
git init -b main >/dev/null
git config user.name "Camron Taylor"
git config user.email "$(git -C "$SOURCE_ROOT" config user.email || printf 'camron@example.com')"
git add -A
git commit -m "Initial clean AI-OS snapshot" >/dev/null
git remote add origin "$REMOTE_URL"

legacy_terms=(
    "simon""c602"
    "simon""coton"
    "simon ""coton"
    "google""mail"
    "simon ""scrapes"
    "agentic ""academy"
    "@simon""scrapes"
    "skool""\\.com/scrapes"
    "github""\\.com/simonc"
)
legacy_pattern=""
for term in "${legacy_terms[@]}"; do
    if [ -z "$legacy_pattern" ]; then
        legacy_pattern="$term"
    else
        legacy_pattern="$legacy_pattern|$term"
    fi
done

high_risk_hits=""
if command -v rg >/dev/null 2>&1; then
    high_risk_hits="$(rg -n -i "$legacy_pattern" . -g '!node_modules' -g '!command-centre/node_modules' -g '!.git' || true)"
else
    high_risk_hits="$(grep -RInE "$legacy_pattern" . 2>/dev/null || true)"
fi

if [ -n "$high_risk_hits" ]; then
    printf '%s\n' "$high_risk_hits" >&2
    echo "Clean export still contains legacy access/provenance strings." >&2
    exit 1
fi

history_hits="$(git log --all --format='%H%x09%an <%ae>%x09%s' | grep -Ei "simon|simonc|google""mail" || true)"
if [ -n "$history_hits" ]; then
    printf '%s\n' "$history_hits" >&2
    echo "Clean export history still contains legacy author/provenance strings." >&2
    exit 1
fi

echo "Clean AI-OS history export created:"
echo "  $DEST"
echo ""
echo "Remote:"
git remote -v
echo ""
echo "Commit:"
git log --oneline -1
echo ""
echo "Nothing was pushed. Review this folder before replacing any existing repo."

#!/usr/bin/env bash
set -euo pipefail

# ==========================================================
# AI-OS — Safe Update Script
# Pulls upstream changes without overwriting user data.
#
# Usage: bash scripts/update.sh
#        bash scripts/update.sh --dry-run
#        bash scripts/update.sh --preview
#        bash scripts/update.sh --rollback
# ==========================================================

DRY_RUN=false
case "${1:-}" in
    --dry-run|--preview|preview)
        DRY_RUN=true
        ;;
    --rollback|rollback|undo)
        ;;
    "" )
        ;;
    * )
        echo "Unknown option: $1"
        echo "Usage: bash scripts/update.sh [--dry-run|--rollback]"
        exit 64
        ;;
esac

# Bootstrap the update dependency bundle before sourcing scripts/lib/common.sh.
# This lets old installs upgrade into the multi-file updater with only:
#   bash scripts/update.sh
if [[ -z "${__AGENTIC_OS_UPDATE_BOOTSTRAPPED:-}" ]]; then
    BOOTSTRAP_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    BOOTSTRAP_REPO_ROOT="$(dirname "$BOOTSTRAP_SCRIPT_DIR")"
    case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) BOOTSTRAP_REPO_ROOT="$(cygpath -m "$BOOTSTRAP_REPO_ROOT")" ;; esac
    cd "$BOOTSTRAP_REPO_ROOT"

    # Team checkout: follow the team repo for updates (no-op on a solo install).
    if [[ -f "$BOOTSTRAP_REPO_ROOT/scripts/lib/team-config.sh" ]]; then
        source "$BOOTSTRAP_REPO_ROOT/scripts/lib/team-config.sh"
    fi

    BOOTSTRAP_UPSTREAM_BRANCH="${AGENTIC_OS_UPSTREAM_BRANCH:-main}"
    BOOTSTRAP_UPSTREAM_SLUG="${AGENTIC_OS_UPSTREAM_SLUG:-camrontaylor/AI-OS-Template}"

    # Resolve the canonical remote by URL — never a user's backup fork.
    # Mirrors resolve_update_remote() in scripts/lib/common.sh, which isn't
    # available yet because this block bootstraps the lib files themselves.
    BOOTSTRAP_REMOTE=""
    for bootstrap_remote in upstream origin $(git remote 2>/dev/null); do
        [[ "$bootstrap_remote" == "$BOOTSTRAP_REMOTE" ]] && continue
        bootstrap_url="$(git remote get-url "$bootstrap_remote" 2>/dev/null || echo "")"
        if [[ "$bootstrap_url" == *"$BOOTSTRAP_UPSTREAM_SLUG"* ]]; then
            BOOTSTRAP_REMOTE="$bootstrap_remote"
            break
        fi
    done
    if [[ -z "$BOOTSTRAP_REMOTE" ]]; then
        BOOTSTRAP_UPDATE_URL="${AGENTIC_OS_UPSTREAM_URL:-https://github.com/$BOOTSTRAP_UPSTREAM_SLUG.git}"
        if ! git remote get-url upstream >/dev/null 2>&1; then
            git remote add upstream "$BOOTSTRAP_UPDATE_URL" 2>/dev/null || true
            BOOTSTRAP_REMOTE="upstream"
        else
            git remote add ai-os-upstream "$BOOTSTRAP_UPDATE_URL" 2>/dev/null || git remote set-url ai-os-upstream "$BOOTSTRAP_UPDATE_URL" 2>/dev/null || true
            BOOTSTRAP_REMOTE="ai-os-upstream"
        fi
    fi
    if [[ -z "$BOOTSTRAP_REMOTE" ]]; then
        echo "No git remote points at the AI-OS update repo ($BOOTSTRAP_UPSTREAM_SLUG)."
        echo "Run from inside the existing AI-OS folder, then try again:"
        echo "  git remote add upstream https://github.com/$BOOTSTRAP_UPSTREAM_SLUG.git"
        exit 1
    fi

    BOOTSTRAP_REQUIRED_FILES=(
        "scripts/update.sh"
        "scripts/lib/common.sh"
        "scripts/lib/python.sh"
        "scripts/lib/backup.sh"
        "scripts/lib/pull.sh"
        "scripts/lib/merge.sh"
        "scripts/lib/catalog.sh"
        "scripts/lib/preview.sh"
        "scripts/lib/gsd-migration.sh"
        "scripts/lib/synthesize.py"
        "scripts/rollback.sh"
        "scripts/session-end.sh"
        "config/update-manifest.json"
    )

    BOOTSTRAP_NEEDS_BUNDLE=false
    for BOOTSTRAP_FILE in "${BOOTSTRAP_REQUIRED_FILES[@]}"; do
        [[ -e "$BOOTSTRAP_FILE" ]] || BOOTSTRAP_NEEDS_BUNDLE=true
    done

    if $BOOTSTRAP_NEEDS_BUNDLE; then
        echo "Fetching update dependencies from $BOOTSTRAP_REMOTE ($BOOTSTRAP_UPSTREAM_SLUG)..."
        git fetch "$BOOTSTRAP_REMOTE" "$BOOTSTRAP_UPSTREAM_BRANCH" --quiet 2>/dev/null || {
            echo "Could not fetch $BOOTSTRAP_REMOTE/$BOOTSTRAP_UPSTREAM_BRANCH."
            echo "Could not reach the Camron-owned AI-OS update repo:"
            echo "  https://github.com/$BOOTSTRAP_UPSTREAM_SLUG.git"
            echo "Check network access or the remote URL, then run bash scripts/update.sh again."
            exit 1
        }

        BOOTSTRAP_TMP_DIR="$BOOTSTRAP_REPO_ROOT/.git/agentic-os-update-bootstrap"
        rm -rf "$BOOTSTRAP_TMP_DIR"
        mkdir -p "$BOOTSTRAP_TMP_DIR"

        for BOOTSTRAP_FILE in "${BOOTSTRAP_REQUIRED_FILES[@]}"; do
            mkdir -p "$BOOTSTRAP_TMP_DIR/$(dirname "$BOOTSTRAP_FILE")"
            git show "$BOOTSTRAP_REMOTE/$BOOTSTRAP_UPSTREAM_BRANCH:$BOOTSTRAP_FILE" > "$BOOTSTRAP_TMP_DIR/$BOOTSTRAP_FILE" 2>/dev/null || {
                echo "Could not download $BOOTSTRAP_FILE from $BOOTSTRAP_REMOTE/$BOOTSTRAP_UPSTREAM_BRANCH."
                echo "Please check your remote branch and run bash scripts/update.sh again."
                exit 1
            }
        done

        # Older update.sh versions self-checkout scripts/update.sh before re-execing.
        # Restore that path so the main update flow can pull with a clean index.
        git checkout HEAD -- scripts/update.sh 2>/dev/null || true

        __AGENTIC_OS_UPDATE_BOOTSTRAPPED=1 \
        AGENTIC_OS_UPDATE_BOOTSTRAP_REPO_ROOT="$BOOTSTRAP_REPO_ROOT" \
        AGENTIC_OS_UPDATE_BOOTSTRAP_LIB_DIR="$BOOTSTRAP_TMP_DIR/scripts/lib" \
        exec bash "$BOOTSTRAP_TMP_DIR/scripts/update.sh" "$@"
    fi
fi

UPDATE_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
UPDATE_LIB_DIR="${AGENTIC_OS_UPDATE_BOOTSTRAP_LIB_DIR:-$UPDATE_SCRIPT_DIR/lib}"

source "$UPDATE_LIB_DIR/common.sh"

# --rollback mode — delegate to dedicated script
if [[ "${1:-}" == "--rollback" || "${1:-}" == "rollback" || "${1:-}" == "undo" ]]; then
    exec bash "$SCRIPT_DIR/rollback.sh"
fi

# Python is required for the catalog steps — fail fast here
source "$UPDATE_LIB_DIR/python.sh"
if ! resolve_python_cmd; then
    printf "  ${RED}Python 3 is required for update.sh.${NC}\n"
    exit 1
fi
load_update_manifest

# =========================================================
# Step 1: Verify we're in a git repo
# =========================================================
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
    echo ""
    printf "  ${RED}Not a git repository.${NC} Run this from the AI-OS root.\n"
    exit 1
fi

# Always update from the canonical repo — never a user's backup fork.
UPDATE_REMOTE="$(resolve_update_remote || true)"
if [[ -z "$UPDATE_REMOTE" ]]; then
    print_upstream_help
    exit 1
fi

OLD_VERSION=$(read_agentic_os_version)

echo ""
printf "${CYAN}${BOLD}"
cat << 'BANNER'
    ╔══════════════════════════════════════════════╗
    ║                                              ║
    ║            A G E N T I C   O S               ║
    ║                                              ║
    ║               Update Check                   ║
    ║                                              ║
    ╚══════════════════════════════════════════════╝
BANNER
printf "${NC}"
printf "    ${DIM}Current version: %s${NC}\n" "$(format_agentic_os_version "$OLD_VERSION")"
echo ""

# Step 2: Read installed.json
[[ -f "$INSTALLED" ]] && HAVE_INSTALLED_JSON=true || HAVE_INSTALLED_JSON=false

# Step 3: Save current HEAD before any pull
OLD_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
OLD_HEAD=$(git rev-parse HEAD)
LAST_UPDATED=$(git log -1 --format="%cd" --date=format:"%d %b %Y at %H:%M" 2>/dev/null || echo "unknown")

if $DRY_RUN; then
    source "$UPDATE_LIB_DIR/preview.sh"
    print_update_preview
    exit 0
fi

mkdir -p "$UPDATE_BACKUP_DIR"
UPDATE_RECOVERY_BRANCH="update-recovery/${UPDATE_TIMESTAMP}"
if git branch "$UPDATE_RECOVERY_BRANCH" "$OLD_HEAD" >/dev/null 2>&1; then
    printf "%s\n" "$OLD_HEAD" > "$UPDATE_BACKUP_DIR/head-before.txt"
    printf "%s\n" "$UPDATE_RECOVERY_BRANCH" > "$UPDATE_BACKUP_DIR/recovery-branch.txt"
    git status --short --branch > "$UPDATE_BACKUP_DIR/git-status-before.txt" 2>/dev/null || true
    [[ -f "$UPDATE_MANIFEST" ]] && cp "$UPDATE_MANIFEST" "$UPDATE_BACKUP_DIR/update-manifest.json" 2>/dev/null || true
fi

# Steps 4–5c: back up modified files + prevent merge conflicts
source "$UPDATE_LIB_DIR/backup.sh"

# Step 6: pull, nuclear fallback, restore, and display Step 1 of 4
source "$UPDATE_LIB_DIR/pull.sh"

# Step 2 of 4: skill review + other file review + restore stash
source "$UPDATE_LIB_DIR/merge.sh"

# Legacy GSD migration must run after the safe pull/merge work and before the final summary.
source "$UPDATE_LIB_DIR/gsd-migration.sh"
agentic_os_gsd_run_update_migration "$REPO_ROOT" || true

# Steps 3–4: gate new skills, catalog, GSD, summary, What's New
source "$UPDATE_LIB_DIR/catalog.sh"

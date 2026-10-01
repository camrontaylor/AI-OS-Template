#!/usr/bin/env bash
set -euo pipefail

# ==========================================================
# AI-OS — Safe Update Script
# Pulls upstream changes without overwriting user data.
#
# Usage: bash scripts/update.sh
#        bash scripts/update.sh --rollback
# ==========================================================

# Bootstrap the update dependency bundle before sourcing scripts/lib/common.sh.
# This lets old installs upgrade into the multi-file updater with only:
#   bash scripts/update.sh
if [[ -z "${__AI_OS_UPDATE_BOOTSTRAPPED:-}" ]]; then
    BOOTSTRAP_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    BOOTSTRAP_REPO_ROOT="$(dirname "$BOOTSTRAP_SCRIPT_DIR")"
    case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) BOOTSTRAP_REPO_ROOT="$(cygpath -m "$BOOTSTRAP_REPO_ROOT")" ;; esac
    cd "$BOOTSTRAP_REPO_ROOT"

    BOOTSTRAP_TOKEN_REQUIRED_MARKER="AI_OS_UPDATE_TOKEN_REQUIRED"
    BOOTSTRAP_TOKEN_REQUIRED_EXIT=20
    BOOTSTRAP_TOKEN_HELP_URL="https://github.com/settings/tokens"

    bootstrap_trim_value() {
        local value="${1:-}"
        value="${value//$'\r'/}"
        value="${value//$'\n'/}"
        value="${value#"${value%%[![:space:]]*}"}"
        value="${value%"${value##*[![:space:]]}"}"
        printf "%s" "$value"
    }

    bootstrap_read_env_value() {
        local key="$1"

        # Update source settings intentionally come only from the root .env.
        # Long-lived shells and the Command Centre may inherit stale values.
        if [[ -f "$BOOTSTRAP_REPO_ROOT/.env" ]]; then
            awk -v key="$key" '
                /^[[:space:]]*#/ { next }
                {
                    line = $0
                    sub(/^[[:space:]]*export[[:space:]]+/, "", line)
                    pattern = "^[[:space:]]*" key "[[:space:]]*="
                    if (line ~ pattern) {
                        sub(pattern, "", line)
                        sub(/[[:space:]]*$/, "", line)
                        gsub(/^"|"$/, "", line)
                        gsub(/^'\''|'\''$/, "", line)
                        print line
                        exit
                    }
                }
            ' "$BOOTSTRAP_REPO_ROOT/.env"
        fi
    }

    bootstrap_resolve_update_setting() {
        local key="$1"
        local default_value="$2"
        local value

        value="$(bootstrap_read_env_value "$key" | head -n 1)"
        value="$(bootstrap_trim_value "$value")"
        if [[ -n "$value" ]]; then
            printf '%s\n' "$value"
        else
            printf '%s\n' "$default_value"
        fi
    }

    bootstrap_validate_update_branch() {
        local branch="${1:-}"
        if [[ -z "$branch" || "$branch" == -* ]] ||
            ! git check-ref-format --branch "$branch" >/dev/null 2>&1; then
            echo "Invalid AI_OS_UPSTREAM_BRANCH: $branch"
            echo "Use a valid Git branch name, for example: main, dev, or feature/test-update."
            return 1
        fi
    }

    BOOTSTRAP_UPSTREAM_BRANCH="$(bootstrap_resolve_update_setting AI_OS_UPSTREAM_BRANCH main)"
    BOOTSTRAP_UPSTREAM_SLUG="$(bootstrap_resolve_update_setting AI_OS_UPSTREAM_SLUG "camrontaylor/AI-OS-Template")"
    if [[ -z "$BOOTSTRAP_UPSTREAM_SLUG" && "${1:-}" != "--rollback" ]]; then
        echo "Upstream updates are disabled for this independent AI-OS copy."
        echo "Set AI_OS_UPSTREAM_SLUG in .env to your own repository to enable updates."
        exit 0
    fi
    if [[ "${1:-}" != "--rollback" ]]; then
        bootstrap_validate_update_branch "$BOOTSTRAP_UPSTREAM_BRANCH" || exit 1
    fi

    bootstrap_trim_token() {
        local token="${1:-}"
        token="${token//$'\r'/}"
        token="${token//$'\n'/}"
        token="${token#"${token%%[![:space:]]*}"}"
        token="${token%"${token##*[![:space:]]}"}"
        printf "%s" "$token"
    }

    bootstrap_is_auth_error() {
        local output="${1:-}"
        printf "%s" "$output" | grep -Eqi \
            "authentication failed|invalid credentials|could not read username|could not read password|repository not found|support for password authentication was removed|http basic: access denied|fatal: authentication|403|401"
    }

    bootstrap_sanitize_git_url() {
        local url="${1:-}"
        printf "%s" "$url" | sed -E 's#(https?://)[^/@]+@#\1<token>@#g'
    }

    bootstrap_emit_token_required() {
        local reason="${1:-GitHub rejected the AI-OS access token.}"
        echo ""
        echo "$BOOTSTRAP_TOKEN_REQUIRED_MARKER"
        echo "GitHub access token required"
        echo "$reason"
        echo ""
        echo "Get the latest token from:"
        echo "$BOOTSTRAP_TOKEN_HELP_URL"
        echo ""
        echo "Then run bash scripts/update.sh again and paste it when asked."
    }

    bootstrap_set_token_remote() {
        local remote="${1:-upstream}"
        local token
        token="$(bootstrap_trim_token "${2:-}")"
        [[ -n "$token" ]] || return 1
        if git remote get-url "$remote" >/dev/null 2>&1; then
            git remote set-url "$remote" "https://$token@github.com/$BOOTSTRAP_UPSTREAM_SLUG.git"
        else
            git remote add "$remote" "https://$token@github.com/$BOOTSTRAP_UPSTREAM_SLUG.git"
        fi
        echo "Saved the new AI-OS access token on the '$remote' update remote."
        return 0
    }

    bootstrap_ensure_token() {
        local remote="${1:-upstream}"
        local token
        token="$(bootstrap_trim_token "${AI_OS_UPDATE_TOKEN:-}")"
        if [[ -z "$token" ]] && [[ -t 0 ]]; then
            echo ""
            echo "GitHub needs a new AI-OS access token."
            echo "Get the latest token from:"
            echo "$BOOTSTRAP_TOKEN_HELP_URL"
            echo ""
            echo "Paste the token below. It will be visible so you can confirm it pasted correctly."
            printf "New token: "
            read -r token
            token="$(bootstrap_trim_token "$token")"
        fi
        if [[ -z "$token" ]]; then
            bootstrap_emit_token_required
            return "$BOOTSTRAP_TOKEN_REQUIRED_EXIT"
        fi
        bootstrap_set_token_remote "$remote" "$token"
    }

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
        BOOTSTRAP_REMOTE="upstream"
        BOOTSTRAP_TOKEN_STATUS=0
        bootstrap_ensure_token "$BOOTSTRAP_REMOTE" || BOOTSTRAP_TOKEN_STATUS=$?
        if [[ $BOOTSTRAP_TOKEN_STATUS -ne 0 ]]; then
            exit "$BOOTSTRAP_TOKEN_STATUS"
        fi
    fi

    BOOTSTRAP_REQUIRED_FILES=(
        "scripts/update.sh"
        "scripts/lib/common.sh"
        "scripts/lib/python.sh"
        "scripts/lib/backup.sh"
        "scripts/lib/pull.sh"
        "scripts/lib/merge.sh"
        "scripts/lib/catalog.sh"
        "scripts/lib/update-processes.sh"
        "scripts/lib/update-processes.ps1"
        "scripts/lib/gsd-migration.sh"
        "scripts/lib/synthesize.py"
        "scripts/update-recovery.sh"
        "scripts/rollback.sh"
        "scripts/session-end.sh"
    )

    BOOTSTRAP_REQUIRED_SIGNATURES=(
        "scripts/lib/common.sh:ensure_update_remote_access()"
        "scripts/lib/common.sh:update_recovery_on_exit()"
        "scripts/lib/update-processes.sh:prepare_update_processes()"
        "scripts/lib/common.sh:clients/*/.claude/settings.local.json"
        "scripts/lib/backup.sh:restore_protected_stash_backup()"
        "scripts/lib/backup.sh:warn_stale_update_stashes()"
        "scripts/lib/backup.sh:split_protected_stash_paths()"
        "scripts/update-clients.sh:SKILL.local.md"
    )

    BOOTSTRAP_NEEDS_BUNDLE=false
    for BOOTSTRAP_FILE in "${BOOTSTRAP_REQUIRED_FILES[@]}"; do
        [[ -e "$BOOTSTRAP_FILE" ]] || BOOTSTRAP_NEEDS_BUNDLE=true
    done
    for BOOTSTRAP_SIGNATURE in "${BOOTSTRAP_REQUIRED_SIGNATURES[@]}"; do
        BOOTSTRAP_SIGNATURE_FILE="${BOOTSTRAP_SIGNATURE%%:*}"
        BOOTSTRAP_SIGNATURE_PATTERN="${BOOTSTRAP_SIGNATURE#*:}"
        if [[ ! -f "$BOOTSTRAP_SIGNATURE_FILE" ]] ||
            ! grep -Fq "$BOOTSTRAP_SIGNATURE_PATTERN" "$BOOTSTRAP_SIGNATURE_FILE"; then
            BOOTSTRAP_NEEDS_BUNDLE=true
        fi
    done

    if $BOOTSTRAP_NEEDS_BUNDLE; then
        echo "Fetching update dependencies from $BOOTSTRAP_REMOTE ($BOOTSTRAP_UPSTREAM_SLUG)..."
        BOOTSTRAP_FETCH_OUTPUT=$(git fetch "$BOOTSTRAP_REMOTE" "$BOOTSTRAP_UPSTREAM_BRANCH" --quiet 2>&1) || {
            if bootstrap_is_auth_error "$BOOTSTRAP_FETCH_OUTPUT"; then
                BOOTSTRAP_TOKEN_STATUS=0
                bootstrap_ensure_token "$BOOTSTRAP_REMOTE" || BOOTSTRAP_TOKEN_STATUS=$?
                if [[ $BOOTSTRAP_TOKEN_STATUS -ne 0 ]]; then
                    exit "$BOOTSTRAP_TOKEN_STATUS"
                fi
                BOOTSTRAP_FETCH_OUTPUT=$(git fetch "$BOOTSTRAP_REMOTE" "$BOOTSTRAP_UPSTREAM_BRANCH" --quiet 2>&1) || {
                    bootstrap_emit_token_required "The token did not work. Please get a fresh token and try again."
                    exit "$BOOTSTRAP_TOKEN_REQUIRED_EXIT"
                }
            else
                echo "Could not fetch $BOOTSTRAP_REMOTE/$BOOTSTRAP_UPSTREAM_BRANCH."
                bootstrap_sanitize_git_url "$BOOTSTRAP_FETCH_OUTPUT"
                echo "Please check your connection and run bash scripts/update.sh again."
                exit 1
            fi
        }

        BOOTSTRAP_TMP_DIR="$BOOTSTRAP_REPO_ROOT/.git/AI-OS-update-bootstrap"
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

        __AI_OS_UPDATE_BOOTSTRAPPED=1 \
        AI_OS_UPDATE_BOOTSTRAP_REPO_ROOT="$BOOTSTRAP_REPO_ROOT" \
        AI_OS_UPDATE_BOOTSTRAP_LIB_DIR="$BOOTSTRAP_TMP_DIR/scripts/lib" \
        exec bash "$BOOTSTRAP_TMP_DIR/scripts/update.sh" "$@"
    fi
fi

UPDATE_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
UPDATE_LIB_DIR="${AI_OS_UPDATE_BOOTSTRAP_LIB_DIR:-$UPDATE_SCRIPT_DIR/lib}"

source "$UPDATE_LIB_DIR/common.sh"

# --rollback mode — delegate to dedicated script
if [[ "${1:-}" == "--rollback" ]]; then
    exec bash "$SCRIPT_DIR/rollback.sh"
fi

# Python is required for the catalog steps — fail fast here
source "$UPDATE_LIB_DIR/python.sh"
if ! resolve_python_cmd; then
    printf "  ${RED}Python 3 is required for update.sh.${NC}\n"
    exit 1
fi
source "$UPDATE_LIB_DIR/update-processes.sh"

# =========================================================
# Step 1: Verify we're in a git repo
# =========================================================
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
    echo ""
    printf "  ${RED}Not a git repository.${NC} Run this from the AI-OS root.\n"
    exit 1
fi

validate_update_branch "$UPSTREAM_BRANCH" || exit 1

# Always update from the canonical repo — never a user's backup fork.
UPDATE_REMOTE="$(resolve_update_remote || true)"
if [[ -z "$UPDATE_REMOTE" ]]; then
    UPDATE_REMOTE="upstream"
    UPDATE_TOKEN_STATUS=0
    ensure_update_remote_token "$UPDATE_REMOTE" || UPDATE_TOKEN_STATUS=$?
    if [[ $UPDATE_TOKEN_STATUS -ne 0 ]]; then
        exit "$UPDATE_TOKEN_STATUS"
    fi
fi

UPDATE_ACCESS_STATUS=0
ensure_update_remote_access "$UPDATE_REMOTE" || UPDATE_ACCESS_STATUS=$?
if [[ $UPDATE_ACCESS_STATUS -ne 0 ]]; then
    exit "$UPDATE_ACCESS_STATUS"
fi

OLD_VERSION=$(read_ai_os_version)

echo ""
printf "${CYAN}${BOLD}"
cat << 'BANNER'
    ╔══════════════════════════════════════════════╗
    ║                                              ║
    ║                   AI-OS                      ║
    ║                                              ║
    ║               Update Check                   ║
    ║                                              ║
    ╚══════════════════════════════════════════════╝
BANNER
printf "${NC}"
printf "    ${DIM}Current version: %s${NC}\n" "$(format_ai_os_version "$OLD_VERSION")"
echo ""

# Step 2: Read installed.json
[[ -f "$INSTALLED" ]] && HAVE_INSTALLED_JSON=true || HAVE_INSTALLED_JSON=false

# Step 3: Save current HEAD before any pull
OLD_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
OLD_HEAD=$(git rev-parse HEAD)
LAST_UPDATED=$(git log -1 --format="%cd" --date=format:"%d %b %Y at %H:%M" 2>/dev/null || echo "unknown")

# Stop only processes owned by this installation, and never while tasks are active.
prepare_update_processes || exit 1

# Steps 4–5c: back up modified files + prevent merge conflicts
source "$UPDATE_LIB_DIR/backup.sh"

# Step 6: pull, nuclear fallback, restore, and display Step 1 of 4
source "$UPDATE_LIB_DIR/pull.sh"

# Step 2 of 4: skill review + other file review + restore stash
source "$UPDATE_LIB_DIR/merge.sh"

# Legacy GSD migration must run after the safe pull/merge work and before the final summary.
source "$UPDATE_LIB_DIR/gsd-migration.sh"
ai_os_gsd_run_update_migration "$REPO_ROOT" || true

# Steps 3–4: gate new skills, catalog, GSD, summary, What's New
source "$UPDATE_LIB_DIR/catalog.sh"
restore_update_background_services 0 || true
update_recovery_deactivate_guard

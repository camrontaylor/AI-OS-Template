#!/usr/bin/env bash
# Shared setup sourced by update.sh and rollback.sh.
# Uses BASH_SOURCE so it resolves correctly regardless of the caller's CWD.

# ---------- Colors ----------
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()  { printf "  ${CYAN}%b${NC}\n" "$1"; }
ok()    { printf "  ${GREEN}✓ %b${NC}\n" "$1"; }
warn()  { printf "  ${YELLOW}→ %b${NC}\n" "$1"; }
bullet(){ printf "    ${DIM}•${NC} %b\n" "$1"; }

read_ai_os_version() {
    local version_file="${1:-$REPO_ROOT/VERSION}"
    local version=""
    if [[ -f "$version_file" ]]; then
        version=$(head -n 1 "$version_file" 2>/dev/null | tr -d '\r' || true)
    fi
    if [[ -z "$version" ]]; then
        printf "unknown\n"
    else
        printf "%s\n" "$version"
    fi
}

format_ai_os_version() {
    local version="${1:-unknown}"
    if [[ "$version" == "unknown" || -z "$version" ]]; then
        printf "version unknown\n"
    else
        printf "v%s\n" "$version"
    fi
}

# ---------- Repo root from this file's location ----------
if [[ -n "${AI_OS_UPDATE_BOOTSTRAP_REPO_ROOT:-}" ]]; then
    REPO_ROOT="$AI_OS_UPDATE_BOOTSTRAP_REPO_ROOT"
    case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) REPO_ROOT="$(cygpath -m "$REPO_ROOT")" ;; esac
    SCRIPT_DIR="$REPO_ROOT/scripts"
else
    _COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    SCRIPT_DIR="$(dirname "$_COMMON_DIR")"     # scripts/
    REPO_ROOT="$(dirname "$SCRIPT_DIR")"       # repo root
    case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) REPO_ROOT="$(cygpath -m "$REPO_ROOT")" ;; esac
fi
cd "$REPO_ROOT"

trim_update_value() {
    local value="${1:-}"
    value="${value//$'\r'/}"
    value="${value//$'\n'/}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    printf "%s" "$value"
}

read_update_env_value() {
    local key="$1"

    # Update source settings intentionally come only from the root .env.
    # Long-lived shells and the Command Centre may inherit stale values.
    if [[ -f "$REPO_ROOT/.env" ]]; then
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
        ' "$REPO_ROOT/.env"
    fi
}

resolve_update_setting() {
    local key="$1"
    local default_value="$2"
    local value

    value="$(read_update_env_value "$key" | head -n 1)"
    value="$(trim_update_value "$value")"
    if [[ -n "$value" ]]; then
        printf '%s\n' "$value"
    else
        printf '%s\n' "$default_value"
    fi
}

validate_update_branch() {
    local branch="${1:-}"
    local env_name="${2:-AI_OS_UPSTREAM_BRANCH}"

    if [[ -z "$branch" || "$branch" == -* ]] ||
        ! git check-ref-format --branch "$branch" >/dev/null 2>&1; then
        printf "  ${RED}Invalid %s: %s${NC}\n" "$env_name" "$branch"
        printf "  Use a valid Git branch name, for example: main, dev, or feature/test-update.\n"
        return 1
    fi
}

# ---------- Upstream branch ----------
UPSTREAM_BRANCH="$(resolve_update_setting AI_OS_UPSTREAM_BRANCH main)"

# ---------- Canonical upstream ----------
# Updates must ALWAYS come from the canonical AI-OS repo, never from a
# user's backup fork. In the fork workflow `origin` is the user's private fork
# and the canonical repo lives at `upstream`, so we resolve the update remote by
# URL rather than trusting a fixed remote name.
UPSTREAM_SLUG="$(resolve_update_setting AI_OS_UPSTREAM_SLUG "camrontaylor/AI-OS-Template")"
UPDATE_TOKEN_REQUIRED_MARKER="AI_OS_UPDATE_TOKEN_REQUIRED"
UPDATE_TOKEN_REQUIRED_EXIT=20
UPDATE_TOKEN_HELP_URL="https://github.com/settings/tokens"

# Echo the name of the first remote whose URL points at the canonical repo.
# Preference order: upstream, origin, then any other remote. Returns 1 if none.
resolve_update_remote() {
    [[ -n "$UPSTREAM_SLUG" ]] || return 1
    local preferred="upstream origin" remote url seen=" "
    for remote in $preferred $(git remote 2>/dev/null); do
        case "$seen" in *" $remote "*) continue ;; esac
        seen="$seen$remote "
        git remote get-url "$remote" >/dev/null 2>&1 || continue
        url=$(git remote get-url "$remote" 2>/dev/null)
        case "$url" in *"$UPSTREAM_SLUG"*) printf '%s\n' "$remote"; return 0 ;; esac
    done
    return 1
}

trim_token() {
    local token="${1:-}"
    token="${token//$'\r'/}"
    token="${token//$'\n'/}"
    token="${token#"${token%%[![:space:]]*}"}"
    token="${token%"${token##*[![:space:]]}"}"
    printf "%s" "$token"
}

sanitize_git_url() {
    local url="${1:-}"
    printf "%s" "$url" | sed -E 's#(https?://)[^/@]+@#\1<token>@#g'
}

update_remote_url_for_token() {
    local token="$1"
    printf "https://%s@github.com/%s.git" "$token" "$UPSTREAM_SLUG"
}

is_update_auth_error() {
    local output="${1:-}"
    printf "%s" "$output" | grep -Eqi \
        "authentication failed|invalid credentials|could not read username|could not read password|repository not found|support for password authentication was removed|http basic: access denied|fatal: authentication|403|401"
}

set_update_remote_token() {
    local remote="${1:-upstream}"
    local token
    token="$(trim_token "${2:-}")"

    if [[ -z "$token" ]]; then
        return 1
    fi

    local remote_url
    remote_url="$(update_remote_url_for_token "$token")"
    if git remote get-url "$remote" >/dev/null 2>&1; then
        git remote set-url "$remote" "$remote_url"
    else
        git remote add "$remote" "$remote_url"
    fi
    ok "Saved the new AI-OS access token on the '$remote' update remote."
    return 0
}

prompt_for_update_token() {
    local token=""
    echo ""
    printf "${YELLOW}${BOLD}GitHub needs a new AI-OS access token.${NC}\n"
    echo ""
    echo "  The token used for updates may have expired or rotated."
    echo "  Get the latest token from:"
    printf "  ${CYAN}%s${NC}\n" "$UPDATE_TOKEN_HELP_URL"
    echo ""
    echo "  Paste the token below. It will be visible so you can confirm it pasted correctly."
    printf "  New token: "
    read -r token
    token="$(trim_token "$token")"
    if [[ -z "$token" ]]; then
        warn "No token entered."
        return 1
    fi
    UPDATE_TOKEN_FROM_PROMPT="$token"
    return 0
}

emit_update_token_required() {
    local remote="${1:-upstream}"
    local reason="${2:-GitHub rejected the AI-OS access token.}"

    echo ""
    printf "%s\n" "$UPDATE_TOKEN_REQUIRED_MARKER"
    printf "${YELLOW}${BOLD}GitHub access token required${NC}\n"
    warn "$reason"
    echo ""
    echo "  Get the latest token from:"
    printf "  ${CYAN}%s${NC}\n" "$UPDATE_TOKEN_HELP_URL"
    echo ""
    echo "  Then either:"
    printf "  ${BOLD}bash scripts/update.sh${NC} and paste it when asked\n"
    echo "  or update the remote manually:"
    if git remote get-url "$remote" >/dev/null 2>&1; then
        printf "  ${BOLD}git remote set-url %s https://<NEW-TOKEN>@github.com/%s.git${NC}\n" "$remote" "$UPSTREAM_SLUG"
    else
        printf "  ${BOLD}git remote add upstream https://<NEW-TOKEN>@github.com/%s.git${NC}\n" "$UPSTREAM_SLUG"
    fi
    echo ""
    info "Nothing was changed — your local files are untouched."
}

ensure_update_remote_token() {
    local remote="${1:-upstream}"
    local env_token
    env_token="$(trim_token "${AI_OS_UPDATE_TOKEN:-}")"

    if [[ -n "$env_token" ]]; then
        set_update_remote_token "$remote" "$env_token"
        return $?
    fi

    if [[ -t 0 ]]; then
        if prompt_for_update_token; then
            set_update_remote_token "$remote" "$UPDATE_TOKEN_FROM_PROMPT"
            return $?
        fi
        emit_update_token_required "$remote" "No new token was entered."
        return "$UPDATE_TOKEN_REQUIRED_EXIT"
    fi

    emit_update_token_required "$remote"
    return "$UPDATE_TOKEN_REQUIRED_EXIT"
}

ensure_update_remote_access() {
    local remote="${1:-upstream}"
    local output=""

    output=$(git ls-remote "$remote" "refs/heads/$UPSTREAM_BRANCH" 2>&1) && return 0

    if ! is_update_auth_error "$output"; then
        return 0
    fi

    local token_status=0
    ensure_update_remote_token "$remote" || token_status=$?
    if [[ $token_status -ne 0 ]]; then
        return "$token_status"
    fi

    output=$(git ls-remote "$remote" "refs/heads/$UPSTREAM_BRANCH" 2>&1) && return 0

    if is_update_auth_error "$output"; then
        emit_update_token_required "$remote" "The token did not work. Please get a fresh token and try again."
        return "$UPDATE_TOKEN_REQUIRED_EXIT"
    fi

    warn "Could not reach the AI-OS update repo after saving the token."
    warn "Git said: $(sanitize_git_url "$output")"
    return 1
}

# Print copy-pasteable guidance for pointing a remote at the canonical repo.
# Used both when no canonical remote is configured and when a fetch auth fails.
print_upstream_help() {
    local remote="${1:-upstream}"
    echo ""
    printf "${YELLOW}${BOLD}═══════════════════════════════════════════════${NC}\n"
    printf "${YELLOW}${BOLD}  Can't reach the AI-OS update repo${NC}\n"
    printf "${YELLOW}${BOLD}═══════════════════════════════════════════════${NC}\n"
    echo ""
    warn "Updates come from ${BOLD}${UPSTREAM_SLUG}${NC}, but no working remote points there."
    warn "Your access token may also have been rotated."
    echo ""
    info "To fix this:"
    echo ""
    echo "  1. Get the latest token from:"
    printf "     ${CYAN}%s${NC}\n" "$UPDATE_TOKEN_HELP_URL"
    echo ""
    echo "  2. Point a remote at the update repo:"
    if git remote get-url "$remote" >/dev/null 2>&1; then
        printf "     ${BOLD}git remote set-url %s https://<NEW-TOKEN>@github.com/%s.git${NC}\n" "$remote" "$UPSTREAM_SLUG"
    else
        printf "     ${BOLD}git remote add upstream https://<NEW-TOKEN>@github.com/%s.git${NC}\n" "$UPSTREAM_SLUG"
    fi
    echo ""
    echo "  3. Run this script again:"
    printf "     ${BOLD}bash scripts/update.sh${NC}\n"
    echo ""
    info "Nothing was changed — your local files are untouched."
}

# ---------- Key paths ----------
BACKUP_DIR="$REPO_ROOT/.backup"
CATALOG="$REPO_ROOT/.claude/skills/_catalog/catalog.json"
INSTALLED="$REPO_ROOT/.claude/skills/_catalog/installed.json"
REVIEWED_STATE="$BACKUP_DIR/.update-reviewed"
UPDATE_TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
UPDATE_RECOVERY_REPORT="$BACKUP_DIR/update-recovery-${UPDATE_TIMESTAMP}.txt"
UPDATE_RECOVERY_GUARD_ACTIVE=false
UPDATE_RECOVERY_RESTORE_ATTEMPTED=false

update_recovery_activate_guard() {
    UPDATE_RECOVERY_GUARD_ACTIVE=true
    mkdir -p "$BACKUP_DIR" 2>/dev/null || true
}

update_recovery_deactivate_guard() {
    UPDATE_RECOVERY_GUARD_ACTIVE=false
}

update_recovery_has_files() {
    local path="$1"
    [[ -d "$path" ]] || return 1
    find "$path" -mindepth 1 -print -quit 2>/dev/null | grep -q .
}

update_recovery_list_array() {
    local list_name="$1"
    local prefix="$2"
    local count
    local -a values=()
    local value

    declare -p "$list_name" >/dev/null 2>&1 || return 0
    eval 'count=${#'"$list_name"'[@]}'
    [[ "$count" -gt 0 ]] || return 0
    eval 'values=("${'"$list_name"'[@]}")'

    for value in "${values[@]}"; do
        [[ -n "$value" ]] && printf "%s%s\n" "$prefix" "$value"
    done
}

restore_update_backups() {
    UPDATE_RECOVERY_RESTORE_ATTEMPTED=true

    git merge --abort >/dev/null 2>&1 || true

    if declare -F restore_upstream_protected_backups >/dev/null 2>&1; then
        restore_upstream_protected_backups || true
    fi

    if [[ "${STASHED:-false}" == true ]] &&
        declare -F restore_protected_stash >/dev/null 2>&1; then
        restore_protected_stash || true
    fi

    local count skill_name file
    local -a skills=()
    local -a files=()

    if declare -p MODIFIED_SKILLS >/dev/null 2>&1; then
        eval 'count=${#MODIFIED_SKILLS[@]}'
        if [[ "$count" -gt 0 ]]; then
            eval 'skills=("${MODIFIED_SKILLS[@]}")'
            for skill_name in "${skills[@]}"; do
                [[ -n "$skill_name" ]] || continue
                [[ -n "${SKILL_BACKUP_DIR:-}" ]] || continue
                mkdir -p "$REPO_ROOT/.claude/skills/$skill_name" 2>/dev/null || true
                cp -r "$SKILL_BACKUP_DIR/$skill_name"/* "$REPO_ROOT/.claude/skills/$skill_name/" 2>/dev/null || true
            done
        fi
    fi

    if declare -p OTHER_MODIFIED_FILES >/dev/null 2>&1; then
        eval 'count=${#OTHER_MODIFIED_FILES[@]}'
        if [[ "$count" -gt 0 ]]; then
            eval 'files=("${OTHER_MODIFIED_FILES[@]}")'
            for file in "${files[@]}"; do
                [[ -n "$file" ]] || continue
                [[ -n "${OTHER_BACKUP_DIR:-}" ]] || continue
                mkdir -p "$(dirname "$REPO_ROOT/$file")" 2>/dev/null || true
                cp "$OTHER_BACKUP_DIR/$file" "$REPO_ROOT/$file" 2>/dev/null || true
            done
        fi
    fi
}

update_recovery_emit_report_body() {
    local exit_status="${1:-unknown}"
    local stashes

    echo "AI-OS update recovery report"
    echo "Generated: $(date)"
    echo "Repository: $REPO_ROOT"
    echo "Exit status: $exit_status"
    echo "Pre-update commit: ${OLD_HEAD:-unknown}"
    echo "Update source: ${UPDATE_REMOTE:-unknown}/${UPSTREAM_BRANCH:-unknown}"
    echo ""
    echo "Your files are safe in:"

    if update_recovery_has_files "${PROTECTED_STASH_BACKUP_DIR:-}"; then
        echo "- Protected file stash backup: $PROTECTED_STASH_BACKUP_DIR"
    fi
    if update_recovery_has_files "${UPSTREAM_PROTECTED_BACKUP_DIR:-}"; then
        echo "- Protected upstream backup: $UPSTREAM_PROTECTED_BACKUP_DIR"
    fi
    if update_recovery_has_files "${SKILL_BACKUP_DIR:-}"; then
        echo "- Skill backup: $SKILL_BACKUP_DIR"
    fi
    if update_recovery_has_files "${OTHER_BACKUP_DIR:-}"; then
        echo "- Other changed-file backup: $OTHER_BACKUP_DIR"
    fi

    stashes=$(git stash list --format='%gd %gs' 2>/dev/null | grep 'AI-OS-update-' || true)
    if [[ -n "$stashes" ]]; then
        echo "- AI-OS update stashes:"
        printf "%s\n" "$stashes" | sed 's/^/  - /'
        echo "  Restore with:"
        git stash list --format='%H %gs' 2>/dev/null | awk '/AI-OS-update-/ { print "  git stash apply " $1 }'
    fi

    echo "- Pre-update commit: ${OLD_HEAD:-unknown}"
    echo "- This report: $UPDATE_RECOVERY_REPORT"
    echo ""
    echo "Backed up protected files:"
    update_recovery_list_array PROTECTED_STASH_BACKED_UP_PATHS "- "
    update_recovery_list_array UPSTREAM_PROTECTED_BACKED_UP_PATHS "- "
    echo ""
    echo "Backed up skills:"
    update_recovery_list_array MODIFIED_SKILLS "- "
    echo ""
    echo "Backed up changed files:"
    update_recovery_list_array OTHER_MODIFIED_FILES "- "
    echo ""
    echo "Recovery helper:"
    echo "bash scripts/update-recovery.sh --latest"
}

update_recovery_write_report() {
    local exit_status="${1:-unknown}"

    mkdir -p "$BACKUP_DIR" 2>/dev/null || true
    update_recovery_emit_report_body "$exit_status" > "$UPDATE_RECOVERY_REPORT" 2>/dev/null || true
}

update_recovery_print_failure_message() {
    local exit_status="${1:-unknown}"

    echo ""
    printf "${YELLOW}${BOLD}═══════════════════════════════════════════════${NC}\n"
    printf "${YELLOW}${BOLD}  Update stopped before finishing${NC}\n"
    printf "${YELLOW}${BOLD}═══════════════════════════════════════════════${NC}\n"
    echo ""
    warn "Your files are safe in:"

    if update_recovery_has_files "${PROTECTED_STASH_BACKUP_DIR:-}"; then
        bullet "Protected file stash backup: ${BOLD}${PROTECTED_STASH_BACKUP_DIR}${NC}"
    fi
    if update_recovery_has_files "${UPSTREAM_PROTECTED_BACKUP_DIR:-}"; then
        bullet "Protected upstream backup: ${BOLD}${UPSTREAM_PROTECTED_BACKUP_DIR}${NC}"
    fi
    if update_recovery_has_files "${SKILL_BACKUP_DIR:-}"; then
        bullet "Skill backup: ${BOLD}${SKILL_BACKUP_DIR}${NC}"
    fi
    if update_recovery_has_files "${OTHER_BACKUP_DIR:-}"; then
        bullet "Other changed-file backup: ${BOLD}${OTHER_BACKUP_DIR}${NC}"
    fi
    if git stash list --format='%gd %gs' 2>/dev/null | grep -q 'AI-OS-update-'; then
        bullet "AI-OS update stashes: ${BOLD}git stash list | grep AI-OS-update${NC}"
    fi
    bullet "Pre-update commit: ${BOLD}${OLD_HEAD:-unknown}${NC}"
    bullet "Recovery report: ${BOLD}${UPDATE_RECOVERY_REPORT}${NC}"
    echo ""
    if declare -F print_update_stash_recovery >/dev/null 2>&1; then
        print_update_stash_recovery
        echo ""
    fi
    info "To show the latest recovery report:"
    printf "  ${BOLD}bash scripts/update-recovery.sh --latest${NC}\n"
    echo ""
    info "Exit status: ${BOLD}${exit_status}${NC}"
}

update_recovery_on_exit() {
    local exit_status="$1"

    if declare -F restore_update_background_services >/dev/null 2>&1; then
        set +e
        restore_update_background_services "$exit_status"
        set -e
    fi

    [[ "$exit_status" -ne 0 ]] || return 0
    [[ "${UPDATE_RECOVERY_GUARD_ACTIVE:-false}" == true ]] || return 0

    set +e
    restore_update_backups
    update_recovery_write_report "$exit_status"
    update_recovery_print_failure_message "$exit_status"
    return 0
}

trap 'update_recovery_on_exit $?' EXIT

# ---------- Reviewed-state helpers ----------
file_md5() {
    md5 -q "$1" 2>/dev/null || md5sum "$1" 2>/dev/null | awk '{print $1}' || echo ""
}

was_already_reviewed() {
    local file="$1"
    [[ ! -f "$REVIEWED_STATE" ]] && return 1
    local current_md5
    current_md5=$(file_md5 "$REPO_ROOT/$file")
    [[ -z "$current_md5" ]] && return 1
    grep -qx "${file}:${current_md5}" "$REVIEWED_STATE" 2>/dev/null
}

mark_reviewed() {
    local file="$1"
    local current_md5
    current_md5=$(file_md5 "$REPO_ROOT/$file")
    [[ -z "$current_md5" ]] && return
    mkdir -p "$BACKUP_DIR"
    if [[ -f "$REVIEWED_STATE" ]]; then
        grep -v "^${file}:" "$REVIEWED_STATE" > "${REVIEWED_STATE}.tmp" 2>/dev/null || true
        mv "${REVIEWED_STATE}.tmp" "$REVIEWED_STATE"
    fi
    echo "${file}:${current_md5}" >> "$REVIEWED_STATE"
}

# ---------- Smart Merge helper ----------
# Merges user's SKILL.md Rules entries into the upstream version.
# Strategy: take upstream as base, inject any user dated entries missing from it.
# Pure Python — deterministic, no LLM dependency, works on all platforms.
smart_merge_file() {
    local user_file="$1"
    local upstream_file="$2"
    local ancestor_file="$3"   # signature-compatible; not used
    local file_type="$4"

    if [[ ! -f "$user_file" ]] || [[ ! -s "$user_file" ]]; then
        warn "Smart Merge: user file missing: $user_file"
        return 1
    fi
    if [[ ! -f "$upstream_file" ]]; then
        warn "Smart Merge: upstream file missing: $upstream_file"
        return 1
    fi

    mkdir -p "$BACKUP_DIR"
    local py_script="$BACKUP_DIR/smart_merge_${UPDATE_TIMESTAMP}.py"

    cat > "$py_script" << 'PYEOF'
import re, sys

user_file, upstream_file = sys.argv[1], sys.argv[2]

try:
    with open(user_file, encoding="utf-8", errors="replace") as f:
        user_lines = f.read().splitlines()
    with open(upstream_file, encoding="utf-8", errors="replace") as f:
        upstream_text = f.read()
    upstream_lines = upstream_text.splitlines()
except Exception as e:
    print("read error: " + str(e), file=sys.stderr)
    sys.exit(1)

# Collect user's dated entries from ## Rules section
user_entries = []
in_rules = False
for line in user_lines:
    if line.strip() == "## Rules":
        in_rules = True
    elif in_rules and line.startswith("## ") and line.strip() != "## Rules":
        break
    elif in_rules and re.match(r"^- \d{4}-\d{2}-\d{2}:", line):
        user_entries.append(line)

# Find entries missing from the upstream version
missing = [e for e in user_entries if e not in upstream_text]
if not missing:
    sys.exit(0)

# Locate end of ## Rules section in upstream (first ## heading or bare --- after it)
insert_at = -1
in_rules = False
for i, line in enumerate(upstream_lines):
    if line.strip() == "## Rules":
        in_rules = True
    elif in_rules:
        if line.startswith("## ") or line.rstrip() == "---":
            insert_at = i
            break

if insert_at == -1:
    print("could not locate Rules section end", file=sys.stderr)
    sys.exit(1)

for entry in missing:
    upstream_lines.insert(insert_at, entry)
    insert_at += 1

try:
    with open(upstream_file, "w", encoding="utf-8") as f:
        f.write("\n".join(upstream_lines))
        if upstream_text.endswith("\n"):
            f.write("\n")
except Exception as e:
    print("write error: " + str(e), file=sys.stderr)
    sys.exit(1)

sys.exit(0)
PYEOF

    local merge_output exit_code
    merge_output=$("${PYTHON_CMD[@]}" "$py_script" "$user_file" "$upstream_file" 2>&1)
    exit_code=$?
    rm -f "$py_script"

    if [[ $exit_code -ne 0 ]]; then
        warn "Smart Merge python error: $merge_output"
        return 1
    fi
}

# ---------- Protected paths (never overwritten) ----------
PROTECTED_EXACT_PATHS=(
    ".env"
    ".mcp.json"
    ".claude/settings.local.json"
    ".claude/skills/_catalog/installed.json"
    ".claude/skills/viz-ugc-heygen/references/avatar-config.md"
)

PROTECTED_DIR_PATHS=(
    "context/"
    "brand_context/"
    "projects/"
    "cron/jobs/"
    ".planning/"
)

# Everything under clients/<slug>/.claude/skills/ is client-owned.
# Clients inherit the root skill pack via project-root skill discovery, so
# nothing inside a client skills directory is a root-managed copy anymore.
is_protected_path() {
    local path="${1:-}"
    path="${path#./}"
    path="${path//\\//}"

    local protected_path
    for protected_path in "${PROTECTED_EXACT_PATHS[@]}"; do
        if [[ "$path" == "$protected_path" ]]; then
            return 0
        fi
    done

    for protected_path in "${PROTECTED_DIR_PATHS[@]}"; do
        if [[ "$path" == "${protected_path%/}" || "$path" == "$protected_path"* ]]; then
            return 0
        fi
    done

    case "$path" in
        clients/*/context|clients/*/context/*) return 0 ;;
        clients/*/brand_context|clients/*/brand_context/*) return 0 ;;
        clients/*/projects|clients/*/projects/*) return 0 ;;
        clients/*/cron/jobs|clients/*/cron/jobs/*) return 0 ;;
        clients/*/.planning|clients/*/.planning/*) return 0 ;;
        clients/*/.env) return 0 ;;
        clients/*/.mcp.json) return 0 ;;
        clients/*/.claude/settings.local.json) return 0 ;;
        clients/*/AGENTS.md) return 0 ;;
        clients/*/.claude/skills|clients/*/.claude/skills/*) return 0 ;;
    esac

    return 1
}

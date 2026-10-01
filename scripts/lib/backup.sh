#!/usr/bin/env bash
# Steps 4–5c: Stash protected files, scan and backup modified skills and other
# tracked files, then prevent merge conflicts from files deleted upstream.

# =========================================================
# Step 4: Stash local changes to protected paths
# =========================================================
STASHED=false
PROTECTED_STASH_REF=""
PROTECTED_STASH_COMMIT=""
PROTECTED_DIRTY_PATHS=()
PROTECTED_STASH_PATHS=()
PROTECTED_STASH_BACKUP_DIR="$BACKUP_DIR/protected-stash-${UPDATE_TIMESTAMP}"
PROTECTED_STASH_BACKED_UP_PATHS=()
UPSTREAM_PROTECTED_BACKUP_DIR="$BACKUP_DIR/protected-upstream-${UPDATE_TIMESTAMP}"
UPSTREAM_PROTECTED_BACKED_UP_PATHS=()

add_unique_path() {
    local list_name="$1"
    local candidate="$2"
    local existing
    local count
    local -a values=()

    # bash 3.2 (stock macOS) errors on "${arr[@]}" for an empty array under
    # set -u, so guard the expansion with a length check first.
    eval 'count=${#'"$list_name"'[@]}'
    if [[ "$count" -gt 0 ]]; then
        eval 'values=("${'"$list_name"'[@]}")'
        for existing in "${values[@]}"; do
            [[ "$existing" == "$candidate" ]] && return 0
        done
    fi

    eval "${list_name}+=(\"\$candidate\")"
}

collect_protected_changes() {
    PROTECTED_DIRTY_PATHS=()
    local dirty_files file
    dirty_files=$(
        {
            git diff --name-only 2>/dev/null || true
            git diff --cached --name-only 2>/dev/null || true
            git ls-files --others --exclude-standard 2>/dev/null || true
            for file in "${PROTECTED_EXACT_PATHS[@]}"; do
                [[ -e "$REPO_ROOT/$file" ]] && printf '%s\n' "$file"
            done
            if [[ -d "$REPO_ROOT/.planning" ]]; then
                find "$REPO_ROOT/.planning" -type f 2>/dev/null | sed "s|^$REPO_ROOT/||"
            fi
            if [[ -d "$REPO_ROOT/clients" ]]; then
                find "$REPO_ROOT/clients" -type f \( \
                    -path "$REPO_ROOT/clients/*/.env" -o \
                    -path "$REPO_ROOT/clients/*/.mcp.json" -o \
                    -path "$REPO_ROOT/clients/*/.claude/settings.local.json" -o \
                    -path "$REPO_ROOT/clients/*/.planning/*" \
                \) 2>/dev/null | sed "s|^$REPO_ROOT/||"
            fi
        } | sort -u | grep -v '^$' || true
    )

    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        if is_protected_path "$file"; then
            PROTECTED_DIRTY_PATHS+=("$file")
        fi
    done <<< "$dirty_files"

    [[ ${#PROTECTED_DIRTY_PATHS[@]} -gt 0 ]]
}

is_user_config_path() {
    case "${1:-}" in
        .env|.mcp.json|.claude/settings.local.json|.claude/skills/_catalog/installed.json) return 0 ;;
        clients/*/.env|clients/*/.mcp.json) return 0 ;;
        clients/*/.claude/settings.local.json|clients/*/.claude/skills/_catalog/installed.json) return 0 ;;
    esac
    return 1
}

# Untracked user config and gitignored files stay on disk. git pull and
# reset --hard only replace them when upstream starts tracking the same path,
# and backup_protected_paths_changed_upstream already copies those aside.
# Stashing them bought nothing and stranded .env/.mcp.json whenever the update
# died before its restore ran (AIOS-473).
split_protected_stash_paths() {
    PROTECTED_STASH_PATHS=()
    [[ ${#PROTECTED_DIRTY_PATHS[@]} -gt 0 ]] || return 1

    # One pass: paths reach git on stdin (a large .planning/ overflows the
    # Windows command line as argv) and one awk lookup replaces a grep per
    # file. check-ignore skips tracked files; the existence test drops staged
    # deletions, so this matches ls-files --others --ignored.
    local ignored="" candidates file
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        if [[ -e "$REPO_ROOT/$file" || -L "$REPO_ROOT/$file" ]]; then
            ignored+="$file"$'\n'
        fi
    done < <(printf '%s\n' "${PROTECTED_DIRTY_PATHS[@]}" | git -c core.quotePath=false check-ignore --stdin 2>/dev/null || true)

    # The leading blank line keeps awk's first input non-empty, so NR == FNR
    # never spills into the path list when nothing is ignored.
    candidates=$(printf '%s\n' "${PROTECTED_DIRTY_PATHS[@]}" |
        awk 'NR == FNR { ignored[$0] = 1; next } !($0 in ignored)' <(printf '\n%s' "$ignored") -)

    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        if is_user_config_path "$file" &&
            ! git ls-files --error-unmatch -- "$file" >/dev/null 2>&1; then
            continue
        fi
        PROTECTED_STASH_PATHS+=("$file")
    done <<< "$candidates"

    [[ ${#PROTECTED_STASH_PATHS[@]} -gt 0 ]]
}

# Stash entries shift when anything else pushes a stash, so look ours up by
# commit instead of trusting stash@{0}.
find_stash_ref_for_commit() {
    local commit="$1"
    local sha ref

    while read -r sha ref; do
        if [[ "$sha" == "$commit" ]]; then
            printf '%s\n' "$ref"
            return 0
        fi
    done < <(git stash list --format='%H %gd' 2>/dev/null)

    return 1
}

print_update_stash_recovery() {
    local stashes

    stashes=$(git stash list --format='%H %gs' 2>/dev/null | awk '/AI-OS-update-/ { print $1 }' || true)
    [[ -n "$stashes" ]] || return 0

    info "To restore files from an update stash, run:"
    printf "%s\n" "$stashes" | while IFS= read -r sha; do
        printf "  ${BOLD}git stash apply %s${NC}\n" "$sha"
    done
}

backup_paths_from_stash_tree() {
    local tree_ref="$1"
    local file

    [[ ${#PROTECTED_STASH_PATHS[@]} -gt 0 ]] || return 0
    git rev-parse -q --verify "${tree_ref}^{tree}" >/dev/null 2>&1 || return 0

    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        mkdir -p "$PROTECTED_STASH_BACKUP_DIR/$(dirname "$file")"
        if git cat-file blob "${tree_ref}:${file}" > "$PROTECTED_STASH_BACKUP_DIR/$file" 2>/dev/null; then
            add_unique_path PROTECTED_STASH_BACKED_UP_PATHS "$file"
        fi
    done < <(git ls-tree -r --name-only "$tree_ref" -- "${PROTECTED_STASH_PATHS[@]}" 2>/dev/null | sort -u)
}

backup_protected_stash_contents() {
    [[ -n "${PROTECTED_STASH_COMMIT:-}" ]] || return 0

    backup_paths_from_stash_tree "$PROTECTED_STASH_REF"
    backup_paths_from_stash_tree "${PROTECTED_STASH_REF}^3"
}

restore_protected_stash_backup() {
    [[ ${#PROTECTED_STASH_BACKED_UP_PATHS[@]} -gt 0 ]] || return 1

    git reset --quiet -- "${PROTECTED_STASH_BACKED_UP_PATHS[@]}" 2>/dev/null || true

    local file
    for file in "${PROTECTED_STASH_BACKED_UP_PATHS[@]}"; do
        [[ -f "$PROTECTED_STASH_BACKUP_DIR/$file" ]] || return 1
        mkdir -p "$(dirname "$REPO_ROOT/$file")"
        cp "$PROTECTED_STASH_BACKUP_DIR/$file" "$REPO_ROOT/$file" 2>/dev/null || return 1
    done

    return 0
}

backup_protected_paths_changed_upstream() {
    local remote_ref="$UPDATE_REMOTE/$UPSTREAM_BRANCH"
    local file

    git rev-parse -q --verify "$remote_ref" >/dev/null 2>&1 || return 0

    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        is_protected_path "$file" || continue
        [[ -f "$REPO_ROOT/$file" ]] || continue

        mkdir -p "$UPSTREAM_PROTECTED_BACKUP_DIR/$(dirname "$file")"
        if cp "$REPO_ROOT/$file" "$UPSTREAM_PROTECTED_BACKUP_DIR/$file" 2>/dev/null; then
            update_recovery_activate_guard
            add_unique_path UPSTREAM_PROTECTED_BACKED_UP_PATHS "$file"
        fi
    done < <(git diff --name-only HEAD "$remote_ref" -- 2>/dev/null || true)
}

restore_upstream_protected_backups() {
    [[ ${#UPSTREAM_PROTECTED_BACKED_UP_PATHS[@]} -gt 0 ]] || return 0

    local file
    git reset --quiet -- "${UPSTREAM_PROTECTED_BACKED_UP_PATHS[@]}" 2>/dev/null || true

    for file in "${UPSTREAM_PROTECTED_BACKED_UP_PATHS[@]}"; do
        [[ -f "$UPSTREAM_PROTECTED_BACKUP_DIR/$file" ]] || continue
        mkdir -p "$(dirname "$REPO_ROOT/$file")"
        cp "$UPSTREAM_PROTECTED_BACKUP_DIR/$file" "$REPO_ROOT/$file" 2>/dev/null || true
    done
}

warn_stale_update_stashes() {
    local stashes count

    stashes=$(git stash list --format='%gd %gs' 2>/dev/null | grep 'AI-OS-update-' || true)
    [[ -n "$stashes" ]] || return 0

    count=$(printf "%s\n" "$stashes" | grep -c . || true)
    if [[ "$count" -eq 1 ]]; then
        warn "Found 1 old AI-OS update stash. Keep it until you confirm your data is restored."
    else
        warn "Found ${count} old AI-OS update stashes. Keep them until you confirm your data is restored."
    fi
    info "Review them with: ${BOLD}git stash list | grep AI-OS-update${NC}"
    print_update_stash_recovery
}

restore_protected_stash() {
    $STASHED || return 0

    local stash_ref="${PROTECTED_STASH_REF:-stash@{0}}"

    if [[ -n "${PROTECTED_STASH_COMMIT:-}" ]]; then
        stash_ref=$(find_stash_ref_for_commit "$PROTECTED_STASH_COMMIT" || true)
        if [[ -z "$stash_ref" ]]; then
            warn "Protected-file stash is no longer in the stash list — keeping the update backup for manual recovery."
            return 0
        fi
    fi

    if git stash apply --quiet "$stash_ref" 2>/dev/null; then
        git stash drop "$stash_ref" >/dev/null 2>&1 || true
        STASHED=false
    else
        warn "Protected-file stash did not apply cleanly — restoring protected files from update backup."
        if restore_protected_stash_backup; then
            git stash drop "$stash_ref" >/dev/null 2>&1 || true
            STASHED=false
            ok "Restored protected local files from update backup."
        else
            warn "Could not automatically restore protected local files — kept the stash for manual recovery."
            printf "  ${BOLD}git stash apply %s${NC}\n" "${PROTECTED_STASH_COMMIT:-$stash_ref}"
        fi
    fi
}

if collect_protected_changes && split_protected_stash_paths; then
    update_recovery_activate_guard
    _stash_before=$(git rev-parse -q --verify refs/stash 2>/dev/null || true)
    _stash_status=0
    git stash push --include-untracked -m "AI-OS-update-$(date +%s)" -- "${PROTECTED_STASH_PATHS[@]}" >/dev/null 2>&1 || _stash_status=$?
    _stash_after=$(git rev-parse -q --verify refs/stash 2>/dev/null || true)

    if [[ -n "$_stash_after" ]] && [[ "$_stash_after" != "$_stash_before" ]]; then
        STASHED=true
        PROTECTED_STASH_REF="stash@{0}"
        PROTECTED_STASH_COMMIT="$_stash_after"
        backup_protected_stash_contents
    elif [[ $_stash_status -ne 0 ]]; then
        warn "Could not temporarily stash protected files. Update will continue carefully, but please inspect your local files after it finishes."
    fi
fi

git fetch "$UPDATE_REMOTE" "$UPSTREAM_BRANCH" --quiet 2>/dev/null || true
backup_protected_paths_changed_upstream

# =========================================================
# Step 5: Scan local skill modifications before pull
# =========================================================
SKILL_BACKUP_DIR="$BACKUP_DIR/skills-${UPDATE_TIMESTAMP}"
MODIFIED_SKILLS=()
MODIFIED_SKILL_FILES=()  # parallel array: pipe-separated file list per skill
USER_CREATED_SKILLS=()

if [[ -d "$REPO_ROOT/.claude/skills" ]]; then
    for skill_dir in "$REPO_ROOT/.claude/skills"/*/; do
        [[ -d "$skill_dir" ]] || continue
        skill_name=$(basename "$skill_dir")
        [[ "$skill_name" == "_catalog" ]] && continue

        # Untracked = user-created skill
        tracked_files=$(git ls-files -- ".claude/skills/$skill_name/" 2>/dev/null || true)
        if [[ -z "$tracked_files" ]]; then
            USER_CREATED_SKILLS+=("$skill_name")
            continue
        fi

        # Check for local modifications — always backup and reset, regardless of review state
        modified_files=$(git diff --name-only -- ".claude/skills/$skill_name/" 2>/dev/null || true)
        if [[ -n "$modified_files" ]]; then
            update_recovery_activate_guard
            mkdir -p "$SKILL_BACKUP_DIR/$skill_name"
            cp -r "$skill_dir"* "$SKILL_BACKUP_DIR/$skill_name/" 2>/dev/null || true
            MODIFIED_SKILLS+=("$skill_name")
            file_list=$(echo "$modified_files" | while IFS= read -r f; do basename "$f"; done | tr '\n' '|' | sed 's/|$//')
            MODIFIED_SKILL_FILES+=("$file_list")

        fi
    done
fi

# Reset modified skill files to HEAD so git pull won't conflict.
# Migration runs AFTER checkout so git can't overwrite the new SKILL.local.md.
if [[ ${#MODIFIED_SKILLS[@]} -gt 0 ]]; then
    for skill_name in "${MODIFIED_SKILLS[@]}"; do
        git checkout HEAD -- ".claude/skills/$skill_name/" 2>/dev/null || true
        local_md="$REPO_ROOT/.claude/skills/$skill_name/SKILL.local.md"
        backup_md="$SKILL_BACKUP_DIR/$skill_name/SKILL.md"
        if [[ ! -f "$local_md" ]] && [[ -f "$backup_md" ]]; then
            cp "$backup_md" "$local_md" 2>/dev/null || true
            _synth="$SCRIPT_DIR/lib/synthesize.py"
            _base="$REPO_ROOT/.claude/skills/$skill_name/SKILL.md"
            [[ -f "$_synth" ]] && [[ -f "$_base" ]] && "${PYTHON_CMD[@]}" "$_synth" "$local_md" "$_base" 2>/dev/null || true
            ok "Migrated $skill_name → SKILL.local.md"
        fi
    done
fi

# =========================================================
# Step 5b: Stash other modified tracked files (not protected, not skills)
# =========================================================
OTHER_BACKUP_DIR="$BACKUP_DIR/other-${UPDATE_TIMESTAMP}"
OTHER_MODIFIED_FILES=()

ALL_MODIFIED=$(git diff --name-only 2>/dev/null || true)
ALL_STAGED=$(git diff --cached --name-only 2>/dev/null || true)
ALL_DIRTY=$(printf '%s\n%s' "$ALL_MODIFIED" "$ALL_STAGED" | sort -u | grep -v '^$' || true)

if [[ -n "$ALL_DIRTY" ]]; then
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue

        # Skip protected paths
        if is_protected_path "$file"; then
            continue
        fi

        # Skip skill files (handled separately above)
        case "$file" in
            .claude/skills/*) continue ;;
        esac

        # Skip files already reviewed with unchanged content
        if was_already_reviewed "$file"; then
            continue
        fi

        update_recovery_activate_guard
        mkdir -p "$OTHER_BACKUP_DIR/$(dirname "$file")"
        cp "$REPO_ROOT/$file" "$OTHER_BACKUP_DIR/$file" 2>/dev/null || true
        OTHER_MODIFIED_FILES+=("$file")
    done <<< "$ALL_DIRTY"
fi

# Reset other modified files so git pull won't conflict.
# Migration for CLAUDE.md runs AFTER checkout for the same reason.
if [[ ${#OTHER_MODIFIED_FILES[@]} -gt 0 ]]; then
    for file in "${OTHER_MODIFIED_FILES[@]}"; do
        git checkout HEAD -- "$file" 2>/dev/null || true
        if [[ "$(basename "$file")" == "CLAUDE.md" ]]; then
            _local_md="$REPO_ROOT/$(dirname "$file")/CLAUDE.local.md"
            [[ "$(dirname "$file")" == "." ]] && _local_md="$REPO_ROOT/CLAUDE.local.md"
            if [[ ! -f "$_local_md" ]] && [[ -f "$OTHER_BACKUP_DIR/$file" ]]; then
                cp "$OTHER_BACKUP_DIR/$file" "$_local_md" 2>/dev/null || true
                _synth="$SCRIPT_DIR/lib/synthesize.py"
                _base="$REPO_ROOT/$file"
                [[ -f "$_synth" ]] && [[ -f "$_base" ]] && "${PYTHON_CMD[@]}" "$_synth" "$_local_md" "$_base" 2>/dev/null || true
                ok "Migrated CLAUDE.md → CLAUDE.local.md"
            fi
        fi
    done
fi

if [[ "${AI_OS_TEST_FAIL_AFTER_BACKUP:-0}" == "1" ]]; then
    warn "Injected update failure after backup for test."
    false
fi

# Simulates another tool pushing its own stash while the update runs.
if [[ "${AI_OS_TEST_PUSH_FOREIGN_STASH:-0}" == "1" ]]; then
    printf 'foreign stash test\n' > "$REPO_ROOT/.AI-OS-foreign-stash-test"
    git stash push --include-untracked -m "foreign-stash-test" -- .AI-OS-foreign-stash-test >/dev/null 2>&1 || true
fi

# Simulates the update dying without running its EXIT trap (window closed,
# SSH dropped, process killed).
if [[ "${AI_OS_TEST_KILL_AFTER_BACKUP:-0}" == "1" ]]; then
    warn "Injected SIGKILL after backup for test."
    kill -KILL $$
fi

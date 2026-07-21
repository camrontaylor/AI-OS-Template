#!/usr/bin/env bash
# Steps 4-5c: Stash protected files, scan and backup modified skills and other
# tracked files, then prevent merge conflicts from files deleted upstream.

# =========================================================
# Step 4: Stash local changes to protected paths
# =========================================================
STASHED=false
PROTECTED_STASH_REF=""
PROTECTED_STASH_COMMIT=""
PROTECTED_DIRTY_PATHS=()

collect_protected_changes() {
    PROTECTED_DIRTY_PATHS=()
    for p in "${PROTECTED_PATHS[@]}"; do
        if git diff --name-only -- "$p" 2>/dev/null | grep -q .; then
            PROTECTED_DIRTY_PATHS+=("$p")
            continue
        fi
        if git diff --cached --name-only -- "$p" 2>/dev/null | grep -q .; then
            PROTECTED_DIRTY_PATHS+=("$p")
            continue
        fi
        if git ls-files --others --exclude-standard -- "$p" 2>/dev/null | grep -q .; then
            PROTECTED_DIRTY_PATHS+=("$p")
            continue
        fi
    done

    [[ ${#PROTECTED_DIRTY_PATHS[@]} -gt 0 ]]
}

restore_protected_stash() {
    $STASHED || return 0

    local stash_ref="${PROTECTED_STASH_REF:-stash@{0}}"
    local current_ref
    current_ref=$(git rev-parse -q --verify "$stash_ref" 2>/dev/null || true)

    if [[ -n "${PROTECTED_STASH_COMMIT:-}" ]] && [[ "$current_ref" != "$PROTECTED_STASH_COMMIT" ]]; then
        warn "Protected-file stash moved - keeping it for manual recovery."
        return 0
    fi

    if git stash apply --quiet "$stash_ref" 2>/dev/null; then
        git stash drop "$stash_ref" >/dev/null 2>&1 || true
        STASHED=false
    else
        warn "Could not automatically restore protected local files - kept the stash for manual recovery."
        # A failed apply can leave git conflict markers INSIDE the protected files. Reset
        # and restore them to the committed version so no corrupted markers remain; the
        # stash above still holds the user's local changes for manual recovery.
        git reset -q -- "${PROTECTED_DIRTY_PATHS[@]}" 2>/dev/null || true
        git checkout -- "${PROTECTED_DIRTY_PATHS[@]}" 2>/dev/null || true
    fi
}

if collect_protected_changes; then
    _stash_before=$(git rev-parse -q --verify refs/stash 2>/dev/null || true)
    _stash_status=0
    git stash push --include-untracked -m "agentic-os-update-$(date +%s)" -- "${PROTECTED_DIRTY_PATHS[@]}" >/dev/null 2>&1 || _stash_status=$?
    _stash_after=$(git rev-parse -q --verify refs/stash 2>/dev/null || true)

    if [[ -n "$_stash_after" ]] && [[ "$_stash_after" != "$_stash_before" ]]; then
        STASHED=true
        PROTECTED_STASH_REF="stash@{0}"
        PROTECTED_STASH_COMMIT="$_stash_after"
    elif [[ $_stash_status -ne 0 ]]; then
        warn "Could not temporarily stash protected files. Update will continue carefully, but please inspect your local files after it finishes."
    fi
fi

git fetch "$UPDATE_REMOTE" "$UPSTREAM_BRANCH" --quiet 2>/dev/null || true

# If upstream starts tracking a file under a user-owned path, Git may otherwise
# overwrite an ignored local file at the same path during a hard reset. Move only
# exact user-owned collision paths aside, then restore them after the pull/reset.
USER_OWNED_COLLISION_BACKUP_DIR="$UPDATE_BACKUP_DIR/user-owned-local"
USER_OWNED_COLLISION_PATHS=()

prepare_user_owned_collision_backups() {
    local remote_ref="$UPDATE_REMOTE/$UPSTREAM_BRANCH"
    local changed_files file local_path backup_path

    git rev-parse "$remote_ref" >/dev/null 2>&1 || return 0
    changed_files=$(git diff --name-only "HEAD..$remote_ref" 2>/dev/null || true)
    [[ -n "$changed_files" ]] || return 0

    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        path_matches_any "$file" "${USER_OWNED_PATHS[@]}" || continue

        # Tracked user-owned files are restored from OLD_HEAD after the update.
        if git ls-files --error-unmatch -- "$file" >/dev/null 2>&1; then
            continue
        fi

        local_path="$REPO_ROOT/$file"
        [[ -e "$local_path" || -L "$local_path" ]] || continue

        backup_path="$USER_OWNED_COLLISION_BACKUP_DIR/$file"
        mkdir -p "$(dirname "$backup_path")"
        rm -rf "$backup_path"
        cp -pR "$local_path" "$backup_path"
        rm -rf "$local_path"
        USER_OWNED_COLLISION_PATHS+=("$file")
    done <<< "$changed_files"
}

restore_user_owned_collision_backups() {
    local file local_path backup_path
    [[ ${#USER_OWNED_COLLISION_PATHS[@]} -gt 0 ]] || return 0

    for file in "${USER_OWNED_COLLISION_PATHS[@]}"; do
        [[ -z "$file" ]] && continue
        backup_path="$USER_OWNED_COLLISION_BACKUP_DIR/$file"
        [[ -e "$backup_path" || -L "$backup_path" ]] || continue

        local_path="$REPO_ROOT/$file"
        mkdir -p "$(dirname "$local_path")"
        rm -rf "$local_path"
        cp -pR "$backup_path" "$local_path"
        USER_OWNED_RESTORED_FILES+=("$file")
    done
}

prepare_user_owned_collision_backups

# =========================================================
# Step 5: Scan local skill modifications before pull
# =========================================================
SKILL_BACKUP_DIR="$UPDATE_BACKUP_DIR/skills"
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

        # Check for local modifications - always backup and reset, regardless of review state
        modified_files=$(git diff --name-only -- ".claude/skills/$skill_name/" 2>/dev/null || true)
        if [[ -n "$modified_files" ]]; then
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
OTHER_BACKUP_DIR="$UPDATE_BACKUP_DIR/other"
OTHER_MODIFIED_FILES=()

ALL_MODIFIED=$(git diff --name-only 2>/dev/null || true)
ALL_STAGED=$(git diff --cached --name-only 2>/dev/null || true)
ALL_DIRTY=$(printf '%s\n%s' "$ALL_MODIFIED" "$ALL_STAGED" | sort -u | grep -v '^$' || true)

if [[ -n "$ALL_DIRTY" ]]; then
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue

        # Skip protected paths
        is_protected=false
        for p in "${PROTECTED_PATHS[@]}"; do
            case "$file" in
                $p|$p*) is_protected=true; break ;;
            esac
        done
        $is_protected && continue

        # Skip skill files (handled separately above)
        case "$file" in
            .claude/skills/*) continue ;;
        esac

        # Skip files already reviewed with unchanged content
        if was_already_reviewed "$file"; then
            continue
        fi

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

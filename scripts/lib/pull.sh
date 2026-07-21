#!/usr/bin/env bash
# Step 6: Pull upstream changes, handle failures, and display what changed.

# =========================================================
# Step 6: Pull upstream changes
# =========================================================
info "Checking for updates..."
echo ""

MERGE_FAILED=false
PULL_OUTPUT=$(git pull "$UPDATE_REMOTE" "$UPSTREAM_BRANCH" 2>&1) || MERGE_FAILED=true
USER_OWNED_RESTORED_FILES=()

restore_user_owned_paths_after_pull() {
    local changed file backup_file
    changed=$(git diff --name-only "${OLD_HEAD}..${NEW_HEAD}" 2>/dev/null || true)
    [[ -n "$changed" ]] || return 0

    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        path_matches_any "$file" "${USER_OWNED_PATHS[@]}" || continue

        backup_file="$UPDATE_BACKUP_DIR/upstream-user-owned/$file"
        if [[ -f "$REPO_ROOT/$file" ]]; then
            mkdir -p "$(dirname "$backup_file")"
            cp "$REPO_ROOT/$file" "$backup_file" 2>/dev/null || true
        fi

        if git cat-file -e "${OLD_HEAD}:${file}" 2>/dev/null; then
            git checkout "$OLD_HEAD" -- "$file" 2>/dev/null || true
        else
            rm -f "$REPO_ROOT/$file" 2>/dev/null || true
        fi
        USER_OWNED_RESTORED_FILES+=("$file")
    done <<< "$changed"
}

# --- Nuclear fallback: if merge fails for ANY reason, force-reset ---
if $MERGE_FAILED; then
    # Check for auth failures first — those can't be fixed by force-reset
    if echo "$PULL_OUTPUT" | grep -qi "authentication\|403\|could not read\|repository not found\|invalid credentials"; then
        git merge --abort 2>/dev/null || true
        if $STASHED; then
            restore_protected_stash
        fi
        restore_user_owned_collision_backups
        for skill_name in "${MODIFIED_SKILLS[@]:-}"; do
            [[ -z "$skill_name" ]] && continue
            cp -r "$SKILL_BACKUP_DIR/$skill_name"/* "$REPO_ROOT/.claude/skills/$skill_name/" 2>/dev/null || true
        done
        for file in "${OTHER_MODIFIED_FILES[@]:-}"; do
            [[ -z "$file" ]] && continue
            cp "$OTHER_BACKUP_DIR/$file" "$REPO_ROOT/$file" 2>/dev/null || true
        done

        print_upstream_help "$UPDATE_REMOTE"
        exit 1
    fi

    warn "Standard pull failed — resetting system files to $UPDATE_REMOTE/$UPSTREAM_BRANCH after backups."
    git merge --abort 2>/dev/null || true
    # Safety net: a hard reset to the remote would destroy any un-pushed local
    # commits (e.g. autosave commits on local main). Before resetting, if local
    # HEAD is ahead of the remote, archive the tip to a recovery branch so no
    # committed work is ever lost. Recoverable with: git checkout <branch>.
    AHEAD_LOCAL=$(git rev-list --count "$UPDATE_REMOTE/$UPSTREAM_BRANCH..HEAD" 2>/dev/null || echo 0)
    if [[ "${AHEAD_LOCAL:-0}" -gt 0 ]]; then
        RECOVERY_BRANCH="${UPDATE_RECOVERY_BRANCH:-autosave-recovery/$(date +%Y%m%d-%H%M%S)}"
        if git show-ref --verify --quiet "refs/heads/$RECOVERY_BRANCH"; then
            warn "Preserved ${AHEAD_LOCAL} un-pushed local commit(s) on branch ${RECOVERY_BRANCH} before reset."
        elif git branch "$RECOVERY_BRANCH" HEAD >/dev/null 2>&1; then
            warn "Preserved ${AHEAD_LOCAL} un-pushed local commit(s) on branch ${RECOVERY_BRANCH} before reset."
        fi
    fi
    git reset --hard "$UPDATE_REMOTE/$UPSTREAM_BRANCH" >/dev/null 2>&1 || {
        for skill_name in "${MODIFIED_SKILLS[@]:-}"; do
            [[ -z "$skill_name" ]] && continue
            cp -r "$SKILL_BACKUP_DIR/$skill_name"/* "$REPO_ROOT/.claude/skills/$skill_name/" 2>/dev/null || true
        done
        for file in "${OTHER_MODIFIED_FILES[@]:-}"; do
            [[ -z "$file" ]] && continue
            cp "$OTHER_BACKUP_DIR/$file" "$REPO_ROOT/$file" 2>/dev/null || true
        done
        restore_user_owned_collision_backups
        warn "Reset failed — restored local backups. Please inspect git status and try again."
        exit 1
    }
    PULL_OUTPUT="${PULL_OUTPUT}"$'\n'"Reset to $UPDATE_REMOTE/$UPSTREAM_BRANCH after pull conflict."
fi

# =========================================================
# Determine if anything changed
# =========================================================
HAS_UPSTREAM_CHANGES=true
if echo "$PULL_OUTPUT" | grep -q "Already up to date"; then
    HAS_UPSTREAM_CHANGES=false
    if $STASHED; then
        restore_protected_stash
    fi
fi

NEW_HEAD=$(git rev-parse HEAD)
NEW_VERSION=$(read_agentic_os_version)
COMMIT_COUNT=0
if $HAS_UPSTREAM_CHANGES; then
    COMMIT_COUNT=$(git log --oneline "${OLD_HEAD}..${NEW_HEAD}" 2>/dev/null | wc -l | tr -d ' ')
    restore_user_owned_paths_after_pull
    restore_user_owned_collision_backups
fi

# =========================================================
# STEP 1 OF 4: Updates from the Main Repo
# =========================================================
echo ""
printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
printf "${CYAN}${BOLD}  Step 1: Updates from the Main Repo${NC}\n"
printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
echo ""

if ! $HAS_UPSTREAM_CHANGES; then
    ok "No new updates — you're on the latest version."
    info "Last updated: ${BOLD}${LAST_UPDATED}${NC}"
    echo ""
    info "Scripts:              ${GREEN}no changes${NC}"
    info "System files:         ${GREEN}no changes${NC}  ${DIM}(AGENTS.md, CLAUDE.md, README.md, etc.)${NC}"
    info "Skill catalog:        ${GREEN}no changes${NC}"
    info "Skills:               ${GREEN}no changes${NC}"
    echo ""
else
    ok "Pulled ${COMMIT_COUNT} new commit(s) from main."
    echo ""

    CHANGED_FILES=$(git diff --name-only "${OLD_HEAD}..${NEW_HEAD}" 2>/dev/null || true)

    CHANGED_SCRIPTS=""
    CHANGED_SYSTEM=""
    CHANGED_CATALOG=""
    CHANGED_SKILL_FILES=""
    CHANGED_OTHER=""
    SCRIPT_COUNT=0; SYSTEM_COUNT=0; CATALOG_COUNT=0; SKILL_COUNT=0; OTHER_COUNT=0

    if [[ -n "$CHANGED_FILES" ]]; then
        while IFS= read -r file; do
            case "$file" in
                scripts/*)
                    CHANGED_SCRIPTS="${CHANGED_SCRIPTS}${file}\n"
                    SCRIPT_COUNT=$((SCRIPT_COUNT + 1))
                    ;;
                AGENTS.md|CLAUDE.md|PRD.md|README.md|.gitignore|.gitattributes)
                    CHANGED_SYSTEM="${CHANGED_SYSTEM}${file}\n"
                    SYSTEM_COUNT=$((SYSTEM_COUNT + 1))
                    ;;
                .claude/skills/_catalog/*)
                    CHANGED_CATALOG="${CHANGED_CATALOG}${file}\n"
                    CATALOG_COUNT=$((CATALOG_COUNT + 1))
                    ;;
                .claude/skills/*)
                    CHANGED_SKILL_FILES="${CHANGED_SKILL_FILES}${file}\n"
                    SKILL_COUNT=$((SKILL_COUNT + 1))
                    ;;
                context/*|brand_context/*|projects/*|.env*)
                    ;; # Protected — skip
                *)
                    CHANGED_OTHER="${CHANGED_OTHER}${file}\n"
                    OTHER_COUNT=$((OTHER_COUNT + 1))
                    ;;
            esac
        done <<< "$CHANGED_FILES"
    fi

    if [[ $SCRIPT_COUNT -gt 0 ]]; then
        printf "  ${BOLD}Scripts${NC} ${DIM}(%d updated)${NC}\n" "$SCRIPT_COUNT"
        printf "$CHANGED_SCRIPTS" | while IFS= read -r f; do [[ -n "$f" ]] && bullet "$f"; done
    else
        info "Scripts:              ${GREEN}no changes${NC}"
    fi

    if [[ $SYSTEM_COUNT -gt 0 ]]; then
        printf "  ${BOLD}System files${NC} ${DIM}(%d updated)${NC}\n" "$SYSTEM_COUNT"
        printf "$CHANGED_SYSTEM" | while IFS= read -r f; do [[ -n "$f" ]] && bullet "$f"; done
    else
        info "System files:         ${GREEN}no changes${NC}  ${DIM}(AGENTS.md, CLAUDE.md, README.md, etc.)${NC}"
    fi

    if [[ $CATALOG_COUNT -gt 0 ]]; then
        printf "  ${BOLD}Skill catalog${NC} ${DIM}(%d updated)${NC}\n" "$CATALOG_COUNT"
        printf "$CHANGED_CATALOG" | while IFS= read -r f; do [[ -n "$f" ]] && bullet "$f"; done
    else
        info "Skill catalog:        ${GREEN}no changes${NC}"
    fi

    if [[ $SKILL_COUNT -gt 0 ]]; then
        # Collect unique skill names from changed files
        UPDATED_SKILL_NAMES=$(printf "%b" "$CHANGED_SKILL_FILES" | sed -n 's|^\.claude/skills/\([^/][^/]*\)/.*|\1|p' | sort -u || true)
        UPDATED_SKILL_COUNT=$(echo "$UPDATED_SKILL_NAMES" | grep -c . || true)
        printf "  ${BOLD}Skills${NC} ${DIM}(%d updated)${NC}\n" "$UPDATED_SKILL_COUNT"
        while IFS= read -r skill; do
            [[ -z "$skill" ]] && continue
            changelog_summary=$("${PYTHON_CMD[@]}" - "$CATALOG" "$skill" << 'PYEOF'
import json, sys
catalog_path, skill_name = sys.argv[1], sys.argv[2]
try:
    data = json.load(open(catalog_path, encoding="utf-8"))
    entry = data.get("skills", data).get(skill_name, {})
    log = entry.get("changelog", [])
    summary = log[0].get("summary", "") if log else ""
    print(summary)
except Exception:
    pass
PYEOF
            )
            if [[ -n "$changelog_summary" ]]; then
                printf "    ${DIM}•${NC} ${BOLD}%s${NC} — %s\n" "$skill" "$changelog_summary"
            else
                printf "    ${DIM}•${NC} ${BOLD}%s${NC}\n" "$skill"
            fi
        done <<< "$UPDATED_SKILL_NAMES"
    else
        info "Skills:               ${GREEN}no changes${NC}"
    fi

    if [[ $OTHER_COUNT -gt 0 ]]; then
        printf "  ${BOLD}Other${NC} ${DIM}(%d updated)${NC}\n" "$OTHER_COUNT"
        printf "$CHANGED_OTHER" | while IFS= read -r f; do [[ -n "$f" ]] && bullet "$f"; done
    fi

    echo ""

fi

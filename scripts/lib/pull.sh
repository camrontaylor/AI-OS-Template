#!/usr/bin/env bash
# Step 6: Pull upstream changes, handle failures, and display what changed.

# =========================================================
# Step 6: Pull upstream changes
# =========================================================
info "Checking for updates..."
echo ""

MERGE_FAILED=false
PULL_OUTPUT=$(git pull "$UPDATE_REMOTE" "$UPSTREAM_BRANCH" 2>&1) || MERGE_FAILED=true

# --- Fallback: never move a branch away from local commits silently ---
if $MERGE_FAILED; then
    # Check for auth failures first — those can't be fixed by force-reset
    if is_update_auth_error "$PULL_OUTPUT"; then
        git merge --abort 2>/dev/null || true
        restore_update_backups

        emit_update_token_required "$UPDATE_REMOTE" "GitHub rejected the token during the update pull."
        exit "$UPDATE_TOKEN_REQUIRED_EXIT"
    fi

    LOCAL_ONLY_COMMITS=$(git rev-list --count "$UPDATE_REMOTE/$UPSTREAM_BRANCH..$OLD_HEAD" 2>/dev/null || echo 0)
    git merge --abort 2>/dev/null || true

    if [[ "$LOCAL_ONLY_COMMITS" -gt 0 ]]; then
        current_branch="$(git branch --show-current 2>/dev/null || echo "")"
        safe_branch_name="$(printf "%s" "${current_branch:-detached}" | tr -c 'A-Za-z0-9._/-' '-')"
        rescue_branch="AI-OS-rescue/${safe_branch_name}-${UPDATE_TIMESTAMP}"
        if ! git branch "$rescue_branch" "$OLD_HEAD" >/dev/null 2>&1; then
            rescue_branch="AI-OS-rescue/${safe_branch_name}-${UPDATE_TIMESTAMP}-$$"
            git branch "$rescue_branch" "$OLD_HEAD" >/dev/null 2>&1 || rescue_branch=""
        fi

        warn "Standard pull failed, and this branch has local commit(s). Keeping your branch history instead of resetting to $UPDATE_REMOTE/$UPSTREAM_BRANCH."
        git reset --hard "$OLD_HEAD" >/dev/null 2>&1 || true

        SAFE_MERGE_FAILED=false
        SAFE_MERGE_OUTPUT=$(git merge --no-edit "$UPDATE_REMOTE/$UPSTREAM_BRANCH" 2>&1) || SAFE_MERGE_FAILED=true
        if $SAFE_MERGE_FAILED; then
            git merge --abort 2>/dev/null || true
            git reset --hard "$OLD_HEAD" >/dev/null 2>&1 || true
            restore_update_backups

            warn "Could not merge the upstream update without conflicts, so your branch was kept at the pre-update commit."
            if [[ -n "$rescue_branch" ]]; then
                info "Recovery branch saved: ${BOLD}${rescue_branch}${NC}"
            fi
            info "To finish manually, resolve the conflict with:"
            printf "  ${BOLD}git merge %s/%s${NC}\n" "$UPDATE_REMOTE" "$UPSTREAM_BRANCH"
            info "Your local commits were not reset to upstream."
            exit 1
        fi

        PULL_OUTPUT="${PULL_OUTPUT}"$'\n'"Preserved local commits and merged $UPDATE_REMOTE/$UPSTREAM_BRANCH after pull failure."$'\n'"$SAFE_MERGE_OUTPUT"
    else
        warn "Standard pull failed — resetting tracked files to $UPDATE_REMOTE/$UPSTREAM_BRANCH after backups."
        git reset --hard "$UPDATE_REMOTE/$UPSTREAM_BRANCH" >/dev/null 2>&1 || {
            restore_update_backups
            warn "Reset failed — restored local backups. Please inspect git status and try again."
            exit 1
        }
        PULL_OUTPUT="${PULL_OUTPUT}"$'\n'"Reset to $UPDATE_REMOTE/$UPSTREAM_BRANCH after pull conflict."
    fi
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
NEW_VERSION=$(read_ai_os_version)
COMMIT_COUNT=0
if $HAS_UPSTREAM_CHANGES; then
    COMMIT_COUNT=$(git log --oneline "${OLD_HEAD}..${NEW_HEAD}" 2>/dev/null | wc -l | tr -d ' ')
fi

# =========================================================
# STEP 1 OF 4: Updates from the configured update source
# =========================================================
echo ""
printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
printf "${CYAN}${BOLD}  Step 1: Updates from %s/%s${NC}\n" "$UPDATE_REMOTE" "$UPSTREAM_BRANCH"
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
    ok "Pulled ${COMMIT_COUNT} new commit(s) from $UPDATE_REMOTE/$UPSTREAM_BRANCH."
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
            if is_protected_path "$file"; then
                continue
            fi

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

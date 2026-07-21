#!/usr/bin/env bash
# Dry-run update preview. Fetches remote refs and reports what would change
# without pulling, resetting, stashing, or writing working-tree files.

print_update_preview() {
    info "Fetching the latest update information..."
    echo ""

    if ! git fetch "$UPDATE_REMOTE" "$UPSTREAM_BRANCH" --quiet 2>/dev/null; then
        print_upstream_help "$UPDATE_REMOTE"
        exit 1
    fi

    local remote_ref="$UPDATE_REMOTE/$UPSTREAM_BRANCH"
    local remote_head
    remote_head=$(git rev-parse "$remote_ref" 2>/dev/null || true)
    if [[ -z "$remote_head" ]]; then
        warn "Could not find $remote_ref."
        exit 1
    fi

    local behind ahead changed_files commit_count new_version
    behind=$(git rev-list --count "HEAD..$remote_ref" 2>/dev/null || echo 0)
    ahead=$(git rev-list --count "$remote_ref..HEAD" 2>/dev/null || echo 0)
    changed_files=$(git diff --name-only "HEAD..$remote_ref" 2>/dev/null || true)
    commit_count=$(printf "%s\n" "$changed_files" | grep -c . || true)
    new_version=$(git show "$remote_ref:VERSION" 2>/dev/null | head -n 1 | tr -d '\r' || echo "unknown")

    echo ""
    printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
    printf "${CYAN}${BOLD}  AI-OS Update Preview${NC}\n"
    printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
    echo ""
    info "Current version: ${BOLD}$(format_agentic_os_version "$OLD_VERSION")${NC}"
    info "Available version: ${BOLD}$(format_agentic_os_version "$new_version")${NC}"
    info "Update source: ${BOLD}${UPDATE_REMOTE}/${UPSTREAM_BRANCH}${NC}"
    echo ""

    if [[ "$behind" -eq 0 ]]; then
        ok "No upstream updates are waiting."
        if [[ "$ahead" -gt 0 ]]; then
            warn "This checkout also has ${ahead} local commit(s) not in the update source."
        fi
    else
        ok "${behind} upstream commit(s) would be applied."
        echo ""
        git log --oneline "HEAD..$remote_ref" 2>/dev/null | while IFS= read -r line; do
            [[ -n "$line" ]] && printf "    ${DIM}•${NC} %s\n" "$line"
        done
    fi

    echo ""
    printf "${BOLD}Would update:${NC}\n"
    if [[ -z "$changed_files" ]]; then
        printf "    ${GREEN}No working files${NC}\n"
    else
        printf "%s\n" "$changed_files" | while IFS= read -r file; do
            [[ -z "$file" ]] && continue
            if path_matches_any "$file" "${USER_OWNED_PATHS[@]}"; then
                printf "    ${YELLOW}!${NC} %s ${DIM}(user-owned path changed upstream; updater protects your local copy)${NC}\n" "$file"
            elif path_matches_any "$file" "${AI_OS_OWNED_PATHS[@]}"; then
                printf "    ${GREEN}+${NC} %s\n" "$file"
            else
                printf "    ${CYAN}+${NC} %s ${DIM}(unclassified system file)${NC}\n" "$file"
            fi
        done
    fi

    local local_changes
    local_changes=$(git diff --name-only 2>/dev/null || true)
    if [[ -n "$local_changes" ]]; then
        echo ""
        printf "${BOLD}Your local edits:${NC}\n"
        printf "%s\n" "$local_changes" | while IFS= read -r file; do
            [[ -z "$file" ]] && continue
            if path_matches_any "$file" "${USER_OWNED_PATHS[@]}"; then
                printf "    ${GREEN}✓${NC} %s ${DIM}(user-owned; preserved)${NC}\n" "$file"
            elif path_matches_any "$file" "${AI_OS_OWNED_PATHS[@]}"; then
                printf "    ${YELLOW}~${NC} %s ${DIM}(AI-OS file; update will back it up and review/merge when needed)${NC}\n" "$file"
            else
                printf "    ${YELLOW}~${NC} %s ${DIM}(unclassified; update will back it up if needed)${NC}\n" "$file"
            fi
        done
    fi

    echo ""
    ok "Protected user data:"
    printf "    clients/ ${GREEN}✓${NC}   brand_context/ ${GREEN}✓${NC}   context/ ${GREEN}✓${NC}   projects/ ${GREEN}✓${NC}   cron/jobs/ ${GREEN}✓${NC}   .env ${GREEN}✓${NC}\n"
    echo ""
    info "To apply this update, run ${BOLD}bash scripts/update.sh${NC}"
    info "To undo a finished update, run ${BOLD}bash scripts/update.sh --rollback${NC}"
    echo ""
}

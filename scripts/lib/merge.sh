#!/usr/bin/env bash
# Step 2 of 4: Review local skill modifications and other tracked file changes.

# =========================================================
# STEP 2 OF 4: Your Local Skill Changes
# =========================================================
echo ""
printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
printf "${CYAN}${BOLD}  Step 2: Your Local Changes${NC}\n"
printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
echo ""

SKILL_REVIEW_MSG=""

# --- User-created skills (always shown first and prominently) ---
if [[ ${#USER_CREATED_SKILLS[@]} -gt 0 ]]; then
    printf "  ${GREEN}${BOLD}★ ${#USER_CREATED_SKILLS[@]} custom skill(s) detected${NC} ${DIM}(yours — never touched by updates):${NC}\n"
    for uc_skill in "${USER_CREATED_SKILLS[@]}"; do
        printf "    ${GREEN}✓${NC} ${BOLD}%s${NC}\n" "$uc_skill"
    done
    echo ""
fi

# --- Modified upstream skills ---
if [[ ${#MODIFIED_SKILLS[@]} -eq 0 ]] && [[ ${#USER_CREATED_SKILLS[@]} -eq 0 ]]; then
    ok "No local skill modifications detected."
    info "All your installed skills match the upstream versions."
    echo ""
elif [[ ${#MODIFIED_SKILLS[@]} -eq 0 ]]; then
    ok "No modifications to upstream skills."
    echo ""
fi

if [[ ${#MODIFIED_SKILLS[@]} -gt 0 ]]; then
    info "You've modified ${#MODIFIED_SKILLS[@]} skill(s) locally:"
    for i in "${!MODIFIED_SKILLS[@]}"; do
        IFS='|' read -ra files <<< "${MODIFIED_SKILL_FILES[$i]}"
        printf "    ${YELLOW}~${NC} ${BOLD}%s${NC} ${DIM}(%s)${NC}\n" "${MODIFIED_SKILLS[$i]}" "${files[*]}"
    done
    echo ""

    if $HAS_UPSTREAM_CHANGES; then
        info "Merging upstream changes with your local edits..."
        echo ""
    else
        ok "No upstream changes to these skills — your local versions are kept as-is."
        echo ""
    fi

    for skill_name in "${MODIFIED_SKILLS[@]}"; do
        skill_dir="$REPO_ROOT/.claude/skills/$skill_name"
        backup_skill_dir="$SKILL_BACKUP_DIR/$skill_name"

        # Skill removed upstream
        if [[ ! -d "$skill_dir" ]]; then
            warn "$skill_name was removed upstream, but you had local changes."
            mkdir -p "$skill_dir"
            cp -r "$backup_skill_dir"/* "$skill_dir/" 2>/dev/null || true
            ok "Kept your version of $skill_name"
            SKILL_REVIEW_MSG="${SKILL_REVIEW_MSG}\n    ${YELLOW}~${NC} $skill_name: kept (removed upstream)"
            continue
        fi

        echo "  ─────────────────────────────────────────"
        printf "  ${BOLD}%s${NC}\n" "$skill_name"
        echo "  ─────────────────────────────────────────"

        changed_files=$(diff -rq "$backup_skill_dir" "$skill_dir" 2>/dev/null | grep "^Files " | sed 's/^Files //;s/ and / → /;s/ differ$//' || true)
        new_upstream=$(diff -rq "$backup_skill_dir" "$skill_dir" 2>/dev/null | grep "^Only in $skill_dir" | sed "s|^Only in $skill_dir[/]*: ||" || true)
        removed_upstream=$(diff -rq "$backup_skill_dir" "$skill_dir" 2>/dev/null | grep "^Only in $backup_skill_dir" | sed "s|^Only in $backup_skill_dir[/]*: ||" || true)

        if [[ -z "$changed_files" ]] && [[ -z "$new_upstream" ]] && [[ -z "$removed_upstream" ]]; then
            echo ""
            info "No upstream changes to this skill — keeping your version."
            cp -r "$backup_skill_dir"/* "$skill_dir/" 2>/dev/null || true
            for rf in $(git diff --name-only -- ".claude/skills/$skill_name/" 2>/dev/null || true); do
                mark_reviewed "$rf"
            done
            SKILL_REVIEW_MSG="${SKILL_REVIEW_MSG}\n    ${GREEN}✓${NC} $skill_name: kept yours (no upstream changes)"
            echo ""
            continue
        fi

        file_decisions=""
        accepted_count=0
        kept_count=0

        # --- Per-file review with 3-way analysis ---
        if [[ -n "$changed_files" ]]; then
            while IFS= read -r pair; do
                backup_file=$(echo "$pair" | sed 's/ → .*//')
                upstream_file=$(echo "$pair" | sed 's/.* → //')
                rel_name=$(echo "$upstream_file" | sed "s|$skill_dir/||;s|$skill_dir||")
                [[ -z "$rel_name" ]] && rel_name=$(basename "$upstream_file")

                # No upstream pull — if SKILL.local.md exists, keep the clean base;
                # otherwise copy user version back from backup as usual.
                if ! $HAS_UPSTREAM_CHANGES; then
                    if [[ "$rel_name" == "SKILL.md" ]] && [[ -f "$skill_dir/SKILL.local.md" ]]; then
                        ok "Base kept clean: $rel_name ${DIM}(customizations in SKILL.local.md)${NC}"
                        file_decisions="${file_decisions}\n    ${GREEN}✓${NC} $rel_name (base kept clean — local overrides in SKILL.local.md)"
                        accepted_count=$((accepted_count + 1))
                    else
                        cp "$backup_file" "$upstream_file" 2>/dev/null || true
                        ok "Kept yours: $rel_name ${DIM}(no upstream changes)${NC}"
                        file_decisions="${file_decisions}\n    ${YELLOW}○${NC} $rel_name (kept yours — no upstream changes)"
                        kept_count=$((kept_count + 1))
                    fi
                    continue
                fi

                rel_git_path=".claude/skills/$skill_name/$rel_name"
                case "$(uname -s)" in
                    MINGW*|MSYS*|CYGWIN*)
                        ANCESTOR_TMP="$BACKUP_DIR/ancestor-${skill_name}-$(echo "$rel_name" | tr '/' '-')-${UPDATE_TIMESTAMP}.md"
                        ;;
                    *)
                        ANCESTOR_TMP=$(mktemp)
                        ;;
                esac
                git show "${OLD_HEAD}:${rel_git_path}" > "$ANCESTOR_TMP" 2>/dev/null || echo "" > "$ANCESTOR_TMP"

                upstream_diff=$(diff -u "$ANCESTOR_TMP" "$upstream_file" 2>/dev/null | tail -n +3 || true)
                your_diff=$(diff -u "$ANCESTOR_TMP" "$backup_file" 2>/dev/null | tail -n +3 || true)

                has_upstream=false; [[ -n "$upstream_diff" ]] && has_upstream=true
                has_yours=false; [[ -n "$your_diff" ]] && has_yours=true

                # Handle bulk decisions from a previous iteration
                if [[ "${ACCEPT_ALL_REMAINING:-false}" == "true" ]]; then
                    ok "Accepted upstream: $rel_name"
                    file_decisions="${file_decisions}\n    ${GREEN}✓${NC} $rel_name (accepted upstream)"
                    accepted_count=$((accepted_count + 1))
                    mark_reviewed "$rel_git_path"
                    rm -f "$ANCESTOR_TMP"
                    continue
                fi
                if [[ "${KEEP_ALL_REMAINING:-false}" == "true" ]]; then
                    cp "$backup_file" "$upstream_file" 2>/dev/null || true
                    ok "Kept yours: $rel_name"
                    file_decisions="${file_decisions}\n    ${YELLOW}○${NC} $rel_name (kept yours)"
                    kept_count=$((kept_count + 1))
                    mark_reviewed "$rel_git_path"
                    rm -f "$ANCESTOR_TMP"
                    continue
                fi

                # If only you changed (upstream didn't touch it), auto-keep yours
                if ! $has_upstream && $has_yours; then
                    cp "$backup_file" "$upstream_file" 2>/dev/null || true
                    ok "Kept yours: $rel_name ${DIM}(upstream didn't change this file)${NC}"
                    file_decisions="${file_decisions}\n    ${YELLOW}○${NC} $rel_name (kept yours — upstream unchanged)"
                    kept_count=$((kept_count + 1))
                    mark_reviewed "$rel_git_path"
                    rm -f "$ANCESTOR_TMP"
                    continue
                fi

                # If SKILL.local.md exists, user's customizations are safe there —
                # accept upstream SKILL.md as the clean base without merging.
                if [[ "$rel_name" == "SKILL.md" ]] && [[ -f "$skill_dir/SKILL.local.md" ]]; then
                    ok "Accepted upstream: $rel_name ${DIM}(customizations preserved in SKILL.local.md)${NC}"
                    file_decisions="${file_decisions}\n    ${GREEN}✓${NC} $rel_name (accepted upstream — local overrides in SKILL.local.md)"
                    accepted_count=$((accepted_count + 1))
                    mark_reviewed "$rel_git_path"
                    rm -f "$ANCESTOR_TMP"
                    continue
                fi

                # Smart Merge: both sides changed a SKILL.md — delegate to Claude
                if [[ "$rel_name" == "SKILL.md" ]] && $has_upstream && $has_yours; then
                    info "Smart Merge: ${skill_name}/SKILL.md"
                    if smart_merge_file "$backup_file" "$upstream_file" "$ANCESTOR_TMP" "SKILL.md"; then
                        ok "Smart Merge complete: $rel_name"
                        file_decisions="${file_decisions}\n    ${GREEN}⊕${NC} $rel_name (smart merged)"
                        accepted_count=$((accepted_count + 1))
                    else
                        cp "$backup_file" "$upstream_file" 2>/dev/null || true
                        warn "Smart Merge failed — keeping your version of $rel_name"
                        file_decisions="${file_decisions}\n    ${YELLOW}○${NC} $rel_name (kept yours — smart merge failed)"
                        kept_count=$((kept_count + 1))
                    fi
                    mark_reviewed "$rel_git_path"
                    rm -f "$ANCESTOR_TMP"
                    continue
                fi

                # Non-SKILL.md files: auto-accept upstream
                ok "Accepted upstream: $rel_name"
                file_decisions="${file_decisions}\n    ${GREEN}✓${NC} $rel_name (accepted upstream)"
                accepted_count=$((accepted_count + 1))
                mark_reviewed "$rel_git_path"
                rm -f "$ANCESTOR_TMP"
            done <<< "$changed_files"
            ACCEPT_ALL_REMAINING=false
            KEEP_ALL_REMAINING=false
        fi

        # New files added upstream
        if [[ -n "$new_upstream" ]]; then
            while IFS= read -r new_file; do
                [[ -z "$new_file" ]] && continue
                printf "\n  ${GREEN}+${NC} %s ${DIM}(new from upstream)${NC}\n" "$new_file"
                file_decisions="${file_decisions}\n    ${GREEN}+${NC} $new_file (new from upstream)"
                accepted_count=$((accepted_count + 1))
            done <<< "$new_upstream"
        fi

        # Files removed upstream
        if [[ -n "$removed_upstream" ]]; then
            while IFS= read -r rm_file; do
                [[ -z "$rm_file" ]] && continue
                printf "\n  ${YELLOW}−${NC} %s ${DIM}(removed upstream — kept your version)${NC}\n" "$rm_file"
                cp "$backup_skill_dir/$rm_file" "$skill_dir/$rm_file" 2>/dev/null || true
                file_decisions="${file_decisions}\n    ${YELLOW}○${NC} $rm_file (kept yours, removed upstream)"
                kept_count=$((kept_count + 1))
            done <<< "$removed_upstream"
        fi

        echo ""
        SKILL_REVIEW_MSG="${SKILL_REVIEW_MSG}\n    ${BOLD}$skill_name${NC}: $accepted_count accepted, $kept_count kept"
        printf "$file_decisions\n"
    done
    echo ""
fi

# =========================================================
# Review other modified files (non-skill, non-protected)
# =========================================================
OTHER_REVIEW_MSG=""

if [[ ${#OTHER_MODIFIED_FILES[@]} -gt 0 ]] && $HAS_UPSTREAM_CHANGES; then
    OTHER_CONFLICT_FILES=()
    OTHER_NOCONFLICT_FILES=()
    for file in "${OTHER_MODIFIED_FILES[@]}"; do
        if echo "$CHANGED_FILES" | grep -qx "$file" 2>/dev/null; then
            OTHER_CONFLICT_FILES+=("$file")
        else
            OTHER_NOCONFLICT_FILES+=("$file")
        fi
    done

    for file in "${OTHER_NOCONFLICT_FILES[@]}"; do
        if [[ "$(basename "$file")" == "CLAUDE.md" ]]; then
            _local_md="$REPO_ROOT/$(dirname "$file")/CLAUDE.local.md"
            [[ "$(dirname "$file")" == "." ]] && _local_md="$REPO_ROOT/CLAUDE.local.md"
            if [[ -f "$_local_md" ]]; then
                mark_reviewed "$file"
                continue
            fi
        fi
        cp "$OTHER_BACKUP_DIR/$file" "$REPO_ROOT/$file" 2>/dev/null || true
        mark_reviewed "$file"
    done

    if [[ ${#OTHER_CONFLICT_FILES[@]} -gt 0 ]]; then
        echo ""
        printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
        printf "${CYAN}${BOLD}  Your Local File Changes${NC}\n"
        printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
        echo ""
        info "${#OTHER_CONFLICT_FILES[@]} file(s) you edited also changed upstream:"
        echo ""

        ACCEPT_ALL_OTHER=false
        KEEP_ALL_OTHER=false

        for file in "${OTHER_CONFLICT_FILES[@]}"; do
            backup_file="$OTHER_BACKUP_DIR/$file"
            upstream_file="$REPO_ROOT/$file"

            if [[ "$ACCEPT_ALL_OTHER" == "true" ]]; then
                ok "Accepted upstream: $file"
                OTHER_REVIEW_MSG="${OTHER_REVIEW_MSG}\n    ${GREEN}✓${NC} $file (accepted upstream)"
                mark_reviewed "$file"
                continue
            fi
            if [[ "$KEEP_ALL_OTHER" == "true" ]]; then
                cp "$backup_file" "$upstream_file" 2>/dev/null || true
                ok "Kept yours: $file"
                OTHER_REVIEW_MSG="${OTHER_REVIEW_MSG}\n    ${YELLOW}○${NC} $file (kept yours)"
                mark_reviewed "$file"
                continue
            fi

            case "$(uname -s)" in
                MINGW*|MSYS*|CYGWIN*)
                    ANCESTOR_TMP="$BACKUP_DIR/ancestor-$(echo "$file" | tr '/' '-')-${UPDATE_TIMESTAMP}.md"
                    ;;
                *)
                    ANCESTOR_TMP=$(mktemp)
                    ;;
            esac
            git show "${OLD_HEAD}:${file}" > "$ANCESTOR_TMP" 2>/dev/null || echo "" > "$ANCESTOR_TMP"

            upstream_diff=$(diff -u "$ANCESTOR_TMP" "$upstream_file" 2>/dev/null | tail -n +3 || true)
            your_diff=$(diff -u "$ANCESTOR_TMP" "$backup_file" 2>/dev/null | tail -n +3 || true)

            has_upstream=false; [[ -n "$upstream_diff" ]] && has_upstream=true
            has_yours=false; [[ -n "$your_diff" ]] && has_yours=true

            # If CLAUDE.local.md exists, accept upstream CLAUDE.md directly
            if [[ "$(basename "$file")" == "CLAUDE.md" ]]; then
                _local_md="$REPO_ROOT/$(dirname "$file")/CLAUDE.local.md"
                [[ "$(dirname "$file")" == "." ]] && _local_md="$REPO_ROOT/CLAUDE.local.md"
                if [[ -f "$_local_md" ]]; then
                    ok "Accepted upstream: $file ${DIM}(customizations preserved in CLAUDE.local.md)${NC}"
                    OTHER_REVIEW_MSG="${OTHER_REVIEW_MSG}\n    ${GREEN}✓${NC} $file (accepted upstream — local overrides in CLAUDE.local.md)"
                    mark_reviewed "$file"
                    rm -f "$ANCESTOR_TMP"
                    continue
                fi
            fi

            # Smart Merge: both sides changed a CLAUDE.md — delegate to Claude
            if [[ "$(basename "$file")" == "CLAUDE.md" ]] && $has_upstream && $has_yours; then
                info "Smart Merge: $file"
                if smart_merge_file "$backup_file" "$upstream_file" "$ANCESTOR_TMP" "CLAUDE.md"; then
                    ok "Smart Merge complete: $file"
                    OTHER_REVIEW_MSG="${OTHER_REVIEW_MSG}\n    ${GREEN}⊕${NC} $file (smart merged)"
                else
                    cp "$backup_file" "$upstream_file" 2>/dev/null || true
                    warn "Smart Merge failed — keeping your version of $file"
                    OTHER_REVIEW_MSG="${OTHER_REVIEW_MSG}\n    ${YELLOW}○${NC} $file (kept yours — smart merge failed)"
                fi
                mark_reviewed "$file"
                rm -f "$ANCESTOR_TMP"
                continue
            fi

            # Non-CLAUDE.md files: auto-accept upstream
            ok "Accepted upstream: $file"
            OTHER_REVIEW_MSG="${OTHER_REVIEW_MSG}\n    ${GREEN}✓${NC} $file (accepted upstream)"
            mark_reviewed "$file"
            rm -f "$ANCESTOR_TMP"
        done
        echo ""
    fi
elif [[ ${#OTHER_MODIFIED_FILES[@]} -gt 0 ]]; then
    for file in "${OTHER_MODIFIED_FILES[@]}"; do
        if [[ "$(basename "$file")" == "CLAUDE.md" ]]; then
            _local_md="$REPO_ROOT/$(dirname "$file")/CLAUDE.local.md"
            [[ "$(dirname "$file")" == "." ]] && _local_md="$REPO_ROOT/CLAUDE.local.md"
            if [[ -f "$_local_md" ]]; then
                mark_reviewed "$file"
                continue
            fi
        fi
        cp "$OTHER_BACKUP_DIR/$file" "$REPO_ROOT/$file" 2>/dev/null || true
        mark_reviewed "$file"
    done
fi

# =========================================================
# Restore stashed protected files
# =========================================================
if $STASHED; then
    restore_protected_stash
fi

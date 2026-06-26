#!/usr/bin/env bash
# Steps 3-4: Gate new skills, present skill catalog, run GSD sync, and print summary.

# =========================================================
# Gate new skills: remove any that arrived via pull but
# aren't in installed.json - they'll be offered in Step 3
# =========================================================
REMOVED_SKILLS_MSG=""

if $HAVE_INSTALLED_JSON && [[ -f "$INSTALLED" ]] && [[ -f "$CATALOG" ]]; then
    SKILLS_TO_REMOVE=$("${PYTHON_CMD[@]}" -c "
import json, sys, os

def load_json(path, label):
    try:
        with open(path) as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        sys.stderr.write(f'ERROR: {label} ({path}) is invalid JSON: {e}\n')
        sys.exit(2)

inst = load_json('$INSTALLED', 'installed.json')
cat = load_json('$CATALOG', 'catalog.json')

installed = set(inst.get('installed_skills', []))
removed = set(inst.get('removed_skills', []))
core = set(cat.get('core_skills', []))
catalog_skills = set(cat.get('skills', {}).keys())
known = installed | removed | core

for s in sorted(removed):
    print(f'{s}|removed')

for s in sorted(catalog_skills - known):
    skill_dir = os.path.join('$REPO_ROOT', '.claude', 'skills', s)
    if os.path.isdir(skill_dir):
        print(f'{s}|new')
") || {
        printf "  ${RED}✗ Skill catalog or installed.json is corrupt - cannot gate new skills. See the error above.${NC}\n" >&2
        exit 1
    }

    if [[ -n "$SKILLS_TO_REMOVE" ]]; then
        while IFS='|' read -r skill reason; do
            [[ -z "$skill" ]] && continue
            skill_dir="$REPO_ROOT/.claude/skills/$skill"
            if [[ -d "$skill_dir" ]]; then
                rm -rf "$skill_dir"
                if [[ "$reason" == "removed" ]]; then
                    REMOVED_SKILLS_MSG="${REMOVED_SKILLS_MSG}\n    ${DIM}✗ $skill (re-removed per your preference)${NC}"
                fi
            fi
        done <<< "$SKILLS_TO_REMOVE"
    fi
elif $HAVE_INSTALLED_JSON && [[ -f "$INSTALLED" ]]; then
    REMOVED_SKILLS=$("${PYTHON_CMD[@]}" -c "
import json, sys
try:
    with open('$INSTALLED') as f:
        data = json.load(f)
except json.JSONDecodeError as e:
    sys.stderr.write('ERROR: installed.json ($INSTALLED) is invalid JSON: ' + str(e) + '\n')
    sys.exit(2)
for s in data.get('removed_skills', []):
    print(s)
") || {
        printf "  ${RED}✗ installed.json is corrupt - cannot re-apply removed skills. See the error above.${NC}\n" >&2
        exit 1
    }

    if [[ -n "$REMOVED_SKILLS" ]]; then
        while IFS= read -r skill; do
            skill_dir="$REPO_ROOT/.claude/skills/$skill"
            if [[ -d "$skill_dir" ]]; then
                rm -rf "$skill_dir"
                REMOVED_SKILLS_MSG="${REMOVED_SKILLS_MSG}\n    ${DIM}✗ $skill (re-removed per your preference)${NC}"
            fi
        done <<< "$REMOVED_SKILLS"
    fi
fi

# =========================================================
# STEP 3 OF 4: Skill Catalog
# =========================================================
echo ""
printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
printf "${CYAN}${BOLD}  Step 3: Skill Catalog${NC}\n"
printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
echo ""

INSTALLED_NEW_SKILLS_MSG=""

if [[ -f "$CATALOG" ]]; then
    CATALOG_OUTPUT=$("${PYTHON_CMD[@]}" -c "
import json, sys, os

catalog_path = '$CATALOG'
installed_path = '$INSTALLED'

def load_json(path, label):
    try:
        with open(path) as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        sys.stderr.write(f'ERROR: {label} ({path}) is invalid JSON: {e}\n')
        sys.exit(2)

catalog = load_json(catalog_path, 'catalog.json')

catalog_skills = catalog.get('skills', {})
core_skills = set(catalog.get('core_skills', []))

if os.path.exists(installed_path):
    inst = load_json(installed_path, 'installed.json')
    installed = set(inst.get('installed_skills', []))
    removed = set(inst.get('removed_skills', []))
else:
    installed = set()
    removed = set()

known = installed | removed | core_skills
# Only show as new if not already on disk
new_skills = set(
    s for s in set(catalog_skills.keys()) - known
    if not os.path.isdir(os.path.join('$REPO_ROOT', '.claude', 'skills', s))
)
available_skills = removed

order = {'utility': 1, 'strategy': 2, 'execution': 3, 'visual': 4, 'operations': 5}

def format_skill(name):
    info = catalog_skills[name]
    services = ','.join(info.get('requires_services', []))
    deps = ','.join(info.get('dependencies', []))
    return f'{name}|{info[\"category\"]}|{info[\"description\"]}|{services}|{deps}'

for s in sorted(new_skills, key=lambda n: (order.get(catalog_skills[n].get('category',''), 99), n)):
    print(format_skill(s))
print('---')
for s in sorted(available_skills, key=lambda n: (order.get(catalog_skills.get(n,{}).get('category',''), 99), n)):
    if s in catalog_skills:
        print(format_skill(s))
") || {
        printf "  ${RED}✗ Skill catalog (or installed.json) is corrupt - cannot show the skill catalog. See the error above.${NC}\n" >&2
        exit 1
    }

    NEW_SKILLS=$(echo "$CATALOG_OUTPUT" | sed '/^---$/,$d')
    AVAILABLE_SKILLS=$(echo "$CATALOG_OUTPUT" | sed '1,/^---$/d')

    # --- New skills section ---
    if [[ -n "$NEW_SKILLS" ]] && [[ "$NEW_SKILLS" != "" ]]; then
        ok "New skills added since your last update:"
        echo ""

        declare -a NS_NAMES=()
        declare -a NS_CATEGORIES=()
        declare -a NS_DESCRIPTIONS=()
        declare -a NS_SERVICES=()
        declare -a NS_DEPS=()
        CURRENT_CATEGORY=""

        while IFS='|' read -r name category description services deps; do
            [[ -z "$name" ]] && continue
            NS_NAMES+=("$name")
            NS_CATEGORIES+=("$category")
            NS_DESCRIPTIONS+=("$description")
            NS_SERVICES+=("$services")
            NS_DEPS+=("$deps")
        done <<< "$NEW_SKILLS"

        for i in "${!NS_NAMES[@]}"; do
            NUM=$((i + 1))
            cat="${NS_CATEGORIES[$i]}"

            if [[ "$cat" != "$CURRENT_CATEGORY" ]]; then
                first="$(echo "${cat:0:1}" | tr '[:lower:]' '[:upper:]')"
                printf "\n    ${BOLD}%s${NC}\n" "${first}${cat:1}"
                CURRENT_CATEGORY="$cat"
            fi

            svc_note=""
            [[ -n "${NS_SERVICES[$i]}" ]] && svc_note=" ${DIM}(needs ${NS_SERVICES[$i]})${NC}"
            dep_note=""
            [[ -n "${NS_DEPS[$i]}" ]] && dep_note=" ${DIM}(auto-adds: ${NS_DEPS[$i]})${NC}"

            printf "     ${BOLD}[%2d]${NC} %-26s ${DIM} -  %s${NC}%b%b\n" \
                "$NUM" "${NS_NAMES[$i]}" "${NS_DESCRIPTIONS[$i]}" "$svc_note" "$dep_note"
        done
        echo ""
        info "Installing all new skills..."
        echo ""
        for ns in "${NS_NAMES[@]}"; do
            bash "$REPO_ROOT/scripts/add-skill.sh" "$ns" 2>&1 | sed 's/^/    /'
            INSTALLED_NEW_SKILLS_MSG="${INSTALLED_NEW_SKILLS_MSG}\n    ${GREEN}✓${NC} $ns"
        done
        echo ""
    else
        ok "No new skills since your last update."
        echo ""
    fi

    # --- Available (not installed) skills section ---
    if [[ -n "$AVAILABLE_SKILLS" ]] && [[ "$AVAILABLE_SKILLS" != "" ]]; then
        AVAIL_COUNT=$(echo "$AVAILABLE_SKILLS" | grep -c '|' || true)
        echo ""
        info "You also have ${BOLD}${AVAIL_COUNT} skill(s)${NC} ${CYAN}available that you haven't installed:${NC}"
        echo ""

        declare -a AV_NAMES=()
        declare -a AV_CATEGORIES=()
        declare -a AV_DESCRIPTIONS=()
        declare -a AV_SERVICES=()
        declare -a AV_DEPS=()
        CURRENT_CATEGORY=""

        while IFS='|' read -r name category description services deps; do
            [[ -z "$name" ]] && continue
            AV_NAMES+=("$name")
            AV_CATEGORIES+=("$category")
            AV_DESCRIPTIONS+=("$description")
            AV_SERVICES+=("$services")
            AV_DEPS+=("$deps")
        done <<< "$AVAILABLE_SKILLS"

        for i in "${!AV_NAMES[@]}"; do
            NUM=$((i + 1))
            cat="${AV_CATEGORIES[$i]}"

            if [[ "$cat" != "$CURRENT_CATEGORY" ]]; then
                first="$(echo "${cat:0:1}" | tr '[:lower:]' '[:upper:]')"
                printf "\n    ${BOLD}%s${NC}\n" "${first}${cat:1}"
                CURRENT_CATEGORY="$cat"
            fi

            svc_note=""
            [[ -n "${AV_SERVICES[$i]}" ]] && svc_note=" ${DIM}(needs ${AV_SERVICES[$i]})${NC}"
            dep_note=""
            [[ -n "${AV_DEPS[$i]}" ]] && dep_note=" ${DIM}(auto-adds: ${AV_DEPS[$i]})${NC}"

            printf "     ${DIM}[%2d]${NC} %-26s ${DIM} -  %s${NC}%b%b\n" \
                "$NUM" "${AV_NAMES[$i]}" "${AV_DESCRIPTIONS[$i]}" "$svc_note" "$dep_note"
        done
        echo ""

        printf "  Enter numbers to install (e.g. ${BOLD}1 3${NC}), ${BOLD}all${NC}, or press Enter to skip: "
        read -r AV_INPUT < /dev/tty

        if [[ -n "$AV_INPUT" ]]; then
            SELECTED_AV=()
            if echo "$AV_INPUT" | grep -qi "^all$"; then
                SELECTED_AV=("${AV_NAMES[@]}")
            else
                for token in $AV_INPUT; do
                    if [[ "$token" =~ ^[0-9]+$ ]] && [[ "$token" -ge 1 ]] && [[ "$token" -le "${#AV_NAMES[@]}" ]]; then
                        SELECTED_AV+=("${AV_NAMES[$((token - 1))]}")
                    else
                        warn "Ignoring invalid selection: $token"
                    fi
                done
            fi

            if [[ ${#SELECTED_AV[@]} -gt 0 ]]; then
                echo ""
                for av in "${SELECTED_AV[@]}"; do
                    bash "$REPO_ROOT/scripts/add-skill.sh" "$av" 2>&1 | sed 's/^/    /'
                    INSTALLED_NEW_SKILLS_MSG="${INSTALLED_NEW_SKILLS_MSG}\n    ${GREEN}✓${NC} $av"
                done
                echo ""
            fi
        else
            echo ""
        fi
    fi
else
    warn "Skill catalog not found - skipping skill check."
    echo ""
fi

# =========================================================
# GSD migration status
# =========================================================
GSD_STATUS="${AGENTIC_OS_GSD_UPDATE_STATUS:-}"

record_memory_setup_decision() {
    local decision="$1"
    local helper="${REPO_ROOT}/scripts/launcher-bootstrap.py"

    [[ -f "$helper" ]] || return 0
    "${PYTHON_CMD[@]}" "$helper" --repo-root "$REPO_ROOT" state-mark-memory --memory "$decision" >/dev/null 2>&1 || true
}

offer_memory_setup_after_update() {
    local setup_script="${REPO_ROOT}/scripts/setup-memory.sh"
    local reply=""
    local exit_code=0

    [[ -f "$setup_script" ]] || return 0
    [[ "${AGENTIC_OS_SKIP_MEMORY_PROMPT:-0}" != "1" ]] || return 0

    if bash "$setup_script" --check >/dev/null 2>&1; then
        record_memory_setup_decision "configured"
        return 0
    fi

    # Keep automated update runs non-blocking. The setup can still be run manually.
    if [[ ! -t 0 ]]; then
        echo ""
        info "Searchable memory is available. Run ${BOLD}bash scripts/setup-memory.sh${NC} when you are ready."
        return 0
    fi

    echo ""
    printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
    printf "${CYAN}${BOLD}  Recommended: Searchable Memory${NC}\n"
    printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
    echo ""
    echo "  MemSearch lets AI-OS search older memory, daily logs,"
    echo "  learnings, and client-scoped brand context. Claude Code is the recommended default,"
    echo "  but Codex and Claude Code + Codex are also supported."
    echo ""
    printf "  Set it up now? ${BOLD}[Y/n]${NC} "
    if ! read -r reply; then
        reply="N"
    fi
    reply="${reply:-Y}"

    if [[ ! "$reply" =~ ^[Yy]$ ]]; then
        warn "Skipped searchable memory setup. The update flow will offer it again next time."
        echo "  Semantic recall, older memory search,"
        echo "  expanded search, and stronger citations remain unavailable until enabled."
        record_memory_setup_decision "skipped-update"
        return 0
    fi

    set +e
    bash "$setup_script"
    exit_code=$?
    set -e

    if [[ $exit_code -eq 0 ]]; then
        record_memory_setup_decision "configured"
    elif [[ $exit_code -eq 3 ]]; then
        record_memory_setup_decision "skipped-confirmation"
    else
        record_memory_setup_decision "failed"
    fi

    return 0
}

# =========================================================
# STEP 4 OF 4: Summary
# =========================================================
echo ""
printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
printf "${CYAN}${BOLD}  Step 4: Summary${NC}\n"
printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
echo ""

NEW_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
NEW_VERSION="${NEW_VERSION:-$(read_agentic_os_version)}"
if $HAS_UPSTREAM_CHANGES; then
    if [[ -n "$OLD_TAG" ]] && [[ -n "$NEW_TAG" ]] && [[ "$OLD_TAG" != "$NEW_TAG" ]]; then
        ok "Main repo: updated ${OLD_TAG} → ${NEW_TAG}"
    else
        ok "Main repo: pulled ${COMMIT_COUNT} new commit(s)"
    fi

    if [[ "${OLD_VERSION:-unknown}" != "$NEW_VERSION" ]]; then
        ok "Version: $(format_agentic_os_version "${OLD_VERSION:-unknown}") -> $(format_agentic_os_version "$NEW_VERSION")"
    else
        ok "Version: still $(format_agentic_os_version "$NEW_VERSION")"
    fi

    CHANGES=$(git log --oneline "${OLD_HEAD}..${NEW_HEAD}" 2>/dev/null | sed 's/^/      /')
    if [[ -n "$CHANGES" ]]; then
        echo "$CHANGES"
    fi
else
    ok "Main repo: already up to date"
    ok "Version: $(format_agentic_os_version "$NEW_VERSION") already installed"
fi

if [[ ${#USER_CREATED_SKILLS[@]} -gt 0 ]]; then
    printf "\n  ${BOLD}Your custom skills:${NC} %s\n" "${USER_CREATED_SKILLS[*]}"
fi

if [[ -n "$SKILL_REVIEW_MSG" ]]; then
    printf "\n  ${BOLD}Skill review:${NC}"
    printf "$SKILL_REVIEW_MSG\n"
    info "Backups saved to ${BOLD}.backup/${NC} if you change your mind."
elif [[ ${#MODIFIED_SKILLS[@]} -gt 0 ]]; then
    printf "\n"
    ok "Local skill changes: kept as-is (no upstream conflicts)"
fi

if [[ -n "$OTHER_REVIEW_MSG" ]]; then
    printf "\n  ${BOLD}File review:${NC}"
    printf "$OTHER_REVIEW_MSG\n"
fi

if [[ -n "$INSTALLED_NEW_SKILLS_MSG" ]]; then
    printf "\n  ${BOLD}Newly installed:${NC}"
    printf "$INSTALLED_NEW_SKILLS_MSG\n"
fi

if [[ -n "$REMOVED_SKILLS_MSG" ]]; then
    printf "$REMOVED_SKILLS_MSG\n"
fi

if [[ -n "$GSD_STATUS" ]]; then
    echo ""
    ok "GSD framework: ${GSD_STATUS}"
fi

offer_memory_setup_after_update

# =========================================================
# What's New - compare old vs new catalog.json
# =========================================================
if $HAS_UPSTREAM_CHANGES && [[ -f "$CATALOG" ]]; then
    WHATS_NEW=$("${PYTHON_CMD[@]}" -c "
import json, sys

catalog_path = '$CATALOG'
old_head = '$OLD_HEAD'

try:
    with open(catalog_path) as f:
        new_cat = json.load(f)
except Exception:
    sys.exit(0)

import subprocess
try:
    old_json = subprocess.check_output(
        ['git', 'show', f'{old_head}:.claude/skills/_catalog/catalog.json'],
        stderr=subprocess.DEVNULL
    ).decode()
    old_cat = json.loads(old_json)
except Exception:
    old_cat = {'skills': {}}

new_version = new_cat.get('version', '')
old_version = old_cat.get('version', '')

highlights = []
notes = ''
if new_version and new_version != old_version:
    for release in new_cat.get('releases', []):
        if release.get('version') == new_version:
            highlights = release.get('highlights', [])
            notes = release.get('notes', '')
            break

new_skills = new_cat.get('skills', {})
old_skills = old_cat.get('skills', {})

skill_lines = []
for name, info in new_skills.items():
    new_ver = info.get('version', '')
    old_ver = old_skills.get(name, {}).get('version', '')
    story = info.get('story', {})
    story_text = story.get('text', '') if isinstance(story, dict) else str(story)
    story_video = story.get('video', '') if isinstance(story, dict) else ''
    changelog = info.get('changelog', [])

    if name not in old_skills:
        label = 'NEW'
    elif new_ver and old_ver and new_ver != old_ver:
        label = 'UPDATED'
    else:
        continue

    change_summary = ''
    for entry in changelog:
        if entry.get('version') == new_ver:
            change_summary = entry.get('summary', '')
            break

    skill_lines.append(f'{label}|{name}|{info.get(\"description\",\"\")}|{story_text}|{story_video}|{change_summary}')

for h in highlights:
    print(f'HIGHLIGHT|{h}')
if notes:
    print(f'NOTES|{notes}')
for l in skill_lines:
    print(l)
" 2>/dev/null || true)

    if [[ -n "$WHATS_NEW" ]]; then
        CURRENT_VERSION=$(cat "$REPO_ROOT/VERSION" 2>/dev/null || echo "")
        echo ""
        printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
        if [[ -n "$CURRENT_VERSION" ]]; then
            printf "${CYAN}${BOLD}  What's New - v${CURRENT_VERSION}${NC}\n"
        else
            printf "${CYAN}${BOLD}  What's New${NC}\n"
        fi
        printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
        echo ""

        HAS_HIGHLIGHTS=false
        while IFS='|' read -r label rest; do
            [[ -z "$label" ]] && continue
            if [[ "$label" == "HIGHLIGHT" ]]; then
                HAS_HIGHLIGHTS=true
                printf "  ${GREEN}✦${NC} %s\n" "$rest"
            elif [[ "$label" == "NOTES" ]]; then
                echo ""
                printf "  ${DIM}%s${NC}\n" "$rest"
            fi
        done <<< "$WHATS_NEW"
        $HAS_HIGHLIGHTS && echo ""

        while IFS='|' read -r label name desc story_text story_video change_summary; do
            [[ -z "$name" ]] && continue
            [[ "$label" == "HIGHLIGHT" || "$label" == "NOTES" ]] && continue
            if [[ "$label" == "NEW" ]]; then
                badge="${GREEN}${BOLD}  NEW${NC}"
            else
                badge="${CYAN}${BOLD}  UPDATED${NC}"
            fi
            printf "  %b  ${BOLD}%s${NC}\n" "$badge" "$name"
            [[ -n "$desc" ]] && printf "       ${DIM}%s${NC}\n" "$desc"
            [[ -n "$story_text" ]] && printf "       \"%s\"\n" "$story_text"
            [[ -n "$story_video" ]] && printf "       ${CYAN}▶ Watch: %s${NC}\n" "$story_video"
            [[ -n "$change_summary" ]] && printf "       ${DIM}→ %s${NC}\n" "$change_summary"
            echo ""
        done <<< "$WHATS_NEW"
    fi
fi

# Protected files
echo ""
ok "Your data is safe:"
printf "    brand_context/  ${GREEN}✓${NC}   .env  ${GREEN}✓${NC}   context/  ${GREEN}✓${NC}   projects/  ${GREEN}✓${NC}\n"

echo ""
if $HAS_UPSTREAM_CHANGES; then
    ok "You are now on AI-OS $(format_agentic_os_version "$NEW_VERSION")."
else
    ok "You already have AI-OS $(format_agentic_os_version "$NEW_VERSION")."
fi

# ---------- Auto-sync to client folders ----------
if [[ -d "${REPO_ROOT}/clients" ]]; then
    CLIENT_COUNT=0
    for CLIENT_DIR in "${REPO_ROOT}/clients"/*/; do
        [[ -d "$CLIENT_DIR" ]] || continue
        CLIENT_COUNT=$((CLIENT_COUNT + 1))
    done
    if [[ $CLIENT_COUNT -gt 0 ]]; then
        echo ""
        info "Syncing updates to ${CLIENT_COUNT} client folder(s)..."
        bash "${REPO_ROOT}/scripts/update-clients.sh"
    fi
fi

LEGACY_CENTRE_DIR="${REPO_ROOT}/projects/briefs/command-centre"
if [[ -d "$LEGACY_CENTRE_DIR" ]]; then
    echo ""
    warn "Legacy Command Centre folder detected at projects/briefs/command-centre/"
    info "The active app now lives in command-centre/ at the repo root."
    info "The old folder is no longer used and can be deleted manually when you're ready."
fi

echo ""
printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
echo ""

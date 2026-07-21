#!/usr/bin/env bash
set -euo pipefail

# ==========================================================
# Agentic OS — Update Script Test Harness
#
# Creates isolated git repos (main + demo) in /tmp and sets
# up 29 test scenarios to exercise every branch of update.sh.
#
# Usage:
#   bash scripts/test-update.sh              # interactive menu
#   bash scripts/test-update.sh <number>     # run specific scenario
#   bash scripts/test-update.sh list         # list all scenarios
#   bash scripts/test-update.sh clean        # remove test environment
# ==========================================================

# ---------- Colors ----------
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ---------- Paths ----------
REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="/tmp/agentic-os-test"
MAIN_REPO="$TEST_ROOT/main-repo"          # bare upstream repo
DEMO_REPO="$TEST_ROOT/demo-repo"          # user's clone
MAIN_WORK="$TEST_ROOT/main-worktree"      # working copy for pushing changes
source "$REAL_REPO/scripts/lib/python.sh"

if ! resolve_python_cmd; then
    err "Python 3 is required for scripts/test-update.sh"
    exit 1
fi

# ---------- Helpers ----------
info()   { printf "  ${CYAN}%b${NC}\n" "$1"; }
ok()     { printf "  ${GREEN}✓ %b${NC}\n" "$1"; }
warn()   { printf "  ${YELLOW}→ %b${NC}\n" "$1"; }
err()    { printf "  ${RED}✗ %b${NC}\n" "$1"; }
header() { printf "\n${CYAN}${BOLD}  ═══ %s ═══${NC}\n\n" "$1"; }

assert_output_contains() {
    local file="$1"
    local expected="$2"
    if grep -Fq "$expected" "$file"; then
        ok "Found: $expected"
    else
        err "Expected output not found: $expected"
        echo ""
        sed -n '1,220p' "$file"
        return 1
    fi
}

# ---------- Environment Setup ----------

create_test_env() {
    header "Creating test environment"

    # Clean any previous run
    rm -rf "$TEST_ROOT"
    mkdir -p "$TEST_ROOT"

    info "Copying real repo to create main..."

    # Create a working copy from the real repo
    git clone "$REAL_REPO" "$MAIN_WORK" --quiet 2>/dev/null
    cd "$MAIN_WORK"

    # Remove any user data that shouldn't be in "upstream"
    rm -f .env .mcp.json 2>/dev/null || true
    rm -rf context/memory/*.md brand_context/*.md projects/ 2>/dev/null || true

    # Commit clean state
    git add -A 2>/dev/null || true
    git commit -m "Clean upstream state" --allow-empty --quiet 2>/dev/null || true

    # Create a bare repo from this
    git clone --bare "$MAIN_WORK" "$MAIN_REPO" --quiet 2>/dev/null

    # Repoint main worktree's origin to the bare repo (not the real repo)
    git remote set-url origin "$MAIN_REPO"

    # Clone demo from the bare repo
    git clone "$MAIN_REPO" "$DEMO_REPO" --quiet 2>/dev/null

    # Set up demo repo with installed.json (simulating post-install state)
    cd "$DEMO_REPO"
    mkdir -p .claude/skills/_catalog

    # Write installed.json with a realistic selection
    cat > .claude/skills/_catalog/installed.json << 'IJSON'
{
  "installed_at": "2026-03-12",
  "version": "1.0.0",
  "installed_skills": [
    "meta-skill-creator",
    "meta-wrap-up",
    "mkt-brand-voice",
    "mkt-content-repurposing",
    "mkt-copywriting",
    "mkt-icp",
    "mkt-positioning",
    "tool-humanizer"
  ],
  "removed_skills": [
    "mkt-ugc-scripts",
    "ops-cron",
    "str-trending-research",
    "tool-firecrawl-scraper",
    "tool-youtube",
    "viz-excalidraw-diagram",
    "viz-ugc-heygen"
  ]
}
IJSON

    # Remove the skills the user "chose not to install"
    rm -rf .claude/skills/mkt-ugc-scripts 2>/dev/null || true
    rm -rf .claude/skills/ops-cron 2>/dev/null || true
    rm -rf .claude/skills/str-trending-research 2>/dev/null || true
    rm -rf .claude/skills/tool-firecrawl-scraper 2>/dev/null || true
    rm -rf .claude/skills/tool-youtube 2>/dev/null || true
    rm -rf .claude/skills/viz-excalidraw-diagram 2>/dev/null || true
    rm -rf .claude/skills/viz-ugc-heygen 2>/dev/null || true

    git add -A 2>/dev/null
    git commit -m "Post-install state: selected skills only" --quiet 2>/dev/null
    git push origin main --quiet 2>/dev/null

    # Push same state to main repo
    cd "$MAIN_WORK"
    git pull origin main --quiet 2>/dev/null || true

    ok "Test environment created"
    info "Main repo (bare):  $MAIN_REPO"
    info "Main worktree:     $MAIN_WORK"
    info "Demo repo:         $DEMO_REPO"
    echo ""
}

reset_demo() {
    # Reset demo repo to clean post-install state
    cd "$DEMO_REPO"
    git checkout main --quiet 2>/dev/null
    git reset --hard origin/main --quiet 2>/dev/null
    git clean -fd --quiet 2>/dev/null
    # Re-ensure installed.json exists
    if [[ ! -f .claude/skills/_catalog/installed.json ]]; then
        cat > .claude/skills/_catalog/installed.json << 'IJSON'
{
  "installed_at": "2026-03-12",
  "version": "1.0.0",
  "installed_skills": [
    "meta-skill-creator",
    "meta-wrap-up",
    "mkt-brand-voice",
    "mkt-content-repurposing",
    "mkt-copywriting",
    "mkt-icp",
    "mkt-positioning",
    "tool-humanizer"
  ],
  "removed_skills": [
    "mkt-ugc-scripts",
    "ops-cron",
    "str-trending-research",
    "tool-firecrawl-scraper",
    "tool-youtube",
    "viz-excalidraw-diagram",
    "viz-ugc-heygen"
  ]
}
IJSON
    fi
}

reset_main() {
    # Reset main worktree to match bare repo
    cd "$MAIN_WORK"
    git checkout main --quiet 2>/dev/null
    git reset --hard origin/main --quiet 2>/dev/null
    git clean -fd --quiet 2>/dev/null
}

push_from_main() {
    # Commit and push changes made in MAIN_WORK
    cd "$MAIN_WORK"
    git add -A 2>/dev/null
    git commit -m "${1:-upstream change}" --quiet 2>/dev/null
    git push origin main --quiet 2>/dev/null
}

run_update() {
    # Run update.sh in the demo repo with optional piped input
    cd "$DEMO_REPO"
    local update_env=(
        "AGENTIC_OS_UPSTREAM_SLUG=agentic-os-test/main-repo"
        "AGENTIC_OS_SKIP_MEMORY_PROMPT=1"
    )
    if [[ -n "${1:-}" ]]; then
        echo "$1" | env "${update_env[@]}" bash scripts/update.sh
    else
        env "${update_env[@]}" bash scripts/update.sh
    fi
}

run_version_output_test() {
    local test_root="${TMPDIR:-/tmp}/agentic-os-version-output-test"
    local upstream="$test_root/upstream"
    local demo="$test_root/demo"
    local first_output="$test_root/update-with-version-change.out"
    local second_output="$test_root/update-without-version-change.out"

    header "Version output test"
    rm -rf "$test_root"
    mkdir -p "$test_root"

    git clone "$REAL_REPO" "$upstream" --quiet
    cd "$upstream"
    git checkout -b main --quiet 2>/dev/null || git checkout main --quiet 2>/dev/null || true
    cp "$REAL_REPO/VERSION" VERSION
    cp "$REAL_REPO/scripts/update.sh" scripts/update.sh
    cp "$REAL_REPO/scripts/lib/common.sh" scripts/lib/common.sh
    cp "$REAL_REPO/scripts/lib/pull.sh" scripts/lib/pull.sh
    cp "$REAL_REPO/scripts/lib/catalog.sh" scripts/lib/catalog.sh
    cp "$REAL_REPO/scripts/lib/preview.sh" scripts/lib/preview.sh
    mkdir -p config
    cp "$REAL_REPO/config/update-manifest.json" config/update-manifest.json
    git add VERSION scripts/update.sh scripts/lib/common.sh scripts/lib/pull.sh scripts/lib/catalog.sh scripts/lib/preview.sh config/update-manifest.json
    git commit -m "Use current update scripts" --allow-empty --quiet

    git clone "$upstream" "$demo" --quiet
    cd "$demo"
    git checkout main --quiet 2>/dev/null || true

    cd "$upstream"
    printf "9.9.9\n" > VERSION
    git add VERSION
    git commit -m "Bump version for update output test" --quiet

    cd "$demo"
    env AGENTIC_OS_UPSTREAM_SLUG=agentic-os-version-output-test/upstream \
        AGENTIC_OS_SKIP_MEMORY_PROMPT=1 \
        bash scripts/update.sh > "$first_output" 2>&1

    assert_output_contains "$first_output" "Current version: v$(cat "$REAL_REPO/VERSION")"
    assert_output_contains "$first_output" "Version: v$(cat "$REAL_REPO/VERSION") -> v9.9.9"
    assert_output_contains "$first_output" "You are now on Agentic OS v9.9.9."

    env AGENTIC_OS_UPSTREAM_SLUG=agentic-os-version-output-test/upstream \
        AGENTIC_OS_SKIP_MEMORY_PROMPT=1 \
        bash scripts/update.sh > "$second_output" 2>&1

    assert_output_contains "$second_output" "Current version: v9.9.9"
    assert_output_contains "$second_output" "Version: v9.9.9 already installed"
    assert_output_contains "$second_output" "You already have Agentic OS v9.9.9."

    ok "Version output test passed"
}

run_update_v2_contract_test() {
    local test_root
    test_root="$(mktemp -d "${TMPDIR:-/tmp}/agentic-os-update-v2-test.XXXXXX")"
    local upstream="$test_root/upstream"
    local demo="$test_root/demo"
    local dry_output="$test_root/dry-run.out"
    local apply_output="$test_root/apply.out"
    local upstream_slug
    upstream_slug="$(basename "$test_root")/upstream"

    header "Updater v2 contract test"

    git clone "$REAL_REPO" "$upstream" --quiet
    cd "$upstream"
    git checkout -b main --quiet 2>/dev/null || git checkout main --quiet 2>/dev/null || true
    mkdir -p scripts/lib config
    cp "$REAL_REPO/scripts/update.sh" scripts/update.sh
    cp "$REAL_REPO/scripts/lib/common.sh" scripts/lib/common.sh
    cp "$REAL_REPO/scripts/lib/preview.sh" scripts/lib/preview.sh
    cp "$REAL_REPO/scripts/lib/backup.sh" scripts/lib/backup.sh
    cp "$REAL_REPO/scripts/lib/pull.sh" scripts/lib/pull.sh
    cp "$REAL_REPO/scripts/lib/catalog.sh" scripts/lib/catalog.sh
    cp "$REAL_REPO/scripts/rollback.sh" scripts/rollback.sh
    cp "$REAL_REPO/config/update-manifest.json" config/update-manifest.json
    cp "$REAL_REPO/README.md" README.md
    cp "$REAL_REPO/AGENTS.md" AGENTS.md
    git add scripts/update.sh scripts/lib/common.sh scripts/lib/preview.sh scripts/lib/backup.sh scripts/lib/pull.sh scripts/lib/catalog.sh scripts/rollback.sh config/update-manifest.json README.md AGENTS.md
    git commit -m "Use updater v2 files" --allow-empty --quiet

    git clone "$upstream" "$demo" --quiet

    cd "$upstream"
    printf "9.9.10\n" > VERSION
    printf "\n<!-- updater v2 dry-run fixture -->\n" >> AGENTS.md
    git add VERSION AGENTS.md
    git commit -m "Publish updater v2 fixture update" --quiet

    cd "$demo"
    env AGENTIC_OS_UPSTREAM_SLUG="$upstream_slug" \
        AGENTIC_OS_SKIP_MEMORY_PROMPT=1 \
        bash scripts/update.sh --dry-run > "$dry_output" 2>&1

    assert_output_contains "$dry_output" "AI-OS Update Preview"
    assert_output_contains "$dry_output" "Would update:"
    assert_output_contains "$dry_output" "Protected user data:"
    if [[ "$(cat VERSION)" != "$(cat "$REAL_REPO/VERSION")" ]]; then
        err "Dry run changed VERSION"
        return 1
    fi

    env AGENTIC_OS_UPSTREAM_SLUG="$upstream_slug" \
        AGENTIC_OS_SKIP_MEMORY_PROMPT=1 \
        bash scripts/update.sh > "$apply_output" 2>&1

    assert_output_contains "$apply_output" "Version:"
    assert_output_contains "$apply_output" "Your data is safe:"

    if ! git for-each-ref --format="%(refname:short)" refs/heads/update-recovery | grep -q '^update-recovery/'; then
        err "No update recovery branch was created"
        return 1
    fi
    ok "Update recovery branch was created"

    if ! find .backup -maxdepth 1 -type d -name 'update-*' | grep -q .; then
        err "No per-update backup directory was created"
        return 1
    fi
    ok "Per-update backup directory was created"

    ok "Updater v2 contract test passed"
}

run_update_v2_corrupt_catalog_test() {
    local test_root
    test_root="$(mktemp -d "${TMPDIR:-/tmp}/agentic-os-corrupt-catalog-test.XXXXXX")"
    local repo="$test_root/repo"
    local output="$test_root/update.out"

    header "Updater v2 corrupt catalog test"

    git clone "$REAL_REPO" "$repo" --quiet
    cd "$repo"
    mkdir -p scripts/lib config
    cp "$REAL_REPO/scripts/update.sh" scripts/update.sh
    cp "$REAL_REPO/scripts/lib/common.sh" scripts/lib/common.sh
    cp "$REAL_REPO/scripts/lib/catalog.sh" scripts/lib/catalog.sh
    cp "$REAL_REPO/scripts/lib/preview.sh" scripts/lib/preview.sh
    cp "$REAL_REPO/config/update-manifest.json" config/update-manifest.json
    git remote add upstream "$REAL_REPO"

    printf '{ broken json\n' > .claude/skills/_catalog/installed.json

    set +e
    AGENTIC_OS_UPSTREAM_SLUG="$(basename "$REAL_REPO")" \
        AGENTIC_OS_SKIP_MEMORY_PROMPT=1 \
        bash scripts/update.sh > "$output" 2>&1
    local exit_code=$?
    set -e

    if [[ "$exit_code" -eq 0 ]]; then
        err "Corrupt installed.json did not stop update"
        sed -n '1,220p' "$output"
        return 1
    fi

    assert_output_contains "$output" "installed.json"
    assert_output_contains "$output" "corrupt"
    ok "Corrupt catalog state stops update with a clear error"
}

run_update_v2_user_owned_preserved_test() {
    local test_root
    test_root="$(mktemp -d "${TMPDIR:-/tmp}/agentic-os-user-owned-test.XXXXXX")"
    local upstream="$test_root/upstream"
    local demo="$test_root/demo"
    local output="$test_root/update.out"
    local protected_file="brand_context/README.md"
    local upstream_slug
    upstream_slug="$(basename "$test_root")/upstream"

    header "Updater v2 user-owned preservation test"

    git clone "$REAL_REPO" "$upstream" --quiet
    cd "$upstream"
    git checkout -b main --quiet 2>/dev/null || git checkout main --quiet 2>/dev/null || true
    mkdir -p scripts/lib config
    cp "$REAL_REPO/scripts/update.sh" scripts/update.sh
    cp "$REAL_REPO/scripts/lib/common.sh" scripts/lib/common.sh
    cp "$REAL_REPO/scripts/lib/preview.sh" scripts/lib/preview.sh
    cp "$REAL_REPO/scripts/lib/backup.sh" scripts/lib/backup.sh
    cp "$REAL_REPO/scripts/lib/pull.sh" scripts/lib/pull.sh
    cp "$REAL_REPO/scripts/lib/catalog.sh" scripts/lib/catalog.sh
    cp "$REAL_REPO/config/update-manifest.json" config/update-manifest.json
    git add scripts/update.sh scripts/lib/common.sh scripts/lib/preview.sh scripts/lib/backup.sh scripts/lib/pull.sh scripts/lib/catalog.sh config/update-manifest.json
    git commit -m "Use updater v2 files" --allow-empty --quiet

    git clone "$upstream" "$demo" --quiet

    cd "$demo"
    printf "USER LOCAL BRAND CONTENT\n" > "$protected_file"
    git add "$protected_file"
    git commit -m "User customizes brand context" --quiet

    cd "$upstream"
    printf "UPSTREAM TEMPLATE CONTENT\n" > "$protected_file"
    git add "$protected_file"
    git commit -m "Upstream changes starter brand context" --quiet

    cd "$demo"
    env AGENTIC_OS_UPSTREAM_SLUG="$upstream_slug" \
        AGENTIC_OS_SKIP_MEMORY_PROMPT=1 \
        bash scripts/update.sh > "$output" 2>&1

    if ! grep -q "USER LOCAL BRAND CONTENT" "$protected_file"; then
        err "User-owned tracked file was overwritten"
        sed -n '1,220p' "$output"
        return 1
    fi
    ok "User-owned tracked file kept the user's content"

    if ! find .backup -path "*/upstream-user-owned/$protected_file" -type f | grep -q .; then
        err "Upstream copy of user-owned file was not backed up"
        return 1
    fi
    ok "Upstream copy was saved in the update backup"

    assert_output_contains "$output" "User-owned files preserved"
}

run_update_v2_ignored_user_owned_collision_test() {
    local test_root
    test_root="$(mktemp -d "${TMPDIR:-/tmp}/agentic-os-ignored-user-owned-test.XXXXXX")"
    local upstream="$test_root/upstream"
    local demo="$test_root/demo"
    local output="$test_root/update.out"
    local protected_file="clients/acme/context/MEMORY.md"
    local upstream_slug
    upstream_slug="$(basename "$test_root")/upstream"

    header "Updater v2 ignored user-owned collision test"

    git clone "$REAL_REPO" "$upstream" --quiet
    cd "$upstream"
    git checkout -b main --quiet 2>/dev/null || git checkout main --quiet 2>/dev/null || true
    mkdir -p scripts/lib config
    cp "$REAL_REPO/scripts/update.sh" scripts/update.sh
    cp "$REAL_REPO/scripts/lib/common.sh" scripts/lib/common.sh
    cp "$REAL_REPO/scripts/lib/preview.sh" scripts/lib/preview.sh
    cp "$REAL_REPO/scripts/lib/backup.sh" scripts/lib/backup.sh
    cp "$REAL_REPO/scripts/lib/pull.sh" scripts/lib/pull.sh
    cp "$REAL_REPO/scripts/lib/catalog.sh" scripts/lib/catalog.sh
    cp "$REAL_REPO/config/update-manifest.json" config/update-manifest.json
    git add scripts/update.sh scripts/lib/common.sh scripts/lib/preview.sh scripts/lib/backup.sh scripts/lib/pull.sh scripts/lib/catalog.sh config/update-manifest.json
    git commit -m "Use updater v2 files" --allow-empty --quiet

    git clone "$upstream" "$demo" --quiet

    cd "$demo"
    mkdir -p "$(dirname "$protected_file")"
    printf "USER LOCAL MEMORY\n" > "$protected_file"

    cd "$upstream"
    mkdir -p "$(dirname "$protected_file")"
    printf "UPSTREAM STARTER MEMORY\n" > "$protected_file"
    git add -f "$protected_file"
    git commit -m "Upstream accidentally tracks client memory" --quiet

    cd "$demo"
    env AGENTIC_OS_UPSTREAM_SLUG="$upstream_slug" \
        AGENTIC_OS_SKIP_MEMORY_PROMPT=1 \
        bash scripts/update.sh > "$output" 2>&1

    if ! grep -q "USER LOCAL MEMORY" "$protected_file"; then
        err "Ignored user-owned file was overwritten"
        sed -n '1,220p' "$output"
        return 1
    fi
    ok "Ignored user-owned file kept the user's content"

    if ! find .backup -path "*/user-owned-local/$protected_file" -type f | grep -q .; then
        err "Local ignored user-owned file was not backed up during collision handling"
        return 1
    fi
    ok "Local ignored user-owned collision was backed up before update"

    assert_output_contains "$output" "User-owned files preserved"
}

# ---------- Scenario Descriptions ----------

declare -a SCENARIO_NAMES=(
    "No upstream changes at all"
    "System file changes only (AGENTS.md, CLAUDE.md, README.md)"
    "Script changes only (scripts/*.sh)"
    "Existing skill updated upstream (no local mods)"
    "New skill added to catalog upstream"
    "Mixed changes — system + skills + scripts"
    "User modified skill, NO upstream change to that skill"
    "User modified skill, upstream ALSO changed same skill"
    "User modified skill, upstream changed DIFFERENT file in same skill"
    "User created a brand new skill (not in catalog)"
    "User has multiple modified skills + custom skill"
    "New skills available that user hasn't installed"
    "Brand new skill upstream + previously removed skills"
    "User selects skills to install (enter numbers)"
    "User selects 'all' in skill install menu"
    "User presses Enter (installs nothing)"
    "No new or available skills"
    "Clean update with changes — verify summary"
    "Clean update with no changes anywhere"
    "Git pull fails (simulated)"
    "User has uncommitted changes in non-skill files"
    "installed.json doesn't exist"
    "Skill folder exists but not in installed.json"
    "Run update twice in a row"
    "First-time update (fresh clone)"
    "User accepts upstream change (y)"
    "User keeps their version (k)"
    "User accepts all remaining (a)"
    "User says no (n) to a change"
)

declare -a SCENARIO_CATEGORIES=(
    "Step 1" "Step 1" "Step 1" "Step 1" "Step 1" "Step 1"
    "Step 2" "Step 2" "Step 2" "Step 2" "Step 2"
    "Step 3" "Step 3" "Step 3" "Step 3" "Step 3" "Step 3"
    "Step 4" "Step 4"
    "Edge" "Edge" "Edge" "Edge" "Edge" "Edge"
    "Review" "Review" "Review" "Review"
)

# =========================================================
# SCENARIO SETUP FUNCTIONS
# Each function sets up the repos for one test scenario.
# After setup, the user runs update.sh manually in demo-repo.
# =========================================================

setup_scenario_1() {
    # No upstream changes — demo is already up to date
    reset_demo
    ok "Demo repo is up to date with origin. No changes anywhere."
}

setup_scenario_2() {
    # System file changes only
    reset_main
    reset_demo
    cd "$MAIN_WORK"
    echo -e "\n<!-- Updated $(date) -->" >> AGENTS.md
    echo -e "\n<!-- Updated $(date) -->" >> CLAUDE.md
    echo -e "\n<!-- Updated $(date) -->" >> README.md
    push_from_main "Update system files (AGENTS.md, CLAUDE.md, README.md)"
    ok "Pushed system file changes (AGENTS.md, CLAUDE.md, README.md) to main."
}

setup_scenario_3() {
    # Script changes only
    reset_main
    reset_demo
    cd "$MAIN_WORK"
    echo -e "\n# Script update $(date)" >> scripts/check-updates.sh
    push_from_main "Update check-updates.sh script"
    ok "Pushed script change (scripts/check-updates.sh) to main."
}

setup_scenario_4() {
    # Existing skill updated upstream, no local mods
    reset_main
    reset_demo
    cd "$MAIN_WORK"
    if [[ -f .claude/skills/tool-humanizer/SKILL.md ]]; then
        echo -e "\n<!-- Upstream improvement $(date) -->" >> .claude/skills/tool-humanizer/SKILL.md
        push_from_main "Improve tool-humanizer skill"
        ok "Pushed upstream change to tool-humanizer/SKILL.md."
    else
        err "tool-humanizer/SKILL.md not found in main worktree."
    fi
}

setup_scenario_5() {
    # New skill added to catalog upstream
    reset_main
    reset_demo
    cd "$MAIN_WORK"

    # Create a new skill folder
    mkdir -p .claude/skills/mkt-email-sequence
    cat > .claude/skills/mkt-email-sequence/SKILL.md << 'SKILL'
---
name: mkt-email-sequence
description: Generate email sequences for launches, onboarding, and nurture campaigns
trigger: email sequence, drip campaign, nurture emails, onboarding emails, email series
---

# Email Sequence Generator

## Methodology

### Step 1: Define sequence goal
### Step 2: Map the journey
### Step 3: Write each email
### Step 4: Humanize and review
SKILL

    # Add to catalog.json
    "${PYTHON_CMD[@]}" -c "
import json
with open('.claude/skills/_catalog/catalog.json') as f:
    data = json.load(f)
data['skills']['mkt-email-sequence'] = {
    'category': 'execution',
    'description': 'Email sequences for launches, onboarding, nurture',
    'requires_services': [],
    'dependencies': ['tool-humanizer'],
    'mcp_servers': []
}
with open('.claude/skills/_catalog/catalog.json', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
"
    push_from_main "Add mkt-email-sequence skill to catalog"
    ok "Pushed new skill (mkt-email-sequence) + catalog entry to main."
}

setup_scenario_6() {
    # Mixed changes: system + skills + scripts
    reset_main
    reset_demo
    cd "$MAIN_WORK"
    echo -e "\n<!-- Mixed update $(date) -->" >> AGENTS.md
    echo -e "\n<!-- Mixed update $(date) -->" >> CLAUDE.md
    echo -e "\n# Mixed script update" >> scripts/setup.sh
    if [[ -f .claude/skills/mkt-brand-voice/SKILL.md ]]; then
        echo -e "\n<!-- Upstream tweak -->" >> .claude/skills/mkt-brand-voice/SKILL.md
    fi
    if [[ -f .claude/skills/tool-humanizer/SKILL.md ]]; then
        echo -e "\n<!-- Another upstream tweak -->" >> .claude/skills/tool-humanizer/SKILL.md
    fi
    push_from_main "Mixed update: system + scripts + skills"
    ok "Pushed mixed changes (AGENTS.md, CLAUDE.md, scripts/setup.sh, 2 skills) to main."
}

setup_scenario_7() {
    # User modified a skill, no upstream change to it
    reset_main
    reset_demo
    cd "$DEMO_REPO"
    if [[ -d .claude/skills/tool-humanizer/references ]]; then
        echo -e "\n<!-- User's custom pattern -->" >> .claude/skills/tool-humanizer/references/pattern-library.md 2>/dev/null || \
        echo "<!-- User's custom pattern -->" > .claude/skills/tool-humanizer/references/user-note.md
    else
        echo -e "\n<!-- User mod -->" >> .claude/skills/tool-humanizer/SKILL.md
    fi
    ok "Modified tool-humanizer locally. No upstream changes pushed."
    warn "When you run update.sh, Step 2 should report the local mod with no conflict."
}

setup_scenario_8() {
    # User modified a skill, upstream ALSO changed the SAME file
    reset_main
    reset_demo

    # Push upstream change first
    cd "$MAIN_WORK"
    if [[ -f .claude/skills/tool-humanizer/SKILL.md ]]; then
        sed -i '' 's/^# /# [UPSTREAM] /' .claude/skills/tool-humanizer/SKILL.md 2>/dev/null || \
        echo -e "\n<!-- Upstream change -->" >> .claude/skills/tool-humanizer/SKILL.md
        push_from_main "Upstream: update tool-humanizer SKILL.md"
    fi

    # Make local modification in demo
    cd "$DEMO_REPO"
    echo -e "\n<!-- MY LOCAL CUSTOMIZATION -->" >> .claude/skills/tool-humanizer/SKILL.md
    ok "Upstream changed tool-humanizer/SKILL.md AND user has local changes to same file."
    warn "Step 2 should show per-file diff and prompt y/n/a/k."
}

setup_scenario_9() {
    # User modified SKILL.md, upstream changed a different file in same skill
    reset_main
    reset_demo

    # Push upstream change to references file
    cd "$MAIN_WORK"
    REFS_DIR=".claude/skills/tool-humanizer/references"
    if [[ -d "$REFS_DIR" ]]; then
        # Find any file in references to modify
        REF_FILE=$(ls "$REFS_DIR"/*.md 2>/dev/null | head -1 || true)
        if [[ -n "$REF_FILE" ]]; then
            echo -e "\n<!-- Upstream reference update -->" >> "$REF_FILE"
            push_from_main "Upstream: update tool-humanizer reference file"
        else
            echo "<!-- New upstream ref -->" > "$REFS_DIR/upstream-addition.md"
            push_from_main "Upstream: add new reference to tool-humanizer"
        fi
    fi

    # User modifies SKILL.md locally
    cd "$DEMO_REPO"
    echo -e "\n<!-- User's SKILL.md tweak -->" >> .claude/skills/tool-humanizer/SKILL.md
    ok "Upstream changed a reference file, user changed SKILL.md in same skill."
    warn "Reference file should update cleanly. User's SKILL.md should be preserved."
}

setup_scenario_10() {
    # User created a brand new custom skill
    reset_demo
    cd "$DEMO_REPO"
    mkdir -p .claude/skills/mkt-my-custom-skill
    cat > .claude/skills/mkt-my-custom-skill/SKILL.md << 'SKILL'
---
name: mkt-my-custom-skill
description: My custom skill for specialized tasks
trigger: custom task, my special thing
---

# My Custom Skill

This is a user-created skill not in the catalog.
SKILL
    ok "Created custom skill: mkt-my-custom-skill (not tracked by git)."
    warn "Step 2 should detect this as a user-created skill and leave it untouched."
}

setup_scenario_11() {
    # Multiple modified skills + a custom skill
    reset_main
    reset_demo

    # Push upstream changes to trigger conflict review
    cd "$MAIN_WORK"
    if [[ -f .claude/skills/tool-humanizer/SKILL.md ]]; then
        echo -e "\n<!-- Upstream humanizer change -->" >> .claude/skills/tool-humanizer/SKILL.md
    fi
    if [[ -f .claude/skills/mkt-brand-voice/SKILL.md ]]; then
        echo -e "\n<!-- Upstream brand-voice change -->" >> .claude/skills/mkt-brand-voice/SKILL.md
    fi
    push_from_main "Upstream: update humanizer + brand-voice"

    # User modifications in demo
    cd "$DEMO_REPO"
    echo -e "\n<!-- User mod to humanizer -->" >> .claude/skills/tool-humanizer/SKILL.md
    echo -e "\n<!-- User mod to brand-voice -->" >> .claude/skills/mkt-brand-voice/SKILL.md

    # Custom skill
    mkdir -p .claude/skills/str-my-research
    cat > .claude/skills/str-my-research/SKILL.md << 'SKILL'
---
name: str-my-research
description: Custom research methodology
trigger: research my way
---
# My Research Skill
SKILL

    ok "Modified 2 installed skills + created 1 custom skill."
    warn "Step 2 should report all three separately."
}

setup_scenario_12() {
    # Skills available that user hasn't installed (previously removed)
    reset_demo
    ok "Demo has 7 removed skills in installed.json."
    warn "Step 3 should show available-but-not-installed skills."
}

setup_scenario_13() {
    # Brand new skill upstream + previously removed skills
    setup_scenario_5  # This adds mkt-email-sequence
    ok "New skill upstream + demo still has removed skills from install."
    warn "Step 3 should show BOTH new skill and available skills."
}

setup_scenario_14() {
    # Same as 12/13 but user will enter numbers
    setup_scenario_12
    echo ""
    warn "When Step 3 shows the menu, enter skill numbers (e.g. '1 3') to install."
    warn "Verify: selected skills restored, installed.json updated."
}

setup_scenario_15() {
    # Same as 12 but user will type "all"
    setup_scenario_12
    echo ""
    warn "When Step 3 shows the menu, type 'all'."
    warn "Verify: all available skills installed."
}

setup_scenario_16() {
    # Same as 12 but user will press Enter
    setup_scenario_12
    echo ""
    warn "When Step 3 shows the menu, just press Enter."
    warn "Verify: no skills installed, moves to summary."
}

setup_scenario_17() {
    # No new or available skills — user has everything
    reset_main
    reset_demo

    # Install ALL skills so nothing is "available"
    cd "$DEMO_REPO"
    "${PYTHON_CMD[@]}" -c "
import json
with open('.claude/skills/_catalog/installed.json') as f:
    data = json.load(f)
with open('.claude/skills/_catalog/catalog.json') as f:
    cat = json.load(f)
all_skills = list(cat.get('core_skills', [])) + list(cat.get('skills', {}).keys())
data['installed_skills'] = sorted(set(all_skills))
data['removed_skills'] = []
with open('.claude/skills/_catalog/installed.json', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
"
    # Restore all skill folders from git
    git checkout HEAD -- .claude/skills/ 2>/dev/null || true

    ok "All skills installed, none removed. No upstream changes."
    warn "Step 3 should say 'no new skills' and show no available skills."
}

setup_scenario_18() {
    # Clean update with changes — for verifying summary
    setup_scenario_6  # Mixed changes
    warn "Focus on Step 4 summary output. Verify all categories reported."
}

setup_scenario_19() {
    # Clean update with absolutely no changes
    reset_demo
    ok "Everything up to date. No local mods. No new skills."
    warn "All 4 steps should show explicit 'no changes' messages."
}

setup_scenario_20() {
    # Git pull fails
    reset_demo
    cd "$DEMO_REPO"

    # Point origin to a nonexistent URL to simulate failure
    git remote set-url origin /tmp/nonexistent-repo.git
    ok "Set demo origin to nonexistent path to simulate pull failure."
    warn "Update should show error, restore any backups, exit cleanly."
    echo ""
    warn "After testing, restore origin with:"
    info "  cd $DEMO_REPO && git remote set-url origin $MAIN_REPO"
}

setup_scenario_21() {
    # User has uncommitted changes in non-skill files (protected paths)
    reset_main
    reset_demo

    # Push something upstream so there's a pull to do
    cd "$MAIN_WORK"
    echo -e "\n# Upstream script change" >> scripts/check-updates.sh
    push_from_main "Upstream: script update"

    # User edits a protected file
    cd "$DEMO_REPO"
    echo -e "\n<!-- User's AGENTS.md customization -->" >> AGENTS.md
    ok "User modified AGENTS.md locally. Upstream has script changes."
    warn "AGENTS.md should be treated as a protected system-file customization."
}

setup_scenario_22() {
    # installed.json doesn't exist
    reset_demo
    cd "$DEMO_REPO"
    rm -f .claude/skills/_catalog/installed.json
    ok "Deleted installed.json from demo repo."
    warn "Script should handle gracefully — warn and continue."
}

setup_scenario_23() {
    # Skill folder on disk but not in installed.json
    reset_demo
    cd "$DEMO_REPO"

    # Manually restore a removed skill's folder without updating installed.json
    git checkout HEAD -- .claude/skills/ops-cron/ 2>/dev/null || true

    if [[ -d .claude/skills/ops-cron ]]; then
        ok "Restored ops-cron folder on disk, but installed.json still lists it as 'removed'."
        warn "Observe how the script handles this mismatch."
    else
        err "Could not restore ops-cron from git."
    fi
}

setup_scenario_24() {
    # Run update twice in a row
    reset_demo
    ok "Demo repo is clean and up to date."
    warn "Run 'bash scripts/update.sh' TWICE in a row."
    warn "Second run should show 'Already up to date' with no errors."
}

setup_scenario_25() {
    # First-time update (simulate fresh clone + install)
    rm -rf "$DEMO_REPO"
    git clone "$MAIN_REPO" "$DEMO_REPO" --quiet 2>/dev/null
    cd "$DEMO_REPO"

    # Simulate install.sh output
    mkdir -p .claude/skills/_catalog
    cat > .claude/skills/_catalog/installed.json << 'IJSON'
{
  "installed_at": "2026-03-16",
  "version": "1.0.0",
  "installed_skills": [
    "meta-skill-creator",
    "meta-wrap-up",
    "mkt-brand-voice",
    "mkt-icp",
    "mkt-positioning",
    "tool-humanizer"
  ],
  "removed_skills": [
    "mkt-content-repurposing",
    "mkt-copywriting",
    "mkt-ugc-scripts",
    "ops-cron",
    "str-trending-research",
    "tool-firecrawl-scraper",
    "tool-youtube",
    "viz-excalidraw-diagram",
    "viz-ugc-heygen"
  ]
}
IJSON

    # Remove skills the user "didn't select"
    for skill in mkt-content-repurposing mkt-copywriting mkt-ugc-scripts ops-cron \
                 str-trending-research tool-firecrawl-scraper tool-youtube \
                 viz-excalidraw-diagram viz-ugc-heygen; do
        rm -rf ".claude/skills/$skill" 2>/dev/null || true
    done

    ok "Simulated fresh clone + install (minimal skill selection)."
    warn "Run update.sh — should show clean 'already up to date' flow."
}

setup_scenario_26() {
    # Interactive review: user accepts upstream (y)
    setup_scenario_8
    echo ""
    warn "When prompted for tool-humanizer/SKILL.md, enter 'y'."
    warn "Verify: upstream version replaces local, backup preserved in .backup/"
}

setup_scenario_27() {
    # Interactive review: user keeps their version (k)
    setup_scenario_8
    echo ""
    warn "When prompted, enter 'k'."
    warn "Verify: local version preserved, upstream change skipped."
}

setup_scenario_28() {
    # Interactive review: user accepts all remaining (a)
    setup_scenario_11  # Multiple conflicts
    echo ""
    warn "When prompted for the FIRST file, enter 'a'."
    warn "Verify: all remaining files accept upstream without further prompts."
}

setup_scenario_29() {
    # Interactive review: user says no (n)
    setup_scenario_8
    echo ""
    warn "When prompted, enter 'n'."
    warn "Verify: same as 'k' — local version kept."
}

# =========================================================
# RUNNER
# =========================================================

list_scenarios() {
    echo ""
    printf "${CYAN}${BOLD}  Agentic OS — Update Script Test Scenarios${NC}\n"
    echo ""
    CURRENT_CAT=""
    for i in "${!SCENARIO_NAMES[@]}"; do
        num=$((i + 1))
        cat="${SCENARIO_CATEGORIES[$i]}"
        if [[ "$cat" != "$CURRENT_CAT" ]]; then
            echo ""
            printf "  ${BOLD}${cat}${NC}\n"
            CURRENT_CAT="$cat"
        fi
        printf "    ${BOLD}[%2d]${NC} %s\n" "$num" "${SCENARIO_NAMES[$i]}"
    done
    echo ""
}

run_scenario() {
    local num="$1"
    local idx=$((num - 1))

    if [[ $idx -lt 0 ]] || [[ $idx -ge ${#SCENARIO_NAMES[@]} ]]; then
        err "Invalid scenario number: $num (valid: 1-${#SCENARIO_NAMES[@]})"
        return 1
    fi

    header "Scenario $num: ${SCENARIO_NAMES[$idx]}"
    info "Category: ${SCENARIO_CATEGORIES[$idx]}"
    echo ""

    # Ensure test env exists
    if [[ ! -d "$MAIN_REPO" ]] || [[ ! -d "$DEMO_REPO" ]]; then
        create_test_env
    fi

    # Run the setup function
    "setup_scenario_$num"

    echo ""
    printf "  ${BOLD}────────────────────────────────────────────${NC}\n"
    echo ""
    info "Setup complete. Now run the update:"
    echo ""
    printf "    ${BOLD}cd $DEMO_REPO && bash scripts/update.sh${NC}\n"
    echo ""
    info "After testing, inspect the results:"
    echo ""
    printf "    ${DIM}cat .claude/skills/_catalog/installed.json${NC}\n"
    printf "    ${DIM}ls .claude/skills/${NC}\n"
    printf "    ${DIM}ls .backup/ 2>/dev/null${NC}\n"
    echo ""

    # Offer to run it directly
    printf "  ${BOLD}Run update.sh now?${NC} [y/n] "
    read -r run_now < /dev/tty
    if [[ "$run_now" =~ ^[yY]$ ]]; then
        echo ""
        printf "  ${BOLD}──── UPDATE OUTPUT BELOW ────${NC}\n"
        echo ""
        cd "$DEMO_REPO"
        bash scripts/update.sh || true
        echo ""
        printf "  ${BOLD}──── END UPDATE OUTPUT ────${NC}\n"
        echo ""

        # Post-run checks
        printf "  ${BOLD}Post-run verification:${NC}\n"
        echo ""
        if [[ -f .claude/skills/_catalog/installed.json ]]; then
            info "installed.json exists ✓"
            INST_COUNT=$("${PYTHON_CMD[@]}" -c "import json; d=json.load(open('.claude/skills/_catalog/installed.json')); print(len(d.get('installed_skills',[])))" 2>/dev/null || echo "?")
            REM_COUNT=$("${PYTHON_CMD[@]}" -c "import json; d=json.load(open('.claude/skills/_catalog/installed.json')); print(len(d.get('removed_skills',[])))" 2>/dev/null || echo "?")
            info "  Installed: $INST_COUNT skills, Removed: $REM_COUNT skills"
        else
            warn "installed.json missing"
        fi

        SKILL_DIRS=$(ls -d .claude/skills/*/ 2>/dev/null | grep -v _catalog | wc -l | tr -d ' ')
        info "Skill folders on disk: $SKILL_DIRS"

        if [[ -d .backup ]]; then
            BACKUP_COUNT=$(find .backup -type f 2>/dev/null | wc -l | tr -d ' ')
            info "Backup files: $BACKUP_COUNT"
        else
            info "No .backup directory"
        fi
        echo ""
    fi
}

interactive_menu() {
    # Ensure test env exists
    if [[ ! -d "$MAIN_REPO" ]] || [[ ! -d "$DEMO_REPO" ]]; then
        create_test_env
    fi

    while true; do
        list_scenarios
        printf "  Enter scenario number (1-${#SCENARIO_NAMES[@]}), ${BOLD}all${NC} to run sequentially, or ${BOLD}q${NC} to quit: "
        read -r choice < /dev/tty

        case "$choice" in
            [qQ]) echo ""; ok "Done."; exit 0 ;;
            all)
                for i in $(seq 1 ${#SCENARIO_NAMES[@]}); do
                    run_scenario "$i"
                    echo ""
                    printf "  ${DIM}Press Enter for next scenario, or 'q' to stop...${NC} "
                    read -r cont < /dev/tty
                    [[ "$cont" =~ ^[qQ]$ ]] && break
                done
                ;;
            *)
                if [[ "$choice" =~ ^[0-9]+$ ]] && [[ "$choice" -ge 1 ]] && [[ "$choice" -le "${#SCENARIO_NAMES[@]}" ]]; then
                    run_scenario "$choice"
                else
                    err "Invalid choice: $choice"
                fi
                ;;
        esac
    done
}

# =========================================================
# MAIN
# =========================================================

case "${1:-}" in
    list)
        list_scenarios
        ;;
    clean)
        header "Cleaning test environment"
        rm -rf "$TEST_ROOT"
        ok "Removed $TEST_ROOT"
        echo ""
        ;;
    version-output)
        run_version_output_test
        ;;
    update-v2)
        run_update_v2_contract_test
        ;;
    update-v2-corrupt-catalog)
        run_update_v2_corrupt_catalog_test
        ;;
    update-v2-user-owned)
        run_update_v2_user_owned_preserved_test
        ;;
    update-v2-ignored-user-owned)
        run_update_v2_ignored_user_owned_collision_test
        ;;
    setup)
        create_test_env
        ;;
    [0-9]*)
        run_scenario "$1"
        ;;
    *)
        interactive_menu
        ;;
esac

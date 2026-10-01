#!/usr/bin/env bash
set -euo pipefail

# ==========================================================
# AI-OS — Update Script Test Harness
#
# Creates isolated git repos (main + demo) in /tmp and sets
# up 29 test scenarios to exercise every branch of update.sh.
#
# Usage:
#   bash scripts/test-update.sh              # interactive menu
#   bash scripts/test-update.sh <number>     # run specific scenario
#   bash scripts/test-update.sh list         # list all scenarios
#   bash scripts/test-update.sh clean        # remove test environment
#   bash scripts/test-update.sh catalog-missing-folder
#   bash scripts/test-update.sh catalog-memory-prompt
#   bash scripts/test-update.sh developer-update-source
#   bash scripts/test-update.sh command-centre-dependencies
#   bash scripts/test-update.sh update-processes
#   bash scripts/test-update.sh update-process-preflight
#   bash scripts/test-update.sh client-sync-contract
#   bash scripts/test-update.sh failed-stash-backup
#   bash scripts/test-update.sh stale-update-stashes
#   bash scripts/test-update.sh unexpected-backup-failure
#   bash scripts/test-update.sh killed-update-keeps-config
#   bash scripts/test-update.sh stale-backup-lib-bootstrap
#   bash scripts/test-update.sh foreign-stash-restore
#   bash scripts/test-update.sh missing-script-warns
#   bash scripts/test-update.sh recovery-helper-no-report
#   bash scripts/test-update.sh backup-fork-remote
#   bash scripts/test-update.sh old-0-2-update
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
TEST_ROOT="${AI_OS_TEST_ROOT:-/tmp/AI-OS-test}"
MAIN_REPO="$TEST_ROOT/main-repo"          # bare upstream repo
DEMO_REPO="$TEST_ROOT/demo-repo"          # user's clone
MAIN_WORK="$TEST_ROOT/main-worktree"      # working copy for pushing changes
export AI_OS_TEST_SKIP_COMMAND_CENTRE_DEPS=1
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

assert_output_not_contains() {
    local file="$1"
    local unexpected="$2"
    if grep -Fq "$unexpected" "$file"; then
        err "Unexpected output found: $unexpected"
        echo ""
        sed -n '1,220p' "$file"
        return 1
    else
        ok "Not found, as expected: $unexpected"
    fi
}

assert_file_contains() {
    local file="$1"
    local expected="$2"
    if grep -Fq "$expected" "$file"; then
        ok "File preserved: $file"
    else
        err "Expected file content not found in $file: $expected"
        [[ -f "$file" ]] && sed -n '1,80p' "$file"
        return 1
    fi
}

assert_path_absent() {
    local path="$1"
    local reason="$2"
    if [[ -e "$path" ]]; then
        err "Expected path to be absent ($reason): $path"
        return 1
    else
        ok "Path absent as expected: $path"
    fi
}

write_test_update_source_env() {
    local repo_root="$1"
    local slug="$2"
    local branch="${3:-main}"
    local env_file="$repo_root/.env"
    local temp_file="$repo_root/.env.update-source.tmp"

    if [[ -f "$env_file" ]]; then
        awk '
            !/^[[:space:]]*(export[[:space:]]+)?AI_OS_UPSTREAM_(SLUG|BRANCH)[[:space:]]*=/
        ' "$env_file" > "$temp_file"
    else
        : > "$temp_file"
    fi

    printf 'AI_OS_UPSTREAM_SLUG=%s\n' "$slug" >> "$temp_file"
    printf 'AI_OS_UPSTREAM_BRANCH=%s\n' "$branch" >> "$temp_file"
    mv "$temp_file" "$env_file"
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
    git checkout -B main --quiet 2>/dev/null

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
    "tool-humanizer",
    "viz-image-gen"
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
    "tool-humanizer",
    "viz-image-gen"
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
    local test_upstream_slug
    test_upstream_slug="$(basename "$TEST_ROOT")/main-repo"
    write_test_update_source_env "$DEMO_REPO" "$test_upstream_slug" main
    local update_env=(
        "AI_OS_SKIP_MEMORY_PROMPT=1"
    )
    if [[ -n "${1:-}" ]]; then
        echo "$1" | env "${update_env[@]}" bash scripts/update.sh
    else
        env "${update_env[@]}" bash scripts/update.sh
    fi
}

install_current_update_scripts() {
    cd "$MAIN_WORK"
    cp "$REAL_REPO/scripts/update.sh" scripts/update.sh
    cp "$REAL_REPO/scripts/update-recovery.sh" scripts/update-recovery.sh
    cp "$REAL_REPO/scripts/lib/"*.sh scripts/lib/
    cp "$REAL_REPO/scripts/lib/"*.ps1 scripts/lib/
    cp "$REAL_REPO/scripts/lib/synthesize.py" scripts/lib/synthesize.py
    git add scripts/update.sh scripts/update-recovery.sh scripts/lib
    git commit -m "Use current update scripts" --allow-empty --quiet
    git push origin main --quiet

    cd "$DEMO_REPO"
    git pull origin main --quiet
}

install_all_skills_in_demo() {
    cd "$DEMO_REPO"
    "${PYTHON_CMD[@]}" -c "
import json
from pathlib import Path

installed_path = Path('.claude/skills/_catalog/installed.json')
catalog_path = Path('.claude/skills/_catalog/catalog.json')

installed = json.loads(installed_path.read_text())
catalog = json.loads(catalog_path.read_text())
all_skills = set(catalog.get('core_skills', [])) | set(catalog.get('skills', {}).keys())
installed['installed_skills'] = sorted(all_skills)
installed['removed_skills'] = []
installed_path.write_text(json.dumps(installed, indent=2) + '\n')
"
}

run_protected_paths_test() {
    local output_file="$TEST_ROOT/protected-paths.out"

    header "Protected user data paths test"
    create_test_env
    install_current_update_scripts

    install_all_skills_in_demo

    cd "$MAIN_WORK"
    echo "<!-- upstream protected paths trigger -->" >> README.md
    mkdir -p \
        .claude \
        context/memory \
        brand_context \
        projects/protected-output \
        cron/jobs \
        .planning \
        clients/acme/.claude/skills/_catalog \
        clients/acme/context \
        clients/acme/brand_context \
        clients/acme/projects/protected-output \
        clients/acme/cron/jobs \
        clients/acme/.planning
    echo "upstream env should not win" > .env
    echo "upstream mcp should not win" > .mcp.json
    echo "upstream settings local should not win" > .claude/settings.local.json
    echo "upstream user should not win" > context/USER.md
    echo "upstream soul should not win" > context/SOUL.md
    echo "upstream learning should not win" > context/learnings.md
    echo "upstream memory should not win" > context/memory/upstream.md
    echo "upstream context should not win" > context/local-note.md
    echo "upstream brand should not win" > brand_context/local-brand.md
    echo "upstream project should not win" > projects/protected-output/local-output.md
    echo "upstream cron should not win" > cron/jobs/local-job.md
    echo "upstream planning should not win" > .planning/STATE.md
    echo "upstream client env should not win" > clients/acme/.env
    echo "upstream client mcp should not win" > clients/acme/.mcp.json
    echo "upstream client settings local should not win" > clients/acme/.claude/settings.local.json
    echo "upstream client AGENTS should not win" > clients/acme/AGENTS.md
    echo "upstream client installed should not win" > clients/acme/.claude/skills/_catalog/installed.json
    echo "upstream client context should not win" > clients/acme/context/local-note.md
    echo "upstream client brand should not win" > clients/acme/brand_context/local-brand.md
    echo "upstream client project should not win" > clients/acme/projects/protected-output/local-output.md
    echo "upstream client cron should not win" > clients/acme/cron/jobs/local-job.md
    echo "upstream client planning should not win" > clients/acme/.planning/STATE.md
    git add -f .env .mcp.json .claude/settings.local.json .planning clients/acme/.env clients/acme/.mcp.json clients/acme/.claude/settings.local.json clients/acme/.claude/skills/_catalog/installed.json clients/acme/.planning
    push_from_main "Trigger update for protected paths test"

    cd "$DEMO_REPO"
    mkdir -p \
        .claude \
        context/memory \
        context \
        brand_context \
        projects/protected-output \
        cron/jobs \
        .planning \
        clients/acme/.claude/skills/_catalog \
        clients/acme/context \
        clients/acme/brand_context \
        clients/acme/projects/protected-output \
        clients/acme/cron/jobs \
        clients/acme/.planning

    echo "root env local note" > .env
    echo "root mcp local note" > .mcp.json
    echo "root settings local note" > .claude/settings.local.json
    echo "root user local note" > context/USER.md
    echo "root soul local note" > context/SOUL.md
    echo "root learnings local note" > context/learnings.md
    echo "root memory local edit" >> context/MEMORY.md
    echo "root dated memory local note" > context/memory/upstream.md
    echo "root context local note" > context/local-note.md
    echo "root brand local note" > brand_context/local-brand.md
    echo "root project local note" > projects/protected-output/local-output.md
    echo "root cron local note" > cron/jobs/local-job.md
    echo "root planning local note" > .planning/STATE.md
    echo "client env local note" > clients/acme/.env
    echo "client mcp local note" > clients/acme/.mcp.json
    echo "client settings local note" > clients/acme/.claude/settings.local.json
    echo "client AGENTS local note" > clients/acme/AGENTS.md
    echo "client installed local note" > clients/acme/.claude/skills/_catalog/installed.json
    echo "client context local note" > clients/acme/context/local-note.md
    echo "client brand local note" > clients/acme/brand_context/local-brand.md
    echo "client project local note" > clients/acme/projects/protected-output/local-output.md
    echo "client cron local note" > clients/acme/cron/jobs/local-job.md
    echo "client planning local note" > clients/acme/.planning/STATE.md

    run_update > "$output_file" 2>&1

    assert_file_contains "$DEMO_REPO/.env" "root env local note"
    assert_file_contains "$DEMO_REPO/.mcp.json" "root mcp local note"
    assert_file_contains "$DEMO_REPO/.claude/settings.local.json" "root settings local note"
    assert_file_contains "$DEMO_REPO/context/USER.md" "root user local note"
    assert_file_contains "$DEMO_REPO/context/SOUL.md" "root soul local note"
    assert_file_contains "$DEMO_REPO/context/learnings.md" "root learnings local note"
    assert_file_contains "$DEMO_REPO/context/MEMORY.md" "root memory local edit"
    assert_file_contains "$DEMO_REPO/context/memory/upstream.md" "root dated memory local note"
    assert_file_contains "$DEMO_REPO/context/local-note.md" "root context local note"
    assert_file_contains "$DEMO_REPO/brand_context/local-brand.md" "root brand local note"
    assert_file_contains "$DEMO_REPO/projects/protected-output/local-output.md" "root project local note"
    assert_file_contains "$DEMO_REPO/cron/jobs/local-job.md" "root cron local note"
    assert_file_contains "$DEMO_REPO/.planning/STATE.md" "root planning local note"
    assert_file_contains "$DEMO_REPO/clients/acme/.env" "client env local note"
    assert_file_contains "$DEMO_REPO/clients/acme/.mcp.json" "client mcp local note"
    assert_file_contains "$DEMO_REPO/clients/acme/.claude/settings.local.json" "client settings local note"
    assert_file_contains "$DEMO_REPO/clients/acme/AGENTS.md" "client AGENTS local note"
    # Deliberate exception among protected client paths: skills are inherited
    # from the root now, so the client _catalog copy is pruned as dead weight.
    # The root catalog is the only catalog.
    assert_path_absent "$DEMO_REPO/clients/acme/.claude/skills/_catalog" "client skill catalog is pruned; the root catalog is the only one"
    assert_file_contains "$DEMO_REPO/clients/acme/context/local-note.md" "client context local note"
    assert_file_contains "$DEMO_REPO/clients/acme/brand_context/local-brand.md" "client brand local note"
    assert_file_contains "$DEMO_REPO/clients/acme/projects/protected-output/local-output.md" "client project local note"
    assert_file_contains "$DEMO_REPO/clients/acme/cron/jobs/local-job.md" "client cron local note"
    assert_file_contains "$DEMO_REPO/clients/acme/.planning/STATE.md" "client planning local note"
    assert_output_contains "$output_file" "cron/jobs/"
    assert_output_contains "$output_file" ".planning/"

    ok "Protected user data paths test passed"
}

run_client_sync_contract_test() {
    local output_file="$TEST_ROOT/client-sync-contract.out"
    local skill_name="mkt-brand-voice"

    header "Client sync contract test"
    create_test_env
    install_current_update_scripts
    install_all_skills_in_demo

    cd "$DEMO_REPO"
    mkdir -p \
        "clients/acme/.claude/skills/${skill_name}" \
        clients/acme/.claude/skills/client-only-local \
        clients/acme/.claude/skills/_catalog \
        clients/acme/.claude \
        clients/acme/cron/jobs \
        clients/acme/cron/templates \
        clients/acme/scripts

    cp -R ".claude/skills/${skill_name}/." "clients/acme/.claude/skills/${skill_name}/"
    echo "client local skill override must survive" > "clients/acme/.claude/skills/${skill_name}/SKILL.local.md"
    echo "client-only skill must survive" > clients/acme/.claude/skills/client-only-local/SKILL.md
    echo '{"client":"installed state must survive"}' > clients/acme/.claude/skills/_catalog/installed.json
    echo "client local settings must survive" > clients/acme/.claude/settings.local.json
    echo '{"old":"client shared settings should update"}' > clients/acme/.claude/settings.json
    echo "client cron job must survive" > clients/acme/cron/jobs/local-job.md
    echo "old client template should update" > clients/acme/cron/templates/example.md

    cd "$MAIN_WORK"
    mkdir -p cron/templates .claude/hooks .claude/hooks_info
    echo "<!-- root skill sync marker -->" >> ".claude/skills/${skill_name}/SKILL.md"
    cat > .claude/settings.json <<'JSON'
{
  "clientSyncContract": "root shared settings marker"
}
JSON
    echo "# root script sync marker" >> scripts/check-updates.sh
    echo "root hook marker" > .claude/hooks/client-sync-contract.sh
    echo "root hook info marker" > .claude/hooks_info/client-sync-contract.md
    echo "root cron template marker" > cron/templates/example.md
    push_from_main "Update shared client system files"

    run_update > "$output_file" 2>&1

    # Shared skills are inherited from the root now. The stale client copy of a
    # root skill is pruned (its content matches a root version), the root copy
    # carries the upstream marker for every client to read, and the client
    # _catalog goes away with it: the root catalog is the only catalog.
    assert_path_absent "$DEMO_REPO/clients/acme/.claude/skills/${skill_name}/SKILL.md" "stale client copy of a root skill is pruned instead of synced"
    assert_file_contains "$DEMO_REPO/.claude/skills/${skill_name}/SKILL.md" "root skill sync marker"
    assert_file_contains "$DEMO_REPO/clients/acme/.claude/skills/${skill_name}/SKILL.local.md" "client local skill override must survive"
    assert_file_contains "$DEMO_REPO/clients/acme/.claude/skills/client-only-local/SKILL.md" "client-only skill must survive"
    assert_path_absent "$DEMO_REPO/clients/acme/.claude/skills/_catalog" "client skill catalog is pruned; the root catalog is the only one"
    assert_file_contains "$DEMO_REPO/clients/acme/.claude/settings.local.json" "client local settings must survive"
    assert_file_contains "$DEMO_REPO/clients/acme/.claude/settings.json" "root shared settings marker"
    assert_file_contains "$DEMO_REPO/clients/acme/scripts/check-updates.sh" "root script sync marker"
    assert_file_contains "$DEMO_REPO/clients/acme/.claude/hooks/client-sync-contract.sh" "root hook marker"
    assert_file_contains "$DEMO_REPO/clients/acme/.claude/hooks_info/client-sync-contract.md" "root hook info marker"
    assert_file_contains "$DEMO_REPO/clients/acme/cron/jobs/local-job.md" "client cron job must survive"
    assert_file_contains "$DEMO_REPO/clients/acme/cron/templates/example.md" "root cron template marker"
    assert_output_contains "$output_file" "Skills inherited from root"
    assert_output_contains "$output_file" "Cron templates synced"

    ok "Client sync contract test passed"
}

run_failed_stash_backup_test() {
    local output_file="$TEST_ROOT/failed-stash-backup.out"

    header "Failed stash restore backup test"
    create_test_env
    install_current_update_scripts
    install_all_skills_in_demo

    cd "$MAIN_WORK"
    mkdir -p brand_context
    echo "upstream tracked brand file should not win" > brand_context/voice-profile.md
    push_from_main "Add upstream tracked protected file"

    cd "$DEMO_REPO"
    mkdir -p brand_context
    echo "local brand file must survive failed stash apply" > brand_context/voice-profile.md

    run_update > "$output_file" 2>&1

    assert_file_contains "$DEMO_REPO/brand_context/voice-profile.md" "local brand file must survive failed stash apply"
    assert_output_contains "$output_file" "Restored protected local files from update backup."

    cd "$DEMO_REPO"
    if git diff --name-only --diff-filter=U | grep -q .; then
        err "Update left unresolved merge conflicts."
        git diff --name-only --diff-filter=U
        return 1
    fi
    if git stash list | grep -q "AI-OS-update"; then
        err "Update left the protected-file stash behind after successful backup restore."
        git stash list
        return 1
    fi

    ok "Failed stash restore backup test passed"
}

run_stale_update_stashes_test() {
    local output_file="$TEST_ROOT/stale-update-stashes.out"

    header "Stale update stash warning test"
    create_test_env
    install_current_update_scripts
    install_all_skills_in_demo

    cd "$DEMO_REPO"
    mkdir -p brand_context
    echo "stale stash content" > brand_context/stale.md
    git stash push --include-untracked -m "AI-OS-update-stale-test" -- brand_context/stale.md >/dev/null

    cd "$MAIN_WORK"
    echo "<!-- stale stash warning trigger -->" >> README.md
    push_from_main "Trigger stale stash warning"

    run_update > "$output_file" 2>&1

    assert_output_contains "$output_file" "Found 1 old AI-OS update stash"
    cd "$DEMO_REPO"
    if git stash list | grep -q "AI-OS-update-stale-test"; then
        ok "Stale update stash was reported and kept"
    else
        err "Stale update stash should not be dropped automatically"
        git stash list
        return 1
    fi

    ok "Stale update stash warning test passed"
}

run_unexpected_backup_failure_test() {
    local output_file="$TEST_ROOT/unexpected-backup-failure.out"
    local helper_output="$TEST_ROOT/unexpected-backup-helper.out"
    local report_path
    local status

    header "Unexpected backup failure recovery UX test"
    create_test_env
    install_current_update_scripts
    install_all_skills_in_demo

    cd "$DEMO_REPO"
    mkdir -p brand_context
    echo "local brand file must survive unexpected update failure" > brand_context/voice-profile.md

    set +e
    export AI_OS_TEST_FAIL_AFTER_BACKUP=1
    run_update > "$output_file" 2>&1
    status=$?
    unset AI_OS_TEST_FAIL_AFTER_BACKUP
    set -e

    if [[ $status -eq 0 ]]; then
        err "update.sh should fail when the test backup failure is injected."
        sed -n '1,220p' "$output_file"
        return 1
    fi

    assert_file_contains "$DEMO_REPO/brand_context/voice-profile.md" "local brand file must survive unexpected update failure"
    assert_output_contains "$output_file" "Your files are safe in:"
    assert_output_contains "$output_file" "Recovery report:"
    assert_output_contains "$output_file" "bash scripts/update-recovery.sh --latest"

    report_path=$(find "$DEMO_REPO/.backup" -maxdepth 1 -type f -name 'update-recovery-*.txt' -print 2>/dev/null | sort | tail -n 1)
    if [[ -z "$report_path" ]]; then
        err "Expected an update recovery report in .backup."
        find "$DEMO_REPO/.backup" -maxdepth 2 -type f -print 2>/dev/null || true
        return 1
    fi
    assert_file_contains "$report_path" "Your files are safe in:"
    assert_file_contains "$report_path" "Protected file stash backup:"

    cd "$DEMO_REPO"
    bash scripts/update-recovery.sh --latest > "$helper_output" 2>&1
    assert_output_contains "$helper_output" "Latest recovery report:"
    assert_output_contains "$helper_output" "Your files are safe in:"
    assert_output_contains "$helper_output" "Protected file stash backup:"

    ok "Unexpected backup failure recovery UX test passed"
}

assert_update_stashes_exclude_config() {
    local sha files

    while IFS= read -r sha; do
        [[ -z "$sha" ]] && continue
        files=$(
            {
                git diff --name-only "${sha}^1" "$sha" 2>/dev/null || true
                git ls-tree -r --name-only "${sha}^3" 2>/dev/null || true
            } | grep -E '(^|/)(\.env|\.mcp\.json)$' || true
        )
        if [[ -n "$files" ]]; then
            err "Update stash $sha holds user config that should never leave disk:"
            printf "%s\n" "$files"
            return 1
        fi
    done < <(git stash list --format='%H %gs' | awk '/AI-OS-update-/ { print $1 }')

    ok "No update stash holds .env or .mcp.json"
}

run_killed_update_keeps_config_test() {
    local output_file="$TEST_ROOT/killed-update.out"
    local rerun_file="$TEST_ROOT/killed-update-rerun.out"
    local stash_sha
    local status

    header "Killed update keeps user config on disk"
    create_test_env
    install_current_update_scripts
    install_all_skills_in_demo

    cd "$MAIN_WORK"
    echo "<!-- killed update trigger -->" >> README.md
    push_from_main "Trigger killed update"

    cd "$DEMO_REPO"
    mkdir -p clients/acme brand_context
    echo "ROOT_SECRET=keep-me" > .env
    echo '{"mcpServers":{"root":"keep-me"}}' > .mcp.json
    echo "CLIENT_SECRET=keep-me" > clients/acme/.env
    echo '{"mcpServers":{"client":"keep-me"}}' > clients/acme/.mcp.json
    echo "local brand file parked in the update stash" > brand_context/voice-profile.md

    set +e
    export AI_OS_TEST_KILL_AFTER_BACKUP=1
    run_update > "$output_file" 2>&1
    status=$?
    unset AI_OS_TEST_KILL_AFTER_BACKUP
    set -e

    if [[ $status -ne 137 ]]; then
        err "update.sh should die with SIGKILL (137), got $status."
        sed -n '1,220p' "$output_file"
        return 1
    fi

    assert_file_contains "$DEMO_REPO/.env" "ROOT_SECRET=keep-me"
    assert_file_contains "$DEMO_REPO/.mcp.json" '"root":"keep-me"'
    assert_file_contains "$DEMO_REPO/clients/acme/.env" "CLIENT_SECRET=keep-me"
    assert_file_contains "$DEMO_REPO/clients/acme/.mcp.json" '"client":"keep-me"'

    cd "$DEMO_REPO"
    assert_update_stashes_exclude_config

    # The killed run strands the brand file in the stash. The next run must
    # say exactly how to get it back.
    stash_sha=$(git stash list --format='%H %gs' | awk '/AI-OS-update-/ { print $1; exit }')
    if [[ -z "$stash_sha" ]]; then
        err "Expected the killed run to leave its update stash behind."
        git stash list
        return 1
    fi

    run_update > "$rerun_file" 2>&1
    assert_output_contains "$rerun_file" "git stash apply $stash_sha"

    ok "Killed update keeps user config test passed"
}

run_stale_backup_lib_bootstrap_test() {
    local output_file="$TEST_ROOT/stale-backup-lib.out"
    local status

    header "Latest update.sh swaps in the fixed backup lib on the first run"
    create_test_env
    install_current_update_scripts
    install_all_skills_in_demo

    cd "$MAIN_WORK"
    echo "<!-- stale backup lib trigger -->" >> README.md
    push_from_main "Trigger stale backup lib update"

    # local installer overwrites scripts/update.sh with the latest one but
    # leaves the older libs on disk. The bootstrap signature must pull the
    # fixed backup.sh before any stash happens.
    cd "$DEMO_REPO"
    sed '/^split_protected_stash_paths()/,/^}/d' scripts/lib/backup.sh > scripts/lib/backup.sh.stale
    mv scripts/lib/backup.sh.stale scripts/lib/backup.sh
    git commit --quiet -am "Simulate pre-AIOS-473 backup lib"
    echo "ROOT_SECRET=keep-me" > .env
    echo '{"mcpServers":{"root":"keep-me"}}' > .mcp.json

    set +e
    export AI_OS_TEST_KILL_AFTER_BACKUP=1
    run_update > "$output_file" 2>&1
    status=$?
    unset AI_OS_TEST_KILL_AFTER_BACKUP
    set -e

    if [[ $status -ne 137 ]]; then
        err "update.sh should die with SIGKILL (137), got $status."
        sed -n '1,220p' "$output_file"
        return 1
    fi

    assert_output_contains "$output_file" "Fetching update dependencies from"
    assert_output_not_contains "$output_file" "split_protected_stash_paths: command not found"
    assert_file_contains "$DEMO_REPO/.env" "ROOT_SECRET=keep-me"
    assert_file_contains "$DEMO_REPO/.mcp.json" '"root":"keep-me"'

    ok "Stale backup lib bootstrap test passed"
}

run_foreign_stash_restore_test() {
    local output_file="$TEST_ROOT/foreign-stash.out"

    header "Update restores its own stash when another stash lands on top"
    create_test_env
    install_current_update_scripts
    install_all_skills_in_demo

    cd "$MAIN_WORK"
    echo "<!-- foreign stash trigger -->" >> README.md
    push_from_main "Trigger foreign stash update"

    cd "$DEMO_REPO"
    mkdir -p brand_context
    echo "local brand file must survive a foreign stash" > brand_context/voice-profile.md

    export AI_OS_TEST_PUSH_FOREIGN_STASH=1
    run_update > "$output_file" 2>&1
    unset AI_OS_TEST_PUSH_FOREIGN_STASH

    assert_file_contains "$DEMO_REPO/brand_context/voice-profile.md" "local brand file must survive a foreign stash"

    cd "$DEMO_REPO"
    if git stash list | grep -q "AI-OS-update-"; then
        err "Update left its own stash behind after a foreign stash landed on top."
        git stash list
        return 1
    fi
    if ! git stash list | grep -q "foreign-stash-test"; then
        err "Update must never drop a stash it did not create."
        git stash list
        return 1
    fi

    ok "Foreign stash restore test passed"
}

run_missing_script_warns_test() {
    local output_file="$TEST_ROOT/missing-script.out"

    header "Update warns when a shipped script is missing locally"
    create_test_env
    install_current_update_scripts
    install_all_skills_in_demo

    cd "$MAIN_WORK"
    echo "<!-- missing script trigger -->" >> README.md
    push_from_main "Trigger missing script update"

    # Mirrors the field report: a manual merge resolution committed the deletion.
    cd "$DEMO_REPO"
    git rm --quiet scripts/lib/gsd-migration.sh
    git commit --quiet -m "Local merge dropped gsd-migration.sh"

    run_update > "$output_file" 2>&1

    assert_path_absent "$DEMO_REPO/scripts/lib/gsd-migration.sh" "update only warns, it never rewrites scripts on its own"
    assert_output_contains "$output_file" "scripts/lib/gsd-migration.sh"
    assert_output_contains "$output_file" "git checkout origin/main -- scripts/lib/gsd-migration.sh"

    ok "Missing script warning test passed"
}

run_recovery_helper_no_report_test() {
    local output_file="$TEST_ROOT/recovery-helper-no-report.out"

    header "Update recovery helper no-report test"
    create_test_env
    install_current_update_scripts

    cd "$DEMO_REPO"
    rm -rf .backup
    bash scripts/update-recovery.sh --latest > "$output_file" 2>&1

    assert_output_contains "$output_file" "No AI-OS update recovery report found"
    assert_output_contains "$output_file" "No AI-OS update stashes found."

    ok "Update recovery helper no-report test passed"
}

run_backup_fork_remote_test() {
    local output_file="$TEST_ROOT/backup-fork-remote.out"
    local backup_repo="$TEST_ROOT/backup-fork.git"
    local marker="canonical upstream marker"

    header "Backup fork origin with canonical upstream test"
    create_test_env
    install_current_update_scripts
    install_all_skills_in_demo

    git clone --bare "$DEMO_REPO" "$backup_repo" --quiet

    cd "$DEMO_REPO"
    git remote set-url origin "$backup_repo"
    git remote add upstream "$MAIN_REPO"

    cd "$MAIN_WORK"
    printf "\n<!-- %s -->\n" "$marker" >> README.md
    push_from_main "Canonical upstream update"

    run_update > "$output_file" 2>&1

    assert_output_contains "$output_file" "Step 1: Updates from upstream/main"
    assert_file_contains "$DEMO_REPO/README.md" "$marker"

    ok "Backup fork origin with canonical upstream test passed"
}

run_old_0_2_update_test() {
    local test_root="${TMPDIR:-/tmp}/AI-OS-old-0-2-update-test"
    local upstream="$test_root/upstream"
    local demo="$test_root/demo"
    local output_file="$test_root/update.out"
    local old_commit="65b38280c52b49212b840dfc7c14b309072ecd2d"
    local expected_version
    local required_files=(
        VERSION
        scripts/update.sh
        scripts/update-clients.sh
        scripts/add-skill.sh
        scripts/rollback.sh
        scripts/session-end.sh
        scripts/lib/backup.sh
        scripts/lib/catalog.sh
        scripts/lib/common.sh
        scripts/lib/gsd-migration.sh
        scripts/lib/merge.sh
        scripts/lib/pull.sh
        scripts/lib/python.sh
        scripts/lib/synthesize.py
        scripts/lib/update-processes.sh
        scripts/lib/update-processes.ps1
    )

    header "Old 0.2.x install update smoke test"
    rm -rf "$test_root"
    mkdir -p "$test_root"

    git cat-file -e "${old_commit}^{commit}" 2>/dev/null || {
        err "Old 0.2.x commit is not available locally: $old_commit"
        return 1
    }

    expected_version="$(head -n 1 "$REAL_REPO/VERSION" | tr -d '\r')"

    git clone "$REAL_REPO" "$upstream" --quiet
    cd "$upstream"
    git checkout -B main "$old_commit" --quiet

    git clone "$upstream" "$demo" --quiet

    cd "$upstream"
    for file in "${required_files[@]}"; do
        mkdir -p "$(dirname "$file")"
        cp "$REAL_REPO/$file" "$file"
    done
    git add "${required_files[@]}"
    git commit -m "Publish current update bundle" --quiet

    cd "$demo"
    write_test_update_source_env "$demo" AI-OS-old-0-2-update-test/upstream main
    env AI_OS_SKIP_MEMORY_PROMPT=1 \
        bash scripts/update.sh > "$output_file" 2>&1

    assert_output_contains "$output_file" "You are now on AI-OS"
    assert_file_contains "$demo/VERSION" "$expected_version"

    ok "Old 0.2.x install update smoke test passed"
}

run_branch_preserve_fallback_test() {
    local output_file="$TEST_ROOT/branch-preserve-fallback.out"
    local local_commit head_after upstream_after unmerged rescue_branches

    header "Branch preserve fallback test"
    create_test_env
    install_current_update_scripts

    cd "$DEMO_REPO"
    "${PYTHON_CMD[@]}" - <<'PY'
from pathlib import Path

path = Path("README.md")
text = path.read_text()
path.write_text(text.replace(
    "Turn Claude Code into your AI Operating System.",
    "Local harness README line."
))
PY
    git add README.md
    git commit -m "User local README change" --quiet
    local_commit="$(git rev-parse HEAD)"

    cd "$MAIN_WORK"
    "${PYTHON_CMD[@]}" - <<'PY'
from pathlib import Path

path = Path("README.md")
text = path.read_text()
path.write_text(text.replace(
    "Turn Claude Code into your AI Operating System.",
    "Upstream README update."
))
PY
    push_from_main "Upstream conflicting README update"

    cd "$DEMO_REPO"
    if run_update > "$output_file" 2>&1; then
        err "update.sh should stop when preserving a branch with unresolved conflicts"
        sed -n '1,220p' "$output_file"
        return 1
    fi

    head_after="$(git rev-parse HEAD)"
    upstream_after="$(git rev-parse origin/main)"

    if [[ "$head_after" == "$upstream_after" ]]; then
        err "HEAD should not be reset to upstream/main"
        sed -n '1,220p' "$output_file"
        return 1
    fi
    ok "HEAD was not reset to upstream/main"

    git merge-base --is-ancestor "$local_commit" HEAD || {
        err "local commit should still be reachable from HEAD"
        sed -n '1,220p' "$output_file"
        return 1
    }
    ok "local commit is still reachable from HEAD"

    unmerged="$(git diff --name-only --diff-filter=U)"
    if [[ -n "$unmerged" ]]; then
        err "update.sh should abort the failed merge before exiting"
        printf '%s\n' "$unmerged"
        sed -n '1,220p' "$output_file"
        return 1
    fi
    ok "failed merge was aborted cleanly"

    rescue_branches="$(git branch --list 'AI-OS-rescue/main-*')"
    if [[ -z "$rescue_branches" ]]; then
        err "expected a recovery branch for the pre-update commit"
        sed -n '1,220p' "$output_file"
        return 1
    fi
    ok "recovery branch was created"

    assert_output_contains "$output_file" "this branch has local commit(s)"
    assert_output_contains "$output_file" "kept at the pre-update commit"
    assert_output_contains "$output_file" "Your local commits were not reset to upstream"

    ok "Branch preserve fallback test passed"
}

run_version_output_test() {
    local test_root="${TMPDIR:-/tmp}/AI-OS-version-output-test"
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
    git add VERSION scripts/update.sh scripts/lib/common.sh scripts/lib/pull.sh scripts/lib/catalog.sh
    git commit -m "Use current update scripts" --allow-empty --quiet

    git clone "$upstream" "$demo" --quiet
    cd "$demo"
    git checkout main --quiet 2>/dev/null || true
    write_test_update_source_env "$demo" AI-OS-version-output-test/upstream main

    cd "$upstream"
    printf "9.9.9\n" > VERSION
    git add VERSION
    git commit -m "Bump version for update output test" --quiet

    cd "$demo"
    env AI_OS_SKIP_MEMORY_PROMPT=1 \
        bash scripts/update.sh > "$first_output" 2>&1

    assert_output_contains "$first_output" "Current version: v$(cat "$REAL_REPO/VERSION")"
    assert_output_contains "$first_output" "Version: v$(cat "$REAL_REPO/VERSION") -> v9.9.9"
    assert_output_contains "$first_output" "You are now on AI-OS v9.9.9."

    env AI_OS_SKIP_MEMORY_PROMPT=1 \
        bash scripts/update.sh > "$second_output" 2>&1

    assert_output_contains "$second_output" "Current version: v9.9.9"
    assert_output_contains "$second_output" "Version: v9.9.9 already installed"
    assert_output_contains "$second_output" "You already have AI-OS v9.9.9."

    ok "Version output test passed"
}

run_catalog_missing_folder_test() {
    local test_root="${TMPDIR:-/tmp}/AI-OS-catalog-missing-folder-test"
    local upstream="$test_root/upstream"
    local demo="$test_root/demo"
    local output_file="$test_root/update.out"
    local add_skill_output="$test_root/add-skill.out"
    local valid_skill="tool-valid-catalog-skill"
    local invalid_skill="tool-missing-folder"

    header "Catalog missing folder test"
    rm -rf "$test_root"
    mkdir -p "$test_root"

    git clone "$REAL_REPO" "$upstream" --quiet
    cd "$upstream"
    git checkout -b main --quiet 2>/dev/null || git checkout main --quiet 2>/dev/null || true

    for file in \
        scripts/update.sh \
        scripts/add-skill.sh \
        scripts/rollback.sh \
        scripts/session-end.sh \
        scripts/lib/backup.sh \
        scripts/lib/catalog.sh \
        scripts/lib/common.sh \
        scripts/lib/gsd-migration.sh \
        scripts/lib/merge.sh \
        scripts/lib/pull.sh \
        scripts/lib/python.sh \
        scripts/lib/synthesize.py; do
        cp "$REAL_REPO/$file" "$file"
    done
    git add scripts/update.sh scripts/add-skill.sh scripts/rollback.sh scripts/session-end.sh scripts/lib
    git commit -m "Use current update scripts" --allow-empty --quiet

    git clone "$upstream" "$demo" --quiet
    cd "$demo"
    git checkout main --quiet 2>/dev/null || true
    mkdir -p .claude/skills/_catalog
    "${PYTHON_CMD[@]}" - <<'PY'
import json

catalog_path = ".claude/skills/_catalog/catalog.json"
installed_path = ".claude/skills/_catalog/installed.json"

with open(catalog_path) as f:
    catalog = json.load(f)

installed = sorted(set(catalog.get("core_skills", [])) | set(catalog.get("skills", {}).keys()))
with open(installed_path, "w") as f:
    json.dump({
        "installed_at": "2026-06-09",
        "version": catalog.get("version", "1.0.0"),
        "installed_skills": installed,
        "removed_skills": [],
        "selection_pending": False,
    }, f, indent=2)
    f.write("\n")
PY

    cd "$upstream"
    mkdir -p ".claude/skills/$valid_skill"
    cat > ".claude/skills/$valid_skill/SKILL.md" <<'SKILL'
---
name: tool-valid-catalog-skill
description: Test skill with a tracked folder
---

# Valid Catalog Skill
SKILL
    "${PYTHON_CMD[@]}" - <<PY
import json

catalog_path = ".claude/skills/_catalog/catalog.json"
with open(catalog_path) as f:
    catalog = json.load(f)

catalog.setdefault("skills", {})
catalog["skills"]["$valid_skill"] = {
    "category": "utility",
    "version": "1.0.0",
    "description": "Test skill with a tracked folder",
    "requires_services": [],
    "dependencies": [],
    "mcp_servers": [],
}
catalog["skills"]["$invalid_skill"] = {
    "category": "utility",
    "version": "1.0.0",
    "description": "Test skill without a tracked folder",
    "requires_services": [],
    "dependencies": [],
    "mcp_servers": [],
}

with open(catalog_path, "w") as f:
    json.dump(catalog, f, indent=2)
    f.write("\n")
PY
    git add ".claude/skills/$valid_skill" .claude/skills/_catalog/catalog.json
    git commit -m "Add valid skill and broken catalog entry" --quiet

    cd "$demo"
    write_test_update_source_env "$demo" AI-OS-catalog-missing-folder-test/upstream main
    env AI_OS_SKIP_MEMORY_PROMPT=1 \
        bash scripts/update.sh > "$output_file" 2>&1

    assert_output_contains "$output_file" "Skipped catalog skill(s) with missing tracked folder: $invalid_skill"
    assert_output_contains "$output_file" "Restored $valid_skill"
    assert_output_not_contains "$output_file" "pathspec"

    [[ -d ".claude/skills/$valid_skill" ]] || {
        err "$valid_skill folder was not installed"
        sed -n '1,220p' "$output_file"
        return 1
    }
    ok "$valid_skill folder installed"

    [[ ! -d ".claude/skills/$invalid_skill" ]] || {
        err "$invalid_skill folder should not exist"
        sed -n '1,220p' "$output_file"
        return 1
    }
    ok "$invalid_skill folder was not created"

    "${PYTHON_CMD[@]}" - <<PY
import json
import sys

with open(".claude/skills/_catalog/installed.json") as f:
    state = json.load(f)

installed = set(state.get("installed_skills", []))
removed = set(state.get("removed_skills", []))
errors = []

if "$valid_skill" not in installed:
    errors.append("$valid_skill was not added to installed_skills")
if "$invalid_skill" in installed:
    errors.append("$invalid_skill should not be in installed_skills")
if "$invalid_skill" in removed:
    errors.append("$invalid_skill should not be in removed_skills")

if errors:
    for error in errors:
        print(error)
    sys.exit(1)
PY
    ok "installed.json records only the valid new skill"

    if bash scripts/add-skill.sh "$invalid_skill" > "$add_skill_output" 2>&1; then
        err "add-skill.sh should fail for $invalid_skill"
        sed -n '1,120p' "$add_skill_output"
        return 1
    fi
    assert_output_contains "$add_skill_output" "The catalog lists $invalid_skill, but .claude/skills/$invalid_skill/ is not tracked in Git."
    assert_output_not_contains "$add_skill_output" "pathspec"

    ok "Catalog missing folder test passed"
}

run_catalog_memory_prompt_test() {
    local catalog_file="$REAL_REPO/scripts/lib/catalog.sh"

    header "Catalog memory prompt"

    grep -Fq "setup_label=\"Searchable memory setup\"" "$catalog_file" \
        || { err "Catalog prompt should default to searchable memory setup"; return 1; }
    grep -Fq "setup_label=\"Memory migration/setup\"" "$catalog_file" \
        || { err "Catalog prompt should still support memory migration/setup"; return 1; }
    grep -Fq -- "--legacy-check" "$catalog_file" \
        || { err "Catalog prompt should check whether legacy MemSearch exists"; return 1; }
    grep -Fq "No old MemSearch data was" "$catalog_file" \
        || { err "Catalog prompt should clearly say when no old MemSearch data exists"; return 1; }
    grep -Fq "bash scripts/setup-memory.sh" "$catalog_file" \
        || { err "Catalog prompt should point to setup-memory.sh"; return 1; }
    grep -Fq "Update completed with attention needed" "$catalog_file" \
        || { err "Catalog summary should clearly report update steps that need attention"; return 1; }
    grep -Fq "Memory migration/setup failed. Searchable memory may not work" "$catalog_file" \
        || { err "Catalog summary should clearly report legacy memory setup failure"; return 1; }
    grep -Fq "Searchable memory setup failed. Searchable memory may not work" "$catalog_file" \
        || { err "Catalog summary should clearly report non-legacy memory setup failure"; return 1; }
    grep -Fq "If old .memsearch data remains, it will stay in place until setup finishes successfully." "$catalog_file" \
        || { err "Catalog summary should keep legacy data warning conditional"; return 1; }
    grep -Fq "Client sync failed. The root update succeeded" "$catalog_file" \
        || { err "Catalog summary should clearly report client sync failure"; return 1; }

    if grep -Fq "Recommended: Searchable Memory" "$catalog_file" ||
        grep -Fq "MemSearch lets" "$catalog_file" ||
        grep -Fq "Old .memsearch data was not archived because re-indexing did not finish." "$catalog_file" ||
        grep -Fq -- "--target claude" "$catalog_file"; then
        err "Catalog prompt still contains legacy MemSearch setup wording"
        return 1
    fi

    for install_file in "$REAL_REPO/scripts/install.sh" "$REAL_REPO/scripts/install.ps1"; do
        if grep -Fq "This is optional, but recommended. AI-OS now uses local PGLite" "$install_file" ||
            grep -Fq "If old .memsearch data exists, it will be indexed and archived." "$install_file"; then
            err "$(basename "$install_file") still prints the extra memory setup intro"
            return 1
        fi
    done

    ok "Catalog prompt separates searchable memory setup from legacy migration"
}

run_client_sync_failure_warning_test() {
    local test_root="${TMPDIR:-/tmp}/AI-OS-client-sync-failure-test"
    local upstream="$test_root/upstream"
    local demo="$test_root/demo"
    local output_file="$test_root/update.out"

    header "Client sync failure warning test"
    rm -rf "$test_root"
    mkdir -p "$test_root"

    git clone "$REAL_REPO" "$upstream" --quiet
    cd "$upstream"
    git checkout -B main --quiet 2>/dev/null || git checkout main --quiet 2>/dev/null || true

    for file in \
        scripts/update.sh \
        scripts/update-clients.sh \
        scripts/add-skill.sh \
        scripts/rollback.sh \
        scripts/session-end.sh \
        scripts/lib/backup.sh \
        scripts/lib/catalog.sh \
        scripts/lib/common.sh \
        scripts/lib/gsd-migration.sh \
        scripts/lib/merge.sh \
        scripts/lib/pull.sh \
        scripts/lib/python.sh \
        scripts/lib/synthesize.py; do
        cp "$REAL_REPO/$file" "$file"
    done
    git add scripts/update.sh scripts/update-clients.sh scripts/add-skill.sh scripts/rollback.sh scripts/session-end.sh scripts/lib
    git commit -m "Use current update scripts" --allow-empty --quiet

    git clone "$upstream" "$demo" --quiet
    cd "$demo"
    git checkout main --quiet 2>/dev/null || true
    mkdir -p clients/acme

    cd "$upstream"
    cat > scripts/update-clients.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "fake client sync failure"
exit 1
EOF
    chmod +x scripts/update-clients.sh
    echo "<!-- trigger client sync failure test -->" >> README.md
    git add README.md scripts/update-clients.sh
    git commit -m "Trigger client sync failure" --quiet

    cd "$demo"
    write_test_update_source_env "$demo" AI-OS-client-sync-failure-test/upstream main
    env AI_OS_SKIP_MEMORY_PROMPT=1 \
        bash scripts/update.sh > "$output_file" 2>&1

    assert_output_contains "$output_file" "Client folder sync did not finish"
    assert_output_contains "$output_file" "Update completed with attention needed"
    assert_output_contains "$output_file" "Client sync failed. The root update succeeded"

    ok "Client sync failure warning test passed"
}

run_bootstrap_stale_common_test() {
    local test_root="${TMPDIR:-/tmp}/AI-OS-bootstrap-stale-common-test"
    local upstream="$test_root/upstream"
    local demo="$test_root/demo"
    local output_file="$test_root/update.out"
    local required_files=(
        scripts/update.sh
        scripts/lib/common.sh
        scripts/lib/python.sh
        scripts/lib/backup.sh
        scripts/lib/pull.sh
        scripts/lib/merge.sh
        scripts/lib/catalog.sh
        scripts/lib/update-processes.sh
        scripts/lib/update-processes.ps1
        scripts/lib/gsd-migration.sh
        scripts/lib/synthesize.py
        scripts/rollback.sh
        scripts/session-end.sh
    )

    header "Bootstrap stale common helper test"
    rm -rf "$test_root"
    mkdir -p "$test_root"

    git clone "$REAL_REPO" "$upstream" --quiet
    cd "$upstream"
    git checkout -B main --quiet 2>/dev/null || git checkout main --quiet 2>/dev/null || true

    for file in "${required_files[@]}"; do
        mkdir -p "$(dirname "$file")"
        cp "$REAL_REPO/$file" "$file"
    done

    sed '/^ensure_update_remote_access()/,/^}/d' scripts/lib/common.sh > scripts/lib/common.sh.stale
    mv scripts/lib/common.sh.stale scripts/lib/common.sh
    git add "${required_files[@]}"
    git commit -m "Simulate stale common helper release" --allow-empty --quiet

    git clone "$upstream" "$demo" --quiet

    cd "$upstream"
    for file in "${required_files[@]}"; do
        mkdir -p "$(dirname "$file")"
        cp "$REAL_REPO/$file" "$file"
    done
    git add "${required_files[@]}"
    git commit -m "Publish fixed update helper bundle" --quiet

    cd "$demo"
    write_test_update_source_env "$demo" AI-OS-bootstrap-stale-common-test/upstream main
    env AI_OS_SKIP_MEMORY_PROMPT=1 \
        bash scripts/update.sh > "$output_file" 2>&1

    assert_output_contains "$output_file" "Fetching update dependencies from"
    assert_output_not_contains "$output_file" "ensure_update_remote_access: command not found"
    assert_output_contains "$output_file" "You are now on AI-OS"

    if grep -Fq "ensure_update_remote_access()" "$demo/scripts/lib/common.sh"; then
        ok "Updated common.sh contains ensure_update_remote_access"
    else
        err "Updated common.sh does not contain ensure_update_remote_access"
        return 1
    fi

    ok "Bootstrap stale common helper test passed"
}

run_developer_update_source_test() {
    local test_root="${TMPDIR:-/tmp}/AI-OS-dev-branch-override-test"
    local upstream="$test_root/OWNER/REPO"
    local demo="$test_root/demo"
    local default_demo="$test_root/default-demo"
    local check_output="$test_root/check-updates-dev.out"
    local update_output="$test_root/update-dev.out"
    local default_check_output="$test_root/check-updates-main-default.out"
    local default_update_output="$test_root/update-main-default.out"
    local invalid_check_output="$test_root/check-updates-invalid.out"
    local invalid_update_output="$test_root/update-invalid.out"
    local slug="OWNER/REPO"
    local dev_marker="dev branch update marker"
    local main_marker="main branch update marker"
    local required_files=(
        scripts/update.sh
        scripts/check-updates.sh
        scripts/update-clients.sh
        scripts/add-skill.sh
        scripts/rollback.sh
        scripts/session-end.sh
        scripts/lib/backup.sh
        scripts/lib/catalog.sh
        scripts/lib/common.sh
        scripts/lib/gsd-migration.sh
        scripts/lib/merge.sh
        scripts/lib/pull.sh
        scripts/lib/python.sh
        scripts/lib/synthesize.py
        scripts/lib/update-processes.sh
        scripts/lib/update-processes.ps1
    )

    header "Developer update source override test"
    rm -rf "$test_root"
    mkdir -p "$(dirname "$upstream")"

    git clone "$REAL_REPO" "$upstream" --quiet
    cd "$upstream"
    git checkout -B main --quiet 2>/dev/null || git checkout main --quiet 2>/dev/null || true

    for file in "${required_files[@]}"; do
        mkdir -p "$(dirname "$file")"
        cp "$REAL_REPO/$file" "$file"
    done
    git add "${required_files[@]}"
    git commit -m "Use current update scripts" --allow-empty --quiet

    git clone "$upstream" "$demo" --quiet
    cd "$demo"
    git checkout main --quiet 2>/dev/null || true
    cat > .env <<EOF
AI_OS_UPSTREAM_SLUG=$slug
AI_OS_UPSTREAM_BRANCH=dev
EOF

    git clone "$upstream" "$default_demo" --quiet
    cd "$default_demo"
    git checkout main --quiet 2>/dev/null || true
    printf 'AI_OS_UPSTREAM_SLUG=%s\n' "$slug" > .env

    cd "$upstream"
    git checkout -B dev main --quiet
    printf "\n<!-- %s -->\n" "$dev_marker" >> README.md
    git add README.md
    git commit -m "Add dev-only update marker" --quiet
    git checkout main --quiet

    printf '%s\n' "$main_marker" > main-update-marker.txt
    git add main-update-marker.txt
    git commit -m "Add main-only update marker" --quiet

    cd "$demo"
    env AI_OS_UPSTREAM_SLUG=legacy/team-os-v1 \
        AI_OS_UPSTREAM_BRANCH=main \
        AI_OS_SKIP_MEMORY_PROMPT=1 \
        bash scripts/check-updates.sh > "$check_output" 2>&1
    assert_output_contains "$check_output" "behind origin/dev"

    env AI_OS_UPSTREAM_SLUG=legacy/team-os-v1 \
        AI_OS_UPSTREAM_BRANCH=main \
        AI_OS_SKIP_MEMORY_PROMPT=1 \
        bash scripts/update.sh > "$update_output" 2>&1
    assert_output_contains "$update_output" "Step 1: Updates from origin/dev"
    assert_output_contains "$update_output" "Pulled 1 new commit(s) from origin/dev."
    assert_file_contains README.md "$dev_marker"
    ok ".env update source ignores conflicting shell values"

    cd "$default_demo"
    env AI_OS_UPSTREAM_SLUG=legacy/team-os-v1 \
        AI_OS_UPSTREAM_BRANCH=dev \
        AI_OS_SKIP_MEMORY_PROMPT=1 \
        bash scripts/check-updates.sh > "$default_check_output" 2>&1
    assert_output_contains "$default_check_output" "behind origin/main"

    cat > .env <<EOF
AI_OS_UPSTREAM_SLUG=
AI_OS_UPSTREAM_BRANCH=
EOF

    env AI_OS_UPSTREAM_SLUG=legacy/team-os-v1 \
        AI_OS_UPSTREAM_BRANCH=dev \
        AI_OS_SKIP_MEMORY_PROMPT=1 \
        bash scripts/update.sh > "$default_update_output" 2>&1
    assert_output_contains "$default_update_output" "Upstream updates are disabled"
    assert_output_not_contains "$default_update_output" "Fetching update dependencies"
    if [[ -f main-update-marker.txt ]]; then
        err "An independent copy with no configured source must not fetch upstream changes"
        return 1
    fi
    assert_output_not_contains "$default_update_output" "origin/dev"
    env AI_OS_UPSTREAM_SLUG=legacy/team-os-v1 \
        bash scripts/check-updates.sh > "$default_check_output" 2>&1
    assert_output_contains "$default_check_output" "Upstream updates are disabled"
    ok "Blank update source disables upstream changes and ignores shell overrides"

    cd "$demo"
    cat > .env <<EOF
AI_OS_UPSTREAM_SLUG=$slug
AI_OS_UPSTREAM_BRANCH=bad branch
EOF

    if bash scripts/check-updates.sh > "$invalid_check_output" 2>&1; then
        err "check-updates.sh should fail for invalid AI_OS_UPSTREAM_BRANCH"
        sed -n '1,120p' "$invalid_check_output"
        return 1
    fi
    assert_output_contains "$invalid_check_output" "Invalid AI_OS_UPSTREAM_BRANCH: bad branch"

    if bash scripts/update.sh > "$invalid_update_output" 2>&1; then
        err "update.sh should fail for invalid AI_OS_UPSTREAM_BRANCH"
        sed -n '1,120p' "$invalid_update_output"
        return 1
    fi
    assert_output_contains "$invalid_update_output" "Invalid AI_OS_UPSTREAM_BRANCH: bad branch"

    ok "Developer update source override test passed"
}

run_command_centre_dependencies_test() {
    local success_output="$TEST_ROOT/command-centre-dependencies-success.out"
    local failure_output="$TEST_ROOT/command-centre-dependencies-failure.out"
    local helper_log="$TEST_ROOT/command-centre-dependencies.log"
    local update_exit=0

    header "Command Centre dependency synchronization"
    create_test_env
    install_current_update_scripts

    cd "$MAIN_WORK"
    cat > command-centre/scripts/ensure-dependencies.cjs <<'EOF'
const fs = require("node:fs");
fs.appendFileSync(process.env.AI_OS_DEPENDENCY_TEST_LOG, "success\n");
process.exit(0);
EOF
    push_from_main "Trigger dependency synchronization without a lockfile change"

    export AI_OS_TEST_SKIP_COMMAND_CENTRE_DEPS=0
    export AI_OS_DEPENDENCY_TEST_LOG="$helper_log"
    run_update > "$success_output" 2>&1
    export AI_OS_TEST_SKIP_COMMAND_CENTRE_DEPS=1

    assert_file_contains "$helper_log" "success"
    assert_output_contains "$success_output" "Command Centre dependencies: ready"

    cd "$MAIN_WORK"
    cat > command-centre/scripts/ensure-dependencies.cjs <<'EOF'
const fs = require("node:fs");
fs.appendFileSync(process.env.AI_OS_DEPENDENCY_TEST_LOG, "failure\n");
process.exit(9);
EOF
    push_from_main "Simulate Command Centre dependency synchronization failure"

    export AI_OS_TEST_SKIP_COMMAND_CENTRE_DEPS=0
    set +e
    run_update > "$failure_output" 2>&1
    update_exit=$?
    set -e
    export AI_OS_TEST_SKIP_COMMAND_CENTRE_DEPS=1
    unset AI_OS_DEPENDENCY_TEST_LOG

    if [[ $update_exit -ne 0 ]]; then
        err "update.sh should finish successfully when Command Centre dependency repair fails"
        sed -n '1,220p' "$failure_output"
        return 1
    fi
    assert_file_contains "$helper_log" "failure"
    assert_output_contains "$failure_output" "Command Centre dependencies could not be synchronized"
    assert_output_contains "$failure_output" "Update completed with attention needed"
    assert_output_contains "$failure_output" "cd command-centre && npm ci"

    ok "Command Centre dependency synchronization test passed"
}

run_update_process_preflight_integration_test() {
    local blocked_output="$TEST_ROOT/update-process-preflight-blocked.out"
    local success_output="$TEST_ROOT/update-process-preflight-success.out"
    local marker="update process preflight marker"
    local before_head after_head

    header "Update process preflight integration"
    create_test_env
    install_current_update_scripts

    cd "$DEMO_REPO"
    "${PYTHON_CMD[@]}" - "$DEMO_REPO" <<'PYEOF'
import sqlite3
import sys
from pathlib import Path

root = Path(sys.argv[1])
for relative, status in (
    (Path(".command-centre/data.db"), "running"),
    (Path(".command-centre/profiles/abcdef/data.db"), "queued"),
):
    database = root / relative
    database.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database)
    connection.execute(
        "CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, status TEXT, updatedAt TEXT)"
    )
    connection.execute(
        "INSERT INTO tasks VALUES (?, ?, ?, ?)",
        (str(relative), "Blocking update task", status, "2026-07-24T12:00:00Z"),
    )
    connection.commit()
    connection.close()
PYEOF

    cd "$MAIN_WORK"
    printf '\n<!-- %s -->\n' "$marker" >> README.md
    push_from_main "Trigger process preflight update"

    cd "$DEMO_REPO"
    before_head="$(git rev-parse HEAD)"
    if run_update > "$blocked_output" 2>&1; then
        err "Update should stop while Command Centre has active work"
        sed -n '1,220p' "$blocked_output"
        return 1
    fi
    after_head="$(git rev-parse HEAD)"

    [[ "$before_head" == "$after_head" ]] || {
        err "Blocked update changed the repository HEAD"
        return 1
    }
    assert_output_contains "$blocked_output" "Command Centre has active work"
    assert_output_contains "$blocked_output" "Nothing was changed and no processes were stopped"
    if grep -Fq "$marker" "$DEMO_REPO/README.md"; then
        err "Blocked update pulled the upstream marker"
        return 1
    fi
    ok "Blocked update did not pull upstream changes"

    "${PYTHON_CMD[@]}" - "$DEMO_REPO" <<'PYEOF'
import sqlite3
import sys
from pathlib import Path

root = Path(sys.argv[1])
for database in [root / ".command-centre/data.db", *sorted((root / ".command-centre/profiles").glob("*/data.db"))]:
    connection = sqlite3.connect(database)
    connection.execute("UPDATE tasks SET status = 'review'")
    connection.commit()
    connection.close()
PYEOF

    run_update > "$success_output" 2>&1
    assert_output_contains "$success_output" "Command Centre processes: already stopped"
    assert_file_contains "$DEMO_REPO/README.md" "$marker"
    ok "Active tasks block before pull; idle updates continue"
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
    "viz-image-gen",
    "viz-ugc-heygen"
  ]
}
IJSON

    # Remove skills the user "didn't select"
    for skill in mkt-content-repurposing mkt-copywriting mkt-ugc-scripts ops-cron \
                 str-trending-research tool-firecrawl-scraper tool-youtube \
                 viz-excalidraw-diagram viz-image-gen viz-ugc-heygen; do
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
    printf "${CYAN}${BOLD}  AI-OS — Update Script Test Scenarios${NC}\n"
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
    catalog-missing-folder)
        run_catalog_missing_folder_test
        ;;
    protected-paths)
        run_protected_paths_test
        ;;
    client-sync-contract)
        run_client_sync_contract_test
        ;;
    failed-stash-backup)
        run_failed_stash_backup_test
        ;;
    stale-update-stashes)
        run_stale_update_stashes_test
        ;;
    unexpected-backup-failure)
        run_unexpected_backup_failure_test
        ;;
    killed-update-keeps-config)
        run_killed_update_keeps_config_test
        ;;
    stale-backup-lib-bootstrap)
        run_stale_backup_lib_bootstrap_test
        ;;
    foreign-stash-restore)
        run_foreign_stash_restore_test
        ;;
    missing-script-warns)
        run_missing_script_warns_test
        ;;
    recovery-helper-no-report)
        run_recovery_helper_no_report_test
        ;;
    backup-fork-remote)
        run_backup_fork_remote_test
        ;;
    old-0-2-update)
        run_old_0_2_update_test
        ;;
    catalog-memory-prompt)
        run_catalog_memory_prompt_test
        ;;
    client-sync-failure-warning)
        run_client_sync_failure_warning_test
        ;;
    bootstrap-stale-common)
        run_bootstrap_stale_common_test
        ;;
    developer-update-source)
        run_developer_update_source_test
        ;;
    command-centre-dependencies)
        run_command_centre_dependencies_test
        ;;
    update-processes)
        bash "$REAL_REPO/scripts/test-update-processes.sh"
        ;;
    update-process-preflight)
        run_update_process_preflight_integration_test
        ;;
    branch-preserve-fallback)
        run_branch_preserve_fallback_test
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

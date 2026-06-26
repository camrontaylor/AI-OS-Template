#!/usr/bin/env bash
set -euo pipefail

# AI-OS - Installer / Bootstrap Repair
#
# Modes:
#   bash scripts/install.sh            # guided install
#   bash scripts/install.sh --guided   # guided install
#   bash scripts/install.sh --repair   # silent local bootstrap repair

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
source "$SCRIPT_DIR/lib/python.sh"
source "$SCRIPT_DIR/lib/centre-shortcut.sh"
source "$SCRIPT_DIR/lib/gsd-migration.sh"

case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) REPO_ROOT="$(cygpath -m "$REPO_ROOT")" ;;
esac

HELPER_SCRIPT="$SCRIPT_DIR/launcher-bootstrap.py"
SETUP_SCRIPT="$SCRIPT_DIR/setup.sh"
MEMORY_SETUP_SCRIPT="$SCRIPT_DIR/setup-memory.sh"
CRON_DRY_RUN="${AGENTIC_OS_CRON_DRY_RUN:-0}"
AGENTIC_OS_VERSION="$(cat "$REPO_ROOT/VERSION" 2>/dev/null || echo "unknown")"

if is_windows_shell && command -v cygpath >/dev/null 2>&1; then
    HELPER_SCRIPT="$(cygpath -m "$HELPER_SCRIPT")"
    SETUP_SCRIPT="$(cygpath -m "$SETUP_SCRIPT")"
    MEMORY_SETUP_SCRIPT="$(cygpath -m "$MEMORY_SETUP_SCRIPT")"
fi

MODE="guided"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --guided)
            MODE="guided"
            ;;
        --repair)
            MODE="repair"
            ;;
        -h|--help)
            cat <<'EOF'
AI-OS installer

Usage:
  bash scripts/install.sh
  bash scripts/install.sh --guided
  bash scripts/install.sh --repair

Modes:
  --guided  Run the first-time guided install flow.
  --repair  Repair only the local bootstrap files silently.
EOF
            exit 0
            ;;
        *)
            printf "Unknown argument: %s\n" "$1" >&2
            exit 1
            ;;
    esac
    shift
done

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()    { printf "${CYAN}%s${NC}\n" "$1"; }
success() { printf "${GREEN}  ✓ %s${NC}\n" "$1"; }
warn()    { printf "${YELLOW}  ! %s${NC}\n" "$1"; }
fail()    { printf "${RED}  ✗ %s${NC}\n" "$1"; }

GITHUB_DECISION="unknown"
GSD_DECISION="unknown"
LAUNCHER_DECISION="unknown"
MEMORY_DECISION="unknown"

run_helper() {
    "${PYTHON_CMD[@]}" "$HELPER_SCRIPT" --repo-root "$REPO_ROOT" "$@"
}

state_field() {
    run_helper state-status --field "$1"
}

bootstrap_field() {
    run_helper bootstrap-status --field "$1"
}

ask_yes_no() {
    local prompt="$1"
    local default_answer="${2:-Y}"
    local reply=""

    if [[ "$default_answer" == "N" ]]; then
        printf "%b  %s %b" "$CYAN" "$prompt" "${BOLD}[y/N]${NC} "
    else
        printf "%b  %s %b" "$CYAN" "$prompt" "${BOLD}[Y/n]${NC} "
    fi

    read -r reply
    reply="${reply:-$default_answer}"
    [[ "$reply" =~ ^[Yy]$ ]]
}

print_banner() {
    clear 2>/dev/null || true
    echo ""
    printf "${CYAN}${BOLD}"
    cat <<'BANNER'
    ╔══════════════════════════════════════════════╗
    ║                                              ║
    ║                 A I - O S                    ║
    ║                                              ║
    ║          Guided First-Time Install           ║
    ║                                              ║
    ╚══════════════════════════════════════════════╝
BANNER
    printf "${NC}"
    if [[ "$AGENTIC_OS_VERSION" == "unknown" ]]; then
        printf "    ${DIM}AI-OS version unknown${NC}\n"
    else
        printf "    ${DIM}AI-OS v%s${NC}\n" "$AGENTIC_OS_VERSION"
    fi
    echo ""
}

check_prerequisites() {
    local prereq_fail=0

    if [[ "$MODE" == "guided" ]]; then
        info "Checking prerequisites..."
        echo ""
    fi

    if command -v git &>/dev/null; then
        [[ "$MODE" == "guided" ]] && success "git $(git --version | awk '{print $3}')"
    else
        fail "git not found - install from https://git-scm.com/downloads"
        prereq_fail=1
    fi

    if command -v bash &>/dev/null; then
        [[ "$MODE" == "guided" ]] && success "bash ${BASH_VERSION}"
    else
        fail "bash not found"
        prereq_fail=1
    fi

    if command -v node &>/dev/null; then
        [[ "$MODE" == "guided" ]] && success "node $(node --version 2>&1)"
    else
        # Node is NOT a hard blocker. Skills and memory work without it.
        # Only the Command Centre dashboard needs Node, so make that loud and clear
        # instead of failing the whole install. centre.sh gives the same actionable
        # message and exits cleanly if Node is still missing when you open it.
        warn "Node.js not found."
        echo "      The rest of AI-OS works fine without Node - skills and memory do not need it."
        echo "      But the Command Centre dashboard will NOT run until Node is installed."
        echo "      Install Node.js from https://nodejs.org, then run 'centre' to open the dashboard."
    fi

    if resolve_python_cmd; then
        [[ "$MODE" == "guided" ]] && success "Python $PYTHON_VERSION via $PYTHON_LABEL"
        if is_windows_shell && [[ $PYTHON3_DIAGNOSTIC_BROKEN -eq 1 ]]; then
            warn "Windows exposes a broken python3 at ${PYTHON3_DIAGNOSTIC_PATH}."
            warn "AI-OS will use '${PYTHON_LABEL}' instead."
        fi
        # tool-youtube needs Python 3.10 or newer.
        # The core system is fine on any Python 3, so this is a notice, not a blocker.
        if [[ -n "${PYTHON_VERSION:-}" ]]; then
            local py_major py_minor
            py_major="$(printf '%s' "$PYTHON_VERSION" | cut -d. -f1)"
            py_minor="$(printf '%s' "$PYTHON_VERSION" | cut -d. -f2)"
            if [[ "$py_major" =~ ^[0-9]+$ && "$py_minor" =~ ^[0-9]+$ ]]; then
                if [[ "$py_major" -lt 3 || ( "$py_major" -eq 3 && "$py_minor" -lt 10 ) ]]; then
                    warn "Python ${PYTHON_VERSION} is older than 3.10."
                    echo "      The core system is fine. tool-youtube needs Python 3.10 or newer."
                    echo "      The easiest fix is 'uv', which fetches a"
                    echo "      newer Python automatically (https://docs.astral.sh/uv/)."
                fi
            fi
        fi
    else
        fail "Python 3 not found - install from https://www.python.org/downloads/"
        prereq_fail=1
    fi

    if [[ $prereq_fail -ne 0 ]]; then
        exit 1
    fi

    return 0
}

ensure_local_bootstrap() {
    if [[ "$MODE" == "guided" ]]; then
        info "Preparing local bootstrap files..."
    fi

    if ! run_helper bootstrap-repair >/dev/null; then
        fail "Could not repair the local bootstrap state."
        exit 1
    fi

    if [[ "$(bootstrap_field bootstrap_valid)" != "true" ]]; then
        fail "Bootstrap repair finished, but the workspace is still incomplete."
        exit 1
    fi

    [[ "$MODE" == "guided" ]] && success "Local bootstrap is ready"
    return 0
}

run_dependency_setup() {
    if [[ ! -f "$SETUP_SCRIPT" ]]; then
        warn "setup.sh not found - skipping dependency setup"
        return 0
    fi

    info "Checking system dependencies..."
    bash "$SETUP_SCRIPT" --silent || true
    return 0
}

setup_searchable_memory() {
    echo ""
    printf "${CYAN}${BOLD}Searchable Memory${NC}\n"
    echo "  This is optional, but recommended. It lets AI-OS search older"
    echo "  memory, daily logs, learnings, and client-scoped brand context."
    echo "  Claude Code is the recommended default because AI-OS is Claude-first."
    echo ""

    if [[ "$CRON_DRY_RUN" == "1" ]]; then
        warn "Dry run mode active - skipping searchable memory setup."
        MEMORY_DECISION="skipped-dry-run"
        return 0
    fi

    if [[ ! -f "$MEMORY_SETUP_SCRIPT" ]]; then
        warn "setup-memory.sh not found - skipping searchable memory setup."
        MEMORY_DECISION="unavailable"
        return 0
    fi

    if bash "$MEMORY_SETUP_SCRIPT" --check >/dev/null 2>&1; then
        success "Searchable memory already configured"
        MEMORY_DECISION="configured"
        return 0
    fi

    echo "  Choose where to enable searchable memory:"
    echo "    1. Claude Code only (recommended)"
    echo "    2. Codex only"
    echo "    3. Claude Code + Codex"
    echo "    4. Skip for now"
    echo ""
    printf "  Selection ${DIM}[1]${NC} "

    local reply target
    if ! read -r reply; then
        reply="4"
    fi
    reply="${reply:-1}"

    case "$reply" in
        1) target="claude" ;;
        2) target="codex" ;;
        3) target="both" ;;
        4)
            warn "Skipped searchable memory setup."
            echo "  Semantic recall, older memory search,"
            echo "  expanded search, and stronger citations will be unavailable until enabled."
            MEMORY_DECISION="skipped"
            return 0
            ;;
        *)
            warn "Unknown selection - skipped searchable memory setup."
            MEMORY_DECISION="skipped-invalid"
            return 0
            ;;
    esac

    local exit_code
    set +e
    bash "$MEMORY_SETUP_SCRIPT" --target "$target"
    exit_code=$?
    set -e

    if [[ $exit_code -eq 0 ]]; then
        success "Searchable memory setup finished"
        MEMORY_DECISION="$target"
        return 0
    fi

    if [[ $exit_code -eq 3 ]]; then
        warn "Skipped searchable memory setup."
        MEMORY_DECISION="skipped-confirmation"
        return 0
    fi

    warn "Searchable memory setup did not finish. You can retry later:"
    echo "    bash scripts/setup-memory.sh"
    MEMORY_DECISION="failed"
    return 0
}

setup_github_repo() {
    local upstream_owner="camrontaylor"
    local upstream_repo="ai-os-template"
    local origin_url=""
    local is_upstream=0

    origin_url="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || echo "")"
    if [[ "$origin_url" == *"${upstream_owner}/${upstream_repo}"* ]]; then
        is_upstream=1
    fi

    if [[ -n "$origin_url" ]] && [[ $is_upstream -eq 0 ]]; then
        success "GitHub backup already configured: $origin_url"
        GITHUB_DECISION="configured"
        return 0
    fi

    echo ""
    printf "${CYAN}${BOLD}GitHub Backup${NC}\n"
    echo "  AI-OS stores your brand and project data locally."
    echo "  You can back it up to your own private GitHub repository."
    echo ""

    if ! ask_yes_no "Set up private GitHub backup now?"; then
        warn "Skipped GitHub backup setup."
        GITHUB_DECISION="skipped"
        return 0
    fi

    if ! command -v gh &>/dev/null; then
        warn "GitHub CLI (gh) not found."
        echo "  Manual fallback:"
        echo "    1. Create a new PRIVATE repo on GitHub"
        if [[ $is_upstream -eq 1 ]]; then
            echo "    2. Run: git remote rename origin upstream"
            echo "    3. Run: git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git"
        else
            echo "    2. Run: git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git"
        fi
        echo "    4. Run: git push -u origin main"
        GITHUB_DECISION="manual-required"
        return 0
    fi

    if ! gh auth status &>/dev/null 2>&1; then
        warn "GitHub CLI is not authenticated."
        echo "  Run: gh auth login"
        echo "  Then run this installer again if you want automatic setup."
        GITHUB_DECISION="pending-auth"
        return 0
    fi

    local gh_user=""
    gh_user="$(gh api user --jq '.login' 2>/dev/null || echo "")"
    if [[ -z "$gh_user" ]]; then
        warn "Could not read your GitHub username."
        GITHUB_DECISION="failed"
        return 0
    fi

    local default_repo="AI-OS"
    local repo_name=""

    echo "  Logged in as: ${BOLD}${gh_user}${NC}"
    printf "  Repo name? ${DIM}[${default_repo}]${NC} "
    read -r repo_name
    repo_name="${repo_name:-$default_repo}"

    # If origin still points at the canonical repo, move it to `upstream` BEFORE
    # creating the fork. Otherwise `gh repo create --remote=origin` collides with
    # the existing origin remote and silently fails - leaving the user with no
    # remote pointing at the canonical repo, which breaks update.sh.
    if [[ $is_upstream -eq 1 ]]; then
        if git -C "$REPO_ROOT" remote get-url upstream >/dev/null 2>&1; then
            git -C "$REPO_ROOT" remote remove origin 2>/dev/null || true
        else
            git -C "$REPO_ROOT" remote rename origin upstream 2>/dev/null || true
        fi
    fi

    info "Creating private repo ${gh_user}/${repo_name}..."

    if gh repo create "${repo_name}" --private --source="$REPO_ROOT" --remote=origin 2>/dev/null; then
        git -C "$REPO_ROOT" push -u origin main 2>/dev/null || {
            local current_branch
            current_branch="$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || echo "main")"
            git -C "$REPO_ROOT" push -u origin "$current_branch" 2>/dev/null || true
        }
        success "Private backup repo configured"
        GITHUB_DECISION="configured"
        return 0
    fi

    warn "Automatic repo creation failed."
    if [[ $is_upstream -eq 1 ]]; then
        warn "Canonical repo is now at the 'upstream' remote - updates will still work."
    fi
    GITHUB_DECISION="failed"
    return 0
}

install_gsd() {
    local redux_version=""
    echo ""
    printf "${CYAN}${BOLD}GSD Project Framework${NC}\n"
    echo "  This installs the optional GSD commands for structured project work."
    echo ""

    if [[ "$CRON_DRY_RUN" == "1" ]]; then
        warn "Dry run mode active - skipping GSD install."
        GSD_DECISION="skipped-dry-run"
        return 0
    fi

    if ! command -v node &>/dev/null; then
        warn "Node.js is required for GSD. Install Node.js first."
        GSD_DECISION="unavailable"
        return 0
    fi

    if ! command -v npx &>/dev/null; then
        warn "npx is required for GSD. Install npm first."
        GSD_DECISION="unavailable"
        return 0
    fi

    if agentic_os_gsd_offer_legacy_migration "$REPO_ROOT"; then
        if [[ "$AGENTIC_OS_GSD_MIGRATION_RESULT" != "cleaned" ]]; then
            if redux_version="$(agentic_os_gsd_redux_version "$REPO_ROOT")"; then
                success "GSD-redux already installed (v${redux_version})"
                GSD_DECISION="already-installed"
                return 0
            fi
            if ! ask_yes_no "Install GSD now?"; then
                warn "Skipped GSD installation."
                GSD_DECISION="skipped"
                return 0
            fi
        fi
    else
        warn "Legacy GSD left in place. Skipped GSD-redux install."
        GSD_DECISION="migration-declined"
        return 0
    fi

    if agentic_os_gsd_install_redux 2>/dev/null; then
        success "GSD-redux installed globally"
        GSD_DECISION="installed"
    else
        warn "GSD installation failed. You can retry later with: npx -y @opengsd/get-shit-done-redux@latest --global --claude"
        GSD_DECISION="failed"
    fi

    return 0
}

install_launcher_alias() {
    echo ""
    printf "${CYAN}${BOLD}Global 'centre' Shortcut${NC}\n"
    echo "  This is optional. It lets you type 'centre' from anywhere."
    echo ""

    if ! ask_yes_no "Install the global 'centre' shortcut now?"; then
        warn "Skipped launcher shortcut install."
        LAUNCHER_DECISION="skipped"
        return 0
    fi

    if [[ "$CRON_DRY_RUN" == "1" ]]; then
        warn "Dry run mode active - skipping launcher install."
        LAUNCHER_DECISION="skipped-dry-run"
        return 0
    fi

    local centre_script="$SCRIPT_DIR/centre.sh"
    local manual_alias_line=""
    manual_alias_line="$(agentic_os_centre_build_alias_line "posix" "$centre_script")"

    case "$(uname -s)" in
        Darwin|Linux)
            if ! agentic_os_centre_install_current_unix_shortcut "$centre_script"; then
                warn "Unknown shell. Install the shortcut manually:"
                echo "    $manual_alias_line"
                LAUNCHER_DECISION="manual-required"
                return 0
            fi

            case "$AGENTIC_OS_CENTRE_LAST_ACTION" in
                added)
                    success "Added 'centre' to $(basename "$AGENTIC_OS_CENTRE_CURRENT_TARGET_PATH")"
                    ;;
                updated)
                    success "Updated 'centre' in $(basename "$AGENTIC_OS_CENTRE_CURRENT_TARGET_PATH")"
                    ;;
                *)
                    success "Shortcut already current in $(basename "$AGENTIC_OS_CENTRE_CURRENT_TARGET_PATH")"
                    ;;
            esac

            [[ -n "$AGENTIC_OS_CENTRE_CURRENT_RELOAD_HINT" ]] && \
                warn "Open a new terminal or run '$AGENTIC_OS_CENTRE_CURRENT_RELOAD_HINT' to activate 'centre'."
            LAUNCHER_DECISION="installed"
            ;;
        MINGW*|MSYS*|CYGWIN*)
            if agentic_os_centre_install_current_unix_shortcut "$centre_script"; then
                case "$AGENTIC_OS_CENTRE_LAST_ACTION" in
                    added)
                        success "Added 'centre' to $(basename "$AGENTIC_OS_CENTRE_CURRENT_TARGET_PATH")"
                        ;;
                    updated)
                        success "Updated 'centre' in $(basename "$AGENTIC_OS_CENTRE_CURRENT_TARGET_PATH")"
                        ;;
                    *)
                        success "Shortcut already current in $(basename "$AGENTIC_OS_CENTRE_CURRENT_TARGET_PATH")"
                        ;;
                esac
            fi
            if command -v powershell.exe &>/dev/null; then
                if powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$SCRIPT_DIR/install-centre-alias.ps1")"; then
                    success "Installed PowerShell shortcut"
                    LAUNCHER_DECISION="installed"
                else
                    warn "PowerShell shortcut install failed."
                    LAUNCHER_DECISION="failed"
                fi
            else
                warn "PowerShell not found. Skipping PowerShell shortcut install."
                LAUNCHER_DECISION="partial"
            fi
            ;;
        *)
            warn "Unknown environment. Install the shortcut manually:"
            echo "    $manual_alias_line"
            LAUNCHER_DECISION="manual-required"
            ;;
    esac

    return 0
}

mark_guided_complete() {
    run_helper state-mark-guided \
        --github "$GITHUB_DECISION" \
        --gsd "$GSD_DECISION" \
        --launcher "$LAUNCHER_DECISION" \
        --memory "$MEMORY_DECISION" \
        --bootstrap-valid true >/dev/null
}

mark_repair_complete() {
    run_helper state-mark-repair --bootstrap-valid true >/dev/null
    return 0
}

run_repair_mode() {
    check_prerequisites
    ensure_local_bootstrap
    mark_repair_complete
}

run_guided_mode() {
    print_banner
    check_prerequisites
    echo ""
    ensure_local_bootstrap
    echo ""
    run_dependency_setup
    setup_searchable_memory
    setup_github_repo
    install_gsd
    install_launcher_alias
    mark_guided_complete

    echo ""
    printf "${CYAN}${BOLD}Installation Complete${NC}\n"
    echo ""
    echo "  Next steps:"
    echo "    1. Run 'centre' (or 'bash scripts/centre.sh') to open the Command Centre"
    echo "    2. Run 'claude' when you want to start working in the terminal"
    echo ""
}

if [[ "$MODE" == "repair" ]]; then
    run_repair_mode
    exit 0
fi

run_guided_mode

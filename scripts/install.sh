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

# A missing lib would otherwise end the run with a bare `set -e` exit (AIOS-473).
for required_lib in python.sh centre-shortcut.sh gsd-migration.sh; do
    if [[ ! -f "$SCRIPT_DIR/lib/$required_lib" ]]; then
        printf "AI-OS cannot continue: scripts/lib/%s is missing.\n" "$required_lib" >&2
        printf "Restore it from the AI-OS repo, then run this again:\n" >&2
        printf "  git fetch upstream main\n" >&2
        printf "  git checkout upstream/main -- scripts/lib/%s\n" "$required_lib" >&2
        printf "  git commit -m \"Restore scripts/lib/%s\"\n" "$required_lib" >&2
        printf "Use 'origin' instead of 'upstream' if that is the remote pointing at the AI-OS repo.\n" >&2
        exit 1
    fi
done

source "$SCRIPT_DIR/lib/python.sh"
source "$SCRIPT_DIR/lib/centre-shortcut.sh"
source "$SCRIPT_DIR/lib/gsd-migration.sh"

case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) REPO_ROOT="$(cygpath -m "$REPO_ROOT")" ;;
esac

HELPER_SCRIPT="$SCRIPT_DIR/launcher-bootstrap.py"
SETUP_SCRIPT="$SCRIPT_DIR/setup.sh"
MEMORY_SETUP_SCRIPT="$SCRIPT_DIR/setup-memory.sh"
CRON_DRY_RUN="${AI_OS_CRON_DRY_RUN:-0}"
AI_OS_VERSION="$(cat "$REPO_ROOT/VERSION" 2>/dev/null || echo "unknown")"

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

claude_code_available() {
    if [[ -n "${AI_OS_CLAUDE_BIN:-}" ]]; then
        if command -v "$AI_OS_CLAUDE_BIN" >/dev/null 2>&1; then
            return 0
        fi
        if [[ -x "$AI_OS_CLAUDE_BIN" ]]; then
            return 0
        fi
        if is_windows_shell && [[ -f "$AI_OS_CLAUDE_BIN" ]]; then
            return 0
        fi
        return 1
    fi

    command -v claude >/dev/null 2>&1 ||
        command -v claude.exe >/dev/null 2>&1 ||
        command -v claude.cmd >/dev/null 2>&1
}

append_windows_path_to_current_path() {
    local win_path="$1"
    local shell_path=""

    if ! command -v cygpath >/dev/null 2>&1; then
        return 0
    fi

    shell_path="$(cygpath -u "$win_path" 2>/dev/null || true)"
    if [[ -z "$shell_path" || ! -d "$shell_path" ]]; then
        return 0
    fi

    case ":$PATH:" in
        *":$shell_path:"*) ;;
        *)
            PATH="$PATH:$shell_path"
            export PATH
            ;;
    esac
}

repair_windows_claude_code_path() {
    if ! is_windows_shell || ! command -v powershell.exe >/dev/null 2>&1; then
        return 1
    fi

    local output=""
    local status=0
    output="$(powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command - <<'POWERSHELL'
$ErrorActionPreference = "Stop"

function Normalize-PathForComparison {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ""
    }
    $expanded = [Environment]::ExpandEnvironmentVariables($Path.Trim().Trim('"'))
    try {
        $fullPath = [System.IO.Path]::GetFullPath($expanded)
    }
    catch {
        $fullPath = $expanded
    }
    return ($fullPath -replace '[\\/]+$', '').ToLowerInvariant()
}

function Test-PathListContains {
    param(
        [string[]]$Entries,
        [string]$Path
    )
    $target = Normalize-PathForComparison $Path
    if (-not $target) {
        return $false
    }
    foreach ($entry in $Entries) {
        if ((Normalize-PathForComparison $entry) -eq $target) {
            return $true
        }
    }
    return $false
}

function Get-PathEntries {
    param([AllowNull()][string]$PathValue)
    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return @()
    }
    return @($PathValue -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

try {
    $candidates = @()

    if ($env:USERPROFILE) {
        $localBin = Join-Path $env:USERPROFILE ".local\bin"
        if (Test-Path -LiteralPath $localBin -PathType Container) {
            foreach ($shim in @("claude", "claude.exe", "claude.cmd")) {
                if (Test-Path -LiteralPath (Join-Path $localBin $shim) -PathType Leaf) {
                    $candidates += $localBin
                    break
                }
            }
        }
    }

    $gitBin = "C:\Program Files\Git\bin"
    if (Test-Path -LiteralPath $gitBin -PathType Container) {
        $candidates += $gitBin
    }

    $userEntries = @(Get-PathEntries ([Environment]::GetEnvironmentVariable("Path", "User")))
    $processEntries = @(Get-PathEntries $env:Path)
    $added = @()

    foreach ($candidate in @($candidates | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Container)) {
            continue
        }

        $resolved = (Resolve-Path -LiteralPath $candidate).ProviderPath
        Write-Output "AIOS_PATH_CANDIDATE=$resolved"

        if (-not (Test-PathListContains -Entries $userEntries -Path $resolved)) {
            $userEntries += $resolved
            $added += $resolved
        }

        if (-not (Test-PathListContains -Entries $processEntries -Path $resolved)) {
            $env:Path = if ([string]::IsNullOrWhiteSpace($env:Path)) {
                $resolved
            }
            else {
                "$env:Path;$resolved"
            }
            $processEntries += $resolved
        }
    }

    if ($added.Count -gt 0) {
        [Environment]::SetEnvironmentVariable("Path", ($userEntries -join ";"), "User")
        foreach ($path in $added) {
            Write-Output "AIOS_PATH_ADDED=$path"
        }
    }
}
catch {
    Write-Output "AIOS_PATH_ERROR=$($_.Exception.Message)"
    exit 1
}
POWERSHELL
)" || status=$?

    local line=""
    local value=""
    local added_any=0
    local error_message=""

    while IFS= read -r line; do
        line="${line%$'\r'}"
        case "$line" in
            AIOS_PATH_CANDIDATE=*)
                value="${line#AIOS_PATH_CANDIDATE=}"
                append_windows_path_to_current_path "$value"
                ;;
            AIOS_PATH_ADDED=*)
                value="${line#AIOS_PATH_ADDED=}"
                success "Added $value to your Windows User PATH"
                added_any=1
                append_windows_path_to_current_path "$value"
                ;;
            AIOS_PATH_ERROR=*)
                error_message="${line#AIOS_PATH_ERROR=}"
                ;;
        esac
    done <<< "$output"

    if [[ $status -ne 0 ]]; then
        if [[ -n "$error_message" ]]; then
            warn "Could not update your Windows User PATH automatically: $error_message"
        else
            warn "Could not update your Windows User PATH automatically."
        fi
        return 1
    fi

    [[ $added_any -eq 1 ]]
}

warn_if_claude_code_missing() {
    if claude_code_available; then
        success "Claude Code CLI detected"
        return 0
    fi

    local path_repaired=0
    if is_windows_shell; then
        if repair_windows_claude_code_path; then
            path_repaired=1
        fi

        if claude_code_available; then
            success "Claude Code CLI detected after PATH repair"
            if [[ $path_repaired -eq 1 ]]; then
                warn "Open a new terminal after install so Windows reloads PATH."
            fi
            return 0
        fi
    fi

    if command -v codex >/dev/null 2>&1; then
        success "Codex CLI detected; direct AI-OS sessions are ready"
        warn "Command Centre chat and cron jobs also need Claude Code."
        return 0
    fi
    warn "Install Codex or Claude Code for direct AI-OS sessions; Command Centre chat and cron jobs need Claude Code."
    if [[ $path_repaired -eq 1 ]]; then
        echo "      AI-OS updated your Windows User PATH. Open a new terminal before running tasks."
    else
        echo "      Install Claude Code, then open a new terminal before running tasks."
    fi
    echo "      Docs: https://code.claude.com/docs/en/setup"

    if [[ -n "${AI_OS_CLAUDE_BIN:-}" ]]; then
        echo "      AI_OS_CLAUDE_BIN is set, but that command or path was not found."
    fi

    if is_windows_shell; then
        echo "      Windows PowerShell: irm https://claude.ai/install.ps1 | iex"
        echo "      Windows CMD: curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd"
        echo "      Windows WinGet: winget install Anthropic.ClaudeCode"
    else
        echo "      macOS/Linux/WSL: curl -fsSL https://claude.ai/install.sh | bash"
    fi
}

TOTAL_STEPS=6

print_step() {
    local step="$1"
    local title="$2"
    echo ""
    printf "${CYAN}${BOLD}── Step ${step}/${TOTAL_STEPS}: ${title}${NC}\n"
    echo ""
}

print_status_row() {
    local label="$1"
    local decision="$2"
    local status_text status_color
    case "$decision" in
        configured|installed|both|claude|codex)
            status_text="✓ Done"
            status_color="$GREEN"
            ;;
        already-installed)
            status_text="✓ Already installed"
            status_color="$GREEN"
            ;;
        ready)
            status_text="✓ Ready"
            status_color="$GREEN"
            ;;
        skipped|skipped-*)
            status_text="⊖ Skipped"
            status_color="$DIM"
            ;;
        manual-required|pending-auth)
            status_text="! Manual step needed"
            status_color="$YELLOW"
            ;;
        unavailable)
            status_text="⊖ Not available"
            status_color="$DIM"
            ;;
        failed)
            status_text="✗ Failed"
            status_color="$RED"
            ;;
        migration-declined)
            status_text="⊖ Kept existing"
            status_color="$DIM"
            ;;
        *)
            status_text="– ${decision}"
            status_color="$DIM"
            ;;
    esac
    printf "  %-28s ${status_color}%s${NC}\n" "$label" "$status_text"
}

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

sanitize_install_git_url() {
    local url="${1:-}"
    printf "%s" "$url" | sed -E 's#(https?://)[^/@]+@#\1<token>@#g'
}

install_github_cli() {
    if command -v gh &>/dev/null; then
        return 0
    fi

    warn "GitHub CLI (gh) is not installed."
    echo "  Git is still the required tool. GitHub CLI only helps this installer"
    echo "  create your private backup repository automatically."
    echo ""

    if ! ask_yes_no "Install GitHub CLI now?" "Y"; then
        return 1
    fi

    case "$(uname -s)" in
        Darwin*)
            if command -v brew &>/dev/null; then
                brew install gh || return 1
            else
                warn "Homebrew is not installed."
                echo "  Install GitHub CLI from: https://cli.github.com/"
                return 1
            fi
            ;;
        MINGW*|MSYS*|CYGWIN*)
            if command -v winget &>/dev/null; then
                winget install --id GitHub.cli -e --silent || return 1
            elif command -v choco &>/dev/null; then
                choco install gh -y || return 1
            else
                warn "No Windows package manager found."
                echo "  Install GitHub CLI from: https://cli.github.com/"
                return 1
            fi
            ;;
        *)
            warn "Automatic GitHub CLI install is not available for this system."
            echo "  Install GitHub CLI from: https://cli.github.com/"
            return 1
            ;;
    esac

    if command -v gh &>/dev/null; then
        success "GitHub CLI installed"
        return 0
    fi

    warn "GitHub CLI was installed, but this terminal cannot find it yet."
    echo "  Close and reopen the terminal, then run the installer again."
    return 1
}

ensure_github_cli_auth() {
    if gh auth status &>/dev/null 2>&1; then
        return 0
    fi

    warn "GitHub CLI is not logged in yet."
    echo "  A browser window may open, or GitHub may show a short code to copy."
    echo "  Follow GitHub's instructions, then come back to this terminal."
    echo ""

    if ! ask_yes_no "Start GitHub login now?" "Y"; then
        return 1
    fi

    gh auth login -h github.com -w || return 1
    gh auth status &>/dev/null 2>&1
}

print_github_backup_manual_fallback() {
    local is_upstream="$1"

    echo "  Manual fallback:"
    echo "    1. Open https://github.com/new"
    echo "    2. Create a new PRIVATE repository"
    if [[ "$is_upstream" == "1" ]]; then
        echo "    3. Run: git remote rename origin upstream"
        echo "    4. Run: git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git"
        echo "    5. Run: git push -u origin main"
    else
        echo "    3. Run: git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git"
        echo "    4. Run: git push -u origin main"
    fi
}

print_banner() {
    clear 2>/dev/null || true
    echo ""
    printf "${CYAN}${BOLD}"
    cat <<'BANNER'
    ╔══════════════════════════════════════════════╗
    ║                                              ║
    ║                   AI-OS                      ║
    ║                                              ║
    ║          Guided First-Time Install           ║
    ║                                              ║
    ╚══════════════════════════════════════════════╝
BANNER
    printf "${NC}"
    if [[ "$AI_OS_VERSION" == "unknown" ]]; then
        printf "    ${DIM}AI-OS version unknown${NC}\n"
    else
        printf "    ${DIM}AI-OS v%s${NC}\n" "$AI_OS_VERSION"
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
        warn "Node.js not found - the command centre will not run until Node is installed."
    fi

    if resolve_python_cmd; then
        [[ "$MODE" == "guided" ]] && success "Python $PYTHON_VERSION via $PYTHON_LABEL"
        if is_windows_shell && [[ $PYTHON3_DIAGNOSTIC_BROKEN -eq 1 ]]; then
            warn "Windows exposes a broken python3 at ${PYTHON3_DIAGNOSTIC_PATH}."
            warn "AI-OS will use '${PYTHON_LABEL}' instead."
        fi
    else
        fail "Python 3 not found - install from https://www.python.org/downloads/"
        prereq_fail=1
    fi

    if [[ "$MODE" == "guided" ]]; then
        warn_if_claude_code_missing
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
    if [[ "$CRON_DRY_RUN" == "1" ]]; then
        warn "Dry run mode active - skipping memory migration/setup."
        MEMORY_DECISION="skipped-dry-run"
        return 0
    fi

    if [[ ! -f "$MEMORY_SETUP_SCRIPT" ]]; then
        warn "setup-memory.sh not found - skipping memory migration/setup."
        MEMORY_DECISION="unavailable"
        return 0
    fi

    if bash "$MEMORY_SETUP_SCRIPT" --check >/dev/null 2>&1; then
        success "Memory migration/setup already complete"
        MEMORY_DECISION="configured"
        return 0
    fi

    echo ""
    echo "  AI-OS will set up semantic memory using the BGE-M3 embedding model."
    echo "  If it is not cached yet, it will be downloaded now and this may take several minutes."

    local exit_code
    set +e
    bash "$MEMORY_SETUP_SCRIPT"
    exit_code=$?
    set -e

    if [[ $exit_code -eq 0 ]]; then
        success "Memory migration/setup finished"
        MEMORY_DECISION="configured"
        return 0
    fi

    if [[ $exit_code -eq 3 ]]; then
        warn "Skipped memory migration/setup."
        MEMORY_DECISION="skipped-confirmation"
        return 0
    fi

    warn "Memory migration/setup did not finish. You can retry later:"
    echo "    bash scripts/setup-memory.sh"
    MEMORY_DECISION="failed"
    return 0
}

setup_github_repo() {
    local upstream_owner="camrontaylor"
    local upstream_repo="AI-OS-Template"
    local origin_url=""
    local is_upstream=0

    origin_url="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || echo "")"
    if [[ "$origin_url" == *"${upstream_owner}/${upstream_repo}"* ]]; then
        is_upstream=1
    fi

    if [[ -n "$origin_url" ]] && [[ $is_upstream -eq 0 ]]; then
        success "GitHub backup already configured: $(sanitize_install_git_url "$origin_url")"
        GITHUB_DECISION="configured"
        return 0
    fi

    echo ""
    printf "${CYAN}${BOLD}GitHub Backup${NC}\n"
    echo "  AI-OS stores your brand, project, and summarized memory data locally."
    echo "  This step can create a private GitHub repository in your account"
    echo "  and push a first backup there."
    echo "  It includes context/memory/*.aos.md so memory can be rebuilt later."
    echo "  Raw transcripts and built memory databases stay local."
    echo ""
    echo "  You need:"
    echo "    - git, which is already required for AI-OS"
    echo "    - GitHub CLI (gh), which helps create the private repo"
    echo "    - a GitHub browser login when gh asks for it"
    echo ""

    if ! ask_yes_no "Set up private GitHub backup now?"; then
        warn "Skipped GitHub backup setup."
        GITHUB_DECISION="skipped"
        return 0
    fi

    if ! install_github_cli; then
        print_github_backup_manual_fallback "$is_upstream"
        GITHUB_DECISION="manual-required"
        return 0
    fi

    if ! ensure_github_cli_auth; then
        warn "GitHub login did not finish."
        echo "  You can run this installer again later, or use the manual fallback:"
        print_github_backup_manual_fallback "$is_upstream"
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

    printf "  Logged in as: ${BOLD}%s${NC}\n" "$gh_user"
    echo "  The backup repo will be private by default."
    printf "  Repo name? ${DIM}[${default_repo}]${NC} "
    read -r repo_name
    repo_name="${repo_name:-$default_repo}"

    # If origin still points at the canonical repo, move it to `upstream` BEFORE
    # creating the fork. Otherwise `gh repo create --remote=origin` collides with
    # the existing origin remote and silently fails — leaving the user with no
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
        info "Pushing your first backup..."
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
        warn "Canonical repo is now at the 'upstream' remote — updates will still work."
    fi
    print_github_backup_manual_fallback "0"
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

    if ai_os_gsd_offer_legacy_migration "$REPO_ROOT"; then
        if [[ "$AI_OS_GSD_MIGRATION_RESULT" != "cleaned" ]]; then
            if redux_version="$(ai_os_gsd_redux_version "$REPO_ROOT")"; then
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

    if ai_os_gsd_install_redux 2>/dev/null; then
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
    manual_alias_line="$(ai_os_centre_build_alias_line "posix" "$centre_script")"

    case "$(uname -s)" in
        Darwin|Linux)
            if ! ai_os_centre_install_current_unix_shortcut "$centre_script"; then
                warn "Unknown shell. Install the shortcut manually:"
                echo "    $manual_alias_line"
                LAUNCHER_DECISION="manual-required"
                return 0
            fi

            case "$AI_OS_CENTRE_LAST_ACTION" in
                added)
                    success "Added 'centre' to $(basename "$AI_OS_CENTRE_CURRENT_TARGET_PATH")"
                    ;;
                updated)
                    success "Updated 'centre' in $(basename "$AI_OS_CENTRE_CURRENT_TARGET_PATH")"
                    ;;
                *)
                    success "Shortcut already current in $(basename "$AI_OS_CENTRE_CURRENT_TARGET_PATH")"
                    ;;
            esac

            [[ -n "$AI_OS_CENTRE_CURRENT_RELOAD_HINT" ]] && \
                warn "Open a new terminal or run '$AI_OS_CENTRE_CURRENT_RELOAD_HINT' to activate 'centre'."
            LAUNCHER_DECISION="installed"
            ;;
        MINGW*|MSYS*|CYGWIN*)
            if ai_os_centre_install_current_unix_shortcut "$centre_script"; then
                case "$AI_OS_CENTRE_LAST_ACTION" in
                    added)
                        success "Added 'centre' to $(basename "$AI_OS_CENTRE_CURRENT_TARGET_PATH")"
                        ;;
                    updated)
                        success "Updated 'centre' in $(basename "$AI_OS_CENTRE_CURRENT_TARGET_PATH")"
                        ;;
                    *)
                        success "Shortcut already current in $(basename "$AI_OS_CENTRE_CURRENT_TARGET_PATH")"
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

    print_step 1 "Prerequisites"
    check_prerequisites

    print_step 2 "Bootstrap Files"
    ensure_local_bootstrap
    echo ""
    run_dependency_setup

    print_step 3 "Searchable Memory"
    setup_searchable_memory

    print_step 4 "GitHub Backup"
    setup_github_repo

    print_step 5 "GSD Project Framework"
    install_gsd

    print_step 6 "Centre Shortcut"
    install_launcher_alias

    mark_guided_complete

    echo ""
    if [[ "$AI_OS_VERSION" != "unknown" ]]; then
        printf "  ${CYAN}${BOLD}AI-OS${NC}%*sv${DIM}%s${NC}\n" 48 "" "$AI_OS_VERSION"
    else
        printf "  ${CYAN}${BOLD}AI-OS${NC}\n"
    fi
    printf "  ${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
    echo ""
    printf "  ${BOLD}SETUP COMPLETE${NC} ${DIM}────────────────────────────────────────────────────${NC}\n"
    echo ""
    print_status_row "Prerequisites"      "ready"
    print_status_row "Searchable Memory"  "$MEMORY_DECISION"
    print_status_row "GitHub Backup"      "$GITHUB_DECISION"
    print_status_row "GSD Framework"      "$GSD_DECISION"
    print_status_row "Centre Shortcut"    "$LAUNCHER_DECISION"
    echo ""
    printf "  ${BOLD}NEXT${NC} ${DIM}────────────────────────────────────────────────────────────────${NC}\n"
    echo ""
    printf "  ${DIM}The OS installed into the folder below. When setup finishes your\n"
    printf "  terminal is one level up — move into it first, or ${NC}${BOLD}/start-here${NC}${DIM} won't\n"
    printf "  be available:${NC}\n"
    echo ""
    printf "  ${CYAN}01${NC}  ${BOLD}cd \"%s\"${NC}\n" "$REPO_ROOT"
    printf "  ${CYAN}02${NC}  ${BOLD}bash scripts/centre.sh${NC}      Open the Command Centre\n"
    printf "  ${CYAN}03${NC}  ${BOLD}claude${NC}                       Start working in the terminal\n"
    printf "  ${CYAN}04${NC}  ${BOLD}/start-here${NC}                  Set up your brand on first session\n"
    echo ""
}

if [[ "$MODE" == "repair" ]]; then
    run_repair_mode
    exit 0
fi

run_guided_mode

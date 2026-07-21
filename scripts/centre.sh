#!/usr/bin/env bash
set -euo pipefail

# AI-OS - Command Centre Launcher
#
# Usage:
#   bash scripts/centre.sh
#   bash scripts/centre.sh --clean
#   centre

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
CENTRE_DIR="$REPO_ROOT/command-centre"
PORT="${PORT:-3000}"
URL="http://localhost:${PORT}"

source "$SCRIPT_DIR/lib/python.sh"

HELPER_SCRIPT="$SCRIPT_DIR/launcher-bootstrap.py"
INSTALL_SCRIPT="$SCRIPT_DIR/install.sh"
SETUP_SCRIPT="$SCRIPT_DIR/setup.sh"

if is_windows_shell && command -v cygpath >/dev/null 2>&1; then
    REPO_ROOT="$(cygpath -m "$REPO_ROOT")"
    HELPER_SCRIPT="$(cygpath -m "$HELPER_SCRIPT")"
    INSTALL_SCRIPT="$(cygpath -m "$INSTALL_SCRIPT")"
    SETUP_SCRIPT="$(cygpath -m "$SETUP_SCRIPT")"
fi

CLEAN=0
for arg in "$@"; do
    case "$arg" in
        --clean) CLEAN=1 ;;
        -h|--help)
            cat <<'EOF'
AI-OS command centre launcher

Usage:
  bash scripts/centre.sh
  bash scripts/centre.sh --clean
  centre

What it does:
  1. Reuses an already-running UI if one exists.
  2. Runs the guided installer on first launch.
  3. Repairs missing bootstrap files silently on later launches.
  4. Repairs dependencies when setup checks fail.
  5. Starts the Command Centre and opens the browser.
EOF
            exit 0
            ;;
    esac
done

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

info()    { printf "${CYAN}%s${NC}\n" "$1"; }
success() { printf "${GREEN}  ✓ %s${NC}\n" "$1"; }
warn()    { printf "${YELLOW}  ! %s${NC}\n" "$1"; }
fail()    { printf "${RED}  ✗ %s${NC}\n" "$1"; }

open_browser() {
    if command -v open &>/dev/null; then
        open "$URL" 2>/dev/null || true
    elif command -v xdg-open &>/dev/null; then
        xdg-open "$URL" 2>/dev/null || true
    elif is_windows_shell && command -v powershell.exe &>/dev/null; then
        powershell.exe -NoProfile -Command "Start-Process '$URL'" >/dev/null 2>&1 || true
    fi
}

python_helper_field() {
    local command_name="$1"
    local field_name="$2"
    "${PYTHON_CMD[@]}" "$HELPER_SCRIPT" --repo-root "$REPO_ROOT" "$command_name" --field "$field_name"
}

if [[ ! -d "$CENTRE_DIR" ]]; then
    fail "Command centre not found at: $CENTRE_DIR"
    exit 1
fi

# If the centre already responds on the port, just open the browser and exit.
if command -v curl &>/dev/null && curl -sf -o /dev/null --max-time 1 "$URL"; then
    info "Command centre already running at $URL - opening browser."
    open_browser
    exit 0
fi

if ! resolve_python_cmd; then
    info "Python 3 is missing. Running the guided installer so it can explain what is required."
    bash "$INSTALL_SCRIPT" --guided
    resolve_python_cmd || exit 1
fi

legacy_install_detected="$(python_helper_field state-status legacy_install_detected)"
if [[ "$legacy_install_detected" == "true" ]]; then
    info "Existing installation detected - recording launcher state so you are not asked setup questions again."
    "${PYTHON_CMD[@]}" "$HELPER_SCRIPT" --repo-root "$REPO_ROOT" state-migrate-legacy >/dev/null
fi

guided_install_completed="$(python_helper_field state-status guided_install_completed)"
if [[ "$guided_install_completed" != "true" ]]; then
    info "First launch detected - starting the guided install."
    bash "$INSTALL_SCRIPT" --guided
else
    bootstrap_valid="$(python_helper_field bootstrap-status bootstrap_valid)"
    if [[ "$bootstrap_valid" != "true" ]]; then
        info "Some local bootstrap files are missing - repairing them silently."
        bash "$INSTALL_SCRIPT" --repair
    fi
fi

if [[ -f "$SETUP_SCRIPT" ]]; then
    if ! bash "$SETUP_SCRIPT" --check --silent; then
        info "Some dependencies are missing - repairing them now."
        bash "$SETUP_SCRIPT" --silent || true
    fi
fi

if ! command -v node &>/dev/null; then
    fail "Node.js is required. Install it from https://nodejs.org/"
    exit 1
fi

if ! command -v npm &>/dev/null; then
    fail "npm is required (it ships with Node.js)."
    exit 1
fi

cd "$CENTRE_DIR"

if [[ "$CLEAN" -eq 1 ]] && [[ -d ".next" ]]; then
    info "Cleaning .next/ cache..."
    rm -rf .next
    success "Cache cleared"
fi

if [[ ! -d "node_modules" ]]; then
    info "First run for the Command Centre - installing npm dependencies..."
    npm install
    success "Dependencies installed"
    echo ""
fi

printf "${CYAN}${BOLD}"
cat <<'BANNER'
    ╔══════════════════════════════════════════════╗
    ║          A G E N T I C   O S                 ║
    ║              Command Centre                  ║
    ╚══════════════════════════════════════════════╝
BANNER
printf "${NC}\n"
info "Starting on ${URL}"
echo ""

(
    sleep 3
    open_browser
) &

exec npm run dev

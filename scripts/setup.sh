#!/usr/bin/env bash
set -uo pipefail

# AI-OS - Dependency Setup
# Supports:
#   bash scripts/setup.sh
#   bash scripts/setup.sh --check
#   bash scripts/setup.sh --silent
#   bash scripts/setup.sh --check --silent

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
source "$SCRIPT_DIR/lib/python.sh"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

CHECK_ONLY=0
SILENT=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --check)
            CHECK_ONLY=1
            ;;
        --silent)
            SILENT=1
            ;;
        -h|--help)
            cat <<'EOF'
AI-OS dependency setup

Usage:
  bash scripts/setup.sh
  bash scripts/setup.sh --check
  bash scripts/setup.sh --silent
  bash scripts/setup.sh --check --silent

Modes:
  --check   Only verify whether required dependencies are missing.
  --silent  Reduce script output for launcher-driven repairs.
EOF
            exit 0
            ;;
        *)
            printf "${RED}Unknown argument: %s${NC}\n" "$1" >&2
            exit 1
            ;;
    esac
    shift
done

say() {
    if [[ $SILENT -eq 0 ]]; then
        printf "%s\n" "$1"
    fi
}

ok() {
    if [[ $SILENT -eq 0 ]]; then
        printf "${GREEN}  ✓ %s${NC}\n" "$1"
    fi
}

warn() {
    if [[ $SILENT -eq 0 ]]; then
        printf "${YELLOW}  ! %s${NC}\n" "$1"
    fi
}

fail() {
    if [[ $SILENT -eq 0 ]]; then
        printf "${RED}  ✗ %s${NC}\n" "$1"
    fi
}

installed() { command -v "$1" &>/dev/null; }

run_install() {
    local label="$1"
    shift

    if [[ $CHECK_ONLY -eq 1 ]]; then
        record_missing "$label"
        return 1
    fi

    if "$@"; then
        ok "$label installed"
        return 0
    fi

    fail "$label install failed"
    record_missing "$label"
    return 1
}

record_missing() {
    local label="$1"
    MISSING_ITEMS+=("$label")
    return 1
}

OS="unknown"
case "$(uname -s)" in
    Darwin*) OS="mac" ;;
    MINGW*|MSYS*|CYGWIN*) OS="windows" ;;
    Linux*) OS="linux" ;;
esac

WIN_PKG=""
ERRORS=0
MISSING_ITEMS=()

if [[ $SILENT -eq 0 ]]; then
    echo ""
    echo "========================================="
    echo "  AI-OS - Dependency Setup"
    echo "========================================="
    echo ""
    printf "  Platform: %s\n" "$OS"
    echo ""
fi

if [[ "$OS" == "mac" ]]; then
    say "Checking brew..."
    if installed brew; then
        ok "brew found"
    else
        fail "brew not found - install from https://brew.sh"
        record_missing "brew"
        ERRORS=$((ERRORS + 1))
    fi
elif [[ "$OS" == "windows" ]]; then
    say "Checking package manager..."
    if installed winget; then
        WIN_PKG="winget"
        ok "winget found"
    elif installed choco; then
        WIN_PKG="choco"
        ok "choco found"
    else
        warn "No package manager found (winget or choco). Some installs may need manual help."
    fi
fi

say "Checking Python 3..."
if resolve_python_cmd; then
    ok "$PYTHON_VERSION via $PYTHON_LABEL"
    if is_windows_shell && [[ $PYTHON3_DIAGNOSTIC_BROKEN -eq 1 ]]; then
        warn "Windows exposes a broken python3 at ${PYTHON3_DIAGNOSTIC_PATH}."
        warn "AI-OS will use '${PYTHON_LABEL}' instead."
    fi
else
    fail "Python 3 not found"
    record_missing "python3"
    ERRORS=$((ERRORS + 1))
fi

say "Checking uv..."
if installed uv; then
    ok "uv $(uv --version 2>&1 | awk '{print $2}')"
else
    warn "uv missing"
    if [[ "$OS" == "mac" ]] && installed brew; then
        run_install "uv" brew install uv || ERRORS=$((ERRORS + 1))
    elif [[ "$OS" == "windows" ]] && [[ "$WIN_PKG" == "winget" ]]; then
        run_install "uv" winget install --id astral-sh.uv -e --silent || ERRORS=$((ERRORS + 1))
    elif [[ "$OS" == "windows" ]] && [[ "$WIN_PKG" == "choco" ]]; then
        run_install "uv" choco install uv -y || ERRORS=$((ERRORS + 1))
    elif installed curl; then
        run_install "uv" bash -lc "curl -LsSf https://astral.sh/uv/install.sh | sh" || ERRORS=$((ERRORS + 1))
    else
        record_missing "uv"
        ERRORS=$((ERRORS + 1))
    fi
fi

say "Checking yt-dlp..."
if installed yt-dlp; then
    ok "yt-dlp found"
else
    warn "yt-dlp missing"
    if [[ "$OS" == "mac" ]] && installed brew; then
        run_install "yt-dlp" brew install yt-dlp || ERRORS=$((ERRORS + 1))
    elif [[ "$OS" == "windows" ]] && [[ "$WIN_PKG" == "winget" ]]; then
        run_install "yt-dlp" winget install --id yt-dlp.yt-dlp -e --silent || ERRORS=$((ERRORS + 1))
    elif resolve_python_cmd; then
        run_install "yt-dlp" "${PYTHON_CMD[@]}" -m pip install yt-dlp || ERRORS=$((ERRORS + 1))
    else
        record_missing "yt-dlp"
        ERRORS=$((ERRORS + 1))
    fi
fi

say "Checking ffmpeg..."
if installed ffmpeg; then
    ok "ffmpeg found"
else
    warn "ffmpeg missing"
    if [[ "$OS" == "mac" ]] && installed brew; then
        run_install "ffmpeg" brew install ffmpeg || ERRORS=$((ERRORS + 1))
    elif [[ "$OS" == "windows" ]] && [[ "$WIN_PKG" == "winget" ]]; then
        run_install "ffmpeg" winget install --id Gyan.FFmpeg -e --silent || ERRORS=$((ERRORS + 1))
    elif [[ "$OS" == "windows" ]] && [[ "$WIN_PKG" == "choco" ]]; then
        run_install "ffmpeg" choco install ffmpeg -y || ERRORS=$((ERRORS + 1))
    else
        record_missing "ffmpeg"
        ERRORS=$((ERRORS + 1))
    fi
fi

if [[ $CHECK_ONLY -eq 1 ]]; then
    if [[ $ERRORS -eq 0 ]]; then
        exit 0
    fi
    exit 1
fi

if [[ $SILENT -eq 0 ]]; then
    echo ""
    echo "========================================="
    if [[ $ERRORS -eq 0 ]]; then
        printf "${GREEN}  All dependency checks passed.${NC}\n"
    else
        printf "${YELLOW}  %d dependency issue(s) still need attention.${NC}\n" "$ERRORS"
        printf "${YELLOW}  Missing items: %s${NC}\n" "${MISSING_ITEMS[*]:-unknown}"
    fi
    echo "========================================="
    echo ""
fi

# Keep manual setup non-blocking for compatibility.
exit 0

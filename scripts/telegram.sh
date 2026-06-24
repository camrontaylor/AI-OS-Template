#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# AI-OS - Telegram Channel Launcher
# =============================================================================
# Starts Claude Code with the Telegram channels plugin so you can chat with
# AI-OS from Telegram.
#
# Usage:
#   bash scripts/telegram.sh              # from repo root
#   telegram                              # from anywhere, if alias is installed
#   telegram --install-alias              # add 'telegram' shell alias
#
# Prerequisites:
#   - Claude Code v2.1.80+ (run: claude update)
#   - Bun runtime (https://bun.sh)
#   - Telegram bot token from @BotFather
#   - TELEGRAM_BOT_TOKEN in .env
#   - TELEGRAM_ALLOWED_USERS in .env (comma-separated Telegram user IDs)
#
# What it does:
#   1. Validates prerequisites (claude CLI, bun, bot token).
#   2. Checks Claude Code version is 2.1.80+.
#   3. Starts Claude Code with --channels plugin:telegram@claude-plugins-official
#      inside the AI-OS workspace.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
MIN_VERSION="2.1.80"

# ---------- Colors ----------
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()    { printf "${CYAN}%s${NC}\n" "$1"; }
success() { printf "${GREEN}  ✓ %s${NC}\n" "$1"; }
warn()    { printf "${YELLOW}  ! %s${NC}\n" "$1"; }
fail()    { printf "${RED}  ✗ %s${NC}\n" "$1"; }

# ---------- Parse args ----------
INSTALL_ALIAS=0
for arg in "$@"; do
    case "$arg" in
        --install-alias) INSTALL_ALIAS=1 ;;
        -h|--help)
            sed -n '4,22p' "$0"
            exit 0
            ;;
    esac
done

# ---------- Alias installer ----------
if [[ "$INSTALL_ALIAS" -eq 1 ]]; then
    ALIAS_LINE="alias telegram='bash \"$SCRIPT_DIR/telegram.sh\"'"
    ALIAS_MARKER="# AI-OS - telegram channel launcher"
    USER_SHELL_NAME="$(basename "${SHELL:-bash}")"

    install_alias_into() {
        local rc="$1"
        touch "$rc"
        if grep -Fq "$ALIAS_MARKER" "$rc" 2>/dev/null; then
            success "Alias already present in $(basename "$rc")"
            return 0
        fi
        { echo ""; echo "$ALIAS_MARKER"; echo "$ALIAS_LINE"; } >> "$rc"
        success "Added 'telegram' alias to $(basename "$rc")"
    }

    case "$USER_SHELL_NAME" in
        zsh)  install_alias_into "$HOME/.zshrc" ;;
        bash)
            if [[ "$(uname -s)" == "Darwin" ]]; then
                install_alias_into "$HOME/.bash_profile"
            else
                install_alias_into "$HOME/.bashrc"
            fi
            ;;
        fish)
            mkdir -p "$HOME/.config/fish"
            FISH_RC="$HOME/.config/fish/config.fish"
            touch "$FISH_RC"
            if grep -Fq "$ALIAS_MARKER" "$FISH_RC"; then
                success "Alias already present in config.fish"
            else
                { echo ""; echo "$ALIAS_MARKER"; echo "alias telegram 'bash \"$SCRIPT_DIR/telegram.sh\"'"; } >> "$FISH_RC"
                success "Added 'telegram' alias to config.fish"
            fi
            ;;
        *) warn "Unrecognised shell - add manually: $ALIAS_LINE" ;;
    esac
    echo ""
    warn "Open a new terminal to activate the alias."
    exit 0
fi

# ---------- Version comparison ----------
version_gte() {
    # Returns 0 if $1 >= $2 (semver comparison)
    local IFS=.
    local i a=($1) b=($2)
    for ((i=0; i<${#b[@]}; i++)); do
        [[ -z "${a[i]:-}" ]] && return 1
        ((10#${a[i]} > 10#${b[i]})) && return 0
        ((10#${a[i]} < 10#${b[i]})) && return 1
    done
    return 0
}

# =============================================================================
# Preflight checks
# =============================================================================
echo ""
printf "${CYAN}${BOLD}"
cat << 'BANNER'
    ╔══════════════════════════════════════════════╗
    ║                  A I - O S                   ║
    ║           Telegram Channel                   ║
    ╚══════════════════════════════════════════════╝
BANNER
printf "${NC}\n"

PREFLIGHT_FAIL=0

# Claude CLI
printf "  claude ........ "
if command -v claude &>/dev/null; then
    CLAUDE_VERSION="$(claude --version 2>/dev/null | head -1 | sed 's/[^0-9.]//g')"
    if [[ -n "$CLAUDE_VERSION" ]] && version_gte "$CLAUDE_VERSION" "$MIN_VERSION"; then
        printf "${GREEN}v${CLAUDE_VERSION}${NC}\n"
    else
        printf "${RED}v${CLAUDE_VERSION:-unknown} (need v${MIN_VERSION}+)${NC}\n"
        fail "Upgrade with: claude update"
        PREFLIGHT_FAIL=1
    fi
else
    printf "${RED}not found${NC}\n"
    fail "Install Claude Code: https://docs.anthropic.com/en/docs/claude-code"
    PREFLIGHT_FAIL=1
fi

# Bun
printf "  bun ........... "
if command -v bun &>/dev/null; then
    printf "${GREEN}$(bun --version 2>/dev/null)${NC}\n"
else
    printf "${RED}not found${NC}\n"
    fail "Install Bun: curl -fsSL https://bun.sh/install | bash"
    PREFLIGHT_FAIL=1
fi

# Bot token
printf "  bot token ..... "
telegram_bot_token="${TELEGRAM_BOT_TOKEN:-}"
if [[ -f "$REPO_ROOT/.env" ]]; then
    loaded_telegram_bot_token="$(grep -E '^TELEGRAM_BOT_TOKEN=' "$REPO_ROOT/.env" 2>/dev/null | cut -d= -f2- | tr -d '[:space:]"'"'" || true)"
    [[ -n "$loaded_telegram_bot_token" ]] && telegram_bot_token="$loaded_telegram_bot_token"
fi
if [[ -n "${telegram_bot_token:-}" ]]; then
    printf "${GREEN}configured${NC}\n"
else
    printf "${RED}missing${NC}\n"
    fail "Set TELEGRAM_BOT_TOKEN in .env (get one from @BotFather on Telegram)"
    PREFLIGHT_FAIL=1
fi

# Allowed users (access control)
printf "  access control  "
telegram_allowed_users="${TELEGRAM_ALLOWED_USERS:-}"
if [[ -f "$REPO_ROOT/.env" ]]; then
    loaded_telegram_allowed_users="$(grep -E '^TELEGRAM_ALLOWED_USERS=' "$REPO_ROOT/.env" 2>/dev/null | cut -d= -f2- | tr -d '[:space:]"'"'" || true)"
    [[ -n "$loaded_telegram_allowed_users" ]] && telegram_allowed_users="$loaded_telegram_allowed_users"
fi
if [[ -n "${telegram_allowed_users:-}" ]]; then
    USER_COUNT=$(echo "$telegram_allowed_users" | tr ',' '\n' | wc -l | tr -d ' ')
    printf "${GREEN}${USER_COUNT} user(s) allowlisted${NC}\n"
else
    printf "${YELLOW}open (no allowlist)${NC}\n"
    warn "Set TELEGRAM_ALLOWED_USERS in .env to restrict access"
    warn "Use your Telegram user ID (get it from @userinfobot)"
fi

echo ""

if [[ $PREFLIGHT_FAIL -ne 0 ]]; then
    fail "Fix the issues above and try again."
    exit 1
fi

success "All checks passed"
echo ""

# =============================================================================
# Build channel args
# =============================================================================
CHANNEL_ARGS=(
    --channels
    "plugin:telegram@claude-plugins-official"
)

# Pass config via environment
export TELEGRAM_BOT_TOKEN="$telegram_bot_token"
if [[ -n "${telegram_allowed_users:-}" ]]; then
    export TELEGRAM_ALLOWED_USERS="$telegram_allowed_users"
fi

# =============================================================================
# Launch
# =============================================================================
info "Starting Claude Code with Telegram channel..."
printf "${DIM}  Bot token: configured${NC}\n"
if [[ -n "${telegram_allowed_users:-}" ]]; then
    printf "${DIM}  Allowed users: configured${NC}\n"
fi
echo ""
info "Send a message to your bot on Telegram to start chatting."
printf "${DIM}  Press Ctrl+C to stop.${NC}\n"
echo ""

cd "$REPO_ROOT"
exec claude "${CHANNEL_ARGS[@]}"

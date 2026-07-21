#!/usr/bin/env bash

CRON_UI_GREEN='\033[0;32m'
CRON_UI_YELLOW='\033[1;33m'
CRON_UI_CYAN='\033[0;36m'
CRON_UI_RED='\033[0;31m'
CRON_UI_BOLD='\033[1m'
CRON_UI_DIM='\033[2m'
CRON_UI_RESET='\033[0m'

agentic_os_cron_banner() {
    local title="$1"
    local subtitle="${2:-}"

    echo ""
    printf "%b" "${CRON_UI_CYAN}${CRON_UI_BOLD}"
    cat <<'EOF'
╔══════════════════════════════════════════════╗
║                                              ║
║               A G E N T I C   O S            ║
║                                              ║
║               C R O N   R U N T I M E        ║
║                                              ║
╚══════════════════════════════════════════════╝
EOF
    printf "%b" "${CRON_UI_RESET}"
    echo ""
    printf "%b%s%b\n" "${CRON_UI_CYAN}${CRON_UI_BOLD}" "$title" "${CRON_UI_RESET}"
    if [[ -n "$subtitle" ]]; then
        printf "%b%s%b\n" "${CRON_UI_DIM}" "$subtitle" "${CRON_UI_RESET}"
    fi
    echo ""
}

agentic_os_cron_info() {
    printf "%b%s%b\n" "${CRON_UI_CYAN}" "$1" "${CRON_UI_RESET}"
}

agentic_os_cron_success() {
    printf "%b  ✓ %s%b\n" "${CRON_UI_GREEN}" "$1" "${CRON_UI_RESET}"
}

agentic_os_cron_warn() {
    printf "%b  ! %s%b\n" "${CRON_UI_YELLOW}" "$1" "${CRON_UI_RESET}"
}

agentic_os_cron_fail() {
    printf "%b  ✗ %s%b\n" "${CRON_UI_RED}" "$1" "${CRON_UI_RESET}"
}

agentic_os_cron_note() {
    printf "%b%s%b\n" "${CRON_UI_DIM}" "$1" "${CRON_UI_RESET}"
}

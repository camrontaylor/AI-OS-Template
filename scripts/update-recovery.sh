#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) REPO_ROOT="$(cygpath -m "$REPO_ROOT")" ;; esac
BACKUP_DIR="$REPO_ROOT/.backup"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info() { printf "  ${CYAN}%b${NC}\n" "$1"; }
warn() { printf "  ${YELLOW}→ %b${NC}\n" "$1"; }
ok() { printf "  ${GREEN}✓ %b${NC}\n" "$1"; }
bullet() { printf "    ${DIM}•${NC} %b\n" "$1"; }

usage() {
    cat <<'EOF'
Usage: bash scripts/update-recovery.sh --latest

Shows the latest AI-OS update recovery report and any AI-OS update
stashes. This command is read-only.
EOF
}

latest_report() {
    [[ -d "$BACKUP_DIR" ]] || return 1
    find "$BACKUP_DIR" -maxdepth 1 -type f -name 'update-recovery-*.txt' -print 2>/dev/null | sort | tail -n 1
}

show_stashes() {
    local stashes
    stashes=$(git -C "$REPO_ROOT" stash list --format='%gd %gs' 2>/dev/null | grep 'AI-OS-update-' || true)
    if [[ -n "$stashes" ]]; then
        warn "AI-OS update stashes:"
        printf "%s\n" "$stashes" | while IFS= read -r line; do
            bullet "$line"
        done
    else
        ok "No AI-OS update stashes found."
    fi
}

case "${1:---latest}" in
    --latest)
        report="$(latest_report || true)"
        if [[ -n "$report" ]]; then
            ok "Latest recovery report: ${BOLD}${report}${NC}"
            echo ""
            cat "$report"
            echo ""
        else
            warn "No AI-OS update recovery report found in ${BOLD}${BACKUP_DIR}${NC}."
            echo ""
        fi
        show_stashes
        ;;
    -h|--help)
        usage
        ;;
    *)
        usage
        exit 2
        ;;
esac

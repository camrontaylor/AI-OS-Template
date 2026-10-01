#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib/common.sh"

echo ""
printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
printf "${CYAN}${BOLD}  AI-OS — Rollback${NC}\n"
printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
echo ""

mapfile -t COMMITS < <(git log --no-merges --format="%H|%ad|%s" --date=format:"%b %d, %Y at %H:%M" -3 2>/dev/null || true)

if [[ ${#COMMITS[@]} -eq 0 ]]; then
    warn "No previous versions found."
    exit 1
fi

info "Choose a version to roll back to:"
echo ""
for i in "${!COMMITS[@]}"; do
    IFS='|' read -r hash date msg <<< "${COMMITS[$i]}"
    printf "  ${BOLD}%d)${NC} %s  ${DIM}%s${NC}\n" "$((i+1))" "$date" "$msg"
done
echo ""
printf "  Enter number (or ${BOLD}q${NC} to quit): "
read -r choice < /dev/tty

if [[ "$choice" =~ ^[qQ]$ ]]; then
    info "Rollback cancelled."
    exit 0
fi

if ! [[ "$choice" =~ ^[0-9]+$ ]] || [[ "$choice" -lt 1 ]] || [[ "$choice" -gt ${#COMMITS[@]} ]]; then
    warn "Invalid choice."
    exit 1
fi

IFS='|' read -r COMMIT_HASH SELECTED_DATE SELECTED_MSG <<< "${COMMITS[$((choice-1))]}"

echo ""
warn "This will reset your repo to: ${BOLD}${SELECTED_DATE} — ${SELECTED_MSG}${NC}"
printf "  ${YELLOW}Uncommitted changes will be lost. Continue? (y/N):${NC} "
read -r confirm < /dev/tty

if [[ ! "$confirm" =~ ^[yY]$ ]]; then
    info "Rollback cancelled."
    exit 0
fi

echo ""
git reset --hard "$COMMIT_HASH"
echo ""
ok "Rolled back to: ${SELECTED_DATE} — ${SELECTED_MSG}"
info "Run ${BOLD}git log --oneline -5${NC} to confirm."
echo ""

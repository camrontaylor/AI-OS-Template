#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib/common.sh"

echo ""
printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
printf "${CYAN}${BOLD}  AI-OS — Undo Update${NC}\n"
printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
echo ""

UPDATE_POINTS=()
while IFS= read -r line; do
    [[ -n "$line" ]] && UPDATE_POINTS+=("$line")
done < <(
    git for-each-ref refs/heads/update-recovery \
        --sort=-creatordate \
        --format="%(refname:short)|%(creatordate:format:%b %d, %Y at %H:%M)|%(objectname:short)" 2>/dev/null |
    head -5
)

if [[ ${#UPDATE_POINTS[@]} -eq 0 ]]; then
    warn "No update recovery points found."
    info "Recovery points are created by ${BOLD}bash scripts/update.sh${NC} before a real update starts."
    exit 1
fi

info "Choose the update point to go back to:"
echo ""
for i in "${!UPDATE_POINTS[@]}"; do
    IFS='|' read -r branch date short_hash <<< "${UPDATE_POINTS[$i]}"
    printf "  ${BOLD}%d)${NC} %s  ${DIM}%s at %s${NC}\n" "$((i+1))" "$date" "$branch" "$short_hash"
done
echo ""
printf "  Enter number (or ${BOLD}q${NC} to quit): "
read -r choice < /dev/tty

if [[ "$choice" =~ ^[qQ]$ ]]; then
    info "Undo cancelled."
    exit 0
fi

if ! [[ "$choice" =~ ^[0-9]+$ ]] || [[ "$choice" -lt 1 ]] || [[ "$choice" -gt ${#UPDATE_POINTS[@]} ]]; then
    warn "Invalid choice."
    exit 1
fi

IFS='|' read -r RECOVERY_BRANCH SELECTED_DATE SHORT_HASH <<< "${UPDATE_POINTS[$((choice-1))]}"
TARGET_COMMIT=$(git rev-parse "$RECOVERY_BRANCH" 2>/dev/null || true)

if [[ -z "$TARGET_COMMIT" ]]; then
    warn "Could not read recovery point $RECOVERY_BRANCH."
    exit 1
fi

echo ""
warn "This will put AI-OS back to the state saved before that update:"
printf "  ${BOLD}%s${NC} ${DIM}(%s)${NC}\n" "$RECOVERY_BRANCH" "$SELECTED_DATE"
echo ""
info "Your current state will be saved first as a rollback-recovery branch."
printf "  Continue? ${BOLD}[y/N]${NC} "
read -r confirm < /dev/tty

if [[ ! "$confirm" =~ ^[yY]$ ]]; then
    info "Undo cancelled."
    exit 0
fi

ROLLBACK_BRANCH="rollback-recovery/$(date +%Y%m%d-%H%M%S)"
if git branch "$ROLLBACK_BRANCH" HEAD >/dev/null 2>&1; then
    ok "Saved current committed state as $ROLLBACK_BRANCH"
fi

if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
    STASH_NAME="ai-os-rollback-$(date +%s)"
    if git stash push --include-untracked -m "$STASH_NAME" >/dev/null 2>&1; then
        ok "Saved current uncommitted file changes in git stash: $STASH_NAME"
    else
        warn "Could not save uncommitted changes. Undo stopped before changing files."
        exit 1
    fi
fi

echo ""
git reset --hard "$TARGET_COMMIT" >/dev/null
echo ""
ok "AI-OS is back to the selected pre-update state."
info "Your previous current state is recoverable from ${BOLD}$ROLLBACK_BRANCH${NC}."
echo ""

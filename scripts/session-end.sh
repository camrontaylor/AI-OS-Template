#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib/common.sh"

echo ""
printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
printf "${CYAN}${BOLD}  AI-OS — Session End${NC}\n"
printf "${CYAN}${BOLD}═══════════════════════════════════════════════${NC}\n"
echo ""

# Collect user-owned paths that exist and have changes
USER_PATHS=(
    "context/USER.md"
    "context/SOUL.md"
    "context/learnings.md"
    "CLAUDE.local.md"
)

STAGED=()

for path in "${USER_PATHS[@]}"; do
    full="$REPO_ROOT/$path"
    [[ ! -f "$full" ]] && continue
    git -C "$REPO_ROOT" check-ignore -q -- "$path" && continue
    if ! git diff --quiet HEAD -- "$path" 2>/dev/null || git ls-files --others --exclude-standard "$REPO_ROOT" | grep -qF "$path"; then
        git add "$REPO_ROOT/$path" 2>/dev/null || true
        STAGED+=("$path")
    fi
done

# context/memory/ — any new or modified files
while IFS= read -r memfile; do
    rel="${memfile#$REPO_ROOT/}"
    git -C "$REPO_ROOT" check-ignore -q -- "$rel" && continue
    git add "$memfile" 2>/dev/null || true
    STAGED+=("$rel")
done < <(git -C "$REPO_ROOT" ls-files --others --exclude-standard -- "context/memory/" 2>/dev/null | sed "s|^|$REPO_ROOT/|"; \
         git -C "$REPO_ROOT" diff --name-only HEAD -- "context/memory/" 2>/dev/null | sed "s|^|$REPO_ROOT/|")

# .claude/skills/*/SKILL.local.md
while IFS= read -r localmd; do
    [[ ! -f "$localmd" ]] && continue
    rel="${localmd#$REPO_ROOT/}"
    git -C "$REPO_ROOT" check-ignore -q -- "$rel" && continue
    git add "$localmd" 2>/dev/null || true
    STAGED+=("$rel")
done < <(find "$REPO_ROOT/.claude/skills" -name "SKILL.local.md" 2>/dev/null)

if [[ ${#STAGED[@]} -eq 0 ]]; then
    ok "Nothing to save — no changes since last commit."
    echo ""
    exit 0
fi

TIMESTAMP=$(date +"%Y-%m-%d %H:%M")
git -C "$REPO_ROOT" commit -m "chore: session end [$TIMESTAMP]" 2>/dev/null | tail -1 || true

echo ""
info "Saved:"
for f in "${STAGED[@]}"; do
    bullet "$f"
done
echo ""

git push origin "$(git rev-parse --abbrev-ref HEAD)" 2>/dev/null && ok "Pushed to origin." || warn "Push failed — changes are committed locally."
echo ""

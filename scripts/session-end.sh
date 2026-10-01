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
    if ! git diff --quiet HEAD -- "$path" 2>/dev/null || git ls-files --others --exclude-standard "$REPO_ROOT" | grep -qF "$path"; then
        git add "$REPO_ROOT/$path" 2>/dev/null || true
        STAGED+=("$path")
    fi
done

# context/memory/ — any new or modified source files, including .aos.md summaries
while IFS= read -r memfile; do
    rel="${memfile#$REPO_ROOT/}"
    git add "$memfile" 2>/dev/null || true
    STAGED+=("$rel")
done < <(git -C "$REPO_ROOT" ls-files --others --exclude-standard -- "context/memory/" 2>/dev/null | sed "s|^|$REPO_ROOT/|"; \
         git -C "$REPO_ROOT" diff --name-only HEAD -- "context/memory/" 2>/dev/null | sed "s|^|$REPO_ROOT/|")

# SKILL.local.md overrides — the repo's own skills plus every client workspace.
# Client overrides are tracked separately so the summary can name the client
# they belong to instead of mixing them into the root list.
#
# When this script is invoked from inside a client (clients/<slug>/scripts/),
# REPO_ROOT resolves to that client folder, so its .claude/skills IS the client
# override set and there are no nested clients to walk.
CLIENT_STAGED=()   # entries: "<slug>|<path relative to REPO_ROOT>"
SELF_CLIENT=""
case "$REPO_ROOT" in
    */clients/*) SELF_CLIENT="${REPO_ROOT##*/}" ;;
esac

stage_local_skill() {
    local localmd="$1"
    local slug="$2"
    local rel
    [[ -f "$localmd" ]] || return 0
    rel="${localmd#$REPO_ROOT/}"
    git add "$localmd" 2>/dev/null || true
    if [[ -n "$slug" ]]; then
        CLIENT_STAGED+=("$slug|$rel")
    else
        STAGED+=("$rel")
    fi
}

while IFS= read -r localmd; do
    stage_local_skill "$localmd" "$SELF_CLIENT"
done < <(find "$REPO_ROOT/.claude/skills" -name "SKILL.local.md" 2>/dev/null || true)

# clients/*/.claude/skills/**/SKILL.local.md (missing or empty clients/ is fine)
if [[ -z "$SELF_CLIENT" && -d "$REPO_ROOT/clients" ]]; then
    while IFS= read -r client_dir; do
        [[ -d "$client_dir" ]] || continue
        client_slug="$(basename "$client_dir")"
        while IFS= read -r localmd; do
            stage_local_skill "$localmd" "$client_slug"
        done < <(find "$client_dir/.claude/skills" -name "SKILL.local.md" 2>/dev/null || true)
    done < <(find "$REPO_ROOT/clients" -mindepth 1 -maxdepth 1 -type d 2>/dev/null || true)
fi

if [[ ${#STAGED[@]} -eq 0 && ${#CLIENT_STAGED[@]} -eq 0 ]]; then
    ok "Nothing to save — no changes since last commit."
    echo ""
    exit 0
fi

TIMESTAMP=$(date +"%Y-%m-%d %H:%M")
git -C "$REPO_ROOT" commit -m "chore: session end [$TIMESTAMP]" --allow-empty 2>/dev/null | tail -1 || true

echo ""
info "Saved:"
if [[ ${#STAGED[@]} -gt 0 ]]; then
    for f in "${STAGED[@]}"; do
        bullet "$f"
    done
else
    bullet "(nothing outside client skill overrides)"
fi

if [[ ${#CLIENT_STAGED[@]} -gt 0 ]]; then
    PREV_SLUG=""
    while IFS= read -r entry; do
        slug="${entry%%|*}"
        rel="${entry#*|}"
        if [[ "$slug" != "$PREV_SLUG" ]]; then
            echo ""
            info "Client skill overrides ($slug):"
            PREV_SLUG="$slug"
        fi
        bullet "$rel"
    done < <(printf '%s\n' "${CLIENT_STAGED[@]}" | LC_ALL=C sort)
fi
echo ""

git push origin "$(git rev-parse --abbrev-ref HEAD)" 2>/dev/null && ok "Pushed to origin." || warn "Push failed — changes are committed locally."
echo ""

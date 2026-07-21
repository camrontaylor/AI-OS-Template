#!/usr/bin/env bash
# Checks that .claude/skills/ and .agents/skills/ have the same skill folders.
# Both are authoritative: Claude reads .claude/skills, compatible agents read .agents/skills.
# A gap means one agent is blind to a skill the other can see.
#
# Usage: bash scripts/lib/skills-parity-check.sh [REPO_ROOT]
# Exit 0 = in sync (or symlinked = always in sync). Exit 1 = mismatch.
# Silent on success. Never blocks; call with || true when used in hooks.

set -euo pipefail

REPO_ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
CLAUDE_SKILLS="$REPO_ROOT/.claude/skills"
AGENTS_SKILLS="$REPO_ROOT/.agents/skills"

# If either dir doesn't exist, skip (partial or fresh install)
[[ -d "$CLAUDE_SKILLS" ]] || exit 0
[[ -d "$AGENTS_SKILLS" ]] || exit 0

# If .agents/skills is a symlink pointing into .claude/skills, they are
# physically the same directory - always in sync, nothing to check.
if [[ -L "$AGENTS_SKILLS" ]]; then
  target=$(readlink "$AGENTS_SKILLS")
  resolved=$(cd "$REPO_ROOT/.agents" && cd "$target" 2>/dev/null && pwd) || true
  claude_abs=$(cd "$CLAUDE_SKILLS" && pwd)
  [[ "$resolved" == "$claude_abs" ]] && exit 0
fi

# Real separate directories - compare skill folder names (skip _ prefixed dirs)
claude_list=$(ls "$CLAUDE_SKILLS" | grep -v '^_' | sort)
agents_list=$(ls "$AGENTS_SKILLS" | grep -v '^_' | sort)

only_in_claude=$(comm -23 <(echo "$claude_list") <(echo "$agents_list") 2>/dev/null || true)
only_in_agents=$(comm -13 <(echo "$claude_list") <(echo "$agents_list") 2>/dev/null || true)

[[ -z "$only_in_claude" ]] && [[ -z "$only_in_agents" ]] && exit 0

echo "SKILLS PARITY BROKEN - .claude/skills and .agents/skills are out of sync."
echo "Claude reads .claude/skills. Compatible agents read .agents/skills. A gap means one agent is blind."
echo ""

if [[ -n "$only_in_claude" ]]; then
  echo "In .claude/skills/ but MISSING from .agents/skills/:"
  while IFS= read -r s; do
    [[ -n "$s" ]] && echo "  - $s"
  done <<< "$only_in_claude"
fi

if [[ -n "$only_in_agents" ]]; then
  echo "In .agents/skills/ but MISSING from .claude/skills/:"
  while IFS= read -r s; do
    [[ -n "$s" ]] && echo "  - $s"
  done <<< "$only_in_agents"
fi

echo ""
echo "Fix: rsync -a .claude/skills/SKILLNAME/ .agents/skills/SKILLNAME/"
exit 1

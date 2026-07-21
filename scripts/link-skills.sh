#!/usr/bin/env bash
# link-skills.sh - Maintain the project-local cross-tool skill adapter.
#
# AI-OS skills exist once at .claude/skills/. Claude reads that directory
# directly. Compatible agents, including current Codex builds, discover the
# project adapter at .agents/skills, which is one directory symlink back to the
# same source. Cursor reads AGENTS.md and does not have a separate skill catalog.
#
# Nothing is published into ~/.codex/skills or ~/.claude/skills. Home-directory
# publication creates a second registration surface, false drift, and possible
# name collisions with project skills.
#
#   bash scripts/link-skills.sh           # create/repair the project adapter
#   bash scripts/link-skills.sh --check   # verify it
#   bash scripts/link-skills.sh --unlink  # remove only this project adapter

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADAPTER_DIR="$ROOT/.agents"
ADAPTER="$ADAPTER_DIR/skills"
TARGET="../.claude/skills"

MODE="link"
case "${1:-}" in
  ""|--link) MODE="link" ;;
  --check) MODE="check" ;;
  --unlink) MODE="unlink" ;;
  *) echo "usage: link-skills.sh [--link|--check|--unlink]" >&2; exit 2 ;;
esac

is_correct() {
  [[ -L "$ADAPTER" ]] && [[ "$(readlink "$ADAPTER")" == "$TARGET" ]]
}

case "$MODE" in
  check)
    if is_correct; then
      echo "link-skills: OK - .agents/skills resolves to the single .claude/skills source."
      exit 0
    fi
    if [[ -e "$ADAPTER" || -L "$ADAPTER" ]]; then
      echo "link-skills: DRIFT - .agents/skills exists but is not the AI-OS project adapter."
    else
      echo "link-skills: DRIFT - .agents/skills is missing."
    fi
    echo "Run: bash scripts/link-skills.sh"
    exit 1
    ;;
  unlink)
    if is_correct; then
      unlink "$ADAPTER"
      echo "link-skills: removed .agents/skills; .claude/skills is untouched."
    else
      echo "link-skills: no owned adapter to remove."
    fi
    ;;
  link)
    mkdir -p "$ADAPTER_DIR"
    if is_correct; then
      echo "link-skills: already correct."
    elif [[ -e "$ADAPTER" || -L "$ADAPTER" ]]; then
      echo "link-skills: collision - .agents/skills exists and was left untouched." >&2
      exit 1
    else
      ln -s "$TARGET" "$ADAPTER"
      echo "link-skills: created .agents/skills -> ../.claude/skills."
    fi
    ;;
esac

#!/usr/bin/env bash
# Copy one or all ad-creative skills into another AI-OS checkout.
# Usage:
#   bash scripts/install-to-ai-os.sh /path/to/AI-OS codex
#   bash scripts/install-to-ai-os.sh /path/to/AI-OS all --force
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-}"
ENGINE="${2:-all}"
FORCE="${3:-}"

usage() {
  echo "Usage: bash scripts/install-to-ai-os.sh /path/to/AI-OS [codex|fal|figma|all] [--force]"
}

if [ -z "$TARGET" ] || [ ! -d "$TARGET" ]; then
  usage
  exit 1
fi

case "$ENGINE" in
  codex) SKILLS=("viz-ad-creative-codex") ;;
  fal) SKILLS=("viz-ad-creative-fal") ;;
  figma) SKILLS=("viz-ad-creative-figma") ;;
  all) SKILLS=("viz-ad-creative-codex" "viz-ad-creative-fal" "viz-ad-creative-figma") ;;
  *) usage; exit 1 ;;
esac

DEST_ROOT="$TARGET/.claude/skills"
mkdir -p "$DEST_ROOT"

for skill in "${SKILLS[@]}"; do
  src="$ROOT/$skill"
  dest="$DEST_ROOT/$skill"
  if [ ! -d "$src" ]; then
    echo "[missing] source skill not found: $src"
    exit 1
  fi
  if [ -e "$dest" ]; then
    if [ "$FORCE" = "--force" ]; then
      backup="${dest}.backup-$(date +%Y%m%d-%H%M%S)"
      mv "$dest" "$backup"
      echo "[backup] moved existing $skill to $backup"
    else
      echo "[exists] $dest"
      echo "Run again with --force to back it up and replace it."
      exit 1
    fi
  fi
  cp -R "$src" "$dest"
  echo "[installed] $skill -> $dest"
done

echo ""
echo "Next:"
for skill in "${SKILLS[@]}"; do
  echo "  cd \"$DEST_ROOT/$skill\""
  echo "  python3 scripts/onboard.py --client \"first-client\""
  echo "  bash scripts/setup.sh"
done

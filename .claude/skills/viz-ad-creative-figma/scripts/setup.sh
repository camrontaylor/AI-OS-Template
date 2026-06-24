#!/usr/bin/env bash
# Setup check for viz-ad-creative-figma. Picks one of two render paths:
#   A) Figma export (needs FIGMA_TOKEN + a brand template file key)
#   B) Local HTML-to-image (needs Node + node-html-to-image + Chromium via Puppeteer)
# Runs only checks, changes nothing.
set -uo pipefail
echo "viz-ad-creative-figma setup check"
ok=1
PATHS=()
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ------------ Path A: Figma export ------------
if [ -n "${FIGMA_TOKEN:-}" ]; then
  echo "[ok] FIGMA_TOKEN is set"
  if [ -n "${FIGMA_FILE_KEY:-}" ]; then
    echo "[ok] FIGMA_FILE_KEY is set"
    PATHS+=("figma")
  else
    echo "[note] FIGMA_FILE_KEY not set. Optional, but without it the export script needs --file-key on every call."
    PATHS+=("figma")
  fi
else
  echo "[note] FIGMA_TOKEN not set. Create one at Figma -> Settings -> Personal access tokens (scope: file_content:read)."
fi

# ------------ Path B: Local HTML render ------------
if command -v node >/dev/null 2>&1; then
  echo "[ok] node $(node -v) (for scripts/render-ad.mjs and scripts/figma-export.mjs)"
  PATHS+=("html")
else
  echo "[note] Node 18+ not installed. Install from https://nodejs.org if you want the local HTML fallback."
fi

if command -v npx >/dev/null 2>&1; then
  if node -e "require.resolve('node-html-to-image', { paths: ['$SKILL_DIR'] })" 2>/dev/null; then
    echo "[ok] node-html-to-image installed"
  else
    echo "[note] node-html-to-image not installed. From this skill folder, run: npm install"
  fi
fi

# ------------ Decide ------------
if [ ${#PATHS[@]} -eq 0 ]; then
  echo ""
  echo "[missing] Neither path is available."
  echo "  Path A (Figma):   set FIGMA_TOKEN in .env, then create a brand-locked template file in Figma."
  echo "  Path B (local):   install Node 18+, then run npm install in this skill folder."
  ok=0
fi

echo ""
echo "Render paths available: ${PATHS[*]:-none}"
echo "Default routing: prefer 'figma' when FIGMA_TOKEN is set and a template file key is supplied;"
echo "                 otherwise fall back to 'html' for pixel-deterministic local rendering."
echo ""

if [ "$ok" -eq 1 ]; then
  echo "Ready."
else
  echo "Setup incomplete. Fix the [missing] items above before generating."
  exit 1
fi

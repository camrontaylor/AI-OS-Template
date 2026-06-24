#!/usr/bin/env bash
# Setup check for viz-ad-creative-fal. Runs only checks, changes nothing.
set -uo pipefail
echo "viz-ad-creative-fal setup check"
ok=1

if [ -n "${FAL_KEY:-}" ]; then
  echo "[ok] FAL_KEY is set"
else
  echo "[missing] FAL_KEY. Get a key at https://fal.ai/dashboard and add FAL_KEY=... to your .env, then make sure it is loaded into the shell."
  ok=0
fi

if command -v node >/dev/null 2>&1; then
  echo "[ok] node $(node -v) (for scripts/falgen.mjs)"
else
  echo "[missing] Node 18+ for scripts/falgen.mjs. Install from https://nodejs.org"
  ok=0
fi

echo ""
echo "Optional: add the fal MCP server for in-session model discovery and runs:"
echo "  claude mcp add --transport http fal-ai https://mcp.fal.ai/mcp --header \"Authorization: Bearer \$FAL_KEY\""
echo ""

if [ "$ok" -eq 1 ]; then
  echo "Ready."
else
  echo "Setup incomplete. Fix the [missing] items above before generating."
  exit 1
fi

#!/usr/bin/env bash
# Setup check for viz-ad-creative-codex. Runs only checks, changes nothing.
# This is the no-key Codex-native image generation path.
set -uo pipefail

echo "viz-ad-creative-codex setup check"
ok=1

echo "[ok] No Gemini, fal, OpenAI, or other image-model API key is required for this variant."
echo "[info] Image generation is expected to run through Codex's native image generation tool."

if command -v python3 >/dev/null 2>&1; then
  echo "[ok] python3 available for scripts/onboard.py"
else
  echo "[note] python3 not found. Run onboarding manually from references/onboarding.md."
fi

if [ -n "${FAL_KEY:-}" ]; then
  echo "[note] FAL_KEY is set, but this skill will not use it. Use viz-ad-creative-fal for fal.ai automation."
fi

echo ""
echo "Generation note:"
echo "  Native image generation cannot be validated from this shell script."
echo "  When running inside Codex, use the image generation tool in Step 7."
echo "  If it is unavailable, save the prompt pack and route generation to a subscription UI or sibling skill."
echo ""

if [ "$ok" -eq 1 ]; then
  echo "Ready."
else
  echo "Setup incomplete. Fix the [missing] items above before generating."
  exit 1
fi

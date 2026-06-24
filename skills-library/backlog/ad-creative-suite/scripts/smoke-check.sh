#!/usr/bin/env bash
# Fast non-generating validation for the ad-creative skill pack.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0
PYCACHE_ROOT="${TMPDIR:-/tmp}/ad-creative-suite-pycache-$$"

need() {
  if [ ! -e "$1" ]; then
    echo "[missing] $1"
    fail=1
  fi
}

frontmatter_len() {
  awk 'BEGIN{n=0} /^---$/{n++; next} n==1{print}' "$1" | wc -c | tr -d ' '
}

common_refs=(
  brand-lock.md
  ad-methodology.md
  ad-sizes.md
  creative-testing.md
  media-buying-workflow.md
  slate.md
  qa-checklist.md
)

for skill in viz-ad-creative-codex viz-ad-creative-fal viz-ad-creative-figma; do
  base="$ROOT/$skill"
  need "$base/SKILL.md"
  need "$base/scripts/setup.sh"
  need "$base/scripts/onboard.py"
  need "$base/assets/brand-profile.template.json"
  need "$base/assets/creative-matrix.template.csv"
  need "$base/assets/launch-readiness.template.md"
  need "$base/assets/onboarding-profile.template.json"
  need "$base/assets/performance-read.template.csv"
  need "$base/assets/slate.template.csv"
  need "$base/references/onboarding.md"
  for ref in "${common_refs[@]}"; do need "$base/references/$ref"; done
  case "$skill" in
    viz-ad-creative-fal)
      need "$base/references/engine-fal.md"
      need "$base/scripts/falgen.mjs"
      ;;
    viz-ad-creative-codex)
      need "$base/references/engine-codex.md"
      ;;
    viz-ad-creative-figma)
      need "$base/references/engine-figma.md"
      need "$base/scripts/render-ad.mjs"
      need "$base/scripts/figma-export.mjs"
      need "$base/assets/ad-template.html"
      need "$base/assets/rows.example.json"
      need "$base/package.json"
      ;;
  esac

  chars="$(frontmatter_len "$base/SKILL.md")"
  if [ "$chars" -gt 1024 ]; then
    echo "[fail] $skill frontmatter is ${chars} chars, over 1024"
    fail=1
  else
    echo "[ok] $skill frontmatter ${chars} chars"
  fi

  if ! grep -q "projects/$skill/" "$base/SKILL.md"; then
    echo "[fail] $skill output path does not use projects/$skill/"
    fail=1
  fi

  if ! grep -q "Step 1: First-Run Onboarding" "$base/SKILL.md"; then
    echo "[fail] $skill is missing first-run onboarding in SKILL.md"
    fail=1
  fi

  if ! grep -q "media-buying-workflow.md" "$base/SKILL.md"; then
    echo "[fail] $skill does not reference media-buying-workflow.md"
    fail=1
  fi

  if ! grep -q "creative-matrix.csv" "$base/SKILL.md"; then
    echo "[fail] $skill does not write creative-matrix.csv"
    fail=1
  fi

  if ! grep -q "launch-readiness.md" "$base/SKILL.md"; then
    echo "[fail] $skill does not write launch-readiness.md"
    fail=1
  fi
done

if grep -R "_shared/" "$ROOT"/viz-ad-creative-* >/dev/null 2>&1; then
  echo "[fail] standalone skill folders still reference _shared/"
  grep -R "_shared/" "$ROOT"/viz-ad-creative-*
  fail=1
fi

echo ""
echo "Syntax checks"
bash -n "$ROOT"/viz-ad-creative-*/scripts/setup.sh
node --check "$ROOT/viz-ad-creative-fal/scripts/falgen.mjs"
node --check "$ROOT/viz-ad-creative-figma/scripts/figma-export.mjs"
node --check "$ROOT/viz-ad-creative-figma/scripts/render-ad.mjs"
PYTHONPYCACHEPREFIX="$PYCACHE_ROOT" python3 -m py_compile "$ROOT"/viz-ad-creative-*/scripts/onboard.py
python3 -m json.tool "$ROOT/viz-ad-creative-fal/assets/onboarding-profile.template.json" >/dev/null
python3 -m json.tool "$ROOT/viz-ad-creative-codex/assets/onboarding-profile.template.json" >/dev/null
python3 -m json.tool "$ROOT/viz-ad-creative-figma/assets/onboarding-profile.template.json" >/dev/null
python3 -m json.tool "$ROOT/viz-ad-creative-figma/assets/rows.example.json" >/dev/null
python3 -m json.tool "$ROOT/viz-ad-creative-figma/package.json" >/dev/null
python3 -m json.tool "$ROOT/viz-ad-creative-codex/assets/brand-profile.template.json" >/dev/null

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "Smoke check failed."
  exit 1
fi

echo ""
echo "Smoke check passed."

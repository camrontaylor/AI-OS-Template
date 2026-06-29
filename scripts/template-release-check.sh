#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEFAULT_REPO="https://github.com/camrontaylor/AI-OS-Template.git"
REPO_URL="${AI_OS_TEMPLATE_REPO:-$DEFAULT_REPO}"
BRANCH="${AI_OS_TEMPLATE_BRANCH:-main}"
CHECKOUT=""
KEEP=0
SKIP_NETWORK=0

usage() {
  cat <<'EOF'
Usage: bash scripts/template-release-check.sh [options]

Read-only template release proof. It checks a fresh clone by default and never
pushes, publishes, or mutates the remote.

Options:
  --repo URL        Template repo URL. Default: https://github.com/camrontaylor/AI-OS-Template.git
  --branch NAME     Branch to inspect. Default: main
  --path PATH       Inspect an existing local checkout instead of cloning
  --skip-network    Require --path and do not clone or fetch
  --keep            Keep the temporary clone for inspection
  -h, --help        Show this help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo)
      REPO_URL="${2:?missing value for --repo}"
      shift 2
      ;;
    --branch)
      BRANCH="${2:?missing value for --branch}"
      shift 2
      ;;
    --path)
      CHECKOUT="${2:?missing value for --path}"
      shift 2
      ;;
    --skip-network)
      SKIP_NETWORK=1
      shift
      ;;
    --keep)
      KEEP=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

ok() { printf 'OK: %s\n' "$1"; }
info() { printf 'INFO: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

if [ "$SKIP_NETWORK" -eq 1 ] && [ -z "$CHECKOUT" ]; then
  fail "--skip-network requires --path"
fi

TMP_ROOT=""
if [ -n "$CHECKOUT" ]; then
  CHECKOUT="$(cd "$CHECKOUT" && pwd)"
else
  TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aios-template-check.XXXXXX")"
  CHECKOUT="$TMP_ROOT/repo"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$CHECKOUT"
fi

cleanup() {
  if [ -n "$TMP_ROOT" ] && [ "$KEEP" -eq 0 ]; then
    rm -rf "$TMP_ROOT"
  fi
}
trap cleanup EXIT

[ -d "$CHECKOUT/.git" ] || fail "Not a git checkout: $CHECKOUT"

cd "$CHECKOUT"

origin="$(git remote get-url origin 2>/dev/null || true)"
head_sha="$(git rev-parse HEAD)"
head_short="$(git rev-parse --short HEAD)"
current_branch="$(git rev-parse --abbrev-ref HEAD)"

echo "AI-OS Template Release Check"
echo "============================"
echo "Checkout: $CHECKOUT"
echo "Remote: ${origin:-none}"
echo "Branch: $current_branch"
echo "Commit: $head_sha"
echo ""

if [ "$origin" != "$REPO_URL" ]; then
  fail "origin is '$origin', expected '$REPO_URL'"
fi
ok "remote target matches expected template repo"

if [ "$current_branch" != "$BRANCH" ]; then
  fail "current branch is '$current_branch', expected '$BRANCH'"
fi
ok "branch matches expected release branch"

for generated in \
  "node_modules" \
  "command-centre/node_modules" \
  ".next" \
  "command-centre/.next" \
  ".command-centre" \
  ".memsearch"; do
  if [ -e "$generated" ]; then
    fail "generated or local-only artifact exists: $generated"
  fi
done
ok "no high-risk generated artifacts found"

if find . -name ".DS_Store" -print -quit | grep -q .; then
  fail ".DS_Store files are present"
fi
ok "no .DS_Store files found"

declare -a high_risk_strings=()
run_private_scan=0

if [ -n "${AI_OS_TEMPLATE_PRIVATE_SCAN_TERMS:-}" ]; then
  IFS=',' read -r -a extra_terms <<< "$AI_OS_TEMPLATE_PRIVATE_SCAN_TERMS"
  for extra in "${extra_terms[@]}"; do
    if [ -n "$extra" ]; then
      high_risk_strings+=("$extra")
      run_private_scan=1
    fi
  done
else
  info "no private scan terms configured; set AI_OS_TEMPLATE_PRIVATE_SCAN_TERMS for maintainer-specific leakage checks"
fi

scan_hits=""
if [ "$run_private_scan" -eq 1 ]; then
  while IFS= read -r file; do
    case "$file" in
      scripts/template-release-check.sh)
        continue
        ;;
    esac
    [ -f "$file" ] || continue
    if LC_ALL=C grep -Iq . "$file"; then
      for needle in "${high_risk_strings[@]}"; do
        if LC_ALL=C grep -nF "$needle" "$file" >/tmp/aios-template-scan-hit.$$ 2>/dev/null; then
          while IFS= read -r hit; do
            scan_hits="${scan_hits}${file}:${hit}"$'\n'
          done < /tmp/aios-template-scan-hit.$$
        fi
      done
    fi
  done < <(git ls-files)
  rm -f /tmp/aios-template-scan-hit.$$
fi

if [ -n "$scan_hits" ]; then
  printf '%s' "$scan_hits" >&2
  fail "high-risk personal or client strings found in tracked files"
fi
ok "tracked files passed high-risk personal/client string scan"

required_tests=(
  "scripts/test-memory-search.sh"
  "scripts/test-memsearch-search.sh"
  "scripts/test-memsearch-reindex.sh"
  "scripts/test-client-routing-guard.sh"
  "scripts/test-session-memory-block.sh"
  "scripts/test-memory-setup.sh"
)

for test_script in "${required_tests[@]}"; do
  if [ ! -f "$test_script" ]; then
    fail "required release test is missing: $test_script"
  fi
  info "running $test_script"
  bash "$test_script"
done
ok "template release tests passed"

if [ -f ".claude/skills/meta-systems-check/scripts/check.sh" ]; then
  info "checking meta-systems-check script syntax"
  bash -n .claude/skills/meta-systems-check/scripts/check.sh
fi

echo ""
echo "READY: template $head_short passed release check."
echo "Proof: $REPO_URL $BRANCH $head_sha"
echo "No push or publish was performed."

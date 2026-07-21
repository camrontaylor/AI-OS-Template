#!/usr/bin/env bash
# Generate a read-only report for local branches that need merge/archive decisions.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TODAY="$(date +%F)"
REPORT_DIR="$ROOT/projects/system-health"
REPORT="$REPORT_DIR/${TODAY}_branch-triage.md"
BASE_BRANCH="${1:-main}"

mkdir -p "$REPORT_DIR"

cd "$ROOT"

INSPECTED_HEAD="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
INSPECTED_STATUS="$(git status --branch --short 2>/dev/null | sed -n '1p' || echo unknown)"

{
  echo "# Branch Triage - $TODAY"
  echo
  echo "This is a read-only planning report. It does not pull, push, merge, delete, or archive branches."
  echo
  echo "## Baseline"
  echo
  echo "- Repository: \`$ROOT\`"
  echo "- Base branch: \`$BASE_BRANCH\`"
  echo "- Inspected commit: \`$INSPECTED_HEAD\`"
  echo "- Inspected tracking state: \`$INSPECTED_STATUS\`"
  echo
  echo "Note: this report describes the branch state before the report file is saved or committed. A later commit that stores the report can increase the ahead count by one."
  echo
  echo "## Recommended Plan"
  echo
  echo "Do not merge stale side branches wholesale. These branches are far behind \`$BASE_BRANCH\`, and several mix system changes with generated client artifacts or stale runtime logs. The safe path is extract, rebuild, or archive."
  echo
  echo "| Branch | Recommendation | Why |"
  echo "|---|---|---|"
  echo "| \`feature/ops-versioning\` | **Archive candidate after backup** | Current \`$BASE_BRANCH\` already contains the ops-versioning skill and is ahead of this branch's copy, including the eval guidance. Do not promote from this stale branch. |"
  echo "| \`feature/command-centre-redesign\` | **Rebuild as a fresh feature branch** | Large UI branch with many deletions. The intent may be valuable, but the branch is too stale to land directly. |"
  echo "| \`feature/flatten-projects\` | **Architecture decision required** | Changes canonical project paths and client project layout. This is a policy/product decision, not a cleanup merge. |"
  echo "| \`feature/ai-os-rebrand-docs-overhaul\` | **Archive after spot-check** | Much of the rebrand/thinking-partner/doc intent appears already absorbed into \`$BASE_BRANCH\`; branch is huge and stale. Spot-check for missing assets/docs, then archive. |"
  echo
  echo "## Execution Order"
  echo
  echo "1. Push a dated backup branch for current local \`$BASE_BRANCH\` before any remote reconcile."
  echo "2. Pull/rebase or otherwise reconcile the commits currently on \`origin/$BASE_BRANCH\` into local \`$BASE_BRANCH\`."
  echo "3. Run \`bash scripts/branch-triage-report.sh\` again so the recommendations use the reconciled base."
  echo "4. Archive \`feature/ops-versioning\` after backup; current \`$BASE_BRANCH\` already has the newer skill."
  echo "5. Decide whether Command Centre redesign deserves a new clean project branch."
  echo "6. Decide separately on the project-flattening architecture."
  echo "7. Archive superseded branches only after the extracted work is either landed or explicitly rejected."
  echo
  echo "## Approval Boundary"
  echo
  echo "No remote backup, pull/rebase, branch archive, merge, cherry-pick, or remote branch update should happen without explicit approval. The current report is planning only."
  echo
  echo "## Branches"
  echo

  while IFS= read -r branch; do
    [[ -z "$branch" || "$branch" == "$BASE_BRANCH" ]] && continue

    ahead="$(git rev-list --count "$BASE_BRANCH..$branch" 2>/dev/null || echo unknown)"
    behind="$(git rev-list --count "$branch..$BASE_BRANCH" 2>/dev/null || echo unknown)"
    last_commit="$(git log -1 --format='%h %cr %s' "$branch" 2>/dev/null || echo unknown)"
    changed_count="$(git diff --name-only "$BASE_BRANCH...$branch" 2>/dev/null | wc -l | tr -d ' ')"
    diff_stat="$(git diff --shortstat "$BASE_BRANCH...$branch" 2>/dev/null || true)"

    echo "### \`$branch\`"
    echo
    echo "- Commits ahead of \`$BASE_BRANCH\`: $ahead"
    echo "- Commits behind \`$BASE_BRANCH\`: $behind"
    echo "- Last commit: $last_commit"
    echo "- Files changed from merge-base: $changed_count"
    if [[ -n "$diff_stat" ]]; then
      echo "- Diff stat: $diff_stat"
    else
      echo "- Diff stat: none"
    fi
    echo
    echo "Recent branch commits:"
    echo
    git log --format='- `%h` %s' --no-merges "$BASE_BRANCH..$branch" 2>/dev/null | sed -n '1,8p'
    if [[ "$ahead" != "0" && -z "$(git log --format='%h' --no-merges "$BASE_BRANCH..$branch" 2>/dev/null | sed -n '1p')" ]]; then
      echo "- No non-merge commits unique to this branch."
    elif [[ "$ahead" == "0" ]]; then
      echo "- No commits unique to this branch."
    fi
    echo
    echo "Changed paths:"
    echo
    git diff --name-only "$BASE_BRANCH...$branch" 2>/dev/null | sed -n '1,24p' | sed 's/^/- `/' | sed 's/$/`/'
    if [[ "$changed_count" == "0" ]]; then
      echo "- No changed paths."
    elif [[ "$changed_count" -gt 24 ]]; then
      echo "- ...and $((changed_count - 24)) more path(s)."
    fi
    echo
  done < <(git branch --format='%(refname:short)' | sort)

  echo "## Decision Rules"
  echo
  echo "- **Merge candidate:** branch has unique work that still appears useful and does not conflict with current AI-OS direction."
  echo "- **Archive candidate:** branch is stale, superseded by main, or contains exploratory work that should be preserved but not landed."
  echo "- **Leave open:** branch needs a human call because the intended outcome is unclear."
  echo
  echo "## Next Decision"
  echo
  echo "Use this report to choose one action per branch: merge, archive, or leave open. Any push, remote branch creation, deletion, or merge needs explicit approval first."
} > "$REPORT"

echo "Branch triage report saved to $REPORT"

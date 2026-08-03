#!/usr/bin/env bash
# Maintain client-scoped MEMORY.md files from root-owned scheduled jobs.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE=""
CLIENT=""
ALL=0
STDOUT_ONLY=0
TODAY="$(date +%F)"

usage() {
  cat <<'EOF'
Usage: bash scripts/client-memory-maintenance.sh --mode distill|gaps|curate|evaluate|brief (--client slug | --all) [--stdout] [--yesterday]

Keeps client memory inside clients/{slug}/context/. It never writes root context/MEMORY.md.
--yesterday targets yesterday's session log instead of today's - used by the
morning cron batch, which closes out the day that just ended.
EOF
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --mode=*)
      MODE="${1#--mode=}"
      shift
      ;;
    --client)
      CLIENT="${2:-}"
      shift 2
      ;;
    --client=*)
      CLIENT="${1#--client=}"
      shift
      ;;
    --all)
      ALL=1
      shift
      ;;
    --stdout)
      STDOUT_ONLY=1
      shift
      ;;
    --yesterday)
      TODAY="$(date -v-1d +%F 2>/dev/null || date -d yesterday +%F)"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$MODE" != "distill" && "$MODE" != "gaps" && "$MODE" != "curate" && "$MODE" != "evaluate" && "$MODE" != "brief" ]]; then
  usage >&2
  exit 2
fi

if [[ "$ALL" -eq 0 && -z "$CLIENT" ]]; then
  usage >&2
  exit 2
fi

ensure_memory() {
  local file="$1"
  if [[ -f "$file" ]]; then
    return
  fi
  mkdir -p "$(dirname "$file")"
  cat > "$file" <<'EOF'
<!-- Cap: 2,500 chars. Client-scoped curated scratchpad. -->
# Working Memory

## Active Threads

## Environment Notes

## Pending Decisions
EOF
}

canonicalize_memory_file() {
  local file="$1"
  python3 - "$file" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
if not path.exists():
    raise SystemExit(0)

required = ["## Active Threads", "## Environment Notes", "## Pending Decisions"]
heading_aliases = {"## Operating Notes": "## Environment Notes"}
lines = path.read_text(encoding="utf-8", errors="replace").splitlines()

pre: list[str] = []
sections: dict[str, list[str]] = {}
order: list[str] = []
current = None

for line in lines:
    if line.startswith("## "):
        current = heading_aliases.get(line, line)
        if current not in sections:
            sections[current] = []
            order.append(current)
        continue
    if current is None:
        pre.append(line)
    else:
        sections[current].append(line)

if not any(line.startswith("# ") for line in pre):
    pre = ["<!-- Cap: 2,500 chars. Client-scoped curated scratchpad. -->", "# Working Memory"]

output: list[str] = []
while pre and pre[-1] == "":
    pre.pop()
output.extend(pre)

ordered_headings = required + [heading for heading in order if heading not in required]
for heading in ordered_headings:
    body = sections.get(heading, [])
    while body and body[0] == "":
        body.pop(0)
    while body and body[-1] == "":
        body.pop()
    output.extend(["", heading])
    output.extend(body)

path.write_text("\n".join(output).rstrip() + "\n", encoding="utf-8")
PY
}

append_unique() {
  local file="$1"
  local section="$2"
  local line="$3"
  local tmp

  [[ -n "$line" ]] || return 0
  if grep -Fqx -- "$line" "$file"; then
    return 0
  fi

  tmp="$(mktemp "${TMPDIR:-/tmp}/aios-client-memory.XXXXXX")"
  awk -v section="$section" -v line="$line" '
    BEGIN { inserted = 0 }
    $0 == section {
      print
      print line
      inserted = 1
      next
    }
    { print }
    END {
      if (!inserted) {
        print ""
        print section
        print line
      }
    }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

extract_section_bullets() {
  local file="$1"
  local heading="$2"
  awk -v heading="$heading" '
    $0 == heading { in_section = 1; next }
    /^### / && in_section { in_section = 0 }
    in_section && /^- / {
      line = $0
      sub(/^- /, "", line)
      if (line != "None yet." && line != "Session in progress." && line != "None") {
        print line
      }
    }
  ' "$file"
}

distill_client() {
  local client_dir="$1"
  local slug
  local memory_file
  local session_file
  local added=0
  local line

  slug="$(basename "$client_dir")"
  memory_file="$client_dir/context/MEMORY.md"
  session_file="$client_dir/context/memory/$TODAY.md"
  ensure_memory "$memory_file"
  canonicalize_memory_file "$memory_file"

  if [[ ! -f "$session_file" ]]; then
    printf '%s: no session today - nothing to distill.\n' "$slug"
    return 0
  fi

  while IFS= read -r line; do
    append_unique "$memory_file" "## Active Threads" "- $TODAY: $line"
    added=$((added + 1))
  done < <(extract_section_bullets "$session_file" "### Open threads")

  while IFS= read -r line; do
    append_unique "$memory_file" "## Pending Decisions" "- $TODAY: $line"
    added=$((added + 1))
  done < <(extract_section_bullets "$session_file" "### Decisions")

  printf '%s: distilled %s item(s) into %s.\n' "$slug" "$added" "${memory_file#"$ROOT/"}"
}

date_epoch() {
  local value="$1"
  if date -d "$value" +%s >/dev/null 2>&1; then
    date -d "$value" +%s
  else
    date -j -f "%Y-%m-%d" "$value" +%s 2>/dev/null || printf '0\n'
  fi
}

gaps_client() {
  local client_dir="$1"
  local slug
  local memory_dir
  local report
  local dates=()
  local gaps=()
  local prev
  local curr
  local diff_days

  slug="$(basename "$client_dir")"
  memory_dir="$client_dir/context/memory"
  report="$memory_dir/${TODAY}_gap-analysis.md"
  mkdir -p "$memory_dir"

  while IFS= read -r date_value; do
    dates+=("$date_value")
  done < <(find "$memory_dir" -maxdepth 1 -type f -name '????-??-??.md' -print 2>/dev/null | sed 's#.*/##; s#\.md$##' | sort)

  for ((i = 1; i < ${#dates[@]}; i += 1)); do
    prev="${dates[$((i - 1))]}"
    curr="${dates[$i]}"
    diff_days=$(( ($(date_epoch "$curr") - $(date_epoch "$prev")) / 86400 ))
    if [[ "$diff_days" -gt 2 ]]; then
      gaps+=("$prev -> $curr ($diff_days days)")
    fi
  done

  {
    printf '# Client Memory Gap Analysis - %s\n\n' "$TODAY"
    printf 'Client: `%s`\n\n' "$slug"
    if [[ "${#dates[@]}" -eq 0 ]]; then
      printf 'Session logs: none\n\n'
    else
      printf 'Session logs: %s to %s (%s day file(s))\n\n' "${dates[0]}" "${dates[$((${#dates[@]} - 1))]}" "${#dates[@]}"
    fi
    printf '## Date Gaps (>2 days)\n\n'
    if [[ "${#gaps[@]}" -eq 0 ]]; then
      printf '%s\n' '- None detected'
    else
      printf -- '- %s\n' "${gaps[@]}"
    fi
  } > "$report"

  printf '%s: gap report saved to %s.\n' "$slug" "${report#"$ROOT/"}"
}

curate_client() {
  local client_dir="$1"
  local slug
  local memory_file
  local tmp
  local before
  local after

  slug="$(basename "$client_dir")"
  memory_file="$client_dir/context/MEMORY.md"
  ensure_memory "$memory_file"
  canonicalize_memory_file "$memory_file"
  before="$(wc -c < "$memory_file" | tr -d ' ')"
  tmp="$(mktemp "${TMPDIR:-/tmp}/aios-client-curate.XXXXXX")"

  python3 - "$memory_file" > "$tmp" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
seen: set[str] = set()
resolved_re = re.compile(r"\b(done|shipped|closed|resolved|complete|completed|superseded)\b", re.I)
placeholder_re = re.compile(r"\b(none for this pass|session in progress|nothing to distill|pending title|none yet)\b", re.I)

for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
    if line.startswith("- "):
        if resolved_re.search(line) or placeholder_re.search(line):
            continue
        normalized = re.sub(r"^\-\s+\d{4}-\d{2}-\d{2}:\s+", "- ", line.lower())
        normalized = re.sub(r"\s+", " ", normalized).strip()
        if normalized in seen:
            continue
        seen.add(normalized)
    print(line)
PY
  mv "$tmp" "$memory_file"
  after="$(wc -c < "$memory_file" | tr -d ' ')"

  printf '%s: curated MEMORY.md from %s to %s chars.\n' "$slug" "$before" "$after"
}

count_section_bullets() {
  local file="$1"
  local heading="$2"
  awk -v heading="$heading" '
    $0 == heading { in_section = 1; next }
    /^## / && in_section { in_section = 0 }
    in_section && /^- / { count += 1 }
    END { print count + 0 }
  ' "$file"
}

write_client_memory_report() {
  local client_dir="$1"
  local report_path="$2"
  ensure_memory "$client_dir/context/MEMORY.md"
  python3 - "$ROOT" "$client_dir" "$report_path" "$TODAY" <<'PY'
from __future__ import annotations

from collections import Counter
from datetime import date, datetime
from pathlib import Path
import json
import re
import subprocess
import sys

root = Path(sys.argv[1])
client_dir = Path(sys.argv[2])
report_path = Path(sys.argv[3])
today_text = sys.argv[4]
today = datetime.strptime(today_text, "%Y-%m-%d").date()
slug = client_dir.name
memory_file = client_dir / "context" / "MEMORY.md"
memory_dir = client_dir / "context" / "memory"
required_headings = ["## Active Threads", "## Environment Notes", "## Pending Decisions"]

text = memory_file.read_text(encoding="utf-8", errors="replace")
lines = text.splitlines()
chars = len(text.encode("utf-8"))

headings = [line for line in lines if line.startswith("## ")]
missing_headings = [heading for heading in required_headings if heading not in headings]
unexpected_headings = [heading for heading in headings if heading not in required_headings]

def section_lines(heading: str) -> list[str]:
    output: list[str] = []
    in_section = False
    for line in lines:
        if line == heading:
            in_section = True
            continue
        if in_section and line.startswith("## "):
            break
        if in_section and line.startswith("- "):
            output.append(line)
    return output

active = section_lines("## Active Threads")
environment = section_lines("## Environment Notes")
pending = section_lines("## Pending Decisions")
all_bullets = [line for line in lines if line.startswith("- ")]

def normalized_bullet(line: str) -> str:
    lowered = line.lower()
    lowered = re.sub(r"^-\s+\d{4}-\d{2}-\d{2}:\s+", "- ", lowered)
    return re.sub(r"\s+", " ", lowered).strip()

dupes = sum(count - 1 for count in Counter(normalized_bullet(line) for line in all_bullets).values() if count > 1)
placeholder_count = sum(1 for line in all_bullets if re.search(r"\b(none for this pass|session in progress|nothing to distill|pending title|none yet)\b", line, re.I))
detail_count = sum(1 for line in all_bullets if re.search(r"\b(x=|y=|[0-9]+px|geometry|sticky|figjam placement|frame id|panel width|top-aligned|right edge|section gap|table of contents)\b", line, re.I))

def has_source(line: str) -> bool:
    return bool(re.search(r"\bsource:\s*|`[^`]+`|https?://|notion\.com|figma\.com", line, re.I))

def has_next(line: str) -> bool:
    return bool(re.search(r"\bnext:\s*|\bwaiting on\b|\bpending\b|\bwhen ready\b|\bif .* approves\b", line, re.I))

active_missing_source = [line for line in active if not has_source(line)]
active_missing_next = [line for line in active if not has_next(line)]

settled_re = re.compile(r"\b(is current|current recommended|recommended current|decided|lead with|treat|keep|frame|start from|do not|should|must|confirmed|approved)\b", re.I)
unresolved_re = re.compile(r"\b(decide|whether|pending|waiting|if\b|ask|approval|confirm|choose|needs?|still)\b", re.I)
settled_pending = [line for line in pending if settled_re.search(line) and not unresolved_re.search(line)]

stale_dated: list[str] = []
for line in active + pending:
    match = re.search(r"^-\s+(\d{4}-\d{2}-\d{2}):", line)
    if not match:
        continue
    try:
        line_date = datetime.strptime(match.group(1), "%Y-%m-%d").date()
    except ValueError:
        continue
    if (today - line_date).days > 7:
        stale_dated.append(line)

reference_count = len([
    path for path in (client_dir / "context").glob("*.md")
    if path.name not in {"MEMORY.md", "learnings.md"} and not path.name.startswith(".")
])
session_count = len(list(memory_dir.glob("????-??-??.md"))) if memory_dir.is_dir() else 0

def is_dataless(path: Path) -> bool:
    try:
        return bool(getattr(path.stat(), "st_flags", 0) & 0x40000000)
    except OSError:
        return False

routine_memory_files = [memory_file, client_dir / "context" / "learnings.md"]
if memory_dir.is_dir():
    routine_memory_files.extend(sorted(memory_dir.glob("*.md")))
dataless_routine = [path for path in routine_memory_files if path.exists() and is_dataless(path)]

recall_status = "not checked"
recall_detail = "Set AI_OS_SKIP_RECALL_HEALTH=1 to skip this bounded check."
if not bool(int(__import__("os").environ.get("AI_OS_SKIP_RECALL_HEALTH", "0"))):
    cmd = [
        "python3",
        str(root / "scripts" / "memory-search.py"),
        f"{slug} current state",
        "1",
        "--root",
        str(root),
        "--scope",
        "all",
    ]
    try:
        completed = subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=8)
        if completed.returncode == 0:
            try:
                json.loads(completed.stdout or "[]")
                recall_status = "ok"
                recall_detail = "All-scope markdown recall returned within 8s."
            except json.JSONDecodeError:
                recall_status = "failed"
                recall_detail = "All-scope markdown recall returned non-JSON output."
        else:
            recall_status = "failed"
            recall_detail = (completed.stderr or completed.stdout or "No output").strip().splitlines()[0][:220]
    except subprocess.TimeoutExpired:
        recall_status = "stalled"
        recall_detail = "All-scope markdown recall exceeded 8s."

issues: list[str] = []
warnings: list[str] = []
if missing_headings or unexpected_headings:
    issues.append("memory headings do not match the official three-section shape")
if chars > 2300:
    issues.append("hot memory is above the 2,300-char review threshold")
if chars > 2500:
    issues.append("hot memory is above the 2,500-char hard cap")
if placeholder_count:
    issues.append("placeholder/no-op bullets are present")
if dupes:
    issues.append("duplicate bullets are present")
if detail_count:
    issues.append("implementation-detail bullets belong in logs or handoffs")
if active_missing_source:
    issues.append("active threads are missing source pointers")
if active_missing_next:
    issues.append("active threads are missing next-step markers")
if stale_dated:
    issues.append("dated active/pending bullets are older than 7 days")
if settled_pending:
    issues.append("settled decisions appear under Pending Decisions")
if recall_status in {"failed", "stalled"}:
    issues.append("broad markdown recall is not responsive")
if dataless_routine:
    warnings.append("some routine memory files are offline/dataless and skipped by markdown recall")

status = "NEEDS CURATION" if issues else ("OK WITH WARNINGS" if warnings else "OK")

def bullet_list(items: list[str], empty: str = "- None") -> list[str]:
    return items if items else [empty]

out: list[str] = [
    f"# Client Memory Health - {today_text}",
    "",
    f"Client: `{slug}`",
    f"Status: **{status}**",
    "",
    "## Summary",
]
if issues:
    out.extend(f"- {issue}." for issue in issues)
else:
    out.append("- Hot memory is within the useful-current-brief bar.")
if warnings:
    out.extend(f"- Warning: {warning}." for warning in warnings)

out.extend([
    "",
    "## Hot Memory Budget",
    "",
    f"- `MEMORY.md`: {chars}/2500 chars",
    "- Review threshold: 2300 chars",
    "- Risk: " + ("startup memory is too crowded for a sharp current-state brief." if chars > 2300 else "none from size."),
    "",
    "## Shape Checks",
    "",
    f"- Required headings missing: {len(missing_headings)}",
    f"- Unexpected headings: {len(unexpected_headings)}",
])
out.extend(f"  - {item}" for item in missing_headings + unexpected_headings)

out.extend([
    "",
    "## Organization Signals",
    "",
    f"- Active thread bullets: {len(active)}",
    f"- Environment note bullets: {len(environment)}",
    f"- Pending decision bullets: {len(pending)}",
    f"- Exact/near duplicate bullets: {dupes}",
    f"- Placeholder or no-op lines: {placeholder_count}",
    f"- Detail-heavy lines likely better suited to a project handoff or dated log: {detail_count}",
    f"- Active threads missing source pointers: {len(active_missing_source)}",
    f"- Active threads missing next-step markers: {len(active_missing_next)}",
    f"- Dated active/pending bullets older than 7 days: {len(stale_dated)}",
    f"- Settled-looking bullets under Pending Decisions: {len(settled_pending)}",
    f"- Client reference files available beside `MEMORY.md`: {reference_count}",
    f"- Dated client session logs: {session_count}",
    f"- Routine memory files offline/dataless: {len(dataless_routine)}",
    "",
    "## Recall Responsiveness",
    "",
    f"- Status: {recall_status}",
    f"- Detail: {recall_detail}",
    "",
    "## Recommended Memory Shape",
    "",
    "- `MEMORY.md`: a compact current-state brief with active thread, source, and next-step in each active bullet.",
    "- `context/current-state.md`: richer generated brief from hot memory, recent logs, and reference files.",
    "- `context/memory/YYYY-MM-DD.md`: chronological session details and one-off implementation decisions.",
    "- `context/learnings.md`: durable client-specific rules that should affect future work.",
    "- `context/*.md` and `projects/**`: stable reference maps, handoffs, and detailed history.",
    "",
    "## Next Curation Actions",
    "",
])

actions: list[str] = []
if missing_headings or unexpected_headings:
    actions.append("- Normalize headings to `## Active Threads`, `## Environment Notes`, and `## Pending Decisions`.")
if chars > 2300:
    actions.append("- Consolidate hot memory until it is below 2,300 chars.")
if active_missing_source or active_missing_next:
    actions.append("- Rewrite each active thread as `current position; source: ...; next: ...`.")
if settled_pending:
    actions.append("- Move settled pending-decision bullets into Environment Notes, learnings, or dated logs.")
if detail_count:
    actions.append("- Move implementation-detail bullets into dated logs or project handoffs.")
if stale_dated:
    actions.append("- Review stale dated bullets and either refresh the next step or archive them to logs.")
if recall_status in {"failed", "stalled"}:
    actions.append("- Fix markdown recall before trusting broad memory search.")
if dataless_routine:
    sample = ", ".join(path.relative_to(client_dir).as_posix() for path in dataless_routine[:3])
    suffix = "..." if len(dataless_routine) > 3 else ""
    actions.append(f"- Optional: hydrate offline routine memory files if long-tail recall is needed now ({sample}{suffix}).")
if not actions:
    actions.append("- No curation action needed.")
out.extend(actions)

report_path.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")
PY
}

evaluate_client() {
  local client_dir="$1"
  local slug
  local report
  local tmp

  slug="$(basename "$client_dir")"
  report="$client_dir/context/memory/${TODAY}_memory-health.md"
  mkdir -p "$(dirname "$report")"

  if [[ "$STDOUT_ONLY" -eq 1 ]]; then
    tmp="$(mktemp "${TMPDIR:-/tmp}/aios-client-memory-health.XXXXXX")"
    write_client_memory_report "$client_dir" "$tmp"
    cat "$tmp"
    rm -f "$tmp"
  else
    write_client_memory_report "$client_dir" "$report"
    printf '%s: memory health report saved to %s.\n' "$slug" "${report#"$ROOT/"}"
  fi
}

brief_client() {
  local client_dir="$1"
  local slug
  local memory_file
  local brief

  slug="$(basename "$client_dir")"
  memory_file="$client_dir/context/MEMORY.md"
  brief="$client_dir/context/current-state.md"
  ensure_memory "$memory_file"
  canonicalize_memory_file "$memory_file"

  python3 - "$ROOT" "$client_dir" "$brief" "$TODAY" <<'PY'
from __future__ import annotations

from datetime import datetime
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
sys.path.insert(0, str(root / "scripts" / "lib"))
import decision_ledger
client_dir = Path(sys.argv[2])
brief_path = Path(sys.argv[3])
today = sys.argv[4]
slug = client_dir.name
context_dir = client_dir / "context"
memory_file = context_dir / "MEMORY.md"
memory_dir = context_dir / "memory"

def rel(path: Path) -> str:
    try:
        return path.relative_to(client_dir).as_posix()
    except ValueError:
        return path.as_posix()

def is_dataless(path: Path) -> bool:
    try:
        return bool(getattr(path.stat(), "st_flags", 0) & 0x40000000)
    except OSError:
        return False

def read_lines(path: Path) -> list[str]:
    try:
        if is_dataless(path):
            return []
        return path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []

memory_lines = read_lines(memory_file)

def section_bullets(lines: list[str], heading: str) -> list[str]:
    output: list[str] = []
    in_section = False
    for line in lines:
        if line == heading:
            in_section = True
            continue
        if in_section and line.startswith("## "):
            break
        if in_section and line.startswith("- "):
            output.append(line)
    return output

active = section_bullets(memory_lines, "## Active Threads")
environment = section_bullets(memory_lines, "## Environment Notes")
pending = section_bullets(memory_lines, "## Pending Decisions")

# The Decision Ledger (context/decisions.md) is parsed by the shared lib so the
# surfacer here and the decision-ledger-check guard never drift on format.
decision_section = decision_ledger.open_decisions_section(context_dir / "decisions.md")

daily_logs = sorted(memory_dir.glob("????-??-??.md"), reverse=True)[:5] if memory_dir.is_dir() else []
offline_daily_logs = [path for path in daily_logs if is_dataless(path)]

def collect_session_bullets(path: Path, wanted: str, limit: int = 5) -> list[str]:
    lines = read_lines(path)
    output: list[str] = []
    in_section = False
    for line in lines:
        if line == wanted:
            in_section = True
            continue
        if in_section and line.startswith("### "):
            in_section = False
        if in_section and line.startswith("- ") and not re.search(r"\b(None yet|Session in progress|None)\b", line, re.I):
            value = line[2:]
            if not skip_recent_signal(value):
                output.append(f"{path.stem}: {value}")
        if len(output) >= limit:
            break
    return output

def skip_recent_signal(value: str) -> bool:
    """Keep generated client briefs focused on client state, not AI-OS upkeep."""
    return bool(re.search(
        r"(root repo|unrelated dirty|\.claude/skills|/AGENTS\.md|/README\.md|registered the `comms`|new skill for direct client message|created a separate `comms-message` skill|quick client-message checks|in client folders, local client context|AI-OS client memory|client memory evaluation|scripts/client-memory-maintenance|cron/jobs/client-current-state-brief|markdown recall|MemSearch|memory docs|health report|`MEMORY\.md` should stay|`context/MEMORY\.md`|`context/current-state\.md`)",
        value,
        re.I,
    ))

recent_decisions: list[str] = []
recent_open_threads: list[str] = []
recent_deliverables: list[str] = []
for path in daily_logs:
    recent_decisions.extend(collect_session_bullets(path, "### Decisions", 3))
    recent_open_threads.extend(collect_session_bullets(path, "### Open threads", 3))
    recent_deliverables.extend(collect_session_bullets(path, "### Deliverables", 3))

reference_files = sorted(
    path for path in context_dir.glob("*.md")
    if path.name not in {"MEMORY.md", "current-state.md", "learnings.md"} and not path.name.startswith(".")
)
project_dirs = sorted(
    (path for path in (client_dir / "projects").glob("*") if path.is_dir()),
    key=lambda path: path.stat().st_mtime,
    reverse=True,
)[:8] if (client_dir / "projects").is_dir() else []

def source_candidates_from_bullets(items: list[str]) -> list[Path]:
    candidates: list[Path] = []
    seen: set[Path] = set()
    for item in items:
        for raw in re.findall(r"`([^`]+)`", item):
            if raw.startswith(("http://", "https://", "~")):
                continue
            if not raw.endswith(".md"):
                continue
            raw_path = Path(raw)
            possible = raw_path if raw_path.is_absolute() else client_dir / raw_path
            if not possible.exists() or not possible.is_file():
                continue
            resolved = possible.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            candidates.append(possible)
    return candidates[:10]

def source_file_summary(path: Path) -> str:
    if is_dataless(path):
        return "offline/dataless - listed from hot memory but not read"
    lines = read_lines(path)
    heading = ""
    first_body = ""
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if not heading and stripped.startswith("#"):
            heading = stripped.lstrip("#").strip()
            continue
        if heading and stripped and not stripped.startswith("#"):
            first_body = stripped
            break
    parts = [part for part in [heading, first_body] if part]
    if not parts:
        return "local markdown source"
    summary = " - ".join(parts)
    return summary[:220] + ("..." if len(summary) > 220 else "")

key_source_files = source_candidates_from_bullets(active + pending)

def emit_bullets(items: list[str], empty: str) -> list[str]:
    if not items:
        return [f"- {empty}"]
    return items

out: list[str] = [
    f"# {slug.title()} Current State",
    "",
    f"Generated: {today}",
    f"Source: `{rel(memory_file)}` plus the latest {len(daily_logs)} dated session log(s).",
    "",
]
out.extend(decision_section)
out.extend([
    "## Where We Are",
    "",
])
out.extend(emit_bullets(active, "No active threads in hot memory."))
out.extend([
    "",
    "## What Matters Now",
    "",
])
out.extend(emit_bullets(pending, "No pending decisions in hot memory."))
out.extend([
    "",
    "## What Not To Forget",
    "",
])
out.extend(emit_bullets(environment, "No environment notes in hot memory."))
out.extend([
    "",
    "## Recent Signals",
    "",
    "### Recent Decisions",
    "",
])
recent_empty = (
    f"{len(offline_daily_logs)} of the latest {len(daily_logs)} dated log(s) are offline/dataless, so recent log signals are partial."
    if offline_daily_logs
    else "No recent signals found in dated logs."
)
out.extend(emit_bullets([f"- {item}" for item in recent_decisions[:8]], recent_empty))
out.extend([
    "",
    "### Recent Open Threads",
    "",
])
out.extend(emit_bullets([f"- {item}" for item in recent_open_threads[:8]], recent_empty))
out.extend([
    "",
    "### Recent Deliverables",
    "",
])
out.extend(emit_bullets([f"- {item}" for item in recent_deliverables[:8]], recent_empty))
out.extend([
    "",
    "## Key Source Files",
    "",
])
out.extend(emit_bullets(
    [f"- `{rel(path)}` - {source_file_summary(path)}" for path in key_source_files],
    "No key source files found in hot memory.",
))
out.extend([
    "",
    "## Source Map",
    "",
    "### Reference Files",
    "",
])
out.extend(emit_bullets([f"- `{rel(path)}`" for path in reference_files], "No reference files found beside hot memory."))
out.extend([
    "",
    "### Recent Project Folders",
    "",
])
out.extend(emit_bullets([f"- `{rel(path)}`" for path in project_dirs], "No project folders found."))
out.extend([
    "",
    "## Maintenance Notes",
    "",
    "- This file is generated by `scripts/client-memory-maintenance.sh --mode brief`.",
    "- Edit `context/MEMORY.md`, dated logs, project files, or reference files, then regenerate this brief.",
    "- Keep `context/MEMORY.md` small; use this file for the fuller readable client state.",
])

brief_path.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")
PY

  printf '%s: current-state brief saved to %s.\n' "$slug" "${brief#"$ROOT/"}"
}

client_dirs=()
if [[ "$ALL" -eq 1 ]]; then
  shopt -s nullglob
  for client_dir in "$ROOT"/clients/*/; do
    [[ -d "$client_dir/context" ]] && client_dirs+=("${client_dir%/}")
  done
  shopt -u nullglob
else
  client_dirs=("$ROOT/clients/$CLIENT")
fi

if [[ "${#client_dirs[@]}" -eq 0 ]]; then
  printf 'No client workspaces found.\n'
  exit 0
fi

for client_dir in "${client_dirs[@]}"; do
  if [[ ! -d "$client_dir/context" ]]; then
    printf 'Missing client context: %s\n' "${client_dir#"$ROOT/"}" >&2
    continue
  fi
  case "$MODE" in
    distill) distill_client "$client_dir" ;;
    gaps) gaps_client "$client_dir" ;;
    curate) curate_client "$client_dir" ;;
    evaluate) evaluate_client "$client_dir" ;;
    brief) brief_client "$client_dir" ;;
  esac
done

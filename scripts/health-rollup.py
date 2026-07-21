#!/usr/bin/env python3
"""health-rollup.py - the one daily choke point that closes the detect->report loop.

The audit's core finding: AI-OS detects everywhere and escalates nowhere.
Reports pile up in projects/system-health/ and projects/ops-cron/ and nothing
reads them back. This script is the missing consumer:

  1. Scans the monitored surfaces (cron status files, autosave stamp,
     memsearch index freshness, template-sync log, yesterday's health reports).
  2. Keeps a findings ledger (.command-centre/health-ledger.json) keyed by
     stable finding ids, so the same issue open N days ESCALATES instead of
     being re-reported as new every morning.
  3. Writes ONE compact rollup (.command-centre/health-rollup.md) that the
     SessionStart hook health-rollup-surface.js injects into the first
     interactive session of the day.
  4. Parks health reports older than 30 days into _archive/ (no hard deletes).

Deterministic, read-mostly, always exits 0. Runs from cron (daily-health-rollup)
and can be run by hand: python3 scripts/health-rollup.py
"""

import glob
import hashlib
import json
import os
import re
import shutil
import sys
import time
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_DIR = os.path.join(ROOT, ".command-centre")
LEDGER_PATH = os.path.join(STATE_DIR, "health-ledger.json")
ROLLUP_PATH = os.path.join(STATE_DIR, "health-rollup.md")
TODAY = date.today().isoformat()

ESCALATE_AFTER_DAYS = 5
REPORT_RETENTION_DAYS = 30
REPORT_FOLDERS = [
    os.path.join(ROOT, "projects", "system-health"),
    os.path.join(ROOT, "projects", "ops-cron"),
]
# Lines in a report that mean "a human should see this". The ": 0" guard keeps
# healthy summary lines ("Failures: 0") out.
REPORT_SIGNAL = re.compile(
    r"(essential|blocked|critical|action needed|needs your call|failing|failed|"
    r"unresolved|decision fork|rotate|leak)",
    re.IGNORECASE,
)
REPORT_NOISE = re.compile(
    r":\s*0\b|\b0 fail|no action needed|none found|all (checks )?pass|"
    r"no critical|no warnings|nothing (blocked|failing|failed)|resolved",
    re.IGNORECASE,
)


def load_json(path, fallback):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return fallback


def finding(key, summary):
    return {"key": key, "summary": summary}


# A job counts as stalled once it is roughly twice its own cadence overdue, so a
# daily job going quiet for 3 days is caught while a weekly one is not nagged at
# day 8. Falls back to the weekly allowance when the cadence cannot be read.
STALE_ALLOWANCE_DAYS = {"daily": 3, "weekdays": 4, "weekly": 16, "monthly": 62}
DEFAULT_STALE_DAYS = STALE_ALLOWANCE_DAYS["weekly"]
WEEKLY_DAY_TOKENS = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}


def job_stale_allowance(slug, scope):
    """Days a job may stay quiet before it counts as stalled, from its own
    `days:` cadence in the job file. Unknown cadence gets the weekly allowance."""
    if scope == "root":
        job_file = os.path.join(ROOT, "cron", "jobs", f"{slug}.md")
    else:
        job_file = os.path.join(ROOT, "clients", scope, "cron", "jobs", f"{slug}.md")
    try:
        with open(job_file, "r", encoding="utf-8") as fh:
            for line in fh:
                if not line.startswith("days:"):
                    continue
                value = line.split(":", 1)[1].strip().strip("'\"").lower()
                if value in STALE_ALLOWANCE_DAYS:
                    return STALE_ALLOWANCE_DAYS[value]
                # A specific weekday (mon, sun, ...) means it runs weekly.
                if any(tok in value for tok in WEEKLY_DAY_TOKENS):
                    return STALE_ALLOWANCE_DAYS["weekly"]
                break
    except Exception:
        pass
    return DEFAULT_STALE_DAYS


def _job_age_days(last_run):
    """Days since last_run, or None if it cannot be parsed."""
    raw = str(last_run or "").strip()
    if not raw:
        return None
    try:
        cleaned = raw.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(cleaned)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - parsed).total_seconds() / 86400
    except Exception:
        return None


def collect_cron_streaks():
    """Report a job that is currently broken, has stalled, or never ran.

    Previously this only fired on a 3-in-a-row failure streak, so a job sitting
    in a failed state, a job that silently stopped running, and a dead job entry
    were all invisible - the rollup would print "all healthy" while jobs were
    red. Any non-success result now reports immediately.
    """
    found = []
    patterns = [
        os.path.join(ROOT, "cron", "status", "*.json"),
        os.path.join(ROOT, "clients", "*", "cron", "status", "*.json"),
    ]
    for pattern in patterns:
        for status_path in sorted(glob.glob(pattern)):
            data = load_json(status_path, {})
            slug = os.path.splitext(os.path.basename(status_path))[0]
            rel = os.path.relpath(status_path, ROOT)
            scope = "root" if rel.startswith("cron/") else rel.split(os.sep)[1]
            raw_last = data.get("last_run")
            last_run = str(raw_last or "unknown")[:16].replace("T", " ")
            result = str(data.get("result") or "").strip().lower()
            streak = int(data.get("consecutive_fail_count") or 0)
            runs = int(data.get("run_count") or 0)

            # 1. Currently failing. Report on the first failure, not the third.
            if result and result != "success":
                if streak >= 3:
                    detail = f"has failed {streak} runs in a row"
                elif streak > 0:
                    detail = f"failed its last {streak} run(s)"
                else:
                    detail = f"last run ended in {result}"
                found.append(
                    finding(
                        f"cron-fail:{scope}:{slug}",
                        f"Cron job {slug} ({scope}) {detail} (last run {last_run}).",
                    )
                )
                continue

            # 2. Never ran, or a dead leftover entry with no result at all.
            if not result or runs == 0:
                found.append(
                    finding(
                        f"cron-dead:{scope}:{slug}",
                        f"Cron job {slug} ({scope}) has never completed a run "
                        f"({runs} runs recorded). It is either newly added or a stale leftover entry.",
                    )
                )
                continue

            # 3. Succeeded once, then went quiet. Silence is not health.
            age = _job_age_days(raw_last)
            allowance = job_stale_allowance(slug, scope)
            if age is not None and age > allowance:
                found.append(
                    finding(
                        f"cron-stalled:{scope}:{slug}",
                        f"Cron job {slug} ({scope}) last ran {age:.0f} days ago "
                        f"({last_run}), past its {allowance}-day allowance; it looks like it stopped running.",
                    )
                )
    return found


def collect_autosave():
    stamp = os.path.join(STATE_DIR, "autosave-last-run")
    try:
        with open(stamp, "r", encoding="utf-8") as fh:
            last = int(fh.read().strip() or 0)
    except Exception:
        return [finding("autosave-stale", "Autosave has no last-run stamp; the session-end safety net may be dead.")]
    age_hours = (time.time() - last) / 3600
    if age_hours > 36:
        return [
            finding(
                "autosave-stale",
                f"Autosave last ran {age_hours / 24:.1f} days ago; the session-end commit + GitHub backup net may be dead again.",
            )
        ]
    return []


def collect_memsearch_freshness():
    status = load_json(os.path.join(ROOT, "cron", "status", "nightly-memsearch-index.json"), {})
    last_success = status.get("last_success") or (
        status.get("last_run") if status.get("result") == "success" else None
    )
    if not last_success:
        return [finding("memsearch-stale", "The semantic memory index has no recorded successful run; recall may be serving stale results.")]
    try:
        last_dt = datetime.fromisoformat(str(last_success).replace("Z", "+00:00"))
        age_hours = (datetime.now(last_dt.tzinfo) - last_dt).total_seconds() / 3600
    except Exception:
        return []
    if age_hours > 48:
        return [
            finding(
                "memsearch-stale",
                f"The semantic memory index last succeeded {age_hours / 24:.1f} days ago; recall is drifting stale.",
            )
        ]
    return []


def collect_template_sync():
    log_path = os.path.join(ROOT, ".backup", "template-sync", "last-run.log")
    armed = os.path.exists(os.path.join(STATE_DIR, "template-sync-armed"))
    if not armed or not os.path.exists(log_path):
        return []
    try:
        with open(log_path, "r", encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()[-60:]
    except Exception:
        return []
    last_ok = last_fail = -1
    for i, line in enumerate(lines):
        if "Propagated" in line:
            last_ok = i
        if "Push to template failed" in line or "[rejected]" in line:
            last_fail = i
    if last_fail > last_ok:
        return [
            finding(
                "template-sync-failing",
                "Template propagation is failing (push rejected); systemic changes are not reaching the template.",
            )
        ]
    return []


def collect_report_lines():
    found = []
    cutoff = time.time() - 24 * 3600
    for folder in REPORT_FOLDERS:
        if not os.path.isdir(folder):
            continue
        for path in sorted(glob.glob(os.path.join(folder, "*.md"))):
            try:
                if os.path.getmtime(path) < cutoff:
                    continue
                with open(path, "r", encoding="utf-8", errors="replace") as fh:
                    text = fh.read()
            except Exception:
                continue
            base = os.path.basename(path)
            kind = re.sub(r"^\d{4}-\d{2}-\d{2}_?", "", base).replace(".md", "") or base
            kept = 0
            for line in text.splitlines():
                line = line.strip()
                if not line or len(line) > 300:
                    continue
                if line.startswith(("✓", "- ✓", "PASS", "OK", "[x]")):
                    continue  # pass-lines are not findings even when wordy
                if not REPORT_SIGNAL.search(line) or REPORT_NOISE.search(line):
                    continue
                digest = hashlib.sha1(line.encode("utf-8", "replace")).hexdigest()[:10]
                found.append(finding(f"report:{kind}:{digest}", f"{kind}: {line.lstrip('-# ').strip()}"))
                kept += 1
                if kept >= 3:
                    break
    return found


def archive_old_reports():
    parked = 0
    cutoff = time.time() - REPORT_RETENTION_DAYS * 24 * 3600
    dated = re.compile(r"^\d{4}-\d{2}-\d{2}")
    for folder in REPORT_FOLDERS:
        if not os.path.isdir(folder):
            continue
        archive = os.path.join(folder, "_archive")
        for path in glob.glob(os.path.join(folder, "*.md")):
            # Only dated report files are retention-managed; standing docs
            # (plans, guides) in the same folder must never be parked.
            if not dated.match(os.path.basename(path)):
                continue
            try:
                if os.path.getmtime(path) >= cutoff:
                    continue
                os.makedirs(archive, exist_ok=True)
                shutil.move(path, os.path.join(archive, os.path.basename(path)))
                parked += 1
            except Exception:
                continue
    return parked


def main():
    os.makedirs(STATE_DIR, exist_ok=True)

    current = []
    for collector in (
        collect_cron_streaks,
        collect_autosave,
        collect_memsearch_freshness,
        collect_template_sync,
        collect_report_lines,
    ):
        try:
            current.extend(collector())
        except Exception as exc:  # a broken collector must not kill the rollup
            current.append(finding(f"rollup-collector:{collector.__name__}", f"Health collector {collector.__name__} crashed: {exc}"))

    ledger = load_json(LEDGER_PATH, {})
    if not isinstance(ledger, dict):
        ledger = {}
    seen_keys = set()
    for item in current:
        key = item["key"]
        seen_keys.add(key)
        entry = ledger.get(key) or {"first_seen": TODAY}
        entry["last_seen"] = TODAY
        entry["summary"] = item["summary"]
        ledger[key] = entry
    resolved = [k for k in list(ledger.keys()) if k not in seen_keys]
    for key in resolved:
        del ledger[key]

    def days_open(entry):
        try:
            return (date.fromisoformat(TODAY) - date.fromisoformat(entry["first_seen"])).days
        except Exception:
            return 0

    items = sorted(ledger.items(), key=lambda kv: -days_open(kv[1]))
    lines = [f"# AI-OS health rollup - {TODAY}", ""]
    if items:
        lines.append("## Needs attention")
        for key, entry in items:
            age = days_open(entry)
            prefix = f"[open {age} days] " if age >= ESCALATE_AFTER_DAYS else ("[new] " if age == 0 else f"[day {age + 1}] ")
            lines.append(f"- {prefix}{entry['summary']}")
    else:
        lines.append("Nothing needs attention - all monitored loops are healthy.")
    if resolved:
        lines.append("")
        lines.append(f"Resolved since the last rollup: {len(resolved)} finding(s).")
    parked = archive_old_reports()
    if parked:
        lines.append("")
        lines.append(f"Parked {parked} report(s) older than {REPORT_RETENTION_DAYS} days into _archive/.")
    lines.append("")

    with open(LEDGER_PATH, "w", encoding="utf-8") as fh:
        json.dump(ledger, fh, indent=2, sort_keys=True)
    with open(ROLLUP_PATH, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))

    print(f"health-rollup: {len(items)} open finding(s), {len(resolved)} resolved, {parked} parked. -> {os.path.relpath(ROLLUP_PATH, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

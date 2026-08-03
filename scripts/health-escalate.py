#!/usr/bin/env python3
"""health-escalate.py - the out-of-band arm of AI-OS self-monitoring.

The health rollup already knows what is broken (.command-centre/health-ledger.json),
but its only delivery path is a Claude Code SessionStart hook: the user has to open
a session to hear about it. So a broken self-maintenance loop can sit red for days
(as it did 2026-07-21..23) while nothing pages. This script is the missing edge:

  - Reads the findings ledger.
  - Pages the INFRA/loop-health findings (a cron job down, autosave dead, index
    stale, memory over cap) via scripts/notify.sh, which reaches the phone through
    Pushover and always fires a macOS banner.
  - Priority escalates with how long the finding has been open: 0 (normal) < 3
    days, 1 (high) at 3+, 2 (emergency, repeats until acknowledged) at 7+.
  - Deduplicates via .command-centre/health-escalations.json so it alerts ONCE
    per finding per day at its current priority, with an immediate extra alert the
    moment a finding's priority steps up. Resolved findings drop out silently.
  - Sends ONE consolidated alert per run, not one per finding, so a bad night is a
    single readable page, never a spam burst.

Report-line findings (report:*, cold threads) are deliberately NOT paged - those
are for the once-a-day in-session surface; only the structural loop-health findings
are loud enough to interrupt. Run from the watchdog every ~30 min and from the
daily rollup. Deterministic, always exits 0.

Usage:  health-escalate.py [--dry-run]
"""
import json
import os
import subprocess
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_DIR = os.path.join(ROOT, ".command-centre")
LEDGER_PATH = os.path.join(STATE_DIR, "health-ledger.json")
ESCALATION_STATE = os.path.join(STATE_DIR, "health-escalations.json")
NOTIFY = os.path.join(ROOT, "scripts", "notify.sh")
TODAY = date.today().isoformat()

# Finding key prefixes loud enough to page out-of-band. These are the self-
# maintenance and self-improvement loops going dark - the thing the user must not
# discover a week late. Everything else (report:*, memory-cold-threads) stays on
# the once-a-day in-session surface.
PAGING_PREFIXES = (
    "cron-fail:",
    "cron-dead:",
    "cron-stalled:",
    "autosave-stale",
    "memsearch-stale",
    "memory-over-cap",
    "template-sync-failing",
    "rollup-collector:",
)


def load_json(path, fallback):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return fallback


def days_open(entry):
    try:
        return (date.fromisoformat(TODAY) - date.fromisoformat(entry["first_seen"])).days
    except Exception:
        return 0


def priority_for(days):
    if days >= 7:
        return 2
    if days >= 3:
        return 1
    return 0


def is_paging(key):
    return any(key.startswith(p) for p in PAGING_PREFIXES)


def main():
    dry = "--dry-run" in sys.argv[1:] or os.environ.get("AIOS_ESCALATE_DRYRUN") == "1"
    ledger = load_json(LEDGER_PATH, {})
    if not isinstance(ledger, dict):
        ledger = {}
    state = load_json(ESCALATION_STATE, {})
    if not isinstance(state, dict):
        state = {}

    # Drop state for findings that have resolved, so a recurrence pages fresh.
    for key in list(state.keys()):
        if key not in ledger:
            del state[key]

    to_alert = []
    for key, entry in ledger.items():
        if not is_paging(key):
            continue
        days = days_open(entry)
        prio = priority_for(days)
        st = state.get(key) or {}
        already = st.get("last_notified_date")
        last_prio = st.get("last_priority", -1)
        # Alert when: never alerted, priority stepped up, or a new day dawned on a
        # still-open finding (a gentle daily re-remind at current priority).
        if already is None or prio > last_prio or already != TODAY:
            to_alert.append((key, days, prio, entry.get("summary", key)))

    if not to_alert:
        print("health-escalate: nothing to page (%d ledger finding(s))." % len(ledger))
        # Persist the pruned state even when quiet.
        if not dry:
            _write_state(state)
        return 0

    to_alert.sort(key=lambda t: -t[1])  # oldest/most-severe first
    max_prio = max(t[2] for t in to_alert)
    header = "%d self-maintenance loop(s) need attention:" % len(to_alert)
    body_lines = ["- [%dd] %s" % (days, summary) for _key, days, _p, summary in to_alert[:6]]
    if len(to_alert) > 6:
        body_lines.append("- ...and %d more (see health rollup)." % (len(to_alert) - 6))
    message = header + "\n" + "\n".join(body_lines)
    title = "AI-OS self-monitoring"

    if dry:
        print("DRY-RUN would page (priority %d):" % max_prio)
        print(title + ": " + message)
        return 0

    try:
        subprocess.run([
            "bash", NOTIFY, title, message, str(max_prio)
        ], timeout=20, check=False)
    except Exception as exc:
        print("health-escalate: notify failed (%s)" % exc)

    for key, _days, prio, _summary in to_alert:
        state[key] = {"last_notified_date": TODAY, "last_priority": prio}
    _write_state(state)
    print("health-escalate: paged %d finding(s) at priority %d." % (len(to_alert), max_prio))
    return 0


def _write_state(state):
    try:
        with open(ESCALATION_STATE, "w", encoding="utf-8") as fh:
            json.dump(state, fh, indent=2, sort_keys=True)
    except Exception:
        pass


if __name__ == "__main__":
    sys.exit(main())

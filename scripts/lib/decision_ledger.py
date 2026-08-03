#!/usr/bin/env python3
"""Decision Ledger: parse, surface, and health-check context/decisions.md.

One parser, shared by two callers so the format never drifts between them:
  - the current-state brief generator imports open_decisions_section() to write
    the "Open Decisions" block at the top of current-state.md (session start);
  - scripts/decision-ledger-check.sh calls the `check` CLI for the weekly health
    guard (malformed entries, chronic churn).

The ledger records directional decisions (positioning, offer, pricing, naming,
strategy) with a reopen gate and a reopen counter, so a settled call is not
silently re-decided by the next session. Live facts (what is actually billed or
shipped) are NOT the ledger's job: those live in context/facts-of-record.md and
win over any ledger entry. The ledger tracks the decision and its reopen bar.

Entry format (one per decision), forgiving by design so a hand-written entry
never crashes the brief:

    ## Topic
    - Status: Decided | Reopened | Proposed | Unresolved | Escalated | Retired
    - Decided: YYYY-MM-DD
    - Call: the decision, one or two lines
    - Reopen gate: what must be true to reopen
    - Gate met: yes | no | n/a
    - Reopened: N (optional detail after the integer)
    - Confirmed: YYYY-MM-DD (optional; last time the call was re-verified as still
      current, separate from Decided. Populated by a re-ground pass - the weekly
      re-ground queue or meta-wrap-up - so a settled call also carries how fresh
      that settlement is. Absent means never re-confirmed since it was written.)
    - Note: optional
    - Source: optional
"""
from __future__ import annotations

import re
import sys
from datetime import date
from pathlib import Path

# A field is required for an entry to be well-formed. Missing fields do not crash
# the surfacer (it defaults them); the health check reports them so a malformed
# entry cannot silently fail to surface.
REQUIRED_FIELDS = ("status", "call", "reopen gate", "gate met", "reopened")

# Reopened this many times or more is chronic churn: the gate is not holding and
# the decision needs escalating, not re-deciding. MSF positioning hit 4.
CHRONIC_THRESHOLD = 3


def read_lines(path) -> list:
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []


def parse(lines) -> list:
    """Split ledger text into entries: [{"topic": str, "fields": {k: v}}]."""
    entries = []
    current = None
    for line in lines:
        if line.startswith("## "):
            if current is not None:
                entries.append(current)
            current = {"topic": line[3:].strip(), "fields": {}}
        elif current is not None and line.startswith("- ") and ":" in line:
            key, _, value = line[2:].partition(":")  # first colon only
            current["fields"][key.strip().lower()] = value.strip()
    if current is not None:
        entries.append(current)
    return entries


def reopened_count(fields) -> int:
    match = re.match(r"\s*(\d+)", fields.get("reopened", "0"))
    return int(match.group(1)) if match else 0


def _parse_date(value):
    """First YYYY-MM-DD found in value, as a date, or None. Forgiving like the
    rest of the parser: a malformed date never crashes the brief."""
    match = re.search(r"(\d{4})-(\d{2})-(\d{2})", value or "")
    if not match:
        return None
    try:
        return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return None


def needs_surface(entry) -> bool:
    """Surface a decision that must not be silently reopened (gate unmet), that
    has already churned (reopened), or that is still open and the user owns it.
    A cleanly settled decision (Decided, gate met/na, never reopened) and a
    Retired one stay hidden, so the block carries only what needs guarding."""
    fields = entry["fields"]
    status = fields.get("status", "").lower()
    if status.startswith("retired"):
        return False
    if status.startswith("escalated"):
        return True
    if fields.get("gate met", "").lower().startswith("no"):
        return True
    if reopened_count(fields) >= 1:
        return True
    return status.startswith(("proposed", "unresolved", "open"))


def open_decisions_section(path) -> list:
    """Markdown lines for the current-state 'Open Decisions' block, or [] when
    nothing needs guarding. Trailing blank line included when non-empty."""
    entries = [e for e in parse(read_lines(path)) if needs_surface(e)]
    if not entries:
        return []
    out = ["## Open Decisions (do not silently reopen)", ""]
    for entry in entries:
        fields = entry["fields"]
        status = fields.get("status", "Decided").strip().rstrip(".")
        gatemet = fields.get("gate met", "?").strip().rstrip(".")
        out.append(f"- **{entry['topic']}** - {fields.get('call', '').strip()}")
        out.append(
            f"  - Status: {status}. Reopened {reopened_count(fields)}x. "
            f"Gate met: {gatemet}."
        )
        confirmed = _parse_date(fields.get("confirmed", ""))
        if confirmed:
            out.append(
                f"  - Last confirmed: {confirmed.isoformat()} "
                f"({(date.today() - confirmed).days}d ago)"
            )
        else:
            decided = _parse_date(fields.get("decided", ""))
            since = f" (written {decided.isoformat()})" if decided else ""
            out.append(
                f"  - Last confirmed: not re-confirmed since it was written{since} "
                f"- re-ground at source before relying"
            )
        gate = fields.get("reopen gate", "").strip()
        if gate:
            out.append(f"  - Reopen gate: {gate}")
    out.append("")
    out.append(
        "> These are settled directional calls. Reopening one is the user's "
        "decision, not a silent redo: surface the call, the gate, and the reopen "
        "count first. Full ledger: `context/decisions.md`."
    )
    out.append("")
    return out


def check(path) -> tuple:
    """Health findings for one ledger file: (malformed, chronic) lists of
    human-readable finding strings. Retired entries are exempt."""
    malformed = []
    chronic = []
    for entry in parse(read_lines(path)):
        fields = entry["fields"]
        status = fields.get("status", "").lower()
        if status.startswith(("retired", "escalated")):
            continue
        missing = [name for name in REQUIRED_FIELDS if name not in fields]
        if missing:
            malformed.append(
                f'"{entry["topic"]}" is missing field(s): {", ".join(missing)}'
            )
        count = reopened_count(fields)
        if count >= CHRONIC_THRESHOLD:
            chronic.append(
                f'"{entry["topic"]}" reopened {count}x - chronic churn, the reopen '
                f"gate is not holding; escalate the gate, do not re-decide"
            )
    return malformed, chronic


def _main(argv) -> int:
    if len(argv) < 2:
        print("usage: decision_ledger.py <surface|check> <ledger.md>", file=sys.stderr)
        return 2
    command, path = argv[0], argv[1]
    if command == "surface":
        lines = open_decisions_section(path)
        if lines:
            print("\n".join(lines).rstrip())
        return 0
    if command == "check":
        malformed, chronic = check(path)
        for item in malformed:
            print(f"MALFORMED|{item}")
        for item in chronic:
            print(f"CHRONIC|{item}")
        return 1 if (malformed or chronic) else 0
    print(f"unknown command: {command}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))

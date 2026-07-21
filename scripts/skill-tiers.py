#!/usr/bin/env python3
"""
skill-tiers.py - Rank every skill you have actually used by frequency,
classify where it comes from, and flag which ones are worth graduating
into AI-OS.

This is the data-driven half of the AI-OS skill graduation rule: a skill
only earns a place in AI-OS once you have USED it and it can be DOCUMENTED.
This script gives you the "used" half, ranked, so the picture clarifies
over time. Re-run it whenever you want a fresh read.

Source of truth: Claude Code logs a usage count for every skill you invoke
in ~/.claude.json (skillUsage). This reads that, nothing else, so it is
always current. No external calls.

Tiers (by lifetime use count):
  A = 8 or more   proven, high value
  B = 3 to 7      recurring
  C = 1 to 2      occasional / trial

A "graduation candidate" is any Tier A or B skill that is NOT already an
AI-OS native skill - i.e. something you lean on that AI-OS does not yet own.

Usage: python3 scripts/skill-tiers.py
"""

import json
import os
import sys

HOME = os.path.expanduser("~")
# AI-OS root = parent of the scripts/ dir this file lives in
AIOS_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CLAUDE_JSON = os.path.join(HOME, ".claude.json")
AIOS_SKILLS = os.path.join(AIOS_ROOT, ".claude", "skills")
AGENTS_STORE = os.path.join(HOME, ".agents", "skills")
CLAUDE_MENU = os.path.join(HOME, ".claude", "skills")
CLAUDE_PARKED = os.path.join(HOME, ".claude", "skills-parked")

# Claude Code built-ins (not skills that graduate into AI-OS)
BUILTINS = {
    "update-config", "loop", "run", "context-control", "claude-api",
    "verify", "init", "review", "security-review",
}

TIER_A_MIN = 8
TIER_B_MIN = 3


def isdir(*parts):
    return os.path.isdir(os.path.join(*parts))


def exists(path, name):
    p = os.path.join(path, name)
    return os.path.exists(p) or os.path.islink(p)


def classify(name):
    """Return (source_key, human_readable, is_ai_os)."""
    # AI-OS native (a folder under the repo's .claude/skills/)
    if isdir(AIOS_SKILLS, name):
        return ("ai-os", "AI-OS native", True)
    # namespaced -> plugin or client-scoped
    if ":" in name:
        ns = name.split(":", 1)[0]
        if ns.startswith("clients/"):
            return ("project", f"client skill ({ns})", False)
        return (f"plugin:{ns}", f"plugin '{ns}'", False)
    # agents store (feeds Cursor and other compatible agents too)
    if isdir(AGENTS_STORE, name):
        return ("agents-store", "agents store", False)
    # live in the Claude menu folder
    if exists(CLAUDE_MENU, name):
        return ("claude-menu", "~/.claude/skills", False)
    # parked out of the menu
    if exists(CLAUDE_PARKED, name):
        return ("parked", "parked (out of menu)", False)
    if name in BUILTINS:
        return ("builtin", "Claude Code built-in", False)
    return ("unknown", "unknown", False)


def tier_of(count):
    if count >= TIER_A_MIN:
        return "A"
    if count >= TIER_B_MIN:
        return "B"
    return "C"


def load_usage():
    if not os.path.exists(CLAUDE_JSON):
        sys.exit(f"Cannot find {CLAUDE_JSON}")
    with open(CLAUDE_JSON) as f:
        d = json.load(f)
    su = d.get("skillUsage", {})
    rows = []
    for name, v in su.items():
        count = v.get("usageCount", 0) if isinstance(v, dict) else (v if isinstance(v, int) else 0)
        if count <= 0:
            continue
        src, human, is_aios = classify(name)
        rows.append({
            "name": name, "count": count, "tier": tier_of(count),
            "source": src, "human": human, "is_aios": is_aios,
        })
    rows.sort(key=lambda r: (-r["count"], r["name"]))
    return rows


def fmt(rows):
    out = []
    out.append("AI-OS Skill Tiers  -  ranked by how often you have used each skill")
    out.append(f"Read from {CLAUDE_JSON} (skillUsage).  {len(rows)} skills with real usage.\n")

    for tier, label in (("A", "TIER A  -  used 8+ times  (proven, high value)"),
                        ("B", "TIER B  -  used 3 to 7 times  (recurring)"),
                        ("C", "TIER C  -  used 1 to 2 times  (occasional / trial)")):
        group = [r for r in rows if r["tier"] == tier]
        if not group:
            continue
        out.append(label)
        if tier == "C":
            # summarise tier C to keep the report scannable
            aios = [r["name"] for r in group if r["is_aios"]]
            other = [f"{r['name']}({r['count']})" for r in group if not r["is_aios"]]
            if aios:
                out.append("  AI-OS native, lightly used: " + ", ".join(sorted(aios)))
            if other:
                out.append("  Non-AI-OS: " + ", ".join(other))
            out.append("")
            continue
        for r in group:
            flag = "" if r["is_aios"] else "  <- not in AI-OS"
            mark = "ai-os" if r["is_aios"] else r["human"]
            out.append(f"  {r['count']:>3}x  {r['name']:<32} {mark}{flag}")
        out.append("")

    # graduation candidates: Tier A/B, not AI-OS, not a pure dev/builtin tool
    cands = [r for r in rows
             if r["tier"] in ("A", "B") and not r["is_aios"]
             and r["source"] not in ("builtin",)]
    out.append("GRADUATION CANDIDATES  -  used enough to earn a place; review + document, then build into AI-OS")
    if cands:
        for r in cands:
            out.append(f"  {r['count']:>3}x  {r['name']:<32} ({r['human']})")
    else:
        out.append("  (none)")
    out.append("")
    out.append("Rule: a candidate only becomes a live AI-OS skill after you confirm the use case")
    out.append("and it gets documented (registered + named to the convention). Tier C stays out.")
    return "\n".join(out)


if __name__ == "__main__":
    print(fmt(load_usage()))

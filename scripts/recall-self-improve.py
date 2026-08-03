#!/usr/bin/env python3
"""recall-self-improve.py - the sensing half of the recall self-improvement loop.

The nightly index proves recall quality against a STATIC golden set that only
grows when a human notices a miss (scripts/lib/recall-golden-set.json says as
much: "Add cases when a recall miss is discovered"). Every client's scripts/lib
is a SYMLINK to root's, so the golden file is physically one shared set - fine for
system-recall cases, but it left client-specific recall unmeasured and ungrowable.
This script closes that loop with a base+overlay model: the shared base holds
system cases every scope inherits, and each client grows its OWN cases in a real
per-client overlay (clients/<slug>/.recall/golden-additions.json) that sits
OUTSIDE the symlinked scripts/ tree. A client scope is measured against base
UNION overlay; root against base alone. It harvests candidate cases from real
recall usage (routing each to base or overlay) so coverage expands from what was
actually asked, and flags dead weight so the set gets better without bloating.

It only SENSES and PROPOSES. It never edits the golden set or memory. The
judgment layer (cron/jobs/daily-recall-self-improve.md) verifies each proposal
at source and applies the smallest reversible cure. That split is deliberate:
golden cases must be confirmed facts that live in the named source, which is a
judgment call, not a heuristic one.

The rate this script reports is for triage only. The AUTHORITATIVE recall gate
stays scripts/test-recall-golden.sh, run by the nightly index job - the single
source of truth for whether the index is healthy. This script measures the same
golden set per scope with realistic scope wiring (which is also how it catches
client misses the root-scoped clone test could not see), but it never gates a
cron and never competes with that owner.

Per scope it writes:
  - a human report under projects/system-health/{date}_recall-self-improve-{scope}.md
  - a machine-readable actions file the cron job consumes:
      .command-centre/recall-actions-{scope}.json

Usage:
  recall-self-improve.py --scope root
  recall-self-improve.py --scope client --client example-client
Options:
  --window N   usage-log lookback in days (default 30)
  --max-candidates K   cap harvested candidates (default 5) - anti-bloat
  --quiet      print only the one-line summary
"""
import argparse
import glob
import json
import os
import re
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone, timedelta

ROOT = os.path.realpath(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
USAGE_LOG = os.environ.get("AI_OS_RECALL_LOG_PATH") or os.path.join(
    ROOT, ".command-centre", "recall-usage.jsonl")
ORGANIC = {"auto-recall", "manual"}
# Memory surfaces that are legitimate golden expectations (the routine_semantic
# tier of config/memory-index-policy.json). A harvested candidate whose served
# top source is outside this set is not proposed - we do not want deep-search-only
# material (transcripts, inbox, projects) becoming recall expectations.
ROUTINE_PREFIXES = (
    "context/MEMORY.md", "context/learnings.md", "context/memory/",
    "context/wiki/", "context/notion/CATALOG.md", "daily/",
)
ROUTINE_PREFIXES_CLIENT = (
    "context/MEMORY.md", "context/learnings.md", "context/memory/",
    "context/wiki/",
)
# Queries longer than this are almost always a pasted session prompt, not a real
# recall question - never harvest them into a golden set.
MAX_QUERY_CHARS = 160
MIN_QUERY_TOKENS = 3
# Hard safety gate for the acting layer. If the semantic layer is dead or recall
# has collapsed below this floor, the misses are almost certainly an INDEX fault
# (Milvus down, empty generation), not a memory-content fault - curing them would
# edit memory to chase phantom misses. Below this, the actions file says
# safe_to_act=false and the judgment job must only report, never edit.
SAFETY_FLOOR = 0.5
STOP = set("the a an of to for and or in on at is do i how what when where why "
           "with my me your his this that it as be can should would need".split())
# A golden case must be a RECALL QUESTION or a topic query, never a task the
# assistant was told to do. Real usage logs both; only the first kind belongs in
# a benchmark. Leading imperative verbs, slash commands, and "again"/meta filler
# mark a task prompt; a leading question word or a bare noun phrase marks a query.
IMPERATIVE_LEAD = set("implement finish answer write draft fix refine update make "
                      "build create add run redo rewrite do give send review handle "
                      "complete generate produce prepare check tell show find help "
                      "let continue keep put use".split())
QUESTION_LEAD = set("how what where why which who when does is are was were can "
                    "could should did will do".split())
TASKY_SUBSTR = ("/goal", "/loop", "/wrap", " again", "fucking", "as instructed",
                "like i said", "you were supposed", "redo", "re-do")


def looks_like_task_prompt(q):
    ql = q.lower().strip()
    if not ql:
        return True
    if any(b in ql for b in TASKY_SUBSTR):
        return True
    first = re.sub(r"[^a-z]", "", ql.split()[0])
    if first in QUESTION_LEAD:
        return False          # a genuine question - keep even if it names a task noun
    if first in IMPERATIVE_LEAD:
        return True           # an order to the assistant - not a recall question
    return False              # a bare topic/keyword phrase - keep


def clean_query(q):
    """Trim a trailing task clause ('... - answer for the Nick doc') so the
    harvested query reads as a clean recall question."""
    q = q.split("\n")[0].strip()   # a logged query can carry a pasted second line
    m = re.search(r"\s[-–—]\s", q)
    if m:
        head, tail = q[:m.start()].strip(), q[m.end():]
        if len(tokens(head)) >= MIN_QUERY_TOKENS and any(
                re.sub(r"[^a-z]", "", w) in IMPERATIVE_LEAD for w in tail.lower().split()[:2]):
            return head
    return q


def tokens(s):
    return [t for t in re.findall(r"[a-z0-9]+", s.lower()) if t not in STOP and len(t) > 1]


def jaccard(a, b):
    sa, sb = set(a), set(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


BASE_GOLDEN = os.path.join(ROOT, "scripts", "lib", "recall-golden-set.json")


def overlay_path(client):
    # A client's OWN recall cases live in a real per-client file OUTSIDE the
    # symlinked scripts/ tree, so growing it never touches root or other clients.
    return os.path.join(ROOT, "clients", client, ".recall", "golden-additions.json")


def load_cases(scope, client):
    """Merge the shared base set with the client's independent overlay.

    Root sees base only. A client sees base (system recall it inherits) plus its
    own overlay (client-specific recall). This is how per-client benchmarks grow
    independently while system cases stay shared - working WITH the scripts/lib
    symlink, not against it."""
    base = json.load(open(BASE_GOLDEN))
    cases = list(base.get("cases", []))
    overlay_count = 0
    if scope == "client":
        op = overlay_path(client)
        if os.path.exists(op):
            try:
                over = json.load(open(op))
            except Exception:
                over = {"cases": []}
            seen = {c.get("query", "").lower() for c in cases}
            for c in over.get("cases", []):
                if c.get("query", "").lower() not in seen:
                    cases.append(c)
                    overlay_count += 1
    merged = dict(base)
    merged["cases"] = cases
    return merged, len(base.get("cases", [])), overlay_count


def search_scope_args(scope, client):
    # root measures the root layer; a client measures the realistic session scope
    # (its own surfaces plus root), which is what a real client session uses.
    if scope == "root":
        return ["--scope", "root"]
    return ["--scope", "workspace", "--client", client]


def run_search(query, top_k, scope, client):
    cmd = ["bash", os.path.join(ROOT, "scripts", "memsearch-search.sh"),
           query, str(top_k)] + search_scope_args(scope, client)
    env = dict(os.environ, AI_OS_RECALL_CALLER="eval")
    try:
        raw = subprocess.run(cmd, capture_output=True, text=True, timeout=120,
                             cwd=ROOT, env=env).stdout
        start = raw.find("[")
        return json.loads(raw[start:]) if start >= 0 else []
    except Exception:
        return []


def src_of(r):
    return str(r.get("source") or r.get("source_path") or "")


def measure(golden, scope, client):
    """Run every golden case; return rate, para stats and the structured misses."""
    top_k = int(golden.get("top_k", 3))
    hits, misses = 0, []
    para_hits = para_total = 0
    semantic_alive = False
    for case in golden.get("cases", []):
        q, expect = case["query"], case["expect_source"]
        is_para = bool(case.get("paraphrase"))
        para_total += 1 if is_para else 0
        results = run_search(q, top_k, scope, client)
        sources = [src_of(r) for r in results]
        if any((r.get("search_mode") in {"semantic", "hybrid"}
                or "semantic" in (r.get("search_modes") or [])
                or "hybrid" in (r.get("search_modes") or [])) for r in results):
            semantic_alive = True
        matching = [s for s in sources if re.search(expect, s)]
        if matching:
            hits += 1
            para_hits += 1 if is_para else 0
        else:
            misses.append({"query": q, "expect": expect, "top": sources[:top_k]})
    total = len(golden.get("cases", []))
    return {
        "total": total, "hits": hits,
        "rate": hits / total if total else 0.0,
        "para_hits": para_hits, "para_total": para_total,
        "para_rate": para_hits / para_total if para_total else 1.0,
        "semantic_alive": semantic_alive, "misses": misses, "top_k": top_k,
    }


def load_usage(window_days, scope, client):
    cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)
    recs = []
    for path in (USAGE_LOG, USAGE_LOG + ".1"):
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                ts = rec.get("ts", "")
                try:
                    when = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
                except Exception:
                    continue
                if when < cutoff:
                    continue
                if rec.get("caller") not in ORGANIC:
                    continue
                recs.append(rec)
    return recs


def is_routine(src, scope, client):
    if scope == "root":
        return any(src.startswith(p) for p in ROUTINE_PREFIXES)
    prefix = f"clients/{client}/"
    if src.startswith(prefix):
        rest = src[len(prefix):]
        return any(rest.startswith(p) for p in ROUTINE_PREFIXES_CLIENT)
    # root memory surfaces are also legitimate answers inside a client session
    return any(src.startswith(p) for p in ROUTINE_PREFIXES)


def harvest(usage, golden, scope, client, max_candidates):
    """Real organic queries with no golden coverage yet -> candidate cases."""
    covered = [tokens(c["query"]) for c in golden.get("cases", [])]
    # score by frequency; keep the strongest served source as the proposed expect
    buckets = {}
    for rec in usage:
        q = (rec.get("q") or "").strip()
        if len(q) > MAX_QUERY_CHARS:
            continue
        if looks_like_task_prompt(q):
            continue
        q = clean_query(q)
        qt = tokens(q)
        if len(qt) < MIN_QUERY_TOKENS:
            continue
        # already covered by an existing golden case?
        if any(jaccard(qt, ct) >= 0.6 for ct in covered):
            continue
        items = rec.get("items") or []
        if not items:
            continue
        top = items[0]
        src = str(top.get("src") or "")
        if not is_routine(src, scope, client):
            continue
        key = " ".join(sorted(set(qt)))
        b = buckets.setdefault(key, {"query": q, "count": 0, "src": src,
                                     "head": top.get("head", ""), "qt": qt})
        b["count"] += 1
        # prefer the shorter, cleaner phrasing as the representative query
        if len(q) < len(b["query"]):
            b["query"] = q
    # de-dupe candidates that overlap each other, keep the most frequent
    ranked = sorted(buckets.values(), key=lambda x: (-x["count"], x["query"]))
    chosen = []
    for cand in ranked:
        if any(jaccard(cand["qt"], c["qt"]) >= 0.6 for c in chosen):
            continue
        chosen.append(cand)
        if len(chosen) >= max_candidates:
            break
    for c in chosen:
        c.pop("qt", None)
        # Route each candidate: a fact served from THIS client's own files is
        # client-specific -> its overlay; a root/system fact -> the shared base.
        src = c.get("src", "")
        if scope == "client" and src.startswith(f"clients/{client}/"):
            c["target"] = "overlay"
        else:
            c["target"] = "base"
    return chosen


def dead_cases(golden, scope, client):
    """Golden cases whose expected source no longer resolves to any real file."""
    base = ROOT if scope == "root" else os.path.join(ROOT, "clients", client)
    dead = []
    for case in golden.get("cases", []):
        expect = case["expect_source"]
        # turn the anchored-ish regex into a coarse literal prefix to test existence
        literal = re.split(r"[\\(\[.*+?]", expect)[0].strip("/")
        if not literal:
            continue
        probe = os.path.join(ROOT, literal)
        probe_client = os.path.join(base, literal)
        # a directory pattern (context/memory/) is alive if the dir has any .md
        if os.path.isdir(probe) or os.path.isdir(probe_client):
            continue
        matches = glob.glob(probe + "*") or glob.glob(probe_client + "*")
        if not matches:
            dead.append(case["query"])
    return dead


def cold_summary():
    try:
        out = subprocess.run(
            ["python3", os.path.join(ROOT, "scripts", "recall-usage-report.py"),
             "--summary"], capture_output=True, text=True, timeout=60, cwd=ROOT).stdout.strip()
        return out
    except Exception:
        return ""


def build_report(scope, client, m, candidates, dead, cold, today,
                 base_count=0, overlay_count=0):
    label = "root" if scope == "root" else f"client:{client}"
    healthy = bool(m["semantic_alive"]) and m["rate"] >= SAFETY_FLOOR
    lines = [f"# Recall Self-Improvement - {label} - {today}", ""]
    if not healthy:
        lines.append("> SAFE_TO_ACT = FALSE. The index looks broken (semantic layer "
                     "dead or recall collapsed). These misses are an index fault, not "
                     "a memory fault. The acting layer must REPORT ONLY and edit nothing.")
        lines.append("")
    lines.append(f"## Recall quality (measured this run, correct scope)")
    lines.append(f"- Golden recall at top-{m['top_k']}: {m['hits']}/{m['total']} "
                 f"({m['rate']:.0%}); paraphrase {m['para_hits']}/{m['para_total']}; "
                 f"semantic layer {'alive' if m['semantic_alive'] else 'DEAD'}")
    if scope == "client":
        lines.append(f"- Benchmark = {base_count} shared base cases + "
                     f"{overlay_count} client overlay cases (this client's own)")
    lines.append("")
    lines.append("## Misses to cure (judgment layer applies smallest safe fix)")
    if m["misses"]:
        for x in m["misses"]:
            lines.append(f"- MISS `{x['query']}` -> wanted `{x['expect']}`; "
                         f"top served: {x['top']}")
    else:
        lines.append("- None. Every golden case is found at top-k.")
    lines.append("")
    lines.append("## Harvested candidate cases (self-expansion - verify at source before promoting)")
    if candidates:
        for c in candidates:
            lines.append(f"- CANDIDATE [{c.get('target','base')}] `{c['query']}` "
                         f"(asked x{c['count']}) -> proposed expect `{c['src']}` "
                         f"(head: {c['head']})")
    else:
        lines.append("- None. No uncovered real recall questions in the window.")
    lines.append("")
    lines.append("## Dead weight (anti-bloat - prune after confirming)")
    lines.append(f"- Dead golden cases (expected source gone): "
                 f"{dead if dead else 'none'}")
    lines.append(f"- Cold memory signal: {cold or 'below signal threshold or nothing actionable'}")
    lines.append("")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scope", choices=["root", "client"], default="root")
    ap.add_argument("--client", default="")
    ap.add_argument("--window", type=int, default=30)
    ap.add_argument("--max-candidates", type=int, default=5)
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    if args.scope == "client" and not args.client:
        print("--scope client requires --client", file=sys.stderr)
        return 2

    if not os.path.exists(BASE_GOLDEN):
        print(f"no base golden set at {BASE_GOLDEN}", file=sys.stderr)
        return 2
    golden, base_count, overlay_count = load_cases(args.scope, args.client)

    m = measure(golden, args.scope, args.client)
    usage = load_usage(args.window, args.scope, args.client)
    candidates = harvest(usage, golden, args.scope, args.client, args.max_candidates)
    dead = dead_cases(golden, args.scope, args.client)
    cold = cold_summary()

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    label = "root" if args.scope == "root" else args.client
    report = build_report(args.scope, args.client, m, candidates, dead, cold, today,
                          base_count, overlay_count)

    out_dir = os.path.join(ROOT, "projects", "system-health")
    os.makedirs(out_dir, exist_ok=True)
    report_path = os.path.join(out_dir, f"{today}_recall-self-improve-{label}.md")
    with open(report_path, "w", encoding="utf-8") as fh:
        fh.write(report + "\n")

    # Hard gate: never let a broken index trigger memory edits.
    index_healthy = bool(m["semantic_alive"]) and m["rate"] >= SAFETY_FLOOR
    # Growth targets. The shared base (system cases, symlinked across all scopes)
    # is written only for the root scope. A client grows its OWN overlay, a real
    # per-client file outside the symlinked scripts/ tree - safe, no contamination.
    over_path = overlay_path(args.client) if args.scope == "client" else None
    actions = {
        "scope": args.scope, "client": args.client, "date": today,
        "base_golden_path": os.path.relpath(BASE_GOLDEN, ROOT),
        "overlay_path": os.path.relpath(over_path, ROOT) if over_path else None,
        "base_case_count": base_count,
        "overlay_case_count": overlay_count,
        "base_writable": args.scope == "root",
        "overlay_writable": args.scope == "client",
        "write_routing": ("root writes SYSTEM cases to the shared base; a client "
                          "writes its OWN cases to its overlay. base+overlay are "
                          "measured together for a client scope."),
        "safe_to_act": index_healthy,
        "safe_to_act_reason": (
            "index healthy" if index_healthy else
            f"index looks broken (semantic_alive={m['semantic_alive']}, "
            f"rate={m['rate']:.0%} < floor {SAFETY_FLOOR:.0%}) - report only, do NOT edit"),
        "quality": {k: m[k] for k in ("total", "hits", "rate", "para_rate",
                                      "semantic_alive", "top_k")},
        "misses": m["misses"], "candidates": candidates, "dead_cases": dead,
    }
    cc_dir = os.path.join(ROOT, ".command-centre")
    os.makedirs(cc_dir, exist_ok=True)
    actions_path = os.path.join(cc_dir, f"recall-actions-{label}.json")
    with open(actions_path, "w", encoding="utf-8") as fh:
        json.dump(actions, fh, indent=2)

    actionable = bool(m["misses"] or candidates or dead)
    gate = "" if index_healthy else " [SAFE_TO_ACT=FALSE: index broken, report only]"
    summary = (f"Recall self-improve ({label}, {today}): {m['hits']}/{m['total']} "
               f"({m['rate']:.0%}), {len(m['misses'])} misses to cure, "
               f"{len(candidates)} candidates to grow, {len(dead)} dead to prune.{gate} "
               f"-> {os.path.relpath(report_path, ROOT)}")
    if not args.quiet:
        print(report)
    print(summary)
    # exit 0 always: sensing never fails the cron; the job acts on the actions file
    return 0


if __name__ == "__main__":
    sys.exit(main())

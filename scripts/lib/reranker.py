#!/usr/bin/env python3
"""
reranker.py — Post-fusion reranker for memsearch results.
Stages 1-3 (Stage 4 cross-encoder disabled by default).

Usage:
  memsearch search "query" --top-k 10 --json-output | python3 scripts/lib/reranker.py "query"

Input:  JSON array from memsearch on stdin
Output: Re-ranked JSON array to stdout, sorted by final_score desc
"""

import json
import math
import os
import re
import sys
from datetime import date, datetime

# --- Config ---
DEFAULTS = {
    "half_life_days": 14,
    "floor_ratio": 0.3,
    "recency_floor": 0.7,
    "authority_weights": {
        "context/MEMORY.md": 2.0,
        "context/learnings.md": 1.5,
        "context/memory/": 1.0,
        "brand_context/": 0.8,
    },
    "cross_encoder_enabled": False,
}

def load_config():
    """Load memory-config.json from repo root, fall back to defaults."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    root = os.path.join(script_dir, "..", "..")
    config_path = os.path.join(root, "context", "memory-config.json")
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        cfg = data.get("reranker", {})
        return {**DEFAULTS, **cfg}
    except (FileNotFoundError, json.JSONDecodeError):
        return DEFAULTS

def authority_multiplier(source_path: str, weights: dict) -> float:
    """Return authority weight for source_path by most-specific prefix match.

    Exact file keys take precedence over directory keys. Within each group the
    longest (most specific) matching key wins, so nested directories like
    ``context/`` and ``context/memory/`` resolve to the deeper match.
    """
    if not source_path:
        return 1.0
    # Normalize path separators
    path = source_path.replace("\\", "/")

    # Exact file match takes precedence; pick the longest matching key.
    best_weight = None
    best_len = -1
    for key, weight in weights.items():
        nkey = key.replace("\\", "/")
        if not nkey.endswith("/") and path.endswith(nkey) and len(nkey) > best_len:
            best_len, best_weight = len(nkey), weight
    if best_weight is not None:
        return best_weight

    # Directory/prefix match; pick the longest (most specific) matching key.
    best_len = -1
    for key, weight in weights.items():
        nkey = key.replace("\\", "/")
        if nkey.endswith("/") and (("/" + nkey) in ("/" + path) or path.startswith(nkey)) and len(nkey) > best_len:
            best_len, best_weight = len(nkey), weight
    if best_len >= 0:
        return best_weight

    return 1.0

def extract_file_date(source_path: str):
    """Extract YYYY-MM-DD from filename if present, else None."""
    if not source_path:
        return None
    basename = os.path.basename(source_path.replace("\\", "/"))
    match = re.search(r"(\d{4}-\d{2}-\d{2})", basename)
    if match:
        try:
            return datetime.strptime(match.group(1), "%Y-%m-%d").date()
        except ValueError:
            return None
    return None

def recency_factor(source_path: str, half_life: float) -> float:
    """Exponential recency factor. 1.0 for non-dated files."""
    file_date = extract_file_date(source_path)
    if file_date is None:
        return 1.0
    age_days = (date.today() - file_date).days
    age_days = max(age_days, 0)
    return math.exp(-age_days / half_life)

def rerank(results: list, query: str, cfg: dict) -> list:
    """Apply 3-stage reranking pipeline."""
    half_life = cfg.get("half_life_days", DEFAULTS["half_life_days"])
    floor_ratio = cfg.get("floor_ratio", DEFAULTS["floor_ratio"])
    rec_floor = cfg.get("recency_floor", DEFAULTS["recency_floor"])
    weights = cfg.get("authority_weights", DEFAULTS["authority_weights"])

    if not results:
        return results

    scored = []
    for item in results:
        try:
            raw_score = float(item.get("score", 0.0))
        except (TypeError, ValueError):
            # Tolerate malformed scores rather than crashing the recall path.
            raw_score = 0.0
        # memsearch emits the file path under "source"; keep "source_path"/"path"
        # as fallbacks for other producers. Without "source" the reranker reads
        # an empty path and silently applies no authority or recency weighting.
        source = (
            item.get("source_path", "")
            or item.get("path", "")
            or item.get("source", "")
            or ""
        )

        # Stage 1 — Authority Boost
        auth = authority_multiplier(source, weights)
        s1 = raw_score * auth

        # Stage 2 — Recency Decay
        rf = recency_factor(source, half_life)
        s2 = s1 * (rec_floor + (1.0 - rec_floor) * rf)

        scored.append({**item, "_s1": s1, "_s2": s2})

    # Stage 3 — Floor-Ratio Gating
    # Drop low-relevance noise: anything scoring below floor_ratio of the top
    # result is gated out. The top result always survives (floor_ratio < 1).
    top_s2 = max(x["_s2"] for x in scored) if scored else 1.0
    threshold = top_s2 * floor_ratio

    final = []
    for item in scored:
        s2 = item["_s2"]
        if s2 < threshold:
            continue
        final.append({
            **{k: v for k, v in item.items() if not k.startswith("_")},
            "final_score": round(s2, 6),
            "reranked": True,
        })

    final.sort(key=lambda x: x["final_score"], reverse=True)
    return final

def main():
    query = sys.argv[1] if len(sys.argv) > 1 else ""

    raw = sys.stdin.read().strip()
    if not raw:
        print("[]")
        return

    try:
        results = json.loads(raw)
    except json.JSONDecodeError as e:
        sys.stderr.write(f"reranker: invalid JSON input: {e}\n")
        print(raw)
        return

    if not isinstance(results, list):
        # Passthrough non-list shapes unchanged
        print(raw)
        return

    cfg = load_config()
    reranked = rerank(results, query, cfg)
    print(json.dumps(reranked, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()

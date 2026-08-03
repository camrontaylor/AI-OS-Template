#!/usr/bin/env python3
"""Merge semantic MemSearch and markdown recall results.

The two engines use different score scales, so this uses reciprocal-rank fusion
instead of comparing raw scores. Markdown gets a small weight bump because exact
rare-term hits often rescue queries where semantic search returns broad context.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


DEFAULT_AUTHORITY_WEIGHTS = {
    "context/MEMORY.md": 2.0,
    "context/learnings.md": 1.5,
    "context/memory/": 1.0,
    "brand_context/": 0.8,
}


def load_json(path: str) -> list[dict[str, Any]]:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return []
    return data if isinstance(data, list) else []


def result_source(item: dict[str, Any]) -> str:
    return str(item.get("source") or item.get("source_path") or item.get("path") or "")


def load_authority_weights() -> dict[str, float]:
    """Use the same source-authority contract as the engine rerankers."""
    config_path = Path(__file__).resolve().parents[2] / "context" / "memory-config.json"
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
        weights = data.get("reranker", {}).get("authority_weights", {})
        if isinstance(weights, dict) and weights:
            return {str(key): float(value) for key, value in weights.items()}
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        pass
    return DEFAULT_AUTHORITY_WEIGHTS


def source_diversity_enabled() -> bool:
    """Read reranker.source_diversity from memory-config.json (default True)."""
    config_path = Path(__file__).resolve().parents[2] / "context" / "memory-config.json"
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
        return bool(data.get("reranker", {}).get("source_diversity", True))
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return True


def diversify_by_source(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Pull the best-scoring chunk of each distinct source to the head, in score
    order, then append the remaining same-source chunks. Pure reorder - no item
    is dropped - so it cannot remove a source that was already present; it can
    only add distinct sources to the head. This stops one file from occupying
    several of the top-k slots and crowding out the distinct source that answers
    the query (2026-07-27: fixed the standing MYOB-rotation and orphaned-worktree
    golden near-misses, both caused by one file taking two of the top-3 slots)."""
    seen: set[str] = set()
    head: list[dict[str, Any]] = []
    tail: list[dict[str, Any]] = []
    for item in items:
        src = result_source(item).replace("\\", "/")
        if src and src in seen:
            tail.append(item)
        else:
            if src:
                seen.add(src)
            head.append(item)
    return head + tail


def source_authority(source: str, weights: dict[str, float]) -> float:
    path = source.replace("\\", "/")
    exact = [
        (len(key), weight)
        for key, weight in weights.items()
        if not key.endswith("/") and path.endswith(key)
    ]
    if exact:
        return max(exact)[1]
    directories = [
        (len(key), weight)
        for key, weight in weights.items()
        if key.endswith("/") and (f"/{key}" in f"/{path}" or path.startswith(key))
    ]
    return max(directories)[1] if directories else 1.0


def result_key(item: dict[str, Any]) -> str:
    source = result_source(item)
    start = item.get("start_line", "")
    end = item.get("end_line", "")
    if source and start != "":
        return f"{source}:{start}:{end}"
    return str(item.get("chunk_hash") or json.dumps(item, sort_keys=True))


def result_range(item: dict[str, Any]) -> tuple[int, int] | None:
    try:
        start = int(item.get("start_line"))
        end = int(item.get("end_line"))
    except (TypeError, ValueError):
        return None
    return (start, end) if start <= end else (end, start)


def find_fusion_key(
    item: dict[str, Any],
    fused: dict[str, dict[str, Any]],
    modes: dict[str, set[str]],
    mode: str,
) -> str:
    """Fuse by source file + OVERLAPPING line range, not exact range equality.

    The two engines chunk the same file differently, so exact source:start:end
    keys almost never collide and cross-engine agreement was never rewarded
    (2026-07-16 audit: semantic-only results were structurally suppressed).

    Overlap fusion only applies ACROSS engines: memsearch chunks the same file
    with overlap_lines, so adjacent chunks from one stream always overlap and
    fusing them would reward same-engine redundancy and drop content.
    """
    key = result_key(item)
    if key in fused:
        return key
    source = result_source(item)
    rng = result_range(item)
    if not source or rng is None:
        return key
    for existing_key, existing in fused.items():
        if mode in modes.get(existing_key, set()):
            continue  # same-stream neighbor, not cross-engine agreement
        if result_source(existing) != source:
            continue
        existing_rng = result_range(existing)
        if existing_rng is None:
            continue
        if rng[0] <= existing_rng[1] and existing_rng[0] <= rng[1]:
            return existing_key
    return key


def merge(semantic: list[dict[str, Any]], markdown: list[dict[str, Any]], top_k: int) -> list[dict[str, Any]]:
    fused: dict[str, dict[str, Any]] = {}
    modes: dict[str, set[str]] = {}
    rrf_k = 60.0
    authority_weights = load_authority_weights()

    # Markdown keeps only a genuinely small bump (it beats semantic within ~3
    # ranks, not 22): at 1.35 the entire semantic stream was decorative
    # whenever markdown filled top_k. 1.05 lets cross-vocabulary semantic hits
    # actually surface, which is the whole reason the embedding index exists.
    streams = [
        ("semantic", semantic, 1.0),
        ("markdown_fallback", markdown, 1.05),
    ]

    for mode, results, weight in streams:
        for rank, item in enumerate(results, start=1):
            key = find_fusion_key(item, fused, modes, mode)
            if key not in fused:
                fused[key] = dict(item)
                fused[key]["original_final_score"] = item.get("final_score", item.get("score"))
                fused[key]["fusion_score"] = 0.0
                modes[key] = set()

            modes[key].add(str(item.get("search_mode") or mode))
            fused[key]["fusion_score"] += weight / (rrf_k + rank)

            if mode == "semantic":
                fused[key]["semantic_rank"] = rank
            else:
                fused[key]["markdown_rank"] = rank

    merged = []
    for key, item in fused.items():
        item_modes = sorted(modes[key])
        item["search_modes"] = item_modes
        item["search_mode"] = "hybrid" if len(item_modes) > 1 else item_modes[0]
        authority = source_authority(result_source(item), authority_weights)
        item["source_authority"] = authority
        item["fusion_score"] *= authority
        item["final_score"] = round(float(item["fusion_score"]), 6)
        item["reranked"] = True
        merged.append(item)

    merged.sort(key=lambda item: item.get("fusion_score", 0.0), reverse=True)
    if source_diversity_enabled():
        merged = diversify_by_source(merged)
    return merged[:top_k]


def main() -> int:
    if len(sys.argv) != 4:
        print("Usage: merge-memory-results.py SEMANTIC_JSON MARKDOWN_JSON TOP_K", file=sys.stderr)
        return 64

    semantic = load_json(sys.argv[1])
    markdown = load_json(sys.argv[2])
    top_k = int(sys.argv[3])
    print(json.dumps(merge(semantic, markdown, top_k), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

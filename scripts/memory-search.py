#!/usr/bin/env python3
"""Sandbox-safe markdown recall for AI-OS memory.

This is the deterministic fallback below MemSearch. It reads the authoritative
markdown sources directly, so it needs no Milvus lock file, no loopback port,
and no external service.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path


SOURCE_RULES = [
    ("context/MEMORY.md", 2.0),
    ("context/learnings.md", 1.8),
    ("context/memory/", 0.95),
    ("daily/", 0.9),
    ("brand_context/", 0.8),
    # Wiki and Notion-catalog pages are broad reference material; at the default
    # 1.0 they outranked learnings on the golden set (2026-07-28 review pass 1).
    ("context/wiki/", 0.7),
    ("context/notion/", 0.7),
]

MEMORY_SOURCE_FILES = [
    "context/MEMORY.md",
    "context/learnings.md",
    "context/notion/CATALOG.md",
]

MEMORY_SOURCE_DIRS = [
    "context/memory",
    "context/wiki",
    "daily",
]

# Top-level context/*.md is the durable synthesis layer (overview,
# relationship-history, ops synthesis, timeline, current-state, decisions,
# SOUL/USER, ...). Globbed non-recursively so deep-search-only subfolders
# (inbox/, notion/items/, transcripts/, meetings/, reference/) stay out. Kept in
# sync with the routine_semantic tier in config/memory-index-policy.json so the
# markdown fallback and the semantic index cover the same surfaces (2026-07-27).
MEMORY_TOPLEVEL_MD_DIRS = [
    "context",
]

# Curated knowledge subfolders: durable vendor/product/reference synthesis one
# level down inside context/ (e.g. context/myob-exo/). The top-level *.md glob
# above is non-recursive, so a whole knowledge folder was a recall blind spot
# (2026-07-29 fix). Kept in sync with KNOWLEDGE_SUBFOLDERS in
# scripts/memsearch-reindex.sh and routine_semantic in the index policy. Add a
# folder NAME here to make its markdown routinely searchable, root and clients.
KNOWLEDGE_SUBFOLDERS = [
    "myob-exo",
    "operator",
]
# Noisy machine maps inside a knowledge folder (large table-of-contents / topic
# dumps) that must stay OUT of routine recall. Matched against the full path.
KNOWLEDGE_SUBFOLDER_SKIP_RE = re.compile(r"/official-help/topic-index\.md$")

CLIENT_REFERENCE_DIRS = [
    "brand_context",
]

# Cron-generated maintenance reports that live inside memory folders but are
# not memory. Kept out of recall so boilerplate never competes with real facts.
GENERATED_REPORT_RE = re.compile(r"_(gap-analysis|memory-health)\.md$")

# Non-recall files caught by the top-level context/*.md glob: learnings.shared.md
# is the git-tracked mirror of learnings.md (double-counts lessons), prompt-tags.md
# is prompt config. Kept in sync with the same skip in memsearch-reindex.sh.
NON_MEMORY_NAMES = {"learnings.shared.md", "prompt-tags.md"}

MAX_MARKDOWN_FILE_BYTES = int(os.environ.get("AI_OS_MEMORY_SEARCH_MAX_FILE_BYTES", "600000"))
MACOS_DATALESS_FLAG = 0x40000000

SYSTEM_RECALL_TERMS = {
    "ai-os",
    "aios",
    "fallback",
    "lock",
    "memory",
    "memsearch",
    "milvus",
    "recall",
    "sandbox",
    "semantic",
}

SYSTEM_NOTE_MARKERS = {
    "markdown fallback",
    "memory recall",
    "memsearch",
    "milvus",
    "recall layer",
    "sandbox",
    "semantic search",
    "semantic-only",
}


@dataclass
class Section:
    source: Path
    rel_source: str
    heading: str
    heading_level: int
    start_line: int
    end_line: int
    content: str


@dataclass(frozen=True)
class TermGroup:
    term: str
    variants: tuple[str, ...]


def tokenize(query: str) -> list[str]:
    words = re.findall(r"[a-z0-9][a-z0-9_-]{1,}", query.lower())
    stop = {
        "about",
        "after",
        "again",
        "also",
        "from",
        "have",
        "into",
        "that",
        "their",
        "there",
        "this",
        "what",
        "when",
        "where",
        "which",
        "with",
        "would",
        "your",
    }
    return [word for word in words if word not in stop]


def term_variants(term: str) -> tuple[str, ...]:
    variants = {term}
    if len(term) > 4 and term.endswith("ies"):
        variants.add(term[:-3] + "y")
    if len(term) > 4 and term.endswith("es"):
        variants.add(term[:-2])
    if len(term) > 3 and term.endswith("s"):
        variants.add(term[:-1])
    return tuple(sorted(variants, key=lambda item: (-len(item), item)))


def build_term_groups(query: str) -> list[TermGroup]:
    seen: set[str] = set()
    groups: list[TermGroup] = []
    for term in tokenize(query):
        if term in seen:
            continue
        seen.add(term)
        groups.append(TermGroup(term=term, variants=term_variants(term)))
    return groups


def is_client_root(path: Path) -> bool:
    return path.parent.name == "clients" and (path / "context").is_dir()


def workspace_root(start: Path) -> Path:
    if is_client_root(start) and (start.parent.parent / "AGENTS.md").is_file():
        return start.parent.parent
    return start


def client_dirs(root: Path) -> list[Path]:
    clients_root = root / "clients"
    if not clients_root.is_dir():
        return []
    return sorted(
        path
        for path in clients_root.iterdir()
        if path.is_dir() and (path / "context").is_dir()
    )


def source_roots(root: Path, initial_root: Path, scope: str, client: str | None) -> list[Path]:
    current_is_client = is_client_root(initial_root)

    if scope == "current":
        return [initial_root] if current_is_client else [root]

    if scope == "root":
        return [root]

    if scope == "client":
        if client:
            target = root / "clients" / client
        elif current_is_client:
            target = initial_root
        else:
            raise ValueError("--scope client requires --client when --root is not a client folder")
        return [target] if (target / "context").is_dir() else []

    if scope == "clients":
        return client_dirs(root)

    if scope == "all":
        return [root, *client_dirs(root)]

    if scope == "workspace":
        # One client plus the root layer, never other clients (default recall
        # scope inside a client folder). Without a client it is just root.
        if client:
            target = root / "clients" / client
        elif current_is_client:
            target = initial_root
        else:
            return [root]
        return [root, target] if (target / "context").is_dir() else [root]

    raise ValueError(f"unknown memory search scope: {scope}")


def candidate_files(root: Path, source_root: Path) -> list[Path]:
    files: list[Path] = []
    explicit = [source_root / rel for rel in MEMORY_SOURCE_FILES]
    files.extend(path for path in explicit if path.is_file())

    for rel_dir in MEMORY_SOURCE_DIRS:
        directory = source_root / rel_dir
        if directory.is_dir():
            files.extend(sorted(directory.rglob("*.md")))

    # Durable synthesis layer: top-level *.md only (non-recursive), matching the
    # routine_semantic tier so fallback recall does not silently lose these
    # surfaces when Milvus is locked/blocked.
    for rel_dir in MEMORY_TOPLEVEL_MD_DIRS:
        directory = source_root / rel_dir
        if directory.is_dir():
            files.extend(sorted(directory.glob("*.md")))

    # Curated knowledge subfolders (e.g. context/myob-exo/): durable vendor/
    # product/reference synthesis one level down, walked recursively but with the
    # noisy machine maps skipped. Matches add_knowledge_subfolder in
    # memsearch-reindex.sh so fallback and semantic index cover the same surfaces
    # (2026-07-29 blind-spot fix). No-op when the folder is absent.
    context_dir = source_root / "context"
    if context_dir.is_dir():
        for sub in KNOWLEDGE_SUBFOLDERS:
            sub_dir = context_dir / sub
            if sub_dir.is_dir():
                files.extend(
                    path
                    for path in sorted(sub_dir.rglob("*.md"))
                    if not KNOWLEDGE_SUBFOLDER_SKIP_RE.search(path.as_posix())
                )

    # Client brand context is useful when the caller deliberately scopes recall
    # to clients, but root brand/transcript archives are not routine memory.
    if source_root != root and is_client_root(source_root):
        for rel_dir in CLIENT_REFERENCE_DIRS:
            directory = source_root / rel_dir
            if directory.is_dir():
                files.extend(sorted(directory.rglob("*.md")))

    # Generated maintenance reports inside memory folders are machine
    # boilerplate, not memory (2026-07-16 audit) - keep them out of recall.
    files = [p for p in files if not GENERATED_REPORT_RE.search(p.name)]
    files = [p for p in files if p.name not in NON_MEMORY_NAMES]

    seen: set[Path] = set()
    unique: list[Path] = []
    for path in files:
        resolved = path.resolve()
        if resolved not in seen:
            seen.add(resolved)
            unique.append(path)
    return unique


def rel_path(root: Path, path: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def split_sections(root: Path, path: Path) -> list[Section]:
    try:
        stat_result = path.stat()
        if stat_result.st_size > MAX_MARKDOWN_FILE_BYTES:
            return []
        if getattr(stat_result, "st_flags", 0) & MACOS_DATALESS_FLAG:
            return []
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []

    lines = text.splitlines()
    if not lines:
        return []

    sections: list[Section] = []
    current_start = 1
    current_heading = path.name
    current_level = 0

    heading_re = re.compile(r"^(#{1,6})\s+(.+?)\s*$")

    def emit(end_line: int) -> None:
        if end_line < current_start:
            return
        content_lines = lines[current_start - 1 : end_line]
        content = "\n".join(content_lines).strip()
        if not content:
            return
        sections.append(
            Section(
                source=path.resolve(),
                rel_source=rel_path(root, path),
                heading=current_heading,
                heading_level=current_level,
                start_line=current_start,
                end_line=end_line,
                content=content,
            )
        )

    for idx, line in enumerate(lines, start=1):
        match = heading_re.match(line)
        if not match:
            continue
        if idx > current_start:
            emit(idx - 1)
        current_start = idx
        current_level = len(match.group(1))
        current_heading = match.group(2).strip()

    emit(len(lines))
    return sections


def authority(rel_source: str) -> float:
    client_match = re.match(r"clients/[^/]+/(.+)", rel_source)
    if client_match:
        return authority(client_match.group(1))

    best_len = -1
    best_weight = 1.0
    for prefix, weight in SOURCE_RULES:
        if prefix.endswith("/"):
            matches = rel_source.startswith(prefix)
        else:
            matches = rel_source == prefix
        if matches and len(prefix) > best_len:
            best_len = len(prefix)
            best_weight = weight
    return best_weight


def file_date(rel_source: str) -> date | None:
    match = re.search(r"(\d{4}-\d{2}-\d{2})", rel_source)
    if not match:
        return None
    try:
        return datetime.strptime(match.group(1), "%Y-%m-%d").date()
    except ValueError:
        return None


def recency(rel_source: str) -> float:
    found = file_date(rel_source)
    if found is None:
        return 1.0
    age_days = max((date.today() - found).days, 0)
    return 0.7 + 0.3 * math.exp(-age_days / 14)


def query_is_system_recall(groups: list[TermGroup]) -> bool:
    terms = {group.term for group in groups}
    return bool(terms & SYSTEM_RECALL_TERMS)


TEMPORAL_QUERY_RE = re.compile(
    r"\b(yesterday|today|tonight|recently|latest|last (night|week|month)|this (week|month))\b|\d{4}-\d{2}-\d{2}"
)


def source_fit(section: Section, groups: list[TermGroup], temporal: bool = False) -> float:
    """Prefer the memory source type that matches the query shape."""
    is_system_query = query_is_system_recall(groups)
    fit = 1.0
    source_rel = section.rel_source
    client_match = re.match(r"clients/[^/]+/(.+)", source_rel)
    local_rel = client_match.group(1) if client_match else source_rel

    if source_rel.startswith("clients/") and is_system_query:
        fit *= 0.55
    if not is_system_query:
        haystack = section_haystack(section)
        if any(marker in haystack for marker in SYSTEM_NOTE_MARKERS):
            fit *= 0.35
    # Temporal-intent queries ("what did we do yesterday", a date) genuinely
    # want the dated session record, not durable lessons (review pass 2, F5).
    if temporal and (local_rel.startswith("context/memory/") or local_rel.startswith("daily/")):
        fit *= 1.5
    # NOTE (2026-07-28 memory diagnosis): this function used to multiply any
    # learnings.md hit by 0.35 on non-system queries and boost daily logs 1.15x
    # on longer queries. That structurally suppressed the user's own lesson and
    # preference record for every normal work query - the golden set's
    # learnings-expected cases went 2/13 under it - and was a direct cause of
    # "memory exists but never surfaces". Learnings authority now comes from
    # SOURCE_RULES alone, with the narrow temporal boost above as the one
    # query-shaped exception.
    return fit


def trim_content(content: str, terms: list[str], max_chars: int = 900) -> str:
    compact = re.sub(r"\n{3,}", "\n\n", content).strip()
    if len(compact) <= max_chars:
        return compact

    lowered = compact.lower()
    hit_positions = [lowered.find(term) for term in terms if term and lowered.find(term) >= 0]
    if hit_positions:
        center = min(hit_positions)
        start = max(0, center - 220)
    else:
        start = 0

    end = min(len(compact), start + max_chars)
    snippet = compact[start:end].strip()
    if start > 0:
        snippet = "..." + snippet
    if end < len(compact):
        snippet = snippet + "..."
    return snippet


def section_haystack(section: Section) -> str:
    return f"{section.heading}\n{section.content}".lower()


def variant_count(haystack: str, group: TermGroup) -> int:
    return sum(haystack.count(variant) for variant in group.variants)


def document_frequency(sections: list[Section], groups: list[TermGroup]) -> dict[str, int]:
    freqs: dict[str, int] = {group.term: 0 for group in groups}
    for section in sections:
        haystack = section_haystack(section)
        for group in groups:
            if variant_count(haystack, group) > 0:
                freqs[group.term] += 1
    return freqs


def idf_weights(section_count: int, freqs: dict[str, int]) -> dict[str, float]:
    return {
        term: math.log((section_count + 1) / (freq + 1)) + 1.0
        for term, freq in freqs.items()
    }


def score_section(section: Section, query: str, groups: list[TermGroup], idf: dict[str, float], temporal: bool = False) -> float:
    haystack = f"{section.heading}\n{section.content}".lower()
    if not groups and not query.strip():
        return 0.0

    hits: list[tuple[TermGroup, int]] = []
    for group in groups:
        count = variant_count(haystack, group)
        if count > 0:
            hits.append((group, count))

    unique_hits = len(hits)
    phrase_bonus = 2.5 if query.strip().lower() in haystack else 0.0
    heading_bonus = 1.5 if any(
        any(variant in section.heading.lower() for variant in group.variants)
        for group in groups
    ) else 0.0

    if unique_hits == 0 and phrase_bonus == 0:
        return 0.0

    min_hits = max(1, min(4, math.ceil(len(groups) * 0.3)))
    if len(groups) >= 5 and unique_hits < min_hits and phrase_bonus == 0:
        return 0.0

    weighted_unique = sum(idf.get(group.term, 1.0) for group, _ in hits)
    weighted_counts = sum(min(count, 4) * idf.get(group.term, 1.0) * 0.18 for group, count in hits)
    coverage = unique_hits / max(len(groups), 1)
    coverage_bonus = 1.0 + coverage

    word_count = max(len(re.findall(r"\w+", section.content)), 1)
    length_factor = max(0.45, 1.0 / math.sqrt(max(word_count / 160, 1.0)))

    raw = (weighted_unique * 2.0 + weighted_counts + phrase_bonus + heading_bonus) * coverage_bonus
    return raw * authority(section.rel_source) * recency(section.rel_source) * length_factor * source_fit(section, groups, temporal)


def search(root: Path, query: str, top_k: int, scope: str, client: str | None) -> list[dict]:
    initial_root = root
    root = workspace_root(root)
    groups = build_term_groups(query)
    terms = sorted({variant for group in groups for variant in group.variants}, key=len, reverse=True)
    sections: list[Section] = []
    for source_root in source_roots(root, initial_root, scope, client):
        for path in candidate_files(root, source_root):
            sections.extend(split_sections(root, path))

    freqs = document_frequency(sections, groups)
    idf = idf_weights(len(sections), freqs)
    temporal = bool(TEMPORAL_QUERY_RE.search(query.lower()))
    scored: list[tuple[float, Section]] = []
    for section in sections:
        final_score = score_section(section, query, groups, idf, temporal)
        if final_score > 0:
            scored.append((final_score, section))

    scored.sort(key=lambda item: item[0], reverse=True)

    # Source-diversity reorder (same lever as merge-memory-results.py, 2026-07-27):
    # pull the best chunks of each DISTINCT source to the head before slicing
    # top-k, so one file cannot monopolize every slot and crowd out the distinct
    # expected source. Two chunks per source keep their rank before demotion
    # (review pass 2, F4: a strict one-per-source cap was evicting high-scoring
    # second chunks of the correct file on nearly every query). Pure reorder -
    # it can never drop a present source.
    per_source: dict[str, int] = {}
    diverse: list[tuple[float, Section]] = []
    rest: list[tuple[float, Section]] = []
    for item in scored:
        src = item[1].rel_source
        count = per_source.get(src, 0)
        if count >= 2:
            rest.append(item)
        else:
            per_source[src] = count + 1
            diverse.append(item)
    scored = diverse + rest

    results = []
    for final_score, section in scored[:top_k]:
        chunk_id = f"{section.rel_source}:{section.start_line}:{section.end_line}"
        results.append(
            {
                "chunk_hash": hashlib.sha1(chunk_id.encode("utf-8")).hexdigest()[:16],
                "content": trim_content(section.content, terms),
                "source": section.source.as_posix(),
                "heading": section.heading,
                "heading_level": section.heading_level,
                "start_line": section.start_line,
                "end_line": section.end_line,
                "score": round(final_score, 6),
                "final_score": round(final_score, 6),
                "reranked": True,
                "search_mode": "markdown_fallback",
            }
        )
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description="Search AI-OS memory markdown without MemSearch.")
    parser.add_argument("query")
    parser.add_argument("top_k", nargs="?", default=10, type=int)
    parser.add_argument("--root", default=Path(__file__).resolve().parents[1])
    parser.add_argument(
        "--scope",
        choices=["current", "root", "client", "clients", "all", "workspace"],
        default="current",
        help="Memory scope: current workspace, root only, one client, all clients, or root plus all clients.",
    )
    parser.add_argument("--client", help="Client slug to use with --scope client.")
    args = parser.parse_args()

    if args.top_k < 1:
        print("top_k must be a positive integer", file=sys.stderr)
        return 64

    root = Path(args.root).expanduser().resolve()
    try:
        results = search(root, args.query, args.top_k, args.scope, args.client)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 64

    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

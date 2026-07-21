#!/usr/bin/env python3
"""Fast complete-source MemSearch sync for AI-OS.

The upstream `memsearch index` command queries existing chunk hashes once per
source file. That is fine for a small memory folder, but AI-OS can have 1k+
Notion item files. This wrapper keeps the same chunk IDs and source paths while
loading existing hashes once for the whole collection, then embedding only
missing chunks.
"""

from __future__ import annotations

import argparse
import asyncio
import re
from collections import defaultdict
from pathlib import Path

from memsearch.chunker import chunk_markdown, compute_chunk_id
from memsearch.cli import _build_cli_overrides, _cfg_to_memsearch_kwargs, _safe_resolve_config
from memsearch.core import MemSearch
from memsearch.io import read_utf8_text_replace
from memsearch.scanner import scan_paths


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fast complete-source MemSearch sync for AI-OS.")
    parser.add_argument("paths", nargs="+", help="Files or directories to index.")
    parser.add_argument("--collection", required=True, help="Milvus collection name.")
    parser.add_argument("--force", action="store_true", help="Re-index all chunks.")
    parser.add_argument("--embed-batch-chunks", type=int, default=256, help="Chunks per embed/upsert call.")
    parser.add_argument("--delete-batch", type=int, default=1000, help="Chunk hashes per delete call.")
    return parser.parse_args()


def chunked(values: list, size: int):
    for index in range(0, len(values), size):
        yield values[index : index + size]


async def run() -> int:
    args = parse_args()
    cfg = _safe_resolve_config(_build_cli_overrides(collection=args.collection))
    ms = MemSearch(list(args.paths), **_cfg_to_memsearch_kwargs(cfg))

    try:
        existing_by_source: dict[str, set[str]] = defaultdict(set)
        for row in ms._store.query():
            source = row.get("source")
            chunk_hash = row.get("chunk_hash")
            if source and chunk_hash:
                existing_by_source[source].add(chunk_hash)

        files = scan_paths(list(args.paths))
        # Generated maintenance reports living inside memory folders are
        # machine boilerplate, not memory; indexing them dilutes recall with
        # near-identical health text (2026-07-16 audit). Their previously
        # indexed chunks fall out via the stale-source prune below.
        generated_re = re.compile(r"_(gap-analysis|memory-health)\.md$")
        files = [f for f in files if not generated_re.search(str(f.path))]
        model = ms._embedder.model_name
        active_sources: set[str] = set()
        stale_hashes: list[str] = []
        chunks_to_embed = []
        embedded_total = 0

        for scanned in files:
            source = str(Path(scanned.path).resolve())
            active_sources.add(source)
            text = read_utf8_text_replace(scanned.path)
            chunks = chunk_markdown(
                text,
                source=source,
                max_chunk_size=ms._max_chunk_size,
                overlap_lines=ms._overlap_lines,
            )

            chunk_ids = {
                compute_chunk_id(chunk.source, chunk.start_line, chunk.end_line, chunk.content_hash, model)
                for chunk in chunks
            }
            old_ids = existing_by_source.get(source, set())
            stale_hashes.extend(old_ids - chunk_ids)

            if args.force:
                missing = chunks
            else:
                missing = [
                    chunk
                    for chunk in chunks
                    if compute_chunk_id(chunk.source, chunk.start_line, chunk.end_line, chunk.content_hash, model)
                    not in old_ids
                ]

            chunks_to_embed.extend(missing)
            while len(chunks_to_embed) >= args.embed_batch_chunks:
                batch = chunks_to_embed[: args.embed_batch_chunks]
                del chunks_to_embed[: args.embed_batch_chunks]
                embedded_total += await ms._embed_and_store(batch)

        for source, old_ids in existing_by_source.items():
            if source not in active_sources:
                stale_hashes.extend(old_ids)

        for batch in chunked(list(dict.fromkeys(stale_hashes)), args.delete_batch):
            ms._store.delete_by_hashes(batch)

        if chunks_to_embed:
            embedded_total += await ms._embed_and_store(chunks_to_embed)

        print(
            f"Fast-index scanned {len(files)} file(s); "
            f"embedded {embedded_total} chunk(s); deleted {len(set(stale_hashes))} stale chunk(s)."
        )
        return 0
    finally:
        ms.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))

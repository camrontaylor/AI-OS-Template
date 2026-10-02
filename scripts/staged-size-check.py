#!/usr/bin/env python3
"""Read the staged batch without changing it; oversized autosaves need review."""
import json
import subprocess
import sys

LIMIT = 50 * 1024 * 1024
FILE_LIMIT = 5 * 1024 * 1024


def git(repo, *args, data=None):
    return subprocess.run(["git", "-C", repo, *args], input=data, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=True).stdout


def main():
    repo = sys.argv[1]
    existing = set()
    for entry in git(repo, "ls-tree", "-r", "-z", "HEAD").split(b"\0"):
        if entry:
            meta = entry.split(b"\t", 1)[0].split()
            if meta[1] == b"blob":
                existing.add(meta[2])
    rows = git(repo, "diff", "--cached", "--raw", "--no-abbrev", "--no-renames",
               "--diff-filter=ACMT", "-z").split(b"\0")
    candidates = {}
    for i in range(0, len(rows) - 1, 2):
        mode, oid = rows[i].split()[1:4:2]
        if mode != b"160000" and oid not in existing:
            candidates.setdefault(oid, rows[i + 1].decode("utf-8", errors="replace"))
    total = 0
    sizes = []
    if candidates:
        result = git(repo, "cat-file", "--batch-check", data=b"\n".join(candidates) + b"\n")
        for line in result.splitlines():
            oid, kind, size = line.split()
            if kind != b"blob" or oid not in candidates:
                raise ValueError("unsupported staged object")
            total += int(size)
            sizes.append({"path": candidates[oid], "bytes": int(size)})
        if len(sizes) != len(candidates):
            raise ValueError("incomplete staged object measurement")
    # ceiling: raw unique payloads absent from HEAD are a conservative budget,
    # not packed disk usage. A historical restore can need deliberate review.
    print(json.dumps({"new_blob_bytes": total, "limit_bytes": LIMIT,
                      "file_limit_bytes": FILE_LIMIT, "new_blobs": len(sizes),
                      "largest": sorted(sizes, key=lambda item: item["bytes"], reverse=True)[:10]}))
    return 2 if total > LIMIT or any(item["bytes"] > FILE_LIMIT for item in sizes) else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, IndexError, subprocess.CalledProcessError):
        print("aggregate measurement unavailable; staged work retained")
        sys.exit(3)

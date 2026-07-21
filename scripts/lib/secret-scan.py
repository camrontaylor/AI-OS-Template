#!/usr/bin/env python3
"""Fail on credential-shaped values without printing the values themselves."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


TOKEN_PREFIX = re.compile(
    r"(?<![A-Za-z0-9_-])(?:"
    r"sk-[A-Za-z0-9_-]{20,}|"
    r"github_pat_[A-Za-z0-9_]{20,}|"
    r"gh[pousr]_[A-Za-z0-9]{30,}|"
    r"xox[baprs]-[A-Za-z0-9-]{20,}|"
    r"AKIA[0-9A-Z]{16}|"
    r"AIza[0-9A-Za-z_-]{30,}"
    r")"
)
PRIVATE_KEY = re.compile(r"-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----")
CREDENTIAL_ASSIGNMENT = re.compile(
    r"\b[A-Za-z0-9_-]*(?:"
    r"api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|"
    r"password|passwd|pwd|recovery[_-]?(?:code|key)"
    r")\b\s*[:=]\s*(?P<quote>[\"']?)(?P<value>[^\s,\"'#]+)(?P=quote)",
    re.IGNORECASE,
)
PLACEHOLDER_MARKERS = (
    "placeholder",
    "example",
    "dummy",
    "test",
    "your_",
    "your-",
    "replace",
    "changeme",
    "redacted",
    "actual-secret",
    "secret-value",
    "secret-token",
    "notion-secret",
    "oauth-token",
    "xxxxx",
    ".....",
)


def is_placeholder(value: str) -> bool:
    raw = value.strip().strip("\"'`")
    if (
        "_" in raw
        and re.fullmatch(r"[A-Z][A-Z0-9_]{5,}", raw)
        and raw.endswith(("_API_KEY", "_TOKEN", "_SECRET", "_PASSWORD", "_RECOVERY_CODE"))
    ):
        return True
    cleaned = raw.lower()
    if len(cleaned) < 8:
        return True
    if cleaned.startswith(("$", "${", "<", "process.env", "os.getenv", "env(")):
        return True
    return any(marker in cleaned for marker in PLACEHOLDER_MARKERS)


def tracked_files(root: Path) -> list[str]:
    completed = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-z"],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    if completed.returncode != 0:
        return []
    return [item.decode("utf-8", "surrogateescape") for item in completed.stdout.split(b"\0") if item]


def scan_file(root: Path, relative: str) -> list[tuple[int, str]]:
    path = root / relative
    try:
        raw = path.read_bytes()
    except (OSError, ValueError):
        return []
    if b"\0" in raw:
        return []

    text = raw.decode("utf-8", "replace")
    findings: list[tuple[int, str]] = []
    seen: set[tuple[int, str]] = set()
    config_like = path.suffix.lower() in {".env", ".toml", ".yaml", ".yml", ".ini", ".conf", ".properties"} or ".env." in path.name.lower()
    for line_no, line in enumerate(text.splitlines(), start=1):
        if PRIVATE_KEY.search(line):
            seen.add((line_no, "private-key"))

        for match in TOKEN_PREFIX.finditer(line):
            if not is_placeholder(match.group(0)):
                seen.add((line_no, "token-prefix"))

        for match in CREDENTIAL_ASSIGNMENT.finditer(line):
            value = match.group("value")
            quote = match.group("quote")
            line_lower = line.lower()
            if "e.g." in line_lower or "example" in line_lower or "\\n" in value:
                continue
            expression_like = bool(
                re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]*(?:\([^)]*\))?;?", value)
                or any(marker in value for marker in ("(", ")", "{", "}", "[", "]"))
            )
            if not quote and not config_like and expression_like:
                continue
            if not is_placeholder(value):
                seen.add((line_no, "credential-assignment"))

    findings.extend(sorted(seen))
    return findings


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: secret-scan.py ROOT [FILE ...]", file=sys.stderr)
        return 64

    root = Path(sys.argv[1]).resolve()
    files = sys.argv[2:] or tracked_files(root)
    found = False
    for item in files:
        relative = str(Path(item))
        for line_no, rule in scan_file(root, relative):
            print(f"{relative}:{line_no}:{rule}")
            found = True
    return 1 if found else 0


if __name__ == "__main__":
    raise SystemExit(main())

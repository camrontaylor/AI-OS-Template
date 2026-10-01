#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "pillow>=10.0.0",
#     "rembg>=2.0.50",
#     "onnxruntime>=1.16.0",
# ]
# ///
"""
Atomic logo intake: copy + safe background removal in ONE invocation.

This script is the SINGLE entry point for logo intake. Calling it guarantees:
  1. The file is copied to brand_context/visual-identity/logos/ with a normalized name
  2. clean_logo_bg.process_one() runs in-process (same rembg session, no subprocess)
  3. A decision JSON is returned (stdout) describing what happened per file

Why atomic (not 2 separate scripts): the orchestrator cannot accidentally do
copy-without-cleanup. Both happen or neither does. Removes the failure mode where
Claude reads the SKILL.md, copies the file, and forgets to invoke the cleanup.

Filename normalization:
  "Logo <Brand Name>.jpg" → "logo-your-brand.jpg"
  "My_Brand-MARK.PNG"        → "my-brand-mark.png"

SVGs pass through untouched (no bg removal needed — they have alpha by design).
PNG/JPG/JPEG go through the full clean_logo_bg pipeline.

Usage:
  uv run intake_logo.py --input path/to/logo.png --brand-context brand_context
  uv run intake_logo.py --input path/to/folder/ --brand-context brand_context
  uv run intake_logo.py --input logo.png --brand-context brand_context --dry-run
"""

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

# Import clean_logo_bg as module to share the rembg session in-process
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

ALLOWED_EXTS = {".png", ".jpg", ".jpeg", ".svg"}


def normalize_name(stem: str) -> str:
    """'Logo <Brand Name>' → 'logo-your-brand'."""
    s = stem.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-") or "logo"


def collect_inputs(input_path: Path) -> list[Path]:
    """Single file → [file]. Folder → all images in it (non-recursive)."""
    if input_path.is_file():
        return [input_path]
    if input_path.is_dir():
        return sorted(
            p for p in input_path.iterdir()
            if p.is_file() and p.suffix.lower() in ALLOWED_EXTS
        )
    return []


def copy_normalized(src: Path, logos_dir: Path) -> Path:
    """Copy src into logos_dir with normalized filename. Returns dst path."""
    suffix = src.suffix.lower()
    dst_name = f"{normalize_name(src.stem)}{suffix}"
    dst = logos_dir / dst_name
    if dst.exists() and dst.resolve() == src.resolve():
        return dst  # already in place
    shutil.copy2(src, dst)
    return dst


def process_one_atomic(
    src: Path,
    logos_dir: Path,
    audit_dir: Path,
    dry_run: bool,
    rembg_session,
) -> dict:
    """Copy + clean in one logical operation. Returns decision record."""
    suffix = src.suffix.lower()
    if suffix not in ALLOWED_EXTS:
        return {"input": str(src), "decision": "error", "reason": f"unsupported ext {suffix!r}"}

    # 1. Copy (always — even SVGs)
    if dry_run:
        dst = logos_dir / f"{normalize_name(src.stem)}{suffix}"
        return {
            "input": str(src),
            "dst_would_be": str(dst),
            "decision": "would-process",
            "reason": "dry-run",
        }
    dst = copy_normalized(src, logos_dir)

    # 2. SVG: skip cleanup (vectors have alpha by design)
    if suffix == ".svg":
        return {
            "input": str(src),
            "output_copy": str(dst),
            "decision": "ok",
            "reason": "svg-passthrough (no bg removal needed)",
            "transparent_output": None,
            "comparison": None,
        }

    # 3. PNG/JPG: run clean_logo_bg.process_one() in-process
    from clean_logo_bg import process_one as cleanup
    decision = cleanup(dst, logos_dir, audit_dir, dry_run=False, rembg_session=rembg_session)
    # Augment with copy info for clarity
    decision["input_original"] = str(src)
    decision["copied_to"] = str(dst)
    return decision


def main() -> int:
    parser = argparse.ArgumentParser(description="Atomic logo intake (copy + safe bg removal).")
    parser.add_argument("--input", required=True, help="Single file or folder of logos to intake.")
    parser.add_argument("--brand-context", required=True, help="Path to brand_context/ directory.")
    parser.add_argument("--dry-run", action="store_true", help="Print what WOULD happen — copy nothing.")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    if not input_path.exists():
        print(f"Error: input not found: {input_path}", file=sys.stderr)
        return 1

    brand_context = Path(args.brand_context).resolve()
    logos_dir = brand_context / "visual-identity" / "logos"
    audit_dir = logos_dir / "_bg_clean"

    if not args.dry_run:
        logos_dir.mkdir(parents=True, exist_ok=True)
        audit_dir.mkdir(parents=True, exist_ok=True)

    inputs = collect_inputs(input_path)
    if not inputs:
        print(f"Error: no supported image files found at {input_path}", file=sys.stderr)
        return 1

    # Lazy-init ONE rembg session shared across all files (model loads once)
    rembg_session = None
    needs_rembg = any(p.suffix.lower() in (".png", ".jpg", ".jpeg") for p in inputs)
    if needs_rembg and not args.dry_run:
        try:
            from rembg import new_session
            rembg_session = new_session("u2net")
        except Exception as e:
            print(f"Error: rembg unavailable: {e}", file=sys.stderr)
            return 2

    decisions = []
    for src in inputs:
        print(f"  → {src.name}", file=sys.stderr)
        rec = process_one_atomic(src, logos_dir, audit_dir, args.dry_run, rembg_session)
        decisions.append(rec)
        print(f"    {rec['decision'].upper()}: {rec.get('reason', '')}", file=sys.stderr)

    # Persist decisions
    if not args.dry_run:
        report_path = audit_dir / "_decisions.json"
        existing = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else []
        existing.extend(decisions)
        report_path.write_text(json.dumps(existing, indent=2), encoding="utf-8")
        print(f"\nDecisions: {report_path}", file=sys.stderr)
        print(f"Audit PNGs: {audit_dir}", file=sys.stderr)

    # JSON to stdout for orchestrator to parse
    print(json.dumps(decisions, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml>=6.0", "pillow>=10.0.0", "numpy>=1.26.0"]
# ///
"""ONE COMMAND end-to-end template QA.

Runs the full standard procedure documented in references/standard-procedure.md:
  1. Validate _measurements.yaml (gutter, scale, spacing rhythm — see design-fundamentals.md)
  2. Render preview.png (via render_template.py)
  3. Generate diagnostic artifacts to _workdir/ (comparison, overlay, diff, grid)
  4. Numerical text-height comparison (ref vs preview)
  5. Cleanup old iteration files

All diagnostic / log artifacts go to {template_dir}/_workdir/ — the template root stays
clean (ref.png, bg.png, template.html, instructions.md, _measurements.yaml, preview.png +
brand-extracted assets like badge.png / icon.png).

Usage:

    uv run run_template_qa.py \\
        --template-dir brand_context/templates/<pool>/<slug> \\
        --brand-context brand_context \\
        [--ref path/to/ref.png]          # default: <template-dir>/ref.png
        [--art-director]                  # also spawn ssc-art-director agent
        [--strict]                        # exit non-zero on any warning

Exit codes:
  0 — all checks pass
  1 — script error (missing file, bad config)
  2 — validation failed (HARD gate)
  3 — warnings present and --strict was set"""
import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path


# Image / chrome slots are not text content — they are not required in the instructions
# ## Slots enumeration the same way text zones are (image binding lives in the ai-image-zone
# block; chrome is injected from tokens.json). The completeness check (D2) governs CONTENT
# text slots: every text-bearing data-slot the template.html declares must be enumerated in
# instructions.md ## Slots — no gaps (the highlight-stack LINE_3 skip).
_NON_TEXT_SLOT_HINTS = ("logo", "badge", "icon", "photo", "image", "bg", "background",
                        "mark", "wordmark", "brand", "masthead", "dots", "pagination",
                        "_path", "src")


def template_text_slots(html: str) -> list[str]:
    """CONTENT-text data-slot names declared in template.html (chrome/image slots excluded)."""
    out: list[str] = []
    for s in re.findall(r'data-slot\s*=\s*["\']([^"\']+)["\']', html, re.IGNORECASE):
        sl = s.lower()
        if any(h in sl for h in _NON_TEXT_SLOT_HINTS):
            continue
        if s not in out:
            out.append(s)
    return out


def instructions_enumerated_slots(text: str) -> list[str]:
    """Slot names enumerated under the ## Slots section of instructions.md (document order)."""
    slot_re = re.compile(r"^[-*]\s+\*?\*?([A-Z][A-Z0-9_]+)\*?\*?\s*[—\-]")
    out: list[str] = []
    in_slots = False
    for line in text.splitlines():
        stripped = line.strip()
        if re.match(r"^#{1,3}\s+Slots\s*$", stripped, re.IGNORECASE):
            in_slots = True
            continue
        if in_slots and re.match(r"^#{1,3}\s+\S", stripped):
            in_slots = False
            continue
        if not in_slots:
            continue
        m = slot_re.match(stripped)
        if m and m.group(1) not in out:
            out.append(m.group(1))
    return out


def check_instructions_slot_completeness(template_html: str, instructions_text: str) -> list[str]:
    """D2 — every CONTENT text data-slot in template.html must be enumerated in
    instructions.md ## Slots (no gaps). Returns a list of issue strings (empty = pass).

    Catches the highlight-stack-cover defect: the template declares LINE_1/LINE_2/LINE_4 +
    CONNECTOR but instructions.md's ## Slots block omits one — the Template Card no longer
    enumerates every slot the template renders. Case-agnostic: the contract is one ## Slots
    entry per text data-slot the HTML declares."""
    declared = template_text_slots(template_html)
    enumerated = set(instructions_enumerated_slots(instructions_text))
    missing = [s for s in declared if s not in enumerated]
    if not missing:
        return []
    return [
        f"instructions.md ## Slots omits text slot(s) the template.html declares: "
        f"{', '.join(missing)}. Every text data-slot the template renders must be enumerated "
        f"in the Template Card's ## Slots block (no gaps) — an un-enumerated slot is an "
        f"authoring contract hole (the user opens instructions.md and a rendered zone is "
        f"undocumented)."
    ]


SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
VIZ_RENDER = SKILL_DIR.parent.parent.parent / ".claude/skills/viz-image-gen/scripts/render_template.py"
VALIDATE = SCRIPT_DIR / "validate_measurements.py"
COMPARE = SCRIPT_DIR / "compare_ref_to_preview.py"
MEASURE = SCRIPT_DIR / "measure_text_heights.py"


def run(cmd: list[str], description: str) -> tuple[int, str, str]:
    """Run a subprocess, return (exit_code, stdout, stderr)."""
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.returncode, result.stdout, result.stderr


def section(title: str) -> None:
    print()
    print(f"=== {title} ".ljust(70, "="))


def cleanup_old_iterations(workdir: Path) -> int:
    """Delete versioned iteration files (e.g., _grid_vN.png) keeping only the latest.
    Returns the number of files deleted."""
    deleted = 0
    if not workdir.exists():
        return 0
    # Match patterns like _grid_v2.png, _grid_v15.png, _overlay_v3.png, etc.
    import re
    pattern = re.compile(r"_(grid|overlay|diff|comparison)_v\d+\.png$", re.IGNORECASE)
    for f in workdir.iterdir():
        if pattern.search(f.name):
            f.unlink()
            deleted += 1
    return deleted


def main() -> int:
    ap = argparse.ArgumentParser(description="One-command template QA per standard-procedure.md")
    ap.add_argument("--template-dir", required=True, type=Path)
    ap.add_argument("--brand-context", required=True, type=Path)
    ap.add_argument("--ref", type=Path, help="Path to ref.png (default: <template-dir>/ref.png)")
    ap.add_argument("--art-director", action="store_true", help="Also spawn the ssc-art-director agent")
    ap.add_argument("--strict", action="store_true", help="Exit non-zero on any warning")
    args = ap.parse_args()

    tdir = args.template_dir.resolve()
    if not tdir.is_dir():
        print(f"Error: template-dir not found: {tdir}", file=sys.stderr)
        return 1

    workdir = tdir / "_workdir"
    workdir.mkdir(exist_ok=True)

    measurements = tdir / "_measurements.yaml"
    template_html = tdir / "template.html"
    ref = args.ref or (tdir / "ref.png")
    preview = tdir / "preview.png"

    issues_count = 0
    warnings_count = 0

    # ── Step 1: Validate measurements ─────────────────────────────────
    section("STEP 1 — Validate _measurements.yaml")
    if not measurements.exists():
        print(f"[skip] no _measurements.yaml at {measurements}")
    else:
        code, out, err = run([sys.executable, "-u", str(VALIDATE), "--measurements", str(measurements)],
                              "validate_measurements")
        # Either uv or python — try uv first
        if code != 0 and "ModuleNotFoundError" in err:
            code, out, err = run(["uv", "run", str(VALIDATE), "--measurements", str(measurements)],
                                  "validate_measurements (uv)")
        # Print whatever we got
        if out: print(out.strip())
        if err: print(err.strip())
        if code == 2:
            issues_count += 1  # validation failed (hard error)
        elif "warning" in (err.lower() + out.lower()):
            warnings_count += 1

    # ── Step 2: Render preview ────────────────────────────────────────
    section("STEP 2 — Render preview.png")
    if not template_html.exists():
        print(f"[fail] no template.html at {template_html}", file=sys.stderr)
        return 1
    code, out, err = run([
        "uv", "run", str(VIZ_RENDER),
        "--template-dir", str(tdir),
        "--brand-context", str(args.brand_context.resolve()),
        "--output", str(preview),
        "--use-sample-text",
    ], "render_template")
    if code != 0:
        print(f"[fail] render failed:\n{err}", file=sys.stderr)
        return 1
    print(f"[ok] {preview.name} rendered")

    # ── Step 3: Visual diagnostic — grid + overlay + diff ─────────────
    section("STEP 3 — Visual diagnostics (grid + overlay + diff)")
    if ref.exists() and preview.exists():
        for mode, fname in [("grid", "_grid.png"), ("overlay", "_overlay.png"), ("diff", "_diff.png")]:
            out_path = workdir / fname
            code, _, err = run([
                "uv", "run", str(COMPARE),
                "--ref", str(ref),
                "--preview", str(preview),
                "--mode", mode,
                "--output", str(out_path),
            ], f"compare {mode}")
            if code == 0:
                print(f"[ok] _workdir/{fname}")
            else:
                print(f"[warn] {mode} failed: {err.strip()[:100]}")
    else:
        print(f"[skip] ref.png not found at {ref}")

    # ── Step 4: Numerical text-height comparison ──────────────────────
    section("STEP 4 — Text-height delta (ref vs preview)")
    if ref.exists() and preview.exists():
        code, out, err = run([
            "uv", "run", str(MEASURE),
            "--image", str(preview),
            "--compare-to", str(ref),
        ], "measure_text_heights")
        if out: print(out.strip())
    else:
        print("[skip] missing ref or preview")

    # ── Step 4b: instructions ↔ slots completeness (D2) ───────────────
    section("STEP 4b — instructions.md ↔ template slots completeness")
    instructions = tdir / "instructions.md"
    if instructions.exists():
        slot_issues = check_instructions_slot_completeness(
            template_html.read_text(encoding="utf-8", errors="ignore"),
            instructions.read_text(encoding="utf-8", errors="ignore"),
        )
        if slot_issues:
            for issue in slot_issues:
                print(f"[fail] {issue}", file=sys.stderr)
            issues_count += 1
        else:
            print("[ok] every template text slot is enumerated in instructions.md ## Slots")
    else:
        print(f"[skip] no instructions.md at {instructions}")

    # ── Step 5: Cleanup old iteration files ───────────────────────────
    section("STEP 5 — Cleanup old iterations")
    deleted = cleanup_old_iterations(workdir)
    if deleted:
        print(f"[ok] deleted {deleted} old iteration file(s) from _workdir/")
    else:
        print("[ok] no old iterations to clean")

    # ── Final report ──────────────────────────────────────────────────
    section("RESULT")
    print(f"  Errors:    {issues_count}")
    print(f"  Warnings:  {warnings_count}")
    print(f"  Preview:   {preview}")
    print(f"  Artifacts: {workdir}")
    if args.art_director:
        print("  Art-director: spawn manually via Agent tool with ssc-art-director")
    if issues_count > 0:
        return 2
    if warnings_count > 0 and args.strict:
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())

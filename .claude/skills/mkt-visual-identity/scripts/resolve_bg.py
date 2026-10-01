#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml>=6.0"]
# ///
"""Per-post bg resolution. Reads template's bg_slot.substitution_options,
matches with brand_context assets + user preference, executes the chosen method.

Methods:
  - brand-headshot / brand-product : clean_ref.py with --ref bg.png + --ref-aux <brand-asset>
  - ai-generated                    : viz-image-gen with prompt_template
  - user-upload                     : copy user image to output
  - keep-default                    : copy bg.png to output

Usage:
    uv run resolve_bg.py --template-dir <p> --brand-context <p> --choice auto --output <p>
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
CLEAN_REF = SCRIPT_DIR / "clean_ref.py"


def find_brand_assets(brand_context: Path, pattern: str) -> list[Path]:
    p = pattern.replace("brand_context/", "").replace("brand_context\\", "")
    if "{" in p and "}" in p:
        prefix, _, rest = p.partition("{")
        exts, _, suffix = rest.partition("}")
        results = []
        for ext in exts.split(","):
            results.extend(brand_context.glob(prefix + ext + suffix))
        return sorted(results)
    return sorted(brand_context.glob(p))


def auto_pick_method(template_dir: Path, brand_context: Path) -> tuple[str, dict | None, list[Path]]:
    import yaml
    meas = yaml.safe_load((template_dir / "_measurements.yaml").read_text(encoding="utf-8")) or {}
    bg_slot = meas.get("bg_slot") or {}
    for opt in (bg_slot.get("substitution_options") or []):
        method = opt.get("method")
        pattern = opt.get("source_pattern")
        if method in ("brand-headshot", "brand-product") and pattern:
            assets = find_brand_assets(brand_context, pattern)
            if assets:
                return method, opt, assets
    return "keep-default", None, []


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--template-dir", required=True, type=Path)
    ap.add_argument("--brand-context", required=True, type=Path)
    ap.add_argument("--choice", default="auto", choices=["brand-headshot", "brand-product", "ai-generated", "user-upload", "keep-default", "auto"])
    ap.add_argument("--output", required=True, type=Path)
    ap.add_argument("--user-image", type=Path)
    ap.add_argument("--subject", default="founder")
    args = ap.parse_args()

    tdir = args.template_dir.resolve()
    bc = args.brand_context.resolve()
    default_bg = tdir / "bg.png"
    if not default_bg.exists():
        print(f"Error: default bg.png not at {default_bg}", file=sys.stderr)
        return 1

    import yaml
    meas = yaml.safe_load((tdir / "_measurements.yaml").read_text(encoding="utf-8")) or {}
    options = {opt.get("method"): opt for opt in ((meas.get("bg_slot") or {}).get("substitution_options") or [])}

    if args.choice == "auto":
        method, option_block, assets = auto_pick_method(tdir, bc)
        print(f"[auto] picked: {method}", file=sys.stderr)
    else:
        method = args.choice
        option_block = options.get(method)
        assets = find_brand_assets(bc, option_block.get("source_pattern", "")) if (method in ("brand-headshot", "brand-product") and option_block) else []

    args.output.parent.mkdir(parents=True, exist_ok=True)

    if method == "keep-default":
        shutil.copy(default_bg, args.output)
        print(f"[keep-default] {args.output}")
        return 0

    if method == "user-upload":
        if not args.user_image or not args.user_image.exists():
            print("Error: --choice user-upload requires --user-image", file=sys.stderr)
            return 1
        shutil.copy(args.user_image, args.output)
        print(f"[user-upload] {args.output}")
        return 0

    if method in ("brand-headshot", "brand-product"):
        if not assets:
            print(f"Error: {method} chosen but no brand asset matched", file=sys.stderr)
            return 1
        aux = assets[0]
        prompt = (
            "Edit this scene photograph. PRESERVE composition, lighting, camera equipment, "
            "background props. REPLACE the central person with the person shown in the SECOND "
            "input image — match their pose to the scene but render the new person's face/likeness "
            "exactly. Photographic realism, no stylization. Match studio lighting."
        )
        cmd = ["uv", "run", str(CLEAN_REF), "--ref", str(default_bg), "--ref-aux", str(aux),
               "--prompt", prompt, "--output", str(args.output)]
        print(f"[{method}] {default_bg.name} + {aux.name} -> {args.output.name}", file=sys.stderr)
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"clean_ref failed:\n{r.stderr}", file=sys.stderr)
            return r.returncode
        print(f"[{method}] {args.output}")
        return 0

    if method == "ai-generated":
        prompt = (option_block or {}).get("prompt_template", "").replace("{{subject}}", args.subject)
        viz = SCRIPT_DIR.parent.parent.parent / ".claude/skills/viz-image-gen/scripts/generate_image_gpt.py"
        cmd = ["uv", "run", str(viz), "--prompt", prompt, "--filename", str(args.output),
               "--size", "1024x1536", "--quality", "high"]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"viz-image-gen failed:\n{r.stderr}", file=sys.stderr)
            return r.returncode
        print(f"[ai-generated] {args.output}")
        return 0

    print(f"Error: unknown method {method}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())

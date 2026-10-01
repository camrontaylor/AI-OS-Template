#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml>=6.0"]
# ///
"""Walk a template pool, aggregate per-template _measurements.yaml into manifest.json.

The manifest becomes a queryable catalog that downstream skills (00-social-content,
ssc-designer) use to pick templates by role/tone/bg-requirements.

Per template, the manifest captures (denormalized from _measurements.yaml):
  - role                            (cover / body / cta — derived from folder name or explicit `role:` in measurements)
  - bg_subject_type                 (person-portrait / product-shot / scene-backdrop / textured / none)
  - required_slots[]                (element ids with required:true)
  - optional_slots[]                (element ids with required:false)
  - bg_substitution_methods[]       (methods declared in bg_slot.substitution_options)
  - has_composition_techniques      (bool — has scrims/vignettes/gradients)
  - fits[]                          (tone tags from instructions.md if present)
  - tone[]                          (style tags from instructions.md if present)
  - status                          (ready / draft — from existing manifest if present)

Usage:
    uv run build_manifest.py --pool-dir brand_context/templates/linkedin-carousel
    uv run build_manifest.py --pool-dir <path> --dry-run    # preview without writing
"""
import argparse
import json
import re
import sys
from pathlib import Path


def detect_role(template_dir: Path, measurements: dict) -> str:
    """Derive role from slug heuristic or measurements content."""
    slug = template_dir.name.lower()
    if "cover" in slug or "hero" in slug:
        return "cover"
    if "cta" in slug:
        return "cta"
    # body is the default for content-bearing templates
    return "body"


def parse_instructions_tags(instructions_path: Path) -> tuple[list[str], list[str]]:
    """Read instructions.md for `fits:` and `tone:` declarations (if any).
    Returns (fits, tone)."""
    if not instructions_path.exists():
        return [], []
    text = instructions_path.read_text(encoding="utf-8", errors="ignore")
    fits = []
    tone = []
    # Look for lines like `fits: [...]` or `tone: [...]`
    fits_m = re.search(r"^fits\s*:\s*\[(.*?)\]", text, re.MULTILINE | re.IGNORECASE)
    tone_m = re.search(r"^tone\s*:\s*\[(.*?)\]", text, re.MULTILINE | re.IGNORECASE)
    if fits_m:
        fits = [s.strip().strip('"\'') for s in fits_m.group(1).split(",") if s.strip()]
    if tone_m:
        tone = [s.strip().strip('"\'') for s in tone_m.group(1).split(",") if s.strip()]
    return fits, tone


def build_entry(template_dir: Path) -> dict | None:
    """Build a manifest entry for one template folder. Returns None if no _measurements.yaml."""
    measurements_path = template_dir / "_measurements.yaml"
    if not measurements_path.exists():
        return None

    import yaml
    meas = yaml.safe_load(measurements_path.read_text(encoding="utf-8")) or {}

    role = detect_role(template_dir, meas)

    bg_slot = meas.get("bg_slot") or {}
    bg_subject_type = bg_slot.get("subject_type", "none")
    bg_methods = []
    for opt in bg_slot.get("substitution_options", []) or []:
        m = opt.get("method")
        if m and m not in bg_methods:
            bg_methods.append(m)

    required_slots = []
    optional_slots = []
    for el in meas.get("elements", []) or []:
        eid = el.get("id")
        if not eid:
            continue
        if el.get("required") is True:
            required_slots.append(eid)
        elif el.get("required") is False:
            optional_slots.append(eid)

    has_comp_tech = bool(meas.get("composition_techniques"))

    fits, tone = parse_instructions_tags(template_dir / "instructions.md")

    return {
        "id": template_dir.name,
        "file": f"{template_dir.name}/template.html",   # path the renderer resolves (rooted at pool_dir)
        "role": role,
        "bg_subject_type": bg_subject_type,
        "required_slots": required_slots,
        "optional_slots": optional_slots,
        "bg_substitution_methods": bg_methods,
        "has_composition_techniques": has_comp_tech,
        "fits": fits,
        "tone": tone,
        "status": "ready",  # default; preserved from existing manifest below if present
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pool-dir", required=True, type=Path)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    pool = args.pool_dir.resolve()
    if not pool.is_dir():
        print(f"Error: pool-dir not found: {pool}", file=sys.stderr)
        return 1

    # Read existing manifest to preserve status per template
    manifest_path = pool / "manifest.json"
    # Preserve status per template id. Accept BOTH manifest shapes for back-compat:
    # a dict keyed by id, OR a list of entries (the renderer's canonical shape).
    existing = {}
    if manifest_path.exists():
        try:
            existing_data = json.loads(manifest_path.read_text(encoding="utf-8"))
            ex_templates = existing_data.get("templates") or existing_data.get("variations") or {}
            if isinstance(ex_templates, dict):
                existing = dict(ex_templates)
            elif isinstance(ex_templates, list):
                existing = {t["id"]: t for t in ex_templates if isinstance(t, dict) and t.get("id")}
        except Exception:
            pass

    # Emit `templates` as a LIST of entries — the shape render_template.py consumes
    # (it iterates entries and reads entry["id"]/["file"]/["status"]). A dict-keyed
    # manifest broke pool-mode rendering ('str' object has no attribute 'get').
    templates: list[dict] = []
    for tdir in sorted(pool.iterdir()):
        if not tdir.is_dir() or tdir.name.startswith("_"):
            continue
        entry = build_entry(tdir)
        if not entry:
            continue
        # Preserve status if previously declared
        if entry["id"] in existing:
            entry["status"] = existing[entry["id"]].get("status", "ready")
        templates.append(entry)

    manifest = {
        "version": 2,                            # v2 = parameterized-recipe schema
        "pool": pool.name,
        "templates": templates,
        "summary": {
            "count": len(templates),
            "by_role": {
                "cover": sum(1 for t in templates if t["role"] == "cover"),
                "body": sum(1 for t in templates if t["role"] == "body"),
                "cta": sum(1 for t in templates if t["role"] == "cta"),
            },
            "by_bg_subject": {},
        },
    }
    for t in templates:
        st = t["bg_subject_type"] or "none"
        manifest["summary"]["by_bg_subject"][st] = manifest["summary"]["by_bg_subject"].get(st, 0) + 1

    if args.dry_run:
        print(json.dumps(manifest, indent=2))
        return 0

    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Wrote {manifest_path}")
    print(f"  {manifest['summary']['count']} templates ({manifest['summary']['by_role']})")
    print(f"  bg subject types: {manifest['summary']['by_bg_subject']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

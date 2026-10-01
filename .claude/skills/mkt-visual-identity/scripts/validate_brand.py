#!/usr/bin/env python3
"""validate_brand.py — single consolidated validator for the visual-identity skill.

Replaces the per-gate validators (validate_inventory, validate_template_zones,
validate_moves_yaml, validate_moves_vs_templates) with one CLI that runs all
four gates inline. The skill writes ONE artifact per concern (no parallel
machine/human files): moves.md carries structured data in <!--meta--> HTML
comment blocks; per-template inventory lives in a `## Inventory` YAML code block
inside instructions.md.

GATES
=====

G1 (per-template) — inventory decision-reason validator.
    For each element with decision in {skip, simplify, drop, omit}, require a
    `reason:` field that is >=20 chars and does NOT match the banned regex
    (cost, easier, faster, skip-photo, CSS-only, deterministic, save-API, etc).

G3 (per-template) — photo-zone contract.
    If inventory's `requires_photo_zone: true`, the template.html MUST contain
    at least one element with class containing 'photo-zone', id starting with
    'photo-', or data-zone='photo'. Also enforces inventory-internal consistency
    (scene-with-figures vs requires_photo_zone, photo_zones[] vs the flag).

G4 (brand-level) — moves.md frontmatter sanity.
    For each move section in moves.md, require a <!--meta ... --> YAML block
    with `name` (kebab-case slug) and `image_bearing` (bool). When
    image_bearing:true, `required_zone_types` must be a non-empty list.

G2 (brand-level) — moves vs templates cross-check.
    For each move with image_bearing:true, ensure at least one template (in
    scope: ready by default, or ready+draft with --include-draft) supports one
    of the move's required_zone_types. Support is declared either explicitly
    via manifest.json template entry's `supports_zone_types`, or inferred from
    legacy `image_zone != "none"` (-> 'photo-zone').

G6 (per-template) — render-completeness + QA report + chrome consistency.
    Five sub-checks:
      G6a: `_measurements.yaml` must exist (measurements workflow was followed).
      G6b: preview rendered — `preview.png` in template_dir OR `_preview/{slug}.png` in pool.
      G6c: chrome consistency with tokens.json:
            - tokens.chrome.masthead.enabled:false → no uncommented <div class="masthead">
            - tokens.chrome.pagination:null → no uncommented <div class="dots">
            - chrome divs must use Mustache placeholders, not hardcoded brand text
      G6d: art-director QA report exists at `_workdir/art-director-report.md`
           (cannot promote a template to ready without QA having run).
      G6e: text-height delta — if the report contains a `## Text height delta` section,
            the "Max delta:" line must be ≤8% (per measurement-protocol). When the
            section is absent OR delta exceeds threshold, FAIL.
    G6c runs only when tokens.json is resolvable (via --brand-context or walk-up).

USAGE
=====

    # Per-template gates only (G1 + G3)
    uv run validate_brand.py --template-dir <path>

    # Brand-level gates only (G2 + G4)
    uv run validate_brand.py --brand-context <path>

    # Both — full pre-promotion check
    uv run validate_brand.py --brand-context <path> --template-dir <path>

    # During Phase 5 (before user accepts a draft template), include draft
    # entries in the G2 supporter pool
    uv run validate_brand.py --brand-context <path> --include-draft

Exit codes: 0 = every gate in scope passed; 1 = >=1 gate failed.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Iterable

# Force UTF-8 stdout/stderr so em-dashes and other unicode in reports/messages
# survive on Windows consoles (default cp1252 fails on chars outside ANSI).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

try:
    import yaml
except ImportError:
    print("ERROR: PyYAML not installed. Run: uv pip install pyyaml", file=sys.stderr)
    sys.exit(2)


# ─── Constants ──────────────────────────────────────────────────────────────

BANNED_REASON_PATTERNS = re.compile(
    r"\b(cost|cheap|expensive|easier|faster|quick(?:er)?|skip[\s\-_]?photo|"
    r"css[\s\-_]?only|deterministic|save[\s\-_]?api|api[\s\-_]?call|"
    r"\$\d|dollars?|cents?)\b",
    re.IGNORECASE,
)
SKIP_LIKE_DECISIONS = {"skip", "simplify", "drop", "omit"}
MIN_REASON_LEN = 20

# Photo-zone detection patterns in template.html
PHOTO_ZONE_PATTERNS = [
    re.compile(r"""class\s*=\s*["'][^"']*\bphoto-zone\b[^"']*["']""", re.IGNORECASE),
    re.compile(r"""id\s*=\s*["']photo-[\w\-]+["']""", re.IGNORECASE),
    re.compile(r"""data-zone\s*=\s*["']photo["']""", re.IGNORECASE),
]

# Move section header in moves.md (e.g., "## 1. Red Hand-Drawn Sketch Overlay")
MOVE_SECTION_RE = re.compile(r"^##\s+\d+[\.\)]\s+(.+?)$", re.MULTILINE)
# <!--meta ... --> block (YAML inside HTML comment, used right after a move heading)
META_BLOCK_RE = re.compile(r"<!--meta\s*\n(.*?)\n-->", re.DOTALL)

# YAML code block under `## Inventory` heading in instructions.md
INVENTORY_BLOCK_RE = re.compile(
    r"^##\s+Inventory\s*\n+```yaml\s*\n(.*?)\n```",
    re.MULTILINE | re.DOTALL,
)

# Allowed zone-type tokens (kept in sync with template-conventions.md)
ALLOWED_ZONE_TYPES = {
    "photo-zone", "silhouette-bg", "cutout", "hero-overlay",
    "illustration-overlay", "annotation-overlay", "icon-zone",
    "text-zone", "pill", "callout-card", "page-indicator",
    "masthead", "dots",
}


# ─── Result accumulator ─────────────────────────────────────────────────────


class Report:
    def __init__(self) -> None:
        self.failures: list[str] = []
        self.passes: list[str] = []

    def fail(self, gate: str, msg: str) -> None:
        self.failures.append(f"[{gate} FAIL] {msg}")

    def ok(self, gate: str, msg: str) -> None:
        self.passes.append(f"[{gate} PASS] {msg}")

    def emit(self) -> int:
        for line in self.passes:
            print(line)
        if self.failures:
            print("", file=sys.stderr)
            for line in self.failures:
                print(line, file=sys.stderr)
            return 1
        return 0


# ─── Parsers ────────────────────────────────────────────────────────────────


def parse_inventory_from_instructions(instructions_path: Path) -> dict | None:
    """Extract the `## Inventory` YAML block from instructions.md. Returns None
    if the heading is missing."""
    if not instructions_path.exists():
        return None
    text = instructions_path.read_text(encoding="utf-8")
    m = INVENTORY_BLOCK_RE.search(text)
    if not m:
        return None
    try:
        return yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError as exc:
        raise SystemExit(f"YAML parse error in {instructions_path} ## Inventory block: {exc}")


def parse_moves_md(moves_path: Path) -> list[dict]:
    """Parse moves.md sections and their <!--meta ... --> YAML blocks.

    A valid moves.md has, for each move:
        ## N. Title

        <!--meta
        name: kebab-slug
        image_bearing: true
        required_zone_types: [photo-zone]
        keywords: [photo, sketch]
        -->

        ...prose body...

    Returns a list of dicts (one per parsed meta block) with at minimum the
    `name` and `image_bearing` keys plus whatever else the user authored. The
    section title is attached as `_section_title` for error messages.
    """
    if not moves_path.exists():
        return []
    text = moves_path.read_text(encoding="utf-8")
    out: list[dict] = []
    # Split into sections by ## N. headings; each section's first meta block (if any) is the move's metadata.
    sections = re.split(r"(^##\s+\d+[\.\)]\s+.+?$)", text, flags=re.MULTILINE)
    # sections layout: [pre-text, h1, body1, h2, body2, ...]
    for i in range(1, len(sections), 2):
        header = sections[i].strip()
        body = sections[i + 1] if i + 1 < len(sections) else ""
        m = META_BLOCK_RE.search(body)
        if not m:
            continue
        try:
            meta = yaml.safe_load(m.group(1)) or {}
        except yaml.YAMLError as exc:
            raise SystemExit(f"YAML parse error in {moves_path} under section '{header}': {exc}")
        if not isinstance(meta, dict):
            continue
        meta["_section_title"] = header
        out.append(meta)
    return out


def template_zone_support(entry: dict) -> set[str]:
    """Resolve the set of zone-types a template manifest entry supports.
    Explicit `supports_zone_types` wins; fallback infers `photo-zone` from
    non-'none' image_zone."""
    explicit = entry.get("supports_zone_types")
    if isinstance(explicit, list) and explicit:
        return {str(z).strip() for z in explicit if str(z).strip()}
    iz = (entry.get("image_zone") or "").strip().lower()
    if iz in {"", "none"}:
        return set()
    return {"photo-zone"}


def collect_templates(brand_context: Path, include_draft: bool) -> list[tuple[str, dict]]:
    """Yield (pool_name, manifest_entry) for templates in scope across pools."""
    pools_dir = brand_context / "templates"
    if not pools_dir.is_dir():
        return []
    allowed = {"ready"} | ({"draft"} if include_draft else set())
    out: list[tuple[str, dict]] = []
    for pool in sorted(pools_dir.iterdir()):
        if not pool.is_dir():
            continue
        manifest = pool / "manifest.json"
        if not manifest.exists():
            continue
        try:
            data = json.loads(manifest.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise SystemExit(f"manifest.json malformed at {manifest}: {exc}")
        for entry in data.get("templates", []):
            if (entry.get("status") or "").lower() in allowed:
                out.append((pool.name, entry))
    return out


# ─── Gate implementations ───────────────────────────────────────────────────


def check_g1_inventory_reasons(inv: dict, label: str, report: Report) -> None:
    elements = inv.get("elements") or []
    violations: list[str] = []
    for idx, element in enumerate(elements):
        if not isinstance(element, dict):
            continue
        decision = (element.get("decision") or "").strip().lower()
        if decision not in SKIP_LIKE_DECISIONS:
            continue
        name = element.get("name") or f"element[{idx}]"
        reason = (element.get("reason") or "").strip()
        if not reason:
            violations.append(f"  - {name}: decision='{decision}' but no reason: field")
        elif len(reason) < MIN_REASON_LEN:
            violations.append(f"  - {name}: reason too short ({len(reason)} chars): '{reason}'")
        else:
            m = BANNED_REASON_PATTERNS.search(reason)
            if m:
                violations.append(f"  - {name}: reason uses banned cost/speed token '{m.group(0)}': '{reason}'")

    # Top-level zone_skip_reason (used when requires_photo_zone:false with photo elements)
    photo_elements = [e for e in elements if isinstance(e, dict) and (e.get("type") or "").lower() == "photo"]
    requires = bool(inv.get("requires_photo_zone", False))
    zone_skip_reason = (inv.get("zone_skip_reason") or "").strip()
    if not requires and photo_elements and zone_skip_reason:
        if len(zone_skip_reason) < MIN_REASON_LEN:
            violations.append(f"  - zone_skip_reason too short: '{zone_skip_reason}'")
        m = BANNED_REASON_PATTERNS.search(zone_skip_reason)
        if m:
            violations.append(f"  - zone_skip_reason uses banned token '{m.group(0)}': '{zone_skip_reason}'")

    if violations:
        report.fail("G1", f"{label} — {len(violations)} reason violation(s):\n" + "\n".join(violations))
    else:
        n_skip = sum(1 for e in elements if isinstance(e, dict) and (e.get("decision") or "").lower() in SKIP_LIKE_DECISIONS)
        report.ok("G1", f"{label} — {len(elements)} elements ({n_skip} skip-like, reasons OK)")


def check_g3_photo_zone(inv: dict, template_dir: Path, label: str, report: Report) -> None:
    requires = bool(inv.get("requires_photo_zone", False))
    bg_kind = (inv.get("bg_treatment") or {}).get("kind")
    photo_zones = inv.get("photo_zones") or []
    elements = inv.get("elements") or []
    photo_elements = [e for e in elements if isinstance(e, dict) and (e.get("type") or "").lower() == "photo"]

    if not requires and bg_kind == "scene-with-figures":
        report.fail("G3", f"{label} — bg_treatment.kind='scene-with-figures' but requires_photo_zone:false")
        return
    if not requires and photo_zones:
        report.fail("G3", f"{label} — requires_photo_zone:false but photo_zones[] has {len(photo_zones)} entries")
        return
    if not requires and photo_elements and not (inv.get("zone_skip_reason") or "").strip():
        names = ", ".join(e.get("name", "?") for e in photo_elements)
        report.fail("G3", f"{label} — ref has photo element(s) [{names}] without zone_skip_reason")
        return
    if requires:
        html_path = template_dir / "template.html"
        if not html_path.exists():
            report.fail("G3", f"{label} — template.html missing at {html_path}")
            return
        html = html_path.read_text(encoding="utf-8")
        if not any(p.search(html) for p in PHOTO_ZONE_PATTERNS):
            report.fail(
                "G3",
                f"{label} — requires_photo_zone:true but template.html has no element with "
                f"class='photo-zone', id='photo-*', or data-zone='photo'",
            )
            return

        # G3b — photo-zone CONTENT validation. The element exists, but is it actually
        # carrying an image, or is it filled with CSS/SVG shape primitives recreating
        # the subject? The latter is the "robot-as-CSS-divs" failure mode.
        photo_zone_block_re = re.compile(
            r"""<div\b[^>]*(?:class\s*=\s*["'][^"']*\bphoto-zone\b[^"']*["']|id\s*=\s*["']photo-[\w\-]+["']|data-zone\s*=\s*["']photo["'])[^>]*>(.*?)</div>""",
            re.IGNORECASE | re.DOTALL,
        )
        for match in photo_zone_block_re.finditer(html):
            inner = match.group(1)
            has_img = bool(re.search(r"<img\b", inner, re.IGNORECASE))
            has_bg_image = bool(re.search(r"background-image\s*:", inner, re.IGNORECASE)) or \
                           bool(re.search(r"background-image\s*:", match.group(0), re.IGNORECASE))
            has_canvas = bool(re.search(r"<canvas\b", inner, re.IGNORECASE))
            has_mustache_path = bool(re.search(r"\{\{\s*[A-Z_]+_PATH\s*\}\}", inner))
            if has_img or has_bg_image or has_canvas or has_mustache_path:
                continue
            # No image carrier inside. Count shape primitives that suggest subject-recreation.
            shape_count = (
                len(re.findall(r"<svg\b", inner, re.IGNORECASE)) +
                len(re.findall(r"<div\b", inner, re.IGNORECASE)) +
                len(re.findall(r"<rect\b|<circle\b|<ellipse\b|<polygon\b|<path\b", inner, re.IGNORECASE))
            )
            if shape_count >= 3:
                report.fail(
                    "G3",
                    f"{label} — photo-zone contains {shape_count} shape primitive(s) but no "
                    f"<img>, background-image, <canvas>, or {{{{*_PATH}}}} slot. "
                    f"This is the 'recreate subject in CSS/SVG' anti-pattern. Replace the shapes "
                    f"with an <img src=\"{{{{PHOTO_MAIN_PATH}}}}\"> slot and add `ai_image_prompt` "
                    f"to the manifest entry — render_template.py HYBRID_AI v3 fills the slot.",
                )
                return
            # 0-2 shapes with no image — likely a placeholder-in-progress; warn but don't fail.
            report.fail(
                "G3",
                f"{label} — photo-zone has no image carrier (<img> / background-image / <canvas> / "
                f"{{{{*_PATH}}}} slot). Add an <img> tag pointing to a Mustache path slot.",
            )
            return
    report.ok("G3", f"{label} — photo-zone contract satisfied (requires={requires})")


def check_g4_moves_md(moves: list[dict], moves_path: Path, report: Report) -> None:
    if not moves:
        # Missing moves.md is OK (skill may not have written it yet on a fresh brand);
        # only fail if the file exists but has no parseable meta blocks.
        if moves_path.exists():
            report.fail("G4", f"{moves_path.name} exists but no <!--meta--> blocks found in any section")
        else:
            report.ok("G4", f"no moves.md present (skipped — write it in Phase 4.5)")
        return

    violations: list[str] = []
    seen_names: set[str] = set()
    for meta in moves:
        title = meta.get("_section_title", "<no header>")
        name = meta.get("name")
        if not name or not isinstance(name, str):
            violations.append(f"  - {title}: missing or non-string `name`")
            continue
        if not re.match(r"^[a-z][a-z0-9\-]*$", name):
            violations.append(f"  - {title}: name '{name}' is not kebab-case (lowercase letters/digits/hyphens, starting with a letter)")
        if name in seen_names:
            violations.append(f"  - {title}: duplicate name '{name}'")
        seen_names.add(name)
        if "image_bearing" not in meta or not isinstance(meta.get("image_bearing"), bool):
            violations.append(f"  - {title}: missing or non-boolean `image_bearing`")
            continue
        if meta["image_bearing"]:
            rzt = meta.get("required_zone_types") or []
            if not isinstance(rzt, list) or not rzt:
                violations.append(f"  - {title}: image_bearing:true but `required_zone_types` is empty")
            else:
                bad = [z for z in rzt if z not in ALLOWED_ZONE_TYPES]
                if bad:
                    violations.append(f"  - {title}: unknown zone-type(s) {bad} (allowed: {sorted(ALLOWED_ZONE_TYPES)})")

    if violations:
        report.fail("G4", f"{moves_path.name} — {len(violations)} meta-block violation(s):\n" + "\n".join(violations))
    else:
        n_img = sum(1 for m in moves if m.get("image_bearing"))
        report.ok("G4", f"{moves_path.name} — {len(moves)} moves parsed ({n_img} image_bearing)")


def check_g6_render_completeness(
    inv: dict,
    template_dir: Path,
    pool_dir: Path,
    slug: str,
    tokens: dict | None,
    label: str,
    report: Report,
) -> None:
    """G6 — render-completeness + QA report + chrome consistency.

    Five sub-checks:
      G6a — `_measurements.yaml` must exist (measurements workflow followed)
      G6b — preview rendered: `preview.png` in template_dir OR `_preview/{slug}.png` in pool_dir
      G6c — chrome consistency with tokens.json (only when tokens provided):
              - tokens.chrome.masthead.enabled:false AND uncommented <div class="masthead"> in template.html → FAIL
              - tokens.chrome.pagination:null AND uncommented <div class="dots"> in template.html → FAIL
              - chrome <div>s contain hardcoded brand text instead of Mustache placeholders → FAIL
      G6d — art-director QA report exists at `_workdir/art-director-report.md`
      G6e — text-height delta in QA report ≤8% (or section absent → FAIL)
    """
    violations: list[str] = []

    # G6a — measurements
    measurements_path = template_dir / "_measurements.yaml"
    if not measurements_path.exists():
        violations.append("missing `_measurements.yaml` — measurements workflow was skipped")

    # G6b — preview
    template_preview = template_dir / "preview.png"
    pool_preview = pool_dir / "_preview" / f"{slug}.png" if pool_dir else None
    if not template_preview.exists() and not (pool_preview and pool_preview.exists()):
        violations.append(
            "no preview rendered (looked for preview.png in template dir and _preview/{slug}.png in pool dir)"
        )

    # G6d — art-director QA report exists
    qa_report_path = template_dir / "_workdir" / "art-director-report.md"
    if not qa_report_path.exists():
        violations.append(
            "missing `_workdir/art-director-report.md` — ssc-art-director was not spawned (or did not persist its report). "
            "ssc-template-builder Step 8 MUST run the QA agent and persist the report before this gate passes."
        )
    else:
        # G6e — text-height delta check
        report_text = qa_report_path.read_text(encoding="utf-8", errors="ignore")
        delta_match = re.search(
            r"^Max delta:\s*([\d.]+)\s*%",
            report_text,
            re.MULTILINE | re.IGNORECASE,
        )
        if not re.search(r"##\s+Text height delta", report_text, re.IGNORECASE):
            violations.append(
                "`art-director-report.md` is missing the `## Text height delta` section. "
                "Re-spawn ssc-art-director with the updated output_format that includes this section."
            )
        elif delta_match:
            try:
                max_delta = float(delta_match.group(1))
                if max_delta > 8.0:
                    violations.append(
                        f"text-height max delta = {max_delta}% (limit 8%). Text fidelity violated; "
                        "iterate `_measurements.yaml` (font_size_cqw or bbox.height) and re-render."
                    )
            except ValueError:
                violations.append("could not parse `Max delta:` value in QA report — fix formatting in ssc-art-director output")
        else:
            violations.append(
                "`art-director-report.md` has `## Text height delta` section but no `Max delta: N%` line. Fix the report format."
            )

    # G6c — chrome consistency (only when tokens.json available)
    html_path = template_dir / "template.html"
    if tokens is not None and html_path.exists():
        html = html_path.read_text(encoding="utf-8")
        chrome = (tokens.get("chrome") or {})
        masthead_enabled = bool((chrome.get("masthead") or {}).get("enabled", False))
        pagination_set = chrome.get("pagination") is not None

        # Strip HTML comments to find uncommented chrome divs
        html_no_comments = re.sub(r"<!--.*?-->", "", html, flags=re.DOTALL)

        masthead_re = re.compile(r"""<div\s+[^>]*class\s*=\s*["'][^"']*\bmasthead\b[^"']*["']""", re.IGNORECASE)
        dots_re = re.compile(r"""<div\s+[^>]*class\s*=\s*["'][^"']*\bdots\b[^"']*["']""", re.IGNORECASE)

        masthead_present = bool(masthead_re.search(html_no_comments))
        dots_present = bool(dots_re.search(html_no_comments))

        if not masthead_enabled and masthead_present:
            violations.append(
                "tokens.chrome.masthead.enabled:false but template.html contains uncommented <div class='masthead'> "
                "(remove the masthead block or set tokens.chrome.masthead.enabled:true)"
            )
        if not pagination_set and dots_present:
            violations.append(
                "tokens.chrome.pagination:null but template.html contains uncommented <div class='dots'> "
                "(remove the dots block or set tokens.chrome.pagination to a non-null value)"
            )

        # Hardcoded chrome content detection — if a chrome div is rendered, its contents
        # must reference Mustache placeholders (`{{MASTHEAD_*}}` / `{{SLIDE_N}}` / etc.)
        # rather than literal brand text.
        if masthead_enabled and masthead_present:
            m = re.search(r"""<div\s+[^>]*class\s*=\s*["'][^"']*\bmasthead\b[^"']*["'][^>]*>(.*?)</div>""",
                          html_no_comments, re.DOTALL | re.IGNORECASE)
            if m and m.group(1).strip() and "{{" not in m.group(1):
                violations.append(
                    "masthead div has hardcoded content (no Mustache placeholder). "
                    "Use {{MASTHEAD_LEFT}} / {{MASTHEAD_CENTER}} / {{MASTHEAD_RIGHT}} instead."
                )

    if violations:
        report.fail("G6", f"{label} — {len(violations)} render/chrome violation(s):\n" + "\n".join(f"  - {v}" for v in violations))
    else:
        report.ok("G6", f"{label} — measurements + preview + chrome consistent")


def load_tokens(brand_context: Path) -> dict | None:
    path = brand_context / "visual-identity" / "tokens.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def find_brand_context_from_template_dir(template_dir: Path) -> Path | None:
    """Walk up from template_dir looking for a brand_context root (one containing
    visual-identity/tokens.json)."""
    for parent in template_dir.resolve().parents:
        if (parent / "visual-identity" / "tokens.json").exists():
            return parent
    return None


def check_g2_moves_vs_templates(
    moves: list[dict],
    brand_context: Path,
    include_draft: bool,
    report: Report,
) -> None:
    image_moves = [m for m in moves if m.get("image_bearing")]
    if not image_moves:
        report.ok("G2", "no image_bearing moves declared — nothing to cross-check")
        return
    templates = collect_templates(brand_context, include_draft)
    if not templates:
        scope = "ready+draft" if include_draft else "ready"
        report.fail(
            "G2",
            f"0 templates in scope (status:{scope}) — cannot satisfy {len(image_moves)} image_bearing move(s). "
            "Run Phase 4.5+5 (composition extraction + template factory) first.",
        )
        return

    lines: list[str] = []
    missing: list[tuple[str, set[str]]] = []
    for move in image_moves:
        required = set(move.get("required_zone_types") or [])
        supporters = [
            (pool, entry.get("id", "?"))
            for pool, entry in templates
            if required & template_zone_support(entry)
        ]
        name = move.get("name", "?")
        if not supporters:
            missing.append((name, required))
            lines.append(f"  [MISS] '{name}' (needs {sorted(required)}) - ZERO supporting templates")
        else:
            head = ", ".join(f"{p}/{t}" for p, t in supporters[:3])
            more = f" +{len(supporters)-3}" if len(supporters) > 3 else ""
            lines.append(f"  [OK]   '{name}' (needs {sorted(required)}) - {head}{more}")

    body = f"{len(image_moves)} image_bearing move(s) checked against {len(templates)} template(s):\n" + "\n".join(lines)
    if missing:
        body += f"\n\n{len(missing)} unsupported move(s). Resolve before ready-promotion:"
        body += "\n  (a) add a template that supports one of the required zone-types"
        body += "\n  (b) flip the move to image_bearing:false (requires explicit user confirmation)"
        report.fail("G2", body)
    else:
        report.ok("G2", body)


# ─── Main ───────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description="Single consolidated validator for the visual-identity skill (G1 + G2 + G3 + G4 + G6).")
    parser.add_argument("--brand-context", help="Path to brand_context/ folder. Triggers brand-level gates G2 + G4.")
    parser.add_argument("--template-dir", help="Path to a single template folder. Triggers per-template gates G1 + G3.")
    parser.add_argument("--include-draft", action="store_true", help="In G2, count draft templates as supporting (use during Phase 5 before ready-promotion).")
    args = parser.parse_args()

    if not args.brand_context and not args.template_dir:
        parser.error("must pass --brand-context, --template-dir, or both")

    report = Report()

    # Per-template gates
    if args.template_dir:
        tdir = Path(args.template_dir).resolve()
        if not tdir.is_dir():
            print(f"[FAIL] template dir does not exist: {tdir}", file=sys.stderr)
            return 1
        instructions_path = tdir / "instructions.md"
        inv = parse_inventory_from_instructions(instructions_path)
        if inv is None:
            report.fail("G1+G3", f"{tdir.name} — instructions.md missing `## Inventory` YAML block")
        else:
            label = tdir.name
            check_g1_inventory_reasons(inv, label, report)
            check_g3_photo_zone(inv, tdir, label, report)

        # G6 — render-completeness + chrome consistency.
        # Resolve brand_context for chrome checks (explicit arg or walk-up search).
        bc_for_g6: Path | None = None
        if args.brand_context:
            bc_for_g6 = Path(args.brand_context).resolve()
        else:
            bc_for_g6 = find_brand_context_from_template_dir(tdir)
        tokens = load_tokens(bc_for_g6) if bc_for_g6 else None
        # pool_dir = templates/{pool}/ — the parent of template_dir
        pool_dir = tdir.parent
        check_g6_render_completeness(
            inv or {},
            tdir,
            pool_dir,
            slug=tdir.name,
            tokens=tokens,
            label=tdir.name,
            report=report,
        )

    # Brand-level gates
    if args.brand_context:
        bc = Path(args.brand_context).resolve()
        if not bc.is_dir():
            print(f"[FAIL] brand_context does not exist: {bc}", file=sys.stderr)
            return 1
        moves_path = bc / "visual-identity" / "moves.md"
        moves = parse_moves_md(moves_path) if moves_path.exists() else []
        check_g4_moves_md(moves, moves_path, report)
        # G2 only meaningful when moves declared
        if moves:
            check_g2_moves_vs_templates(moves, bc, args.include_draft, report)
        else:
            report.ok("G2", "no moves to cross-check")

    return report.emit()


if __name__ == "__main__":
    sys.exit(main())

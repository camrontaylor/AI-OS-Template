#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "playwright>=1.40.0",
# ]
# ///
"""
Render an HTML/CSS carousel template to PNG using Playwright + headless Chromium.

Stage 2 — pool mode is the only supported mode. The legacy
`--template <family>/<page>` form is retained in argparse for in-flight
back-compat but the template families themselves were moved to
`viz-image-gen/references/templates/_archive/`.
Use the pool flow:

    uv run render_template.py \\
      --template-pool linkedin-carousel \\
      --template-id hero-typographic \\
      --output ./slide-01.png \\
      --data '{"HEADLINE": "The 4 ideas that ship.", "SLIDE_N": 1, "SLIDE_TOTAL": 7}' \\
      --brand-kit '<json or path>'

The pool flow reads the pool's manifest.json from
`brand_context/templates/<pool>/manifest.json` (per-brand only; no fallback),
resolves the HTML file (including cross-folder `../family/file.html` imports),
loads the pool's _shared/styles.css (or per-entry override) automatically, and
supports Mustache sections in the template ({{#X}}…{{/X}}, {{^X}}…{{/X}},
{{.}} inside list sections).

First-time setup:
    uv run playwright install chromium
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = SCRIPT_DIR.parent / "references" / "templates"


def load_env_file(env_path: Path) -> None:
    """Parse .env into os.environ so subprocess.run(generate_image_*.py) inherits API keys.
    Without this, FULL_AI / Case B / Case C renders fail with "No API key provided"
    because uv-run subprocesses spawn with a clean env."""
    import os
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def find_project_root(start: Path) -> Path:
    for c in [start, *start.parents]:
        if c.name == ".claude":
            continue
        if (c / ".claude").is_dir():
            return c
    return Path.cwd()


def resolve_pool_dir(pool: str, brand_context: Path | None = None) -> Path:
    """Return the directory holding the pool's templates.

    Stage 2 — pool mode universal. Looks in:
        - {brand_context}/templates/<pool>/  when brand_context override is supplied
        - <project_root>/brand_context/templates/<pool>/  by default

    The legacy viz-image-gen/references/templates/ fallback was removed.
    Per-brand customization is the only mode now; missing pool → loud failure.
    """
    if brand_context is not None:
        brand_pool = brand_context / "templates" / pool
    else:
        project_root = find_project_root(SCRIPT_DIR)
        brand_pool = project_root / "brand_context" / "templates" / pool
    if not (brand_pool / "manifest.json").is_file():
        raise SystemExit(
            f"ERROR: template pool '{pool}' not found at {brand_pool}. "
            f"Build it via /mkt-visual-identity Templates mode, or copy a default pool "
            f"from .claude/skills/viz-image-gen/references/templates/_archive/ as a starting point."
        )
    return brand_pool


def build_brand_tokens_css(brand_kit: dict, target_canvas: dict | None = None) -> str:
    """Convert a brand_kit dict into CSS custom property overrides.

    BRAND WINS RULE — the brand's own fonts + colors (from tokens.json) MUST drive
    the rendered output, not the template's hardcoded defaults. element-subtypes.css
    uses `var(--type-display-family, "Fraunces", serif)` etc., so this function MUST
    emit the brand's actual family names; otherwise the CSS falls back to whatever
    the template author hardcoded.

    Reads v3 tokens.json schema:
      - fonts.{display,body,micro,headline}.{family,weight,style}
      - colors.{accent,bg_dark,bg_light,text_on_dark,text_on_light,muted_*,primary,background,text,accents[]}
      - type_scale.{h1,h2,subtitle,body,caption,micro}  (top-level, NOT nested under tokens.* — v3 schema)
      - canvas.{width,height}

    Legacy schema (fonts.headline_family, colors.text, accents[]) is also honored
    as a fallback so older brand_context dirs keep rendering.
    """
    colors = brand_kit.get("colors", {}) or {}
    accents = colors.get("accents") or []
    fonts = brand_kit.get("fonts", {}) or {}
    ts = brand_kit.get("type_scale", {}) or (brand_kit.get("tokens", {}) or {}).get("type_scale", {}) or {}
    canvas = brand_kit.get("canvas", {}) or (brand_kit.get("tokens", {}) or {}).get("grid", {}) or {}
    sp = (brand_kit.get("tokens", {}) or {}).get("spacing", {}) or brand_kit.get("spacing", {}) or {}

    # ── Format scale (SAFE-BY-DEFAULT) ───────────────────────────────────────
    # The brand's type/space px are "designed at" the brand canvas (reference).
    # When rendering a different output_format the caller passes its `target_canvas`.
    # We scale by the **smaller (limiting) dimension**, NOT by width — because
    # scaling by width alone overflows when the aspect ratio flips (4:5 portrait →
    # 16:9 landscape shrinks the height while growing the type). Tracking the
    # limiting dimension means anything that fit at the reference still fits — it
    # never overflows. The standard social formats all share a 1080 short side, so
    # this yields scale 1.0 for them (type stays a consistent, safe absolute size);
    # it only scales up for genuinely higher-res canvases (e.g. 2x retina).
    # Growing type to fill extra room on a wider canvas is a DELIBERATE per-pool
    # override applied after a visual review — not an automatic guess.
    # `line_height` (unitless) + `letter_spacing` (em) are relative → NOT scaled.
    def _min_dim(c):
        if not isinstance(c, dict):
            return None
        dims = [d for d in (c.get("width"), c.get("height")) if isinstance(d, (int, float)) and d > 0]
        return min(dims) if dims else None

    ref_dim = _min_dim(canvas) or 1080
    tgt_canvas = target_canvas if (isinstance(target_canvas, dict) and target_canvas.get("width")) else canvas
    tgt_dim = _min_dim(tgt_canvas) or ref_dim
    scale = (tgt_dim / ref_dim) if ref_dim else 1.0

    def _spx(v):
        """Scale a px value by the format factor; emit an int when whole."""
        try:
            n = float(v) * scale
        except (TypeError, ValueError):
            return None
        return f"{int(round(n))}px"

    pairs = []

    # ── Colors (v3 schema first, then legacy fallbacks) ────────────────────
    color_map = {
        "--brand-bg-dark":       colors.get("bg_dark") or colors.get("background") or colors.get("primary"),
        "--brand-bg-light":      colors.get("bg_light") or colors.get("background"),
        "--brand-background":    colors.get("background") or colors.get("bg_light") or colors.get("bg_dark"),
        "--brand-primary":       colors.get("primary") or colors.get("bg_dark"),
        "--brand-secondary":     colors.get("secondary") or colors.get("accent_secondary"),
        "--brand-accent":        colors.get("accent") or (accents[0] if accents else None),
        "--brand-accent-2":      colors.get("accent_secondary") or (accents[1] if len(accents) > 1 else None),
        "--brand-text":          colors.get("text") or colors.get("text_on_light") or colors.get("primary"),
        "--brand-text-on-dark":  colors.get("text_on_dark") or colors.get("bg_light"),
        "--brand-text-on-light": colors.get("text_on_light") or colors.get("bg_dark") or colors.get("primary"),
        "--brand-muted-on-dark": colors.get("muted_on_dark"),
        "--brand-muted-on-light":colors.get("muted_on_light") or colors.get("neutral_dark"),
    }
    for css_name, val in color_map.items():
        if val:
            pairs.append(f"{css_name}: {val};")

    # ── Fonts (BRAND WINS — these override template hardcoded families) ────
    # v3 schema: fonts.{role}.family. Legacy: fonts.headline_family / body_family.
    def _font_family_for(role: str, legacy_key: str | None = None, fallback_quoted: str = "") -> str | None:
        role_cfg = fonts.get(role)
        if isinstance(role_cfg, dict) and role_cfg.get("family"):
            fam = role_cfg["family"]
        elif legacy_key and fonts.get(legacy_key):
            fam = fonts[legacy_key]
        else:
            return None
        # Wrap in quotes (CSS requires for multi-word family names)
        quoted = f'"{fam}"'
        return f"{quoted}, {fallback_quoted}" if fallback_quoted else quoted

    # Fallback tail is SANS, not serif. The display family is brand-driven; if it
    # fails to load (e.g. the @font-face never resolved) the tail must degrade to a
    # neutral sans — a serif tail ('Fraunces', Georgia, serif) silently rendered
    # serif on nested-flex display zones in the AIOS-190 gate run. A brand that
    # genuinely wants a serif display ships it as fonts.display.family; the tail is
    # only the safety net, and the safe default for a display headline is sans.
    display_fam = _font_family_for("display", "headline_family", "'Inter Tight', 'Inter', system-ui, sans-serif")
    body_fam    = _font_family_for("body",    "body_family",     '"Inter", system-ui, sans-serif')
    micro_fam   = _font_family_for("micro",   None,              '"Inter", system-ui, sans-serif')

    if display_fam:
        # Multiple var names so different element classes can pick the right one.
        # `--brand-display`/`--brand-body` are the aliases the pool templates' inline
        # styles actually read (`var(--brand-display, 'Anton'…)`); without emitting
        # them the brand-override font path was dead and only the literal 'Anton'
        # fallback rendered (SPEC-C C2). Keep the literal fallback in the chain.
        pairs.append(f"--type-display-family: {display_fam};")
        pairs.append(f"--font-display: {display_fam};")
        pairs.append(f"--brand-display: {display_fam};")
    if body_fam:
        pairs.append(f"--type-body-family: {body_fam};")
        pairs.append(f"--font-body: {body_fam};")
        pairs.append(f"--brand-body: {body_fam};")
    if micro_fam:
        pairs.append(f"--type-micro-family: {micro_fam};")

    # Font weights/styles (so display-italic gets the brand's specified weight)
    for role, prefix in [("display", "--type-display"), ("body", "--type-body"), ("micro", "--type-micro")]:
        role_cfg = fonts.get(role) or {}
        if isinstance(role_cfg, dict):
            if role_cfg.get("weight"):
                pairs.append(f"{prefix}-weight: {role_cfg['weight']};")
            if role_cfg.get("style"):
                pairs.append(f"{prefix}-style: {role_cfg['style']};")

    # ── Type scale ─────────────────────────────────────────────────────────
    # v3 schema: type_scale.{role} = {size, line_height, letter_spacing} (nested).
    # Legacy schema: type_scale.{role} = <px scalar>. Handle BOTH.
    # (Before this, a nested dict was stringified into an invalid CSS value, so the
    #  brand's type SIZES silently fell back to the template's hardcoded defaults —
    #  only fonts/colors actually "won". line_height/letter_spacing were dropped too.)
    for k_kit, k_css in [
        ("display", "--type-display"), ("h1", "--type-h1"), ("h2", "--type-h2"),
        ("h3", "--type-h3"), ("subtitle", "--type-subtitle"),
        ("body", "--type-body"), ("body_l", "--type-body-l"),
        ("body_m", "--type-body-m"), ("body_s", "--type-body-s"),
        ("caption", "--type-caption"), ("micro", "--type-micro"),
    ]:
        if k_kit not in ts:
            continue
        entry = ts[k_kit]
        size = entry.get("size") if isinstance(entry, dict) else entry
        if size is not None:
            css_size = _spx(size)
            if css_size:
                pairs.append(f"{k_css}: {css_size};")
        if isinstance(entry, dict):
            if entry.get("line_height") is not None:
                pairs.append(f"{k_css}-line-height: {entry['line_height']};")
            if entry.get("letter_spacing"):
                pairs.append(f"{k_css}-letter-spacing: {entry['letter_spacing']};")

    # ── Spacing (v3 nested `spacing.scale` OR legacy flat) — scaled ──────────
    sp_scale = sp.get("scale") if (isinstance(sp, dict) and isinstance(sp.get("scale"), dict)) else sp
    if isinstance(sp_scale, dict):
        for token, css_name in [
            ("2xs", "--space-2xs"), ("xs", "--space-xs"), ("sm", "--space-sm"),
            ("md", "--space-md"), ("lg", "--space-lg"), ("xl", "--space-xl"),
            ("2xl", "--space-2xl"), ("3xl", "--space-3xl"), ("4xl", "--space-4xl"),
            ("5xl", "--space-5xl"),
        ]:
            if token in sp_scale:
                css_val = _spx(sp_scale[token])
                if css_val:
                    pairs.append(f"{css_name}: {css_val};")

    # ── Canvas (the target format's dimensions — NOT scaled; these ARE the size)
    if tgt_canvas.get("width"):
        pairs.append(f"--canvas-w: {tgt_canvas['width']}px;")
    if tgt_canvas.get("height"):
        pairs.append(f"--canvas-h: {tgt_canvas['height']}px;")

    return " ".join(pairs)


# ─── Mustache-lite parser ────────────────────────────────────────────────

def render_sections(html: str, data: dict) -> str:
    """Process {{#X}}…{{/X}} (section) and {{^X}}…{{/X}} (inverted) blocks.

    - If `data[X]` is truthy and a list → repeat the block per item, with {{.}}
      replaced by the item's value. Item can be a string OR a dict (then nested
      placeholders {{key}} inside the block resolve against the dict).
    - If `data[X]` is truthy (non-list) → keep block contents once.
    - Else → strip block.
    - Inverted (^): kept only when value is falsy/missing.

    Handles nested sections via a single non-greedy regex pass repeated until
    no more sections remain (simple but works for our depth).
    """
    section_re = re.compile(r"\{\{([#^])([A-Za-z_][A-Za-z0-9_]*)\}\}([\s\S]*?)\{\{/\2\}\}")
    while True:
        m = section_re.search(html)
        if not m:
            break
        kind, key, content = m.group(1), m.group(2), m.group(3)
        val = data.get(key)
        if kind == "#":
            if isinstance(val, list):
                replacement = "".join(_render_list_item(content, v) for v in val)
            elif val:
                replacement = content
            else:
                replacement = ""
        else:  # inverted
            replacement = content if not val else ""
        html = html[:m.start()] + replacement + html[m.end():]
    return html


def _render_list_item(content: str, item) -> str:
    """Render one repetition of a list section.
    If item is dict, replace {{key}} placeholders inside content.
    If item is scalar, replace {{.}} only.
    """
    if isinstance(item, dict):
        out = content
        for k, v in item.items():
            out = out.replace("{{" + k + "}}", str(v))
        # remaining {{.}} ignored
        out = out.replace("{{.}}", "")
        return out
    else:
        return content.replace("{{.}}", str(item))


def _html_escape(s: str) -> str:
    """Escape a plain-text value for HTML text content, exactly once.

    Idempotent by design: the value is first `html.unescape`d so any entities
    already present (e.g. `&#39;` / `&#x27;` for an apostrophe, emitted upstream by
    the model or carried in from scraped source material) are normalised back to
    literal characters before the single escape pass. Without this, the blind
    `&` → `&amp;` replacement turns a pre-existing `&#39;` into `&amp;#39;`, which
    the browser renders as a visible `&#39;` instead of `'`.

    Apostrophes are intentionally NOT escaped — they need no escaping in HTML text
    content, so `it's` / `don't` render as literal characters.
    """
    s = html.unescape(s)
    return (
        s.replace("&", "&amp;")
         .replace("<", "&lt;")
         .replace(">", "&gt;")
         .replace('"', "&quot;")
    )


def substitute(html: str, data: dict, raw_keys: set | None = None) -> str:
    """Mustache substitution after sections are processed.

    Triple-brace {{{NAME}}} renders the value raw (HTML pass-through — used by
    slots with `type: html` whose content may include <mark>, <em>, <strong>).
    Double-brace {{NAME}} HTML-escapes the value.

    Triple-brace is processed FIRST so the outer `{` `}` are consumed cleanly
    (otherwise the inner `{{NAME}}` matches first and the outer braces leak
    into the rendered output — the exact bug that produced visible `{...}`
    in editorial-news slides post-Fase 6).

    ``raw_keys``: slot names whose value must render RAW even through a
    double-brace ``{{NAME}}`` placeholder. These are user TEXT tweaks: the editor
    applies them with ``el.innerHTML = value`` (trusting its own input), so the
    bake must NOT re-escape or a ``<mark>``/``<br>`` would become literal in the
    PNG → live ≠ bake (AIOS template-studio audit #2). Untweaked/non-text values
    stay escaped.
    """
    raw_keys = raw_keys or set()

    def repl_raw(match: re.Match) -> str:
        key = match.group(1).strip()
        return str(data.get(key, ""))

    def repl_escaped(match: re.Match) -> str:
        key = match.group(1).strip()
        if key in raw_keys:
            return str(data.get(key, ""))  # user text tweak → trust editor innerHTML
        return _html_escape(str(data.get(key, "")))

    # Triple-brace first.
    html = re.sub(r"\{\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}\}", repl_raw, html)
    # Then double-brace.
    html = re.sub(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}", repl_escaped, html)
    return html


def fill(html: str, data: dict, raw_keys: set | None = None) -> str:
    """Full pipeline: sections → inverted → placeholders."""
    return substitute(render_sections(html, data), data, raw_keys)


# ─── Pool resolver ───────────────────────────────────────────────────────

# ─── THE MANIFEST ALIAS CONTRACT ──────────────────────────────────────────
# The canonical manifest schema is ``{"id": ..., "file": "<pool-relative html>"}``
# (build_manifest.py / Phase 4.5 / Phase 5). The AI-first ``ssc-template-builder``
# instead hand-writes ``{"slug": ..., "template_html": <abs/rooted>, "template_dir":
# <abs/rooted>}`` (see ssc-template-builder.md Step 7) and never calls build_manifest.py.
# These two helpers normalize either shape to the canonical id/file at the READ
# boundary so the renderer resolves the right template instead of KeyError-ing on
# the missing ``file`` key / failing the id match.
#
# An IDENTICAL pair lives in 00-social-content/scripts/content-studio/content_studio.py.
# The two readers sit in different skills with no shared import path, so the rule is
# duplicated verbatim — KEEP THE TWO COPIES IN SYNC.
def _manifest_entry_id(entry: dict) -> str:
    """Canonical id for a manifest entry, tolerant of the builder's native schema.

    Order: ``id`` (canonical) → ``slug`` (builder) → ``name`` → basename of
    ``template_dir``. Idempotent: a canonical entry returns its own ``id``.
    """
    explicit = entry.get("id") or entry.get("slug") or entry.get("name")
    if explicit:
        return explicit
    template_dir = entry.get("template_dir") or ""
    return Path(str(template_dir).replace("\\", "/")).name


def _manifest_entry_file(entry: dict, pool_name: str) -> str:
    """Pool-relative path to the entry's template HTML, tolerant of both schemas.

    Order: ``file`` (canonical, already pool-relative) → ``template_html`` →
    ``template_dir`` + ``/template.html`` → ``<id>/template.html``. Every candidate
    is made pool-relative by stripping everything up to and including
    ``templates/<pool>/``. Idempotent: a canonical ``file`` passes through.
    """
    def _pool_relative(raw: str) -> str:
        p = str(raw).replace("\\", "/")
        marker = f"templates/{pool_name}/"
        idx = p.rfind(marker)
        return p[idx + len(marker):] if idx != -1 else p

    file_field = entry.get("file")
    if file_field:
        return _pool_relative(file_field)
    template_html = entry.get("template_html")
    if template_html:
        return _pool_relative(template_html)
    template_dir = entry.get("template_dir")
    if template_dir:
        rel_dir = _pool_relative(template_dir).rstrip("/")
        return f"{rel_dir}/template.html"
    return f"{_manifest_entry_id(entry)}/template.html"


def resolve_pool_template(pool: str, template_id: str, brand_context: Path | None = None, allow_draft: bool = False) -> tuple[dict, Path | None, Path | None, Path]:
    """Resolve a pool template_id. Returns (entry, html_path, prompt_path, shared_css).

    - Case A (TEMPLATE):  html_path set,  prompt_path None
    - Case B (FULL_AI):   html_path None, prompt_path set
    - Case C (HYBRID_AI): both set       — entry has both `file` (html) and `ai_prompt` (.prompt.md)

    Pool dir resolution: {brand_context}/templates/<pool>/ when supplied,
    else <project_root>/brand_context/templates/<pool>/.

    Status enforcement: by default only `status: "ready"` entries are renderable.
    `allow_draft=True` allows `draft` (used by Phase 4.5 preview rendering before
    user acceptance). `broken` is never renderable.
    """
    pool_dir = resolve_pool_dir(pool, brand_context=brand_context)
    manifest_path = pool_dir / "manifest.json"
    if not manifest_path.is_file():
        raise SystemExit(f"ERROR: no manifest at {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    # Schema normalization: Phase 4.5 (primitive_to_template) writes 'templates[]';
    # Phase 5 (template factory) writes 'variations[]'. Accept both transparently.
    # Also accept a dict keyed by id (build_manifest.py historically emitted that) —
    # normalize it to a list so downstream `t.get(...)` works either way.
    entries = manifest.get("templates") or manifest.get("variations") or []
    if isinstance(entries, dict):
        entries = [{**v, "id": v.get("id", k)} for k, v in entries.items() if isinstance(v, dict)]
    # Match on the canonical id alias (id → slug → name → dir basename) so a
    # builder-native entry (slug, no id) resolves — see THE MANIFEST ALIAS CONTRACT.
    entry = next((t for t in entries if _manifest_entry_id(t) == template_id), None)
    if entry is None:
        ids = ", ".join(_manifest_entry_id(t) for t in entries)
        raise SystemExit(f"ERROR: template_id '{template_id}' not in pool '{pool}'. Available: {ids}")
    status = entry.get("status")
    allowed_statuses = {"ready", "approved"} if not allow_draft else {"ready", "approved", "draft", "TODO"}
    if status not in allowed_statuses:
        raise SystemExit(f"ERROR: template '{template_id}' has status '{status}', not in {sorted(allowed_statuses)}.")

    # Per-entry shared_css wins over pool-level (used for cross-folder imports
    # where the imported template needs its source family's stylesheet, not
    # the pool's).
    shared_css_rel = entry.get("shared_css") or manifest.get("shared_css", "_shared/styles.css")
    shared_css = (pool_dir / shared_css_rel).resolve()

    # File path normalization: Phase 5 factory writes 'file: templates/{pool}/body/X.html'
    # (rooted at brand_context), while Phase 4.5 primitive_to_template writes 'file: body/X.html'
    # (rooted at pool_dir). Accept both — strip the redundant 'templates/{pool}/' prefix
    # if present to dedupe the path.
    # Tolerant of the builder's native schema (template_html/template_dir, no
    # 'file') — see THE MANIFEST ALIAS CONTRACT. No hard KeyError on entry['file'].
    file_field = _manifest_entry_file(entry, pool)
    redundant_prefix = f"templates/{pool}/"
    if file_field.startswith(redundant_prefix):
        file_field = file_field[len(redundant_prefix):]
    file_path = (pool_dir / file_field).resolve()
    html_path = None
    prompt_path = None

    # Case routing by manifest entry shape
    if entry.get("ai_prompt"):
        # Case C: hybrid — file is HTML, ai_prompt is .prompt.md
        html_path = file_path
        prompt_path = pool_dir / entry["ai_prompt"]
    elif str(file_path).endswith(".prompt.md"):
        # Case B: AI prompt template — file is .prompt.md
        prompt_path = file_path
    else:
        # Case A: HTML template
        html_path = file_path

    if html_path and not html_path.is_file():
        raise SystemExit(f"ERROR: HTML missing: {html_path}")
    if prompt_path and not prompt_path.is_file():
        raise SystemExit(f"ERROR: prompt template missing: {prompt_path}")

    return entry, html_path, prompt_path, shared_css


# ─── Prompt-template (.prompt.md) parser ─────────────────────────────────

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.+?)\n---\s*\n(.+)$", re.DOTALL)
_SECTION_RE = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)


def parse_prompt_md(path: Path) -> dict:
    """Parse a .prompt.md template into {frontmatter, prompt_body, negative, variables}.

    Frontmatter is parsed via a simple YAML-subset reader (avoids PyYAML dep).
    Body sections are identified by `## <Section>` headers.
    """
    text = path.read_text(encoding="utf-8")
    m = _FRONTMATTER_RE.match(text)
    if not m:
        raise SystemExit(f"ERROR: {path} has no YAML frontmatter (--- ... ---)")
    fm_raw, body = m.group(1), m.group(2)

    frontmatter = {}
    for line in fm_raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" in line:
            k, _, v = line.partition(":")
            v = v.strip()
            if v.startswith("[") and v.endswith("]"):
                v = [x.strip().strip("'\"") for x in v[1:-1].split(",") if x.strip()]
            else:
                v = v.strip("'\"")
            frontmatter[k.strip()] = v

    sections = {}
    headers = list(_SECTION_RE.finditer(body))
    for i, h in enumerate(headers):
        name = h.group(1).strip().lower()
        start = h.end()
        end = headers[i + 1].start() if i + 1 < len(headers) else len(body)
        sections[name] = body[start:end].strip()

    return {
        "frontmatter": frontmatter,
        "prompt": sections.get("prompt", "").strip(),
        "negative": sections.get("negative", "").strip(),
        "variables": sections.get("variables", "").strip(),
        "notes": sections.get("notes for designer", "").strip() or sections.get("notes", "").strip(),
    }


def build_ai_prompt(parsed: dict, data: dict, brand_kit: dict) -> str:
    """Substitute brand tokens + slide data into the prompt body."""
    prompt = parsed["prompt"]
    # Brand placeholders
    mood = (brand_kit or {}).get("mood_block") or ""
    colors = (brand_kit or {}).get("colors", {}) or {}
    accents = colors.get("accents") or []
    brand_replacements = {
        "BRAND_MOOD_BLOCK": mood,
        "BRAND_PRIMARY":    colors.get("primary") or "",
        "BRAND_SECONDARY":  colors.get("secondary") or "",
        "BRAND_BACKGROUND": colors.get("background") or "",
        "BRAND_TEXT":       colors.get("text") or "",
        "BRAND_ACCENT":     accents[0] if accents else "",
        "BRAND_ACCENT_2":   accents[1] if len(accents) > 1 else "",
    }
    for k, v in brand_replacements.items():
        prompt = prompt.replace("{{" + k + "}}", str(v))
    # Slide-data placeholders (TOPIC, TOPIC_ARTIFACT, etc.)
    for k, v in (data or {}).items():
        prompt = prompt.replace("{{" + k + "}}", str(v))
    # Strip any unfilled placeholders
    prompt = re.sub(r"\{\{[^}]+\}\}", "", prompt)
    # Append negative as suffix if present
    if parsed.get("negative"):
        prompt = prompt.strip() + "\n\nNegative: " + parsed["negative"]
    return prompt.strip()


def call_ai_image_gen(prompt: str, output: Path, model: str, aspect: str = "4:5", input_image: Path | None = None) -> Path:
    """Invoke generate_image_gemini.py or generate_image_gpt.py via subprocess.

    When `input_image` is supplied, runs in EDIT mode — the underlying photograph
    is preserved and the prompt only describes overlays to add. This is critical
    for FULL_AI render of scene-template templates: regenerating the scene from
    scratch loses the user-approved composition. Edit mode keeps the cleaned
    scene intact and bakes text on top with gpt-image-2's high-fidelity text rendering.
    """
    script_name = "generate_image_gemini.py" if "gemini" in (model or "").lower() else "generate_image_gpt.py"
    script_path = SCRIPT_DIR / script_name
    if not script_path.is_file():
        raise SystemExit(f"ERROR: AI image script not found: {script_path}")
    output.parent.mkdir(parents=True, exist_ok=True)
    if "gemini" in script_name:
        cmd = ["uv", "run", str(script_path), "--prompt", prompt, "--filename", str(output), "--aspect-ratio", aspect]
    else:
        size = {"4:5": "1024x1536", "1:1": "1024x1024", "9:16": "1024x1536", "16:9": "1536x1024"}.get(aspect, "1024x1536")
        cmd = ["uv", "run", str(script_path), "--prompt", prompt, "--filename", str(output), "--size", size, "--quality", "high"]
    if input_image and input_image.is_file():
        cmd.extend(["--input-image", str(input_image)])
    import subprocess
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        raise SystemExit(f"AI image gen failed:\nSTDOUT: {result.stdout[-1000:]}\nSTDERR: {result.stderr[-1000:]}")
    return output


def resolve_ai_image_slots(
    entry: dict,
    data: dict,
    output_dir: Path,
    brand_kit: dict | None = None,
    allow_ai_gen: bool = True,
) -> dict:
    """v3 schema: for each `type: image` slot with `prompt_pattern`, generate the
    AI image (gpt-image-2 / gemini-3-pro-image) and inject the file path into data
    as `{slot_key}_PATH`. Cached by prompt hash so re-runs reuse the image.

    Bug fix: the v3 manifest declares image slots like `BG_AI_IMAGE` with a
    `prompt_pattern` containing the full AI prompt, but render_template's legacy
    Case C only triggers on the older `ai_prompt` field. Without this resolver,
    HYBRID_AI templates render with empty `background-image: url('')` — text on
    off-white instead of editorial photography. Preview is structurally meaningless.

    - `allow_ai_gen=False` → skip generation (user explicitly declined AI bg via
      the `--no-ai-bg` flag, or sub-agent decided no-AI for cost/policy reasons).
      Caller knows previews will lack the bg image.
    - Caller-provided `{slot_key}_PATH` always wins — never overwritten.
    """
    import hashlib
    slots = (entry or {}).get("slots") or {}
    if not slots:
        return dict(data)

    out = dict(data)
    cache_dir = output_dir / "_ai_bg"

    for slot_key, slot_def in slots.items():
        if slot_def.get("type") != "image":
            continue
        prompt_pattern = slot_def.get("prompt_pattern")
        if not prompt_pattern:
            continue
        path_key = f"{slot_key}_PATH"
        if out.get(path_key):
            continue  # caller supplied a path
        if not allow_ai_gen:
            print(f"[render_template] SKIP AI gen for slot {slot_key} (--no-ai-bg)", file=sys.stderr)
            continue
        prompt_hash = hashlib.sha1(prompt_pattern.encode("utf-8")).hexdigest()[:12]
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_path = cache_dir / f"{slot_key.lower()}-{prompt_hash}.png"
        if not cache_path.is_file():
            model = "gpt-image-2"
            if brand_kit and (brand_kit.get("image_provider") or "").lower() == "gemini":
                model = "gemini-3-pro-image"
            aspect = slot_def.get("aspect", "4:5")
            print(f"[render_template] AI gen for slot {slot_key} via {model} (cache miss)", file=sys.stderr)
            call_ai_image_gen(prompt_pattern, cache_path, model, aspect)
        else:
            print(f"[render_template] AI gen for slot {slot_key} (cache hit: {cache_path.name})", file=sys.stderr)
        out[path_key] = str(cache_path.resolve())

    return out


def inject_brand_tokens_into_data(data: dict, brand_kit: dict | None) -> dict:
    """Pre-fill `{{BRAND_*}}` Mustache placeholders with brand_kit values.

    BRAND WINS RULE — intents reference colors via Mustache (e.g.
    `color: '{{BRAND_ACCENT}}'`) so that the SAME intent.md works across brands
    with different palettes. This function resolves those placeholders from the
    brand_kit BEFORE HTML fill, so the rendered output uses the brand's actual
    hex codes — not the template author's defaults.

    Caller-provided values (already set in `data`) WIN. We only fill what's missing.

    Reads v3 tokens.json schema with legacy fallbacks (same conventions as
    build_brand_tokens_css).
    """
    if not brand_kit:
        return dict(data)
    colors = (brand_kit.get("colors") or {}) if isinstance(brand_kit, dict) else {}
    accents = colors.get("accents") or []
    fonts = (brand_kit.get("fonts") or {}) if isinstance(brand_kit, dict) else {}
    brand_name = brand_kit.get("brand", "")

    defaults = {
        "BRAND_ACCENT":         colors.get("accent") or (accents[0] if accents else "#e25a45"),
        "BRAND_ACCENT_2":       colors.get("accent_secondary") or (accents[1] if len(accents) > 1 else ""),
        "BRAND_PRIMARY":        colors.get("primary") or colors.get("bg_dark") or "#0a0a0a",
        "BRAND_BACKGROUND":     colors.get("background") or colors.get("bg_light") or "#f2f0eb",
        "BRAND_BG_DARK":        colors.get("bg_dark") or colors.get("primary") or "#0a0a0a",
        "BRAND_BG_LIGHT":       colors.get("bg_light") or colors.get("background") or "#f2f0eb",
        "BRAND_TEXT":           colors.get("text") or colors.get("text_on_light") or "#0a0a0a",
        "BRAND_TEXT_ON_DARK":   colors.get("text_on_dark") or colors.get("bg_light") or "#ece8e7",
        "BRAND_TEXT_ON_LIGHT":  colors.get("text_on_light") or colors.get("bg_dark") or "#0a0a0a",
        "BRAND_MUTED_ON_DARK":  colors.get("muted_on_dark") or "#999999",
        "BRAND_MUTED_ON_LIGHT": colors.get("muted_on_light") or colors.get("neutral_dark") or "#666666",
        "BRAND_NAME":           brand_name,
    }
    # Font families (so intents can reference {{BRAND_FONT_DISPLAY}} etc.)
    for role, key_name in [("display", "BRAND_FONT_DISPLAY"), ("body", "BRAND_FONT_BODY"), ("micro", "BRAND_FONT_MICRO")]:
        role_cfg = fonts.get(role) if isinstance(fonts, dict) else None
        if isinstance(role_cfg, dict) and role_cfg.get("family"):
            defaults[key_name] = role_cfg["family"]

    out = dict(data)
    for k, v in defaults.items():
        if k not in out and v:
            out[k] = v
    return out


def sample_bg_luminance(bg_path: Path, *, sample_box: tuple[float, float, float, float] = (0.1, 0.1, 0.9, 0.9)) -> float:
    """Sample mean luminance of a bg image inside `sample_box` (left, top, right, bottom as fractions).

    Returns a float 0.0 (pure black) to 1.0 (pure white). Used by `auto_resolve_text_color_tokens`
    to override BRAND_TEXT_ON_DARK / BRAND_TEXT_ON_LIGHT when the bg's actual luminance doesn't
    match what the template author assumed.

    Default sample box excludes the outer 10% (chrome rows / edge artifacts), focusing on the
    area where text typically sits.
    """
    try:
        from PIL import Image
    except ImportError:
        print("[render_template] PIL not installed; skipping luminance sample. Run: uv add pillow", file=sys.stderr)
        return 0.5  # neutral fallback — no override
    if not bg_path.is_file():
        return 0.5
    img = Image.open(bg_path).convert("RGB")
    w, h = img.size
    l, t, r, b = sample_box
    box = (int(w * l), int(h * t), int(w * r), int(h * b))
    crop = img.crop(box)
    # Downsample to 32x32 for speed
    crop.thumbnail((32, 32))
    pixels = list(crop.getdata())
    # Relative luminance per WCAG: 0.2126*R + 0.7152*G + 0.0722*B (sRGB linear approximation)
    total = sum(0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in pixels)
    return total / (255.0 * len(pixels))


def auto_resolve_text_color_tokens(data: dict, brand_kit: dict | None, bg_path_keys: list[str]) -> dict:
    """Auto-override BRAND_TEXT_ON_DARK / BRAND_TEXT_ON_LIGHT based on actual bg luminance.

    Templates hardcode `{{BRAND_TEXT_ON_DARK}}` assuming the bg is dark; when scene-template
    extraction returns a LIGHT photograph (sunlit brick wall) the assumption breaks and text
    renders illegibly. This fn samples the actual bg, computes luminance, and overrides the
    token in `data` so the template still uses a readable color.

    Threshold rationale: WCAG AA contrast 4.5:1 requires roughly luminance delta > 0.3 between
    text and bg. Using cutoffs 0.35 / 0.55 gives safety margin.
    """
    if not bg_path_keys:
        return data
    bg_lum = None
    for key in bg_path_keys:
        p = data.get(key)
        if p and Path(p).is_file():
            bg_lum = sample_bg_luminance(Path(p))
            break
    if bg_lum is None:
        return data
    colors = (brand_kit or {}).get("colors", {}) or {}
    text_on_light = colors.get("text_on_light") or colors.get("primary") or "#0a0a0a"
    text_on_dark = colors.get("text_on_dark") or "#f2f0eb"
    out = dict(data)
    if bg_lum > 0.55:
        # Bg is light — text marked "on dark" should actually use the on-light color
        out["BRAND_TEXT_ON_DARK"] = text_on_light
        out["BRAND_TEXT_ON_LIGHT"] = text_on_light
        print(f"[render_template] auto-luminance: bg lum={bg_lum:.2f} (light) -> text=on-light ({text_on_light})", file=sys.stderr)
    elif bg_lum < 0.35:
        # Bg is dark — text marked "on light" should actually use the on-dark color
        out["BRAND_TEXT_ON_LIGHT"] = text_on_dark
        out["BRAND_TEXT_ON_DARK"] = text_on_dark
        print(f"[render_template] auto-luminance: bg lum={bg_lum:.2f} (dark) -> text=on-dark ({text_on_dark})", file=sys.stderr)
    else:
        print(f"[render_template] auto-luminance: bg lum={bg_lum:.2f} (mid) -> keeping brand defaults", file=sys.stderr)
    return out


def embed_paths_as_data_uris(data: dict, brand_context: Path | None, template_dir: Path | None = None) -> dict:
    """For every data key ending in _PATH whose value is a local file, replace the value
    with a base64 data URI. Templates use these via Mustache (e.g.
    `<img src="{{LOGO_PATH}}">` or `background-image: url('{{BG_SOURCE_PATH}}')`).
    Playwright's `set_content()` runs with no base URL and blocks file:// — so any
    local path leaks as a broken image. Inlining as data URI sidesteps both issues.

    This MUST run before Mustache fill: `_inline_relative_urls` only catches LITERAL
    relative paths in the raw HTML, so a path that arrives through a Mustache slot
    (e.g. `<img src="{{BRAND_LOGO_PATH}}">`) is only inlined here. That's why per-post
    image slots must end in `_PATH`.

    Caller-provided data URIs and http(s) URLs pass through unchanged.
    Relative paths resolve against the template dir first (where the template's own
    `assets/` live), then `brand_context` (the project's brand folder).
    """
    out = dict(data)
    for key in list(out.keys()):
        if not key.endswith("_PATH"):
            continue
        val = out[key]
        if not isinstance(val, str) or not val:
            continue
        if val.startswith("data:") or val.startswith("http://") or val.startswith("https://"):
            continue
        path = Path(val)
        if not path.is_absolute():
            for base in (template_dir, brand_context):
                if base is None:
                    continue
                candidate = (Path(base) / val).resolve()
                if candidate.is_file():
                    path = candidate
                    break
        if not path.is_file():
            continue
        suffix = path.suffix.lower().lstrip(".")
        mime = {"png": "png", "jpg": "jpeg", "jpeg": "jpeg",
                "svg": "svg+xml", "webp": "webp"}.get(suffix, "png")
        import base64 as _b64
        b64 = _b64.b64encode(path.read_bytes()).decode()
        out[key] = f"data:image/{mime};base64,{b64}"
    return out


def resolve_brand_logo_path(brand_kit: dict | None, brand_context: Path | None) -> str | None:
    """Resolve the brand's primary logo path for PAGE_INDICATOR_LOGO_PATH auto-injection.

    Lookup order:
      1. brand_kit['logo']['primary_path'] (set by brand_kit_loader)
      2. {brand_context}/visual-identity/logos/*-transparent.{png,svg}
      3. {brand_context}/visual-identity/logos/*.{png,svg,jpg}  (first file found)

    Returns absolute path string or None if no logo found.
    """
    if brand_kit:
        primary = (brand_kit.get("logo") or {}).get("primary_path")
        if primary and Path(primary).is_file():
            return str(Path(primary).resolve())
    if brand_context:
        logos_dir = brand_context / "visual-identity" / "logos"
        if logos_dir.is_dir():
            for pattern in ("*-transparent.png", "*-transparent.svg", "*.svg", "*.png", "*.jpg"):
                for candidate in sorted(logos_dir.glob(pattern)):
                    if "_bg_clean" in candidate.parts:
                        continue
                    return str(candidate.resolve())
    return None


# Decorative elements templates ship without a data-slot (background rects, the
# dot-grid svg, the logo stamp, frame cards). The editor auto-tags these so they
# become editable layers; the bake MUST tag them identically (same deterministic
# rule) so tweaks keyed by the synthetic handle apply on rebake (RNDR-04 parity).
_DECOR_RULES = [
    ("div", r"\bbg\b", "BACKGROUND"),
    ("div", r"frame", "FRAME"),
    ("img", r"logo", "LOGO"),
]


def _inject_first_slot(html_text: str, tag: str, kw: str, handle: str) -> str:
    pat = re.compile(
        r'(<' + tag + r'\b(?![^>]*\bdata-slot=)[^>]*?\bclass="[^"]*' + kw + r'[^"]*"[^>]*?)(>)',
        re.IGNORECASE,
    )
    return pat.sub(lambda m: f'{m.group(1)} data-slot="{handle}"{m.group(2)}', html_text, count=1)


_BG_LAYER_DIV = (
    '<div data-slot="BACKGROUND" '
    'style="position:absolute;inset:0;background:inherit;z-index:0"></div>'
)


def _tag_root_bg(html_text: str) -> str:
    """Root-background fallback: make the slide backdrop a REAL **stackable** BACKGROUND
    layer (FASE 6 fix #1). A container can't be z-indexed above its own children, so
    instead of tagging the root ``.slide`` we inject a dedicated inset:0 child
    (``background:inherit`` → same backdrop, ``z-index:0`` → behind content by default).
    Reordering then applies a real z-index that bakes identically to the live preview
    (RNDR-04). MUST match preview_editor._tag_root_bg byte-for-byte. No-op when a
    BACKGROUND already exists (real div.bg or the full-AI layer-canvas <img>)."""
    if 'data-slot="BACKGROUND"' in html_text:
        return html_text
    slide_pat = re.compile(
        r'(<div\b[^>]*\bclass="[^"]*\bslide\b[^"]*"[^>]*>)', re.IGNORECASE)
    out, n = slide_pat.subn(lambda m: m.group(1) + _BG_LAYER_DIV, html_text, count=1)
    if n:
        return out
    out, n = re.subn(
        r'(<body\b[^>]*>)', lambda m: m.group(1) + _BG_LAYER_DIV,
        html_text, count=1, flags=re.IGNORECASE)
    return out if n else html_text


def _tag_decor(html_text: str) -> str:
    """Auto-tag untagged decorative elements with synthetic data-slot handles —
    mirror of preview_editor._tag_decor so preview and bake see the same layers."""
    out = html_text
    for tag, kw, handle in _DECOR_RULES:
        out = _inject_first_slot(out, tag, kw, handle)
    n = [0]
    def _svg(m):
        n[0] += 1
        h = "GRAPHIC" if n[0] == 1 else f"GRAPHIC{n[0]}"
        return f'{m.group(1)} data-slot="{h}"{m.group(2)}'
    out = re.sub(r'(<svg\b(?![^>]*\bdata-slot=)[^>]*?)(>)', _svg, out, flags=re.IGNORECASE)
    return _tag_root_bg(out)


def render(
    output: Path,
    data: dict,
    brand_kit: dict | None = None,
    *,
    template: str | None = None,
    template_pool: str | None = None,
    template_id: str | None = None,
    template_dir: str | Path | None = None,
    brand_context: Path | None = None,
    target_canvas: dict | None = None,
    allow_draft: bool = False,
    allow_ai_gen: bool = True,
    tweaks: dict | None = None,
    tweaks_slide: str | None = None,
    require_font: bool = False,
) -> Path:
    """Render an HTML template to PNG. Three call modes:

    - **template_dir** (new, preferred): a folder with `template.html` + optional `bg.png`, `instructions.md`.
    - Pool: `template_pool="linkedin-carousel"`, `template_id="hero-typographic"`.
    - Legacy: `template="family/page"`.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("ERROR: playwright not installed. Run: uv run playwright install chromium", file=sys.stderr)
        sys.exit(1)

    entry = {}
    prompt_path = None
    pool_shared_css = None
    if template_dir:
        # New simplified architecture: a per-template folder with template.html inside.
        td = Path(template_dir).resolve()
        html_path = td / "template.html"
        shared_css_path = td / "styles.css"  # optional per-template overrides; missing is fine
        # The pool's _shared/styles.css carries the brand @font-face + base classes. Templates
        # link it via <link href="../_shared/styles.css">, but Playwright set_content() has no
        # base URL so that relative link never resolves — without loading it explicitly here the
        # brand fonts never inject and display text falls back to the serif tail of
        # --type-display-family. Load it (pool first, per-template styles.css override second).
        pool_shared_css = td.parent / "_shared" / "styles.css"
        is_pool = False
    elif template_pool and template_id:
        entry, html_path, prompt_path, shared_css_path = resolve_pool_template(
            template_pool, template_id,
            brand_context=brand_context,
            allow_draft=allow_draft,
        )
        is_pool = True
    elif template:
        html_path = TEMPLATES_DIR / f"{template}.html"
        shared_css_path = html_path.parent / "styles.css"
        is_pool = False
    else:
        raise SystemExit("ERROR: pass --template-dir OR (--template-pool + --template-id) OR --template")

    # ─── Case B / C: AI prompt template branch ──────────────────────────
    if prompt_path is not None:
        parsed = parse_prompt_md(prompt_path)
        fm = parsed["frontmatter"]
        model = fm.get("recommended_model") or fm.get("model") or "gpt-image-2"
        aspect = fm.get("aspect") or fm.get("aspect_ratio") or "4:5"
        prompt_text = build_ai_prompt(parsed, data, brand_kit or {})

        # Edit-mode input image (frontmatter `input_image:` field) — preserves the
        # user-approved scene-template composition. Without this, FULL_AI regenerates
        # the photo from scratch and loses the brick wall + figure positioning the
        # user already accepted.
        input_image_path: Path | None = None
        fm_input = fm.get("input_image")
        if fm_input:
            candidate = Path(fm_input)
            if not candidate.is_absolute() and brand_context:
                candidate = (brand_context / fm_input).resolve()
            if candidate.is_file():
                input_image_path = candidate
                print(f"[render_template] Case B/C using input_image: {candidate}", file=sys.stderr)

        output = output.resolve()
        output.parent.mkdir(parents=True, exist_ok=True)

        if html_path is None:
            # Case B: AI image is the final output (FULL_AI mode)
            mode_label = "edit" if input_image_path else "txt2img"
            print(f"[render_template] Case B ({mode_label}): {template_id}", file=sys.stderr)
            return call_ai_image_gen(prompt_text, output, model, aspect, input_image=input_image_path)

        # Case C: generate AI image to a temp file, then embed in HTML overlay below
        print(f"[render_template] Case C (hybrid): {template_id}", file=sys.stderr)
        tmp_bg = output.parent / f"_tmp-{output.stem}-bg.png"
        call_ai_image_gen(prompt_text, tmp_bg, model, aspect, input_image=input_image_path)
        # Inject IMAGE_SRC for the HTML overlay step below
        data = dict(data or {})
        data["IMAGE_SRC"] = str(tmp_bg)
        # Then fall through to the HTML render path

    if html_path is None or not html_path.exists():
        print(f"ERROR: template not found: {html_path}", file=sys.stderr)
        sys.exit(1)

    # v3 schema HYBRID_AI: resolve image slots BEFORE HTML fill. Generates the
    # AI bg via gpt-image-2 / gemini-3-pro-image and injects {SLOT}_PATH keys.
    # Disabled by --no-ai-bg (caller opted out of AI bg generation explicitly).
    if is_pool:
        data = resolve_ai_image_slots(
            entry,
            data,
            output_dir=output.parent,
            brand_kit=brand_kit,
            allow_ai_gen=allow_ai_gen,
        )

    # BRAND WINS — fill {{BRAND_*}} Mustache placeholders from brand_kit BEFORE
    # any other resolution. Caller-provided data wins; we only fill missing keys.
    # This is what makes color/font tokens in intent.md (e.g. `{{BRAND_ACCENT}}`)
    # resolve to the brand's actual hex codes / family names.
    if is_pool:
        data = inject_brand_tokens_into_data(data, brand_kit)

    # Auto-resolve PAGE_INDICATOR_LOGO_PATH if not supplied by caller. Otherwise
    # the {{#PAGE_INDICATOR_LOGO_PATH}}…{{^…}} Mustache section falls through to
    # the default black circle placeholder, even though the brand has a logo.
    if is_pool and "PAGE_INDICATOR_LOGO_PATH" not in data:
        logo_path = resolve_brand_logo_path(brand_kit, brand_context)
        if logo_path:
            data["PAGE_INDICATOR_LOGO_PATH"] = logo_path

    # Auto-luminance: sample bg image, override BRAND_TEXT_ON_* tokens when contrast
    # would fail (e.g., scene-template extraction returned a light photo but the
    # template hardcodes text_on_dark assuming a dark bg). Covers:
    #   - BG_AI_IMAGE_PATH (set by resolve_ai_image_slots for HYBRID_AI templates)
    #   - any image-type slot named *BG* in the entry
    #   - _bg_image_path field on the entry itself (set by primitive_to_template
    #     when the bg is real-photo or scene-template — these are inlined in HTML,
    #     not in a slot, so they need explicit injection here)
    if is_pool:
        bg_keys = ["BG_AI_IMAGE_PATH"] + [
            f"{k}_PATH" for k in (entry.get("slots") or {})
            if "BG" in k.upper() and (entry["slots"][k].get("type") == "image")
        ]
        # Also sample any full-bleed bg the template fills via a Mustache image slot
        # (PHOTO_CUTOUT_PATH on hero-display-cutout, PHOTO_MAIN_PATH, BG_SCENE_PATH, …)
        # AND the --bg-override path (slides whose bg is a generated/real image swapped
        # into `url('bg.png')`). Without these, auto-luminance never fires for
        # overlaid-text-on-image templates and dark text renders on dark photos.
        bg_keys += [
            k for k in data
            if k.endswith("_PATH") and any(tok in k.upper() for tok in ("PHOTO", "SCENE", "CUTOUT", "BG"))
        ]
        _ov = (data.get("_BG_OVERRIDE") or "").strip()
        if _ov:
            data.setdefault("_BG_OVERRIDE_SAMPLE", _ov)
            bg_keys.append("_BG_OVERRIDE_SAMPLE")
        seen = set(); bg_keys = [k for k in bg_keys if not (k in seen or seen.add(k))]
        # Inject _bg_image_path as ENTRY_BG_PATH so auto_resolve can find it
        entry_bg = entry.get("_bg_image_path") or ""
        if entry_bg:
            entry_bg_abs = entry_bg
            if not Path(entry_bg_abs).is_absolute() and brand_context:
                entry_bg_abs = str((brand_context / entry_bg_abs).resolve())
            data.setdefault("ENTRY_BG_PATH", entry_bg_abs)
            bg_keys.append("ENTRY_BG_PATH")
        data = auto_resolve_text_color_tokens(data, brand_kit, bg_keys)

    # --tweaks: EARLY global patch — MUST happen before build_brand_tokens_css so that
    # the emitted token CSS already contains the patched accent/fonts.  (Pitfall 4 guard.)
    # Derive slide_id from tweaks_slide arg; fallback to output stem (e.g. "slide-01").
    if tweaks:
        _global_tweaks = tweaks.get("global") or {}
        if _global_tweaks:
            brand_kit = apply_global_tweaks(brand_kit or {}, _global_tweaks)
    _slide_id = tweaks_slide or output.stem
    _slide_tweaks: dict = (tweaks or {}).get(_slide_id, {}) if tweaks else {}

    # Canvas: a target format canvas (CLI --canvas) overrides the brand grid.
    # Resolved here so it drives BOTH the brand-token scaling and the viewport below.
    _grid = (brand_kit or {}).get("tokens", {}).get("grid", {}) or {}
    if isinstance(target_canvas, dict) and target_canvas.get("width") and target_canvas.get("height"):
        canvas_w, canvas_h = int(target_canvas["width"]), int(target_canvas["height"])
    else:
        canvas_w = _grid.get("canvas_width") or 1080
        canvas_h = _grid.get("canvas_height") or 1350
    tokens = build_brand_tokens_css(brand_kit or {}, target_canvas={"width": canvas_w, "height": canvas_h})

    # Logo: if brand_kit has a logo path, expose LOGO_HTML for pool templates.
    if is_pool and "LOGO_HTML" not in data and brand_kit:
        logo_path = (brand_kit.get("logo") or {}).get("primary_path") or ""
        if logo_path and Path(logo_path).is_file():
            import base64 as _b64
            suffix = Path(logo_path).suffix.lower().lstrip(".")
            mime = {"svg": "svg+xml", "png": "png", "jpg": "jpeg", "jpeg": "jpeg", "webp": "webp"}.get(suffix, "png")
            data["LOGO_HTML"] = (
                f'<div class="logo"><img src="data:image/{mime};base64,'
                f'{_b64.b64encode(Path(logo_path).read_bytes()).decode()}" alt=""></div>'
            )
        else:
            initial = (brand_kit.get("brand") or "B")[0].upper()
            data["LOGO_HTML"] = f'<div class="logo">{initial}</div>'

    # Resolve IMAGE_SRC → IMAGE_HTML so templates never see a raw path.
    # If IMAGE_HTML is already in data, it wins (caller built custom markup).
    processed = dict(data)

    # Resolve HANDLE_ICON_PATH → HANDLE_ICON_HTML (small inline platform icon
    # rendered next to @handle in the header). Accepts SVG or PNG.
    if "HANDLE_ICON_HTML" not in processed:
        icon_src = processed.get("HANDLE_ICON_PATH", "")
        if icon_src:
            import base64
            icon_path = Path(icon_src).resolve()
            icon_bytes = icon_path.read_bytes()
            suffix = icon_path.suffix.lower().lstrip(".")
            mime = {"svg": "svg+xml", "png": "png"}.get(suffix, "png")
            b64 = base64.b64encode(icon_bytes).decode()
            processed["HANDLE_ICON_HTML"] = f'<img src="data:image/{mime};base64,{b64}" alt="">'
        else:
            processed["HANDLE_ICON_HTML"] = ""

    if "IMAGE_HTML" not in processed:
        src = processed.get("IMAGE_SRC", "")
        if src:
            # Embed as base64 data URI — Playwright blocks file:// URIs when
            # content is loaded via set_content() (no origin / CORS sandbox).
            import base64
            img_path = Path(src).resolve()
            img_bytes = img_path.read_bytes()
            suffix = img_path.suffix.lower().lstrip(".")
            mime = {
                "jpg": "jpeg", "jpeg": "jpeg", "png": "png",
                "webp": "webp", "svg": "svg+xml",
            }.get(suffix, "png")
            b64 = base64.b64encode(img_bytes).decode()
            data_uri = f"data:image/{mime};base64,{b64}"
            # SVG icons need contain, not cover — preserve aspect ratio and don't crop
            object_fit = "contain" if suffix == "svg" else "cover"
            processed["IMAGE_HTML"] = (
                f'<img src="{data_uri}" alt="" '
                f'style="width:100%;height:100%;object-fit:{object_fit};display:block;">'
            )
            # Typed-image-slot pattern (Stage 1+): templates that use
            # {{#IMAGE_PATH}}<img src="{{IMAGE_PATH}}">{{/IMAGE_PATH}}
            # need IMAGE_PATH populated too. Only set if caller didn't already.
            if not processed.get("IMAGE_PATH"):
                processed["IMAGE_PATH"] = data_uri
        else:
            processed["IMAGE_HTML"] = ""

    # Convert all local file paths in *_PATH data keys to base64 data URIs.
    # Playwright's set_content() has no base URL + blocks file://, so any local
    # path leaks as a broken image. This pass embeds BG_SOURCE_PATH, the logo,
    # any image slot _PATH, etc.
    processed = embed_paths_as_data_uris(processed, brand_context, html_path.parent.resolve())

    raw_html = html_path.read_text(encoding="utf-8")
    # Auto-tag decoration so tweaks on synthetic handles (BACKGROUND/GRAPHIC/…)
    # apply on rebake exactly as in the editor preview (RNDR-04 parity).
    raw_html = _tag_decor(raw_html)

    # Phase 1 — pop parameterization control keys (they shouldn't reach Mustache)
    bg_override = (processed.pop("_BG_OVERRIDE", None) or "").strip()
    omitted_ids = processed.pop("_OMITTED_IDS", None) or []

    # --bg-override: replace `url('bg.png')` references with the override image,
    # inlined DIRECTLY as a base64 data URI. Inlining here (rather than inserting the
    # path and leaning on _inline_relative_urls) is required because that regex stops
    # at whitespace — an absolute override path containing spaces (e.g. "Gustavo
    # Bezerra") would silently fail to resolve and the bg would render blank.
    if bg_override:
        _ov = Path(bg_override)
        if not _ov.is_absolute() and brand_context:
            _cand = (brand_context / bg_override).resolve()
            if _cand.is_file():
                _ov = _cand
        if _ov.is_file():
            import base64 as _b64ov
            _mime = _MEDIA_TYPE_BY_EXT.get(_ov.suffix.lower(), "image/png")
            _ov_uri = f"data:{_mime};base64,{_b64ov.b64encode(_ov.read_bytes()).decode()}"
            raw_html = raw_html.replace("url('bg.png')", f"url('{_ov_uri}')")
            raw_html = raw_html.replace('url("bg.png")', f'url("{_ov_uri}")')
        else:
            print(f"[render_template] --bg-override file not found: {bg_override}", file=sys.stderr)

    # Resolve relative `url('xxx.png')` (CSS) and `<img src="xxx.png">` (HTML)
    # references against the template's containing folder and inline them as base64
    # data URIs. Playwright's set_content() has no base URL — without this,
    # `background: url('bg.png')` and `<img src="../logos/brand.png">` just render
    # broken because file:// is blocked and the relative path doesn't resolve.
    #
    # `html_path.parent` is the right base in all three render modes:
    #   - template_dir mode: `html_path = template_dir / "template.html"` → parent = template_dir
    #   - pool mode:         `html_path` returned by resolve_pool_template → parent = pool template dir
    #   - legacy mode:       `html_path = TEMPLATES_DIR / f"{template}.html"` → parent = TEMPLATES_DIR
    raw_html = _inline_relative_urls(raw_html, html_path.parent.resolve())

    # --slots-omitted: inject a CSS rule that hides matching element IDs.
    # Templates that want slots omittable MUST give each zone an `id="<element-id>"` matching
    # _measurements.yaml. Documented in template-conventions.md.
    if omitted_ids:
        selectors = ", ".join([f"#{eid}" for eid in omitted_ids])
        hide_css = f"<style>{selectors} {{ display: none !important; }}</style>"
        if "</head>" in raw_html:
            raw_html = raw_html.replace("</head>", hide_css + "</head>", 1)
        else:
            raw_html = hide_css + raw_html

    # FASE 2 — materialize decomposed layer <img> elements before CSS injection.
    # _materialize_layers is a no-op when _slide_tweaks has no layer entries
    # (no "img" key present), so RNDR-05 byte-identical guarantee is preserved.
    if tweaks and _slide_tweaks:
        raw_html = _materialize_layers(raw_html, _slide_tweaks)
        # Post-production texture overlay (Addendum 5): injected AFTER the layers so it
        # composites over everything on the slide. No-op without a __texture entry.
        raw_html = _materialize_texture(raw_html, _slide_tweaks.get("__texture"))

    # --tweaks: apply per-zone text overrides and inject CSS overrides.
    # RNDR-05 no-op guarantee: when tweaks is None or _slide_tweaks is {},
    # neither branch mutates processed nor injects any <style> — output is
    # byte-identical to the no-tweaks path.
    _raw_text_keys: set = set()
    if tweaks and _slide_tweaks:
        apply_tweaks(processed, _slide_tweaks)
        # Slots the user retyped are inserted RAW at fill() so a <mark>/<br> they
        # kept renders identically to the editor's innerHTML (audit #2). Untweaked
        # double-brace slots stay escaped.
        _raw_text_keys = text_tweak_keys(_slide_tweaks)
        _tweaks_css = _build_tweaks_css(_slide_tweaks)
        # Inject the curated Google Fonts <link> ONLY when a fontFamily override is
        # present, so the no-tweaks path stays byte-identical (RNDR-05). The link is
        # the SAME builder the editor uses → preview font == rebaked PNG font.
        _needs_fonts = any(
            isinstance(z, dict) and z.get("fontFamily") for z in _slide_tweaks.values()
        )
        _inject = (build_google_fonts_link() if _needs_fonts else "")
        if _tweaks_css:
            _inject += f"<style>{_tweaks_css}</style>"
        if _inject:
            if "</head>" in raw_html:
                raw_html = raw_html.replace("</head>", _inject + "</head>", 1)
            else:
                raw_html = _inject + raw_html

    filled = fill(raw_html, {**processed, "BRAND_TOKENS_CSS": tokens}, _raw_text_keys)

    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    # Canvas (canvas_w / canvas_h) was resolved above next to the token build.

    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            ctx = browser.new_context(viewport={"width": canvas_w, "height": canvas_h}, device_scale_factor=2)
            page = ctx.new_page()
            page.set_content(filled, wait_until="domcontentloaded")
            # Load the shared/stylesheet — for pool templates this is the
            # pool's _shared/styles.css; for legacy it's family/styles.css.
            # Pool-level shared sheet first (brand @font-face + base classes), then the
            # per-template override (if any) so it wins the cascade.
            #
            # SPEC-C C1: inject the sheet TEXT with its `@font-face` `url(...)` refs
            # inlined to base64 — NOT via `add_style_tag(path=…)`. set_content() has no
            # base URL (about:blank), so the sheet's RELATIVE font URLs
            # (`url('../../../visual-identity/fonts/anton-400.woff2')`) resolved against
            # about:blank and failed silently → every HTML headline fell back to system
            # sans. Inlining relative to the CSS file's OWN parent dir fixes the load.
            if pool_shared_css and Path(pool_shared_css).is_file():
                page.add_style_tag(content=_read_css_with_inlined_urls(Path(pool_shared_css)))
            if shared_css_path and shared_css_path.is_file():
                page.add_style_tag(content=_read_css_with_inlined_urls(shared_css_path))
            if tokens:
                # Inject AFTER the shared sheet so brand_kit wins the cascade.
                page.add_style_tag(content=f":root {{ {tokens} }}")
            page.wait_for_load_state("networkidle")
            # Explicitly wait for fonts (Google Fonts @import) — networkidle alone
            # sometimes screenshots before font swap completes, yielding Arial fallback.
            page.evaluate("() => document.fonts.ready")
            # SPEC-C C3 — font-resolved gate: assert the brand display family actually
            # loaded. Guards C1 from silently regressing (a relative @font-face that fails
            # to resolve falls back to system sans, which looks "fine" to a PNG diff but is
            # the decisive type bug). The family name is parsed from the brand --brand-display
            # token; on fallback we warn (always) and, with require_font, hard-fail the bake.
            _brand_fam = _brand_display_family(tokens)
            if _brand_fam:
                _resolved = bool(page.evaluate(
                    "(fam) => document.fonts.check(`400 100px \"${fam}\"`)", _brand_fam
                ))
                _fc_path = output.with_suffix(output.suffix + ".fontcheck.json")
                try:
                    _fc_path.write_text(
                        json.dumps({"family": _brand_fam, "resolved": _resolved}),
                        encoding="utf-8",
                    )
                except OSError:
                    pass
                if _resolved:
                    print(f"[font-check] ok: brand display \"{_brand_fam}\" resolved", file=sys.stderr)
                else:
                    print(
                        f"[font-check] FALLBACK: brand display \"{_brand_fam}\" did NOT load — "
                        f"HTML headlines render in system sans. Check the @font-face inlining "
                        f"in render_template (SPEC-C C1).",
                        file=sys.stderr,
                    )
                    if require_font:
                        browser.close()
                        raise SystemExit(f"[font-check] FAIL: brand display font \"{_brand_fam}\" unresolved")
            page.screenshot(path=str(output), omit_background=False, full_page=False, clip={"x": 0, "y": 0, "width": canvas_w, "height": canvas_h})
        finally:
            browser.close()

    return output


_RELATIVE_URL_RE = re.compile(r"""url\(\s*['"]?(?P<path>[^'")\s]+)['"]?\s*\)""")
_IMG_SRC_RE = re.compile(r"""(?P<lead><img\b[^>]*?\bsrc\s*=\s*)(?P<quote>['"])(?P<path>[^'"\s>]+)(?P=quote)""", re.IGNORECASE)
_MEDIA_TYPE_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
}


def _inline_relative_urls(html_text: str, base_dir: Path) -> str:
    """Replace `url('xxx.png')` (CSS) and `<img src="xxx.png">` (HTML) with
    base64 data URIs when xxx.png is a local file that exists relative to base_dir.

    Leaves http(s):// and existing data: URIs untouched. Used by template-dir mode
    since Playwright's set_content() can't resolve relative file paths."""
    import base64

    def _resolve_to_data_uri(path_str: str) -> str | None:
        if path_str.startswith(("http://", "https://", "data:", "//", "#")):
            return None
        candidate = (base_dir / path_str).resolve()
        if not candidate.is_file():
            return None
        ext = candidate.suffix.lower()
        media = _MEDIA_TYPE_BY_EXT.get(ext)
        if not media:
            return None
        b64 = base64.b64encode(candidate.read_bytes()).decode("ascii")
        return f"data:{media};base64,{b64}"

    def replace_css(match: re.Match) -> str:
        uri = _resolve_to_data_uri(match.group("path"))
        return f"url('{uri}')" if uri else match.group(0)

    def replace_img(match: re.Match) -> str:
        uri = _resolve_to_data_uri(match.group("path"))
        if not uri:
            return match.group(0)
        return f"{match.group('lead')}{match.group('quote')}{uri}{match.group('quote')}"

    html_text = _RELATIVE_URL_RE.sub(replace_css, html_text)
    html_text = _IMG_SRC_RE.sub(replace_img, html_text)
    return html_text


_BRAND_DISPLAY_RE = re.compile(r"--brand-display\s*:\s*([^;]+);")


def _brand_display_family(tokens_css: str) -> str | None:
    """Extract the FIRST (brand) display family name from a `--brand-display` token
    declaration, stripped of quotes. Returns None when no brand display token is set
    (e.g. a brand with no custom display face) so the font-check is skipped rather
    than asserting a generic fallback. Example value:
    `"Anton", 'Inter Tight', system-ui` → `Anton`."""
    if not tokens_css:
        return None
    m = _BRAND_DISPLAY_RE.search(tokens_css)
    if not m:
        return None
    first = m.group(1).split(",", 1)[0].strip()
    return first.strip("\"'").strip() or None


def _read_css_with_inlined_urls(css_path: Path) -> str:
    """Read a stylesheet and inline its relative `url(...)` references (notably
    `@font-face` font files) to base64 data URIs, resolved against the CSS file's
    OWN parent directory.

    Required for the shared sheets injected at bake time: Playwright's set_content()
    runs against `about:blank` (no base URL), so a sheet injected via
    add_style_tag(path=…) keeps its relative `url(...)` refs unresolved and the brand
    @font-face silently fails to load. Inlining here lets add_style_tag(content=…)
    carry the fonts in-band. The `<img>` pass in _inline_relative_urls is a harmless
    no-op on CSS text (no <img> tags)."""
    css_text = css_path.read_text(encoding="utf-8")
    return _inline_relative_urls(css_text, css_path.parent.resolve())


def load_data_arg(value: str | None) -> dict:
    if not value:
        return {}
    p = Path(value)
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return json.loads(value)


def main() -> None:
    parser = argparse.ArgumentParser(description="Render a carousel HTML template to PNG.")
    parser.add_argument("--template", help="Legacy: template name in the form <family>/<page>, e.g. subtle/front")
    parser.add_argument("--template-pool", dest="template_pool", help="Per-skill pool name (e.g., linkedin-carousel)")
    parser.add_argument("--template-id", dest="template_id", help="Template id from the pool's manifest (e.g., hero-typographic)")
    parser.add_argument("--template-dir", dest="template_dir", help="Per-template folder containing template.html (+ optional bg.png, instructions.md). New simplified architecture — preferred over --template-pool/--template-id.")
    parser.add_argument("--use-sample-text", dest="use_sample_text", action="store_true", help="Read sample text from the template's instructions.md slot defaults and merge into data. Works with --template-dir AND --template-pool/--template-id.")
    parser.add_argument("--output", required=True, type=Path, help="Output PNG path")
    parser.add_argument("--data", help="Slide data: either a JSON file path or an inline JSON string")
    parser.add_argument("--brand-kit", dest="brand_kit", help="Brand kit JSON file path or inline JSON; if omitted, loads from <project_root>/brand_context/")
    parser.add_argument("--allow-draft", dest="allow_draft", action="store_true", help="Allow rendering templates with status='draft' (used by Phase 4.5 preview before user acceptance). Default: only 'ready' status.")
    parser.add_argument("--brand-context", dest="brand_context", help="Brand context folder path (overrides auto-detect)")
    parser.add_argument("--canvas", help="Target canvas as WxH (e.g. 1920x1080) for non-carousel formats. Overrides the brand grid; drives token scaling + viewport. Default: brand canvas (1080x1350).")
    parser.add_argument("--image-src", dest="image_src", help="Path to image file to embed in the {{IMAGE_HTML}} slot")
    parser.add_argument("--no-ai-bg", dest="no_ai_bg", action="store_true", help="Skip AI generation for v3 image slots with prompt_pattern. Use when the caller explicitly declines AI bg cost. Default: generate AI images for any image slot lacking a path.")
    # Phase 1 parameterization flags — templates as recipes, not fixed renders
    parser.add_argument("--slots-omitted", dest="slots_omitted", default="", help="Comma-separated list of slot/element ids to OMIT from the render (the corresponding HTML element is hidden via display:none). Used per-post to skip optional slots.")
    parser.add_argument("--bg-override", dest="bg_override", help="Path to a PNG that replaces the template's default bg.png reference (the template's `url('bg.png')` is rewritten to point here). Used per-post for brand-substituted bgs.")
    parser.add_argument("--content-data", dest="content_data", help="JSON file path with per-slot content overrides (equivalent to --data; merged on top of sample text). Convenience flag for clarity in per-post pipelines.")
    # Plan 01-03 — tweaks.json override layer (per-zone text + CSS + global brand patch)
    parser.add_argument(
        "--tweaks", dest="tweaks", default=None,
        help="Path to tweaks.json: per-zone text/style overrides keyed by data-slot handle. "
             "Layered on top of base data before Mustache fill and before Playwright bake. "
             "Use --tweaks-slide to select the slide-level sub-dict. "
             "Absent or empty slide entry renders byte-identically to current output (RNDR-05).",
    )
    parser.add_argument(
        "--tweaks-slide", dest="tweaks_slide", default=None,
        help="Slide key in tweaks.json to apply (e.g. 'slide-01'). "
             "If omitted, derived from the output filename stem (e.g. --output slide-01.png gives 'slide-01').",
    )
    # AIOS-139 Addendum 8 #1 — emit a self-contained per-slide editing dir alongside
    # the baked PNG so Content Studio's introspected text/layout controls fire on a
    # real run (whose folder otherwise holds only slide-*.png). Documented exception
    # to the clean-output policy.
    parser.add_argument(
        "--emit-edit-slide", dest="emit_edit_slide", action="store_true",
        help="After baking a templated slide, write <output_dir>/_slides/<slide-id>/ "
             "(template.html + instructions.md + metadata.json carrying the real --data) "
             "and a shared <output_dir>/_slides/_shared/, so Content Studio can re-edit "
             "and rebake the slide self-containedly. No-op for full-AI (no template).",
    )
    parser.add_argument(
        "--require-font", dest="require_font", action="store_true",
        help="Hard-fail the bake (non-zero exit) if the brand display @font-face does not "
             "resolve in the page (document.fonts.check). Use in the quality gate to guard "
             "against the relative-@font-face load regression (SPEC-C C3). Without it, an "
             "unresolved font only prints a [font-check] FALLBACK warning.",
    )
    args = parser.parse_args()

    if not args.template and not (args.template_pool and args.template_id) and not args.template_dir:
        parser.error("must pass --template-dir (new), OR --template (legacy), OR both --template-pool and --template-id")

    # Load .env from project root (one level above brand_context) so Case B/C
    # subprocesses (generate_image_gpt.py / gemini) inherit API keys.
    if args.brand_context:
        bc = Path(args.brand_context).resolve()
        load_env_file(bc.parent / ".env")

    data = load_data_arg(args.data)

    # Brand kit: explicit > load from brand_context/ > empty
    if args.brand_kit:
        brand_kit = load_data_arg(args.brand_kit)
    else:
        try:
            from brand_kit_loader import load as _load_kit
        except ImportError:
            sys.path.insert(0, str(SCRIPT_DIR))
            from brand_kit_loader import load as _load_kit
        bc = Path(args.brand_context).resolve() if args.brand_context else None
        brand_kit = _load_kit(bc)

    if args.image_src:
        data["IMAGE_SRC"] = args.image_src

    # --use-sample-text: read sample text from the template's instructions.md slot
    # defaults and merge into data (existing data values take precedence). Works in
    # BOTH --template-dir mode and --template-pool/--template-id (pool) mode.
    if args.use_sample_text:
        instructions_path: Path | None = None
        if args.template_dir:
            instructions_path = Path(args.template_dir).resolve() / "instructions.md"
        elif args.template_pool and args.template_id:
            bc = Path(args.brand_context).resolve() if args.brand_context else None
            try:
                _entry, _html_path, _prompt_path, _shared_css = resolve_pool_template(
                    args.template_pool, args.template_id,
                    brand_context=bc,
                    allow_draft=getattr(args, "allow_draft", False),
                )
                if _html_path is not None:
                    instructions_path = _html_path.parent / "instructions.md"
            except Exception as exc:
                print(f"[render_template] --use-sample-text: pool resolve failed: {exc}", file=sys.stderr)
        if instructions_path and instructions_path.exists():
            samples = parse_sample_text_from_instructions(instructions_path)
            for k, v in samples.items():
                if k not in data:
                    data[k] = v

    # Masthead chrome: TOKEN > SAMPLE (precedence INVERSION). See
    # apply_masthead_tokens() — must run AFTER the sample merge above so the token
    # overrides the (possibly stale) per-template sample, not the other way round.
    apply_masthead_tokens(data, brand_kit)

    # --content-data: merge per-slot overrides (alias-style flag for clarity in per-post pipelines)
    if args.content_data:
        content_overrides = load_data_arg(args.content_data)
        data.update(content_overrides)

    # Phase 1 — render-time parameterization (post-process the rendered HTML)
    omitted_ids = [s.strip() for s in (args.slots_omitted or "").split(",") if s.strip()]
    data["_OMITTED_IDS"] = omitted_ids
    data["_BG_OVERRIDE"] = args.bg_override or ""

    target_canvas = None
    if getattr(args, "canvas", None):
        try:
            _cw, _ch = args.canvas.lower().split("x")
            target_canvas = {"width": int(_cw), "height": int(_ch)}
        except ValueError:
            print(f"[render_template] --canvas must be WxH (e.g. 1920x1080); got {args.canvas!r}", file=sys.stderr)
            sys.exit(2)
    # --tweaks: load overrides file (JSON) if provided; auto-load canonical base
    output_stem = args.output.stem
    tweaks_slide_id: str | None = getattr(args, "tweaks_slide", None)
    canonical = _load_canonical_tweaks(args, tweaks_slide_id, output_stem)
    caller_tweaks = load_data_arg(args.tweaks) if getattr(args, "tweaks", None) else None
    tweaks_data = _merge_tweaks(canonical, caller_tweaks)  # caller wins; None-safe

    result = render(
        args.output, data, brand_kit,
        template=args.template,
        template_pool=args.template_pool,
        template_id=args.template_id,
        template_dir=args.template_dir,
        target_canvas=target_canvas,
        brand_context=Path(args.brand_context).resolve() if args.brand_context else None,
        allow_draft=getattr(args, "allow_draft", False),
        allow_ai_gen=not getattr(args, "no_ai_bg", False),
        tweaks=tweaks_data,
        tweaks_slide=tweaks_slide_id,
        require_font=getattr(args, "require_font", False),
    )
    print(f"Rendered -> {result}")

    # AIOS-139 Addendum 8 #1 — persist a self-contained editing dir for this slide.
    if getattr(args, "emit_edit_slide", False):
        try:
            tmpl_html, instr_path, shared_dir = _resolve_template_assets(args, brand_kit)
            if tmpl_html is not None:
                sid = tweaks_slide_id or args.output.stem
                # The editor enumerator (_find_slides_info) only recognizes slide
                # dirs named `slide-<N>`. A template-author bake outputs preview.png
                # → stem "preview", which the enumerator would skip, dropping the
                # authored data (text + PHOTO_MAIN_PATH) → the editor opens without
                # the hero photo. Normalize any non-`slide-N` id to the canonical
                # single-slide id so the emitted dir is always picked up.
                if not re.match(r"slide-\d+$", sid):
                    sid = "slide-01"
                emit_edit_slide(
                    out_png=args.output, slide_id=sid,
                    template_html=tmpl_html, instructions=instr_path,
                    shared_dir=shared_dir, data=data,
                    template_id=args.template_id, template_pool=args.template_pool,
                )
        except Exception as exc:  # never fail the bake over the editing-dir copy
            print(f"[render_template] --emit-edit-slide skipped: {exc}", file=sys.stderr)


def _load_canonical_tweaks(args, tweaks_slide_id: str | None, output_stem: str) -> dict | None:
    """Load and re-key a per-template canonical tweaks file for auto-base injection.

    Looks for ``<template_dir>/tweaks.json`` (written by the Template Studio
    /approve endpoint).  If the file contains the sentinel key ``"__canonical__"``
    the sub-dict is re-keyed to *tweaks_slide_id* or *output_stem* so the result
    is slide-keyed and can be passed straight to :func:`render`.

    Returns ``None`` when no canonical file is found or any error occurs — callers
    must treat ``None`` as "no canonical tweaks" and continue normally.
    """
    try:
        # Resolve the template folder
        folder: Path | None = None
        if getattr(args, "template_dir", None):
            folder = Path(args.template_dir).resolve()
        elif getattr(args, "template_pool", None) and getattr(args, "template_id", None):
            bc = Path(args.brand_context).resolve() if getattr(args, "brand_context", None) else None
            _entry, html_path, _prompt_path, _shared_css = resolve_pool_template(
                args.template_pool, args.template_id,
                brand_context=bc,
                allow_draft=getattr(args, "allow_draft", False),
            )
            if html_path is not None:
                folder = Path(html_path).parent
        if folder is None:
            return None

        cf = folder / "tweaks.json"
        if not cf.is_file():
            return None

        loaded: dict = json.loads(cf.read_text(encoding="utf-8"))
        if not isinstance(loaded, dict):
            return None

        if "__canonical__" in loaded:
            slide_key = tweaks_slide_id or output_stem
            return {slide_key: loaded["__canonical__"]}
        # Already slide-keyed (e.g. hand-written file) — return as-is
        return loaded
    except Exception as exc:  # never fail the bake over a malformed canonical file
        print(f"[render_template] _load_canonical_tweaks: {exc}", file=sys.stderr)
        return None


def _merge_tweaks(base: dict | None, over: dict | None) -> dict | None:
    """Deep-merge two slide-keyed tweaks dicts; *over* wins key-by-key.

    Both arguments are slide-keyed dicts (``{slide_id: {zones: {…}, text: {…}, …}}``).
    The merge is per-slide-key, then per sub-dict key (zones, text, global), so a
    run-level override for one zone does not erase canonical data for other zones.

    Returns ``None`` when both arguments are ``None`` (preserves byte-identical
    behaviour for callers that provide neither canonical nor ``--tweaks``).
    """
    if base is None and over is None:
        return None
    if base is None:
        return over
    if over is None:
        return base

    import copy
    merged: dict = copy.deepcopy(base)
    for slide_key, over_slide in over.items():
        if slide_key not in merged:
            merged[slide_key] = copy.deepcopy(over_slide)
        else:
            base_slide = merged[slide_key]
            for sub_key, over_sub in over_slide.items():
                if sub_key not in base_slide:
                    base_slide[sub_key] = copy.deepcopy(over_sub)
                elif isinstance(base_slide[sub_key], dict) and isinstance(over_sub, dict):
                    # Key-by-key merge within zones/text/global
                    base_slide[sub_key] = {**base_slide[sub_key], **over_sub}
                else:
                    base_slide[sub_key] = copy.deepcopy(over_sub)
    return merged


def _resolve_template_assets(args, brand_kit) -> tuple[Path | None, Path | None, Path | None]:
    """Resolve (template.html, instructions.md, _shared dir) for the rendered slide,
    in both --template-dir and --template-pool/--template-id modes. Returns
    (None, …) for full-AI (.prompt.md) templates that have no HTML to edit.
    """
    if args.template_dir:
        tdir = Path(args.template_dir).resolve()
        html = tdir / "template.html"
        instr = tdir / "instructions.md"
        shared = tdir.parent / "_shared"
        return (html if html.is_file() else None,
                instr if instr.is_file() else None,
                shared if shared.is_dir() else None)
    if args.template_pool and args.template_id:
        bc = Path(args.brand_context).resolve() if args.brand_context else None
        _entry, html_path, _prompt_path, _shared_css = resolve_pool_template(
            args.template_pool, args.template_id, brand_context=bc,
            allow_draft=getattr(args, "allow_draft", False),
        )
        if html_path is None:
            return (None, None, None)  # full-AI prompt template — nothing to edit
        html_path = Path(html_path)
        instr = html_path.parent / "instructions.md"
        shared = html_path.parent.parent / "_shared"
        return (html_path,
                instr if instr.is_file() else None,
                shared if shared.is_dir() else None)
    return (None, None, None)


# Keys that are render-internal (not real slot values) — kept out of the persisted
# metadata.data so a rebake/edit sees exactly the post's content.
_NON_SLOT_KEYS = frozenset({
    "_OMITTED_IDS", "_BG_OVERRIDE", "BRAND_TOKENS_CSS", "IMAGE_SRC",
})


def emit_edit_slide(
    out_png: Path, slide_id: str,
    template_html: Path, instructions: Path | None,
    shared_dir: Path | None, data: dict,
    template_id: str | None = None, template_pool: str | None = None,
) -> Path:
    """Write a self-contained ``<run>/_slides/<slide_id>/`` editing dir next to the
    baked PNG (AIOS-139 Addendum 8 #1) and a once-copied ``<run>/_slides/_shared/``.

    The dir holds ``template.html`` + ``instructions.md`` (slot introspection) +
    ``metadata.json`` carrying the post's REAL ``data`` so Content Studio renders and
    rebakes the actual copy (not sample text). Returns the slide dir path.
    """
    import shutil
    run = out_png.resolve().parent
    slides_root = run / "_slides"
    sdir = slides_root / slide_id
    sdir.mkdir(parents=True, exist_ok=True)

    # Ensure the persisted template carries stable data-slot handles on its TEXT zones
    # so Content Studio can introspect them as editable layers and the rebake can apply
    # per-zone tweaks. Old/unmigrated pool templates only have {{MUSTACHE}} placeholders
    # (no data-slot), which would surface only the auto-tagged decor (LOGO/GRAPHIC/BG).
    # migrate_data_slots.migrate() is idempotent + stdlib-only; degrade to a verbatim
    # copy if it can't be imported.
    tmpl_text = template_html.read_text(encoding="utf-8", errors="ignore")
    try:
        _mvi = SCRIPT_DIR.parent.parent / "mkt-visual-identity" / "scripts"
        if str(_mvi) not in sys.path:
            sys.path.insert(0, str(_mvi))
        from migrate_data_slots import migrate as _migrate_slots  # type: ignore[import]
        tmpl_text, _ = _migrate_slots(tmpl_text)
    except Exception as exc:
        print(f"[render_template] emit_edit_slide: data-slot migration skipped: {exc}",
              file=sys.stderr)
    (sdir / "template.html").write_text(tmpl_text, encoding="utf-8")
    if instructions and instructions.is_file():
        shutil.copyfile(instructions, sdir / "instructions.md")

    # Copy the template's OWN assets/ (logo stamps, graphics, bg.png that the HTML
    # references via src="assets/…" / url(assets/…)) so the editor inlines them and
    # the rebake composites them — without this LOGO/GRAPHIC zones render broken and
    # the run isn't self-contained. Per-template, next to its template.html.
    src_tdir = template_html.resolve().parent
    src_assets = src_tdir / "assets"
    if src_assets.is_dir():
        shutil.copytree(src_assets, sdir / "assets", dirs_exist_ok=True)

    # Copy the template's OWN _ai_bg/ (the authored hero/bg samples that *_PATH data
    # slots reference — e.g. PHOTO_MAIN_PATH → _ai_bg/photo_main.png). Without this
    # the slide is NOT self-contained: at rebake the editor passes the slide dir as
    # --template-dir, and a relative _PATH that can't be found there renders with no
    # photo. Copying it (like assets/) + rewriting the data paths below to be
    # slide-relative makes the slide render the hero whether in place or relocated.
    src_ai_bg = src_tdir / "_ai_bg"
    if src_ai_bg.is_dir():
        shutil.copytree(src_ai_bg, sdir / "_ai_bg", dirs_exist_ok=True)

    # Copy the pool's _shared/ (styles.css + brand @font-face files) ONCE, so the
    # editor resolves template_dir.parent/_shared/ locally and the run survives the
    # brand_context moving. Skip if already populated.
    if shared_dir and shared_dir.is_dir():
        dest_shared = slides_root / "_shared"
        if not (dest_shared / "styles.css").is_file():
            shutil.copytree(shared_dir, dest_shared, dirs_exist_ok=True)

    clean_data = {k: v for k, v in data.items() if k not in _NON_SLOT_KEYS}
    # Rewrite image-slot paths (keys ending in _PATH) that point into the template's
    # own _ai_bg/ or assets/ to be slide-relative, so they resolve against the slide
    # dir we just made self-contained — independent of the absolute/base-relative
    # form the caller passed and of where the slide dir later moves.
    for _k, _v in list(clean_data.items()):
        if not _k.endswith("_PATH") or not isinstance(_v, str) or not _v:
            continue
        if _v.startswith(("data:", "http://", "https://")):
            continue
        _norm = _v.replace("\\", "/")
        for _marker in ("_ai_bg/", "assets/"):
            _i = _norm.rfind(_marker)
            if _i != -1 and (sdir / _norm[_i:]).is_file():
                clean_data[_k] = _norm[_i:]
                break
    meta = {
        "slide_id": slide_id,
        "template_id": template_id,
        "template_pool": template_pool,
        # Absolute pointer back to the source template dir — a fallback for asset
        # resolution; the local template.html/instructions.md are authoritative.
        "source_template_dir": str(template_html.resolve().parent),
        "data": clean_data,
    }
    (sdir / "metadata.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    return sdir


def _clean_sample_value(raw: str) -> str:
    """Normalise a raw `sample:` value: trim, drop a trailing inline-list separator,
    then strip ONE layer of surrounding quotes or backticks.

    Tolerant of the two quirks that silently dropped sample slots in the AIOS-190
    gate run:
      - a value wrapped in backticks (``sample: `Learn More` ``) kept the literal
        backticks → they rendered as stray glyphs. Strip surrounding ` `.
      - a value carried inline after other fields on a combined line
        (``bbox: … · style: … · sample: "X"``) — the caller extracts the tail after
        `sample:`; here we also drop a dangling ` · `/` | ` separator if one trails.
    """
    raw = raw.strip()
    # A combined one-liner may leave a trailing list separator after the value when
    # `sample:` was NOT the last field; defensively trim a dangling separator+remainder
    # is handled by the caller's regex, so here we only trim a bare trailing sep.
    raw = re.sub(r"\s*[·|]\s*$", "", raw).strip()
    # Strip ONE layer of matching surrounding quotes or backticks.
    for pair in ('""', "''", "``"):
        if len(raw) >= 2 and raw[0] == pair[0] and raw[-1] == pair[1]:
            raw = raw[1:-1].strip()
            break
    return raw


# Matches `sample:` whether it starts the line (own-line bullet) OR appears inline
# after other fields in a combined `bbox · style · sample` one-liner. The value is
# everything after `sample:` up to the next ` · `/` | ` field separator (so a combined
# line that continues with more fields doesn't swallow them) — or end-of-line.
_SAMPLE_INLINE_RE = re.compile(
    r"sample\s*:\s*("
    r"`[^`]*`"          # backtick-wrapped (may itself contain separators)
    r'|"[^"]*"'         # double-quoted
    r"|'[^']*'"         # single-quoted
    r"|[^·|]*"          # bare value, up to the next list separator
    r")",
    re.IGNORECASE,
)


def parse_sample_text_from_instructions(path: Path) -> dict:
    """Parse instructions.md `## Slots` block and pull `sample:` values per slot name.
    Returns dict of {SLOT_NAME: sample_text}. Best-effort regex parse — instructions.md
    is human-authored so structure may vary; missing samples are skipped silently.

    Handles slot blocks like:
      - **HERO** — italic preamble
        - bbox: 4% 22% 92% 7%
        - style: display-italic, ...
        - sample: "I never write"
    Where the sample line is an indented bullet (after stripping it becomes
    "- sample: \"I never write\"").

    Tolerant of two AIOS-190 quirks:
      - the value may be wrapped in backticks → stripped (no stray glyphs).
      - `sample:` may appear INLINE in a combined `bbox · style · sample` one-liner
        rather than on its own line → still parsed (was silently dropped before).
    """
    text = path.read_text(encoding="utf-8", errors="ignore")
    samples = {}
    current_slot = None
    slot_re = re.compile(r"^[-*]\s+\*?\*?([A-Z][A-Z0-9_]+)\*?\*?\s*[—\-]")

    for line in text.splitlines():
        stripped = line.strip()
        m_slot = slot_re.match(stripped)
        if m_slot:
            current_slot = m_slot.group(1)
            # A combined one-liner can carry the sample on the SAME line as the slot
            # header (e.g. "- **CTA** — label · sample: `Go`"). Look for it here too.
            m_inline = _SAMPLE_INLINE_RE.search(stripped)
            if m_inline:
                val = _clean_sample_value(m_inline.group(1))
                if val:
                    samples[current_slot] = val
                    current_slot = None
            continue
        if current_slot:
            m_sample = _SAMPLE_INLINE_RE.search(stripped)
            if m_sample:
                val = _clean_sample_value(m_sample.group(1))
                if val:
                    samples[current_slot] = val
                current_slot = None  # consume one sample per slot block
    return samples


# Masthead slots, in label order: labels[0]=LEFT, labels[1]=CENTER, labels[2]=RIGHT.
_MASTHEAD_SLOTS = ("MASTHEAD_LEFT", "MASTHEAD_CENTER", "MASTHEAD_RIGHT")


def apply_masthead_tokens(data: dict, brand_kit: dict | None) -> dict:
    """Override MASTHEAD_LEFT/CENTER/RIGHT in `data` from the brand's
    chrome.masthead.labels — TOKEN WINS over the per-template `sample:` value.

    This INVERTS the usual precedence. Everywhere else (inject_brand_tokens_into_data,
    --use-sample-text) the rule is "caller/sample already in `data` wins, only fill what's
    missing". The masthead is the exception: the brand's masthead identity lives in
    tokens.json > chrome.masthead.labels and must sign EVERY template identically. The
    per-template `sample:` values (merged into `data` earlier by --use-sample-text) are
    template-authoring artifacts that drift per template — pre-rebrand ones still read
    "@yourbrand". So when the token carries labels, it OVERRIDES the sample
    UNCONDITIONALLY (plain assignment, NOT setdefault). Must be called AFTER the sample
    merge in main(); calling it before, or using "fill what's missing" semantics, lets the
    stale sample win and the bug returns.

    Rules:
      - chrome.masthead.enabled == False  -> no-op (respect brand opt-out).
      - labels[1] == ""  -> intentional empty center; the empty string is written through
        (not skipped, so it can't fall back to a stale sample).
      - a label of None (absent slot) is skipped, leaving any existing sample in place.

    Mutates and returns `data`.
    """
    if not isinstance(brand_kit, dict):
        return data
    chrome = brand_kit.get("chrome")
    masthead = chrome.get("masthead") if isinstance(chrome, dict) else None
    if not isinstance(masthead, dict):
        return data
    if not masthead.get("enabled", True):
        return data
    labels = masthead.get("labels")
    if not isinstance(labels, list) or not labels:
        return data
    for idx, slot in enumerate(_MASTHEAD_SLOTS):
        if idx < len(labels) and labels[idx] is not None:
            data[slot] = labels[idx]  # unconditional: token wins over sample
    return data


def parse_slots_from_instructions(path: Path) -> list[dict]:
    """Parse the ``## Slots`` block in *instructions.md* and return the full
    schema for every slot — name, bbox, style, sample, max_chars, and an
    inferred zone type.

    Returns a list of dicts, one per slot, in document order::

        [
          {
            "name":      "HERO",
            "bbox":      {"x": 4.0, "y": 22.0, "w": 92.0, "h": 7.0},
            "style":     "display-italic, 8cqw, white on coral, left-align",
            "sample":    "I never write",
            "max_chars": 60,
            "type":      "text",   # "text" | "pill" | "image" | "chrome"
          },
          ...
        ]

    Missing optional fields (bbox, sample, max_chars) are ``None`` — the
    function never raises on a malformed instructions.md.

    ``type`` is inferred from the *style* field (case-insensitive):
    - keywords ``photo``, ``ai-image``, ``image``        → ``"image"``
    - keyword  ``pill``                                  → ``"pill"``
    - keywords ``masthead``, ``dots``, ``chrome``        → ``"chrome"``
    - anything else (or no style)                        → ``"text"``

    The existing ``parse_sample_text_from_instructions`` is left UNCHANGED;
    this function is a sibling that returns richer data.
    """
    slot_re  = re.compile(r"^[-*]\s+\*?\*?([A-Z][A-Z0-9_]+)\*?\*?\s*[—\-]")
    bbox_re  = re.compile(
        r"bbox\s*:\s*([\d.]+)%\s+([\d.]+)%\s+([\d.]+)%\s+([\d.]+)%",
        re.IGNORECASE,
    )
    # `style:` value runs up to the next field separator (· or |) so a combined
    # `style: … · sample: …` one-liner doesn't swallow the sample tail.
    style_re = re.compile(r"style\s*:\s*([^·|]+)", re.IGNORECASE)
    maxch_re = re.compile(r"max_chars\s*:\s*(\d+)", re.IGNORECASE)

    text = path.read_text(encoding="utf-8", errors="ignore")

    def _infer_type(style: str | None) -> str:
        if not style:
            return "text"
        sl = style.lower()
        if any(kw in sl for kw in ("photo", "ai-image", "image")):
            return "image"
        if "pill" in sl:
            return "pill"
        if any(kw in sl for kw in ("masthead", "dots", "chrome")):
            return "chrome"
        return "text"

    def _flush(slot: dict | None, results: list) -> None:
        """Finalise a slot dict and append to results."""
        if slot is None:
            return
        slot["type"] = _infer_type(slot.get("style"))
        results.append(slot)

    results: list[dict] = []
    current_slot: dict | None = None
    in_slots_section = False

    for line in text.splitlines():
        stripped = line.strip()

        # Detect ## Slots heading (enter slots section)
        if re.match(r"^#{1,3}\s+Slots\s*$", stripped, re.IGNORECASE):
            in_slots_section = True
            continue

        # Any other top-level heading ends the slots section
        if in_slots_section and re.match(r"^#{1,3}\s+\S", stripped):
            in_slots_section = False
            _flush(current_slot, results)
            current_slot = None
            continue

        if not in_slots_section:
            continue

        # New slot line?
        m_slot = slot_re.match(stripped)
        if m_slot:
            _flush(current_slot, results)
            current_slot = {
                "name":      m_slot.group(1),
                "bbox":      None,
                "style":     None,
                "sample":    None,
                "max_chars": None,
                "type":      "text",  # placeholder; set on flush
            }
            continue

        if current_slot is None:
            continue

        # Fields are parsed NON-exclusively so a combined `bbox · style · sample`
        # one-liner fills every field on the line (the gate's ref-03 lost 3 slots
        # because only the first field on a combined line was read).
        m_bbox = bbox_re.search(stripped)
        if m_bbox:
            current_slot["bbox"] = {
                "x": float(m_bbox.group(1)),
                "y": float(m_bbox.group(2)),
                "w": float(m_bbox.group(3)),
                "h": float(m_bbox.group(4)),
            }

        m_style = style_re.search(stripped)
        if m_style:
            current_slot["style"] = m_style.group(1).strip()

        # sample (own-line bullet OR inline in a combined line; backtick-tolerant)
        m_sample = _SAMPLE_INLINE_RE.search(stripped)
        if m_sample:
            raw = _clean_sample_value(m_sample.group(1))
            if raw:
                current_slot["sample"] = raw

        m_maxch = maxch_re.search(stripped)
        if m_maxch:
            current_slot["max_chars"] = int(m_maxch.group(1))

    # Flush the last slot (EOF)
    _flush(current_slot, results)

    return results


# ---------------------------------------------------------------------------
# Layer-bake helper — FASE 2 (RNDR-04): materialize decomposed layers into HTML
# ---------------------------------------------------------------------------


def _materialize_layers(raw_html: str, slide_tweaks: dict) -> str:
    """Inject ``<img data-slot="LAYER_NN">`` elements for decomposed layers.

    A decomposed layer is represented in *slide_tweaks* as a slot whose name
    matches ``LAYER_\\d+`` (e.g. ``LAYER_00``, ``LAYER_01``) and whose dict
    contains an ``"img"`` key (a data URI or URL for the layer PNG).

    The element is injected as an absolutely-positioned ``<img>`` inside the
    slide root ``<div class="slide">`` (or ``<body>`` as fallback), carrying
    ``data-slot="LAYER_NN"`` and ``position:absolute`` so the existing
    ``_build_tweaks_css`` rules (x → left%, y → top%, w → width%, tilt →
    transform:rotate) land on it immediately — no new tweaks schema needed.

    Non-layer tweaks entries (no ``"img"`` key) are untouched — this function
    is purely additive and must be a no-op when *slide_tweaks* is empty or
    contains no layer entries (RNDR-05 parity guarantee).

    Called from ``render()`` BEFORE tweaks CSS injection so the injected
    element is already present when the CSS rule ``[data-slot="LAYER_NN"]``
    is applied.  The editor replicates the same injection client-side, so
    preview HTML == bake HTML (RNDR-04).
    """
    import re as _re

    # Collect layer entries in slot-name order so layers are injected
    # deterministically (sorted LAYER_00 < LAYER_01 < …).
    layer_slots = sorted(
        (name, t)
        for name, t in (slide_tweaks or {}).items()
        if _re.fullmatch(r"LAYER_\d+", name)
        and isinstance(t, dict)
        and t.get("img")
    )

    if not layer_slots:
        return raw_html  # no-op — RNDR-05 preserved

    # Build the injection block: one <img> per layer in order.
    imgs = []
    for name, t in layer_slots:
        src = t["img"]
        # The element is absolutely positioned; CSS rules will override the
        # inline style — we still set position:absolute as a safe baseline
        # so the element is in the flow of positioned children even if the
        # CSS injection is later stripped.
        imgs.append(
            f'<img data-slot="{name}" src="{src}" '
            f'style="position:absolute;max-width:none;" />'
        )

    injection = "\n".join(imgs)

    # Inject just before </div> of the first .slide container (or before </body>).
    # Using a simple heuristic: find `</div>` at the end of the outermost .slide.
    # For robustness, inject before </body> if the slide pattern is not found.
    _slide_end = _re.search(r'(<div[^>]+class="[^"]*\bslide\b[^"]*"[^>]*>)(.*?)(</div>)',
                            raw_html, _re.DOTALL)
    if _slide_end:
        # Append after the slide's last child but before its closing </div>.
        insert_at = _slide_end.end(2)  # position just before the closing </div>
        return raw_html[:insert_at] + "\n" + injection + "\n" + raw_html[insert_at:]

    # Fallback: inject before </body>
    pos = raw_html.lower().rfind("</body>")
    if pos != -1:
        return raw_html[:pos] + injection + "\n" + raw_html[pos:]
    return raw_html + "\n" + injection


# Allowlisted CSS blend modes for the post-production texture overlay (AIOS-139
# Addendum 5). Restricting the set keeps the value safe to interpolate into CSS and
# matches the editor's blend picker. "normal" = plain opacity overlay.
_TEXTURE_BLENDS = {
    "multiply", "overlay", "screen", "soft-light", "hard-light",
    "darken", "lighten", "normal",
}


def _materialize_texture(raw_html: str, texture: dict | None) -> str:
    r"""Inject a full-slide post-production texture overlay into ``.slide``.

    *texture* is the per-slide tweaks' reserved ``__texture`` entry:
    ``{"tex": <data-uri>, "blend": <css-blend>, "intensity": <0..1>}``. The overlay
    is a single absolutely-positioned, ``pointer-events:none`` ``<div>`` tiled with
    the texture image and composited with ``mix-blend-mode`` over everything on the
    slide (z-index above the injected layers). The editor injects the BYTE-IDENTICAL
    element client-side from the same data URI / blend / intensity, so the live
    preview equals the baked PNG (RNDR-04).

    No-op (returns *raw_html* unchanged) when *texture* is missing or has no ``tex`` —
    preserving the RNDR-05 byte-identical guarantee for the no-texture path.
    """
    import re as _re

    if not isinstance(texture, dict):
        return raw_html
    uri = texture.get("tex")
    if not uri:
        return raw_html
    blend = str(texture.get("blend", "multiply")).lower()
    if blend not in _TEXTURE_BLENDS:
        blend = "multiply"
    try:
        intensity = float(texture.get("intensity", 1))
    except (TypeError, ValueError):
        intensity = 1.0
    intensity = max(0.0, min(1.0, intensity))

    overlay = (
        '<div data-texture="1" style="position:absolute;inset:0;'
        f'background-image:url(&quot;{uri}&quot;);background-repeat:repeat;'
        f'mix-blend-mode:{blend};opacity:{intensity};pointer-events:none;z-index:99999">'
        "</div>"
    )

    # Inject as the LAST child of the first .slide container (so it sits above the
    # template zones + any materialized layers), else before </body> (same heuristic
    # as _materialize_layers, kept consistent).
    _slide_end = _re.search(
        r'(<div[^>]+class="[^"]*\bslide\b[^"]*"[^>]*>)(.*?)(</div>)',
        raw_html, _re.DOTALL,
    )
    if _slide_end:
        insert_at = _slide_end.end(2)
        return raw_html[:insert_at] + "\n" + overlay + "\n" + raw_html[insert_at:]
    pos = raw_html.lower().rfind("</body>")
    if pos != -1:
        return raw_html[:pos] + overlay + "\n" + raw_html[pos:]
    return raw_html + "\n" + overlay


# ---------------------------------------------------------------------------
# Tweaks helpers — Plan 01-03 (apply_tweaks, _build_tweaks_css, apply_global_tweaks)
# ---------------------------------------------------------------------------

_SCALE_TO_OBJECT_FIT: dict[str, str] = {
    "cover":  "cover",
    # crop = "show the image at native size, clipped to the zone" — the editor sets
    # objectFit:none (preview_editor.py applyToSlide 'scale'), so the bake must too.
    "crop":   "none",
    # square = 1:1 zone, still cover-filled — the editor sets objectFit:cover +
    # aspect-ratio:1/1. The aspect-ratio is emitted separately in _build_tweaks_css.
    "square": "cover",
    "contain": "contain",
    "fit":    "contain",
}

# Per-scale extra CSS props that must match the live editor (preview_editor.py
# applyToSlide 'scale': square → aspect-ratio 1/1; crop/cover → no aspect-ratio).
_SCALE_EXTRA_CSS: dict[str, list[str]] = {
    "square": ["aspect-ratio: 1 / 1"],
}


# ---------------------------------------------------------------------------
# Curated web-font set (AIOS-139 Stage A) — shared SOURCE OF TRUTH for the
# editor preview AND the bake so a per-layer fontFamily override looks identical
# in both (parity). Delivered via a Google Fonts <link>; headless Chromium fetches
# the CDN at bake time (`document.fonts.ready` already awaited in render()).
# Trade-off (accepted in the PRD): non-brand fonts now require network — brand /
# bundled @font-face fonts still render offline.
# ---------------------------------------------------------------------------
CURATED_FONTS: list[tuple[str, str]] = [
    ("Inter", "sans-serif"),
    ("Geist", "sans-serif"),
    ("Manrope", "sans-serif"),
    ("DM Sans", "sans-serif"),
    ("Space Grotesk", "sans-serif"),
    ("Sora", "sans-serif"),
    ("Hanken Grotesk", "sans-serif"),
    ("Fraunces", "serif"),
    ("Playfair Display", "serif"),
    ("Archivo", "sans-serif"),
    ("JetBrains Mono", "monospace"),
]
_FONT_GENERIC: dict[str, str] = {name: generic for name, generic in CURATED_FONTS}


def css_font_value(family: str) -> str:
    """A CSS ``font-family`` value for *family*: the quoted family + a sensible
    generic fallback (so a multi-word name like ``Playfair Display`` is valid and a
    failed CDN load still degrades to the right generic). Shared by editor + bake."""
    fam = (family or "").strip().strip('"').strip("'")
    if not fam:
        return ""
    generic = _FONT_GENERIC.get(fam, "sans-serif")
    return f'"{fam}", {generic}'


def build_google_fonts_link(extra_families: list[str] | None = None) -> str:
    """The Google Fonts ``<link>`` (with preconnect) requesting the curated set
    (+ any *extra_families*, e.g. brand fonts that happen to be Google fonts). Same
    string injected into the editor's slide ``<head>`` and the bake's slide HTML, so
    a fontFamily override renders identically in preview and PNG."""
    names = [n for n, _ in CURATED_FONTS]
    for fam in (extra_families or []):
        if fam and fam not in names:
            names.append(fam)
    specs = []
    for n in names:
        fam_param = n.replace(" ", "+")
        wght = "wght@400;500" if n == "JetBrains Mono" else "wght@400;500;600;700"
        specs.append(f"family={fam_param}:{wght}")
    href = "https://fonts.googleapis.com/css2?" + "&".join(specs) + "&display=swap"
    return (
        '<link rel="preconnect" href="https://fonts.googleapis.com">'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
        f'<link rel="stylesheet" href="{href}">'
    )


def _build_tweaks_css(slide_tweaks: dict) -> str:
    """Build a CSS string of ``[data-slot="NAME"] { ... }`` rules from *slide_tweaks*.

    Only numeric/string CSS properties are emitted.  Text overrides and
    non-CSS keys (``text``, ``layers``) are silently ignored.
    ``scale`` maps to ``object-fit`` on the slot element and its inner ``img``.
    The ``global`` key is always skipped (it is a brand-kit patch, not a slot).

    Returns an empty string when *slide_tweaks* is empty or contains no CSS props.
    """
    rules: list[str] = []
    for slot_name, t in slide_tweaks.items():
        if slot_name == "global":
            continue
        if slot_name.startswith("__"):
            continue  # reserved non-slot metadata (e.g. __texture) — not a zone
        if not isinstance(t, dict):
            continue

        # Remove asset (§4): a zone flagged removed:true (a real template zone the
        # user deleted) OR an eye-hidden zone (visible:false) must NOT render in the
        # baked PNG. Emit display:none and skip the rest — this is the round-trip the
        # bake was missing (a hidden/removed zone used to reappear in the PNG).
        if t.get("removed") is True:
            rules.append(f'[data-slot="{slot_name}"] {{ display: none !important; }}')
            continue

        props: list[str] = []
        if t.get("visible") is False:
            props.append("display: none")
        # Position is a translate DELTA (slide %) applied via the CSS `translate`
        # property — containing-block-agnostic, so a `relative` zone nested in an
        # auto-height card moves on BOTH axes (top:% used to compute to 0 there). It
        # composes with the `transform: rotate()` tilt below (individual transform
        # properties apply before `transform`). Matches the editor's `el.style.translate`
        # exactly → preview == PNG. 1080x1350 = the brand carousel canvas.
        if "x" in t or "y" in t:
            _dx = float(t.get("x", 0)) / 100 * 1080
            _dy = float(t.get("y", 0)) / 100 * 1350
            props.append(f"translate: {_dx:g}px {_dy:g}px")
        if "w" in t:
            props.append(f"width: {t['w']}%")
        if "h" in t:
            props.append(f"height: {t['h']}%")
        if "fontSize" in t:
            props.append(f"font-size: {t['fontSize']}cqw")
        if t.get("fontFamily"):
            props.append(f"font-family: {css_font_value(t['fontFamily'])}")
        if "opacity" in t:
            props.append(f"opacity: {t['opacity']}")
        if "tilt" in t:
            props.append(f"transform: rotate({t['tilt']}deg)")
        if "color" in t and t["color"]:
            props.append(f"color: {t['color']}")
        if "bgColor" in t and t["bgColor"]:
            props.append(f"background: {t['bgColor']} !important")
        # stroke = border (needs a width to render); colour defaults to black
        _sw = t.get("strokeW")
        if _sw is not None:
            try:
                _swf = float(_sw)
            except (TypeError, ValueError):
                _swf = 0.0
            if _swf > 0:
                props.append("box-sizing: border-box")
                props.append(f"border: {_sw}px solid {t.get('strokeColor') or '#000000'}")
        if "radius" in t:
            props.append(f"border-radius: {t['radius']}px")
            props.append("overflow: hidden")
        if "z" in t:
            props.append("position: relative")
            props.append(f"z-index: {t['z']}")

        # colour also recolours an inline-SVG overlay's shapes (parity with editor)
        if t.get("color"):
            c = t["color"]
            rules.append(f'[data-slot="{slot_name}"] svg [stroke]:not([stroke="none"]) {{ stroke: {c}; }}')
            rules.append(f'[data-slot="{slot_name}"] svg [fill]:not([fill="none"]) {{ fill: {c}; }}')

        # scale → object-fit on the slot element; also emit a child-img rule
        scale_raw = t.get("scale")
        if scale_raw is not None:
            _sk = str(scale_raw).lower()
            fit = _SCALE_TO_OBJECT_FIT.get(_sk, "cover")
            _extra = _SCALE_EXTRA_CSS.get(_sk, [])
            props.append(f"object-fit: {fit}")
            props.extend(_extra)
            # For image zones the actual <img> is a child — add a separate rule.
            # Mirror the editor, which sets objectFit + aspectRatio on BOTH the zone
            # and the inner <img> (preview_editor.py applyToSlide 'scale').
            img_sel = f'[data-slot="{slot_name}"] img'
            _img_props = "; ".join([f"object-fit: {fit}", *_extra])
            rules.append(f'{img_sel} {{ {_img_props}; }}')

        if props:
            sel = f'[data-slot="{slot_name}"]'
            rules.append(f"{sel} {{ {'; '.join(props)}; }}")

    return "\n".join(rules)


def apply_tweaks(processed: dict, slide_tweaks: dict) -> dict:
    """Merge text overrides from *slide_tweaks* into *processed* in-place.

    Only entries that have a ``"text"`` key are applied; CSS-only entries are
    left to :func:`_build_tweaks_css`.  The ``global`` key is skipped.

    Returns *processed* (mutated in place for efficiency; caller may ignore
    the return value). See :func:`text_tweak_keys` for the set of slots that
    received a text override — those must render RAW (the editor applied them
    as ``innerHTML``), passed to :func:`fill` as ``raw_keys``.
    """
    for slot_name, t in slide_tweaks.items():
        if slot_name == "global":
            continue
        if slot_name.startswith("__"):
            continue  # reserved non-slot metadata (e.g. __texture)
        if not isinstance(t, dict):
            continue
        if "text" in t:
            processed[slot_name] = t["text"]
    return processed


def text_tweak_keys(slide_tweaks: dict) -> set:
    """Slot names that carry a user ``text`` override in *slide_tweaks*.

    These are the keys the editor set via ``el.innerHTML = value``; the bake
    must render them RAW (not HTML-escaped) so ``<mark>``/``<br>`` match the live
    preview exactly. Skips ``global`` and ``__``-prefixed metadata keys."""
    keys: set = set()
    for slot_name, t in slide_tweaks.items():
        if slot_name == "global" or slot_name.startswith("__"):
            continue
        if isinstance(t, dict) and "text" in t:
            keys.add(slot_name)
    return keys


def apply_global_tweaks(brand_kit: dict, global_tweaks: dict) -> dict:
    """Return a shallow-patched *copy* of *brand_kit* with global tweaks applied.

    Recognised keys in *global_tweaks*:
    - ``"accent"``       → ``brand_kit["colors"]["accent"]``
    - ``"fontDisplay"``  → ``brand_kit["fonts"]["display"]["family"]``
    - ``"fontBody"``     → ``brand_kit["fonts"]["body"]["family"]``
    - ``"masthead"``     → ``brand_kit["masthead"]`` (data key, not CSS var)

    All other keys are silently ignored (forward-compat).
    The original *brand_kit* is **never mutated** (Pitfall 4 guard).
    """
    import copy as _copy
    kit = _copy.deepcopy(brand_kit)

    accent = global_tweaks.get("accent")
    if accent is not None:
        kit.setdefault("colors", {})["accent"] = accent

    font_display = global_tweaks.get("fontDisplay")
    if font_display is not None:
        kit.setdefault("fonts", {}).setdefault("display", {})["family"] = font_display

    font_body = global_tweaks.get("fontBody")
    if font_body is not None:
        kit.setdefault("fonts", {}).setdefault("body", {})["family"] = font_body

    masthead = global_tweaks.get("masthead")
    if masthead is not None:
        kit["masthead"] = masthead

    return kit


if __name__ == "__main__":
    main()

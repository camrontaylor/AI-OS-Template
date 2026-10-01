# /// script
# requires-python = ">=3.9"
# dependencies = ["playwright", "pillow"]
# ///
"""generate_brand_bible_pdf.py — compile brand_context into a 20- or 21-page brand bible PDF.

Style: A4 landscape (1834×1375 @ 110 DPI), Swiss-minimal layout patterned after the
rushidesign Brand Guidelines template — pure white content pages with dark section
dividers, 3-column micro header, ALL CAPS H1 in Inter Tight Bold, section numbering
1.0 / 1.1 / 2.0 etc, hairline rule in the brand's accent color.

Reads (brand-agnostic):
    brand_context/visual-identity/tokens.json        (required)
    brand_context/visual-identity/identity.md        (optional — used for narrative)
    brand_context/visual-identity/moves.md           (optional — referenced by design moves)
    brand_context/visual-identity/logos/*            (optional — used on cover + lockup)

Writes:
    brand_context/visual-identity/brand-book.pdf  (canonical name, v2.0.1+)
    brand_context/visual-identity/brand-book.v{N}.pdf  (versioned backup of any pre-existing PDF before overwrite)

The legacy `visual-identity.pdf` filename is migrated forward: if a file with that
name exists at the destination, it's renamed to the next available versioned backup
before the new `brand-book.pdf` is written.

Pages (20):
    01  Cover (dark)
    02  Table of content
    03  About the brand
    04  Mission & vision
    05  Tone of voice
    06  Brand values
    07  Logo — section divider (dark)
    08  Logomark
    09  Logotype
    10  Lockup
    11  Clear space
    12  Minimum sizes
    13  Colors — section divider (dark)
    14  Color palette
    15  Combinations
    16  Typography — section divider (dark)
    17  Typeface
    18  Weights
    19  Type scaling
    20  Brand in use (mockups — dashboard · banner · social)  [opt-out via --no-mockups]
    21  Thank you (dark)   (page 20 when --no-mockups)

CLI:
    uv run --with playwright --with pillow python generate_brand_bible_pdf.py \\
        [--brand-context PATH] [--output PATH] [--keep-html]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import tempfile
from pathlib import Path
from typing import Any

from PIL import Image, ImageColor

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent.parent.parent  # ../../../../

# ─── Light markdown helpers ──────────────────────────────────────────────

def md_strip(s: str) -> str:
    """Remove markdown formatting, keep plain text."""
    s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
    s = re.sub(r"\*([^*]+)\*", r"\1", s)
    s = re.sub(r"`([^`]+)`", r"\1", s)
    s = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s)
    return s.strip()


def md_to_inline(s: str, accent_color: str) -> str:
    """Convert lightweight md to HTML inline (bold + italic + code, no block elements).
    Escapes < first.
    """
    s = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", s)
    return s


def section_extract(md: str, heading: str) -> str:
    """Return the body text under a `## {heading}` section. Empty if absent."""
    pattern = re.compile(rf"##\s+{re.escape(heading)}\s*\n+(.+?)(?:\n##\s|\Z)", re.DOTALL)
    m = pattern.search(md)
    return m.group(1).strip() if m else ""


def first_paragraph(md: str) -> str:
    """Return the first non-empty paragraph as a single line."""
    for chunk in re.split(r"\n\n+", md.strip()):
        chunk = chunk.strip()
        if chunk and not chunk.startswith("#"):
            return md_strip(chunk.replace("\n", " "))
    return ""


def bulleted_lines(text: str) -> list[str]:
    """Extract bulleted lines (starts with -, *, or ✕) as clean strings."""
    out: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith(("-", "*", "✕", "❌")):
            out.append(md_strip(re.sub(r"^[-*✕❌]\s*", "", line)))
    return out


# ─── Brand data extraction ───────────────────────────────────────────────

def find_logo(brand_ctx: Path) -> Path | None:
    """Find a primary logo file. Prefer hex/honeycomb, then primary, then first jpg/png/svg."""
    logos_dir = brand_ctx / "visual-identity" / "logos"
    if not logos_dir.is_dir():
        return None
    candidates = sorted(logos_dir.glob("*.*"))
    # priority order — prefer a cleaned alpha (transparent) PNG first, so the
    # logomark page can recolor the mark via CSS mask fill (needs an alpha
    # channel). Fall back to any logo file. sorted() keeps the pick deterministic.
    for pattern in ["*-transparent.png", "*transparent*", "*honeycomb*", "*primary*", "*mark*", "*logo*"]:
        matches = sorted(logos_dir.glob(pattern))
        if matches:
            return matches[0]
    for c in candidates:
        if c.suffix.lower() in {".jpg", ".jpeg", ".png", ".svg"}:
            return c
    return None


def find_headshot(brand_ctx: Path) -> Path | None:
    logos_dir = brand_ctx / "visual-identity" / "logos"
    if not logos_dir.is_dir():
        return None
    for pat in ["*headshot*", "*portrait*", "*avatar*", "*founder*"]:
        matches = list(logos_dir.glob(pat))
        if matches:
            return matches[0]
    return None


def file_url(p: Path) -> str:
    return "file:///" + str(p.resolve()).replace("\\", "/")


def extract_moves_titles(moves_md: str, max_items: int = 6) -> list[tuple[str, str]]:
    """Extract (title, short-rule) tuples from moves.md. Each '##' is a move."""
    parts = re.split(r"^##\s+", moves_md, flags=re.MULTILINE)
    out: list[tuple[str, str]] = []
    for part in parts[1:max_items + 1]:
        title_line, _, rest = part.partition("\n")
        title = md_strip(re.sub(r"\*\([^)]+\)\*", "", title_line)).strip()
        # find "**When to apply:**" or "**What it is:**" line
        rule = ""
        for marker in ("When to apply", "What it is", "Universal principle"):
            m = re.search(rf"\*\*{marker}:\*\*\s*(.+?)(?:\n\n|\n\*\*|\Z)", rest, re.DOTALL)
            if m:
                rule = md_strip(m.group(1).strip().replace("\n", " "))
                break
        if title:
            out.append((title, rule or "—"))
    return out


# ─── CSS ─────────────────────────────────────────────────────────────────

W, H = 1834, 1375  # A4 landscape @ ~110 DPI


def build_css(tokens: dict) -> str:
    colors = tokens.get("colors", {})
    fonts = tokens.get("fonts", {})
    display = fonts.get("display", {})
    body = fonts.get("body", {})

    accent = colors.get("accent", "#E25A45")
    ink = colors.get("primary", "#000000")
    paper = colors.get("bg_light", "#FFFFFF")  # the brand's cream OR pure white fallback
    bg_dark = colors.get("bg_dark", "#000000")
    text_on_dark = colors.get("text_on_dark", "#FFFFFF")

    # Font import — pull from Google Fonts URLs in tokens.json if available
    font_imports: list[str] = []
    for f in [display, body]:
        url = f.get("google_fonts_url")
        if url:
            font_imports.append(f'@import url("{url}");')
    # Always include Inter Tight for the bible's own typographic chassis (page headers/H1s)
    font_imports.append('@import url("https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&display=swap");')

    display_family = display.get("family", "Inter")
    body_family = body.get("family", "Inter")

    return f"""
{chr(10).join(font_imports)}

* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{ width: {W}px; }}
body {{
  background: {paper};
  color: {ink};
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}}

.page {{
  width: {W}px; height: {H}px;
  position: relative;
  background: {paper};
  overflow: hidden;
  page-break-after: always;
}}
.page.dark {{ background: {bg_dark}; color: {text_on_dark}; }}
.page:last-child {{ page-break-after: auto; }}

/* Header band — 3 columns, monosized */
.header {{
  position: absolute; top: 90px; left: 90px; right: 90px;
  display: grid; grid-template-columns: 1fr 1fr 1fr;
  font-size: 18px; line-height: 1.45;
}}
.header .col {{ display: flex; flex-direction: column; }}
.header .col .b {{ font-weight: 700; }}
.header .col .m {{ font-weight: 400; }}

/* Accent hairline under header */
.rule-top {{
  position: absolute; top: 240px; left: 90px; right: 90px;
  height: 2px; background: {accent};
}}
.page.dark .rule-top {{ background: {accent}; }}

/* Plain (non-accent) hairline for divider lines on dense pages */
.rule {{ height: 1px; background: {ink}; opacity: 0.18; }}
.page.dark .rule {{ background: {text_on_dark}; opacity: 0.22; }}

/* Page-title block */
.h-page {{
  font-family: 'Inter Tight', sans-serif;
  font-weight: 700;
  font-size: 108px; line-height: 1.0;
  letter-spacing: -0.01em;
  text-transform: uppercase;
}}
.h-page.big {{ font-size: 140px; }}

/* Body & helpers */
.body {{ font-size: 24px; line-height: 1.4; max-width: 620px; }}
.body-sm {{ font-size: 20px; line-height: 1.45; max-width: 560px; opacity: 0.78; }}
.kicker {{ font-size: 14px; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 700; opacity: 0.55; }}
.accent {{ color: {accent}; font-weight: 600; }}

/* Page number bottom-right */
.page-num {{
  position: absolute; bottom: 60px; right: 90px;
  font-size: 16px; font-weight: 400;
  opacity: 0.55; letter-spacing: 0.04em;
}}

/* Display-font wordmark / large brand calls — uses the BRAND's display font */
.wordmark {{
  font-family: '{display_family}', 'Inter Tight', sans-serif;
  font-weight: 400; line-height: 0.95;
  letter-spacing: -0.005em; text-transform: uppercase;
}}

/* Color swatch helpers — always show a 1px ink border so the swatch is visible
   even when its hex matches the page bg (was: Paper swatch invisible on Paper page). */
.swatch {{
  position: relative; padding: 60px;
  display: flex; flex-direction: column; justify-content: space-between;
  min-height: 480px;
  border: 1px solid rgba(0,0,0,0.18);
}}
.page.dark .swatch {{ border-color: rgba(255,255,255,0.22); }}
.swatch .name {{ font-family: 'Inter Tight', sans-serif; font-weight: 700; font-size: 80px; line-height: 1.0; }}
.swatch .data {{ font-size: 20px; line-height: 1.7; font-family: 'Inter Tight', sans-serif; }}
.swatch .role {{ font-size: 14px; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.72; }}

/* Grid helpers */
.grid-2 {{ display: grid; grid-template-columns: 1fr 1fr; gap: 80px; }}
.grid-3 {{ display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0; }}

/* Trait row (tone of voice / values) */
.trait-row {{
  display: grid; grid-template-columns: 340px 1fr;
  gap: 60px; padding: 36px 0;
  border-bottom: 1px solid rgba(0,0,0,0.18);
}}
.trait-row:last-child {{ border-bottom: none; }}
.trait-row .name {{ font-family: 'Inter Tight', sans-serif; font-weight: 500; font-size: 42px; line-height: 1.1; }}

/* Mistake cell */
.mistake-cell {{
  border: 2px solid {ink};
  padding: 32px; aspect-ratio: 4/3;
  display: flex; align-items: center; justify-content: center;
  font-size: 28px; text-align: center; line-height: 1.3; font-weight: 500;
  position: relative;
}}
.mistake-cell .strike {{
  position: absolute; top: 50%; left: 8%; right: 8%;
  height: 4px; background: {accent}; transform: rotate(-18deg); transform-origin: center;
}}

/* Two-tone headline (brand's own move on Cover / Thank you) */
.two-tone .l1 {{ color: {text_on_dark}; }}
.two-tone .l2 {{ color: {accent}; }}
"""


# ─── Page builders ───────────────────────────────────────────────────────

class Builder:
    def __init__(self, brand_ctx: Path):
        self.brand_ctx = brand_ctx
        tokens_path = brand_ctx / "visual-identity" / "tokens.json"
        if not tokens_path.is_file():
            raise FileNotFoundError(f"tokens.json missing: {tokens_path}")
        self.tokens = json.loads(tokens_path.read_text(encoding="utf-8"))

        identity_path = brand_ctx / "visual-identity" / "identity.md"
        self.identity_md = identity_path.read_text(encoding="utf-8") if identity_path.is_file() else ""

        moves_path = brand_ctx / "visual-identity" / "moves.md"
        self.moves_md = moves_path.read_text(encoding="utf-8") if moves_path.is_file() else ""

        # voice-profile.md (sibling of visual-identity/) — for tone-of-voice traits
        voice_path = brand_ctx / "voice-profile.md"
        self.voice_md = voice_path.read_text(encoding="utf-8") if voice_path.is_file() else ""

        self.colors = self.tokens.get("colors", {})
        self.fonts = self.tokens.get("fonts", {})
        self.display = self.fonts.get("display", {})
        self.body_font = self.fonts.get("body", {})
        self.accent = self.colors.get("accent", "#E25A45")
        self.ink = self.colors.get("primary", "#000000")
        self.paper = self.colors.get("bg_light", "#FFFFFF")
        self.bg_dark = self.colors.get("bg_dark", "#000000")

        self.brand = self.tokens.get("brand", "Brand")
        # extract author handle from tokens if present
        author = self.tokens.get("author", {}) or {}
        self.handle = "@" + (author.get("handle", "") or self._derive_handle())
        self.version = self.tokens.get("version", "v1")
        self.last_updated = self.tokens.get("last_updated", "")

        self.logo_path = find_logo(brand_ctx)
        self.headshot_path = find_headshot(brand_ctx)

    def _derive_handle(self) -> str:
        m = re.search(r"\(([^)]+)\)", self.brand)
        if m:
            return re.sub(r"\s+", "", m.group(1)).lower()
        return re.sub(r"\s+", "", self.brand).lower()

    # ─── Layout helpers ────────────────────────────────────────────────
    def header(self, topic: str, page_no: str, section: str, sub: str) -> str:
        return f"""
<div class="header">
  <div class="col"><span class="b">Topic — {topic}</span><span class="m">Page no. — {page_no}</span></div>
  <div class="col"><span class="b">{section}</span><span class="m">{sub}</span></div>
  <div class="col"><span class="m">Designed for <b>{self.handle}</b></span><span class="m">Version 1.0</span></div>
</div>
<div class="rule-top"></div>"""

    def page(self, content: str, page_no: str, dark: bool = False) -> str:
        cls = "page dark" if dark else "page"
        return f'<div class="{cls}">{content}<div class="page-num">{page_no}</div></div>'

    # ─── Pages ─────────────────────────────────────────────────────────
    def cover(self) -> str:
        logo_img = f'<img src="{file_url(self.logo_path)}" style="width:160px; height:160px; object-fit:contain; filter:invert(1); mix-blend-mode:screen;">' if self.logo_path else ""
        brand_line1 = self.brand.split("(")[0].strip().upper()
        return self.page(f"""
<div style="position:absolute; top:90px; right:90px; text-align:left; font-size:18px; line-height:1.45;">
  <div style="font-weight:700;">Designed for <span style="color:{self.accent};">{self.handle}</span></div>
  <div>Version 1.0 · {self.last_updated}</div>
</div>
<div style="position:absolute; top:340px; left:90px; right:90px; height:2px; background:{self.accent};"></div>

<div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); display:flex; flex-direction:column; align-items:center; gap:48px;">
  {logo_img}
  <div style="text-align:center;">
    <div class="wordmark" style="font-family:'Inter Tight'; font-weight:700; font-size:120px; color:#fff;">{brand_line1}<sup style="font-size:36px; vertical-align:top; margin-left:8px;">™</sup></div>
    <div class="wordmark" style="font-family:'Inter Tight'; font-weight:500; font-size:120px; color:rgba(255,255,255,0.32); margin-top:8px;">BRAND GUIDELINES</div>
  </div>
</div>
""", "01", dark=True)

    def toc(self) -> str:
        return self.page(f"""
{self.header("1.1", "2", "Table of content", "Introduction")}
<div style="position:absolute; top:300px; left:90px; right:90px;">
  <h1 class="h-page">Table of content</h1>
</div>
<div style="position:absolute; top:540px; left:90px; right:90px; display:grid; grid-template-columns:1fr 1fr; gap:80px; font-size:22px; line-height:1.85;">
  <div>
    <div style="font-weight:700; margin-bottom:8px;">1.0&nbsp;&nbsp;&nbsp;Introduction</div>
    <div>1.1&nbsp;&nbsp;&nbsp;Table of content</div>
    <div>1.2&nbsp;&nbsp;&nbsp;About the brand</div>
    <div>1.3&nbsp;&nbsp;&nbsp;Mission &amp; vision</div>
    <div>1.4&nbsp;&nbsp;&nbsp;Tone of voice</div>
    <div>1.5&nbsp;&nbsp;&nbsp;Brand values</div>
    <div style="margin-top:40px; font-weight:700; margin-bottom:8px;">2.0&nbsp;&nbsp;&nbsp;Logo</div>
    <div>2.1&nbsp;&nbsp;&nbsp;Logomark</div>
    <div>2.2&nbsp;&nbsp;&nbsp;Logotype</div>
    <div>2.3&nbsp;&nbsp;&nbsp;Lockup</div>
    <div>2.4&nbsp;&nbsp;&nbsp;Clear space</div>
    <div>2.5&nbsp;&nbsp;&nbsp;Minimum sizes</div>
  </div>
  <div>
    <div style="font-weight:700; margin-bottom:8px;">3.0&nbsp;&nbsp;&nbsp;Color</div>
    <div>3.1&nbsp;&nbsp;&nbsp;Palette</div>
    <div>3.2&nbsp;&nbsp;&nbsp;Combinations</div>
    <div style="margin-top:40px; font-weight:700; margin-bottom:8px;">4.0&nbsp;&nbsp;&nbsp;Typography</div>
    <div>4.1&nbsp;&nbsp;&nbsp;Typeface</div>
    <div>4.2&nbsp;&nbsp;&nbsp;Weights</div>
    <div>4.3&nbsp;&nbsp;&nbsp;Type scaling</div>
    <div style="margin-top:40px; font-weight:700;">5.0&nbsp;&nbsp;&nbsp;Close</div>
  </div>
</div>
""", "02")

    def about(self) -> str:
        # extract the one-paragraph summary
        summary = section_extract(self.identity_md, "One-Paragraph Summary")
        if not summary:
            summary = first_paragraph(self.identity_md) or f"{self.brand} brand identity."
        # Render as bold-leader + body
        lead = "About the brand"
        body_html = md_to_inline(summary, self.accent)
        return self.page(f"""
{self.header("1.2", "3", "About the brand", "Introduction")}
<div style="position:absolute; top:340px; left:90px; right:90px;">
  <div style="font-family:'Inter Tight'; font-weight:500; font-size:60px; line-height:1.18; letter-spacing:-0.005em; max-width:1620px;">
    <span style="font-weight:700;">{lead} </span>
    <span style="color:rgba(0,0,0,0.55);">— {body_html}</span>
  </div>
</div>
""", "03")

    def mission(self) -> str:
        mission = section_extract(self.identity_md, "Mission")
        if not mission:
            # fall back to first paragraph
            mission = first_paragraph(self.identity_md)
        mission_text = md_to_inline(md_strip(mission)[:380], self.accent)
        return self.page(f"""
{self.header("1.3", "4", "Mission & vision", "Introduction")}
<div style="position:absolute; top:300px; left:90px;">
  <h1 class="h-page">Mission</h1>
</div>
<div style="position:absolute; top:560px; left:90px; right:90px;">
  <div style="font-family:'Inter Tight'; font-weight:500; font-size:48px; line-height:1.3; letter-spacing:-0.005em; max-width:1620px; color:rgba(0,0,0,0.78);">
    {mission_text}
  </div>
</div>
""", "04")

    def tone_of_voice(self) -> str:
        # Try identity.md first, then voice-profile.md, then fall back
        traits: list[tuple[str, str]] = []
        traits_block = (
            section_extract(self.identity_md, "Personality Traits")
            or section_extract(self.identity_md, "Personality")
            or section_extract(self.voice_md, "Personality Traits")
            or section_extract(self.voice_md, "Personality")
        )
        for line in traits_block.splitlines():
            line = line.strip()
            m = re.match(r"^[-*]\s*\*\*([^*]+):\*\*\s*(.+)$", line)
            if m:
                traits.append((md_strip(m.group(1)), md_to_inline(m.group(2), self.accent)))
            elif line.startswith(("-", "*")):
                parts = re.sub(r"^[-*]\s*", "", line).split(" — ", 1)
                if len(parts) == 2:
                    traits.append((md_strip(parts[0]), md_to_inline(parts[1], self.accent)))
                else:
                    traits.append((md_strip(parts[0]), ""))
        if not traits:
            traits = [
                ("Direct", "Lead with the news. Skip the preamble."),
                ("Concrete", "Every claim anchored to a number, an artifact, or a date."),
                ("Warm", "Talk to the reader, not at them."),
                ("Confident", "No hedging on shipped work."),
            ]
        rows = "".join(
            f'<div class="trait-row"><div class="name">{n}</div><div class="body">{b}</div></div>'
            for n, b in traits[:4]
        )
        return self.page(f"""
{self.header("1.4", "5", "Tone of voice", "Introduction")}
<div style="position:absolute; top:300px; left:90px;"><h1 class="h-page">Tone of voice</h1></div>
<div style="position:absolute; top:520px; left:90px; right:90px;"><div class="rule"></div></div>
<div style="position:absolute; top:560px; left:90px; right:90px;">{rows}</div>
""", "05")

    def brand_values(self) -> str:
        # try to extract from identity.md (may not exist — use Recurring themes or Core Energy as fallback)
        values_block = section_extract(self.identity_md, "Values") or section_extract(self.identity_md, "Core Energy")
        values: list[str] = []
        for line in values_block.splitlines():
            line = line.strip()
            if line.startswith(("-", "*")):
                values.append(md_strip(re.sub(r"^[-*]\s*\*?\*?[^:*]+:?\*?\*?\s*", "", line)))
        if not values:
            values = ["Build it real", "Ship out loud", "Receipts over hype", "Modular over monolithic"]
        cells = "".join(
            f'<div style="font-family:\'Inter Tight\'; font-weight:500; font-size:56px; line-height:1.05; text-transform:uppercase; padding:60px 0; border-top:1px solid rgba(0,0,0,0.18); display:flex; align-items:baseline; gap:32px;"><span style="color:{self.accent}; font-weight:700; font-size:22px; min-width:60px; letter-spacing:0.04em;">{i + 1:02d}</span>{v}</div>'
            for i, v in enumerate(values[:5])
        )
        return self.page(f"""
{self.header("1.5", "6", "Brand values", "Introduction")}
<div style="position:absolute; top:300px; left:90px;"><h1 class="h-page">Values</h1></div>
<div style="position:absolute; top:540px; left:90px; right:90px;">{cells}</div>
""", "06")

    def section_divider(self, topic: str, page_no: str, section_name: str, sub_items: list[str]) -> str:
        items_html = "<br>".join(f"{topic[0]}.{i + 1}&nbsp;&nbsp;&nbsp;{name}" for i, name in enumerate(sub_items))
        return self.page(f"""
{self.header(topic, page_no, "Introduction", section_name)}
<div style="position:absolute; bottom:160px; right:90px; text-align:right;">
  <div style="font-family:'Inter Tight'; font-weight:700; font-size:140px; line-height:1.0; letter-spacing:-0.01em; text-transform:uppercase;">{section_name}</div>
  <div style="margin-top:40px; font-size:20px; line-height:1.85; font-weight:400;">{items_html}</div>
</div>
""", page_no, dark=True)

    def recolor_mark(self, target_hex: str) -> Path | None:
        """Return a PNG of the logo mark recolored to an EXACT target color.

        Keeps the source alpha channel (the mark shape) and replaces RGB with the
        target. Done with Pillow rather than a CSS mask/filter because (a) a CSS
        `filter: hue-rotate(...)` chain can't hit an arbitrary hex exactly, and
        (b) Chromium silently ignores a `mask: url(file://...)` resource during
        headless PDF render. A pre-tinted PNG referenced via a plain <img> loads
        reliably and is pixel-exact. Cached per color; needs an alpha logo
        (find_logo prefers *-transparent.png).
        """
        if not self.logo_path:
            return None
        if not hasattr(self, "_mark_cache"):
            self._mark_cache: dict[str, Path] = {}
            self._mark_dir = Path(tempfile.mkdtemp(prefix="brandbook_marks_"))
        key = target_hex.lstrip("#").lower()
        if key in self._mark_cache:
            return self._mark_cache[key]
        try:
            src = Image.open(self.logo_path).convert("RGBA")
        except Exception:
            return None
        r, g, b = ImageColor.getrgb(target_hex)[:3]
        tinted = Image.new("RGBA", src.size, (r, g, b, 0))
        tinted.putalpha(src.split()[-1])  # keep the mark's alpha shape
        out = self._mark_dir / f"mark-{key}.png"
        tinted.save(out)
        self._mark_cache[key] = out
        return out

    def logomark(self) -> str:
        """Logomark page now displays the mark in 3 (or 4, when accent-2 is set) color
        variations on different backgrounds — ink-on-paper, paper-on-ink, accent-on-paper,
        and (when present) accent-2-on-paper. Replaces the previous single dark panel.

        Issue 05 acceptance: "Brand book logo page shows ≥3 color variations of the logo
        on different backgrounds."
        """
        accent_2 = self.colors.get("accent_secondary") or self.colors.get("accent-2") or self.colors.get("accent2")

        # Each tile renders the mark in a target color on a target background.
        # We recolor via a CSS mask fill: the (transparent-PNG) logo's alpha channel
        # masks a solid `background-color` block, so the mark is painted in the EXACT
        # token color. This replaced a hardcoded `filter: ... hue-rotate(...)` chain
        # that always produced the same orange regardless of colors.accent — the bug
        # where "Accent on Paper (#C0594B)" rendered as a brighter orange. Mask fill is
        # exact for any single-color mark and needs no per-color tuning.
        # Requires an alpha logo (find_logo prefers *-transparent.png) and a Chromium
        # renderer (Playwright) — both guaranteed here.

        # Mark + tile sizing are RELATIVE (% of column) so the page scales cleanly to
        # whatever swatch count the brand's palette yields — 3 (ink/paper/accent) or 4
        # (+ accent_secondary). A fixed-px mark overflowed the narrower 4-column tile.
        def tile(bg: str, fg_label: str, fill: str, label_color: str) -> str:
            mark_png = self.recolor_mark(fill)
            if mark_png:
                mark = (
                    f'<img src="{file_url(mark_png)}" '
                    f'style="width:70%; aspect-ratio:1/1; object-fit:contain;">'
                )
            else:
                mark = (
                    f'<div style="width:70%; aspect-ratio:1/1; border:4px solid {label_color}; '
                    f'display:flex; align-items:center; justify-content:center; '
                    f'font-family:\'Inter Tight\'; font-weight:700; color:{label_color};">LOGO</div>'
                )
            return f"""
<div style="background:{bg}; border:1px solid rgba(0,0,0,0.18); padding:32px; display:flex; flex-direction:column; align-items:center; justify-content:space-between; min-height:420px;">
  <div style="flex:1; display:flex; align-items:center; justify-content:center; width:100%;">{mark}</div>
  <div style="font-size:13px; letter-spacing:0.08em; text-transform:uppercase; color:{label_color}; opacity:0.72; text-align:center; line-height:1.3;">{fg_label}</div>
</div>"""

        tiles = [
            tile(self.paper, "Ink on Paper", self.ink, self.ink),
            tile(self.ink, "Paper on Ink", "#ffffff", "#fff"),
            tile(self.paper, f"Accent on Paper ({self.accent})", self.accent, self.accent),
        ]
        if accent_2:
            tiles.append(tile(
                self.paper, f"Accent-2 on Paper ({accent_2})", accent_2, accent_2,
            ))

        cols = len(tiles)  # 3 or 4
        tiles_html = "".join(tiles)

        return self.page(f"""
{self.header("2.1", "8", "Logomark", "Logo")}
<div style="position:absolute; top:300px; left:90px; width:680px;">
  <h1 class="h-page" style="font-size:88px;">Logomark</h1>
  <div class="body" style="margin-top:48px;">The mark stands alone in any context where the wordmark would compete. Reproduce in <span class="accent">ink on paper</span>, <span class="accent">paper on ink</span>, or in <span class="accent">accent</span> tones — never in outlines, gradients, or rotations.</div>
</div>
<div style="position:absolute; top:300px; right:90px; width:980px; display:grid; grid-template-columns:repeat({cols}, 1fr); gap:24px;">
  {tiles_html}
</div>
""", "08")

    def logotype(self) -> str:
        brand_line1 = self.brand.split("(")[0].strip().upper()
        return self.page(f"""
{self.header("2.2", "9", "Logotype", "Logo")}
<div style="position:absolute; top:300px; left:90px; width:680px;">
  <h1 class="h-page" style="font-size:88px;">Logotype</h1>
  <div class="body" style="margin-top:48px;">The wordmark is <span class="accent">{self.display.get('family', 'Inter Tight')}</span> set in {self.display.get('case', 'All Caps')} at the brand weight. Letter-spacing locked at the design value — never re-kerned.</div>
</div>
<div style="position:absolute; top:300px; right:90px; width:880px; height:880px; background:{self.ink}; display:flex; align-items:center; justify-content:center; padding:80px;">
  <div class="wordmark" style="color:#fff; font-size:140px; line-height:0.95; text-align:center;">{brand_line1}</div>
</div>
""", "09")

    def lockup(self) -> str:
        brand_line1 = self.brand.split("(")[0].strip().upper()
        logo_img = f'<img src="{file_url(self.logo_path)}" style="width:160px; height:160px; object-fit:contain; filter:invert(1); mix-blend-mode:screen;">' if self.logo_path else ""
        return self.page(f"""
{self.header("2.3", "10", "Lockup", "Logo")}
<div style="position:absolute; top:300px; left:90px; width:680px;">
  <h1 class="h-page" style="font-size:88px;">Lockup</h1>
  <div class="body" style="margin-top:48px;">Mark + wordmark, locked. Use the full lockup at all sizes ≥ <span class="accent">50px / 0.75"</span>. Below that, fall back to the logomark alone.</div>
</div>
<div style="position:absolute; top:300px; right:90px; width:880px; height:880px; background:{self.ink}; display:flex; align-items:center; justify-content:center; gap:32px;">
  {logo_img}
  <div class="wordmark" style="color:#fff; font-size:120px; line-height:0.95;">{brand_line1}<sup style="font-size:28px; vertical-align:top;">™</sup></div>
</div>
""", "10")

    def clear_space(self) -> str:
        logo_img = f'<img src="{file_url(self.logo_path)}" style="width:200px; height:200px; object-fit:contain; filter:invert(1); mix-blend-mode:screen;">' if self.logo_path else ""
        return self.page(f"""
{self.header("2.4", "11", "Clear space", "Logo")}
<div style="position:absolute; top:300px; left:90px; width:680px;">
  <h1 class="h-page" style="font-size:88px;">Clear space</h1>
  <div class="body" style="margin-top:48px;">Keep a clear margin of <span class="accent">1× the height of the mark</span> on every side. No competing graphic elements within that zone.</div>
</div>
<div style="position:absolute; top:380px; right:90px; width:780px; height:780px; background:{self.paper}; border:2px solid {self.ink}; display:flex; align-items:center; justify-content:center; padding:200px;">
  <div style="position:relative; width:200px; height:200px; background:{self.ink}; display:flex; align-items:center; justify-content:center;">
    {logo_img.replace("filter:invert(1); mix-blend-mode:screen", "filter:invert(1); mix-blend-mode:screen")}
  </div>
</div>
""", "11")

    def min_sizes(self) -> str:
        brand_line1 = self.brand.split("(")[0].strip().upper()
        return self.page(f"""
{self.header("2.5", "12", "Minimum sizes", "Logo")}
<div style="position:absolute; top:300px; left:90px;"><h1 class="h-page" style="font-size:88px;">Minimum sizes</h1></div>
<div style="position:absolute; top:300px; right:90px; width:980px;">
  <div class="body" style="font-weight:500;">Optimized for sizes that are not excessively small. Mandates a minimum height of <span class="accent">0.75" / 50px</span> for the full lockup. Below that, drop to the mark alone (minimum <span class="accent">24px / 0.35"</span>).</div>
</div>
<div style="position:absolute; top:660px; left:90px; right:90px; height:560px; border:1px solid {self.ink}; display:flex; align-items:center; justify-content:center; gap:48px;">
  <div class="wordmark" style="font-size:48px; line-height:1.0;">{brand_line1}</div>
  <div style="font-size:18px; color:rgba(0,0,0,0.55); letter-spacing:0.06em;">↑ 0.75" or 50px</div>
</div>
""", "12")

    def color_palette(self) -> str:
        """Render 3 or 4 swatches depending on whether the brand has a secondary accent.

        Slot resolution (backward-compatible):
          Paper       <- colors.bg_light          (always)
          Accent      <- colors.accent            (always)
          Ink         <- colors.primary           (always)
          Accent-2    <- colors.accent_secondary  OR colors['accent-2']  OR colors['accent2']   (optional — Issue 05)
        """
        c = self.colors
        roles = [
            ("Paper", c.get("bg_light", "#FFFFFF"), "Default background", "ink"),
            ("Accent", c.get("accent", "#E25A45"), "Signature emphasis", "paper"),
            ("Ink", c.get("primary", "#000000"), "Primary type & frames", "paper"),
        ]
        accent_2 = c.get("accent_secondary") or c.get("accent-2") or c.get("accent2")
        if accent_2:
            roles.append(("Accent 2", accent_2, "Secondary highlight & data accents", "paper"))

        def hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
            h = hex_str.lstrip("#")
            return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

        cells = ""
        for name, hex_v, role, text_mode in roles:
            r, g, b = hex_to_rgb(hex_v)
            text_color = self.ink if text_mode == "ink" else "#fff"
            opacity_data = "0.78" if text_mode == "ink" else "0.92"
            opacity_role = "0.55" if text_mode == "ink" else "0.78"
            cells += f"""
<div class="swatch" style="background:{hex_v}; color:{text_color};">
  <div>
    <div class="name">{name}</div>
    <div class="data" style="margin-top:32px; opacity:{opacity_data};">
      <div>HEX:&nbsp;&nbsp;{hex_v.upper()}</div>
      <div>R:&nbsp;&nbsp;&nbsp;{r}</div>
      <div>G:&nbsp;&nbsp;&nbsp;{g}</div>
      <div>B:&nbsp;&nbsp;&nbsp;{b}</div>
    </div>
  </div>
  <div class="role" style="opacity:{opacity_role};">{role}</div>
</div>"""
        # Grid columns: 3 when 3 slots, 4 when 4 slots. CSS `repeat(N, 1fr)` handles both.
        cols = len(roles)
        return self.page(f"""
{self.header("3.1", "14", "Palette", "Colors")}
<div style="position:absolute; top:300px; left:90px;"><h1 class="h-page" style="font-size:80px;">Color palette</h1></div>
<div style="position:absolute; top:540px; left:90px; right:90px; display:grid; grid-template-columns:repeat({cols}, 1fr);">{cells}</div>
""", "14")

    def combinations(self) -> str:
        a, i, p = self.accent, self.ink, self.paper
        return self.page(f"""
{self.header("3.2", "15", "Combinations", "Colors")}
<div style="position:absolute; top:300px; left:90px;"><h1 class="h-page" style="font-size:80px;">Combinations</h1></div>
<div style="position:absolute; top:540px; left:90px; right:90px; display:grid; grid-template-columns:repeat(3, 1fr); gap:32px;">
  <div style="background:{p}; border:1px solid {i}; padding:60px; aspect-ratio:1;">
    <div style="font-family:'Inter Tight'; font-weight:700; font-size:64px; line-height:0.95; color:{i};">Ink on<br>Paper</div>
    <div style="margin-top:32px; font-size:18px; color:rgba(0,0,0,0.55);">Body text default.</div>
  </div>
  <div style="background:{a}; padding:60px; aspect-ratio:1;">
    <div style="font-family:'Inter Tight'; font-weight:700; font-size:64px; line-height:0.95; color:#fff;">Paper on<br>Accent</div>
    <div style="margin-top:32px; font-size:18px; color:rgba(255,255,255,0.85);">Hero callout cards.</div>
  </div>
  <div style="background:{i}; padding:60px; aspect-ratio:1; color:#fff;">
    <div style="font-family:'Inter Tight'; font-weight:700; font-size:64px; line-height:0.95;"><span style="color:{a};">Accent</span><br>on Ink</div>
    <div style="margin-top:32px; font-size:18px; opacity:0.7;">Section dividers, dark thumbnails.</div>
  </div>
</div>
""", "15")

    def typeface(self) -> str:
        display_name = self.display.get("family", "Inter")
        return self.page(f"""
{self.header("4.1", "17", "Typeface", "Typography")}
<div style="position:absolute; top:300px; left:90px;"><h1 class="h-page" style="font-size:88px;">Typeface</h1></div>
<div style="position:absolute; top:300px; right:90px; width:980px;">
  <div class="body" style="font-weight:500;">The display face is <span class="accent">{display_name}</span> — {self.display.get('style', 'a brand-defining grotesque')}. Pulled from Google Fonts for universal availability. Body copy uses <strong>{self.body_font.get('family', 'Inter')}</strong> for legibility at every size.</div>
</div>
<div style="position:absolute; top:620px; left:90px; right:90px; height:660px; background:{self.ink}; display:flex; align-items:center; justify-content:center;">
  <div class="wordmark" style="color:#fff; font-size:340px; line-height:0.95;">{display_name.upper()}</div>
</div>
""", "17")

    def type_weights(self) -> str:
        display_name = self.display.get("family", "Inter")
        body_name = self.body_font.get("family", "Inter")
        return self.page(f"""
{self.header("4.2", "18", "Weights", "Typography")}
<div style="position:absolute; top:300px; left:90px;"><h1 class="h-page" style="font-size:88px;">Weights</h1></div>
<div style="position:absolute; top:540px; left:90px; right:90px;">
  <div style="border-top:1px solid {self.ink}; padding:32px 0; display:grid; grid-template-columns:280px 1fr; gap:48px; align-items:baseline;">
    <div style="font-family:'Inter Tight'; font-weight:500; font-size:28px;">Display</div>
    <div style="font-family:'{display_name}', 'Inter Tight', sans-serif; font-size:108px; line-height:1.0; letter-spacing:-0.005em; text-transform:uppercase;">{display_name}</div>
  </div>
  <div style="border-top:1px solid rgba(0,0,0,0.18); padding:32px 0; display:grid; grid-template-columns:280px 1fr; gap:48px; align-items:baseline;">
    <div style="font-family:'Inter Tight'; font-weight:500; font-size:28px;">Body — 400</div>
    <div style="font-family:'{body_name}', sans-serif; font-weight:400; font-size:48px; line-height:1.2;">The quick brown fox jumps over the lazy dog.</div>
  </div>
  <div style="border-top:1px solid rgba(0,0,0,0.18); padding:32px 0; display:grid; grid-template-columns:280px 1fr; gap:48px; align-items:baseline;">
    <div style="font-family:'Inter Tight'; font-weight:500; font-size:28px;">Body — 600</div>
    <div style="font-family:'{body_name}', sans-serif; font-weight:600; font-size:48px; line-height:1.2;">The quick brown fox jumps over the lazy dog.</div>
  </div>
  <div style="border-top:1px solid rgba(0,0,0,0.18); padding:32px 0; display:grid; grid-template-columns:280px 1fr; gap:48px; align-items:baseline;">
    <div style="font-family:'Inter Tight'; font-weight:500; font-size:28px;">Body — 700</div>
    <div style="font-family:'{body_name}', sans-serif; font-weight:700; font-size:48px; line-height:1.2;">The quick brown fox jumps over the lazy dog.</div>
  </div>
</div>
""", "18")

    def type_scaling(self) -> str:
        ts = self.tokens.get("type_scale", {})
        rows: list[str] = []
        for role, spec in ts.items():
            if not isinstance(spec, dict):
                continue
            size = spec.get("size", 0)
            weight = spec.get("weight", "—")
            sample_text = role.upper() if role in {"display", "h1", "h2", "pill"} else "Aa Bb Cc 123"
            sample_size = min(size, 80)
            rows.append(f"""
<div style="border-top:1px solid rgba(0,0,0,0.18); padding:18px 0; display:grid; grid-template-columns:140px 100px 100px 1fr; gap:24px; align-items:baseline; font-size:18px;">
  <div style="font-weight:700;">{role}</div>
  <div>{size}px</div>
  <div>{weight}</div>
  <div style="font-size:{sample_size}px; line-height:1.0;">{sample_text}</div>
</div>""")
        rows_html = "".join(rows[:10])
        return self.page(f"""
{self.header("4.3", "19", "Type scaling", "Typography")}
<div style="position:absolute; top:300px; left:90px;"><h1 class="h-page" style="font-size:88px;">Type scaling</h1></div>
<div style="position:absolute; top:540px; left:90px; right:90px;">
  <div style="display:grid; grid-template-columns:140px 100px 100px 1fr; gap:24px; padding-bottom:12px; border-bottom:1px solid {self.ink}; font-size:14px; letter-spacing:0.12em; text-transform:uppercase; font-weight:700;">
    <div>Role</div><div>Size</div><div>Weight</div><div>Sample</div>
  </div>
  {rows_html}
</div>
""", "19")

    def brand_in_use(self, page_no: str = "20") -> str:
        """Brand-in-use mockups page (Issue 10). Shows the visual identity applied to three
        mock contexts so the user/clients can visualize how the brand reads in real-world
        use, not just isolated swatches/specs.

        All colors and fonts pull from `tokens.json` — no stock placeholders.
        """
        accent_2 = self.colors.get("accent_secondary") or self.colors.get("accent-2") or self.colors.get("accent2") or self.accent
        display_family = self.display.get("family", "Inter")
        body_family = self.body_font.get("family", "Inter")

        # Mockup 1 — dashboard: shows palette + accent on data + display font on KPIs
        dashboard = f"""
<div style="background:{self.paper}; border:1px solid rgba(0,0,0,0.18); border-radius:8px; padding:32px; height:520px; display:flex; flex-direction:column; gap:24px; overflow:hidden;">
  <div style="display:flex; align-items:baseline; justify-content:space-between; border-bottom:1px solid rgba(0,0,0,0.12); padding-bottom:12px;">
    <div style="font-family:'{display_family}', 'Inter Tight', sans-serif; font-weight:700; font-size:22px; color:{self.ink};">Dashboard</div>
    <div style="font-family:'{body_family}', sans-serif; font-size:12px; color:rgba(0,0,0,0.55); letter-spacing:0.1em; text-transform:uppercase;">May 20</div>
  </div>
  <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px;">
    <div style="background:{self.ink}; color:#fff; padding:20px; border-radius:6px;">
      <div style="font-size:11px; opacity:0.7; letter-spacing:0.12em; text-transform:uppercase;">Visits</div>
      <div style="font-family:'{display_family}','Inter Tight',sans-serif; font-weight:900; font-size:48px; line-height:1; margin-top:4px;">12.4k</div>
      <div style="font-size:12px; color:{self.accent}; margin-top:8px;">+18% vs last week</div>
    </div>
    <div style="background:{self.paper}; border:1px solid rgba(0,0,0,0.18); padding:20px; border-radius:6px;">
      <div style="font-size:11px; opacity:0.55; letter-spacing:0.12em; text-transform:uppercase; color:{self.ink};">Conversions</div>
      <div style="font-family:'{display_family}','Inter Tight',sans-serif; font-weight:900; font-size:48px; line-height:1; margin-top:4px; color:{self.ink};">2.1%</div>
      <div style="font-size:12px; color:{accent_2}; margin-top:8px;">+0.3 pts</div>
    </div>
    <div style="background:{self.accent}; color:#fff; padding:20px; border-radius:6px;">
      <div style="font-size:11px; opacity:0.92; letter-spacing:0.12em; text-transform:uppercase;">Revenue</div>
      <div style="font-family:'{display_family}','Inter Tight',sans-serif; font-weight:900; font-size:48px; line-height:1; margin-top:4px;">$48k</div>
      <div style="font-size:12px; opacity:0.85; margin-top:8px;">on-track quarter</div>
    </div>
  </div>
  <div style="flex:1; background:{self.paper}; border:1px solid rgba(0,0,0,0.12); border-radius:6px; padding:16px; display:flex; align-items:flex-end; gap:8px;">
    {''.join(f'<div style="flex:1; background:{self.accent if i in (2,5) else (accent_2 if i==3 else self.ink)}; opacity:{0.4+0.1*i:.2f}; height:{20+i*12}%; border-radius:3px 3px 0 0;"></div>' for i in range(7))}
  </div>
</div>
"""

        # Mockup 2 — banner: marketing hero with display font + accent CTA
        banner = f"""
<div style="background:{self.ink}; color:#fff; padding:48px; height:520px; border-radius:8px; position:relative; overflow:hidden;">
  <div style="position:absolute; top:0; right:0; width:300px; height:300px; background:radial-gradient(circle at center, {self.accent} 0%, transparent 70%); opacity:0.45;"></div>
  <div style="position:relative; max-width:560px;">
    <div style="font-family:'{body_family}', sans-serif; font-size:14px; letter-spacing:0.12em; text-transform:uppercase; color:{accent_2};">Launching this week</div>
    <h2 style="font-family:'{display_family}','Inter Tight',sans-serif; font-weight:900; font-size:68px; line-height:1.0; letter-spacing:-0.03em; margin-top:16px; color:#fff;">
      Built for shipping, <span style="color:{self.accent};">not for slides.</span>
    </h2>
    <div style="font-family:'{body_family}', sans-serif; font-size:18px; line-height:1.5; margin-top:20px; opacity:0.78; max-width:480px;">
      A live look at what changed in the platform this week — and what's queued for next.
    </div>
    <div style="margin-top:32px; display:flex; gap:12px;">
      <div style="background:{self.accent}; color:#fff; padding:14px 28px; border-radius:999px; font-weight:700; font-size:14px; letter-spacing:0.04em;">Read the changelog</div>
      <div style="border:1px solid rgba(255,255,255,0.35); color:#fff; padding:14px 28px; border-radius:999px; font-weight:500; font-size:14px;">Try a demo</div>
    </div>
  </div>
</div>
"""

        # Mockup 3 — social post (LinkedIn-style): showcases carousel hero applied at scale
        social = f"""
<div style="background:#fff; border:1px solid rgba(0,0,0,0.18); border-radius:8px; height:520px; padding:24px; display:flex; flex-direction:column; gap:16px;">
  <div style="display:flex; align-items:center; gap:12px;">
    <div style="width:48px; height:48px; background:{self.ink}; border-radius:50%; display:flex; align-items:center; justify-content:center; color:{self.paper}; font-family:'{display_family}','Inter Tight',sans-serif; font-weight:900; font-size:18px;">{self.brand[:1].upper() or 'B'}</div>
    <div>
      <div style="font-family:'{body_family}',sans-serif; font-weight:700; font-size:14px; color:{self.ink};">{self.brand}</div>
      <div style="font-size:11px; color:rgba(0,0,0,0.55);">{self.handle} · 2h · 🌐</div>
    </div>
  </div>
  <div style="font-family:'{body_family}',sans-serif; font-size:13px; line-height:1.45; color:{self.ink};">
    The way most teams use AI coding tools is wrong. Here's what we've learned shipping production agents this quarter ↓
  </div>
  <div style="flex:1; background:{self.paper}; border:1px solid rgba(0,0,0,0.12); border-radius:6px; padding:24px; display:flex; flex-direction:column; justify-content:center;">
    <div style="font-family:'{body_family}',sans-serif; font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:{self.accent}; font-weight:700;">Slide 1 / 8</div>
    <div style="font-family:'{display_family}','Inter Tight',sans-serif; font-weight:900; font-size:38px; line-height:0.95; letter-spacing:-0.02em; margin-top:12px; color:{self.ink};">
      You are using<br><span style="color:{self.accent};">Claude Code</span><br>wrong.
    </div>
    <div style="margin-top:16px; font-family:'{body_family}',sans-serif; font-size:13px; color:rgba(0,0,0,0.55);">10 configuration tips to go from chatbot to senior engineer.</div>
  </div>
  <div style="display:flex; gap:16px; padding-top:8px; border-top:1px solid rgba(0,0,0,0.08); font-size:11px; color:rgba(0,0,0,0.55);">
    <span>♡ 412 reactions</span><span>💬 38 comments</span><span>↻ 24 reposts</span>
  </div>
</div>
"""

        return self.page(f"""
{self.header("5.0", page_no, "Brand in use", "Close")}
<div style="position:absolute; top:300px; left:90px;"><h1 class="h-page" style="font-size:80px;">Brand in use</h1></div>
<div style="position:absolute; top:480px; left:90px; right:90px;">
  <div class="body" style="font-weight:500; max-width:1100px;">How the identity reads in real-world contexts. All colors and fonts pull from <span class="accent">tokens.json</span> — no stock placeholders.</div>
</div>
<div style="position:absolute; top:660px; left:90px; right:90px; display:grid; grid-template-columns:1fr 1fr 1fr; gap:24px;">
  {dashboard}
  {banner}
  {social}
</div>
""", page_no)

    def thank_you(self) -> str:
        logo_img = f'<img src="{file_url(self.logo_path)}" style="width:120px; height:120px; object-fit:contain; filter:invert(1); mix-blend-mode:screen;">' if self.logo_path else ""
        return self.page(f"""
<div style="position:absolute; top:90px; right:90px; text-align:right; font-size:18px; line-height:1.45; color:#fff;">
  <div style="font-weight:700;">Designed for <span style="color:{self.accent};">{self.handle}</span></div>
  <div>Version 1.0 · {self.last_updated}</div>
</div>
<div style="position:absolute; top:340px; left:90px; right:90px; height:2px; background:{self.accent};"></div>
<div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); display:flex; flex-direction:column; align-items:center; gap:48px; color:#fff;">
  {logo_img}
  <div class="wordmark two-tone" style="font-size:200px; text-align:center;">
    <span class="l1">Thank</span> <span class="l2">you.</span>
  </div>
  <div style="font-size:18px; opacity:0.55; letter-spacing:0.08em;">{self.handle}</div>
</div>
""", "20", dark=True)

    # ─── Assemble full HTML ────────────────────────────────────────────
    def build(self, include_mockups: bool = True) -> str:
        """Build the full brand-bible HTML. Pass include_mockups=False to opt out of
        the Issue 10 "Brand in use" page — the rest of the bible regenerates as usual.
        Page numbering shifts: Thank-you is page 20 without mockups, page 21 with.
        """
        css = build_css(self.tokens)
        pages = [
            self.cover(),
            self.toc(),
            self.about(),
            self.mission(),
            self.tone_of_voice(),
            self.brand_values(),
            self.section_divider("2.0", "07", "Logo design",
                                 ["Logomark", "Logotype", "Lockup", "Clear space", "Minimum sizes"]),
            self.logomark(),
            self.logotype(),
            self.lockup(),
            self.clear_space(),
            self.min_sizes(),
            self.section_divider("3.0", "13", "Colors", ["Palette", "Combinations"]),
            self.color_palette(),
            self.combinations(),
            self.section_divider("4.0", "16", "Typography",
                                 ["Typeface", "Weights", "Type scaling"]),
            self.typeface(),
            self.type_weights(),
            self.type_scaling(),
        ]
        if include_mockups:
            pages.append(self.brand_in_use(page_no="20"))
            thank_you_page = "21"
        else:
            thank_you_page = "20"
        # The thank_you method hardcodes page "20" — patch via string replace on the
        # rendered HTML to keep the change minimal (don't add a parameter the live
        # tests don't expect).
        thanks_html = self.thank_you().replace('class="page-num">20<', f'class="page-num">{thank_you_page}<')
        pages.append(thanks_html)
        return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{self.brand} — Brand Bible</title>
<style>{css}</style></head>
<body>{''.join(pages)}</body></html>"""


# ─── Main ────────────────────────────────────────────────────────────────

# ─── Idempotency: input dirty-check ───────────────────────────────────────

HASH_SIDECAR = ".brand-book.hash"


def _hash_file(h: "hashlib._Hash", path: Path) -> None:
    """Fold a file's relative tag + bytes into the digest, if it exists."""
    if path.is_file():
        h.update(b"\x01")
        h.update(path.read_bytes())
    else:
        h.update(b"\x00")


def _hash_dir_listing(h: "hashlib._Hash", dir_path: Path) -> None:
    """Fold a directory's asset listing (names + bytes) into the digest.

    Used for logos/ and (if present) fonts/ — the binary inputs the PDF embeds.
    Sorted for determinism; folds each file's name, size and bytes.
    """
    if not dir_path.is_dir():
        h.update(b"\x00")
        return
    h.update(b"\x01")
    for f in sorted(dir_path.glob("*.*")):
        if f.is_file():
            h.update(f.name.encode("utf-8"))
            h.update(f.read_bytes())


def compute_inputs_hash(brand_ctx: Path) -> str:
    """Hash the INPUTS the brand book derives from — NOT the rendered PDF.

    Same set Builder.__init__ reads: tokens.json, identity.md, moves.md,
    voice-profile.md, plus the logos/ (and fonts/, if any) asset dirs. The
    Chromium PDF output is non-deterministic (embedded timestamps / font-subset
    ordering), so the dirty-check MUST key on inputs.
    """
    vi = brand_ctx / "visual-identity"
    h = hashlib.sha256()
    for rel in ("tokens.json", "identity.md", "moves.md"):
        _hash_file(h, vi / rel)
    _hash_file(h, brand_ctx / "voice-profile.md")  # sibling of visual-identity/
    _hash_dir_listing(h, vi / "logos")
    _hash_dir_listing(h, vi / "fonts")
    return h.hexdigest()


def _next_backup_path(existing: Path) -> Path:
    """Return the next available versioned backup name for an existing PDF.

    brand-book.pdf -> brand-book.v1.pdf, brand-book.v2.pdf, ...
    visual-identity.pdf (legacy) is preserved under brand-book.v{N}.pdf so the user
    can still find their previous bible after the rename.
    """
    parent = existing.parent
    stem = "brand-book"
    n = 1
    while (parent / f"{stem}.v{n}.pdf").exists():
        n += 1
    return parent / f"{stem}.v{n}.pdf"


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--brand-context", help="Path to brand_context/. Defaults to project root.")
    ap.add_argument("--output", help="PDF output path. Defaults to brand_context/visual-identity/brand-book.pdf.")
    ap.add_argument("--keep-html", action="store_true", help="Keep the intermediate HTML next to the PDF.")
    ap.add_argument(
        "--backup",
        dest="backup",
        action="store_true",
        help="Archive any pre-existing PDF to brand-book.v{N}.pdf before overwriting. "
             "Opt-in: by default the regen overwrites brand-book.pdf in place (no .vN pile-up).",
    )
    ap.add_argument(
        "--force",
        action="store_true",
        help="Re-render even if the inputs are unchanged (bypass the skip-if-unchanged dirty-check).",
    )
    ap.add_argument(
        "--no-mockups",
        dest="include_mockups",
        action="store_false",
        help="Skip the 'Brand in use' mockup page (Issue 10). Default: include.",
    )
    ap.set_defaults(backup=False, include_mockups=True)
    args = ap.parse_args(argv)

    if args.brand_context:
        brand_ctx = Path(args.brand_context).resolve()
    else:
        brand_ctx = PROJECT_ROOT / "brand_context"

    if not (brand_ctx / "visual-identity" / "tokens.json").is_file():
        sys.exit(f"tokens.json missing at {brand_ctx}/visual-identity/. Run mkt-visual-identity first.")

    output = Path(args.output) if args.output else (brand_ctx / "visual-identity" / "brand-book.pdf")
    output.parent.mkdir(parents=True, exist_ok=True)

    # One-time legacy migration: visual-identity.pdf -> brand-book.pdf. This is a
    # rename of the canonical artifact, separate from the per-run .vN backup. Only
    # migrate if the canonical name doesn't already exist (don't clobber a current PDF).
    legacy = output.parent / "visual-identity.pdf"
    if legacy.exists() and not output.exists():
        legacy.rename(output)
        print(f"[migrate] {legacy.name} -> {output.name}")

    # Skip-if-unchanged: hash the INPUTS (not the non-deterministic rendered PDF).
    # If they match the sidecar and a brand-book.pdf already exists, the regen is a
    # no-op — this is what makes every "regenerate" trigger idempotent.
    sidecar = output.parent / HASH_SIDECAR
    inputs_hash = compute_inputs_hash(brand_ctx)
    if not args.force and output.exists() and sidecar.is_file():
        if sidecar.read_text(encoding="utf-8").strip() == inputs_hash:
            print("[skip] brand book unchanged")
            return 0

    builder = Builder(brand_ctx)
    html = builder.build(include_mockups=args.include_mockups)

    # Versioned backup of any pre-existing PDF — OPT-IN (--backup). By default the
    # regen overwrites brand-book.pdf in place, so routine re-runs don't pile up .vN.
    if args.backup and output.exists():
        backup_path = _next_backup_path(output)
        output.rename(backup_path)
        print(f"[backup] previous PDF preserved at {backup_path}")

    tmp_html = output.with_suffix(".html")
    tmp_html.write_text(html, encoding="utf-8")

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": W, "height": H})
        page.goto(tmp_html.resolve().as_uri(), wait_until="networkidle")
        page.wait_for_timeout(1200)  # extra time for webfont settle
        page.pdf(
            path=str(output),
            width=f"{W}px",
            height=f"{H}px",
            print_background=True,
            margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
        )
        browser.close()

    if not args.keep_html:
        tmp_html.unlink(missing_ok=True)

    # Persist the inputs hash so the next routine re-run can skip if nothing changed.
    sidecar.write_text(inputs_hash, encoding="utf-8")

    print(f"[ok] {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

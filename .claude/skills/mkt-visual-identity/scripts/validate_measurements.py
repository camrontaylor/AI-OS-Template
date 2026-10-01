#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml>=6.0"]
# ///
"""Validate _measurements.yaml against design fundamentals (HARD floor).

Enforces references/design-fundamentals.md:
  - Content gutter alignment (all primary elements share one left edge)
  - Type scale (font_size within role range, no in-between)
  - Feed-legibility floors (body ≥3.0cqw if it carries the main message)
  - Spacing rhythm (gaps as multiples of 1cqw base unit) — soft warning
  - Width floor for primary content

Usage:
    uv run validate_measurements.py --measurements path/to/_measurements.yaml

Exits non-zero on violation. Prints structured report to stdout."""
import argparse
import sys
from pathlib import Path

# ── DESIGN FUNDAMENTALS — see references/design-fundamentals.md ──────────

# Content gutter — universal alignment baseline. All primary elements share this left edge.
# Default 10% per user direction (was 7% before): bigger safe margin reads more editorial,
# survives feed thumbnail compression, gives display elements breathing room.
DEFAULT_GUTTER_LEFT_PCT = 10.0
GUTTER_TOLERANCE_PCT = 0.5   # ±0.5% drift is read as accidental misalignment

# Type scale — modular 1.5x Major Third. Pick a role, stay within its range.
TYPE_SCALE = {
    "display-massive":  (22.0, 28.0),
    "display-large":    (9.0, 14.0),   # widened to 14 to accommodate cover headlines wrapping to 4 lines @ 38% canvas height (derives to 12.5cqw)
    "display":          (6.0, 8.5),
    "display-bold":     (6.0, 8.5),
    "display-italic":   (6.0, 26.0),   # italic can stretch to display-massive scale
    "headline":         (4.5, 5.5),
    "body-lead":        (3.5, 4.5),
    "body":             (3.0, 3.8),
    "caption":          (2.2, 2.6),
    "kicker":           (1.2, 1.8),
    "masthead-left":    (1.2, 1.8),
    "masthead-center":  (1.2, 1.8),
    "masthead-right":   (1.2, 1.8),
    "numeral":          (5.5, 9.0),
}

# Canvas aspect constant: canvas_height / canvas_width × 100.
# For 1080×1350 LinkedIn carousel: 1350/1080 × 100 = 125.
CANVAS_ASPECT_RATIO_PCT = 125.0

# Font-size derivation tolerance (±%): declared font may deviate from the math
# this much because real Playwright/Chromium font metrics differ from the bare
# theoretical line-height × N math by a small constant (typography rounding,
# ascender padding). 15% catches the "I eyeballed it" class of error without
# false-flagging real-world rendering quirks.
FONT_DERIVATION_TOLERANCE = 0.15

# Default line_height per role (used when an element omits the field).
DEFAULT_LINE_HEIGHT_BY_FONT_ROLE = {
    "display-massive": 0.95,
    "display-large":   0.95,
    "display":         0.95,
    "display-bold":    0.95,
    "display-italic":  0.95,
    "headline":        1.05,
    "body-lead":       1.35,
    "body":            1.40,
    "caption":         1.35,
    "kicker":          1.20,
    "numeral":         0.95,
}

# Feed-legibility floors — HARD. Below these, text is illegible on social-feed thumbnails.
FEED_FLOORS = {
    "body":            3.0,
    "body-lead":       3.5,
    "caption":         2.0,
    "kicker":          1.2,
    "numeral":         5.5,
    "display":         4.5,
    "display-bold":    4.5,
    "display-italic":  4.5,
    "display-large":   8.0,
    "display-massive": 18.0,
}

# Primary-content roles must respect the gutter (decorative / chrome don't need to)
PRIMARY_ROLES = {
    "body", "body-lead", "headline", "display", "display-bold", "display-italic",
    "display-large", "display-massive",
    "tagline-pill", "creator-badge", "numeral-badge",
    "cover-line-1", "cover-line-2",
}

# Width floor for primary content (% of canvas)
WIDTH_FLOOR_BY_ROLE = {
    "headline":      60,
    "display":       60,
    "display-bold":  60,
    "display-italic": 60,
    "body":          50,
    "body-lead":     50,
}

# Element height floors (visual identity floor — separate from font legibility floor)
MIN_ELEMENT_HEIGHT_BY_ROLE = {
    "kicker": 1.5,
    "masthead-left": 1.5,
    "masthead-center": 1.5,
    "masthead-right": 1.5,
    "body": 4.0,
    "tagline-pill": 4.0,
    "creator-badge": 4.0,
    "numeral-badge": 4.0,
}

MAX_AREA_PCT_BY_ROLE = {
    "body": 60,
    "default": 30,
}

# Spacing rhythm — max gap between CONSECUTIVE primary elements (in y-axis order).
# Per design-fundamentals §4: within-group ≤2cqw, between-group ≤3cqw, section break ≤6cqw.
# A "loose" gap > 3% between visually-paired elements (headline→body, headline→pill) reads
# as disconnected — eye loses the relationship. The ref always tightens these gaps.
MAX_GAP_PCT_BETWEEN_PAIRED = {
    # (role_above, role_below): max gap in % canvas-h
    ("display", "body"): 3.0,
    ("display-bold", "body"): 3.0,
    ("display-italic", "body"): 3.0,
    ("display-large", "body"): 2.5,        # cover headline → subhead — ref keeps these tight
    ("display-large", "body-lead"): 2.5,
    ("display-massive", "body"): 3.0,
    ("headline", "body"): 3.0,
    ("numeral-badge", "display"): 4.0,
    ("numeral-badge", "headline"): 4.0,
    ("numeral-badge", "display-bold"): 4.0,
    ("display-bold", "body-lead"): 2.5,
    # Default (any-paired): 5% — beyond this, almost always disconnected
}
MAX_GAP_PCT_DEFAULT = 5.0

# When BOTH elements in a pair declare observed_line_count (strict mode — author
# measured precisely), upgrade the spacing check from warning to error. The author
# committed to measurement precision; the gap must match too.
SPACING_STRICT_MODE_WHEN_OBSERVED = True

# Single-line height-fit check — when a text element has observed_line_count: 1,
# the declared font_size_cqw should still be roughly coherent with the declared
# bbox.height. The tolerance band is much wider than the multi-line derivation
# (±30% vs ±15%) because a 1-line bbox has visual latitude — extra vertical
# whitespace is OK design, only flagged when font is clearly under/overfilling.
#
# When STRICT_SINGLE_LINE_FIT is True, single-line under/overfill is escalated
# from warning to error. Default False — leaves the multi-line derivation as
# the only hard error class.
SINGLE_LINE_UNDERFILL_RATIO = 0.70   # actual < expected × 0.70 → text is dwarfed by bbox
SINGLE_LINE_OVERFILL_RATIO = 1.30    # actual > expected × 1.30 → text won't fit, will clip
STRICT_SINGLE_LINE_FIT = False

# Element types/roles that escape single-line fit check — chrome, decorative,
# pill containers, icons. Single-line fit math doesn't model their visual budget.
SINGLE_LINE_FIT_EXCLUDED_TYPES = {
    "bg-watermark", "icon", "icon-composite", "image-zone", "pill",
}
SINGLE_LINE_FIT_EXCLUDED_ROLES = {
    "chrome", "framed-card-border", "dot-grid-corner",
    "masthead-left", "masthead-center", "masthead-right",
    "kicker",  # kicker has wider visual latitude (small text floating in larger bbox is fine)
}

# ── Alignment-intent check (ALIGNMENT_DRIFT) ─────────────────────────────
#
# bbox_pct says WHERE an element IS (top-left corner). It doesn't say WHY it's
# there — is the element anchored to the canvas top, vertically centered, or
# anchored to the bottom? If the agent measures a frame's top edge at y=8% but
# the ref's design intent is "vertically centered" (with 26% empty above AND
# below), the bbox is wrong — re-anchoring would put top at ~26%.
#
# When an element declares `alignment_intent: {vertical: center, horizontal: ...}`,
# the validator checks that the actual margins computed from bbox match that
# intent. Tolerance is 3% of canvas (1 percentage point per visual margin).
ALIGNMENT_TOLERANCE_PCT = 3.0
ALIGNMENT_ANCHOR_MAX_MARGIN_PCT = 25.0   # for top/left/bottom/right anchors:
                                          # the anchored margin should be smaller
                                          # than this — anything larger and the
                                          # element isn't really anchored, it's
                                          # floating, suggesting the wrong anchor.


# ── Validation ───────────────────────────────────────────────────────────

def validate(meas: dict) -> tuple[list[str], list[str]]:
    """Returns (errors, warnings)."""
    errors: list[str] = []
    warnings: list[str] = []

    gutter = meas.get("content_gutter_left_pct", DEFAULT_GUTTER_LEFT_PCT)

    def check_font_size_derivation(eid: str, bbox: list, font_size_cqw: float | None,
                                    observed_line_count: int | None, line_height: float | None,
                                    font_role: str | None):
        """For multi-line text: declared font_size must match math derivation within tolerance.

        Formula:
            font_size_cqw = bbox.height_pct × 125 / (observed_line_count × line_height)

        Where 125 = canvas_h/canvas_w × 100 for 1080×1350 canvas. The derivation says
        N lines at the given line_height fill the bbox.height. If declared font deviates
        from this by more than ±15%, the measurement is internally inconsistent — the
        agent eyeballed the font instead of deriving it, OR the bbox.height was wrong,
        OR observed_line_count was wrong. Force a recompute.
        """
        if observed_line_count is None or observed_line_count <= 1:
            return  # single-line text or icon — derivation doesn't apply
        if font_size_cqw is None:
            errors.append(f"[{eid}] observed_line_count={observed_line_count} but no font_size_cqw declared — cannot validate derivation")
            return
        if not isinstance(bbox, list) or len(bbox) != 4:
            return  # bbox already failed earlier check
        bbox_height = bbox[3]
        # Resolve line_height: use declared, else default by role, else 1.0
        lh = line_height
        if lh is None and font_role:
            lh = DEFAULT_LINE_HEIGHT_BY_FONT_ROLE.get(font_role)
        if lh is None:
            lh = 1.0
        if lh <= 0:
            errors.append(f"[{eid}] line_height={lh} invalid (must be > 0)")
            return

        expected = bbox_height * CANVAS_ASPECT_RATIO_PCT / (observed_line_count * lh) / 100
        # Note: the /100 above converts because bbox_height is already a percent and
        # CANVAS_ASPECT_RATIO_PCT is canvas_h/canvas_w × 100 — they multiply to give
        # a px-style ratio that we then express in cqw (which is also % of canvas_w).
        # Simplification: expected = bbox_height_pct × 1.25 / (N × line_height).
        expected = bbox_height * 1.25 / (observed_line_count * lh)

        if expected <= 0:
            return
        deviation = abs(font_size_cqw - expected) / expected
        if deviation > FONT_DERIVATION_TOLERANCE:
            errors.append(
                f"[{eid}] FONT_SIZE_DRIFT: declared font_size_cqw={font_size_cqw} but "
                f"expected={expected:.2f} from bbox.height={bbox_height}% × 1.25 / "
                f"({observed_line_count} lines × line_height {lh}). "
                f"Deviation {deviation*100:.0f}% > tolerance ±{int(FONT_DERIVATION_TOLERANCE*100)}%. "
                f"Fix: re-measure bbox.height to match the smallest rectangle containing all "
                f"{observed_line_count} lines in the ref, OR recount lines, OR adjust line_height. "
                f"DO NOT manually set font_size_cqw — derive it from the formula."
            )

    def check_single_line_fit(eid: str, bbox: list, font_size_cqw: float | None,
                              observed_line_count: int | None, line_height: float | None,
                              font_role: str | None, role: str | None, etype: str | None):
        """For single-line text: declared font_size should be coherent with bbox.height.

        Same formula as multi-line derivation:
            expected_font_cqw = bbox.height_pct × 1.25 / (1 × line_height)

        Tolerance band 70%-130% (vs ±15% for multi-line) — a single-line bbox can carry
        intentional vertical whitespace, but if the font is below 70% of expected it's
        clearly underfilling (the cover byline bug: 1.6cqw font in a 4% bbox where
        the math says ~4.17cqw — text reads as a tiny footnote instead of a footer).
        Above 130%: the text won't fit vertically — it'll clip or overflow.

        Returns nothing; appends to outer `warnings` (or `errors` under strict mode).
        """
        if observed_line_count != 1:
            return  # only single-line text
        if font_size_cqw is None:
            return  # nothing to check
        if etype in SINGLE_LINE_FIT_EXCLUDED_TYPES:
            return
        # Content-bearing font_roles override role-based exclusions: a structural
        # role: kicker carrying font_role: body is still body-shaped text and must
        # honor its bbox. Catches the "byline tagged as kicker but rendered as
        # footer body" case that escaped the original exclusion list.
        content_font_role = font_role in {
            "body", "body-lead", "headline",
            "display", "display-bold", "display-italic", "display-large", "display-massive",
            "numeral",
        }
        if not content_font_role:
            if role in SINGLE_LINE_FIT_EXCLUDED_ROLES:
                return
            if font_role in SINGLE_LINE_FIT_EXCLUDED_ROLES:
                return
        if not isinstance(bbox, list) or len(bbox) != 4:
            return
        bbox_height = bbox[3]
        # Resolve line_height: declared, else default by font_role, else 1.0
        lh = line_height
        if lh is None and font_role:
            lh = DEFAULT_LINE_HEIGHT_BY_FONT_ROLE.get(font_role)
        if lh is None and role:
            lh = DEFAULT_LINE_HEIGHT_BY_FONT_ROLE.get(role)
        if lh is None:
            lh = 1.0
        if lh <= 0:
            return  # invalid line_height — let other check flag it

        expected = bbox_height * 1.25 / (1 * lh)
        if expected <= 0:
            return

        ratio = font_size_cqw / expected
        target_bucket = errors if STRICT_SINGLE_LINE_FIT else warnings

        if ratio < SINGLE_LINE_UNDERFILL_RATIO:
            target_bucket.append(
                f"[{eid}] SINGLE_LINE_UNDERFILL: font_size_cqw={font_size_cqw} is "
                f"{ratio*100:.0f}% of expected {expected:.2f}cqw "
                f"(bbox.height={bbox_height}% × 1.25 / (1 line × line_height {lh})). "
                f"Below {int(SINGLE_LINE_UNDERFILL_RATIO*100)}% threshold — text reads as a "
                f"tiny floating footnote inside a bbox sized for something larger. "
                f"Fix: raise font_size_cqw toward {expected:.2f}, OR shrink bbox.height to "
                f"~{font_size_cqw * lh / 1.25:.1f}% so the bbox matches the actual visual size."
            )
        elif ratio > SINGLE_LINE_OVERFILL_RATIO:
            target_bucket.append(
                f"[{eid}] SINGLE_LINE_OVERFILL: font_size_cqw={font_size_cqw} is "
                f"{ratio*100:.0f}% of expected {expected:.2f}cqw "
                f"(bbox.height={bbox_height}% × 1.25 / (1 line × line_height {lh})). "
                f"Above {int(SINGLE_LINE_OVERFILL_RATIO*100)}% threshold — text won't fit "
                f"vertically in this bbox and will clip or overflow. "
                f"Fix: lower font_size_cqw toward {expected:.2f}, OR raise bbox.height to "
                f"~{font_size_cqw * lh / 1.25:.1f}% so the bbox can contain the actual text."
            )

    def check_alignment_intent(eid: str, bbox: list, alignment_intent: dict | None):
        """Validate declared alignment_intent against actual margins from bbox.

        alignment_intent schema:
            vertical: top | center | bottom
            horizontal: left | center | right

        Margins from bbox:
            margin_top    = bbox[1]
            margin_bottom = 100 - (bbox[1] + bbox[3])
            margin_left   = bbox[0]
            margin_right  = 100 - (bbox[0] + bbox[2])

        Rules:
            - vertical: center → |margin_top - margin_bottom| <= ALIGNMENT_TOLERANCE_PCT
            - vertical: top    → margin_top   < margin_bottom (anchored to top)
              AND margin_top < ALIGNMENT_ANCHOR_MAX_MARGIN_PCT
            - vertical: bottom → margin_bottom < margin_top (anchored to bottom)
              AND margin_bottom < ALIGNMENT_ANCHOR_MAX_MARGIN_PCT
            - horizontal: same logic with left/right

        Skips elements without alignment_intent declared (it's optional metadata).
        """
        if not alignment_intent or not isinstance(alignment_intent, dict):
            return
        if not isinstance(bbox, list) or len(bbox) != 4:
            return
        left, top, w, h = bbox
        margin_top = top
        margin_bottom = 100 - (top + h)
        margin_left = left
        margin_right = 100 - (left + w)

        v = alignment_intent.get("vertical")
        if v == "center":
            delta = abs(margin_top - margin_bottom)
            if delta > ALIGNMENT_TOLERANCE_PCT:
                centered_top = (100 - h) / 2
                errors.append(
                    f"[{eid}] ALIGNMENT_DRIFT vertical: declared alignment_intent.vertical=center "
                    f"but margin_top={margin_top:.1f}% vs margin_bottom={margin_bottom:.1f}% "
                    f"(delta={delta:.1f}% > tolerance {ALIGNMENT_TOLERANCE_PCT}%). "
                    f"For true vertical centering with height={h}%, set bbox top to ≈{centered_top:.1f}%."
                )
        elif v == "top":
            if margin_top >= margin_bottom:
                warnings.append(
                    f"[{eid}] ALIGNMENT_DRIFT vertical: declared alignment_intent.vertical=top "
                    f"but margin_top={margin_top:.1f}% >= margin_bottom={margin_bottom:.1f}% — "
                    f"element is not actually anchored to top. Either change intent to center/bottom "
                    f"or shrink margin_top."
                )
            elif margin_top > ALIGNMENT_ANCHOR_MAX_MARGIN_PCT:
                warnings.append(
                    f"[{eid}] ALIGNMENT_DRIFT vertical: declared alignment_intent.vertical=top "
                    f"but margin_top={margin_top:.1f}% > {ALIGNMENT_ANCHOR_MAX_MARGIN_PCT}% — "
                    f"element floats too far from top to be 'top-anchored'. Probably should be "
                    f"vertical=center or floating."
                )
        elif v == "bottom":
            if margin_bottom >= margin_top:
                warnings.append(
                    f"[{eid}] ALIGNMENT_DRIFT vertical: declared alignment_intent.vertical=bottom "
                    f"but margin_bottom={margin_bottom:.1f}% >= margin_top={margin_top:.1f}% — "
                    f"element is not actually anchored to bottom."
                )
            elif margin_bottom > ALIGNMENT_ANCHOR_MAX_MARGIN_PCT:
                warnings.append(
                    f"[{eid}] ALIGNMENT_DRIFT vertical: declared alignment_intent.vertical=bottom "
                    f"but margin_bottom={margin_bottom:.1f}% > {ALIGNMENT_ANCHOR_MAX_MARGIN_PCT}% — "
                    f"element floats too far from bottom."
                )
        elif v is not None and v != "floating":
            errors.append(
                f"[{eid}] alignment_intent.vertical={v!r} invalid — "
                f"must be one of: top, center, bottom, floating"
            )

        ha = alignment_intent.get("horizontal")
        if ha == "center":
            delta = abs(margin_left - margin_right)
            if delta > ALIGNMENT_TOLERANCE_PCT:
                centered_left = (100 - w) / 2
                errors.append(
                    f"[{eid}] ALIGNMENT_DRIFT horizontal: declared alignment_intent.horizontal=center "
                    f"but margin_left={margin_left:.1f}% vs margin_right={margin_right:.1f}% "
                    f"(delta={delta:.1f}% > tolerance {ALIGNMENT_TOLERANCE_PCT}%). "
                    f"For true horizontal centering with width={w}%, set bbox left to ≈{centered_left:.1f}%."
                )
        elif ha == "left":
            if margin_left >= margin_right:
                warnings.append(
                    f"[{eid}] ALIGNMENT_DRIFT horizontal: declared alignment_intent.horizontal=left "
                    f"but margin_left={margin_left:.1f}% >= margin_right={margin_right:.1f}%."
                )
        elif ha == "right":
            if margin_right >= margin_left:
                warnings.append(
                    f"[{eid}] ALIGNMENT_DRIFT horizontal: declared alignment_intent.horizontal=right "
                    f"but margin_right={margin_right:.1f}% >= margin_left={margin_left:.1f}%."
                )
        elif ha is not None and ha != "floating":
            errors.append(
                f"[{eid}] alignment_intent.horizontal={ha!r} invalid — "
                f"must be one of: left, center, right, floating"
            )

    def check_element(eid: str, bbox: list, role: str | None, etype: str | None,
                      font_size_cqw: float | None, breaks_gutter: bool):
        if not isinstance(bbox, list) or len(bbox) != 4:
            errors.append(f"[{eid}] bbox_pct must be [left, top, width, height], got: {bbox}")
            return
        left, top, w, h = bbox
        right = left + w
        bottom = top + h

        # Canvas bounds
        if left < 0 or top < 0:
            errors.append(f"[{eid}] negative bbox: left={left}, top={top}")
        if right > 100:
            errors.append(f"[{eid}] overflows right edge: {right}% > 100%")
        if bottom > 100:
            errors.append(f"[{eid}] overflows bottom edge: {bottom}% > 100%")

        # 1. CONTENT GUTTER — all primary elements share one left edge
        if role in PRIMARY_ROLES and not breaks_gutter:
            drift = abs(left - gutter)
            if drift > GUTTER_TOLERANCE_PCT:
                errors.append(
                    f"[{eid}] role={role} left={left}% drifts {drift:.1f}% from gutter {gutter}% "
                    f"— set bbox_pct[0]={gutter} or tag `breaks_gutter: true` with a reason"
                )

        # 2. TYPE SCALE — font must be within role's range
        if role and role in TYPE_SCALE and font_size_cqw is not None:
            lo, hi = TYPE_SCALE[role]
            if font_size_cqw < lo:
                errors.append(f"[{eid}] role={role} font={font_size_cqw}cqw below scale ({lo}–{hi})")
            elif font_size_cqw > hi:
                errors.append(f"[{eid}] role={role} font={font_size_cqw}cqw above scale ({lo}–{hi})")

        # 3. FEED-LEGIBILITY FLOOR — hard floor below scale
        if role and role in FEED_FLOORS and font_size_cqw is not None:
            floor = FEED_FLOORS[role]
            if font_size_cqw < floor:
                errors.append(
                    f"[{eid}] role={role} font={font_size_cqw}cqw below feed floor {floor}cqw "
                    f"(illegible on LinkedIn/IG feed thumbnails)"
                )

        # 4. WIDTH FLOOR for primary text
        if role and role in WIDTH_FLOOR_BY_ROLE:
            floor = WIDTH_FLOOR_BY_ROLE[role]
            if w < floor:
                warnings.append(
                    f"[{eid}] role={role} width={w}% below width floor {floor}% "
                    f"(reads as footnote instead of primary content)"
                )

        # 5. ELEMENT HEIGHT floor
        if role and role in MIN_ELEMENT_HEIGHT_BY_ROLE:
            min_h = MIN_ELEMENT_HEIGHT_BY_ROLE[role]
            if h < min_h:
                errors.append(f"[{eid}] role={role} height={h}% below floor {min_h}%")

        # 6. AREA ceiling
        area = (w * h) / 100
        ceiling = MAX_AREA_PCT_BY_ROLE.get(role or "", MAX_AREA_PCT_BY_ROLE["default"])
        if area > ceiling:
            warnings.append(f"[{eid}] role={role} covers {area:.1f}% canvas area (max {ceiling}%)")

    for el in meas.get("elements", []) or []:
        check_element(
            el.get("id", "<no-id>"),
            el.get("bbox_pct", []),
            el.get("role"),
            el.get("type"),
            el.get("font_size_cqw"),
            bool(el.get("breaks_gutter", False)),
        )
        # Font-size derivation check (only triggers when observed_line_count > 1)
        check_font_size_derivation(
            el.get("id", "<no-id>"),
            el.get("bbox_pct", []),
            el.get("font_size_cqw"),
            el.get("observed_line_count"),
            el.get("line_height"),
            el.get("font_role") or el.get("role"),
        )
        # Single-line fit check (only triggers when observed_line_count == 1)
        check_single_line_fit(
            el.get("id", "<no-id>"),
            el.get("bbox_pct", []),
            el.get("font_size_cqw"),
            el.get("observed_line_count"),
            el.get("line_height"),
            el.get("font_role"),
            el.get("role"),
            el.get("type"),
        )
        # Alignment-intent check (only triggers when alignment_intent is declared)
        check_alignment_intent(
            el.get("id", "<no-id>"),
            el.get("bbox_pct", []),
            el.get("alignment_intent"),
        )

    for ml in meas.get("mixed_lines", []) or []:
        check_element(
            ml.get("id", "<no-id>"),
            ml.get("bbox_pct", []),
            ml.get("font_role"),
            "mixed-line",
            ml.get("font_size_cqw"),
            bool(ml.get("breaks_gutter", False)),
        )
        check_font_size_derivation(
            ml.get("id", "<no-id>"),
            ml.get("bbox_pct", []),
            ml.get("font_size_cqw"),
            ml.get("observed_line_count"),
            ml.get("line_height"),
            ml.get("font_role"),
        )
        check_single_line_fit(
            ml.get("id", "<no-id>"),
            ml.get("bbox_pct", []),
            ml.get("font_size_cqw"),
            ml.get("observed_line_count"),
            ml.get("line_height"),
            ml.get("font_role"),
            ml.get("font_role"),
            "mixed-line",
        )

    # ── Parameterization flags (Phase 1 schema) ──────────────────────────
    for el in meas.get("elements", []) or []:
        eid = el.get("id", "<no-id>")
        # required + content default
        if el.get("required") is True and not el.get("content"):
            errors.append(f"[{eid}] required:true but no content — required slots MUST declare default content for fallback")
        # brand_locked_color flag must accompany an explicit color_role
        if el.get("brand_locked_color") is True and not el.get("color_role"):
            warnings.append(f"[{eid}] brand_locked_color:true but no color_role declared — set color_role: text-on-dark|text-on-light|accent")
        # omit_behavior makes sense only when required:false
        if el.get("required") is True and el.get("omit_behavior"):
            warnings.append(f"[{eid}] required:true element has omit_behavior:{el.get('omit_behavior')} — required slots can't be omitted; remove omit_behavior")

    # ── bg_slot check ────────────────────────────────────────────────────
    bg_slot = meas.get("bg_slot") or {}
    if bg_slot:
        if not bg_slot.get("type"):
            errors.append("[bg_slot] missing required field: type (photo-replaceable|textured|gradient|solid|none)")
        if bg_slot.get("required") is True and not (bg_slot.get("default_source") or {}).get("path"):
            errors.append("[bg_slot] required:true but no default_source.path declared")
        # substitution_options should list at least 'keep-default'
        subs = bg_slot.get("substitution_options") or []
        methods = [s.get("method") for s in subs]
        if "keep-default" not in methods:
            warnings.append("[bg_slot] substitution_options missing 'keep-default' fallback method — recommended")

    # ── composition_techniques check ─────────────────────────────────────
    for ct in meas.get("composition_techniques", []) or []:
        cid = ct.get("id", "<no-id>")
        if not ct.get("type"):
            errors.append(f"[ct:{cid}] missing type (gradient-scrim|radial-vignette|blur-overlay|linear-gradient)")
        if not ct.get("css"):
            errors.append(f"[ct:{cid}] missing css declaration")
        bb = ct.get("bbox_pct") or []
        if len(bb) != 4:
            errors.append(f"[ct:{cid}] bbox_pct must be [left, top, width, height]")

    # ── AUTO-DETECT: photo-bg + text in y>60% requires bottom-scrim ──────
    # Empirical pattern: text overlays on photo bgs need a scrim/gradient for legibility.
    # This rule catches the "I forgot to declare composition_techniques" failure mode.
    bg_type = (meas.get("bg_slot") or {}).get("type") or ""
    if bg_type == "photo-replaceable":
        has_low_text = False
        for el in meas.get("elements", []) or []:
            bb = el.get("bbox_pct") or []
            if len(bb) == 4 and bb[1] >= 60 and el.get("role") in PRIMARY_ROLES:
                # Skip elements that have their own bg (pills) — pill bg replaces scrim function
                if el.get("type") in ("pill", "icon-composite"):
                    continue
                has_low_text = True
                break
        if has_low_text:
            ct_list = meas.get("composition_techniques") or []
            has_bottom_scrim = any(
                (ct.get("type") in ("gradient-scrim", "linear-gradient") and
                 (ct.get("bbox_pct") or [0,0,0,0])[1] >= 50)
                for ct in ct_list
            )
            if not has_bottom_scrim:
                warnings.append(
                    "[composition] photo-replaceable bg has primary text element(s) at y>=60% "
                    "but no bottom-scrim composition_technique declared — text legibility at risk. "
                    "Add a gradient-scrim (e.g., linear-gradient transparent→rgba(0,0,0,0.65) in y=60-100) "
                    "or text-shadow on each text class."
                )

    # ── Spacing rhythm check (between consecutive primary elements) ──────
    # Collect primary elements with their vertical extent + role + observed_line_count
    primary = []
    for el in meas.get("elements", []) or []:
        if el.get("role") in PRIMARY_ROLES and isinstance(el.get("bbox_pct"), list) and len(el["bbox_pct"]) == 4:
            top, _, height = el["bbox_pct"][1], el["bbox_pct"][2], el["bbox_pct"][3]
            primary.append({
                "id": el.get("id"),
                "role": el.get("role"),
                "top": top,
                "bottom": top + height,
                "has_observed_lc": el.get("observed_line_count") is not None,
            })
    for ml in meas.get("mixed_lines", []) or []:
        if ml.get("font_role") in PRIMARY_ROLES and isinstance(ml.get("bbox_pct"), list) and len(ml["bbox_pct"]) == 4:
            top, _, height = ml["bbox_pct"][1], ml["bbox_pct"][2], ml["bbox_pct"][3]
            primary.append({
                "id": ml.get("id"),
                "role": ml.get("font_role"),
                "top": top,
                "bottom": top + height,
                "has_observed_lc": ml.get("observed_line_count") is not None,
            })

    # Sort by top y. For each consecutive pair, compute gap = next.top - prev.bottom.
    primary.sort(key=lambda e: e["top"])
    for i in range(len(primary) - 1):
        a, b = primary[i], primary[i + 1]
        gap = b["top"] - a["bottom"]
        if gap < 0:
            continue  # overlapping — different check (validators above handle bounds)
        max_allowed = MAX_GAP_PCT_BETWEEN_PAIRED.get((a["role"], b["role"]), MAX_GAP_PCT_DEFAULT)
        if gap > max_allowed:
            # Strict mode: when both elements have observed_line_count declared, the author
            # committed to precision — the gap is an error, not a soft warning.
            strict = SPACING_STRICT_MODE_WHEN_OBSERVED and a["has_observed_lc"] and b["has_observed_lc"]
            msg = (
                f"[spacing] SPACING_DRIFT: {a['id']} (bottom={a['bottom']:.1f}%) -> "
                f"{b['id']} (top={b['top']:.1f}%) gap={gap:.1f}% > max {max_allowed}% "
                f"for ({a['role']}, {b['role']}). Ref shows these elements tight together — "
                f"set {b['id']}.top ≈ {a['bottom']:.1f}% (or {a['bottom'] + max_allowed:.1f}% "
                f"if a small breathing gap is intentional)."
            )
            (errors if strict else warnings).append(msg)

    return errors, warnings


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--measurements", required=True)
    args = ap.parse_args()

    import yaml
    path = Path(args.measurements).resolve()
    if not path.exists():
        print(f"Error: file not found: {path}", file=sys.stderr)
        return 1

    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    errors, warnings = validate(data)

    if warnings:
        print(f"[warn] {len(warnings)} warning(s):", file=sys.stderr)
        for w in warnings:
            print(f"  - {w}", file=sys.stderr)
    if errors:
        print(f"[fail] VALIDATION FAILED - {len(errors)} error(s):", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 2

    elements = len(data.get("elements", []) or [])
    mixed = len(data.get("mixed_lines", []) or [])
    print(f"OK - {elements} elements + {mixed} mixed-lines pass all design-fundamentals checks.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

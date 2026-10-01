# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Download Google Fonts family files into a brand's fonts/ folder.

Resolves families via the Google Fonts CSS2 API — no API key, stdlib only.
Emits ONE .woff2 per (weight, style), choosing the `latin` subset (which
covers Latin-1 accents, so EN + PT-BR + ES are fine). woff2 is the right
format here: every render path in this skill is Chromium/Playwright
(render_slide.py, preview_carousel.py, generate_brand_bible_pdf.py), all of
which support woff2 in @font-face.

Why not the legacy-UA TTF trick: the CSS2 API's legacy `/l/font?kit=...&skey=`
endpoint returns a protected, non-sfnt payload that fontTools rejects. The
modern-UA woff2 URLs are plain, cacheable font files. Validated with
`fontTools.ttLib.TTFont`.

Usage:
    python fetch_font.py --family "Fraunces" --weights 400,900 --italic \
        --output-dir brand_context/visual-identity/fonts
    python fetch_font.py --family "Archivo Black" --output-dir <dir>
    python fetch_font.py --family "Inter" --weights 400,500,700 --output-dir <dir>

Multiple --family flags are allowed; each is resolved independently.
Optional --subset overrides the default `latin` (e.g. `latin-ext`).
Prints a JSON summary to stdout: one record per downloaded file.
Exit code 0 if every requested family produced at least one file, else 1.
"""
import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Modern UA → API returns plain .woff2 URLs (one per unicode-range subset).
MODERN_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# Each face is preceded by a `/* subset */` comment. Capture the label so we
# can pick one subset per (weight, style) instead of grabbing all ~7.
FACE_RE = re.compile(
    r"/\*\s*(?P<subset>[\w-]+)\s*\*/\s*@font-face\s*\{(?P<body>[^}]*)\}",
    re.DOTALL,
)
WEIGHT_RE = re.compile(r"font-weight:\s*(\d+)")
STYLE_RE = re.compile(r"font-style:\s*(normal|italic)")
SRC_RE = re.compile(r"src:\s*url\((?P<url>[^)]+)\)")


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def build_css_url(family: str, weights, italic: bool) -> str:
    fam = urllib.parse.quote_plus(family)
    if not weights:
        return f"https://fonts.googleapis.com/css2?family={fam}&display=swap"
    if italic:
        tuples = [f"0,{w}" for w in weights] + [f"1,{w}" for w in weights]
        spec = "ital,wght@" + ";".join(sorted(tuples))
    else:
        spec = "wght@" + ";".join(weights)
    return f"https://fonts.googleapis.com/css2?family={fam}:{spec}&display=swap"


def fetch_css(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": MODERN_UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8")


def resolve_css(family: str, weights, italic: bool) -> str:
    """Try the full spec; on HTTP 400 fall back to the bare family name."""
    try:
        return fetch_css(build_css_url(family, weights, italic))
    except urllib.error.HTTPError as e:
        if e.code == 400 and weights:
            sys.stderr.write(
                f"  ! spec rejected for {family} (weights may not exist); "
                f"retrying bare family\n"
            )
            return fetch_css(build_css_url(family, None, False))
        raise


def download(url: str, dest: Path) -> int:
    req = urllib.request.Request(url, headers={"User-Agent": MODERN_UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    dest.write_bytes(data)
    return len(data)


def fetch_family(family: str, weights, italic: bool, out_dir: Path,
                 subset: str) -> list[dict]:
    css = resolve_css(family, weights, italic)
    slug = slugify(family)
    # Collect candidate URLs per (weight, style) keyed by subset.
    faces: dict[tuple, dict] = {}
    for m in FACE_RE.finditer(css):
        body = m.group("body")
        wm, sm, um = WEIGHT_RE.search(body), STYLE_RE.search(body), SRC_RE.search(body)
        if not (wm and um):
            continue
        weight = wm.group(1)
        style = sm.group(1) if sm else "normal"
        url = um.group("url").strip().strip("'\"")
        faces.setdefault((weight, style), {})[m.group("subset")] = url

    results = []
    for (weight, style), by_subset in faces.items():
        # Prefer the requested subset, then latin, then latin-ext, then any.
        url = (
            by_subset.get(subset)
            or by_subset.get("latin")
            or by_subset.get("latin-ext")
            or next(iter(by_subset.values()))
        )
        suffix = f"{weight}{'i' if style == 'italic' else ''}"
        dest = out_dir / f"{slug}-{suffix}.woff2"
        size = download(url, dest)
        results.append({
            "family": family, "weight": int(weight), "style": style,
            "file": str(dest), "bytes": size,
        })
    return results


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--family", action="append", required=True,
                    help="Google Fonts family name (repeatable)")
    ap.add_argument("--weights", default="",
                    help="comma-separated weights, e.g. 400,700,900 (optional)")
    ap.add_argument("--italic", action="store_true",
                    help="also fetch italic faces for each weight")
    ap.add_argument("--subset", default="latin",
                    help="unicode-range subset to keep per face (default: latin)")
    ap.add_argument("--output-dir", required=True, help="destination fonts/ folder")
    args = ap.parse_args()

    weights = [w.strip() for w in args.weights.split(",") if w.strip()]
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    all_results, failures = [], []
    for family in args.family:
        try:
            res = fetch_family(family, weights, args.italic, out_dir, args.subset)
            if not res:
                failures.append(family)
                sys.stderr.write(f"  ! no faces found for {family}\n")
            for r in res:
                sys.stderr.write(
                    f"  OK {r['family']} {r['weight']}"
                    f"{'i' if r['style'] == 'italic' else ''} "
                    f"-> {Path(r['file']).name} ({r['bytes']} B)\n"
                )
            all_results.extend(res)
        except Exception as e:  # noqa: BLE001 — surface failure, keep going
            failures.append(family)
            sys.stderr.write(f"  ! failed {family}: {e}\n")

    print(json.dumps({"downloaded": all_results, "failed": failures}, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())

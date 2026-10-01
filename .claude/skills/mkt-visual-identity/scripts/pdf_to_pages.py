"""Rasterize a PDF into one PNG per page, resized to target canvas.

Usage:
    python pdf_to_pages.py <pdf_path> <output_dir> [--width 1080] [--height 1350] [--prefix slug]

Outputs:
    {output_dir}/{prefix}-p{N}.png  for N = 1..page_count
"""
import argparse
from pathlib import Path

import fitz
from PIL import Image


def rasterize_pdf(pdf_path: str, output_dir: str, width: int, height: int, prefix: str) -> list[str]:
    doc = fitz.open(pdf_path)
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    paths = []
    for i, page in enumerate(doc, start=1):
        pix = page.get_pixmap(dpi=200)
        raw = Path(out / f"_raw-{prefix}-p{i}.png")
        pix.save(str(raw))
        img = Image.open(raw).resize((width, height), Image.LANCZOS)
        final = out / f"{prefix}-p{i}.png"
        img.save(final)
        raw.unlink()
        paths.append(str(final))
    return paths


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("output_dir")
    ap.add_argument("--width", type=int, default=1080)
    ap.add_argument("--height", type=int, default=1350)
    ap.add_argument("--prefix", default=None)
    args = ap.parse_args()
    prefix = args.prefix or Path(args.pdf).stem
    paths = rasterize_pdf(args.pdf, args.output_dir, args.width, args.height, prefix)
    for p in paths:
        print(p)


if __name__ == "__main__":
    main()

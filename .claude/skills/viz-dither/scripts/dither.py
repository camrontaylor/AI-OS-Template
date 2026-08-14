#!/usr/bin/env python3
"""viz-dither — palette-tinted 1-bit dither graphic generator.

Self-hosted, zero third-party runtime code (PIL + numpy only). Turns a source
image and procedural gradients into cohesive dither graphics in ANY brand
palette: a duotone portrait, a small face avatar, radial/linear gradient
"bleeds" for background atmosphere, and seamless density tiles.

The look: ordered-Bayer (regular, cohesive) or Floyd-Steinberg (organic).
The trick for visible dots on the web: dither at a low dot-resolution, then
scale up nearest-neighbour so each dot is a crisp block. Never anti-aliased.

Usage:
  python3 dither.py --out ./dither \\
      --paper "#FAF9F7" --ink "#0F0F0F" --accent "#E5532A" \\
      --portrait ./photo.jpg --face-crop 160,150,460,450

  # Backgrounds only (no source photo needed):
  python3 dither.py --out ./dither --accent "#3B82F6" --no-portrait

Every flag has a sane default. Run --help for the full list.
"""
from __future__ import annotations
import argparse, os
import numpy as np
from PIL import Image, ImageOps, ImageEnhance


def hex_rgb(s: str):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


# ---------- dithering core ----------
def bayer_matrix(n: int) -> np.ndarray:
    if n == 0:
        return np.array([[0]])
    m = bayer_matrix(n - 1)
    size = m.shape[0]
    out = np.zeros((size * 2, size * 2))
    out[0:size, 0:size] = 4 * m + 0
    out[0:size, size:] = 4 * m + 2
    out[size:, 0:size] = 4 * m + 3
    out[size:, size:] = 4 * m + 1
    return out


def _thresholds(shape, order=3):
    m = bayer_matrix(order)
    m = (m + 0.5) / m.size
    reps = (shape[0] // m.shape[0] + 1, shape[1] // m.shape[1] + 1)
    return np.tile(m, reps)[: shape[0], : shape[1]]


def to_gray(im, contrast=1.0, brightness=1.0):
    g = ImageOps.autocontrast(im.convert("L"), cutoff=1)
    if contrast != 1.0:
        g = ImageEnhance.Contrast(g).enhance(contrast)
    if brightness != 1.0:
        g = ImageEnhance.Brightness(g).enhance(brightness)
    return np.asarray(g, dtype=np.float32) / 255.0


def bayer_bits(gray, order=3):
    return gray < _thresholds(gray.shape, order)


def fs_bits(im, contrast=1.0, brightness=1.0):
    g = ImageOps.autocontrast(im.convert("L"), cutoff=1)
    if contrast != 1.0:
        g = ImageEnhance.Contrast(g).enhance(contrast)
    if brightness != 1.0:
        g = ImageEnhance.Brightness(g).enhance(brightness)
    return np.asarray(g.convert("1"), dtype=np.uint8) == 0


def duotone(bits, dot_rgb, bg_rgb, scale, transparent_bg=False):
    h, w = bits.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    if not transparent_bg:
        rgba[..., 0], rgba[..., 1], rgba[..., 2] = bg_rgb
        rgba[..., 3] = 255
    rgba[bits, 0], rgba[bits, 1], rgba[bits, 2] = dot_rgb
    rgba[bits, 3] = 255
    img = Image.fromarray(rgba)
    if scale != 1:
        img = img.resize((w * scale, h * scale), Image.NEAREST)
    return img


# ---------- asset builders ----------
def make_portrait(pal, src, out, dots=150, scale=4):
    im = Image.open(src).convert("RGB")
    small = im.resize((dots, int(dots * im.height / im.width)), Image.LANCZOS)
    gray = to_gray(small, 1.18, 1.06)
    for name, dot, bg in [("portrait-accent", pal["accent"], pal["paper"]),
                          ("portrait-ink", pal["ink"], pal["paper"])]:
        duotone(bayer_bits(gray), dot, bg, scale).save(f"{out}/{name}.png")
        print("wrote", name)


def make_avatar(pal, src, out, crop, dots=40, scale=4):
    im = Image.open(src).convert("RGB")
    c = im.crop(tuple(crop)) if crop else im
    small = c.resize((dots, dots), Image.LANCZOS)
    gray = to_gray(small, 1.3, 1.12)
    # Generate at 2x the display chip with integer dot blocks so the browser
    # downsamples cleanly and the dot pitch matches the portrait (no moire).
    for name, dot, bg in [("avatar-accent", pal["accent"], pal["paper"]),
                          ("avatar-ink", pal["ink"], pal["paper"])]:
        duotone(bayer_bits(gray), dot, bg, scale).save(f"{out}/{name}.png")
        print("wrote", name)


def make_bleed(pal, out, name, dot, w=120, h=120, direction="radial", scale=5, invert=False):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    if direction == "radial":
        cx, cy = w / 2, h / 2
        d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
        val = 1 - d / d.max()
    elif direction == "vertical":
        val = 1 - yy / (h - 1)
    else:
        val = xx / (w - 1)
    if invert:
        val = 1 - val
    bits = val > _thresholds(val.shape, 3)
    duotone(bits, dot, pal["paper"], scale, transparent_bg=True).save(f"{out}/{name}.png")
    print("wrote", name)


def make_tile(pal, out, name, dot, density=0.3, scale=3):
    m = bayer_matrix(3)
    m = (m + 0.5) / m.size
    duotone(density > m, dot, pal["paper"], scale, transparent_bg=True).save(f"{out}/{name}.png")
    print("wrote", name)


def main():
    ap = argparse.ArgumentParser(description="Palette-tinted 1-bit dither generator")
    ap.add_argument("--out", default="./dither")
    ap.add_argument("--paper", default="#FAF9F7", help="light surface hex")
    ap.add_argument("--ink", default="#0F0F0F", help="dark tone hex")
    ap.add_argument("--accent", default="#E5532A", help="brand accent hex")
    ap.add_argument("--portrait", help="source image for the duotone portrait")
    ap.add_argument("--no-portrait", action="store_true", help="skip portrait/avatar")
    ap.add_argument("--face-crop", help="l,t,r,b crop box for the avatar face")
    ap.add_argument("--portrait-dots", type=int, default=150)
    ap.add_argument("--avatar-dots", type=int, default=40)
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    pal = {"paper": hex_rgb(args.paper), "ink": hex_rgb(args.ink), "accent": hex_rgb(args.accent)}

    if args.portrait and not args.no_portrait:
        make_portrait(pal, args.portrait, args.out, args.portrait_dots)
        crop = [int(x) for x in args.face_crop.split(",")] if args.face_crop else None
        make_avatar(pal, args.portrait, args.out, crop, args.avatar_dots)

    # Background atmosphere (always): radial + vertical bleeds, accent + ink.
    make_bleed(pal, args.out, "grad-accent-radial", pal["accent"])
    make_bleed(pal, args.out, "grad-ink-radial", pal["ink"])
    make_bleed(pal, args.out, "grad-accent-vert", pal["accent"], w=160, h=100, direction="vertical")
    # Seamless density tiles for repeating texture.
    for d, tag in [(0.18, "12"), (0.30, "30"), (0.5, "50")]:
        make_tile(pal, args.out, f"tile-ink-{tag}", pal["ink"], d)
        make_tile(pal, args.out, f"tile-accent-{tag}", pal["accent"], d)
    print("done ->", args.out)


if __name__ == "__main__":
    main()

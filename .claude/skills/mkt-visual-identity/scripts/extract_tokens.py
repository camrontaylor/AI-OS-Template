"""Extract design tokens from a reference image via pixel analysis.

Reports dominant colors (k-means), aspect ratio, large dark/light regions.
Does NOT run OCR or font matching — those are separate scripts.

Usage:
    python extract_tokens.py <image_path> [--k 6] [--output spec.json]
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image


def kmeans_colors(img_np: np.ndarray, k: int = 6) -> list[dict]:
    """Simple k-means via numpy. Returns sorted list of color clusters by weight."""
    pixels = img_np.reshape(-1, 3).astype(np.float32)
    sample = pixels[np.random.choice(len(pixels), size=min(20000, len(pixels)), replace=False)]
    rng = np.random.default_rng(42)
    centers = sample[rng.choice(len(sample), size=k, replace=False)].copy()
    for _ in range(15):
        dists = ((sample[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
        labels = dists.argmin(axis=1)
        new_centers = np.array([sample[labels == i].mean(axis=0) if (labels == i).any() else centers[i]
                                for i in range(k)])
        if np.allclose(new_centers, centers, atol=0.5):
            break
        centers = new_centers
    counts = np.bincount(labels, minlength=k)
    weights = counts / counts.sum()
    order = np.argsort(-weights)
    return [
        {"hex": "#{:02x}{:02x}{:02x}".format(*centers[i].astype(int).clip(0, 255)),
         "rgb": centers[i].astype(int).clip(0, 255).tolist(),
         "weight": float(weights[i])}
        for i in order
    ]


def regions(img_np: np.ndarray) -> dict:
    """Identify large dark/light/saturated regions."""
    gray = img_np.mean(axis=2)
    h, w = gray.shape
    return {
        "size": [w, h],
        "aspect": round(w / h, 3),
        "mean_brightness": float(gray.mean()),
        "pct_dark": float((gray < 50).mean()),
        "pct_light": float((gray > 200).mean()),
        "pct_mid": float(((gray >= 50) & (gray <= 200)).mean()),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--k", type=int, default=6)
    ap.add_argument("--output", default=None)
    args = ap.parse_args()

    img = Image.open(args.image).convert("RGB")
    img_np = np.array(img)
    spec = {
        "source": args.image,
        "regions": regions(img_np),
        "colors": kmeans_colors(img_np, k=args.k),
    }
    out = Path(args.output) if args.output else Path(args.image).with_suffix(".spec.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(spec, indent=2, ensure_ascii=False), encoding="utf-8")
    print(out)


if __name__ == "__main__":
    main()

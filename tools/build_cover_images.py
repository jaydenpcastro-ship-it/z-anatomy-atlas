"""Cover-page figures for the site's landing screen (web/index.html #cover).

Takes the front studio renders (renders/*_front.png, from tools/render_views.py), keys out their flat
background to transparency, crops every layer to the same box so they stay aligned when stacked, and writes
small WebP files to web/img/cover/.

    python tools/build_cover_images.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "renders"
OUT = ROOT / "web" / "img" / "cover"
LAYERS = ["skeletal", "muscular", "nervous", "cardiovascular", "all_systems"]
HEIGHT = 1100          # output height in px (shown at up to ~80vh, so this stays sharp on hi-dpi screens)
PAD = 20               # px of empty margin kept around the figure (in source pixels)
LO, HI = 4.0, 28.0     # colour distance from the background: <= LO fully transparent, >= HI fully opaque


def load(name):
    return np.asarray(Image.open(SRC / f"{name}_front.png").convert("RGB")).astype(np.float32)


def main():
    imgs = {n: load(n) for n in LAYERS}
    bg = np.median(np.concatenate([a[:8, :8].reshape(-1, 3) for a in imgs.values()]), axis=0)

    # one crop box shared by every layer, so the stacked figures line up exactly
    x0 = y0 = 10**9
    x1 = y1 = 0
    for a in imgs.values():
        ys, xs = np.where(np.linalg.norm(a - bg, axis=2) > LO * 4)
        x0, y0, x1, y1 = min(x0, xs.min()), min(y0, ys.min()), max(x1, xs.max()), max(y1, ys.max())
    h, w = next(iter(imgs.values())).shape[:2]
    x0, y0, x1, y1 = max(0, x0 - PAD), max(0, y0 - PAD), min(w, x1 + PAD + 1), min(h, y1 + PAD + 1)

    OUT.mkdir(parents=True, exist_ok=True)
    for name, a in imgs.items():
        a = a[y0:y1, x0:x1]
        alpha = np.clip((np.linalg.norm(a - bg, axis=2) - LO) / (HI - LO), 0.0, 1.0)
        # un-premultiply the anti-aliased edge so it carries no grey fringe from the old background
        safe = np.maximum(alpha, 1e-3)[..., None]
        rgb = np.clip(bg + (a - bg) / safe, 0, 255)
        rgba = np.dstack([rgb, alpha * 255]).astype(np.uint8)
        im = Image.fromarray(rgba, "RGBA")
        im = im.resize((round(im.width * HEIGHT / im.height), HEIGHT), Image.LANCZOS)
        path = OUT / f"{name}.webp"
        im.save(path, "WEBP", quality=82, method=6)
        print(f"{path.relative_to(ROOT)}  {im.width}x{im.height}  {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()

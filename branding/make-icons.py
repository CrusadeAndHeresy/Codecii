#!/usr/bin/env python3
"""Build the app icons from branding/logo-source.jpg (artwork on a white background).

    python3 branding/make-icons.py

Writes public/: icon-192.png, icon-512.png (full bleed), icon-maskable-512.png (full bleed,
art inside the safe zone), apple-touch-icon.png (180, opaque), favicon.png (48).
The white background is removed by flood-filling from the edges, so white glows that sit
inside the artwork's outline are kept.
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public')
BG = (255, 255, 253)     # #fffffd, the off-white Creatio's icon sits on


def cutout(path):
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(np.int16)
    cand = a.min(axis=2) > 225
    lab, _ = ndi.label(cand)
    edge = np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])
    bg = np.isin(lab, [v for v in np.unique(edge) if v])
    alpha = (~bg).astype(np.float32)
    alpha = ndi.binary_opening(alpha > 0.5, iterations=1).astype(np.float32)   # drop stray specks
    alpha = ndi.binary_erosion(alpha > 0.5, iterations=1).astype(np.float32)   # light halo is invisible on the off-white tile
    alpha = ndi.gaussian_filter(alpha, 0.9)                                    # soft edge
    rgba = np.dstack([np.asarray(im), (alpha * 255).astype(np.uint8)])
    art = Image.fromarray(rgba, 'RGBA')
    return art.crop(art.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())


def tile(art, size, art_h, rounded):
    s = size * 4                                   # draw large, then shrink for smooth edges
    base = Image.new('RGB', (s, s), BG)
    h = int(s * art_h)
    w = int(art.width * h / art.height)
    if w > s * 0.94:                                # never let the width crowd the edges
        w = int(s * 0.94); h = int(art.height * w / art.width)
    a = art.resize((w, h), Image.LANCZOS)
    base = base.convert('RGBA')
    base.alpha_composite(a, ((s - w) // 2, (s - h) // 2))
    if rounded:
        m = Image.new('L', (s, s), 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.2), fill=255)
        base.putalpha(m)
    return base.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    art = cutout(os.path.join(HERE, 'logo-source.jpg'))
    jobs = [
        ('icon-192.png', 192, 0.88, False),     # full-bleed squares, like Creatio's icons
        ('icon-512.png', 512, 0.88, False),
        ('icon-maskable-512.png', 512, 0.72, False),
        ('apple-touch-icon.png', 180, 0.88, False),
        ('favicon.png', 48, 0.94, True),
    ]
    for name, size, h, rounded in jobs:
        img = tile(art, size, h, rounded)
        if not rounded:
            img = img.convert('RGB')
        img.save(os.path.join(OUT, name), optimize=True)
        print(name, img.size, img.mode)

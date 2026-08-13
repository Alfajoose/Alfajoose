#!/usr/bin/env python3
"""Generate the Frame Twelve icons.

The mark is a film frame — a hand-drawn square with sprocket tabs down both
edges — carrying a brushed "12" in the app's accent blue, on near-black. It
replaces an earlier three-stacked-cels mark that was light blue and read
oddly against the app's dark UI.

NOTE: the artwork here is a RECONSTRUCTION of the supplied logo, drawn from a
reference image rather than the original file. To use the real asset instead,
drop it in as `assets/logo.png` and run:

    python3 native/scripts/make-icons.py --source assets/logo.png

which skips the drawing entirely and derives every size from that file. That is
the preferred path — this drawing exists so the icon pipeline is not blocked on
the original.

Everything is drawn at 4x and downsampled, because Pillow's shape drawing is
not antialiased.

    python3 native/scripts/make-icons.py
"""

import argparse
import math
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, '..', 'android', 'app', 'src', 'main', 'res')
WEB = os.path.join(HERE, '..', '..', 'web')

SS = 4                       # supersample factor
SIZE = 1024                  # master size, downsampled per density
S = SIZE * SS

BG_TOP = (26, 31, 42)        # near-black with a blue cast, matching the app
BG_BOTTOM = (13, 16, 22)
FRAME = (122, 132, 148)      # slate grey for the film frame and sprockets
BLUE = (77, 159, 255)        # the brushed numerals

CORNER = 0.225               # icon corner radius, as a fraction of the side

# Android launcher densities: multiplier on a 48dp legacy icon and a 108dp
# adaptive layer.
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}


def u(v):
    """Master-space units (0..1024) to supersampled pixels."""
    return v * SS


def brush(d, pts, width, color, jitter=0.0, seed=0):
    """A hand-drawn stroke: a polyline with round caps and joins.

    Straight machine lines read as a UI chrome box rather than something
    someone drew, which is the whole character of this mark, so each vertex is
    nudged along a smooth wave rather than randomly — random jitter looks like
    noise, a wave looks like a hand.
    """
    w = u(width)
    out = []
    for i, (x, y) in enumerate(pts):
        if jitter:
            phase = seed + i * 1.7
            x += math.sin(phase) * jitter
            y += math.cos(phase * 0.9) * jitter
        out.append((u(x), u(y)))
    if len(out) > 1:
        d.line(out, fill=color, width=round(w), joint='curve')
    for (x, y) in out:                      # round caps and joins
        r = w / 2
        d.ellipse((x - r, y - r, x + r, y + r), fill=color)


def arc_pts(cx, cy, rx, ry, a0, a1, n=26):
    """Sample an elliptical arc, in degrees."""
    return [(cx + rx * math.cos(math.radians(a)), cy + ry * math.sin(math.radians(a)))
            for a in [a0 + (a1 - a0) * i / (n - 1) for i in range(n)]]


def draw_mark(scale=1.0, with_frame=True):
    """The film frame plus numerals, centred, on transparency."""
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = 512.0                                     # master-space centre

    def sc(x, y):
        return (c + (x - c) * scale, c + (y - c) * scale)

    def pth(pts):
        return [sc(x, y) for (x, y) in pts]

    fcol = FRAME + (255,)
    bcol = BLUE + (255,)

    if with_frame:
        # The frame: four strokes rather than a rectangle, so the corners
        # overshoot slightly the way a drawn box does.
        L, R, T, B = 212, 812, 196, 818
        for pts, seed in (
            ([(L - 6, T), (R + 4, T - 3)], 0.4),      # top
            ([(R, T - 4), (R + 3, B + 4)], 1.9),      # right
            ([(R + 5, B), (L - 4, B + 3)], 3.1),      # bottom
            ([(L, B + 4), (L - 3, T - 5)], 4.6),      # left
        ):
            brush(d, pth(pts), 17 * scale, fcol, jitter=3.0 * scale, seed=seed)

        # Sprocket tabs, three down each edge, sitting outside the frame.
        for ty in (322, 508, 694):
            brush(d, pth([(138, ty), (206, ty)]), 24 * scale, fcol)
            brush(d, pth([(818, ty), (886, ty)]), 24 * scale, fcol)

    # "1": diagonal flag, vertical stem, foot.
    brush(d, pth([(352, 368), (430, 320)]), 30 * scale, bcol, jitter=2.0, seed=7)
    brush(d, pth([(430, 322), (428, 662)]), 33 * scale, bcol, jitter=2.4, seed=2)
    brush(d, pth([(364, 676), (502, 666)]), 30 * scale, bcol, jitter=2.0, seed=5)

    # "2": an arc over the TOP, then a diagonal back down-left, then a foot.
    #
    # Screen y grows downward, so sin() is positive below centre: sweeping from
    # 175 DOWN to -60 passes through +90, which is the bottom, and draws the
    # bowl upside down. Increasing past 270 is what goes over the top.
    top = arc_pts(636, 398, 104, 92, 175, 382)
    brush(d, pth(top), 33 * scale, bcol, jitter=2.2, seed=1)
    brush(d, pth([(730, 442), (566, 610)]), 33 * scale, bcol, jitter=2.4, seed=3)
    brush(d, pth([(558, 622), (744, 612)]), 30 * scale, bcol, jitter=2.0, seed=6)

    return img


def gradient(size, top, bottom):
    img = Image.new('RGB', (1, size), top)
    px = img.load()
    for y in range(size):
        t = y / max(1, size - 1)
        px[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return img.resize((size, size), Image.NEAREST)


def down(img, size=SIZE):
    return img.resize((size, size), Image.LANCZOS)


def rounded(img, frac=CORNER):
    """Square icon with the platform's rounded corners baked in."""
    w = img.size[0]
    mask = Image.new('L', (w, w), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, w - 1),
                                           radius=round(w * frac), fill=255)
    out = img.convert('RGBA')
    out.putalpha(mask)
    return out


def circle(img):
    w = img.size[0]
    mask = Image.new('L', (w, w), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, w - 1, w - 1), fill=255)
    out = img.convert('RGBA')
    out.putalpha(mask)
    return out


def from_source(path):
    """Use a supplied logo file instead of the drawn reconstruction."""
    src = Image.open(path).convert('RGBA')
    if src.size[0] != src.size[1]:
        side = min(src.size)
        left = (src.size[0] - side) // 2
        topc = (src.size[1] - side) // 2
        src = src.crop((left, topc, left + side, topc + side))
    return src.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', help='PNG to derive every icon from '
                                     '(skips the drawn reconstruction)')
    args = ap.parse_args()

    print('generating icons:')
    bg_master = gradient(SIZE, BG_TOP, BG_BOTTOM).convert('RGBA')

    if args.source:
        full = from_source(args.source)
        # An adaptive foreground is cropped to roughly the centre 66%, so the
        # supplied square is scaled down and re-centred or the frame edges and
        # sprockets get shaved off by the launcher's mask.
        inner = full.resize((round(SIZE * 0.62),) * 2, Image.LANCZOS)
        fg_master = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
        off = (SIZE - inner.size[0]) // 2
        fg_master.paste(inner, (off, off), inner)
        print(f'  source: {args.source}')
    else:
        full = Image.alpha_composite(bg_master, down(draw_mark(1.0)))
        # Drawn at 0.62 so the mark itself sits inside the safe zone, rather
        # than shrinking the whole tile and leaving the artwork tiny.
        fg_master = down(draw_mark(0.62))
        print('  source: drawn reconstruction (pass --source to use the real file)')

    for bucket, factor in DENSITIES.items():
        dpath = os.path.join(RES, f'mipmap-{bucket}')
        os.makedirs(dpath, exist_ok=True)
        legacy = round(48 * factor)
        adaptive = round(108 * factor)

        down(rounded(full), legacy).save(os.path.join(dpath, 'ic_launcher.png'))
        down(circle(full), legacy).save(os.path.join(dpath, 'ic_launcher_round.png'))
        down(fg_master, adaptive).save(os.path.join(dpath, 'ic_launcher_foreground.png'))
        down(bg_master, adaptive).save(os.path.join(dpath, 'ic_launcher_background.png'))
        print(f'  mipmap-{bucket:<8} {legacy}px legacy, {adaptive}px adaptive')

    os.makedirs(WEB, exist_ok=True)
    p = os.path.join(WEB, 'frame_twelve_icon.png')
    down(rounded(full), 256).save(p)
    print(f'  {os.path.relpath(p)}  256px  (inline it with scripts/inline-icon.py)')


if __name__ == '__main__':
    main()

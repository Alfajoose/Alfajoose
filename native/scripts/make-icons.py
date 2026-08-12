#!/usr/bin/env python3
"""Generate the Frame Twelve icons.

The mark is three stacked cels receding into the distance — the app's own
onion-skin idea, which is what "frame by frame" means — with the active cel
carrying the numerals. Colours come from the web app's palette (--accent).

Writes the Android launcher icons at every density plus the web startup logo.
Everything is drawn at 4x and downsampled, because Pillow's shape drawing is
not antialiased.

    python3 scripts/make-icons.py
"""

import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, '..', 'android', 'app', 'src', 'main', 'res')
WEB = os.path.join(HERE, '..', '..', 'web')

# Regeneration should work off this machine too, so try a few well-known
# families before giving up on the numerals.
FONT_CANDIDATES = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/Library/Fonts/Arial Bold.ttf',
    'C:/Windows/Fonts/arialbd.ttf',
]

SS = 4                      # supersample factor
SIZE = 1024                 # master size, downsampled per density
S = SIZE * SS

ACCENT = (45, 82, 184)      # --accent #2d52b8
ACCENT_DEEP = (22, 40, 96)
WHITE = (255, 255, 255)

FW, FH = 462, 344           # frame geometry, in master pixels
RADIUS, STROKE, STEP = 38, 32, 62
LAYERS = [(0, 70), (1, 140), (2, 255)]   # back -> front, alpha

# The solid front cel carries the visual weight, so a bbox-centred stack reads
# as sitting low and right. Nudge the group back the other way.
OPTICAL = -20

# Android launcher densities: px per bucket for a 48dp icon, and 108dp for the
# adaptive layers.
DENSITIES = {
    'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4,
}


def load_font(px):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, px)
            except OSError:
                continue
    print('  ! no bold font found — drawing the mark without numerals')
    return None


def gradient(size, top, bottom):
    img = Image.new('RGB', (1, size), top)
    px = img.load()
    for y in range(size):
        t = y / max(1, size - 1)
        px[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return img.resize((size, size), Image.NEAREST)


def draw_stack(scale=1.0, numerals=True):
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    fw, fh = FW * scale * SS, FH * scale * SS
    step = STEP * scale * SS
    stroke = max(1, round(STROKE * scale * SS))
    radius = RADIUS * scale * SS

    x0 = (S - (fw + step * 2)) / 2 + OPTICAL * scale * SS
    y0 = (S - (fh + step * 2)) / 2 + OPTICAL * scale * SS

    for i, alpha in LAYERS:
        box = (x0 + step * i, y0 + step * i,
               x0 + step * i + fw, y0 + step * i + fh)

        if i != len(LAYERS) - 1:
            d.rounded_rectangle(box, radius=radius,
                                outline=WHITE + (alpha,), width=stroke)
            continue

        # Active cel: solid, giving the numerals a ground and the stack a
        # focal point instead of reading as a generic "duplicate" glyph.
        d.rounded_rectangle(box, radius=radius, fill=WHITE + (255,))
        if numerals:
            font = load_font(round(fh * 0.62))
            if font:
                d.text(((box[0] + box[2]) / 2, (box[1] + box[3]) / 2), '12',
                       font=font, fill=ACCENT + (255,), anchor='mm')
    return layer


def down(img, size=SIZE):
    return img.resize((size, size), Image.LANCZOS)


def circle_mask(img):
    """Round icon: the legacy pre-adaptive circular variant."""
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, S, S), fill=255)
    out = img.resize((S, S), Image.LANCZOS).convert('RGBA')
    out.putalpha(mask)
    return out


def main():
    print('generating icons:')
    bg_master = gradient(SIZE, ACCENT, ACCENT_DEEP).convert('RGBA')
    full = Image.alpha_composite(bg_master, down(draw_stack(1.0)))

    # Adaptive layers are 108dp with only the centre 72dp guaranteed visible,
    # so the mark is scaled to sit inside that safe zone.
    fg_master = down(draw_stack(0.62))

    for bucket, factor in DENSITIES.items():
        d = os.path.join(RES, f'mipmap-{bucket}')
        os.makedirs(d, exist_ok=True)

        legacy = round(48 * factor)      # ic_launcher / ic_launcher_round
        adaptive = round(108 * factor)   # foreground / background layers

        down(full, legacy).save(os.path.join(d, 'ic_launcher.png'))
        down(circle_mask(full), legacy).save(
            os.path.join(d, 'ic_launcher_round.png'))
        down(fg_master, adaptive).save(
            os.path.join(d, 'ic_launcher_foreground.png'))
        down(bg_master, adaptive).save(
            os.path.join(d, 'ic_launcher_background.png'))
        print(f'  mipmap-{bucket:<8} {legacy}px legacy, {adaptive}px adaptive')

    # The web app's startup logo, inlined into the HTML as a data URI.
    os.makedirs(WEB, exist_ok=True)
    p = os.path.join(WEB, 'frame_twelve_icon.png')
    down(full, 256).save(p)
    print(f'  {os.path.relpath(p)}  256px')


if __name__ == '__main__':
    main()

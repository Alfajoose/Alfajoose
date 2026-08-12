#!/usr/bin/env python3
"""Generate the Frame Twelve app icons.

The mark is three stacked frame outlines receding into the distance — the
app's own onion-skin idea, which is also what "frame by frame" means. Colours
come from the web app's palette (--accent / --a2).

Everything is drawn at 4x and downsampled, because Pillow's shape drawing is
not antialiased.

    python3 scripts/make-icons.py
"""

import os
from PIL import Image, ImageDraw, ImageFont

# Regeneration should work off this machine too, so try a few well-known
# families before giving up on the numerals.
FONT_CANDIDATES = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/Library/Fonts/Arial Bold.ttf',
    'C:/Windows/Fonts/arialbd.ttf',
]


def load_font(px):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, px)
            except OSError:
                continue
    print('  ! no bold font found — drawing the mark without numerals')
    return None

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, '..', 'assets')
WEB = os.path.join(HERE, '..', '..', 'web')

SS = 4            # supersample factor
SIZE = 1024
S = SIZE * SS

ACCENT = (45, 82, 184)     # --accent #2d52b8
ACCENT_DEEP = (22, 40, 96)
WHITE = (255, 255, 255)

# frame geometry, in final-image pixels
FW, FH = 462, 344
RADIUS = 38
STROKE = 32
STEP = 62                  # diagonal offset between stacked frames
# The solid front cel carries the visual weight, so a bbox-centred stack reads
# as sitting low and right. Nudge the group back the other way.
OPTICAL = -20
LAYERS = [(0, 70), (1, 140), (2, 255)]   # (index, alpha) back -> front


def gradient(size, top, bottom):
    """Vertical gradient."""
    img = Image.new('RGB', (1, size), top)
    px = img.load()
    for y in range(size):
        t = y / max(1, size - 1)
        px[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return img.resize((size, size), Image.NEAREST)


def draw_stack(scale=1.0, color=WHITE, numerals=True):
    """Transparent layer holding the three frames, centred."""
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    fw, fh = FW * scale * SS, FH * scale * SS
    step = STEP * scale * SS
    stroke = max(1, round(STROKE * scale * SS))
    radius = RADIUS * scale * SS

    span_w = fw + step * (len(LAYERS) - 1)
    span_h = fh + step * (len(LAYERS) - 1)
    x0 = (S - span_w) / 2 + OPTICAL * scale * SS
    y0 = (S - span_h) / 2 + OPTICAL * scale * SS

    for i, alpha in LAYERS:
        x, y = x0 + step * i, y0 + step * i
        box = (x, y, x + fw, y + fh)

        if i != len(LAYERS) - 1:
            # ghosted frames behind: outline only
            d.rounded_rectangle(box, radius=radius,
                                outline=color + (alpha,), width=stroke)
            continue

        # Active cel: solid, so the numerals have something to sit on and the
        # stack gains a clear focal point instead of reading as "duplicate".
        d.rounded_rectangle(box, radius=radius, fill=color + (255,))

        if numerals:
            font = load_font(round(fh * 0.62))
            if font:
                cx, cy = x + fw / 2, y + fh / 2
                # anchor='mm' centres on the glyph box, not the line box
                d.text((cx, cy), '12', font=font, fill=ACCENT + (255,),
                       anchor='mm')
    return layer


def down(img):
    return img.resize((SIZE, SIZE), Image.LANCZOS)


def save(img, path, size=None):
    if size:
        img = img.resize((size, size), Image.LANCZOS)
    img.save(path)
    print(f'  {os.path.relpath(path)}  {img.size[0]}x{img.size[1]}')


def main():
    os.makedirs(ASSETS, exist_ok=True)
    print('generating icons:')

    bg = gradient(SIZE, ACCENT, ACCENT_DEEP).convert('RGBA')

    # Full icon: gradient + full-size stack.
    full = Image.alpha_composite(bg, down(draw_stack(1.0)))
    save(full, os.path.join(ASSETS, 'icon.png'))
    save(full, os.path.join(ASSETS, 'favicon.png'), 48)

    # Android adaptive: foreground must stay inside the centre 66% safe zone,
    # since the launcher masks and can zoom the outer edge away.
    fg = down(draw_stack(0.62))
    save(fg, os.path.join(ASSETS, 'android-icon-foreground.png'))
    save(bg, os.path.join(ASSETS, 'android-icon-background.png'))

    # Monochrome (themed icons): solid white, no fill tint.
    mono = down(draw_stack(0.62, WHITE, numerals=False))
    save(mono, os.path.join(ASSETS, 'android-icon-monochrome.png'))

    # Splash: mark on transparent, app.json paints the background.
    save(down(draw_stack(0.55)), os.path.join(ASSETS, 'splash-icon.png'))

    # The web app's startup logo.
    os.makedirs(WEB, exist_ok=True)
    save(full, os.path.join(WEB, 'frame_twelve_icon.png'), 256)


if __name__ == '__main__':
    main()

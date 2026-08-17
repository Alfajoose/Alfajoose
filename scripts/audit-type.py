#!/usr/bin/env python3
"""Fail if the app's typography has drifted off its scale.

The stylesheet had accreted 21 font sizes between 7px and 26px and eleven font
weights including 650, 750, 780, 820 and 850. The weights were the more telling
half: the system UI faces this app actually renders in (Roboto on Android, Segoe
on Windows) have 400/500/700, so four of those numbers had no effect at all
beyond looking deliberate in the source. Precision with no visual consequence is
exactly what "generated" looks like.

Sizes and weights are literals rather than custom properties because most of
them live in JS-built inline styles where a var() reads worse than a number.
This script is the guard instead — cheaper than tokens and it catches the
inline styles too.

    python3 scripts/audit-type.py        # or: npm run audit:type

Exits non-zero and prints every offending line if anything is off-scale.
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
HTML = ROOT / 'web' / 'frame-twelve.html'

# The type scale. 10 is the floor: below that, text on a phone is decoration.
SIZES = {10, 11, 12, 13, 15, 18, 24}

# Sizes that set a GLYPH, not text — a '+', a stepper arrow, a grip, a fallback
# initial. They are icons that happen to be characters, so the type scale has no
# business governing them; they are listed so they cannot quietly become type.
GLYPH_SIZES = {14, 15, 16, 22, 26}

# 400 reading text, 500 labels, 600 buttons and section titles, 700 titles,
# primary actions, uppercase micro-labels and tiny badges.
WEIGHTS = {400, 500, 600, 700}

# One tracking value, and only on uppercase micro-labels — at 10-13px, tracking
# below half a pixel is a rounding error with a comment attached.
TRACKING = {'.4px'}


def main():
    src = HTML.read_text()
    bad = []

    for lineno, line in enumerate(src.split('\n'), 1):
        for m in re.finditer(r'font-size:([0-9.]+)px', line):
            v = float(m.group(1))
            v = int(v) if v == int(v) else v
            if v not in SIZES and v not in GLYPH_SIZES:
                bad.append((lineno, f'font-size:{m.group(1)}px', line))
        for m in re.finditer(r'font-weight:(\d+)', line):
            if int(m.group(1)) not in WEIGHTS:
                bad.append((lineno, f'font-weight:{m.group(1)}', line))
        for m in re.finditer(r'letter-spacing:([^;"\'}\s]+)', line):
            if m.group(1) not in TRACKING:
                bad.append((lineno, f'letter-spacing:{m.group(1)}', line))

    # The font stack has to name fonts the target platforms actually have. This
    # shipped as 'SF Pro Text' first, which exists on no Android device.
    stack = re.search(r'body\{[^}]*font-family:([^;}]+)', src)
    if stack and 'system-ui' not in stack.group(1):
        bad.append((0, 'body font stack does not start from system-ui', stack.group(1)))

    if bad:
        print(f'{len(bad)} off-scale declaration(s):\n')
        for lineno, what, line in bad:
            print(f'  {HTML.name}:{lineno}  {what}')
            print(f'      {line.strip()[:110]}')
        print('\nsizes  ', sorted(SIZES), '(+ glyphs', sorted(GLYPH_SIZES), ')')
        print('weights', sorted(WEIGHTS))
        print('tracking', sorted(TRACKING))
        sys.exit(1)

    sizes = sorted({float(x) for x in re.findall(r'font-size:([0-9.]+)px', src)})
    weights = sorted({int(x) for x in re.findall(r'font-weight:(\d+)', src)})
    print(f'on scale — sizes {[int(s) for s in sizes]}, weights {weights}')


if __name__ == '__main__':
    main()

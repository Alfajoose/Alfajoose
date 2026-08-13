#!/usr/bin/env python3
"""Inline web/frame_twelve_icon.png into frame-twelve.html as a data URI.

The app ships as one self-contained HTML file, so the icon cannot be a relative
path: it would resolve in neither the published Artifact nor the Android
WebView. It appears three times — the favicon, the apple-touch-icon and the
startup logo — and all three must stay in step, which is exactly the kind of
thing that rots when it is done by hand.

    python3 native/scripts/make-icons.py      # redraw / re-derive the PNG
    python3 scripts/inline-icon.py            # push it into the HTML

Refuses to write unless it replaced all three and the file still parses as the
same document otherwise.
"""

import base64
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
HTML = ROOT / 'web' / 'frame-twelve.html'
PNG = ROOT / 'web' / 'frame_twelve_icon.png'

EXPECTED = 3   # favicon, apple-touch-icon, startup logo


def main():
    if not PNG.exists():
        sys.exit(f'{PNG} not found — run native/scripts/make-icons.py first')

    b64 = base64.b64encode(PNG.read_bytes()).decode('ascii')
    html = HTML.read_text()

    # Only swap URIs that are plausibly the icon. A short data URI elsewhere in
    # the file (a cursor, a texture) must not be caught by this.
    pattern = re.compile(r'(data:image/png;base64,)[A-Za-z0-9+/=]{200,}')
    found = len(pattern.findall(html))
    if found != EXPECTED:
        sys.exit(f'expected {EXPECTED} icon data URIs, found {found} — refusing to write')

    out = pattern.sub(lambda m: m.group(1) + b64, html)

    # The only thing that may differ is the base64 payload.
    if len(pattern.findall(out)) != EXPECTED:
        sys.exit('substitution lost a URI — refusing to write')
    stripped_before = pattern.sub(r'\1<PAYLOAD>', html)
    stripped_after = pattern.sub(r'\1<PAYLOAD>', out)
    if stripped_before != stripped_after:
        sys.exit('the document changed outside the data URIs — refusing to write')

    HTML.write_text(out)
    kb = len(b64) * 3 / 4 / 1024
    print(f'inlined {PNG.name} ({kb:.1f} KB) into {EXPECTED} references')


if __name__ == '__main__':
    main()

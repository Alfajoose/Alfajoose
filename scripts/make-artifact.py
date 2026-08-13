#!/usr/bin/env python3
"""Build the claude.ai Artifact copy of Frame Twelve from web/frame-twelve.html.

Artifacts are wrapped in <!doctype html><head>...</head><body> at publish time,
so the page content must not carry its own document skeleton. This strips it and
keeps everything from <title> onward, then re-adds the viewport meta (Chrome
honours it outside <head>, and without it a phone lays the page out at 980px and
never reaches the touch breakpoint).
"""
import re, sys, pathlib

SRC = pathlib.Path('/home/user/Alfajoose/web/frame-twelve.html')
DST = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else
                   '/tmp/claude-0/-home-user-Alfajoose/8fd28bb2-9ed2-5d76-b135-1a3930ab6294/scratchpad/frame-twelve.html')

src = SRC.read_text()
VIEWPORT = ('<meta name="viewport" content="width=device-width,initial-scale=1.0,'
            'maximum-scale=1.0,user-scalable=no,viewport-fit=cover">')

i = src.index('<title>')
out = src[i:]

# Match only tags that are alone on a line: "<body>" also appears inside code
# comments, and blanking those would corrupt the script.
lines = out.split('\n')
for tag in ('</head>', '<body>', '</body>', '</html>'):
    hits = [n for n, l in enumerate(lines) if l is not None and l.strip() == tag]
    if len(hits) != 1:
        sys.exit(f'expected exactly one standalone {tag}, found {len(hits)} — refusing to guess')
    lines[hits[0]] = None
out = '\n'.join(l for l in lines if l is not None)

out = re.sub(r'(</title>)', r'\1\n' + VIEWPORT, out, count=1)
out = re.sub(r'\n{3,}', '\n\n', out).strip() + '\n'

# Same line-anchored test as above, so comments mentioning <body> don't trip it.
stripped = {l.strip() for l in out.split('\n')}
for bad in ('<!DOCTYPE html>', '<html lang="en">', '</head>', '<body>', '</body>', '</html>'):
    if bad in stripped:
        sys.exit(f'skeleton leaked into output: {bad}')
if '<title>' not in out[:200]:
    sys.exit('title must stay in the first 8KB')

DST.write_text(out)
print(f'{DST}  {len(out)/1024:.1f} KB')

#!/usr/bin/env python3
"""Subset the inlined Phosphor icon font + CSS down to the icons actually used."""
import base64, io, re, sys
from fontTools.subset import Subsetter, Options
from fontTools.ttLib import TTFont

SRC, DST = sys.argv[1], sys.argv[2]
html = open(SRC, encoding="utf-8").read()

# ---- split out the Phosphor <style> block (the first one) -------------------
s0 = html.index("<style>") + len("<style>")
s1 = html.index("</style>", s0)
phosphor_css = re.sub(r"/\*.*?\*/", "", html[s0:s1], flags=re.S)   # strip comments
app_html = html[s1:]                      # app css + markup + js

# ---- collect icon names the app actually references ------------------------
used = set()
for m in re.finditer(r"\bph-([a-z0-9][a-z0-9-]*)", app_html):      # class="ph-bold ph-x"
    if m.group(1) not in ("bold", "fill", "duotone", "thin", "light"):
        used.add(m.group(1))
for m in re.finditer(r"""\bicon\(\s*["']([a-z0-9][a-z0-9-]*)["']""", app_html):
    used.add(m.group(1))                                            # icon("push-pin", ...)
feats = re.search(r"const features = \[(.*?)\n    \];", app_html, re.S)
if feats:                                                           # ["Tables","..","✓","table"]
    used |= set(re.findall(r'"([a-z0-9][a-z0-9-]*)"\s*\]', feats.group(1)))

WEIGHTS = {"": "Phosphor", "-bold": "Phosphor-Bold",
           "-fill": "Phosphor-Fill", "-duotone": "Phosphor-Duotone"}

RULE = re.compile(r"([^{}]+)\{([^{}]*)\}", re.S)
ICON = re.compile(r"^\.ph(-bold|-fill|-duotone)?\.ph-([a-z0-9-]+):(before|after)$")
BASE = re.compile(r"^\.ph(-bold|-fill|-duotone)?$")
CP = re.compile(r'content:\s*"\\([0-9a-fA-F]+)"')

kept, faces, codepoints = [], {}, {f: set() for f in WEIGHTS.values()}
seen = set()

for m in RULE.finditer(phosphor_css):
    sel, body = m.group(1).strip(), m.group(2)
    if sel == "@font-face":
        faces[re.search(r'font-family:\s*"([^"]+)"', body).group(1)] = body
        continue
    if BASE.match(sel):                                   # .ph / .ph-bold / ...
        kept.append((WEIGHTS[BASE.match(sel).group(1) or ""], sel, body))
        continue
    im = ICON.match(sel)
    if not im:
        kept.append((None, sel, body))
        continue
    fam, name = WEIGHTS[im.group(1) or ""], im.group(2)
    seen.add(name)
    if name not in used:
        continue
    if (cp := CP.search(body)):
        codepoints[fam].add(int(cp.group(1), 16))
    kept.append((fam, sel, body))

if (missing := sorted(n for n in used if n not in seen)):
    print(f"  note: not Phosphor icon names, ignored -> {missing}")

# ---- subset each font ------------------------------------------------------
def subset(b64, unicodes):
    raw = base64.b64decode(b64)
    font = TTFont(io.BytesIO(raw))
    opts = Options()
    opts.layout_features = []          # CSS uses \eXXX codepoints, not ligatures
    opts.drop_tables += ["DSIG", "FFTM"]
    opts.desubroutinize = True
    s = Subsetter(options=opts); s.populate(unicodes=unicodes); s.subset(font)
    font.flavor = "woff2"
    out = io.BytesIO(); font.save(out)
    return base64.b64encode(out.getvalue()).decode("ascii"), len(raw), out.tell()

new_faces, before_t, after_t = {}, 0, 0
for fam, body in faces.items():
    b64 = re.search(r"base64,([A-Za-z0-9+/=]+)", body).group(1)
    before_t += len(base64.b64decode(b64))
    if not codepoints[fam]:
        print(f"  {fam:18} dropped entirely (no icons used)")
        continue
    nb64, before, after = subset(b64, codepoints[fam])
    new_faces[fam] = re.sub(r"base64,[A-Za-z0-9+/=]+", "base64," + nb64, body)
    after_t += after
    print(f"  {fam:18} {len(codepoints[fam]):3d} glyphs  {before/1024:7.1f}KB -> {after/1024:5.1f}KB")

# ---- re-emit the style block ----------------------------------------------
out = [f"\n/* Phosphor Icons 2.1.1 — subset to the {len(seen & used)} icons this app uses. */\n"]
out += [f"@font-face {{{b}}}\n" for b in new_faces.values()]
out += [f"{sel} {{{body}}}\n" for fam, sel, body in kept if fam is None or fam in new_faces]

open(DST, "w", encoding="utf-8").write(html[:s0] + "".join(out) + app_html)
print(f"\n  icons kept: {len(seen & used)}   fonts {before_t/1024:.0f}KB -> {after_t/1024:.0f}KB")

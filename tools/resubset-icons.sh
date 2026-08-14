#!/bin/bash
# Re-subset icons: splice the full Phosphor block from the original upload onto
# the current app, then prune to whatever icons the app now references.
set -e
ORIG="/root/.claude/uploads/a6c4ea61-65e8-5c10-8483-2ba4318618ad/5328bfa6-notepadproresizablestacks.html"
CUR="/home/user/Alfajoose/web/notepad-pro.html"
DIR="$(dirname "$0")"
python3 - "$ORIG" "$CUR" "$DIR/full.html" <<'PY'
import sys
orig, cur, out = sys.argv[1], sys.argv[2], sys.argv[3]
o = open(orig, encoding="utf-8").read()
c = open(cur,  encoding="utf-8").read()
# full Phosphor <style>…</style> from the original
o0 = o.index("<style>"); o1 = o.index("</style>", o0) + len("</style>")
# current file's everything-after-the-icon-style
c0 = c.index("<style>"); c1 = c.index("</style>", c0) + len("</style>")
open(out, "w", encoding="utf-8").write(c[:c0] + o[o0:o1] + c[c1:])
PY
python3 "$DIR/subset.py" "$DIR/full.html" "$CUR"

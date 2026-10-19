#!/bin/sh
# Genera una página HTML autocontenida con el visual real y datos de ejemplo.
set -e
OUT=${1:-preview.html}
npx lessc style/visual.less /tmp/lfm.css
npx esbuild harness/main.ts --bundle --minify --format=iife --target=es2020 --loader:.less=empty --outfile=/tmp/lfm.js --log-level=warning
python3 harness/assemble.py /tmp/lfm.js /tmp/lfm.css harness/page.html "$OUT"

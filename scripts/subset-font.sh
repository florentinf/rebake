#!/bin/sh
# Rebuilds the self-hosted font: Hanken Grotesk, wght axis limited to the
# weights the UI uses, Latin only. Needs fonttools + brotli in .venv.
set -eu
SRC=node_modules/@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2
OUT=src/assets/fonts
TMP=$(mktemp -d)
.venv/bin/fonttools varLib.instancer "$SRC" wght=400:600 -o "$TMP/limited.ttf"
.venv/bin/pyftsubset "$TMP/limited.ttf" \
  --unicodes="U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+2013-2014,U+2018-201A,U+201C-201E,U+2022,U+2026,U+2190-2193,U+2212" \
  --layout-features='kern,liga,calt,tnum,lnum,ss01,case' \
  --flavor=woff2 --output-file="$OUT/hanken-grotesk.woff2"
rm -rf "$TMP"
ls -l "$OUT"

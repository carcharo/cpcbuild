#!/bin/sh
# R8 spike (2026-10-09): CPCEC compiled to WebAssembly with Emscripten's SDL2
# port and ASYNCIFY, unchanged apart from a console fps meter
# (fpsmeter.patch). Copies the pinned, patched checkout made by
# ../fetch_build.sh to work/wasm/src, applies the meter, and builds
# work/wasm/out/index.html (+ .js, .wasm, .data) with the ROMs and one media
# file preloaded. GPLv3 like CPCEC; see docs/notes.md (R8).
#
#   EMSDK=/path/to/emsdk sh tools/cpcec/wasm/build.sh FILE.cpr|FILE.dsk
#   cd tools/cpcec/work/wasm/out && python3 -m http.server 8765
#   then open http://127.0.0.1:8765/index.html (click the picture for sound)
#
# Needs an activated emsdk (git clone https://github.com/emscripten-core/emsdk;
# ./emsdk install latest; ./emsdk activate latest). Tested with Emscripten's
# SDL2 port release-2.32.10.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
MEDIA=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
[ -n "$EMSDK" ] || { echo "build.sh: set EMSDK to an activated emsdk" >&2; exit 1; }
. "$EMSDK/emsdk_env.sh" >/dev/null 2>&1
W=$HERE/../work/wasm
[ -d "$HERE/../work/src" ] || { echo "build.sh: run tools/cpcec/fetch_build.sh first" >&2; exit 1; }
rm -rf "$W/src" && mkdir -p "$W/out" && cp -R "$HERE/../work/src" "$W/src"
(cd "$W/src" && git apply "$HERE/fpsmeter.patch")
NAME=$(basename "$MEDIA")
case "$NAME" in *.cpr|*.CPR) ARGS="'-m3', '-O', '/$NAME'" ;; *) ARGS="'-O', '/$NAME'" ;; esac
echo "Module.arguments = [$ARGS];" > "$W/pre.js"
cd "$W/src"
emcc -w -DSDL2 -O2 -xc cpcec.c -sUSE_SDL=2 -sASYNCIFY -sALLOW_MEMORY_GROWTH -sINITIAL_MEMORY=256MB \
  --preload-file cpc6128.rom --preload-file cpc464.rom --preload-file cpc664.rom \
  --preload-file cpcados.rom --preload-file cpcplus.rom \
  --preload-file "$MEDIA@/$NAME" --pre-js "$W/pre.js" -o "$W/out/index.html"
ls -l "$W/out"

#!/bin/sh
# Phase 8 (stream D1): CPCEC compiled to WebAssembly with our own SDL-free, ASYNCIFY-free
# front end, for the cpcbuild-emu extension.
#
# Copies the pinned, cpcbuild-patched CPCEC source that tools/cpcec/fetch_build.sh (make cpcec)
# left in tools/cpcec/work/src (in a git worktree: the main checkout's) to tools/cpcec/work/wasm-host/src, applies host.patch (cpcec.c and
# cpcec-rt.h include cpcec-wasm.h instead of the SDL2 front end, and main()'s loop becomes
# cpcec_frame()), adds cpcec-wasm.h (the front end) and cpcec-wasm-api.h (the emu_* exports),
# and builds with emcc -O2 to vscode/cpcbuild-emu/wasm/cpcec.js + cpcec.wasm: a MODULARIZE=1
# ES module (createCpcec) for Node and browsers. Nothing is preloaded: the host writes the
# ROMs (and any media) into the module's file system, see the header of cpcec-wasm-api.h.
# The R8 SDL2+ASYNCIFY build (build.sh) is untouched and stays the reference.
#
#   EMSDK=/path/to/emsdk sh tools/cpcec/wasm/build-host.sh      (EMSDK optional if emcc is on PATH)
#
# GPLv3 like CPCEC (see the headers of the files this builds from).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
WORK=$HERE/../work
OUT=${OUT:-$ROOT/vscode/cpcbuild-emu/wasm}
SRC=$WORK/src
if [ ! -f "$SRC/cpcec.c" ]; then # a git worktree has no work/: the (git-ignored) one is in the main checkout
    COMMON=$(git -C "$ROOT" rev-parse --git-common-dir 2>/dev/null || true)
    [ -n "$COMMON" ] && MAIN=$(cd "$ROOT" && cd "$COMMON/.." && pwd) && [ -f "$MAIN/tools/cpcec/work/src/cpcec.c" ] && SRC=$MAIN/tools/cpcec/work/src
fi
[ -f "$SRC/cpcec.c" ] && [ -f "$SRC/cpcec-cb.h" ] || { echo "build-host.sh: tools/cpcec/work/src is missing (or not patched): run make cpcec" >&2; exit 1; }
if [ -n "$EMSDK" ]; then . "$EMSDK/emsdk_env.sh" >/dev/null 2>&1; elif [ -f "$HERE/emsdk/emsdk_env.sh" ]; then . "$HERE/emsdk/emsdk_env.sh" >/dev/null 2>&1; fi
command -v emcc >/dev/null || { echo "build-host.sh: emcc not found: set EMSDK to an activated emsdk" >&2; exit 1; }

B=$WORK/wasm-host
rm -rf "$B/src" && mkdir -p "$B" "$OUT"
# the sources only (no .git, no binaries)
mkdir "$B/src" && (cd "$SRC" && tar cf - --exclude .git --exclude cpcec --exclude '*.o' .) | (cd "$B/src" && tar xf -)
cd "$B/src"
patch -p1 --binary -s < "$HERE/host.patch" || { echo "build-host.sh: host.patch does not apply (was the pin in fetch_build.sh moved?)" >&2; exit 1; }
cp "$HERE/cpcec-wasm.h" "$HERE/cpcec-wasm-api.h" .

emcc -w -DCPCEC_WASM -O2 -xc cpcec.c \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createCpcec -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=1048576 --no-entry \
  -sEXPORTED_RUNTIME_METHODS=FS,HEAPU8,stringToUTF8,lengthBytesUTF8,UTF8ToString \
  -sEXPORTED_FUNCTIONS=_malloc,_free \
  -o "$OUT/cpcec.js"
# the loader is an ES module: say so for Node, next to it (no effect on the extension's own package.json)
printf '{ "type": "module" }\n' > "$OUT/package.json"
cp "$SRC/gpl.txt" "$OUT/gpl.txt" 2>/dev/null || true
ls -l "$OUT"

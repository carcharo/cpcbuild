#!/bin/sh
# Builds source/cpcbuild-emu-source.tar.gz, the "corresponding source" the GPLv3 asks for, shipped inside the .vsix:
#   cpcec/        CPCEC at the pinned commit exactly as fetched (git archive of tools/cpcec/work/src's pin: unpatched)
#   cpcbuild/     our changes and the way to rebuild: cpcbuild.patch, host.patch, cpcec-wasm.h, cpcec-wasm-api.h,
#                 fetch_build.sh, build-host.sh, ... (tools/cpcec) and this extension's source (vscode/cpcbuild-emu)
#   BUILDING.txt  how the .wasm in the extension is made from these
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
EXT=$(cd "$HERE/.." && pwd)
ROOT=$(cd "$EXT/../.." && pwd)
SRC=$ROOT/tools/cpcec/work/src
if [ ! -d "$SRC/.git" ]; then # a git worktree has no work/: the (git-ignored) one is in the main checkout
    COMMON=$(git -C "$ROOT" rev-parse --git-common-dir 2>/dev/null || true)
    [ -n "$COMMON" ] && MAIN=$(cd "$ROOT" && cd "$COMMON/.." && pwd) && [ -d "$MAIN/tools/cpcec/work/src/.git" ] && SRC=$MAIN/tools/cpcec/work/src
fi
[ -d "$SRC/.git" ] || { echo "make-source.sh: tools/cpcec/work/src (a git checkout of CPCEC) is missing: run make cpcec" >&2; exit 1; }
SHA=$(sed -n 's/^SHA=\([0-9a-f]\{40\}\).*/\1/p' "$ROOT/tools/cpcec/fetch_build.sh")
[ "$(git -C "$SRC" rev-parse "$SHA^{commit}")" = "$SHA" ] || { echo "make-source.sh: the CPCEC checkout does not have the pinned commit $SHA" >&2; exit 1; }

T=$(mktemp -d "${TMPDIR:-/tmp}/cpcemu-src.XXXXXX")
trap 'rm -rf "$T"' EXIT
D=$T/cpcbuild-emu-source
mkdir -p "$D/cpcec" "$D/cpcbuild/tools/cpcec/wasm" "$D/cpcbuild/vscode/cpcbuild-emu"
git -C "$SRC" archive "$SHA" | tar -xf - -C "$D/cpcec"
cp "$ROOT/tools/cpcec/fetch_build.sh" "$ROOT/tools/cpcec/cpcbuild.patch" "$ROOT/tools/cpcec/README.md" "$D/cpcbuild/tools/cpcec/"
for f in "$ROOT"/tools/cpcec/wasm/*.sh "$ROOT"/tools/cpcec/wasm/*.h "$ROOT"/tools/cpcec/wasm/*.patch; do cp "$f" "$D/cpcbuild/tools/cpcec/wasm/"; done
(cd "$EXT" && tar -cf - --exclude node_modules --exclude dist --exclude out --exclude .vscode-test --exclude source \
    --exclude wasm --exclude media --exclude '*.vsix' --exclude test/.media --exclude LICENSE \
    src scripts test package.json package-lock.json tsconfig.json tsconfig.test.json vitest.config.mjs README.md .vscodeignore .gitignore) \
  | tar -xf - -C "$D/cpcbuild/vscode/cpcbuild-emu"
cp "$EXT/LICENSE" "$D/LICENSE" 2>/dev/null || cp "$SRC/gpl.txt" "$D/LICENSE"
cat > "$D/BUILDING.txt" <<EOT
CPCBuild Emulator: corresponding source (GNU GPL v3 or later)

cpcec/     CPCEC (c) Cesar Nicolas-Gonzalez, commit $SHA of https://github.com/cpcitor/cpcec, unmodified.
cpcbuild/  CPCBuild's changes: tools/cpcec/cpcbuild.patch (long options, test hooks), tools/cpcec/wasm/host.patch
           (main() split into cpcec_frame()), cpcec-wasm.h (the SDL-free front end), cpcec-wasm-api.h (the emu_*
           exports), and the extension itself (vscode/cpcbuild-emu).

Rebuilding wasm/cpcec.js and wasm/cpcec.wasm:
  1. apply cpcbuild.patch to cpcec/ (git apply tools/cpcec/cpcbuild.patch), see fetch_build.sh;
  2. with an activated Emscripten SDK, run tools/cpcec/wasm/build-host.sh: it copies the patched tree, applies
     host.patch, adds the two headers and runs emcc -O2 -DCPCEC_WASM (the command line is in that script).
The ROM images in media/roms are the firmware files that come with CPCEC (cpc464.rom, cpc664.rom, cpc6128.rom,
cpcplus.rom, cpcados.rom).
EOT
mkdir -p "$EXT/source"
tar -czf "$EXT/source/cpcbuild-emu-source.tar.gz" -C "$T" cpcbuild-emu-source
ls -l "$EXT/source/cpcbuild-emu-source.tar.gz"

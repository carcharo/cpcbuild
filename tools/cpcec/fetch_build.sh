#!/bin/sh
# Fetch CPCEC (Cesar Nicolas-Gonzalez, GPLv3; github.com/cpcitor/cpcec is the
# mirror) at a pinned commit and build it with SDL2. Everything lands in
# tools/cpcec/work/ (git-ignored): the sources, the ROM files that ship with
# them, and the `cpcec` binary. Nothing of CPCEC is vendored here: only our
# small patch (cpcbuild.patch, GPLv3 like CPCEC itself) is kept in the repo and
# applied to the pinned checkout. It adds long options for unattended test
# runs (--headless, --printer, --shot-dir, --max-frames ...; see the README).
#
#   sh tools/cpcec/fetch_build.sh      then   tools/cpcec/work/cpcec -m3 FILE.cpr
#
# Needs git, a C compiler and SDL2 (macOS: brew install sdl2).
set -e
SHA=c025aab961a796b918cc99bc3e16216ea65bb5d1   # cpcitor/cpcec master, release 20260303
cd "$(dirname "$0")"
HERE=$(pwd)
mkdir -p work
cd work
if [ ! -d src/.git ]; then
    git clone -q https://github.com/cpcitor/cpcec src
fi
if [ "$(git -C src rev-parse HEAD)" != "$SHA" ]; then
    git -C src fetch -q origin "$SHA" 2>/dev/null || git -C src fetch -q origin
    git -C src checkout -q "$SHA"
fi
cd src
# apply our patch unless the tree already has it (re-runs); a tree that has
# neither state (an edited checkout, or a pin moved without refreshing the
# patch) is a hard error rather than a silent half-patched build
if git apply --reverse --check "$HERE/cpcbuild.patch" 2>/dev/null; then
    :
elif git apply --check "$HERE/cpcbuild.patch" 2>/dev/null; then
    git apply "$HERE/cpcbuild.patch"
else
    echo "fetch_build.sh: cpcbuild.patch does not apply to CPCEC $SHA." >&2
    echo "  If work/src was edited, delete tools/cpcec/work/src and run again;" >&2
    echo "  if SHA was changed, the patch needs rebasing onto the new commit." >&2
    exit 1
fi
# cpcec.c includes <SDL2/SDL.h>, which `sdl2-config --cflags` (it names the
# SDL2 directory itself) doesn't cover: add the parent include directory.
INC=
for d in /opt/homebrew/include /usr/local/include; do
    [ -d "$d/SDL2" ] && INC="$INC -I$d"
done
# shellcheck disable=SC2046
cc -w -DSDL2 -O2 -xc cpcec.c $INC $(sdl2-config --cflags) $(sdl2-config --libs) -o cpcec
# the binary looks for its ROM files (cpc464/664/6128.rom, cpcados.rom,
# cpcplus.rom) in its own directory: run it from the source directory's copy
cp cpcec ../cpcec
for f in cpc464.rom cpc664.rom cpc6128.rom cpcados.rom cpcplus.rom; do cp "$f" ..; done
cp gpl.txt ../LICENSE.cpcec-gpl3
echo "cpcec at $(git rev-parse HEAD): $(cd .. && pwd)/cpcec"

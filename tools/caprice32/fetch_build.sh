#!/bin/sh
# Fetch Caprice32 (ColinPitrat/caprice32, GPLv2) at a pinned commit, apply our
# patch and build `cap32`. Everything lands in tools/caprice32/work/ (git-
# ignored); nothing of Caprice32 is vendored here, only caprice32-asic-regs.patch
# (GPLv2 like Caprice32), which keeps the Plus ASIC's DMA/DCSR registers out of
# program RAM (see README.md).
#
#   sh tools/caprice32/fetch_build.sh      then   tools/caprice32/work/src/cap32
#
# The binary stays in the source tree: it finds rom/ and cap32.cfg.tmpl beside
# itself, which is what tools/cpcrun.py expects.
# Needs git, make, g++, pkg-config, SDL2, FreeType, libpng and zlib
# (macOS: brew install sdl2 freetype libpng pkg-config;
#  Debian/Ubuntu: apt-get install g++ make pkg-config libsdl2-dev libfreetype6-dev zlib1g-dev libpng-dev).
set -e
SHA=6c12c4c92360065cdc229ac9ada7551f941436b8   # keep in sync with caprice32-sha in .github/actions/setup/action.yml
PATCH=caprice32-asic-regs.patch
cd "$(dirname "$0")"
HERE=$(pwd)
mkdir -p work
cd work
if [ ! -d src/.git ]; then
    git clone -q https://github.com/ColinPitrat/caprice32 src
fi
if [ "$(git -C src rev-parse HEAD)" != "$SHA" ]; then
    git -C src fetch -q origin "$SHA" 2>/dev/null || git -C src fetch -q origin
    git -C src checkout -q "$SHA"
fi
cd src
# apply our patch unless the tree already has it (re-runs); a tree that has
# neither state (an edited checkout, or a pin moved without refreshing the
# patch) is a hard error rather than a silent half-patched build
if git apply --reverse --check "$HERE/$PATCH" 2>/dev/null; then
    :
elif git apply --check "$HERE/$PATCH" 2>/dev/null; then
    git apply "$HERE/$PATCH"
else
    echo "fetch_build.sh: $PATCH does not apply to Caprice32 $SHA." >&2
    echo "  If work/src was edited, delete tools/caprice32/work/src and run again;" >&2
    echo "  if SHA was changed, the patch needs rebasing onto the new commit." >&2
    exit 1
fi
JOBS=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)
if [ "$(uname -s)" = Darwin ]; then
    make -j"$JOBS" ARCH=macos APP_PATH="$PWD" cap32
else
    make -j"$JOBS" cap32
fi
echo "caprice32 at $(git rev-parse HEAD) + $PATCH: $PWD/cap32"

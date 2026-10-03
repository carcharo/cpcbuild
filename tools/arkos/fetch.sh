#!/bin/sh
# Download the pinned Arkos / Rasm / Disark tools into tools/arkos/work/
# (gitignored). Idempotent; verifies SHA-256 of every download.
#
#   Arkos Tracker 3.7  (player sources, SongToAkg & friends, MIT)
#   Rasm 3.3           (Z80 assembler)
#   Disark 2.0.0       (Z80 disassembler / source converter)
#
# macOS (arm64/x86_64) and Linux x86_64 only. On macOS the downloaded
# binaries are ad-hoc re-signed (codesign --force --sign -): as shipped, the
# AT3 tools and Disark hang forever in the kernel at exec on current macOS
# (uninterruptible, unkillable); a local ad-hoc signature fixes it.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
W=$HERE/work
mkdir -p "$W/bin" "$W/dl"

case "$(uname -s)" in
  Darwin)
    AT_URL=https://www.julien-nevo.com/arkostracker/release/3.7/macosx/ArkosTracker-macosx-3.7.zip
    AT_SHA=cf00cdfba8d09bfaea2b46a01c6db1f9fff521f608a80d04ec99c3d4991ed217
    DK_URL=https://julien-nevo.com/disark/release/2.0.0/macosx/Disark-macosx-2.0.0.zip
    DK_SHA=5f490f69710bafdabb60df9d3014e51a6561d04d83f946e97e76ab9a277f8751
    RASM_URL=https://github.com/EdouardBERGE/rasm/releases/download/v3.3/rasm.macOS
    RASM_SHA=54b2fd38d96efa024d455683bdf6ae85436cd44a53fcd6bd95aaf551ecc67d95 ;;
  Linux)
    AT_URL=https://www.julien-nevo.com/arkostracker/release/3.7/linux64/ArkosTracker-linux64-3.7.zip
    AT_SHA=7e22d5762a611a09f21e83fa07cef0aeddc37fc28e159b67e2e0a949617024cf
    DK_URL=https://julien-nevo.com/disark/release/2.0.0/linux64/Disark-linux64-2.0.0.zip
    DK_SHA=1311b9a41f4fa113b69f04e201619952183b9f71a42e4f47b09efb44a5397fc6
    # No Linux release binary: built from the v3.3 source tarball.
    RASM_URL=https://github.com/EdouardBERGE/rasm/archive/refs/tags/v3.3.tar.gz
    RASM_SHA=3b7f352f7584b4a71fb2038e5b40a5058b65aaf04c5a8ef007ae961f4270297a ;;
  *) echo "unsupported OS" >&2; exit 1 ;;
esac

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
get() { # url sha dest
  if [ ! -f "$3" ] || [ "$(sha256 "$3")" != "$2" ]; then
    echo "download $1"; curl -fsSL "$1" -o "$3"
  fi
  [ "$(sha256 "$3")" = "$2" ] || { echo "SHA-256 mismatch for $3" >&2; exit 1; }
}

get "$AT_URL" "$AT_SHA" "$W/dl/at3.zip"
get "$DK_URL" "$DK_SHA" "$W/dl/disark.zip"
get "$RASM_URL" "$RASM_SHA" "$W/dl/rasm.dl"

if [ ! -d "$W/at3" ]; then
  mkdir -p "$W/at3.tmp" && unzip -q -o "$W/dl/at3.zip" -d "$W/at3.tmp"
  mv "$W/at3.tmp"/* "$W/at3" && rmdir "$W/at3.tmp"
fi
if [ ! -x "$W/bin/disark" ]; then
  mkdir -p "$W/dk.tmp" && unzip -q -o "$W/dl/disark.zip" -d "$W/dk.tmp"
  cp "$(find "$W/dk.tmp" -type f -name 'disark*' ! -name '*.zip' | head -1)" "$W/bin/disark"
  rm -rf "$W/dk.tmp"; chmod +x "$W/bin/disark"
fi
if [ ! -x "$W/bin/rasm" ]; then
  if [ "$(uname -s)" = Darwin ]; then
    cp "$W/dl/rasm.dl" "$W/bin/rasm"
  else
    rm -rf "$W/rasm-src"; mkdir -p "$W/rasm-src"
    tar xzf "$W/dl/rasm.dl" -C "$W/rasm-src" --strip-components=1
    (cd "$W/rasm-src" && cc -O2 -o "$W/bin/rasm" rasm.c -lm -lrt -lpthread)
  fi
  chmod +x "$W/bin/rasm"
fi
# AT3 command-line tools: link into bin/.
for t in SongToAkg SongToSoundEffects Z80Profiler; do
  f=$(find "$W/at3" -type f -name "$t" | head -1)
  [ -n "$f" ] && { cp "$f" "$W/bin/$t"; chmod +x "$W/bin/$t"; }
done
if [ "$(uname -s)" = Darwin ]; then
  for t in disark SongToAkg SongToSoundEffects Z80Profiler; do
    [ -f "$W/bin/$t" ] && codesign --force --sign - "$W/bin/$t" 2>/dev/null
  done
fi
echo "tools ready in $W/bin:"; ls "$W/bin"

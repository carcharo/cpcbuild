#!/bin/sh
# Fetch the ZX Spectrum ROMs used by zxrun into ./zxroms/ (gitignored).
#
# Source: floooh/chips-test (the test/demo repo of the chips emulator
# library), examples/roms/, at a pinned commit. They are the original
# Sinclair/Amstrad ROM images, byte-identical to the 48.rom, 128-0.rom and
# 128-1.rom that the FUSE emulator ships (SHA-1s below are checked):
#   amstrad_zx48k.bin    -> 48.rom     5ea7c2b824672e914525d1d5c419d71b84a426a2
#   amstrad_zx128k_0.bin -> 128-0.rom  4f4b11ec22326280bdb96e3baf9db4b4cb1d02c5
#   amstrad_zx128k_1.bin -> 128-1.rom  80080644289ed93d71a1103992a154cc9802b2fa
#
# Permission: Amstrad (rights since passed to Sky) gave permission, in 1999
# and since, for the 48K, 128K, +2 ROM images to be distributed with
# emulators, on condition that the copyright notice stays with them
# ("Amstrad have kindly given their permission for the redistribution of
# their copyrighted material but retain that copyright"). The ROMs are
# still copyrighted: they are fetched here, never committed to this repo.
# (The +3 ROMs are not covered by that permission and are not used.)
set -e
SHA=dc7176cfc5b6f2fe7db795b82f4e592dd6faae7a   # floooh/chips-test master, 2026-10-03
BASE=https://raw.githubusercontent.com/floooh/chips-test/$SHA/examples/roms
cd "$(dirname "$0")"
mkdir -p zxroms
sha1() { shasum -a 1 "$1" | cut -d' ' -f1; }
get() {   # remote name, local name, sha1
    if [ -f "zxroms/$2" ] && [ "$(sha1 "zxroms/$2")" = "$3" ]; then return; fi
    curl -fsSL "$BASE/$1" -o "zxroms/$2.tmp"
    if [ "$(sha1 "zxroms/$2.tmp")" != "$3" ]; then
        echo "fetch_zxroms: $2: unexpected SHA-1" >&2; rm -f "zxroms/$2.tmp"; exit 1
    fi
    mv "zxroms/$2.tmp" "zxroms/$2"
}
get amstrad_zx48k.bin    48.rom    5ea7c2b824672e914525d1d5c419d71b84a426a2
get amstrad_zx128k_0.bin 128-0.rom 4f4b11ec22326280bdb96e3baf9db4b4cb1d02c5
get amstrad_zx128k_1.bin 128-1.rom 80080644289ed93d71a1103992a154cc9802b2fa
cat > zxroms/README <<'EOT'
Sinclair ZX Spectrum 48K / 128K ROMs, (c) Amstrad plc (now Sky), redistributed
with emulators by Amstrad's permission. Fetched by ../fetch_zxroms.sh; do not
commit.
EOT
echo "zx roms in $(pwd)/zxroms"

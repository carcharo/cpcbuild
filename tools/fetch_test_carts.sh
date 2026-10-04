#!/bin/sh
# Test cartridges for manual Plus cross-checks, into tools/arnold/ (git-ignored;
# binaries stay out of the repo).
#
#   sh tools/fetch_test_carts.sh --diag        llopis/amstrad-diagnostics v1.3 (MIT):
#       AmstradDiag.cpr, tests RAM, ROMs, keyboard, CRTC model (not the ASIC)
#   sh tools/fetch_test_carts.sh --roudoudou   Roudoudou's real-hardware-verified Plus
#       cartridges (atboot, dma, split, sprites, stress; CPCWiki)
#   sh tools/fetch_test_carts.sh [FILE.zip|FILE.cpr]   Amstrad's Arnold V diagnostic
#       (below): unpack a manually downloaded copy
#
# Amstrad's "Arnold V" (Arnold 5) diagnostic cartridge is Amstrad's copyrighted
# software: never commit it. ("Arnold" is Amstrad's codename for the Plus range;
# this is not the Arnold emulator.)
#
# The only public source we found is CPC-Power's CPC-Softs entry 9627, "Arnold 5
# Diagnostic Rom Version 1.3 (UK) (1990)", whose download sits behind a
# letter-order CAPTCHA, so it cannot be scripted (and we don't try to get round
# it). Download it by hand from
#   https://www.cpc-power.com/index.php?page=detail&onglet=dumps&num=9627
# (the .cpr part, CRC32 0B01AF8C, or the whole zip), then run this script with the
# downloaded file: it unpacks it into tools/arnold/ and checks the CRC32.
#
# Also fetches (no CAPTCHA) Roudoudou's real-hardware-verified Plus cartridges
# (atboot, dma, split, sprites, stress; CPCWiki) with `--roudoudou`.
set -e
# resolve a path argument before changing directory
case "$1" in
    ""|--*) ;;
    *) ARG="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; shift; set -- "$ARG" ;;
esac
cd "$(dirname "$0")"
mkdir -p arnold
WANT_CRC=0b01af8c
crc32() { python3 -c 'import sys,zlib;print("%08x"%(zlib.crc32(open(sys.argv[1],"rb").read())&0xffffffff))' "$1"; }

if [ "$1" = "--diag" ]; then
    gh release download v1.3 -R llopis/amstrad-diagnostics -p AmstradDiag.zip -D arnold --clobber
    (cd arnold && unzip -o -q AmstradDiag.zip 'AmstradDiag.cpr' && ls -l AmstradDiag.cpr)
    exit 0
fi

if [ "$1" = "--roudoudou" ]; then
    curl -fsSL -A "Mozilla/5.0" -o arnold/Roudoudou_CPR_tests.zip \
        https://oldwiki.cpcwiki.eu/imgs/2/27/Roudoudou_CPR_tests.zip
    (cd arnold && unzip -o -q Roudoudou_CPR_tests.zip '*.cpr' && ls -l *.cpr)
    exit 0
fi

if [ -z "$1" ]; then
    if ls arnold/*.cpr >/dev/null 2>&1; then ls -l arnold/*.cpr; exit 0; fi
    sed -n '/^# The only public/,/^# downloaded file/p' "$0" | sed 's/^# \{0,1\}//'
    echo "then: sh tools/fetch_test_carts.sh ~/Downloads/<file>" >&2
    exit 1
fi
case "$1" in
    *.zip) unzip -o -q "$1" '*.cpr' -d arnold ;;
    *.cpr) [ "$1" -ef "arnold/$(basename "$1")" ] || cp "$1" arnold/ ;;
    *) echo "want a .zip or .cpr" >&2; exit 2 ;;
esac
for f in arnold/Arnold*.cpr; do
    [ -f "$f" ] || continue
    got=$(crc32 "$f")
    [ "$got" = "$WANT_CRC" ] && echo "$f: CRC32 ok" || echo "$f: CRC32 $got (expected $WANT_CRC)"
done

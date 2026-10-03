#!/bin/sh
# Build chipsrun (CPC) and zxrun (ZX Spectrum). Needs ./chips (fetch_chips.sh)
# and, to run zxrun, ./zxroms (fetch_zxroms.sh, fetched here if missing).
set -e
cd "$(dirname "$0")"
[ -d chips/chips ] || ./fetch_chips.sh
${CC:-cc} -std=c99 -O2 -Wall -Wno-unused-function -Ichips -o chipsrun chipsrun.c -lm
${CC:-cc} -std=c99 -O2 -Wall -Wno-unused-function -Ichips -o zxrun zxrun.c -lm
[ -f zxroms/48.rom ] || ./fetch_zxroms.sh || echo "build.sh: warning: Spectrum ROMs not fetched (zxrun will not run)" >&2

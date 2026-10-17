#!/bin/sh
# bench_plus.sh -- Lamplighter Plus's speed: 250 logic steps of the scripted walk
# in room 0 with four enemies (-D BENCH), as the firmware build and as the bare
# cartridge, on Caprice32 and CPCEC, paced (the default: 25.0 steps a second is
# the target, a step is 2 frames; "late" counts steps that took longer) and
# unpaced (-D NOPACE: the frames the 250 steps take, 500 is the 25 Hz budget).
#   games/lamplighter/tests/bench_plus.sh
cd "$(dirname "$0")/../../.." || exit 1
. games/lamplighter/tests/env.sh
PLUSLIB="${PLUSLIB:-$PWD/lib}"
run() {   # emu variant extra
  printf "%-6s %-5s %-8s " "$1" "$2" "$3"
  bare=""; own=""
  [ "$2" = cart ] && bare="--bare" && own="--zxbc-arg=-D --zxbc-arg=CPC_OWNFONT"
  python3 tools/cpcrun.py games/lamplighter/main.bas --org 0x40 --emu "$1" --model plus --timeout 120 $bare $own \
      --zxbc-arg=-I --zxbc-arg="$PLUSLIB" --zxbc-arg=-D --zxbc-arg=PLUS --zxbc-arg=-D --zxbc-arg=BENCH \
      ${3:+--zxbc-arg=-D --zxbc-arg="$3"} < /dev/null 2>&1 | grep "^INFO" || echo "(no result)"
}
for e in cap32 cpcec; do
  for v in disc cart; do
    run $e $v ""
    run $e $v NOPACE
  done
done

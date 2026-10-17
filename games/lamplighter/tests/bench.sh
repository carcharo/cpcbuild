#!/bin/sh
# bench.sh -- Lamplighter's speed: 250 logic steps of a scripted walk in room
# 0 with four enemies (-D BENCH) on chips, CPC 464 and 6128, in game mode (the
# default) and without it (-D NOGAMEMODE). One line each:
# "INFO steps=250 frames=... per second=..." (25.0 is the target: a step is
# 2 frames); then the Spectrum 48K and 128K builds (zxrun; -D BENCHLOG lists
# the first late steps, -D NOPACE shows the headroom: frames of 250 steps,
# 500 is the target).
#   games/lamplighter/tests/bench.sh
cd "$(dirname "$0")/../../.." || exit 1
. games/lamplighter/tests/env.sh
run() {   # model flag extra
  printf "%-5s %-9s " "$1" "$3"
  python3 tools/cpcrun.py games/lamplighter/main.bas --org 0x40 --emu chips --model "$1" --timeout 120 \
      --zxbc-arg=-D --zxbc-arg=BENCH --zxbc-arg=-D --zxbc-arg="$2" ${3:+--zxbc-arg=-D --zxbc-arg="$3"} \
      < /dev/null 2>&1 | grep "^INFO" || echo "(no result)"
}
for m in 464 6128; do
  run $m CPC$m ""
  run $m CPC$m NOGAMEMODE
done
for m in 48 128; do
  printf "zx%-3s %-9s " "$m" ""
  python3 tools/zxrun.py games/lamplighter/main.bas --model "$m" --timeout 300 \
      --zxbc-arg=-D --zxbc-arg=BENCH --zxbc-arg=-D --zxbc-arg=ZX"$m" --zxbc-arg=-H --zxbc-arg=1024 \
      < /dev/null 2>&1 | grep "^INFO" || echo "(no result)"
done

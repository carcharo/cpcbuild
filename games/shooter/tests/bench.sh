#!/bin/sh
# bench.sh -- Starfall's speed: 250 logic steps of an attract-style game with
# the in-game music, on chips (CPC 6128 and 464) and Caprice32 (6128), in
# game mode (the default) and without it (-D NOGAMEMODE). One line each:
# "INFO steps=250 frames=... per second=..." (25.0 is the target: a step is
# 2 frames).
#   games/shooter/tests/bench.sh [chips|cap32|all]
cd "$(dirname "$0")/../../.." || exit 1
WHICH="${1:-all}"
run() {   # emulator model flag extra (chips has no disc: -D NODISC skips the bank load; cap32 gets STARFALL.DAT)
  printf "%-8s %-5s %-9s " "$1" "$2" "$4"
  python3 tools/cpcrun.py games/shooter/main.bas --org 0x40 --emu "$1" --model "$2" --timeout 120 \
      --zxbc-arg=-D --zxbc-arg=BENCH --zxbc-arg=-D --zxbc-arg="$3" \
      $( [ "$1" = chips ] && echo "--zxbc-arg=-D --zxbc-arg=NODISC" || echo "--disk-file STARFALL.DAT=games/shooter/assets/starfall.dat" ) ${4:+--zxbc-arg=-D --zxbc-arg="$4"} 2>&1 \
      | grep "^INFO" || echo "(no result)"
}
if [ "$WHICH" = all ] || [ "$WHICH" = chips ]; then
  for m in 6128 464; do
    run chips $m CPC$m ""
    run chips $m CPC$m NOGAMEMODE
  done
fi
if [ "$WHICH" = all ] || [ "$WHICH" = cap32 ]; then
  run cap32 6128 CPC6128 ""
  run cap32 6128 CPC6128 NOGAMEMODE
  run cap32 464 CPC464 ""
  run cap32 464 CPC464 NOGAMEMODE
fi

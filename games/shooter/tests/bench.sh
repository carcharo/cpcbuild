#!/bin/sh
# bench.sh -- Starfall's speed: 250 logic steps of an attract-style game with
# the in-game music, on chips (CPC 6128 and 464) and Caprice32 (6128), in
# game mode (the default) and without it (-D NOGAMEMODE). One line each:
# "INFO steps=250 frames=... per second=..." (25.0 is the target: a step is
# 2 frames).
#   games/shooter/tests/bench.sh [chips|cap32|all]
# BARE=1 benches the bare-metal builds (-D CPC_BAREMETAL, -D NODISC: a bare
# program cannot load the songs itself, so there is no bank music, as in the
# chips runs of the firmware builds; and -D BENCH_ERR: no PRINT, the 6128's
# bare build would not fit below &4000 with the text code, so the frame count
# comes back as "Error n", n = frames - 400). Chips only.
cd "$(dirname "$0")/../../.." || exit 1
WHICH="${1:-all}"
run() {   # emulator model flag extra (chips has no disc: -D NODISC skips the bank load; cap32 gets STARFALL.DAT)
  printf "%-8s %-5s %-9s %s" "$1" "$2" "$4" "${BARE:+bare }"
  if [ -n "$BARE" ]; then
    n=$(python3 tools/cpcrun.py games/shooter/main.bas --org 0x40 --emu "$1" --model "$2" --timeout 120 --bare \
        --zxbc-arg=-D --zxbc-arg=BENCH --zxbc-arg=-D --zxbc-arg=BENCH_ERR --zxbc-arg=-D --zxbc-arg="$3" \
        --zxbc-arg=-D --zxbc-arg=NODISC ${4:+--zxbc-arg=-D --zxbc-arg="$4"} 2>&1 | sed -n 's/^Error \([0-9]*\).*/\1/p' | tail -1)
    if [ -z "$n" ]; then echo "(no result)"; else
      f=$((n + 400)); r=$((62500 / (f / 2)))
      echo "INFO steps=250 frames=$f per second=$((r / 10)).$((r % 10))"
    fi
    return
  fi
  python3 tools/cpcrun.py games/shooter/main.bas --org 0x40 --emu "$1" --model "$2" --timeout 120 \
      ${BARE:+--bare} --zxbc-arg=-D --zxbc-arg=BENCH --zxbc-arg=-D --zxbc-arg="$3" \
      $( [ "$1" = chips ] || [ -n "$BARE" ] && echo "--zxbc-arg=-D --zxbc-arg=NODISC" || echo "--disk-file STARFALL.DAT=games/shooter/assets/starfall.dat" ) ${4:+--zxbc-arg=-D --zxbc-arg="$4"} 2>&1 \
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

#!/bin/sh
# bench.sh -- Lamplighter's speed: 250 logic steps of a scripted walk in room
# 0 with four enemies (-D BENCH) on chips, CPC 464 and 6128, in game mode (the
# default), without it (-D NOGAMEMODE) and unpaced (-D NOPACE: the frames the 250
# steps take, 500 is the 25 Hz budget). One line each:
# "INFO steps=250 frames=... per second=..." (25.0 is the target: a step is
# 2 frames); the spaces PRINT puts round numbers are normalised.
#   games/lamplighter/tests/bench.sh
cd "$(dirname "$0")/../../.." || exit 1
. games/lamplighter/tests/env.sh
info() {   # the INFO line of a run, whatever the PRINT spacing and the 40-column wrap
  tr -d ' \r\n' | grep -o 'INFOsteps=[0-9]*frames=[0-9]*persecond=[0-9.]*late=[0-9]*longest=[0-9]*' |
    sed 's/INFO/INFO /; s/frames/ frames/; s/persecond/ per second/; s/late/ late/; s/longest/ longest/' | grep .
}
run() {   # model flag extra
  printf "%-5s %-9s " "$1" "$3"
  python3 tools/cpcrun.py games/lamplighter/main.bas --org 0x40 --emu chips --model "$1" --timeout 120 \
      --cpcbas-arg=-D --cpcbas-arg=BENCH --cpcbas-arg=-D --cpcbas-arg="$2" ${3:+--cpcbas-arg=-D --cpcbas-arg="$3"} \
      < /dev/null 2>/dev/null | info || echo "(no result)"
}
for m in 464 6128; do
  run $m CPC$m ""
  run $m CPC$m NOGAMEMODE
  run $m CPC$m NOPACE
done

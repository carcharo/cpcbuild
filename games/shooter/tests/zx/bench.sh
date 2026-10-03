#!/bin/sh
# bench.sh -- Starfall's BENCH on the headless Spectrum: builds main.bas with
# -D BENCH for 48K and 128K, runs it, and saves the final screen (main.bas
# PRINTs "INFO steps= frames= per second=" there; the zx48k runtime's PRINT
# has no echo to the runner's test port) as build/zx-bench-<model>.png.
# (BENCH prints numbers through the runtime, which needs a 1 KB heap, with the
# ORG lowered by 768 bytes to keep the image where the production build has it.)
# Read the INFO line off the picture. Usage: bench.sh [48|128] (default both)
set -e
cd "$(dirname "$0")/../../../.."
mkdir -p build
for m in ${1:-48 128}; do
  if [ "$m" = 48 ]; then org=32768; else org=30976; fi
  python3 tools/zxrun.py games/shooter/main.bas --model "$m" --timeout 200 --quiet \
    --zxbc-arg=-D --zxbc-arg=ZX"$m" --zxbc-arg=-D --zxbc-arg=BENCH \
    --zxbc-arg=-H --zxbc-arg=1024 --zxbc-arg=-S --zxbc-arg="$org" \
    --shot "build/zx-bench-$m.png" 2>&1 | grep -v "warning" || true
  echo "model $m: build/zx-bench-$m.png"
done

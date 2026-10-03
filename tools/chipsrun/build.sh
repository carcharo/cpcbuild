#!/bin/sh
# Build chipsrun (needs ./chips: run fetch_chips.sh first).
set -e
cd "$(dirname "$0")"
[ -d chips/chips ] || ./fetch_chips.sh
${CC:-cc} -std=c99 -O2 -Wall -Wno-unused-function -Ichips -o chipsrun chipsrun.c -lm

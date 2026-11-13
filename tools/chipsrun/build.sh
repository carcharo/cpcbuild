#!/bin/sh
# Build chipsrun (CPC). Needs ./chips (fetch_chips.sh).
set -e
cd "$(dirname "$0")"
[ -d chips/chips ] || ./fetch_chips.sh
${CC:-cc} -std=c99 -O2 -Wall -Wno-unused-function -Ichips -o chipsrun chipsrun.c -lm

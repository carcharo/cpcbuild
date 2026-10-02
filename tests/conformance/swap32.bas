REM Conformance: 32-bit operations with the interrupt handler running.
REM The original runtime's __SWAP32 (used when the compiler swaps the
REM operands of a 32-bit division, MOD, ...) moves SP over the stacked
REM value for a few instructions, leaving that value below SP where an
REM interrupt's pushes overwrite it. On the Spectrum that is one interrupt
REM a frame; compiled cpc code runs with interrupts at 300 Hz and about
REM one ULONG division in 200 gave a wrong answer (found by the Play
REM tempo calibration, Phase 4d). The cpc runtime has its own swap32.asm
REM that only PUSHes and POPs. 6000 divisions and 6000 MODs here, each
REM against the value computed once, would show about 30 bad results
REM with the original.

#include "lib/chk.bas"

DIM i, badDiv, badMod, badSub AS ULONG
DIM x, a, wantDiv, wantMod, wantSub AS ULONG
DIM d AS UBYTE

a = 1920000
d = 120
wantDiv = a / 120
wantMod = a MOD 1000
wantSub = 5000000 - a
FOR i = 1 TO 6000
  x = a / 120
  IF x <> wantDiv THEN badDiv = badDiv + 1
  x = a MOD 1000
  IF x <> wantMod THEN badMod = badMod + 1
  x = 5000000 - a
  IF x <> wantSub THEN badSub = badSub + 1
NEXT i
CHK("ulong_div_const", STR$(badDiv), "0")
CHK("ulong_mod_const", STR$(badMod), "0")
CHK("ulong_sub", STR$(badSub), "0")
CHK("div_value", STR$(wantDiv), "16000")
CHK("mod_value", STR$(wantMod), "0")
PRINT "DONE"

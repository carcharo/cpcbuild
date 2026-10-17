REM MODELS: plus
REM Conformance: palette cycling (lib/cpcplus/palcycle.bas) on a CPC Plus: the table is applied at
REM once, a rotation by one every `period` calls of PalCycleStep (read back with GetPalette12),
REM forward, backward and ping-pong, screen pens and sprite colours (entry 16 + first), independent
REM cycles, PalCycleStop, a range cut to the palette and refused arguments.

#include <cpc.bas>
#include "lib/chk.bas"
#include <cpcplus/palcycle.bas>

DIM t5(4) AS UINTEGER => {$0100, $0200, $0300, $0400, $0500}
DIM t3(2) AS UINTEGER => {$0A00, $00B0, $000C}
DIM ts(3) AS UINTEGER => {$0111, $0222, $0333, $0444}
DIM i AS UBYTE

REM the red nibble of entries first..first+n-1 as one string of digits
FUNCTION Reds(first AS UBYTE, n AS UBYTE) AS STRING
  DIM s AS STRING
  DIM k AS UBYTE
  s = ""
  FOR k = first TO first + n - 1
    s = s + STR$(GetPalette12(k) / 256)
  NEXT k
  RETURN s
END FUNCTION

PlusUnlock()
FOR i = 0 TO 31
  SetPalette12(i BAND 15, 0)
NEXT i

REM ---- forward, period 1: after k steps entry first + i shows table((i + k) mod count)
PalCycleSet(0, 0, 2, 5, @t5(0), 1)
CHK("set_applies_table", Reds(2, 5), "12345")
PalCycleStep()
CHK("fwd_step1", Reds(2, 5), "23451")
PalCycleStep()
PalCycleStep()
CHK("fwd_step3", Reds(2, 5), "45123")
PalCycleStep()
PalCycleStep()
CHK("fwd_step5_wraps", Reds(2, 5), "12345")
CHK("outside_untouched", Reds(0, 2) + Reds(7, 1), "000")

REM ---- period 3: a rotation every 3rd call
PalCycleSet(0, 0, 2, 5, @t5(0), 3)
PalCycleStep()
PalCycleStep()
CHK("period3_not_yet", Reds(2, 5), "12345")
PalCycleStep()
CHK("period3_due", Reds(2, 5), "23451")
PalCycleStep()
PalCycleStep()
CHK("period3_waiting", Reds(2, 5), "23451")
PalCycleStep()
CHK("period3_second", Reds(2, 5), "34512")

REM ---- period 0 counts as 1
PalCycleSet(0, 0, 2, 5, @t5(0), 0)
PalCycleStep()
CHK("period0_is_1", Reds(2, 5), "23451")

REM ---- backward
PalCycleSet(0, 0, 2, 5, @t5(0), 1)
PalCycleDir(0, 1)
PalCycleStep()
CHK("back_step1", Reds(2, 5), "51234")
PalCycleStep()
CHK("back_step2", Reds(2, 5), "45123")

REM ---- ping-pong: the offset runs 0 1 2 3 4 3 2 1 0 1
PalCycleSet(0, 0, 2, 5, @t5(0), 1)
PalCycleDir(0, 2)
PalCycleStep(): PalCycleStep(): PalCycleStep(): PalCycleStep()
CHK("pp_top", Reds(2, 5), "51234")
PalCycleStep()
CHK("pp_turn", Reds(2, 5), "45123")
PalCycleStep(): PalCycleStep(): PalCycleStep()
CHK("pp_bottom", Reds(2, 5), "12345")
PalCycleStep()
CHK("pp_again_up", Reds(2, 5), "23451")

REM ---- stop leaves the colours; independent cycles; sprite colours (entry 16 + first)
PalCycleStop(0)
PalCycleStep()
CHK("stop_holds", Reds(2, 5), "23451")
PalCycleSet(1, 0, 10, 3, @t3(0), 1)
PalCycleSet(2, 1, 3, 4, @ts(0), 2)
CHK("sprite_kind_entries", STR$(GetPalette12(19)) + " " + STR$(GetPalette12(22)) + " " + STR$(GetPalette12(18)), "273 1092 0")
PalCycleStep()
CHK("indep_1", STR$(GetPalette12(10)) + " " + STR$(GetPalette12(11)) + " " + STR$(GetPalette12(12)) + " " + STR$(GetPalette12(19)), "176 12 2560 273")
PalCycleStep()
CHK("indep_2", STR$(GetPalette12(10)) + " " + STR$(GetPalette12(19)) + " " + STR$(GetPalette12(22)) + " " + Reds(2, 5), "12 546 273 23451")
PalCycleStop(1)
PalCycleStep(): PalCycleStep()
CHK("stop_one_other_runs", STR$(GetPalette12(10)) + " " + STR$(GetPalette12(19)), "12 819")
CHK("sprite_not_pens", STR$(GetPalette12(1)) + " " + STR$(GetPalette12(9)), "0 0")

REM ---- ranges and refusals
PalCycleStop(2)
PalCycleSet(3, 0, 14, 5, @t5(0), 1)
CHK("cut_to_16", Reds(14, 2), "12")
PalCycleStep()
CHK("cut_rotates", Reds(14, 2), "21")
PalCycleStop(3)
SetPalette12(0, $0F00)
PalCycleSet(3, 0, 0, 1, @t5(0), 1)
PalCycleStep()
CHK("count1_refused", STR$(GetPalette12(0)), "3840")
PalCycleSet(4, 0, 0, 3, @t3(0), 1)
CHK("id4_refused", STR$(GetPalette12(0)), "3840")
SetBorder12($0123)
PalCycleSet(3, 1, 0, 3, @t3(0), 1)
CHK("sprite_first0_refused", STR$(GetPalette12(16)) + " " + STR$(GetPalette12(0)), "291 3840")
PalCycleSet(3, 1, 14, 9, @t5(0), 1)
CHK("sprite_cut_to_15", STR$(GetPalette12(30) / 256) + " " + STR$(GetPalette12(31) / 256), "1 2")
PalCycleStop(3)

PRINT "DONE"
END

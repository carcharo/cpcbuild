REM Conformance: Phase 4a input, timing, sound and text width (INKEY$,
REM PAUSE, BEEP, BORDER, Mode-dependent PRINT AT/TAB/comma).
REM
REM Times are measured on the firmware's 300 Hz tick count
REM (KL_TIME_PLEASE): PAUSE n waits n frames = 6n ticks, BEEP d waits
REM until the tone (d * 100 hundredths) has played = about 300d ticks.
REM The firmware's sound manager keeps time even with emulator audio off.

#include <cpc.bas>
#include <pos.bas>
#include <csrlin.bas>

DIM results$ AS STRING
SUB CHK(name AS STRING, gotv AS STRING, wantv AS STRING)
  IF gotv = wantv THEN
    results$ = results$ + "PASS " + name + CHR$ 13
  ELSE
    results$ = results$ + "FAIL " + name + " got=" + gotv + " want=" + wantv + CHR$ 13
  END IF
END SUB

SUB CHKRANGE(name AS STRING, gotv AS ULONG, lo AS ULONG, hi AS ULONG)
  IF gotv >= lo AND gotv <= hi THEN
    CHK(name, "ok", "ok")
  ELSE
    CHK(name, STR$(gotv), STR$(lo) + ".." + STR$(hi))
  END IF
END SUB

REM Firmware: KL_TIME_PLEASE (&BD0D) -> DEHL.
FUNCTION FASTCALL Ticks AS ULONG
  ASM
  call .core.__FW_CALL
  defw $BD0D
  END ASM
END FUNCTION

REM Firmware: SCR_GET_BORDER (&BC3B) -> B, C.
FUNCTION FASTCALL BorderColour AS UBYTE
  ASM
  call .core.__FW_CALL
  defw $BC3B
  ld a, b
  END ASM
END FUNCTION

DIM t0, t1 AS ULONG

REM --- INKEY$: the key buffer starts empty ---
CHK("inkey_empty", STR$(LEN(INKEY$)), "0")

REM --- PAUSE ---
t0 = Ticks()
PAUSE 50
t1 = Ticks()
CHKRANGE("pause_50_frames", t1 - t0, 294, 312)

t0 = Ticks()
PAUSE 1
t1 = Ticks()
CHKRANGE("pause_1_frame", t1 - t0, 5, 12)

REM --- BEEP, constant arguments (compiler-converted) ---
t0 = Ticks()
BEEP 0.5, 0
t1 = Ticks()
CHKRANGE("beep_const_0.5s", t1 - t0, 140, 170)
REM The tone period BEEP queued, from the runtime's SOUND_BLK
REM (sysvars.asm: private block $9E00 + $AC, period at +3).
CHK("beep_const_middle_c_period", STR$(PEEK(UINTEGER, $9EAF)), "239")

REM --- BEEP, run-time arguments (calculator-converted) ---
DIM d, p AS FLOAT
d = 0.25
p = 7
t0 = Ticks()
BEEP d, p
t1 = Ticks()
CHKRANGE("beep_runtime_0.25s", t1 - t0, 65, 95)
REM 62500 / (261.6256 * 2^(7/12)) = 159.4
CHK("beep_runtime_period", STR$(PEEK(UINTEGER, $9EAF)), "159")
p = -12
d = 0.05
BEEP d, p
CHK("beep_runtime_octave_down", STR$(PEEK(UINTEGER, $9EAF)), "478")

d = 0
t0 = Ticks()
BEEP d, p
t1 = Ticks()
CHKRANGE("beep_zero_duration", t1 - t0, 0, 6)

REM --- BORDER c shows PAPER c's colour ---
BORDER 2
CHK("border_red_mode1", STR$(BorderColour()), "6")
BORDER 0
CHK("border_black_mode1", STR$(BorderColour()), "1")
SetBorder 13
CHK("setborder_hw", STR$(BorderColour()), "13")

REM --- text width follows the mode ---
Mode 0
PRINT AT 2, 19; "X";
CHK("mode0_last_col_wraps", STR$(CSRLIN()) + "," + STR$(POS()), "3,0")
PRINT AT 4, 0; TAB 25;
CHK("mode0_tab_mod20", STR$(POS()), "5")
PRINT AT 5, 3;,;
CHK("mode0_comma_half", STR$(POS()), "10")
Mode 2
PRINT AT 2, 79; "X";
CHK("mode2_last_col_wraps", STR$(CSRLIN()) + "," + STR$(POS()), "3,0")
PRINT AT 4, 0; TAB 70;
CHK("mode2_tab", STR$(POS()), "70")
PRINT AT 5, 45;,;
CHK("mode2_comma_wraps", STR$(CSRLIN()) + "," + STR$(POS()), "6,0")
Mode 1
PRINT AT 2, 39; "X";
CHK("mode1_last_col_wraps", STR$(CSRLIN()) + "," + STR$(POS()), "3,0")
PRINT AT 4, 3;,;
CHK("mode1_comma_half", STR$(POS()), "20")
CLS

PRINT
PRINT results$; "DONE"
END

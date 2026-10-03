REM BARE: only
REM STATE: mode=1 lrom=off urom=off ramcfg=0 border=4 ink=4,10,19,12,11,20,21,13,6,30,31,7,18,25,4,7 crtc=63,40,46,142,38,0,25,30,0,7,0,0,48,0
REM Conformance (bare-metal mode only, -D CPC_BAREMETAL): the machine state
REM the bare boot leaves, from a disc/quickload start (the firmware ran
REM first) and from a cold start (--cold: junk RAM, ROMs out, no firmware).
REM
REM Checked here, with no PRINT (output through lib/bareout.bas):
REM   - the screen (&C000-&FFFF) is all zero (cleared by the boot, junk or
REM     firmware text before it);
REM   - both ROMs are paged out: complementary patterns written to &0010
REM     (the lower ROM's RST 2 vector, free in bare mode) and &C7E0 (upper
REM     ROM area) read back from RAM;
REM   - the private block's defaults (no error, INK 7 / PAPER 0).
REM Checked by the runner from chipsrun's state dump (the program asks for it
REM with BState(); the Gate Array can't be read back): mode 1, both ROMs
REM off, RAM configuration 0, the firmware's power-on inks as hardware colours
REM (pens 0-15 = firmware inks 1,24,20,6,26,0,2,8,10,12,14,16,18,22,1,16;
REM border firmware ink 1; 14 and 15 steady, not flashing) and the standard
REM 50 Hz CRTC registers R0-R13 (63,40,46,142,38,0,25,30,0,7,0,0,&30,0).
REM The state check runs on chips only; on Caprice32 the program checks run.

#include "lib/bareout.bas"

FUNCTION FASTCALL ErrNr() AS UBYTE
  ASM
  ld a, (.core.ERR_NR)
  END ASM
END FUNCTION

FUNCTION FASTCALL AttrP() AS UBYTE
  ASM
  ld a, (.core.ATTR_P)
  END ASM
END FUNCTION

DIM a, n AS UINTEGER
DIM o, p1, p2 AS UBYTE

REM first: the screen, before anything could touch it
n = 0
FOR a = 0 TO 16383
  IF PEEK(49152 + a) <> 0 THEN n = n + 1
NEXT a
BCHK("screen_clear", n, 0)

REM ROMs off
o = PEEK($10)
POKE $10, $A5
p1 = PEEK($10)
POKE $10, $5A
p2 = PEEK($10)
POKE $10, o
BCHK("lower_a5", p1, 165)
BCHK("lower_5a", p2, 90)

o = PEEK($C7E0)
POKE $C7E0, $A5
p1 = PEEK($C7E0)
POKE $C7E0, $5A
p2 = PEEK($C7E0)
POKE $C7E0, o
BCHK("upper_a5", p1, 165)
BCHK("upper_5a", p2, 90)

BCHK("err_nr_none", ErrNr(), 255)
BCHK("attr_p", AttrP(), 7)

BState()
BDone()

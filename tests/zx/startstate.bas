REM Spectrum start state: the program starts on a booted ROM, the way
REM RANDOMIZE USR would start it (I=&3F, IM 1 with interrupts on, IY=&5C3A,
REM the system variables initialised, 48K BASIC ROM mapped; on the 128K that
REM is ROM 1, entered through the menu's Tape Loader).
#include <zxtest.bas>

FUNCTION IReg() AS UBYTE
  ASM
  ld a, i
  END ASM
END FUNCTION

FUNCTION IyReg() AS UINTEGER
  ASM
  push iy
  pop hl
  END ASM
END FUNCTION

DIM f0, f1 AS UINTEGER
CHK("i_register", STR$(IReg()), "63")
CHK("iy", STR$(IyReg()), "23610")
CHK("chars", STR$(PEEK(UINTEGER, 23606)), "15360")
CHK("attr_p", STR$(PEEK(23693)), "56")
CHK("bordcr", STR$(PEEK(23624)), "56")
CHK("udg", STR$(PEEK(UINTEGER, 23675)), "65368")
CHK("ramtop", STR$(PEEK(UINTEGER, 23730)), "65367")
CHK("rom_1_or_48k", STR$(PEEK(0) = 243 OR PEEK(0) = 175), "1")
f0 = PEEK(UINTEGER, 23672)
TWAIT(5)
f1 = PEEK(UINTEGER, 23672)
CHK("frames_tick_im1", STR$(f1 - f0 >= 4 AND f1 - f0 <= 6), "1")
TEND()

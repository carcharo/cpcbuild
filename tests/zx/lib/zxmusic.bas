REM Shared helpers for tests/zx/music*.bas (ZX Spectrum 128K, --arch zx48k).
#ifndef __ZXMUSIC_TEST_LIB__
#define __ZXMUSIC_TEST_LIB__

REM Reads AY register r (128K). Interrupts are off for the select + read, so
REM a tick of the IM2 player can't fall between them.
FUNCTION FASTCALL AyRead(r AS UBYTE) AS UBYTE
  ASM
  di
  ld bc, 0xFFFD
  out (c), a
  in a, (c)
  ei
  END ASM
END FUNCTION

REM Waits for the next 50 Hz interrupt (HALT; interrupts are on).
SUB WaitFrame()
  ASM
  halt
  END ASM
END SUB

REM The low 16 bits of the ROM's FRAMES system variable (23672).
FUNCTION Frames() AS UINTEGER
  RETURN PEEK(UINTEGER, 23672)
END FUNCTION

REM The CPU's I register.
FUNCTION FASTCALL IReg() AS UBYTE
  ASM
  ld a, i
  END ASM
END FUNCTION

#endif

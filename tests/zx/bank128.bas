REM Spectrum 128K conformance: RAM bank paging through port &7FFD.
REM The program's stack (BASIC puts it in the top 16K) is moved below the
REM paged window first. Bit 4 keeps ROM 1 (48K BASIC) mapped.
REM MODELS: 128
#include <zxtest.bas>

DIM n AS UBYTE

SUB Bank(b AS UBYTE)
  OUT 32765, 16 + b
END SUB

ASM
  ld ($7FF4), sp
  ld sp, $7FF0
END ASM

REM Give every bank 0..7 its own value at &C000 and &FFFF.
FOR n = 0 TO 7
  Bank(n)
  POKE 49152, 16 + n
  POKE 65535, 32 + n
NEXT n
FOR n = 0 TO 7
  Bank(n)
  CHK("bank" + STR$(n), STR$(PEEK(49152)) + "," + STR$(PEEK(65535)), STR$(16 + n) + "," + STR$(32 + n))
NEXT n

REM Banks 2 and 5 are also mapped fixed at &8000 and &4000.
POKE 32768 + 3000, 77
Bank(2)
CHK("bank2_alias", STR$(PEEK(49152 + 3000)), "77")
Bank(5)
POKE 16384 + 3000, 78
Bank(5)
CHK("bank5_alias", STR$(PEEK(49152 + 3000)), "78")
POKE 49152 + 3000, 0
POKE 32768 + 3000, 0

REM Shadow screen: draw into bank 7 through the window, then display it.
Bank(7)
FOR n = 0 TO 7
  POKE 49152 + 2048 * 0 + 256 * n + 5, 255
NEXT n
POKE 49152 + 6144 + 5, 2 * 8 + 7  : REM attribute row 0 col 5: paper red, ink white
Bank(0)
ASM
  ld sp, ($7FF4)
END ASM
CLS
CHK("normal_screen_blank", STR$(PEEK(16384 + 5)), "0")
OUT 32765, 16 + 8 + 0 : REM display bank 7's screen, keep bank 0 at &C000
TSHOT("shadow")
OUT 32765, 16
TEND()

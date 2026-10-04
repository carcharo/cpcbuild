REM MODELS: plus
REM Conformance: the cpcplus library next to a frame hook that pages RAM bank 3 in at
REM &4000 every frame (what the music hook does) and writes a sprite colour
REM through the library from interrupt context (interrupts off there: the library
REM must not turn them on). The main program meanwhile selects bank 1, copies
REM sprite pictures and reads them back over and over (each a window with the ASIC
REM page in, interrupts off). Checks: the hook ran, the hook's palette write
REM landed, every picture was intact, bank 1 is still selected and its contents
REM visible afterwards, and the hook's own bank 3 counter is not damaged by the
REM ASIC page (the page covers &4000-&7FFF only while a window is open and
REM interrupts are off, so the hook can never run inside one).
REM (Plus, Caprice32 only: a 6128 Plus has the extra 64 KB.)

#include <cpc.bas>
#include <framehook.bas>
#include <cpcbuild/display.bas>
#include <cpcbuild/banks.bas>
#include "lib/chk.bas"
#include "lib/plushelp.bas"

REM The hook: bank 3 in, count at &7F00 in it, the library's shadow configuration
REM back, then sprite colour 3 (palette entry 19) := the low nibble of the count.
FUNCTION FASTCALL PhHookAddr() AS UINTEGER
  ASM
  ld hl, PH_HOOK
  jp PH_SKIP
PH_HOOK:
  ld b, $7F
  ld c, $C7
  out (c), c
  ld hl, $7F00
  inc (hl)
  ld d, (hl)
  ld a, (.core.CBK_CFG)
  ld c, a
  out (c), c
  ld a, d
  and $0F
  ld l, a
  ld h, 0
  ld a, 19
  jp .core.__PL_SETCOL
PH_SKIP:
  END ASM
END FUNCTION

DIM img(255) AS UBYTE
DIM i, k AS UINTEGER
DIM bad, n AS UINTEGER
DIM c AS UBYTE
DIM hookn AS UBYTE
DIM pk AS UBYTE

PlusUnlock()
POKE 16384, 109
BankPoke(1, 16384, 99)
BankPoke(3, 32512, 0)
BankSelect(1)
SpriteColour(3, $0000)

FrameHook(PhHookAddr())
bad = 0
FOR n = 1 TO 60
  FOR i = 0 TO 255
    img(i) = i + n
  NEXT i
  SpriteSetImage(n MOD 16, @img(0))
  FOR k = 0 TO 255 STEP 37
    IF AsicPeek(16384 + (n MOD 16) * 256 + k) <> ((k + n) BAND 15) THEN bad = bad + 1
  NEXT k
NEXT n
FrameHookOff()

pk = PEEK(16384)
hookn = BankPeek(3, 32512)
CHK("hook_ran", STR$(hookn >= 10), "1")
CHK("pictures_intact", STR$(bad), "0")
CHK("bank_still_selected", STR$(BankSelected()) + " " + STR$(pk), "1 99")
CHK("hook_palette_landed", STR$(GetPalette12(19)), STR$(hookn BAND 15))
CHK("iff_on", STR$(Iff()), "1")
BankOff()
CHK("main_ram_back", STR$(PEEK(16384)), "109")
PRINT "DONE"
END

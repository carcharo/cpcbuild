REM MODELS: plus
REM Conformance: cpcplus 12-bit palette on a CPC Plus (Phase 7 P2, Caprice32 only):
REM SetPalette12 / SetBorder12 / GetPalette12 / SetPalette12Block, range and
REM refusal rules, sprite palette entries, read back through the ASIC page.

#include <cpc.bas>
#include <cpcbuild/display.bas>
#include "lib/chk.bas"
#include "lib/plushelp.bas"
#include "lib/ticks.bas"

DIM pal(29) AS UBYTE
DIM blk(7) AS UBYTE
DIM i, bad AS UINTEGER
DIM v AS UBYTE

PlusUnlock()
FOR i = 0 TO 15
  SetPalette12(i, i * 256 + ((15 - i) * 16) + (i * 7) MOD 16)
NEXT i
bad = 0
FOR i = 0 TO 15
  IF GetPalette12(i) <> i * 256 + ((15 - i) * 16) + (i * 7) MOD 16 THEN bad = bad + 1
NEXT i
CHK("pens_roundtrip", STR$(bad), "0")
SetPalette12(5, $0123)
CHK("pen5_raw", STR$(AsicPeek($640A)) + " " + STR$(AsicPeek($640B)), "19 2")
SetPalette12(6, $0ACE)
CHK("pen6_raw", STR$(AsicPeek($640C)) + " " + STR$(AsicPeek($640D)), "174 12")
SetPalette12(7, $F123)
CHK("high_bits_ignored", STR$(GetPalette12(7)), "291")
SetBorder12($0ABC)
CHK("border", STR$(GetPalette12(16)), "2748")
CHK("border_raw", STR$(AsicPeek($6420)) + " " + STR$(AsicPeek($6421)), "172 11")
CHK("pens_untouched_by_border", STR$(GetPalette12(15)), STR$(15 * 256 + 0 + (15 * 7) MOD 16))
SetPalette12(31, $0F8F)
CHK("entry31", STR$(GetPalette12(31)), "3983")
SetPalette12(32, $0FFF)
SetPalette12(200, $0FFF)
CHK("entry32_ignored", STR$(GetPalette12(31)) + " " + STR$(GetPalette12(32)) + " " + STR$(GetPalette12(255)), "3983 0 0")

REM ---- SetPalette12Block (two bytes per entry, even byte red<<4|blue, odd green)
blk(0) = $12: blk(1) = $03      REM red 1, blue 2, green 3 = &0132
blk(2) = $F0: blk(3) = $0F      REM red F, blue 0, green F = &0FF0
blk(4) = $0A: blk(5) = $05      REM red 0, blue A, green 5 = &005A
blk(6) = $44: blk(7) = $04
SetPalette12Block(@blk(0), 8, 4)
CHK("block_entries", STR$(GetPalette12(8)) + " " + STR$(GetPalette12(9)) + " " + STR$(GetPalette12(10)) + " " + STR$(GetPalette12(11)), "306 4080 90 1092")
CHK("block_neighbours", STR$(GetPalette12(7)) + " " + STR$(GetPalette12(12)), "291 " + STR$(12 * 256 + (3 * 16) + (12 * 7) MOD 16))
SetPalette12Block(@blk(0), 30, 4)
CHK("block_cut_at_32", STR$(GetPalette12(30)) + " " + STR$(GetPalette12(31)) + " " + STR$(GetPalette12(29) <> 306), "306 4080 1")
SetPalette12(20, $0777)
SetPalette12Block(@blk(0), 40, 2)
SetPalette12Block(@blk(0), 20, 0)
CHK("block_bad_first_or_count", STR$(GetPalette12(20)), "1911")
REM a source in &4000-&7FFF (RAM under the ASIC page while it is in) is bounced
REM through a buffer, no longer refused (Phase 7 P3)
FOR i = 0 TO 7
  POKE 16640 + i, blk(i)
NEXT i
SetPalette12Block(16640, 20, 4)
CHK("block_source_in_window", STR$(GetPalette12(20)) + " " + STR$(GetPalette12(21)) + " " + STR$(GetPalette12(22)) + " " + STR$(GetPalette12(23)), "306 4080 90 1092")
SetPalette12Block(@blk(0), 16, 1)
CHK("block_border", STR$(GetPalette12(16)), "306")

REM ---- sprite palette and colours
FOR i = 0 TO 29
  pal(i) = (i * 9) BAND 255
NEXT i
SpritePalette(@pal(0))
bad = 0
FOR i = 0 TO 29
  IF AsicPeek($6422 + i) <> (i * 9 BAND 255) THEN
    IF (i BAND 1) = 1 THEN
      IF AsicPeek($6422 + i) <> ((i * 9) BAND 15) THEN bad = bad + 1
    ELSE
      bad = bad + 1
    END IF
  END IF
NEXT i
CHK("spritepalette", STR$(bad), "0")
CHK("spritepalette_entry1", STR$(GetPalette12(17)), STR$(((0 * 9) BAND 240) * 16 + (((1 * 9) BAND 15) * 16) + ((0 * 9) BAND 15)))
SpriteColour(3, $0ABC)
CHK("spritecolour", STR$(GetPalette12(19)) + " " + STR$(AsicPeek($6426)) + " " + STR$(AsicPeek($6427)), "2748 172 11")
SpriteColour(15, $0123)
CHK("spritecolour15", STR$(GetPalette12(31)), "291")
v = AsicPeek($6420)
SpriteColour(0, $0FFF)
SpriteColour(16, $0FFF)
SpriteColour(200, $0FFF)
CHK("spritecolour_0_16_ignored", STR$(GetPalette12(16)) + " " + STR$(GetPalette12(0)) + " " + STR$(v), "306 " + STR$(GetPalette12(0)) + " 18")

PRINT "DONE"
END

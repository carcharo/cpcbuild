REM MODELS: plus
REM Conformance (CPC Plus, both modes; Phase 7 tidy-up): PlusPokeBlock(dest, src, count) copies
REM count bytes from RAM to the ASIC page at dest in ONE window when the source lies outside
REM &4000-&7FFF. Checks: lengths 1, 64, 255, 256, 257, 400 land byte for byte (sprite pixel
REM RAM keeps the low nibble); the sprite register table at &6000 (what Starfall writes each
REM frame); a block that would run past &7FFF is cut there and does not touch the RAM above
REM it (the old call wrote into &8000 and up); a destination outside &4000-&7FFF or a count
REM of 0 does nothing; the interrupt state is kept; the source is not changed. The same from a
REM source inside &4000-&7FFF is in plus_big (a program that large).

#include <cpc.bas>
#include "lib/chk.bas"
#include "lib/plushelp.bas"

DIM src(399) AS UBYTE
DIM i, bad AS UINTEGER
DIM before, after AS ULONG

FUNCTION Sum(addr AS UINTEGER, n AS UINTEGER) AS ULONG
  DIM k AS UINTEGER
  DIM t AS ULONG
  t = 0
  FOR k = 0 TO n - 1
    t = t * 3 + PEEK(addr + k) + 1
  NEXT k
  RETURN t
END FUNCTION

FUNCTION Check(first AS UINTEGER, n AS UINTEGER, base AS UINTEGER) AS UINTEGER
  DIM k, b AS UINTEGER
  b = 0
  FOR k = 0 TO n - 1
    IF AsicPeek(first + k) <> (PEEK(base + k) BAND 15) THEN b = b + 1
  NEXT k
  RETURN b
END FUNCTION

FOR i = 0 TO 399
  src(i) = (i * 7 + 3) BAND 255
NEXT i
PlusUnlock()
SpritesHideAll()

PlusPokeBlock($4000, @src(0), 1)
CHK("len_1", STR$(Check($4000, 1, @src(0))), "0")
PlusPokeBlock($4100, @src(0), 64)
CHK("len_64", STR$(Check($4100, 64, @src(0))), "0")
PlusPokeBlock($4200, @src(0), 255)
CHK("len_255", STR$(Check($4200, 255, @src(0))), "0")
PlusPokeBlock($4400, @src(0), 256)
CHK("len_256", STR$(Check($4400, 256, @src(0))), "0")
PlusPokeBlock($4600, @src(0), 257)
CHK("len_257", STR$(Check($4600, 257, @src(0))), "0")
PlusPokeBlock($4800, @src(0), 400)
CHK("len_400", STR$(Check($4800, 400, @src(0))), "0")
CHK("source_intact", STR$(PEEK(@src(0) + 399)), STR$((399 * 7 + 3) BAND 255))
CHK("iff_kept_on", STR$(Iff()), "1")

REM the register table: 3 sprites of 8 bytes
POKE @src(0), 40: POKE @src(0) + 1, 1: POKE @src(0) + 2, 50: POKE @src(0) + 3, 0: POKE @src(0) + 4, 5
POKE @src(0) + 5, 0: POKE @src(0) + 6, 0: POKE @src(0) + 7, 0
PlusPokeBlock($6008, @src(0), 8)
CHK("registers", STR$(PlusPeek($6008)) + " " + STR$(PlusPeek($6009)) + " " + STR$(PlusPeek($600A)) + " " + STR$(PlusPeek($600B)), "40 1 50 0")

REM interrupts off stay off
IntOff()
PlusPokeBlock($4A00, @src(0), 64)
CHK("iff_kept_off", STR$(Iff()), "0")
IntOn()

REM past the end of the page: cut at &7FFF, the RAM above untouched
before = Sum(32768, 64)
PlusPokeBlock($7FF0, @src(0), 64)
after = Sum(32768, 64)
CHK("cut_at_7FFF_ram_above_untouched", STR$(before = after), "1")

REM outside the page: nothing (the pixel RAM keeps what it had)
PlusPoke($4000, 9)
PlusPoke($4001, 7)
PlusPokeBlock($3FFF, @src(1), 4)
PlusPokeBlock($8000, @src(1), 4)
PlusPokeBlock($4001, @src(0), 0)
CHK("outside_and_zero_ignored", STR$(PlusPeek($4000)) + " " + STR$(PlusPeek($4001)), "9 7")
PRINT "DONE"
END

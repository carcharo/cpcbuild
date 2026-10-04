REM Body of plus_big.bas / plus_big_hi.bas (Phase 7 P3): the cpcplus library in a
REM program that is bigger than 16 KB, so that the program's code, the library's own
REM code and the data it reads reach into &4000-&7FFF, where the ASIC register page
REM appears. Nothing here pages the ASIC in by hand (PlusPageIn would reserve the
REM range): everything goes through the library, which runs its paging code from the
REM private block. The including file defines PB_PAD1 and PB_PAD2: the bytes of
REM padding (inside the program code, jumped over) before and after the picture
REM buffers PadImg() and PadPacked() (the padding is $C9 bytes, so a byte of it that
REM the library damaged at &4000 would show).
REM Checks: where the library's code ended up (in the window, or above it),
REM palette, sprite pictures from a source in the window (plain and packed),
REM sprite positions, PlusPeek/PlusPoke, the program's own bytes at &4000 intact
REM after the probe and every call, interrupts on, and a frame hook that calls the
REM library from interrupt context while the main program copies pictures.

#include <cpc.bas>
#include <framehook.bas>
#include <cpcplus/cpcplus.bas>
#include "chk.bas"
#include "plushelp.bas"

REM Code padding with data inside it. PAD_BUF is a 256-byte buffer, PAD_PK 128 bytes.
FUNCTION FASTCALL PadImg() AS UINTEGER
  ASM
  ld hl, PAD_IMG
  END ASM
END FUNCTION

FUNCTION FASTCALL PadPacked() AS UINTEGER
  ASM
  ld hl, PAD_PK
  END ASM
END FUNCTION

FUNCTION FASTCALL LibAddr() AS UINTEGER
  ASM
  ld hl, .core.__PL_PUT
  END ASM
END FUNCTION

REM The sprite colour 4 = palette entry 20 is rewritten by the frame hook every frame.
FUNCTION FASTCALL PbHookAddr() AS UINTEGER
  ASM
  ld hl, PB_HOOK
  jp PB_SKIP
PB_HOOK:
  ld hl, PB_COUNT
  inc (hl)
  ld l, (hl)
  ld h, 0
  ld a, 20
  jp .core.__PL_SETCOL
PB_COUNT:
  defb 0
PB_SKIP:
  END ASM
END FUNCTION

FUNCTION FASTCALL HookCount() AS UBYTE
  ASM
  ld a, (PB_COUNT)
  END ASM
END FUNCTION

ASM
  jp PAD_END
PAD_PRE:
  defs PB_PAD1, $C9
PAD_IMG:
  defs 256, 0
PAD_PK:
  defs 128, 0
PAD_POST:
  defs PB_PAD2, $C9
PAD_END:
END ASM

DIM i, bad AS UINTEGER
DIM v AS UBYTE

REM how many bytes of the block at dest (low nibbles, as the ASIC keeps them) differ from src
FUNCTION PbBad(dest AS UINTEGER, src AS UINTEGER, count AS UINTEGER) AS UINTEGER
  DIM k, b AS UINTEGER
  b = 0
  FOR k = 0 TO count - 1
    IF PlusPeek(dest + k) <> (PEEK(src + k) BAND 15) THEN b = b + 1
  NEXT k
  RETURN b
END FUNCTION
DIM img AS UINTEGER
DIM pk AS UINTEGER
DIM n AS UINTEGER
DIM guard0, guard1 AS UBYTE

img = PadImg()
pk = PadPacked()
CHK("img_in_window", STR$(img >= 16384 AND img < 32768), "1")
#ifdef PB_LIB_HIGH
CHK("lib_above_window", STR$(LibAddr() >= 32768), "1")
#else
CHK("lib_in_window", STR$(LibAddr() >= 16384 AND LibAddr() < 32768), "1")
#endif

REM bytes of the program at &4000-&4003 (the probe writes &4000)
guard0 = PEEK(16384)
guard1 = PEEK(16385)
CHK("avail", STR$(PlusAvailable()), "1")
CHK("probe_left_4000", STR$(PEEK(16384) = guard0 AND PEEK(16385) = guard1), "1")
CHK("iff_on", STR$(Iff()), "1")

REM ---- palette
SetPalette12(3, $0ABC)
CHK("palette_roundtrip", STR$(GetPalette12(3)), STR$($0ABC))
SetBorder12($0123)
CHK("border", STR$(GetPalette12(16)), STR$($0123))
SpriteColour(15, $0F0F)
CHK("spritecolour", STR$(GetPalette12(31)), STR$($0F0F))

REM ---- a picture from the window
FOR i = 0 TO 255
  POKE img + i, (i * 5 + 1) BAND 255
NEXT i
SpriteSetImage(6, img)
bad = 0
FOR i = 0 TO 255
  IF PlusPeek(16384 + 6 * 256 + i) <> (((i * 5 + 1) BAND 255) BAND 15) THEN bad = bad + 1
NEXT i
CHK("image_from_window", STR$(bad), "0")
CHK("image_source_intact", STR$(PEEK(img) + PEEK(img + 255)), STR$(1 + ((255 * 5 + 1) BAND 255)))

FOR i = 0 TO 127
  POKE pk + i, (i * 3 + 7) BAND 255
NEXT i
SpriteSetImagePacked(7, pk)
bad = 0
FOR i = 0 TO 127
  v = (i * 3 + 7) BAND 255
  IF PlusPeek(16384 + 7 * 256 + i * 2) <> (v >> 4) THEN bad = bad + 1
  IF PlusPeek(16384 + 7 * 256 + i * 2 + 1) <> (v BAND 15) THEN bad = bad + 1
NEXT i
CHK("packed_from_window", STR$(bad), "0")

REM ---- PlusPokeBlock from the window: bounced through the library's private buffer, 64 bytes
REM a window
FOR i = 0 TO 499
  POKE img - 100 + i, (i * 11 + 5) BAND 255
NEXT i
PlusPokeBlock($4800, img - 100, 64)
CHK("pokeblock_win_64", STR$(PbBad($4800, img - 100, 64)), "0")
PlusPokeBlock($4900, img - 100, 65)
CHK("pokeblock_win_65", STR$(PbBad($4900, img - 100, 65)), "0")
PlusPokeBlock($4A00, img - 100, 100)
CHK("pokeblock_win_100", STR$(PbBad($4A00, img - 100, 100)), "0")
PlusPokeBlock($4B00, img - 100, 256)
CHK("pokeblock_win_256", STR$(PbBad($4B00, img - 100, 256)), "0")
PlusPokeBlock($4C00, img - 100, 257)
CHK("pokeblock_win_257", STR$(PbBad($4C00, img - 100, 257)), "0")
PlusPokeBlock($4D00, img - 100, 500)
CHK("pokeblock_win_500", STR$(PbBad($4D00, img - 100, 500)), "0")
CHK("pokeblock_win_iff", STR$(Iff()), "1")
CHK("pokeblock_win_ram_intact", STR$(PEEK(16384) = guard0 AND PEEK(16385) = guard1), "1")

REM ---- positions
SpriteMove(2, 300, 80)
CHK("move", STR$(PlusPeek($6010)) + " " + STR$(PlusPeek($6011)) + " " + STR$(PlusPeek($6012)) + " " + STR$(PlusPeek($6013)), "44 1 80 0")
SpriteMove(2, -5, -7)
CHK("move_neg", STR$(PlusPeek($6010)) + " " + STR$(PlusPeek($6011)) + " " + STR$(PlusPeek($6012)) + " " + STR$(PlusPeek($6013)), "251 255 249 255")
SpritesHideAll()
CHK("hideall_keeps_position", STR$(PlusPeek($6010)), "251")

REM ---- PlusPoke / PlusPeek
PlusPoke($4F00, 9)
CHK("poke_peek", STR$(PlusPeek($4F00)), "9")
PlusPoke($3FFF, 1)
PlusPoke($8000, 1)
CHK("outside_ignored", STR$(PlusPeek($3FFF)) + " " + STR$(PlusPeek($8000)), "0 0")
CHK("ram_untouched_by_poke", STR$(PEEK(16384) = guard0 AND PEEK(16385) = guard1), "1")

REM ---- a frame hook that calls the library from interrupt context while the main
REM program copies pictures out of the window
FrameHook(PbHookAddr())
bad = 0
FOR n = 1 TO 40
  FOR i = 0 TO 255
    POKE img + i, i + n
  NEXT i
  SpriteSetImage(n MOD 16, img)
  FOR i = 0 TO 255 STEP 51
    IF PlusPeek(16384 + (n MOD 16) * 256 + i) <> ((i + n) BAND 15) THEN bad = bad + 1
  NEXT i
NEXT n
FrameHookOff()
CHK("hook_ran", STR$(HookCount() >= 5), "1")
CHK("pictures_intact", STR$(bad), "0")
CHK("hook_palette_landed", STR$(GetPalette12(20)), STR$(HookCount()))
CHK("iff_still_on", STR$(Iff()), "1")
CHK("ram_untouched", STR$(PEEK(16384) = guard0 AND PEEK(16385) = guard1), "1")
SpritesHideAll()
PRINT "DONE"
END

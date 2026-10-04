REM MODELS: plus
REM Conformance: the cheap paths of the cpcplus calls (Phase 7 speed fixes, Caprice32 and CPCEC):
REM SpriteMove's in-range fast path and its clamping at each edge, SpriteMoveBlock (first/count
REM masking, a table in &4000-&7FFF, PlusPageIn in force, interrupt state), SetPalette12 /
REM SpriteColour on the fast path before and after PlusPageIn/PlusPageOut and PlusLock, the
REM handler-context entries PlusHandlerIn/Out/Poke/SetColour/SetColourRaw/Scroll called from a
REM frame hook (interrupts off, as in a raster handler), and that none of it leaves interrupts
REM off or the ASIC page in. Read back through the ASIC page.

#include <cpc.bas>
#include <framehook.bas>
#include <cpcbuild/display.bas>
#include "lib/chk.bas"
#include "lib/plushelp.bas"
#require "cpcplus/plushandler.asm"

REM The hook (interrupt context): pen colours and registers through the handler entries.
FUNCTION FASTCALL FastHook() AS UINTEGER
  ASM
  ld hl, FH_HOOK
  jp FH_SKIP
FH_HOOK:
  ld a, 20
  ld de, $0BAC                  ; red A, green B, blue C = &0ABC
  call .core.PlusHandlerSetColourRaw
  ld a, 21
  ld hl, $0123
  call .core.PlusHandlerSetColour
  ld a, $55
  ld hl, $643E                  ; entry 31's first byte
  call .core.PlusHandlerPoke
  ld bc, $0503
  call .core.PlusHandlerScroll
  call .core.PlusHandlerIn
  ld a, $77
  ld ($6402), a                 ; pen 1: red 7, blue 7 (this code is below &4000)
  call .core.PlusHandlerOut
  ld a, 32                      ; refused: entry above 31
  ld de, $0FFF
  call .core.PlusHandlerSetColourRaw
  ld hl, FH_N
  inc (hl)
  ret
FH_N:
  defb 0
FH_SKIP:
  END ASM
END FUNCTION

FUNCTION FASTCALL FastHookN() AS UBYTE
  ASM
  ld a, (FH_N)
  END ASM
END FUNCTION

DIM tbl(31) AS UBYTE
DIM i, bad AS UINTEGER
DIM v AS UBYTE

FUNCTION Reg(n AS UBYTE, k AS UBYTE) AS UBYTE
  RETURN AsicPeek(24576 + CAST(UINTEGER, n) * 8 + k)
END FUNCTION

FUNCTION Pos(n AS UBYTE) AS STRING
  RETURN STR$(Reg(n, 0) + 256 * Reg(n, 1)) + " " + STR$(Reg(n, 2) + 256 * Reg(n, 3))
END FUNCTION

PlusUnlock()
REM ---- SpriteMove: the fast path (in range) and the clamp, edges both sides
SpriteMove(2, 200, 100)
CHK("move_plain", Pos(2), "200 100")
SpriteMove(2, 767, 255)
CHK("move_max", Pos(2), "767 255")
SpriteMove(2, 768, 256)
CHK("move_over", Pos(2), "767 255")
SpriteMove(2, -256, -256)
CHK("move_min", Pos(2), "65280 65280")
SpriteMove(2, -257, -257)
CHK("move_under", Pos(2), "65280 65280")
SpriteMove(2, -1, -1)
CHK("move_minus1", Pos(2), "65535 65535")
SpriteMove(2, 255, 0)
SpriteMove(2, 256, 1)
CHK("move_256_1", Pos(2), "256 1")
SpriteMove(18, 5, 6)
CHK("move_n_masked", Pos(2), "5 6")
SpriteMove(3, 30000, -30000)
CHK("move_wild", Pos(3), "767 65280")
CHK("move_neighbours", Pos(1) + " " + Pos(4), "0 0 0 0")

REM ---- SpriteMoveBlock
FOR i = 0 TO 15
  POKE UINTEGER @tbl(0) + (i * 4), 100 + i * 10
  POKE UINTEGER @tbl(0) + (i * 4) + 2, 50 + i
NEXT i
SpriteMoveBlock(4, 3, @tbl(0))
CHK("block_3", Pos(4) + " | " + Pos(5) + " | " + Pos(6), "100 50 | 110 51 | 120 52")
CHK("block_neighbours", Pos(3) + " | " + Pos(7), "767 65280 | 0 0")
SpriteMoveBlock(14, 5, @tbl(0))
CHK("block_cut_at_16", Pos(14) + " | " + Pos(15), "100 50 | 110 51")
SpriteMoveBlock(20, 1, @tbl(0))
CHK("block_first_masked", Pos(4), "100 50")
SpriteMoveBlock(0, 0, @tbl(0))
CHK("block_count0", Pos(0), "0 0")
SpriteMoveBlock(0, 8, @tbl(0))
CHK("block_8", Pos(0) + " | " + Pos(7), "100 50 | 170 57")
REM -1 and -256 and 767 are what the ASIC takes as they are
POKE UINTEGER @tbl(0), -1
POKE UINTEGER @tbl(0) + 2, -256
SpriteMoveBlock(9, 1, @tbl(0))
CHK("block_negative", Pos(9), "65535 65280")
REM a table in &4000-&7FFF is bounced
FOR i = 0 TO 15
  POKE 17000 + i, PEEK(@tbl(0) + i)
NEXT i
SpriteMoveBlock(10, 4, 17000)
CHK("block_table_in_window", Pos(10) + " | " + Pos(13), "65535 65280 | 130 53")
REM PlusPageIn in force: plain stores, table outside the window
PlusPageIn()
SpriteMoveBlock(11, 2, @tbl(0))
PlusPageOut()
CHK("block_while_paged_in", Pos(11) + " | " + Pos(12), "65535 65280 | 110 51")
CHK("iff_after_blocks", STR$(Iff()), "1")
IntOff()
SpriteMoveBlock(0, 2, @tbl(0))
CHK("block_keeps_di", STR$(Iff()), "0")
IntOn()
CHK("block_leaves_page_out", STR$(PEEK(17000)), STR$(PEEK(@tbl(0))))

REM ---- the fast paths survive PlusPageIn/Out and PlusLock (flags rebuilt)
SetPalette12(5, $0123)
PlusPageIn()
SetPalette12(5, $0456)
SpriteMove(6, 33, 44)
PlusPageOut()
CHK("pal_while_paged_in", STR$(GetPalette12(5)) + " " + Pos(6), "1110 33 44")
SetPalette12(5, $0789)
CHK("pal_after_page_out", STR$(GetPalette12(5)), "1929")
PlusLock()
SpriteColour(2, $0ABC)
CHK("auto_unlock_after_lock", STR$(GetPalette12(18)), "2748")
SetPalette12(5, $0F0F)
SpriteMove(6, 7, 8)
CHK("fast_again", STR$(GetPalette12(5)) + " " + Pos(6), "3855 7 8")
CHK("iff_on", STR$(Iff()), "1")
IntOff()
SetPalette12(5, $0111)
SpriteMove(6, 9, 9)
CHK("window_keeps_di", STR$(Iff()) + " " + STR$(GetPalette12(5)) + " " + Pos(6), "0 273 9 9")
IntOn()

REM ---- handler context, from a frame hook
POKE 16384, 109
SetPalette12(1, $0000)
SetPalette12(31, $0000)
ScrollFine(0, 0)
FrameHook(FastHook())
WaitRetrace(3)
FrameHookOff()
CHK("handler_hook_ran", STR$(FastHookN() >= 2), "1")
CHK("handler_colour_raw", STR$(GetPalette12(20)), "2748")
CHK("handler_colour", STR$(GetPalette12(21)), "291")
CHK("handler_poke", STR$(AsicPeek($643E)), "85")
CHK("handler_scroll", STR$(AsicPeek($6804) BAND $7F), "53")
CHK("handler_in_out", STR$(AsicPeek($6402)), "119")
CHK("handler_entry32_refused", STR$(AsicPeek($6440)) + " " + STR$(AsicPeek($6441)), "0 0")
CHK("handler_page_out", STR$(PEEK(16384)), "109")
CHK("handler_iff", STR$(Iff()), "1")
PRINT "DONE"
END

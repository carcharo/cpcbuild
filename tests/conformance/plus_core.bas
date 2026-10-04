REM MODELS: plus
REM Conformance: the cpcplus library on a CPC Plus (Phase 7 P2), Caprice32 6128 Plus
REM only (no other emulator here has an ASIC): detection, unlock/lock, paging,
REM the 12-bit palette and the sprite registers and pixel RAM, read back through
REM the ASIC page (Caprice32 keeps palette, sprite position and sprite pixels
REM readable; sprite magnification is write-only there, see plus_sprites_vis in
REM tests/screens for what it does), interrupt state, the clock.
REM The ASIC is locked at start-up and PlusAvailable() leaves it so.

#include <cpc.bas>
#include <cpcbuild/display.bas>
#include "lib/chk.bas"
#include "lib/plushelp.bas"
#include "lib/ticks.bas"

DIM img(255) AS UBYTE
DIM i, bad AS UINTEGER
DIM v AS UBYTE
DIM t0 AS ULONG

POKE 16384, $5A
POKE 16385, $A5

REM ---- detection leaves the ASIC locked: RMR2 &BD is then an ordinary RMR
REM (mode 1, both ROMs off, interrupt counter reset: what the program has
REM anyway), so &4000 is still RAM
CHK("avail", STR$(PlusAvailable()), "1")
RawRmr($BD)
CHK("avail_leaves_locked", STR$(PEEK(16384)), "90")
CHK("avail_again", STR$(PlusAvailable()), "1")
RawRmr($BD)
CHK("avail_again_locked", STR$(PEEK(16384)), "90")

REM ---- unlock and paging
PlusUnlock()
CHK("unlock_ram_still_ram", STR$(PEEK(16384)), "90")
PlusPageIn()
CHK("pagein_iff_off", STR$(Iff()), "0")
CHK("pagein_hides_ram", STR$(PEEK(16384) <> 90), "1")
PlusPageOut()
CHK("pageout_ram_back", STR$(PEEK(16384)) + " " + STR$(PEEK(16385)), "90 165")
CHK("pageout_iff_on", STR$(Iff()), "1")
CHK("avail_unlocked", STR$(PlusAvailable()), "1")
PlusPageOut()
CHK("pageout_twice", STR$(PEEK(16384)), "90")
PlusPageIn()
PlusPageIn()
PlusPageOut()
CHK("pagein_twice_one_out", STR$(PEEK(16384)) + " " + STR$(Iff()), "90 1")

REM with interrupts off to start with, they stay off
IntOff()
PlusPageIn()
PlusPageOut()
v = Iff()
SetPalette12(2, $0123)
SpriteMove(1, 5, 5)
IntOn()
CHK("iff_off_kept", STR$(v) + " " + STR$(Iff()), "0 1")

REM ---- lock
PlusLock()
RawRmr($BD)
CHK("lock_ram_visible", STR$(PEEK(16384)), "90")
SetPalette12(3, $0ABC)
CHK("auto_unlock", STR$(GetPalette12(3)), "2748")
PlusLock()
PlusLock()
PlusUnlock()
PlusUnlock()
CHK("lock_unlock_ok", STR$(GetPalette12(3)), "2748")
PlusPageIn()
PlusLock()
CHK("lock_while_paged_in", STR$(PEEK(16384)) + " " + STR$(Iff()), "90 1")
RawRmr($BD)
CHK("locked_after_lock", STR$(PEEK(16384)), "90")

REM ---- nothing here may leave the ASIC raising interrupts: PRI (&6800) and the
REM DMA control/status register (&6C0F) are untouched, and the CPC's ordinary
REM interrupts still run at their rate (no extra, none lost)
CHK("pri_dcsr_zero", STR$(AsicPeek($6800)) + " " + STR$(AsicPeek($6C0F)), "0 0")
t0 = Ticks()
WaitRetrace(10)
t0 = Ticks() - t0
CHK("ticks", STR$(t0 >= 50 AND t0 <= 70), "1")

REM ---- END with sprites showing: the harness still sees the END marker
SpriteSetImage(0, @img(0))
SpriteColour(1, $0F00)
SpriteMove(0, 200, 100)
SpriteMag(0, 4, 4)
PRINT "DONE"
END

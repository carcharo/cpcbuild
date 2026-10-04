REM Body of plus_none.bas / plus_none_hi.bas: a CPC without ASIC (464, 664,
REM 6128): every cpcplus call does nothing and changes nothing. The including
REM file defines PN_BYTE (the byte at &4000 when PlusAvailable() first probes)
REM and PN_DI (1 = start the first call with interrupts off).
REM Hardware state (mode, ROMs, RAM configuration, the CRTC registers) is
REM checked by plus_none_state.bas through chipsrun's state dump.

#include <cpc.bas>
#include <cpcbuild/display.bas>
#include "chk.bas"
#include "plushelp.bas"
#include "ticks.bas"

DIM img(255) AS UBYTE
DIM pal(29) AS UBYTE
DIM blkbuf(63) AS UBYTE
DIM i AS UINTEGER
DIM bad AS UINTEGER
DIM t0 AS ULONG

REM &4000-&40FF: a pattern whose first byte is PN_BYTE
POKE 16384, PN_BYTE
FOR i = 1 TO 255
  POKE 16384 + i, (i * 7) BAND 255
NEXT i
FOR i = 0 TO 255
  img(i) = i
NEXT i
FOR i = 0 TO 29
  pal(i) = $FF
NEXT i

DIM av, fl AS UBYTE
#ifdef PN_DI
IntOff()
#endif
av = PlusAvailable()
fl = Iff()
#ifdef PN_DI
IntOn()
CHK("none_iff_kept", STR$(fl), "0")
#else
CHK("none_iff_kept", STR$(fl), "1")
#endif
CHK("none_avail", STR$(av), "0")
CHK("none_avail_again", STR$(PlusAvailable()), "0")

REM the probe wrote and restored &4000: the whole pattern is as it was
bad = 0
IF PEEK(16384) <> PN_BYTE THEN bad = bad + 1
FOR i = 1 TO 255
  IF PEEK(16384 + i) <> ((i * 7) BAND 255) THEN bad = bad + 1
NEXT i
CHK("none_ram_intact", STR$(bad), "0")

REM every other call: no effect, no crash, interrupts as they were
PlusUnlock()
PlusPageIn()
CHK("none_pagein_is_ram", STR$(PEEK(16384) = PN_BYTE), "1")
CHK("none_pagein_iff", STR$(Iff()), "1")
PlusPageOut()
SetPalette12(1, $0F00)
SetPalette12(16, $0123)
SetBorder12($0ABC)
CHK("none_getpal", STR$(GetPalette12(1)), "0")
SetPalette12Block(@pal(0), 0, 15)
SpritePalette(@pal(0))
SpriteColour(1, $0F0F)
SpriteSetImage(0, @img(0))
SpriteSetImagePacked(3, @img(0))
SpriteMove(0, 100, 50)
SpriteMove(15, -64, 300)
SpriteMoveBlock(0, 4, @blkbuf(0))
SpriteMoveBlock(14, 9, @blkbuf(0))
SpriteMag(0, 2, 2)
SpriteMag(0, 4, 1)
SpriteHide(0)
SpritesHideAll()
ScrollFine(3, 2)
ScrollBorder(1)
SplitScreen(96, $C000)
SplitScreenCrtc(96, $3000)
SplitOff()
CHK("none_dma_refused", STR$(DmaStart(0, @img(0))) + " " + STR$(DmaActive()), "0 0")
DmaStop(0)
DmaPrescaler(1, 4)
CHK("none_peek", STR$(PlusPeek(16384)) + " " + STR$(PlusPeek($6804)), "0 0")
PlusPoke(16384, 77)
CHK("none_poke_ignored", STR$(PEEK(16384) = PN_BYTE), "1")
PlusLock()
PlusUnlock()
PlusLock()
bad = 0
IF PEEK(16384) <> PN_BYTE THEN bad = bad + 1
FOR i = 1 TO 255
  IF PEEK(16384 + i) <> ((i * 7) BAND 255) THEN bad = bad + 1
NEXT i
CHK("none_calls_ram_intact", STR$(bad), "0")
CHK("none_iff_after_calls", STR$(Iff()), "1")
CHK("none_still_none", STR$(PlusAvailable()), "0")

REM the clock still runs at its rate (no interrupt lost or added)
t0 = Ticks()
WaitRetrace(10)
t0 = Ticks() - t0
CHK("none_ticks", STR$(t0 >= 50 AND t0 <= 70), "1")
PRINT "DONE"
END

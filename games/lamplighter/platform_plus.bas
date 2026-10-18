' ----------------------------------------------------------------
' platform_plus.bas -- Lamplighter Plus: the portable layer for the CPC Plus /
' GX4000 (--arch cpc --org 0x40, -D PLUS), mode 0
'
' platform_cpc.bas stays the engine: tiles, text, HUD, input, music. This file
' includes it with the sprite drawing and the room drawing wrapped away, and
' adds the ASIC's own things:
'
'   - the player and the enemies are hardware sprites handed out by the sprite
'     manager (lib/cpcplus/sprman): no erase (TileRestore) and no masked draw
'     (PutSpriteMasked) any more, a moving sprite costs one SprMove;
'   - a sprite is 16 x 16 hardware pixels, magnified 2 x 1: it covers the same
'     8 x 16 mode-0 pixels as the CPC build's sprite (assets/plus/
'     lpsprites.bas, made from the same frames by make_plus_art.py), so
'     logical x (mode-0 pixels) is 4 x in mode-2 pixels, y is y;
'   - 12-bit colours: the playfield's 16 pens (assets/plus/pl_pens.bas) and
'     the sprites' 15 colours;
'   - a lit lamp's flame is drawn in pens 11-14 (assets/plus/plus_tiles.png:
'     no other tile uses them) and palette cycling (lib/cpcplus/palcycle)
'     rotates four flame colours over those pens, so every lit lamp flickers
'     for the cost of one palette block write every second step.
'
' game.bas and main.bas are shared with every other build.
'
' PlatSprite only notes what a slot should show; PlatFlushPlus, which the CPC
' layer's PlatFrameEnd calls right after its frame wait, hands the changes to
' the manager (a new picture is an upload, a move one SprMove) and steps the
' flame, so sprites never move part-way down the screen. A sprite slot is
' allocated when the object appears and freed when it hides; the manager's
' image cache makes the allocation after a room change free of uploads.
'
' Without a Plus the layer says so and stops (firmware build). The bare
' cartridge (-D CPC_BAREMETAL -D CPC_OWNFONT) only runs on a Plus.
' ----------------------------------------------------------------

#ifndef __LAMP_PLUS__
#define __LAMP_PLUS__

#define LAMP_PLUS
#ifdef CPC6128
#undef CPC6128
#endif
' single-buffered, music in the program: no extra RAM bank needed (a GX4000 has none)
#define CPC464

#define PlatInit PlatInitCpc
#define PlatRoom PlatRoomCpc
#define PlatTile PlatTileCpc
#define PlatClear PlatClearCpc
#define PlatEnd PlatEndCpc
#include "platform_cpc.bas"
#undef PlatInit
#undef PlatRoom
#undef PlatTile
#undef PlatClear
#undef PlatEnd

#include <cpcplus/sprman.bas>
#include <cpcplus/palcycle.bas>
#include "assets/plus/lpsprites.bas"
#include "assets/plus/pl_pens.bas"

CONST PL_BORDER AS UINTEGER = $000

DIM pBlack(31) AS UBYTE               ' 16 black pens: the screen while a room is drawn
DIM pHs(4) AS UBYTE                   ' the manager's slot of each object (255: none)
DIM pWant(4) AS UBYTE                 ' the frame it should show (255: hidden) ...
DIM pWx(4) AS UBYTE                   ' ... and where (mode-0 pixels, lines)
DIM pWy(4) AS UBYTE
DIM pAf(4) AS UBYTE                   ' what the slot has been given (frame 255: nothing)
DIM pAx(4) AS UBYTE
DIM pAy(4) AS UBYTE
DIM pDirty AS UBYTE                   ' bit s: object s differs from what the slot has

' The flame: four colours rotated over pens 11-14 every second step. Set again
' whenever the palette has been rewritten (it starts a cycle at offset 0).
SUB FlameStart()
  PalCycleSet(0, 0, FLAME_PEN0, 4, @pl_flame(0), 2)
END SUB

SUB SpritesForget()
  DIM s AS UBYTE
  FOR s = 0 TO NSLOT - 1
    IF pHs(s) <> 255 THEN SprFree(pHs(s))
    pHs(s) = 255
    pAf(s) = 255
  NEXT s
  pDirty = 0
END SUB

SUB PlatInit()
  DIM s AS UBYTE
#ifndef CPC_BAREMETAL
  IF PlusAvailable() = 0 THEN
    PRINT "LAMPLIGHTER PLUS needs a CPC Plus"
    PRINT "or GX4000."
    PAUSE 0
    END
  END IF
#endif
  PlatInitCpc()
  SetPalette12Block(@pl_pens(0), 0, 16)
  SetBorder12(PL_BORDER)
  SpritePalette(@lpsprites_pal(0))
  SprMgrInit(0, NSLOT)
  FOR s = 0 TO NSLOT - 1
    pHs(s) = 255
    pWant(s) = 255
    pAf(s) = 255
  NEXT s
  FlameStart()
END SUB

' Draws a room with the screen blanked, then the pens back and the flame going.
' The sprites are not on the screen's memory, so nothing is forgotten but the
' slots (freed: hidden at once; the cache gives them their pictures back).
SUB PlatRoom(addr AS UINTEGER)
  SetPalette12Block(@pBlack(0), 0, 16)
  TileMap(addr, 0, 0, 20, 23)
  SetPalette12Block(@pl_pens(0), 0, 16)
  FlameStart()
  SpritesForget()
  pDirty = 31
  hLit = 255
END SUB

' One cell changed (hardware sprites are not touched by it).
SUB PlatTile(cx AS UBYTE, cy AS UBYTE, t AS UBYTE)
  DoTile8(cx, cy, t)
END SUB

' Sprite slot s shows frame f at pixel x, line y at the next flush.
SUB PlatSprite(s AS UBYTE, f AS UBYTE, x AS UBYTE, y AS UBYTE)
  pWant(s) = f
  pWx(s) = x
  pWy(s) = y
  IF f <> pAf(s) OR x <> pAx(s) OR y <> pAy(s) THEN pDirty = pDirty BOR bitOf(s)
END SUB

' Hands the changes to the sprite manager and steps the flame (called by
' PlatFrameEnd after the frame wait).
SUB PlatFlushPlus()
  DIM s, f, h AS UBYTE
  DIM img AS UINTEGER
  IF pDirty <> 0 THEN
    FOR s = 0 TO NSLOT - 1
      IF (pDirty BAND bitOf(s)) <> 0 THEN
        f = pWant(s)
        h = pHs(s)
        IF f = 255 THEN
          IF h <> 255 THEN SprFree(h)
          pHs(s) = 255
          pAf(s) = 255
        ELSE
          img = @lpsprites(0) + (CAST(UINTEGER, f) << 8)
          IF h = 255 THEN
            h = SprAlloc(img)
            IF h <> 255 THEN SprMag(h, 2, 1)
            pHs(s) = h
          ELSEIF f <> pAf(s) THEN
            SprSetImage(h, img)
          END IF
          IF h <> 255 THEN
            SprMove(h, CAST(INTEGER, pWx(s)) << 2, pWy(s))
            pAf(s) = f
            pAx(s) = pWx(s)
            pAy(s) = pWy(s)
          END IF
        END IF
      END IF
    NEXT s
    pDirty = 0
  END IF
  SprFlush(NSLOT)
  PalCycleStep()
END SUB

' Blanks the whole screen and forgets the sprites and the HUD.
SUB PlatClear()
  DIM s AS UBYTE
  PlatClearCpc()
  SpritesForget()
  FOR s = 0 TO NSLOT - 1
    pWant(s) = 255
  NEXT s
END SUB

' Back to the machine's own world (sprites are ASIC state that survives END),
' for text output (main.bas under -D BENCH or -D SHOT).
#ifdef TESTSW
SUB PlatEnd()
  SpritesHideAll()
  PlatEndCpc()
END SUB
#endif

#endif

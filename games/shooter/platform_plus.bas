' ----------------------------------------------------------------
' platform_plus.bas -- Starfall Plus: the portable layer for the CPC Plus /
' GX4000 (--arch cpc --org 0x40, -D PLUS), mode 0
'
' platform_cpc.bas is the layer's engine: the software drawing (the formation,
' tiles, text, HUD), input, music. This file includes it with the Plus
' specifics wrapped round it and adds the ASIC's own things:
'
'   - 12-bit colours: the playfield's 16 pens and the border (assets/
'     pl_pens.bas), the sprites' 15 colours (assets/plsprites.bas);
'   - hardware sprites for the objects that move: the ship, the diver, the
'     player's bullets, the enemies' bombs and the explosions. The game draws
'     only the formation in software, so a frame costs a fraction of the
'     CPU the CPC builds' sprite engine takes.
'
' The game's logic (game.bas) and main.bas are shared with every other build:
' this file implements the same PlatSprite / PlatFrameBegin / PlatFrameEnd ...
' routines, handing the kinds 1-3 (the formation) to the engine's own
' PlatSprite (renamed PlatSpriteCpc below) and the rest to a hardware sprite.
'
' Slot plan (the ASIC has 16 sprites; sprite 0 is drawn on top):
'
'   slot  0       the ship               (kind 0)
'   slot  1       the diver              (kind 4)
'   slots 2-3     the player's bullets   (kind 5; the game allows 2)
'   slots 4-6     the bombs              (kind 6; the game allows 3)
'   slots 7-10    explosions             (kind 7; the game allows 4, and
'                                         the ship's own blast is one more)
'   slots 11-15   not used in this build (the formation is software); the
'                 raster-multiplexed formation takes 10-15 in the bare build
'                 (stage 2, platform_plus_raster.bas)
'
' A kind has a fixed number of slots, so a picture's pixels are loaded into a
' slot when its frame changes (a diver's wing beat, an explosion's growth),
' never every frame. A kind that has more objects than slots (the game never
' does with these numbers) shows the first ones and drops the rest: nothing
' else is disturbed.
'
' Geometry: a hardware sprite is 16x16 sprite pixels. Magnified 2x1 one
' sprite pixel is half a mode-0 pixel wide, so the sprite covers 8 mode-0
' pixels by 16 lines, of which our pictures use the top 8 (a bullet or bomb
' 4): the same box as the software sprites and the logic's 8x8 units. The
' explosion is a 16 x 16 line blast centred on the old 8 x 8 box. Logical x is
' mode-0 pixels from the playfield's left edge at screen pixel 16, y lines
' from line 16 of the picture: sprite x = 4 * (16 + x) (mode-2 pixels), y =
' 16 + y.
'
' Updates: PlatSprite only notes what each slot should show; the hardware
' registers are written by PlatFrameEnd right after the pacing wait, that is
' just after the frame tick, so a sprite never moves part-way down the
' screen (what the double buffers' flip does for the software sprites).
'
' Without a Plus the library does nothing; the firmware build says so and
' stops (the bare build is a cartridge: it only runs on a Plus).
' ----------------------------------------------------------------

#ifndef __STARFALL_PLUS__
#define __STARFALL_PLUS__

#define SF_PLUS
#ifdef CPC6128
#undef CPC6128
#endif
' single-buffered, songs in the program: the Plus builds need no extra RAM
' bank (a GX4000 has none) and, without a back screen, no &4000-&7FFF
#define CPC464

#define PlatInit PlatInitCpc
#define PlatFrameBegin PlatFrameBeginCpc
#define PlatFrameEnd PlatFrameEndCpc
#define PlatSprite PlatSpriteCpc
#define PlatClear PlatClearCpc
#define PlatEnd PlatEndCpc
#include "platform_cpc.bas"
#undef PlatInit
#undef PlatFrameBegin
#undef PlatFrameEnd
#undef PlatSprite
#undef PlatClear
#undef PlatEnd

#include <cpcplus/cpcplus.bas>
#include "assets/plsprites.bas"
#include "assets/pl_pens.bas"

CONST HW_SLOTS AS UBYTE = 11          ' slots 0-10 are used by this build

' The sprite registers of slots 0-10 as the ASIC wants them (8 bytes each:
' X low, X high, Y low, Y high, magnification, 3 unused), written to &6000
' in one go each frame. The magnification byte is the "shown" flag: 0 hides.
DIM hwReg(127) AS UBYTE

' The sprite queue, in assembly (a BASIC version of it took 8 ms a logic step:
' every array access with a variable index is a call). HW_SPRITE is
' PlatSprite's body, IX = the SUB's frame as in the engine's SF_SPRITE.
ASM
    jp HW_END

HW_REGP:    defw 0              ; the register table (hwReg)
HW_NP:      defb 0              ; pictures to load at the next frame
HW_CNT:     defs 8              ; objects of each kind queued this frame
HW_IMG:     defs 16, 255        ; the picture each slot has (or will have)
HW_PS:      defs 16             ; the pictures to load: slot,
HW_PI:      defs 16             ;   picture
; by kind (0 ship, 4 diver, 5 bullet, 6 bomb, 7 explosion): first slot,
; slots, first picture
HW_BASE:    defb 0, 0, 0, 0, 1, 2, 4, 7
HW_MAX:     defb 1, 0, 0, 0, 1, 2, 3, 4
HW_PIC:     defb 0, 0, 0, 0, 1, 3, 4, 5

; HW_SPRITE: PlatSprite(kind, frame, x, y), IX = the SUB's frame. The
; formation's kinds 1-3 are the engine's.
HW_SPRITE:
    ld a, (ix+5)
    ld e, a
    ld d, 0
    dec a
    cp 3
    jp c, SF_SPRITE             ; kinds 1-3
    ld hl, HW_CNT
    add hl, de
    ld c, (hl)                  ; C = n, the object's number within its kind
    push hl
    ld hl, HW_MAX
    add hl, de
    ld a, c
    cp (hl)
    pop hl
    ret nc                      ; more objects than slots: dropped
    inc (hl)
    ld hl, HW_BASE
    add hl, de
    ld a, (hl)
    add a, c
    ld c, a                     ; C = the slot
    ld hl, HW_PIC
    add hl, de
    ld a, (hl)
    add a, (ix+7)
    ld b, a                     ; B = the picture
    ld e, c
    ld hl, HW_IMG
    add hl, de
    ld a, (hl)
    cp b
    jr z, HW_SAME
    ld (hl), b                  ; a new picture: queue it for the frame end
    ld a, (HW_NP)
    ld e, a
    inc a
    ld (HW_NP), a
    ld hl, HW_PS
    add hl, de
    ld (hl), c
    ld hl, HW_PI
    add hl, de
    ld (hl), b
HW_SAME:
    ld a, c
    add a, a
    add a, a
    add a, a
    ld e, a
    ld d, 0
    ld hl, (HW_REGP)
    add hl, de                  ; HL = the slot's registers
    ld a, (ix+9)                ; x
    ld e, a
    ld d, 0
    sla e
    rl d
    sla e
    rl d
    ld a, e
    add a, 64
    ld e, a
    jr nc, HW_X1
    inc d
HW_X1:
    ld (hl), e                  ; X = 4 x + 64 (mode-2 pixels)
    inc hl
    ld (hl), d
    inc hl
    ld a, (ix+11)               ; y
    ld e, a
    ld d, 0
    ld a, (ix+5)
    cp 7
    ld a, 16
    jr nz, HW_Y2
    ld a, 12                    ; the blast is 16 lines tall: 4 up
HW_Y2:
    add a, e
    ld e, a
    jr nc, HW_Y3
    inc d
HW_Y3:
    ld (hl), e                  ; Y = y + 16 (an explosion: + 12)
    inc hl
    ld (hl), d
    inc hl
    ld (hl), 9                  ; magnified 2 x 1: shown
    ret

; HW_FRAME: end of a frame's bookkeeping: all magnifications to 0 (hidden
; until queued again), kind counters to 0
HW_FRAME:
    ld hl, (HW_REGP)
    ld de, 4
    add hl, de
    ld de, 8
    ld b, 11
HW_FL:
    ld (hl), 0
    add hl, de
    djnz HW_FL
    ld hl, HW_CNT
    ld b, 8
HW_FC:
    ld (hl), 0
    inc hl
    djnz HW_FC
    ret
HW_END:
END ASM

SUB HwInit()
  ASM
  ld hl, _hwReg.__DATA__
  ld (HW_REGP), hl
  END ASM
END SUB

SUB HwFrame()
  ASM
  call HW_FRAME
  END ASM
END SUB

SUB PlatSprite(kind AS UBYTE, frame AS UBYTE, x AS UBYTE, y AS UBYTE)
  ASM
  call HW_SPRITE
  END ASM
END SUB

' Start of a frame: every slot hidden until queued (the register table
' still holds what the last frame sent, until here).
SUB PlatFrameBegin()
  PlatFrameBeginCpc()
  HwFrame()
END SUB

' Number of pictures waiting to be loaded, and the next one's slot and picture
FUNCTION HwPending() AS UBYTE
  ASM
  ld a, (HW_NP)
  END ASM
END FUNCTION

FUNCTION HwPendingSlot(i AS UBYTE) AS UBYTE
  ASM
  ld a, (ix+5)
  ld e, a
  ld d, 0
  ld hl, HW_PS
  add hl, de
  ld a, (hl)
  END ASM
END FUNCTION

FUNCTION HwPendingPic(i AS UBYTE) AS UBYTE
  ASM
  ld a, (ix+5)
  ld e, a
  ld d, 0
  ld hl, HW_PI
  add hl, de
  ld a, (hl)
  END ASM
END FUNCTION

SUB HwPendingDone()
  ASM
  xor a
  ld (HW_NP), a
  END ASM
END SUB

' Forgets what the slots show and hides them all (the sprites of a screen
' that is being replaced).
SUB HwHideAll()
  SpritesHideAll()
  HwFrame()
  HwPendingDone()
END SUB

' End of a frame: the engine's wait for the next logic step, then the
' hardware sprites are updated at the start of the frame: the pictures that
' changed, then all 11 slots' registers in one block.
SUB PlatFrameEnd()
  DIM i, n AS UBYTE
  PlatFrameEndCpc()
  n = HwPending()
  IF n <> 0 THEN
    FOR i = 0 TO n - 1
      SpriteSetImagePacked(HwPendingSlot(i), @plsprites(0) + (CAST(UINTEGER, HwPendingPic(i)) << 7))
    NEXT i
    HwPendingDone()
  END IF
  PlusPokeBlock($6000, @hwReg(0), CAST(UINTEGER, HW_SLOTS) << 3)
END SUB

SUB PlatClear()
  PlatClearCpc()
  HwHideAll()
  PlusPokeBlock($6000, @hwReg(0), CAST(UINTEGER, HW_SLOTS) << 3)
END SUB

SUB PlatInit()
#ifndef CPC_BAREMETAL
  IF PlusAvailable() = 0 THEN
    PRINT "STARFALL PLUS needs a CPC Plus"
    PRINT "or GX4000."
    PRINT
    PRINT "On a CPC 464/664/6128: RUN"; CHR$(34); "DISC"
    PAUSE 0
    END
  END IF
#endif
  PlatInitCpc()
  SetPalette12Block(@pl_pens(0), 0, 16)
  SetBorder12(PL_BORDER)
  SpritePalette(@plsprites_pal(0))
  HwInit()
  HwHideAll()
END SUB

' Back to the machine's own world: sprites are ASIC state that survives END.
SUB PlatEnd()
  HwHideAll()
  PlatEndCpc()
END SUB

#endif

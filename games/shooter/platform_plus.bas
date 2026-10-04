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
'   slots 11-15   not used in the disc build (the formation is software); the
'                 cartridge build (-D PLUS_MUX) uses 10-15 for the formation and
'                 gives the explosions 7-9 only (a 4th is dropped), see "The
'                 multiplexed formation" below
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
' The multiplexed formation (-D PLUS_MUX, the bare cartridge; platform_plus_mux.inc)
' ----------------------------------------------------------------------------
' The ASIC has 16 sprites and the formation 18 aliens in three rows, 12 lines apart
' (the alien is 8 lines tall in a 16-line sprite). Six sprites (10-15) show them: the
' k-th living alien of a row is sprite 10 + k, and raster interrupts move the six on to
' the next row once a row has been drawn:
'
'   - PlatSprite only logs a formation call (kind, frame, x, y); PlatFrameEnd's flush
'     turns the log into three row tables (X, Y of six sprites + the row's two colours;
'     a hidden sprite has Y = -128), in a shadow buffer. The commit, right after the
'     frame tick (the wait is in HALT, and a late step waits for the next tick), swaps
'     the buffers and writes the top row to the ASIC at once.
'   - Four handlers (RasterIntAt; PlusHandlerIn/Out and block copies, code and tables
'     below &4000, checked by build_plus.sh): H1 at line (top row's line + 6) writes
'     row 1's table, H2 at (row 1's line + 6) row 2's, H3 at (row 2's line + 6) the top
'     row again for the next frame, H4 14 lines later loads the aliens' second animation
'     frame when the frame changed (it differs in picture lines 5-7 only: 48 bytes in
'     each of the six sprites, after the last row has been drawn). A handler's writes
'     land about 3 to 5 lines after its line, in the 4 lines between a row's last
'     picture line and the next row's first (measured on CPCEC). A row table is 6
'     sprites x (X, Y) + two palette entries (the aliens' body and light colours), so
'     the rows differ in colour (magenta, red, green) while sharing one shape.
'   - When the formation steps down, the four lines move in the raster table in place
'     (MX_RELINE; RasterIntAt/Off take 1.2 ms a pair).
'   - Everything long that the main thread does (sprite registers, pictures) is in the
'     vertical blank, the pictures at most two a frame (the rest wait), and the keys
'     are read there too (PlatInput returns the value read at the tick): an
'     interrupts-off window that a handler line falls into would shift its writes.
'   - Fallback: when a frame cannot be multiplexed (more than 6 in a row, a row whose
'     sprites differ in y, rows closer than 12 lines or out of order, x above 175, a
'     row too low for H4 to finish before the frame entry, more than 24 formation
'     calls) the logged sprites are drawn in software by the CPC engine (SF_SPRITE) and
'     the six sprites hide; the next normal frame multiplexes again. The game's own
'     numbers (6 per row, rows 12 apart, x 0-120, y up to 143) never trigger it.
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

#ifdef PLUS_MUX
#ifndef CPC_BAREMETAL
#error "PLUS_MUX (raster-multiplexed formation) is for the bare-metal cartridge build"
#endif
#define SF_PLUS_MUX
#endif

#define PlatInit PlatInitCpc
#define PlatFrameBegin PlatFrameBeginCpc
#define PlatFrameEnd PlatFrameEndCpc
#define PlatSprite PlatSpriteCpc
#define PlatClear PlatClearCpc
#define PlatEnd PlatEndCpc
#ifdef PLUS_MUX
#define PlatInput PlatInputCpc
#endif
#include "platform_cpc.bas"
#ifdef PLUS_MUX
#undef PlatInput
#endif
#undef PlatInit
#undef PlatFrameBegin
#undef PlatFrameEnd
#undef PlatSprite
#undef PlatClear
#undef PlatEnd

#include <cpcplus/cpcplus.bas>
#include "assets/plsprites.bas"
#include "assets/pl_pens.bas"

#ifdef PLUS_MUX
CONST HW_SLOTS AS UBYTE = 10          ' slots 0-9 as below; 10-15 are the formation's
#else
CONST HW_SLOTS AS UBYTE = 11          ' slots 0-10 are used by this build
#endif

' The sprite registers of slots 0-10 as the ASIC wants them (8 bytes each:
' X low, X high, Y low, Y high, magnification, 3 unused), written to &6000
' in one go each frame. The magnification byte is the "shown" flag: 0 hides.
DIM hwReg(127) AS UBYTE

' The sprite queue, in assembly (a BASIC version of it took 8 ms a logic step:
' every array access with a variable index is a call). HW_SPRITE is
' PlatSprite's body, IX = the SUB's frame as in the engine's SF_SPRITE.
ASM
    jp HW_END

#ifdef PLUS_MUX
HW_NSL      EQU 10              ; slots the table covers (hidden at each frame start)
#else
HW_NSL      EQU 11
#endif
HW_REGP:    defw 0              ; the register table (hwReg)
HW_NP:      defb 0              ; pictures to load at the next frame
HW_CNT:     defs 8              ; objects of each kind queued this frame
HW_IMG:     defs 16, 255        ; the picture each slot has (or will have)
HW_PS:      defs 16             ; the pictures to load: slot,
HW_PI:      defs 16             ;   picture
; by kind (0 ship, 4 diver, 5 bullet, 6 bomb, 7 explosion): first slot,
; slots, first picture
HW_BASE:    defb 0, 0, 0, 0, 1, 2, 4, 7
#ifdef PLUS_MUX
HW_MAX:     defb 1, 0, 0, 0, 1, 2, 3, 3
#else
HW_MAX:     defb 1, 0, 0, 0, 1, 2, 3, 4
#endif
HW_PIC:     defb 0, 0, 0, 0, 1, 3, 4, 5

; HW_SPRITE: PlatSprite(kind, frame, x, y), IX = the SUB's frame. The
; formation's kinds 1-3 are the engine's.
HW_SPRITE:
    ld a, (ix+5)
    ld e, a
    ld d, 0
    dec a
    cp 3
#ifdef PLUS_MUX
    jp c, MX_SPRITE             ; kinds 1-3: the multiplexed formation
#else
    jp c, SF_SPRITE             ; kinds 1-3
#endif
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
    ld (hl), 9                  ; magnified 2 x 1: shown (bytes 4-7 of a sprite's
    inc hl                      ; registers are one: the ASIC decodes only A2, CPCEC
    ld (hl), 9                  ; models it so, so the unused bytes carry the value
    inc hl
    ld (hl), 9
    inc hl
    ld (hl), 9
    ret

; HW_FRAME: end of a frame's bookkeeping: all magnifications to 0 (hidden
; until queued again), kind counters to 0
HW_FRAME:
    ld hl, (HW_REGP)
    ld de, 4
    add hl, de
    ld de, 5
    ld b, HW_NSL
HW_FL:
    ld (hl), 0                  ; bytes 4-7: the magnification (see HW_SPRITE)
    inc hl
    ld (hl), 0
    inc hl
    ld (hl), 0
    inc hl
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
#ifdef PLUS_MUX
#include "platform_plus_mux.inc"
#endif
HW_END:
END ASM

#ifdef PLUS_MUX
' ---- the multiplexed formation (platform_plus_mux.inc has the assembly) ----

DIM plpix(2559) AS UBYTE              ' the ten pictures unpacked, 256 bytes each (the ASIC's format)
DIM mxKeys AS UBYTE                   ' PlatInput's value, read at the frame tick

SUB MxFlush()
  ASM
  call MX_FLUSH
  END ASM
END SUB

FUNCTION MxReline() AS UBYTE
  ASM
  call MX_RELINE
  END ASM
END FUNCTION

SUB MxCommit()
  ASM
  call MX_COMMIT
  END ASM
END SUB

SUB MxHideAll()
  ASM
  call MX_HIDEALL
  END ASM
END SUB

' the aliens' frame queued this frame (0-1), 255 = none
FUNCTION MxFrame() AS UBYTE
  ASM
  ld a, (MX_FR)
  END ASM
END FUNCTION

' 1 if this frame's rows gave the handler lines (MxNewLine)
FUNCTION MxLinesValid() AS UBYTE
  ASM
  ld a, (MX_LV)
  END ASM
END FUNCTION

FUNCTION MxNewLine(i AS UBYTE) AS UBYTE
  ASM
  ld a, (ix+5)
  ld e, a
  ld d, 0
  ld hl, MX_NEWL
  add hl, de
  ld a, (hl)
  END ASM
END FUNCTION

FUNCTION MxActLine(i AS UBYTE) AS UBYTE
  ASM
  ld a, (ix+5)
  ld e, a
  ld d, 0
  ld hl, MX_ACTL
  add hl, de
  ld a, (hl)
  END ASM
END FUNCTION

SUB MxSetActLine(i AS UBYTE, v AS UBYTE)
  ASM
  ld a, (ix+5)
  ld e, a
  ld d, 0
  ld hl, MX_ACTL
  add hl, de
  ld a, (ix+7)
  ld (hl), a
  END ASM
END SUB

' The handler of line i (0 = the one for row 1, 1 = row 2, 2 = the top row
' again, 3 = the aliens' legs)
FUNCTION MxHandler(i AS UBYTE) AS UINTEGER
  ASM
  ld a, (ix+5)
  ld e, a
  ld d, 0
  ld hl, MX_HTAB
  add hl, de
  add hl, de
  ld a, (hl)
  inc hl
  ld h, (hl)
  ld l, a
  END ASM
END FUNCTION

' Puts the raster table right for this frame's rows: the lines that are new
' are added first, then the old ones that are no longer wanted go, so the
' table is never empty (that would switch raster mode off and on). It changes
' only when the formation steps down (every 6 lines of y) or a row empties.
SUB MxLines()
  DIM i, j, l, keep AS UBYTE
  IF MxLinesValid() = 0 THEN RETURN
  keep = 1
  FOR i = 0 TO 3
    IF MxNewLine(i) <> MxActLine(i) THEN keep = 0
  NEXT i
  IF keep = 1 THEN RETURN
  IF MxReline() <> 0 THEN RETURN
  FOR i = 0 TO 3
    RasterIntAt(MxNewLine(i), MxHandler(i))
  NEXT i
  FOR i = 0 TO 3
    l = MxActLine(i)
    IF l <> 0 THEN
      keep = 0
      FOR j = 0 TO 3
        IF MxNewLine(j) = l THEN keep = 1
      NEXT j
      IF keep = 0 THEN RasterIntOff(l)
    END IF
  NEXT i
  FOR i = 0 TO 3
    MxSetActLine(i, MxNewLine(i))
  NEXT i
END SUB

' Nothing in the formation sprites: hidden, magnified 2 x 1 (hidden by Y, so
' that the handlers' register writes need no magnification byte).
SUB MxClear()
  DIM s AS UBYTE
  MxHideAll()
  FOR s = 10 TO 15
    PlusPoke($6004 + (CAST(UINTEGER, s) << 3), 9)
  NEXT s
END SUB

SUB MxUnpack(src AS UINTEGER, dst AS UINTEGER, n AS UINTEGER)
  ASM
  ld l, (ix+4)
  ld h, (ix+5)
  ld e, (ix+6)
  ld d, (ix+7)
  ld c, (ix+8)
  ld b, (ix+9)
  call MX_UNPACK
  END ASM
END SUB

FUNCTION MxLegsAddr() AS UINTEGER
  ASM
  ld hl, MX_LEGS
  END ASM
END FUNCTION

SUB HwLoad(pic AS UBYTE, slot AS UBYTE)
  ASM
  ld a, (ix+5)
  ld c, (ix+7)
  call HW_LOAD
  END ASM
END SUB

SUB MxPreload()
  ASM
  call MX_PRELOAD
  END ASM
END SUB

SUB HwPics()
  ASM
  call HW_PICS
  END ASM
END SUB

SUB HwPush()
  ASM
  call HW_PUSH
  END ASM
END SUB

SUB MxInit()
  DIM s, f AS UBYTE
  MxUnpack(@plsprites(0), @plpix(0), 1280)
  FOR f = 0 TO 1
    MxUnpack(@plsprites(0) + (CAST(UINTEGER, 8 + f) << 7) + 40, MxLegsAddr() + CAST(UINTEGER, f) * 48, 24)
  NEXT f
  MxPreload()
  FOR s = 10 TO 15
    HwLoad(8, s)
  NEXT s
  MxClear()
END SUB
#endif

SUB HwInit()
  ASM
  ld hl, _hwReg.__DATA__
  ld (HW_REGP), hl
#ifdef PLUS_MUX
  ld hl, _plpix.__DATA__
  ld (HW_PIXP), hl
#endif
  END ASM
END SUB

SUB HwFrame()
  ASM
  call HW_FRAME
#ifdef PLUS_MUX
  call MX_FRAME
#endif
  END ASM
END SUB

SUB PlatSprite(kind AS UBYTE, frame AS UBYTE, x AS UBYTE, y AS UBYTE)
  ASM
  call HW_SPRITE
  END ASM
END SUB

#ifdef PLUS_MUX
' The keys are read in the vertical blank (PlatFrameEnd): a key scan switches
' interrupts off for a while, and a raster handler must not wait behind that.
FUNCTION PlatInput() AS UBYTE
  RETURN mxKeys
END FUNCTION
#endif

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
#ifdef PLUS_MUX
  MxFlush()
  PlatFrameEndCpc()
  ' the vertical blank: the formation's tables, the other sprites' registers
  ' and pictures, the keys; kept short (a raster handler waits behind any
  ' interrupts-off window), see platform_plus_mux.inc
  MxCommit()
  MxLines()
  HwPush()
  HwPics()
  mxKeys = PlatInputCpc()
#else
  PlatFrameEndCpc()
  n = HwPending()
  IF n <> 0 THEN
    FOR i = 0 TO n - 1
      SpriteSetImagePacked(HwPendingSlot(i), @plsprites(0) + (CAST(UINTEGER, HwPendingPic(i)) << 7))
    NEXT i
    HwPendingDone()
  END IF
  PlusPokeBlock($6000, @hwReg(0), CAST(UINTEGER, HW_SLOTS) << 3)
#endif
#ifdef MX_TEST
  ASM
  ld a, 1
  ld (MX_DONE), a
  END ASM
#endif
END SUB

SUB PlatClear()
  PlatClearCpc()
  HwHideAll()
#ifdef PLUS_MUX
  MxClear()
#endif
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
#ifdef PLUS_MUX
  mxKeys = PlatInputCpc()
#endif
  SetPalette12Block(@pl_pens(0), 0, 16)
  SetBorder12(PL_BORDER)
  SpritePalette(@plsprites_pal(0))
  HwInit()
  HwHideAll()
#ifdef PLUS_MUX
  MxInit()
#endif
END SUB

' Back to the machine's own world: sprites are ASIC state that survives END.
SUB PlatEnd()
#ifdef PLUS_MUX
  RasterIntClear()
#endif
  HwHideAll()
  PlatEndCpc()
END SUB

#endif

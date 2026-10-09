' ----------------------------------------------------------------
' platform_cpc.bas -- Starfall's portable layer for the Amstrad CPC
' (--arch cpc --org 0x40), mode 0
'
' Build switches: -D CPC6128 (default) double-buffered; -D CPC464
' single-buffered, drawing in flyback order; -D NOSOUND; -D NOGAMEMODE
' (no game mode while playing: for benchmarks); -D SHOT=n and -D BENCH are
' handled by main.bas through PlatShot and PlatEnd.
'
' Screen (mode 0, 20 x 25 tile cells of 4 x 8 bytes): cells 0-1 and 18-19
' are the side borders, row 0 the HUD, row 1 its rule, rows 22-24 the
' ground; the 128 x 160 playfield is cells 2-17 x 2-21 (byte column
' 8 + x / 2, line 16 + y). Logical units are mode-0 pixels.
'
' The layer is BASIC on the cpcbuild library: sprites by spritelist.bas,
' text by text.bas, tiles by tiles.bas, the playfield clear by fill.bas,
' plus the display, keyboard and palette modules. The playfield background
' is plain black (plus a few static stars), which is what spritelist.bas is
' for: a sprite (pixels only: transparent is black) is ORed onto the black
' and erased by clearing its box, which a full formation needs to be cheap
' enough for 25 steps a second. The text is a 5 x 7 font (7 bytes a glyph,
' not 32-byte tile glyphs). What is left of Starfall's own is three small
' assembly routines, each because BASIC was measurably too slow or too big:
' SF_SPRITE (the kind-to-frame table and the logical-to-screen mapping,
' calling spritelist's __SL_SPRITE with registers: a BASIC call of
' SprListDraw costs ~1,100 T and a step draws ~20 sprites, which dropped
' the 6128 below 25 steps a second), SF_HUD (the HUD diffing per screen,
' drawing through tiles' __CB_TILE_AT and text's __TX_PENS/__TX_PUTS: in
' BASIC it also missed 25 steps a second and was ~500 bytes larger) and
' Stars (BASIC: 132 bytes against ~45, ~14,000 T a frame).
'
' The sprite list: PlatSprite draws with SprListDraw. 6128:
' PlatFrameEnd flips, then SprListBegin erases the list of the screen to
' be drawn next (drawn two frames ago). 464: the list is the one screen's;
' SprListDraw erases the previous frame's sprite of the same slot (same
' call number) just before drawing its own, so each sprite is blank only
' for a moment: flyback order.
'
' The erase, the stars and the queued text come at the end of
' PlatFrameEnd, in that order, so that everything the game draws until
' the next PlatFrameEnd (the sprites, and the text PlatText draws at once
' on the screen being drawn and again on the other one, TextAtBoth and
' TextFlush) lands on a screen that has already been erased and starred.
'
' Timing: one logic step is two frames (25 Hz) counted by Frames(); a
' step that takes longer is never made up for.
' ----------------------------------------------------------------

#ifndef __STARFALL_PLATFORM__
#define __STARFALL_PLATFORM__

#ifndef __CPC__
#error "platform_cpc.bas is for --arch cpc"
#endif

#ifndef CPC464
#ifndef CPC6128
#define CPC6128
#endif
#endif

' Sizes of the library's lists, set to what the game can produce: a frame's
' sprites are at most 29 (the formation 18, the diver 1, the ship or its
' explosion 1, bullets 2, bombs 3, explosions 4); the text queue (6128
' only) holds the title's nine texts at once: 8 + 4 + 4 x 4 + 10 + 14 + 13
' characters and 4 bytes of header each = 101 bytes (GAME OVER and NEW HIGH
' SCORE: 31).
#define SPRLIST_MAX 29
#define TEXT_QUEUE 101

#include <cpc.bas>
#include <cpcbuild/display.bas>
#include <cpcbuild/keyboard.bas>
#include <cpcbuild/palette.bas>
#include <cpcbuild/spritelist.bas>
#include <cpcbuild/text.bas>
#include <cpcbuild/tiles.bas>
#include <cpcbuild/fill.bas>
#include <framehook.bas>

#ifdef CPC6128
' Double-buffered builds: the constant graphics arrays below (sprites,
' sprites_pal, shots, tiles, tiles_pal, font: 970 bytes; and the star table)
' have their data bytes placed from &8000 up (their descriptors stay low),
' which keeps the low segment (the part below the back screen at &4000)
' smaller. The gap up to &8000 is zero-filled in the one .bin;
' EnableDoubleBuffer copies the screen over &4000-&7FFF. Nothing here is
' read by the firmware through a pointer (and &8000-&BFFF would be fine for
' that anyway). The 464 has one screen and no limit at &4000, so it keeps
' everything in place.
#pragma hidata = $8000
#endif
' sprites: 12 frames of 4 bytes x 8 lines (32 bytes, pixels only: they are ORed
' onto the erased black); shots: 2 of 1 x 4 (4 bytes)
#include "assets/sprites.bas"
#include "assets/shots.bas"
' tiles: 0 border outer, 1 inner left, 2 inner right, 3 HUD rule, 4 ground,
' 5 ground fill, 6 life icon; and tiles_pal, the 16 pens
#include "assets/tiles.bas"
' font: 7 bytes a character, ASCII 45-90, in the library's format (assets/
' fontcpc.bas: the 5 x 7 font shifted left 2, so bit 7 is the leftmost
' pixel and the glyph keeps its one-pixel left margin)
#include "assets/fontcpc.bas"
' the static stars: 20 x (offset in the 16 KB screen, byte)
DIM starTab(59) AS UBYTE => { _
    $61, $02, $AA, _
    $2A, $31, $51, _
    $01, $1E, $A2, _
    $24, $3C, $55, _
    $13, $19, $A2, _
    $13, $0D, $51, _
    $B6, $09, $AA, _
    $7E, $09, $51, _
    $E7, $1A, $A2, _
    $89, $23, $55, _
    $1D, $32, $A2, _
    $57, $26, $51, _
    $6F, $0E, $AA, _
    $AF, $21, $51, _
    $80, $0C, $A2, _
    $8F, $32, $55, _
    $37, $16, $A2, _
    $FE, $13, $51, _
    $83, $3E, $AA, _
    $52, $34, $51 _
}
#ifdef CPC6128
#pragma hidata = 0
#endif

#ifndef NOSOUND
#ifdef CPC6128
#define SF_BANKMUSIC
#endif
#ifdef SF_BANKMUSIC
' 6128: the songs are in extra RAM bank 0 (assets/starfall.dat, loaded from
' the disc at start with BankLoad: title at &4000, in-game loop at &4400);
' the effects stay in main RAM (the library's rule). If the load fails (no
' disc or no extra RAM) the game runs silently. -D NODISC skips the load (the
' chips emulator has no disc and BankLoad hangs there: tests/run.py, bench.sh).
#include <cpcbuild/banks.bas>
#include <music/music.bas>
#include "assets/sfx.bas"
#else
#include <music/music.bas>
#include "assets/title.bas"
#include "assets/gamesong.bas"
#include "assets/sfx.bas"
#endif
#endif

#ifdef SHOT
#include "../../tests/screens/lib/shot.bas"
#endif

' ---- sprites, stars, the HUD ------------------------------------------

DIM hudS, hudH AS UINTEGER
DIM hudL, hudW, hudDirty AS UBYTE
DIM curTune, bankOK AS UBYTE         ' music; songs in the bank
DIM fT AS UINTEGER                  ' Frames() at the start of this step

' ---- PlatSprite: assembly ---------------------------------------------
' PlatSprite(kind, frame, x, y): a sprite of the playfield. Logical x, y
' (mode-0 pixels) map to byte column 8 + x / 2 and line 16 + y; one at
' y >= 160 is not drawn. The work is SF_SPRITE, in assembly (see the
' header): SprListDraw called from BASIC costs
' ~1,100 T-states a sprite more than its routine (spritelist.bas, Cost), and
' a frame has about 20 sprites, which 25 steps a second cannot afford.
asm
    jp SF_END

SF_SPR:     defw 0              ; the 12 4 x 8 frames
SF_SHOT:    defw 0              ; the 2 1 x 4 frames
SF_KBASE:   defb 0, 1, 3, 5, 7  ; first frame of each kind (0-4, 7; kinds 5, 6 are the shots)
            defb 0, 0, 9

; SF_SPRITE: PlatSprite(kind, frame, x, y), IX = the SUB's frame. Maps the
; kind and frame to the graphic and calls the library's register entry
; __SL_SPRITE (C = x, B = y, E = w, D = h, HL = data; spritelist.asm). Clobbers
; AF, BC, DE, HL (IX kept).
SF_SPRITE:
    ld a, (ix+11)           ; y
    cp 160
    ret nc
    add a, 16
    ld b, a                 ; B = line
    ld a, (ix+9)            ; x
    srl a
    add a, 8
    ld c, a                 ; C = byte column
    ld a, (ix+5)            ; kind
    ld e, a
    sub 5
    cp 2
    jr c, SF_SSHOT
    ld d, 0
    ld hl, SF_KBASE
    add hl, de
    ld a, (hl)
    add a, (ix+7)           ; + frame
    ld l, a
    ld h, 0
    add hl, hl
    add hl, hl
    add hl, hl
    add hl, hl
    add hl, hl              ; * 32
    ld de, (SF_SPR)
    add hl, de
    ld de, 8 * 256 + 4      ; 4 x 8
    jp .core.__SL_SPRITE
SF_SSHOT:
    add a, a
    add a, a                ; (kind - 5) * 4
    ld l, a
    ld h, 0
    ld de, (SF_SHOT)
    add hl, de
    ld de, 4 * 256 + 1      ; 1 x 4
    jp .core.__SL_SPRITE

SF_END:
end asm

SUB PlatSprite(kind AS UBYTE, frame AS UBYTE, x AS UBYTE, y AS UBYTE)
  ASM
  call SF_SPRITE
  END ASM
END SUB

' The sprite and shot graphics, for SF_SPRITE (the arrays are only reached
' by address, so BASIC hands the addresses over).
SUB SfGfx(spr AS UINTEGER, shots AS UINTEGER)
  ASM
  ld l, (ix+4)
  ld h, (ix+5)
  ld (SF_SPR), hl
  ld l, (ix+6)
  ld h, (ix+7)
  ld (SF_SHOT), hl
  END ASM
END SUB

' The static stars, on the screen being drawn where it is black: put the
' byte of each of the 20 table entries (offset in the 16 KB screen, byte) at
' its place unless something is drawn there. Assembly for size and speed (a
' BASIC version took 132 bytes, ~14,000 T-states a frame; this is ~45 bytes,
' ~2,500). Clobbers AF, BC, DE, HL.
SUB FASTCALL Stars(st AS UINTEGER)   ' st: @starTab(0), in HL
  ASM
  ld a, (.core.CB_BASE)
  ld b, a
  ld c, 20
SF_ST1:
  ld e, (hl)
  inc hl
  ld a, (hl)
  inc hl
  or b
  ld d, a
  ld a, (de)
  or a
  jr nz, SF_ST2
  ld a, (hl)
  ld (de), a
SF_ST2:
  inc hl
  dec c
  jr nz, SF_ST1
  END ASM
END SUB

' Blanks the playfield (64 bytes x 160 lines from byte column 8, line 16) of
' the screen being drawn, then the stars.
SUB ClearField()
  FillRect(8, 16, 64, 160, 0)
  Stars(@starTab(0))
END SUB

' ---- the HUD: assembly -------------------------------------------------
' SfHud draws the HUD: hudS, hudL, hudW, hudH as 20 characters (cells 0-4
' score, 6 life icon, 7 lives, 9 W, 10-11 wave, 13 H, 14-18 high score),
' each cell that differs from what the screen being drawn shows (one list of
' 20 per screen, 255 = unknown). Assembly, because the same in BASIC (it
' was written first) made the 6128 build miss its 25 steps a second (23.4
' to 24.5 steps/s on the bench: a changed cell costs ~5,800 T-states
' through TextAt(col, row, CHR$(c)) against ~2,900 here, and the digit and
' diff loops dozens of BASIC statements) and ~500 bytes larger. It draws
' through the library's documented register entries (tile8.asm, text.asm):
' __CB_TILE_AT, __TX_PENS, __TX_PUTS, not through their BASIC subs.
asm
    jp SF_HEND

SF_HUDB:    defs 20             ; the HUD as characters
SF_HUDS:    defs 40             ; what each screen shows (255 = unknown)
SF_HCH:     defb 0              ; the character being drawn

; SF_DEC5: HL = value, DE = destination: five ASCII digits, DE advanced.
; Clobbers AF, BC, DE, HL.
SF_DEC5:
    ld bc, -10000
    call SF_DE1
    ld bc, -1000
    call SF_DE1
    ld bc, -100
    call SF_DE1
    ld bc, -10
    call SF_DE1
    ld a, l
    add a, 48
    ld (de), a
    inc de
    ret
SF_DE1:
    ld a, 47
SF_DE2:
    inc a
    add hl, bc
    jr c, SF_DE2
    sbc hl, bc
    ld (de), a
    inc de
    ret

; SF_HCELL: draws character A (1 = the life icon, else a font character) at
; cell column C, row 0. Letters (65 up) are drawn in pen 2, the rest in pen
; 1, the text module's default. Clobbers AF, BC, DE, HL (the library's
; routines use no others).
SF_HCELL:
    cp 1
    jr nz, SF_HTXT
    ld b, 0
    ld hl, 6                    ; tile 6
    jp .core.__CB_TILE_AT       ; C = cell x, B = cell y, HL = tile
SF_HTXT:
    ld (SF_HCH), a
    cp 65
    jr c, SF_HDRAW
    ld a, 2
    push bc
    call .core.__TX_PENS        ; A = ink | paper << 4
    pop bc
    call SF_HDRAW
    ld a, 1
    jp .core.__TX_PENS
SF_HDRAW:
    xor a                       ; row 0
    ld b, 1                     ; one character
    ld de, SF_HCH
    jp .core.__TX_PUTS          ; A = row, C = column, B = length, DE = text

; SF_HUD: builds the characters and draws the cells that differ from what the
; screen being drawn shows. Clobbers AF, BC, DE, HL.
SF_HUD:
    ld de, SF_HUDB
    ld hl, (_hudS)
    call SF_DEC5
    ld a, 32
    ld (de), a
    inc de
    ld a, 1
    ld (de), a
    inc de
    ld a, (_hudL)
    add a, 48
    ld (de), a
    inc de
    ld a, 32
    ld (de), a
    inc de
    ld a, 87                    ; W
    ld (de), a
    inc de
    ld a, (_hudW)
    ld b, 48
SF_HW1:
    cp 10
    jr c, SF_HW2
    sub 10
    inc b
    jr SF_HW1
SF_HW2:
    ld c, a
    ld a, b
    ld (de), a
    inc de
    ld a, c
    add a, 48
    ld (de), a
    inc de
    ld a, 32
    ld (de), a
    inc de
    ld a, 72                    ; H
    ld (de), a
    inc de
    ld hl, (_hudH)
    call SF_DEC5
    ld a, 32
    ld (de), a
    ld hl, SF_HUDS
    ld a, (.core.CB_BASE)
    rla                         ; carry = the screen at &C000
    jr nc, SF_HU1
    ld de, 20
    add hl, de
SF_HU1:
    ld de, SF_HUDB
    ld c, 0
SF_HU2:
    ld a, (de)
    cp (hl)
    jr z, SF_HU4
    ld (hl), a
    push hl
    push de
    push bc
    call SF_HCELL
    pop bc
    pop de
    pop hl
SF_HU4:
    inc hl
    inc de
    inc c
    ld a, c
    cp 20
    jr nz, SF_HU2
    ret

SF_HEND:
end asm

SUB SfHud()
  ASM
  call SF_HUD
  END ASM
END SUB

SUB SfHudReset()
  ASM
  ld hl, SF_HUDS
  ld de, SF_HUDS + 1
  ld bc, 39
  ld (hl), 255
  ldir
  END ASM
END SUB

' ---- the rest of the layer --------------------------------------------

SUB PlatInit()
  DIM r, c AS UBYTE
  Mode 0
  SetPalette(@tiles_pal(0), tiles_PENS)
  SetBorder 0
  ScreenInit()
  SetTileSet(@tiles(0))
  SfGfx(@sprites(0), @shots(0))
  TextFont(@font(0), font_FIRST, 7, font_FIRST + font_COUNT - 1)
  TextPen(1, 0)
  FOR c = 0 TO 19
    DoTile8(c, 1, 3)
    DoTile8(c, 22, 4)
    DoTile8(c, 23, 5)
    DoTile8(c, 24, 5)
  NEXT c
  FOR r = 2 TO 21
    DoTile8(0, r, 0)
    DoTile8(1, r, 1)
    DoTile8(18, r, 2)
    DoTile8(19, r, 0)
  NEXT r
  Stars(@starTab(0))
#ifndef CPC464
  EnableDoubleBuffer()
#endif
  SprListReset()
  SprListBegin()
  SfHudReset()
  hudS = 65535
  hudDirty = 2
#ifndef NOSOUND
  SfxInit(@sf_sfx)
#ifdef SF_BANKMUSIC
  bankOK = BankAvailable()
#ifdef CPC_BAREMETAL
#ifndef NODISC
  ' Bare: no disc, so no BankLoad. The disc loader (loader.asm, RUN"BARE")
  ' put STARFALL.DAT into bank 0 before starting this program; check its
  ' "AT" signature (the songs' header) so a start without the loader runs
  ' silent instead of playing garbage.
  IF bankOK <> 0 THEN
    IF BankPeek(0, 16384) <> 65 OR BankPeek(0, 16385) <> 84 THEN bankOK = 0
  END IF
#else
  bankOK = 0
#endif
#else
#ifndef NODISC
  IF bankOK <> 0 THEN bankOK = BankLoad("STARFALL.DAT", 0, 16384)
#else
  bankOK = 0
#endif
#endif
#endif
#endif
END SUB

' Start of a drawn frame: nothing to do here, the screen to draw on was
' erased, starred and given its text at the end of the last PlatFrameEnd.
SUB PlatFrameBegin()
END SUB

' End of a frame: 464: erase what was not redrawn, stars. 6128: flip, erase
' the list of the screen to draw on next, stars, the text queued for it.
' Then wait for the next logic step.
SUB PlatFrameEnd()
  SprListEnd()
#ifdef CPC464
  Stars(@starTab(0))
  SprListBegin()
#else
  FlipBuffer()
  SprListBegin()
  Stars(@starTab(0))
  TextFlush()
#endif
#ifndef NOPACE
#ifdef SF_PLUS_MUX
  ' the multiplexed formation's tables change at a frame tick: a step that
  ' was late (no wait left) waits for the next tick instead
  DIM f0 AS UINTEGER
  f0 = CAST(UINTEGER, Frames())
  IF f0 - fT >= 2 THEN
    DO WHILE CAST(UINTEGER, Frames()) = f0
      ASM
      halt
      END ASM
    LOOP
  END IF
#endif
  DO WHILE CAST(UINTEGER, Frames()) - fT < 2
#ifdef SF_PLUS_MUX
    ASM
    halt
    END ASM
#endif
  LOOP
#endif
  fT = CAST(UINTEGER, Frames())
END SUB

' The HUD: score, lives, wave and high score, redrawn where it changed
' (on both screens).
SUB PlatHud(score AS UINTEGER, lives AS UBYTE, wave AS UBYTE, hiscore AS UINTEGER)
  IF score <> hudS OR lives <> hudL OR wave <> hudW OR hiscore <> hudH THEN
    hudS = score: hudL = lives: hudW = wave: hudH = hiscore
#ifdef CPC464
    hudDirty = 1
#else
    hudDirty = 2
#endif
  END IF
  IF hudDirty > 0 THEN
    hudDirty = hudDirty - 1
    SfHud()
  END IF
END SUB

' Text at a character cell (upper case, digits and - . =), drawn on the
' screen being drawn now and, double-buffered, on the other one after the
' next flip.
SUB PlatText(col AS UBYTE, row AS UBYTE, s AS STRING)
#ifdef CPC464
  TextAt(col, row, s)
#else
  TextAtBoth(col, row, s)
#endif
END SUB

' Clears the playfield (and queued text) on both screens.
SUB PlatClear()
#ifndef CPC464
  TextFlush()
#endif
  ClearField()
#ifndef CPC464
  FlipBuffer()
  ClearField()
#endif
  SprListReset()
  SprListBegin()
END SUB

' Bits: 1 left (O, cursor left, joystick), 2 right (P, cursor right), 4
' fire (Space, joystick fire), 8 any key.
FUNCTION PlatInput() AS UBYTE
  DIM r AS UBYTE
  ScanKeys()
  r = 0
  IF KeyDown(KEY_O) <> 0 OR KeyDown(KEY_LEFT) <> 0 OR KeyDown(JOY_LEFT) <> 0 THEN r = 1
  IF KeyDown(KEY_P) <> 0 OR KeyDown(KEY_RIGHT) <> 0 OR KeyDown(JOY_RIGHT) <> 0 THEN r = r BOR 2
  IF KeyDown(KEY_SPACE) <> 0 OR KeyDown(JOY_FIRE1) <> 0 THEN r = r BOR 4
  IF AnyKeyDown() <> 0 THEN r = r BOR 8
  RETURN r
END FUNCTION

FUNCTION PlatFrames() AS UINTEGER
  RETURN CAST(UINTEGER, Frames())
END FUNCTION

' 0 off, 1 title, 2 in-game (and game mode, unless -D NOGAMEMODE).
SUB PlatMusic(tune AS UBYTE)
#ifndef NOSOUND
  IF tune = curTune THEN RETURN
  curTune = tune
  IF tune = 0 THEN
    GameMode(0)
    MusicStop()
  ELSE
    IF tune = 1 THEN
      GameMode(0)
#ifdef SF_BANKMUSIC
      IF bankOK <> 0 THEN MusicInitBank(16384, 0, 0)
#else
      MusicInit(@sf_title, 0)
#endif
    ELSE
#ifdef SF_BANKMUSIC
      IF bankOK <> 0 THEN MusicInitBank(17408, 0, 0)
#else
      MusicInit(@sf_game, 0)
#endif
#ifndef NOGAMEMODE
      GameMode(1)
#endif
    END IF
  END IF
#else
  curTune = tune
#ifndef NOGAMEMODE
  IF tune = 2 THEN GameMode(1) ELSE GameMode(0)
#endif
#endif
END SUB

SUB PlatSfx(n AS UBYTE)
#ifndef NOSOUND
#ifdef SF_BANKMUSIC
  IF curTune <> 0 AND bankOK <> 0 THEN SfxPlay(n, 0, 0)
#else
  IF curTune <> 0 THEN SfxPlay(n, 0, 0)
#endif
#endif
END SUB

' Back to the firmware's world, for text output (main.bas under -D BENCH or
' -D SHOT).
SUB PlatEnd()
  GameMode(0)
#ifndef NOSOUND
  MusicStop()
#endif
#ifndef CPC464
  DisableDoubleBuffer()
#endif
END SUB

#ifdef SHOT
' Asks the test runner for a screenshot called name.
SUB PlatShot(name AS STRING)
  Shot(name)
END SUB
#endif

#endif

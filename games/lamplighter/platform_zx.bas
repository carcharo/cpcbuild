' ----------------------------------------------------------------
' platform_zx.bas -- Lamplighter's portable layer for the ZX Spectrum
' (--arch zx48k). The calls are the ones of platform_cpc.bas (see game.bas
' for the list); the sprite engine is lib/zxbuild/sprites.bas.
'
'   -D ZX48    Spectrum 48K: effects on the beeper, no music
'   -D ZX128   Spectrum 128K: Starfall's AY music and effects (lib/music,
'              interrupt driven); the picture is the same, single-buffered
'   (neither is taken as ZX128)
'   -D NOMUSIC (effects only), -D NOSFX (music only), -D NOSOUND (silent)
'   -D NOJOY / -D KEMPSTON: the Kempston port, as Starfall's layer
'   -D SHOT=n, -D BENCH: main.bas's test switches (PlatShot, PlatEnd)
'
' Build: build_zx.sh (the .tap files); compile with -I <cpcbuild>/lib.
'
' ---------------- Screen ----------------
' The room is 20 x 23 cells of 8 x 8 pixels: character columns 6-25, rows
' 0-22 of the 32 x 24 screen (160 x 184 pixels, centred); logical x (0-159)
' is a pixel across, plus 48; logical y is the line. Row 23 is the HUD (the
' lamps, the lives, the room's name), the whole width.
'
' Tiles are 1 bit per pixel, one attribute per cell (assets/zx/zx_tiles.bas,
' img2cpc.py --spectrum from the same art as the CPC's): a room is drawn by
' PzRoom in assembly (the cells go dark first, so the new room appears at
' once).
'
' ---------------- Memory ----------------
' ORG 32768 on both; the image (code, tiles, rooms, on the 128K the player and
' the songs) has to end below F000, where the sprite library's data starts
' (build_zx.sh checks; 48K: about 20 KB, 128K about 25 KB). The stack is
' below the ORG.
'
' ---------------- Sprites ----------------
' The sprites are 8 x 16 pixels. lib/zxbuild draws 16 x 8 images at x
' rounded down to a multiple of 4, so each sprite is two images, the top and
' the bottom half (assets/zx/zx_sprites.bas: 12 frames, the top halves
' first), the art in the left byte of the 16-wide image; it moves by 4
' pixels every second step (the game moves it 2 at a time). The library
' saves and restores the pixels under a sprite. The colour is this layer's:
' the library's own attribute handling would recolour the image's empty
' right half too (a wall beside the player would turn cyan), so the images
' have no attribute, and PzAttr sets the attribute of the 8 x 16 the art
' covers (cyan for the player, magenta for the ghosts) and puts the cells'
' own back, from the room's map, when the sprite has moved on.
' PlatFrameEnd waits two frames since the last (25 steps a second), then
' changes what the screen shows; unchanged sprites at the start of the list
' are not touched (so the enemies, which move least, come first and the
' player last). Not double-buffered: a sprite can flicker where the beam
' catches it.
' ----------------------------------------------------------------

#ifndef __LAMP_PLATFORM__
#define __LAMP_PLATFORM__

#ifndef __ZX48K__
#error "platform_zx.bas is for --arch zx48k"
#endif

#ifdef ZX48
#ifdef ZX128
#error "define only one of ZX48, ZX128"
#endif
#else
#ifndef ZX128
#define ZX128
#endif
#endif

#ifdef NOSOUND
#ifndef NOMUSIC
#define NOMUSIC
#endif
#ifndef NOSFX
#define NOSFX
#endif
#endif

#include "assets/zx/zx_tiles.bas"
#include "assets/zx/zx_sprites.bas"
#ifdef ZX128
#ifndef NOSOUND
#ifndef NOMUSIC
#include "assets/title.bas"
#include "assets/gamesong.bas"
#else
#include "assets/quiet.bas"
#endif
#ifndef NOSFX
#include "assets/zx/sfx_zx.bas"
#endif
#endif
#endif

#include <memcopy.bas>
#define ZXSPR_IMAGES 24            ' image 2 frame + half: 12 frames of two halves
#define ZXSPR_MAX 12               ' at most 5 sprites of 2 images a frame
#define ZXSPR_BASE 0xF000          ' the library's data (~2 KB) above the program: the
                                   ' image may end as high as F000 (the 128K's music
                                   ' makes it 25 KB; single-buffered, so no bank 7)
#include <zxbuild/sprites.bas>
#ifdef ZX128
#ifndef NOSOUND
#include <music/music.bas>
#endif
#endif

#ifdef SHOT
#define TESTSW
#endif
#ifdef BENCH
#ifndef TESTSW
#define TESTSW
#endif
#endif
#ifdef TESTSW
#include <zxtest.bas>
#endif

' Start-up: the stack must not be in the top 16K, where the sprite library's
' data is (the headless runner starts with it up there).
ASM
    ld hl, 0
    add hl, sp
    ld a, h
    cp 0xC0
    jr c, __LZ_SP_OK
    ld sp, .core.__START_PROGRAM    ; just below our code (the ORG)
__LZ_SP_OK:
END ASM

CONST NSLOT AS UBYTE = 5
' PlatSfx(n) -> an effect of the sound set: 1 jump = its shot, 2 lamp = its
' wave, 3 death = its hit, 4 door = its boom (as the CPC build)
DIM sfxMap(4) AS UBYTE => {0, 1, 4, 3, 2}

DIM pzRoom AS UINTEGER                 ' the room's map (0: the title: no map)
DIM pzTiles, pzTAttr AS UINTEGER       ' the tile bitmaps, their attributes
DIM pzImg(15) AS UBYTE                 ' one 16 x 8 image being built
DIM pzLast AS UINTEGER                 ' FRAMES at the last step
DIM pzJoy AS UBYTE
DIM curTune AS UBYTE
DIM hLit, hTot, hLives, hRoom AS UBYTE
#ifdef ZX48
DIM pzSfxDone, pzE AS UBYTE
#endif

' ---- assembly: tiles, rooms, attributes ---------------------------------
' Subroutines (called by the SUBs below; the code jumps over them):
'   __LZ_SCR   B column, C row -> HL the bitmap address of the cell's top line
'   __LZ_ATTR  B column, C row -> HL its attribute address
'   __LZ_TILE  A tile, DE bitmap address -> the 8 lines drawn (clobbers A, B, HL)
ASM
    jp __LZ_SUBS_END
__LZ_SCR:
    ld a,c
    and 0x18
    or 0x40
    ld h,a
    ld a,c
    and 7
    rrca
    rrca
    rrca
    or b
    ld l,a
    ret
__LZ_ATTR:
    ld a,c
    rrca
    rrca
    rrca
    and 0xE0
    or b
    ld l,a
    ld a,c
    rrca
    rrca
    rrca
    and 3
    or 0x58
    ld h,a
    ret
__LZ_TILE:
    and 15
    ld l,a
    ld h,0
    add hl,hl
    add hl,hl
    add hl,hl
    ld bc,(_pzTiles)
    add hl,bc
    ld b,8
__LZ_TL:
    ld a,(hl)
    ld (de),a
    inc hl
    inc d
    djnz __LZ_TL
    ret
__LZ_MAP:
    dw 0
__LZ_RB:
    dw 0
__LZ_C0:
    db 0
__LZ_CL:
    db 0
__LZ_RL:
    db 0

; ---- the sprite slots: 5 of 16 bytes: 0 NF, 1 NX, 2 NY (to be drawn), 3 OF,
; 4 OX, 5 OY (drawn), 6, 7 the old cell key, 8, 9 the new one; frame 255 =
; none. __LZ_ORD the drawing order (enemies first, the player last).
__LZ_SL:
    defs 80
__LZ_ORD:
    db 16, 32, 48, 64, 0
__LZ_FRATTR:
    db 69, 69, 69, 69, 69, 69, 69, 69, 69, 69, 67, 67
__LZ_V:
    db 0
; A = x (screen pixels), E = line y, D = v: the attribute of the cells the art
; of a sprite covers (8 x 16 at x rounded down to 4); v = 255: each cell's own,
; from the room's map (the title has none: bright white on black, its text)
__LZ_ATTRRECT:
    ld b,a
    ld a,d
    ld (__LZ_V),a
    ld a,b
    and 252
    ld b,a
    rrca
    rrca
    rrca
    and 31
    ld (__LZ_C0),a
    ld a,b
    add a,7
    rrca
    rrca
    rrca
    and 31
    ld (__LZ_CL),a
    ld a,e
    add a,15
    rrca
    rrca
    rrca
    and 31
    ld (__LZ_RL),a
    ld a,e
    rrca
    rrca
    rrca
    and 31
    ld c,a                      ; C = the first row
__LZ_AR:
    ld hl,(_pzRoom)             ; this row's map: pzRoom + 20 row - 6 (0: none)
    ld a,h
    or l
    jr z,__LZ_AR0
    push hl
    ld l,c
    ld h,0
    ld d,h
    ld e,l
    add hl,hl
    add hl,hl
    add hl,de
    add hl,hl
    add hl,hl                   ; 20 row
    pop de
    add hl,de
    ld de,-6
    add hl,de
__LZ_AR0:
    ld (__LZ_RB),hl
    ld a,(__LZ_C0)
    ld b,a
__LZ_AC:
    push bc
    call __LZ_ATTR
    ld a,(__LZ_V)
    cp 255
    jr nz,__LZ_AV
    push hl
    ld hl,(__LZ_RB)
    ld a,h
    or l
    ld a,71
    jr z,__LZ_AT
    ld e,b
    ld d,0
    add hl,de
    ld a,(hl)
    and 15
    ld e,a
    ld d,0
    ld hl,(_pzTAttr)
    add hl,de
    ld a,(hl)
__LZ_AT:
    pop hl
__LZ_AV:
    ld (hl),a
    pop bc
    inc b
    ld a,(__LZ_CL)
    cp b
    jr nc,__LZ_AC
    inc c
    ld a,(__LZ_RL)
    cp c
    jr nc,__LZ_AR
    ret
; Forgets what is drawn (OF = none, key = none). With A = 1 the cells of the
; sprites that were drawn get their own colour back first.
__LZ_FORGET:
    push ix
    ld ix,__LZ_SL
    ld b,5
    ld c,a
__LZ_FG1:
    ld a,c
    or a
    jr z,__LZ_FG2
    ld a,(ix+3)
    cp 255
    jr z,__LZ_FG2
    push bc
    ld d,255
    ld e,(ix+5)
    ld a,(ix+4)
    add a,48
    call __LZ_ATTRRECT
    pop bc
__LZ_FG2:
    ld (ix+3),255
    ld (ix+6),255
    ld (ix+7),255
    ld de,16
    add ix,de
    djnz __LZ_FG1
    pop ix
    ret
; Nothing to be drawn
__LZ_HIDE:
    ld hl,__LZ_SL
    ld b,5
    ld de,16
__LZ_HD1:
    ld (hl),255
    add hl,de
    djnz __LZ_HD1
    ret
; Makes the screen show the slots (PlatFlush).
__LZ_FLUSH:
    push ix
    ld ix,__LZ_SL
    ld b,5
    ld c,0                      ; C = something changed
__LZ_F1:
    ld a,(ix+0)
    cp 255
    jr nz,__LZ_F1A
    cp (ix+3)
    jr z,__LZ_F1N               ; hidden and not drawn
__LZ_F1A:
    cp (ix+3)
    jr nz,__LZ_F1C
    ld a,(ix+1)
    cp (ix+4)
    jr nz,__LZ_F1C
    ld a,(ix+2)
    cp (ix+5)
    jr z,__LZ_F1N
__LZ_F1C:
    ld c,1
__LZ_F1N:
    ld de,16
    add ix,de
    djnz __LZ_F1
    ld a,c
    or a
    jp z,__LZ_FEND
    call .core.__ZXS_QRESET
    ld c,0
__LZ_Q1:
    ld hl,__LZ_ORD
    ld e,c
    ld d,0
    add hl,de
    ld e,(hl)
    ld d,0
    ld ix,__LZ_SL
    add ix,de
    ld a,(ix+0)
    cp 255
    jr z,__LZ_Q2
    add a,a
    push bc
    ld b,a                      ; B = image 2 frame (the top half)
    ld a,(ix+1)
    add a,48
    ld d,a                      ; D = x
    ld e,(ix+2)                 ; E = y
    push bc
    push de
    call .core.__ZXS_SPRITE
    pop de
    pop bc
    inc b                       ; the bottom half, 8 lines down
    ld a,e
    add a,8
    ld e,a
    call .core.__ZXS_SPRITE
    pop bc
__LZ_Q2:
    inc c
    ld a,c
    cp 5
    jr nz,__LZ_Q1
    call .core.__ZXS_SYNC
    ld ix,__LZ_SL
    ld b,5
    ld c,0                      ; C = a sprite left or entered cells
__LZ_Y1:
    ld a,(ix+0)
    cp 255
    jr nz,__LZ_Y2
    ld hl,0xFFFF
    jr __LZ_Y3
__LZ_Y2:
    ld a,(ix+1)
    add a,48
    srl a
    srl a
    ld l,a                      ; L = the column key (x / 4)
    ld a,(ix+2)
    ld e,a
    and 7
    jr z,__LZ_Y2A
    set 7,l                     ; not on a cell row boundary
__LZ_Y2A:
    ld a,e
    srl a
    srl a
    srl a
    ld h,a                      ; H = the cell row
__LZ_Y3:
    ld (ix+8),l
    ld (ix+9),h
    ld a,l
    cp (ix+6)
    jr nz,__LZ_Y4
    ld a,h
    cp (ix+7)
    jr z,__LZ_Y5
__LZ_Y4:
    ld a,(ix+6)
    cp 255
    jr z,__LZ_Y4B
    push bc
    ld d,255
    ld e,(ix+5)
    ld a,(ix+4)
    add a,48
    call __LZ_ATTRRECT          ; its old cells: their own colour
    pop bc
__LZ_Y4B:
    ld c,1
__LZ_Y5:
    ld de,16
    add ix,de
    djnz __LZ_Y1
    ld a,c
    or a
    jr z,__LZ_CP
    ld ix,__LZ_SL
    ld b,5
__LZ_S1:
    ld a,(ix+0)
    cp 255
    jr z,__LZ_S2
    ld e,a
    ld d,0
    ld hl,__LZ_FRATTR
    add hl,de
    ld d,(hl)                   ; D = the frame's attribute
    ld e,(ix+2)
    ld a,(ix+1)
    add a,48
    push bc
    call __LZ_ATTRRECT
    pop bc
__LZ_S2:
    ld de,16
    add ix,de
    djnz __LZ_S1
__LZ_CP:
    ld ix,__LZ_SL
    ld b,5
__LZ_C1:
    ld a,(ix+0)
    ld (ix+3),a
    ld a,(ix+1)
    ld (ix+4),a
    ld a,(ix+2)
    ld (ix+5),a
    ld a,(ix+8)
    ld (ix+6),a
    ld a,(ix+9)
    ld (ix+7),a
    ld de,16
    add ix,de
    djnz __LZ_C1
__LZ_FEND:
    pop ix
    ret
__LZ_SUBS_END:
END ASM

' Draws a room: the 20 x 23 tiles at addr, in cells (6, 0) to (25, 22). The
' attributes go black first, then the bitmap, then the attributes.
SUB PzRoom(addr AS UINTEGER)
  ASM
    push ix
    ld hl,0x5806
    ld a,23
__LZ_H1:
    push af
    push hl
    ld d,h
    ld e,l
    inc de
    ld (hl),0
    ld bc,19
    ldir
    pop hl
    ld de,32
    add hl,de
    pop af
    dec a
    jr nz,__LZ_H1
    ld l,(ix+4)
    ld h,(ix+5)
    ld (__LZ_MAP),hl
    push hl
    pop ix                      ; IX walks the map
    ld c,0
__LZ_R1:
    ld b,6
__LZ_K1:
    push bc
    call __LZ_SCR
    ex de,hl
    ld a,(ix+0)
    inc ix
    call __LZ_TILE
    pop bc
    inc b
    ld a,b
    cp 26
    jr nz,__LZ_K1
    inc c
    ld a,c
    cp 23
    jr nz,__LZ_R1
    ld ix,(__LZ_MAP)
    ld c,0
__LZ_R2:
    ld b,6
__LZ_K2:
    push bc
    call __LZ_ATTR
    ld a,(ix+0)
    inc ix
    and 15
    ld e,a
    ld d,0
    push hl
    ld hl,(_pzTAttr)
    add hl,de
    ld a,(hl)
    pop hl
    ld (hl),a
    pop bc
    inc b
    ld a,b
    cp 26
    jr nz,__LZ_K2
    inc c
    ld a,c
    cp 23
    jr nz,__LZ_R2
    pop ix
  END ASM
END SUB

' One tile at character cell (col, row) of the screen: bitmap and attribute.
SUB PzTile(col AS UBYTE, row AS UBYTE, t AS UBYTE)
  ASM
    ld b,(ix+5)
    ld c,(ix+7)
    call __LZ_SCR
    ex de,hl
    ld a,(ix+9)
    call __LZ_TILE
    ld b,(ix+5)
    ld c,(ix+7)
    call __LZ_ATTR
    ld a,(ix+9)
    and 15
    ld e,a
    ld d,0
    push hl
    ld hl,(_pzTAttr)
    add hl,de
    ld a,(hl)
    pop hl
    ld (hl),a
  END ASM
END SUB

' Forgets the drawn sprites (their pixels are not touched): recolour = 1 puts
' the cells' own colour back first.
SUB PzForget(recolour AS UBYTE)
  ASM
    ld a,(ix+5)
    call __LZ_FORGET
  END ASM
END SUB

' ---- the layer -------------------------------------------------------------

' Kempston: 1 if port 31 looks like a joystick (a machine without one
' returns the floating bus, which has bits 5-7 set at times).
FUNCTION PzDetectJoy() AS UBYTE
#ifdef NOJOY
  RETURN 0
#else
#ifdef KEMPSTON
  RETURN 1
#else
  DIM i AS UINTEGER
  DIM ok AS UBYTE
  ok = 1
  FOR i = 1 TO 1500
    IF (IN(31) BAND 224) <> 0 THEN ok = 0: EXIT FOR
  NEXT i
  RETURN ok
#endif
#endif
END FUNCTION

SUB PzPrint(row AS UBYTE, col AS UBYTE, ik AS UBYTE, s AS STRING)
  PRINT AT row, col; INK ik; BRIGHT 1; PAPER 0; s;
END SUB

SUB PlatInit()
  DIM f, h, r AS UBYTE
  DIM u AS UINTEGER
  BORDER 0: PAPER 0: INK 0: BRIGHT 0: FLASH 0
  CLS
  pzJoy = PzDetectJoy()
  pzTiles = @zx_tiles(0)
  pzTAttr = @zx_tiles_attr(0)
  pzRoom = 0
  ' (the assembly reads these: the compiler drops a variable BASIC never reads)
  IF pzTiles = 0 OR pzTAttr = 0 OR pzRoom <> 0 THEN BORDER 2
  r = SpritesInit(0)
  SpritesReset()
  FOR f = 0 TO 11
    FOR h = 0 TO 1
      u = CAST(UINTEGER, h * 12 + f) * 8
      FOR r = 0 TO 7
        pzImg(r * 2) = zx_sprites(u + r)
        pzImg(r * 2 + 1) = 0
      NEXT r
      SpriteImage(f * 2 + h, @pzImg(0), 1, 0)
    NEXT h
  NEXT f
  PzHide()
  PzForget(0)
  hLit = 255
  pzLast = PEEK(UINTEGER, 23672)
#ifdef ZX128
#ifndef NOSFX
  SfxInit(@sf_sfx)
#endif
#endif
END SUB

' Clears the sprites from the screen (their pixels and their colour) and
' forgets them: before a tile changes under them.
SUB PzEraseSprites()
  SpritesBegin()
  SpritesSync()                 ' the list is empty: everything drawn is erased
  PzForget(1)
END SUB

' Draws a room (its sprites are forgotten, not erased: the room goes over them
' and the next flush draws them all).
SUB PlatRoom(addr AS UINTEGER)
  pzRoom = addr
  PzRoom(addr)
  SpritesReset()
  PzForget(0)
  hLit = 255
END SUB

' One cell changed. Its sprites go first (their saved background would be
' the old tile) and all come back at the next flush.
SUB PlatTile(cx AS UBYTE, cy AS UBYTE, t AS UBYTE)
  PzEraseSprites()
  PzTile(cx + 6, cy, t)
END SUB

' A tile at cell (cx, cy) of the 20-wide field, outside the game's map (the
' title's lamps).
SUB PlatTileRaw(cx AS UBYTE, cy AS UBYTE, t AS UBYTE)
  PzTile(cx + 6, cy, t)
END SUB

' Nothing to be drawn in any slot
SUB PzHide()
  ASM
    call __LZ_HIDE
  END ASM
END SUB

' Slot s shows frame f at pixel x, line y at the next flush.
SUB PlatSprite(s AS UBYTE, f AS UBYTE, x AS UBYTE, y AS UBYTE)
  ASM
    ld a,(ix+5)
    add a,a
    add a,a
    add a,a
    add a,a                     ; 16 s
    ld e,a
    ld d,0
    ld hl,__LZ_SL
    add hl,de
    ld a,(ix+7)
    ld (hl),a                   ; the frame
    inc hl
    ld a,(ix+9)
    ld (hl),a                   ; x
    inc hl
    ld a,(ix+11)
    ld (hl),a                   ; y
  END ASM
END SUB

' Makes the screen show the slots (the library erases and draws, the enemies
' first and the player last; a sprite's colour changes only when it enters
' other cells): all in assembly, the same in BASIC took more than a frame.
SUB PlatFlush()
  ASM
    call __LZ_FLUSH
  END ASM
END SUB

SUB PlatHud(lit AS UBYTE, total AS UBYTE, lives AS UBYTE, room AS UBYTE)
  DIM i AS UBYTE
  DIM nm AS STRING
  IF hLit = 255 THEN
    PzPrint(23, 0, 7, "LAMPS")
    PzPrint(23, 9, 7, "OF")
    hTot = 255
    hLives = 255
    hRoom = 255
    hLit = 254
  END IF
  IF lit <> hLit THEN
    hLit = lit
    PzPrint(23, 6, 7, CHR$(48 + lit / 10) + CHR$(48 + lit MOD 10))
  END IF
  IF total <> hTot THEN
    hTot = total
    PzPrint(23, 12, 7, CHR$(48 + total / 10) + CHR$(48 + total MOD 10))
  END IF
  IF lives <> hLives THEN
    hLives = lives
    FOR i = 0 TO 2
      IF lives > i THEN PzTile(15 + i, 23, 9) ELSE PzTile(15 + i, 23, 0)
    NEXT i
  END IF
  IF room <> hRoom THEN
    hRoom = room
    nm = RoomName(room) + "             "
    PzPrint(23, 18, 5, nm(0 TO 12))
  END IF
END SUB

' Text at a character cell of the 20-wide field (upper case, digits and
' punctuation)
SUB PlatText(col AS UBYTE, row AS UBYTE, s AS STRING)
  PzPrint(row, col + 6, 7, s)
END SUB

' Blanks the screen (bright white on black, the colour of the text) and
' forgets the sprites and the HUD.
SUB PlatClear()
  MemSet(16384, 0, 6144)
  MemSet(22528, 71, 768)
  SpritesReset()
  pzRoom = 0
  PzHide()
  PzForget(0)
  hLit = 255
END SUB

' Bits: 1 left (O, Kempston), 2 right (P), 4 fire (Space), 8 any key, 16 up
' (Q), 32 down (A).
FUNCTION PlatInput() AS UBYTE
  DIM r, k, j AS UBYTE
  r = 0
  k = IN(57342)                       ' &DFFE: P = bit 0, O = bit 1
  IF (k BAND 2) = 0 THEN r = r BOR 1
  IF (k BAND 1) = 0 THEN r = r BOR 2
  IF (IN(32766) BAND 1) = 0 THEN r = r BOR 4      ' &7FFE: Space
  IF (IN(64510) BAND 1) = 0 THEN r = r BOR 16     ' &FBFE: Q
  IF (IN(65022) BAND 1) = 0 THEN r = r BOR 32     ' &FDFE: A
  IF (IN(254) BAND 31) <> 31 THEN r = r BOR 8     ' any key (all rows)
  IF pzJoy THEN
    j = IN(31)
    IF (j BAND 2) <> 0 THEN r = r BOR 1
    IF (j BAND 1) <> 0 THEN r = r BOR 2
    IF (j BAND 16) <> 0 THEN r = r BOR 4
    IF (j BAND 8) <> 0 THEN r = r BOR 16
    IF (j BAND 4) <> 0 THEN r = r BOR 32
    IF (j BAND 31) <> 0 THEN r = r BOR 8
  END IF
  RETURN r
END FUNCTION

#ifdef TESTSW      ' (the step counter of main.bas's bench; nothing else asks)
FUNCTION PlatFrames() AS UINTEGER
  RETURN PEEK(UINTEGER, 23672)
END FUNCTION
#endif

' End of a step: wait until two frames have passed since the last (25 steps
' a second, a slow step is not made up for), then draw what GameDraw handed
' over, just after the frame interrupt, ahead of the beam.
SUB PlatFrameEnd()
#ifdef ZX48
  pzSfxDone = 0
#endif
#ifndef NOPACE
  DO
    ASM
    ei
    halt
    END ASM
  LOOP UNTIL PEEK(UINTEGER, 23672) - pzLast >= 2
#endif
  pzLast = PEEK(UINTEGER, 23672)
#ifndef NOFLUSH
  PlatFlush()
#endif
END SUB

SUB PlatPlaying(flag AS UBYTE)
END SUB

' 0 off, 1 the title's tune, 2 the game's (128K only).
SUB PlatMusic(tune AS UBYTE)
#ifdef ZX128
#ifndef NOSOUND
  IF tune = curTune THEN RETURN
  curTune = tune
  IF tune = 0 THEN
    MusicStop()
  ELSEIF tune = 1 THEN
#ifndef NOMUSIC
    MusicInit(@sf_title, 0)
#else
    MusicInit(@bounce_quiet, 0)
#endif
  ELSE
#ifndef NOMUSIC
    MusicInit(@sf_game, 0)
#else
    MusicInit(@bounce_quiet, 0)
#endif
  END IF
#endif
#else
  curTune = tune
#endif
END SUB

#ifdef ZX48
' ---------------- 48K beeper effects ----------------
' PlatSfx(n) plays a short effect on the beeper (bit 4 of port &FE; the
' border colour kept, MIC off), interrupts off while it plays, blocking, then
' EI; at most one a step. The same table-driven routine and effects as
' Starfall's 48K build: segments (count, d, step, mode), a tone segment is
' `count` square-wave cycles with half period delay d (DJNZ loops, 13 T per
' d), d += step after each cycle; a noise segment is `count` pseudo-random
' toggles with delay d. The numbers are Starfall's: 1 = its shot (the jump,
' ~3 ms), 2 = its boom (the door, ~2.5 ms), 3 = its hit (the death, ~23 ms),
' 4 = its wave (the lamp: an arpeggio, ~75 ms).
SUB PlatSfx(n AS UBYTE)
#ifndef NOSFX
  IF pzSfxDone <> 0 THEN RETURN
  IF n = 0 THEN RETURN
  IF n > 4 THEN RETURN
  pzSfxDone = 1
  pzE = sfxMap(n)
  IF pzE = 0 THEN RETURN
  ASM
    ld a,(_pzE)
    push ix
    ld hl,__LZ_BEEP_TAB
    dec a
    add a,a
    ld e,a
    ld d,0
    add hl,de
    ld e,(hl)
    inc hl
    ld d,(hl)
    push de
    pop ix                      ; IX = the effect's segments
    ld a,(23624)                ; BORDCR: border colour in bits 3-5
    rrca
    rrca
    rrca
    and 7
    ld c,a                      ; C = port value with the speaker low
    di
__LZ_BEEP_SEG:
    ld e,(ix+0)                 ; E = count; 0 ends the effect
    ld a,e
    or a
    jr z,__LZ_BEEP_END
    ld d,(ix+1)                 ; D = delay
    ld h,(ix+2)                 ; H = step
    ld a,(ix+3)
    ld l,a                      ; L = mode (then the noise state)
    inc ix
    inc ix
    inc ix
    inc ix
    or a
    jr nz,__LZ_BEEP_NOISE
__LZ_BEEP_TONE:
    ld a,c
    or 16
    out (254),a
    ld b,d
__LZ_BEEP_T1:
    djnz __LZ_BEEP_T1
    ld a,c
    out (254),a
    ld b,d
__LZ_BEEP_T2:
    djnz __LZ_BEEP_T2
    ld a,d
    add a,h
    ld d,a
    dec e
    jr nz,__LZ_BEEP_TONE
    jr __LZ_BEEP_SEG
__LZ_BEEP_NOISE:
    ld a,l
    add a,a
    add a,a
    add a,l
    inc a
    ld l,a
    ld a,r
    xor l
    and 16
    or c
    out (254),a
    ld b,d
__LZ_BEEP_N1:
    djnz __LZ_BEEP_N1
    dec e
    jr nz,__LZ_BEEP_NOISE
    jr __LZ_BEEP_SEG
__LZ_BEEP_END:
    ld a,c
    out (254),a                 ; speaker low, border as it was
    ei
    pop ix
    jp __LZ_BEEP_DATA_END
__LZ_BEEP_TAB:
    dw __LZ_BEEP_1, __LZ_BEEP_2, __LZ_BEEP_3, __LZ_BEEP_4
__LZ_BEEP_1:
    db 19, 10, 1, 0, 0
__LZ_BEEP_2:
    db 14, 2, 0, 1, 14, 4, 0, 1, 14, 7, 0, 1, 14, 11, 0, 1, 0
__LZ_BEEP_3:
    db 10, 20, 0, 1, 20, 120, 3, 0, 0
__LZ_BEEP_4:
    db 26, 127, 0, 0, 33, 100, 0, 0, 39, 84, 0, 0, 0
__LZ_BEEP_DATA_END:
  END ASM
#endif
END SUB
#else
' Effects: 1 jump, 2 lamp lit, 3 death, 4 door opens (128K: the AY effects;
' they replace one still playing on channel C; heard while a tune plays).
SUB PlatSfx(n AS UBYTE)
#ifdef ZX128
#ifndef NOSFX
  IF curTune <> 0 THEN SfxPlay(sfxMap(n), 2, 0)
#endif
#endif
END SUB
#endif

#ifdef TESTSW
' Back to the machine's own world: music off.
SUB PlatEnd()
#ifdef ZX128
#ifndef NOSOUND
  MusicStop()
#endif
#endif
END SUB
#endif

#ifdef SHOT
' Asks the test runner for a screenshot called name (zxtest.bas's TSHOT:
' then 6 frames' wait with the screen unchanged).
SUB PlatShot(name AS STRING)
  TSHOT(name)
END SUB
#endif

#endif

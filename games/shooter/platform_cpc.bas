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
' Drawing is not the library's: the playfield background is plain black
' (plus a few static stars), so a sprite is erased by clearing its box,
' and sprites (pixels only: transparent is black, drawn with OR onto the
' erased box) by a routine specialised for 4-byte-wide ones. Tiles (border, HUD rule, ground) and text (a 5x7 font, 7 bytes a
' glyph, not 32-byte tiles) are drawn by routines in the same assembly
' block too. Together that is about 5 times cheaper than PutSpriteMasked +
' TileRestore (which a full formation could not afford at 25 steps a
' second) and about 4 KB smaller than the library's sprite, tile and fill
' modules plus a tile font (the 6128 build must fit under &4000 with the
' music player). It uses only the library's display, keyboard and palette
' modules, and reads its CB_BASE, so it draws on whichever screen the
' library says is hidden.
'
' The sprite list: PlatSprite appends an entry (screen address and type)
' to the list of the screen being drawn. 6128: PlatFrameBegin erases the
' list of the hidden screen (drawn two frames ago), then PlatSprite draws.
' 464: the list is the one screen's; PlatSprite erases the previous frame's
' sprite of the same slot (same call number) just before drawing its
' own, so each sprite is blank only for a moment: flyback order.
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

#include <cpc.bas>
#include <cpcbuild/display.bas>
#include <cpcbuild/keyboard.bas>
#include <cpcbuild/palette.bas>
#include <framehook.bas>

#ifdef CPC6128
' Double-buffered builds: the constant graphics arrays below (sprites,
' sprites_pal, shots, tiles, tiles_pal, font: 970 bytes) have their data bytes
' placed from &8000 up (their descriptors stay low), which keeps the low
' segment (the part below the back screen at &4000) smaller. The gap up to
' &8000 is zero-filled in the one .bin; EnableDoubleBuffer copies the screen
' over &4000-&7FFF. Nothing here is read by the firmware through a pointer
' (and &8000-&BFFF would be fine for that anyway). The 464 has one screen
' and no limit at &4000, so it keeps everything in place.
#pragma hidata = $8000
#endif
' sprites: 12 frames of 4 bytes x 8 lines (32 bytes, pixels only: they are ORed
' onto the erased black); shots: 2 of 1 x 4 (4 bytes)
#include "assets/sprites.bas"
#include "assets/shots.bas"
' tiles: 0 border outer, 1 inner left, 2 inner right, 3 HUD rule, 4 ground,
' 5 ground fill, 6 life icon; and tiles_pal, the 16 pens
#include "assets/tiles.bas"
' font: 7 bytes a character, ASCII 45-90
#include "assets/font.bas"
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

' ---- the sprite engine ----------------------------------------------
' Entries are 3 bytes (screen address, type 0 = 4 x 8, 1 = 1 x 4); the
' lists hold 40. NSTARS static stars: (offset in the 16 KB screen, byte).
asm
    jp SF_END

SF_SPR:     defw 0              ; the 12 4 x 8 frames
SF_SHOT:    defw 0              ; the 2 1 x 4 frames
SF_SGL:     defb 0              ; 1 = single-buffered
SF_BUF:     defb 0              ; list of the screen being drawn (0, 1)
SF_N0:      defb 0              ; entries in list 0
SF_N1:      defb 0              ; entries in list 1 (must follow SF_N0)
SF_OLDN:    defb 0              ; single: entries of the previous frame
SF_CNT:     defb 0              ; entries so far this frame
SF_LP:      defw 0              ; the list being filled
SF_E:       defw 0              ; the entry being written
SF_EC:      defb 0
SF_KBASE:   defb 0, 1, 3, 5, 7, 255, 255, 9     ; first frame of each kind
SF_L0:      defs 120
SF_L1:      defs 120
SF_TILEP:   defw 0              ; the 7 tiles (32 bytes each)
SF_FONTP:   defw 0              ; the font
SF_PEN:     defb 1              ; pen of the glyph being drawn (0-3)
SF_PENTAB:  defb 0, 0, $80, $40, $08, $04, $88, $44    ; left, right pixel
SF_BLANK:   defb 0, 0, 0, 0, 0, 0, 0
SF_TXTLEN:  defb 0              ; bytes in the text queue
SF_TXTP:    defb 0              ; frames it is still to be drawn on
SF_TXT:     defs 160            ; entries: col, row, length, characters
SF_HUDB:    defs 20             ; the HUD as characters (1 = life icon)
SF_HUDS:    defs 40             ; what each screen shows (255 = unknown)
SF_CL:      defb 0
SF_CC:      defb 0

; SF_DRAW8: 4 x 8 sprite (pixels only, 32 bytes) ORed onto the screen
; (which the erase left black), HL = data, DE = screen address
SF_DRAW8:
    ld b, 8
SF_D8R:
    push de
    ld a, (de)
    or (hl)
    ld (de), a
    inc hl
    inc de
    ld a, (de)
    or (hl)
    ld (de), a
    inc hl
    inc de
    ld a, (de)
    or (hl)
    ld (de), a
    inc hl
    inc de
    ld a, (de)
    or (hl)
    ld (de), a
    inc hl
    pop de
    ld a, d
    add a, 8
    ld d, a
    and $38
    jr nz, SF_D8N
    ld a, d
    sub $40
    ld d, a
    ld a, e
    add a, 80
    ld e, a
    jr nc, SF_D8N
    inc d
SF_D8N:
    djnz SF_D8R
    ret

; SF_DRAW1: 1 x 4 sprite (4 bytes), HL = data, DE = screen address
SF_DRAW1:
    ld b, 4
SF_D1R:
    ld a, (de)
    or (hl)
    ld (de), a
    inc hl
    ld a, d
    add a, 8
    ld d, a
    and $38
    jr nz, SF_D1N
    ld a, d
    sub $40
    ld d, a
    ld a, e
    add a, 80
    ld e, a
    jr nc, SF_D1N
    inc d
SF_D1N:
    djnz SF_D1R
    ret

; SF_ERASE8: clears a 4 x 8 box, HL = screen address. Rows alternate
; direction, so the pointer is already at the next row's near end.
SF_ERASE8:
    ld b, 0
    ld c, 4
SF_E8L:
    ld (hl), b
    inc hl
    ld (hl), b
    inc hl
    ld (hl), b
    inc hl
    ld (hl), b
    ld a, h
    add a, 8
    ld h, a
    and $38
    jr nz, SF_E8A
    ld a, h
    sub $40
    ld h, a
    ld a, l
    add a, 80
    ld l, a
    jr nc, SF_E8A
    inc h
SF_E8A:
    ld (hl), b
    dec hl
    ld (hl), b
    dec hl
    ld (hl), b
    dec hl
    ld (hl), b
    ld a, h
    add a, 8
    ld h, a
    and $38
    jr nz, SF_E8B
    ld a, h
    sub $40
    ld h, a
    ld a, l
    add a, 80
    ld l, a
    jr nc, SF_E8B
    inc h
SF_E8B:
    dec c
    jr nz, SF_E8L
    ret

; SF_ERASE1: clears a 1 x 4 box, HL = screen address
SF_ERASE1:
    ld b, 0
    ld c, 4
SF_E1L:
    ld (hl), b
    ld a, h
    add a, 8
    ld h, a
    and $38
    jr nz, SF_E1N
    ld a, h
    sub $40
    ld h, a
    ld a, l
    add a, 80
    ld l, a
    jr nc, SF_E1N
    inc h
SF_E1N:
    dec c
    jr nz, SF_E1L
    ret

; SF_ERASE_ONE: HL = an entry
SF_ERASE_ONE:
    ld e, (hl)
    inc hl
    ld d, (hl)
    inc hl
    ld a, (hl)
    ex de, hl
    or a
    jp z, SF_ERASE8
    jp SF_ERASE1

; SF_ERASEL: HL = a list, A = its entry count
SF_ERASEL:
    or a
    ret z
    ld (SF_EC), a
SF_ELP:
    push hl
    call SF_ERASE_ONE
    pop hl
    inc hl
    inc hl
    inc hl
    ld a, (SF_EC)
    dec a
    ld (SF_EC), a
    jr nz, SF_ELP
    ret

; SF_STARS: puts the static stars on the drawing screen where it is black
SF_STARS:
    ld a, (.core.CB_BASE)
    ld b, a
    ld hl, SF_STARTAB
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
    ret

SF_STARTAB:
    defb $61, $02, $AA
    defb $2A, $31, $51
    defb $01, $1E, $A2
    defb $24, $3C, $55
    defb $13, $19, $A2
    defb $13, $0D, $51
    defb $B6, $09, $AA
    defb $7E, $09, $51
    defb $E7, $1A, $A2
    defb $89, $23, $55
    defb $1D, $32, $A2
    defb $57, $26, $51
    defb $6F, $0E, $AA
    defb $AF, $21, $51
    defb $80, $0C, $A2
    defb $8F, $32, $55
    defb $37, $16, $A2
    defb $FE, $13, $51
    defb $83, $3E, $AA
    defb $52, $34, $51

; SF_BEGIN: start of a frame
SF_BEGIN:
    ld a, (SF_SGL)
    or a
    jr nz, SF_BSGL
    ld a, (SF_BUF)
    or a
    jr nz, SF_B1
    ld hl, SF_L0
    ld (SF_LP), hl
    ld a, (SF_N0)
    jr SF_B2
SF_B1:
    ld hl, SF_L1
    ld (SF_LP), hl
    ld a, (SF_N1)
SF_B2:
    call SF_ERASEL
    xor a
    ld (SF_CNT), a
    jp SF_STARS
SF_BSGL:
    ld a, (SF_CNT)
    ld (SF_OLDN), a
    xor a
    ld (SF_CNT), a
    ld hl, SF_L0
    ld (SF_LP), hl
    ret

; SF_FEND: end of a frame (before the flip)
SF_FEND:
    ld a, (SF_SGL)
    or a
    jr nz, SF_FS
    ld hl, SF_N0
    ld a, (SF_BUF)
    or a
    jr z, SF_FE0
    inc hl
SF_FE0:
    ld a, (SF_CNT)
    ld (hl), a
    ret
SF_FS:
    ld a, (SF_OLDN)
    ld hl, SF_CNT
    sub (hl)
    jr c, SF_FS2
    jr z, SF_FS2
    push af
    ld a, (SF_CNT)
    ld e, a
    add a, a
    add a, e
    ld e, a
    ld d, 0
    ld hl, SF_L0
    add hl, de
    pop af
    call SF_ERASEL
SF_FS2:
    jp SF_STARS

; SF_SPRITE: PlatSprite(kind, frame, x, y), IX = the SUB's frame
SF_SPRITE:
    ld a, (ix+11)
    cp 160
    ret nc
    ld a, (SF_CNT)
    cp 40
    ret nc
    ld c, a
    add a, a
    add a, c
    ld e, a
    ld d, 0
    ld hl, (SF_LP)
    add hl, de
    ld (SF_E), hl
    ld a, (SF_SGL)
    or a
    jr z, SF_S1
    ld a, (SF_OLDN)
    cp c
    jr z, SF_S1
    jr c, SF_S1
    ld hl, (SF_E)
    push bc
    call SF_ERASE_ONE
    pop bc
SF_S1:
    ld a, (ix+9)
    srl a
    add a, 8
    ld c, a
    ld a, (ix+11)
    add a, 16
    ld b, a
    call .core.__CB_ADDR
    push hl
    ld a, (ix+5)
    ld e, a
    ld d, 0
    ld hl, SF_KBASE
    add hl, de
    ld a, (hl)
    cp 255
    jr z, SF_SMALL
    add a, (ix+7)
    ld l, a
    ld h, 0
    add hl, hl
    add hl, hl
    add hl, hl
    add hl, hl
    add hl, hl
    ld de, (SF_SPR)
    add hl, de
    pop de
    push hl
    ld hl, (SF_E)
    ld (hl), e
    inc hl
    ld (hl), d
    inc hl
    ld (hl), 0
    pop hl
    call SF_DRAW8
    jr SF_S2
SF_SMALL:
    ld a, (ix+5)
    sub 5
    add a, a
    add a, a
    ld l, a
    ld h, 0
    ld de, (SF_SHOT)
    add hl, de
    pop de
    push hl
    ld hl, (SF_E)
    ld (hl), e
    inc hl
    ld (hl), d
    inc hl
    ld (hl), 1
    pop hl
    call SF_DRAW1
SF_S2:
    ld hl, SF_CNT
    inc (hl)
    ret

; SF_CELL: B = cell row, C = cell column -> DE = the cell's screen address
SF_CELL:
    ld a, b
    add a, a
    add a, a
    add a, a
    ld b, a
    ld a, c
    add a, a
    add a, a
    ld c, a
    call .core.__CB_ADDR
    ex de, hl
    ret

; SF_TILE: A = tile, B = cell row, C = cell column
SF_TILE:
    push af
    call SF_CELL
    pop af
    ld l, a
    ld h, 0
    add hl, hl
    add hl, hl
    add hl, hl
    add hl, hl
    add hl, hl
    ld bc, (SF_TILEP)
    add hl, bc
    ld b, 8
SF_TL1:
    ld a, (hl)
    ld (de), a
    inc hl
    inc de
    ld a, (hl)
    ld (de), a
    inc hl
    inc de
    ld a, (hl)
    ld (de), a
    inc hl
    inc de
    ld a, (hl)
    ld (de), a
    inc hl
    dec de
    dec de
    dec de
    ld a, d
    add a, 8
    ld d, a
    djnz SF_TL1
    ret

; SF_GLY: draws character A (ASCII 45-90, else blank) at cell row B,
; column C in pen SF_PEN (0-3)
SF_GLY:
    push iy
    push af
    call SF_CELL
    pop af
    push de
    sub 45
    jr c, SF_GBL
    cp 46
    jr nc, SF_GBL
    ld l, a
    ld h, 0
    ld e, a
    ld d, 0
    add hl, hl
    add hl, hl
    add hl, hl
    or a
    sbc hl, de
    ld de, (SF_FONTP)
    add hl, de
    push hl
    pop iy
    jr SF_GGO
SF_GBL:
    ld iy, SF_BLANK
SF_GGO:
    ld a, (SF_PEN)
    and 3
    add a, a
    ld e, a
    ld d, 0
    ld hl, SF_PENTAB
    add hl, de
    ld e, (hl)
    inc hl
    ld d, (hl)
    pop hl
    ld b, 7
SF_GR:
    ld c, (iy+0)
    inc iy
    sla c
    sla c
    sla c
    sla c
    sbc a, a
    and d
    ld (hl), a
    inc hl
    sla c
    sbc a, a
    and e
    ld (hl), a
    sla c
    sbc a, a
    and d
    or (hl)
    ld (hl), a
    inc hl
    sla c
    sbc a, a
    and e
    ld (hl), a
    sla c
    sbc a, a
    and d
    or (hl)
    ld (hl), a
    inc hl
    xor a
    ld (hl), a
    dec hl
    dec hl
    dec hl
    ld a, h
    add a, 8
    ld h, a
    djnz SF_GR
    xor a
    ld (hl), a
    inc hl
    ld (hl), a
    inc hl
    ld (hl), a
    inc hl
    ld (hl), a
    pop iy
    ret

; SF_DEC5: HL = value, DE = destination: five ASCII digits, DE advanced
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

; SF_HUD: builds the HUD from hudS, hudL, hudW, hudH and draws the cells
; that differ from what the screen being drawn shows. Cells: 0-4 score,
; 6 life icon, 7 lives, 9 W, 10-11 wave, 13 H, 14-18 high score.
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
    ld a, 87
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
    ld a, 72
    ld (de), a
    inc de
    ld hl, (_hudH)
    call SF_DEC5
    ld a, 32
    ld (de), a
    ld hl, SF_HUDS
    ld a, (SF_BUF)
    or a
    jr z, SF_HU1
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
    cp 1
    jr nz, SF_HU3
    ld a, 6
    ld b, 0
    call SF_TILE
    jr SF_HU5
SF_HU3:
    ld e, a
    ld d, 1
    cp 65
    jr c, SF_HU6
    ld d, 2
SF_HU6:
    ld a, d
    ld (SF_PEN), a
    ld a, e
    ld b, 0
    call SF_GLY
SF_HU5:
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

; SF_TEXTADD: PlatText(col, row, s$) with IX = the SUB's frame
SF_TEXTADD:
    ld l, (ix+8)
    ld h, (ix+9)
    ld c, (hl)
    inc hl
    ld b, (hl)
    inc hl
    ld a, b
    or a
    ret nz
    ld a, (SF_TXTLEN)
    add a, c
    ret c
    add a, 3
    ret c
    cp 161
    ret nc
    push hl
    ld a, (SF_TXTLEN)
    ld e, a
    ld d, 0
    ld hl, SF_TXT
    add hl, de
    ex de, hl
    ld a, (ix+5)
    ld (de), a
    inc de
    ld a, (ix+7)
    ld (de), a
    inc de
    ld a, c
    ld (de), a
    inc de
    pop hl
    ld a, (SF_TXTLEN)
    add a, c
    add a, 3
    ld (SF_TXTLEN), a
    ld a, (SF_SGL)
    xor 1
    inc a
    ld (SF_TXTP), a
    ld a, c
    or a
    ret z
    ldir
    ret

; SF_TEXTDRAW: draws the queued text, while it is still pending
SF_TEXTDRAW:
    ld a, (SF_TXTP)
    or a
    ret z
    dec a
    ld (SF_TXTP), a
    ld a, 1
    ld (SF_PEN), a
    ld hl, SF_TXT
    ld a, (SF_TXTLEN)
    ld e, a
SF_TD1:
    ld a, e
    or a
    ret z
    ld c, (hl)
    inc hl
    ld b, (hl)
    inc hl
    ld d, (hl)
    inc hl
    ld a, e
    sub d
    sub 3
    ld e, a
SF_TD2:
    ld a, d
    or a
    jr z, SF_TD1
    ld a, (hl)
    inc hl
    push hl
    push de
    push bc
    call SF_GLY
    pop bc
    pop de
    pop hl
    inc c
    dec d
    jr SF_TD2

; SF_CLEAR: blanks the playfield on the screen being drawn (64 x 160 bytes)
SF_CLEAR:
    ld a, 16
    ld (SF_CL), a
    ld a, 20
    ld (SF_CC), a
SF_CLR1:
    ld a, (SF_CL)
    ld b, a
    ld c, 8
    call .core.__CB_ADDR
    ld b, 8
SF_CLR2:
    push bc
    push hl
    ld d, h
    ld e, l
    inc de
    ld (hl), 0
    ld bc, 63
    ldir
    pop hl
    ld a, h
    add a, 8
    ld h, a
    pop bc
    djnz SF_CLR2
    ld a, (SF_CL)
    add a, 8
    ld (SF_CL), a
    ld hl, SF_CC
    dec (hl)
    jr nz, SF_CLR1
    ret

SF_END:
end asm

SUB SFSetup(spr AS UINTEGER, shots AS UINTEGER, tilesp AS UINTEGER, fontp AS UINTEGER, sgl AS UBYTE)
  ASM
  ld l, (ix+4)
  ld h, (ix+5)
  ld (SF_SPR), hl
  ld l, (ix+6)
  ld h, (ix+7)
  ld (SF_SHOT), hl
  ld l, (ix+8)
  ld h, (ix+9)
  ld (SF_TILEP), hl
  ld l, (ix+10)
  ld h, (ix+11)
  ld (SF_FONTP), hl
  ld a, (ix+13)
  ld (SF_SGL), a
  END ASM
END SUB

SUB SFTile(col AS UBYTE, row AS UBYTE, t AS UBYTE)
  ASM
  ld a, (ix+9)
  ld b, (ix+7)
  ld c, (ix+5)
  call SF_TILE
  END ASM
END SUB

SUB SFBegin()
  ASM
  call SF_BEGIN
  call SF_TEXTDRAW
  END ASM
END SUB

SUB SFEnd()
  ASM
  call SF_FEND
  END ASM
END SUB

SUB SFStars()
  ASM
  call SF_STARS
  END ASM
END SUB

SUB SFClear()
  ASM
  call SF_CLEAR
  call SF_STARS
  END ASM
END SUB

SUB SFHud()
  ASM
  call SF_HUD
  END ASM
END SUB

SUB SFHudReset()
  ASM
  ld hl, SF_HUDS
  ld de, SF_HUDS + 1
  ld bc, 39
  ld (hl), 255
  ldir
  END ASM
END SUB

SUB SFText(col AS UBYTE, row AS UBYTE, s AS STRING)
  ASM
  call SF_TEXTADD
  END ASM
END SUB

' After a flip: the other list belongs to the screen being drawn now.
SUB SFSwap()
  ASM
  ld a, (SF_BUF)
  xor 1
  ld (SF_BUF), a
  END ASM
END SUB

' Empties both lists and the text queue (the screens have been cleared).
SUB SFReset()
  ASM
  xor a
  ld (SF_N0), a
  ld (SF_N1), a
  ld (SF_CNT), a
  ld (SF_OLDN), a
  ld (SF_TXTLEN), a
  ld (SF_TXTP), a
  END ASM
END SUB

SUB PlatSprite(kind AS UBYTE, frame AS UBYTE, x AS UBYTE, y AS UBYTE)
  ASM
  call SF_SPRITE
  END ASM
END SUB

' ---- the rest of the layer --------------------------------------------

DIM hudS, hudH AS UINTEGER
DIM hudL, hudW, hudDirty AS UBYTE
DIM pbuf, curTune, bankOK AS UBYTE   ' the drawing screen's list (0, 1); music; songs in the bank
DIM fT AS UINTEGER                  ' Frames() at the start of this step

SUB PlatInit()
  DIM r, c AS UBYTE
  Mode 0
  SetPalette(@tiles_pal(0), tiles_PENS)
  SetBorder 0
  ScreenInit()
#ifdef CPC464
  SFSetup(@sprites(0), @shots(0), @tiles(0), @font(0), 1)
#else
  SFSetup(@sprites(0), @shots(0), @tiles(0), @font(0), 0)
#endif
  FOR c = 0 TO 19
    SFTile(c, 1, 3)
    SFTile(c, 22, 4)
    SFTile(c, 23, 5)
    SFTile(c, 24, 5)
  NEXT c
  FOR r = 2 TO 21
    SFTile(0, r, 0)
    SFTile(1, r, 1)
    SFTile(18, r, 2)
    SFTile(19, r, 0)
  NEXT r
  SFStars()
#ifndef CPC464
  EnableDoubleBuffer()
#endif
  SFHudReset()
  hudS = 65535
  hudDirty = 2
#ifndef NOSOUND
  SfxInit(@sf_sfx)
#ifdef SF_BANKMUSIC
  bankOK = BankAvailable()
#ifdef CPC_BAREMETAL
#ifndef NODISC
  ' Bare: no disc, so no BankLoad. The disc loader (loader.asm, RUN"BARE)
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

' Start of a drawn frame: erases what was drawn here before (6128), draws
' queued text.
SUB PlatFrameBegin()
  SFBegin()
END SUB

' End of a frame: flip (6128), then wait for the next logic step.
SUB PlatFrameEnd()
  SFEnd()
#ifndef CPC464
  FlipBuffer()
  SFSwap()
  pbuf = 1 - pbuf
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
    SFHud()
  END IF
END SUB

' Text at a character cell (upper case, digits and - . =), drawn on both
' screens during the next frames.
SUB PlatText(col AS UBYTE, row AS UBYTE, s AS STRING)
  SFText(col, row, s)
END SUB

' Clears the playfield (and queued text) on both screens.
SUB PlatClear()
  SFClear()
#ifndef CPC464
  FlipBuffer()
  SFSwap()
  pbuf = 1 - pbuf
  SFClear()
#endif
  SFReset()
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

; ----------------------------------------------------------------
; platform_zx_draw.asm -- Starfall's Spectrum sprite engine (Z80), included
; inside an ASM block by platform_zx.bas. MIT licence, written for this
; project; see the memory plan and the reasons in platform_zx.bas.
;
; What it does. A sprite is 16x8 pixels (narrow ones, bullets and bombs,
; 2x4 pixels in one byte) drawn at an x that is a multiple of 4 pixels
; and a pixel line y, as screen OR graph (the art is ink only, so OR is
; all a mask would do), from two pre-shifted copies (0 and 4 pixels; made
; by PlatInit: graph bytes only, 8 rows of 2 / 3 bytes, narrow 4 rows of
; 1). Drawing a sprite also
;   - saves the screen bytes it covers (for the erase),
;   - gives the attribute cells it covers the kind's colour, saving the
;     old values.
; Erasing puts both back, sprites in reverse order of drawing, so every
; frame leaves the screen exactly as it was.
;
; Records (16 bytes, REC area), per drawn sprite:
;   +0,+1 screen address of its first byte    +2 type (0 wide, 1 wide
;   shifted by 4 pixels, 2 narrow)            +3 rows*16 + columns of
;   attribute cells   +4,+5 their first address   +6..+11 saved attributes
;   (3 per row)   +12..+15 what was asked: kind, frame, x, y
; Backgrounds (24 bytes, BG area) saved bytes, a row of 2, 3 or 1.
; Two sets of both, one per screen (the 128K draws on one screen while the
; other is shown); a "context" holds the current set's count and pointers.
;
; A frame: PlatSprite queues (kind, frame, x, y); at the frame's end
; __PZ_SYNC makes the screen being drawn show exactly the queue: it keeps
; the first records that are the same as the queue's first entries (a
; sprite that hasn't changed since this screen was last drawn isn't touched
; again: the formation, between its moves), erases the rest of the old
; records in reverse order and draws the rest of the queue. Keeping only a
; prefix is what keeps the erase order right (a kept sprite was drawn
; before everything that is erased, so nothing erased was saved over it).
;
; Entry points (registers; all preserve nothing but IX and the stack):
;   __PZ_INIT    A = screen high byte (40 or C0), B = 1 if double-buffered
;   __PZ_SPRITE  B kind, C frame, D x (logical), E y (logical): queues it
;   __PZ_QRESET  empty the queue            __PZ_SYNC  the above
;   __PZ_FLIP    switch to the other set and drawing screen
;   __PZ_RESET   forget everything drawn (after the screen was cleared)
; ----------------------------------------------------------------

PZ_NS       equ 28                  ; sprites per frame
PZ_REC      equ 0xDB00              ; records, 2 sets x 28 x 16 bytes: DB00..DE7F
PZ_REC1     equ PZ_REC + PZ_NS * 16
PZ_BG       equ 0xDE80              ; backgrounds, 2 x 28 x 24: DE80..E3BF
PZ_BG1      equ PZ_BG + PZ_NS * 24
PZ_IMGTAB   equ 0xE400              ; 32 image pointers, index kind*4+frame
PZ_ATTRTAB  equ 0xE440              ; 8 attribute values, by kind
PZ_IMGS     equ 0xE450              ; the images, to about E830

; A context: count, record pointer, background pointer, their starts.
__PZ_CTX:   db 0
            dw PZ_REC, PZ_BG, PZ_REC, PZ_BG
__PZ_CTX2:  db 0
            dw PZ_REC1, PZ_BG1, PZ_REC1, PZ_BG1
__PZ_N      equ __PZ_CTX
__PZ_REC_P  equ __PZ_CTX + 1
__PZ_BGP    equ __PZ_CTX + 3
__PZ_RECS   equ __PZ_CTX + 5
__PZ_BGS    equ __PZ_CTX + 7
__PZ_SCRHI: db 0x40
__PZ_DBL:   db 0
__PZ_TSCR:  dw 0
__PZ_TIMG:  dw 0
__PZ_TTYPE: db 0
__PZ_QN:    db 0
__PZ_Q:     defs PZ_NS * 4

; next screen line: DE = address of a byte, DE = the byte below it
#define PZ_DOWN                                                         \
    PROC                                                                \
    LOCAL nextline                                                      \
    inc d                                                               \
    ld a,d                                                              \
    and 7                                                               \
    jr nz,nextline                                                      \
    ld a,e                                                              \
    add a,32                                                            \
    ld e,a                                                              \
    jr c,nextline                                                       \
    ld a,d                                                              \
    sub 8                                                               \
    ld d,a                                                              \
nextline:                                                               \
    ENDP

; draw one byte: DE screen, HL image (graph), BC background buffer
#define PZ_DB                                                           \
    ld a,(de)                                                           \
    ld (bc),a                                                           \
    inc bc                                                              \
    or (hl)                                                             \
    inc hl                                                              \
    ld (de),a

; a row of 1, 2 or 3 bytes and the step to the next line
#define PZ_ROW1                                                         \
    PZ_DB                                                               \
    PZ_DOWN
#define PZ_ROW2                                                         \
    PZ_DB                                                               \
    inc e                                                               \
    PZ_DB                                                               \
    dec e                                                               \
    PZ_DOWN
#define PZ_ROW3                                                         \
    PZ_DB                                                               \
    inc e                                                               \
    PZ_DB                                                               \
    inc e                                                               \
    PZ_DB                                                               \
    dec e                                                               \
    dec e                                                               \
    PZ_DOWN

; restore a row (LDI: HL background -> DE screen; BC is just a counter; LDI's
; INC DE is 16 bits, so is the DEC DE that undoes it: E may wrap at column 31)
#define PZ_RROW1                                                        \
    ldi                                                                 \
    dec de                                                              \
    PZ_DOWN
#define PZ_RROW2                                                        \
    ldi                                                                 \
    ldi                                                                 \
    dec de                                                              \
    dec de                                                              \
    PZ_DOWN
#define PZ_RROW3                                                        \
    ldi                                                                 \
    ldi                                                                 \
    ldi                                                                 \
    dec de                                                              \
    dec de                                                              \
    dec de                                                              \
    PZ_DOWN

; one attribute cell: DE its address, HL saved-area pointer, C new value
#define PZ_ASET                                                         \
    ld a,(de)                                                           \
    ld (hl),a                                                           \
    inc hl                                                              \
    ld a,c                                                              \
    ld (de),a                                                           \
    inc e

#define PZ_AREST                                                        \
    ld a,(hl)                                                           \
    inc hl                                                              \
    ld (de),a                                                           \
    inc e

; ---------------- set up ----------------
__PZ_INIT:
    ld (__PZ_SCRHI),a
    ld a,b
    ld (__PZ_DBL),a
    xor a
    ld (__PZ_QN),a
    ; set 0 is the current one
    ld hl,__PZ_CTX
    ld (hl),0
    inc hl
    ld de,PZ_REC
    ld (hl),e : inc hl : ld (hl),d : inc hl
    ld de,PZ_BG
    ld (hl),e : inc hl : ld (hl),d : inc hl
    ld de,PZ_REC
    ld (hl),e : inc hl : ld (hl),d : inc hl
    ld de,PZ_BG
    ld (hl),e : inc hl : ld (hl),d
    ld hl,__PZ_CTX2
    ld (hl),0
    inc hl
    ld de,PZ_REC1
    ld (hl),e : inc hl : ld (hl),d : inc hl
    ld de,PZ_BG1
    ld (hl),e : inc hl : ld (hl),d : inc hl
    ld de,PZ_REC1
    ld (hl),e : inc hl : ld (hl),d : inc hl
    ld de,PZ_BG1
    ld (hl),e : inc hl : ld (hl),d
    ret

; forget everything drawn: both sets empty
__PZ_RESET:
    xor a
    ld (__PZ_QN),a
    ld (__PZ_CTX),a
    ld (__PZ_CTX2),a
    ld hl,(__PZ_RECS)
    ld (__PZ_REC_P),hl
    ld hl,(__PZ_BGS)
    ld (__PZ_BGP),hl
    ld hl,(__PZ_CTX2 + 5)
    ld (__PZ_CTX2 + 1),hl
    ld hl,(__PZ_CTX2 + 7)
    ld (__PZ_CTX2 + 3),hl
    ret

; switch to the other set and the other drawing screen
__PZ_FLIP:
    ld hl,__PZ_CTX
    ld de,__PZ_CTX2
    ld b,9
__PZ_FLIP1:
    ld a,(de)
    ld c,(hl)
    ld (hl),a
    ld a,c
    ld (de),a
    inc hl
    inc de
    djnz __PZ_FLIP1
    ld a,(__PZ_SCRHI)
    xor 0x80
    ld (__PZ_SCRHI),a
    ret

; ---------------- the queue (single-buffered) ----------------
__PZ_QRESET:
    xor a
    ld (__PZ_QN),a
    ret

__PZ_SPRITE:
    ld a,b
    cp 5
    jr c,__PZ_SPRITE_WIDE
    cp 7
    jr nc,__PZ_SPRITE_WIDE
    ld a,e                      ; narrow (4 lines): last line 191
    cp 157
    ret nc
    jr __PZ_SPRITE_OK
__PZ_SPRITE_WIDE:
    ld a,e                      ; 8 lines
    cp 153
    ret nc                      ; too low for the screen: dropped
__PZ_SPRITE_OK:
    ld a,(__PZ_QN)
    cp PZ_NS
    ret nc                      ; more than we can hold: dropped
    push hl
    ld l,a
    ld h,0
    add hl,hl
    add hl,hl
    push de
    ld de,__PZ_Q
    add hl,de
    pop de
    ld (hl),b
    inc hl
    ld (hl),c
    inc hl
    ld (hl),d
    inc hl
    ld (hl),e
    ld hl,__PZ_QN
    inc (hl)
    pop hl
    ret

; make the drawing screen show the queue (see the top), then empty it
__PZ_SYNC:
    push ix
    ld ix,(__PZ_RECS)
    ld hl,__PZ_Q
    ld a,(__PZ_QN)
    ld d,a                      ; D = queued
    ld a,(__PZ_N)
    ld e,a                      ; E = drawn
    ld b,0                      ; B = how many match
__PZ_SYNC1:
    ld a,b
    cp d
    jp nc,__PZ_SYNC2
    cp e
    jp nc,__PZ_SYNC2
    ld a,(hl)
    cp (ix+12)
    jp nz,__PZ_SYNC2
    inc hl
    ld a,(hl)
    cp (ix+13)
    jp nz,__PZ_SYNC2
    inc hl
    ld a,(hl)
    cp (ix+14)
    jp nz,__PZ_SYNC2
    inc hl
    ld a,(hl)
    cp (ix+15)
    jp nz,__PZ_SYNC2
    inc hl
    inc b
    ld a,ixl
    add a,16
    ld ixl,a
    jp nc,__PZ_SYNC1
    inc ixh
    jp __PZ_SYNC1
__PZ_SYNC2:
    ld a,b
    ld (__PZ_KEPT),a
    call __PZ_ERASE_TO          ; the old records above the kept ones
    ld a,(__PZ_KEPT)            ; the queue from the first one that differs
    ld e,a
    ld d,0
    ld hl,__PZ_Q
    ex de,hl
    add hl,hl
    add hl,hl
    add hl,de                   ; HL = queue + 4 * kept
    ld a,(__PZ_KEPT)
    ld b,a
    ld a,(__PZ_QN)
    sub b
    jp z,__PZ_SYNC4
    ld b,a                      ; B = how many to draw
__PZ_SYNC3:
    push bc
    push hl
    ld b,(hl)
    inc hl
    ld c,(hl)
    inc hl
    ld d,(hl)
    inc hl
    ld e,(hl)
    call __PZ_ADD
    pop hl
    ld de,4
    add hl,de
    pop bc
    djnz __PZ_SYNC3
__PZ_SYNC4:
    xor a
    ld (__PZ_QN),a
    pop ix
    ret

__PZ_KEPT:  db 0
__PZ_ETGT:  db 0

; ---------------- draw one sprite ----------------
; B kind, C frame, D x (logical), E y (logical)
__PZ_ADD:
    ld a,(__PZ_N)
    cp PZ_NS
    ret nc                      ; more than we can hold: not drawn
    push ix
    ld hl,(__PZ_REC_P)          ; what was asked, at record +12 (for __PZ_SYNC)
    ld a,12
    add a,l
    ld l,a
    jp nc,__PZ_ADD_R0
    inc h
__PZ_ADD_R0:
    ld (hl),b
    inc hl
    ld (hl),c
    inc hl
    ld (hl),d
    inc hl
    ld (hl),e
    ld ixh,b                    ; kind
    ld a,b                      ; image table entry
    add a,a
    add a,a
    add a,c
    add a,a
    ld l,a
    ld h,PZ_IMGTAB >> 8
    ld a,(hl)
    inc l
    ld h,(hl)
    ld l,a                      ; HL = image (unshifted copy)
    ld a,d
    add a,a
    ld c,a                      ; C = x in pixels
    ld a,b
    cp 5
    jp c,__PZ_ADD_WIDE
    cp 7
    jp c,__PZ_ADD_NARROW
__PZ_ADD_WIDE:
    ld a,c
    cp 241
    jp c,__PZ_ADD_W0
    ld c,240                    ; keep a 16-pixel image on the screen
__PZ_ADD_W0:
    ld a,c
    and 4
    jp nz,__PZ_ADD_W1
    ld b,0
    jp __PZ_ADD_COMMON
__PZ_ADD_W1:
    ld b,1
    ld a,l                      ; the copy shifted by 4 pixels: +16
    add a,16
    ld l,a
    jp nc,__PZ_ADD_COMMON
    inc h
    jp __PZ_ADD_COMMON
__PZ_ADD_NARROW:
    ld b,2
    ld a,c
    and 4
    jp z,__PZ_ADD_COMMON
    ld a,l                      ; shifted copy: +4
    add a,4
    ld l,a
    jp nc,__PZ_ADD_COMMON
    inc h
__PZ_ADD_COMMON:
    ld (__PZ_TIMG),hl
    ld a,b
    ld (__PZ_TTYPE),a
    ; screen address of the first byte -> DE
    ld a,e
    add a,32                    ; the playfield starts at line 32
    ld e,a
    and 0xC0
    rrca
    rrca
    rrca
    ld d,a
    ld a,e
    and 7
    or d
    ld d,a
    ld a,(__PZ_SCRHI)
    or d
    ld d,a
    ld a,e
    and 0x38
    add a,a
    add a,a
    ld e,a
    ld a,c
    rrca
    rrca
    rrca
    and 31
    or e
    ld e,a
    ld (__PZ_TSCR),de
    ; the record
    ld hl,(__PZ_REC_P)
    ld (hl),e
    inc hl
    ld (hl),d
    inc hl
    ld (hl),b
    inc hl
    ; attribute cells: rows*16 + columns, by type and by the scanline in D
    ld a,d
    and 7
    ld c,a                      ; C = scanline of the first byte
    ld a,b
    or a
    jp z,__PZ_ADD_T0
    dec a
    jp z,__PZ_ADD_T1
    ld a,c                      ; narrow: 1 column, 2 rows if scanline >= 5
    cp 5
    ld a,0x11
    jp c,__PZ_ADD_TS
    ld a,0x21
    jp __PZ_ADD_TS
__PZ_ADD_T0:
    ld a,c                      ; 2 columns, 2 rows unless scanline 0
    or a
    ld a,0x12
    jp z,__PZ_ADD_TS
    ld a,0x22
    jp __PZ_ADD_TS
__PZ_ADD_T1:
    ld a,c                      ; 3 columns
    or a
    ld a,0x13
    jp z,__PZ_ADD_TS
    ld a,0x23
__PZ_ADD_TS:
    ld b,a                      ; B = rows*16 + columns
    ld (hl),a
    inc hl
    ld (hl),e                   ; attribute address: low byte as the bitmap's
    inc hl
    ld a,d
    and 0x80
    ld c,a
    ld a,d
    and 0x18
    rrca
    rrca
    rrca
    add a,0x58
    or c
    ld (hl),a                   ; high byte: 58..5B, or D8..DB for screen 7
    inc hl
    ld d,a                      ; DE = attribute address
    ld a,ixh                    ; C = the kind's attribute value
    add a,PZ_ATTRTAB & 0xFF
    push hl
    ld l,a
    ld h,PZ_ATTRTAB >> 8
    ld c,(hl)
    pop hl                      ; HL = saved-attribute area
    ld a,b
    and 15
    ld ixl,a                    ; IXL = columns
    ld a,b
    rrca
    rrca
    rrca
    rrca
    and 15
    ld b,a                      ; B = rows
__PZ_ADD_AROW:
    push de
    PZ_ASET
    ld a,ixl
    cp 1
    jp nz,__PZ_ADD_AC2
    inc hl
    inc hl
    jp __PZ_ADD_AEND
__PZ_ADD_AC2:
    PZ_ASET
    ld a,ixl
    cp 2
    jp nz,__PZ_ADD_AC3
    inc hl
    jp __PZ_ADD_AEND
__PZ_ADD_AC3:
    PZ_ASET
__PZ_ADD_AEND:
    pop de
    ld a,e
    add a,32
    ld e,a
    jp nc,__PZ_ADD_AN
    inc d
__PZ_ADD_AN:
    djnz __PZ_ADD_AROW
    ; the bitmap
    ld de,(__PZ_TSCR)
    ld hl,(__PZ_TIMG)
    ld bc,(__PZ_BGP)
    ld a,(__PZ_TTYPE)
    or a
    jp z,__PZ_DRAW0
    dec a
    jp z,__PZ_DRAW1
    PZ_ROW1                     ; narrow: 4 rows of 1 byte
    PZ_ROW1
    PZ_ROW1
    PZ_DB
    jp __PZ_ADD_END
__PZ_DRAW0:                     ; 8 rows of 2 bytes
    PZ_ROW2
    PZ_ROW2
    PZ_ROW2
    PZ_ROW2
    PZ_ROW2
    PZ_ROW2
    PZ_ROW2
    PZ_DB
    inc e
    PZ_DB
    jp __PZ_ADD_END
__PZ_DRAW1:                     ; 8 rows of 3 bytes
    PZ_ROW3
    PZ_ROW3
    PZ_ROW3
    PZ_ROW3
    PZ_ROW3
    PZ_ROW3
    PZ_ROW3
    PZ_DB
    inc e
    PZ_DB
    inc e
    PZ_DB
__PZ_ADD_END:
    ld hl,(__PZ_REC_P)
    ld de,16
    add hl,de
    ld (__PZ_REC_P),hl
    ld hl,(__PZ_BGP)
    ld de,24
    add hl,de
    ld (__PZ_BGP),hl
    ld hl,__PZ_N
    inc (hl)
    pop ix
    ret

; ---------------- erase everything drawn in the current set ----------------
__PZ_ERASE_TO:                  ; A = how many records to keep
    ld (__PZ_ETGT),a
    push ix
    ld b,a
    ld a,(__PZ_N)
    cp b
    jp z,__PZ_ERASE_END         ; nothing above them
__PZ_ERASE_LOOP:
    ld hl,(__PZ_REC_P)
    ld de,-16
    add hl,de
    ld (__PZ_REC_P),hl
    ld hl,(__PZ_BGP)
    ld de,-24
    add hl,de
    ld (__PZ_BGP),hl
    ld b,h
    ld c,l                      ; BC = its background
    ld hl,(__PZ_REC_P)
    ld e,(hl)
    inc hl
    ld d,(hl)
    inc hl
    ld a,(hl)                   ; type
    inc hl
    push hl                     ; record + 3
    ld h,b
    ld l,c                      ; HL = the saved bytes, DE = the screen
    or a
    jp z,__PZ_REST0
    dec a
    jp z,__PZ_REST1
    PZ_RROW1                    ; narrow: 4 rows of 1 byte
    PZ_RROW1
    PZ_RROW1
    ldi
    jp __PZ_ERASE_ATTR
__PZ_REST0:                     ; 8 rows of 2 bytes
    PZ_RROW2
    PZ_RROW2
    PZ_RROW2
    PZ_RROW2
    PZ_RROW2
    PZ_RROW2
    PZ_RROW2
    ldi
    ldi
    jp __PZ_ERASE_ATTR
__PZ_REST1:                     ; 8 rows of 3 bytes
    PZ_RROW3
    PZ_RROW3
    PZ_RROW3
    PZ_RROW3
    PZ_RROW3
    PZ_RROW3
    PZ_RROW3
    ldi
    ldi
    ldi
__PZ_ERASE_ATTR:
    pop hl                      ; record + 3
    ld b,(hl)                   ; rows*16 + columns
    inc hl
    ld e,(hl)
    inc hl
    ld d,(hl)
    inc hl                      ; DE = attribute address, HL = saved area
    ld a,b
    and 15
    ld ixl,a
    ld a,b
    rrca
    rrca
    rrca
    rrca
    and 15
    ld b,a
__PZ_ERASE_AROW:
    push de
    PZ_AREST
    ld a,ixl
    cp 1
    jp nz,__PZ_ERASE_AC2
    inc hl
    inc hl
    jp __PZ_ERASE_AEND
__PZ_ERASE_AC2:
    PZ_AREST
    ld a,ixl
    cp 2
    jp nz,__PZ_ERASE_AC3
    inc hl
    jp __PZ_ERASE_AEND
__PZ_ERASE_AC3:
    PZ_AREST
__PZ_ERASE_AEND:
    pop de
    ld a,e
    add a,32
    ld e,a
    jp nc,__PZ_ERASE_AN
    inc d
__PZ_ERASE_AN:
    djnz __PZ_ERASE_AROW
    ld hl,__PZ_N
    dec (hl)
    ld a,(__PZ_ETGT)
    cp (hl)
    jp nz,__PZ_ERASE_LOOP
__PZ_ERASE_END:
    pop ix
    ret

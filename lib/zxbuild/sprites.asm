; -----------------------------------------------------------------------
; zxbuild/sprites.asm -- the Spectrum sprite engine behind sprites.bas
; (Z80, --arch zx48k). Written from scratch for this project (MIT); the
; engine is the one Starfall's former Spectrum layer carried, made generic. Read the header of sprites.bas for
; the API, formats, memory map and costs.
;
; The constants __ZXS_* (sprite capacity, images, the addresses of the
; areas) are defined by SpritesInit in sprites.bas, from ZXSPR_BASE,
; ZXSPR_MAX and ZXSPR_IMAGES.
;
; Records (16 bytes, per drawn sprite, in the REC area):
;   +0,+1 screen address of its first byte
;   +2    draw type: 0 wide, 1 wide shifted by 4 pixels, 2 narrow
;   +3    attribute cells covered, rows*16 + columns; 0 = attributes not
;         touched (the image has no colour)
;   +4,+5 address of the first of those cells
;   +6..+11 their saved values (3 per row)
;   +12..+14 what was asked: image, x, y (+15 unused)
; Backgrounds (24 bytes, BG area): the screen bytes under the sprite, a
; row of 2, 3 or 1 bytes per line.
; Image table (4 bytes per image, IMGTAB): address of its pre-shifted
; copies (0 = not defined), attribute (0 = none), kind (0 wide, 1 narrow).
; Queue (4 bytes per entry, Q area): image, x, y, unused.
; Two sets of records and backgrounds, one per screen (a 128K draws on one
; screen while the other is shown); a "context" holds the current set's
; count and pointers and the two are swapped by __ZXS_FLIP.
;
; Entry points (all keep IX, IY and the stack; AF, BC, DE, HL and the
; flags are clobbered unless said):
;   __ZXS_INIT    A = high byte of the drawing screen (&40 or &C0)
;   __ZXS_QRESET  empty the queue                       clobbers A
;   __ZXS_SPRITE  B image, D x, E y: queues it (dropped if the image is
;                 undefined or too low for the screen, or the queue is
;                 full)
;   __ZXS_SYNC    make the drawing screen show the queue, empty the queue
;   __ZXS_FLIP    show the screen drawn, swap to the other set and screen (128K)
;   __ZXS_PAGING, __ZXS_ENTER, __ZXS_LEAVE: see below (128K bank handling)
;   __ZXS_RESET   forget everything drawn (after the screen was cleared)
; -----------------------------------------------------------------------

    push namespace core

__ZXS_CTX:  db 0                        ; the current set: count,
            dw __ZXS_REC, __ZXS_BG      ; record and background pointers,
            dw __ZXS_REC, __ZXS_BG      ; and where its areas start
__ZXS_CTX2: db 0                        ; the other set
            dw __ZXS_REC1, __ZXS_BG1
            dw __ZXS_REC1, __ZXS_BG1
__ZXS_N     equ __ZXS_CTX
__ZXS_REC_P equ __ZXS_CTX + 1
__ZXS_BGP   equ __ZXS_CTX + 3
__ZXS_RECS  equ __ZXS_CTX + 5
__ZXS_BGS   equ __ZXS_CTX + 7
; the same bytes as at the start: copied over the contexts by INIT, RESET
__ZXS_CTX0: db 0
            dw __ZXS_REC, __ZXS_BG
            dw __ZXS_REC, __ZXS_BG
            db 0
            dw __ZXS_REC1, __ZXS_BG1
            dw __ZXS_REC1, __ZXS_BG1
__ZXS_SCRHI: db 0x40
__ZXS_TSCR:  dw 0
__ZXS_TIMG:  dw 0
__ZXS_TTYPE: db 0
__ZXS_QN:    db 0
__ZXS_KEPT:  db 0
__ZXS_ETGT:  db 0

; next screen line: DE = address of a byte, DE = the byte below it. Inside a
; character cell only D changes (INC D); crossing into the next cell (every
; 8th line) is the subroutine __ZXS_CELL (the macros cannot hold labels).
__ZXS_CELL:                     ; D has just wrapped to scanline 0 of its cell
    ld a,e
    add a,32
    ld e,a
    ret c                       ; the next cell row in the same third
    ld a,d
    sub 8                       ; next third: undo the carry into D's bits 3-4
    ld d,a
    ret
#define ZXS_DOWN \
    inc d : \
    ld a,d : \
    and 7 : \
    call z,__ZXS_CELL

; draw one byte: DE screen, HL image (graph), BC background buffer
#define ZXS_DB \
    ld a,(de) : \
    ld (bc),a : \
    inc bc : \
    or (hl) : \
    inc hl : \
    ld (de),a

; a row of 1, 2 or 3 bytes and the step to the next line
#define ZXS_ROW1 \
    ZXS_DB : \
    ZXS_DOWN
#define ZXS_ROW2 \
    ZXS_DB : \
    inc e : \
    ZXS_DB : \
    dec e : \
    ZXS_DOWN
#define ZXS_ROW3 \
    ZXS_DB : \
    inc e : \
    ZXS_DB : \
    inc e : \
    ZXS_DB : \
    dec e : \
    dec e : \
    ZXS_DOWN

; restore a row (LDI: HL background -> DE screen; BC is just a counter; LDI's
; INC DE is 16 bits, so is the DEC DE that undoes it: E may wrap at column 31)
#define ZXS_RROW1 \
    ldi : \
    dec de : \
    ZXS_DOWN
#define ZXS_RROW2 \
    ldi : \
    ldi : \
    dec de : \
    dec de : \
    ZXS_DOWN
#define ZXS_RROW3 \
    ldi : \
    ldi : \
    ldi : \
    dec de : \
    dec de : \
    dec de : \
    ZXS_DOWN

; one attribute cell: DE its address, HL saved-area pointer, C new value
#define ZXS_ASET \
    ld a,(de) : \
    ld (hl),a : \
    inc hl : \
    ld a,c : \
    ld (de),a : \
    inc e

#define ZXS_AREST \
    ld a,(hl) : \
    inc hl : \
    ld (de),a : \
    inc e


; ---------------- set up ----------------
; A = high byte of the drawing screen. Empties both sets and the queue and
; marks every image undefined. Clobbers AF, BC, DE, HL.
__ZXS_INIT:
    ld (__ZXS_SCRHI),a
    ld hl,__ZXS_IMGTAB
    ld de,__ZXS_IMGTAB + 1
    ld bc,__ZXS_NI * 4 - 1
    ld (hl),0
    ldir
; forget everything drawn: both sets empty. Clobbers AF, BC, DE, HL.
__ZXS_RESET:
    xor a
    ld (__ZXS_QN),a
    ld hl,__ZXS_CTX0
    ld de,__ZXS_CTX
    ld bc,18
    ldir
    ret

; ---------------- 128K paging ----------------
; Bank register (&7FFD) writes keep the BANKM copy at &5B5C (the 128K ROM
; reads it) and the interrupt state. A = the value; clobbers AF, BC.
__ZXS_OUT7FFD:
    ld c,a
    ld a,i                      ; IFF2 -> P/V (read twice: NMOS Z80 bug)
    jp pe,__ZXS_OUT1
    ld a,i
__ZXS_OUT1:
    ld a,c
    ld bc,0x7FFD
    di
    ld (0x5B5C),a
    out (c),a
    ret po                      ; interrupts were off
    ei
    ret

__ZXS_BANK0: db 0               ; the bank that was at &C000

; A = 1 if the stack is below &C000 and RAM paging works (a 128K), else 0.
; Probes the byte at &FFFE of two banks and puts everything back.
; Clobbers AF, BC, DE, HL.
__ZXS_PAGING:
    ld hl,0
    add hl,sp
    ld a,h
    cp 0xC0
    jr c,__ZXS_PG1
    xor a
    ret
__ZXS_PG1:
    ld hl,0xFFFE
    ld d,(hl)                   ; D = the byte in the current bank
    ld a,d
    cpl
    ld (hl),a                   ; ... made ~D
    ld a,(0x5B5C)
    xor 1                       ; another bank, if banks exist
    call __ZXS_OUT7FFD
    ld e,(hl)                   ; E = its byte (D's neighbour, or ~D if no banks)
    ld a,e
    xor 0x55
    ld (hl),a
    ld a,(0x5B5C)
    xor 1                       ; back to the first
    call __ZXS_OUT7FFD
    ld a,(hl)
    cpl
    cp d                        ; first bank's byte still ~D: it is another RAM
    ld a,0
    jr nz,__ZXS_PG2
    inc a
__ZXS_PG2:
    ld b,a                      ; (B is free: the out routine is done)
    ld a,(0x5B5C)
    xor 1
    push bc
    call __ZXS_OUT7FFD          ; restore the other bank's byte
    ld (hl),e
    ld a,(0x5B5C)
    xor 1
    call __ZXS_OUT7FFD
    ld (hl),d                   ; and the first one's
    pop bc
    ld a,b
    ret

; page bank 7 in at &C000 and show screen 5 (the drawing screen is 7).
; Clobbers AF, BC.
__ZXS_ENTER:
    ld a,(0x5B5C)
    and 7
    ld (__ZXS_BANK0),a
    ld a,(0x5B5C)
    and 0xF0                    ; ROM select kept; screen 5 shown
    or 7
    jp __ZXS_OUT7FFD

; page the bank that was at &C000 back and show screen 5. Clobbers AF, BC, HL.
__ZXS_LEAVE:
    ld a,(0x5B5C)
    and 0xF0
    ld hl,__ZXS_BANK0
    or (hl)
    jp __ZXS_OUT7FFD

; show the screen just drawn, switch to the other set and the other drawing
; screen. Call right after a HALT (the switch happens in the frame blank).
; Clobbers AF, BC, DE, HL.
__ZXS_FLIP:
    ld a,(0x5B5C)
    xor 8                       ; the other screen (5 <-> 7)
    call __ZXS_OUT7FFD
    ld hl,__ZXS_CTX
    ld de,__ZXS_CTX2
    ld b,9
__ZXS_FLIP1:
    ld a,(de)
    ld c,(hl)
    ld (hl),a
    ld a,c
    ld (de),a
    inc hl
    inc de
    djnz __ZXS_FLIP1
    ld a,(__ZXS_SCRHI)
    xor 0x80
    ld (__ZXS_SCRHI),a
    ret

; ---------------- the queue ----------------
; Clobbers A.
__ZXS_QRESET:
    xor a
    ld (__ZXS_QN),a
    ret

; B image, D x, E y. Clobbers AF, HL.
__ZXS_SPRITE:
    ld a,b
    cp __ZXS_NI
    ret nc                      ; no such image
    add a,a
    add a,a                     ; 4 bytes an entry (at most 64 images)
    add a,__ZXS_IMGTAB & 0xFF
    ld l,a
    ld a,__ZXS_IMGTAB >> 8
    adc a,0
    ld h,a                      ; HL = its table entry
    inc hl
    ld a,(hl)                   ; address high byte: 0 = undefined
    or a
    ret z
    inc hl
    inc hl
    ld a,(hl)                   ; kind
    or a
    ld a,e
    jr nz,__ZXS_SPRITE_NARROW
    cp 185                      ; 8 lines: the last must be 191
    ret nc
    jr __ZXS_SPRITE_OK
__ZXS_SPRITE_NARROW:
    cp 189                      ; 4 lines
    ret nc
__ZXS_SPRITE_OK:
    ld a,(__ZXS_QN)
    cp __ZXS_NS
    ret nc                      ; more than we can hold: dropped
    add a,a
    add a,a                     ; 4 bytes an entry (at most 64 sprites)
    add a,__ZXS_Q & 0xFF
    ld l,a
    ld a,__ZXS_Q >> 8
    adc a,0
    ld h,a                      ; HL = the queue entry
    ld (hl),b
    inc hl
    ld (hl),d
    inc hl
    ld (hl),e
    ld hl,__ZXS_QN
    inc (hl)
    ret

; make the drawing screen show the queue (see sprites.bas), then empty it.
; Clobbers AF, BC, DE, HL (keeps IX).
__ZXS_SYNC:
    push ix
    ld ix,(__ZXS_RECS)
    ld hl,__ZXS_Q
    ld a,(__ZXS_QN)
    ld d,a                      ; D = queued
    ld a,(__ZXS_N)
    ld e,a                      ; E = drawn
    ld b,0                      ; B = how many match
__ZXS_SYNC1:
    ld a,b
    cp d
    jp nc,__ZXS_SYNC2
    cp e
    jp nc,__ZXS_SYNC2
    ld a,(hl)
    cp (ix+12)
    jp nz,__ZXS_SYNC2
    inc hl
    ld a,(hl)
    cp (ix+13)
    jp nz,__ZXS_SYNC2
    inc hl
    ld a,(hl)
    cp (ix+14)
    jp nz,__ZXS_SYNC2
    inc hl
    inc hl
    inc b
    ld a,ixl
    add a,16
    ld ixl,a
    jp nc,__ZXS_SYNC1
    inc ixh
    jp __ZXS_SYNC1
__ZXS_SYNC2:
    ld a,b
    ld (__ZXS_KEPT),a
    call __ZXS_ERASE_TO         ; the old records above the kept ones
    ld a,(__ZXS_KEPT)           ; the queue from the first one that differs
    ld e,a
    ld d,0
    ld hl,__ZXS_Q
    ex de,hl
    add hl,hl
    add hl,hl
    add hl,de                   ; HL = queue + 4 * kept
    ld a,(__ZXS_KEPT)
    ld b,a
    ld a,(__ZXS_QN)
    sub b
    jp z,__ZXS_SYNC4
    ld b,a                      ; B = how many to draw
__ZXS_SYNC3:
    push bc
    push hl
    ld b,(hl)
    inc hl
    ld d,(hl)
    inc hl
    ld e,(hl)
    call __ZXS_ADD
    pop hl
    ld de,4
    add hl,de
    pop bc
    djnz __ZXS_SYNC3
__ZXS_SYNC4:
    xor a
    ld (__ZXS_QN),a
    pop ix
    ret

; ---------------- draw one sprite ----------------
; B image, D x, E y. Clobbers AF, BC, DE, HL (keeps IX).
__ZXS_ADD:
    ld a,(__ZXS_N)
    cp __ZXS_NS
    ret nc                      ; more than we can hold: not drawn
    push ix
    ld hl,(__ZXS_REC_P)         ; what was asked, at record +12 (for SYNC)
    ld a,12
    add a,l
    ld l,a
    jp nc,__ZXS_ADD_R0
    inc h
__ZXS_ADD_R0:
    ld (hl),b
    inc hl
    ld (hl),d
    inc hl
    ld (hl),e
    ld a,b                      ; the image's table entry
    add a,a
    add a,a
    add a,__ZXS_IMGTAB & 0xFF
    ld l,a
    ld a,__ZXS_IMGTAB >> 8
    adc a,0
    ld h,a
    ld c,(hl)
    inc hl
    ld b,(hl)                   ; BC = image (unshifted copy)
    inc hl
    ld a,(hl)
    inc hl
    ld ixh,a                    ; IXH = attribute, 0 = none
    ld a,(hl)                   ; kind
    ld h,b
    ld l,c                      ; HL = image
    ld c,d                      ; C = x in pixels
    or a
    jp nz,__ZXS_ADD_NARROW
    ld a,c                      ; wide
    cp 241
    jp c,__ZXS_ADD_W0
    ld c,240                    ; keep a 16-pixel image on the screen
__ZXS_ADD_W0:
    ld a,c
    and 4
    jp nz,__ZXS_ADD_W1
    ld b,0
    jp __ZXS_ADD_COMMON
__ZXS_ADD_W1:
    ld b,1
    ld a,l                      ; the copy shifted by 4 pixels: +16
    add a,16
    ld l,a
    jp nc,__ZXS_ADD_COMMON
    inc h
    jp __ZXS_ADD_COMMON
__ZXS_ADD_NARROW:
    ld b,2
    ld a,c
    and 4
    jp z,__ZXS_ADD_COMMON
    ld a,l                      ; shifted copy: +4
    add a,4
    ld l,a
    jp nc,__ZXS_ADD_COMMON
    inc h
__ZXS_ADD_COMMON:
    ld (__ZXS_TIMG),hl
    ld a,b
    ld (__ZXS_TTYPE),a
    ; screen address of the first byte -> DE
    ld a,e
    and 0xC0
    rrca
    rrca
    rrca
    ld d,a
    ld a,e
    and 7
    or d
    ld d,a
    ld a,(__ZXS_SCRHI)
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
    ld (__ZXS_TSCR),de
    ; the record
    ld hl,(__ZXS_REC_P)
    ld (hl),e
    inc hl
    ld (hl),d
    inc hl
    ld (hl),b
    inc hl
    ld a,ixh
    or a
    jp nz,__ZXS_ADD_ATTR
    ld (hl),a                   ; no colour: no cells
    jp __ZXS_ADD_BITMAP
__ZXS_ADD_ATTR:
    ; attribute cells: rows*16 + columns, by type and by the scanline in D
    ld a,d
    and 7
    ld c,a                      ; C = scanline of the first byte
    ld a,b
    or a
    jp z,__ZXS_ADD_T0
    dec a
    jp z,__ZXS_ADD_T1
    ld a,c                      ; narrow: 1 column, 2 rows if scanline >= 5
    cp 5
    ld a,0x11
    jp c,__ZXS_ADD_TS
    ld a,0x21
    jp __ZXS_ADD_TS
__ZXS_ADD_T0:
    ld a,c                      ; 2 columns, 2 rows unless scanline 0
    or a
    ld a,0x12
    jp z,__ZXS_ADD_TS
    ld a,0x22
    jp __ZXS_ADD_TS
__ZXS_ADD_T1:
    ld a,c                      ; 3 columns
    or a
    ld a,0x13
    jp z,__ZXS_ADD_TS
    ld a,0x23
__ZXS_ADD_TS:
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
    ld c,ixh                    ; C = the image's attribute value
    ld a,b
    and 15
    ld ixl,a                    ; IXL = columns
    ld a,b
    rrca
    rrca
    rrca
    rrca
    and 15
    ld b,a                      ; B = rows (HL = saved-attribute area)
__ZXS_ADD_AROW:
    push de
    ZXS_ASET
    ld a,ixl
    cp 1
    jp nz,__ZXS_ADD_AC2
    inc hl
    inc hl
    jp __ZXS_ADD_AEND
__ZXS_ADD_AC2:
    ZXS_ASET
    ld a,ixl
    cp 2
    jp nz,__ZXS_ADD_AC3
    inc hl
    jp __ZXS_ADD_AEND
__ZXS_ADD_AC3:
    ZXS_ASET
__ZXS_ADD_AEND:
    pop de
    ld a,e
    add a,32
    ld e,a
    jp nc,__ZXS_ADD_AN
    inc d
__ZXS_ADD_AN:
    djnz __ZXS_ADD_AROW
__ZXS_ADD_BITMAP:
    ld de,(__ZXS_TSCR)
    ld hl,(__ZXS_TIMG)
    ld bc,(__ZXS_BGP)
    ld a,(__ZXS_TTYPE)
    or a
    jp z,__ZXS_DRAW0
    dec a
    jp z,__ZXS_DRAW1
    ZXS_ROW1                    ; narrow: 4 rows of 1 byte
    ZXS_ROW1
    ZXS_ROW1
    ZXS_DB
    jp __ZXS_ADD_END
__ZXS_DRAW0:                    ; 8 rows of 2 bytes
    ZXS_ROW2
    ZXS_ROW2
    ZXS_ROW2
    ZXS_ROW2
    ZXS_ROW2
    ZXS_ROW2
    ZXS_ROW2
    ZXS_DB
    inc e
    ZXS_DB
    jp __ZXS_ADD_END
__ZXS_DRAW1:                    ; 8 rows of 3 bytes
    ZXS_ROW3
    ZXS_ROW3
    ZXS_ROW3
    ZXS_ROW3
    ZXS_ROW3
    ZXS_ROW3
    ZXS_ROW3
    ZXS_DB
    inc e
    ZXS_DB
    inc e
    ZXS_DB
__ZXS_ADD_END:
    ld hl,(__ZXS_REC_P)
    ld de,16
    add hl,de
    ld (__ZXS_REC_P),hl
    ld hl,(__ZXS_BGP)
    ld de,24
    add hl,de
    ld (__ZXS_BGP),hl
    ld hl,__ZXS_N
    inc (hl)
    pop ix
    ret

; ---------------- erase the drawn sprites above the first A ----------------
; Clobbers AF, BC, DE, HL (keeps IX).
__ZXS_ERASE_TO:
    ld (__ZXS_ETGT),a
    push ix
    ld b,a
    ld a,(__ZXS_N)
    cp b
    jp z,__ZXS_ERASE_END        ; nothing above them
__ZXS_ERASE_LOOP:
    ld hl,(__ZXS_REC_P)
    ld de,-16
    add hl,de
    ld (__ZXS_REC_P),hl
    ld hl,(__ZXS_BGP)
    ld de,-24
    add hl,de
    ld (__ZXS_BGP),hl
    ld b,h
    ld c,l                      ; BC = its background
    ld hl,(__ZXS_REC_P)
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
    jp z,__ZXS_REST0
    dec a
    jp z,__ZXS_REST1
    ZXS_RROW1                   ; narrow: 4 rows of 1 byte
    ZXS_RROW1
    ZXS_RROW1
    ldi
    jp __ZXS_ERASE_ATTR
__ZXS_REST0:                    ; 8 rows of 2 bytes
    ZXS_RROW2
    ZXS_RROW2
    ZXS_RROW2
    ZXS_RROW2
    ZXS_RROW2
    ZXS_RROW2
    ZXS_RROW2
    ldi
    ldi
    jp __ZXS_ERASE_ATTR
__ZXS_REST1:                    ; 8 rows of 3 bytes
    ZXS_RROW3
    ZXS_RROW3
    ZXS_RROW3
    ZXS_RROW3
    ZXS_RROW3
    ZXS_RROW3
    ZXS_RROW3
    ldi
    ldi
    ldi
__ZXS_ERASE_ATTR:
    pop hl                      ; record + 3
    ld b,(hl)                   ; rows*16 + columns, 0 = none
    ld a,b
    or a
    jp z,__ZXS_ERASE_NEXT
    inc hl
    ld e,(hl)
    inc hl
    ld d,(hl)
    inc hl                      ; DE = attribute address, HL = saved area
    and 15
    ld ixl,a
    ld a,b
    rrca
    rrca
    rrca
    rrca
    and 15
    ld b,a
__ZXS_ERASE_AROW:
    push de
    ZXS_AREST
    ld a,ixl
    cp 1
    jp nz,__ZXS_ERASE_AC2
    inc hl
    inc hl
    jp __ZXS_ERASE_AEND
__ZXS_ERASE_AC2:
    ZXS_AREST
    ld a,ixl
    cp 2
    jp nz,__ZXS_ERASE_AC3
    inc hl
    jp __ZXS_ERASE_AEND
__ZXS_ERASE_AC3:
    ZXS_AREST
__ZXS_ERASE_AEND:
    pop de
    ld a,e
    add a,32
    ld e,a
    jp nc,__ZXS_ERASE_AN
    inc d
__ZXS_ERASE_AN:
    djnz __ZXS_ERASE_AROW
__ZXS_ERASE_NEXT:
    ld hl,__ZXS_N
    dec (hl)
    ld a,(__ZXS_ETGT)
    cp (hl)
    jp nz,__ZXS_ERASE_LOOP
__ZXS_ERASE_END:
    pop ix
    ret

    pop namespace

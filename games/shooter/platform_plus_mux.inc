; ----------------------------------------------------------------
; platform_plus_mux.inc -- the raster-multiplexed formation of Starfall Plus
; (the cartridge build, -D PLUS_MUX), assembly part. Included inside the ASM
; block of platform_plus.bas, so it lies in the program image below &4000:
; the handlers and the tables they read must be outside &4000-&7FFF, which
; the ASIC's register page covers while a handler has it paged in
; (build_plus.sh checks the map).
;
; The six sprites 10-15 show the formation: the k-th living alien of a row uses
; sprite 10 + k (the layer is told only kind, frame, x and y), and three
; raster handlers re-position those six sprites for the next row each frame
; (see platform_plus.bas for the whole design).
;
; Row table (28 bytes, 3 per buffer: row 0 = the top row, kind 3):
;   6 x (X low, X high, Y low, Y high)  the six sprites' registers X and Y,
;                                       a hidden one has Y = -128
;   body colour (E, D), light colour (E, D)   as the ASIC's palette bytes
; Two buffers: MX_ACTP's is read by the handlers, MX_SHDP's is filled by
; MX_FLUSH while the frame is being drawn; MX_COMMIT swaps them.
; Handlers: MX_H1 (row 1), MX_H2 (row 2), MX_H3 (the top row for the next frame),
; MX_H4 (the aliens' legs, when the animation frame changed).
; Compile with -D MX_TEST for the logging hooks of tests/plus_mux.bas.
; ----------------------------------------------------------------

MX_ROWSZ    EQU 28

; MX_SPRITE: PlatSprite for kinds 1-3 (the formation), IX = the SUB's frame:
; the call is logged, MX_FLUSH decides what to do with them at the frame end.
MX_SPRITE:
    ld a, (MX_NL)
    cp 24
    jr c, MXS_OK
    ld a, 1
    ld (MX_BAD), a              ; more than 24 calls: software for the frame
    ret
MXS_OK:
    ld l, a
    ld h, 0
    add hl, hl
    add hl, hl
    ld de, MX_LOG
    add hl, de
    ld a, (ix+5)
    ld (hl), a                  ; kind
    inc hl
    ld a, (ix+7)
    ld (hl), a                  ; frame
    inc hl
    ld a, (ix+9)
    ld (hl), a                  ; x
    inc hl
    ld a, (ix+11)
    ld (hl), a                  ; y
    ld hl, MX_NL
    inc (hl)
    ret

; MX_FRAME: start of a frame's drawing
MX_FRAME:
    xor a
    ld (MX_NL), a
    ld (MX_BAD), a
    dec a
    ld (MX_FR), a               ; 255: no alien queued
    ret

; MX_IDX: HL = an aligned 4-byte table, C = 0-3: HL = &table[C]
MX_IDX:
    ld a, l
    or c
    ld l, a
    ret

; MX_FLUSH: the frame's formation calls become the shadow row tables, or, when
; the multiplexing cannot show them, software sprites. Returns A = 1 for the
; multiplexed formation, 0 for the software fallback.
MX_FLUSH:
    xor a
    ld (MX_N), a
    ld (MX_N+1), a
    ld (MX_N+2), a
    ld (MX_LV), a
    ld a, (MX_NL)
    or a
    jp z, MXF_OK                ; no alien this frame: all sprites hidden
    ld a, (MX_BAD)
    or a
    jp nz, MXF_FALL
    ld hl, MX_LOG
    ld a, (MX_NL)
    ld b, a
MXF_L:
    push bc
    ld a, (hl)
    inc hl
    ld c, a                     ; C = kind
    ld a, (hl)
    inc hl
    ld (MX_FR), a
    ld e, (hl)                  ; E = x
    inc hl
    ld d, (hl)                  ; D = y
    inc hl
    push hl                     ; the log pointer
    ld a, 3
    sub c
    ld c, a                     ; C = row 0-2 (0 = top, kind 3)
    ld a, d
    add a, 16
    jp c, MXF_ERR
    ld d, a                     ; D = the sprite's line
    ld a, e
    cp 176                      ; X = 4 x + 64 must stay below 768
    jp nc, MXF_ERR
    ld hl, MX_N
    call MX_IDX
    ld a, (hl)
    cp 6
    jp nc, MXF_ERR              ; a row of more than 6
    or a
    jr nz, MXF_CMP
    push hl
    ld hl, MX_YR
    call MX_IDX
    ld (hl), d                  ; the row's line
    pop hl
    jr MXF_ST
MXF_CMP:
    push hl
    ld hl, MX_YR
    call MX_IDX
    ld a, (hl)
    pop hl
    cp d
    jp nz, MXF_ERR              ; a row whose sprites differ in y
MXF_ST:
    ld a, (hl)                  ; n
    inc (hl)
    add a, a
    add a, a
    ld b, a                     ; B = 4 n
    ld hl, MX_ROFF
    call MX_IDX
    ld a, (hl)                  ; 28 row
    add a, b
    ld hl, (MX_SHDP)
    add a, l
    ld l, a
    jr nc, MXF_S1
    inc h
MXF_S1:
    ld c, e
    ld b, 0
    sla c
    rl b
    sla c
    rl b                        ; BC = 4 x
    ld a, c
    add a, 64
    ld c, a
    jr nc, MXF_S2
    inc b
MXF_S2:
    ld (hl), c
    inc hl
    ld (hl), b
    inc hl
    ld (hl), d
    inc hl
    ld (hl), 0
    pop hl
    pop bc
    djnz MXF_L
    ; the row lines: the first row with aliens gives its own, the rows above
    ; it follow at 12-line steps, the ones below keep 12 lines from the row
    ; before (or their own, when they have aliens, and that is farther)
    ld c, 0
MXF_P:
    ld hl, MX_N
    call MX_IDX
    ld a, (hl)
    or a
    jr nz, MXF_PF
    inc c
    ld a, c
    cp 3
    jp nc, MXF_FALL
    jr MXF_P
MXF_PF:
    ld a, c
    ld (MX_P), a
    ld hl, MX_YR
    call MX_IDX
    ld b, (hl)
    ld hl, MX_YC
    call MX_IDX
    ld (hl), b
MXF_BK:
    ld a, c
    or a
    jr z, MXF_FW0
    dec c
    ld hl, MX_YC
    call MX_IDX
    inc hl
    ld a, (hl)
    sub 12
    jp c, MXF_FALL
    dec hl
    ld (hl), a
    jr MXF_BK
MXF_FW0:
    ld a, (MX_P)
    ld c, a
MXF_FW:
    inc c
    ld a, c
    cp 3
    jr nc, MXF_LINES
    ld hl, MX_YC
    call MX_IDX
    dec hl
    ld a, (hl)
    add a, 12
    jp c, MXF_FALL
    ld b, a                     ; B = the least line this row may have
    inc hl
    push hl
    ld hl, MX_N
    call MX_IDX
    ld a, (hl)
    or a
    jr z, MXF_FWM
    ld hl, MX_YR
    call MX_IDX
    ld a, (hl)
    pop hl
    cp b
    jp c, MXF_FALL              ; rows closer than 12 lines
    ld (hl), a
    jr MXF_FW
MXF_FWM:
    pop hl
    ld (hl), b
    jr MXF_FW
MXF_LINES:                      ; handler lines: 6 lines below each row's top
    ld hl, MX_YC
    ld de, MX_NEWL
    ld b, 3
MXF_LN:
    ld a, (hl)
    add a, 6
    jp c, MXF_FALL
    cp 196                      ; the legs handler (14 lines on, 25 lines long)
    jp nc, MXF_FALL             ; must end before the frame entry (243)
    ld (de), a
    inc hl
    inc de
    djnz MXF_LN
    add a, 14                   ; the fourth line: the legs
    ld (de), a
    ld a, 1
    ld (MX_LV), a
    ; the legs of the aliens' frame: the handler at the fourth line puts them
    ; into the six sprites once the formation has gone by
    ld a, (MX_FR)
    cp 2
    jr nc, MXF_OK
    ld hl, MX_SHOWN
    cp (hl)
    jr z, MXF_OK
    ld (MX_LEGN), a
MXF_OK:
    call MXF_HIDE
    ld a, 1
    ld (MX_OK), a
    ret
MXF_ERR:
    pop hl
    pop bc
MXF_FALL:
    xor a
    ld (MX_N), a
    ld (MX_N+1), a
    ld (MX_N+2), a
    ld (MX_LV), a
    ld (MX_OK), a
    call MXF_HIDE
    ; the software fallback: every logged sprite through the engine's
    ; PlatSprite (SF_SPRITE), IX pointing at a made-up frame
    push ix
    ld ix, MX_FK
    ld hl, MX_LOG
    ld a, (MX_NL)
    ld b, a
    or a
    jr z, MXF_SX
MXF_SL:
    ld a, (hl)
    ld (ix+5), a
    inc hl
    ld a, (hl)
    ld (ix+7), a
    inc hl
    ld a, (hl)
    ld (ix+9), a
    inc hl
    ld a, (hl)
    ld (ix+11), a
    inc hl
    push hl
    push bc
    call SF_SPRITE
    pop bc
    pop hl
    djnz MXF_SL
MXF_SX:
    pop ix
    xor a
    ret

; MXF_HIDE: the shadow tables' unused sprites (n .. 5 of each row) hidden,
; Y = -128 (the ASIC's range is -256..255; a 16-line sprite there is above the
; screen)
MXF_HIDE:
    ld c, 0
MXH_ROW:
    ld hl, MX_N
    call MX_IDX
    ld a, (hl)
    ld b, a                     ; B = n
    ld a, 6
    sub b
    jr z, MXH_NEXT              ; the row is full
    ld e, a                     ; E = sprites to hide
    ld a, b
    add a, a
    add a, a
    ld b, a                     ; B = 4 n
    ld hl, MX_ROFF
    call MX_IDX
    ld a, (hl)
    add a, b
    add a, 2                    ; the Y bytes
    ld hl, (MX_SHDP)
    add a, l
    ld l, a
    jr nc, MXH_1
    inc h
MXH_1:
MXH_L:
    ld (hl), $80
    inc hl
    ld (hl), $FF
    inc hl
    inc hl
    inc hl
    dec e
    jr nz, MXH_L
MXH_NEXT:
    inc c
    ld a, c
    cp 3
    jr c, MXH_ROW
    ret

; MX_ROW: HL = a row table. Writes its sprites' X and Y and the row's two colours
; to the ASIC. Interrupts must be off (a raster handler, or DI around the call).
; About 700 T-states.
MX_ROW:
    call .core.PlusHandlerIn
    ld de, $6050                ; sprite 10's X
    ld bc, $4000
    ldi
    ldi
    ldi
    ldi
    ld a, e
    add a, 4
    ld e, a
    ldi
    ldi
    ldi
    ldi
    ld a, e
    add a, 4
    ld e, a
    ldi
    ldi
    ldi
    ldi
    ld a, e
    add a, 4
    ld e, a
    ldi
    ldi
    ldi
    ldi
    ld a, e
    add a, 4
    ld e, a
    ldi
    ldi
    ldi
    ldi
    ld a, e
    add a, 4
    ld e, a
    ldi
    ldi
    ldi
    ldi
    ld de, $6436                ; sprite colour 11 (palette entry 27): the body
    ldi
    ldi
    ld de, $6434                ; colour 10 (entry 26): the light body
    ldi
    ldi
#ifdef MX_TEST
    call MX_TLOGROW
#endif
    jp .core.PlusHandlerOut

MX_H1:
    ld hl, (MX_ACTP)
    ld de, MX_ROWSZ
    add hl, de
#ifdef MX_TEST
    ld a, 1
    ld (MX_TROW), a
#endif
    jp MX_ROW
MX_H2:
    ld hl, (MX_ACTP)
    ld de, MX_ROWSZ * 2
    add hl, de
#ifdef MX_TEST
    ld a, 2
    ld (MX_TROW), a
#endif
    jp MX_ROW
MX_H3:
    ld hl, (MX_ACTP)
#ifdef MX_TEST
    ld a, 3
    ld (MX_TROW), a
#endif
    jp MX_ROW

; MX_H4: the legs of the aliens' second frame differ in lines 5-7 of the picture
; only; when the frame changes, those 48 bytes of each of the six sprites are
; rewritten here, after the last row has been drawn (the six are above the
; screen's formation until the next frame) and long before the next frame's
; first row. About 6500 T-states, interrupts off.
MX_H4:
    ld a, (MX_LEGN)
    cp 2
    ret nc
    ld (MX_SHOWN), a
    ld hl, MX_LEGS
    or a
    jr z, MXH4_1
    ld de, 48
    add hl, de
MXH4_1:
    ld a, 255
    ld (MX_LEGN), a
    call .core.PlusHandlerIn
    ld de, $4A50                ; sprite 10, line 5
    push hl
    ld bc, 48
    ldir
    pop hl
    ld a, e
    sub 48
    ld e, a
    inc d
    push hl
    ld bc, 48
    ldir
    pop hl
    ld a, e
    sub 48
    ld e, a
    inc d
    push hl
    ld bc, 48
    ldir
    pop hl
    ld a, e
    sub 48
    ld e, a
    inc d
    push hl
    ld bc, 48
    ldir
    pop hl
    ld a, e
    sub 48
    ld e, a
    inc d
    push hl
    ld bc, 48
    ldir
    pop hl
    ld a, e
    sub 48
    ld e, a
    inc d
    ld bc, 48
    ldir
#ifdef MX_TEST
    ld hl, MX_T4
    inc (hl)
#endif
    jp .core.PlusHandlerOut
#ifdef MX_TEST
MX_T4:      defb 0
#endif

; MX_UNPACK: HL = packed pixels (two a byte, left one high), DE = destination
; (a pixel a byte), BC = packed bytes
MX_UNPACK:
    ld a, (hl)
    rrca
    rrca
    rrca
    rrca
    and 15
    ld (de), a
    inc de
    ld a, (hl)
    inc hl
    and 15
    ld (de), a
    inc de
    dec bc
    ld a, b
    or c
    jr nz, MX_UNPACK
    ret

; HW_LOAD: A = picture (of the unpacked table), C = sprite: its pixels to the ASIC
; (128 bytes for the pictures that use the top half only, 0-4 and 8-9, 256 for the
; explosions). Interrupts are on at the call. About 0.7 / 1.4 ms with them off.
HW_LOAD:
    ld l, 0
    ld h, a
    ld de, (HW_PIXP)
    add hl, de                  ; HL = the picture's pixels
    ld de, 128
    cp 5
    jr c, HWL_1
    cp 8
    jr nc, HWL_1
    ld de, 256
HWL_1:
    ld (HW_LC), de
    ld a, c
    add a, $40
    ld d, a
    ld e, 0                     ; DE = the sprite's pixels in the ASIC
    di
    call .core.PlusHandlerIn
    ld bc, (HW_LC)
    ldir
    call .core.PlusHandlerOut
    ei
    ret

; MX_PRELOAD: every non-formation slot gets its first picture (the ship, the diver's
; first frame, the bullets, the bombs, the explosion's first frame) at start, so that
; a picture is only loaded when a frame changes, never the first time an object appears
MX_PRE:     defb 0, 1, 3, 3, 4, 4, 4, 5, 5, 5
MX_PRELOAD:
    ld b, 0
MXP_L:
    push bc
    ld hl, MX_PRE
    ld d, 0
    ld e, b
    add hl, de
    ld a, (hl)
    ld hl, HW_IMG
    add hl, de
    ld (hl), a                  ; HW_IMG: the layer knows the slot's picture
    ld c, b
    call HW_LOAD
    pop bc
    inc b
    ld a, b
    cp 10
    jr c, MXP_L
    ret

; HW_PICS: the pending pictures (HW_NP, HW_PS, HW_PI), the last queued first, at
; most 2 a frame: a raster handler must not wait behind a long window. What is left
; stays queued for the next frame.
HW_PICS:
    ld b, 2
HWP_L:
    ld a, (HW_NP)
    or a
    ret z
    dec a
    ld (HW_NP), a
    ld e, a
    ld d, 0
    ld hl, HW_PS
    add hl, de
    ld c, (hl)
    ld hl, HW_PI
    add hl, de
    ld a, (hl)
    push bc
    call HW_LOAD
    pop bc
    djnz HWP_L
    ret

; HW_PUSH: the sprite registers of slots 0-9 (the table at HW_REGP) in one window
HW_PUSH:
    ld hl, (HW_REGP)
    di
    call .core.PlusHandlerIn
    ld de, $6000
    ld bc, HW_NSL * 8
    ldir
    call .core.PlusHandlerOut
    ei
    ret

; MX_RELINE: the formation stepped down: the four handler lines move in the raster
; table in place (library state: RI_N, RI_IDX, RI_LINE, see plusraster.asm), which
; RasterIntAt/Off do in about 1.2 ms a pair. Only valid while the table is ours
; (4 lines + the frame entry) and the next line to fire is its first, that is in
; the vertical blank after the frame entry, where the commit step is. Returns A = 1
; when done, 0 when the caller must use RasterIntAt/Off.
MX_RELINE:
    ld a, (MX_ACTL)
    or a
    jr z, MXR_NO
    di
    ld a, (.core.RI_N)
    cp 5
    jr nz, MXR_EI
    ld a, (.core.RI_IDX)
    or a
    jr nz, MXR_EI
    ld hl, MX_NEWL
    ld de, .core.RI_LINE
    ld bc, 4
    ldir
    ld hl, MX_NEWL
    ld de, MX_ACTL
    ld bc, 4
    ldir
    call .core.__RI_PRIIDX      ; PRI = the first line
    ei
    ld a, 1
    ret
MXR_EI:
    ei
MXR_NO:
    xor a
    ret

; MX_COMMIT: right after a frame tick: the shadow tables become the active ones
; and the top row goes to the ASIC at once (the handlers do it for the frames
; in between).
MX_COMMIT:
    di
    ld hl, (MX_SHDP)
    ld de, (MX_ACTP)
    ld (MX_ACTP), hl
    ld (MX_SHDP), de
#ifdef MX_TEST
    xor a
    ld (MX_TROW), a
    ld (MX_DONE), a
#endif
    call MX_ROW
    ei
    ret

; MX_HIDEALL: the active tables show nothing (a screen is being replaced)
MX_HIDEALL:
    di
    ld hl, (MX_ACTP)
    ld b, 18
MXA_L:
    inc hl
    inc hl
    ld (hl), $80
    inc hl
    ld (hl), $FF
    inc hl
    ld a, b
    cp 13
    jr z, MXA_SK
    cp 7
    jr nz, MXA_N
MXA_SK:
    inc hl
    inc hl
    inc hl
    inc hl                      ; the row's colours
MXA_N:
    djnz MXA_L
    ld hl, (MX_ACTP)
#ifdef MX_TEST
    xor a
    ld (MX_TROW), a
#endif
    call MX_ROW
    ei
    ret

#ifdef MX_TEST
; The test hooks: every call of MX_ROW appends 30 bytes to MX_TLOG (at most 64):
; the row number (0 = the commit's own call), MX_DONE (1 once the frame's commit
; work has finished), the 24 bytes of X and Y read back from the ASIC and the
; 4 colour bytes (body, light) read back.
MX_TLOGROW:
    ld a, (MX_TROW)
    or a
    jr z, MXT_LOG               ; the commit's own call
    ld hl, MX_HCNT
    inc (hl)
    ld c, a
    ld a, (MX_TPREV)            ; the handlers must come as 1, 2, 3, 1, 2, 3
    cp 3
    jr nz, MXT_P1
    xor a
MXT_P1:
    inc a
    cp c
    jr z, MXT_P2
    ld hl, MX_VIOL
    inc (hl)
MXT_P2:
    ld a, c
    ld (MX_TPREV), a
    cp 1
    jr nz, MXT_LOG
    ld a, (MX_DONE)             ; row 1 comes first after the commit: its work must be done
    or a
    jr nz, MXT_LOG
    ld hl, MX_LATE
    inc (hl)
MXT_LOG:
    ld a, (MX_TCNT)
    cp 64
    ret nc
    inc a
    ld (MX_TCNT), a
    ld de, (MX_TPTR)
    ld a, (MX_TROW)
    ld (de), a
    inc de
    ld a, (MX_DONE)
    ld (de), a
    inc de
    ld hl, $6050
    ld bc, $4000
    ld a, 6
MXT_L:
    ldi
    ldi
    ldi
    ldi
    inc hl
    inc hl
    inc hl
    inc hl
    dec a
    jr nz, MXT_L
    ld hl, $6436
    ldi
    ldi
    ld hl, $6434
    ldi
    ldi
    ld (MX_TPTR), de
    ret
MX_TROW:    defb 0
MX_TPREV:   defb 3
MX_HCNT:    defb 0              ; handler calls (rows 1-3)
MX_VIOL:    defb 0              ; handlers out of order
MX_LATE:    defb 0              ; row 1 handler reached before the commit work was finished
MX_DONE:    defb 0
MX_TCNT:    defb 0
MX_TPTR:    defw MX_TLOG
MX_TLOG:    defs 30 * 64
#endif

; ---- data ----
MX_NL:      defb 0              ; formation calls logged this frame
MX_BAD:     defb 0
MX_OK:      defb 0
MX_FR:      defb 255            ; the aliens' picture this frame (255 = none)
MX_P:       defb 0
MX_LV:      defb 0              ; MX_NEWL holds the lines of this frame's rows
MX_ACTP:    defw MX_BUF
MX_SHDP:    defw MX_BUF + 3 * MX_ROWSZ
MX_HTAB:    defw MX_H1, MX_H2, MX_H3, MX_H4
    ALIGN 4
MX_N:       defs 4              ; aliens per row
MX_YR:      defs 4              ; each row's sprite line (from the calls)
MX_YC:      defs 4              ; each row's line, estimated for an empty row
MX_NEWL:    defs 4              ; handler lines: row 1, row 2, the top row again, the legs
MX_ACTL:    defs 4              ; those the raster table has now
MX_ROFF:    defb 0, MX_ROWSZ, 2 * MX_ROWSZ, 0
MX_LOG:     defs 96             ; kind, frame, x, y of each call
MX_FK:      defs 12
MX_SHOWN:   defb 0              ; the aliens' frame whose legs the sprites hold
MX_LEGN:    defb 255            ; a frame whose legs the legs handler must load (255: none)
MX_LEGS:    defs 96             ; lines 5-7 of both alien frames, a pixel a byte
HW_PIXP:    defw 0              ; the pictures, unpacked: 256 bytes each
HW_LC:      defw 0
MX_BUF:
    defs 24
    defb $EE, $03, $FF, $09     ; row 0 (top, 30 points): magenta
    defs 24
    defb $F4, $03, $F9, $09     ; row 1: red
    defs 24
    defb $34, $0E, $99, $0F     ; row 2 (bottom): green
    defs 24
    defb $EE, $03, $FF, $09
    defs 24
    defb $F4, $03, $F9, $09
    defs 24
    defb $34, $0E, $99, $0F

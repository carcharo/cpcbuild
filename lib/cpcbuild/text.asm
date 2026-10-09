; -----------------------------------------------------------------------
; cpcbuild library -- text from a compact 1-bit font, drawn in character
; cells straight into screen memory
;
; Written from scratch for this project (MIT); see core.asm. The glyph
; drawer follows the idea of Starfall's (games/shooter/platform_cpc.bas):
; a precomputed table of screen bytes turns the font's bits into pen
; pixels without a per-pixel loop.
;
; Font: one byte per pixel row, TX_ROWS bytes a glyph (1-8), glyphs from
; character code TX_FIRST up to TX_FIRST + TX_SPAN; bit 7 is the leftmost
; pixel. A cell is 8 x 8 pixels: 4 bytes x 8 lines in mode 0, 2 x 8 in
; mode 1; the glyph starts at the top, the lines below its rows are paper.
;
; The speed trick: a 32-byte table (at TX_TP) holds, for each 4-pixel
; nibble of a font byte (16 values), the screen bytes of that nibble in
; the current ink and paper -- two bytes in mode 0 (2 pixels each), one
; in mode 1. A row of the glyph is then two table lookups, whatever the
; pens. The table is indexed by 2 * nibble, so the index is built with
; AND and ADD, and the second byte of a nibble is an INC E away. It sits
; in the 64-byte buffer TX_TBUF, at the start or 32 bytes on, so that it
; doesn't cross a 256-byte boundary (INC E and the ADD can't carry); its
; low address byte is patched into the ADDs (self-modifying: the program
; is in RAM) by __TX_BUILD.
;
; Wrap: with a hardware-scroll offset (core.asm) a mode 0 cell (4 bytes)
; can cross the end of its 2 KB block, or its low address byte can carry
; (the offset is always even, so cells start on even addresses; mode 1
; cells, 2 bytes, never cross). The cell address is checked once per
; glyph run: when L >= &FD the slow, wrap-safe row loop is used.
;
; The queue (TextAtBoth / TextFlush) is in text.bas, with its code and data
; (the size, TEXT_QUEUE, is a BASIC #define): entries are col, row,
; length, pens (ink | paper << 4), then the characters.
;
; Each routine reads its parameters from the calling sub's IX frame where
; it says so: col = (ix+5), row = (ix+7), string = (ix+8) (16-bit).

#include once <cpcbuild/core.asm>

    push namespace core

; Library state (initial values are in the program image, no init code).
TX_FONT:    defw 0          ; font address
TX_FIRST:   defb 0          ; first character code in the font
TX_SPAN:    defb 0          ; last - first (the last glyph's index)
TX_ROWS:    defb 0          ; rows a glyph (0 = no font: everything blank)
TX_INK:     defb 1          ; pens (TX_INK and TX_PAPER stay adjacent)
TX_PAPER:   defb 0
TX_TMODE:   defb 0          ; GFX_XSHIFT the table was built for (0 = none)
TX_W:       defb 4          ; cell width in bytes for that mode
TX_PR:      defs 4          ; build: mode 0 byte for each pixel-pair state
TX_PB:      defb 0          ; the screen byte of a pixel run in the paper pen
TX_TP:      defw 0          ; the table's address (in TX_TBUF)
TX_TBUF:    defs 64

; -----------------------------------------------------------------------
; __TX_BUILD -- builds the table (TX_TP) for TX_INK / TX_PAPER in the current mode
; (GFX_XSHIFT: 2 = mode 0, 1 = mode 1) and notes the mode in TX_TMODE.
; Mode 0: table[2n], table[2n+1] = the two bytes of nibble n (pairs of
; pixels, left pixel in bits 7,5,3,1). Mode 1: table[2n] = the byte of
; nibble n. Entry n has each pixel in the ink if its bit is 1, else in
; the paper.
; Firmware entry called: none.
; Registers clobbered: AF, BC, DE, HL.
__TX_BUILD:
    PROC
    LOCAL __TXB_T, __TXB_W, __TXB_M0, __TXB_M1, __TXB_L0, __TXB_L1, __TXB_P0, __TXB_GP

    ld   hl, TX_TBUF        ; the table: no 256-byte boundary inside it
    ld   a, l
    cp   225
    jr   c, __TXB_T
    ld   de, 32
    add  hl, de
__TXB_T:
    ld   (TX_TP), hl
    ld   a, l
    ld   (__TXR_A1 + 1), a  ; patch the table's low byte into the row loops
    ld   (__TXR_A2 + 1), a
    ld   (__TXR_A3 + 1), a
    ld   (__TXR_A4 + 1), a
    ld   (__TXR_A5 + 1), a
    ld   (__TXR_A6 + 1), a
    ld   a, (GFX_XSHIFT)
    ld   (TX_TMODE), a
    ld   b, 4
    cp   2
    jr   nc, __TXB_W
    ld   b, 2
__TXB_W:
    ld   a, b
    ld   (TX_W), a
    ld   a, (TX_INK)
    call __TXB_PEN
    ld   c, a               ; C = ink byte
    ld   a, (TX_PAPER)
    call __TXB_PEN
    ld   d, a               ; D = paper byte
    ld   (TX_PB), a
    xor  c
    ld   c, a               ; C = ink XOR paper: the bits that differ
    ld   a, (TX_TMODE)
    cp   2
    jr   c, __TXB_M1

; Mode 0: first the four pair states (left, right pixel: paper/paper,
; paper/ink, ink/paper, ink/ink) = paper XOR (diff AND mask).
__TXB_M0:
    ld   hl, TX_PR
    ld   b, 4
    ld   e, 0               ; E = the mask: 0, $55, $AA, $FF
__TXB_P0:
    ld   a, e
    and  c
    xor  d
    ld   (hl), a
    inc  hl
    ld   a, e
    add  a, $55
    ld   e, a
    djnz __TXB_P0
; then nibble n -> pair state n >> 2, pair state n & 3
    ld   hl, (TX_TP)
    ld   b, 0
__TXB_L0:
    ld   a, b
    rrca
    rrca
    and  3
    call __TXB_GP
    ld   (hl), a
    inc  hl
    ld   a, b
    and  3
    call __TXB_GP
    ld   (hl), a
    inc  hl
    inc  b
    ld   a, b
    cp   16
    jr   nz, __TXB_L0
    ret

; A = pair state -> A = its byte (clobbers DE)
__TXB_GP:
    push hl
    ld   e, a
    ld   d, 0
    ld   hl, TX_PR
    add  hl, de
    ld   a, (hl)
    pop  hl
    ret

; Mode 1: nibble n has pixel j (0 = left) in bit 3-j, and pixel j's bits
; in the byte are mask $88 >> j, so the mask of nibble n is n | n << 4.
__TXB_M1:
    ld   hl, (TX_TP)
    ld   b, 0
__TXB_L1:
    ld   a, b
    rlca
    rlca
    rlca
    rlca
    or   b
    and  c
    xor  d
    ld   (hl), a
    inc  hl
    inc  hl
    inc  b
    ld   a, b
    cp   16
    jr   nz, __TXB_L1
    ret

    ENDP

; __TXB_PEN -- A = pen -> A = the screen byte with all its pixels in that
; pen, for the current mode (the pen is masked to 0-15 / 0-3; the same
; bytes as fill.asm's __CB_PENBYTE, which this file doesn't pull in).
; Firmware entry called: none. Registers clobbered: AF, DE, HL.
__TXB_PEN:
    PROC
    LOCAL __TXN_0, __TXN_GO

    ld   e, a
    ld   a, (GFX_XSHIFT)
    cp   2
    jr   nc, __TXN_0
    ld   a, e
    and  $03
    ld   hl, __TXN_T1
    jr   __TXN_GO
__TXN_0:
    ld   a, e
    and  $0F
    ld   hl, __TXN_T0
__TXN_GO:
    ld   e, a
    ld   d, 0
    add  hl, de
    ld   a, (hl)
    ret
__TXN_T0:
    DEFB $00, $C0, $0C, $CC, $30, $F0, $3C, $FC
    DEFB $03, $C3, $0F, $CF, $33, $F3, $3F, $FF
__TXN_T1:
    DEFB $00, $F0, $0F, $FF
    ENDP

; -----------------------------------------------------------------------
; __TX_PENS -- A = ink | paper << 4: makes those the pens, rebuilding the
; table only if they differ from the current ones.
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__TX_PENS:
    ld   b, a
    and  $0F
    ld   hl, TX_INK
    cp   (hl)
    jr   nz, __TXP_SET
    ld   a, b
    rrca
    rrca
    rrca
    rrca
    and  $0F
    inc  hl
    cp   (hl)
    ret  z
__TXP_SET:
    ld   a, b
    and  $0F
    ld   (TX_INK), a
    ld   a, b
    rrca
    rrca
    rrca
    rrca
    and  $0F
    ld   (TX_PAPER), a
    jp   __TX_BUILD

; -----------------------------------------------------------------------
; __TX_FONT -- TextFont. addr = (ix+4) (16-bit), first = (ix+7),
; rows = (ix+9), last = (ix+11).
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__TX_FONT:
    ld   l, (ix+4)
    ld   h, (ix+5)
    ld   (TX_FONT), hl
    ld   a, (ix+7)
    ld   (TX_FIRST), a
    ld   b, a
    ld   a, (ix+11)
    sub  b
    jr   nc, __TXF_SPAN
    xor  a                  ; last < first: one glyph
__TXF_SPAN:
    ld   (TX_SPAN), a
    ld   a, (ix+9)
    cp   9
    jr   c, __TXF_ROWS
    ld   a, 8
__TXF_ROWS:
    ld   (TX_ROWS), a
    ret

; __TX_PEN -- TextPen. ink = (ix+5), paper = (ix+7).
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__TX_PEN:
    ld   a, (ix+5)
    and  $0F
    ld   (TX_INK), a
    ld   a, (ix+7)
    and  $0F
    ld   (TX_PAPER), a
    jp   __TX_BUILD

; -----------------------------------------------------------------------
; __TX_RUN -- draws B lines of the font rows at IY on the cell at HL
; (HL = the cell's address on line 0 of a text row, or on the line to
; continue from). Returns HL = the same x on the line after the last one
; drawn (H + 8 per line; the caller keeps within the 8 lines of the cell).
; Needs the table built for the mode (TX_TMODE).
; Firmware entry called: none.
; Registers clobbered: AF, BC, DE, HL, IY.
__TX_RUN:
    PROC
    LOCAL __TXR_R0, __TXR_R1, __TXR_S0

    ld   de, (TX_TP)
    ld   a, (TX_TMODE)
    cp   2
    jr   c, __TXR_R1
    ld   a, l
    cp   $FD
    jr   nc, __TXR_S0       ; the cell may wrap: the careful loop

; Mode 0, fast: 4 bytes a line with INC L (L < &FD, so no carry).
__TXR_R0:
    ld   a, (iy+0)
    inc  iy
    ld   c, a
    rrca
    rrca
    rrca
    and  $1E
__TXR_A1: add  a, 0
    ld   e, a
    ld   a, (de)
    ld   (hl), a
    inc  l
    inc  e
    ld   a, (de)
    ld   (hl), a
    inc  l
    ld   a, c
    add  a, a
    and  $1E
__TXR_A2: add  a, 0
    ld   e, a
    ld   a, (de)
    ld   (hl), a
    inc  l
    inc  e
    ld   a, (de)
    ld   (hl), a
    dec  l
    dec  l
    dec  l
    ld   a, h
    add  a, 8
    ld   h, a
    djnz __TXR_R0
    ret

; Mode 1: 2 bytes a line (the cell never crosses a 256 or 2 KB boundary).
__TXR_R1:
    ld   a, (iy+0)
    inc  iy
    ld   c, a
    rrca
    rrca
    rrca
    and  $1E
__TXR_A3: add  a, 0
    ld   e, a
    ld   a, (de)
    ld   (hl), a
    inc  l
    ld   a, c
    add  a, a
    and  $1E
__TXR_A4: add  a, 0
    ld   e, a
    ld   a, (de)
    ld   (hl), a
    dec  l
    ld   a, h
    add  a, 8
    ld   h, a
    djnz __TXR_R1
    ret

; Mode 0, wrap-safe: each byte steps with __CB_INC_X; the line start is
; kept on the stack.
__TXR_S0:
    push hl
    ld   a, (iy+0)
    inc  iy
    ld   c, a
    rrca
    rrca
    rrca
    and  $1E
__TXR_A5: add  a, 0
    ld   e, a
    ld   a, (de)
    ld   (hl), a
    call __CB_INC_X
    inc  e
    ld   a, (de)
    ld   (hl), a
    call __CB_INC_X
    ld   a, c
    add  a, a
    and  $1E
__TXR_A6: add  a, 0
    ld   e, a
    ld   a, (de)
    ld   (hl), a
    call __CB_INC_X
    inc  e
    ld   a, (de)
    ld   (hl), a
    pop  hl
    ld   a, h
    add  a, 8
    ld   h, a
    djnz __TXR_S0
    ret
    ENDP

; -----------------------------------------------------------------------
; __TX_PAD -- fills B lines of the cell at HL with paper (TX_PB), the
; same line stepping as __TX_RUN: returns HL = the line after the last.
; Firmware entry called: none. Registers clobbered: AF, B, C, HL.
__TX_PAD:
    PROC
    LOCAL __TXD_0, __TXD_1, __TXD_S

    ld   a, (TX_PB)
    ld   c, a
    ld   a, (TX_TMODE)
    cp   2
    jr   c, __TXD_1
    ld   a, l
    cp   $FD
    jr   nc, __TXD_S
__TXD_0:
    ld   (hl), c
    inc  l
    ld   (hl), c
    inc  l
    ld   (hl), c
    inc  l
    ld   (hl), c
    dec  l
    dec  l
    dec  l
    ld   a, h
    add  a, 8
    ld   h, a
    djnz __TXD_0
    ret
__TXD_1:
    ld   (hl), c
    inc  l
    ld   (hl), c
    dec  l
    ld   a, h
    add  a, 8
    ld   h, a
    djnz __TXD_1
    ret
__TXD_S:
    push hl
    ld   (hl), c
    call __CB_INC_X
    ld   (hl), c
    call __CB_INC_X
    ld   (hl), c
    call __CB_INC_X
    ld   (hl), c
    pop  hl
    ld   a, h
    add  a, 8
    ld   h, a
    djnz __TXD_S
    ret
    ENDP

; -----------------------------------------------------------------------
; __TX_GLYPH -- draws character A in the cell at HL (line 0 of the cell):
; its glyph if the font has one, else paper; the lines below the glyph's
; rows are paper.
; Firmware entry called: none.
; Registers clobbered: AF, BC, DE, HL, IY.
__TX_GLYPH:
    PROC
    LOCAL __TXG_BLANK, __TXG_MUL

    push hl
    ld   hl, TX_FIRST
    sub  (hl)               ; A = index into the font
    jr   c, __TXG_BLANK
    ld   c, a
    ld   a, (TX_SPAN)
    cp   c
    jr   c, __TXG_BLANK     ; past the last glyph
    ld   a, (TX_ROWS)
    or   a
    jr   z, __TXG_BLANK     ; no font
    ld   b, a
    ld   e, c
    ld   d, 0
    ld   hl, 0
__TXG_MUL:
    add  hl, de             ; HL = index * rows
    djnz __TXG_MUL
    ld   de, (TX_FONT)
    add  hl, de
    push hl
    pop  iy
    ld   a, (TX_ROWS)
    ld   b, a
    pop  hl
    call __TX_RUN           ; the glyph's rows
    ld   a, (TX_ROWS)
    ld   b, a
    ld   a, 8
    sub  b
    ret  z
    ld   b, a
    jp   __TX_PAD           ; paper below
__TXG_BLANK:
    pop  hl
    ld   b, 8
    jp   __TX_PAD
    ENDP

; -----------------------------------------------------------------------
; __TX_PUTS -- draws a string. C = column, A = row, DE = characters,
; B = length. Cut off at the right edge; nothing in mode 2 or off the
; bottom. Rebuilds the table first if the mode changed since it was built.
; Firmware entry called: none.
; Registers clobbered: AF, BC, DE, HL (IY is preserved).
__TX_PUTS:
    PROC
    LOCAL __TXS_END, __TXS_C40, __TXS_LEN, __TXS_SH, __TXS_LP, __TXS_NC

    cp   25
    ret  nc
    push iy
    ld   h, a               ; H = row
    ld   a, (GFX_XSHIFT)
    or   a
    jr   z, __TXS_END       ; mode 2: not supported
    ld   l, a               ; L = shift (bytes per cell = 1 << L)
    ld   a, 40
    bit  1, l
    jr   z, __TXS_C40
    ld   a, 20
__TXS_C40:
    sub  c                  ; A = columns left from this one
    jr   z, __TXS_END
    jr   c, __TXS_END
    cp   b
    jr   nc, __TXS_LEN
    ld   b, a               ; cut off at the right edge
__TXS_LEN:
    ld   a, b
    or   a
    jr   z, __TXS_END
    ld   a, (TX_TMODE)
    cp   l
    jr   z, __TXS_SH
    push hl
    push de
    push bc
    call __TX_BUILD
    pop  bc
    pop  de
    pop  hl
__TXS_SH:
    ld   a, h
    add  a, a
    add  a, a
    add  a, a
    push bc                 ; B = length
    ld   b, a               ; B = line
    ld   a, l
__TXS_SHL:
    sla  c
    dec  a
    jr   nz, __TXS_SHL      ; C = byte column
    push de
    call __CB_ADDR          ; HL = the cell
    pop  de
    pop  bc                 ; B = length
__TXS_LP:
    ld   a, (de)
    inc  de
    push de
    push bc
    push hl
    call __TX_GLYPH
    pop  hl
    ld   a, (TX_W)
    add  a, l
    ld   l, a
    jr   nc, __TXS_NC
    inc  h                  ; carry into the offset's high bits...
    ld   a, h
    and  $07
    jr   nz, __TXS_NC
    ld   a, h               ; ...which wrapped the 2 KB block
    sub  8
    ld   h, a
__TXS_NC:
    pop  bc
    pop  de
    djnz __TXS_LP
__TXS_END:
    pop  iy
    ret
    ENDP

; -----------------------------------------------------------------------
; __TX_AT -- TextAt: col = (ix+5), row = (ix+7), string = (ix+8).
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__TX_AT:
    ld   l, (ix+8)
    ld   h, (ix+9)
    ld   a, h
    or   l
    ret  z                  ; null string
    ld   c, (hl)
    inc  hl
    ld   b, (hl)
    inc  hl
    ld   a, b
    or   a
    ret  nz                 ; longer than 255: ignored
    ex   de, hl
    ld   b, c               ; B = length
    ld   c, (ix+5)          ; C = column
    ld   a, (ix+7)          ; A = row
    jp   __TX_PUTS

    pop namespace

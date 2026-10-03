; -----------------------------------------------------------------------
; cpcbuild library -- keyboard matrix scan
;
; Written from scratch for this project (MIT); see core.asm. From the
; public documentation of the 8255 PPI, the AY-3-8912's I/O port and the
; keyboard matrix (cpcwiki.eu, CPC Firmware Guide); no library code.
;
; The CPC keyboard is a matrix of 10 rows x 8 columns, read through the
; AY-3-8912: PPI port C bits 0-3 pick the row, bits 6-7 are the AY's
; BDIR (bit 7) and BC1 (bit 6) lines (&C0 = select register, &40 =
; read it), and the AY's port A (register 14) returns the 8 column bits,
; 0 = pressed. Row 9 is joystick 0 (and DEL). A firmware key
; number is row * 8 + bit.
;
; CB_KEYS (at the end of this file) holds the last scan, one byte per row,
; as read (bit = 0: pressed). It is the library's own storage, in the
; program image.

    push namespace core

; __CB_SCAN_KEYS -- reads the 10 rows into CB_KEYS, straight from the
; hardware, with interrupts off so the firmware's own keyboard scan (in
; its interrupt handler) cannot interleave with this one; returns with
; interrupts on.
;
; Afterwards the PPI is as the firmware leaves it: control word &82
; (port A output, B input, C output), port C = the cassette bits it had
; before (bits 4-5: motor and write data) with the AY lines (bits 6-7)
; and row bits (0-3) inactive, AY register 14 selected (the register
; the firmware's own scan selects too). Writing the PPI control word
; clears its output latches, so the cassette bits are put back at once;
; the motor is off for a few microseconds only if it was on.
; Firmware entries called: none.
; Registers clobbered: AF, BC, DE, HL.
__CB_SCAN_KEYS:
    PROC
    LOCAL __CSK_LOOP

    di
    ld   b, $F6
    in   a, (c)             ; port C: keep the cassette bits (4, 5)
    and  $30
    ld   d, a
    ld   bc, $F40E
    out  (c), c             ; port A = 14 (AY register number)
    ld   b, $F6
    or   $C0
    out  (c), a             ; AY: select register
    out  (c), d             ; AY: inactive
    ld   bc, $F792
    out  (c), c             ; port A becomes an input
    ld   a, d
    or   $40                ; BC1 only = read; low nibble = row 0
    ld   e, a
    ld   hl, CB_KEYS
__CSK_LOOP:
    ld   b, $F6
    out  (c), e             ; select the row, AY: read
    ld   b, $F4
    in   a, (c)
    ld   (hl), a
    inc  hl
    inc  e
    ld   a, e
    and  $0F
    cp   10
    jr   nz, __CSK_LOOP
    ld   bc, $F782
    out  (c), c             ; port A back to output (clears the latches)
    ld   b, $F6
    out  (c), d             ; cassette bits back, AY inactive, row 0
    ei
    ret
    ENDP

; __CB_KEY_DOWN -- A = firmware key number (0-79) -> A = 1 if that key
; was down at the last scan, else 0 (also 0 for numbers above 79).
; Firmware entries called: none.
; Registers clobbered: AF, BC, HL.
__CB_KEY_DOWN:
    PROC
    LOCAL __CKD_SHIFT, __CKD_LOOP, __CKD_TEST, __CKD_NO

    cp   80
    jr   nc, __CKD_NO
    ld   c, a
    and  7
    ld   b, a               ; B = bit number
    ld   a, c
    rrca
    rrca
    rrca
    and  $1F                ; A = row
    ld   hl, CB_KEYS
    add  a, l
    ld   l, a
    jr   nc, __CKD_SHIFT
    inc  h
__CKD_SHIFT:
    ld   a, 1
    inc  b
    jr   __CKD_TEST
__CKD_LOOP:
    add  a, a
__CKD_TEST:
    djnz __CKD_LOOP         ; A = 1 << bit
    and  (hl)
    jr   nz, __CKD_NO       ; bit set = not pressed
    ld   a, 1
    ret
__CKD_NO:
    xor  a
    ret
    ENDP

; __CB_ANY_KEY -- A = 1 if any key was down at the last scan, else 0.
; Firmware entries called: none.
; Registers clobbered: AF, B, HL.
__CB_ANY_KEY:
    PROC
    LOCAL __CAK_LOOP

    ld   hl, CB_KEYS
    ld   b, 10
    ld   a, $FF
__CAK_LOOP:
    and  (hl)
    inc  hl
    djnz __CAK_LOOP
    inc  a                  ; $FF (nothing down) -> 0
    ret  z
    ld   a, 1
    ret
    ENDP

CB_KEYS:    defs 10         ; the last matrix scan, rows 0-9 (bit = 0: pressed)

    pop namespace

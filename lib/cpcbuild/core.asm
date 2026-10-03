; -----------------------------------------------------------------------
; cpcbuild library core -- screen addressing for direct screen writes
;
; Written from scratch for this project (MIT, like Boriel's runtime),
; from public documentation of the CPC's screen layout; no code from
; CPCtelera or other libraries (cpcbuild/docs/notes.md, 2026-10-01).
;
; Library coordinates (notes.md, Q-4c.2): x in BYTES (0-79), y in pixel
; lines (0-199), from the top-left. A byte is 2 pixels in mode 0, 4 in
; mode 1, 8 in mode 2, in every mode 80 bytes per line.
;
; Screen layout: 16 KB at CB_BASE*256 (&C000, or &4000 for the
; double-buffer back screen), as eight 2 KB blocks, one per pixel line
; within a character row: line y is in block (y AND 7), at byte
; (y >> 3) * 80 + x of that block -- plus the hardware-scroll offset
; (below), wrapping within the 2 KB block.
;
; Hardware scroll (Q-4c.3): when the firmware scrolls text it moves the
; CRTC's start address rather than copying the screen, so after a
; scroll the top-left byte is at CB_OFFSET (0-&7FE) into each block.
; __CB_SYNC reads it from the firmware (SCR_GET_LOCATION); the library
; calls it in ScreenInit and after every WaitRetrace/FlipBuffer. All
; addresses below include it, and wrap at the end of the 2 KB block.
; Because of the offset, a row of bytes can cross the end of its block
; (it continues at the block's start): __CB_ROW_WRAPS tells a drawing
; routine when to use the careful per-byte path (__CB_INC_X).
;
; The CB_* variables (CB_BASE ... CB_TILESET, at the end of this file; CB_KEYS
; is in keys.asm) are this library's own storage, in the program image, so
; the compiler's private runtime block (sysvars.asm) knows nothing of them.
; Zero when the program loads; CPC_INIT_CB_CORE sets the defaults.

#include once <fwcall.asm>
#include once <sysvars.asm>

#init .core.CPC_INIT_CB_CORE

    push namespace core

; CPC_INIT_CB_CORE -- start-up defaults: draw on and show &C000, no
; scroll offset yet (the bootstrap's SCR_SET_MODE has just reset it).
; Firmware entry called: none. Registers clobbered: AF.
CPC_INIT_CB_CORE:
    ld   a, $C0
    ld   (CB_BASE), a
    ld   (CB_SHOWN), a
    ret

; __CB_SYNC -- reads the firmware's screen base and hardware-scroll
; offset. Outside double buffering, the library draws on the screen the
; firmware shows; with double buffering on, CB_BASE/CB_SHOWN are kept
; by FlipBuffer and only the offset is read.
; Firmware entry called: SCR_GET_LOCATION (&BC0B, -> A = base high
; byte, HL = offset in bytes).
; Registers clobbered: AF, HL (main); BC', DE', HL', AF' (the gate).
__CB_SYNC:
    call .core.__FW_CALL
    defw $BC0B
    ld   (CB_OFFSET), hl
    ld   l, a
    ld   a, (CB_DBUF)
    or   a
    ret  nz
    ld   a, l
    ld   (CB_BASE), a
    ld   (CB_SHOWN), a
    ret

; __CB_ADDR -- B = y (pixel line 0-199), C = x (byte 0-79) -> HL = its
; address on the screen the library draws on. No range check.
; Firmware entry called: none.
; Registers clobbered: AF, DE, HL. B and C are preserved.
__CB_ADDR:
    ld   a, b
    and  $F8                ; 8 * (y >> 3)
    ld   l, a
    ld   h, 0
    add  hl, hl             ; 16 * (y >> 3)
    ld   d, h
    ld   e, l
    add  hl, hl
    add  hl, hl             ; 64 * (y >> 3)
    add  hl, de             ; 80 * (y >> 3)
    ld   e, c
    ld   d, 0
    add  hl, de             ; + x
    ld   de, (CB_OFFSET)
    add  hl, de             ; + scroll offset
    ld   a, h
    and  $07                ; wrap within the 2 KB block
    ld   h, a
    ld   a, b
    and  $07
    add  a, a
    add  a, a
    add  a, a               ; block (y AND 7) * 8 (high byte)
    or   h
    ld   h, a
    ld   a, (CB_BASE)
    or   h
    ld   h, a
    ret

; __CB_NEXT_LINE -- HL = an address on line y -> the same x on line
; y + 1. Line 199 goes on to an address past the bottom of the screen;
; callers clip before that.
; Firmware entry called: none.
; Registers clobbered: AF, HL.
__CB_NEXT_LINE:
    ld   a, h
    add  a, 8               ; next block = next pixel line
    ld   h, a
    and  $38
    ret  nz                 ; same character row
    ld   a, l               ; crossed into the next character row:
    add  a, 80              ; block 0, 80 bytes on, wrapping within it
    ld   l, a
    ld   a, h
    adc  a, 0
    and  $07
    ld   h, a
    ld   a, (CB_BASE)
    or   h
    ld   h, a
    ret

; __CB_INC_X -- HL = HL + 1 within its 2 KB block (the byte after the
; block's last one is its first). The slow path for rows that wrap.
; Firmware entry called: none.
; Registers clobbered: AF, HL.
__CB_INC_X:
    inc  l
    ret  nz
    inc  h
    ld   a, h
    and  $07
    ret  nz
    ld   a, h
    sub  8
    ld   h, a
    ret

; __CB_ROW_WRAPS -- HL = the first byte of a row, C = its width in bytes
; (1-80) -> Carry set if the row crosses the end of its 2 KB block (use
; __CB_INC_X), clear if plain INC HL / LDI work for the whole row.
; Firmware entry called: none.
; Registers clobbered: AF, DE.
__CB_ROW_WRAPS:
    PROC
    LOCAL __CRW_FITS, __CRW_WRAPS

    ld   a, h
    and  $07
    ld   d, a
    ld   a, l
    add  a, c
    ld   e, a
    ld   a, d
    adc  a, 0               ; A:E = position in block + width
    cp   $08
    jr   c, __CRW_FITS      ; < &800
    jr   nz, __CRW_WRAPS
    ld   a, e
    or   a
    jr   z, __CRW_FITS      ; exactly &800: ends on the block's last byte
__CRW_WRAPS:
    scf
    ret
__CRW_FITS:
    or   a
    ret
    ENDP

; Library state. CB_BASE and CB_SHOWN must stay adjacent and in this order
; (FlipBuffer swaps them with one 16-bit load and store).
CB_BASE:    defb 0          ; high byte of the screen the library draws on
CB_SHOWN:   defb 0          ; high byte of the screen being displayed
CB_OFFSET:  defw 0          ; the firmware's hardware-scroll offset, 0-&7FE
CB_DBUF:    defb 0          ; 1 = double buffering on
CB_TILESET: defw 0          ; current tileset address (tiles.asm)

    pop namespace

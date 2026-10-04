; -----------------------------------------------------------------------
; cpcplus library -- soft scroll (SSCR) and split screen (SSSL, SSA)
;
; Written from scratch for this project (MIT); see plus.asm for the ASIC
; page, the unlock and the paged access (__PL_POKE: one byte in a window of
; interrupts off, the code that pages running from the private block, so
; this code may be anywhere). Every routine starts with __PL_ENSURE and
; does nothing, changing nothing, on a CPC without ASIC.
;
; Registers (ASIC page, written through the page; Caprice32 and CPCEC both
; keep them readable):
;   &6801  SSSL  split screen line: 0 = off, 1-255 = the scan line (counted
;          from the first line of the picture, as the raster interrupt's
;          PRI) at which the CRTC switches its start address to SSA
;   &6802  SSA high byte  = what R12 would hold (bits 5-4 the 16 KB page,
;   &6803  SSA low byte   =  bits 1-0 the top of the word offset), low
;          byte what R13 would hold: the same 14-bit "CRTC address" as the
;          screen start (R12/R13), in 2-byte words
;   &6804  SSCR  soft scroll: bits 3-0 horizontal 0-15, bits 6-4 vertical
;          0-7, bit 7 extend the border
;
; SSCR units (Caprice32 crtc.cpp prerender_*_plus, CPCEC cpcec.c: the video
; position adjust is sscr & 15 in 1/16-character steps of the 640-pixel
; line, and crtc_raster = (R9 count << 11) + (sscr << 7)): horizontal in
; mode-2 pixels, 1/640 of the picture width, moving the picture to the
; right (a mode-1 pixel is 2 units, a mode-0 pixel 4 units; byte steps are
; made with the CRTC start address, R12/R13); vertical in scan lines,
; moving the picture up (the first picture line shown is line dy of the
; character row, so the last dy lines come from the next row: leave a spare
; row of data below the picture, as every hardware scroller does). Bit 7
; (extend border) hides the left edge's scroll garbage by widening the left
; border by 16 mode-2 pixels (what the picture lost to the scroll).
;
; The split screen takes the new start address at the start of scan line
; SSSL like a new character row would: the lines that follow continue with
; the same raster (line within the character row), so for a clean split
; give a line that is a multiple of the character height (8 on the CPC's
; standard screen).
;
; State (program image, zero at load): PLUS_SSCR is what the library last
; wrote to SSCR, so the border bit and the scroll can be set separately.
; -----------------------------------------------------------------------

#include once <cpcplus/plus.asm>

    push namespace core

; __PL_SCRVAL -- B = dx (0-15, above is cut to 15), C = dy (0-7, above is
; cut to 7) -> A = the new SSCR value, border bit kept (PLUS_SSCR updated).
; Hardware: none. Registers clobbered: AF, B.
__PL_SCRVAL:
    PROC
    LOCAL __SC_X, __SC_Y
    ld   a, b
    cp   16
    jr   c, __SC_X
    ld   a, 15
__SC_X:
    ld   b, a
    ld   a, c
    cp   8
    jr   c, __SC_Y
    ld   a, 7
__SC_Y:
    add  a, a
    add  a, a
    add  a, a
    add  a, a
    or   b
    ld   b, a
    ld   a, (PLUS_SSCR)
    and  $80
    or   b
    ld   (PLUS_SSCR), a
    ret
    ENDP

; __PL_SCROLL -- ScrollFine: B = dx, C = dy, as __PL_SCRVAL; SSCR &6804
; written (one RMR2 window of about 100 T-states).
; Registers clobbered: AF, BC, DE, HL.
__PL_SCROLL:
    call __PL_ENSURE2       ; keeps BC
    ret  nc
    call __PL_SCRVAL
    ld   hl, $6804
    jp   __PL_POKE

; __PL_SCRBORDER -- A = 0 (border normal) or not (extended): SSCR bit 7,
; keeping the scroll.
; Registers clobbered: AF, BC, DE, HL.
__PL_SCRBORDER:
    PROC
    LOCAL __SB_ON
    ld   d, a
    call __PL_ENSURE2
    ret  nc
    ld   a, (PLUS_SSCR)
    and  $7F
    ld   e, a
    ld   a, d
    or   a
    ld   a, e
    jr   z, __SB_ON
    or   $80
__SB_ON:
    ld   (PLUS_SSCR), a
    ld   hl, $6804
    jp   __PL_POKE
    ENDP

; __PL_SPLIT -- A = line (0 turns the split off; HL is not used then),
; HL = the CRTC address (H = R12 value, bits 5-0 used; L = R13 value). SSA
; first, then SSSL, so the new address is in place when the line is armed.
; Hardware: SSSL/SSA &6801-&6803. Registers clobbered: AF, BC, DE, HL.
__PL_SPLIT:
    PROC
    LOCAL __SP_OFF
    ld   d, a
    call __PL_ENSURE2       ; keeps HL, DE, BC
    ret  nc
    ld   a, d
    or   a
    jr   z, __SP_OFF
    ld   b, l               ; B = R13
    ld   c, d               ; C = line
    ld   a, h
    and  $3F
    ld   hl, $6802
    push bc
    call __PL_POKE
    pop  bc
    inc  hl
    ld   a, b
    push bc
    call __PL_POKE
    pop  bc
    ld   hl, $6801
    ld   a, c
    jp   __PL_POKE
__SP_OFF:
    ld   hl, $6801
    xor  a
    jp   __PL_POKE
    ENDP

; __PL_ADDR2CRTC -- HL = a byte address (bit 0 dropped) -> HL = the CRTC
; address: R12 = page (address bits 15-14 as bits 5-4) | offset bits 9-8,
; R13 = offset bits 7-0, the offset being address bits 10-1 (2-byte words
; within the 2 KB the CRTC counts through; the CPC's character rows are
; 2 KB apart in the screen map, so bits 13-11 are the raster, not part
; of the CRTC address). Registers clobbered: AF, D, HL.
__PL_ADDR2CRTC:
    ld   a, h
    and  $C0
    rrca
    rrca
    ld   d, a               ; page bits in place
    ld   a, h
    and  $07
    ld   h, a
    srl  h
    rr   l                  ; HL = (address & &7FF) >> 1
    ld   a, h
    or   d
    ld   h, a
    ret

PLUS_SSCR:  defb 0          ; what the library last wrote to SSCR

    pop namespace

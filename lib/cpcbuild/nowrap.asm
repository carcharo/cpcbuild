; -----------------------------------------------------------------------
; cpcbuild library -- the "no row can wrap" test used by the fast paths
;
; Written from scratch for this project (MIT); see core.asm. Kept in a
; file of its own (not core.asm) so that programs that use only the
; display and keyboard routines don't carry it.
; -----------------------------------------------------------------------

#include once <cpcbuild/core.asm>

    push namespace core

; __CB_NOWRAP -- Carry set if no row on the screen can wrap around the
; end of its 2 KB block, i.e. the hardware-scroll offset is 48 or less
; (the last row's last byte is then at offset + 24*80 + 79 < 2048). True
; whenever the text hasn't scrolled, so then the routines can skip the
; per-row __CB_ROW_WRAPS test and use their unrolled fast paths.
; Firmware entry called: none. Registers clobbered: AF.
__CB_NOWRAP:
    ld   a, (CB_OFFSET + 1)
    or   a
    ret  nz                 ; 256 or more: Carry clear
    ld   a, (CB_OFFSET)
    cp   49                 ; Carry set if 48 or less
    ret

    pop namespace

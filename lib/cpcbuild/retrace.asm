; -----------------------------------------------------------------------
; cpcbuild library -- frame flyback wait (WaitRetrace)
;
; Written from scratch for this project (MIT); see core.asm and display.asm
; (the notes on double buffering and on bare-metal mode there apply).

#include once <cpcbuild/core.asm>
#ifdef CPC_BAREMETAL
#include once <waitframes.asm>
#endif

    push namespace core

; __CB_WAIT_RETRACE -- waits for the start of the next frame flyback, BC
; times (0 counts as 1), then re-reads the scroll offset. Each wait
; first lets any flyback in progress finish (PPI port B bit 0, read
; directly), so every count is a new frame; the wait itself is the
; firmware's, with interrupts on, so the firmware's frame work (palette,
; keyboard, sound) runs.
; Firmware entries called: MC_WAIT_FLYBACK (&BD19), SCR_GET_LOCATION
; (&BC0B).
; Registers clobbered: AF, BC, HL (main); BC', DE', HL', AF' (the gate).
__CB_WAIT_RETRACE:
#ifdef CPC_BAREMETAL
    ld   a, b
    or   c
    jr   nz, __CWR_BARE
    inc  c
__CWR_BARE:
    call .core.__CPC_WAIT_FRAMES
    jp   __CB_SYNC
#else
    PROC
    LOCAL __CWR_LOOP, __CWR_INFLY

    ld   a, b
    or   c
    jr   nz, __CWR_LOOP
    inc  c
__CWR_LOOP:
    push bc
    ld   b, $F5             ; PPI port B: bit 0 = frame flyback
__CWR_INFLY:
    in   a, (c)
    rra
    jr   c, __CWR_INFLY
    call .core.__FW_CALL
    defw $BD19              ; MC_WAIT_FLYBACK
    pop  bc
    dec  bc
    ld   a, b
    or   c
    jr   nz, __CWR_LOOP
    jp   __CB_SYNC
    ENDP
#endif

    pop namespace

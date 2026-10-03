; -----------------------------------------------------------------------
; cpcbuild library -- frame sync and double buffering
;
; Written from scratch for this project (MIT); see core.asm.
;
; Double buffering (notes.md, Q-4c.1, opt-in): the CRTC can only show a
; screen at &0000/&4000/&8000/&C000, so the back screen is &4000-&7FFF.
; Programs that call EnableDoubleBuffer (cpcbuild/display.bas) get the
; label __CPC_RESERVE_4000 (defined in reserve.bas's CbReserve4000, which
; that sub calls, so only when it is actually used; the banks library
; calls it too): it makes the compiler's memory-layout check reserve
; &4000-&7FFF (src/arch/cpc/backend/main.py RESERVED_RANGE_LABELS).
; Code+data must then end below &4000 and the heap stay above &7FFF.
;
; The firmware draws text on the screen it shows (SCR_SET_BASE moves
; both), so with double buffering on, PRINT output lands on whichever
; screen is showing at the time and is overwritten by the next frames:
; draw text into both screens, or use the library's own drawing only.
; Text must not scroll while double buffering (the firmware's scroll
; would move only the shown screen).

; Bare-metal mode (-D CPC_BAREMETAL, no firmware): the waits count the
; interrupt handler's frames (FH_FRAMES; waitframes.asm in the compiler's
; runtime) and the screen start address is set by writing the CRTC's
; registers 12 and 13 directly (__CB_SET_BASE). The scroll offset is
; always 0 (core.asm's __CB_SYNC). Everything else is as described here.

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

; __CB_SET_BASE -- A = base high byte (&00, &40, &80 or &C0): shows that
; 16 KB screen (and, in firmware mode, makes the firmware's text go there
; too). Takes effect at the next frame.
; Firmware entry called: SCR_SET_BASE (&BC08).
; Registers clobbered: AF (main); BC', DE', HL', AF' (the gate).
;
; Bare-metal mode (-D CPC_BAREMETAL): CRTC registers 12 and 13 directly
; (start address = base, plus CB_OFFSET/2 words; the CRTC reads it at the
; start of the next frame, so writing after the flyback is safe). The
; bare runtime's text base (SCREEN_ADDR) is pointed at the same screen,
; so PRINT follows the shown screen as the firmware's does. Hardware
; used: CRTC (&BCxx/&BDxx).
; Registers clobbered: AF, BC, DE, HL.
__CB_SET_BASE:
#ifdef CPC_BAREMETAL
    ld   h, a
    ld   l, 0
    ld   (SCREEN_ADDR), hl
    rrca
    rrca
    and  $30                ; R12 bits 5-4: address bits 15-14
    ld   d, a
    ld   hl, (CB_OFFSET)
    srl  h
    rr   l                  ; offset in words
    ld   a, h
    and  3
    or   d
    ld   d, a               ; R12
    ld   e, l               ; R13
    ld   bc, $BC0C
    out  (c), c
    ld   b, $BD
    out  (c), d
    ld   bc, $BC0D
    out  (c), c
    ld   b, $BD
    out  (c), e
    ret
#else
    call .core.__FW_CALL
    defw $BC08
    ret
#endif

; __CB_DBUF_ON -- starts double buffering: copies the shown screen to
; the back screen (&4000), then draws there while &C000 is shown.
; Does nothing if already on.
; Firmware entry called: SCR_SET_BASE (&BC08, A = &C0) so that &C000 is
; shown, then __CB_SYNC's.
; Registers clobbered: AF, BC, DE, HL (main); BC', DE', HL', AF'.
__CB_DBUF_ON:
    ld   a, (CB_DBUF)
    or   a
    ret  nz
    ld   a, $C0
    call __CB_SET_BASE      ; SCR_SET_BASE: show &C000
    ld   hl, $C000
    ld   de, $4000
    ld   bc, $4000
    ldir
    ld   a, 1
    ld   (CB_DBUF), a
    ld   a, $40
    ld   (CB_BASE), a
    ld   a, $C0
    ld   (CB_SHOWN), a
    jp   __CB_SYNC

; __CB_DBUF_OFF -- stops double buffering, leaving &C000 shown with the
; last frame on it (copied from &4000 if that was showing).
; Firmware entry called: SCR_SET_BASE (&BC08), then __CB_SYNC's.
; Registers clobbered: AF, BC, DE, HL (main); BC', DE', HL', AF'.
__CB_DBUF_OFF:
    PROC
    LOCAL __CDO_SHOWN_C0

    ld   a, (CB_DBUF)
    or   a
    ret  z
    ld   a, (CB_SHOWN)
    cp   $C0
    jr   z, __CDO_SHOWN_C0
    ld   hl, $4000
    ld   de, $C000
    ld   bc, $4000
    ldir
    ld   a, $C0
    call __CB_SET_BASE      ; SCR_SET_BASE: show &C000
__CDO_SHOWN_C0:
    xor  a
    ld   (CB_DBUF), a
    jp   __CB_SYNC          ; CB_BASE = CB_SHOWN = &C0 again
    ENDP

; __CB_FLIP -- shows the screen just drawn and draws on the other one
; from now on. Waits for the frame flyback first, so the switch happens
; between frames (the CRTC takes the new start address at the next
; frame). Without double buffering it just waits for the flyback.
; Firmware entries called: MC_WAIT_FLYBACK (&BD19, via
; __CB_WAIT_RETRACE), SCR_SET_BASE (&BC08, A = new base), SCR_GET_LOCATION.
; Registers clobbered: AF, BC, DE, HL (main); BC', DE', HL', AF'.
__CB_FLIP:
    ld   bc, 1
    call __CB_WAIT_RETRACE
    ld   a, (CB_DBUF)
    or   a
    ret  z
    ld   a, (CB_BASE)
    call __CB_SET_BASE      ; SCR_SET_BASE: show the screen just drawn
    ld   hl, (CB_BASE)      ; L = CB_BASE, H = CB_SHOWN (adjacent)
    ld   a, l
    ld   l, h
    ld   h, a
    ld   (CB_BASE), hl      ; swapped
    jp   __CB_SYNC

    pop namespace

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

#include once <cpcbuild/core.asm>

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
    call .core.__FW_CALL
    defw $BC08              ; SCR_SET_BASE: show &C000
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
    call .core.__FW_CALL
    defw $BC08              ; SCR_SET_BASE: show &C000
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
    call .core.__FW_CALL
    defw $BC08              ; SCR_SET_BASE: show the screen just drawn
    ld   hl, (CB_BASE)      ; L = CB_BASE, H = CB_SHOWN (adjacent)
    ld   a, l
    ld   l, h
    ld   h, a
    ld   (CB_BASE), hl      ; swapped
    jp   __CB_SYNC

    pop namespace

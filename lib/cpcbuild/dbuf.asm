; -----------------------------------------------------------------------
; cpcbuild library -- double buffering: start, stop, flip
;
; Written from scratch for this project (MIT); see core.asm and display.asm
; (the notes on double buffering and on bare-metal mode there apply).
; EnableDoubleBuffer, DisableDoubleBuffer and FlipBuffer. FlipBuffer waits
; for the flyback with __CB_WAIT_RETRACE (retrace.asm).
#include once <cpcbuild/core.asm>
#include once <cpcbuild/retrace.asm>
#include once <cpcbuild/setbase.asm>

    push namespace core

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

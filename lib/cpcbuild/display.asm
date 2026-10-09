; -----------------------------------------------------------------------
; cpcbuild library -- frame sync and double buffering (all of it)
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


; The routines live in retrace.asm (__CB_WAIT_RETRACE), setbase.asm
; (__CB_SET_BASE) and dbuf.asm (double buffering on/off, flip);
; __CB_SYNC is in core.asm. display.bas requires just the ones a program
; calls; this file pulls in all of them for anything that still requires
; "cpcbuild/display.asm" as a whole.

#include once <cpcbuild/dbuf.asm>

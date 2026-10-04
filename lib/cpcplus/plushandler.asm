; -----------------------------------------------------------------------
; cpcplus library -- handler-context entry points: the cheap way for a raster
; handler (RasterIntAt) or a frame hook, which run with interrupts already
; off, to touch the ASIC. Written from scratch for this project (MIT).
;
; Not part of the library unless the program asks for it (it costs about
; 100 bytes): put
;     #require "cpcplus/plushandler.asm"
; once in the program (next to the #include of cpcplus.bas). PlusHandlerIn
; and PlusHandlerOut need no such line (they are in the trampoline).
; See the header of cpcplus.bas for the rules and the T-state costs, and
; plus.asm ("handler context") for how the paging works.
; -----------------------------------------------------------------------

#include once <cpcplus/plus.asm>
#include once <cpcplus/plusgfx.asm>
#include once <cpcplus/plusscr.asm>

    push namespace core

; PlusHandlerPoke -- A = value, HL = ASIC address (&4000-&7FFF): one byte,
; paged in and out around the store. Nothing happens while the library is
; not unlocked. 118 T-states with the call. HL kept.
; Hardware: RMR2 and the byte. Registers clobbered: AF, BC.
PlusHandlerPoke:
    ld   d, a
    ld   a, (PLUS_UNLK)
    or   a
    ret  z
    ld   a, d
    jp   PLX1W

; PlusHandlerSetColourRaw -- A = palette entry (0-15 pens, 16 border, 17-31
; sprite colours 1-15; above 31 does nothing), DE = the two palette bytes as
; the ASIC holds them: E = red << 4 | blue, D = green (0-15): for a handler
; that has them in a table (img2cpc.py's palettes are in this format).
; Nothing happens while the library is not unlocked. 155 T-states
; with the call (PLX2); the firmware ink refresh is NOT stopped here:
; any SetPalette12 / SetBorder12 / SetPalette12Block of a pen or the border
; from the main program stops it (once; Mode() starts it again).
; Hardware: palette RAM, RMR2. Registers clobbered: AF, BC, HL (DE kept).
PlusHandlerSetColourRaw:
    cp   32
    ret  nc
    ld   b, a
    ld   a, (PLUS_UNLK)
    or   a
    ret  z
    ld   a, b
    add  a, a
    ld   l, a
    ld   h, $64
    jp   PLX2

; PlusHandlerSetColour -- A = entry (as above), HL = &0RGB (red bits 11-8,
; green 7-4, blue 3-0): converts and stores, about 285 T-states with the call.
; Same rules. Registers clobbered: AF, BC, DE, HL.
PlusHandlerSetColour:
    cp   32
    ret  nc
    ld   c, a
    ld   a, (PLUS_UNLK)
    or   a
    ret  z
    call __PL_RGB2HW
    jp   PLX2

; PlusHandlerScroll -- ScrollFine for a raster handler or frame hook
; (interrupts already off; see plus.asm, "handler context"): B = dx, C = dy,
; written with the paging done around the store but no interrupt handling and
; no ENSURE (nothing happens while the library is not unlocked). About 250
; T-states with the call. Registers clobbered: AF, BC, HL.
PlusHandlerScroll:
    ld   a, (PLUS_UNLK)
    or   a
    ret  z
    call __PL_SCRVAL
    ld   hl, $6804
    jp   PLX1W

    pop namespace

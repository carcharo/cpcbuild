' ----------------------------------------------------------------
' cpcbuild/text.bas -- text from a compact 1-bit font (--arch cpc)
'
'   TextFont(addr, first, rows)   the font: one byte per pixel row, rows
'                                 bytes a glyph (1-8), glyphs from
'                                 character code first upward; bit 7 is
'                                 the leftmost pixel, at most 8 wide. A
'                                 glyph is drawn from the top of its
'                                 8-line cell; the lines below rows are
'                                 paper. Optional fourth argument last:
'                                 the last character code in the font
'                                 (default 255); characters outside
'                                 first..last are drawn as paper.
'   TextPen(ink, paper)           the pens for the text drawn next (mode
'                                 0: 0-15, mode 1: 0-3); default 1, 0
'   TextAt(col, row, s$)          draw s$ from character cell (col, row)
'                                 on the screen the library draws on
'   TextAtBoth(col, row, s$)      as TextAt, and queue it to be drawn
'                                 again on the other screen by the next
'                                 TextFlush (double buffering)
'   TextFlush()                   draw the queued text, empty the queue
'
' Cells are 8 x 8 pixels: mode 0 is 20 x 25 cells (4 bytes x 8 lines
' each), mode 1 is 40 x 25 (2 bytes x 8 lines). Text running past the
' right edge is cut off; nothing is drawn off the bottom. Mode 2 is not
' supported (nothing is drawn). The mode is read when text is drawn
' (the table TextPen builds is rebuilt if the mode changed since), but
' call ScreenInit() after Mode as for every cpcbuild routine.
'
' Font format. A glyph is rows bytes, top row first; in each byte bit 7
' is the leftmost pixel, bit 0 the 8th. A pixel set is drawn in the ink,
' clear in the paper. Starfall's 5 x 7 font (one byte per row, bit 4 the
' leftmost) becomes this format by shifting each byte left 3, or 2 to
' keep the game's one-pixel left margin. The font is read in place: it
' must stay at addr while text is drawn.
'
' Double buffering. TextAtBoth draws the text now, on the screen being
' drawn, and, if EnableDoubleBuffer is on, queues it. The program calls
' TextFlush() once per frame after FlipBuffer: it draws the queued text
' on the screen that is now the hidden one, in the pens the text was
' queued with, then empties the queue (and does nothing, cheaply, when
' the queue is empty). So text queued in frame N is on the shown screen
' at once and on the other one after the next flip and flush. With
' double buffering off TextAtBoth is TextAt.
' Do not change the font while text is queued.
'
' Queue size: #define TEXT_QUEUE n before the include (bytes, 1-255,
' default 160). An entry takes the string's length plus 4 bytes; text
' that doesn't fit is drawn now but not queued. Strings longer than 255
' characters are ignored.
'
' Registers: every call clobbers AF, BC, DE and HL (IX and IY are kept);
' no firmware calls, no firmware state is touched (works in -D
' CPC_BAREMETAL builds). The cell address honours the hardware-scroll
' offset (wrapping inside the 2 KB block, as the rest of the library).
'
' Cost (T-states, CPC effective, measured on chips in game mode, so about
' 3 % interrupt time is included; method: Frames() over 2,000 calls less
' the empty loop, as bench/boriel/banks_bench.bas):
' a glyph of 7 rows + 1 paper line ~2,600 in mode 0, ~2,130 in mode 1;
' a blank cell ~1,090 (mode 0); each TextAt call ~2,900 on top (the
' compiler copying the string argument, a heap block of its length + 2
' for the call); TextPen ~6,300 in mode 0, ~2,500 in mode 1 (it builds
' the table); TextFlush with nothing queued ~60. Starfall's SF_GLY: ~2,950.
'
' Memory: a program that uses TextAt adds ~825 bytes (cpcbuild/text.asm:
' code and tables, variables and the 64-byte table buffer; mode 1 is
' ~110 of that), plus ~390 for the compiler's string support if the
' program has no other strings; TextAtBoth / TextFlush add ~350 more,
' 160 of them the queue (the default). Including this file without
' calling anything adds nothing.
'
' Written from scratch for this project (MIT).
' ----------------------------------------------------------------

#ifndef __LIBRARY_CPCBUILD_TEXT__
#define __LIBRARY_CPCBUILD_TEXT__

#ifndef __CPC__
#error "cpcbuild is for --arch cpc only"
#endif

#ifndef TEXT_QUEUE
#define TEXT_QUEUE 160
#endif

#pragma push(case_insensitive)
#pragma case_insensitive = TRUE

sub TextFont(addr as uinteger, first as ubyte, rows as ubyte, last as ubyte = 255)
    asm
    push namespace core
    call __TX_FONT
    pop namespace
    end asm
    #require "cpcbuild/text.asm"
end sub

sub TextPen(inkpen as ubyte, paperpen as ubyte)
    asm
    push namespace core
    call __TX_PEN
    pop namespace
    end asm
    #require "cpcbuild/text.asm"
end sub

sub TextAt(col as ubyte, row as ubyte, s as string)
    asm
    push namespace core
    call __TX_AT
    pop namespace
    end asm
    #require "cpcbuild/text.asm"
end sub

' The queue: its storage and state (TEXT_QUEUE is a BASIC #define, so the
' assembly file can't see it, and the queue code lives in the two subs
' below). Never run; TextAtBoth and TextFlush call it so that it is
' compiled in exactly when either is used.
sub fastcall TextQueueStore()
    asm
    push namespace core
    ret
TX_QUEUE:   defs TEXT_QUEUE
TX_QSIZE    equ TEXT_QUEUE
TX_QLEN:    defb 0          ; bytes used in the queue
TX_QREM:    defb 0          ; flush: bytes left
TX_QP:      defw 0          ; flush: the entry being drawn
    pop namespace
    end asm
end sub

' Draws now (__TX_AT), and with double buffering on queues the text for
' the next TextFlush if it fits.
' Registers clobbered: AF, BC, DE, HL.
sub TextAtBoth(col as ubyte, row as ubyte, s as string)
    asm
    push namespace core
    PROC
    LOCAL __TXB_END
    call __TX_AT
    ld   a, (CB_DBUF)
    or   a
    jr   z, __TXB_END
    ld   l, (ix+8)
    ld   h, (ix+9)
    ld   a, h
    or   l
    jr   z, __TXB_END
    ld   c, (hl)
    inc  hl
    ld   b, (hl)
    inc  hl
    ld   a, b
    or   a
    jr   nz, __TXB_END
    ld   a, c               ; C = length
    or   a
    jr   z, __TXB_END
    ld   a, (TX_QLEN)
    add  a, c
    jr   c, __TXB_END
    add  a, 4
    jr   c, __TXB_END                  ; A = bytes used if it is queued
    ld   b, a
    ld   a, TX_QSIZE
    cp   b
    jr   c, __TXB_END                  ; it doesn't fit: drawn, not queued
    push hl                 ; HL = the characters
    ld   a, (TX_QLEN)
    ld   e, a
    ld   d, 0
    ld   hl, TX_QUEUE
    add  hl, de
    ex   de, hl             ; DE = where the entry goes
    ld   a, b
    ld   (TX_QLEN), a
    ld   a, (ix+5)
    ld   (de), a            ; column
    inc  de
    ld   a, (ix+7)
    ld   (de), a            ; row
    inc  de
    ld   a, c
    ld   (de), a            ; length
    inc  de
    ld   a, (TX_PAPER)
    add  a, a
    add  a, a
    add  a, a
    add  a, a
    ld   hl, TX_INK
    or   (hl)
    ld   (de), a            ; pens
    inc  de
    pop  hl
    ld   b, 0
    ldir                    ; the characters
__TXB_END:
    ENDP
    pop namespace
    end asm
    #require "cpcbuild/text.asm"
    TextQueueStore()
end sub

' Draws the queued text on the screen being drawn, in the pens it was
' queued with (the current pens come back after), and empties the queue.
' Registers clobbered: AF, BC, DE, HL (and what the drawing does).
sub fastcall TextFlush()
    asm
    push namespace core
    PROC
    LOCAL __TXL_NEXT, __TXL_DONE
    ld   a, (TX_QLEN)
    or   a
    ret  z
    ld   (TX_QREM), a
    xor  a
    ld   (TX_QLEN), a
    ld   hl, (TX_INK)       ; L = ink, H = paper
    push hl
    ld   hl, TX_QUEUE
__TXL_NEXT:
    ld   (TX_QP), hl
    ld   c, (hl)            ; column
    inc  hl
    ld   a, (hl)            ; row
    inc  hl
    ld   b, (hl)            ; length
    inc  hl
    ld   d, (hl)            ; pens
    inc  hl
    push af
    push bc
    push hl
    ld   a, d
    call __TX_PENS
    pop  de                 ; DE = the characters
    pop  bc
    pop  af
    call __TX_PUTS
    ld   hl, (TX_QP)
    inc  hl
    inc  hl
    ld   a, (hl)
    add  a, 4               ; bytes the entry took
    ld   c, a
    ld   a, (TX_QREM)
    sub  c
    jr   z, __TXL_DONE
    ld   (TX_QREM), a
    ld   hl, (TX_QP)
    ld   b, 0
    add  hl, bc
    jr   __TXL_NEXT
__TXL_DONE:
    pop  hl                 ; the pens before
    ld   a, h
    add  a, a
    add  a, a
    add  a, a
    add  a, a
    or   l
    call __TX_PENS
    ENDP
    pop namespace
    end asm
    #require "cpcbuild/text.asm"
    TextQueueStore()
end sub

#pragma pop(case_insensitive)

#endif

' ----------------------------------------------------------------
' cpcbuild/fill.bas -- pen bytes, rectangle fill, clear (--arch cpc)
'
'   PenByte(pen)              the screen byte with every pixel in that
'                             pen, for the current mode (mode 0: pens
'                             0-15, 2 pixels per byte; mode 1: 0-3, 4
'                             pixels; mode 2: 0-1, 8 pixels). The pen is
'                             masked to the mode's range.
'   FillRect(x, y, w, h, pen) fill a rectangle with the pen; x and w in
'                             bytes, y and h in lines, top-left origin,
'                             clipped to the screen
'   ClearScreen(pen)          fill the whole drawing screen (16 KB) with
'                             the pen, fast
'
' Call ScreenInit() (cpcbuild/display.bas) after Mode, as for every
' cpcbuild routine. See cpcbuild/fill.asm.
'
' Written from scratch for this project (MIT).
' ----------------------------------------------------------------

#ifndef __LIBRARY_CPCBUILD_FILL__
#define __LIBRARY_CPCBUILD_FILL__

#ifndef __CPC__
#error "cpcbuild is for --arch cpc only"
#endif

#pragma push(case_insensitive)
#pragma case_insensitive = TRUE

function PenByte(pen as ubyte) as ubyte
    #require "cpcbuild/penbyte.asm"
    asm
    push namespace core
    ld a, (ix+5)
    call __CB_PENBYTE
    pop namespace
    end asm
end function

sub FillRect(x as integer, y as integer, w as ubyte, h as ubyte, pen as ubyte)
    #require "cpcbuild/fill.asm"
    asm
    push namespace core
    call __CB_FILL_RECT
    pop namespace
    end asm
end sub

sub ClearScreen(pen as ubyte)
    #require "cpcbuild/penbyte.asm"
    #require "cpcbuild/clear.asm"
    asm
    push namespace core
    ld a, (ix+5)
    call __CB_PENBYTE
    call __CB_CLEAR
    pop namespace
    end asm
end sub

#pragma pop(case_insensitive)

#endif

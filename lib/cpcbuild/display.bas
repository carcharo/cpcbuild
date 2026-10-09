' ----------------------------------------------------------------
' cpcbuild/display.bas -- frame sync and double buffering (--arch cpc)
'
'   ScreenInit()            re-reads the screen state; call after Mode
'                           or anything else that changes the screen
'   WaitRetrace(frames)     waits for the start of that many frame
'                           flybacks (as NextBuild's WaitRetrace)
'   EnableDoubleBuffer()    draw on a hidden screen at &4000 from now on
'   DisableDoubleBuffer()   back to drawing on the shown screen (&C000)
'   FlipBuffer()            at the next flyback, show what was drawn and
'                           draw on the other screen (as NextBuild's
'                           FlipBuffer); with double buffering off it
'                           just waits for the flyback
'   PokeScreen(x, y, b)     writes byte b at byte column x (0-79), pixel
'                           line y (0-199), top-left origin; ignored off
'                           the screen
'   PeekScreen(x, y)        reads it back (0 off the screen)
'
' Double buffering costs memory: &4000-&7FFF becomes the second screen,
' so a program that uses it must fit its code and data in &0040-&3FFF
' (about 16 KB); the compiler stops with an error if it doesn't. PRINT always
' draws on the screen being shown, and text must not scroll while double
' buffering is on (see cpcbuild/display.asm).
'
' Written from scratch for this project (MIT).
' ----------------------------------------------------------------

#ifndef __LIBRARY_CPCBUILD_DISPLAY__
#define __LIBRARY_CPCBUILD_DISPLAY__

#ifndef __CPC__
#error "cpcbuild is for --arch cpc only"
#endif

#include once <cpcbuild/reserve.bas>

#pragma push(case_insensitive)
#pragma case_insensitive = TRUE

sub fastcall ScreenInit()
    #require "cpcbuild/core.asm"
    asm
    push namespace core
    call __CB_SYNC
    pop namespace
    end asm
end sub

sub fastcall WaitRetrace(frames as uinteger)
    #require "cpcbuild/retrace.asm"
    asm
    push namespace core
    ld b, h
    ld c, l
    call __CB_WAIT_RETRACE
    pop namespace
    end asm
end sub

' Calls CbReserve4000 (reserve.bas), which defines __CPC_RESERVE_4000 (the
' compiler's generic label for "this program reserves &4000-&7FFF"), so the
' compiler reserves it for the back screen -- only in programs that call this
' sub (or another sub that reserves it, such as the banks library's).
sub fastcall EnableDoubleBuffer()
    #require "cpcbuild/dbuf.asm"
    CbReserve4000()
    asm
    push namespace core
    call __CB_DBUF_ON
    pop namespace
    end asm
end sub

sub fastcall DisableDoubleBuffer()
    #require "cpcbuild/dbuf.asm"
    asm
    push namespace core
    call __CB_DBUF_OFF
    pop namespace
    end asm
end sub

sub fastcall FlipBuffer()
    #require "cpcbuild/dbuf.asm"
    asm
    push namespace core
    call __CB_FLIP
    pop namespace
    end asm
end sub

' B = y, C = x -> HL = address (cpcbuild/core.asm), then write.
sub PokeScreen(x as ubyte, y as ubyte, value as ubyte)
    #require "cpcbuild/core.asm"
    asm
    push namespace core
    PROC
    LOCAL __PS_OFF
    ld c, (ix+5)
    ld b, (ix+7)
    ld a, c
    cp 80
    jr nc, __PS_OFF
    ld a, b
    cp 200
    jr nc, __PS_OFF
    call __CB_ADDR
    ld a, (ix+9)
    ld (hl), a
__PS_OFF:
    ENDP
    pop namespace
    end asm
end sub

function PeekScreen(x as ubyte, y as ubyte) as ubyte
    #require "cpcbuild/core.asm"
    asm
    push namespace core
    PROC
    LOCAL __PK_OFF, __PK_END
    ld c, (ix+5)
    ld b, (ix+7)
    ld a, c
    cp 80
    jr nc, __PK_OFF
    ld a, b
    cp 200
    jr nc, __PK_OFF
    call __CB_ADDR
    ld a, (hl)
    jr __PK_END
__PK_OFF:
    xor a
__PK_END:
    ENDP
    pop namespace
    end asm
end function

#pragma pop(case_insensitive)

#endif

' ----------------------------------------------------------------
' cpcplus/cpcplus.bas -- the CPC Plus / GX4000 ASIC (--arch cpc)
'
'   PlusAvailable()               1 on a Plus or GX4000, 0 on a 464/664/6128
'   PlusUnlock()                  unlock the ASIC (the calls below do it
'                                 for you the first time)
'   PlusLock()                    lock it again
'   PlusPageIn() / PlusPageOut()  the ASIC's registers at &4000-&7FFF, for
'                                 programs that poke them themselves
'
'   SetPalette12(pen, rgb)        pen 0-15 gets the 12-bit colour rgb =
'                                 &H0RGB (red, green, blue 0-15 each)
'   SetBorder12(rgb)              the border
'   GetPalette12(entry)           the colour of entry 0-31 (16 = border,
'                                 17-31 = sprite colours 1-15), &H0RGB
'   SetPalette12Block(addr, first, count)
'                                 count colours from addr (two bytes each,
'                                 the format of img2cpc.py --plus-palette
'                                 and --plus-sprite's NAME_pal) into palette
'                                 entries first.. (0-31)
'
'   SpritePalette(addr)           sprite colours 1-15 from 30 bytes at addr
'                                 (img2cpc.py --plus-sprite's NAME_pal)
'   SpriteColour(n, rgb)          one sprite colour n = 1-15, rgb = &H0RGB
'   SpriteSetImage(n, addr)       sprite n (0-15)'s 16x16 picture from 256
'                                 bytes at addr, one pixel per byte, 0 =
'                                 transparent, 1-15 = sprite colour
'   SpriteSetImagePacked(n, addr) the same from 128 bytes, two pixels per
'                                 byte, the left one in the high nibble
'   SpriteMove(n, x, y)           position, see below
'   SpriteMag(n, magx, magy)      magnification 1, 2 or 4 (0 hides it)
'   SpriteHide(n)                 = SpriteMag(n, 0, 0)
'   SpritesHideAll()              hide all 16
'
' Coordinates. x is in mode-2 pixels from the left edge of the 640-pixel
' picture, y in lines from the top of the 200-line picture, of the
' sprite's top-left corner: x 0-639, y 0-199 is the picture, and the
' ASIC's own range is x -256..767, y -256..255 (what you pass is clamped
' to it; a sprite is not drawn when it lies wholly outside the screen).
' Sprites are 16x16 pixels; one sprite pixel is 1 mode-2 pixel wide at
' magnification 1, 2 (a mode-1 pixel) at 2, 4 (a mode-0 pixel) at 4, and
' 1, 2 or 4 lines high, so a sprite covers 16, 32 or 64 pixels each way.
' Sprite 15 is drawn under sprite 0 where they overlap. The sprites' own
' colours are palette entries 17-31, not the pens.
'
' Without an ASIC. Every call does nothing on a CPC without one, and
' changes nothing (PlusAvailable() tells a program which it is: the first
' call finds out). On the first call on a Plus, the library probes the
' ASIC, then unlocks it, and leaves it unlocked: PlusLock() locks it. A
' locked ASIC treats the registers' writes as ordinary RAM and a
' program that wants the Plus's normal behaviour back can call it.
'
' Rules. Any program that uses these routines reserves &4000-&7FFF (the
' same marker double buffering and the RAM banks use: code and data must
' end below &4000, and the heap and stack are elsewhere), because the
' ASIC's register page replaces that range while it is in. The library
' pages it in only inside a window with interrupts off (at most about
' 1.5 ms: a sprite picture copy; the others about 0.1 ms) and puts the
' interrupt state back, so it works from main code and from a frame
' hook alike. A source address (palette, picture) must not lie in
' &4000-&7FFF: such a call is refused (nothing happens). PlusPageIn leaves
' interrupts off until PlusPageOut: keep what lies between them short
' (the same 3.3 ms rule as the banks), call nothing from this library in
' between that you don't need to (they work, and do nothing extra), and
' put nothing of the program in &4000-&7FFF. The RAM bank window and the
' back screen are hidden, not changed, while the page is in.
' Don't change the Gate Array's RMR2 (&7Fxx, bits 7-5 = 101) yourself;
' the library puts it back to &A0 (lower ROM page 0 at &0000), its reset
' value, and keeps no other copy.
'
' A program that ends with END and has sprites on should call
' SpritesHideAll() first: the sprites are ASIC state, not screen memory.
'
' Both modes (firmware, -D CPC_BAREMETAL). Written from scratch for this
' project (MIT). Facts and sources: docs/notes.md, Phase 7 P2.
' ----------------------------------------------------------------

#ifndef __LIBRARY_CPCPLUS__
#define __LIBRARY_CPCPLUS__

#ifndef __CPC__
#error "cpcplus is for --arch cpc only"
#endif

#include once <cpcbuild/reserve.bas>

#pragma push(case_insensitive)
#pragma case_insensitive = TRUE

function PlusAvailable() as ubyte
    CbReserve4000()
    asm
    push namespace core
    call __PL_AVAIL
    pop namespace
    end asm
end function

sub PlusUnlock()
    CbReserve4000()
    asm
    push namespace core
    call __PL_ENSURE
    pop namespace
    end asm
end sub

sub PlusLock()
    CbReserve4000()
    asm
    push namespace core
    call __PL_LOCK
    pop namespace
    end asm
end sub

sub PlusPageIn()
    CbReserve4000()
    asm
    push namespace core
    call __PL_USER_IN
    pop namespace
    end asm
end sub

sub PlusPageOut()
    CbReserve4000()
    asm
    push namespace core
    call __PL_USER_OUT
    pop namespace
    end asm
end sub

sub SetPalette12(pen as ubyte, rgb as uinteger)
    CbReserve4000()
    asm
    push namespace core
    ld a, (ix+5)
    ld l, (ix+6)
    ld h, (ix+7)
    call __PL_SETCOL
    pop namespace
    end asm
end sub

sub SetBorder12(rgb as uinteger)
    CbReserve4000()
    asm
    push namespace core
    ld l, (ix+4)
    ld h, (ix+5)
    ld a, 16
    call __PL_SETCOL
    pop namespace
    end asm
end sub

function GetPalette12(entry as ubyte) as uinteger
    CbReserve4000()
    asm
    push namespace core
    ld a, (ix+5)
    call __PL_GETCOL
    pop namespace
    end asm
end function

sub SetPalette12Block(addr as uinteger, first as ubyte, count as ubyte)
    CbReserve4000()
    asm
    push namespace core
    ld l, (ix+4)
    ld h, (ix+5)
    ld d, (ix+7)
    ld e, (ix+9)
    call __PL_PALBLOCK
    pop namespace
    end asm
end sub

sub SpritePalette(addr as uinteger)
    CbReserve4000()
    asm
    push namespace core
    ld l, (ix+4)
    ld h, (ix+5)
    ld de, $110F
    call __PL_PALBLOCK
    pop namespace
    end asm
end sub

sub SpriteColour(n as ubyte, rgb as uinteger)
    CbReserve4000()
    asm
    push namespace core
    ld a, (ix+5)
    or a
    jr z, __PLB_SC_END
    cp 16
    jr nc, __PLB_SC_END
    add a, 16
    ld l, (ix+6)
    ld h, (ix+7)
    call __PL_SETCOL
__PLB_SC_END:
    pop namespace
    end asm
end sub

sub SpriteSetImage(n as ubyte, addr as uinteger)
    CbReserve4000()
    asm
    push namespace core
    ld a, (ix+5)
    ld l, (ix+6)
    ld h, (ix+7)
    call __PL_IMG
    pop namespace
    end asm
end sub

sub SpriteSetImagePacked(n as ubyte, addr as uinteger)
    CbReserve4000()
    asm
    push namespace core
    ld a, (ix+5)
    ld l, (ix+6)
    ld h, (ix+7)
    call __PL_IMGP
    pop namespace
    end asm
end sub

sub SpriteMove(n as ubyte, x as integer, y as integer)
    CbReserve4000()
    asm
    push namespace core
    call __PL_MOVE
    pop namespace
    end asm
end sub

sub SpriteMag(n as ubyte, magx as ubyte, magy as ubyte)
    CbReserve4000()
    asm
    push namespace core
    ld a, (ix+7)
    call __PL_MAGCODE
    add a, a
    add a, a
    ld e, a
    ld a, (ix+9)
    call __PL_MAGCODE
    or e
    ld e, a
    ld a, (ix+7)
    or a
    jr z, __PLB_SM_OFF
    ld a, (ix+9)
    or a
    jr nz, __PLB_SM_GO
__PLB_SM_OFF:
    ld e, 0
__PLB_SM_GO:
    ld a, (ix+5)
    call __PL_MAGREG
    pop namespace
    end asm
end sub

sub SpriteHide(n as ubyte)
    CbReserve4000()
    asm
    push namespace core
    ld a, (ix+5)
    ld e, 0
    call __PL_MAGREG
    pop namespace
    end asm
end sub

sub SpritesHideAll()
    CbReserve4000()
    asm
    push namespace core
    call __PL_HIDEALL
    pop namespace
    end asm
end sub

#pragma pop(case_insensitive)

#require "cpcplus/plus.asm"
#require "cpcplus/plusgfx.asm"

#endif

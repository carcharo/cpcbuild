' ----------------------------------------------------------------
' cpcbuild/palette.bas -- palettes (--arch cpc)
'
'   SetPalette(colours, count)         pens 0..count-1 get the firmware
'                                      colour numbers (0-26) found in
'                                      the count bytes at address colours
'   PalUpload(colours, count, first)   the same for pens first..first+count-1
'
' colours is an address, e.g. @pal(0) of a DIM pal(15) AS UBYTE. Colour
' numbers are the firmware's (see cpc.bas: 0 black, 1 blue, ... 26
' bright white). Entries above 26 are skipped, and so are pens above
' 15; flashing inks are not set.
'
' Each colour is set through the firmware (SCR_SET_INK &BC32, so its own
' tables stay right) and also written straight to the Gate Array, so it
' shows at once. SetInk and SetBorder in cpc.bas do the same.
'
' Written from scratch for this project (MIT).
' ----------------------------------------------------------------

#ifndef __LIBRARY_CPCBUILD_PALETTE__
#define __LIBRARY_CPCBUILD_PALETTE__

#ifndef __CPC__
#error "cpcbuild is for --arch cpc only"
#endif

#pragma push(case_insensitive)
#pragma case_insensitive = TRUE

sub SetPalette(colours as uinteger, count as ubyte)
    #require "cpcbuild/palette.asm"
    asm
    push namespace core
    ld l, (ix+4)
    ld h, (ix+5)
    ld b, (ix+7)
    ld c, 0
    call __CB_PAL_UPLOAD
    pop namespace
    end asm
end sub

sub PalUpload(colours as uinteger, count as ubyte, first as ubyte)
    #require "cpcbuild/palette.asm"
    asm
    push namespace core
    ld l, (ix+4)
    ld h, (ix+5)
    ld b, (ix+7)
    ld c, (ix+9)
    call __CB_PAL_UPLOAD
    pop namespace
    end asm
end sub

#pragma pop(case_insensitive)

#endif

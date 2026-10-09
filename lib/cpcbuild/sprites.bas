' ----------------------------------------------------------------
' cpcbuild/sprites.bas -- sprites on the screen memory (--arch cpc)
'
'   PutSprite(x, y, w, h, spr)        copy w*h bytes (row by row, top
'                                      row first) to the screen
'   PutSpriteMasked(x, y, w, h, spr)  spr = address of w*h (mask, pixels) byte
'                                      pairs: screen = (screen AND mask)
'                                      OR pixels (mask bit 1 = keep the
'                                      background)
'   GetBlock(x, y, w, h, buffer)       copy the screen area into buffer
'                                      (w*h bytes), to restore it later
'                                      with PutSprite
'
' x is in bytes (0-79; a byte is 2 pixels in mode 0, 4 in mode 1, 8 in
' mode 2), y in pixel lines (0-199), both from the top-left, and may be
' negative or off the far edge: all three clip to the screen, drawing
' only the visible part. The data is in screen-byte format for the mode
' in use. w is 1-255, h 1-255. See cpcbuild/sprite.asm.
'
' Written from scratch for this project (MIT).
' ----------------------------------------------------------------

#ifndef __LIBRARY_CPCBUILD_SPRITES__
#define __LIBRARY_CPCBUILD_SPRITES__

#ifndef __CPC__
#error "cpcbuild is for --arch cpc only"
#endif

#pragma push(case_insensitive)
#pragma case_insensitive = TRUE

sub PutSprite(x as integer, y as integer, w as ubyte, h as ubyte, spr as uinteger)
    #require "cpcbuild/sprput.asm"
    asm
    push namespace core
    call __CB_PUT_SPRITE
    pop namespace
    end asm
end sub

sub PutSpriteMasked(x as integer, y as integer, w as ubyte, h as ubyte, spr as uinteger)
    #require "cpcbuild/sprmask.asm"
    asm
    push namespace core
    call __CB_PUT_MASKED
    pop namespace
    end asm
end sub

sub GetBlock(x as integer, y as integer, w as ubyte, h as ubyte, buffer as uinteger)
    #require "cpcbuild/sprget.asm"
    asm
    push namespace core
    call __CB_GET_BLOCK
    pop namespace
    end asm
end sub

#pragma pop(case_insensitive)

#endif

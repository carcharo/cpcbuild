' ----------------------------------------------------------------
' cpcbuild/spritelist.bas -- sprites on a plain background (--arch cpc)
'
'   SprListBegin()                     start a frame
'   SprListDraw(x, y, w, h, spr)       draw a sprite and remember it
'   SprListEnd()                       finish the frame
'   SprListReset()                     forget what is on the screens
'   SprListPaper(b)                    the background byte (default 0)
'
' For a game whose sprites move over ONE colour: a sprite is drawn by
' ORing its bytes onto the background, and erased by filling its box
' with the background byte. There is no mask and no save buffer, which
' makes it much cheaper than PutSpriteMasked plus redrawing the
' background (see Cost). Each frame the program draws all its sprites
' again; the module remembers what it drew, to erase it.
'
' Frame:  SprListBegin() ... SprListDraw(...) x n ... SprListEnd(),
' then FlipBuffer() (or WaitRetrace) as usual.
'
'   SprListBegin()  Double buffering (EnableDoubleBuffer) on: erases
'                   what was drawn on the screen about to be drawn on
'                   (two frames ago) and empties its list. Off: starts
'                   the frame's slot count, erases nothing yet.
'   SprListDraw(x, y, w, h, spr)
'                   draws a sprite w bytes wide (1-8) and h lines high
'                   (1-255) whose data is at address spr, with its
'                   top-left byte at byte column x (0-79), pixel line y
'                   (0-199), top-left origin as in sprites.bas. Data:
'                   w*h screen bytes, row by row, top row first, pixels
'                   only (transparent = pen 0), the same layout as
'                   PutSprite. The pixels are ORed onto what is on the
'                   screen, so over a background of pen 0 they show as
'                   they are; sprites may overlap (their pixels mix).
'                   Single buffering: first erases what this call
'                   number drew last frame, then draws ("flyback
'                   order": a sprite is blank only for the moment
'                   between its erase and its draw). A sprite beyond
'                   SPRLIST_MAX is not drawn.
'   SprListEnd()    Single buffering: erases the previous frame's
'                   sprites beyond this frame's count. Double: stores
'                   the count of the screen just drawn.
'   SprListReset()  forgets both lists, erasing nothing: call it after
'                   the program has cleared the screen itself, and when
'                   switching double buffering on or off.
'   SprListPaper(b) the byte an erased box is filled with (default 0);
'                   a PenByte() value (fill.bas) for the mode.
'
' Capacity: define SPRLIST_MAX before the include, e.g.
'   #define SPRLIST_MAX 60
' entries per list (1-255; default 40). Memory is 8 bytes per entry
' (two lists of 4), plus 12 bytes of state, plus the code (see Cost).
'
' NO CLIPPING: the sprite must lie wholly on the screen (x + w <= 80,
' y + h <= 200); anything else corrupts memory. The screen address
' follows the library's screen base and hardware-scroll offset
' (ScreenInit, FlipBuffer), but a box that crosses the point where a
' scrolled screen wraps inside its 2 KB block is drawn wrongly.
'
' Cost (chips emulator, game mode, T-states with the CPC's wait states;
' bench method of bench/boriel/banks_bench.bas: N calls timed in frames,
' the empty loop (111) taken off):
'   routine alone (draw + erase): 4x8 3,004; 2x8 2,045; 1x4 719;
'   3x6 (general loop) 2,876 -- as the game's own routines (4x8 2,940)
'   from BASIC, one frame of a single sprite, Begin + Draw (4x8, which
'   also erases last frame's) + End: 4,585; 1x4: 2,269. SprListBegin +
'   SprListEnd with nothing drawn: 320. For comparison PutSprite 4x8
'   takes 3,083, PutSpriteMasked 3,897 and FillRect 4x8 3,881 from BASIC
'   (the call from BASIC costs about 1,100 of each SprListDraw).
' Size: the routines add 1,005 bytes to a program that calls Begin, Draw
' and End, 320 of them the two lists at the default SPRLIST_MAX 40.
' Including this file without calling anything adds nothing.
' Registers: each sub uses the CPU registers freely except IX (the
' frame); see cpcbuild/spritelist.asm for what each routine clobbers.
'
' Written from scratch for this project (MIT).
' ----------------------------------------------------------------

#ifndef __LIBRARY_CPCBUILD_SPRITELIST__
#define __LIBRARY_CPCBUILD_SPRITELIST__

#ifndef __CPC__
#error "cpcbuild is for --arch cpc only"
#endif

#ifndef SPRLIST_MAX
#define SPRLIST_MAX 40
#endif

' SPRLIST_MAX reaches the assembly file as an EQU (a #define does not
' reach asm files, and the list storage's size must be known when the
' assembler gets to it). An EQU makes no code or data.
asm
    push namespace core
__SL_MAX equ SPRLIST_MAX
    pop namespace
end asm

#pragma push(case_insensitive)
#pragma case_insensitive = TRUE

sub SprListBegin()
    #require "cpcbuild/spritelist.asm"
    asm
    push namespace core
    call __SL_BEGIN
    pop namespace
    end asm
end sub

sub SprListDraw(x as ubyte, y as ubyte, w as ubyte, h as ubyte, spr as uinteger)
    #require "cpcbuild/spritelist.asm"
    asm
    push namespace core
    call __SL_DRAW_SPRITE
    pop namespace
    end asm
end sub

sub SprListEnd()
    #require "cpcbuild/spritelist.asm"
    asm
    push namespace core
    call __SL_END
    pop namespace
    end asm
end sub

sub SprListReset()
    #require "cpcbuild/spritelist.asm"
    asm
    push namespace core
    call __SL_RESET
    pop namespace
    end asm
end sub

sub SprListPaper(b as ubyte)
    #require "cpcbuild/spritelist.asm"
    asm
    push namespace core
    ld a, (ix+5)
    ld (__SL_PAPER), a
    pop namespace
    end asm
end sub

#pragma pop(case_insensitive)


#endif

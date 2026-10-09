' ----------------------------------------------------------------
' zxbuild/sprites.bas -- pre-shifted OR sprites with background save and
' attribute colour, double-buffered on the 128K (--arch zx48k)
'
'   SpritesInit(double)        1 = double-buffered (128K: screens 5 and 7);
'                              0 = single screen. Returns 1 if double
'                              buffering is on (it falls back to single if
'                              the machine has no paging, or the stack is
'                              in the top 16K), else 0. Call first.
'   SpriteImage(n, src, wide, attr)
'                              build image n from the art at src (formats
'                              below), pre-shifted; attr = the attribute
'                              byte its cells get (0 = leave attributes)
'   SpritesBegin()             start a frame's list (empty it)
'   SpriteAdd(n, x, y)         queue image n at pixel x, y, in drawing order
'   SpritesSync()              make the drawing screen show the list
'   SpritesFlip()              double-buffered: show the screen just drawn
'                              and draw on the other; otherwise nothing
'   SpritesReset()             forget what was drawn (after the screen(s)
'                              were cleared)
'   SpritesScreen()            the address of the screen being drawn on
'                              (&4000, or &C000 double-buffered)
'   SpritesDone()              double-buffered: show screen 5 again and
'                              page the bank that was at &C000 back (call
'                              before returning to BASIC)
'
' A frame: SpritesBegin(), SpriteAdd(...) for each sprite, SpritesSync(),
' then (after HALT, to flip in the frame blank) SpritesFlip().
'
' ---------------- What a sprite is ----------------
' Drawn as screen OR image (art is ink only, so OR is all a mask would
' give), at x rounded DOWN to a multiple of 4 pixels (0 and 4 pixels are the
' two shifts built by SpriteImage) and any pixel line y (0-191, the whole
' screen). Drawing a sprite also saves the screen bytes it covers and, if
' the image has an attribute, sets the attribute of the cells it covers
' (the old values are saved). Erasing (done by SpritesSync) puts both back,
' sprites in reverse order of drawing, so every frame leaves the screen
' as it was, text and attributes included.
'
' Image formats (src is the address of the art; read when SpriteImage runs,
' not kept):
'   wide   16 x 8 pixels, 16 bytes, row-major: row 0 left byte, row 0
'          right byte, row 1 left byte ... (the leftmost pixel is bit 7)
'   narrow  4 x 4 pixels, 4 bytes, one per row; the pixels are in the high
'          nibble (bit 7 = leftmost), the low nibble is ignored. (Starfall's
'          shots are 2 pixels wide; the engine keeps a narrow image to one
'          byte at both shifts, which is why it is 4 wide, not 8.)
' Pixels set = ink. Zero bits leave the screen alone.
'
' Limits. The images: ZXSPR_IMAGES of them, numbered 0 to ZXSPR_IMAGES-1; an
' image is built once (building n again uses more of the image area; after
' the area is full, SpriteImage does nothing). The list: ZXSPR_MAX sprites a
' frame, the rest are dropped. A sprite that would run off the bottom of the
' screen is dropped (wide: y over 184; narrow: y over 188); a wide one past
' x = 240 is drawn at 240. Images that were not built, and numbers out of
' range, are ignored. Attribute 0 cannot be asked for (it means none). A
' cell holds one ink: where sprites with attributes overlap in a cell, the
' one drawn last wins until it is erased.
'
' ---------------- Memory map ----------------
' Fixed addresses, from ZXSPR_BASE (default &DB00); with NS = ZXSPR_MAX
' (28) and NI = ZXSPR_IMAGES (16):
'   BASE                 records, 2 sets of NS x 16 bytes
'   BASE + 32 NS         backgrounds, 2 sets of NS x 24 bytes
'   BASE + 80 NS         image table, NI x 4 bytes
'   + 4 NI               the images: 40 bytes per wide, 8 per narrow
'                        (room for 40 NI bytes)
'   + 40 NI              the list, NS x 4 bytes
'   total 84 NS + 44 NI bytes: &930 + &2C0 = &BF0 by default (&DB00 to
'   &E6F0). Set ZXSPR_BASE, ZXSPR_MAX and/or ZXSPR_IMAGES with #define
'   before the #include. The area must be free RAM that is not in the way
'   of the program (its ORG..end, heap and stack) and, if you want double
'   buffering on a 128K, at &DB00 or above: bank 7 is paged in at &C000-&FFFF
'   for good then (SpritesDone pages the old one back), and screen 7 is
'   &C000-&DAFF. On a 48K (or single-buffered) the same area is plain RAM
'   (the second set is unused). The program, its variables and the stack
'   must be below &C000 to double-buffer (SpritesInit checks the stack).
'   Contended: screen 5 (&4000) on all models and the odd banks on the 128K,
'   so the data in bank 7 is slower than in main RAM; this matters little.
'
' ---------------- 48K and 128K ----------------
'   SpritesInit(1) on a 128K: bank 7 at &C000, screen 5 shown, screen 7
'     drawn on (the contents of screen 7 are NOT cleared: clear both
'     screens yourself and call SpritesReset()). SpritesSync draws on the
'     hidden screen and SpritesFlip shows it. The two lists alternate, so a
'     sprite unchanged for two frames is not touched.
'   Otherwise (48K, or SpritesInit(0)): one screen, SpritesSync changes it
'     in place; unchanged sprites are skipped, the rest can flicker where the
'     beam catches them. Pace the frames with HALT before SpritesSync.
' The bank and screen switching is done directly (asm, in sprites.asm), not
' with cb/maskedsprites.bas: its CheckMemoryPaging and SetDrawingScreen7
' are FASTCALL routines with locals but no frame of their own, which
' corrupt the locals of a SUB that calls them (and crashed when called
' from SpritesInit). So this library does not include that file, and does
' not touch Boriel's screen variables: PRINT and PLOT keep using screen 5.
' SpritesScreen() gives the address of the screen being drawn on if the
' program wants to draw there itself (bitmap at that address, attributes
' at +&1800).
'
' ---------------- Cost ----------------
' Measured on the chips emulator (tests/zx runner's machine; 28 wide
' sprites a frame, every one changing every frame, so each is erased and
' drawn; T-states per sprite, from FRAMES over 11,200 sprites with the
' BASIC queueing loop subtracted, interrupts on):
'   wide, with attribute, x multiple of 8   3,300  (erase + draw + attrs)
'   wide, with attribute, x = 4 mod 8       3,900  (3 bytes a row)
'   wide, no attribute                      2,700
'   narrow, with attribute                  2,200
'   narrow, no attribute                    1,650
' (the same on the 48K and the 128K, single or double-buffered, within 1 %.
' The game's header quotes about 4.7K a sprite for its own routine, which
' was measured with its call overhead and not by this method.)
' SpriteAdd from BASIC adds about 1,500 T-states a sprite (the call, and
' the loop around it in the measurement); an unchanged sprite costs about
' 270 T-states a frame (compare only), all in.
' Size added to a program: about 2.3 KB of code (the engine is about 1.6
' KB, most of it the unrolled draw and restore loops), plus the data area
' above (2.9 KB by default; not in the program file).
'
' Skipping. SpritesSync keeps the leading run of the screen's old list that
' equals the new list (same image, x, y) and touches nothing there; it
' erases the rest of the old list in reverse order and draws the rest of the
' new. Only a prefix can be kept, which is what keeps the erase order right.
' So put the sprites that move least FIRST in the list.
'
' Written from scratch for this project (MIT); the engine is the generic
' form of Starfall's former Spectrum layer's engine.
' ----------------------------------------------------------------

#ifndef __LIBRARY_ZXBUILD_SPRITES__
#define __LIBRARY_ZXBUILD_SPRITES__

#ifndef __ZX48K__
#error "zxbuild is for --arch zx48k only"
#endif

#ifndef ZXSPR_BASE
#define ZXSPR_BASE 0xDB00
#endif
#ifndef ZXSPR_MAX
#define ZXSPR_MAX 28
#endif
#ifndef ZXSPR_IMAGES
#define ZXSPR_IMAGES 16
#endif

#if ZXSPR_MAX > 63 || ZXSPR_IMAGES > 64
#error "zxbuild/sprites: ZXSPR_MAX at most 63, ZXSPR_IMAGES at most 64"
#endif

' the areas (also used by the assembler: the EQUs in SpritesInit)
#define ZXS_REC1   (ZXSPR_BASE + 16 * ZXSPR_MAX)
#define ZXS_BG     (ZXSPR_BASE + 32 * ZXSPR_MAX)
#define ZXS_BG1    (ZXSPR_BASE + 56 * ZXSPR_MAX)
#define ZXS_IMGTAB (ZXSPR_BASE + 80 * ZXSPR_MAX)
#define ZXS_IMGS   (ZXS_IMGTAB + 4 * ZXSPR_IMAGES)
#define ZXS_IMGEND (ZXS_IMGS + 40 * ZXSPR_IMAGES)
#define ZXS_Q      ZXS_IMGEND

#pragma push(case_insensitive)
#pragma case_insensitive = TRUE

' the constants of sprites.asm (EQUs: no code, no bytes)
ASM
    push namespace core
__ZXS_NS    equ ZXSPR_MAX
__ZXS_NI    equ ZXSPR_IMAGES
__ZXS_REC   equ ZXSPR_BASE
__ZXS_REC1  equ ZXS_REC1
__ZXS_BG    equ ZXS_BG
__ZXS_BG1   equ ZXS_BG1
__ZXS_IMGTAB equ ZXS_IMGTAB
__ZXS_Q     equ ZXS_Q
    pop namespace
END ASM

DIM zxsDbl AS UBYTE             ' 1: double-buffered
DIM zxsNext AS UINTEGER         ' next free byte of the image area (0: not initialised)

FUNCTION FASTCALL ZxsPaging() AS UBYTE
    ASM
    push namespace core
    call __ZXS_PAGING
    pop namespace
    END ASM
    #require "zxbuild/sprites.asm"
END FUNCTION

SUB FASTCALL ZxsEnter()
    ASM
    push namespace core
    call __ZXS_ENTER
    pop namespace
    END ASM
    #require "zxbuild/sprites.asm"
END SUB

SUB FASTCALL ZxsLeave()
    ASM
    push namespace core
    call __ZXS_LEAVE
    pop namespace
    END ASM
    #require "zxbuild/sprites.asm"
END SUB

SUB FASTCALL ZxsFlip()
    ASM
    push namespace core
    call __ZXS_FLIP
    pop namespace
    END ASM
    #require "zxbuild/sprites.asm"
END SUB

SUB FASTCALL ZxsAsmInit(hi AS UBYTE)
    ASM
    push namespace core
    call __ZXS_INIT
    pop namespace
    END ASM
    #require "zxbuild/sprites.asm"
END SUB

FUNCTION SpritesInit(double AS UBYTE) AS UBYTE
    zxsDbl = 0
    IF double THEN zxsDbl = ZxsPaging()
    IF zxsDbl THEN
        ZxsEnter()                  ' bank 7 at &C000 for good, screen 5 shown
        ZxsAsmInit(192)             ' drawn on screen 7 first, then flipped
    ELSE
        ZxsAsmInit(64)
    END IF
    zxsNext = ZXS_IMGS
    RETURN zxsDbl
END FUNCTION

SUB SpritesDone()
    IF zxsDbl THEN
        ZxsLeave()
        zxsDbl = 0
    END IF
END SUB

' the base address of the screen being drawn on (&4000 or &C000)
FUNCTION FASTCALL SpritesScreen() AS UINTEGER
    ASM
    push namespace core
    ld a, (__ZXS_SCRHI)
    ld h, a
    ld l, 0
    pop namespace
    END ASM
    #require "zxbuild/sprites.asm"
END FUNCTION

' Build image n from the art at src. Wide: 8 rows of 2 bytes, then the same
' shifted right by 4 pixels, 8 rows of 3 bytes (40 bytes). Narrow: 4 rows of
' 1 byte, then shifted (8 bytes).
SUB SpriteImage(n AS UBYTE, src AS UINTEGER, wide AS UBYTE, attr AS UBYTE)
    DIM r, l, rt AS UBYTE
    DIM t, dst AS UINTEGER
    IF n >= ZXSPR_IMAGES OR zxsNext = 0 THEN RETURN
    dst = zxsNext
    IF wide THEN
        IF dst + 40 > ZXS_IMGEND THEN RETURN
        FOR r = 0 TO 7
            l = PEEK(src + r * 2): rt = PEEK(src + r * 2 + 1)
            POKE dst + r * 2, l
            POKE dst + r * 2 + 1, rt
            POKE dst + 16 + r * 3, l >> 4
            POKE dst + 16 + r * 3 + 1, ((l BAND 15) << 4) BOR (rt >> 4)
            POKE dst + 16 + r * 3 + 2, (rt BAND 15) << 4
        NEXT r
        zxsNext = dst + 40
    ELSE
        IF dst + 8 > ZXS_IMGEND THEN RETURN
        FOR r = 0 TO 3
            l = PEEK(src + r)
            POKE dst + r, l BAND 240
            POKE dst + 4 + r, l >> 4
        NEXT r
        zxsNext = dst + 8
    END IF
    t = ZXS_IMGTAB + CAST(UINTEGER, n) * 4
    POKE UINTEGER t, dst
    POKE t + 2, attr
    IF wide THEN POKE t + 3, 0 ELSE POKE t + 3, 1
END SUB

SUB SpritesBegin()
    ASM
    push namespace core
    call __ZXS_QRESET
    pop namespace
    END ASM
    #require "zxbuild/sprites.asm"
END SUB

SUB SpriteAdd(n AS UBYTE, x AS UBYTE, y AS UBYTE)
    ASM
    ld b, (ix+5)
    ld d, (ix+7)
    ld e, (ix+9)
    push namespace core
    call __ZXS_SPRITE
    pop namespace
    END ASM
    #require "zxbuild/sprites.asm"
END SUB

SUB SpritesSync()
    ASM
    push namespace core
    call __ZXS_SYNC
    pop namespace
    END ASM
    #require "zxbuild/sprites.asm"
END SUB

SUB SpritesFlip()
    IF zxsDbl THEN ZxsFlip()
    #require "zxbuild/sprites.asm"
END SUB

SUB SpritesReset()
    ASM
    push namespace core
    call __ZXS_RESET
    pop namespace
    END ASM
    #require "zxbuild/sprites.asm"
END SUB

#pragma pop(case_insensitive)

#endif

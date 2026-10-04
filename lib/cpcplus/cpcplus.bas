' ----------------------------------------------------------------
' cpcplus/cpcplus.bas -- the CPC Plus / GX4000 ASIC (--arch cpc)
'
'   PlusAvailable()               1 on a Plus or GX4000, 0 on a 464/664/6128
'   PlusUnlock()                  unlock the ASIC (the calls below do it
'                                 for you the first time)
'   PlusLock()                    lock it again (in bare mode this first
'                                 ends any raster interrupts)
'   PlusPageIn() / PlusPageOut()  the ASIC's registers at &4000-&7FFF, for
'                                 programs that poke them themselves (the
'                                 only calls that still reserve &4000-&7FFF)
'   PlusPeek(addr) / PlusPoke(addr, value)
'                                 one byte of the ASIC page (addr in
'                                 &4000-&7FFF, else ignored / 0), with the
'                                 paging done for you: the way to reach
'                                 registers this library has no call for
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
'   ScrollFine(dx, dy)            soft scroll: the picture moves dx (0-15)
'                                 mode-2 pixels right and dy (0-7) lines up
'   ScrollBorder(flag)            1: widen the left border by 16 mode-2
'                                 pixels (hides the scroll's left edge); 0
'   SplitScreen(line, addr)       from scan line `line` (1-255; a multiple
'                                 of 8 for a clean split) the CRTC shows
'                                 the screen at byte address addr (&C000,
'                                 &4000, ... + a word offset; bit 0 is
'                                 dropped), like a second R12/R13
'   SplitScreenCrtc(line, crtc)   the same with the address as the CRTC's
'                                 own word: crtc = R12 * 256 + R13
'   SplitOff()                    no split
'
'   RasterIntAt(line, handler)    BARE MODE ONLY: the machine-code routine at
'                                 handler runs once a frame at scan line
'                                 `line` (1-255), with interrupts off and
'                                 all registers saved
'   RasterIntOff(line)            removes that line
'   RasterIntClear()              removes them all
'
'   DmaStart(channel, addr)       channel 0-2 plays the list of 16-bit
'                                 instructions at addr (even address);
'                                 returns 1, or 0 if refused
'   DmaStop(channel)              stops it
'   DmaActive()                   bit n set = channel n running
'   DmaPrescaler(channel, value)  time unit of the channel's PAUSEs, used
'                                 by its next DmaStart
'   DmaAlign(addr)                the next even address (for a list in an
'                                 array one word longer than needed)
'   DMA_LOAD(reg, value), DMA_PAUSE(n), DMA_REPEAT(n), DMA_NOP, DMA_LOOP,
'   DMA_INT, DMA_STOP            the words of a list (see below)
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
' Memory: no 16 KB limit. The library no longer reserves &4000-&7FFF: a
' program may be as big as the memory map allows (firmware mode: code and
' data up to &9DFF minus the heap; bare: &B7FF), with code, data and the
' pictures it copies lying anywhere, &4000-&7FFF included. The ASIC page
' replaces that range while it is in, so the few instructions that page it in,
' copy or poke, and page it out run from the runtime's private block (copied
' there at start-up, 58 bytes at PL_TRAMP, offset &300, plus a 64-byte bounce
' buffer at &340: runtime/sysvars.asm; firmware layout &9E00, bare &BC00), and
' data in &4000-&7FFF is copied through the bounce buffer. Interrupts are off
' for each window only (a byte: 0.1 ms; a sprite picture from outside
' &4000-&7FFF: 1.4 ms; from inside it, or packed: 64 bytes a window), and the
' state is put back, so the calls work from main code and from a frame hook
' (interrupts off there) alike. Only PlusPageIn/PlusPageOut hand the page to
' the program, so a program that uses them must end below &4000 (they reserve
' it, as double buffering does) and its own code between them must not
' touch &4000-&7FFF; they leave interrupts off until PlusPageOut (keep what
' lies between short, the 3.3 ms rule of the banks). The RAM bank window and
' the 6128 back screen are hidden, not changed, while the page is in.
' Don't change the Gate Array's RMR2 (&7Fxx, bits 7-5 = 101) yourself;
' the library puts it back to &A0 (lower ROM page 0 at &0000), its reset
' value, and keeps no other copy.
'
' A program that ends with END and has sprites on should call
' SpritesHideAll() first: the sprites are ASIC state, not screen memory
' (soft scroll and split screen likewise: ScrollFine(0, 0), SplitOff()).
'
' Soft scroll (SSCR) and split screen (SSSL/SSA), both modes. Units, from
' Caprice32's and CPCEC's code: dx is in mode-2 pixels (1/640 of the picture
' width; a mode-1 pixel is 2 units, a mode-0 pixel 4) and moves the picture
' to the RIGHT; dy is in scan lines and moves it UP (the lines shown start dy
' lines into each character row, the last dy lines of the row come from the
' next row, so keep a spare row of data below the picture). Whole bytes are
' still moved with the CRTC start address (R12/R13, or FlipBuffer): the two
' add up. ScrollBorder(1) extends the left border to hide the garbage on the
' left edge of the picture that a horizontal scroll uncovers. Values above the
' range are cut to it. SplitScreen switches the CRTC's start address at the
' start of scan line `line` (counted from the top of the picture, as the
' raster interrupt's line); the address is a byte address like SCREEN_ADDR's
' &C000: bits 15-14 pick the 16 KB page, bits 10-1 the word offset within
' 2 KB (bits 13-11 are the line within a character row, not part of it); in
' CRTC terms R12 = page bits 5-4 | offset bits 9-8, R13 = offset bits 7-0.
' With cpcbuild's double buffer, the split address is independent of
' FlipBuffer's R12/R13: give the address of whichever screen part should
' appear (e.g. a status panel somewhere in the other 16 KB), and the lines
' that follow the split line continue within that part. A clean split is on
' a multiple of the character height (8): in between, the raster line within
' the character row carries over. SplitOff() or ScrollFine(0, 0) before END.
'
' Raster interrupts (bare mode only, -D CPC_BAREMETAL; firmware mode refuses
' them at build time with "Undefined GLOBAL label ...RasterIntAt_needs_bare_
' mode__build_with_D_CPC_BAREMETAL"). The ASIC's programmable raster interrupt
' (PRI) stops the CPC's ordinary six interrupts per frame while it is set
' (both emulators; the firmware's keyboard scan, clock and sound queue need
' them, hence bare only). The library's handler (replacing the bare runtime's at
' &0038 while any line is set) keeps a table of up to 15 lines plus one
' internal entry at line 243 that does the frame work, so Frames(), PAUSE,
' BEEP and the frame hook keep their 50 Hz; each interrupt programs the
' next line into PRI before it runs the handlers of the line that fired.
' A handler is an asm routine ending in RET (address from a function
' with an ASM block, as FrameHook's); it runs with interrupts off and AF, BC,
' DE, HL, IX, IY and the alternate set saved, must not call the firmware, and
' must not call RasterIntAt/Off/Clear. The next line is
' programmed first, so a handler that is still running when the next line is
' reached only delays it. Timing: the Z80 finishes its current instruction
' before it takes the interrupt, so a colour change from a handler lands
' part-way along the line and, if the main program is busy, jitters
' sideways by up to that instruction's length (a few characters) from frame
' to frame. For a steady split, have the main program wait in HALT while
' the lines go by (PAUSE and WaitVsync do; a game draws, then waits for the
' next frame): the interrupt is then taken with a fixed delay (checked on
' Caprice32 and CPCEC). Lines are counted from the first line of the picture
' (the standard 200-line screen's sync starts at line 240); a handler of the
' same line as the frame entry (243) runs before the frame hook; two handlers
' on one line are not possible (the second replaces the first). RasterIntAt
' with a line already set replaces its handler; RasterIntOff of a line not
' set does nothing; the table full (15 lines) ignores the call. When the
' last line is removed (or RasterIntClear), PRI goes back to 0 and the
' ordinary handler returns. Switching on can run one ordinary interrupt
' first and the frame count may skip or repeat one frame. PlusLock and END's
' reset (an exit routine in CPC_EXIT_VEC, runtime/sysvars.asm) clear the
' raster interrupts. An INT instruction in a DMA list raises an interrupt that
' neither handler acknowledges: do not use it.
'
' DMA sound (both modes). Each channel fetches one 16-bit instruction a scan
' line from its list in RAM (when it is not pausing) and executes it; the
' address moves on by 2 (the words are stored low byte first, as a
' DIM list(n) AS UINTEGER holds them):
'   DMA_LOAD(reg, value)   write value to AY register reg (0-15) (&0RVV)
'   DMA_PAUSE(n)           wait n * (prescaler + 1) lines, n 0-4095 (&1NNN)
'   DMA_REPEAT(n)          mark the next instruction as a loop start and
'                          run the loop n more times (&2NNN)
'   DMA_LOOP               jump back to the loop start while passes remain
'                          (&4001)
'   DMA_NOP (&4000)  DMA_STOP (&4020: the channel stops)  DMA_INT (&4010)
' PAUSE and REPEAT can be combined with +; so can the three &4xxx flags.
' Where lists may be: anywhere in the first 64 KB of RAM at an even address, in
' &4000-&7FFF too (the DMA reads RAM as it is, not through the ASIC page, ROMs
' or the register page; not in the extra RAM banks). Declare a list as an
' array of UINTEGER one word too long and use DmaAlign(@list(0)) as its
' start (POKE UINTEGER there), or write it in an ASM block after ALIGN 2.
' It must stay unchanged until it has run or DmaStop. The three channels
' are independent; a channel is conventionally the AY channel of its number,
' but LOAD can write any register. The prescaler (DmaPrescaler, 0-255) is
' the time unit of the PAUSEs. The DMA writes the AY by itself: do not run the
' music player, BEEP, Play or AyWrite on the same registers while it runs, and
' in firmware mode do not queue sounds (SoundQueue, BEEP: the firmware's
' sound manager writes the AY from its own interrupt) on the chip while DMA
' lists run. DmaActive() reads the status register (DCSR): on a real ASIC and
' in CPCEC a channel's bit goes off when its list reaches STOP; Caprice32
' updates DCSR in RAM instead of the register when the ASIC page is out
' (it also writes the channel address registers there, &6C00-&6C0F: keep
' those 16 bytes free when testing on it), so there DmaActive() only reflects
' DmaStart/DmaStop. Facts and sources: docs/notes.md, Phase 7 P3.
'
' Both modes (firmware, -D CPC_BAREMETAL). Written from scratch for this
' project (MIT). Facts and sources: docs/notes.md, Phase 7 P2 and P3.
' ----------------------------------------------------------------

#ifndef __LIBRARY_CPCPLUS__
#define __LIBRARY_CPCPLUS__

#ifndef __CPC__
#error "cpcplus is for --arch cpc only"
#endif

#include once <cpcbuild/reserve.bas>

REM The words of a DMA list (see the header).
#define DMA_LOAD(reg, value) ((((reg) BAND 15) * 256) + ((value) BAND 255))
#define DMA_PAUSE(n) (4096 + ((n) BAND 4095))
#define DMA_REPEAT(n) (8192 + ((n) BAND 4095))
#define DMA_NOP 16384
#define DMA_LOOP 16385
#define DMA_INT 16400
#define DMA_STOP 16416

#pragma push(case_insensitive)
#pragma case_insensitive = TRUE

function PlusAvailable() as ubyte
    asm
    push namespace core
    call __PL_AVAIL
    pop namespace
    end asm
end function

sub PlusUnlock()
    asm
    push namespace core
    call __PL_ENSURE
    pop namespace
    end asm
end sub

sub PlusLock()
    asm
    push namespace core
#ifdef CPC_BAREMETAL
    call __RI_CLEAR         ; the raster handler writes PRI through the ASIC page
#endif
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
    asm
    push namespace core
    ld a, (ix+5)
    call __PL_GETCOL
    pop namespace
    end asm
end function

sub SetPalette12Block(addr as uinteger, first as ubyte, count as ubyte)
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
    asm
    push namespace core
    call __PL_MOVE
    pop namespace
    end asm
end sub

sub SpriteMag(n as ubyte, magx as ubyte, magy as ubyte)
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
    asm
    push namespace core
    ld a, (ix+5)
    ld e, 0
    call __PL_MAGREG
    pop namespace
    end asm
end sub

sub SpritesHideAll()
    asm
    push namespace core
    call __PL_HIDEALL
    pop namespace
    end asm
end sub

function PlusPeek(addr as uinteger) as ubyte
    asm
    push namespace core
    PROC
    LOCAL __PLB_PK_NO, __PLB_PK_END
    ld l, (ix+4)
    ld h, (ix+5)
    ld a, h
    cp $40
    jr c, __PLB_PK_NO
    cp $80
    jr nc, __PLB_PK_NO
    call __PL_ENSURE
    jr nc, __PLB_PK_NO
    ld l, (ix+4)
    ld h, (ix+5)
    call __PL_PEEK
    jr __PLB_PK_END
__PLB_PK_NO:
    xor a
__PLB_PK_END:
    ENDP
    pop namespace
    end asm
end function

sub PlusPoke(addr as uinteger, value as ubyte)
    asm
    push namespace core
    PROC
    LOCAL __PLB_PO_END
    ld l, (ix+4)
    ld h, (ix+5)
    ld a, h
    cp $40
    jr c, __PLB_PO_END
    cp $80
    jr nc, __PLB_PO_END
    call __PL_ENSURE
    jr nc, __PLB_PO_END
    ld l, (ix+4)
    ld h, (ix+5)
    ld a, (ix+7)
    call __PL_POKE
__PLB_PO_END:
    ENDP
    pop namespace
    end asm
end sub

sub ScrollFine(dx as ubyte, dy as ubyte)
    asm
    push namespace core
    ld b, (ix+5)
    ld c, (ix+7)
    call __PL_SCROLL
    pop namespace
    end asm
end sub

sub ScrollBorder(flag as ubyte)
    asm
    push namespace core
    ld a, (ix+5)
    call __PL_SCRBORDER
    pop namespace
    end asm
end sub

sub SplitScreen(line as ubyte, addr as uinteger)
    asm
    push namespace core
    ld l, (ix+6)
    ld h, (ix+7)
    call __PL_ADDR2CRTC
    ld a, (ix+5)
    call __PL_SPLIT
    pop namespace
    end asm
end sub

sub SplitScreenCrtc(line as ubyte, crtc as uinteger)
    asm
    push namespace core
    ld l, (ix+6)
    ld h, (ix+7)
    ld a, (ix+5)
    call __PL_SPLIT
    pop namespace
    end asm
end sub

sub SplitOff()
    asm
    push namespace core
    xor a
    call __PL_SPLIT
    pop namespace
    end asm
end sub

#ifdef CPC_BAREMETAL
sub RasterIntAt(line as ubyte, handler as uinteger)
    asm
    push namespace core
    ld a, (ix+5)
    ld l, (ix+6)
    ld h, (ix+7)
    call __RI_AT
    pop namespace
    end asm
end sub

sub RasterIntOff(line as ubyte)
    asm
    push namespace core
    ld a, (ix+5)
    call __RI_OFF
    pop namespace
    end asm
end sub

sub RasterIntClear()
    asm
    push namespace core
    call __RI_CLEAR
    pop namespace
    end asm
end sub
#else
' Firmware mode: refused at compile time, with an "Undefined GLOBAL label" error
' whose name says why (an unused call is ignored as usual).
sub RasterIntAt(line as ubyte, handler as uinteger)
    asm
    call .core.RasterIntAt_needs_bare_mode__build_with_D_CPC_BAREMETAL
    end asm
end sub

sub RasterIntOff(line as ubyte)
    asm
    call .core.RasterIntOff_needs_bare_mode__build_with_D_CPC_BAREMETAL
    end asm
end sub

sub RasterIntClear()
    asm
    call .core.RasterIntClear_needs_bare_mode__build_with_D_CPC_BAREMETAL
    end asm
end sub
#endif

sub DmaPrescaler(channel as ubyte, value as ubyte)
    asm
    push namespace core
    ld a, (ix+5)
    ld e, (ix+7)
    call __PL_DMAPRESC
    pop namespace
    end asm
end sub

function DmaStart(channel as ubyte, addr as uinteger) as ubyte
    asm
    push namespace core
    ld a, (ix+5)
    ld l, (ix+6)
    ld h, (ix+7)
    call __PL_DMASTART
    pop namespace
    end asm
end function

sub DmaStop(channel as ubyte)
    asm
    push namespace core
    ld a, (ix+5)
    call __PL_DMASTOP
    pop namespace
    end asm
end sub

function DmaAlign(addr as uinteger) as uinteger
    return (addr + 1) band $FFFE
end function

function DmaActive() as ubyte
    asm
    push namespace core
    call __PL_DMAACTIVE
    pop namespace
    end asm
end function

#pragma pop(case_insensitive)

#require "cpcplus/plus.asm"
#require "cpcplus/plusgfx.asm"
#require "cpcplus/plusscr.asm"
#require "cpcplus/plusdma.asm"
#ifdef CPC_BAREMETAL
#require "cpcplus/plusraster.asm"
#endif

#endif

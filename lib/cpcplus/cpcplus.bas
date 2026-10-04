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
'   PlusPokeBlock(dest, src, count)
'                                 count bytes from RAM at src to the ASIC
'                                 page at dest (&4000-&7FFF), in one window
'                                 (interrupts off for 6 us a byte, 1.5 ms for
'                                 256; a source in &4000-&7FFF is bounced,
'                                 64 bytes a window): a program that keeps
'                                 its sprite registers in a table writes
'                                 the whole block once a frame. A block that
'                                 would run past &7FFF is cut there; a dest
'                                 outside the page does nothing
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
'                                 (unpacked on the stack, which needs about
'                                 270 bytes free, then ONE window of 1.5 ms)
'   SpriteMove(n, x, y)           position, see below
'   SpriteMoveBlock(first, count, addr)
'                                 positions of sprites first.. first+count-1
'                                 (cut at 15) from a table at addr, 4 bytes a
'                                 sprite: x then y, each an INTEGER, low byte
'                                 first (what DIM t(2 * count - 1) AS INTEGER
'                                 holds: x0, y0, x1, y1, ...), all in ONE
'                                 window. NOT clamped, for speed: x must be
'                                 -256..767 and y -256..255 (the ASIC keeps
'                                 its own low 10 / 9 bits of anything else);
'                                 use SpriteMove for values that may stray
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
'   RasterIntMove(oldLine, newLine)
'                                 BARE MODE ONLY: moves a set line to another
'                                 line, keeping its handler, 2-5 times cheaper
'                                 than Off + At (see "Moving a line" below);
'                                 returns 1 if moved, 0 if refused (oldLine not
'                                 a set line, newLine already set, a 0)
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

' Cost of the calls (Caprice32 and CPCEC agree; tests/conformance/plus_speed.bas
' measures them with Frames()/Ticks() over 1500 calls (200 for the pictures) and asserts
' bounds). Net microseconds a call adds to BASIC's own call overhead (an empty SUB of the
' same signature in a loop: about 93 us), before the speed work -> now. Bare mode /
' firmware mode (firmware mode's figures include the firmware's own interrupts, which take
' about a quarter of the time, so everything there looks slower):
'   SetPalette12, SetBorder12   279 -> 93 / 424 -> 131   (two palette bytes in one window)
'   SpriteColour                279 -> 106 / 319 -> 131
'   SpriteMove (in range)       359 -> 106 / 395 -> 133  (four bytes in one window; out of
'                                range it takes the general clamping path, slower)
'   SpriteMoveBlock             first call-to-call: 8 sprites 360, 16 sprites 590 (28 us a
'                               sprite plus a fixed 130): 8 SpriteMove calls cost 850
'   SetPalette12Block(16)       about 410 (all 32 bytes in one window, 24 T-states a byte)
'   ScrollFine, SpriteMag       about 150 / 190 (one byte a window, unchanged)
' Pictures and blocks, in MILLISECONDS a call including BASIC's call overhead (an LDIR
' byte is 24 T-states on the CPC, 6 us, not the 21 T-states of the Z80 manual: its refresh
' and wait-state rounding; so a block is 6 us a byte plus about 0.3 ms of fixed cost, and an
' earlier version of this table that said 1.4 ms a picture was the LDIR alone, 1.5 ms
' for 256 bytes):
'                                      before         now         (bare / firmware)
'   SpriteSetImage(n, addr)            1.8 / 2.0      1.8 / 2.0   source outside &4000-&7FFF
'     source inside &4000-&7FFF        3.9 / 4.3      same        (copied twice: bounce buffer)
'   SpriteSetImagePacked(n, addr)      5.5 / 6.1      4.7 / 5.2   either source (unpacking is
'                                                                  2.9 ms of it, interrupts on)
'   PlusPokeBlock 88 bytes             0.9 / 0.97     0.85 / 0.93  (wrapper trimmed; measured
'   PlusPokeBlock 256 bytes            1.9 / 2.1      1.85 / 2.05   to within the 0.1 ms noise)
'     256 bytes from inside &4000-&7FFF 3.9 / 4.3     same
'   RasterIntMove (bare), in place     -              0.19 net (0.26 with the call)
'   RasterIntMove, across other lines  -              about 0.5 net
'   RasterIntAt + RasterIntOff pair    1.0 total      (unchanged; what Move replaces)
' The picture and block calls are the cost of copying through the Z80 and cannot get much
' lower from BASIC. Unpacking a picture straight into the ASIC page would save the second
' copy (about 1.5 ms) but needs code that runs while the page is in, and that code can only
' be the library's own private 58+118 bytes (full) or program code that happens to lie
' outside &4000-&7FFF; it would also keep interrupts off for 2.9 ms. A program that wants the
' speed keeps its pictures unpacked (img2cpc.py's default) and, from a raster handler or at
' the frame tick, copies them itself with PlusHandlerIn/Out and an LDIR (as Starfall's
' cartridge does: about 0.8 ms for 128 bytes, no BASIC call, no probe test).
' The first call of a program probes the ASIC and unlocks it (once, slower). Pens
' and the border in firmware mode also stop the firmware's ink refresh the first time
' after each Mode() (a few hundred T-states once), and cost 48 T-states more every call.
' PlusPageIn() in force, a locked ASIC and "no ASIC" take the slower general paths
' (the old costs, or a no-op). The interrupt-off window of each call: SetPalette12,
' SpriteMove: about 130 T-states (35 us); SpriteMoveBlock: 35 us plus 23 us a sprite;
' SetPalette12Block: 0.2 ms for 16 colours; a sprite picture from outside &4000-&7FFF
' or packed: 1.5 ms (one window; from inside: 64 bytes, 0.4 ms, a window); PlusPokeBlock:
' 6 us a byte (outside source) or 0.4 ms (inside source, a window per 64 bytes).
'
' Handler context: the cheap way for a raster handler or frame hook to touch the ASIC.
' A raster handler (RasterIntAt) or a frame hook runs with interrupts already off and
' cannot afford the calls above. The ASM-callable entry points below skip the interrupt
' state handling and the probe check; for them the program must have unlocked the ASIC
' (PlusUnlock() or any call above) on a machine where PlusAvailable() is 1, and must not
' have called PlusLock: they must never run on a CPC without ASIC (the page-in write
' would change the Gate Array's screen mode and ROM state). Call from an ASM block as
' `call .core.NAME`:
'   PlusHandlerIn / PlusHandlerOut    page the ASIC register page in at &4000-&7FFF /
'                                     out again (RMR2 &B8 / &A0): 49 T-states each, BC
'                                     clobbered. Between them the handler stores
'                                     straight to ASIC addresses (`ld (&6400), de` is
'                                     pen 0 with E = red << 4 | blue, D = green: 20
'                                     T-states; `ld (&6420), de` the border; `ld a, v:
'                                     ld (&6804), a` the scroll). The paging code runs
'                                     from the library's private block, so the call
'                                     returns into the handler's own code wherever it
'                                     is, BUT between In and Out &4000-&7FFF is the
'                                     ASIC: the handler's code, the data it reads or
'                                     writes and its stack must all be outside it
'                                     (program below &4000, as every program that uses
'                                     double buffering is, or the handler's code placed
'                                     from &8000 up; the stack is always outside). No
'                                     EI, no firmware call, no library call between.
'                                     In + Out + two word stores: about 150 T-states.
' The entry points below need the line  #require "cpcplus/plushandler.asm"  once in
' the program; they do their own paging (so they have no placement rule), do nothing
' while the ASIC is not unlocked, and keep the interrupt state:
'   PlusHandlerSetColourRaw   A = entry (0-15 pens, 16 border, 17-31 sprite colours;
'                             above 31 ignored), DE = E: red << 4 | blue, D: green.
'                             155 T-states. DE kept; clobbers AF, BC, HL.
'   PlusHandlerSetColour      A = entry, HL = &0RGB. About 285 T-states.
'                             Clobbers AF, BC, DE, HL.
'   PlusHandlerPoke           A = value, HL = ASIC address (&4000-&7FFF). 118 T-states.
'                             Clobbers AF, BC, D.
'   PlusHandlerScroll         B = dx (0-15), C = dy (0-7), as ScrollFine. About 250
'                             T-states. Clobbers AF, BC, HL.
' None of them stops the firmware's ink refresh (firmware mode, frame hooks only;
' raster handlers are bare mode): set a pen or the border once from the main program.
' (examples/plusdemo.bas does all of this: a pen 0 and border change per bar.)
'
' Raster handler timing (counted from the library's handler, __RI_ISR in
' plusraster.asm, at 4 MHz with the CPC's 4-T-state rounding; a scan line is 256
' T-states, 64 us; not measured on hardware):
'   - A handler's first instruction runs about 620 T-states (2.4 lines) after the
'     interrupt is taken, plus up to 23 for the instruction the Z80 finishes first:
'     a colour change from a handler lands that late. Ask for the line three lines
'     before the one you want the change on, and keep the handler's own time in mind.
'   - Once the handler returns, the interrupt handler needs about 300 T-states more
'     before it re-enables interrupts (it saves and restores everything, IX, IY and the
'     alternate set among it). So a line's total cost is about 920 T-states (3.6 lines) +
'     the handler's T-states, with nothing else running, and the NEXT line can only
'     fire after that: lines closer together than (920 + handler) / 256 lines (with
'     a 100 T-state handler, 4 lines; with a 300 T-state one, 5) are delayed and then
'     the main program gets almost no time.
'   - The next line is programmed into PRI early (about 300 T-states in), so a line
'     that is reached while the handler is still running fires as soon as the handler
'     returns (late, not lost); a line already passed fires next frame.
'   - The HALT rule below still holds for steady positions.
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
' buffer at &340: runtime/sysvars.asm; firmware layout &9E00, bare &BC00; a second
' block of 118 bytes (the whole-window routines and the handler entries) at &380-&3FF,
' which sysvars.asm still lists as free), and
' data in &4000-&7FFF is copied through the bounce buffer. Interrupts are off
' for each window only (a byte or a colour: 0.1 ms; a sprite picture from outside
' &4000-&7FFF or packed: 1.5 ms; from inside it: 64 bytes a window), and the
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
' must not call RasterIntAt/Off/Move/Clear. The next line is
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
' Moving a line (RasterIntMove, bare mode only). RasterIntMove(oldLine, newLine) takes the
' user line oldLine to newLine and keeps its handler: the table stays sorted (the entries
' between the two places are shifted, nothing else), RI_IDX and PRI are put right, and no
' entry fires twice. It returns 1 when the line moved (also when oldLine =
' newLine and it is set) and 0, changing nothing, when oldLine is not a user line (the frame
' entry, line 243, cannot be moved), newLine is already a user line (move that one first;
' a newLine equal to 243 goes in before the frame entry, as RasterIntAt does), a line is 0,
' or no line is set. Cost: 0.19 ms net when the line stays between its neighbours (the common
' case: a raster bar or a sprite row sliding down), about 0.5 ms when it crosses other lines,
' against 1.0 ms for a RasterIntAt + RasterIntOff pair; interrupts off for that time (state
' kept). Check the returned value.
' WHEN IT IS SAFE. The table is shared with the interrupt handler, so the call itself changes
' it with interrupts off and is atomic, but it cannot know where the scan is. The entry that
' fires next has its line programmed into PRI; a line already passed fires next frame, and
' everything after it in the table (the other lines, the frame entry: Frames(), PAUSE, the
' frame hook) waits behind it. So call it where no line is imminent: in the vertical blank
' right after the frame tick (WaitVsync, PAUSE or a Frames() change returns there, and the
' first line of the frame is still lines away), in a frame hook, or at any time for a line
' that stays where it is relative to the scan. Never from a raster handler (they must not
' change the table). A line moved to a place before the entry that fires next fires next
' frame, not this one, EXCEPT when no line of the frame has fired yet (the vertical blank
' after the tick): then it is the first to fire this frame. So moving the lines of a
' multiplexed display (Starfall's formation rows) once a frame from the code that follows the
' frame tick is exact.
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

sub SpriteMoveBlock(first as ubyte, count as ubyte, addr as uinteger)
    asm
    push namespace core
    ld a, (ix+5)
    ld c, (ix+7)
    ld l, (ix+8)
    ld h, (ix+9)
    call __PL_MOVEBLK
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

sub PlusPokeBlock(dest as uinteger, src as uinteger, count as uinteger)
    asm
    push namespace core
    PROC
    LOCAL __PLB_PB_END, __PLB_PB_OK
    ld e, (ix+4)
    ld d, (ix+5)
    ld a, d
    cp $40
    jr c, __PLB_PB_END
    cp $80
    jr nc, __PLB_PB_END
    ld hl, $8000
    or a
    sbc hl, de              ; HL = room up to the end of the ASIC page
    ld c, (ix+8)
    ld b, (ix+9)
    ld a, b
    or c
    jr z, __PLB_PB_END
    or a
    sbc hl, bc              ; count cut to the room
    jr nc, __PLB_PB_OK
    add hl, bc
    ld b, h
    ld c, l
__PLB_PB_OK:
    call __PL_ENSURE2       ; (BC, DE, HL kept)
    jr nc, __PLB_PB_END
    ld l, (ix+6)
    ld h, (ix+7)
    call __PL_PUT
__PLB_PB_END:
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

' __RI_MOVE -- RasterIntMove: A = the line of a set user entry, E = the line
' it moves to (1-255). Returns A = 1 if it moved (or old = new and set), 0 if
' refused (old not a user line, new a user line already, either 0, raster mode
' off). The entry keeps its handler; the table stays sorted (a line equal to
' the frame entry's goes in before it, as RasterIntAt does). Only the entries
' between the old and the new position are shifted; RI_IDX, the entry that
' fires next, stays the same entry (identity; the rules are below) and PRI is
' reprogrammed from it.
' Hardware: PRI &6800 (one byte through the trampoline). Interrupts off for
' about 0.2 ms in place, 0.5 ms across lines (state restored). Registers
' clobbered: AF, BC, DE, HL. Not for raster handlers. Safe where no line is
' imminent: the vertical blank after the frame tick, a frame hook (see
' "Moving a line" in cpcplus.bas for the hazard: the entry that fires next
' moved to a line the scan has passed delays the rest of the frame).
'
' RI_IDX rules (p = old position, q = new position, I = RI_IDX):
'   I = p, q > p: I = p (the entry that followed the moved one);
'   I = p, q < p: I = p + 1 (the moved entry has passed for this frame; if that
'                 is past the end, I = 0, the next frame's first);
'   I < p, q < p, q <= I: I + 1   (the entry stays the next one; the moved entry
'                 has passed for this frame: it fires next frame), EXCEPT I = 0
'                 (no line of the frame has fired yet: all are still to come):
'                 I stays 0, the moved entry is the first to fire
'   I > p, q > p, I <= q: I - 1
'   otherwise unchanged.
' (The routine is the body of this function, so that a program that never calls
' RasterIntMove does not carry its 0.4 KB: an unused function is dropped whole. The
' state it uses, RI_N, RI_IDX, RI_LINE, RI_HAND, RI_TP, RI_TH, RI_TQ, RI_MV, is in
' plusraster.asm.)
function RasterIntMove(oldLine as ubyte, newLine as ubyte) as ubyte
    asm
    push namespace core
    PROC
    LOCAL __RM_HAND0, __RM_END, __RM_GEN, __RM_FWD, __RM_F2, __RM_FNEXT, __RM_FDONE
    LOCAL __RM_B, __RM_BNEXT, __RM_HAVEQ, __RM_UP, __RM_DOWN, __RM_WR, __RM_NONEXT, __RM_FAST
    LOCAL __RM_FIX2, __RM_IBEF, __RM_SETI, __RM_PRI, __RM_OK, __RM_NOEI, __RM_NO, __RM_NOPOP
    ld a, (ix+5)
    ld e, (ix+7)
    or   a
    jp   z, __RM_NO
    ld   d, a
    ld   a, e
    or   a
    jp   z, __RM_NO
    ld   a, (RI_N)
    or   a
    jp   z, __RM_NO
    ld   (RI_MV), de        ; RI_MV = new, RI_MV+1 = old
    call __PL_DI
    ld   a, (RI_N)
    ld   c, a
    ld   b, 0
    ld   hl, RI_LINE
    ld   a, d
    cpir                    ; the first entry on the old line
    jp   nz, __RM_NOEI
    ld   a, (RI_N)          ; C = N - (p + 1), HL = &LINE[p + 1]
    dec  a
    sub  c
    ld   b, a               ; B = p
    ld   (RI_TP), a
    add  a, a
    ld   e, a
    ld   d, 0
    push hl
    ld   hl, RI_HAND
    add  hl, de
    ld   a, (hl)
    inc  hl
    ld   h, (hl)
    ld   l, a               ; HL = its handler
    or   h
    jr   z, __RM_NOPOP      ; 0: the frame entry, not movable
    ld   (RI_TH), hl
    pop  hl                 ; HL = &LINE[p + 1]
    ld   a, (RI_MV)
    ld   e, a               ; E = new
    ld   a, (RI_MV+1)
    cp   e
    jp   z, __RM_OK
    ld   a, c               ; the quick way: the line stays between its
    or   a                  ; neighbours, so the table keeps its order
    jr   z, __RM_NONEXT
    ld   a, (hl)
    cp   e
    jr   c, __RM_GEN        ; the next line is below the new one
    jr   z, __RM_GEN        ; or equal to it
__RM_NONEXT:
    ld   a, b
    or   a
    jr   z, __RM_FAST
    dec  hl
    dec  hl
    ld   a, (hl)            ; the line before
    cp   e
    jr   nc, __RM_GEN       ; at or above the new one
__RM_FAST:
    ld   c, b
    ld   b, 0
    ld   hl, RI_LINE
    add  hl, bc
    ld   (hl), e
    ld   a, (RI_IDX)
    cp   c
    jp   nz, __RM_OK        ; (RI_IDX = p: PRI follows the entry's line)
    ld   a, e
    ld   hl, $6800
    call PLX1W
    jp   __RM_OK
__RM_NOPOP:
    pop  hl
    jp   __RM_NOEI
__RM_GEN:                   ; the general way: the entry changes place
    ld   a, (RI_MV)         ; new
    ld   b, a
    ld   a, (RI_MV+1)       ; old
    cp   b
    jr   c, __RM_FWD        ; old < new
    ld   a, (RI_TP)         ; new < old: j = p, walk down while the line
    ld   c, a               ; before j is above new
    ld   e, a
    ld   d, 0
    ld   hl, RI_LINE
    add  hl, de
__RM_B:
    ld   a, c
    or   a
    jr   z, __RM_HAVEQ
    dec  hl
    ld   a, (hl)
    cp   b
    jr   c, __RM_HAVEQ      ; below new: stop, q = j
    jr   nz, __RM_BNEXT     ; above new: past it
    push hl                 ; on new: a user entry there refuses
    ld   a, c
    dec  a
    call __RM_HAND0
    pop  hl
    jp   nz, __RM_NOEI
__RM_BNEXT:
    dec  c
    jr   __RM_B
__RM_FWD:                   ; old < new: j = p + 1, walk up while below new
    ld   a, (RI_TP)
    inc  a
    ld   c, a
    ld   e, a
    ld   d, 0
    ld   hl, RI_LINE
    add  hl, de
__RM_F2:
    ld   a, (RI_N)
    cp   c
    jr   z, __RM_FDONE
    ld   a, (hl)
    cp   b
    jr   c, __RM_FNEXT      ; below new
    jr   nz, __RM_FDONE     ; above new: stop
    push hl                 ; on new: a user entry there refuses, the
    ld   a, c               ; frame entry means go in before it
    call __RM_HAND0
    pop  hl
    jp   nz, __RM_NOEI
    jr   __RM_FDONE
__RM_FNEXT:
    inc  hl
    inc  c
    jr   __RM_F2
__RM_FDONE:
    dec  c                  ; q = j - 1
__RM_HAVEQ:                 ; C = q
    ld   a, c
    ld   (RI_TQ), a
    ld   a, (RI_TP)
    cp   c
    jr   z, __RM_WR         ; same place: just the line
    jr   c, __RM_DOWN       ; p < q: moved later
__RM_UP:                    ; q < p: entries q..p-1 move up one
    sub  c                  ; A = p - q
    ld   c, a
    ld   b, 0
    push bc
    ld   a, (RI_TP)
    dec  a
    ld   e, a
    ld   d, 0
    ld   hl, RI_LINE
    add  hl, de             ; HL = &LINE[p-1]
    ld   d, h
    ld   e, l
    inc  de
    lddr
    pop  bc
    sla  c
    ld   a, (RI_TP)
    add  a, a
    dec  a
    ld   e, a
    ld   d, 0
    ld   hl, RI_HAND
    add  hl, de             ; HL = &HAND[2p-1]
    ld   d, h
    ld   e, l
    inc  de
    inc  de
    lddr
    jr   __RM_WR
__RM_DOWN:                  ; p < q: entries p+1..q move down one
    ld   a, (RI_TQ)
    ld   hl, RI_TP
    sub  (hl)               ; A = q - p
    ld   c, a
    ld   b, 0
    push bc
    ld   a, (RI_TP)
    ld   e, a
    ld   d, 0
    ld   hl, RI_LINE
    add  hl, de
    ld   d, h
    ld   e, l               ; DE = &LINE[p]
    inc  hl                 ; HL = &LINE[p+1]
    ldir
    pop  bc
    sla  c
    ld   a, (RI_TP)
    add  a, a
    ld   e, a
    ld   d, 0
    ld   hl, RI_HAND
    add  hl, de
    ld   d, h
    ld   e, l               ; DE = &HAND[2p]
    inc  hl
    inc  hl
    ldir
__RM_WR:                    ; the entry goes in at q
    ld   a, (RI_TQ)
    ld   e, a
    ld   d, 0
    ld   hl, RI_LINE
    add  hl, de
    ld   a, (RI_MV)
    ld   (hl), a
    ld   hl, RI_HAND
    add  hl, de
    add  hl, de
    ld   de, (RI_TH)
    ld   (hl), e
    inc  hl
    ld   (hl), d
    ld   a, (RI_TQ)         ; the entry that fires next (see the rules)
    ld   c, a               ; C = q
    ld   a, (RI_TP)
    ld   b, a               ; B = p
    cp   c
    jr   z, __RM_PRI
    ld   a, (RI_IDX)
    ld   d, a               ; D = I
    cp   b
    jr   nz, __RM_FIX2
    ld   a, c               ; I = p
    cp   b
    jr   nc, __RM_PRI       ; q > p: I stays (the entry that followed)
    ld   a, d
    inc  a                  ; q < p: the entry after the moved one
    ld   hl, RI_N
    cp   (hl)
    jr   c, __RM_SETI
    xor  a                  ; past the end: next frame's first
__RM_SETI:
    ld   (RI_IDX), a
    jr   __RM_PRI
__RM_FIX2:
    ld   a, d
    cp   b
    jr   c, __RM_IBEF       ; I < p
    ld   a, c               ; I > p: only a move later reaches it
    cp   b
    jr   c, __RM_PRI        ; q < p
    ld   a, c
    cp   d
    jr   c, __RM_PRI        ; q < I
    dec  d
    ld   a, d
    ld   (RI_IDX), a
    jr   __RM_PRI
__RM_IBEF:                  ; I < p: only a move earlier, to q <= I
    ld   a, c
    cp   b
    jr   nc, __RM_PRI       ; q > p
    ld   a, d
    cp   c
    jr   c, __RM_PRI        ; I < q
    ld   a, d
    or   a
    jr   z, __RM_PRI        ; I = 0: no line of this frame has fired yet, so the
                            ; moved entry (q = 0) is the first to fire
    inc  d
    ld   a, d
    ld   (RI_IDX), a
__RM_PRI:
    call __RI_PRIIDX
__RM_OK:
    call __PL_EI
    ld   a, 1
    jp   __RM_END
__RM_NOEI:
    call __PL_EI
__RM_NO:
    xor  a
    jp   __RM_END
    
__RM_HAND0:                 ; A = entry index: Z set if that entry is the frame entry
    add  a, a
    ld   e, a
    ld   d, 0
    ld   hl, RI_HAND
    add  hl, de
    ld   a, (hl)
    inc  hl
    or   (hl)
    ret
__RM_END:
    ENDP
    pop namespace
    end asm
end function

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

function RasterIntMove(oldLine as ubyte, newLine as ubyte) as ubyte
    asm
    call .core.RasterIntMove_needs_bare_mode__build_with_D_CPC_BAREMETAL
    end asm
end function

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

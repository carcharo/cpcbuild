' ----------------------------------------------------------------
' plusdemo.bas -- CPC Plus feature demo (mode 1, bare-metal)
'
' Everything the Plus adds to the CPC, moving at once:
'
'   hardware sprites   eight of the ASIC's sixteen, bouncing around the whole
'                      screen at magnifications x1, x2 and x4, drawn from a
'                      PNG (examples/plusdemo/sprites.png) through
'                      img2cpc.py --plus-sprite --packed; no sprite is ever
'                      erased or redrawn, the ASIC draws them over the screen
'   12-bit palette     4096 colours instead of 27: the title and the stars
'                      cycle round a rainbow of shades the classic CPC
'                      cannot show, the hills and ground have their own
'   raster bars        a smooth moving copper gradient behind the text: 14
'                      raster interrupts a frame (RasterIntAt), each one
'                      sets the colour of pen 0 and of the border; the main
'                      loop waits in HALT, so the bars are steady
'   split screen and   the bottom 104 lines are a second screen that scrolls
'   soft scroll        sideways: the CRTC start address moves it in 16-pixel
'                      steps (SplitScreen), the ASIC's soft scroll (ScrollFine)
'                      smooths it pixel by pixel, a raster interrupt turns the
'                      scroll on at the split line so the panel above stays
'                      still, and the landscape is a repeating pattern whose
'                      next column is written just off screen
'   DMA sound          a looping tune played by the ASIC's DMA channel 0: it
'                      writes the AY registers by itself, the program does
'                      nothing for the music (DmaStart)
'
' On a CPC without the ASIC it prints "needs a CPC Plus" and waits for a key.
' ESC quits (a cartridge has no keyboard; it just runs on).
'
' Bare mode only: raster interrupts stop the firmware's own interrupts.
'
' Written in BASIC, with machine code in four places where BASIC is too slow
' or the library asks for it: the raster handlers (they are interrupt code),
' and MoveSprites and LandscapeWord, which do in a fraction of a millisecond
' what the BASIC loops need tens of milliseconds for (the 15 raster
' interrupts a frame already take about 40% of the CPU, the library's
' interrupt handler included). With them the main loop is done in about a
' third of a frame and waits in HALT for the rest.
'
'   Disc (6128 Plus), run in Caprice32:
'     python3 tools/cpcrun.py examples/plusdemo.bas --model plus --bare
'     (headless: add --timeout S; -D DEMO_FRAMES=n ends after n frames)
'   Cartridge (.cpr, boots like a GX4000):
'     examples/plusdemo/build.sh   then run build/plusdemo.cpr in Caprice32 or
'     CPCEC (-m3) or on a GX4000; the same file ends with -D DEMO_FRAMES=n
'
' Screenshot test: -D SHOT=n runs n frames, takes a program-triggered
' screenshot (tests/screens/lib/shot.bas, tests/screens/plusdemo.bas) and ends.
' ----------------------------------------------------------------

#include <cpc.bas>
#include <framehook.bas>
#include <cpcbuild/display.bas>
#include <cpcbuild/fill.bas>
#include <cpcbuild/keyboard.bas>
#include <cpcbuild/sprites.bas>
#include <cpcplus/cpcplus.bas>
#require "cpcplus/plushandler.asm"   ' PlusHandler* entries for the raster handlers
#include "plusdemo/sprites.bas"
#include "plusdemo/landscape.bas"      ' landscape: one period, 16 bytes x 104 lines

#ifdef SHOT
#include "../tests/screens/lib/shot.bas"
#endif

' --- layout ----------------------------------------------------------
' Lines 0-95 (character rows 0-11): the panel and the sky, shown from the
' screen at &4000, text and bars. Lines 96-199 (rows 12-24): the landscape
' from the screen at &C000, a "ring" of 2 KB per scan line (a CRTC address
' wraps there), 13 character rows of 80 bytes read from a start word that
' advances one word (2 bytes = 16 pixels in mode 2) at a time.
CONST SPLIT_LINE AS UBYTE = 96
CONST BAND_ROWS AS UBYTE = 13
CONST NBARS AS UBYTE = 14       ' raster bars
CONST BAR_FIRST AS UBYTE = 8    ' the first bar's line
CONST BAR_GAP AS UBYTE = 14     ' lines between bars
CONST SCROLL_BAR AS UBYTE = 6   ' the bar (line 92) that sets the soft scroll
CONST NSPR AS UBYTE = 8
CONST SCROLL_SPEED AS UINTEGER = 5      ' mode-2 pixels a frame

DIM barTab(127) AS UBYTE        ' the copper colours, a ring of 64: red << 4 | blue, green
DIM barIdx AS UBYTE             ' next colour the handler uses
DIM barPhase AS UBYTE           ' first colour of this frame's top bar
DIM scrDx AS UBYTE              ' soft scroll for the landscape (0-15)
DIM barNo AS UBYTE              ' the bar the handler is at (counted from 0)

' Sprites bounce along triangle waves: a sprite's phase (0-255) steps on by
' its own speed every frame and wraps by itself, and xTab/yTab turn a phase
' into a position that runs to the far edge and back (a bounce off each wall,
' at constant speed). The ranges leave room for the biggest sprite (64
' pixels across, 64 lines down).
DIM xTab(255) AS UBYTE          ' (x - 16) / 4, x in mode-2 pixels: 16 to 524
DIM yTab(255) AS UBYTE          ' lines: 8 to 135
DIM spr(NSPR * 4 - 1) AS UBYTE  ' per sprite: x phase, y phase, x speed, y speed
DIM posTab(NSPR * 2 - 1) AS INTEGER     ' per sprite: x, y, for SpriteMoveBlock

' The jingle's tune: 32 eighth notes (AY tone periods, 62500 / Hz), A minor,
' F, C, G, and a bass note every second step.
DIM mel(31) AS UINTEGER = { _
  95, 119, 142, 119, 95, 119, 142, 119, _
  90, 119, 142, 119, 90, 119, 142, 119, _
  95, 119, 159, 119, 95, 119, 159, 119, _
  106, 127, 159, 127, 106, 127, 159, 127 }
DIM bass(15) AS UINTEGER = { _
  568, 379, 568, 379, 716, 478, 716, 478, _
  478, 319, 478, 319, 638, 426, 638, 426 }
DIM dmaBuf(250) AS UINTEGER     ' the DMA list (one word too long for DmaAlign)
DIM dmaP AS UINTEGER            ' where the next word goes

' --- raster handlers (machine code, run from the interrupt) -----------
' The library calls a handler with interrupts off and every register saved.

' The bar handler: sets pen 0 and the border to colour barIdx of barTab, then steps
' barIdx on by 3 (so the next bar differs a little) around the ring of 64.
' Bar number SCROLL_BAR also turns the soft scroll on for the landscape below
' (the panel above is drawn with 0): the handler can only be told apart from
' its neighbours by counting (barNo), and the scroll is set first so that it
' is in place by the split line.
FUNCTION FASTCALL BarHandler() AS UINTEGER
  ASM
  ld hl, pd_bar
  jp pd_bar_end
pd_bar:
  ld a, (_barNo)
  inc a
  ld (_barNo), a
  cp 7                          ; SCROLL_BAR + 1 (asm cannot see CONSTs)
  jr nz, pd_colour
  ld a, (_scrDx)
  ld b, a
  ld c, 0
  call .core.PlusHandlerScroll
pd_colour:
  ld a, (_barIdx)
  ld c, a
  add a, 3
  and 63
  ld (_barIdx), a
  ld a, c
  and 63
  add a, a
  ld e, a
  ld d, 0
  ld hl, _barTab.__DATA__       ; an array's data follows a short header
  add hl, de
  ld e, (hl)                    ; E = red << 4 | blue
  inc hl
  ld d, (hl)                    ; D = green
  call .core.PlusHandlerIn      ; the ASIC page in (interrupts are off already): this
  ld ($6400), de                ; code and the table are below &4000 (the double
  ld ($6420), de                ; buffer reserves &4000-&7FFF), so they can run and
  jp .core.PlusHandlerOut       ; be read meanwhile. Pen 0 and the border: about 150
                                ; T-states (SetPalette12 takes 90 us, 360 T-states, a colour)
pd_bar_end:
  END ASM
END FUNCTION

' The frame hook (every frame at line 243, in the blank): scroll back to 0
' for the panel, and the first bar's colour for the top lines of the next
' frame, then the handler's index goes on from there.
FUNCTION FASTCALL HookAddress() AS UINTEGER
  ASM
  ld hl, pd_hook
  jp pd_hook_end
pd_hook:
  ld bc, 0
  call .core.PlusHandlerScroll
  ld a, (_barPhase)
  ld (_barIdx), a
  ld a, 255
  ld (_barNo), a                ; the hook's own colour is not a numbered bar
  ld hl, (_BarHandlerAddr)
  jp (hl)
pd_hook_end:
  END ASM
END FUNCTION

DIM BarHandlerAddr AS UINTEGER
' The asm routines use barTab, barIdx, barPhase, barNo, scrDx, spr, xTab, yTab, posTab; the compiler
' drops variables nothing in BASIC reads, so take their addresses once.
DIM vars AS UINTEGER
vars = @barTab(0) + @barIdx + @barPhase + @scrDx + @barNo + @spr(0) + @xTab(0) + @yTab(0) + @posTab(0)

' --- helpers -----------------------------------------------------------

' A rainbow: hue h (0-95) -> &0RGB, six ramps of 16.
FUNCTION Rainbow(h AS UBYTE) AS UINTEGER
  DIM s, t AS UBYTE
  s = h >> 4
  t = h BAND 15
  IF s = 0 THEN RETURN $0F00 + t * 16
  IF s = 1 THEN RETURN (15 - t) * 256 + $00F0
  IF s = 2 THEN RETURN $00F0 + t
  IF s = 3 THEN RETURN (15 - t) * 16 + $000F
  IF s = 4 THEN RETURN t * 256 + $000F
  RETURN $0F00 + (15 - t)
END FUNCTION

' One word of the DMA list.
SUB AddWord(w AS UINTEGER)
  POKE UINTEGER dmaP, w
  dmaP = dmaP + 2
END SUB

' The jingle as a DMA list: per eighth note the melody's tone on AY channel
' A (plucked: loud for 10 units, quieter for 29, a unit is 64 lines = 4 ms)
' and every second note the bass on B; a loop of 4000 passes (a few hours).
SUB BuildJingle()
  DIM i AS UBYTE
  dmaP = DmaAlign(@dmaBuf(0))
  AddWord(DMA_LOAD(7, $3C))             ' mixer: tones A and B on, noise off
  AddWord(DMA_LOAD(9, 11))              ' bass volume
  AddWord(DMA_REPEAT(4000))
  FOR i = 0 TO 31
    AddWord(DMA_LOAD(0, mel(i) BAND 255))
    AddWord(DMA_LOAD(1, mel(i) >> 8))
    IF (i BAND 1) = 0 THEN
      AddWord(DMA_LOAD(2, bass(i >> 1) BAND 255))
      AddWord(DMA_LOAD(3, bass(i >> 1) >> 8))
    END IF
    AddWord(DMA_LOAD(8, 13))
    AddWord(DMA_PAUSE(10))
    AddWord(DMA_LOAD(8, 6))
    AddWord(DMA_PAUSE(29))
  NEXT i
  AddWord(DMA_LOOP)
  AddWord(DMA_STOP)
END SUB

' Moves the sprites one frame on: the phases step, and xTab and yTab give the
' positions, which go into posTab (X, Y as two INTEGERs a sprite) for one
' SpriteMoveBlock call, all eight sprites in one window of interrupts off.
' (SpriteMove one sprite at a time costs about 0.1 ms a call plus BASIC's
' loop around it, 50 ms with this much else going on; this and the block
' call take about 0.4 ms for all eight.)
SUB FASTCALL MoveSprites()
  ASM
  push ix
  ld ix, _spr.__DATA__          ; an array's data follows a short header
  ld de, _posTab.__DATA__
  ld c, 0                       ; the sprite
pd_ms:
  ld a, (ix+0)                  ; x phase
  add a, (ix+2)
  ld (ix+0), a
  ld l, a
  ld h, 0
  push de
  ld de, _xTab.__DATA__
  add hl, de
  ld l, (hl)                    ; n = (x - 16) / 4
  ld h, 0
  add hl, hl
  add hl, hl
  ld de, 16
  add hl, de                    ; HL = x
  pop de
  ex de, hl
  ld (hl), e
  inc hl
  ld (hl), d                    ; X low, X high (HL was the table pointer, DE = x)
  inc hl
  ex de, hl
  ld a, (ix+1)                  ; y phase
  add a, (ix+3)
  ld (ix+1), a
  ld l, a
  ld h, 0
  push de
  ld de, _yTab.__DATA__
  add hl, de
  pop de
  ld a, (hl)
  ld (de), a                    ; Y low
  inc de
  xor a
  ld (de), a                    ; Y high
  inc de
  inc ix
  inc ix
  inc ix
  inc ix
  inc c
  ld a, c
  cp 8                          ; NSPR (asm cannot see CONSTs)
  jr nz, pd_ms
  pop ix
  END ASM
  SpriteMoveBlock(0, NSPR, @posTab(0))
END SUB

' Writes the landscape's word at world column c (a byte, even) into every
' scan line of every character row of the band, in the ring at &C000: the
' column's picture bytes, 2 a line, 13 rows of 8 lines. BASIC takes too long
' for 104 words (50 ms), so this is the demo's other bit of assembler.
SUB FASTCALL LandscapeWord(c AS UINTEGER)
  ASM
  ld (pd_ring), hl              ; the ring offset of row 0 (masked when used)
  ld a, l
  and 15
  ld e, a
  ld d, 0
  ld hl, _landscape.__DATA__
  add hl, de                    ; HL = the picture's bytes, line by line
  ld c, 13                      ; BAND_ROWS
pd_lw_row:
  ld de, (pd_ring)
  ld a, d
  and 7
  or $C0
  ld d, a                       ; DE = &C000 + the ring offset
  ld b, 8
pd_lw_line:
  ld a, (hl)
  ld (de), a
  inc hl
  inc de
  ld a, (hl)
  ld (de), a
  dec de
  ld a, d
  add a, 8                      ; the next scan line is 2 KB on
  ld d, a
  push de
  ld de, 15
  add hl, de                    ; the next line of the picture
  pop de
  djnz pd_lw_line
  push hl
  ld hl, (pd_ring)
  ld de, 80                     ; the next row
  add hl, de
  ld (pd_ring), hl
  pop hl
  dec c
  jr nz, pd_lw_row
  jr pd_lw_end
pd_ring:
  defw 0
pd_lw_end:
  END ASM
END SUB

' Everything the demo switched on, off again (END resets the CPC but the
' ASIC's sprites, scroll and DMA are not RAM).
SUB Quit()
  DmaStop(0)
  RasterIntClear()
  FrameHookOff()
  SpritesHideAll()
  SplitOff()
  ScrollFine(0, 0)
  ScrollBorder(0)
END SUB

' --- start ---------------------------------------------------------------

DIM i, n AS UBYTE
DIM frame, j AS UINTEGER
DIM p, w, wOld, c AS UINTEGER

Mode 1
ScreenInit()
CLS
IF PlusAvailable() = 0 THEN
  PRINT AT 8, 7; "THIS DEMO NEEDS A CPC PLUS"
  PRINT AT 11, 3; "(A 464 PLUS, 6128 PLUS OR GX4000)"
  PRINT AT 13, 3; "THIS COMPUTER HAS NO ASIC."
  PRINT AT 24, 12; "PRESS A KEY"
#ifdef SHOT
  Shot("plusdemo")
#else
  DO
    ScanKeys()
  LOOP UNTIL AnyKeyDown()
#endif
  END
END IF

' Colours: pen 0 and the border belong to the bars; pen 1 is the rainbow;
' pens 2 and 3 are the hills and the ground (and the captions).
SetPalette12(0, $0008)
SetPalette12(1, $0FFF)
SetPalette12(2, $0527)
SetPalette12(3, $06DB)
SetBorder12($0008)

' The copper colours: a rainbow at half brightness, so the text stays legible.
FOR i = 0 TO 63
  c = (Rainbow((i * 3) >> 1) >> 1) BAND $0777
  barTab(i * 2) = ((c >> 8) << 4) BOR (c BAND 15)       ' the ASIC's own two bytes
  barTab(i * 2 + 1) = (c >> 4) BAND 15
NEXT i

' The panel's screen is at &4000: cpcbuild's double buffering shows it (and
' draws the landscape on the other screen, &C000, from here on). It stops at
' row 11 on purpose: the emulator Caprice32 writes the DMA channel's state into
' &6C00-&6C0F, which is row 12 of this screen, and nobody sees that row.
EnableDoubleBuffer()
FillRect(0, 0, 80, 200, 0)
FlipBuffer()

PRINT AT 1, 9; INK 6; "CPC PLUS FEATURE DEMO"      ' (INK 6 = pen 1 in mode 1)
PRINT AT 3, 2; INK 3; "HARDWARE SPRITES: x1 x2 x4, NO REDRAW"
PRINT AT 4, 2; INK 3; "12-BIT COLOUR: 4096 SHADES"
PRINT AT 5, 2; INK 3; "RASTER BARS: AN INTERRUPT EACH"
PRINT AT 6, 2; INK 3; "DMA SOUND: THE TUNE COSTS NO CPU"
PRINT AT 9, 2; INK 3; "SPLIT SCREEN + SOFT SCROLL BELOW"

' The landscape: its first window of 80 bytes a row (the rest is written as it scrolls in)
FOR n = 0 TO 4
  FOR i = 0 TO BAND_ROWS - 1
    PutSprite(n * 16, i * 8, landscape_W, 8, @landscape(0) + CAST(UINTEGER, i) * 128)
  NEXT i
NEXT n
ScrollBorder(1)         ' hides the 16 pixels a soft scroll uncovers on the left
SplitScreen(SPLIT_LINE, $C000)
wOld = 0
p = 0

' Sprites: the sheet's palette, then eight sprites, each with one of the four
' pictures and a size (the other eight are off)
SpritesHideAll()
SpritePalette(@dsprite_pal(0))
FOR j = 0 TO 255
  n = j                                 ' a triangle: 0 up to 127 and back down
  IF n > 127 THEN n = 255 - n
  xTab(j) = n
  yTab(j) = 8 + n
NEXT j
FOR i = 0 TO NSPR - 1
  spr(i * 4) = i * 43
  spr(i * 4 + 1) = i * 71 + 20
  spr(i * 4 + 2) = 2 + ((i * 3) BAND 3)
  spr(i * 4 + 3) = 3 + ((i * 5) BAND 7)
  SpriteSetImagePacked(i, @dsprite(CAST(UINTEGER, i BAND 3) * 128))
NEXT i
MoveSprites()
' sizes (magnification across, down): x1, x2 and x4 on show
SpriteMag(0, 4, 2)
SpriteMag(1, 2, 1)
SpriteMag(2, 4, 4)
SpriteMag(3, 2, 1)
SpriteMag(4, 4, 2)
SpriteMag(5, 1, 1)
SpriteMag(6, 2, 2)
SpriteMag(7, 4, 1)

' Raster bars and the frame hook
BarHandlerAddr = BarHandler()
FrameHook(HookAddress())
FOR i = 0 TO NBARS - 1
  RasterIntAt(BAR_FIRST + i * BAR_GAP, BarHandlerAddr)
NEXT i

' The tune
BuildJingle()
DmaPrescaler(0, 63)
n = DmaStart(0, DmaAlign(@dmaBuf(0)))

' --- main loop: all work in the blank, then wait in HALT -------------------
frame = 0
DO
  WaitVsync()

  ' soft scroll: the whole pixels in the CRTC start word, the rest in SSCR
  p = p + SCROLL_SPEED
  w = (p + 15) >> 4
  scrDx = (0 - p) BAND 15
  IF w <> wOld THEN
    LandscapeWord(CAST(UINTEGER, w * 2 + 78))
    wOld = w
  END IF
  SplitScreen(SPLIT_LINE, $C000 + ((w * 2) BAND 2047))

  MoveSprites()

  ' colour cycling: the title's and the stars' pen round the rainbow, the
  ' bars' colours shift down the screen
  n = (frame * 2) MOD 96
  SetPalette12(1, Rainbow(n))
  barPhase = (frame BAND 63)

  frame = frame + 1
  ScanKeys()
#ifdef DEMO_FRAMES
  IF frame = DEMO_FRAMES THEN EXIT DO
#endif
#ifdef SHOT
  IF frame = SHOT THEN EXIT DO
#endif
LOOP UNTIL KeyDown(KEY_ESC)

#ifdef SHOT
Shot("plusdemo")
#endif
Quit()
END

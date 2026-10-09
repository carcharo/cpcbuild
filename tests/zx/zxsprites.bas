REM TIMEOUT: 90
REM zxbuild/sprites.bas screenshot test: wide (16x8) and narrow (4x4) OR
REM sprites with attribute colours moving over a background of bars, an
REM attribute chequer and text, on the 48K (single screen) and the 128K
REM (double-buffered, screens 5 and 7). Every erase must give the
REM background back, bitmap and attributes: checked by checksum of both
REM screens as well as by the golden pictures.
#include <zxtest.bas>
#include <zxbuild/sprites.bas>

DIM wideA(15) AS UBYTE => {255, 255, 129, 129, 189, 189, 165, 165, 165, 165, 189, 189, 129, 129, 255, 255}
DIM wideB(15) AS UBYTE => {24, 24, 60, 60, 126, 126, 255, 255, 219, 219, 255, 255, 102, 102, 195, 195}
DIM shot(3) AS UBYTE => {128, 192, 192, 128}
DIM bomb(3) AS UBYTE => {96, 240, 240, 96}

DIM dbl AS UBYTE
DIM f, n AS UBYTE
DIM x, y, a AS UINTEGER
DIM sum0, sum1 AS UINTEGER

REM The stack out of the top 16K (a 128K pages bank 7 there)
ASM
  ld ($7FF4), sp
  ld sp, $7FF0
END ASM

REM the background on the screen at base: bars in the bitmap, a chequer of
REM attributes (paper 1/2, ink 7/6, some bright), text
SUB Background(base AS UINTEGER)
  DIM i, r, c AS UINTEGER
  FOR i = 0 TO 6143
    POKE base + i, 0
  NEXT i
  FOR r = 0 TO 23
    FOR c = 0 TO 31
      POKE base + 6144 + r * 32 + c, 7 + 8 * (1 + ((r + c) BAND 1)) + 64 * ((c / 8) BAND 1)
    NEXT c
  NEXT r
  FOR y = 0 TO 191 STEP 4
    FOR c = 0 TO 31
      POKE base + ((y BAND 192) * 32) + ((y BAND 7) * 256) + ((y BAND 56) * 4) + c, 85
    NEXT c
  NEXT y
END SUB

REM characters from the ROM font (&3D00) at character row r, column c
SUB Text(base AS UINTEGER, r AS UBYTE, c AS UBYTE, s AS STRING)
  DIM i, k AS UINTEGER
  DIM ch AS UBYTE
  FOR i = 0 TO LEN(s) - 1
    ch = CODE(s(i TO i))
    FOR k = 0 TO 7
      POKE base + (r BAND 24) * 256 + (r BAND 7) * 32 + k * 256 + c + i, PEEK(15616 + CAST(UINTEGER, ch - 32) * 8 + k)
    NEXT k
  NEXT i
END SUB

REM a rolling checksum of the 6912 bytes of the screen at base
FUNCTION Sum(base AS UINTEGER) AS UINTEGER
  DIM i, s AS UINTEGER
  s = 0
  FOR i = 0 TO 6911
    s = ((s << 1) BOR (s >> 15)) bXOR PEEK(base + i)
  NEXT i
  RETURN s
END FUNCTION

REM draw the frame f: sprites in the list, in order
SUB Frame(f AS UBYTE)
  DIM i AS UBYTE
  SpritesBegin()
  SpriteAdd(0, 4, 4)                 : REM never moves: skipped after the first frames
  SpriteAdd(4, 100, 10)              : REM no colour (attr 0)
  SpriteAdd(1, 8 + f * 4, 40 + f)    : REM moves right and down
  SpriteAdd(0, 240 - f * 4, 80)      : REM moves left
  SpriteAdd(2, 130, 150 - f * 3)     : REM narrow, up
  SpriteAdd(3, 133 + f, 100 + f * 2) : REM narrow, odd x (rounded down)
  IF f > 5 THEN SpriteAdd(1, 62, 96) : REM appears later, overlaps nothing
  SpritesSync()
  SpritesFlip()
  TWAIT(1)
END SUB

dbl = SpritesInit(1)
BORDER 1
Background(16384)
IF dbl THEN Background(49152)
sum0 = Sum(16384)
IF dbl THEN sum1 = Sum(49152)
SpriteImage(0, @wideA(0), 1, 69)        : REM cyan, bright
SpriteImage(1, @wideB(0), 1, 66)        : REM red, bright
SpriteImage(2, @shot(0), 0, 71)         : REM white
SpriteImage(3, @bomb(0), 0, 70)         : REM yellow
SpriteImage(4, @wideB(0), 1, 0)         : REM no attribute
SpritesReset()
REM text rows from the ROM font, into the screen(s) before the sprites
Text(16384, 21, 1, "WIDE AND NARROW")
IF dbl THEN Text(49152, 21, 1, "WIDE AND NARROW")
sum0 = Sum(16384)
IF dbl THEN sum1 = Sum(49152)

CHK("double", STR$(dbl), STR$(dbl))
TLN("double=" + STR$(dbl))

FOR f = 0 TO 11
  Frame(f)
NEXT f
TSHOT("zxspr_moving")
FOR f = 12 TO 29
  Frame(f)
NEXT f
TSHOT("zxspr_moved")

REM Remove everything: both lists empty (twice, so both screens)
SpritesBegin(): SpritesSync(): SpritesFlip(): TWAIT(1)
SpritesBegin(): SpritesSync(): SpritesFlip(): TWAIT(1)
CHK("erased5", STR$(Sum(16384)), STR$(sum0))
IF dbl THEN CHK("erased7", STR$(Sum(49152)), STR$(sum1))
TSHOT("zxspr_erased")

REM Over capacity (28 fit), off-screen ones dropped, the
REM far right and bottom edges, then erased back to the background
SUB Crowd()
  DIM n AS UBYTE
  SpritesBegin()
  FOR n = 0 TO 25
    SpriteAdd(3, 8 * (n BAND 31), 8 + 6 * n)
  NEXT n
  SpriteAdd(0, 255, 100)       : REM clamped to x = 240
  SpriteAdd(0, 20, 190)        : REM too low: dropped
  SpriteAdd(0, 20, 184)        : REM the lowest line that fits
  SpriteAdd(9, 20, 20)         : REM never built: dropped
  SpriteAdd(16, 20, 20)        : REM no such image: dropped
  SpriteAdd(3, 4, 4)           : REM the 28th: fits
  SpriteAdd(3, 12, 12)         : REM the 29th: over capacity, dropped
  SpritesSync(): SpritesFlip(): TWAIT(1)
END SUB
Crowd()
Crowd()
TSHOT("zxspr_crowded")
SpritesBegin(): SpritesSync(): SpritesFlip(): TWAIT(1)
SpritesBegin(): SpritesSync(): SpritesFlip(): TWAIT(1)
CHK("crowd_erased5", STR$(Sum(16384)), STR$(sum0))
IF dbl THEN CHK("crowd_erased7", STR$(Sum(49152)), STR$(sum1))

SpritesDone()
ASM
  ld sp, ($7FF4)
END ASM
TEND()

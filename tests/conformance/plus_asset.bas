REM MODELS: plus
REM Conformance: the asset pipeline for the Plus (Phase 7 P2): a two-frame sprite
REM sheet drawn with Pillow (assets/make_plus_sources.py) and converted by
REM tools/img2cpc.py --plus-sprite (one byte per pixel, and --packed) is loaded
REM with SpriteSetImage / SpriteSetImagePacked / SpritePalette and read back from
REM the ASIC: pixels equal the generated data, the packed copy equals the unpacked
REM one, the palette entries are the image's colours (12-bit), and the known pixels
REM of the drawing (the disc's white highlight at (4,4), the diamond's corner
REM mark) are where the art put them.
REM Image palette (order of first appearance): 1 navy &228, 2 sand &FC4, 3 orange
REM &F80, 4 white &FFF, 5 crimson &C04, 6 green &0B6.

#include <cpc.bas>
#include "lib/chk.bas"
#include "lib/plushelp.bas"
#include "assets/plus_ball.bas"
#include "assets/plus_ballpk.bas"

DIM i, bad AS UINTEGER

PlusUnlock()
SpritePalette(@plusball_pal(0))
SpriteSetImage(0, @plusball(0))
SpriteSetImage(1, @plusball(256))
SpriteSetImagePacked(2, @plusballpk(0))
SpriteSetImagePacked(3, @plusballpk(128))

CHK("consts", STR$(plusball_FRAMES) + " " + STR$(plusball_SIZE) + " " + STR$(plusballpk_SIZE) + " " + STR$(plusball_PALN), "2 256 128 15")
bad = 0
FOR i = 0 TO 255
  IF AsicPeek(16384 + i) <> plusball(i) THEN bad = bad + 1
  IF AsicPeek(16384 + 256 + i) <> plusball(256 + i) THEN bad = bad + 1
NEXT i
CHK("frames_match_data", STR$(bad), "0")
bad = 0
FOR i = 0 TO 255
  IF AsicPeek(16384 + 512 + i) <> plusball(i) THEN bad = bad + 1
  IF AsicPeek(16384 + 768 + i) <> plusball(256 + i) THEN bad = bad + 1
NEXT i
CHK("packed_matches_unpacked", STR$(bad), "0")
CHK("disc_highlight", STR$(AsicPeek(16384 + 4 * 16 + 4)) + " " + STR$(AsicPeek(16384 + 4 * 16 + 5)) + " " + STR$(AsicPeek(16384 + 5 * 16 + 4)), "4 4 4")
CHK("disc_corner_clear", STR$(AsicPeek(16384)) + " " + STR$(AsicPeek(16384 + 255)), "0 0")
CHK("diamond_mark", STR$(AsicPeek(16384 + 256)) + " " + STR$(AsicPeek(16384 + 256 + 8)) + " " + STR$(AsicPeek(16384 + 256 + 15 * 16 + 8)), "0 5 5")
CHK("palette", STR$(GetPalette12(17)) + " " + STR$(GetPalette12(18)) + " " + STR$(GetPalette12(19)) + " " + STR$(GetPalette12(20)) + " " + STR$(GetPalette12(21)) + " " + STR$(GetPalette12(22)) + " " + STR$(GetPalette12(23)), "552 4036 3968 4095 3076 182 0")
SpriteMove(0, 100, 100)
SpriteMag(0, 2, 2)
PRINT "DONE"
END

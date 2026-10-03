REM layer_demo.inc -- test harness for games/shooter/platform_zx.bas. Included by
REM layer_demo_48.bas (-D ZX48) and layer_demo_128.bas; it exercises every
REM routine of the layer with placeholder sprites drawn in the tables below
REM (no game, no real art).
REM
REM Checks: sprite draw / erase leaves the screen bytes (bitmap and
REM attributes) exactly as they were, shifted and unshifted, every kind,
REM near the edges; the HUD text (both screens on a 128K); PlatText; input
REM from typed keys (O, P, Space, other); no phantom Kempston input; the
REM 25 Hz pacing; (128K) music and effects through the IM2 hook.

#include <zxtest.bas>
#ifndef ZX48
#include <zxmusic.bas>
#include "../../../../tests/conformance/assets/music/soft123.bas"
#include "../../../../tests/conformance/assets/music/sfx.bas"
#define PLAT_ZX_SONG_TITLE @soft123
#define PLAT_ZX_SONG_GAME @soft123
#define PLAT_ZX_SFX @sfx
#endif

REM Placeholder art in the layout of assets/zx/ (frames of 32 bytes: the 16x8 art
REM in the first 16): zx_sprites = ship, enemy rows 0-2 (2 frames each), diver
REM (2), explosion (3); zx_shots = bullet, bomb.
DIM zxart(383) AS UBYTE => { _
  255,1,3,7,15,31,63,127,255,128,192,224,240,248,252,254 , _
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0 , _
  60,66,129,165,129,126,36,66,60,66,129,165,129,126,36,66 , _
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0 , _
  60,66,129,165,129,126,66,36,60,66,129,165,129,126,66,36 , _
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0 , _
  24,60,126,219,255,36,66,129,24,60,126,219,255,36,66,129 , _
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0 , _
  24,60,126,219,255,66,36,24,24,60,126,219,255,66,36,24 , _
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0 , _
  255,129,189,165,165,189,129,255,255,129,189,165,165,189,129,255 , _
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0 , _
  255,129,189,165,165,189,129,255,255,129,189,165,165,189,129,255 , _
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0 , _
  129,66,36,24,24,36,66,129,129,66,36,24,24,36,66,129 , _
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0 , _
  129,66,36,24,24,36,66,129,129,66,36,24,24,36,66,129 , _
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0 , _
  0,0,0,24,24,0,0,0,0,0,0,24,24,0,0,0 , _
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0 , _
  0,24,36,66,66,36,24,0,0,24,36,66,66,36,24,0 , _
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0 , _
  129,0,36,0,0,36,0,129,129,0,36,0,0,36,0,129 , _
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0 _
}
DIM zxshots(63) AS UBYTE => { _
  192,192,192,192,0,0,0,0,0,0,0,0,0,0,0,0 , _
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0 , _
  128,192,192,128,0,0,0,0,0,0,0,0,0,0,0,0 , _
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0 _
}
#define PLAT_ZX_SPRITES @zxart(0)
#define PLAT_ZX_SHOTS @zxshots(0)

#include "../../platform_zx.bas"

DIM g1, g2, hud0 AS UINTEGER
DIM i, n, nbad AS UINTEGER
DIM t0 AS UINTEGER

REM base of the screen the player currently sees
FUNCTION VisBase() AS UINTEGER
  IF pzDbl THEN RETURN GetScreenBufferAddr() BXOR 32768
  RETURN 16384
END FUNCTION

REM Display file address of pixel line y, column c in the screen at base.
FUNCTION LineAddr(base AS UINTEGER, y AS UBYTE, c AS UBYTE) AS UINTEGER
  RETURN base + CAST(UINTEGER, y BAND 192) * 32 + CAST(UINTEGER, y BAND 7) * 256 + CAST(UINTEGER, y BAND 56) * 4 + c
END FUNCTION

REM the attributes of the two HUD rows
FUNCTION HudSum(base AS UINTEGER) AS UINTEGER
  DIM k, s AS UINTEGER
  s = 0
  FOR k = 0 TO 63
    s = s + PEEK(base + 6144 + k)
  NEXT k
  RETURN s
END FUNCTION

REM position-sensitive checksum of bitmap + attributes of the screen at base
SUB Sum(base AS UINTEGER, ByRef s1 AS UINTEGER, ByRef s2 AS UINTEGER)
  DIM k AS UINTEGER
  s1 = 0: s2 = 0
  FOR k = 0 TO 6911
    s1 = s1 + PEEK(base + k) + 1
    s2 = s2 + s1
  NEXT k
END SUB

SUB Snap(base AS UINTEGER)
  Sum(base, g1, g2)
END SUB

REM 0 if the screen at base is as it was at the last Snap, else 1
FUNCTION Diff(base AS UINTEGER) AS UINTEGER
  DIM a1, a2 AS UINTEGER
  Sum(base, a1, a2)
  RETURN (a1 <> g1) OR (a2 <> g2)
END FUNCTION

SUB SceneSprites()
  PlatSprite(0, 0, 60, 152)
  PlatSprite(1, 0, 10, 20)
  PlatSprite(1, 1, 30, 20)
  PlatSprite(2, 0, 50, 40)
  PlatSprite(2, 1, 70, 40)
  PlatSprite(3, 0, 90, 60)
  PlatSprite(3, 1, 110, 60)
  PlatSprite(4, 0, 22, 90)
  PlatSprite(4, 1, 100, 100)
  PlatSprite(5, 0, 64, 120)
  PlatSprite(5, 0, 66, 130)
  PlatSprite(6, 0, 40, 77)
  PlatSprite(7, 0, 80, 110)
  PlatSprite(7, 1, 0, 0)
  PlatSprite(7, 2, 120, 150)
  PlatSprite(5, 0, 126, 50)
  PlatSprite(6, 0, 124, 52)
END SUB

SUB Hold(frames AS UBYTE)
  DIM k AS UBYTE
  FOR k = 1 TO frames
    PlatFrameBegin()
    PlatFrameEnd()
  NEXT k
END SUB

REM Reads typed keys: waits for any input, ORs what it sees until it ends.
FUNCTION ReadKey() AS UBYTE
  DIM seen, v, quiet AS UBYTE
  DIM t AS UINTEGER
  seen = 0: quiet = 0
  FOR t = 1 TO 400
    PlatFrameBegin()
    PlatFrameEnd()
    v = PlatInput()
    IF v <> 0 THEN
      seen = seen BOR v: quiet = 0
    ELSEIF seen <> 0 THEN
      quiet = quiet + 1
      IF quiet > 4 THEN RETURN seen
    END IF
  NEXT t
  RETURN seen
END FUNCTION


REM ---------------- init ----------------
t0 = PlatFrames()
PlatInit()
TLN("joy=" + STR$(pzJoy) + " dbl=" + STR$(pzDbl) + " init frames=" + STR$(PlatFrames() - t0))
#ifdef ZX48
CHK("single_buffered_48", STR$(pzDbl), "0")
#else
CHK("model_dbl", STR$(pzDbl), "1")
#endif

REM The runner types its keys right after the start (the first at about frame
REM 25, while PlatInit is still busy): a throw-away key first, then the real ones.
n = ReadKey()
CHK("key_o", STR$(ReadKey() BAND 15), "9")
CHK("key_p", STR$(ReadKey() BAND 15), "10")
CHK("key_space", STR$(ReadKey() BAND 15), "12")
CHK("key_other", STR$(ReadKey() BAND 15), "8")
Hold(2)
CHK("no_input_after_keys", STR$(PlatInput()), "0")

REM background text on both screens, then the snapshot
PlatText(4, 12, "BACKGROUND TEXT")
PlatText(10, 16, "UNDER SPRITES")
Hold(2)
Snap(VisBase())
CHK("text_attr", STR$(PEEK(VisBase() + 6144 + 12 * 32 + 4)), "71")
CHK("text_pixels", STR$(PEEK(LineAddr(VisBase(), 12 * 8 + 1, 4)) = PEEK(15616 + (66 - 32) * 8 + 1)), "1")

REM ---------------- draw and erase ----------------
hud0 = HudSum(VisBase())
PlatFrameBegin()
SceneSprites()
PlatFrameEnd()
nbad = Diff(VisBase())
CHK("sprites_drawn", STR$(nbad), "1")
REM the ship, x=60 (pixel 120, a multiple of 8): art row 0 is FF FF at line 152+32
CHK("ship_pix_l", STR$(PEEK(LineAddr(VisBase(), 184, 15))), "255")
CHK("ship_pix_r", STR$(PEEK(LineAddr(VisBase(), 184, 16))), "255")
CHK("ship_row1", STR$(PEEK(LineAddr(VisBase(), 185, 15))) + "," + STR$(PEEK(LineAddr(VisBase(), 185, 16))), "1,128")
CHK("ship_attr", STR$(PEEK(VisBase() + 6144 + 23 * 32 + 15)), "69")
CHK("ship_attr_r", STR$(PEEK(VisBase() + 6144 + 23 * 32 + 16)), "69")
CHK("ship_attr_beyond", STR$(PEEK(VisBase() + 6144 + 23 * 32 + 17)), "0")
REM the diver at x=22 -> pixel 44 (mod 8 = 4, a shifted copy): line 90+32, art row 0 =
REM 81 81 shifted right by 4: 08 18 10 at columns 5, 6, 7
CHK("shift4", STR$(PEEK(LineAddr(VisBase(), 122, 5))) + "," + STR$(PEEK(LineAddr(VisBase(), 122, 6))), "8,24")
CHK("shift4_attr", STR$(PEEK(VisBase() + 6144 + 15 * 32 + 5)) + "," + STR$(PEEK(VisBase() + 6144 + 15 * 32 + 7)), "70,70")
REM the rightmost narrow sprite: bullet at x=126 (pixel 252): the right-half copy
CHK("bullet_edge_pix", STR$(PEEK(LineAddr(VisBase(), 82, 31)) BAND 15), "12")
REM (the bomb drawn after it shares the cell: the last sprite wins the colour)
CHK("bullet_edge_attr_last_wins", STR$(PEEK(VisBase() + 6144 + 10 * 32 + 31)), "70")
REM a sprite at the very top of the playfield leaves the HUD rows alone
CHK("hud_attrs_untouched", STR$(HudSum(VisBase())), STR$(hud0))

Hold(2)
REM two empty frames: both buffers have had their sprites erased
PlatFrameBegin()
PlatFrameEnd()
CHK("erased_bitmap_attr", STR$(Diff(VisBase())), "0")
PlatFrameBegin()
PlatFrameEnd()
CHK("erased_other_screen", STR$(Diff(VisBase())), "0")

REM repeated frames with moving sprites leave no residue
FOR n = 0 TO 11
  PlatFrameBegin()
  PlatSprite(1, n BAND 1, 4 + n * 8, 20 + n * 5)
  PlatSprite(5, 0, 120 - n * 6, 150 - n * 10)
  PlatSprite(0, 0, 8 * n, 152)
  PlatFrameEnd()
NEXT n
Hold(3)
CHK("no_residue", STR$(Diff(VisBase())), "0")

REM overlapping sprites erase back to the background
PlatFrameBegin()
PlatSprite(1, 0, 40, 40)
PlatSprite(2, 0, 44, 42)
PlatSprite(5, 0, 46, 44)
PlatFrameEnd()
Hold(3)
CHK("overlap_erased", STR$(Diff(VisBase())), "0")

REM more sprites than the layer can hold are dropped, not corrupting
PlatFrameBegin()
FOR n = 0 TO 40
  PlatSprite(1, 0, (n MOD 12) * 10, 10 + (n / 12) * 20)
NEXT n
PlatFrameEnd()
Hold(3)
CHK("overflow_erased", STR$(Diff(VisBase())), "0")

REM y too low for the sprite to fit above the last line is not drawn (8 lines: 153, 4: 157)
PlatFrameBegin()
PlatSprite(6, 0, 40, 157)
PlatSprite(0, 0, 40, 153)
PlatFrameEnd()
CHK("below_limit_not_drawn", STR$(Diff(VisBase())), "0")
Hold(3)

REM the right-hand columns (30, 31) and every line alignment, wide, narrow and shifted:
REM erasing must put back exactly the bytes (a 16-bit INC DE in the restore once
REM carried into D at column 31)
nbad = 0
FOR n = 0 TO 152 STEP 11
  FOR i = 0 TO 5
    PlatFrameBegin()
    PlatSprite(0, 0, 120 - (i BAND 1) * 2, n)
    PlatSprite(1 + (i >> 1), 0, 118, n)
    PlatSprite(5 + (i BAND 1), 0, 120 + (i >> 1) * 3, n)
    PlatFrameEnd()
    Hold(2)
  NEXT i
  IF Diff(VisBase()) <> 0 THEN nbad = nbad + 1
NEXT n
CHK("edge_columns_erased", STR$(nbad), "0")

REM ---------------- HUD ----------------
FOR n = 1 TO 3
  PlatFrameBegin()
  PlatHud(1234, 3, 2, 56789)
  PlatFrameEnd()
  CHK("hud_score_attr" + STR$(n), STR$(PEEK(VisBase() + 6144 + 0 * 32 + 7)), "71")
  CHK("hud_digit4_" + STR$(n), STR$(PEEK(LineAddr(VisBase(), 3, 11)) = PEEK(15616 + (52 - 32) * 8 + 3)), "1")
  CHK("hud_digit1_" + STR$(n), STR$(PEEK(LineAddr(VisBase(), 3, 8)) = PEEK(15616 + (49 - 32) * 8 + 3)), "1")
  CHK("hud_hi_" + STR$(n), STR$(PEEK(LineAddr(VisBase(), 8 + 3, 11)) = PEEK(15616 + (57 - 32) * 8 + 3)), "1")
  CHK("hud_lives_" + STR$(n), STR$(PEEK(LineAddr(VisBase(), 8 + 3, 27)) = PEEK(15616 + (51 - 32) * 8 + 3)), "1")
  CHK("hud_wave_" + STR$(n), STR$(PEEK(LineAddr(VisBase(), 3, 27)) = PEEK(15616 + (50 - 32) * 8 + 3)), "1")
  CHK("hud_label_" + STR$(n), STR$(PEEK(LineAddr(VisBase(), 3, 1)) = PEEK(15616 + (83 - 32) * 8 + 3)), "1")
NEXT n
PlatFrameBegin()
PlatHud(1244, 2, 3, 56789)
PlatFrameEnd()
PlatFrameBegin()
PlatHud(1244, 2, 3, 56789)
PlatFrameEnd()
CHK("hud_changed_digit", STR$(PEEK(LineAddr(VisBase(), 3, 10)) = PEEK(15616 + (52 - 32) * 8 + 3)), "1")
CHK("hud_changed_lives", STR$(PEEK(LineAddr(VisBase(), 8 + 3, 27)) = PEEK(15616 + (50 - 32) * 8 + 3)), "1")

REM ---------------- clear ----------------
PlatClear()
PlatFrameBegin()
PlatFrameEnd()
n = 0
FOR i = 0 TO 191
  IF i >= 24 THEN
    IF PEEK(LineAddr(VisBase(), i, 4)) <> 0 THEN n = n + 1
  END IF
NEXT i
CHK("clear_playfield", STR$(n), "0")
CHK("clear_keeps_hud", STR$(PEEK(LineAddr(VisBase(), 3, 11)) = PEEK(15616 + (52 - 32) * 8 + 3)), "1")

REM ---------------- frames: 25 Hz ----------------
PlatFrameBegin()
PlatFrameEnd()
t0 = PlatFrames()
FOR n = 1 TO 50
  PlatFrameBegin()
  PlatSprite(0, 0, 60, 152)
  PlatSprite(1, 0, 10, 20)
  PlatFrameEnd()
NEXT n
t0 = PlatFrames() - t0
TLN("50 frames took " + STR$(t0) + " ticks")
CHK("pace_25hz", STR$(t0 >= 99 AND t0 <= 101), "1")
Hold(3)

REM ---------------- input ----------------
CHK("no_phantom_input", STR$(PlatInput()), "0")
n = 0
FOR i = 1 TO 200
  PlatFrameBegin()
  SceneSprites()
  PlatFrameEnd()
  n = n BOR PlatInput()
NEXT i
CHK("no_phantom_input_during_play", STR$(n), "0")
Hold(3)

#ifndef ZX48
REM ---------------- music and effects (128K) ----------------
DIM vsum AS UINTEGER
PlatMusic(1)
vsum = 0
FOR i = 1 TO 120
  PlatFrameBegin()
  SceneSprites()
  PlatFrameEnd()
  vsum = vsum + AyRead(8) + AyRead(9) + AyRead(10)
NEXT i
CHK("music_plays", STR$(vsum > 0), "1")
PlatSfx(2)
Hold(1)
FOR i = 1 TO 3
  Hold(1)
NEXT i
CHK("sfx_on_channel_c", STR$(AyRead(10) > 0), "1")
CHK("frames_keep_counting", STR$(PlatFrames() <> t0), "1")
t0 = PlatFrames()
Hold(25)
t0 = PlatFrames() - t0
TLN("25 frames with music took " + STR$(t0) + " ticks")
CHK("pace_25hz_with_music", STR$(t0 >= 49 AND t0 <= 51), "1")
PlatMusic(2)
Hold(5)
PlatMusic(0)
Hold(3)
CHK("music_off_silent", STR$(AyRead(8) + AyRead(9) + AyRead(10)), "0")
#endif

REM ---------------- a scene for the screenshot ----------------
PlatClear()
PlatText(4, 8, "STARFALL LAYER TEST")
PlatText(7, 10, "PRESS FIRE")
Hold(2)
PlatFrameBegin()
PlatHud(1230, 3, 2, 45600)
SceneSprites()
PlatFrameEnd()
PlatFrameBegin()
PlatHud(1230, 3, 2, 45600)
SceneSprites()
PlatFrameEnd()
TSHOT("layer_scene")
TEND()

REM BARE: skip calls the firmware directly (KL_TIME_PLEASE timing, SCR_GET_LOCATION scroll offset)
REM Conformance: cpcbuild sprites (Phase 4c) -- PutSprite, PutSpriteMasked,
REM GetBlock: clipping on every edge, off-screen, round trips, rows that
REM wrap with a hardware-scroll offset, in mode 1 and mode 0; then speed.
REM
REM Library coordinates: x in bytes (0-79), y in pixel lines (0-199) from
REM the top-left. The byte-level checks use PeekScreen (a sprite byte is
REM the screen byte in any mode); POINT (mode pixels, bottom-left) gives
REM an independent check of what the pixels look like.

#include <point.bas>
#include <cpc.bas>
#include <cpcbuild/display.bas>
#include <cpcbuild/fill.bas>
#include <cpcbuild/sprites.bas>

REM NB: in Boriel BASIC AND/OR are logical (0 or 1); BAND/BOR are bitwise.
REM About 270 checks: the passes are only counted (a line each would not fit
REM in the default 4.7 KB heap); failures are listed in full.
DIM results$ AS STRING
DIM npass AS UINTEGER
SUB CHK(name AS STRING, gotv AS STRING, wantv AS STRING)
  IF gotv = wantv THEN
    npass = npass + 1
  ELSE
    results$ = results$ + "FAIL " + name + " got=" + gotv + " want=" + wantv + CHR$ 13
  END IF
END SUB

REM The firmware's scroll offset (SCR_GET_LOCATION -> HL).
FUNCTION FASTCALL ScrollOffset AS UINTEGER
  ASM
  call .core.__FW_CALL
  defw $BC0B
  END ASM
END FUNCTION

REM How many screen bytes equal v, over the whole screen (in asm: a BASIC
REM loop over 16000 PeekScreen calls takes seconds).
FUNCTION CountEq(v AS UBYTE) AS UINTEGER
  ASM
  push namespace core
  PROC
  LOCAL CE_ROW, CE_COL, CE_SKIP
  exx
  ld hl, 0                ; HL' = count
  exx
  ld b, 0                 ; y
CE_ROW:
  ld c, 0
  call __CB_ADDR          ; HL = start of line y
  ld e, (ix+5)
  ld c, 80
CE_COL:
  ld a, (hl)
  cp e
  jr nz, CE_SKIP
  exx
  inc hl
  exx
CE_SKIP:
  call __CB_INC_X
  dec c
  jr nz, CE_COL
  inc b
  ld a, b
  cp 200
  jr nz, CE_ROW
  exx
  push hl
  exx
  pop hl
  ENDP
  pop namespace
  END ASM
END FUNCTION


REM Timing. Compiled code runs with interrupts off, so the firmware's
REM 300 Hz clock stands still while it runs. This routine is therefore run
REM through the firmware gate (which enables interrupts for the call); inside
REM it only the routine under test runs, which never touches the shadow
REM registers, so the interrupt handler is safe. It reads the clock (KL TIME
REM PLEASE, &BD0D), calls the target 500 times with a fake IX frame (x=10,
REM y=50, w=4, h=16, data/buffer = addr), reads the clock again and returns
REM the ticks elapsed (w, h: the frame's width in bytes and height). which: 0 = empty (just a RET), 1 = PutSprite,
REM 2 = PutSpriteMasked, 3 = GetBlock, 4 = calibration (a counted delay loop
REM of 1,400,000 T-states -- 50000 passes of 28 T on the CPC, whose Z80 rounds
REM every instruction up to a whole microsecond).
FUNCTION Bench(which AS UBYTE, addr AS UINTEGER, w AS UBYTE, h AS UBYTE) AS UINTEGER
  ASM
  ld a, (ix+5)
  ld (BN_WHICH), a
  ld l, (ix+6)
  ld h, (ix+7)
  ld (BN_FRAME + 8), hl
  ld a, (ix+9)
  ld (BN_FRAME + 5), a
  ld a, (ix+11)
  ld (BN_FRAME + 7), a
  call .core.__FW_CALL
  defw BN_BODY
  ld hl, (BN_T1)
  ld de, (BN_T0)
  or a
  sbc hl, de
  jp BN_END
BN_FRAME:
  defw 10, 50
  defb 0, 4
  defb 0, 16
  defw 0
BN_WHICH:
  defb 0
BN_T0:
  defw 0
BN_T1:
  defw 0
BN_RET:
  ret
BN_JPHL:
  jp (hl)
BN_BODY:
  push ix
  ld ix, BN_FRAME - 4
  ld a, (BN_WHICH)
  cp 4
  jr z, BN_CAL
  ld hl, BN_RET
  cp 1
  jr nz, BN_NOT1
  ld hl, .core.__CB_PUT_SPRITE
BN_NOT1:
  cp 2
  jr nz, BN_NOT2
  ld hl, .core.__CB_PUT_MASKED
BN_NOT2:
  cp 3
  jr nz, BN_NOT3
  ld hl, .core.__CB_GET_BLOCK
BN_NOT3:
  ld (BN_TARGET + 1), hl
  call $BD0D
  ld (BN_T0), hl
  ld bc, 500
BN_LOOP:
  push bc
BN_TARGET:
  ld hl, 0
  call BN_JPHL
  pop bc
  dec bc
  ld a, b
  or c
  jr nz, BN_LOOP
  call $BD0D
  ld (BN_T1), hl
  pop ix
  ret
BN_CAL:
  call $BD0D
  ld (BN_T0), hl
  ld bc, 50000
BN_CLOOP:
  dec bc
  ld a, b
  or c
  jp nz, BN_CLOOP
  call $BD0D
  ld (BN_T1), hl
  pop ix
  ret
BN_END:
  END ASM
END FUNCTION

DIM sd(0 TO 719) AS UBYTE
DIM gbuf(0 TO 599) AS UBYTE
DIM bgv AS UBYTE = $A5

REM Sprite data starts doff bytes into sd (default 0): the unrolled masked
REM loops step through the data with INC L when it can't cross a 256-byte
REM page, so the data's low address byte matters (SetDoff).
DIM doff AS UINTEGER

REM Sprite data: n plain bytes, or n (mask, pixels) pairs.
SUB MakeData(n AS UINTEGER, masked AS UBYTE)
  DIM i AS UINTEGER
  FOR i = 0 TO n - 1
    IF masked THEN
      sd(doff + 2 * i) = (i * 29 + 3) BAND 255
      sd(doff + 2 * i + 1) = (i * 71 + 9) BAND 255
    ELSE
      sd(doff + i) = (i * 53 + 17) BAND 255
    END IF
  NEXT i
END SUB

REM Make the sprite data start at a given low address byte.
SUB SetDoff(target AS UBYTE)
  DIM a AS UINTEGER
  a = @sd(0)
  doff = (CAST(UINTEGER, target) + 256 - (a BAND 255)) BAND 255
END SUB

REM Background value over the rectangle and a one-byte margin around it.
SUB PutBg(x AS INTEGER, y AS INTEGER, w AS UBYTE, h AS UBYTE)
  DIM xx, yy AS INTEGER
  FOR yy = y - 1 TO y + h
    FOR xx = x - 1 TO x + w
      IF xx >= 0 AND xx < 80 AND yy >= 0 AND yy < 200 THEN PokeScreen(xx, yy, bgv)
    NEXT xx
  NEXT yy
END SUB

REM Bytes that aren't what a clipped plain/masked draw should leave, in the
REM rectangle and its margin (visible part: sprite; the rest: background).
FUNCTION CheckSprite(x AS INTEGER, y AS INTEGER, w AS UBYTE, h AS UBYTE, masked AS UBYTE) AS UINTEGER
  DIM xx, yy AS INTEGER
  DIM idx AS UINTEGER
  DIM want, got AS UBYTE
  DIM bad AS UINTEGER = 0
  FOR yy = y - 1 TO y + h
    FOR xx = x - 1 TO x + w
      IF xx >= 0 AND xx < 80 AND yy >= 0 AND yy < 200 THEN
        got = PeekScreen(xx, yy)
        IF xx >= x AND xx < x + w AND yy >= y AND yy < y + h THEN
          idx = (yy - y) * w + (xx - x)
          IF masked THEN
            want = (bgv BAND sd(doff + 2 * idx)) BOR sd(doff + 2 * idx + 1)
          ELSE
            want = sd(doff + idx)
          END IF
        ELSE
          want = bgv
        END IF
        IF got <> want THEN bad = bad + 1
      END IF
    NEXT xx
  NEXT yy
  RETURN bad
END FUNCTION

REM Draw a sprite (plain or masked) at (x, y) over the background and check.
SUB TestSprite(name AS STRING, x AS INTEGER, y AS INTEGER, w AS UBYTE, h AS UBYTE, masked AS UBYTE)
  DIM n AS UINTEGER
  n = w
  n = n * h
  MakeData(n, masked)
  PutBg(x, y, w, h)
  IF masked THEN
    PutSpriteMasked(x, y, w, h, @sd(doff))
    CHK(name + "_masked", STR$(CheckSprite(x, y, w, h, 1)), "0")
  ELSE
    PutSprite(x, y, w, h, @sd(doff))
    CHK(name, STR$(CheckSprite(x, y, w, h, 0)), "0")
  END IF
END SUB

SUB Both(name AS STRING, x AS INTEGER, y AS INTEGER, w AS UBYTE, h AS UBYTE)
  TestSprite(name, x, y, w, h, 0)
  TestSprite(name, x, y, w, h, 1)
END SUB

REM GetBlock: capture a patterned area into the buffer (unseen parts stay
REM &EE), then wipe, restore with PutSprite and check the pattern is back.
SUB TestGet(name AS STRING, x AS INTEGER, y AS INTEGER, w AS UBYTE, h AS UBYTE)
  DIM xx, yy AS INTEGER
  DIM idx, n AS UINTEGER
  DIM want AS UBYTE
  DIM bad, bad2 AS UINTEGER
  n = w
  n = n * h
  FOR idx = 0 TO n - 1
    gbuf(idx) = $EE
  NEXT idx
  FOR yy = y TO y + h - 1
    FOR xx = x TO x + w - 1
      IF xx >= 0 AND xx < 80 AND yy >= 0 AND yy < 200 THEN PokeScreen(xx, yy, (xx * 7 + yy * 13 + 1) BAND 255)
    NEXT xx
  NEXT yy
  GetBlock(x, y, w, h, @gbuf(0))
  bad = 0
  FOR yy = y TO y + h - 1
    FOR xx = x TO x + w - 1
      idx = (yy - y) * w + (xx - x)
      IF xx >= 0 AND xx < 80 AND yy >= 0 AND yy < 200 THEN
        want = (xx * 7 + yy * 13 + 1) BAND 255
      ELSE
        want = $EE
      END IF
      IF gbuf(idx) <> want THEN bad = bad + 1
    NEXT xx
  NEXT yy
  CHK(name + "_buffer", STR$(bad), "0")
  REM wipe, restore through PutSprite
  FOR yy = y TO y + h - 1
    FOR xx = x TO x + w - 1
      IF xx >= 0 AND xx < 80 AND yy >= 0 AND yy < 200 THEN PokeScreen(xx, yy, 0)
    NEXT xx
  NEXT yy
  PutSprite(x, y, w, h, @gbuf(0))
  bad2 = 0
  FOR yy = y TO y + h - 1
    FOR xx = x TO x + w - 1
      IF xx >= 0 AND xx < 80 AND yy >= 0 AND yy < 200 THEN
        IF PeekScreen(xx, yy) <> ((xx * 7 + yy * 13 + 1) BAND 255) THEN bad2 = bad2 + 1
      END IF
    NEXT xx
  NEXT yy
  CHK(name + "_restore", STR$(bad2), "0")
END SUB

REM The whole clipping and get/put suite, at the current mode and scroll.
SUB Suite(m AS STRING, full AS UBYTE)
  Both(m + "_inside", 10, 20, 4, 16)
  IF full THEN
    Both(m + "_one_byte", 33, 77, 1, 1)
  END IF
  IF full THEN
    Both(m + "_tall", 5, 3, 3, 40)
  END IF
  REM left edge
  Both(m + "_left_2of4", -2, 30, 4, 8)
  IF full THEN
    Both(m + "_left_3of4", -3, 30, 4, 8)
  END IF
  Both(m + "_left_exact_off", -4, 30, 4, 8)
  IF full THEN
    Both(m + "_left_far", -100, 30, 4, 8)
  END IF
  IF full THEN
    Both(m + "_left_flush", 0, 30, 4, 8)
  END IF
  REM right edge
  IF full THEN
    Both(m + "_right_flush", 76, 50, 4, 8)
  END IF
  IF full THEN
    Both(m + "_right_3of4", 77, 50, 4, 8)
  END IF
  Both(m + "_right_1of4", 79, 50, 4, 8)
  IF full THEN
    Both(m + "_right_exact_off", 80, 50, 4, 8)
  END IF
  IF full THEN
    Both(m + "_right_far", 120, 50, 4, 8)
  END IF
  REM top edge
  IF full THEN
    Both(m + "_top_5of16", -5, 0, 1, 1)
  END IF
  Both(m + "_top_clip", 20, -5, 4, 16)
  Both(m + "_top_1row", 20, -15, 4, 16)
  IF full THEN
    Both(m + "_top_exact_off", 20, -16, 4, 16)
  END IF
  IF full THEN
    Both(m + "_top_flush", 20, 0, 4, 16)
  END IF
  REM bottom edge
  IF full THEN
    Both(m + "_bottom_flush", 20, 184, 4, 16)
  END IF
  Both(m + "_bottom_10rows", 20, 190, 4, 16)
  Both(m + "_bottom_1row", 20, 199, 4, 16)
  IF full THEN
    Both(m + "_bottom_exact_off", 20, 200, 4, 16)
  END IF
  REM corners and sprites wider/taller than the screen
  Both(m + "_corner_tl", -2, -3, 4, 8)
  Both(m + "_corner_tr", 78, -3, 4, 8)
  Both(m + "_corner_bl", -2, 196, 4, 8)
  Both(m + "_corner_br", 78, 196, 4, 8)
  Both(m + "_wide_100", -10, 100, 100, 2)
  IF full THEN
    Both(m + "_wide_100_right", 40, 100, 100, 2)
  END IF
  IF full THEN
    Both(m + "_tall_250", 30, -20, 1, 250)
  END IF
  REM GetBlock
  TestGet(m + "_get_inside", 12, 40, 5, 9)
  TestGet(m + "_get_left", -2, 60, 6, 6)
  TestGet(m + "_get_right", 77, 60, 6, 6)
  IF full THEN
    TestGet(m + "_get_top", 30, -3, 4, 6)
  END IF
  IF full THEN
    TestGet(m + "_get_bottom", 30, 197, 4, 6)
  END IF
  TestGet(m + "_get_corner", 78, 197, 4, 6)
  IF full THEN
    TestGet(m + "_get_off", -10, 60, 4, 6)
  END IF
END SUB

REM Nothing at all may be drawn when the sprite is far off the screen.
SUB FarOff(m AS STRING)
  DIM i AS UBYTE
  FOR i = 0 TO 7
    sd(i) = $FF
  NEXT i
  ClearScreen(0)
  PutSprite(-32768, 10, 4, 2, @sd(0))
  PutSprite(32767, 10, 4, 2, @sd(0))
  PutSprite(10, -32768, 4, 2, @sd(0))
  PutSprite(10, 32767, 4, 2, @sd(0))
  PutSprite(-256, 10, 255, 1, @sd(0))
  PutSprite(10, 10, 0, 2, @sd(0))
  PutSprite(10, 10, 4, 0, @sd(0))
  PutSpriteMasked(-32768, 10, 4, 2, @sd(0))
  PutSpriteMasked(32767, 10, 4, 2, @sd(0))
  PutSpriteMasked(10, -32768, 4, 2, @sd(0))
  PutSpriteMasked(10, 32767, 4, 2, @sd(0))
  PutSpriteMasked(10, 10, 0, 2, @sd(0))
  GetBlock(-32768, 10, 4, 2, @gbuf(0))
  GetBlock(10, 32767, 4, 2, @gbuf(0))
  CHK(m + "_far_off_nothing", STR$(CountEq(0)), "16000")
END SUB

REM Spot checks of the pixels (POINT) for a plain and a masked sprite, using
REM PenByte to build bytes whatever the mode. ppb = pixels per byte.
SUB PixelChecks(m AS STRING, ppb AS UBYTE, penA AS UBYTE, penB AS UBYTE, keepmask AS UBYTE)
  DIM bx AS INTEGER
  DIM y0 AS INTEGER
  bx = 12
  y0 = 70
  ClearScreen(0)
  sd(0) = PenByte(penA)
  sd(1) = PenByte(penB)
  PutSprite(bx, y0, 2, 1, @sd(0))
  CHK(m + "_px_plain", STR$(POINT(bx * ppb, 199 - y0)) + "," + STR$(POINT(bx * ppb + ppb - 1, 199 - y0)) + "," + STR$(POINT((bx + 1) * ppb, 199 - y0)) + "," + STR$(POINT((bx + 2) * ppb, 199 - y0)) + "," + STR$(POINT(bx * ppb - 1, 199 - y0)), STR$(penA) + "," + STR$(penA) + "," + STR$(penB) + ",0,0")
  REM masked: background all penA; the left half of the byte kept (mask),
  REM the right half replaced by penB's pixels
  PokeScreen(bx, y0 + 5, PenByte(penA))
  sd(0) = keepmask
  sd(1) = PenByte(penB) BAND (255 - keepmask)
  PutSpriteMasked(bx, y0 + 5, 1, 1, @sd(0))
  CHK(m + "_px_masked", STR$(POINT(bx * ppb, 199 - y0 - 5)) + "," + STR$(POINT(bx * ppb + ppb - 1, 199 - y0 - 5)), STR$(penA) + "," + STR$(penB))
  REM a masked pixel over the background keeps it where the mask is all 1
  PokeScreen(bx + 3, y0, PenByte(penA))
  sd(0) = 255
  sd(1) = 0
  PutSpriteMasked(bx + 3, y0, 1, 1, @sd(0))
  CHK(m + "_px_mask_all_keep", STR$(POINT((bx + 3) * ppb, 199 - y0)), STR$(penA))
  sd(0) = 0
  sd(1) = PenByte(penB)
  PutSpriteMasked(bx + 3, y0, 1, 1, @sd(0))
  CHK(m + "_px_mask_all_replace", STR$(POINT((bx + 3) * ppb, 199 - y0)), STR$(penB))
END SUB

REM Hardware-scroll offset: sprites whose rows wrap around the 2 KB block.
SUB WrapSuite(m AS STRING, ppb AS UBYTE, fullpen AS UBYTE)
  DIM off AS UINTEGER
  DIM wr, k, xa, y0 AS INTEGER
  DIM i AS UBYTE
  CLS
  FOR i = 1 TO 30
    PRINT i
  NEXT i
  ScreenInit()
  CLS
  FOR i = 1 TO 30
    PRINT i
  NEXT i
  ScreenInit()
  CLS
  off = ScrollOffset()
  CHK(m + "_scroll_offset_set", STR$(off > 0), "1")
  wr = (2048 - off) / 80
  k = (2048 - off) - wr * 80
  CHK(m + "_scroll_wraps_in_row", STR$(k > 0 AND wr <= 24), "1")
  IF k > 0 AND wr <= 24 THEN
    y0 = wr * 8 + 2
    xa = k - 10
    IF xa < 0 THEN xa = 0
    Both(m + "_wrap_mid", xa, y0, 20, 12)
    Both(m + "_wrap_at_start", k, y0, 6, 4)
    Both(m + "_wrap_last_before", k - 3, y0 + 1, 3, 3)
    Both(m + "_wrap_one_after", k - 1, y0, 2, 5)
    Both(m + "_wrap_full_row", 0, y0, 80, 3)
    Both(m + "_wrap_clip_left", -5, y0, 20, 4)
    Both(m + "_wrap_clip_right", 70, y0, 20, 4)
    Both(m + "_wrap_above", xa, y0 - 8, 20, 10)
    TestGet(m + "_wrap_get", xa, y0, 20, 6)
    TestGet(m + "_wrap_get_full", 0, y0, 80, 2)
    REM independent look: a solid sprite across the wrap point
    ClearScreen(0)
    FOR i = 0 TO 7
      sd(i) = PenByte(fullpen)
    NEXT i
    PutSprite(k - 4, y0, 8, 1, @sd(0))
    CHK(m + "_wrap_pixels", STR$(POINT((k - 5) * ppb + ppb - 1, 199 - y0)) + "," + STR$(POINT((k - 4) * ppb, 199 - y0)) + "," + STR$(POINT((k - 1) * ppb, 199 - y0)) + "," + STR$(POINT(k * ppb, 199 - y0)) + "," + STR$(POINT((k + 3) * ppb + ppb - 1, 199 - y0)) + "," + STR$(POINT((k + 4) * ppb, 199 - y0)), "0," + STR$(fullpen) + "," + STR$(fullpen) + "," + STR$(fullpen) + "," + STR$(fullpen) + ",0")
    CHK(m + "_wrap_pixels_count", STR$(CountEq(PenByte(fullpen))), "8")
    REM and a masked one: keep the background where the mask says so
    ClearScreen(0)
    FOR i = 0 TO 7
      PokeScreen(k - 4 + i, y0, PenByte(fullpen))
      sd(2 * i) = 255
      sd(2 * i + 1) = 0
    NEXT i
    PutSpriteMasked(k - 4, y0, 8, 1, @sd(0))
    CHK(m + "_wrap_masked_keeps", STR$(CountEq(PenByte(fullpen))), "8")
    FOR i = 0 TO 7
      sd(2 * i) = 0
    NEXT i
    PutSpriteMasked(k - 4, y0, 8, 1, @sd(0))
    CHK(m + "_wrap_masked_clears", STR$(CountEq(0)), "16000")
  END IF
END SUB

#include "lib/cb_fastcase.bas"

DIM fx(0 TO 9) AS UBYTE
DIM fy(0 TO 9) AS UBYTE
DIM fh(0 TO 9) AS UBYTE

REM Forces the library's idea of the hardware-scroll offset (a value the
REM firmware wouldn't set, to reach particular address patterns).
SUB ForceOffset(v AS UINTEGER)
  ASM
  ld l, (ix+4)
  ld h, (ix+5)
  ld (.core.CB_OFFSET), hl
  END ASM
END SUB

REM The unrolled fast paths (widths 1, 2, 4, 8, drawn whole on the screen,
REM no row wrapping) against the byte-exact expectation, for PutSprite,
REM PutSpriteMasked and GetBlock: heights that stay inside a character row,
REM start mid-row and cross one or two character-row boundaries, rows whose
REM low address byte sits at the end of a 256-byte page (the masked loops'
REM safe path), and masked data whose low address byte is at the edge of
REM the page test (SetDoff). Only the failures are reported.
SUB FastSuite(m AS STRING, npos AS UBYTE, ndat AS UBYTE)
  DIM wi, w, pp, dj, x, y, th AS UBYTE
  fy(0) = 0:   fh(0) = 16: fx(0) = 10
  fy(1) = 3:   fh(1) = 13: fx(1) = 20
  fy(2) = 7:   fh(2) = 2:  fx(2) = 0
  fy(3) = 184: fh(3) = 16: fx(3) = 80
  fy(4) = 24:  fh(4) = 9:  fx(4) = 13
  fy(5) = 24:  fh(5) = 1:  fx(5) = 14
  fy(6) = 57:  fh(6) = 1:  fx(6) = 33
  fy(7) = 190: fh(7) = 10: fx(7) = 5
  fy(8) = 8:   fh(8) = 25: fx(8) = 60
  fy(9) = 120: fh(9) = 24: fx(9) = 2
  FOR wi = 0 TO 3
    w = 1
    IF wi = 1 THEN w = 2
    IF wi = 2 THEN w = 4
    IF wi = 3 THEN w = 8
    FOR pp = 0 TO npos - 1
      x = fx(pp)
      IF x + w > 80 THEN x = 80 - w
      y = fy(pp)
      doff = 0
      FastChk(FastCase(x, y, w, fh(pp), 0), m, 0, w, pp, 0)
      FastChk(FastCase(x, y, w, fh(pp), 1), m, 1, w, pp, 0)
      FastChk(FastCase(x, y, w, fh(pp), 2), m, 2, w, pp, 0)
      REM masked data starting at the page test's edge, one byte either side, and at 255
      IF pp < ndat THEN
        th = 255 - 16 * w
        FOR dj = 0 TO 3
          IF dj = 0 THEN SetDoff(th)
          IF dj = 1 THEN SetDoff(th + 1)
          IF dj = 2 THEN SetDoff(th - 1)
          IF dj = 3 THEN SetDoff(255)
          FastChk(FastCase(x, y, w, fh(pp), 1), m, 1, w, pp, dj + 1)
        NEXT dj
        doff = 0
      END IF
    NEXT pp
  NEXT wi
END SUB

REM Time n calls with the 300 Hz clock (see main).
DIM t0, t1 AS ULONG
DIM i AS UINTEGER

REM ---------------- mode 1 ----------------
Mode 1
ScreenInit()
ClearScreen(0)
CHK("mode1_clear", STR$(CountEq(0)), "16000")
Suite("m1", 1)
FastSuite("m1", 10, 5)
ForceOffset(6)
FastSuite("m1_off6", 5, 2)
ForceOffset(48)
FastSuite("m1_off48", 4, 1)
ScreenInit()
FarOff("m1")
PixelChecks("m1", 4, 1, 2, $CC)
WrapSuite("m1", 4, 3)

REM ---------------- mode 0 ----------------
Mode 0
ScreenInit()
ClearScreen(0)
Suite("m0", 0)
FastSuite("m0", 10, 5)
ForceOffset(50)
FastSuite("m0_off50", 3, 1)
ScreenInit()
FarOff("m0")
PixelChecks("m0", 2, 5, 12, $AA)
WrapSuite("m0", 2, 15)

REM ---------------- speed ----------------
REM The routines are timed on their own (no BASIC call wrapper): 500 calls
REM of a 4x16 sprite = 16x16 pixels in mode 0. T-states per tick are
REM calibrated against a delay loop of 1,400,000 CPC T-states (a 28 T pass:
REM DEC BC 8, LD A,B 4, OR C 4, JP NZ 12 -- the CPC rounds every
REM instruction up to a multiple of 4), which also cancels the cost of the
REM firmware's interrupt handler. The cost of the surrounding loop (measured
REM with an empty target) is subtracted. The BASIC wrapper (pushing five
REM arguments, the call, the IX frame) adds roughly 250 T-states.
Mode 0
ScreenInit()
ClearScreen(0)
DIM j AS UINTEGER
FOR j = 0 TO 127
  sd(j) = (j * 5 + 1) BAND 255
NEXT j
DIM tc, te, tp, tm, tg AS UINTEGER
tc = Bench(4, @sd(0), 4, 16)
te = Bench(0, @sd(0), 4, 16)
tp = Bench(1, @sd(0), 4, 16)
tm = Bench(2, @sd(0), 4, 16)
tg = Bench(3, @gbuf(0), 4, 16)
results$ = results$ + "INFO ticks: calibration(1.4M T)=" + STR$(tc) + " empty=" + STR$(te) + " put=" + STR$(tp) + " masked=" + STR$(tm) + " get=" + STR$(tg) + " (per 500 calls, 1/300 s)" + CHR$ 13
IF tc > 0 THEN
  REM T per call = (ticks - empty ticks) * (1400000 / tc) / 500
  results$ = results$ + "INFO CPC T-states per 4x16 call (routine only): put=" + STR$(CAST(ULONG, tp - te) * 2800 / tc) + " masked=" + STR$(CAST(ULONG, tm - te) * 2800 / tc) + " get=" + STR$(CAST(ULONG, tg - te) * 2800 / tc) + CHR$ 13
  REM other widths (1x8 and 8x16 = 16x16 pixels in mode 1... bytes 8 wide) and a clipped draw
  results$ = results$ + "INFO T per call 8x16: put=" + STR$(CAST(ULONG, Bench(1, @sd(0), 8, 16) - te) * 2800 / tc) + " masked=" + STR$(CAST(ULONG, Bench(2, @sd(0), 8, 16) - te) * 2800 / tc) + " get=" + STR$(CAST(ULONG, Bench(3, @gbuf(0), 8, 16) - te) * 2800 / tc) + CHR$ 13
  results$ = results$ + "INFO T per call 2x8: put=" + STR$(CAST(ULONG, Bench(1, @sd(0), 2, 8) - te) * 2800 / tc) + " masked=" + STR$(CAST(ULONG, Bench(2, @sd(0), 2, 8) - te) * 2800 / tc) + " get=" + STR$(CAST(ULONG, Bench(3, @gbuf(0), 2, 8) - te) * 2800 / tc) + CHR$ 13
  results$ = results$ + "INFO T per call 3x16 (generic path): put=" + STR$(CAST(ULONG, Bench(1, @sd(0), 3, 16) - te) * 2800 / tc) + " masked=" + STR$(CAST(ULONG, Bench(2, @sd(0), 3, 16) - te) * 2800 / tc) + " get=" + STR$(CAST(ULONG, Bench(3, @gbuf(0), 3, 16) - te) * 2800 / tc) + CHR$ 13
END IF

PRINT AT 0, 0;
PRINT results$; "PASS "; STR$(npass); " checks"; CHR$ 13; "DONE"
END

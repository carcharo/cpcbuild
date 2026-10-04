REM Conformance: cpcbuild TileRestore and TileMapPart (Phase 4d) in modes 0, 1
REM and 2, at several forced hardware-scroll offsets.
REM
REM Tile t's byte at row r, byte column b is ((t*29 + r*7 + b*3) AND 127) + 1;
REM slot 24 is the "background" tile, all 0 (never equal to a tile byte). The
REM screen is filled with 0 through memory, the routine is called, then every
REM cell in a window one cell larger than the touched area is compared byte for
REM byte (touched on-screen cells = their map tile, others = background), and the
REM whole 16 KB is counted for bytes <> 0 (= touched on-screen cells * 8 * W)
REM so that nothing is drawn anywhere else (clipping, wrap, 48-byte gaps).
REM Expectations are worked out in BASIC from the cell ranges, not by the library.
REM Offsets: 0 and 48 (fast path of TileRestore), 50, 700, 2046 (rows wrap in
REM their block: general path), then one real firmware scroll.
REM Only failures are buffered (small heap); passes are counted.

#include <cpc.bas>
#include <cpcbuild/display.bas>
#include <cpcbuild/tiles.bas>

DIM results$ AS STRING
DIM npass AS UINTEGER = 0
DIM nfail AS UINTEGER = 0
DIM gmode$ AS STRING
DIM gw AS UBYTE
DIM gcxs AS INTEGER
DIM gkind AS UBYTE
DIM gcount AS UBYTE
DIM gX, gY, gMox, gMoy AS INTEGER
DIM gA, gB, gC, gD, gE AS INTEGER

DIM ts(0 TO 25 * 32 - 1) AS UBYTE
DIM mpA(0 TO 2049) AS UBYTE
DIM mpB(0 TO 2399) AS UBYTE
DIM mpC(0 TO 2999) AS UBYTE
DIM gmp AS UINTEGER
DIM bgr(0 TO 95) AS UBYTE
DIM gms AS UINTEGER
DIM xs(0 TO 17) AS UBYTE
DIM ys(0 TO 17) AS UBYTE

SUB ForceOffset(v AS UINTEGER)
  ASM
  ld l, (ix+4)
  ld h, (ix+5)
  ld (.core.CB_OFFSET), hl
  END ASM
END SUB

#include "lib/ticks.bas"

DIM tm$ AS STRING
DIM tk0 AS ULONG

#include "lib/scrolloff.bas"

REM Fills the whole 16 KB at $C000 with 0 (stack fill: fast).
SUB ClearBg
  ASM
  PROC
  LOCAL cb_loop
  di
  ld (cb_sp + 1), sp
  ld sp, 0
  ld hl, 0
  ld b, 0
cb_loop:
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  push hl
  djnz cb_loop
cb_sp:
  ld sp, 0
  ei
  ENDP
  END ASM
END SUB

REM Number of bytes of the whole 16 KB that are not 0 (64-byte chunks are
REM OR-ed first; only chunks with something in them are counted byte by byte).
FUNCTION CountNE AS UINTEGER
  ASM
  PROC
  LOCAL cn_chunk, cn_next, cn_slow, cn_sl
  ld hl, $C000
  ld de, 0
cn_chunk:
  xor a
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or (hl)
  inc hl
  or a
  jp z, cn_next
  ld bc, 64
  or a
  sbc hl, bc
  ld b, 64
cn_sl:
  ld a, (hl)
  inc hl
  or a
  jr z, cn_slow
  inc de
cn_slow:
  djnz cn_sl
cn_next:
  ld a, h
  or l
  jp nz, cn_chunk
  ex de, hl
  ENDP
  END ASM
END FUNCTION

REM Bytes that differ between n successive cells of one cell row and the
REM tiles whose numbers are the n bytes at mapp: xb = byte column of the first
REM cell, yl = its top pixel line (a multiple of 8), w = tile width in bytes,
REM tsb = tile data. Per cell the address of line 0 comes from __CB_ADDR; the
REM other lines are +2 KB, and the bytes of a line follow +1, wrapping at the
REM end of the 2 KB block (independent of the library's drawing code).
FUNCTION RowChk(xb AS UBYTE, yl AS UBYTE, n AS UBYTE, mapp AS UINTEGER, w AS UBYTE, tsb AS UINTEGER) AS UINTEGER
  ASM
  PROC
  LOCAL rc_bad, rc_n, rc_cx, rc_map, rc_ln, rc_w, rc_b, rc_start, rc_cell, rc_sh
  LOCAL rc_shd, rc_line, rc_byte, rc_ok, rc_nw, rc_end
  jr rc_start
rc_bad:
  defw 0
rc_n:
  defb 0
rc_cx:
  defb 0
rc_map:
  defw 0
rc_ln:
  defb 0
rc_w:
  defb 0
rc_b:
  defb 0
rc_start:
  ld hl, 0
  ld (rc_bad), hl
  ld a, (ix+9)
  or a
  jp z, rc_end
  ld (rc_n), a
  ld a, (ix+13)
  ld (rc_w), a
  ld a, (ix+5)
  ld (rc_cx), a
  ld l, (ix+10)
  ld h, (ix+11)
  ld (rc_map), hl
rc_cell:
  ld hl, (rc_map)
  ld a, (hl)
  inc hl
  ld (rc_map), hl
  ld l, a
  ld h, 0
  add hl, hl
  add hl, hl
  add hl, hl
  ld a, (rc_w)
rc_sh:
  srl a
  jr z, rc_shd
  add hl, hl
  jr rc_sh
rc_shd:
  ld e, (ix+14)
  ld d, (ix+15)
  add hl, de
  ex de, hl               ; DE = this tile's data
  ld a, (rc_cx)
  ld c, a
  ld b, (ix+7)
  push de
  call .core.__CB_ADDR
  pop de                  ; HL = address of line 0, byte 0
  ld a, 8
  ld (rc_ln), a
rc_line:
  push hl
  ld a, (rc_w)
  ld (rc_b), a
rc_byte:
  ld a, (de)
  inc de
  cp (hl)
  jr z, rc_ok
  push hl
  ld hl, (rc_bad)
  inc hl
  ld (rc_bad), hl
  pop hl
rc_ok:
  inc hl
  ld a, h
  and 7
  or l
  jr nz, rc_nw
  ld a, h
  sub 8
  ld h, a
rc_nw:
  ld a, (rc_b)
  dec a
  ld (rc_b), a
  jr nz, rc_byte
  pop hl
  ld a, h
  add a, 8
  ld h, a
  ld a, (rc_ln)
  dec a
  ld (rc_ln), a
  jr nz, rc_line
  ld a, (rc_cx)
  ld hl, rc_w
  add a, (hl)
  ld (rc_cx), a
  ld a, (rc_n)
  dec a
  ld (rc_n), a
  jp nz, rc_cell
rc_end:
  ld hl, (rc_bad)
  ENDP
  END ASM
END FUNCTION

SUB FillTS(w AS UBYTE)
  DIM t, r, b AS UBYTE
  FOR b = 0 TO 95
    bgr(b) = 24
  NEXT b
  DIM i AS UINTEGER = 0
  FOR t = 0 TO 23
    FOR r = 0 TO 7
      FOR b = 0 TO w - 1
        ts(i) = ((t * 29 + r * 7 + b * 3) AND 127) + 1
        i = i + 1
      NEXT b
    NEXT r
  NEXT t
  FOR r = 0 TO 7
    FOR b = 0 TO w - 1
      ts(i) = 0
      i = i + 1
    NEXT b
  NEXT r
END SUB

REM Restore map (ms bytes per row, 25 rows) into mpA / mpB: screen cell (cx, cy)
REM has tile (7 cx + 5 cy) MOD 24; the columns from gcxs on (only in a map wider
REM than the screen) have junk.
SUB FillMapR(which AS UBYTE, ms AS UBYTE)
  DIM cx, cy, v, rv AS UBYTE
  DIM i AS UINTEGER = 0
  rv = 0
  FOR cy = 0 TO 24
    v = rv
    FOR cx = 0 TO ms - 1
      IF cx < gcxs THEN
        IF which = 0 THEN
          mpA(i) = v
        ELSE
          mpB(i) = v
        END IF
      ELSE
        IF which = 0 THEN
          mpA(i) = 23 - v
        ELSE
          mpB(i) = 23 - v
        END IF
      END IF
      i = i + 1
      v = v + 7
      IF v >= 24 THEN v = v - 24
    NEXT cx
    rv = rv + 5
    IF rv >= 24 THEN rv = rv - 24
  NEXT cy
END SUB

REM Wide map for TileMapPart into mpC: map cell (mx, my) has tile
REM (7 mx + 11 my + 3) MOD 24; 30 rows of ms bytes.
SUB FillMapP(ms AS UBYTE)
  DIM mx, my, v, rv AS UBYTE
  DIM i AS UINTEGER = 0
  rv = 3
  FOR my = 0 TO 29
    v = rv
    FOR mx = 0 TO ms - 1
      mpC(i) = v
      i = i + 1
      v = v + 7
      IF v >= 24 THEN v = v - 24
    NEXT mx
    rv = rv + 11
    IF rv >= 24 THEN rv = rv - 24
  NEXT my
END SUB

REM Mismatching bytes among n cells of row cy from cell cx, expected tile
REM numbers at mptr. n <= 0: none.
FUNCTION SegBad(cx AS INTEGER, cy AS INTEGER, n AS INTEGER, mptr AS UINTEGER) AS UINTEGER
  IF n <= 0 THEN RETURN 0
  RETURN RowChk(CAST(UBYTE, cx) * gw, CAST(UBYTE, cy) * 8, CAST(UBYTE, n), mptr, gw, @ts(0))
END FUNCTION

REM Index in mp of the tile expected at cell (cx, cy).
FUNCTION ExpIdx(cx AS INTEGER, cy AS INTEGER) AS UINTEGER
  IF gkind = 0 THEN RETURN CAST(UINTEGER, cy) * gms + cx
  RETURN CAST(UINTEGER, cy - gY + gMoy) * gms + CAST(UINTEGER, cx - gX + gMox)
END FUNCTION

REM Checks the touched cell range x0..x1, y0..y1 (cells; may run off the screen):
REM the window one cell larger (clipped to the screen), row by row: background
REM left of the touched cells, the expected tiles, background to the right; rows
REM above and below all background. Then (gcount) the whole 16 KB is counted.
SUB CheckRect(lbl AS STRING, x0 AS INTEGER, y0 AS INTEGER, x1 AS INTEGER, y1 AS INTEGER)
  DIM cx, cy, xa, xb, ya, yb, nx, ny, t0, t1 AS INTEGER
  DIM bad, cnt, want AS UINTEGER
  bad = 0
  ya = y0 - 1
  IF ya < 0 THEN ya = 0
  yb = y1 + 1
  IF yb > 24 THEN yb = 24
  xa = x0 - 1
  IF xa < 0 THEN xa = 0
  xb = x1 + 1
  IF xb > gcxs - 1 THEN xb = gcxs - 1
  t0 = x0
  t1 = x1
  IF t1 > gcxs - 1 THEN t1 = gcxs - 1
  FOR cy = ya TO yb
    IF cy >= y0 AND cy <= y1 AND t0 <= t1 THEN
      bad = bad + SegBad(xa, cy, t0 - xa, @bgr(0))
      bad = bad + SegBad(t0, cy, t1 - t0 + 1, gmp + ExpIdx(t0, cy))
      bad = bad + SegBad(t1 + 1, cy, xb - t1, @bgr(0))
    ELSE
      bad = bad + SegBad(xa, cy, xb - xa + 1, @bgr(0))
    END IF
  NEXT cy
  want = 0
  IF x0 <= gcxs - 1 AND y0 <= 24 THEN
    nx = x1
    IF nx > gcxs - 1 THEN nx = gcxs - 1
    ny = y1
    IF ny > 24 THEN ny = 24
    want = CAST(UINTEGER, (nx - x0 + 1) * (ny - y0 + 1)) * 8 * gw
  END IF
  cnt = want
  IF gcount THEN cnt = CountNE()
  REM put the window back to background (cheaper than a full clear)
  IF xb >= xa THEN
    FOR cy = ya TO yb
      TileMap(@bgr(0), xa, cy, xb - xa + 1, 1)
    NEXT cy
  END IF
  IF cnt <> want THEN ClearBg()
  npass = npass + 1
  IF bad <> 0 OR cnt <> want THEN
    nfail = nfail + 1
    IF nfail <= 14 THEN
      results$ = results$ + "FAIL " + gmode$ + lbl + " (" + STR$(gA) + "," + STR$(gB) + "," + STR$(gC) + "," + STR$(gD) + "," + STR$(gE) + ") badbytes=" + STR$(bad) + " count=" + STR$(cnt) + " want=" + STR$(want) + CHR$ 13
    END IF
  END IF
END SUB

REM TileRestore(map, mw, x, y, w, h) with x, w in bytes and y, h in lines.
SUB RT(lbl AS STRING, mw AS UBYTE, x AS UBYTE, y AS UBYTE, w AS UBYTE, h AS UBYTE)
  gkind = 0
  gms = mw
  gA = mw: gB = x: gC = y: gD = w: gE = h
  TileRestore(gmp, mw, x, y, w, h)
  CheckRect(lbl, CAST(INTEGER, x) / gw, CAST(INTEGER, y) / 8, (CAST(INTEGER, x) + w - 1) / gw, (CAST(INTEGER, y) + h - 1) / 8)
END SUB

REM TileMapPart of the w x h block at map cell (mox, moy), drawn at cell (x, y).
SUB TP(lbl AS STRING, ms AS UBYTE, mox AS UBYTE, moy AS UBYTE, x AS UBYTE, y AS UBYTE, w AS UBYTE, h AS UBYTE)
  gkind = 1
  gms = ms
  gX = x: gY = y: gMox = mox: gMoy = moy
  gA = mox: gB = moy: gC = x: gD = y: gE = w * 256 + h
  TileMapPart(gmp + CAST(UINTEGER, moy) * ms + mox, ms, x, y, w, h)
  CheckRect(lbl, x, y, CAST(INTEGER, x) + w - 1, CAST(INTEGER, y) + h - 1)
END SUB

SUB RestoreCases(mw AS UBYTE, level AS UBYTE)
  DIM i, j, st, lv2 AS UBYTE
  DIM W AS UBYTE
  W = gw
  lv2 = (level >= 2)
  REM aligned
  gcount = 0
  RT("al1", mw, 0, 0, W, 8)
  RT("al2", mw, 2 * W, 16, 3 * W, 16)
  gcount = 1
  IF level >= 3 THEN RT("al3", mw, 0, 0, 80, 200)
  gcount = lv2
  IF level >= 3 THEN RT("tall", mw, 4, 0, 4, 120)
  IF level >= 3 THEN RT("wide", mw, 0, 24, 80, 8)
  REM unaligned
  gcount = 0
  RT("un1", mw, 5, 5, 7, 13)
  RT("un2", mw, 1, 7, 1, 2)
  RT("un3", mw, 3, 8, 5, 8)
  RT("un4", mw, W + 1, 9, 2 * W, 9)
  RT("un5", mw, 7, 15, 8, 2)
  gcount = lv2
  IF level >= 3 THEN RT("un6", mw, 3, 1, 33, 90)
  REM 1 byte x 1 line
  gcount = 0
  RT("p1", mw, 0, 0, 1, 1)
  RT("p2", mw, 37, 99, 1, 1)
  RT("p3", mw, 79, 199, 1, 1)
  RT("p4", mw, 4, 7, 1, 1)
  RT("p5", mw, 4, 8, 1, 1)
  RT("p6", mw, 3, 0, 1, 1)
  RT("p7", mw, W, 8, 1, 1)
  RT("p8", mw, 79, 0, 1, 1)
  RT("p9", mw, 0, 199, 1, 1)
  REM last cell row / last column cell
  RT("last1", mw, 80 - W, 192, W, 8)
  RT("last2", mw, 79, 192, 1, 8)
  IF level >= 3 THEN RT("last3", mw, 0, 192, 80, 8)
  RT("last4", mw, 80 - W, 0, W, 8)
  REM clipped at the right edge (x + w - 1 > 79); the whole screen is counted
  gcount = 1
  RT("cr1", mw, 78, 10, 4, 16)
  gcount = lv2
  RT("cr2", mw, 79, 0, 3, 8)
  RT("cr3", mw, 76, 50, 10, 1)
  IF level >= 3 THEN RT("cr4", mw, 70, 100, 40, 9)
  RT("cr5", mw, 80 - W + 1, 33, W, 3)
  IF level >= 3 THEN RT("cr6", mw, 79, 17, 255 - 79, 2)
  REM clipped at the bottom edge (y + h - 1 > 199)
  gcount = 1
  RT("cb1", mw, 10, 190, 8, 16)
  gcount = lv2
  IF level >= 3 THEN RT("cb2", mw, 0, 199, 80, 2)
  RT("cb3", mw, 30, 195, 4, 20)
  IF level >= 3 THEN RT("cb4", mw, 31, 193, 6, 63)
  RT("cb5", mw, 2, 185, 3, 55)
  REM corner
  gcount = 1
  RT("cc1", mw, 78, 195, 5, 10)
  gcount = lv2
  RT("cc2", mw, 79, 199, 4, 40)
  REM entirely off the screen: nothing drawn
  gcount = 1
  RT("off1", mw, 80, 0, 4, 8)
  gcount = lv2
  RT("off2", mw, 100, 0, 4, 8)
  RT("off3", mw, 0, 200, 4, 8)
  RT("off4", mw, 40, 208, 4, 8)
  RT("off5", mw, 200, 250, 4, 5)
  REM 4 x 16 "ball" at many positions (full count only when clipped)
  st = 9
  IF level >= 2 THEN st = 4
  IF level >= 3 THEN st = 2
  IF gw <> 4 AND st < 4 THEN st = 4
  i = 0
  DO WHILE i <= 17
    j = 0
    DO WHILE j <= 17
      gcount = (xs(i) > 76) OR (ys(j) > 184)
      IF level < 3 THEN gcount = 0
      RT("ball", mw, xs(i), ys(j), 4, 16)
      j = j + st
    LOOP
    i = i + st
  LOOP
  gcount = 0
END SUB

SUB PartCases(ms AS UBYTE, level AS UBYTE)
  DIM cxs, lv2 AS UBYTE
  cxs = gcxs
  lv2 = (level >= 2)
  gcount = 0
  TP("pt1", ms, 0, 0, 0, 0, 5, 3)
  TP("pt2", ms, 3, 2, 4, 6, 7, 5)
  TP("pt3", ms, 1, 1, 2, 2, 1, 1)
  gcount = 1
  IF level >= 3 THEN TP("pt4", ms, 2, 1, 0, 0, cxs / 2 + 1, 25)
  gcount = 0
  TP("pt5", ms, ms - 4, 3, 5, 4, 4, 6)
  TP("pt6", ms, 4, 0, 0, 0, 3, 1)
  TP("pt7", ms, 6, 5, 8, 0, 1, 20)
  REM partly off the right / bottom / corner
  gcount = 1
  TP("pr1", ms, 5, 2, cxs - 3, 3, 6, 4)
  gcount = lv2
  TP("pr2", ms, 0, 0, cxs - 1, 0, 8, 3)
  TP("pr3", ms, 7, 4, cxs - 2, 10, 12, 2)
  gcount = 1
  TP("pb1", ms, 2, 2, 3, 23, 5, 4)
  gcount = lv2
  TP("pb2", ms, 0, 0, 3, 24, 5, 1)
  TP("pb3", ms, 1, 0, 0, 10, 4, 30)
  gcount = 1
  TP("pc1", ms, 3, 2, cxs - 2, 24, 5, 3)
  gcount = lv2
  TP("pc2", ms, 9, 1, cxs - 1, 23, 3, 6)
  REM entirely off
  gcount = 1
  TP("po1", ms, 1, 1, cxs, 3, 4, 4)
  gcount = lv2
  TP("po2", ms, 1, 1, 2, 25, 4, 4)
  TP("po3", ms, 1, 1, 250, 250, 4, 4)
  gcount = 0
  IF level >= 3 THEN
    REM every start column along the row 22, 3 x 5 blocks
    TP("sweepx", ms, 4, 3, 0, 22, 3, 5)
    TP("sweepx", ms, 4, 3, 1, 22, 3, 5)
    TP("sweepx", ms, 4, 3, 2, 22, 3, 5)
    TP("sweepx", ms, 4, 3, cxs - 4, 22, 3, 5)
    TP("sweepx", ms, 4, 3, cxs - 3, 22, 3, 5)
    TP("sweepx", ms, 4, 3, cxs - 2, 22, 3, 5)
    TP("sweepx", ms, 4, 3, cxs - 1, 22, 3, 5)
    TP("sweepx", ms, 4, 3, cxs, 22, 3, 5)
  END IF
END SUB

REM All the cases for the mode at the current offset.
SUB Suite(lbl AS STRING, level AS UBYTE)
  DIM cxs AS UBYTE
  cxs = gcxs
  gmode$ = lbl + " R "
  ClearBg()
  gmp = @mpA(0)
  RestoreCases(cxs, level)
  IF level >= 2 THEN
    gmode$ = lbl + " Rw "
    gmp = @mpB(0)
    gcount = 0
    RT("w_un1", cxs + 12, 5, 5, 7, 13)
    RT("w_p", cxs + 12, 37, 99, 1, 1)
    gcount = 1
    IF level >= 3 THEN RT("w_all", cxs + 12, 0, 0, 80, 56)
    RT("w_cr1", cxs + 12, 78, 10, 4, 16)
    RT("w_cb1", cxs + 12, 10, 190, 8, 16)
    RT("w_cc", cxs + 12, 79, 199, 4, 40)
    gcount = 0
  END IF
  gmode$ = lbl + " P "
  gcount = 0
  gmp = @mpC(0)
  IF cxs = 20 THEN
    PartCases(32, level)
  ELSE
    IF cxs = 40 THEN
      PartCases(48, level)
    ELSE
      PartCases(96, level)
    END IF
  END IF
END SUB

SUB RealScroll(m AS UBYTE)
  DIM i AS UBYTE
  Mode m
  ScreenInit()
  CLS
  FOR i = 1 TO 30
    PRINT i
  NEXT i
  ScreenInit()
END SUB

SUB SetMode(m AS UBYTE, w AS UBYTE)
  Mode m
  ScreenInit()
  CLS
  gw = w
  gcxs = 80 / w
  FillTS(w)
  SetTileSet(@ts(0))
  FillMapR(0, gcxs)
  FillMapR(1, gcxs + 12)
  IF gcxs = 20 THEN
    FillMapP(32)
  ELSE
    IF gcxs = 40 THEN
      FillMapP(48)
    ELSE
      FillMapP(96)
    END IF
  END IF
END SUB

SUB TSuite(lbl AS STRING, level AS UBYTE)
  tk0 = Ticks()
  Suite(lbl, level)
  tm$ = tm$ + lbl + " " + STR$((Ticks() - tk0) / 300) + "s" + CHR$ 13
END SUB

SUB OneMode(m AS UBYTE, w AS UBYTE, lbl AS STRING, lv0 AS UBYTE, real AS UBYTE)
  SetMode(m, w)
  ForceOffset(0)
  TSuite(lbl + " o0", lv0)
  ForceOffset(48)
  TSuite(lbl + " o48", 1)
  ForceOffset(50)
  TSuite(lbl + " o50", 2)
  ForceOffset(2046)
  TSuite(lbl + " o2046", 1)
  IF real THEN
    ScreenInit()
    RealScroll(m)
    gw = w
    gcxs = 80 / w
    SetTileSet(@ts(0))
REM bare text scrolls in software: the offset is always 0 there
#ifndef CPC_BAREMETAL
    IF ScrollOffset() = 0 THEN
      results$ = results$ + "FAIL " + lbl + " real scroll offset is 0" + CHR$ 13
      nfail = nfail + 1
    END IF
#endif
    TSuite(lbl + " real", 1)
  END IF
END SUB

DIM i AS UBYTE
FOR i = 0 TO 7
  xs(i) = i
NEXT i
xs(8) = 10: xs(9) = 37: xs(10) = 38: xs(11) = 39: xs(12) = 40: xs(13) = 41
xs(14) = 75: xs(15) = 76: xs(16) = 77: xs(17) = 79
ys(0) = 0: ys(1) = 1: ys(2) = 3: ys(3) = 4: ys(4) = 7: ys(5) = 8
ys(6) = 9: ys(7) = 15: ys(8) = 16: ys(9) = 17: ys(10) = 100: ys(11) = 104
ys(12) = 105: ys(13) = 184: ys(14) = 185: ys(15) = 192: ys(16) = 193: ys(17) = 199

OneMode(1, 2, "m1", 3, 1)
OneMode(0, 4, "m0", 3, 0)
OneMode(2, 1, "m2", 3, 0)

Mode 1
ScreenInit()
CLS
PRINT AT 0, 0;
PRINT "PASS "; npass; " checks, FAIL "; nfail
PRINT results$; tm$; "DONE"
END

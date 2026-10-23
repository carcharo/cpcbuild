REM Conformance: cpcbuild tile width (SetTileWidth / TileWidth) -- the tile
REM width W (1, 2 or 4 bytes) set independently of the mode: TileWidth()
REM per mode and setting, then DoTile8, DoTile16, TileMap, TileMapPart and
REM TileRestore for the non-default combinations (mode 0 with W 2 and 1,
REM mode 1 with W 1 and 4, mode 2 with W 2 and 4) at the screen edges and off
REM screen, then the wrapping (slow) paths with a forced scroll offset, and
REM a full-width 40 x 25 map in mode 0 with W = 2.
REM
REM Tile t's byte at row r, byte column b is ((t*29 + r*7 + b*3) AND 127) + 1
REM (never 0), so a wrong tile, row or byte shows up. The screen is cleared
REM through memory (not CLS) so untouched bytes are 0 whatever the offset.
REM Cell (cx, cy) of the shared map holds tile (7 cx + 5 cy) MOD 24. Every
REM expectation is worked out in BASIC from the cell ranges, and the screen
REM is read through the library's addressing (one byte at a time).

#include <cpc.bas>
#include <cpcbuild/display.bas>
#include <cpcbuild/tiles.bas>

REM Only the failures are buffered (the heap is small, and PRINTing during
REM the tests would disturb the screen); the passes are counted.
DIM results$ AS STRING
DIM npass AS UINTEGER = 0
SUB CHK(name AS STRING, gotv AS STRING, wantv AS STRING)
  IF gotv = wantv THEN
    npass = npass + 1
  ELSE
    results$ = results$ + "FAIL " + name + " got=" + gotv + " want=" + wantv + CHR$ 13
  END IF
END SUB

REM Forces the library's idea of the scroll offset (to reach rows that
REM straddle the end of a block, which a real hardware scroll never does).
SUB ForceOffset(v AS UINTEGER)
  ASM
  ld l, (ix+4)
  ld h, (ix+5)
  ld (.core.CB_OFFSET), hl
  END ASM
END SUB

SUB ClearScr
  ASM
  ld hl, $C000
  ld de, $C001
  ld bc, $3FFF
  ld (hl), 0
  ldir
  END ASM
END SUB

DIM gw AS UBYTE
DIM gcxs AS UBYTE
DIM ts(0 TO 24 * 32 - 1) AS UBYTE
DIM mp(0 TO 31) AS UBYTE
DIM mpf(0 TO 1999) AS UBYTE
DIM mpw(0 TO 369) AS UBYTE

SUB FillTS(w AS UBYTE)
  DIM t, r, b AS UBYTE
  DIM i AS UINTEGER = 0
  FOR t = 0 TO 23
    FOR r = 0 TO 7
      FOR b = 0 TO w - 1
        ts(i) = ((t * 29 + r * 7 + b * 3) AND 127) + 1
        i = i + 1
      NEXT b
    NEXT r
  NEXT t
END SUB

REM The shared map: cxs x 25 cells, cell (cx, cy) = tile (7 cx + 5 cy) MOD 24;
REM and mpw, a 37-wide map for TileMapPart.
SUB FillMaps(cxs AS UBYTE)
  DIM cx, cy AS UBYTE
  DIM v AS UINTEGER
  FOR cy = 0 TO 24
    FOR cx = 0 TO cxs - 1
      v = CAST(UINTEGER, cx) * 7 + CAST(UINTEGER, cy) * 5
      mpf(CAST(UINTEGER, cy) * cxs + cx) = v MOD 24
    NEXT cx
  NEXT cy
  FOR v = 0 TO 369
    mpw(v) = (v * 5 + 1) MOD 24
  NEXT v
END SUB

REM Number of screen bytes (of all 16 KB) that are not 0.
FUNCTION CountNZ AS UINTEGER
  ASM
  ld hl, $C000
  ld de, 0
cnz_l:
  ld a, (hl)
  or a
  jr z, cnz_z
  inc de
cnz_z:
  inc hl
  ld a, h
  or l
  jr nz, cnz_l
  ex de, hl
  END ASM
END FUNCTION

REM Bytes that differ between the w bytes x 8 lines at byte column xb, line
REM yl (read through the library's addressing, one byte at a time) and the
REM data at src (rows top first).
FUNCTION TileChk(xb AS UBYTE, yl AS UBYTE, src AS UINTEGER, w AS UBYTE) AS UINTEGER
  ASM
  PROC
  LOCAL tb_bad, tb_ln, tb_b, tb_start, tb_line, tb_byte, tb_ok
  jr tb_start
tb_bad:
  defw 0
tb_ln:
  defb 0
tb_b:
  defb 0
tb_start:
  ld b, (ix+7)
  ld e, (ix+8)
  ld d, (ix+9)
  ld hl, 0
  ld (tb_bad), hl
  ld a, 8
  ld (tb_ln), a
tb_line:
  ld c, (ix+5)
  ld a, (ix+11)
  ld (tb_b), a
tb_byte:
  push de
  call .core.__CB_ADDR
  pop de
  ld a, (de)
  inc de
  cp (hl)
  jr z, tb_ok
  ld hl, (tb_bad)
  inc hl
  ld (tb_bad), hl
tb_ok:
  inc c
  ld a, (tb_b)
  dec a
  ld (tb_b), a
  jr nz, tb_byte
  inc b
  ld a, (tb_ln)
  dec a
  ld (tb_ln), a
  jr nz, tb_line
  ld hl, (tb_bad)
  ENDP
  END ASM
END FUNCTION

REM Bytes of tile cell (cx, cy) that differ from tile t's data.
FUNCTION TileBad(cx AS UBYTE, cy AS UBYTE, t AS UBYTE) AS UINTEGER
  DIM src AS UINTEGER
  src = @ts(0) + CAST(UINTEGER, t) * 8 * gw
  RETURN TileChk(cx * gw, cy * 8, src, gw)
END FUNCTION

REM Mismatching bytes over the vw x vh cells at (x, y), whose expected tile
REM numbers are the bytes at base (rows mw bytes apart).
FUNCTION BlockBad(base AS UINTEGER, mw AS UINTEGER, x AS UBYTE, y AS UBYTE, vw AS UBYTE, vh AS UBYTE) AS UINTEGER
  DIM i, j AS UBYTE
  DIM bad AS UINTEGER = 0
  IF vw = 0 OR vh = 0 THEN RETURN 0
  FOR j = 0 TO vh - 1
    FOR i = 0 TO vw - 1
      bad = bad + TileBad(x + i, y + j, PEEK(base + CAST(UINTEGER, j) * mw + i))
    NEXT i
  NEXT j
  RETURN bad
END FUNCTION

REM Mismatching bytes over the whole screen against the shared map.
FUNCTION AllBad AS UINTEGER
  RETURN BlockBad(@mpf(0), gcxs, 0, 0, gcxs, 25)
END FUNCTION

REM TileRestore(x, y, w, h) (bytes, lines) from the shared map: every cell the
REM rectangle touches (clipped to the screen) is right, and nothing else drawn.
SUB RestoreCase(lbl AS STRING, x AS UBYTE, y AS UBYTE, w AS UBYTE, h AS UBYTE)
  DIM x0, x1, y0, y1 AS INTEGER
  DIM bad, ncell AS UINTEGER
  ClearScr()
  TileRestore(@mpf(0), gcxs, x, y, w, h)
  x0 = CAST(INTEGER, x) / gw
  x1 = (CAST(INTEGER, x) + w - 1) / gw
  IF x1 > gcxs - 1 THEN x1 = gcxs - 1
  y0 = CAST(INTEGER, y) / 8
  y1 = (CAST(INTEGER, y) + h - 1) / 8
  IF y1 > 24 THEN y1 = 24
  bad = 0
  ncell = 0
  IF x0 <= x1 AND y0 <= y1 THEN
    bad = BlockBad(@mpf(y0 * gcxs + x0), gcxs, CAST(UBYTE, x0), CAST(UBYTE, y0), CAST(UBYTE, x1 - x0 + 1), CAST(UBYTE, y1 - y0 + 1))
    ncell = CAST(UINTEGER, (x1 - x0 + 1) * (y1 - y0 + 1))
  END IF
  CHK(lbl + " bytes", STR$(bad), "0")
  CHK(lbl + " nothing_else", STR$(CountNZ()), STR$(ncell * 8 * gw))
END SUB

REM Everything on the current mode at tile width w (the tile set and the
REM shared map are filled here; the mode is already set).
SUB Suite(lbl AS STRING, w AS UBYTE)
  DIM cxs, cx, cy AS UBYTE
  DIM bad AS UINTEGER
  DIM wu AS UINTEGER
  cxs = 80 / w
  wu = w
  gw = w
  gcxs = cxs
  FillTS(w)
  FillMaps(cxs)
  SetTileSet(@ts(0))
  CHK(lbl + " width", STR$(TileWidth()), STR$(w))
  ClearScr()

  REM DoTile8: middle, last column, row 24; then off screen (one past the
  REM last column, row 25) draws nothing
  DoTile8(cxs / 2, 10, 9)
  DoTile8(cxs - 1, 5, 11)
  DoTile8(3, 24, 13)
  bad = TileBad(cxs / 2, 10, 9) + TileBad(cxs - 1, 5, 11) + TileBad(3, 24, 13)
  CHK(lbl + " tile8_bytes", STR$(bad), "0")
  DoTile8(cxs, 5, 5)
  DoTile8(cxs, 24, 5)
  DoTile8(3, 25, 5)
  DoTile8(cxs - 1, 25, 5)
  DoTile8(255, 255, 5)
  CHK(lbl + " tile8_nothing_else", STR$(CountNZ()), STR$(3 * 8 * wu))

  REM DoTile16: parts 4n..4n+3 as TL, TR, BL, BR; right edge; bottom clipped
  ClearScr()
  DoTile16(3, 2, 5)
  bad = TileBad(6, 4, 20) + TileBad(7, 4, 21) + TileBad(6, 5, 22) + TileBad(7, 5, 23)
  CHK(lbl + " tile16_order", STR$(bad), "0")
  DoTile16(cxs / 2 - 1, 0, 1)
  bad = TileBad(cxs - 2, 0, 4) + TileBad(cxs - 1, 0, 5) + TileBad(cxs - 2, 1, 6) + TileBad(cxs - 1, 1, 7)
  CHK(lbl + " tile16_right_edge", STR$(bad), "0")
  DoTile16(1, 12, 2)
  bad = TileBad(2, 24, 8) + TileBad(3, 24, 9)
  CHK(lbl + " tile16_bottom_clipped", STR$(bad), "0")
  DoTile16(cxs / 2, 5, 1)
  DoTile16(cxs / 2, 12, 1)
  DoTile16(200, 3, 1)
  DoTile16(255, 255, 1)
  DoTile16(3, 13, 1)
  CHK(lbl + " tile16_nothing_else", STR$(CountNZ()), STR$(10 * 8 * wu))

  REM TileMap, 3 x 2 at (4, 6)
  ClearScr()
  FOR cy = 0 TO 5
    mp(cy) = (cy * 7 + 1) MOD 24
  NEXT cy
  TileMap(@mp(0), 4, 6, 3, 2)
  CHK(lbl + " map_3x2", STR$(BlockBad(@mp(0), 3, 4, 6, 3, 2)), "0")
  CHK(lbl + " map_3x2_nothing_else", STR$(CountNZ()), STR$(6 * 8 * wu))

  REM clipped at the right and bottom edges: 6 x 4 at (cxs-3, 22): 3 x 3 visible
  ClearScr()
  FOR cy = 0 TO 23
    mp(cy) = (cy * 5 + 2) MOD 24
  NEXT cy
  TileMap(@mp(0), cxs - 3, 22, 6, 4)
  CHK(lbl + " map_clipped", STR$(BlockBad(@mp(0), 6, cxs - 3, 22, 3, 3)), "0")
  CHK(lbl + " map_clipped_nothing_else", STR$(CountNZ()), STR$(9 * 8 * wu))
  REM fully off: nothing
  ClearScr()
  TileMap(@mp(0), cxs, 3, 6, 4)
  TileMap(@mp(0), 2, 25, 6, 4)
  TileMap(@mp(0), 255, 255, 6, 4)
  CHK(lbl + " map_off_skipped", STR$(CountNZ()), "0")

  REM TileMapPart out of a 37-wide map: 4 x 3 from (5, 2) at (6, 3)
  ClearScr()
  TileMapPart(@mpw(2 * 37 + 5), 37, 6, 3, 4, 3)
  CHK(lbl + " part_4x3", STR$(BlockBad(@mpw(2 * 37 + 5), 37, 6, 3, 4, 3)), "0")
  CHK(lbl + " part_4x3_nothing_else", STR$(CountNZ()), STR$(12 * 8 * wu))
  REM 6 x 4 from (3, 1) at (cxs-2, 23): 2 x 2 visible
  ClearScr()
  TileMapPart(@mpw(1 * 37 + 3), 37, cxs - 2, 23, 6, 4)
  CHK(lbl + " part_clipped", STR$(BlockBad(@mpw(1 * 37 + 3), 37, cxs - 2, 23, 2, 2)), "0")
  CHK(lbl + " part_clipped_nothing_else", STR$(CountNZ()), STR$(4 * 8 * wu))

  REM TileRestore of rectangles that are not cell-aligned (x in bytes)
  RestoreCase(lbl + " rs_a", w + 1, 5, w + 1, 13)
  RestoreCase(lbl + " rs_b", 2 * w + 1, 9, 2 * w, 8)
  RestoreCase(lbl + " rs_c", 7, 100, 1, 1)
  RestoreCase(lbl + " rs_right", 79, 192, 3, 8)
  RestoreCase(lbl + " rs_bottom", 10, 195, 4, 20)
  RestoreCase(lbl + " rs_corner", 78, 197, 6, 20)
  RestoreCase(lbl + " rs_off", 80, 0, 4, 8)
END SUB

REM Wrapping (slow) paths: rows that straddle the end of their 2 KB block at
REM the forced offset; every cell by DoTile8, by TileMap, a TileMapPart block and a
REM TileRestore.
SUB Wrap(lbl AS STRING, forced AS UINTEGER)
  DIM cx, cy AS UBYTE
  DIM wu AS UINTEGER
  wu = gw
  ForceOffset(forced)
  ClearScr()
  FOR cy = 0 TO 24
    FOR cx = 0 TO gcxs - 1
      DoTile8(cx, cy, mpf(CAST(UINTEGER, cy) * gcxs + cx))
    NEXT cx
  NEXT cy
  CHK(lbl + " wrap_tile8", STR$(AllBad()), "0")
  CHK(lbl + " wrap_tile8_count", STR$(CountNZ()), STR$(wu * gcxs * 200))
  ClearScr()
  TileMap(@mpf(0), 0, 0, gcxs, 25)
  CHK(lbl + " wrap_map", STR$(AllBad()), "0")
  CHK(lbl + " wrap_map_count", STR$(CountNZ()), STR$(wu * gcxs * 200))
  ClearScr()
  TileMapPart(@mpf(CAST(UINTEGER, 2) * gcxs + 3), gcxs, 3, 2, 7, 5)
  CHK(lbl + " wrap_part", STR$(BlockBad(@mpf(CAST(UINTEGER, 2) * gcxs + 3), gcxs, 3, 2, 7, 5)), "0")
  CHK(lbl + " wrap_part_count", STR$(CountNZ()), STR$(35 * 8 * wu))
  RestoreCase(lbl + " wrap_rs", 5, 13, 2 * gw + 3, 30)
  ForceOffset(0)
END SUB

REM TileWidth() after the settings, in the current mode (mw = the mode's width)
SUB WidthCases(lbl AS STRING, mw AS UBYTE)
  SetTileWidth(0)
  CHK(lbl + " default", STR$(TileWidth()), STR$(mw))
  SetTileWidth(1)
  CHK(lbl + " set1", STR$(TileWidth()), "1")
  SetTileWidth(2)
  CHK(lbl + " set2", STR$(TileWidth()), "2")
  SetTileWidth(4)
  CHK(lbl + " set4", STR$(TileWidth()), "4")
  SetTileWidth(2)
  SetTileWidth(0)
  CHK(lbl + " set0_back", STR$(TileWidth()), STR$(mw))
  SetTileWidth(2)
  SetTileWidth(3)
  CHK(lbl + " set3_back", STR$(TileWidth()), STR$(mw))
  SetTileWidth(4)
  SetTileWidth(8)
  CHK(lbl + " set8_back", STR$(TileWidth()), STR$(mw))
  SetTileWidth(1)
  SetTileWidth(255)
  CHK(lbl + " set255_back", STR$(TileWidth()), STR$(mw))
END SUB

SUB SetMode(m AS UBYTE, w AS UBYTE)
  Mode m
  ScreenInit()
  CLS
  SetTileWidth(w)
END SUB

REM --- TileWidth() ---
Mode 0
ScreenInit()
WidthCases("m0", 4)
Mode 1
ScreenInit()
WidthCases("m1", 2)
Mode 2
ScreenInit()
WidthCases("m2", 1)

REM the setting survives a mode change
SetTileWidth(2)
Mode 1
ScreenInit()
CHK("keep_m2_to_m1", STR$(TileWidth()), "2")
Mode 0
ScreenInit()
CHK("keep_m1_to_m0", STR$(TileWidth()), "2")
Mode 2
ScreenInit()
CHK("keep_m0_to_m2", STR$(TileWidth()), "2")
SetTileWidth(4)
Mode 1
ScreenInit()
CHK("keep4_m1", STR$(TileWidth()), "4")
SetTileWidth(0)
CHK("keep_cleared_m1", STR$(TileWidth()), "2")
Mode 2
ScreenInit()
CHK("keep_cleared_m2", STR$(TileWidth()), "1")

REM --- non-default combinations ---
SetMode(0, 2)
Suite("m0w2", 2)
SetMode(0, 1)
Suite("m0w1", 1)
SetMode(1, 1)
Suite("m1w1", 1)
SetMode(1, 4)
Suite("m1w4", 4)
SetMode(2, 2)
Suite("m2w2", 2)
SetMode(2, 4)
Suite("m2w4", 4)

REM --- wrapping paths, mode 0 with W = 2 (and two others) ---
SetMode(0, 2)
Suite("m0w2_b", 2)
Wrap("m0w2_o50", 50)
Wrap("m0w2_o2046", 2046)
Wrap("m0w2_o2047", 2047)
Wrap("m0w2_o1000", 1000)
SetMode(1, 4)
Suite("m1w4_b", 4)
Wrap("m1w4_o2046", 2046)
SetMode(2, 2)
Suite("m2w2_b", 2)
Wrap("m2w2_o2047", 2047)

REM --- mode 0, W = 2: a full-width 40 x 25 map, a sample of cells ---
SetMode(0, 2)
Suite("m0w2_c", 2)
ForceOffset(0)
ClearScr()
TileMap(@mpf(0), 0, 0, 40, 25)
CHK("full_corners", STR$(BlockBad(@mpf(0), 40, 0, 0, 1, 1) + BlockBad(@mpf(39), 40, 39, 0, 1, 1) + BlockBad(@mpf(24 * 40), 40, 0, 24, 1, 1) + BlockBad(@mpf(24 * 40 + 39), 40, 39, 24, 1, 1)), "0")
CHK("full_sample", STR$(BlockBad(@mpf(7 * 40 + 13), 40, 13, 7, 9, 4) + BlockBad(@mpf(20 * 40 + 30), 40, 30, 20, 8, 3) + BlockBad(@mpf(12 * 40 + 20), 40, 20, 12, 1, 1)), "0")
CHK("full_all", STR$(AllBad()), "0")
CHK("full_count", STR$(CountNZ()), "16000")
ClearScr()
TileMap(@mpf(0), 0, 0, 40, 40)
CHK("full_too_tall_count", STR$(CountNZ()), "16000")

SetTileWidth(0)
CHK("final_default", STR$(TileWidth()), "4")
Mode 1
ScreenInit()
CLS
PRINT AT 0, 0;
PRINT "PASS "; npass; " checks"
PRINT results$; "DONE"
END

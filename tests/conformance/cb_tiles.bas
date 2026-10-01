REM Conformance: cpcbuild tiles (Phase 4c) -- SetTileSet, DoTile8, DoTile16,
REM TileMap in modes 0, 1 and 2, at the screen edges, off screen, and with a
REM hardware-scroll offset (rows wrapping in their 2 KB block).
REM
REM Tile t's byte at row r, byte column b is ((t*29 + r*7 + b*3) AND 127) + 1
REM (never 0), so a wrong tile, row or byte shows up. The screen is cleared
REM through memory (not CLS) so untouched bytes are 0 whatever the offset.
REM The last lines MEASURE speed (informational): the 300 Hz firmware clock
REM only runs with interrupts on, so the timed code is run through the
REM firmware call gate (which enables them), which adds the interrupt
REM handler's own time to the figures.

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

FUNCTION FASTCALL Ticks AS ULONG
  ASM
  call .core.__FW_CALL
  defw $BD0D
  END ASM
END FUNCTION

FUNCTION FASTCALL ScrollOffset AS UINTEGER
  ASM
  call .core.__FW_CALL
  defw $BC0B
  END ASM
END FUNCTION

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

DIM ts(0 TO 24 * 32 - 1) AS UBYTE
DIM mp(0 TO 31) AS UBYTE
DIM mpf(0 TO 1999) AS UBYTE

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
FUNCTION TileBad(cx AS UBYTE, cy AS UBYTE, t AS UBYTE, w AS UBYTE) AS UINTEGER
  DIM src AS UINTEGER
  src = @ts(0) + CAST(UINTEGER, t) * 8 * w
  RETURN TileChk(cx * w, cy * 8, src, w)
END FUNCTION

REM Checks a whole-screen pattern: cell (cx, cy) has tile (cx + cy*3) MOD 24,
REM for the rows 0, 24 and the three around wr (the row that wraps round the
REM block end at the current offset; the other rows are alike).
FUNCTION FullBad(w AS UBYTE, wr AS UBYTE) AS UINTEGER
  DIM cx, cy AS UBYTE
  DIM bad AS UINTEGER = 0
  FOR cy = 0 TO 24
    IF cy = 0 OR cy = 24 OR (cy + 1 >= wr AND cy <= wr + 1) THEN
      FOR cx = 0 TO 80 / w - 1
        bad = bad + TileBad(cx, cy, (cx + cy * 3) AND 15, w)
      NEXT cx
    END IF
  NEXT cy
  RETURN bad
END FUNCTION

REM full = 0 skips the whole-screen checks (the slow ones).
SUB Suite(lbl AS STRING, w AS UBYTE, forced AS UINTEGER, full AS UBYTE)
  DIM cxs, cx, cy, wr AS UBYTE
  DIM off, wu AS UINTEGER
  DIM bad, nz AS UINTEGER
  cxs = 80 / w
  wu = w
  SetTileSet(@ts(0))
  IF forced > 0 THEN ForceOffset(forced)
  off = ScrollOffset()
  IF forced > 0 THEN off = forced
  wr = 12
  IF off > 0 THEN wr = (2048 - off) / 80
  IF wr > 24 THEN wr = 24
  ClearScr()

  REM single tiles: top-left, bottom-right, middle
  DoTile8(0, 0, 3)
  DoTile8(cxs - 1, 24, 7)
  DoTile8(cxs / 2, 10, 23)
  bad = TileBad(0, 0, 3, w) + TileBad(cxs - 1, 24, 7, w) + TileBad(cxs / 2, 10, 23, w)
  CHK(lbl + " tile8_bytes", STR$(bad), "0")

  REM off-screen cells draw nothing
  DoTile8(cxs, 0, 5)
  DoTile8(cxs, 24, 5)
  DoTile8(0, 25, 5)
  DoTile8(cxs - 1, 25, 5)
  DoTile8(255, 255, 5)
  DoTile8(200, 3, 5)
  CHK(lbl + " tile8_offscreen_skipped", STR$(CountNZ()), STR$(3 * 8 * wu))

  IF full THEN
    REM every cell with DoTile8 (includes the row that wraps)
    ClearScr()
    FOR cy = 0 TO 24
      IF cy = 0 OR cy = 24 OR (cy + 1 >= wr AND cy <= wr + 1) THEN
        FOR cx = 0 TO cxs - 1
          DoTile8(cx, cy, (cx + cy * 3) AND 15)
        NEXT cx
      END IF
    NEXT cy
    CHK(lbl + " tile8_fullscreen", STR$(FullBad(w, wr)), "0")
  END IF

  REM DoTile16: parts 4n..4n+3 as TL, TR, BL, BR; edges
  ClearScr()
  DoTile16(3, 2, 5)
  bad = TileBad(6, 4, 20, w) + TileBad(7, 4, 21, w) + TileBad(6, 5, 22, w) + TileBad(7, 5, 23, w)
  CHK(lbl + " tile16_order", STR$(bad), "0")
  DoTile16(cxs / 2 - 1, 0, 1)
  bad = TileBad(cxs - 2, 0, 4, w) + TileBad(cxs - 1, 0, 5, w) + TileBad(cxs - 2, 1, 6, w) + TileBad(cxs - 1, 1, 7, w)
  CHK(lbl + " tile16_right_edge", STR$(bad), "0")
  DoTile16(1, 12, 2)
  bad = TileBad(2, 24, 8, w) + TileBad(3, 24, 9, w)
  CHK(lbl + " tile16_bottom_clipped", STR$(bad), "0")
  DoTile16(cxs / 2, 5, 1)
  DoTile16(200, 3, 1)
  DoTile16(255, 255, 1)
  DoTile16(3, 13, 1)
  DoTile16(3, 200, 1)
  CHK(lbl + " tile16_offscreen_skipped", STR$(CountNZ()), STR$(10 * 8 * wu))

  REM TileMap, non-square 5 x 3 at (4, 6)
  ClearScr()
  FOR cy = 0 TO 14
    mp(cy) = (cy * 7 + 1) MOD 24
  NEXT cy
  TileMap(@mp(0), 4, 6, 5, 3)
  bad = 0
  FOR cy = 0 TO 2
    FOR cx = 0 TO 4
      bad = bad + TileBad(4 + cx, 6 + cy, mp(cy * 5 + cx), w)
    NEXT cx
  NEXT cy
  CHK(lbl + " map_5x3", STR$(bad), "0")
  CHK(lbl + " map_5x3_nothing_else", STR$(CountNZ()), STR$(15 * 8 * wu))

  REM partly off screen: 6 x 4 at (cxs-3, 23): 3 x 2 visible
  ClearScr()
  FOR cy = 0 TO 23
    mp(cy) = (cy * 5 + 2) MOD 24
  NEXT cy
  TileMap(@mp(0), cxs - 3, 23, 6, 4)
  bad = 0
  FOR cy = 0 TO 1
    FOR cx = 0 TO 2
      bad = bad + TileBad(cxs - 3 + cx, 23 + cy, mp(cy * 6 + cx), w)
    NEXT cx
  NEXT cy
  CHK(lbl + " map_partly_off", STR$(bad), "0")
  TileMap(@mp(0), cxs, 3, 6, 4)
  TileMap(@mp(0), 2, 25, 6, 4)
  TileMap(@mp(0), 2, 3, 0, 4)
  TileMap(@mp(0), 2, 3, 6, 0)
  TileMap(@mp(0), 255, 255, 6, 4)
  CHK(lbl + " map_fully_off_skipped", STR$(CountNZ()), STR$(6 * 8 * wu))

  IF full THEN
    REM full-screen map
    ClearScr()
    FOR cy = 0 TO 24
      FOR cx = 0 TO cxs - 1
        mpf(CAST(UINTEGER, cy) * cxs + cx) = (cx + cy * 3) AND 15
      NEXT cx
    NEXT cy
    TileMap(@mpf(0), 0, 0, cxs, 25)
    CHK(lbl + " map_fullscreen", STR$(FullBad(w, wr)), "0")
    CHK(lbl + " map_fullscreen_count", STR$(CountNZ()), STR$(wu * cxs * 200))
    REM and taller than the screen: same picture
    ClearScr()
    TileMap(@mpf(0), 0, 0, cxs, 40)
    CHK(lbl + " map_too_tall_count", STR$(CountNZ()), STR$(wu * cxs * 200))
  END IF
END SUB

REM Runs n cells' worth of the DoTile8 core (cell 5,5 tile 3) with the
REM interrupts on (through the gate), for the 300 Hz clock.
SUB TimedTiles(n AS UINTEGER)
  ASM
  PROC
  LOCAL tt_run, tt_n, tt_end, tt_loop
  ld l, (ix+4)
  ld h, (ix+5)
  ld (tt_n), hl
  call .core.__FW_CALL
  defw tt_run
  jr tt_end
tt_n:
  defw 0
tt_run:
  ld hl, (tt_n)
tt_loop:
  push hl
  ld c, 5
  ld b, 5
  ld hl, 3
  call .core.__CB_TILE_AT
  pop hl
  dec hl
  ld a, h
  or l
  jr nz, tt_loop
  ret
tt_end:
  ENDP
  END ASM
END SUB

REM Runs n full-screen (cxs x 25) TileMaps likewise.
SUB TimedMaps(n AS UINTEGER, mapaddr AS UINTEGER, cxs AS UBYTE)
  ASM
  PROC
  LOCAL tm_run, tm_n, tm_map, tm_w, tm_end, tm_loop
  ld l, (ix+4)
  ld h, (ix+5)
  ld (tm_n), hl
  ld l, (ix+6)
  ld h, (ix+7)
  ld (tm_map), hl
  ld a, (ix+9)
  ld (tm_w), a
  call .core.__FW_CALL
  defw tm_run
  jr tm_end
tm_n:
  defw 0
tm_map:
  defw 0
tm_w:
  defb 0
tm_run:
  ld hl, (tm_n)
tm_loop:
  push hl
  ld hl, (tm_map)
  ld de, 0
  ld a, (tm_w)
  ld c, a
  ld b, 25
  call .core.__CB_TILEMAP
  pop hl
  dec hl
  ld a, h
  or l
  jr nz, tm_loop
  ret
tm_end:
  ENDP
  END ASM
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

DIM t0, t1, t2 AS ULONG

REM --- mode 1 ---
FillTS(2)
Mode 1
ScreenInit()
CLS
Suite("m1", 2, 0, 1)
RealScroll(1)
CHK("m1_real_offset_nonzero", STR$(ScrollOffset() > 0), "1")
Suite("m1_scrolled", 2, 0, 1)
ScreenInit()
Suite("m1_off2047", 2, 2047, 1)

REM --- mode 0 ---
FillTS(4)
Mode 0
ScreenInit()
CLS
Suite("m0", 4, 0, 0)
RealScroll(0)
CHK("m0_real_offset_nonzero", STR$(ScrollOffset() > 0), "1")
Suite("m0_scrolled", 4, 0, 1)
ScreenInit()
Suite("m0_off2046", 4, 2046, 1)

REM --- mode 2 ---
FillTS(1)
Mode 2
ScreenInit()
CLS
Suite("m2", 1, 0, 0)
RealScroll(2)
CHK("m2_real_offset_nonzero", STR$(ScrollOffset() > 0), "1")
Suite("m2_scrolled", 1, 0, 1)

REM --- speed, mode 1, no offset ---
Mode 1
ScreenInit()
CLS
FillTS(2)
SetTileSet(@ts(0))
DIM sp$ AS STRING
t0 = Ticks()
TimedTiles(500)
t1 = Ticks()
sp$ = "SPEED 500 tiles " + STR$(t1 - t0) + " ticks = " + STR$((t1 - t0) * 13333 / 500) + " T/tile"
t0 = Ticks()
TimedTiles(2000)
t1 = Ticks()
sp$ = sp$ + CHR$ 13 + "SPEED 2000 tiles " + STR$(t1 - t0) + " ticks = " + STR$((t1 - t0) * 13333 / 2000) + " T/tile"
FOR t2 = 0 TO 999
  mpf(t2) = t2 MOD 24
NEXT t2
t0 = Ticks()
TimedMaps(1, @mpf(0), 40)
t1 = Ticks()
sp$ = sp$ + CHR$ 13 + "SPEED 1 map 40x25 " + STR$(t1 - t0) + " ticks = " + STR$((t1 - t0) * 13333 / 1000) + " T/tile"
t0 = Ticks()
TimedMaps(3, @mpf(0), 40)
t1 = Ticks()
sp$ = sp$ + CHR$ 13 + "SPEED 3 maps " + STR$(t1 - t0) + " ticks = " + STR$((t1 - t0) * 13333 / 3000) + " T/tile = " + STR$((t1 - t0) * 13333 / 3) + " T/map"

Mode 1
ScreenInit()
CLS
PRINT AT 0, 0;
PRINT "PASS "; npass; " checks"
PRINT results$; sp$; CHR$ 13; "DONE"
END

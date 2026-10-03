REM BARE: skip until Phase 6 B5 (bare graphics: PLOT/DRAW/POINT still call the firmware)
REM Conformance: Phase 4a graphics and colour (PLOT, DRAW, CIRCLE,
REM INK/PAPER/INVERSE/OVER, Mode, POINT).
REM
REM Pixels are read back with POINT (cpc stdlib point.bas, the
REM firmware's GRA_TEST_ABSOLUTE), which returns the pixel's pen.
REM Coordinates are mode pixels, origin bottom-left (notes.md,
REM 2026-10-01). Spectrum colours map to pens per mode (colour.asm):
REM mode 1: black/blue -> 0, red/magenta -> 3, green/cyan -> 2,
REM yellow/white -> 1. Default INK 7 PAPER 0 -> pen 1 on pen 0.

#include <point.bas>
#include <cpc.bas>

REM Results are buffered and printed at the end: printing each one as it
REM happens would scroll the screen, moving the pixels under test.
DIM results$ AS STRING
SUB CHK(name AS STRING, gotv AS STRING, wantv AS STRING)
  IF gotv = wantv THEN
    results$ = results$ + "PASS " + name + CHR$ 13
  ELSE
    results$ = results$ + "FAIL " + name + " got=" + gotv + " want=" + wantv + CHR$ 13
  END IF
END SUB

FUNCTION CountBox(x0 AS INTEGER, y0 AS INTEGER, x1 AS INTEGER, y1 AS INTEGER) AS UINTEGER
  DIM x, y AS INTEGER
  DIM n AS UINTEGER = 0
  FOR y = y0 TO y1
    FOR x = x0 TO x1
      IF POINT(x, y) THEN n = n + 1
    NEXT x
  NEXT y
  RETURN n
END FUNCTION

REM --- PLOT, default colour, exact pixel addressing ---
PLOT 10, 10
CHK("plot_default_pen", STR$(POINT(10, 10)), "1")
CHK("plot_neighbour_x", STR$(POINT(11, 10)), "0")
CHK("plot_neighbour_y", STR$(POINT(10, 11)), "0")
PLOT 319, 199
CHK("plot_top_right", STR$(POINT(319, 199)), "1")
PLOT 0, 0
CHK("plot_origin", STR$(POINT(0, 0)), "1")

REM --- colour mapping and attributes ---
PLOT INK 2; 20, 20
CHK("plot_ink_red_pen3", STR$(POINT(20, 20)), "3")
PLOT INK 4; 21, 20
CHK("plot_ink_green_pen2", STR$(POINT(21, 20)), "2")
PLOT INVERSE 1; 20, 20
CHK("plot_inverse_paper", STR$(POINT(20, 20)), "0")
INK 5
PLOT 22, 20
CHK("perm_ink_cyan_pen2", STR$(POINT(22, 20)), "2")
INK 7

REM --- OVER 1 (XOR) ---
PLOT 30, 30
PLOT OVER 1; 30, 30
CHK("over_plot_erases", STR$(POINT(30, 30)), "0")
PLOT OVER 1; 30, 30
CHK("over_plot_redraws", STR$(POINT(30, 30)), "1")

REM --- DRAW ---
PLOT 0, 50
DRAW 100, 0
CHK("draw_mid", STR$(POINT(50, 50)), "1")
CHK("draw_end", STR$(POINT(100, 50)), "1")
CHK("draw_past_end", STR$(POINT(101, 50)), "0")
DRAW -50, 20
CHK("draw_continues", STR$(POINT(50, 70)), "1")
CHK("draw_diag_mid", STR$(POINT(75, 60)), "1")

REM DRAW OVER 1 leaves the start point lit, like the Spectrum
PLOT OVER 1; 40, 100
DRAW OVER 1; 10, 0
CHK("draw_over_start", STR$(POINT(40, 100)), "1")
CHK("draw_over_end", STR$(POINT(50, 100)), "1")
DRAW OVER 1; -10, 0
CHK("draw_over_back_mid", STR$(POINT(45, 100)), "0")
CHK("draw_over_back_end", STR$(POINT(40, 100)), "0")
CHK("draw_over_back_start", STR$(POINT(50, 100)), "1")

REM --- DRAW with an arc: a semicircle below the chord (radius 50) ---
PLOT 20, 190
DRAW 100, 0, PI
CHK("arc_end_exact", STR$(POINT(120, 190)), "1")
CHK("arc_bottom", STR$(POINT(70, 139) bOR POINT(70, 140) bOR POINT(70, 141)), "1")
REM 10 below the chord the circle is at x = 70 - SQR(50^2 - 10^2) = 21.0
CHK("arc_left_side", STR$(POINT(20, 180) bOR POINT(21, 180) bOR POINT(22, 180)), "1")
CHK("arc_not_above", STR$(POINT(70, 191)), "0")
REM a = 0 is a straight line
PLOT 20, 130
DRAW 30, 0, 0
CHK("arc_zero_angle_mid", STR$(POINT(35, 130)), "1")
CHK("arc_zero_angle_end", STR$(POINT(50, 130)), "1")

REM --- CIRCLE ---
CIRCLE 160, 100, 20
CHK("circle_right", STR$(POINT(180, 100)), "1")
CHK("circle_top", STR$(POINT(160, 120)), "1")
CHK("circle_left", STR$(POINT(140, 100)), "1")
CHK("circle_bottom", STR$(POINT(160, 80)), "1")
CHK("circle_centre", STR$(POINT(160, 100)), "0")

REM XOR circle over the same circle erases every pixel: each one is
REM plotted exactly once.
DIM before AS UINTEGER
before = CountBox(240, 140, 270, 170)
CIRCLE 255, 155, 12
DIM drawn AS UINTEGER
drawn = CountBox(240, 140, 270, 170)
CIRCLE OVER 1; 255, 155, 12
DIM after AS UINTEGER
after = CountBox(240, 140, 270, 170)
CHK("circle_box_empty", STR$(before), "0")
CHK("circle_drawn", STR$(drawn > 60), "1")
CHK("circle_over_erases", STR$(after), "0")

REM --- text colours (read back from a character cell's pixels) ---
REM Row 23 covers pixel rows 15 down to 8; CHR$ 143 is a solid block.
PRINT AT 23, 0; INK 2; CHR$ 143; PAPER 5; " ";
CHK("text_ink_red_pen3", STR$(POINT(3, 12)), "3")
CHK("text_paper_cyan_pen2", STR$(POINT(11, 12)), "2")

REM --- modes ---
Mode 0
CHK("getmode_0", STR$(GetMode()), "0")
PLOT 159, 199
CHK("mode0_plot_white_pen4", STR$(POINT(159, 199)), "4")
PLOT INK 2; 0, 0
CHK("mode0_red_pen3", STR$(POINT(0, 0)), "3")
PLOT INK 4; 1, 0
CHK("mode0_green_pen12", STR$(POINT(1, 0)), "12")
Mode 2
PLOT 639, 0
CHK("mode2_plot", STR$(POINT(639, 0)), "1")
CHK("mode2_neighbour", STR$(POINT(638, 0)), "0")
Mode 1
CHK("mode1_cleared", STR$(POINT(10, 10)), "0")

PRINT results$; "DONE"
END

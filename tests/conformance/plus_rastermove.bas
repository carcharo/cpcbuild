REM MODELS: plus
REM BARE: only
REM Conformance (CPC Plus, bare-metal mode only; Phase 7 tidy-up): RasterIntMove(oldLine,
REM newLine) moves a set raster line to another line, keeping its handler, with the table
REM kept sorted, RI_IDX (the entry that fires next) and PRI right, and 1/0 for done/refused.
REM Part A, interrupts off, the table checked directly against a model: every
REM (next-to-fire entry, moved entry, target line) combination of a five-line table (the
REM line stays in place, moves up, moves down, across the other lines, onto the frame
REM entry's line 243, past it to 250; onto a line already set is refused).
REM Part B, live: handlers log their number, the frame hook publishes each frame's log, so
REM what runs in which order is read back: in place, across, onto the frame line (runs
REM before the frame hook), before the first line, refusals (a set line, an unset line, the
REM frame entry alone, zeros), the same line; PRI = the first line right after a move in the
REM vertical blank; then 150 frames of random moves, one per frame, right after the frame
REM tick (where RasterIntMove is meant to be called), each frame's order checked.

#include <cpc.bas>
#include <framehook.bas>
#include <cpcplus/cpcplus.bas>
#include "lib/chk.bas"
#include "lib/plushelp.bas"

REM The handlers log their number (1-3) into a buffer; the frame hook (which runs at line
REM 243, after every handler of the frame) publishes the buffer as LLEN/LLOG and counts.
FUNCTION FASTCALL LogHAddr(k AS UBYTE) AS UINTEGER
  ASM
  ld hl, LG_TAB
  ld e, a
  ld d, 0
  add hl, de
  add hl, de
  ld a, (hl)
  inc hl
  ld h, (hl)
  ld l, a
  jp LG_SKIP
LG_TAB:
  defw 0, LG_1, LG_2, LG_3
LG_1:
  ld a, 1
  jp LG_PUT
LG_2:
  ld a, 2
  jp LG_PUT
LG_3:
  ld a, 3
LG_PUT:
  ld hl, (LG_PTR)
  ld (hl), a
  inc hl
  ld (LG_PTR), hl
  ret
LG_PTR: defw LG_BUF
LG_BUF: defs 16, 0
LG_LLEN: defb 0
LG_LLOG: defs 16, 0
LG_COUNT: defb 0
LG_SNAP: defs 18, 0
LG_HOOK:
  ld hl, (LG_PTR)
  ld de, LG_BUF
  or a
  sbc hl, de
  ld a, l
  ld (LG_LLEN), a
  ld hl, LG_BUF
  ld de, LG_LLOG
  ld bc, 16
  ldir
  ld hl, LG_BUF
  ld (LG_PTR), hl
  ld hl, LG_COUNT
  inc (hl)
  ret
LG_SKIP:
  END ASM
END FUNCTION

FUNCTION FASTCALL HookAddr() AS UINTEGER
  ASM
  ld hl, LG_HOOK
  END ASM
END FUNCTION

REM The published log of the last frame: its length and bytes, copied at once.
SUB FASTCALL Snap()
  ASM
  di
  ld hl, LG_LLEN
  ld de, LG_SNAP
  ld bc, 17
  ldir
  ei
  END ASM
END SUB

FUNCTION FASTCALL SnapAddr() AS UINTEGER
  ASM
  ld hl, LG_SNAP
  END ASM
END FUNCTION

FUNCTION FASTCALL HookCount() AS UBYTE
  ASM
  ld a, (LG_COUNT)
  END ASM
END FUNCTION

REM The last frame's log as a number: 1 2 3 -> 123 (0 = nothing ran).
FUNCTION LogNum() AS ULONG
  DIM i, n AS UBYTE
  DIM v AS ULONG
  Snap()
  n = PEEK(SnapAddr())
  v = 0
  IF n > 0 THEN
    FOR i = 1 TO n
      v = v * 10 + PEEK(SnapAddr() + i)
    NEXT i
  END IF
  RETURN v
END FUNCTION

REM Waits for the next frame hook (the frame tick).
SUB WaitTick()
  DIM c AS UBYTE
  c = HookCount()
  DO
  LOOP UNTIL HookCount() <> c
END SUB

FUNCTION FASTCALL LineAddr() AS UINTEGER
  ASM
  ld hl, .core.RI_LINE
  END ASM
END FUNCTION
FUNCTION FASTCALL HandAddr() AS UINTEGER
  ASM
  ld hl, .core.RI_HAND
  END ASM
END FUNCTION
FUNCTION FASTCALL RiN() AS UBYTE
  ASM
  ld a, (.core.RI_N)
  END ASM
END FUNCTION
FUNCTION FASTCALL RiIdx() AS UBYTE
  ASM
  ld a, (.core.RI_IDX)
  END ASM
END FUNCTION
SUB SetIdx(v AS UBYTE)
  ASM
  ld a, (ix+5)
  ld (.core.RI_IDX), a
  call .core.__RI_PRIIDX      ; (as it is when the table is live: PRI = the next line)
  END ASM
END SUB
FUNCTION FASTCALL Pri() AS UBYTE
  ASM
  ld hl, $6800
  call .core.PLX1R
  END ASM
END FUNCTION

REM The move, then at once what PRI and RI_IDX are (printing takes longer than a line).
DIM gIdx, gPri AS UBYTE
FUNCTION Mv(o AS UBYTE, n AS UBYTE) AS UBYTE
  DIM r AS UBYTE
  r = RasterIntMove(o, n)
  gIdx = RiIdx()
  gPri = Pri()
  RETURN r
END FUNCTION

REM The raster table's lines as "20,40,60" (all entries).
FUNCTION Tbl() AS STRING
  DIM i AS UBYTE
  DIM s AS STRING
  s = ""
  FOR i = 0 TO RiN() - 1
    IF i > 0 THEN s = s + ","
    s = s + STR$(PEEK(LineAddr() + i))
  NEXT i
  RETURN s
END FUNCTION

REM ---- Part A: the model --------------------------------------------------
REM Entries are identified by their original index 0-5 (line 243 = the frame entry, 5).
DIM oLine(5) AS UBYTE
DIM nLine(5) AS UBYTE        REM model: lines after the move, by new position
DIM nId(5) AS UBYTE          REM model: which original entry is at each position
DIM tgt(8) AS UBYTE
DIM fails AS UINTEGER
DIM runs AS UINTEGER
DIM refusedRuns AS UINTEGER
DIM first$ AS STRING
DIM I, p, t, q, j, k, ni, ok, bad, newI, nn AS UBYTE
DIM nl, i1, i2, rA, rB, rC, rD, rE AS UBYTE
DIM hv AS UINTEGER

oLine(0) = 20: oLine(1) = 40: oLine(2) = 60: oLine(3) = 80: oLine(4) = 100: oLine(5) = 243
tgt(0) = 10: tgt(1) = 20: tgt(2) = 50: tgt(3) = 60: tgt(4) = 90: tgt(5) = 110
tgt(6) = 200: tgt(7) = 243: tgt(8) = 250

PlusUnlock()
CHK("avail", STR$(PlusAvailable()), "1")
FrameHook(HookAddr())

IntOff()
fails = 0: runs = 0: refusedRuns = 0: first$ = ""
FOR p = 0 TO 4
  FOR t = 0 TO 8
    FOR I = 0 TO 5
      RasterIntClear()
      FOR j = 0 TO 4
        RasterIntAt(oLine(j), 4096 + j + 1)
      NEXT j
      REM (line 243 is the frame entry, which is already there)
      nl = tgt(t)
      SetIdx(I)
      ok = RasterIntMove(oLine(p), nl)
      runs = runs + 1
      REM does the target hold a user line already? then refused and nothing changes
      bad = 0
      FOR j = 0 TO 4
        IF j <> p AND oLine(j) = nl THEN bad = 1
      NEXT j
      IF bad = 1 THEN
        refusedRuns = refusedRuns + 1
        IF ok <> 0 THEN
          fails = fails + 1
          IF first$ = "" THEN first$ = "refuse p=" + STR$(p) + " t=" + STR$(nl) + " ok=" + STR$(ok)
        END IF
        FOR j = 0 TO 5
          IF PEEK(LineAddr() + j) <> oLine(j) THEN fails = fails + 1
        NEXT j
        IF RiIdx() <> I THEN fails = fails + 1
      ELSE
        REM the model: the others in order, the moved one before the first line >= new
        q = 0
        FOR j = 0 TO 5
          IF j <> p AND oLine(j) < nl THEN q = q + 1
        NEXT j
        k = 0
        FOR j = 0 TO 5
          IF k = q THEN
            nId(k) = p: nLine(k) = nl: k = k + 1
          END IF
          IF j <> p THEN nId(k) = j: nLine(k) = oLine(j): k = k + 1
        NEXT j
        IF q = 5 THEN nId(5) = p: nLine(5) = nl
        IF ok <> 1 THEN fails = fails + 1: IF first$ = "" THEN first$ = "ok p=" + STR$(p) + " t=" + STR$(nl)
        REM the table: lines and handlers
        FOR j = 0 TO 5
          IF PEEK(LineAddr() + j) <> nLine(j) THEN
            fails = fails + 1
            IF first$ = "" THEN first$ = "line p=" + STR$(p) + " t=" + STR$(nl) + " I=" + STR$(I) + " " + Tbl()
          END IF
          hv = PEEK(HandAddr() + 2 * j) + 256 * PEEK(HandAddr() + 2 * j + 1)
          IF nId(j) = 5 THEN
            IF hv <> 0 THEN fails = fails + 1: IF first$ = "" THEN first$ = "frame entry lost p=" + STR$(p) + " t=" + STR$(nl)
          ELSE
            IF hv <> 4096 + nId(j) + 1 THEN fails = fails + 1: IF first$ = "" THEN first$ = "hand p=" + STR$(p) + " t=" + STR$(nl) + " j=" + STR$(j)
          END IF
        NEXT j
        REM the next entry to fire: the same entry, or after the moved one if it was it
        IF I = p THEN
          IF q = p THEN
            newI = p
          ELSE
            REM the entry that came after it
            ni = p + 1
            IF ni = 6 THEN ni = 255
            newI = 0
            IF ni <> 255 THEN
              FOR j = 0 TO 5
                IF nId(j) = ni THEN newI = j
              NEXT j
            END IF
          END IF
        ELSEIF I = 0 AND q = 0 THEN
          newI = 0             REM nothing has fired yet this frame: the moved entry is first
        ELSE
          FOR j = 0 TO 5
            IF nId(j) = I THEN newI = j
          NEXT j
        END IF
        IF RiIdx() <> newI THEN
          fails = fails + 1
          IF first$ = "" THEN first$ = "idx p=" + STR$(p) + " t=" + STR$(nl) + " I=" + STR$(I) + " got=" + STR$(RiIdx()) + " want=" + STR$(newI)
        END IF
        IF Pri() <> PEEK(LineAddr() + RiIdx()) THEN
          fails = fails + 1
          IF first$ = "" THEN first$ = "pri p=" + STR$(p) + " t=" + STR$(nl) + " I=" + STR$(I)
        END IF
      END IF
    NEXT I
  NEXT t
NEXT p
RasterIntClear()
IntOn()
PRINT "info matrix runs="; runs; " refused="; refusedRuns; " first="; first$
CHK("matrix_runs", STR$(runs), "270")
CHK("matrix_refusals_exercised", STR$(refusedRuns > 20), "1")
CHK("matrix_failures", STR$(fails), "0")
CHK("matrix_interrupts_back", STR$(Iff()), "1")
CHK("matrix_table_cleared", STR$(RiN()), "0")

REM ---- Part B: live ---------------------------------------------------------
RasterIntAt(40, LogHAddr(1))
RasterIntAt(100, LogHAddr(2))
RasterIntAt(160, LogHAddr(3))
CHK("b_table", Tbl(), "40,100,160,243")
WaitTick(): WaitTick(): WaitTick()
CHK("b_order_123", STR$(LogNum()), "123")

WaitTick()
ok = Mv(40, 70)
CHK("b_inplace_ret", STR$(ok), "1")
CHK("b_inplace_table", Tbl(), "70,100,160,243")
CHK("b_inplace_idx", STR$(gIdx), "0")
CHK("b_inplace_pri", STR$(gPri), "70")
WaitTick(): WaitTick(): WaitTick()
CHK("b_inplace_order", STR$(LogNum()), "123")

REM the entry that fires next, moved past another line
WaitTick()
ok = Mv(70, 130)
CHK("b_across_ret", STR$(ok), "1")
CHK("b_across_table", Tbl(), "100,130,160,243")
CHK("b_across_idx", STR$(gIdx), "0")
CHK("b_across_pri", STR$(gPri), "100")
WaitTick(): WaitTick(): WaitTick()
CHK("b_across_order", STR$(LogNum()), "213")

REM onto the frame entry's line: runs before the frame hook
WaitTick()
ok = RasterIntMove(160, 243)
CHK("b_frameline_ret", STR$(ok), "1")
CHK("b_frameline_table", Tbl(), "100,130,243,243")
CHK("b_frameline_n", STR$(RiN()), "4")
WaitTick(): WaitTick(): WaitTick()
CHK("b_frameline_order", STR$(LogNum()), "213")
CHK("b_frameline_hook_after", STR$(PEEK(SnapAddr())), "3")

REM and off it again, to before the first line
WaitTick()
ok = Mv(243, 20)
CHK("b_front_ret", STR$(ok), "1")
CHK("b_front_table", Tbl(), "20,100,130,243")
CHK("b_front_pri", STR$(gPri), "20")
CHK("b_front_idx", STR$(gIdx), "0")
WaitTick(): WaitTick(): WaitTick()
CHK("b_front_order", STR$(LogNum()), "321")

REM refusals leave everything as it was
WaitTick()
i1 = RiIdx()
rA = RasterIntMove(130, 100)
rB = RasterIntMove(77, 80)
rC = RasterIntMove(243, 50)
rD = RasterIntMove(0, 50)
rE = RasterIntMove(100, 0)
i2 = RiIdx()
CHK("r_onto_set_line", STR$(rA), "0")
CHK("r_unset_line", STR$(rB), "0")
CHK("r_frame_entry_alone", STR$(rC), "0")
CHK("r_old_zero", STR$(rD), "0")
CHK("r_new_zero", STR$(rE), "0")
CHK("r_table_same", Tbl(), "20,100,130,243")
CHK("r_idx_same", STR$(i1 = i2), "1")
CHK("same_line_ok", STR$(RasterIntMove(100, 100)), "1")
CHK("same_line_table", Tbl(), "20,100,130,243")
WaitTick(): WaitTick(): WaitTick()
CHK("r_order_same", STR$(LogNum()), "321")

REM ---- random moves, one per frame in the vertical blank, 150 frames
DIM lineOf(3) AS UBYTE
DIM cand(6) AS UBYTE
DIM seed AS UBYTE
DIM bads, moves AS UINTEGER
DIM a1, a2, a3 AS UBYTE
DIM wantOrd, gotOrd AS ULONG
DIM tryn, prevLine AS UBYTE
RasterIntClear()
lineOf(1) = 40: lineOf(2) = 100: lineOf(3) = 160
RasterIntAt(40, LogHAddr(1))
RasterIntAt(100, LogHAddr(2))
RasterIntAt(160, LogHAddr(3))
cand(0) = 30: cand(1) = 60: cand(2) = 90: cand(3) = 120: cand(4) = 150: cand(5) = 180: cand(6) = 210
seed = 77
bads = 0: moves = 0
wantOrd = 123
WaitTick(): WaitTick()
FOR k = 1 TO 150
  REM choose the move first (a free line: a few tries), so that the move itself follows
  REM the tick at once: it must not be late enough for a line of the frame to have passed
  seed = seed * 5 + 3
  a1 = 1 + (seed >> 4) MOD 3
  seed = seed * 5 + 3
  tryn = 0
  DO
    a2 = cand((seed >> 3) MOD 7)
    seed = seed * 5 + 3
    tryn = tryn + 1
    nn = 0
    IF lineOf(1) = a2 OR lineOf(2) = a2 OR lineOf(3) = a2 THEN nn = 1
  LOOP UNTIL nn = 0 OR tryn > 20
  prevLine = lineOf(a1)
  WaitTick()
  IF nn = 0 THEN ok = RasterIntMove(prevLine, a2)
  REM the frame that just ended ran in the order wantOrd
  gotOrd = LogNum()
  IF gotOrd <> wantOrd THEN
    bads = bads + 1
    IF bads < 6 THEN PRINT "info bad k="; k; " got="; gotOrd; " want="; wantOrd; " lines="; lineOf(1); ","; lineOf(2); ","; lineOf(3)
  END IF
  IF nn = 0 THEN
    IF ok <> 1 THEN bads = bads + 1
    lineOf(a1) = a2
    moves = moves + 1
    REM the order for the next frame: ascending line
    IF lineOf(1) < lineOf(2) THEN
      IF lineOf(2) < lineOf(3) THEN
        wantOrd = 123
      ELSEIF lineOf(1) < lineOf(3) THEN
        wantOrd = 132
      ELSE
        wantOrd = 312
      END IF
    ELSE
      IF lineOf(1) < lineOf(3) THEN
        wantOrd = 213
      ELSEIF lineOf(2) < lineOf(3) THEN
        wantOrd = 231
      ELSE
        wantOrd = 321
      END IF
    END IF
  END IF
NEXT k
PRINT "info random moves="; moves; " bad="; bads
CHK("random_moves_done", STR$(moves > 100), "1")
CHK("random_order_ok", STR$(bads), "0")
CHK("random_table_n", STR$(RiN()), "4")

RasterIntClear()
CHK("clear_pri", STR$(PlusPeek($6800)), "0")
FrameHookOff()
PRINT "DONE"
END

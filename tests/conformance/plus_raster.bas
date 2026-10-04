REM MODELS: plus
REM BARE: only
REM Conformance (CPC Plus, bare-metal mode only, Caprice32; Phase 7 P3): cpcplus's raster
REM interrupts. RasterIntAt/Off/Clear keep a sorted table the bare interrupt handler
REM walks, programming the ASIC's PRI with the next line each time and doing the frame work
REM (Frames(), the frame hook) at one more entry, because a non-zero PRI stops the CPC's
REM six interrupts per frame. Checks: each handler runs once a frame, in line order,
REM before the frame hook; the frame rate stays 50 Hz (against the VSYNC edges seen by
REM polling the PPI); a handler at the frame hook's own line runs before it; replacing,
REM removing, clearing, the table limit, PlusLock and the exit routine put the machine back
REM to the ordinary interrupts (PRI 0, vector restored); handlers may clobber every register.

#include <cpc.bas>
#include <framehook.bas>
#include <cpcplus/cpcplus.bas>
#include "lib/chk.bas"
#include "lib/plushelp.bas"

REM Handlers (asm, entered with interrupts off, everything saved around them).
REM RT_LAST = the line of the last handler that ran this frame: each handler checks it is
REM higher than its own (lines run in order) and stores its line; the frame hook checks it
REM ran last and clears it. RT_BAD counts violations.
FUNCTION FASTCALL H1Addr() AS UINTEGER
  ASM
  ld hl, RT_H1
  jp RT_SKIP1
RT_H1:                      ; line 40
  ld a, (RT_LAST)
  cp 40
  jr c, RT_H1_OK
  ld hl, RT_BAD
  inc (hl)
RT_H1_OK:
  ld a, 40
  ld (RT_LAST), a
  ld hl, RT_C1
  inc (hl)
  ret
RT_H1B:                     ; line 40, replacement handler
  ld hl, RT_C1B
  inc (hl)
  ld a, 40
  ld (RT_LAST), a
  ret
RT_SKIP1:
  END ASM
END FUNCTION

FUNCTION FASTCALL H1bAddr() AS UINTEGER
  ASM
  ld hl, RT_H1B
  END ASM
END FUNCTION

FUNCTION FASTCALL H2Addr() AS UINTEGER
  ASM
  ld hl, RT_H2
  jp RT_SKIP2
RT_H2:                      ; line 120, also used for line 100
  ld a, (RT_LAST)
  cp 120
  jr c, RT_H2_OK
  ld hl, RT_BAD
  inc (hl)
RT_H2_OK:
  ld a, 120
  ld (RT_LAST), a
  ld hl, RT_C2
  inc (hl)
  ret
RT_SKIP2:
  END ASM
END FUNCTION

FUNCTION FASTCALL H3Addr() AS UINTEGER
  ASM
  ld hl, RT_H3
  jp RT_SKIP3
RT_H3:                      ; line 200
  ld a, (RT_LAST)
  cp 200
  jr c, RT_H3_OK
  ld hl, RT_BAD
  inc (hl)
RT_H3_OK:
  ld a, 200
  ld (RT_LAST), a
  ld hl, RT_C3
  inc (hl)
  ret
RT_HF:                      ; line 243, the frame hook's own line: runs before it
  ld a, (RT_LAST)
  cp 200
  jr z, RT_HF_OK
  ld hl, RT_BAD
  inc (hl)
RT_HF_OK:
  ld a, 1
  ld (RT_HFRAME), a
  ld hl, RT_CF
  inc (hl)
  ret
RT_SKIP3:
  END ASM
END FUNCTION

FUNCTION FASTCALL EvilAddr() AS UINTEGER
  ASM
  ld hl, RT_EVIL
  jp RT_SKIPE
RT_EVIL:                    ; line 160: clobbers every register
  ld bc, $FFFF
  ld de, $EEEE
  ld hl, $DDDD
  ld ix, $CCCC
  ld iy, $BBBB
  exx
  ld bc, $AAAA
  ld de, $9999
  ld hl, $8888
  exx
  ex af, af'
  ld a, $77
  ex af, af'
  ld a, $66
  or a
  ret
RT_SKIPE:
  END ASM
END FUNCTION

FUNCTION FASTCALL HfAddr() AS UINTEGER
  ASM
  ld hl, RT_HF
  END ASM
END FUNCTION

REM The frame hook: counts, clears RT_LAST, and when RT_WANTHF = 1 checks the handler on
REM its own line ran before it.
FUNCTION FASTCALL HookAddr() AS UINTEGER
  ASM
  ld hl, RT_HOOK
  jp RT_SKIPH
RT_HOOK:
  ld hl, RT_CH
  inc (hl)
  xor a
  ld (RT_LAST), a
  ld a, (RT_WANTHF)
  or a
  jr z, RT_HOOK_END
  ld a, (RT_HFRAME)
  or a
  jr nz, RT_HOOK_OK
  ld hl, RT_BAD
  inc (hl)
RT_HOOK_OK:
  xor a
  ld (RT_HFRAME), a
RT_HOOK_END:
  ret
RT_C1:  defb 0
RT_C1B: defb 0
RT_C2:  defb 0
RT_C3:  defb 0
RT_CF:  defb 0
RT_CH:  defb 0
RT_BAD: defb 0
RT_LAST: defb 0
RT_HFRAME: defb 0
RT_WANTHF: defb 0
RT_SKIPH:
  END ASM
END FUNCTION

FUNCTION FASTCALL CntBase() AS UINTEGER
  ASM
  ld hl, RT_S1
  END ASM
END FUNCTION
FUNCTION C1() AS UBYTE
  RETURN PEEK(CntBase())
END FUNCTION
FUNCTION C1b() AS UBYTE
  RETURN PEEK(CntBase() + 1)
END FUNCTION
FUNCTION C2() AS UBYTE
  RETURN PEEK(CntBase() + 2)
END FUNCTION
FUNCTION C3() AS UBYTE
  RETURN PEEK(CntBase() + 3)
END FUNCTION
FUNCTION Cf() AS UBYTE
  RETURN PEEK(CntBase() + 4)
END FUNCTION
FUNCTION Ch() AS UBYTE
  RETURN PEEK(CntBase() + 5)
END FUNCTION
FUNCTION Bad() AS UBYTE
  RETURN PEEK(CntBase() + 6)
END FUNCTION

REM Snap(): copies the seven counters at once (the checks are slow: PRINT takes frames).
SUB FASTCALL Snap()
  ASM
  di
  ld hl, RT_C1
  ld de, RT_S1
  ld bc, 7
  ldir
  ei
  jp RT_SNAP_END
RT_S1: defs 7, 0
RT_SNAP_END:
  END ASM
END SUB

SUB FASTCALL ResetCounts()
  ASM
  xor a
  ld (RT_C1), a
  ld (RT_C1B), a
  ld (RT_C2), a
  ld (RT_C3), a
  ld (RT_CF), a
  ld (RT_CH), a
  ld (RT_BAD), a
  ld (RT_S1), a
  ld (RT_S1 + 1), a
  ld (RT_S1 + 2), a
  ld (RT_S1 + 3), a
  ld (RT_S1 + 4), a
  ld (RT_S1 + 5), a
  ld (RT_S1 + 6), a
  END ASM
END SUB

SUB WantHf(v AS UBYTE)
  ASM
  ld a, (ix+5)
  ld (RT_WANTHF), a
  END ASM
END SUB

REM Table entries, the vector at &0038, the exit hook, the PRI register.
FUNCTION FASTCALL RiN() AS UBYTE
  ASM
  ld a, (.core.RI_N)
  END ASM
END FUNCTION

FUNCTION FASTCALL VecOk() AS UBYTE
  ASM
  ld hl, ($0039)
  ld de, .core.__CPC_ISR
  or a
  sbc hl, de
  ld a, 0
  jr nz, RT_VEC_END
  inc a
RT_VEC_END:
  END ASM
END FUNCTION

FUNCTION FASTCALL VecRaster() AS UBYTE
  ASM
  ld hl, ($0039)
  ld de, .core.__RI_ISR
  or a
  sbc hl, de
  ld a, 0
  jr nz, RT_VECR_END
  inc a
RT_VECR_END:
  END ASM
END FUNCTION

FUNCTION FASTCALL ExitSet() AS UBYTE
  ASM
  ld hl, (.core.CPC_EXIT_VEC)
  ld a, h
  or l
  jr z, RT_EXS_END
  ld a, 1
RT_EXS_END:
  END ASM
END FUNCTION

SUB FASTCALL RunExit()
  ASM
  di
  ld hl, (.core.CPC_EXIT_VEC)
  ld de, RT_EXIT_BACK
  push de
  jp (hl)
RT_EXIT_BACK:
  ei
  END ASM
END SUB

REM RunFrames(n): polls the VSYNC bit of PPI port B until the frame counter has advanced by
REM n; returns the number of VSYNC rising edges it saw (the frames the hardware made).
FUNCTION RunFrames(n AS UINTEGER) AS UINTEGER
  ASM
  ld e, (ix+4)
  ld d, (ix+5)              ; DE = n
  ld hl, (.core.FH_FRAMES)
  push hl                   ; the start
  ld bc, $F500
  in a, (c)
  and 1
  ld (RT_PREV), a
  ld hl, 0
  ld (RT_EDGES), hl
RT_RF_LOOP:
  ld bc, $F500
  in a, (c)
  and 1
  ld b, a
  ld a, (RT_PREV)
  ld c, a
  ld a, b
  ld (RT_PREV), a
  or a
  jr z, RT_RF_NOEDGE
  ld a, c
  or a
  jr nz, RT_RF_NOEDGE
  ld hl, (RT_EDGES)
  inc hl
  ld (RT_EDGES), hl
RT_RF_NOEDGE:
  ld hl, (.core.FH_FRAMES)
  pop bc
  push bc
  or a
  sbc hl, bc
  or a
  sbc hl, de
  jr c, RT_RF_LOOP
  pop bc
  di
  ld hl, RT_C1
  ld de, RT_S1
  ld bc, 7
  ldir
  ei
  ld hl, (RT_EDGES)
  jp RT_RF_END
RT_PREV: defb 0
RT_EDGES: defw 0
RT_RF_END:
  END ASM
END FUNCTION

REM RegTest(): sets BC, DE, HL, IX, IY and the alternate set to known values and spins about
REM 8 frames comparing them; returns the number of mismatches (the handlers clobber them).
FUNCTION RegTest() AS UINTEGER
  ASM
  push ix
  push iy
  ld hl, 0
  ld (RT_MISS), hl
  ld hl, 5000
  ld (RT_CNT), hl
  call RT_RG_LOAD
RT_RG_LOOP:
  ld a, b
  cp $12
  jp nz, RT_RG_BAD
  ld a, c
  cp $34
  jp nz, RT_RG_BAD
  ld a, d
  cp $89
  jp nz, RT_RG_BAD
  ld a, e
  cp $AB
  jp nz, RT_RG_BAD
  ld a, h
  cp $78
  jp nz, RT_RG_BAD
  ld a, l
  cp $9A
  jp nz, RT_RG_BAD
  exx
  ld a, b
  cp $23
  jr nz, RT_RG_BADX
  ld a, c
  cp $45
  jr nz, RT_RG_BADX
  ld a, d
  cp $34
  jr nz, RT_RG_BADX
  ld a, e
  cp $56
  jr nz, RT_RG_BADX
  ld a, h
  cp $45
  jr nz, RT_RG_BADX
  ld a, l
  cp $67
  jr nz, RT_RG_BADX
  exx
  push ix
  pop hl
  ld de, $5678
  or a
  sbc hl, de
  jp nz, RT_RG_BAD
  push iy
  pop hl
  ld de, $6789
  or a
  sbc hl, de
  jp nz, RT_RG_BAD
  ld de, $89AB
  ld hl, (RT_CNT)
  dec hl
  ld (RT_CNT), hl
  ld a, h
  or l
  ld hl, $789A
  jp nz, RT_RG_LOOP
  pop iy
  pop ix
  ld hl, (RT_MISS)
  jp RT_RG_END
RT_RG_BADX:
  exx
RT_RG_BAD:
  ld hl, (RT_MISS)
  inc hl
  ld (RT_MISS), hl
  call RT_RG_LOAD
  ld hl, (RT_CNT)
  dec hl
  ld (RT_CNT), hl
  ld a, h
  or l
  ld hl, $789A
  jp nz, RT_RG_LOOP
  pop iy
  pop ix
  ld hl, (RT_MISS)
  jp RT_RG_END
RT_RG_LOAD:
  exx
  ld bc, $2345
  ld de, $3456
  ld hl, $4567
  exx
  ld ix, $5678
  ld iy, $6789
  ld bc, $1234
  ld de, $89AB
  ld hl, $789A
  ret
RT_MISS: defw 0
RT_CNT: defw 0
RT_RG_END:
  END ASM
END FUNCTION

REM Near(v, n): v is n, one more or one less.
FUNCTION Near(v AS UINTEGER, n AS UINTEGER) AS UBYTE
  IF v + 1 >= n AND v <= n + 1 THEN RETURN 1
  RETURN 0
END FUNCTION

DIM e AS UINTEGER
DIM k AS UBYTE

CHK("avail", STR$(PlusAvailable()), "1")
CHK("start_vector_ordinary", STR$(VecOk()), "1")
CHK("start_table_empty", STR$(RiN()), "0")
FrameHook(HookAddr())

REM ---- baseline: the frame counter against the hardware's VSYNC edges, no raster
e = RunFrames(50)
CHK("baseline_edges", STR$(Near(e, 50)), "1")

REM ---- three lines added out of order; the frame entry makes four
RasterIntAt(200, H3Addr())
RasterIntAt(40, H1Addr())
RasterIntAt(120, H2Addr())
CHK("table_four", STR$(RiN()), "4")
CHK("vector_raster", STR$(VecRaster()), "1")
CHK("exit_hook_set", STR$(ExitSet()), "1")
CHK("pri_nonzero", STR$(PlusPeek($6800) <> 0), "1")
CHK("iff_on", STR$(Iff()), "1")
e = RunFrames(10)
ResetCounts()
e = RunFrames(100)
CHK("raster_edges", STR$(Near(e, 100)), "1")
CHK("h1_once_a_frame", STR$(Near(C1(), 100)), "1")
CHK("h2_once_a_frame", STR$(Near(C2(), 100)), "1")
CHK("h3_once_a_frame", STR$(Near(C3(), 100)), "1")
CHK("hook_once_a_frame", STR$(Near(Ch(), 100)), "1")
CHK("order_ok", STR$(Bad()), "0")
CHK("frames_counted", STR$(Frames() > 150), "1")

REM ---- all registers survive the handlers
ResetCounts()
RasterIntAt(160, EvilAddr())
CHK("registers_saved", STR$(RegTest()), "0")
RasterIntOff(160)
CHK("table_four_evil_gone", STR$(RiN()), "4")
Snap()
CHK("regtest_ran_frames", STR$(C2() >= 6), "1")

REM ---- remove a line
RasterIntOff(120)
CHK("table_three", STR$(RiN()), "3")
e = RunFrames(10)
ResetCounts()
e = RunFrames(50)
CHK("off_h2_silent", STR$(C2()), "0")
CHK("off_others_run", STR$(Near(C1(), 50) AND Near(C3(), 50)), "1")
CHK("off_edges", STR$(Near(e, 50)), "1")
CHK("off_order_ok", STR$(Bad()), "0")
RasterIntOff(77)
CHK("off_unknown_line_ignored", STR$(RiN()), "3")
RasterIntOff(243)
CHK("off_frame_entry_refused", STR$(RiN()), "3")

REM ---- replace the handler of a line
RasterIntAt(40, H1bAddr())
CHK("replace_keeps_table", STR$(RiN()), "3")
ResetCounts()
e = RunFrames(40)
CHK("replaced_h1_silent", STR$(C1()), "0")
CHK("replaced_h1b_runs", STR$(Near(C1b(), 40)), "1")

REM ---- a handler on the frame hook's own line runs before it
RasterIntAt(243, HfAddr())
CHK("table_four_again", STR$(RiN()), "4")
WantHf(1)
e = RunFrames(5)
ResetCounts()
e = RunFrames(40)
CHK("handler_on_frame_line", STR$(Near(Cf(), 40)), "1")
CHK("frame_line_order_ok", STR$(Bad()), "0")
CHK("frame_line_hook_runs", STR$(Near(Ch(), 40)), "1")
WantHf(0)
RasterIntOff(243)
CHK("frame_line_off", STR$(RiN()), "3")

REM ---- clear: the ordinary interrupts are back
RasterIntClear()
CHK("clear_table", STR$(RiN()), "0")
CHK("clear_vector", STR$(VecOk()), "1")
CHK("clear_pri", STR$(PlusPeek($6800)), "0")
CHK("clear_exit_hook", STR$(ExitSet()), "0")
CHK("clear_iff", STR$(Iff()), "1")
e = RunFrames(5)
ResetCounts()
e = RunFrames(50)
CHK("cleared_edges", STR$(Near(e, 50)), "1")
CHK("cleared_handlers_silent", STR$(C1() + C1b() + C2() + C3()), "0")
CHK("cleared_hook_runs", STR$(Near(Ch(), 50)), "1")
RasterIntClear()

REM ---- on again, off by removing the last line
RasterIntAt(100, H2Addr())
CHK("again_table", STR$(RiN()), "2")
e = RunFrames(5)
ResetCounts()
e = RunFrames(30)
CHK("again_runs", STR$(Near(C2(), 30) AND Near(Ch(), 30)), "1")
CHK("again_order_ok", STR$(Bad()), "0")
RasterIntOff(100)
CHK("last_off_table", STR$(RiN()), "0")
CHK("last_off_vector", STR$(VecOk()), "1")
CHK("last_off_pri", STR$(PlusPeek($6800)), "0")
ResetCounts()
e = RunFrames(30)
CHK("last_off_edges", STR$(Near(e, 30)), "1")

REM ---- limits: a bad line or a zero handler is ignored; 15 user lines at most
RasterIntAt(0, H1Addr())
RasterIntAt(50, 0)
CHK("bad_args_ignored", STR$(RiN()), "0")
FOR k = 1 TO 20
  RasterIntAt(k * 10, H1Addr())
NEXT k
CHK("table_full", STR$(RiN()), "16")
e = RunFrames(20)
CHK("full_frames_ok", STR$(Near(e, 20)), "1")
RasterIntClear()
CHK("full_cleared", STR$(RiN()), "0")

REM ---- PlusLock ends raster mode (the handler writes PRI through the ASIC page)
RasterIntAt(50, H1Addr())
PlusLock()
CHK("lock_clears_table", STR$(RiN()), "0")
CHK("lock_vector", STR$(VecOk()), "1")
ResetCounts()
e = RunFrames(30)
CHK("lock_edges", STR$(Near(e, 30)), "1")
PlusUnlock()
CHK("lock_pri_zero", STR$(PlusPeek($6800)), "0")

REM ---- the exit routine END's reset calls puts PRI back to 0
RasterIntAt(60, H1Addr())
RasterIntAt(180, H3Addr())
CHK("exit_pri_set", STR$(PlusPeek($6800) <> 0), "1")
RunExit()
CHK("exit_pri_zero", STR$(PlusPeek($6800)), "0")
CHK("exit_vector", STR$(VecOk()), "1")
CHK("exit_table", STR$(RiN()), "0")
CHK("exit_iff", STR$(Iff()), "1")

FrameHookOff()
PRINT "DONE"
END

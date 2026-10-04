REM Screen test (CPC Plus, bare-metal mode only, Phase 7 P3): raster bars. Twelve raster
REM interrupts (RasterIntAt, one every 16 lines from line 8), all on one handler that sets
REM the 12-bit colour of pen 0 and of the border from a table: the screen (mode 1, filled
REM with pen 0) shows twelve horizontal bands of a smooth colour ramp, the border the
REM same; the frame hook restores the first colour for the next frame. The handler's
REM two palette writes take about two scan lines, so each band starts a little after
REM its line; the picture is the same every frame.
REM ZXBC: -D CPC_BAREMETAL
#include <cpc.bas>
#include <framehook.bas>
#include <cpcbuild/display.bas>
#include <cpcbuild/fill.bas>
#include <cpcplus/cpcplus.bas>
#include "lib/shot.bas"

REM The bar handler: RB_IDX counts up through RB_TAB (12 colours, 2 bytes each, &0RGB)
REM and sets pen 0 and the border. The hook starts the ramp again (colour 0 on both).
FUNCTION FASTCALL BarAddr() AS UINTEGER
  ASM
  ld hl, RB_BAR
  jp RB_SKIP
RB_BAR:
  ld a, (RB_IDX)
  add a, a
  ld e, a
  ld d, 0
  ld hl, RB_TAB
  add hl, de
  ld e, (hl)
  inc hl
  ld d, (hl)              ; DE = colour
  ld a, (RB_IDX)
  inc a
  ld (RB_IDX), a
  push de
  ex de, hl
  ld a, 0
  call .core.__PL_SETCOL  ; pen 0
  pop hl
  ld a, 16
  jp .core.__PL_SETCOL    ; border
RB_HOOK:
  xor a
  ld (RB_IDX), a
  ld hl, (RB_TAB)
  push hl
  ld a, 0
  call .core.__PL_SETCOL
  pop hl
  ld a, 16
  jp .core.__PL_SETCOL
RB_IDX:
  defb 0
RB_TAB:
  defw $0F00, $0F40, $0F80, $0FC0, $0EF0, $08F0, $04F2, $00F8, $00FC, $00CF, $008F, $004F
RB_SKIP:
  END ASM
END FUNCTION

FUNCTION FASTCALL HookAddr() AS UINTEGER
  ASM
  ld hl, RB_HOOK
  END ASM
END FUNCTION

DIM k AS UBYTE
Mode 1
ScreenInit()
CLS
FillRect(0, 0, 80, 200, 0)
SetPalette12(1, $0FFF)
PRINT AT 11, 6; "CPC PLUS RASTER BARS";
IF PlusAvailable() = 0 THEN
  PRINT AT 1, 1; "NO PLUS"
END IF
FrameHook(HookAddr())
FOR k = 0 TO 11
  RasterIntAt(8 + k * 16, BarAddr())
NEXT k
WaitRetrace(60)
Shot("plus_rasterbars")

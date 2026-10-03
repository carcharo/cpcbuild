REM BARE: only
REM STATE: mode=1 lrom=off urom=off ramcfg=0 border=21 ink=11,20,0,12,11,20,21,13,6,30,31,7,18,25,4,7 crtc=63,40,46,142,38,0,25,30,0,7,0,0,16,0
REM Conformance (bare-metal mode, Phase 6 B4): the cpcbuild library's
REM firmware-free paths -- double buffering through the CRTC start address
REM (R12/R13), WaitRetrace from the frame counter, the palette straight to
REM the Gate Array -- and the compile-time refusal of BankLoad is documented
REM in banks.bas (not testable here).
REM
REM No PRINT (lib/bareout.bas). The runner checks chipsrun's state dump
REM taken after the first FlipBuffer: the CRTC start address is &4000
REM (R12 = &10, R13 = 0), pens 0-3 and the border carry the colours set
REM below (hardware colour numbers), the rest are the boot's. The program
REM checks the screen bytes, the text base (SCREEN_ADDR) and the frame
REM counts itself.

#pragma heap_size = 1200
#include <cpc.bas>
#include <framehook.bas>
#include <cpcbuild/display.bas>
#include <cpcbuild/palette.bas>
#include "lib/bareout.bas"

FUNCTION FASTCALL TextBase() AS UBYTE
  ASM
  ld a, (.core.SCREEN_ADDR + 1)
  END ASM
END FUNCTION

DIM pal(3) AS UBYTE = {26, 0, 13, 6}
DIM f0 AS ULONG
DIM f1 AS ULONG
DIM c AS UBYTE

REM --- WaitRetrace: n frames from the frame counter
ScreenInit()
f0 = Frames()
WaitRetrace(3)
f1 = Frames()
BRng("waitretrace_3", CAST(LONG, f1 - f0), 2, 3)
f0 = Frames()
WaitRetrace(0)
f1 = Frames()
BRng("waitretrace_0_is_1", CAST(LONG, f1 - f0), 0, 1)

REM --- palette: Gate Array only (no firmware inks to keep in step)
PalUpload(@pal(0), 4, 0)
SetBorder(2)

REM --- double buffering
BCHK("text_base_before", TextBase(), $C0)
EnableDoubleBuffer()
BCHK("copy_to_back", PEEK($6805), 0)
PokeScreen(5, 5, $AA)
BCHK("poke_goes_to_back", PEEK($6805), $AA)
BCHK("front_untouched", PEEK($E805), 0)
BCHK("peek_reads_back", PeekScreen(5, 5), $AA)
FlipBuffer()
BCHK("flip_text_base", TextBase(), $40)
BCHK("flip_draws_on_old_front", PeekScreen(5, 5), 0)
PokeScreen(6, 5, $55)
BCHK("flip_poke_old_front", PEEK($E806), $55)
BState()
FlipBuffer()
BCHK("flip_back_text_base", TextBase(), $C0)
BCHK("flip_back_peek", PeekScreen(5, 5), $AA)
BCHK("front_is_blank", PEEK($E805), 0)
FlipBuffer()
DisableDoubleBuffer()
BCHK("disable_text_base", TextBase(), $C0)
BCHK("disable_copies_shown_screen", PEEK($E805), $AA)
f0 = Frames()
FlipBuffer()
f1 = Frames()
BRng("flip_without_dbuf_waits", CAST(LONG, f1 - f0), 0, 1)
BDone()

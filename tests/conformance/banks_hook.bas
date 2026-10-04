REM MODELS: 6128 plus
REM Conformance: bank paging and the interrupt side (6128 only). A frame
REM hook pages extra bank 3 in and out (the bank the main program selected
REM must survive it, in normal and game mode and through firmware waits),
REM and the back screen (&4000) still draws correctly after bank use.

#include <cpc.bas>
#include <framehook.bas>
#include <cpcbuild/display.bas>
#include <cpcbuild/banks.bas>
#include "lib/chk.bas"

REM Waits for the next frame the hook runs.
SUB NextFrame()
  DIM f AS ULONG
  f = Frames()
  DO
  LOOP UNTIL Frames() <> f
END SUB

REM A frame hook that pages extra bank 3 in, counts in its last 16 KB page
REM (&7F00) and puts the library's shadow configuration back -- what the
REM music hook does, but visible.
FUNCTION FASTCALL BankHookAddr() AS UINTEGER
  ASM
  ld hl, BH_HOOK
  jp BH_SKIP
BH_HOOK:
  ld b, $7F
  ld c, $C7
  out (c), c
  ld hl, $7F00
  inc (hl)
  ld a, (.core.CBK_CFG)
  ld c, a
  out (c), c
  ret
BH_SKIP:
  END ASM
END FUNCTION

DIM i, j, n AS UINTEGER
DIM b AS UBYTE
DIM ok AS UBYTE
DIM m0, pk AS UBYTE
POKE 16384, 109
m0 = PEEK(16384)
BankPoke(3, 16384, 13)
BankPoke(1, 16384, 11)
BankPoke(2, 16384, 12)

REM The hook counts in bank 3 at &7F00; the main program has bank 1 in.
FUNCTION Wait(frames AS UINTEGER) AS UBYTE
  DIM k AS UINTEGER
  FOR k = 1 TO frames
    NextFrame()
  NEXT k
  RETURN 1
END FUNCTION

BankPoke(3, 32512, 0)
BankSelect(1)
FrameHook(BankHookAddr())
ok = Wait(6)
FrameHookOff()
REM read &4000 before any Bank routine, which would itself put the shadow back
pk = PEEK(16384)
CHK("hook_restored_shadow", STR$(BankSelected()) + " " + STR$(pk), "1 11")
CHK("hook_ran_in_bank", STR$(BankPeek(3, 32512) >= 5 AND BankPeek(3, 32512) <= 8), "1")
BankOff()
BankPoke(3, 32512, 0)
FrameHook(BankHookAddr())
ok = Wait(4)
FrameHookOff()
pk = PEEK(16384)
CHK("hook_with_main_ram", STR$(BankSelected()) + " " + STR$(pk = m0) + " " + STR$(BankPeek(3, 32512) >= 3), "255 1 1")
REM game mode too, and through a firmware wait
GameMode(1)
BankSelect(2)
BankPoke(3, 32512, 0)
FrameHook(BankHookAddr())
ok = Wait(4)
WaitRetrace(2)
FrameHookOff()
pk = PEEK(16384)
GameMode(0)
CHK("hook_game_mode", STR$(BankSelected()) + " " + STR$(pk) + " " + STR$(BankPeek(3, 32512) >= 5), "2 12 1")
BankOff()

REM ---------------- drawing into the back screen after bank use ----------------
REM (11,10) and (12,10) of the back screen are at &405B/&405C.
EnableDoubleBuffer()
BankPoke(0, 20571, 0x11)
BankPoke(0, 20572, 0x22)
n = PeekScreen(11, 10)
BankSelect(0)
PokeScreen(11, 10, 0xA5)
BankOff()
CHK("draw_while_selected_lands_in_bank", STR$(BankPeek(0, 20571)) + " " + STR$(PeekScreen(11, 10) = n), "165 1")
BankSelect(1)
BankOff()
PokeScreen(12, 10, 0x5A)
CHK("draw_after_bank_use", STR$(PeekScreen(12, 10)) + " " + STR$(BankPeek(0, 20572)), "90 34")
BankPoke(2, 16384, 3)
PokeScreen(13, 10, 0x3C)
CHK("draw_after_bank_poke", STR$(PeekScreen(13, 10)) + " " + STR$(BankPeek(2, 16384)), "60 3")
FlipBuffer()
DisableDoubleBuffer()

PRINT "DONE"

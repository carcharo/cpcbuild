REM Bank library timings (6128; run: python3 tools/cpcrun.py --emu chips
REM --model 6128 --timeout 300 bench/boriel/banks_bench.bas).
REM
REM Each operation runs N times in game mode (only the 300 Hz game-mode
REM interrupt, about 3 % of the CPU, is in the way) and is timed in frames
REM (Frames(), 79872 T-states each: 312 lines of 64 us, 4 T-states per us).
REM The result is T-states per call after subtracting the empty loop. The
REM "page" line is the music hook's paging sequence alone (bank in, bank
REM out, as in __MUSIC_PLAY_BANKED without the player and the CALL/RET).

#include <cpc.bas>
#include <framehook.bas>
#include <cpcbuild/banks.bas>

DIM buf(511) AS UBYTE
DIM i, n AS UINTEGER
DIM f0, f1, base AS ULONG
DIM r AS UBYTE

SUB NextFrame()
  DIM f AS ULONG
  f = Frames()
  DO
  LOOP UNTIL Frames() <> f
END SUB

SUB Report(name AS STRING, frames AS ULONG, count AS ULONG, perunit AS UINTEGER)
  REM T-states = frames * 79872 / count, printed in tenths via integer maths
  DIM t AS ULONG
  t = (frames * 79872) / count
  PRINT "INFO "; name; ": frames="; frames; " N="; count; " T/call(raw)="; t; " per unit ("; perunit; ")= "; t / perunit
END SUB

GameMode(1)
BankPoke(1, 16640, 1)

REM baseline: the empty loop
NextFrame(): f0 = Frames()
FOR n = 1 TO 20000
NEXT n
f1 = Frames()
base = f1 - f0
Report("empty_loop", base, 20000, 1)

NextFrame(): f0 = Frames()
FOR n = 1 TO 20000
  BankPoke(1, 16640, 7)
NEXT n
f1 = Frames()
Report("BankPoke_incl_loop", f1 - f0, 20000, 1)

NextFrame(): f0 = Frames()
FOR n = 1 TO 20000
  r = BankPeek(1, 16640)
NEXT n
f1 = Frames()
Report("BankPeek_incl_loop", f1 - f0, 20000, 1)

NextFrame(): f0 = Frames()
FOR n = 1 TO 20000
  BankSelect(1)
  BankOff()
NEXT n
f1 = Frames()
Report("BankSelect+Off_pair_incl_loop", f1 - f0, 20000, 1)

NextFrame(): f0 = Frames()
FOR n = 1 TO 20000
  ASM
  di
  ld b, $7F
  ld a, $C5
  ld c, a
  out (c), c
  ld a, ($BE00)
  ld c, a
  out (c), c
  ei
  END ASM
NEXT n
f1 = Frames()
Report("page_in_out_sequence_incl_loop", f1 - f0, 20000, 1)

REM copies: 512 bytes (two 256-byte chunks) 
NextFrame(): f0 = Frames()
FOR n = 1 TO 400
  r = BankCopyIn(1, 16640, @buf(0), 512)
NEXT n
f1 = Frames()
Report("BankCopyIn_512", f1 - f0, 400, 512)

NextFrame(): f0 = Frames()
FOR n = 1 TO 400
  r = BankCopyOut(1, 16640, @buf(0), 512)
NEXT n
f1 = Frames()
Report("BankCopyOut_512", f1 - f0, 400, 512)

NextFrame(): f0 = Frames()
FOR n = 1 TO 400
  r = BankCopyIn(1, 16640, @buf(0), 16)
NEXT n
f1 = Frames()
Report("BankCopyIn_16", f1 - f0, 400, 16)

GameMode(0)
PRINT "DONE"

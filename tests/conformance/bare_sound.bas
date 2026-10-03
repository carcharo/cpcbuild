REM BARE: only
REM Conformance (bare-metal mode, Phase 6 B4): BEEP on the AY, PAUSE and
REM WaitVsync from the interrupt handler's frame counter, SoundStop.
REM
REM No PRINT (bareout.bas writes to the printer port). A frame hook (asm,
REM runs at every frame flyback with interrupts off) reads the AY back
REM while BEEP blocks: how many frames the volume of channel A was non-zero,
REM and the tone period and mixer of the first such frame.
REM
REM The frame counter itself is checked against the raw VSYNC line (PPI
REM port B bit 0, read by a polling loop that does not depend on
REM interrupts): Spin(n) runs n loop iterations and counts the VSYNC rising
REM edges it sees; Frames() must have advanced by the same number.

#include <cpc.bas>
#include <framehook.bas>
#include "lib/bareout.bas"

DIM bs_loud AS UINTEGER
DIM bs_seen, bs_r0, bs_r1, bs_r7, bs_r8 AS UBYTE

ASM
  jp bs_skip
bs_hook:                        ; frame hook: interrupts off, registers saved
  ld a, 8
  call .core.__CPC_AY_READ
  and $0F
  jr z, bs_quiet
  ld hl, (_bs_loud)
  inc hl
  ld (_bs_loud), hl
  ld a, (_bs_seen)
  or a
  jr nz, bs_quiet
  inc a
  ld (_bs_seen), a             ; the first loud frame: snapshot
  xor a
  call .core.__CPC_AY_READ
  ld (_bs_r0), a
  ld a, 1
  call .core.__CPC_AY_READ
  ld (_bs_r1), a
  ld a, 7
  call .core.__CPC_AY_READ
  ld (_bs_r7), a
  ld a, 8
  call .core.__CPC_AY_READ
  ld (_bs_r8), a
bs_quiet:
  ret
bs_skip:
END ASM

SUB BsReset()
  bs_loud = 0
  bs_seen = 0
END SUB

FUNCTION Loud() AS UINTEGER
  RETURN bs_loud
END FUNCTION

FUNCTION Period() AS UINTEGER
  RETURN bs_r0 + 256 * (bs_r1 BAND 15)
END FUNCTION

REM Runs n iterations of a polling loop; returns the VSYNC rising edges seen.
FUNCTION FASTCALL Spin(n AS UINTEGER) AS UINTEGER
  ASM
  ld d, h
  ld e, l                       ; DE = iterations
  ld hl, 0                      ; edges
  ld b, $F5                     ; PPI port B (the low byte isn't decoded)
  ld c, 0
  in a, (c)
  and 1
  ld c, a                       ; C = previous level
bs_spin:
  in a, (c)
  and 1
  cp c
  jr z, bs_same
  ld c, a
  or a
  jr z, bs_same                 ; falling edge
  inc hl                        ; rising edge
bs_same:
  dec de
  ld a, d
  or e
  jr nz, bs_spin
  END ASM
END FUNCTION

REM Waits for a VSYNC rising edge on the raw line.
SUB FASTCALL SyncV()
  ASM
  ld bc, $F500
bs_syl:
  in a, (c)
  rra
  jr c, bs_syl
bs_syh:
  in a, (c)
  rra
  jr nc, bs_syh
  END ASM
END SUB

DIM f0 AS ULONG
DIM f1 AS ULONG
DIM e AS UINTEGER
DIM d AS UINTEGER
DIM p AS BYTE
DIM s AS FLOAT

ASM
  ld hl, bs_hook
  ld (.core.FH_ADDR), hl
END ASM
SoundStop()

REM --- the frame counter against the raw VSYNC line
SyncV()
f0 = Frames()
e = Spin(20000)
f1 = Frames()
REM the spin ends between edges: allow one frame's difference at the end
BRng("frames_vs_vsync", CAST(LONG, f1 - f0) - e, -1, 1)
BRng("spin_edges", e, 5, 40)

REM --- BEEP, constant arguments: 0.2 s = 10 frames, middle C = period 239
BsReset()
f0 = Frames()
BEEP 0.2, 0
f1 = Frames()
BRng("beep_const_frames", Loud(), 9, 11)
BRng("beep_const_elapsed", CAST(LONG, f1 - f0), 10, 11)
BCHK("beep_const_period", Period(), 239)
BCHK("beep_const_mixer", bs_r7 BAND 63, 62)
BCHK("beep_const_volume", bs_r8, 15)
BCHK("beep_const_seen", bs_seen, 1)
BCHK("beep_silent_vol", AyRead(8), 0)
BCHK("beep_silent_mixer", AyRead(7) BAND 63, 63)

REM --- BEEP, run-time arguments: 0.3 s = 15 frames, pitch 12 = period 119
d = 3
s = CAST(FLOAT, d) / 10
p = 12
BsReset()
f0 = Frames()
BEEP s, p
f1 = Frames()
BRng("beep_var_frames", Loud(), 14, 16)
REM (the float arithmetic of run-time BEEP takes about 3 frames, in firmware mode too)
BRng("beep_var_elapsed", CAST(LONG, f1 - f0), 15, 20)
BCHK("beep_var_period", Period(), 119)
BCHK("beep_var_silent", AyRead(8), 0)

REM --- BEEP, odd centisecond count rounds up to whole frames: 0.01 s = 1 frame
BsReset()
BEEP 0.01, 0
BRng("beep_short_frames", Loud(), 1, 2)

REM --- BEEP, zero duration: no sound, returns at once
BsReset()
f0 = Frames()
BEEP 0, 0
f1 = Frames()
BCHK("beep_zero_loud", Loud(), 0)
BRng("beep_zero_elapsed", CAST(LONG, f1 - f0), 0, 0)

REM --- PAUSE
f0 = Frames()
PAUSE 25
f1 = Frames()
BRng("pause_25", CAST(LONG, f1 - f0), 24, 25)
f0 = Frames()
PAUSE 1
f1 = Frames()
BRng("pause_1", CAST(LONG, f1 - f0), 0, 1)
f0 = Frames()
PAUSE 100
f1 = Frames()
BRng("pause_100", CAST(LONG, f1 - f0), 99, 100)

REM PAUSE returns just after a flyback interrupt: synchronised to the raw
REM VSYNC line, the pulse that ends it must be the 25th one. After it, the
REM raw line must still be high or have just dropped, and the next rising
REM edge (one frame later) must be seen by a short spin.
SyncV()
PAUSE 25
e = Spin(400)
BRng("pause_lands_on_flyback", e, 0, 1)

REM --- WaitVsync: exactly one frame each time
f0 = Frames()
FOR d = 1 TO 20
  WaitVsync
NEXT d
f1 = Frames()
BCHK("waitvsync_20", CAST(LONG, f1 - f0), 20)

REM --- AyWrite / SoundStop
AyWrite 8, 12
AyWrite 7, 0
SoundStop()
BCHK("stop_vol", AyRead(8), 0)
BCHK("stop_mixer", AyRead(7) BAND 63, 63)

BDone()

REM MODELS: 464 664 6128
REM EMUS: chips
REM STATE: mode=1 lrom=off urom=off ramcfg=0 crtc=63,40,46,142,38,0,25,30,0,7,0,0,48,0
REM Conformance: PlusAvailable() on a CPC without ASIC leaves the hardware as it
REM found it. The probe writes the Gate Array (an RMR2 value that is an ordinary
REM RMR write there) and sends the unlock sequence to the CRTC select port; this
REM program asks chipsrun for its state dump (mode, both ROMs, RAM configuration:
REM what the Gate Array can't be read back for) after the probe and after every
REM other cpcplus call, and the runner compares it with the lines above: mode 1,
REM lower and upper ROM off, RAM configuration 0. Chips only (Caprice32 can't
REM dump its Gate Array); the same program in a firmware build and a bare one.

#include <cpc.bas>
#include <cpcbuild/display.bas>
#include <cpcplus/cpcplus.bas>

REM The printer line "\x04STATE\n" (the same port as the END marker), then a
REM wait of 10 frames (polling the flyback bit, no firmware call: the firmware
REM turns its lower ROM on while it runs) so the dump sees this state.
SUB PState()
  ASM
  ld bc, $EF00
  ld a, $84
  out (c), a
  ld a, $D3
  out (c), a
  ld a, $D4
  out (c), a
  ld a, $C1
  out (c), a
  ld a, $D4
  out (c), a
  ld a, $C5
  out (c), a
  ld a, $8A
  out (c), a
  ld d, 10
plusstate_loop:
  ld bc, $F500
plusstate_end:
  in a, (c)
  rra
  jr c, plusstate_end
plusstate_start:
  in a, (c)
  rra
  jr nc, plusstate_start
  dec d
  jr nz, plusstate_loop
  END ASM
END SUB

DIM img(255) AS UBYTE
IF PlusAvailable() <> 0 THEN
  PRINT "FAIL none_avail"
END IF
SetPalette12(1, $0F00)
SpriteSetImage(0, @img(0))
SpriteMove(0, 10, 10)
PlusUnlock()
PlusPageIn()
PlusPageOut()
PlusLock()
PState()
PRINT "PASS none_state_dumped"
PRINT "DONE"
END

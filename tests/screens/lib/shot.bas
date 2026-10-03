REM Shot("name"): asks tools/chipsrun to save the screen as <shot-dir>/name.png
REM by sending the printer line "\x04SHOT name\n" (the same way the END
REM marker goes (the printer port), so nothing appears on screen),
REM then waits 6 frames: chipsrun grabs the screen 2 frames after it sees
REM the line, and the picture must not change meanwhile. Uses no firmware
REM call (see ShotChar, ShotWait), so a program under test that sets the
REM Gate Array directly is left alone.
#ifndef __SCREENS_SHOT__
#define __SCREENS_SHOT__

#include <cpc.bas>

REM One printer byte, straight to the printer port (&EFxx, A12 low): the
REM byte with bit 7 set as the strobe, which is how chipsrun takes it.
REM No firmware call, so a palette set directly on the Gate Array stays.
SUB ShotChar(c AS UBYTE)
  ASM
  ld bc, $EF00
  ld a, (ix+5)
  or $80
  out (c), a
  END ASM
END SUB

REM Waits for n flyback starts without calling the firmware (the PPI's
REM port B bit 0 is the flyback; interrupts stay on).
SUB ShotWait(n AS UBYTE)
  ASM
  ld d, (ix+5)
shotwait_loop:
  ld bc, $F500
shotwait_end:
  in a, (c)
  rra
  jr c, shotwait_end
shotwait_start:
  in a, (c)
  rra
  jr nc, shotwait_start
  dec d
  jr nz, shotwait_loop
  END ASM
END SUB

SUB Shot(name AS STRING)
  DIM i AS UBYTE
  ShotChar(4)
  ShotChar(83): ShotChar(72): ShotChar(79): ShotChar(84): ShotChar(32)
  FOR i = 0 TO LEN(name) - 1
    ShotChar(CODE(name(i TO i)))
  NEXT i
  ShotChar(10)
  ShotWait(6)
END SUB

#endif

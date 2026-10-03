#ifndef __CONF_TICKS__
#define __CONF_TICKS__

REM Ticks(): a 300 Hz clock in both modes.
REM Firmware: KL TIME PLEASE (&BD0D), DEHL = the 300 Hz clock.
REM Bare metal: Frames() (50 Hz, from the bare interrupt handler) * 6, so
REM the same units but 1/50 s granularity.
#ifdef CPC_BAREMETAL
#include <framehook.bas>
FUNCTION Ticks() AS ULONG
  RETURN Frames() * 6
END FUNCTION
#else
FUNCTION FASTCALL Ticks() AS ULONG
  ASM
  call .core.__FW_CALL
  defw $BD0D
  END ASM
END FUNCTION
#endif

#endif

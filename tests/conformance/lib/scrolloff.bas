#ifndef __CONF_SCROLLOFF__
#define __CONF_SCROLLOFF__

REM ScrollOffset(): the hardware-scroll offset of the screen start.
REM Firmware: SCR_GET_LOCATION (&BC0B) -> HL, which moves when the text
REM scrolls.
REM Bare metal: bare text scrolls in software and the CRTC start address
REM is only ever changed by the double buffer (cpcbuild's __CB_SET_BASE
REM writes a page, never an offset), so the offset is always 0.
#ifdef CPC_BAREMETAL
FUNCTION ScrollOffset() AS UINTEGER
  RETURN 0
END FUNCTION
#else
FUNCTION FASTCALL ScrollOffset() AS UINTEGER
  ASM
  call .core.__FW_CALL
  defw $BC0B
  END ASM
END FUNCTION
#endif

#endif

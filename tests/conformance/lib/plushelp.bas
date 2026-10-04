REM Helpers shared by tests/conformance/plus_*.bas (Phase 7 P2).
REM
REM   Iff()          1 if interrupts are enabled, 0 if not (LD A,I read twice:
REM                  the NMOS Z80 loses IFF2 from it when an interrupt is
REM                  accepted just after the instruction)
REM   IntOff() / IntOn()   DI / EI
REM   AsicPeek(a)    one byte of the ASIC register page (&4000-&7FFF): pages it
REM                  in with the library, reads, pages out
REM   RawRmr(v)      writes v straight to the Gate Array (&7Fxx)
REM   ByteAt(a)      PEEK a (kept out of the way of the optimizer)

#ifndef __CONF_PLUSHELP__
#define __CONF_PLUSHELP__

#include <cpcplus/cpcplus.bas>

FUNCTION FASTCALL Iff() AS UBYTE
  ASM
  ld a, i
  jp pe, plushelp_iff_on
  ld a, i
  jp pe, plushelp_iff_on
  xor a
  jp plushelp_iff_end
plushelp_iff_on:
  ld a, 1
plushelp_iff_end:
  END ASM
END FUNCTION

SUB IntOff()
  ASM
  di
  END ASM
END SUB

SUB IntOn()
  ASM
  ei
  END ASM
END SUB

FUNCTION AsicPeek(addr AS UINTEGER) AS UBYTE
  DIM v AS UBYTE
  PlusPageIn()
  v = PEEK(addr)
  PlusPageOut()
  RETURN v
END FUNCTION

SUB RawRmr(v AS UBYTE)
  ASM
  ld a, (ix+5)
  ld bc, $7F00
  ld c, a
  out (c), c
  END ASM
END SUB

#endif

REM zxtest.bas -- test output for Spectrum (zx48k, 48K and 128K) programs
REM under tools/zxrun.py. The zx48k runtime has no printer echo, so the
REM transcript goes out of an otherwise unused I/O port that zxrun listens on.
REM
REM Port choice: &00FF (any port with A0=1 and A1=1 works). Neither model
REM decodes anything there for a write: the ULA wants A0=0, the 128K paging
REM port A15=0 and A1=0 (&7FFD), the AY registers A15=1 and A1=0 (&FFFD,
REM &BFFD), Kempston is read-only (A7..A5=0). On real hardware the write is
REM harmless (nothing answers).
REM
REM   TOUT(s)           send the characters of s (use CHR$(10) for a new line)
REM   TLN(s)            TOUT(s) and a new line
REM   CHK(name,got,want) one line "PASS name" or "FAIL name got=.. want=.."
REM                     (both sides as strings, STR$() of the typed value;
REM                     the same convention as tests/conformance/lib/chk.bas)
REM   TSHOT(name)       ask zxrun to save the screen as <shot-dir>/name.png
REM                     (sends "\x04SHOT name\n", then HALTs 6 frames: keep the
REM                     screen unchanged for those)
REM   TEND()            send "DONE", then the END marker line "\x04END\n"
REM                     that ends the run with exit status 0

#ifndef __ZXTEST__
#define __ZXTEST__

SUB TCH(c AS UBYTE)
  OUT 255, c
END SUB

SUB TOUT(s AS STRING)
  DIM i AS UINTEGER
  FOR i = 0 TO LEN(s) - 1
    TCH(CODE(s(i TO i)))
  NEXT i
END SUB

SUB TLN(s AS STRING)
  TOUT(s)
  TCH(10)
END SUB

SUB CHK(name AS STRING, gotv AS STRING, wantv AS STRING)
  IF gotv = wantv THEN
    TLN("PASS " + name)
  ELSE
    TLN("FAIL " + name + " got=" + gotv + " want=" + wantv)
  END IF
END SUB

SUB TWAIT(n AS UBYTE)
  IF n = 0 THEN RETURN
  ASM
  ld b, (ix+5)
  ei
tzw_loop:
  halt
  djnz tzw_loop
  END ASM
END SUB

SUB TSHOT(name AS STRING)
  TCH(4)
  TOUT("SHOT " + name)
  TCH(10)
  TWAIT(6)
END SUB

SUB TEND()
  TLN("DONE")
  TCH(4)
  TOUT("END")
  TCH(10)
END SUB

#endif

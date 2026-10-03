REM Spectrum conformance: typed keys through INKEY$ and the keyboard ports.
REM zxrun types the lines below while the program runs, each followed by
REM ENTER (tests/zx/run.py reads these lines):
REM TYPE: hello
REM TYPE: Q
REM TYPE: 1
#include <zxtest.bas>

REM Reads keys until ENTER (or about 6 s), returning the characters.
FUNCTION ReadLine() AS STRING
  DIM s AS STRING
  DIM k AS STRING
  DIM t AS UINTEGER
  s = ""
  FOR t = 1 TO 300
    k = INKEY$
    IF k <> "" THEN
      IF CODE(k) = 13 THEN
        WHILE INKEY$ <> "": TWAIT(1): END WHILE
        RETURN s
      END IF
      s = s + k
      REM wait for the key to be released
      WHILE INKEY$ <> "": TWAIT(1): END WHILE
    END IF
    TWAIT(1)
  NEXT t
  RETURN s + "<timeout>"
END FUNCTION

CHK("line1", ReadLine(), "hello")
CHK("shifted", ReadLine(), "Q")
REM Then a raw port read: row &F7FE (1..5) while "1" is held. ENTER follows
REM the key, so poll until bit 0 is low (pressed) or give up.
DIM t AS UINTEGER
DIM seen AS UBYTE
seen = 0
FOR t = 1 TO 300
  IF (IN(63486) BAND 1) = 0 THEN seen = 1: EXIT FOR
  TWAIT(1)
NEXT t
CHK("port_row", STR$(seen), "1")
TEND()

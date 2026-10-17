REM say.bas -- test output for the logic tests, on the CPC (PRINT, which the
REM runner reads) and the Spectrum (the runner's test port: tests/zx/lib/
REM zxtest.bas; zxrun puts that directory on the include path).
REM   Say(s)     one line
REM   AllDone()  "DONE" (and, on the Spectrum, the END marker)

#ifdef __ZX48K__
#include <zxtest.bas>
SUB Say(s AS STRING)
  TLN(s)
END SUB
SUB AllDone()
  TEND()
END SUB
#else
SUB Say(s AS STRING)
  PRINT s
END SUB
SUB AllDone()
  PRINT "DONE"
END SUB
#endif

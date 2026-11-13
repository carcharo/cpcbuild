REM say.bas -- test output for the logic tests, on the CPC (PRINT, which the
REM runner reads).
REM   Say(s)     one line
REM   AllDone()  "DONE"

SUB Say(s AS STRING)
  PRINT s
END SUB
SUB AllDone()
  PRINT "DONE"
END SUB

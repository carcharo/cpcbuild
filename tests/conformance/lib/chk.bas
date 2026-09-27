REM Shared self-check helper for tests/conformance/*.bas.
REM
REM CHK prints "PASS <name>" if gotv = wantv, else
REM "FAIL <name> got=<gotv> want=<wantv>". Both sides are passed as
REM strings (the caller formats them, usually with STR$()) so this
REM helper never has to know or care which numeric width/signedness is
REM under test -- see cpcbuild's PLAN/notes on why: STR$ on the actual
REM typed variable already renders it correctly (unsigned types print
REM unsigned), which a single Long/ULong-typed helper parameter could
REM not do for every width at once.

#ifndef __CONFORMANCE_CHK__
#define __CONFORMANCE_CHK__

SUB CHK(name AS STRING, gotv AS STRING, wantv AS STRING)
  IF gotv = wantv THEN
    PRINT "PASS "; name
  ELSE
    PRINT "FAIL "; name; " got="; gotv; " want="; wantv
  END IF
END SUB

#endif

REM Conformance: DATA/READ/RESTORE -- numbers and strings, RESTORE to
REM a label. Expected values computed by hand.

#include "lib/chk.bas"

DATA 10, 20, 30
DATA "ALPHA", "BETA"
DATA -5, 300

RESTORE
DIM n1 AS Integer
DIM n2 AS Integer
DIM n3 AS Integer
READ n1, n2, n3
CHK("read_n1", STR$(n1), "10")
CHK("read_n2", STR$(n2), "20")
CHK("read_n3", STR$(n3), "30")

DIM s1$ AS STRING
DIM s2$ AS STRING
READ s1$, s2$
CHK("read_s1", s1$, "ALPHA")
CHK("read_s2", s2$, "BETA")

DIM neg AS Integer
DIM big AS Integer
READ neg, big
CHK("read_neg", STR$(neg), "-5")
CHK("read_big", STR$(big), "300")

REM RESTORE with no label continues from the top of all DATA again.
RESTORE
DIM again AS Integer
READ again
CHK("restore_plain", STR$(again), "10")

REM RESTORE <label>: jump READ's cursor to the DATA statement(s) that
REM textually follow that label, wherever it is in the file.
RESTORE lblMid
DIM midv AS Integer
DIM midv2$ AS STRING
READ midv, midv2$
CHK("restore_label_num", STR$(midv), "777")
CHK("restore_label_str", midv2$, "LABELDATA")

REM A READ past the last DATA item raises the "out of data" runtime
REM error (matches zx48k) -- not exercised here since that would end
REM the program via error.asm's rst 0 before DONE could print.

GOTO lblSkip
lblMid:
DATA 777, "LABELDATA"
lblSkip:

PRINT "DONE"
END

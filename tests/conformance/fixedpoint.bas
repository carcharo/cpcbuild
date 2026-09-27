REM Conformance: fixed-point (16.16, 32-bit) arithmetic. Expected
REM values computed by hand; every literal here is an exact multiple of
REM 1/4 or 1/2, well inside the format's 1/65536 resolution, so there is
REM no rounding to account for. STR$ on a Fixed trims a trailing ".0"
REM (fp_tostr.asm's documented format) -- confirmed empirically once
REM (see cpcbuild's report) before locking these exact strings in.

#include "lib/chk.bas"

DIM a AS Fixed
DIM b AS Fixed
a = 1.5
b = 2.25

CHK("add", STR$(a + b), "3.75")
CHK("sub", STR$(a - b), "-0.75")
CHK("mul_by_int", STR$(a * 2), "3")

DIM c AS Fixed
c = 10.5
CHK("div_by_int", STR$(c / 2), "5.25")

DIM d AS Fixed
d = 5.0
CHK("whole_trims_point", STR$(d), "5")

DIM e AS Fixed
e = -3.75
CHK("negative", STR$(e), "-3.75")

DIM lt AS UByte
lt = (a < b)
CHK("cmp_lt", STR$(lt), "1")

DIM ge AS UByte
ge = (b >= a)
CHK("cmp_ge", STR$(ge), "1")

PRINT "DONE"
END

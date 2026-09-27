REM Conformance: arrays -- 1D/2D/3D, LBOUND/UBOUND, array of strings,
REM array copy. Expected values computed by hand.

#include "lib/chk.bas"

REM -- 1D --
DIM a1(4) AS Integer
DIM i AS UByte
FOR i = 0 TO 4
  a1(i) = i * 10
NEXT i
CHK("d1_val2", STR$(a1(2)), "20")
CHK("d1_val4", STR$(a1(4)), "40")
REM UBOUND/LBOUND with no dimension arg default to dimension 0, which
REM returns the *number of dimensions*, not a bound (docs/ubound.md,
REM docs/lbound.md) -- dimension 1 is a1's only (and first) dimension.
CHK("d1_ndims", STR$(UBOUND(a1)), "1")
CHK("d1_lbound", STR$(LBOUND(a1, 1)), "0")
CHK("d1_ubound", STR$(UBOUND(a1, 1)), "4")

REM -- 2D -- 3 rows (0-2) x 4 cols (0-3)
DIM a2(2, 3) AS Integer
DIM r AS UByte
DIM c AS UByte
FOR r = 0 TO 2
  FOR c = 0 TO 3
    a2(r, c) = r * 10 + c
  NEXT c
NEXT r
CHK("d2_val_1_2", STR$(a2(1, 2)), "12")
CHK("d2_val_2_3", STR$(a2(2, 3)), "23")
CHK("d2_ndims", STR$(UBOUND(a2, 0)), "2")
CHK("d2_ubound_dim1", STR$(UBOUND(a2, 1)), "2")
CHK("d2_ubound_dim2", STR$(UBOUND(a2, 2)), "3")

REM -- 3D -- 2x2x2
DIM a3(1, 1, 1) AS Integer
DIM x AS UByte
DIM y AS UByte
DIM z AS UByte
FOR x = 0 TO 1
  FOR y = 0 TO 1
    FOR z = 0 TO 1
      a3(x, y, z) = x * 4 + y * 2 + z
    NEXT z
  NEXT y
NEXT x
CHK("d3_val_1_1_1", STR$(a3(1, 1, 1)), "7")
CHK("d3_val_0_1_0", STR$(a3(0, 1, 0)), "2")
CHK("d3_ndims", STR$(UBOUND(a3, 0)), "3")
CHK("d3_ubound_dim2", STR$(UBOUND(a3, 2)), "1")

REM -- array of strings --
DIM sa$(3) AS STRING
sa$(0) = "ZERO"
sa$(1) = "ONE"
sa$(2) = "TWO"
sa$(3) = "THREE"
DIM joined$ AS STRING
joined$ = ""
DIM j AS UByte
FOR j = 0 TO 3
  joined$ = joined$ + sa$(j)
NEXT j
CHK("strarr_concat", joined$, "ZEROONETWOTHREE")

REM -- array copy: element-by-element (Boriel arrays are not
REM assignable as a whole with `=`; a copy is a manual element loop) --
DIM src(3) AS Integer
DIM dst(3) AS Integer
DIM k AS UByte
FOR k = 0 TO 3
  src(k) = k * k
NEXT k
FOR k = 0 TO 3
  dst(k) = src(k)
NEXT k
src(0) = 999
CHK("copy_independent", STR$(dst(0)), "0")
CHK("copy_val3", STR$(dst(3)), "9")

PRINT "DONE"
END

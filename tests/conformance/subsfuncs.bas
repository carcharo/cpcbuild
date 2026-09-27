REM Conformance: SUB/FUNCTION -- byval/byref params, recursion
REM (factorial/fibonacci), local arrays. Expected values computed by
REM hand.

#include "lib/chk.bas"

REM ---- byval (default for scalars): callee's changes don't escape ----
SUB BumpVal(x AS Integer)
  x = x + 100
END SUB

DIM v1 AS Integer
v1 = 5
BumpVal(v1)
CHK("byval_unchanged", STR$(v1), "5")

REM ---- byref (explicit keyword): callee's changes do escape ----
SUB BumpRef(BYREF x AS Integer)
  x = x + 100
END SUB

DIM v2 AS Integer
v2 = 5
BumpRef(v2)
CHK("byref_changed", STR$(v2), "105")

REM ---- recursion: factorial ----
FUNCTION Fact(n AS UByte) AS ULong
  IF n <= 1 THEN
    RETURN 1
  END IF
  RETURN n * Fact(n - 1)
END FUNCTION

CHK("fact_0", STR$(Fact(0)), "1")
CHK("fact_1", STR$(Fact(1)), "1")
CHK("fact_5", STR$(Fact(5)), "120")
CHK("fact_10", STR$(Fact(10)), "3628800")

REM ---- recursion: fibonacci ----
FUNCTION Fib(n AS UByte) AS UInteger
  IF n < 2 THEN
    RETURN n
  END IF
  RETURN Fib(n - 1) + Fib(n - 2)
END FUNCTION

CHK("fib_0", STR$(Fib(0)), "0")
CHK("fib_1", STR$(Fib(1)), "1")
CHK("fib_10", STR$(Fib(10)), "55")
CHK("fib_15", STR$(Fib(15)), "610")

REM ---- local arrays inside a FUNCTION body ----
FUNCTION SumSquares(n AS UByte) AS UInteger
  DIM tmp(9) AS UInteger
  DIM i AS UByte
  DIM total AS UInteger
  FOR i = 0 TO n - 1
    tmp(i) = i * i
  NEXT i
  total = 0
  FOR i = 0 TO n - 1
    total = total + tmp(i)
  NEXT i
  RETURN total
END FUNCTION

REM sum of squares 0..4 = 0+1+4+9+16 = 30
CHK("local_array_sum", STR$(SumSquares(5)), "30")

PRINT "DONE"
END

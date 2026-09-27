REM Conformance: heap / memory allocation patterns via MEMAVAIL()/
REM MAXAVAIL() (pattern: tests/runtime/cases/maxavail.bas in the
REM zxbasic repo, which fixes heap_size and checks exact byte counts).
REM
REM All measurements are taken into plain UInteger variables *before*
REM any CHK() call runs -- CHK itself (tests/conformance/chk.bas) takes
REM STRING parameters, and evaluating a CHK call's own string arguments
REM touches the heap (temporary STR$ buffers, etc.), which would
REM perturb a measurement taken *inside* the same statement as a check.
REM Confirmed empirically while writing this file: a bare `PRINT
REM maxavail()` before any DIM/CHK reports 4092 for heap_size 4096, but
REM measuring through a CHK(...) call in the same statement reports a
REM few bytes less. Keeping every MEMAVAIL/MAXAVAIL call in its own
REM plain statement, before any CHK, avoids that entirely -- see
REM cpcbuild's report for the full byte-accounting trail.
REM
REM The two size-dependent deltas below (15 for "HELLO WORLD", 26/11 for
REM maxavail/memavail after a$+a$) are hand-computed and cross-checked
REM against zx48k's own maxavail.bas, which sees the identical deltas
REM for the identical operations at a different heap_size baseline --
REM the heap/string code is architecture-independent.

#pragma heap_size = 4096
#include <alloc.bas>
#include "lib/chk.bas"

DIM base AS UInteger
DIM baseMem AS UInteger
base = maxavail()
baseMem = memavail()

DIM a$ AS STRING
a$ = "HELLO WORLD"
DIM afterAllocMax AS UInteger
DIM afterAllocMem AS UInteger
afterAllocMax = maxavail()
afterAllocMem = memavail()

a$ = a$ + a$
DIM afterConcatMax AS UInteger
DIM afterConcatMem AS UInteger
afterConcatMax = maxavail()
afterConcatMem = memavail()

a$ = ""
DIM afterFreeMax AS UInteger
afterFreeMax = maxavail()

REM ---- churn: allocate/free many strings of varying size in a loop.
REM The general-purpose heap allocator can leave a small, *fixed*
REM residue of unreclaimable free-list bookkeeping behind after a churn
REM of allocation sizes (confirmed empirically: 50 reps and 200 reps of
REM the loop below both leave exactly the same memavail() afterwards,
REM a few bytes below the pre-churn value) -- that's fragmentation, not
REM a leak. An actual per-iteration leak would keep shrinking as the
REM rep count grows, so the real regression check is that MORE churn
REM doesn't cost MORE memory: churning 10x as much must land on the
REM exact same final value. ----
DIM churn$ AS STRING
DIM rep AS UInteger
DIM k AS UByte

FOR rep = 1 TO 20
  churn$ = ""
  FOR k = 1 TO (rep MOD 10) + 1
    churn$ = churn$ + "XYZ"
  NEXT k
NEXT rep
churn$ = ""
DIM afterChurn20 AS UInteger
afterChurn20 = memavail()

FOR rep = 1 TO 200
  churn$ = ""
  FOR k = 1 TO (rep MOD 10) + 1
    churn$ = churn$ + "XYZ"
  NEXT k
NEXT rep
churn$ = ""
DIM afterChurn200 AS UInteger
afterChurn200 = memavail()

REM ---- now that every measurement is safely captured, check them ----
CHK("initial_avail_eq", STR$(baseMem = base), "1")
CHK("after_alloc_maxavail_delta", STR$(base - afterAllocMax), "15")
CHK("after_alloc_memavail_delta", STR$(baseMem - afterAllocMem), "15")
CHK("after_concat_maxavail_delta", STR$(base - afterConcatMax), "41")
CHK("after_concat_memavail_delta", STR$(baseMem - afterConcatMem), "26")
CHK("after_free_recovers", STR$(base - afterFreeMax), "4")
CHK("churn_no_growth", STR$(afterChurn20), STR$(afterChurn200))

PRINT "DONE"
END

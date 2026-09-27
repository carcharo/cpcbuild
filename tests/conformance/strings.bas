REM Conformance: strings -- concat, slicing, LEN, CHR$/CODE, STR$,
REM comparisons, string arrays, long strings / heap churn.
REM Expected values computed by hand (plain string ops, no float
REM involvement).

#include "lib/chk.bas"

DIM a$ AS STRING
DIM b$ AS STRING
DIM c$ AS STRING

a$ = "AB"
b$ = "CD"
c$ = a$ + b$
CHK("concat", c$, "ABCD")

DIM h$ AS STRING
h$ = "HELLO WORLD"
CHK("len", STR$(LEN(h$)), "11")
CHK("slice_2_4", h$(2 TO 4), "LLO")
CHK("slice_0_0", h$(0 TO 0), "H")
CHK("slice_last", h$(10 TO 10), "D")

CHK("chr_65", CHR$(65), "A")
CHK("code_A", STR$(CODE("A")), "65")
CHK("code_space", STR$(CODE(" ")), "32")

CHK("str_pos", STR$(42), "42")
CHK("str_neg", STR$(-7), "-7")
CHK("str_zero", STR$(0), "0")

REM NOTE: comparing two STRING *literals* directly (e.g. "ABC" < "ABD")
REM crashes the compiler's constant folder (src/symbols/binary.py:122
REM calls a.text/b.text, but a constant-folded SymbolSTRING has no
REM .text attribute) on zx48k too -- a pre-existing core bug, not a cpc
REM regression. Comparing through variables avoids constant folding.
DIM lhs$ AS STRING
DIM rhs$ AS STRING
DIM cmp1 AS UByte
DIM cmp2 AS UByte
DIM cmp3 AS UByte
lhs$ = "ABC"
rhs$ = "ABD"
cmp1 = (lhs$ < rhs$)
rhs$ = "ABC"
cmp2 = (lhs$ = rhs$)
lhs$ = "B"
rhs$ = "A"
cmp3 = (lhs$ > rhs$)
CHK("cmp_lt", STR$(cmp1), "1")
CHK("cmp_eq", STR$(cmp2), "1")
CHK("cmp_gt", STR$(cmp3), "1")

REM -- string arrays --
DIM sa$(4) AS STRING
sa$(0) = "ZERO"
sa$(1) = "ONE"
sa$(2) = "TWO"
sa$(3) = "THREE"
sa$(4) = "FOUR"
CHK("strarr_join", sa$(0) + sa$(2) + sa$(4), "ZEROTWOFOUR")
sa$(1) = sa$(1) + "!"
CHK("strarr_mutate", sa$(1), "ONE!")

REM -- long strings / heap churn: build a string to 260 chars (past a
REM single-byte length if this were ever mistaken for one, and enough
REM to exercise a handful of heap growth reallocations), then release
REM it, many times over, checking the length each time.
DIM big$ AS STRING
DIM i AS UInteger
DIM reps AS UInteger
DIM okBig AS UByte
okBig = 1
FOR reps = 1 TO 20
  big$ = ""
  FOR i = 1 TO 26
    big$ = big$ + "ABCDEFGHIJ"
  NEXT i
  IF LEN(big$) <> 260 THEN
    okBig = 0
  END IF
NEXT reps
CHK("heap_churn_len", STR$(okBig), "1")

REM After the loop releases every intermediate buffer, the final
REM buffer is still 260 chars and its content is the expected repeat.
CHK("heap_churn_final_len", STR$(LEN(big$)), "260")
CHK("heap_churn_final_head", big$(0 TO 9), "ABCDEFGHIJ")
CHK("heap_churn_final_tail", big$(250 TO 259), "ABCDEFGHIJ")

PRINT "DONE"
END

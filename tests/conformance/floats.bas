REM Conformance: floating point. The float calculator (fp_calc.asm /
REM stackf.asm / str.asm / val.asm / printf.asm / divf.asm) is being
REM ported by another agent in parallel with this suite -- see
REM cpcbuild's report for its status as of this suite's last run.
REM
REM The first block below is exact binary fractions (halves/quarters/
REM eighths) so there is no float-rounding ambiguity to account for by
REM hand.
REM
REM The "round_*" block exercises fp_tostr's rounding. Since the Spectrum-
REM style text format (8 significant digits, exponent notation; see
REM floatfmt.bas) the expectations are the Spectrum ROM's own output
REM (2/3 -> "0.66666667", 4E-6 -> "4E-6"); they used to be the old 5-decimal
REM format ("0.66667", "0").

#include "lib/chk.bas"

DIM a AS Float
DIM b AS Float
a = 1.5
b = 2.25

CHK("add", STR$(a + b), "3.75")
CHK("sub", STR$(b - a), "0.75")
CHK("mul", STR$(a * 2), "3")
CHK("div", STR$(b / a), "1.5")

CHK("sqr_perfect", STR$(SQR(16.0)), "4")
CHK("abs_neg", STR$(ABS(-3.5)), "3.5")
CHK("abs_pos", STR$(ABS(3.5)), "3.5")
CHK("int_trunc", STR$(INT(3.75)), "3")
CHK("int_trunc_neg", STR$(INT(-3.75)), "-4")

DIM big AS Float
big = 100000.0
CHK("large_no_exponent", STR$(big), "100000")

DIM lt AS UByte
lt = (a < b)
CHK("cmp_lt", STR$(lt), "1")

DIM eq AS UByte
eq = (a + b = 3.75)
CHK("cmp_eq", STR$(eq), "1")

REM --- fp_tostr rounding (8 significant digits, Spectrum style) ---
REM
REM Each value is computed into a Float variable in its own statement,
REM then STR$'d in a separate CHK call. STR$ of a literal/constant
REM expression gets constant-folded by the compiler itself (Python-side,
REM full precision, bypassing fp_tostr entirely) -- routing through a
REM variable forces the runtime conversion this fix is about.

DIM sinval AS Float
sinval = SIN(PI / 6)
CHK("round_sin_half", STR$(sinval), "0.5")

DIM two AS Float
DIM three AS Float
two = 2
three = 3
CHK("round_two_thirds", STR$(two / three), "0.66666667")
CHK("round_neg_two_thirds", STR$(-two / three), "-0.66666667")
CHK("round_one_third", STR$((two / two) / three), "0.33333333")

DIM lnval AS Float
lnval = LN(10)
CHK("round_ln10", STR$(lnval), "2.3025851")

DIM sqrval AS Float
sqrval = SQR(2)
CHK("round_sqr2", STR$(sqrval), "1.4142136")

DIM expval AS Float
expval = EXP(1)
CHK("round_exp1", STR$(expval), "2.7182818")

DIM tenth AS Float
tenth = 0.1
CHK("round_tenth", STR$(tenth), "0.1")

DIM near1 AS Float
near1 = 0.999996
CHK("round_carry_to_1", STR$(near1), "0.999996")

DIM near10 AS Float
near10 = 9.999996
CHK("round_carry_to_10", STR$(near10), "9.999996")

REM 99999.999996 as a single literal loses precision in the compiler's
REM own decimal->float packer (src/api/fp.py truncates rather than
REM rounds the 32-bit mantissa -- unrelated to fp_tostr.asm), landing
REM below 100000 by more than fp_tostr's rounding step can recover.
REM Build the same value at runtime from exactly-representable pieces
REM instead, so this checks fp_tostr's carry, not the literal packer.
DIM hundredk AS Float
DIM sixmil AS Float
hundredk = 100000
sixmil = 1000000
CHK("round_carry_to_100000", STR$(hundredk - 4 / sixmil), "100000")

DIM tiny AS Float
tiny = 0.000004
CHK("round_tiny_to_zero", STR$(tiny), "4E-6")

DIM negtiny AS Float
negtiny = -0.000004
CHK("round_neg_tiny_no_sign", STR$(negtiny), "-4E-6")

DIM mixed AS Float
mixed = 123.456
CHK("round_no_op_exact", STR$(mixed), "123.456")

DIM intf AS Float
intf = 1024
CHK("round_no_op_integer", STR$(intf), "1024")

DIM zerof AS Float
zerof = 0
CHK("round_zero", STR$(zerof), "0")

PRINT "DONE"
END

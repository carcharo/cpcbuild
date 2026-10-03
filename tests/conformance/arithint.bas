REM Conformance: 8/16/32-bit signed/unsigned integer arithmetic --
REM overflow wrap, mul, div/mod by negatives (and the compiler's
REM documented div/mod special cases), shifts, bitwise, comparisons.
REM Expected values computed by hand from plain two's-complement,
REM fixed-width arithmetic (no runtime overflow trap exists in this
REM compiler -- confirmed by reading src/api/errmsg.py and the z80
REM backend: arithmetic is native Z80 ALU ops, so it always wraps).
REM
REM DIV (`/` on two integer operands) and MOD have THREE different
REM code paths in this compiler that can disagree on the same numbers:
REM   (a) two compile-time-constant literals -> folded in Python
REM   (b) a runtime value divided/modded by the literal constant 2 (DIV)
REM       or by a literal power-of-2 (MOD) -> a peephole emits a raw
REM       Z80 shift/AND instead of calling the general routine
REM   (c) anything else -> the general runtime div8/16/32 / mod8/16/32
REM       routines: DIV truncates toward zero (sign-corrected magnitude
REM       division); MOD returns |a| mod |b| with NO sign correction at
REM       all (i.e. it is never negative, regardless of either operand's
REM       sign).
REM This suite deliberately never divides/mods two bare literals (path
REM (a) is a compile-time Python detail, not cpc runtime behaviour) and
REM tests (b) and (c) as separate, explicitly-labelled checks -- both
REM are "correct" in the sense of matching the compiler's own documented
REM behaviour; they just aren't the same as each other.

#include "lib/chk.bas"

REM ---- overflow wrap (unsigned) ----
DIM ub AS UByte
ub = 255
ub = ub + 1
CHK("ubyte_wrap", STR$(ub), "0")

DIM ui AS UInteger
ui = 65535
ui = ui + 1
CHK("uint_wrap", STR$(ui), "0")

DIM ul AS ULong
ul = 4294967295
ul = ul + 1
CHK("ulong_wrap", STR$(ul), "0")

REM ---- overflow wrap (signed) ----
DIM sb AS Byte
sb = 127
sb = sb + 1
CHK("byte_wrap", STR$(sb), "-128")

DIM si AS Integer
si = 32767
si = si + 1
CHK("int_wrap", STR$(si), "-32768")

DIM sl AS Long
sl = 2147483647
sl = sl + 1
REM STR$ of a LONG goes through FLOAT (as on the Spectrum: 8 digits, E notation)
CHK("long_wrap", STR$(sl), "-2.1474836E+9")

REM ---- multiplication overflow wrap ----
DIM m1 AS UByte
DIM m2 AS UByte
m1 = 200
m2 = 200
m1 = m1 * m2
CHK("ubyte_mul_wrap", STR$(m1), "64")

DIM m3 AS Byte
m3 = 100
m3 = m3 * 2
CHK("byte_mul_wrap", STR$(m3), "-56")

REM ---- DIV/MOD by negatives, general runtime path (variable divisor,
REM never a bare literal, so this is always path (c) above) ----
DIM a AS Integer
DIM d2 AS Integer
DIM d3 AS Integer
DIM dm2 AS Integer
DIM dm3 AS Integer
a = -7
d2 = 2
d3 = 3
dm2 = -2
dm3 = -3

CHK("div_neg_pos", STR$(a / d2), "-3")     REM -7/2, truncate toward 0
CHK("div_pos_neg", STR$(7 / dm2), "-3")    REM 7/-2
CHK("div_neg_neg", STR$(a / dm2), "3")     REM -7/-2

CHK("mod_neg_pos", STR$(a MOD d2), "1")    REM |-7| mod |2| = 1
CHK("mod_pos_neg", STR$(7 MOD dm2), "1")   REM |7| mod |-2| = 1
CHK("mod_neg_neg", STR$(a MOD dm2), "1")   REM |-7| mod |-2| = 1
CHK("mod_neg_pos3", STR$(a MOD d3), "1")   REM |-7| mod |3| = 1
CHK("mod_neg_neg3", STR$(a MOD dm3), "1")  REM |-7| mod |-3| = 1

REM ---- DIV/MOD special-cased literal divisors (path (b)) ----
REM DIV by the literal 2 (divisor written as `2` in the source, on a
REM variable dividend): a raw arithmetic-shift-right, i.e. FLOOR
REM division, not truncation -- differs from the general path above
REM for a negative dividend: floor(-7/2) = -4, not -3.
DIM litdiv AS Integer
litdiv = -7
CHK("div_by_literal_2", STR$(litdiv / 2), "-4")

REM MOD by the literal 4 (a power of 2, on a variable dividend): a raw
REM AND-mask on the two's-complement bit pattern, which reproduces
REM floor-mod -- differs from the general (magnitude) path for a
REM negative dividend: floor-mod(-7,4) = 1, but the general/variable-
REM divisor path below gives |-7| mod |4| = 3.
DIM litmod AS Integer
litmod = -7
CHK("mod_by_literal_4", STR$(litmod MOD 4), "1")

DIM vardiv4 AS Integer
vardiv4 = 4
CHK("mod_by_variable_4", STR$(litmod MOD vardiv4), "3")

REM ---- shifts: SHR is arithmetic (sign-extending) on signed types,
REM logical (zero-filling) on unsigned types; SHL doesn't depend on
REM signedness. ----
REM KNOWN FAIL (core compiler bug, not cpc-specific -- do not "fix" by
REM changing this expectation): src/arch/z80/backend/_16bit.py's
REM shri16(), the shift-amount==1 fast path (line 929), emits `srl h`
REM (logical shift) instead of `sra h` (arithmetic shift) -- it's a
REM copy-paste of shru16()'s identical fast path just above it. Every
REM other shift amount (the >1 loop, line 943) correctly uses `sra h`,
REM and shri8/shri32 are both correct, so this is an isolated one-line
REM slip, reproducible on zx48k too (same shared backend file) -- not a
REM cpc regression. Real answer: floor(-8/2) = -4 (arithmetic shift);
REM the bug currently gives 32764 (a logical shift of -8's bit pattern).
DIM shs AS Integer
shs = -8
CHK("shr_signed", STR$(shs SHR 1), "-4")

DIM shu AS UInteger
shu = 32768
CHK("shr_unsigned", STR$(shu SHR 1), "16384")

DIM shl1 AS Integer
shl1 = 100
CHK("shl", STR$(shl1 SHL 2), "400")

REM ---- bitwise (bAND/bOR/bXOR are true bit-by-bit ops regardless of
REM operand value; plain AND/OR/XOR are documented as boolean-only and
REM don't reliably clamp to 0/1 for non-boolean operands, so they're
REM intentionally not used here on raw integers -- see the file header
REM of tests/conformance/dataread.bas's sibling notes / cpcbuild's
REM report for the source citation). ----
DIM bw1 AS UByte
DIM bw2 AS UByte
bw1 = 12
bw2 = 10
CHK("band", STR$(bw1 bAND bw2), "8")
CHK("bor", STR$(bw1 bOR bw2), "14")
CHK("bxor", STR$(bw1 bXOR bw2), "6")

DIM bn AS UByte
bn = 0
CHK("bnot_ubyte", STR$(bn bXOR 255), "255")

REM ---- comparisons (same-signedness; the mixed signed/unsigned
REM comparison gotcha -- comparing an Integer to a UInteger casts the
REM UInteger operand to signed first -- is its own dedicated check) ----
DIM c1 AS Integer
DIM c2 AS Integer
DIM cr AS UByte
c1 = -5
c2 = 3
cr = (c1 < c2)
CHK("cmp_signed_lt", STR$(cr), "1")

DIM cu1 AS UInteger
DIM cu2 AS UInteger
cu1 = 5
cu2 = 3
cr = (cu1 > cu2)
CHK("cmp_unsigned_gt", STR$(cr), "1")

REM Mixed signed/unsigned: UInteger 40000 vs Integer 100. Naively
REM 40000 > 100. But comparing Integer to UInteger casts the UInteger
REM side to signed Integer first (src/api/check.py's common_type), and
REM 40000 as a signed 16-bit value is 40000-65536 = -25536, so the
REM actual comparison performed is (-25536) > 100, which is FALSE.
DIM mu AS UInteger
DIM mi AS Integer
mu = 40000
mi = 100
cr = (mu > mi)
CHK("cmp_mixed_signed_gotcha", STR$(cr), "0")

PRINT "DONE"
END

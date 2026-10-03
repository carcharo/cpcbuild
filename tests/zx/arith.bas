REM Spectrum conformance: integer and floating-point arithmetic.
#include <zxtest.bas>

DIM ub AS UBYTE
DIM sb AS BYTE
DIM ui AS UINTEGER
DIM si AS INTEGER
DIM ul AS ULONG
DIM sl AS LONG
DIM f, g AS FLOAT

ub = 200: ub = ub + 100
CHK("ubyte_wrap", STR$(ub), "44")
sb = 100: sb = sb + 100
CHK("byte_wrap", STR$(sb), "-56")
ui = 60000: ui = ui + 10000
CHK("uinteger_wrap", STR$(ui), "4464")
si = 300: si = si * 100
CHK("integer_mul", STR$(si), "30000")
si = 7
CHK("integer_div", STR$(si / 2), "3")
CHK("integer_mod", STR$(si MOD 3), "1")
ui = 1234
CHK("uinteger_div", STR$(ui / 10), "123")
CHK("uinteger_mul", STR$(ui * 50), "61700")
ul = 100000: ul = ul * 40000
CHK("ulong_mul", STR$(ul / 1000), "4000000")
sl = -100000
CHK("long_div", STR$(sl / 7), "-14285")
CHK("shifts", STR$(1 << 7) + "," + STR$(256 >> 3), "128,32")
CHK("bitops", STR$(0xF0 BAND 0x3C) + "," + STR$(0xF0 BOR 0x0F) + "," + STR$(0xFF BXOR 0x0F), "48,255,240")
f = 1.5: g = 2.25
CHK("float_add", STR$(f + g), "3.75")
CHK("float_mul", STR$(f * g), "3.375")
CHK("float_div", STR$(g / f), "1.5")
CHK("float_sub", STR$(f - g), "-0.75")
CHK("float_cmp", STR$(f < g) + STR$(f > g), "10")
CHK("sqr", STR$(SQR(144)), "12")
CHK("int", STR$(INT(-2.5)) + "," + STR$(INT(2.5)), "-3,2")
CHK("abs", STR$(ABS(-3.5)), "3.5")
CHK("float_to_int", STR$(CAST(UINTEGER, 1000.7)), "1000")
f = 3
CHK("pow", STR$(f ^ 4), "81")
f = 0.1 + 0.2
CHK("float_small", STR$(INT(f * 100 + 0.5)), "30")
TEND()

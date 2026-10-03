REM Spectrum conformance: PRINT, strings, the transcript port.
#include <zxtest.bas>

DIM a$, b$ AS STRING
CLS
PRINT "Hello, Spectrum"
PRINT AT 3, 2; "at 3,2"; TAB 12; "tab"
a$ = "Boriel"
b$ = a$ + " BASIC"
PRINT b$
TLN("Hello, Spectrum")
CHK("strcat", b$, "Boriel BASIC")
CHK("len", STR$(LEN(b$)), "12")
CHK("slice", b$(7 TO 11), "BASIC")
CHK("chr", CHR$(65) + CHR$(66), "AB")
CHK("code", STR$(CODE("a")), "97")
CHK("val", STR$(VAL("123") + 1), "124")
CHK("print_attr", STR$(PEEK(22528 + 3 * 32 + 2)), STR$(PEEK(22528)))
CHK("print_pixels", STR$(PEEK(16384 + 3 * 32 + 2 + 256 * 3) <> 0), "1")
TEND()

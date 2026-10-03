REM Runner self-test: returns to BASIC without TEND -> reaches address 0, exit 4
REM EXPECT-EXIT: 4
#include <zxtest.bas>
TLN("no end marker")

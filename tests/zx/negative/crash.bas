REM Runner self-test: falls to address 0 without the END marker -> exit 4
REM EXPECT-EXIT: 4
#include <zxtest.bas>
TLN("before")
ASM
  jp 0
END ASM

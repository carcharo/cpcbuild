REM Runner self-test: a runtime error (RST 8) -> exit 4, "Error 2" in the transcript
REM EXPECT-EXIT: 4
#include <zxtest.bas>
TLN("before")
ASM
  ld a, 2
  call .core.__ERROR
END ASM

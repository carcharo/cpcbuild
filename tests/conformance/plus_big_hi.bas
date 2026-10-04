REM MODELS: plus
REM Conformance: as plus_big.bas with a program of about 32 KB, so that the library's code
REM lies above &8000 and the pictures it copies are in &4000-&7FFF (Phase 7 P3).
REM ZXBC: -H 512
REM BARE: skip the bare runtime (text, graphics) is 3 KB bigger, so a program with the library above &8000 ends past &A67B, which the firmware's loader (RUN" from disc) cannot load; plus_big.bas covers bare
#define PB_LIB_HIGH
#define PB_PAD1 17000
#define PB_PAD2 12000
#include "lib/plusbig_body.bas"

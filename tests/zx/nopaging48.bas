REM Spectrum 48K: port &7FFD does nothing (no banks to page).
REM MODELS: 48
#include <zxtest.bas>

POKE 49152 + 100, 1
OUT 32765, 17
POKE 49152 + 100, 2
OUT 32765, 16
CHK("no_paging", STR$(PEEK(49152 + 100)), "2")
TEND()

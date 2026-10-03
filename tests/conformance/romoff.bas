REM BARE: skip reads the firmware's captured BC' (FW_BC sysvar); bare boot state is tested by barestate.bas
REM Conformance: both ROMs are off when the program starts.
REM The firmware's BC' (gate-array/ROM state) is captured at entry and
REM trusted by the runtime; if BASIC's upper ROM were still paged in, reads
REM of 0xC000-0xFFFF (PeekScreen, GetBlock, masked sprites) would return ROM
REM bytes. Writes always reach RAM, so write two complementary patterns and
REM read them back: a ROM could not match both. Same for the lower ROM
REM (&0000-&3FFF). The measured BC' at entry is &7F8D on cap32 (RUN") and
REM chips (quickload CALL) alike. Also checks the ROM bits of the captured
REM FW_BC sysvar (&9E33, C' bit 2 lower ROM off, bit 3 upper ROM off).

#include "lib/chk.bas"

DIM s1, s2, l1, l2, o1, o2 AS UBYTE
DIM u1, u2, w1, w2 AS UBYTE

o1 = PEEK(0xC123)
POKE 0xC123, 0xA5
s1 = PEEK(0xC123)
POKE 0xC123, 0x5A
s2 = PEEK(0xC123)
POKE 0xC123, o1
CHK("upper_a5", STR$(s1), "165")
CHK("upper_5a", STR$(s2), "90")

o2 = PEEK(0x0300)
POKE 0x0300, 0xA5
l1 = PEEK(0x0300)
POKE 0x0300, 0x5A
l2 = PEEK(0x0300)
POKE 0x0300, o2
CHK("lower_a5", STR$(l1), "165")
CHK("lower_5a", STR$(l2), "90")

u1 = PEEK(0x9E33) BAND 4
u2 = PEEK(0x9E33) BAND 8
CHK("fwbc_lower_off", STR$(u1), "4")
CHK("fwbc_upper_off", STR$(u2), "8")
PRINT "DONE"

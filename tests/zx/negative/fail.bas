REM Runner self-test: ends cleanly with a FAIL line (exit 0, but the suite must call it a failure)
REM EXPECT-FAIL
#include <zxtest.bas>
CHK("deliberate", "1", "2")
TEND()

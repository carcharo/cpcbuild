REM Runner self-test: never ends -> timeout, exit 2
REM EXPECT-EXIT: 2
REM TIMEOUT: 2
#include <zxtest.bas>
DIM i AS UBYTE
DO
  i = i + 1
LOOP

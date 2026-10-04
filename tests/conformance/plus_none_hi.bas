REM MODELS: 464 664 6128
REM Conformance: as plus_none.bas but the first probe runs with a byte >= &80 at
REM &4000 (the probe needs no write then) and with interrupts off (the state
REM must stay off).
#define PN_BYTE 229
#define PN_DI
#include "lib/plusnone_body.bas"

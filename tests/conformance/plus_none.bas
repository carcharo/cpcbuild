REM MODELS: 464 664 6128
REM Conformance: the cpcplus library on a CPC without ASIC (Phase 7 P2):
REM PlusAvailable() = 0 and every call a no-op with nothing disturbed (RAM at
REM &4000, interrupt state, the clock). First probe with a byte < &80 at &4000
REM (the probe writes it, so it has to put it back) and interrupts on.
#define PN_BYTE 37
#include "lib/plusnone_body.bas"

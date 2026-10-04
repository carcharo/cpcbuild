REM MODELS: plus
REM Conformance: the cpcplus library in a program of about 20 KB (Phase 7 P3): its code and
REM the sprite pictures it copies lie in &4000-&7FFF, where the ASIC register page appears.
REM See lib/plusbig_body.bas. Plus, Caprice32 only.
#define PB_PAD1 17000
#define PB_PAD2 1500
#include "lib/plusbig_body.bas"

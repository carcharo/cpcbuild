REM Screen test: the CPC Plus feature demo (examples/plusdemo.bas) after 40 frames. On
REM the Plus (Caprice32, bare disc run) the picture is the whole demo: sprites, copper
REM bars, the cycling rainbow pen, the split screen scrolled five pixels a frame; the
REM program stops and holds its state at the shot, so the picture is the same every run.
REM On the 464 and 6128 (chips goldens) there is no ASIC and the demo prints "needs a CPC
REM Plus". The demo is bare-mode only (raster interrupts), so the define is here for the
REM firmware-mode runs too.
REM SOURCE: ../../examples/plusdemo.bas
REM ZXBC: -D CPC_BAREMETAL
REM ZXBC: -D SHOT=40

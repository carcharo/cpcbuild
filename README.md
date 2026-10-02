# cpcbuild
## Asset pipeline

Two small Python tools (Python 3 + Pillow) turn art into Boriel BASIC
includes for the cpcbuild library. One PNG pixel is one CPC pixel.

    # sprite sheet -> masked frames: NAME, NAME_W, NAME_H, NAME_FRAMES,
    # NAME_SIZE, plus NAME_pal / NAME_PENS (firmware colours, for SetPalette)
    python3 tools/img2cpc.py --mode 0 --name balls --frame 8x16 --masked balls.png -o balls.bas

    # picture -> de-duplicated 8x8 tiles + a map (NAME, NAME_COUNT, NAME_MAP)
    python3 tools/img2cpc.py --mode 1 --name bg --tiles --dedupe bg.png -o bg.bas

    # Tiled map -> tile numbers for TileMap (NAME, NAME_W, NAME_H)
    python3 tools/tmx2bas.py --layer floor --name level level.tmx -o level.bas

Share one palette between images with `--write-palette F` then
`--palette-file F`; `--spectrum` emits ZX Spectrum bitmap + attribute data
from the same PNG. `tools/build_assets.sh` regenerates every committed
include (see `examples/assets/` and `tests/conformance/assets/`);
`python3 -m unittest discover -s tests/tools` runs the tools' tests. Each
tool's `--help` has the details.

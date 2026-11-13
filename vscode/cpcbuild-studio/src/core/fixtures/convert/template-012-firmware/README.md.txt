# My Game

A CPC Game Studio project. Three things to try:

1. Run **CPC Game Studio: Build and Run** (the status bar shows the target).
2. Switch target with **CPC Game Studio: Select Target** (`cpc464` is the same program on a 464).
3. At the BASIC prompt of a manual emulator session, type `run"MYGAME`.

Targets and packaging are in `cpcbuild.json`; the build puts its output in `build/`.
Set `cpcbuild.library.path` (and `cpcbuild.zxbc.command`) in the settings if "CPC Game Studio: Check Environment" reports something missing.

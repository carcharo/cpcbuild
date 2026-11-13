# My Game

A CPC Game Studio project. Three things to try:

1. Build target `plus-cart` and run the `.cpr` in an emulator set to the Plus model.
2. Build target `plus-dsk` for the disc version (`run"MYGAME`).
3. Compare the two in the build report: the cartridge has no firmware and brings its own font.

Targets and packaging are in `cpcbuild.json`; the build puts its output in `build/`.
Set `cpcbuild.library.path` (and `cpcbuild.zxbc.command`) in the settings if "CPC Game Studio: Check Environment" reports something missing.

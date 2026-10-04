# CPCEC (second Plus emulator)

`fetch_build.sh` downloads CPCEC (César Nicolás-González, **GPLv3**, via the
cpcitor mirror) at a pinned commit and builds it into the git-ignored
`work/` directory. We do not vendor its source or ROMs and apply no patch;
CPCEC stays a separate program that we run as a subprocess. Run a cartridge
with `work/cpcec -m3 FILE.cpr` (`-m3` = 6128 Plus).

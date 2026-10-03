# tools/arkos: the Arkos Tracker music pipeline

Builds `lib/music/akg_cpc.asm` (Amstrad CPC) and `lib/music/akg_zx.asm`
(ZX Spectrum 128K: `PLY_AKG_HARDWARE_SPECTRUM`, AY at &FFFD/&BFFD, 1773400 Hz
period table), the Arkos Tracker 3 AKG player converted
for Boriel's assembler, and holds the song-export helpers' downloads.

| Tool | Version | Used for |
|------|---------|----------|
| Arkos Tracker 3 | 3.7 (release zip) | player source `players/playerAkg/sources/z80/PlayerAkg*.asm`, `SongToAkg`, `SongToSoundEffects` |
| Rasm | 3.3 | assembles the player (and gives the reference binary) |
| Disark | 2.0.0 | binary + symbols -> plain Z80 source |

URLs and SHA-256 sums are in `fetch.sh`.

## Regenerate

    sh tools/arkos/fetch.sh      # downloads into tools/arkos/work/ (gitignored)
    sh tools/arkos/convert.sh    # writes lib/music/akg_cpc.asm and akg_zx.asm

`convert.sh` assembles `PlayerAkg.asm` with Rasm
(`PLY_AKG_HARDWARE_CPC`, `PLY_AKG_MANAGE_SOUND_EFFECTS`, the default full
player configuration, so any song works) at ORG 0x8000 with
`-s -sl -sq` symbols, runs

    disark ref.bin out.asm --symbolFile ref.sym --sourceProfile pasmo \
        --hexPrefix 0x --undocumentedOpcodesToBytes --loadAddress 0x8000 --genOrg

and `postprocess.py` (labels get `:` and their own line, `label equ $+n`
kept as is, `org` and Rasm's wrapper labels dropped, Arkos's identifier
spelling restored, clashing labels like `end` renamed).

**The check:** the converted file, assembled by `zxbasm` at ORG 0x8000,
0x1234 and 0x4000, must be byte-identical to Rasm's binary at the same
ORG (3412 bytes CPC, 3300 bytes Spectrum); `convert.sh` stops if not. The player also survives
zxbc's optimizer unchanged (-O0, -O2, -O4: checked once by assembling
Rasm at the address zxbc placed it and comparing the bytes).

## Songs and effects

    python3 tools/aks2bas.py tune.aks tune.bas --name tune          # SongToAkg
    python3 tools/aks2bas.py --sfx fx.aks fx.bas --name fx          # SongToSoundEffects
    python3 tools/aks2bas.py --sfx --psg spectrum fx.aks fx.bas --name fx   # for the 128K
    python3 tools/aks2bas.py --from-asm src.asm out.bas --name n --prefix n_

Songs (AKG) are identical for CPC and Spectrum (SongToAkg output is byte for
byte the same whatever the .aks's PSG clock: the player has the period
table). Sound-effect banks (AKX) bake software periods from the .aks's
clock, so export them per machine: `--psg cpc` (1000000 Hz) or
`--psg spectrum` (1773400 Hz) rewrites the clock in a temporary copy first
(the Arkos tools have no option for it). The repo's test bank
(`tests/conformance/assets/music/sfx.bas`) is a CPC export from an .asm
source, so on a Spectrum it sounds about 10 semitones low; it is only used
for register checks.
See the header of `tools/aks2bas.py` and `lib/music/music.bas`.

## Notes

* On current macOS the downloaded AT3 tools and Disark **hang forever at
  exec** (kernel-level, unkillable; also under `--help`), sandboxed or
  not. Re-signing a copy ad hoc (`codesign --force --sign - <tool>`, done
  by `fetch.sh`) fixes it; Rasm doesn't need it.
* Rasm has no Linux release binary; `fetch.sh` builds it from the v3.3
  source tarball with `cc` on Linux (not exercised in CI: the committed
  output is what the build uses).
* The test songs under `tests/conformance/assets/music/` come from the
  Arkos Tracker 3 repository's MIT-licensed player test resources
  (`hardware/cpc/playerAkg/sources/resources/`, commit 14d975bd), with the
  notice next to them. The songs bundled with the tracker (`songs/`) have
  no licence and are never used or shipped.

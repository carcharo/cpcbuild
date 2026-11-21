# tools/arkos: the Arkos Tracker music tools

`fetch.sh` downloads the pinned Arkos Tracker 3 command-line tools that `tools/aks2bas.py` and
`tools/build_assets.sh` use to turn songs and sound-effect banks into CPC BASIC includes. CPC Game Studio's
**Download Tools** command downloads the same Arkos Tracker release itself (see `vscode/cpcbuild-studio/tools-manifest.json`).

| Tool | Version | Used for |
|------|---------|----------|
| Arkos Tracker 3 | 3.7 (release zip) | `SongToAkg` and `SongToSoundEffects` (the converters), and the player source `players/playerAkg/sources/z80/PlayerAkg*.asm` |
| Rasm | 3.3 | assembles the player (and gives the reference binary), `convert.sh` only |
| Disark | 2.0.0 | binary + symbols -> plain Z80 source, `convert.sh` only |

URLs and SHA-256 sums are in `fetch.sh`.

## Get the tools

    sh tools/arkos/fetch.sh      # downloads into tools/arkos/work/ (gitignored)

`aks2bas.py` finds the tools in `$AT3_TOOLS`, then `tools/arkos/work/bin`.

## Songs and effects

    python3 tools/aks2bas.py tune.aks tune.bas --name tune          # SongToAkg
    python3 tools/aks2bas.py --sfx fx.aks fx.bas --name fx          # SongToSoundEffects
    python3 tools/aks2bas.py --sfx --psg cpc fx.aks fx.bas --name fx        # clock forced to 1 MHz
    python3 tools/aks2bas.py --from-asm src.asm out.bas --name n --prefix n_

Songs (AKG) do not depend on the .aks's PSG clock (SongToAkg output is byte for
byte the same: the player has the period table). Sound-effect banks (AKX) bake
software periods from the .aks's clock, so `--psg cpc` (1000000 Hz) rewrites the
clock in a temporary copy first (the Arkos tools have no option for it).
See the header of `tools/aks2bas.py` and `lib/music/music.bas` in the cpcbas library.

## The player

The player the library uses, `lib/music/akg_cpc.asm` of the cpcbas repository, is the Arkos Tracker 3.7 AKG player
(CPC, sound effects on, the default full configuration, so any song works). `convert.sh` and `postprocess.py`
here are the record of how it was made: Rasm assembles `PlayerAkg.asm`, Disark turns the binary back into plain Z80
source, `postprocess.py` puts it into the form the 0.1.x assembler accepted, and `convert.sh` then checks that this
assembler gives the same bytes as Rasm at three origins. They write to `lib/music/`, which this repository no longer
has, and they need the 0.1.x compiler checkout for that check, so running them today means checking out the `v0.1.2`
tag of this repository and the 0.1.x compiler fork (see [migrating-from-0.1.md](../../docs/migrating-from-0.1.md)).
`tests/tools/test_aks2bas.py` still tests `postprocess.py`.

## Notes

* On current macOS the downloaded AT3 tools and Disark **hang forever at
  exec** (kernel-level, unkillable; also under `--help`), sandboxed or
  not. Re-signing a copy ad hoc (`codesign --force --sign - <tool>`, done
  by `fetch.sh`) fixes it; Rasm doesn't need it.
* Rasm has no Linux release binary; `fetch.sh` builds it from the v3.3
  source tarball with `cc` on Linux.
* The test songs in the cpcbas repository (`tests/conformance/assets/music/`) come from the
  Arkos Tracker 3 repository's MIT-licensed player test resources
  (`hardware/cpc/playerAkg/sources/resources/`, commit 14d975bd), with the
  notice next to them. The songs bundled with the tracker (`songs/`) have
  no licence and are never used or shipped.

# CPC port notes (`--arch cpc`)

Working notes for the Amstrad CPC backend. The plan is
`../PLAN-boriel-cpc.md`; this file records what Phase -1 (environment)
and Phase 0 (recon) found, and what Phase 1 should start from.

**Paths:** unless stated otherwise, repo paths (`src/…`, `tools/cpc/…`,
`tests/…`, `docs/…`, `mkdocs.yml`) are relative to the compiler fork
`../zxbasic` (branch `cpc-arch`).

Status (2026-10-01): Phase -1 and Phase 0 done. **Phase 1** (§8), **Phase 2** (§9), **Phase 3** (§10) and **Phase 4a** (§11) and **Phase 4b** (§12) done; Phase 4c (§13) library done; next: asset pipeline, then speed-ups (notes.md, next steps).
Phase 1 summary:
`--arch cpc` compiles to a flat binary at &1000, and every ROM or hardware
runtime routine is stubbed or ported. A compiled POKE/FOR/DO-LOOP program runs
in Caprice32. Committed on `cpc-arch` (e7370b55..024b9b0e).

> The fork's upstream docs page should eventually be
> `docs/architectures/amstrad_cpc.md` (currently a stub of hardware links).

---

## 1. Environment (Phase -1)

| Item | Version / path | Notes |
|---|---|---|
| macOS | Darwin 25.1.0, arm64 | Xcode + CLT present |
| Python | 3.14.7 (pyenv), `/Users/barry/.pyenv/versions/3.14.7` | `pyproject.toml` requires `>=3.14` |
| Poetry | 2.5.1, `~/.local/bin/poetry` (pipx) | Homebrew's `poetry` crashed: its `python@3.14` bottle's `pyexpat` needs an expat ≥2.7 symbol (`_XML_SetAllocTrackerActivationThreshold`) missing from the system `libexpat`. Uninstalled and reinstalled via `pipx install --python ~/.pyenv/versions/3.14.7/bin/python3 poetry`. Put `~/.local/bin` on `PATH`. |
| venv | `~/Library/Caches/pypoetry/virtualenvs/zxbasic-ImTsDQxo-py3.14` | 41 packages |
| Test suite | `poetry run pytest -x -q`: **2007 passed** in 57.8 s (pytest 9.0.3, xdist 3.8.0, cov 7.1.0) | Baseline is green before any changes |
| pre-commit | 4.6.0 (via poetry) | not run yet |
| zxbc | `poetry run zxbc --version` → `zxbc 1.19.0`; `--arch` choices `zx48k, zxnext, zx81sd` | |
| Caprice32 | `../caprice32`, master `6c12c4c9` (2026-09-04), reports `v4.6.0-6c12c4c…` | Built with `make ARCH=macos APP_PATH="$PWD" -j$(sysctl -n hw.ncpu)`. Brew deps (already present): sdl2 2.32.10, freetype 2.14.3, libpng 1.6.58, zlib 1.3.2, pkg-config 0.29.2. Still SDL2. ROMs in `caprice32/rom/` (464/664/6128, AMSDOS, MF2, Plus `system.cpr`); default model = 6128. |
| coreutils | 9.12 (brew) | Only for GNU `timeout`/`gtimeout`; macOS has none. Always wrap emulator runs in it. |
| z80dasm | brew | Used to disassemble the 6128 OS ROM during recon |
| iDSK | no Homebrew formula (`brew search idsk` only finds `libdsk`) | Not needed: we have `tools/cpc/mkdsk.py` |
| Retro Virtual Machine | `/Applications/Retro Virtual Machine 2.app`, `CFBundleShortVersionString` 2.0.0, build 6783 (2019-07-09); `--help` banner says **v2.0 BETA-1 r7** | CLI: `-b=cpc6128` boot, `-l=0x1000 file.bin` load, `-j=0x1000` jump (after ~100 frames), `-i disk.dsk` insert, `-c='run"prog\n'` type, `-w` warp. No headless mode and no dump flag. `-boot` not actually launched (it's a Cocoa app, so it's assumed to open a window). |

### Verified run loop

`tools/cpc/run.sh [--shot] prog.bas|prog.bin` compiles (once `--arch cpc`
exists) or copies a `.bin`, wraps it with `mkdsk.py` into `build/<stem>.dsk`,
and launches `${CAP32:-../caprice32/cap32} build/x.dsk -a 'run"x'`. `--shot` runs
it headless and writes a PNG to `build/shots/`:

```sh
SDL_VIDEODRIVER=dummy timeout 30 ../caprice32/cap32 \
    -O file.sdump_dir=build/shots \
    -a 'run"prog' -a CAP32_DELAY -a CAP32_DELAY -a CAP32_SCRNSHOT -a CAP32_EXIT \
    build/prog.dsk
```

Verified end to end on 2026-09-27: a hand-written 25-byte `HELLO CPC` program at
&1000 (TXT_OUTPUT loop, then `jr $`) was assembled with `zxbasm`, packed by
`mkdsk.py`, `RUN"` in headless Caprice32, and the screenshot shows `HELLO CPC`.
`SDL_VIDEODRIVER=dummy` gives byte-identical screenshots to a windowed run.
Caprice32 autocmd tokens: `CAP32_SCRNSHOT`, `CAP32_EXIT`, `CAP32_DELAY`,
`CAP32_WAITBREAK` (hangs unless a breakpoint fires), `CAP32_SNAPSHOT`,
`CAP32_LD_SNAP`, `CAP32_RESET`, `CAP32_PASTE`, … (`src/argparse.cpp:66-84`).
`-i file -o 0x1000` injects a binary into RAM.

### `tools/cpc/mkdsk.py`

Stdlib-only Python. It writes an AMSDOS header (type 2, load/exec/length,
24-bit real length, checksum of bytes 0–66 at &43) and a standard
`MV - CPCEMU` `.dsk` in AMSDOS **Data** format: 40 tracks, 1 side, 9×512-byte
sectors with IDs &C1–&C9 stored skewed (C1,C6,C2,C7,…), 1 KB blocks, 64
directory entries, &E5 filler, multi-extent files. Checked with an independent
reader (round trips at 100 B, 40 KB/3 extents, two files, disk-full and
directory-full errors), with AMSDOS `cat` in the emulator (`HELLO .BIN 1K`,
`177K free`), and by `LOAD"hello",&4000` reading back correct bytes.
cpcwiki.eu blocks automated fetches (Cloudflare), so formats were checked
against `cpctech.cpcwiki.de` mirrors and web.archive.org copies.

### Loading gotchas found while testing (these affect Phase 2)

- **`RUN"prog` does not return.** A binary started by `RUN"` goes through
  MC_BOOT_PROGRAM / MC_START_PROGRAM (&BD13/&BD16). These re-initialise the
  firmware, reset the stack and are documented as "not returned from". A
  `RET` from such a program resets the machine. This was reproduced: even a
  1-byte `RET` resets. BASIC is gone once `RUN"` starts a binary.
- **`LOAD"prog":CALL &1000` doesn't work from BASIC.** Boot HIMEM on the 6128
  with AMSDOS is **&A67B** (measured with `PRINT HEX$(HIMEM)`). Loading a binary
  into &1000 gives `Memory full` unless HIMEM is below it, and `MEMORY &FFF`
  leaves too little room for AMSDOS's file buffer, so the `LOAD` still fails.
  `MEMORY &3FFF:LOAD"x",&4000` and `MEMORY &1FFF:LOAD"x",&2000` both work.
- Consequence: the plan's "bootstrap … return cleanly to BASIC on END" is
  not achievable with ORG &1000 plus `RUN"`. Options for END are listed in §6.5.

---

## 2. How an architecture is plugged in (Phase 0, step 2)

**Registration.** `src/arch/__init__.py:16-25`:
`AVAILABLE_ARCHITECTURES = __all__ = ("zx48k", "zxnext", "zx81sd")`, and
`set_target_arch(name)` asserts membership and does
`importlib.import_module(f".{name}", "src.arch")`. The CLI option is
`src/zxbc/args_parser.py:186-192` (`--arch`, default = first entry), validated
in `src/zxbc/args_config.py:62-65`, and it sets `OPTIONS.architecture`.
`src/zxbc/zxbc.py:83-92` initialises the default backend, parses options, then
calls `set_target_arch()` and re-runs `Backend().init()`. `zxbpp` has its own
independent `--arch` parser (`src/zxbpp/zxbpp.py:867-889`).

**Per-arch package contract** (`src/arch/<name>/__init__.py`): set
`src.api.global_.{PARAM_ALIGN, BOUND_TYPE, SIZE_TYPE, PTR_TYPE, STR_INDEX_TYPE,
MIN_STRSLICE_IDX, MAX_STRSLICE_IDX}`; export `FunctionTranslator, Translator,
VarTranslator, beep, optimizer` (all three archs re-export the generic ones from
`src.arch.z80`); and provide a `backend` subpackage with `Backend` (a subclass of
`src.arch.interface.BackendInterface`: `init`, `emit_prologue`, `emit_epilogue`,
`emit`) plus `HI16, LO16, INITS, MEMINITS, REQUIRES, TMP_COUNTER, TMP_STORAGES,
Float`.

**zx48k, zxnext and zx81sd are siblings.** Each subclasses
`src.arch.z80.backend.Backend` directly; zx81sd does not inherit from zx48k.
zx48k's backend is a 2-line override. The generic org/heap/prologue logic is in
`src/arch/z80/backend/main.py:613-660` (default org 32768, heap 4768 bytes
reserved inline after the code). zx81sd (`src/arch/zx81sd/backend/main.py:82-196`)
overrides `init` (org, heap address/size set directly, bypassing
`ADD_IF_NOT_DEFINED` because `super().init()` has already registered defaults),
`emit_prologue` (RST table, stage-2 boot, `#init` calls) and `emit_epilogue`.
**For cpc**, the zx81sd backend is the template: subclass the z80 backend,
org &1000, own prologue.

**The Python code generator contains no ROM addresses.** There are no Spectrum
numeric constants in `src/arch/z80` or `src/arch/zx48k`. `CHECK_BREAK` is
generated as a symbolic call (`src/zxbc/zxbparser.py:514-524`, only with
`--enable-break`). Every ROM and sysvar dependency lives in the runtime `.asm`
files.

**Include resolution (the key mechanism).** `src/zxbpp/zxbpp.py:153-168`
`set_include_path()` builds `INCLUDE_MAP[arch] = [<arch>/stdlib, <arch>/runtime]`
for every arch, then:

```python
if "zx81sd" in INCLUDE_MAP:
    zx48k_pwd = get_include_path("zx48k")
    INCLUDE_MAP["zx81sd"].extend([zx48k/stdlib, zx48k/runtime])
```

So zx81sd searches its own directories first and falls back to zx48k. That's
why it has only 35 runtime files against zx48k's 177. The fallback is a
hard-coded special case for the string `"zx81sd"`. There is a second way to
inherit: zxnext's runtime is almost entirely one-line stubs,
`#include once [arch:zx48k] <file>`.
**For cpc**: add `"cpc"` to the same fallback (a generic
`ARCH_INHERITS = {"zx81sd": "zx48k", "cpc": "zx48k"}` would be a tidier upstream
change) and override only what's needed. The zx48k tree itself is never
touched, which matches the standing rule.

**Tests.** `tests/functional/test.py:28,226-246` takes the arch from the test
directory name (`tests/functional/arch/<arch>/`) and passes `--arch`. There are
golden `.bas`/`.asm` pairs for zx48k, zxnext and zx81sd (zx81sd's arrived in
PR #1103, `5b5ff22f`). cpc snapshot tests go in `tests/functional/arch/cpc/`.

**Output formats.** `FileType` in `src/zxbc/args_parser.py:20-27` is
`asm, bin, ir, sna, tap, tzx, z80`, all global. zx81sd added no format; it emits
`.bin` and packages with external tools (`src/arch/zx81sd/tools/`). cpc does the
same: `.bin`, then `tools/cpc/mkdsk.py`.

## 3. PR #1090 (zx81sd) summary

Merge `97cf3f42`, 268 files, +21229/−5186. Most of that is CRLF→LF
normalisation from a bundled "lint: format code" commit `6add187e`
(`spectranet.inc`, peephole `.opt` files, `poetry.lock` and so on are identical
apart from line endings). The real changes to core files are just two:
`src/arch/__init__.py` (arch list) and `src/zxbpp/zxbpp.py` (the include
fallback, +6 lines). Everything else is under the arch's own namespace:
`src/arch/zx81sd/{__init__.py, backend/, README.md, doc/*.md, tools/}`,
`src/lib/arch/zx81sd/{runtime,stdlib}/`, `examples/sd81/`, and later
`tests/functional/arch/zx81sd/`. About 40 follow-up commits (keyboard, beeper,
FP calculator `9c2d154b`, AY PLAY, SD LOAD/SAVE, block-7 banking `1af6a113`,
the exit-to-BASIC write-up `d670b641`, tests `5b5ff22f`) never touch core files
again. That's the shape to copy for a reviewable upstream PR.

zx81sd sysvars (`src/lib/arch/zx81sd/runtime/sysvars.asm`): `SYSVAR_BASE EQU
$8000`, with CHARS, UDG, COORDS, FLAGS2, ECHO_E, DFCC, DFCCL, S_POSN, ATTR_P,
MASK_P, ATTR_T, P_FLAG, MEM0, TV_FLAG, ERR_NR, FRAMES, RANDOM_SEED_LOW,
SCREEN_ADDR and SCREEN_ATTR_ADDR at offsets $00–$21. The FP engine block
(FP_STKBOT/STKEND/BREG/MEM, 60-byte calc stack, 30-byte mem area) must stay
contiguous. After it come `ARRAY_SCRATCH`/`CHR_SCRATCH`/`DIVF_SCRATCH`, which
replace MEMBOT 23698, DEST 23629 and ERR_SP 23613. Initialisation is an
`#init` routine in `bootstrap.asm`.

---

## 4. Runtime classification (`src/lib/arch/zx48k/runtime/`, 177 files)

The full per-file table is in the Appendix. Method: two independent sweeps
(sub-directories, then top level). Each grepped for `rst`, `call`/`jp` to
absolute addresses, sysvar addresses and names (from `sysvars.asm`), ports and
`#include`, then read every file that wasn't trivially pure and followed
`#include once` chains. I spot-checked the results and re-derived the
alternate-register and IY column mechanically.

Classes (as in the plan): **PURE** = no ROM, sysvars or hardware. **ROM** = ROM
calls, `rst`, FP-calculator bytecode, or fixed Spectrum sysvar addresses.
**HW** = Spectrum screen, attributes, ports or pixel addressing.

| CPC action | Files | Meaning |
|---|---|---|
| inherit | 95 | Pure (75), pure with only pure dependencies (17), or touches ROM only via `error.asm` (3). Resolved from zx48k through the include fallback, unchanged. |
| inherit once a dependency is ported | 12 | Pure itself but includes a HW/ROM file: the `print*` number printers and `circle` (via `print.asm`, `attr.asm`, `plot.asm`…), `in_screen` (via `sposn`/`attr`). |
| copy with `rst 28h` → `rst 30h` | 25 | Float arithmetic, compare, boolean and `math/*` files. Each is just `rst 28h` + calculator bytecode (addf, subf, mulf, modf, negf, cmp/{eq,ne,lt,le,gt,ge}f, bool/{and,or,xor,not}f, math/{sin,cos,tan,asin,acos,atan,exp,logn,pow,sqrt}). See §5 Q1 for why they can't be inherited unchanged. |
| rewrite | 45 | 30 ROM + 15 HW, listed below. |

**Rewrite list (45).**
- *Text/attributes:* `print.asm` (direct VRAM in the Spectrum interleaved
  layout, `inc h`; CHARS/UDG; `bit n,(iy+$47)` flag tests, so it assumes IY
  points at Spectrum sysvars; calls ROM PO_GR_1 &0B38 and SCROLL &0DFE),
  `printf.asm`, `print_eol_attr` (inherit after print), `cls`, `attr`,
  `copy_attr`, `set_pixel_addr_attr`, `sposn`, `ink`, `paper`, `bright`,
  `flash`, `inverse`, `over`, `bold`, `italic`, `border` (ROM &229B), `chr`
  (TMP = 23629).
- *Graphics:* `plot`, `draw` (PIXEL_ADDR &22AC), `draw3` (literally ripped from
  the ROM: calculator bytecode plus CD_PRMS1 &247D, STACK-A &2D28, STACK_TO_BC
  &2307), `SP/*` (7 files: Spectrum pixel/char address stepping).
- *Float glue:* `stackf.asm` (STK-STORE &2AB6 / STK-FETCH &2BF1), `str.asm`
  and `printf.asm` (STR$ via calculator; RECLAIM2 &19E8, STK_END &5C65),
  `val.asm` (calculator VAL, STK-STO-$ &2AB2, SET-MIN &16B0, RECLAIM1 6629
  decimal = &19E5, STKBOT/ERR_SP/CH_ADD), `arith/divf.asm` (points ERR_SP
  23613 at its own trap, TMP = 23629).
- *Scratch in sysvar RAM:* `array/array.asm` and `arith/modf16.asm` (MEMBOT
  23698 used as scratch, unconditionally). On the CPC, 23698 (&5C92) is inside
  program RAM, so these would silently corrupt code or heap. zx81sd hit exactly
  this bug.
- *System:* `error.asm` (`rst 8`, ERR_NR 23610), `break.asm` (ROM TS_BRK 8020 =
  &1F54, PPC 23621), `pause.asm` (PAUSE_1 &1F3D), `random.asm` (FRAMES 23672 /
  seed), `sysvars.asm`, `usr_str.asm`, `load.asm` (LD_BYTES &0556/&0562,
  TMP_FLAG 23655), `save.asm` (CHAN_OPEN &1601, PO_MSG &0C0A, WAIT_KEY &15D4,
  SA_BYTES &04C6, ROM_SAVE &0970, port &FE, BORDCR 23624, `(iy+2)`).
- *I/O:* `io/keyboard/inkey.asm` (KEY_SCAN &028E, KEY_TEST &031E, KEY_CODE
  &0333), `io/sound/beep.asm` (&03F8), `io/sound/beeper.asm` (&03B5).
- `spectranet.inc`: Spectranet peripheral header, not included by default;
  leave it out of cpc.

Files that touch sysvars only **by name** through `sysvars.asm` would be fixed
just by a cpc `sysvars.asm` that relocates the names. Files with their own local
`EQU 23xxx` must be overridden. zx81sd overrides 22 of the 45 (listed in the
Appendix), which gives worked examples for most of them.

---

## 5. Open questions

### Q1. Does the float runtime need the Spectrum ROM? What did zx81sd do?

**Yes.** All float arithmetic, comparison, boolean and transcendental routines
are `rst 28h` followed by ROM calculator bytecode. There is no software float
maths in the zx48k runtime at all. `stackf`, `str`, `printf` and `val` also call
fixed ROM addresses.

**zx81sd** added `src/lib/arch/zx81sd/runtime/fp_calc.asm` (1996 lines, commit
`9c2d154b`). It is a re-implementation of the Spectrum ROM `CALCULATE` engine,
built from a commented ROM disassembly, using the same 5-byte float format and
the ROM's `Lxxxx` labels. It is always included from `bootstrap.asm`. Its
backend puts `jp .core.FP_CALC_ENTRY` at &0028, so every zx48k `rst 28h` file
works unchanged. zx81sd rewrote `stackf.asm` (97 lines, relocatable), `str.asm`
and `printf.asm` (via a new `fp_tostr.asm`: sign, integer and up to 5 decimals,
**no exponent notation**) and `val.asm` (a single numeric literal only;
`VAL("2+2")` doesn't work). Total: about 2700 lines, paid by every program. The
file carries only the repo-wide AGPL header, even though it derives from a ROM
disassembly. It has been accepted upstream, but its provenance is worth noting.

**What the CPC changes.** &0028 is the CPC firmware's **RST 5 FIRM JUMP**, and
48 of the &BB00 jumpblock entries are `RST 5` (the other 191 are RST 1),
confirmed from the 6128 OS ROM's jumpblock-builder table. It can't be
repointed. **RST 6 (&0030–&0037) is the one vector the Firmware Guide reserves
for the user.** Recommended for Phase 3:
1. Reuse zx81sd's `fp_calc.asm`, `fp_tostr.asm`, `stackf.asm`, `str.asm`,
   `val.asm` and `printf.asm` (copy them into the cpc tree).
2. The cpc prologue writes `jp FP_CALC_ENTRY` at &0030. RAM under the lower ROM
   is writable, and user code runs with the lower ROM paged out.
3. Copy the 25 `rst 28h`-only files with `rst 30h` substituted (same 1-byte
   opcode, so code size is identical). A small generator script would keep
   them in sync with zx48k.
4. fp_calc contains **84 `exx`**, so it needs the interrupt handling in §6.1.

### Q2. What is the arch preprocessor macro for `#ifdef`?

**There isn't one.** `set_option_defines()` (`src/zxbc/args_config.py:177-188`)
only defines `__MEMORY_CHECK__`, `__CHECK_ARRAY_BOUNDARY__`, `__ENABLE_BREAK__`
and `__OPT_STRATEGY__`. Nothing is derived from `--arch`, and `-N/--zxnext`
only sets `OPTIONS.zxnext` for opcode selection. `__ZX81SD__` exists only as a
convention: zx81sd's build scripts pass `-D __ZX81SD__`
(`src/arch/zx81sd/tools/build_sd81.py`). Options:
(a) have `run.sh`/cpcbuild always pass `-D __CPC__` (no core change); or
(b) a 2-line core change in `set_option_defines()`:
`OPTIONS.__DEFINES[f"__{OPTIONS.architecture.upper()}__"] = ""`, which gives
every arch `__ZX48K__`, `__ZXNEXT__`, `__ZX81SD__` and `__CPC__`.
**Decided 2026-09-27: (b).** Verified: defines from `set_option_defines()`
already reach the runtime asm (e.g. `#ifdef __ENABLE_BREAK__` in load.asm);
`#error` exists, for tests; `-D` of the same name doesn't clash; a
source-level `#define __ZXNEXT__` would get warning W510. It lands as its own
commit at the start of Phase 1 (with per-arch tests), also in standalone
`zxbpp`, and goes upstream as a separate small PR. Fallback: tooling passes
`-D __CPC__`.

### Q3. Which emulator can run headless for CI?

| Emulator | Headless | Load | Stepping / dumps | Licence | Verdict |
|---|---|---|---|---|---|
| **Caprice32** (built) | Yes. `SDL_VIDEODRIVER=dummy` verified locally; upstream CI runs `make e2e_test` on stock `ubuntu-latest` | `.dsk` + `-a` autocmd, `-i/-o` inject, snapshots | Screenshot and exit tokens; asserts via virtual-printer output (`test/integrated/dsk/test.sh`); no RAM-dump token | GPL | **Use now** for scripted runs and first CI |
| **floooh/chips** `systems/cpc.h` | Yes (header-only C, no display dependency) | `cpc_insert_disc()` (.dsk, uPD765), `cpc_quickload()` (.sna/AMSDOS .bin) | `cpc_exec(us)` per frame; direct `cpc.fb[]` and `cpc.ram[8][0x4000]` | MIT; ROMs ship in chips-test `examples/roms/` under Amstrad's emulator-redistribution permission | **Best for the Phase 5a harness** (framebuffer/RAM assertions) |
| MAME `cpc6128` | Yes (`-video none`, Lua `-autoboot_script`) | softlist/media + Lua | Lua memory/screen access | MAME licence | Capable but heavy |
| ZEsarUX | Yes (`--vo null`, ZRCP on TCP 10000) | ZRCP | ZRCP | GPL | Project itself calls CPC emulation "experimental" — avoid |
| RVM 2.0 | No (Cocoa GUI, no dump flag) | `-l`/`-j`/`-i`/`-c` | none | freeware | Accuracy checks by eye only |

### Q4. Does the Play library assume 128K AY ports in more than one place?

**No, just one.** Both copies of `play.bas` send every AY write (8 call sites
in 6 `SetChip*` subs, zx48k lines 349–380) through one macro,
`#define _PLAY_WRITE_TO_REGISTER(register, value) out $fffd, (register) : out
$bffd, (value)` (`src/lib/arch/zx48k/stdlib/play.bas:177`). zx81sd's copy
changes only four things: that macro (ZonX ports `$CF`/`$0F`, line 157), the
`_Play_NoteDividers` table (1.625 MHz AY clock), `CpuCyclesPerSecond`
(3250000), and no final `ei`. No other runtime or stdlib file writes the AY;
beep/beeper are ULA and ROM.
**For cpc**: the same pattern applies, but three things differ. (1) The write
is a PPI sequence (see Q5), about 6 OUTs with B changing, so make it an asm
`AY_WRITE` routine rather than a one-line BASIC macro. (2) The CPC AY clock is
**1 MHz**, so regenerate the divider table. (3) `CpuCyclesPerSecond` becomes
4000000; CPC wait states make the effective rate lower, so calibrate the tempo.
Alternatively the firmware's **MC_SOUND_REGISTER &BD34** (A = register,
C = value) is itself an AY write primitive. Using it is simpler and
firmware-safe, at some speed cost.

### Q5. Which CPCtelera routines can be lifted, and what calling convention do they use?

CPCtelera `development` @ `662fc885` (2025-11-12), LGPL-3.0-or-later per file.
Each routine is `cpct_X.asm` (body) plus `_asmbindings.s` (`cpct_X_asm::`,
register entry) and `_cbindings.s` (`_cpct_X::`, stack to registers). The C
conventions are **`__z88dk_callee`** (multi-argument) and **`__z88dk_fastcall`**
(one argument); `__sdcccall` never appears. Wrap the **`_asm` register entry
points**, because they have no SDCC runtime dependency.

| Routine | `_asm` inputs | Clobbers | Liftable? | Notes |
|---|---|---|---|---|
| `cpct_getScreenPtr` | DE=screen start, C=x byte, B=y; → HL | AF,BC,DE,HL | Trivial | |
| `cpct_drawSprite` / `…Masked` | HL=sprite, DE=dest, C=w bytes, B=h | AF,BC,DE,HL | Yes | Self-modifying; uses `jr__0` macro (`.dw 0x0018`). Keep as one resident routine, not inlined per SUB. |
| `cpct_drawSpriteMaskedAlignedTable` | BC=sprite, DE=dest, IXL=w, IXH=h, HL=256-aligned mask table | +IX | With care | Uses IX as data. The Boriel frame pointer is IX, so read `(ix+n)` arguments first and save/restore IX. Needs a page-aligned table. |
| `cpct_drawTileAligned{2x4,2x8,4x4,4x8}[_f]` | HL=tile, DE=dest | AF,BC,DE,HL | Yes | Unrolled LDI; check each size |
| `cpct_etm_*` tilemaps | varies | varies | More work | Chain of calls (TileBox → TileRow → drawTileAligned2x4_f) plus module state set by `cpct_etm_set*`; port as a unit |
| `cpct_scanKeyboard[_f]`, `cpct_isKeyPressed` (HL = key id), `cpct_isAnyKeyPressed` | — | AF,BC,DE,HL | Yes | Drives the PPI directly under `di`/`ei`; 10-byte global status buffer; uses `OUT (C),0` |
| `cpct_waitVSYNC` | — | AF,BC | Yes | Read-only PPI port B bit 0; firmware-safe |
| `cpct_setVideoMode` (C), `cpct_setPalette` (HL, DE), `cpct_setPALColour` (L = pen, H = hw colour; `setBorder` = pen 16 macro) | | | Code yes, design no | Direct gate-array writes; docs say **firmware must be disabled** or it will undo them. In firmware-first v1 use SCR_SET_MODE / SCR_SET_INK / SCR_SET_BORDER instead. |
| `cpct_disableFirmware` / `cpct_reenableFirmware` | — / HL | | Phase 6 only | Replaces &0038 with `EI:RET`, which starves all firmware services |

The CPCtelera AY write (Arkos player `PLY_SendRegisters`) goes through PPI
port A (&F4xx) for the register number and data, and port C (&F6xx) with &C0
(select register), &80 (write) and &00 (inactive). The idle step uses
`OUT (C),0`. The player itself is a whole engine, not a leaf routine.

Porting notes: sdasz80 syntax (`#imm`, `.globl`, `::`, `.include /x.asm/`,
`.dw/.db`) converts mechanically to zxbasm. **zxbasm rejects `out (c),0`**
(checked), so emit `defb $ED,$71`. Boriel STDCALL subs see arguments at
`(ix+5)`, `(ix+7)`, … (the pattern in `stdlib/putchars.bas`), and FASTCALL
puts the first argument in A/HL/DEHL. Write a register shim per routine that
`CALL`s the resident `_asm` body.

Licence (not legal advice): zxbasic is AGPL-3.0, but `src/lib` already mixes
per-file MIT and BSD, including vendored third-party code (`spectranet.inc`,
MIT, Dylan Smith). LGPL-3.0 code can be combined into a GPL-family work.
Keep CPCtelera's headers verbatim, add an attribution line with the upstream
URL and commit, and ship the LGPL text alongside. Consider asking the
CPCtelera author (ronaldo) before the upstream PR.

### Q6. Is em00k open to CPC formats in NextBuild Studio?

Deferred until the Phase 5c demo exists (per plan).

---

## 6. Findings the plan doesn't yet account for

### 6.1 Alternate registers vs the firmware — **highest risk**

**What the firmware needs** (from the 6128/464 OS ROM disassembly, plus
measurement):
- **Every jumpblock call** goes through RST 1 LOW JUMP (ROM &0413, RAM &B982).
  It runs `di; exx`, builds the new ROM configuration from **C'** and does
  `out (c),c` with **B' = &7F** (gate array), then restores it the same way
  on return. It also corrupts DE'/HL'. (The other 48 entries go through RST 5,
  FIRM JUMP.)
- **Every interrupt** (300 Hz, &0038 → `JP &B941` on the 6128, `JP &B939` on
  the 464) runs `ex af,af'` and branches on **AF' carry**, then does `exx`
  and `out (c),c` with B'/C'.
- Measured at entry after `RUN"`: **BC' = &7F8D** (port &7F, mode 1, both ROMs
  off).

So BC' has to hold the firmware's value at *every* firmware call and every
interrupt, and AF' carry has to be clear at every interrupt. DE' and HL' are
scratch, since the firmware corrupts them itself.

**What Boriel does.** zx48k runtime files use `exx` in 27 files and
`ex af,af'` in 24. **The code generator emits them too**:
- every SUB/FUNCTION exit with up to 11 bytes of parameters
  (`src/arch/z80/backend/generic.py:504-520`: `exx; pop hl; pop bc…;
  ex (sp),hl; exx; ret`) — this *pops parameter bytes into BC'*;
- 32-bit and fixed-point indirect pushes (`_32bit.py:128-158`,
  `_f16.py:136-166`);
- float indirect pushes (`_float.py:101-114`);
- `_exchg`.

Unprotected, a program crashes on the first firmware call after any SUB with
parameters. Separately, an interrupt landing inside any `exx` window crashes it
at random. zx81sd never met this because it runs with interrupts off and has
no firmware. The Spectrum ROM doesn't care about the alternate registers.

**Rejected:** DI/EI brackets per file. That means about 30 runtime copies plus
overrides of Python emitters in the shared z80 backend, and every future
upstream change that adds an `exx` becomes an intermittent crash. It can't be
made robust.

**Recommended (pending approval): give the firmware its registers at the
boundary, in one place.**
1. **Firmware gate (Phase 2).** Every firmware call made by the cpc runtime
   (and, by documented rule, by user `asm`) goes through one gate:
   `exx; ld bc,(FW_BC); exx`, call the entry, then `exx; ld (FW_BC),bc; exx`.
   The second half captures mode/ROM changes. `FW_BC` is set once at bootstrap
   from the live BC'. There's a variant that also saves IX for CAS_\*/AMSDOS
   calls, which corrupt IX (the Boriel frame pointer). Cost is about 50
   T-states per call.
2. **Interrupt policy, in two stages behind the same gate API:**
   - *Phase 2–3: interrupts only inside the firmware.* Compiled code runs
     `di`; the gate does `ei` before the call and `di` after. This is provably
     safe and trivial. Firmware timers, sound queue and key scanning advance
     only during firmware calls. PAUSE/WaitVsync wait inside
     MC_WAIT_FLYBACK, so a typical `WaitVsync`-per-frame loop still gets its
     frame-flyback ticks. Long compute loops starve them, which is acceptable
     for text-mode BASIC.
   - *Before Phase 4d/5b (music): own IM1 front-end.* The cpc runtime puts
     `jp CPC_ISR` at RAM &0038. That address is only seen while our code
     runs, because the lower ROM is paged out then; inside ROM firmware the
     original handler runs directly. If the gate's `IN_FW` flag is set, jump
     straight to the original handler (target read from &0039 at boot, so
     464 and 6128 both work). Otherwise push both register banks, load
     `FW_BC` and a clear AF' carry into the alternate bank, call the original
     handler, capture BC' back into `FW_BC`, restore both banks, then
     `ei; ret`. The program then runs with interrupts on at about 2 % CPU.
     Firmware callbacks (KL_NEW_FRAME_FLY music, events) go through a
     trampoline that saves the alternate bank, runs the user routine with
     `di`, and restores it.
   - Neither stage touches inherited zx48k runtime files or the shared z80
     backend. Stage 2 wants a stress test: an `exx`-heavy loop plus firmware
     calls plus frame-fly events, running for minutes.
3. The zx81sd `fp_calc.asm` (84 `exx`) is then safe unchanged, as are all
   29 inherited files that use the alternate registers.

### 6.2 Memory map

Facts (measured in Caprice32, 6128 with AMSDOS, program started by `RUN"`):
- Boot HIMEM is **&A67B** with the disc ROM (&AB7F reported for a 464 without
  disc). This is the old "&9FFF" limit corrected.
- **SP at entry = &BFFA**, in the firmware's own small stack area. The
  program must set its own stack.
- **AMSDOS is not initialised after `RUN"`.** `CAS_CATALOG` answers
  "Press PLAY", meaning the cassette manager is active. Disc LOAD/SAVE need the
  bootstrap to call KL_ROM_WALK (&BCCB) or KL_INIT_BACK. It can be an `#init`
  pulled in only by the cpc `load.asm`/`save.asm`. This re-reserves AMSDOS
  workspace below &B0FF, which is why &A67B stays the fixed program top.
- **Central-32K rule.** During firmware calls the lower ROM (&0000–&3FFF), and
  for some calls the upper ROM (&C000–&FFFF), is paged in for *reads*. So the
  **stack**, and **anything the firmware reads through a pointer**, must be in
  &4000–&BFFF. The Firmware Guide calls this out for M_TABLE matrix tables,
  event blocks, sound blocks, CAS buffers and filenames. Code and constant data
  below &4000 are fine, but the runtime must copy pointer arguments that come
  from there (e.g. a literal filename for LOAD) into a bounce buffer first.
- Spectrum sysvar addresses 23552–23733 (&5C00–&5CB5) are ordinary program RAM
  here, so any inherited file with a local `EQU 23xxx` corrupts the program
  (see the §4 rewrite list).
- With no `heap_address`, the z80 backend emits the heap as `DEFS heap_size`
  inside the binary (`src/arch/z80/backend/main.py:640-651`): 4.6 KB of zeros
  loaded from disc. Setting `heap_address` gives an `EQU` instead.

**Recommended layout (pending approval).** Constants live in
`src/lib/arch/cpc/runtime/arch_config.asm` and the cpc backend, so nothing is
hard-wired:

| Range | Use |
|---|---|
| &0000–&003F | Firmware restarts. The cpc runtime writes only &0030 (RST 6 → `jp FP_CALC_ENTRY`) and, later, &0038 (IM1 front-end, §6.1). |
| &0040–&0FFF | Unused (4 KB) — keep ORG &1000 per the standing decision; revisit if space gets tight |
| &1000 → up | Code + constant data (the `.bin`); may run past &4000 |
| … → &9DFF | **Heap**: fixed `heap_address = &9E00 − heap_size` (default 4768 → &8B60), so it's not in the `.bin`; top-aligned so it stays in central 32K. Code must end below it — the backend emits an assembly-time check |
| &9E00–&A1FF | **Private runtime block** (1 KB): relocated sysvars, FP calculator stack/mem, `FW_BC`/`IN_FW`/ISR save area, firmware bounce buffer, event blocks, UDG matrix table (21×8 = 168 B for CHR$ 144–164). Grow downward if Phase 4b adopts a full 224-char font (+1.75 KB) |
| &A200–&A5FF | **Stack**, 1 KB; bootstrap sets SP = &A600 |
| &A600–&A67B | Slack |
| &A67C–&B0FF | AMSDOS workspace once initialised; not ours |
| &B100–&BFFF | Firmware variables, jumpblocks, firmware stack |
| &C000–&FFFF | Screen |

With the default heap that leaves about 30.8 KB (&1000–&8B5F) for code and data.

### 6.3 Firmware register conventions

- CPC firmware has no fixed IY rule (unlike the Spectrum's IY = &5C3A). IY is
  a per-ROM workspace pointer, and only the ROM-switching RSTs and KL_FAR_PCHL
  corrupt it. Ordinary TXT/GRA/SCR/KM/SOUND entries list only AF/BC/DE/HL as
  corrupt. **CAS_\*/AMSDOS calls corrupt IX**, which is the Boriel frame
  pointer, so LOAD/SAVE wrappers must save IX.
- `print.asm`'s `(iy+$47)` and `save.asm`'s `(iy+2)` flag tests have to go
  (they're in the rewrite list anyway), or IY gets pointed at the relocated
  sysvar block.
- MC_WAIT_FLYBACK preserves all registers.

### 6.4 Firmware entry points (verified)

Every address in the plan is correct. Each was checked by address and by
jumpblock index (&BB00 + 3·index) against the 6128 OS ROM's own jumpblock
table and Richard Lloyd's disassembly. KM_TEST_KEY key numbers are
line × 8 + bit.

| Entry | Addr | Entry regs | Exit (corrupt) |
|---|---|---|---|
| TXT_OUTPUT | &BB5A | A=char/control | none (all preserved) |
| TXT_WR_CHAR | &BB5D | A=char | AF,BC,DE,HL |
| TXT_CLEAR_WINDOW | &BB6C | — | AF,BC,DE,HL |
| TXT_SET_COLUMN / TXT_SET_ROW | &BB6F / &BB72 | A (1-based, window-relative) | AF,HL |
| TXT_SET_CURSOR / TXT_GET_CURSOR | &BB75 / &BB78 | H=col, L=row / → H,L | AF,HL / F |
| TXT_CUR_ENABLE/DISABLE/ON/OFF | &BB7B/&BB7E/&BB81/&BB84 | — | AF |
| TXT_SET_PEN / TXT_SET_PAPER | &BB90 / &BB96 | A=pen | AF,HL |
| TXT_INVERSE / TXT_SET_BACK | &BB9C / &BB9F | — / A=0 opaque, ≠0 transparent | AF,HL |
| TXT_SET_MATRIX / TXT_SET_M_TABLE | &BBA8 / &BBAB | A=char, HL=matrix / DE=first char, HL=table | AF,BC,DE,HL |
| GRA_MOVE_ABSOLUTE / GRA_SET_ORIGIN | &BBC0 / &BBC9 | DE=x, HL=y | AF,BC,DE,HL |
| GRA_WIN_WIDTH / GRA_WIN_HEIGHT | &BBCF / &BBD2 | DE,HL | AF,BC,DE,HL |
| GRA_SET_PEN / GRA_SET_PAPER | &BBDE / &BBE4 | A=pen | AF |
| GRA_PLOT_ABSOLUTE / RELATIVE | &BBEA / &BBED | DE=x, HL=y | AF,BC,DE,HL |
| GRA_TEST_ABSOLUTE | &BBF0 | DE=x, HL=y → A=pen | BC,DE,HL,F |
| GRA_LINE_ABSOLUTE / RELATIVE | &BBF6 / &BBF9 | DE=x, HL=y | AF,BC,DE,HL |
| SCR_SET_MODE / SCR_GET_MODE | &BC0E / &BC11 | A=mode / → A | AF,BC,DE,HL / F |
| SCR_CLEAR | &BC14 | — | AF,BC,DE,HL |
| SCR_SET_INK / SCR_SET_BORDER | &BC32 / &BC38 | A=pen, B,C=colours / B,C | AF,BC,DE,HL |
| SCR_SET_FLASHING / SCR_ACCESS | &BC3E / &BC59 | H,L=periods / A=mode | AF,HL / AF |
| KM_WAIT_CHAR / KM_READ_CHAR | &BB06 / &BB09 | — → A (read: carry = got one) | F |
| KM_WAIT_KEY / KM_READ_KEY | &BB18 / &BB1B | — → A | F |
| KM_TEST_KEY | &BB1E | A=key number → NZ if down, C=shift/ctrl | AF,HL |
| KM_GET_JOYSTICK | &BB24 | — → H/A=joy0, L=joy1 | F |
| KM_ARM_BREAK / DISARM / BREAK_EVENT | &BB45 / &BB48 / &BB4B | | AF (+more) |
| SOUND_RESET / QUEUE / CHECK | &BCA7 / &BCAA / &BCAD | — / HL=9-byte block / A=channel bit | AF,BC,DE,HL / AF,BC,DE,HL,IX / A=status, F |
| KL_LOG_EXT | &BCD1 | BC=RSX table, HL=4-byte workspace | DE |
| KL_NEW_FRAME_FLY / ADD / DEL | &BCD7 / &BCDA / &BCDD | HL=event block, B=class, C=ROM, DE=routine | AF,DE,HL (NEW) |
| KL_TIME_PLEASE / KL_TIME_SET | &BD0D / &BD10 | → DEHL (300 Hz ticks) / DEHL | — / AF |
| MC_BOOT_PROGRAM / MC_START_PROGRAM | &BD13 / &BD16 | HL=loader / HL=entry, C=ROM | never return |
| MC_WAIT_FLYBACK | &BD19 | — | none |
| MC_SET_MODE | &BD1C | A=mode (hardware only) | AF |
| MC_SOUND_REGISTER | &BD34 | A=AY register, C=value | AF,BC |
| CAS_IN_OPEN / CLOSE / DIRECT | &BC77 / &BC7A / &BC83 | HL=name, B=len, DE=2K buffer / — / HL=addr | AF,BC,DE,HL,IX |
| CAS_OUT_OPEN / CLOSE / DIRECT | &BC8C / &BC8F / &BC98 | as above / — / HL,DE,BC,A | AF,BC,DE,HL,IX |
| CAS_CATALOG | &BC9B | DE=2K buffer | AF,BC,DE,HL,IX |

The exit columns were compiled from disassembly annotations and the Firmware
Guide's reference pages. TXT_OUTPUT, TXT_SET_PEN, TXT_SET_MATRIX/M_TABLE,
TXT_SET_CURSOR/GET_CURSOR, TXT_INVERSE/SET_BACK, GRA_TEST_ABSOLUTE,
SOUND_RESET, KL_LOG_EXT, KL_NEW_FRAME_FLY and KM_TEST_KEY were re-checked
against the Guide text. The plan requires every routine to document the
registers it clobbers, so re-check each one against the Guide
(cantrell.org.uk/david/tech/cpc/cpc-firmware/firmware.pdf) when writing it.

Key numbers: ESC **66** (line 8, bit 2), RETURN 18, keypad ENTER 6, SPACE 47,
cursor up 0 / right 1 / down 2 / left 8, DEL 79, joystick 0
up/down/left/right/fire1/fire2 = 72/73/74/75/76/77. Low RAM: RST 6 &0030 is
free for the user; &003B (EXT_INTERRUPT) is a hook whose default is `RET`;
don't touch &0038.

### 6.5 END and exit semantics (for Phase 2)

`RUN"` never returns, so "return cleanly to BASIC" is only possible if the user
enters the program with `CALL` after `MEMORY`/`LOAD` at a higher ORG. Options:
(a) END = `rst 0` (clean reset to BASIC's Ready prompt; simple and honest);
(b) END = spin with `jr $`, or wait for a key and then reset;
(c) offer a second layout (ORG ≥ &4000, `MEMORY &3FFF:LOAD"x":CALL &4000`) that
`RET`s to BASIC, which suits small utilities. **Decided 2026-09-27: (a), END = reset.** (c) may
come later as an option. This is the CPC equivalent of zx81sd's
exit-to-BASIC write-up.

### 6.6 Smaller items

- zxbasm can't assemble `out (c),0`; use `defb $ED,$71`.
- zxnext's `mul8`/`mul16` use the Z80N `mul d,e`; inherit from zx48k, not zxnext.
- The Play library's tempo and pitch tables are clock-specific (Q4).
- CPCtelera's gate-array setters fight the firmware (Q5). Firmware-first v1
  should use SCR_\* for mode, ink and border.
- Headless Caprice32 has no RAM-dump token. Use screenshots, the virtual
  printer (`PRINT #8`), or chips for RAM assertions.

---

### 6.7 128K banking on the 6128 (future feature)

The §6.2 layout covers the 64K every CPC has. The 6128's extra 64K is four 16K
banks selected by the gate-array RAM configuration (`&C0`+n on port &7Fxx).
Configs **&C4–&C7 map extra bank 0–3 into &4000–&7FFF**; &C0 is normal. The
firmware entry is **KL BANK SWITCH &BD5B** (6128 only; A = config, returns the
previous one; per the Firmware Guide). The firmware interrupt handler doesn't
touch the RAM configuration. Configs that hide &B100–&BFFF (e.g. &C2) are
bare-metal only (Phase 6). This doesn't need bare-metal mode, so it can come
before Phase 6.

Constraints to keep now:
- The heap, private block and stack (all ≥ &8B60) are already outside the
  window, and so is the screen.
- Routines that must run while a bank is paged in (firmware gate, IM1
  front-end, bank helpers) must also be outside it. With ORG &1000, code over
  about 12 KB reaches &4000, so when banking arrives the bootstrap should copy
  these routines into the private block.
- The central-32K pointer rule (§6.2) also means the firmware must not be
  handed a pointer into a paged-out bank.

Suggested staging:
1. **Data banks:** a cpc `memorybank.bas` (zx48k has
   `SetBank`/`GetBank`/`SetCodeBank`) plus block copies between main RAM and a
   bank. Load straight into a bank from disc by selecting the bank and doing a
   CAS read into &4000, with the AMSDOS buffer outside the window. Detect the
   extra RAM at runtime and error on a 464/664.
2. **Compile-time placement of constant data in a bank,** like zx81sd's
   block-7 option (`1af6a113`), with the loader filling the bank from a second
   file.
3. **Code in banks** (overlay SUBs with trampolines, like the Spectrum's
   `SetCodeBank`). This is the hardest and comes last.

## 7. Suggested starting point for Phase 1

These are proposals; §6.1 and §6.2 are awaiting approval.
1. `src/arch/__init__.py`: add `"cpc"`. `src/zxbpp/zxbpp.py`: extend the zx48k
   fallback to cpc, ideally as a generic inherits-map.
2. `src/arch/cpc/{__init__.py, backend/{__init__,main}.py}` modelled on zx81sd:
   subclass the z80 `Backend`; org &1000; fixed `heap_address` below the
   private block (§6.2); a prologue that sets SP = &A600, captures `FW_BC`,
   writes `jp FP_CALC_ENTRY` at &0030 and runs `#init`s with interrupts off
   (§6.1 stage 1); END = `rst 0`.
3. `src/lib/arch/cpc/runtime/`: `arch_config.asm` (memory constants),
   `sysvars.asm` (private block), `fwcall.asm` (the gate), and stubs for the 45
   rewrite files. Phase 1 milestone: an empty program compiles.
4. First commit: the `__<ARCH>__` auto-define (Q2, decided) with tests.
   (§6.5 END semantics: decided, END = reset.)
5. `tests/functional/arch/cpc/` for golden `.asm` snapshots.

---

## 8. Phase 1 results (2026-09-27)

**Core changes** (small and general, each suitable as its own upstream PR):
- `src/zxbc/args_config.py` `set_option_defines()`: auto-defines `__<ARCH>__`.
  Standalone `zxbpp` does the same (`src/zxbpp/zxbpp.py` `entry_point()`).
- `src/arch/__init__.py`: `ARCH_PARENTS` (`zx81sd`→`zx48k`, `cpc`→`zx48k`)
  replaces the hard-coded zx81sd include fallback in `set_include_path()`.
  zx81sd's search order is unchanged.
- `src/api/config.py` + `args_config.py`: `OPTIONS.cli_overrides` (a frozenset
  of `org`/`heap_size`/`heap_address` given on the CLI). The cpc backend only
  applies its defaults where the user didn't set a value. Checked: default org
  4096, heap at &8B60; `--org 0x2000`; `--heap-address`; `-H 2000` (still
  top-aligned, &9630); an explicit `--org 32768` is kept.
- `"cpc"` registered in `src/arch/__init__.py`.

**cpc arch:** `src/arch/cpc/{__init__.py, backend/{__init__,main,generic}.py}`.
It subclasses the z80 backend. Memory-map constants in `main.py` are the only
place the numbers live, and are emitted as `.core.CPC_*` EQUs. The prologue is
`di`, `ld sp,&A600`, the `#init` calls, `jp main`. END is `rst 0`.
`bootstrap.asm` is forced into every build through `common.REQUIRES`.

**cpc runtime** (`src/lib/arch/cpc/runtime/`, 71 files): `sysvars.asm` (private
block at &9E00, &3A of &400 bytes used), `bootstrap.asm`, `stub.asm`
(`__CPC_NOT_IMPLEMENTED`: `di; halt`), and `fp_calc.asm` (placeholder: an
`#init` writes `jp FP_CALC_ENTRY` at &0030, which traps for now). There are 25
`rst 30h` float copies, 4 ported files (array, modf16, chr, random; usr_str
isn't needed, as it only uses relocated names) and 38 stubs. Of the stubs, 27
trap, 9 attribute setters keep real code (they only flip bits in the relocated
sysvars), and INKEY$ always returns "".

**Tests:** 4 cpc goldens (empty, intbyte, print_hello, float_arith);
`tests/arch/cpc/test_cpc_fp_copies.py` (the float copies must equal zx48k
after the substitution); `tests/arch/cpc/test_cpc_no_spectrum_refs.py`
(compiles a 15-program feature corpus to asm and bin, and fails on any
Spectrum RST, ROM call, sysvar address or port).

**Findings:**
- zxbasm has no assembly-time assertion (no `ASSERT`/`IF`), and a negative
  `DEFS` silently emits nothing. So "code overlaps heap" can't fail the build
  yet. TODO for Phase 2: a check in zxbc after assembly, or in mkdsk/run.sh.
- Existing zx81sd bugs, worth reporting upstream: (1) `-H`/`--heap-address`
  are silently overwritten because its `init()` assigns the heap after CLI
  parsing; (2) `zxbc --arch zx81sd -f bin` on a pure-integer program (e.g.
  `tests/functional/arch/zx81sd/add8.bas`) fails with undefined
  `.core.FP_CALC_ENTRY`, since nothing pulls in its bootstrap.
- `copy_attr.asm`'s `___PRINT_IS_USED___` path is live whenever a program uses
  PRINT (`src/zxbc/zxbparser.py:641` defines it on every arch), so it has to
  stay a stub until print.asm is real.
- **Option leak between in-process compiles (fixed).** `zxbc.main()` runs its
  first `Backend().init()` on whatever `arch.target` the previous compile left,
  right after `config.init()` has cleared `cli_overrides`. Unguarded, cpc's
  init set org to &1000 and the next zxnext/zx48k build kept it: `zxnext/sub16a`
  failed with `org 4096` whenever cpc goldens ran earlier. The fix is that cpc
  applies memory defaults only when `OPTIONS.architecture == "cpc"`; the
  regression test is `tests/arch/cpc/test_cpc_option_isolation.py`. The same
  latent leak exists upstream for zx81sd's directly assigned heap; worth
  reporting, and arguably `zxbc.main()` should reset the target to the default
  arch before its first init.
- Full suite after Phase 1: **2084 passed, 0 failed**.

---

## 9. Phase 2 results (2026-09-27)

Milestone met: `PRINT "Hello CPC"` and the whole text layer run in Caprice32.
That covers AT, temporary and permanent INK/PAPER, INVERSE, integers and
fixed-point, comma/TAB, embedded CHR$ codes, wrapping and scrolling.

- **Firmware gate** (`fwcall.asm`): `call .core.__FW_CALL` / `defw entry`;
  `__FW_CALL_IX` for CAS_* entries. It restores BC' from `FW_BC`, **clears AF'
  carry**, runs `ei` → call → `di`, then captures BC'. It costs about 210
  T-states. The AF' clear was added after a stress test (carry set in AF'
  before each call) crashed after about 37 calls. The firmware ISR starts with
  `ex af,af'; jr c` and treats carry as "nested interrupt". The earlier
  2000-iteration BC' stress test (SUB epilogues plus 32-bit EXX maths) passed
  before and after the fix.
- **Bootstrap** (`CPC_INIT_00_BOOTSTRAP`, named to sort first among `#init`s):
  captures BC', zero-fills the private block, sets MODE 1 via SCR_SET_MODE
  (which also clears the screen and homes the cursor).
- **Errors:** "Error n" on a fresh line, KM_FLUSH, KM_WAIT_KEY, `rst 0`.
  Unimplemented stubs still hang. An out-of-range `PRINT AT` fails silently
  (`__STOP`), exactly as on zx48k.
- **Text:** print.asm is rewritten on TXT_OUTPUT/TXT_SET_CURSOR/TXT_GET_CURSOR/
  TXT_SET_PEN/TXT_SET_PAPER/TXT_INVERSE/TXT_CLEAR_WINDOW. Codes below 32 never
  reach the firmware raw. zx48k's EXX-based print state machine was replaced by
  a memory state byte, because it would collide with the gate's own `exx`.
  Fixed on the way: MASK_P/MASK_T were missing (INK/PAPER rely on their being
  next to ATTR_P/ATTR_T), and TAB used `and 39` as "mod 40".
- **Build check** (`src/zxbc/zxbc.py` `check_memory_layout`, generic): errors if
  code+data overlaps a fixed heap, or passes a backend's `MAX_CODE_ADDRESS`
  (cpc: &9E00). A range-intersection bug (it rejected a heap *below* the code)
  was fixed and has a test.
- `run.sh --shot` waits `SHOT_DELAYS` (default 6) autocmd delays.
- Headless-testing notes: every `-a` token also types Enter, which can satisfy
  a KM_WAIT_KEY early. Printing is slow enough (thousands of characters take
  seconds) that a screenshot needs enough delays.
- Full suite: 2092 passed.

---

## 10. Phase 3 results (2026-09-28)

Phase 3 (core language conformance) is complete.

**Floats.** zx81sd's re-implementation of the Spectrum ROM calculator
(`fp_calc.asm`, about 2.2 KB with `stackf`) is ported to cpc and entered via
RST 6 (&0030; installed at boot by an `#init`). `fp_tostr`, `str`, `val`,
`printf` and `arith/divf` are ported too. The FP workspace sits in the private
block, which now uses 160 of 1024 bytes. The calculator's 84 `exx` are safe
because compiled code runs with interrupts off and the firmware is only
reached through the gate. Float output now **rounds** to 5 decimals: zx81sd
truncated, so `SIN(PI/6)` printed 0.49999, and `-0` is suppressed.
Limitations kept from zx81sd: no exponent notation, and VAL accepts a single
numeric literal. Division by zero gives "Error 5".

**BREAK.** `--enable-break`: CHECK_BREAK polls ESC (KM_TEST_KEY, key 66)
through the gate, keeping zx48k's calling convention. ESC is seen within a
few loop iterations, because the firmware only scans the keyboard in its
interrupt, which runs inside gate calls.

**Test harness (in cpcbuild).**
- `-D __CPC_PRINTER_ECHO__` (runtime) mirrors all PRINT output to the printer
  via MC_PRINT_CHAR (&BD2B): newline as LF, AT as LF. In this mode errors
  skip the key wait, stubs print "NOT IMPLEMENTED", and END prints a `\x04END`
  marker. END now goes through `.core.__CPC_END` in bootstrap.asm.
- `tools/cpcrun.py prog.bas`: compile, .dsk, headless Caprice32 with printer
  capture, `CAP32_WAITBREAK` (breakpoint at 0). Exit codes: 0 = clean END
  (marker seen), 1 = build error, 2 = timeout/hang, 3 = `--expect` mismatch,
  4 = reached 0 without the marker (runtime error or crash). AMSDOS names are
  limited to `[A-Z0-9]`, because Caprice32's autotype can't type `_`.
- `tests/conformance/*.bas` + `run.py -j N`: 9 self-checking programs
  (integers, fixed-point, floats including rounding, strings, arrays,
  DATA/READ, SUB/FUNCTION/recursion, control flow, heap). **9/9 pass** in about
  15 s.

**Functional-test sweep.** All 1047 zx48k functional tests compile the same
way for cpc as for zx48k (900 OK, 147 expected failures, 0 cpc-only
failures). Running the 900 on the CPC: **835 clean END**, 2 deliberate
runtime errors, 25 stub hits, 31 timeouts, 7 resets. The stub hits are BORDER
7, LOAD 5, SAVE 5, DRAW 3, PLOT/CIRCLE 2, BEEP 2, PAUSE 1. The timeouts are
infinite loops by design, a headerless build, and `#pragma org=0`. The resets
are all Spectrum-specific: `USR 0`, raw ROM calls, DEFB executed as code,
POKEs from uninitialised variables. **No cpc runtime bugs.** Running cap32 in
parallel (-j6) gives about 1% spurious resets or timeouts; always re-run
failures serially.

**Fixed along the way.**
- `shri16`: the shift-by-1 fast path emitted `srl h` instead of `sra h`
  (shared z80 backend; 3 goldens updated).
- The conformance test wrongly assumed ON GOTO/GOSUB is 1-based. It is 0-based
  per Boriel's docs, and the runtime is correct.

**Found, not fixed** (all core/upstream; recorded in notes.md question 9):
string-literal comparison crashes constant folding; the float-literal packer
truncates; STR$ constant folding uses full Python precision; `#pragma
zxnext=TRUE` re-enables Z80N opcodes on cpc (the backend forces it off only in
`init()`).

Full suite: 2093 passed.

---

## 11. Phase 4a results (2026-10-01)

Phase 4a (text, input, basic graphics) is complete, on the **464 and the
6128** (decisions in notes.md, 2026-10-01).

**464 support.** The runtime uses only jumpblock entries every model has;
nothing from the 664/6128 block &BD3A-&BD5D. Phase 2's KM_FLUSH (&BD3D) was
replaced by a KM_READ_CHAR drain (`bootstrap.asm` `__CPC_FLUSH_KEYS`), and
DRAW avoids GRA_SET_FIRST (see below). `cpcrun.py`/`run.py --model 464`,
and `CPC_MODEL=464 tools/cpc/run.sh`, emulate a 464 with the DDI-1 AMSDOS
ROM in slot 7 (Caprice32 `-O system.model=0 -O rom.slot07=amsdos.rom`).

**Colour (`colour.asm`).** INK/PAPER keep Spectrum colours 0-7 in ATTR_P/T
and map them through `PEN_MAP`, a per-mode table of the pen whose firmware
default colour is nearest (mode 0: exact matches; mode 1: black/blue -> 0,
red/magenta -> 3, green/cyan -> 2, yellow/white -> 1; mode 2: by brightness).
The default attribute is INK 7 PAPER 0, i.e. the CPC's own pen 1 on pen 0;
it is set by the bootstrap, because a program with no PRINT still plots with
it. BORDER c shows PAPER c's current colour (SCR_GET_INK + SCR_SET_BORDER).
BRIGHT and FLASH are ignored.

**Text width.** `TXT_COLS` (20/40/80) follows the mode for PRINT AT bounds,
TAB, comma zones and the pending-wrap column in `sposn.asm`.

**Graphics (`gfx.asm`, `plot.asm`, `draw.asm`, `draw3.asm`, `circle.asm`).**
Coordinates are mode pixels, origin bottom-left, 16-bit signed; the parser
casts PLOT/CIRCLE coordinates through `graphics_coord_type()`, which reads
`GRAPHICS_COORD_TYPE = "integer"` from `src/arch/cpc/__init__.py` (the
Spectrum archs keep ubyte/byte). `__GRA_XY` scales to the firmware's 640x400
virtual units; the firmware clips off-screen points silently. The graphics
pen is the temporary ink (paper under INVERSE 1), and OVER 1 is the
firmware's XOR write mode (SCR_ACCESS), both cached to save firmware calls.
- PLOT: GRA_PLOT_ABSOLUTE. DRAW: GRA_LINE_RELATIVE. The firmware also plots a
  line's first point; under OVER 1 that point would be XORed twice, so DRAW
  plots it once more (GRA_SET_FIRST would do it, but is 664/6128 only).
- CIRCLE: midpoint algorithm in mode pixels, each pixel plotted exactly once,
  so an OVER 1 circle erases itself completely (tested). Stretched in mode 0,
  squashed in mode 2, because those pixels aren't square.
- DRAW x,y,a (arc): written fresh, not ported. n = INT(|a| (|dx|+|dy|) / 8) + 1
  segments (max 255) through `__DRAW`; the vectors are rotated on the
  calculator, and the last segment ends exactly on the target. A radius-50
  semicircle takes about 0.25 s.
- `POINT(x, y)` (cpc stdlib `point.bas`) returns the pixel's pen
  (GRA_TEST_ABSOLUTE) and restores the graphics cursor afterwards.

**Input, timing, sound.**
- INKEY$: KM_READ_CHAR, the CPC's buffered model with CPC key codes (RETURN
  13, DEL 127, cursors 240-243). A key held down repeats at the firmware rate.
  The bootstrap empties the key buffer so the RETURN from `RUN"` isn't seen.
- INPUT (cpc stdlib `input.bas`): same API as zx48k's, on KM_WAIT_CHAR with the
  firmware cursor (TXT_CUR_ON/OFF).
- PAUSE n: counts 6 ticks of KL_TIME_PLEASE per frame, and ends early on a
  key, which it puts back with KM_CHAR_RETURN for INKEY$. PAUSE 0 waits for a
  key.
- BEEP: SOUND_QUEUE on channel A, full volume, then waits until the channel
  is idle (SOUND_CHECK). Tone period = 62500 / f, measured in Caprice32
  (`SOUND 1,478` plays 130.7 Hz; recorded with `SDL_AUDIODRIVER=disk`), so
  middle C is 239. Constant arguments are converted by `src/arch/cpc/beep.py`:
  the translator now calls `arch.target.beep`, not `src.arch.zx48k.beep`.
  Run-time arguments are converted on the calculator. Duration 0 plays nothing.
- END (non-test builds) and runtime errors wait for a key (`__CPC_WAIT_KEY`)
  before resetting.

**`cpc.bas`** (cpc stdlib): `Mode n` (SCR_SET_MODE, then the per-mode
variables and CLS), `GetMode()`, `SetInk pen, colour`, `SetBorder colour`
(hardware colours 0-26), `WaitVsync` (MC_WAIT_FLYBACK; it returns at once
if the flyback has already started).

**Spectrum-only stdlib** gives a clear `#error` on cpc: `attr.bas`
(question 6), `print42.bas`, `print64.bas` (question 7), `screen.bas`
(SCREEN$), and `sinclair.bas` (it bundles attr/screen and POKEs 23675, which
on the CPC is inside the program).

**Found along the way.**
- SCR_ACCESS corrupts DE/HL on the 6128, though the register lists say AF
  only. The next PLOT went to a garbage position. `__GRA_PREP` now saves
  both.
- GRA_TEST_ABSOLUTE moves the graphics cursor, so POINT restores it.
- The calculator's `int` ($27) uses memory cell 0 for negative numbers, as
  the Spectrum ROM does. `draw3.asm` rounds with INT(p + 32768.5) - 32768,
  done in Z80 code, instead. `exp` uses cell 3 and SIN/COS use cells 0-2.
- Caprice32 headless: every `-a` token types RETURN, which now ends a
  program at its END key wait. `run.sh --shot` puts its delays and the
  screenshot into one token. `cpcrun.py --type TEXT` (and `REM TYPE:` lines
  in conformance tests) types keys while the program runs. The first typed
  token waits four CAP32_DELAYs, to get past loading and the bootstrap's key
  flush.

**Tests.** cpcbuild conformance: `graphics.bas` (44 checks, pixels read
back with POINT), `textio.bas` (PAUSE/BEEP timing on the 300 Hz clock, BEEP
periods, BORDER, text widths per mode) and `keyboard.bas` (INPUT, INKEY$ with
typed keys). **12/12 pass on the 6128 and on the 464.** zxbasic:
`tests/arch/cpc/test_cpc_phase4a.py` (coordinate types per arch, BEEP
conversion, Spectrum-only stdlib errors), plus new corpus entries in
`test_cpc_no_spectrum_refs.py`. Full suite: 2117 passed.

**Functional-test sweep** (all 1047 zx48k functional tests through
`cpcrun.py`, 6128): **844 clean END** (835 in Phase 3), 2 deliberate runtime
errors (arrcheck, math_ln), 9 resets (Spectrum-specific: USR, raw ROM calls,
DEFB executed as code, INCBIN'd Spectrum data; optspeed reset in Phase 3
too), 30 timeouts (infinite loops by design, headerless, `#pragma org`), 10
stub hits, all LOAD/SAVE/CODE (Phase 5 territory). 152 don't build: 148
fail on zx48k too, and 4 are the new `#error` libraries (print42, print64,
stdlib_attr, stdlib_screen). No PLOT/DRAW/CIRCLE/BORDER/BEEP/PAUSE stub hits
remain.

---

## 12. Phase 4b results (2026-10-01)

Phase 4b (UDGs, character set, SCREEN$) is complete on the 6128 and the
464. Decisions: notes.md questions 8, 16 and 20.

**The firmware's character table.** TXT_SET_M_TABLE (&BBAB) installs a
"user matrix table" that always covers its first character up to 255
(measured with `SYMBOL AFTER`: 896 bytes from 144, 1792 from 32), must be in
the central 32K, and is filled with the glyphs in use when installed. UDGs
in the existing 1 KB private block (the plan's 168 bytes) were therefore
impossible.

- **UDGs** (`udg.asm`, pulled in by the cpc copy of `usr_str.asm`): programs
  that use USR "a" get the 144-255 table (896 bytes) from the heap at
  start-up, via `#init .core.__UDG_INIT`, named to sort after
  `__MEM_INIT`. UDG points at it, so `POKE USR "a"+n` and `PRINT CHR$ 144`
  work as on the Spectrum. Error 3 if the heap can't hold it (or is below
  &4000). Programs without USR "a" pay nothing. The UDGs start as the CPC's
  own glyphs 144-164, not copies of A-U.
- **Block graphics 128-143**: no table needed. They are the CPC's own
  quadrant characters with the bits paired differently (Spectrum: 0 top
  right, 1 top left, 2 bottom right, 3 bottom left; CPC: 0 top left, 1 top
  right, 2 bottom left, 3 bottom right), so print.asm swaps bits 0<->1 and
  2<->3.
- **Full font** (cpc stdlib `font.bas`, opt-in): `SetFont(@font)` takes 768
  bytes for characters 32-127 (the Spectrum's font format). The first call
  allocates the 32-255 table (1792 bytes of heap), installs it, frees the
  UDG table (whose glyphs the firmware has just copied) and points UDG into
  the new one. CHARS = table - 256, as on the Spectrum. Later calls only
  copy. While switching, both tables exist briefly, so a program that also
  uses USR "a" needs 2688 bytes of free heap at its first SetFont.
  Spectrum programs that POKE CHARS (23606) directly won't work: on the CPC
  that address is inside the program. Use SetFont.
- **SCREEN$** (cpc stdlib `screen.bas`): TXT_RD_CHAR (&BB60) at the cell,
  with the text cursor saved and restored. Block graphics are translated
  back to the Spectrum's codes, and UDGs are recognised (the Spectrum's
  SCREEN$ doesn't). Off-screen row/column gives "", as does a cell with
  PLOTted pixels that change the glyph. **Colours:** cells with the current
  colours, or with only INK or only PAPER changed, read back correctly. With
  both changed (pen 2 on pen 3) the firmware misreads the cell: as a space
  on the 6128 and as a solid block on the 464 (their firmware versions
  differ here).

**Tests.** cpcbuild conformance `udg.bas` (17 checks), `font.bas` (17),
`screen.bas` (29). **15/15 programs pass on the 6128 and the 464.** zxbasic:
corpus entries for screen.bas and font.bas, screen.bas removed from the
"Spectrum-only" error test. Full suite: 2120 passed.

**How the work was done.** SCREEN$ and font.bas were written by two
sub-agents (cheaper model) in parallel from written specs, then reviewed
here. The review caught a test that didn't test what it claimed: its
"different paper" check used PAPER 1, which is pen 0 in mode 1, the same
pen as the default paper. The real check found the misread above.

**Functional sweep:** 845 clean END (844 after 4a). The only change is
stdlib_screen.bas, which now builds and runs instead of hitting the
`#error`. No regressions.

---

## 13. Phase 4c results: the cpcbuild library (2026-10-01)

The library half of Phase 4c is done; the asset pipeline is still to come.
Design and decisions: `phase4c-design.md`, notes.md (Phase 4c decisions).
Everything is written from scratch (MIT, clean-room): nobody working on it
read CPCtelera's or any other CPC library's source.

**Files** (zxbasic `src/lib/arch/cpc/`): `stdlib/cpcbuild.bas` includes all
of `stdlib/cpcbuild/{display,sprites,fill,tiles,keyboard,palette}.bas`, on
top of `runtime/cpcbuild/{core,display,sprite,fill,tiles,keys,palette}.asm`.
Library state is in the private block (CB_BASE, CB_SHOWN, CB_OFFSET,
CB_DBUF, CB_TILESET, CB_KEYS; 209 of 1024 bytes now used).

**API.** Coordinates are x in bytes (0-79) and y in pixel lines (0-199), from
the top-left.
- display: `ScreenInit`, `WaitRetrace(frames)`, `EnableDoubleBuffer`,
  `DisableDoubleBuffer`, `FlipBuffer`, `PokeScreen(x, y, b)`,
  `PeekScreen(x, y)`.
- sprites: `PutSprite(x, y, w, h, @spr)`, `PutSpriteMasked` (mask/pixel
  byte pairs), `GetBlock`; clipped on all edges (x, y are signed 16-bit).
- fill: `PenByte(pen)`, `FillRect(x, y, w, h, pen)`, `ClearScreen(pen)`.
- tiles: `SetTileSet(@t)`, `DoTile8(x, y, t)`, `DoTile16(x, y, t)` (four 8x8
  tiles), `TileMap(@map, x, y, w, h)`; x, y in tile cells, off-screen cells
  skipped.
- keyboard: `ScanKeys`, `KeyDown(key)`, `AnyKeyDown`, and `KEY_*`/`JOY_*`
  constants (firmware key numbers).
- palette: `SetPalette(@colours, count)`, `PalUpload(@colours, count,
  first)` (NextBuild name); firmware colour numbers 0-26.

**How it works.**
- `core.asm`: `__CB_ADDR` (x, y to address), `__CB_NEXT_LINE`,
  `__CB_ROW_WRAPS`/`__CB_INC_X` for rows that wrap the 2 KB block. The
  firmware's hardware-scroll offset (SCR_GET_LOCATION) is read at
  ScreenInit, WaitRetrace and FlipBuffer, so drawing stays right after text
  scrolls. Real offsets are multiples of 80, so only sprites (any x) can
  straddle the wrap point, not aligned tiles. At offsets up to 48 nothing can
  wrap, and the sprite/fill routines skip the per-row test.
- Double buffering: back screen &4000-&7FFF, swapped at the flyback with
  SCR_SET_BASE. `EnableDoubleBuffer` defines `__CB_DBUF_RESERVED`. The cpc
  backend's new `RESERVED_RANGE_LABELS` hook (generic, in zxbc's
  `check_memory_layout`) then reserves &4000-&7FFF: code+data or a heap
  overlapping it is a build error. Programs that never call it are
  unaffected. PRINT draws on the shown screen; text must not scroll while
  double buffering.
- Keyboard: direct PPI/AY matrix scan (AY register 14, read command &40),
  then the PPI is restored (control &82, cassette bits kept) so the firmware
  keeps working. The scan doesn't feed the firmware's key buffer.
- Palette: firmware SCR_SET_INK/SET_BORDER plus a direct Gate Array write,
  so changes show at once. `cpc.bas` SetInk/SetBorder now do the same. The
  27-entry firmware-to-hardware colour table was verified on the 6128 and
  the 464 by screenshot comparison (`tools/palette_check.py`).

**Speed** (CPC effective T-states, measured in Caprice32):

| Routine | T-states |
|---|---|
| PutSprite, 16x16 mode-0 sprite (4x16 bytes) | about 6,100 |
| PutSpriteMasked, same | about 9,100 |
| GetBlock, same | about 6,000 |
| DoTile8 (mode 1) | about 1,850 |
| TileMap, full screen (40x25 tiles, mode 1) | about 1.47 M (1,450 per tile) |

Correct but not optimised: about 95 T-states per sprite byte, where unrolled
LDI-based code would manage about a third of that. Left for later.

**Found along the way.**
- The 300 Hz firmware clock only advances during firmware calls (interrupts
  are off otherwise), so timing compiled code with KL_TIME_PLEASE around
  BASIC calls reads near 0. The speed tests run their timed loops through
  the firmware gate (interrupts on) and calibrate. This is another reason
  for the own interrupt handler (question 2, Phase 4d).
- A key pressed only for an instant (as Caprice32 types) can be taken by
  the firmware's own interrupt-time scan first, so a once-a-frame ScanKeys
  may miss it. Held keys are fine. Tests scan in a tight loop.
- Buffering one PASS line per check in a string overflows the default
  4.7 KB heap in long tests (Error 9 or a reset), so big tests print only
  FAIL lines and a count.
- Boriel reminders: AND/OR are logical (bitwise is BAND/BOR/BXOR); `DATA`
  and `VERIFY` are keywords; a UBYTE FOR loop to 255 never ends.

**Tests.** New cpcbuild conformance programs: `cb_display.bas` (16 checks,
addressing with and without scroll offset, double buffering, WaitRetrace),
`cb_sprites.bas` (169), `cb_fill.bas`, `cb_tiles.bas` (107), `cb_keys.bas`
(typed keys), `cb_palette.bas`. **21/21 programs pass on the 6128 and the
464.** zxbasic: `tests/arch/cpc/test_cpc_phase4c.py` (the reserved-range
check, in-process and end to end), a cpcbuild corpus entry. Full suite: 2130
passed.

**How the work was done.** I wrote the core, display and double buffering
myself. Three sub-agents (cheaper model) wrote sprites+fill, tiles and
keyboard+palette in parallel from written specs; their code was reviewed
and everything re-run here on both models.

---

## Appendix: per-file classification

Columns: **Class** from recon. **CPC action** from §4 ("inherit (after X)"
means inherit once X has a cpc version). **Alt regs / IY** marks EXX, EX AF,AF'
or IY use (see §6.1). **zx81sd override** means a same-named file exists in
`src/lib/arch/zx81sd/runtime/`. **Evidence** is the specific line or symbol.

| File (runtime/) | Class | CPC action | Alt regs / IY | zx81sd override | Evidence |
|---|---|---|---|---|---|
| SP/CharLeft.asm | HW | rewrite | — | N | hardcodes screen hi-byte bounds: `sub $08`/`cp $40` (0x4000 screen boundary) |
| SP/CharRight.asm | HW | rewrite | — | N | hardcodes screen hi-byte bound `cp $58` (0x5800 attr boundary) |
| SP/GetScrnAddr.asm | HW | rewrite | — | N | Spectrum interleaved bitmap address calc (`rra`/rotate loop) + `ld hl,(SCREEN_ADDR)` |
| SP/PixelDown.asm | HW | rewrite | AF' | N | `ld de,(SCREEN_ADDR)`; Spectrum non-linear row math (`and $07`, `add $20`) |
| SP/PixelLeft.asm | HW | rewrite | AF' | N | `ld de,(SCREEN_ADDR)`; pixel-bit rotate within attr cell |
| SP/PixelRight.asm | HW | rewrite | AF' | N | `ld de,(SCREEN_ADDR)`; pixel-bit rotate within attr cell |
| SP/PixelUp.asm | HW | rewrite | AF' | N | `ld de,(SCREEN_ADDR)`; Spectrum non-linear row math |
| abs16.asm | PURE | inherit | — | N | only `#include once <neg16.asm>` |
| abs32.asm | PURE | inherit | — | N | only `#include once <neg32.asm>` |
| abs8.asm | PURE | inherit | — | N | plain `neg`/`ret p`, no includes |
| absf.asm | PURE | inherit | — | N | `res 7,e` (FP sign bit in register, not memory) |
| arith/_mul32.asm | PURE | inherit | EXX | N | no ROM/HW refs; pure 32x32→64 shift-add |
| arith/addf.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` + `defb 0fh` (ADD, ROM FP calculator) |
| arith/div16.asm | PURE→dep | inherit | AF' | N | pure div/mod, no ROM/HW |
| arith/div32.asm | PURE→dep | inherit | EXX AF' | N | pure div/mod, no ROM/HW |
| arith/div8.asm | PURE | inherit | AF' | N | pure 8-bit div/mod |
| arith/divf.asm | ROM | rewrite | — | Y | `rst 28h` DIV calc; `TMP EQU 23629 (DEST)`, `ERR_SP EQU 23613` sysvars for div-by-zero trap |
| arith/divf16.asm | PURE→dep | inherit | EXX AF' | N | fixed-point 16.16 div, pure shift/add, no ROM/HW |
| arith/fmul16.asm | PURE→dep | inherit | — | N | pure fast-path 16-bit mul |
| arith/modf.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` + `defb 32h` (MOD, ROM FP calculator) |
| arith/modf16.asm | ROM | rewrite | — | N | `TEMP EQU 23698 ; MEMBOT` used as scratch storage (Spectrum sysvar) |
| arith/mul16.asm | PURE | inherit | — | N | pure 16x16 shift-add multiply |
| arith/mul32.asm | PURE→dep | inherit | EXX | N | pure 32x32 multiply wrapper |
| arith/mul8.asm | PURE | inherit | — | N | pure 8x8 shift-add multiply |
| arith/mulf.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` + `defb 04h` (MUL, ROM FP calculator) |
| arith/mulf16.asm | PURE→dep | inherit | EXX AF' | N | fixed-point 16.16 mul, pure |
| arith/sub32.asm | PURE | inherit | EXX | N | pure 32-bit subtraction |
| arith/subf.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` + `defb 03h` (SUB, ROM FP calculator) |
| array/array.asm | ROM | rewrite | EXX | Y | `LBOUND_PTR EQU 23698 ; Uses MEMBOT as a temporary variable` (unconditional scratch use); `jp __ERROR` under `__CHECK_ARRAY_BOUNDARY__` |
| array/arrayalloc.asm | PURE→dep | inherit (error.asm reworked) | EXX | N | pure heap-offset bookkeeping |
| array/arraybound.asm | PURE | inherit | AF' | N | pure LBOUND/UBOUND table walk, no ROM/HW |
| array/arraystrfree.asm | PURE→dep | inherit | — | N | pure loop freeing string array elements |
| array/strarraycpy.asm | PURE→dep | inherit (error.asm reworked) | — | N | pure string-array copy loop |
| asc.asm | PURE | inherit | AF' | N | no ROM/HW; string/heap logic only |
| attr.asm | HW (primary) + ROM (secondary) | rewrite | — | N | `__ATTR_ADDR`: linear attribute-memory address calc (32 bytes/row, `SCREEN_ATTR_ADDR`); `ld de,(ATTR_T)` sysvar 23695 |
| bitwise/band16.asm | PURE | inherit | — | N | plain AND of HL/DE |
| bitwise/band32.asm | PURE | inherit | — | N | plain AND of DEHL/stack operand |
| bitwise/bnot16.asm | PURE | inherit | — | N | plain CPL of HL |
| bitwise/bnot32.asm | PURE | inherit | — | N | plain CPL of DEHL |
| bitwise/bor16.asm | PURE | inherit | — | N | plain OR of HL/DE |
| bitwise/bor32.asm | PURE | inherit | — | N | plain OR of DEHL/stack operand |
| bitwise/bxor16.asm | PURE | inherit | — | N | plain XOR of HL/DE |
| bitwise/bxor32.asm | PURE | inherit | — | N | plain XOR of DEHL/stack operand |
| bitwise/shl32.asm | PURE | inherit | — | N | plain shift-left DEHL |
| bitwise/shra32.asm | PURE | inherit | — | N | plain arithmetic shift-right DEHL |
| bitwise/shrl32.asm | PURE | inherit | — | N | plain logical shift-right DEHL |
| bold.asm | ROM | rewrite | — | N | `FLAGS2` sysvar via copy_attr.asm |
| bool/and16.asm | PURE | inherit | — | N | boolean AND via OR-test |
| bool/and32.asm | PURE | inherit | — | N | boolean AND via OR-test |
| bool/andf.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` + `defb 08h` (NO-&-NO, ROM FP calc) |
| bool/not32.asm | PURE | inherit | — | N | boolean NOT via sub/sbc trick |
| bool/notf.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` ROM FP calc NOT |
| bool/or32.asm | PURE | inherit | — | N | boolean OR via OR-test |
| bool/orf.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` ROM FP calc OR |
| bool/xor16.asm | PURE→dep | inherit | — | N | one-line include, no own code |
| bool/xor32.asm | PURE→dep | inherit | — | N | boolean XOR wrapper |
| bool/xor8.asm | PURE | inherit | — | N | boolean XOR via sub/sbc trick |
| bool/xorf.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` ROM FP calc XOR (`defb 0E0h` Recall-0 x2) |
| border.asm | ROM | rewrite | — | Y | `BORDER EQU 229Bh` — Spectrum ROM border routine address (file is just the EQU) |
| break.asm | ROM (primary); HW (secondary, keyboard scan under the hood) | rewrite | — | Y | `TS_BRK EQU 8020` (ROM break-key check, called); `PPC EQU 23621` sysvar |
| bright.asm | ROM | rewrite | — | N | `ATTR_P`/`ATTR_T` sysvars, bit6 transparency |
| chr.asm | ROM | rewrite | AF' | Y | `TMP EQU 23629` — fixed Spectrum sysvar (DEST) reused as scratch |
| circle.asm | PURE→dep | inherit (after attr.asm, plot.asm, set_pixel_addr_attr.asm …) | EXX AF' | N | own code is pure Bresenham circle math; calls `__PLOT` and `__OUT_OF_SCREEN_ERR` |
| cls.asm | HW (primary) + ROM (secondary) | rewrite | — | N | direct clear of 6143 bytes @`SCREEN_ADDR` (16384) + 767 bytes @`SCREEN_ATTR_ADDR` (22528) — Spectrum-sized bitmap/attr areas; sets `COORDS/S_POSN/DFCC/DFCCL/ATTR_P` |
| cmp/eq16.asm | PURE | inherit | — | N | plain `sbc hl,de` equality test |
| cmp/eq32.asm | PURE | inherit | EXX | N | plain 32-bit equality test |
| cmp/eqf.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` + `defb 0Eh` (NOS-EQL, ROM FP calc) |
| cmp/gef.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` ROM FP calc GE |
| cmp/gtf.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` ROM FP calc GT |
| cmp/lef.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` ROM FP calc LE |
| cmp/lei16.asm | PURE | inherit | — | N | plain signed <= via parity trick |
| cmp/lei32.asm | PURE→dep | inherit | EXX AF' | N | plain signed 32-bit <= |
| cmp/lei8.asm | PURE | inherit | — | N | plain signed 8-bit <=/< via parity trick |
| cmp/ltf.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` ROM FP calc LT |
| cmp/lti16.asm | PURE→dep | inherit | — | N | plain signed 16-bit < |
| cmp/lti32.asm | PURE→dep | inherit | EXX | N | plain signed 32-bit < |
| cmp/lti8.asm | PURE→dep | inherit | — | N | one-line include, no own code |
| cmp/nef.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` ROM FP calc NE |
| copy_attr.asm | ROM | rewrite | — | N | `FLAGS2`,`P_FLAG`,`ATTR_P`,`ATTR_T` sysvars; self-modifying `PRINT_MODE`/`INVERSE_MODE` opcode table shared with print.asm |
| draw.asm | HW (primary) + ROM (secondary) | rewrite | EXX AF' | Y | `__FASTPLOT` self-modifies `or/xor/and (hl)` and writes VRAM directly; `call __PIXEL_ADDR` = ROM `22ACh`; `COORDS EQU 5C7Dh`, `P_FLAG EQU 23697` |
| draw3.asm | ROM (primary, extreme) + HW (secondary via draw.asm) | rewrite | EXX AF' | Y | Inline ROM FP-calculator bytecode (`rst 28h` + `DEFB` calc opcodes) for sin/cos/rotation; `call 247Dh` (CD_PRMS1), `call 02D28h` (STACK-A); reads `COORDS` sysvar directly. Comment: "Ripped from the ZX Spectrum ROM" |
| error.asm | ROM | rewrite | — | Y | `rst 8` (Spectrum ROM error-trap RST vector); `ERR_NR EQU 23610` |
| f16tofreg.asm | PURE | inherit | EXX | N | includes only PURE files |
| flash.asm | ROM | rewrite | — | N | `ATTR_P`/`ATTR_T` sysvars, bit7 transparency |
| ftof16reg.asm | PURE | inherit | EXX | N | includes only PURE files |
| ftou32reg.asm | PURE | inherit | EXX | N | includes only PURE files |
| iload32.asm | PURE | inherit | — | N | plain register/HL-indirect load, no includes |
| iloadf.asm | PURE | inherit | — | N | plain register/HL-indirect load, no includes |
| in_screen.asm | PURE (error.asm only) | inherit (after attr.asm, sposn.asm) | — | N | own code only compares to `SCR_SIZE` const and calls `__STOP` (error.asm) |
| ink.asm | ROM | rewrite | — | N | `ATTR_P`/`ATTR_T`/`MASK_T` sysvars |
| inverse.asm | ROM | rewrite | — | N | `P_FLAG` sysvar via copy_attr.asm |
| io/keyboard/inkey.asm | ROM | rewrite | — | Y | `call KEY_SCAN`/`KEY_TEST`/`KEY_CODE` at `028Eh`/`031Eh`/`0333h` (abs ROM addrs <0x4000); assumes `D`=FLAGS sysvar |
| io/sound/beep.asm | ROM | rewrite | — | Y | `call 03F8h` (abs ROM BEEP entry) |
| io/sound/beeper.asm | ROM | rewrite | — | Y | `call 03B5h` (abs ROM BEEPER entry) |
| istore16.asm | PURE | inherit | — | N | plain HL-indirect store, no includes |
| italic.asm | ROM | rewrite | — | N | `FLAGS2` sysvar via copy_attr.asm |
| lddede.asm | PURE | inherit | — | N | plain register load; comment notes ROM has a similar routine but this one doesn't call it |
| letsubstr.asm | PURE | inherit | EXX AF' | N | pure heap/string logic |
| load.asm | ROM (primary) + HW (secondary) | rewrite | AF' | Y | `call 0562h` (ROM LD-BYTES); hardcoded ROM tape-message table `ld hl,09C0h`; `HEAD1/MEM0/TMP_FLAG/ERR_NR` sysvars; `ld a,r`/interrupt-timing trick for tape edges |
| loadstr.asm | PURE | inherit (error.asm reworked) | — | N | pure heap/string copy |
| math/acos.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` ; ROM CALC (comment explicit) |
| math/asin.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` ; ROM CALC |
| math/atan.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` ; ROM CALC |
| math/cos.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` ; ROM CALC |
| math/exp.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` ; ROM CALC |
| math/logn.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` ; ROM CALC |
| math/pow.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` + `defb 06h` (POW, ROM FP calc) |
| math/sin.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` ; ROM CALC (`defb 1Fh` SIN) |
| math/sqrt.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` ; ROM CALC |
| math/tan.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` ; ROM CALC |
| mem/alloc.asm | PURE (error.asm only) | inherit (error.asm reworked) | EXX | N | pure heap allocator; `jp __ERROR` only under `#ifdef __MEMORY_CHECK__` |
| mem/calloc.asm | PURE→dep | inherit (error.asm reworked) | — | N | pure zero-fill wrapper |
| mem/free.asm | PURE→dep | inherit | — | N | pure heap free/coalesce, no ROM/HW |
| mem/heapinit.asm | PURE | inherit | — | N | pure heap init, no ROM/HW |
| mem/memcopy.asm | PURE | inherit | — | N | pure memmove/memcpy (ldir/lddr) |
| mem/realloc.asm | PURE (error.asm only) | inherit (error.asm reworked) | EXX | N | pure heap realloc; includes error.asm only for transitive __ERROR (no direct use in this file) |
| neg16.asm | PURE | inherit | — | N | plain two's-complement negate |
| neg32.asm | PURE | inherit | — | N | plain two's-complement negate |
| negf.asm | ROM | copy: rst 28h→rst 30h | — | N | `rst 28h` + `defb 1Bh` (ROM FP-calculator NEGATE opcode) |
| ongoto.asm | PURE | inherit | — | N | plain jump-table dispatch, no includes |
| over.asm | ROM | rewrite | — | N | `FLAGS2`/`P_FLAG` sysvars |
| paper.asm | ROM | rewrite | — | N | `ATTR_P`/`ATTR_T`/`MASK_T` sysvars |
| pause.asm | ROM | rewrite | — | Y | `jp 1F3Dh` (ROM PAUSE_1) |
| pistore32.asm | PURE | inherit | — | N | only `#include once <store32.asm>` |
| ploadf.asm | PURE | inherit | — | N | only `#include once <iloadf.asm>` + trivial wrapper |
| plot.asm | HW (primary) + ROM (secondary) | rewrite | — | Y | direct VRAM pixel write w/ bitmask (`ld (hl),a`); `call PIXEL_ADDR` = ROM `22ACh`; `COORDS EQU 5C7Dh`, `P_FLAG EQU 23697` |
| print.asm | HW (primary) + ROM (secondary) | rewrite | EXX AF' IY | Y | direct VRAM char writer using Spectrum's interleaved-row layout (`inc h`); self-modifying `PRINT_MODE`/`INVERSE_MODE`; **ROM**: `CHARS`/`UDG` font-source sysvars, `TV_FLAG`/`FLAGS2`/`MEM0` sysvars, `bit 2,(iy+$47)`/`bit 4,(iy+$47)` IY-relative sysvar addressing, `PO_GR_1 EQU 0B38h` (ROM call), `__SCROLL_SCR EQU 0DFEh` (ROM SCROLL, when buffer-scroll disabled) |
| print_eol_attr.asm | PURE→dep | inherit (after attr.asm, bold.asm, bright.asm …) | — | N | just calls `PRINT_EOL` and `COPY_ATTR` |
| printf.asm | ROM | rewrite | — | Y | `rst 28h`+`defb 2Eh` (ROM STR$); `RECLAIM2 EQU 19E8h`; `STK_END EQU 5C65h`; `ATTR_T` sysvar |
| printf16.asm | PURE→dep | inherit (after attr.asm, bold.asm, bright.asm …) | — | N | pure fixed-point digit math; calls `__PRINTU16`/`__PRINT_DIGIT` chain |
| printi16.asm | PURE→dep | inherit (after attr.asm, bold.asm, bright.asm …) | — | N | pure div/mod digit extraction; calls `__PRINT_MINUS` chain |
| printi32.asm | PURE→dep | inherit (after attr.asm, bold.asm, bright.asm …) | EXX | N | same pattern, 32-bit |
| printi8.asm | PURE→dep | inherit (after attr.asm, bold.asm, bright.asm …) | — | N | same pattern, 8-bit |
| printnum.asm | PURE→dep | inherit (after attr.asm, bold.asm, bright.asm …) | — | N | file body is only `__PRINT_DIGIT EQU __PRINTCHAR` (alias) |
| printstr.asm | PURE→dep | inherit (after attr.asm, bold.asm, bright.asm …) | — | N | loop calling `__PRINTCHAR` per char |
| printu16.asm | PURE→dep | inherit (after attr.asm, bold.asm, bright.asm …) | — | N | only `#include once <printi16.asm>` |
| printu32.asm | PURE→dep | inherit (after attr.asm, bold.asm, bright.asm …) | — | N | only `#include once <printi32.asm>` |
| printu8.asm | PURE→dep | inherit (after attr.asm, bold.asm, bright.asm …) | — | N | only `#include once <printi8.asm>` |
| pstore32.asm | PURE | inherit | — | N | thin wrapper, `jp __STORE32` |
| pstoref.asm | PURE | inherit | — | N | thin wrapper, `jp __STOREF` |
| pstorestr.asm | PURE | inherit (error.asm reworked) | — | N | thin wrapper, `jp __STORE_STR` |
| pstorestr2.asm | PURE | inherit | — | N | thin wrapper, `jp __STORE_STR2` |
| pushf.asm | PURE | inherit | EXX | N | plain register/stack shuffle (`exx`,`push`/`pop`), no includes |
| random.asm | ROM | rewrite | — | Y | `FRAMES EQU 23672` sysvar used to seed PRNG when seed=0; RAND/RND math itself is pure |
| read_restore.asm | PURE (error.asm only) | inherit (error.asm reworked) | EXX AF' | N | only ROM contact is `__STOP`/`ERROR_InvalidArg` from error.asm |
| save.asm | ROM (primary) + HW (secondary) | rewrite | IY | Y | `CHAN_OPEN EQU 1601h`,`PO_MSG EQU 0C0Ah`,`WAIT_KEY EQU 15D4h`,`SA_BYTES EQU 04C6h`,`ROM_SAVE EQU 0970h` (ROM tape routines); `MEMBOT`/`ECHO_E` sysvars; `set 5,(iy+02h)`; **HW**: `out (0FEh),a` / `in a,(0FEh)` direct ULA port I/O, reads `BORDCR` @`5C48h` |
| set_pixel_addr_attr.asm | HW | rewrite | — | N | converts a VRAM pixel address to its attribute-cell address via Spectrum's `rrca,rrca,rrca; and 3` interleaved-bitmap formula |
| sgn.asm | PURE | inherit | — | N | plain sign-test logic, no includes |
| sgnf.asm | PURE | inherit | — | N | only `#include once <sgn.asm>` |
| sgnf16.asm | PURE | inherit | — | N | only `#include once <sgn.asm>` |
| sgni16.asm | PURE | inherit | — | N | only `#include once <sgn.asm>` |
| sgni32.asm | PURE | inherit | — | N | only `#include once <sgn.asm>` |
| sgni8.asm | PURE | inherit | — | N | plain sign-test logic, no includes |
| sgnu16.asm | PURE | inherit | — | N | plain, no includes |
| sgnu32.asm | PURE | inherit | — | N | plain, no includes |
| sgnu8.asm | PURE | inherit | — | N | plain, no includes |
| spectranet.inc | HW | rewrite | — | N | standalone optional constants for the Spectranet network peripheral (ports `$033B`/`$023B`, jump table `$3E00+`) — not included by default runtime |
| sposn.asm | HW (primary) + ROM (secondary) | rewrite | — | N | `__SET_SCR_PTR` computes screen address via Spectrum's interleaved-bitmap formula (`and 0F8h`, MOD-7 rotate `rrca×3`) |
| stackf.asm | ROM | rewrite | EXX | Y | `__FPSTACK_PUSH EQU 2AB6h`, `__FPSTACK_POP EQU 2BF1h` — fixed ROM FP-calculator-stack entry points |
| store32.asm | PURE | inherit | — | N | plain HL-indirect store, no includes |
| storef.asm | PURE | inherit | AF' | N | plain HL-indirect store, no includes |
| storestr.asm | PURE | inherit (error.asm reworked) | — | N | pure heap/pointer logic |
| storestr2.asm | PURE | inherit | — | N | pure heap/pointer logic |
| str.asm | ROM | rewrite | — | Y | `rst 28h`+`defb 2Eh` (ROM STR$); `RECLAIM2 EQU 19E8h`; `STK_END EQU 5C65h`; comment notes a ROM STR$ "BUG" workaround |
| strcat.asm | PURE | inherit (error.asm reworked) | EXX | N | pure heap/string concat |
| strcpy.asm | PURE | inherit (error.asm reworked) | — | N | pure heap/string copy/realloc |
| strictbool.asm | PURE | inherit | — | N | plain boolean normalize, no includes |
| string.asm | PURE | inherit | AF' | N | pure string compare (`__STRCMP`/`__STREQ`/etc.) |
| strlen.asm | PURE | inherit | — | N | plain HL-indirect length read, no includes |
| strslice.asm | PURE | inherit (error.asm reworked) | AF' | N | pure heap/string slicing |
| swap32.asm | PURE | inherit | — | N | plain stack shuffle, no includes |
| sysvars.asm | ROM | rewrite | — | Y | THIS FILE IS the Spectrum-sysvar map: `CHARS`(23606)/`UDG`(23675)/`COORDS`(23677)/`S_POSN`(23688)/`ATTR_P`(23693)/`ATTR_T`(23695)/`P_FLAG`(23697)/`MEM0`(23698)/`DFCC`(23684)/`DFCCL`(23686) etc. Own header: "mapped onto ZX Spectrum ROM VARS" |
| table_jump.asm | PURE | inherit | — | N | plain computed-jump helper, no includes |
| u32tofreg.asm | PURE | inherit | EXX | N | only `#include once <neg32.asm>` + pure FP-encode math |
| usr.asm | PURE | inherit | — | N | plain `call CALL_HL` via table_jump.asm |
| usr_str.asm | ROM | rewrite | AF' | N | `UDG EQU 23675` sysvar (font pointer); `ERR_NR` sysvar |
| val.asm | ROM (extreme) | rewrite | — | Y | `rst 28h`+`defb 1Dh` (ROM CALC VAL); `STK_STO_S EQU 2AB2h`; `call 16B0h` (SET_MIN); `RECLAIM1 EQU 6629`; `STKBOT`(23651)/`ERR_SP`(23613)/`CH_ADD`(23645) — BASIC-interpreter-internal sysvars; installs a custom ROM error handler via `ERR_SP` |

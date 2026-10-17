#!/usr/bin/env python3
"""prepare_media.py -- builds the media test/golden.mjs runs, with the repo's own
toolchain (zxbc via tools/cpcrun.py, mkdsk.py, tools/mkcpr.py), into
test/.media/ (git-ignored), and writes test/.media/manifest.json.

Each case is a program that asks for a screenshot with Shot("name") (the printer line
"\\x04SHOT name\\n", see tests/screens/lib/shot.bas) and the golden PNG CPCEC's native
build produced for it under `make test-cpcec`:

  plusdemo      tests/screens/plusdemo.bas as a bare-metal disc on the 6128 Plus
                (golden tests/screens/golden/cpcec-plus/plusdemo.png)
  mode1text     tests/screens/mode1text.bas, a firmware (AMSDOS RUN") disc on the Plus
  plusdemo_cpr  the plusdemo program as a cartridge (bare metal, own font), as the
                Phase 7 cartridges are; the same picture as the disc build
  starfall      Starfall Plus (PLUS_MUX, games/shooter/main.bas) title screen, disc

  plusdemo_cpr has no golden among the repo's: no test in `make test-cpcec` runs a cartridge
  picture, and the cartridge's picture differs from the disc build's (boot timing, own font).
  Its reference is test/golden/plusdemo_cpr.png, made by the NATIVE patched CPCEC
  (tools/cpcec/work/cpcec, `make cpcec`) from the very same .cpr:
  `python3 test/prepare_media.py --update-golden`.

    python3 test/prepare_media.py [--force] [--update-golden]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(REPO / "tools"))
sys.path.insert(0, str(REPO / "tests" / "screens"))
import cpcrun  # noqa: E402
import mkcpr  # noqa: E402
import run as screens  # noqa: E402  (spec(): REM SOURCE / REM ZXBC lines)

if "ZXBASIC" not in os.environ and not cpcrun.zxbasic_dir().exists():  # a git worktree: the sibling repo is next to the main checkout
    common = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--git-common-dir"], capture_output=True, text=True).stdout.strip()
    alt = (REPO / common).resolve().parent.parent / "zxbasic"
    if alt.exists():
        os.environ["ZXBASIC"] = str(alt)
OUT = HERE / ".media"
GOLD = REPO / "tests" / "screens" / "golden" / "cpcec-plus"
STAR_GOLD = REPO / "games" / "shooter" / "tests" / "golden" / "cpcec-plus"


def build_dsk(source: Path, zargs: list[str], dsk: Path, org: int | None = None) -> int:
    env = cpcrun.subprocess_env()
    binf = dsk.with_suffix(".bin")
    args = list(zargs)
    if org is not None:
        args = ["--org", hex(org), *args]
    o = cpcrun.compile_program(source, binf, args, env)
    cpcrun.pack_dsk(binf, dsk, cpcrun.amsdos_stem(source), env, o)
    return o


def build_cpr(source: Path, zargs: list[str], cpr: Path) -> None:
    env = cpcrun.subprocess_env()
    binf = cpr.with_suffix(".bin")
    if "CPC_BAREMETAL" not in zargs:
        zargs = ["-D", "CPC_BAREMETAL", *zargs]
    o = cpcrun.compile_program(source, binf, ["-D", "CPC_OWNFONT", *zargs], env)
    cpr.write_bytes(mkcpr.build_cpr(binf.read_bytes(), o))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--update-golden", action="store_true",
                    help="regenerate test/golden/plusdemo_cpr.png with the native patched CPCEC")
    ap.add_argument("--force", action="store_true", help="rebuild even if the media exist")
    args = ap.parse_args()
    OUT.mkdir(exist_ok=True)
    cases = []

    def want(name: str, f) -> Path:
        p = OUT / name
        if args.force or not p.exists():
            f(p)
        return p

    # plusdemo: disc, as `make test-cpcec` builds it (REM SOURCE / REM ZXBC in the test file)
    t = REPO / "tests" / "screens" / "plusdemo.bas"
    src, zargs = screens.spec(t)
    want("plusdemo.dsk", lambda p: build_dsk(src, zargs, p))
    cases.append(dict(name="plusdemo", media="plusdemo.dsk", kind="dsk", model=3, shot="plusdemo",
                      golden=str(GOLD / "plusdemo.png"), exact=True))
    # the same program as a cartridge
    want("plusdemo.cpr", lambda p: build_cpr(src, zargs, p))
    cases.append(dict(name="plusdemo_cpr", media="plusdemo.cpr", kind="cpr", model=3, shot="plusdemo",
                      golden=str(HERE / "golden" / "plusdemo_cpr.png"), exact=True))
    # firmware program on a disc
    t = REPO / "tests" / "screens" / "mode1text.bas"
    src, zargs = screens.spec(t)
    want("mode1text.dsk", lambda p: build_dsk(src, zargs, p))
    cases.append(dict(name="mode1text", media="mode1text.dsk", kind="dsk", model=3, shot="mode1text",
                      golden=str(GOLD / "mode1text.png"), exact=True))
    # Starfall Plus, multiplexed (bare-metal disc)
    star = REPO / "games" / "shooter" / "main.bas"
    sargs = ["-D", "CPC_BAREMETAL", "-D", "CPC_OWNFONT", "-D", "PLUS", "-D", "PLUS_MUX", "-D", "SHOT=60"]
    want("starfall.dsk", lambda p: build_dsk(star, sargs, p, org=0x40))
    cases.append(dict(name="starfall_title", media="starfall.dsk", kind="dsk", model=3, shot="title",
                      golden=str(STAR_GOLD / "title.png"), exact=True))
    if args.update_golden:
        native = Path(os.environ.get("CPCEC", REPO / "tools" / "cpcec" / "work" / "cpcec"))
        if not native.exists():  # a git worktree: the git-ignored work directory is in the main checkout
            common = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--git-common-dir"],
                                    capture_output=True, text=True).stdout.strip()
            native = (REPO / common).resolve().parent / "tools" / "cpcec" / "work" / "cpcec"
        if not native.exists():
            print(f"prepare_media: native CPCEC not found at {native} (make cpcec, or set CPCEC)", file=sys.stderr)
            return 1
        from PIL import Image
        with tempfile.TemporaryDirectory() as t:
            subprocess.run([str(native), "--headless", "--end-on-marker", "--printer", f"{t}/p.dat", "--max-frames", "3000",
                            "--shot-dir", t, "-m3", str(OUT / "plusdemo.cpr")], check=True, cwd=native.parent)
            (HERE / "golden").mkdir(exist_ok=True)
            Image.open(f"{t}/plusdemo.png").convert("RGB").save(HERE / "golden" / "plusdemo_cpr.png", optimize=True)
        print("wrote test/golden/plusdemo_cpr.png")
        # the power-on screens of the stock models after 200 frames, by the same native binary
        with tempfile.TemporaryDirectory() as t:
            for model, name in ((0, "464"), (1, "664"), (2, "6128")):
                subprocess.run([str(native), "--headless", "--max-frames", "260", "--shot", f"{t}/b.png", "--shot-at", "200",
                                f"-m{model}", *(["-k0"] if model < 2 else [])], cwd=native.parent, check=False)
                Image.open(f"{t}/b.png").convert("RGB").save(HERE / "golden" / f"boot_{name}.png", optimize=True)
        print("wrote test/golden/boot_{464,664,6128}.png")
    boots = [dict(name=f"boot_{n}", model=m, frames=200, golden=str(HERE / "golden" / f"boot_{n}.png"))
             for m, n in ((0, "464"), (1, "664"), (2, "6128"))]
    (OUT / "manifest.json").write_text(json.dumps(dict(cases=cases, boots=boots), indent=2))
    print(f"prepared {len(cases)} cases in {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

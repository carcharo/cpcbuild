#!/usr/bin/env python3
"""run.py -- Starfall's CPC tests, headless on the chips emulator.

  logic.bas     the game logic tests (null layer), both models: every
                "PASS name" line, no "FAIL", and DONE.
  variants      each runs as the firmware build (no label), as the bare-metal
                build (-D CPC_BAREMETAL: label 6128/bare/...) and as the bare
                build cold-started with no firmware (--cold: 6128/cold/...,
                the Phase 7 cartridge rehearsal).
  screenshots   the title screen (-D SHOT=60) and a gameplay frame
                (-D DEMO -D SHOT=170: the attract-mode player, fixed seed)
                of the real builds (6128: -D CPC6128, 464: -D CPC464), each
                compared pixel for pixel with golden/<model>/<name>.png (the
                bare builds against the same goldens: the same game state
                must give the same screen).
                A shot is the visible display, 768x272 RGB (chipsrun).

  --plus     Starfall Plus (-D PLUS, Phase 7) on Caprice32 instead of chips (the
             Plus has no chips emulator): the logic tests (logic.bas on the
             real runtime, plus_layer.bas on the real Plus layer: which
             hardware sprite shows what, read back from the ASIC) and the same
             two screenshots, as the 6128 Plus disc build (variant disc: the
             firmware build, `run"` from a disc) and as the cartridge (variant
             cart: -D CPC_BAREMETAL -D CPC_OWNFONT, mkcpr.py, Caprice32 boots
             the .cpr in place of the system cartridge). Goldens golden/plus/
             (Caprice32 renders: 768x540 with the border); the cartridge must
             match the disc build's shots. Not part of the default set (make
             test-plus runs it).

  --plus --emu cpcec
             the cartridge as shipped (-D PLUS_MUX: the alien formation on
             hardware sprites 10-15, re-positioned per row by raster handlers,
             Phase 7 stage 2) on CPCEC, which draws the Plus sprites per scan
             line (Caprice32 draws all sprites once per frame from their final
             registers, so it shows the multiplexed formation wrongly, by
             design: no Caprice32 goldens of the PLUS_MUX build; the --plus
             "cart" variant above is the same cartridge without PLUS_MUX and
             matches the disc build's goldens). plus_mux.bas (the handlers'
             work frame by frame, read back from the ASIC; the software
             fallback; 250 steps of the game) runs on CPCEC here and, because
             Caprice32 runs the same handlers, on Caprice32 under plain --plus.
             Goldens: golden/cpcec-plus/ (768x536, CPCEC's colours).

  --update   write the shots as the new goldens (firmware builds only; the
             bare builds must match them; with --plus the disc build's; with
             --plus --emu cpcec the PLUS_MUX shots')
On a mismatch the actual image and a diff image (differing pixels in red over
a dimmed copy) are written next to the golden. Exit status 0 if all passed.

Usage: run.py [--update] [--model 464|6128] [--variant fw|bare|cold] [-k PATTERN] [--timeout S]
       run.py --plus [--update] [--variant disc|cart] [-k PATTERN]
       run.py --plus --emu cpcec [--update] [-k PATTERN]
"""
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageChops

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
TOOLS = GAME.parent.parent / "tools"
CPCRUN = TOOLS / "cpcrun.py"
sys.path.insert(0, str(TOOLS))
import cpcrun as cpcrun_mod  # noqa: E402  (compile_program, run_emulator for the cartridge runs)
import mkcpr  # noqa: E402
GOLDEN = HERE / "golden"
MODELS = ("6128", "464")
VARIANTS = ("fw", "bare", "cold")   # firmware, bare-metal, bare-metal cold start
VFLAGS = {"fw": [], "bare": ["--bare"], "cold": ["--bare", "--cold"]}
ORG = "0x40"

# name -> extra zxbc defines
SHOTS = {
    "title": ["SHOT=60"],
    "play": ["DEMO", "SHOT=170"],
}


def vlabel(model: str, variant: str) -> str:
    return model if variant == "fw" else f"{model}/{variant}"


def cpcrun(prog: Path, model: str, defines: list[str], timeout: float, shot_dir: Path | None = None,
           variant: str = "fw"):
    cmd = [sys.executable, str(CPCRUN), str(prog), "--emu", "chips", "--model", model,
           "--org", ORG, "--timeout", str(timeout), *VFLAGS[variant]]
    if shot_dir:
        cmd += ["--shot-dir", str(shot_dir), "--quiet"]
    if prog.name == "main.bas":
        defines = [*defines, "NODISC"]   # chips has no disc (BankLoad would hang)
    for d in defines:
        cmd += ["--zxbc-arg=-D", f"--zxbc-arg={d}"]
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout * 4 + 120)


def logic_test(model: str, timeout: float, variant: str = "fw"):
    label = f"{vlabel(model, variant)}/logic"
    proc = cpcrun(HERE / "logic.bas", model, [], timeout, variant=variant)
    out = proc.stdout
    if proc.returncode != 0:
        return [("ERROR", label, f"cpcrun exit {proc.returncode}: {proc.stderr.strip()[-300:]}")]
    fails = re.findall(r"^FAIL.*$", out, re.M)
    passes = len(re.findall(r"^PASS", out, re.M))
    if fails:
        return [("FAIL", label, "; ".join(fails[:5]))]
    if "\nDONE" not in "\n" + out:
        return [("FAIL", label, "no DONE")]
    return [("PASS", label, f"{passes} checks")]


def shot_test(model: str, name: str, timeout: float, update: bool, variant: str = "fw"):
    label = f"{vlabel(model, variant)}/{name}"
    flag = "CPC464" if model == "464" else "CPC6128"
    with tempfile.TemporaryDirectory(prefix="starfall-") as tmp:
        proc = cpcrun(GAME / "main.bas", model, [flag, *SHOTS[name]], timeout, Path(tmp), variant)
        if proc.returncode != 0:
            return [("ERROR", label, f"cpcrun exit {proc.returncode}: {proc.stderr.strip()[-300:]}")]
        shots = sorted(Path(tmp).glob("*.png"))
        if not shots:
            return [("ERROR", label, "took no screenshot")]
        shot = shots[0]
        gold = GOLDEN / model / f"{name}.png"
        actual = gold.with_suffix(".actual.png")
        diff = gold.with_suffix(".diff.png")
        a = Image.open(shot).convert("RGB")
        if update:
            gold.parent.mkdir(parents=True, exist_ok=True)
            had = gold.exists()
            changed = (not had) or ImageChops.difference(a, Image.open(gold).convert("RGB")).getbbox() is not None
            if changed:
                a.save(gold, optimize=True)
            for f in (actual, diff):
                f.unlink(missing_ok=True)
            return [("UPDATED" if changed else "PASS", label, "new" if not had else ("changed" if changed else ""))]
        if not gold.exists():
            actual.parent.mkdir(parents=True, exist_ok=True)
            a.save(actual)
            return [("FAIL", label, f"no golden (run with --update); actual at {actual}")]
        g = Image.open(gold).convert("RGB")
        if a.size != g.size:
            a.save(actual)
            return [("FAIL", label, f"size {a.size} != golden {g.size}")]
        d = ImageChops.difference(a, g).convert("L").point(lambda v: 255 if v else 0)
        n = d.histogram()[255]
        if n == 0:
            for f in (actual, diff):
                f.unlink(missing_ok=True)
            return [("PASS", label, "")]
        a.save(actual)
        dim = a.point(lambda v: v // 4)
        dim.paste(Image.new("RGB", a.size, (255, 0, 0)), mask=d)
        dim.save(diff)
        return [("FAIL", label, f"{n} pixels differ; see {actual.name} and {diff.name} in {gold.parent}")]


# ---- Starfall Plus (Caprice32; chips has no Plus) ---------------------------

PLUS_VARIANTS = ("disc", "cart")
PLUS_FLAGS = {"disc": [], "cart": ["CPC_BAREMETAL", "CPC_OWNFONT"]}


def plus_wait(steps: int, variant: str) -> int:
    """CAP32_DELAYs (42 frames each) to wait for a shot after `steps` logic steps
    (2 frames each): the disc's load time (the emulated drive is slow) and a
    margin, then more: the program holds its picture, so waiting longer is safe."""
    return (2 * steps) // 42 + (14 if variant == "disc" else 6)


def build_cart(bas: Path, defines: list[str], tmp: Path) -> Path:
    """Compiles bas as a bare cartridge program (-D CPC_BAREMETAL -D CPC_OWNFONT) and
    wraps it with mkcpr.py. Returns the .cpr."""
    env = cpcrun_mod.subprocess_env()
    args = ["--org", ORG]
    for d in [*PLUS_FLAGS["cart"], *defines]:
        args += ["-D", d]
    binf = tmp / "prog.bin"
    org = cpcrun_mod.compile_program(bas, binf, args, env)
    cpr = tmp / "prog.cpr"
    cpr.write_bytes(mkcpr.build_cpr(binf.read_bytes(), org))
    return cpr


def plus_run(bas: Path, variant: str, defines: list[str], timeout: float, shot_dir: Path | None = None,
             shot_wait: int = 0) -> tuple[int, str]:
    """Runs bas on Caprice32's 6128 Plus: from a disc (variant disc) or as a cartridge
    (cart). Returns (cpcrun-style exit status, the printer text up to the END marker)."""
    env = cpcrun_mod.subprocess_env()
    with tempfile.TemporaryDirectory(prefix="starfall-plus-") as t:
        tmp = Path(t)
        printer = tmp / "printer.dat"
        try:
            if variant == "cart":
                cpr = build_cart(bas, defines + (["SHOT_HOLD"] if shot_dir else []), tmp)
                cpcrun_mod.run_emulator(None, "", printer, timeout, env, "plus", None, False, cpr,
                                        shot_dir, shot_wait)
            else:
                binf, dsk = tmp / "prog.bin", tmp / "prog.dsk"
                args = ["--org", ORG] + [x for d in [*defines, *(["SHOT_HOLD"] if shot_dir else [])] for x in ("-D", d)]
                org = cpcrun_mod.compile_program(bas, binf, args, env)
                stem = cpcrun_mod.amsdos_stem(bas)
                cpcrun_mod.pack_dsk(binf, dsk, stem, env, org)
                cpcrun_mod.run_emulator(dsk, stem, printer, timeout, env, "plus", None, False, None,
                                        shot_dir, shot_wait)
        except cpcrun_mod.TimeoutHit:
            return 2, ""
        except cpcrun_mod.BuildError as e:
            return 1, str(e)
        text = printer.read_bytes().decode("latin-1") if printer.exists() else ""
    text = text.replace("\x04STATE\n", "")
    if cpcrun_mod.END_MARKER in text:
        return 0, text.split(cpcrun_mod.END_MARKER, 1)[0]
    return (0 if shot_dir else 4), text


def plus_logic_test(variant: str, src: str, timeout: float):
    label = f"plus/{variant}/{src.removesuffix('.bas')}"
    defines = ["PLUS"] if src == "plus_layer.bas" else []
    code, out = plus_run(HERE / src, variant, defines, timeout)
    if code != 0:
        return [("ERROR", label, f"exit {code}: {out.strip()[-200:]}")]
    fails = re.findall(r"^FAIL.*$", out, re.M)
    passes = len(re.findall(r"^PASS", out, re.M))
    if fails:
        return [("FAIL", label, "; ".join(fails[:5]))]
    if "\nDONE" not in "\n" + out:
        return [("FAIL", label, "no DONE")]
    return [("PASS", label, f"{passes} checks")]


def plus_shot_test(variant: str, name: str, timeout: float, update: bool):
    label = f"plus/{variant}/{name}"
    defines = ["PLUS", *SHOTS[name]]
    steps = int([d for d in defines if d.startswith("SHOT=")][0][5:])
    with tempfile.TemporaryDirectory(prefix="starfall-plus-shot-") as t:
        shot_dir = Path(t)
        code, out = plus_run(GAME / "main.bas", variant, defines, timeout, shot_dir, plus_wait(steps, variant))
        if code != 0:
            return [("ERROR", label, f"exit {code}: {out.strip()[-200:]}")]
        if not re.search(r"\x04SHOT ", out):
            return [("ERROR", label, "no SHOT line: the game did not reach the shot (raise the wait)")]
        shots = sorted(shot_dir.glob("*.png"))
        if len(shots) != 1:
            return [("ERROR", label, f"{len(shots)} screenshots")]
        a = Image.open(shots[0]).convert("RGB")
    gold = GOLDEN / "plus" / f"{name}.png"
    actual = gold.with_suffix(".actual.png")
    diff = gold.with_suffix(".diff.png")
    if update:
        if variant != "disc":
            return [("PASS", label, "goldens come from the disc build")]
        gold.parent.mkdir(parents=True, exist_ok=True)
        had = gold.exists()
        changed = (not had) or ImageChops.difference(a, Image.open(gold).convert("RGB")).getbbox() is not None
        if changed:
            a.save(gold, optimize=True)
        for f in (actual, diff):
            f.unlink(missing_ok=True)
        return [("UPDATED" if changed else "PASS", label, "new" if not had else ("changed" if changed else ""))]
    if not gold.exists():
        actual.parent.mkdir(parents=True, exist_ok=True)
        a.save(actual)
        return [("FAIL", label, f"no golden (run with --update); actual at {actual}")]
    g = Image.open(gold).convert("RGB")
    if a.size != g.size:
        a.save(actual)
        return [("FAIL", label, f"size {a.size} != golden {g.size}")]
    d = ImageChops.difference(a, g).convert("L").point(lambda v: 255 if v else 0)
    n = d.histogram()[255]
    if n == 0:
        for f in (actual, diff):
            f.unlink(missing_ok=True)
        return [("PASS", label, "")]
    a.save(actual.with_name(f"{name}.{variant}.actual.png"))
    dim = a.point(lambda v: v // 4)
    dim.paste(Image.new("RGB", a.size, (255, 0, 0)), mask=d)
    dim.save(diff.with_name(f"{name}.{variant}.diff.png"))
    return [("FAIL", label, f"{n} pixels differ; see {name}.{variant}.actual.png and .diff.png in {gold.parent}")]


# ---- Starfall Plus, multiplexed formation (-D PLUS_MUX) ----------------------

MUX_SHOTS = {
    "title": ["SHOT=60"],
    "play": ["DEMO", "SHOT=170"],
    "late": ["DEMO", "SHOT=500"],     # the formation has stepped down several times
}
MUX_GOLDEN = GOLDEN / "cpcec-plus"
MUX_DEFINES = ["PLUS", "PLUS_MUX"]


def cpcec_run(bas: Path, defines: list[str], timeout: float, shot_dir: Path | None = None):
    cmd = [sys.executable, str(CPCRUN), str(bas), "--emu", "cpcec", "--model", "plus", "--bare",
           "--org", ORG, "--timeout", str(timeout)]
    if shot_dir:
        cmd += ["--shot-dir", str(shot_dir), "--quiet"]
    for d in [*PLUS_FLAGS["cart"], *defines]:
        cmd += ["--zxbc-arg=-D", f"--zxbc-arg={d}"]
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout * 4 + 120)


def mux_logic_test(emu: str, timeout: float):
    label = f"plus-mux/{emu}/plus_mux"
    defines = [*MUX_DEFINES, "MX_TEST"]
    if emu == "cap32":
        code, out = plus_run(HERE / "plus_mux.bas", "cart", defines, max(timeout, 150))
    else:
        proc = cpcec_run(HERE / "plus_mux.bas", defines, max(timeout, 150))
        code, out = proc.returncode, proc.stdout
        if code != 0:
            out = out + proc.stderr
    if code != 0:
        return [("ERROR", label, f"exit {code}: {out.strip()[-200:]}")]
    fails = re.findall(r"^FAIL.*$", out, re.M)
    passes = len(re.findall(r"^PASS", out, re.M))
    if fails:
        return [("FAIL", label, "; ".join(fails[:5]))]
    if "\nDONE" not in "\n" + out:
        return [("FAIL", label, "no DONE")]
    return [("PASS", label, f"{passes} checks")]


def mux_shot_test(name: str, timeout: float, update: bool):
    label = f"plus-mux/cpcec/{name}"
    with tempfile.TemporaryDirectory(prefix="starfall-mux-") as t:
        proc = cpcec_run(GAME / "main.bas", [*MUX_DEFINES, *MUX_SHOTS[name]], timeout, Path(t))
        if proc.returncode != 0:
            return [("ERROR", label, f"cpcrun exit {proc.returncode}: {proc.stderr.strip()[-300:]}")]
        shots = sorted(Path(t).glob("*.png"))
        if not shots:
            return [("ERROR", label, "took no screenshot")]
        a = Image.open(shots[0]).convert("RGB")
    gold = MUX_GOLDEN / f"{name}.png"
    actual = gold.with_suffix(".actual.png")
    diff = gold.with_suffix(".diff.png")
    if update:
        gold.parent.mkdir(parents=True, exist_ok=True)
        had = gold.exists()
        changed = (not had) or ImageChops.difference(a, Image.open(gold).convert("RGB")).getbbox() is not None
        if changed:
            a.save(gold, optimize=True)
        for f in (actual, diff):
            f.unlink(missing_ok=True)
        return [("UPDATED" if changed else "PASS", label, "new" if not had else ("changed" if changed else ""))]
    if not gold.exists():
        actual.parent.mkdir(parents=True, exist_ok=True)
        a.save(actual)
        return [("FAIL", label, f"no golden (run with --update); actual at {actual}")]
    g = Image.open(gold).convert("RGB")
    if a.size != g.size:
        a.save(actual)
        return [("FAIL", label, f"size {a.size} != golden {g.size}")]
    d = ImageChops.difference(a, g).convert("L").point(lambda v: 255 if v else 0)
    n = d.histogram()[255]
    if n == 0:
        for f in (actual, diff):
            f.unlink(missing_ok=True)
        return [("PASS", label, "")]
    a.save(actual)
    dim = a.point(lambda v: v // 4)
    dim.paste(Image.new("RGB", a.size, (255, 0, 0)), mask=d)
    dim.save(diff)
    return [("FAIL", label, f"{n} pixels differ; see {actual.name} and {diff.name} in {gold.parent}")]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--update", action="store_true")
    ap.add_argument("--model", choices=MODELS, action="append")
    ap.add_argument("--variant", choices=(*VARIANTS, *PLUS_VARIANTS), action="append")
    ap.add_argument("--plus", action="store_true", help="Starfall Plus on Caprice32 (see above)")
    ap.add_argument("--emu", choices=("cap32", "cpcec"), default="cap32",
                    help="with --plus: cpcec runs the PLUS_MUX cartridge's tests and goldens")
    ap.add_argument("-k", dest="pattern", default=None)
    ap.add_argument("-j", dest="jobs", type=int, default=4)
    ap.add_argument("--timeout", type=float, default=60.0)
    args = ap.parse_args()

    jobs = []
    if args.plus and args.emu == "cpcec":
        jobs.append(lambda: mux_logic_test("cpcec", args.timeout))
        for name in MUX_SHOTS:
            jobs.append(lambda name=name: mux_shot_test(name, args.timeout, args.update))
    elif args.plus:
        if not args.update:
            jobs.append(lambda: mux_logic_test("cap32", args.timeout))
        for v in [x for x in (args.variant or PLUS_VARIANTS) if x in PLUS_VARIANTS]:
            if not args.update:
                for src in ("logic.bas", "plus_layer.bas"):
                    jobs.append(lambda v=v, src=src: plus_logic_test(v, src, args.timeout))
            for name in SHOTS:
                jobs.append(lambda v=v, name=name: plus_shot_test(v, name, args.timeout, args.update))
    for m in ([] if args.plus else (args.model or MODELS)):
        for v in (["fw"] if args.update else [x for x in (args.variant or VARIANTS) if x in VARIANTS]):
            if not args.update:
                jobs.append(lambda m=m, v=v: logic_test(m, args.timeout, v))
            for name in SHOTS:
                jobs.append(lambda m=m, name=name, v=v: shot_test(m, name, args.timeout, args.update, v))
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = [pool.submit(j) for j in jobs]
        results = [r for f in futures for r in f.result()]
    results.sort(key=lambda r: r[1])
    if args.pattern:
        results = [r for r in results if args.pattern in r[1]]
    for status, name, detail in results:
        print(f"{status:8} {name}" + (f"  ({detail})" if detail else ""))
    bad = sum(1 for s, _, _ in results if s in ("FAIL", "ERROR"))
    print(f"\n{len(results) - bad}/{len(results)} ok, {bad} failed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

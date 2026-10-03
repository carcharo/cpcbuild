#!/usr/bin/env python3
"""run.py -- the Starfall Spectrum layer tests (games/shooter/tests/zx/*.bas) on chips.

Reuses tests/zx/run.py (same header lines: MODELS, TYPE, ZXBC, TIMEOUT, XFAIL,
same golden scheme) with this directory's tests and goldens, which are named
golden/<model>/<test>__<shot>.png. One addition: a "REM TYPE: SPACE" line types
a space. Usage: run.py [--update] [-k PATTERN] ...
"""
import importlib.util
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
spec = importlib.util.spec_from_file_location("zxrunner", REPO / "tests" / "zx" / "run.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
base.HERE = HERE
base.GOLDEN = HERE / "golden"

_header = base.header


def header(bas):
    h = _header(bas)
    h["type"] = [" " if t == "SPACE" else t for t in h["type"]]
    return h


base.header = header

# Goldens are named <test>__<shot>.png: the game's own shot names ("title",
# "play") are the same for every test that runs the game.
_local = threading.local()
_run_one = base.run_one
_compare = base.compare_shots


def run_one(bas, model, update, negative):
    _local.test = bas.stem
    return _run_one(bas, model, update, negative)


def compare_shots(shots, model, update):
    renamed = []
    for shot in shots:
        new = shot.with_name(f"{_local.test}__{shot.name}")
        shot.rename(new)
        renamed.append(new)
    return _compare(renamed, model, update)


base.run_one = run_one
base.compare_shots = compare_shots

if __name__ == "__main__":
    sys.exit(base.main())

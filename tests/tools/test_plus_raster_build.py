"""Build-time checks for the cpcplus library (Phase 7 P3): RasterIntAt/Off/Clear are
bare-mode only. A firmware-mode build that uses them must fail with an undefined label
whose name says it needs bare mode (not a file-level #error, which would fire for every
program that includes cpcplus.bas); a bare build must succeed, and a firmware build that
doesn't use them must succeed too.

Compiles with the zxbasic fork's zxbc (`poetry run zxbc` in $ZXBASIC or ../zxbasic);
skipped if that checkout isn't there. python3 -m unittest discover -s tests/tools"""
from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ZXB = Path(os.environ.get("ZXBASIC", ROOT.parent / "zxbasic"))

USES = """#include <cpc.bas>
#include <cpcplus/cpcplus.bas>
RasterIntAt(100, 0)
RasterIntOff(100)
RasterIntClear()
"""
PLAIN = """#include <cpc.bas>
#include <cpcplus/cpcplus.bas>
ScrollFine(1, 1)
SplitScreen(96, $4000)
SplitOff()
SetPalette12(0, $0123)
"""


def zxbc(src: str, *flags: str):
    with tempfile.TemporaryDirectory() as d:
        bas = Path(d) / "t.bas"
        bas.write_text(src)
        proc = subprocess.run(
            ["poetry", "run", "zxbc", "--arch", "cpc", "-I", str(ROOT / "lib"), *flags, "-o", str(Path(d) / "t.bin"), str(bas)],
            cwd=ZXB, capture_output=True, text=True, timeout=300,
        )
        return proc.returncode, proc.stdout + proc.stderr


@unittest.skipUnless((ZXB / "pyproject.toml").exists(), "zxbasic checkout not found")
class RasterBuild(unittest.TestCase):
    def test_firmware_refuses_raster(self):
        code, out = zxbc(USES)
        self.assertNotEqual(code, 0)
        self.assertIn("RasterIntAt_needs_bare_mode__build_with_D_CPC_BAREMETAL", out)
        self.assertIn("RasterIntOff_needs_bare_mode__build_with_D_CPC_BAREMETAL", out)
        self.assertIn("RasterIntClear_needs_bare_mode__build_with_D_CPC_BAREMETAL", out)

    def test_bare_builds_raster(self):
        code, out = zxbc(USES, "-D", "CPC_BAREMETAL")
        self.assertEqual(code, 0, out)

    def test_firmware_builds_without_raster(self):
        code, out = zxbc(PLAIN)
        self.assertEqual(code, 0, out)
        code, out = zxbc(PLAIN, "-D", "CPC_BAREMETAL")
        self.assertEqual(code, 0, out)


if __name__ == "__main__":
    unittest.main()

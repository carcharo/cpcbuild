"""Build-time checks for the cpcplus library (Phase 7 P3): RasterIntAt/Off/Move/Clear are
bare-mode only. A firmware-mode build that uses them must fail with an undefined label
whose name says it needs bare mode (not a file-level #error, which would fire for every
program that includes cpcplus.bas); a bare build must succeed, and a firmware build that
doesn't use them must succeed too.

Compiles with cpcbas ($CPCBAS, or the sibling checkout, see tools/cpcrun.py); skipped if
it is not built. python3 -m unittest discover -s tests/tools"""
from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cpcbas_check  # noqa: E402
from cpcrun import subprocess_env  # noqa: E402

USES = """#include <cpc.bas>
#include <cpcplus/cpcplus.bas>
RasterIntAt(100, 0)
DIM ok AS UBYTE
ok = RasterIntMove(110, 120)
RasterIntOff(120)
RasterIntClear()
"""
PLAIN = """#include <cpc.bas>
#include <cpcplus/cpcplus.bas>
ScrollFine(1, 1)
SplitScreen(96, &4000)
SplitOff()
SetPalette12(0, &0123)
"""


def cpcbas(src: str, *flags: str):
    with tempfile.TemporaryDirectory() as d:
        bas = Path(d) / "t.bas"
        bas.write_text(src)
        proc = subprocess.run(
            ["node", str(cpcbas_check.cli()), *flags, "-o", str(Path(d) / "t.bin"), str(bas)],
            env=subprocess_env(), capture_output=True, text=True, timeout=300,
        )
        return proc.returncode, proc.stdout + proc.stderr


@unittest.skipUnless(cpcbas_check.available(), "cpcbas is not built")
class RasterBuild(unittest.TestCase):
    def test_firmware_refuses_raster(self):
        code, out = cpcbas(USES)
        self.assertNotEqual(code, 0)
        self.assertIn("RasterIntAt_needs_bare_mode__build_with_D_CPC_BAREMETAL", out)
        self.assertIn("RasterIntOff_needs_bare_mode__build_with_D_CPC_BAREMETAL", out)
        self.assertIn("RasterIntMove_needs_bare_mode__build_with_D_CPC_BAREMETAL", out)
        self.assertIn("RasterIntClear_needs_bare_mode__build_with_D_CPC_BAREMETAL", out)

    def test_bare_builds_raster(self):
        code, out = cpcbas(USES, "-D", "CPC_BAREMETAL")
        self.assertEqual(code, 0, out)

    def test_firmware_builds_without_raster(self):
        code, out = cpcbas(PLAIN)
        self.assertEqual(code, 0, out)
        code, out = cpcbas(PLAIN, "-D", "CPC_BAREMETAL")
        self.assertEqual(code, 0, out)


if __name__ == "__main__":
    unittest.main()

"""palette_check.py's generated programs are CPC BASIC that cpcbas compiles (stdlib unittest):
python3 -m unittest discover -s tests/tools. Skipped when cpcbas is not built."""
from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
import cpcbas_check  # noqa: E402
import cpcrun  # noqa: E402
import palette_check  # noqa: E402

# the screen tests' Shot, as far as the programs use it
SHOT_STUB = "SUB Shot(name AS STRING)\nEND SUB\n"


@unittest.skipUnless(cpcbas_check.available(), "cpcbas is not built")
class TestPaletteCheckPrograms(unittest.TestCase):
    def compile(self, text: str):
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "p.bas"
            src.write_text(text)
            p = subprocess.run(["node", str(cpcbas_check.cli()), str(src), "-o", str(Path(d) / "p.bin")],
                               env=cpcrun.subprocess_env(), capture_output=True, text=True, timeout=300)
            return p.returncode, p.stdout + p.stderr

    def test_typed_q_programs_compile(self):
        for path in ("fw", "hw", "lib"):
            with self.subTest(path):
                text = palette_check.program_text(path, False)
                self.assertNotIn("WaitVsync", text)
                rc, out = self.compile(text)
                self.assertEqual(rc, 0, out)

    def test_chips_programs_compile(self):
        with tempfile.TemporaryDirectory() as d:
            stub = Path(d) / "shot.bas"
            stub.write_text(SHOT_STUB)
            for path in ("fw", "hw", "lib"):
                with self.subTest(path):
                    rc, out = self.compile(palette_check.program_text(path, True, stub))
                    self.assertEqual(rc, 0, out)


if __name__ == "__main__":
    unittest.main()

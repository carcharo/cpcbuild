"""CPC Plus modes of tools/img2cpc.py."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_img2cpc import Tmp, img2cpc  # noqa: E402


def sheet(cells, colour_at):
    return [[colour_at(x, y) for x in range(16 * cells)] for y in range(16)]


class Plus(Tmp):
    def test_sprite_basic(self):
        T = (0, 0, 0, 0)
        red, grn = (0xFF, 0, 0), (0, 0x88, 0x11)
        rows = sheet(2, lambda x, y: T if x == 0 else (red if x < 16 else grn))
        png = self.png("s.png", rows)
        arrays, consts, _ = self.run_tool("--plus-sprite", png, "--name", "S")[:3]
        self.assertEqual(len(arrays["S"]), 512)
        self.assertEqual(arrays["S"][0], 0)
        self.assertEqual(arrays["S"][1], 1)
        self.assertEqual(arrays["S"][256 + 1], 2)
        self.assertEqual(consts["S_FRAMES"], 2)
        self.assertEqual(consts["S_SIZE"], 256)
        pal = arrays["S_pal"]
        self.assertEqual(len(pal), 30)
        self.assertEqual(pal[:4], [0xF0, 0x00, 0x01, 0x08])
        self.assertEqual(pal[4:], [0] * 26)

    def test_packed(self):
        rows = sheet(1, lambda x, y: (255, 255, 255) if x % 2 else (0, 0, 255))
        png = self.png("p.png", rows)
        arrays = self.run_tool("--plus-sprite", "--packed", png, "--name", "P")[0]
        self.assertEqual(len(arrays["P"]), 128)
        self.assertEqual(arrays["P"][0], 0x12)  # left pixel high nibble
        self.assertEqual(arrays["P_pal"][:4], [0x0F, 0x00, 0xFF, 0x0F])

    def test_too_many_colours(self):
        rows = sheet(1, lambda x, y: (x * 17, 0, 0))
        png = self.png("m.png", rows)
        self.assertIn("16 distinct", self.fails("--plus-sprite", png))
        # with --palette: nearest
        arrays = self.run_tool("--plus-sprite", png, "--palette", "000,F00")[0]
        self.assertEqual(arrays["m"][0], 1)
        self.assertEqual(arrays["m"][15], 2)

    def test_bad_size(self):
        png = self.png("b.png", [[(1, 2, 3)] * 8] * 8)
        self.assertIn("16x16", self.fails("--plus-sprite", png))

    def test_palette(self):
        png = self.png("pl.png", [[(0x11 * x, 0x22, 0x33) for x in range(16)]])
        arrays = self.run_tool("--plus-palette", png, "--name", "Z")[0]
        self.assertEqual(len(arrays["Z_pal"]), 32)
        self.assertEqual(arrays["Z_pal"][2:4], [0x13, 0x02])
        self.assertEqual(arrays["Z_pal"][30:32], [0xF3, 0x02])

    def test_bin_and_asm(self):
        rows = sheet(1, lambda x, y: (255, 0, 0))
        png = self.png("a.png", rows)
        out = self.dir / "a.bin"
        self.assertEqual(img2cpc.main(["--plus-sprite", str(png), "--plus-format", "bin", "-o", str(out)]), 0)
        self.assertEqual(out.read_bytes(), bytes([1]) * 256)
        self.assertEqual((self.dir / "a.pal").read_bytes(), bytes([0xF0, 0] + [0] * 28))
        text = self.run_tool("--plus-sprite", png, "--plus-format", "asm", "--name", "A")[2]
        self.assertIn("A_pal:", text)
        self.assertIn("A_SIZE EQU 256", text)


if __name__ == "__main__":
    unittest.main()

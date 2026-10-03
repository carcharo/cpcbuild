"""Unit tests for tools/img2cpc.py (stdlib unittest):
python3 -m unittest discover -s tests/tools"""
from __future__ import annotations

import contextlib
import io
import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
import img2cpc  # noqa: E402
from PIL import Image  # noqa: E402

BLACK = (0, 0, 0)
BLUE = (0, 0, 255)      # firmware 2
RED = (255, 0, 0)       # firmware 6
GREEN = (0, 255, 0)     # firmware 18
WHITE = (255, 255, 255)  # firmware 26


class Tmp(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.dir = Path(self._td.name)
        self.addCleanup(self._td.cleanup)

    def png(self, name, rows, size=None):
        """rows: list of lists of (r,g,b) or (r,g,b,a)."""
        h, w = len(rows), len(rows[0])
        im = Image.new("RGBA", (w, h))
        for y, row in enumerate(rows):
            for x, p in enumerate(row):
                im.putpixel((x, y), p if len(p) == 4 else (*p, 255))
        path = self.dir / name
        im.save(path)
        return path

    def run_tool(self, *argv):
        """Returns (parsed arrays, consts, text)."""
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = img2cpc.main([str(a) for a in argv])
        self.assertEqual(rc, 0)
        return parse_bas(out.getvalue()) + (out.getvalue(),)

    def fails(self, *argv):
        err = io.StringIO()
        with self.assertRaises(SystemExit) as cm, contextlib.redirect_stderr(err):
            img2cpc.main([str(a) for a in argv])
        return str(cm.exception.code) + err.getvalue()


def parse_bas(text):
    arrays, consts = {}, {}
    for m in re.finditer(r"DIM (\w+)\((\d+)\) AS UBYTE => \{ _\n(.*?)\n\}", text, re.S):
        vals = [int(v[1:], 16) for v in re.findall(r"\$[0-9A-F]{2}", m.group(3))]
        assert len(vals) == int(m.group(2)) + 1
        arrays[m.group(1)] = vals
    for m in re.finditer(r"CONST (\w+) AS \w+ = (\d+)", text):
        consts[m.group(1)] = int(m.group(2))
    return arrays, consts


class TestEncoding(unittest.TestCase):
    def test_mode0_pen_bytes(self):
        enc = img2cpc.encode_byte
        self.assertEqual(enc(0, [1, 1]), 0xC0)
        self.assertEqual(enc(0, [2, 2]), 0x0C)
        self.assertEqual(enc(0, [4, 4]), 0x30)
        self.assertEqual(enc(0, [8, 8]), 0x03)
        self.assertEqual(enc(0, [15, 15]), 0xFF)

    def test_mode0_pixel_masks(self):
        self.assertEqual(img2cpc.pixel_mask(0, 0), 0xAA)
        self.assertEqual(img2cpc.pixel_mask(0, 1), 0x55)
        for pen in range(1, 16):
            self.assertEqual(img2cpc.encode_byte(0, [pen, 0]) & 0x55, 0)
            self.assertEqual(img2cpc.encode_byte(0, [0, pen]) & 0xAA, 0)

    def test_mode0_each_pixel(self):
        self.assertEqual(img2cpc.encode_byte(0, [1, 0]), 0x80)
        self.assertEqual(img2cpc.encode_byte(0, [0, 1]), 0x40)
        self.assertEqual(img2cpc.encode_byte(0, [2, 0]), 0x08)
        self.assertEqual(img2cpc.encode_byte(0, [0, 2]), 0x04)
        self.assertEqual(img2cpc.encode_byte(0, [4, 0]), 0x20)
        self.assertEqual(img2cpc.encode_byte(0, [8, 0]), 0x02)
        self.assertEqual(img2cpc.encode_byte(0, [0, 8]), 0x01)

    def test_mode1(self):
        enc = img2cpc.encode_byte
        self.assertEqual(enc(1, [1, 1, 1, 1]), 0xF0)
        self.assertEqual(enc(1, [2, 2, 2, 2]), 0x0F)
        self.assertEqual(enc(1, [3, 3, 3, 3]), 0xFF)
        self.assertEqual(enc(1, [1, 0, 0, 0]), 0x80)
        self.assertEqual(enc(1, [0, 0, 0, 2]), 0x01)
        self.assertEqual(enc(1, [0, 2, 0, 0]), 0x04)

    def test_mode2(self):
        enc = img2cpc.encode_byte
        self.assertEqual(enc(2, [1] * 8), 0xFF)
        self.assertEqual(enc(2, [1, 0, 0, 0, 0, 0, 0, 1]), 0x81)
        self.assertEqual(enc(2, [0, 1, 0, 0, 0, 0, 0, 0]), 0x40)

    def test_firmware_colours(self):
        self.assertEqual(img2cpc.nearest_fw(BLACK), 0)
        self.assertEqual(img2cpc.nearest_fw(BLUE), 2)
        self.assertEqual(img2cpc.nearest_fw(RED), 6)
        self.assertEqual(img2cpc.nearest_fw(GREEN), 18)
        self.assertEqual(img2cpc.nearest_fw(WHITE), 26)
        self.assertEqual(img2cpc.nearest_fw((0x80, 0x80, 0x80)), 13)
        # exactly between 0x00 and 0x80 -> lower level (lower number)
        self.assertEqual(img2cpc.nearest_fw((0x40, 0, 0)), 0)


class TestSprites(Tmp):
    def test_mode0_unmasked_and_auto_palette(self):
        p = self.png("a.png", [[RED, GREEN, BLUE, RED]])
        arr, c, _ = self.run_tool("--mode", 0, "--name", "s", p)
        # pens by first appearance: red 0, green 1, blue 2
        self.assertEqual(arr["s_pal"], [6, 18, 2])
        self.assertEqual(c["s_PENS"], 3)
        self.assertEqual(arr["s"], [img2cpc.encode_byte(0, [0, 1]), img2cpc.encode_byte(0, [2, 0])])
        self.assertEqual((c["s_W"], c["s_H"], c["s_FRAMES"], c["s_SIZE"]), (2, 1, 1, 2))

    def test_mode1_rows_top_first(self):
        p = self.png("b.png", [[WHITE] * 4, [BLACK] * 4])
        arr, c, _ = self.run_tool("--mode", 1, "--name", "s", p)
        self.assertEqual(arr["s_pal"], [26, 0])
        # white is pen 0 here (first appearance), black pen 1
        self.assertEqual(arr["s"], [0x00, 0xF0])

    def test_mode2(self):
        p = self.png("c.png", [[BLACK, WHITE, WHITE, BLACK, BLACK, BLACK, BLACK, WHITE]])
        arr, c, _ = self.run_tool("--mode", 2, "--name", "s", "--pen0", 0, p)
        self.assertEqual(arr["s_pal"], [0, 26])
        self.assertEqual(arr["s"], [0b01100001])
        self.assertEqual(c["s_W"], 1)

    def test_pen0_option(self):
        p = self.png("d.png", [[RED, GREEN]])
        arr, c, _ = self.run_tool("--mode", 0, "--name", "s", "--pen0", 0, p)
        self.assertEqual(arr["s_pal"], [0, 6, 18])
        arr, c, _ = self.run_tool("--mode", 0, "--name", "s", "--pen0", 18, p)
        self.assertEqual(arr["s_pal"], [18, 6])

    def test_fixed_palette_nearest(self):
        # (250,10,10) is nearest to bright red; pens fixed as black, white, red
        p = self.png("e.png", [[(250, 10, 10), (5, 5, 5), (240, 240, 240), (0, 0, 200)]])
        arr, c, _ = self.run_tool("--mode", 0, "--name", "s", "--palette", "0,26,6", p)
        self.assertEqual(arr["s_pal"], [0, 26, 6])
        # blue (0,0,200): distances to black 40000, white big, red big -> black
        self.assertEqual(arr["s"], [img2cpc.encode_byte(0, [2, 0]), img2cpc.encode_byte(0, [1, 0])])

    def test_palette_file_and_write(self):
        p = self.png("f.png", [[RED, GREEN]])
        pf = self.dir / "pal.txt"
        pf.write_text("# my pens\n0, 18  # green\n6\n")
        arr, _, _ = self.run_tool("--mode", 0, "--name", "s", "--palette-file", pf, p)
        self.assertEqual(arr["s_pal"], [0, 18, 6])
        self.assertEqual(arr["s"], [img2cpc.encode_byte(0, [2, 1])])
        out = self.dir / "w.txt"
        self.run_tool("--mode", 0, "--name", "s", "--write-palette", out, p)
        self.assertEqual(img2cpc.parse_pal_list(out.read_text()), [6, 18])

    def test_no_palette(self):
        p = self.png("g.png", [[RED, GREEN]])
        arr, c, _ = self.run_tool("--mode", 0, "--name", "s", "--no-palette", p)
        self.assertNotIn("s_pal", arr)
        self.assertNotIn("s_PENS", c)

    def test_too_many_colours(self):
        p = self.png("h.png", [[RED, GREEN, BLUE, WHITE, BLACK, (128, 128, 128), (0, 128, 0), (128, 0, 0)]])
        msg = self.fails("--mode", 1, p)
        self.assertIn("needs 8 colours", msg)
        self.assertIn("4 pens", msg)

    def test_width_multiple(self):
        p = self.png("i.png", [[RED, GREEN, BLUE]])
        self.assertIn("multiple of 2", self.fails("--mode", 0, p))
        p = self.png("j.png", [[RED, GREEN, BLUE, RED, RED, RED]])
        self.assertIn("multiple of 4", self.fails("--mode", 1, p))

    def test_masked_alpha_and_key(self):
        a = (0, 0, 0, 0)
        p = self.png("k.png", [[RED, a, a, GREEN]])
        arr, _, _ = self.run_tool("--mode", 0, "--name", "s", "--masked", p)
        self.assertEqual(arr["s_pal"], [6, 18])
        # pair 1: red, then a transparent pixel; pair 2: transparent, then green
        self.assertEqual(arr["s"][0:2], [0x55, img2cpc.encode_byte(0, [0, 0])])
        self.assertEqual(arr["s"][2:4], [0xAA, img2cpc.encode_byte(0, [0, 1])])

    def test_masked_colour_key(self):
        p = self.png("l.png", [[RED, (255, 0, 255), (255, 0, 255), (255, 0, 255)]])
        arr, _, _ = self.run_tool("--mode", 1, "--name", "s", "--masked", "--transparent", "ff00ff", p)
        self.assertEqual(arr["s_pal"], [6])
        self.assertEqual(arr["s"], [0x77, 0x00])
        self.assertEqual(arr["s"][0] & img2cpc.pixel_mask(1, 0), 0)

    def test_unmasked_transparent_is_pen0(self):
        p = self.png("m.png", [[(0, 0, 0, 0), GREEN]])
        arr, _, _ = self.run_tool("--mode", 0, "--name", "s", "--pen0", 0, p)
        self.assertEqual(arr["s"], [img2cpc.encode_byte(0, [0, 1])])

    def test_frames(self):
        rows = [
            [RED, RED, GREEN, GREEN],
            [RED, RED, GREEN, GREEN],
            [BLUE, BLUE, WHITE, WHITE],
            [BLUE, BLUE, WHITE, WHITE],
        ]
        p = self.png("n.png", rows)
        arr, c, text = self.run_tool("--mode", 0, "--name", "f", "--frame", "2x2", "--palette", "6,18,2,26", p)
        self.assertEqual(c["f_FRAMES"], 4)
        self.assertEqual((c["f_W"], c["f_H"], c["f_SIZE"]), (1, 2, 2))
        want = [img2cpc.encode_byte(0, [pen, pen]) for pen in (0, 1, 2, 3) for _ in range(2)]
        self.assertEqual(arr["f"], want)
        p2 = self.png("n2.png", rows[:3])
        self.assertIn("whole number", self.fails("--mode", 0, "--frame", "2x2", p2))

    def test_frames_masked_size(self):
        p = self.png("o.png", [[RED, RED, GREEN, GREEN]] * 2)
        arr, c, _ = self.run_tool("--mode", 0, "--name", "f", "--frame", "2x2", "--masked", p)
        self.assertEqual(c["f_SIZE"], 4)
        self.assertEqual(len(arr["f"]), 8)

    def test_header_and_format(self):
        p = self.png("p.png", [[RED] * 40])
        _, _, text = self.run_tool("--mode", 0, "--name", "s", p)
        self.assertTrue(text.startswith("' Generated by img2cpc.py"))
        self.assertIn("mode 0", text.splitlines()[1])
        self.assertIn("DIM s(19) AS UBYTE => { _\n    $00, $00", text)
        lines = [l for l in text.splitlines() if l.startswith("    $")][:2]
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].endswith(", _"))
        self.assertTrue(lines[1].endswith("$00 _"))


class TestTiles(Tmp):
    def tile_img(self):
        # 16x16 px: tiles A B / B A, where A = red, B = green
        rows = []
        for y in range(16):
            rows.append([RED if (x // 8 + y // 8) % 2 == 0 else GREEN for x in range(16)])
        return self.png("t.png", rows)

    def test_tiles_plain(self):
        arr, c, _ = self.run_tool("--mode", 0, "--name", "t", "--tiles", self.tile_img())
        self.assertEqual(c["t_COUNT"], 4)
        self.assertEqual(len(arr["t"]), 4 * 32)
        self.assertNotIn("t_MAP", arr)
        self.assertEqual(arr["t"][:32], [0x00] * 32)  # red = pen 0
        self.assertEqual(arr["t"][32:64], [img2cpc.encode_byte(0, [1, 1])] * 32)

    def test_tiles_dedupe_map(self):
        arr, c, _ = self.run_tool("--mode", 0, "--name", "t", "--tiles", "--dedupe", self.tile_img())
        self.assertEqual(c["t_COUNT"], 2)
        self.assertEqual(len(arr["t"]), 64)
        self.assertEqual(arr["t_MAP"], [0, 1, 1, 0])
        self.assertEqual((c["t_MAPW"], c["t_MAPH"]), (2, 2))

    def test_tile_bytes_per_mode(self):
        rows = [[RED] * 8 for _ in range(8)]
        p = self.png("u.png", rows)
        for mode, size in ((0, 32), (1, 16), (2, 8)):
            arr, c, _ = self.run_tool("--mode", mode, "--name", "t", "--tiles", p)
            self.assertEqual(len(arr["t"]), size)

    def test_tile_layout_in_tile(self):
        # one tile in mode 1: row 0 pens 1,0,0,0 | 0,0,0,2 ; rest 0
        rows = [[BLACK] * 8 for _ in range(8)]
        rows[0][0] = WHITE
        rows[0][7] = BLUE
        p = self.png("v.png", rows)
        arr, _, _ = self.run_tool("--mode", 1, "--name", "t", "--tiles", "--palette", "0,26,2", p)
        self.assertEqual(arr["t"][0:2], [0x80, 0x01])
        self.assertEqual(arr["t"][2:], [0] * 14)

    def test_tiles_size_error(self):
        p = self.png("w.png", [[RED] * 12] * 8)
        self.assertIn("multiple of 8", self.fails("--mode", 0, "--tiles", p))

    def test_too_many_tiles(self):
        # 257 distinct tiles: 257 x 1 tiles, tile i has a pixel pattern from i
        w, h = 8 * 257, 8
        im = Image.new("RGB", (w, h), BLACK)
        for t in range(257):
            for b in range(9):
                if t >> b & 1:
                    im.putpixel((t * 8 + b % 8, b // 8), WHITE)
        p = self.dir / "x.png"
        im.save(p)
        self.assertIn("257 tiles", self.fails("--mode", 2, "--tiles", p))

    def test_masked_tiles_rejected(self):
        p = self.png("y.png", [[RED] * 8] * 8)
        self.assertIn("sprites only", self.fails("--mode", 0, "--tiles", "--masked", p))


class TestSpectrum(Tmp):
    def run_zx(self, rows, name="z"):
        p = self.png(name + ".png", rows)
        arr, c, _ = self.run_tool("--spectrum", "--name", name, p)
        return arr, c

    def test_two_colour_cell(self):
        # 8x8: left 3 columns white (more? no: 24 px), rest red (40 px)
        rows = [[WHITE if x < 3 else RED for x in range(8)] for _ in range(8)]
        arr, c = self.run_zx(rows)
        # red (idx 2) is more frequent -> paper; white (7) ink; BRIGHT (0xFF levels)
        self.assertEqual(arr["z_attr"], [0x40 | (2 << 3) | 7])
        self.assertEqual(arr["z"], [0b11100000] * 8)
        self.assertEqual((c["z_COLS"], c["z_ROWS"]), (1, 1))

    def test_zx_sprite_dense_cell_not_inverted(self):
        # A sprite cell where the sprite's colour outnumbers the background:
        # the picture rule makes it the paper (inverted bits); --zx-sprite
        # keeps bit = 1 for every sprite pixel.
        rows = [[WHITE if x < 6 else (0, 0, 0, 0) for x in range(8)] for _ in range(8)]
        p = self.png("s.png", rows)
        pic, _, _ = self.run_tool("--spectrum", "--name", "s", p)
        spr, _, _ = self.run_tool("--spectrum", "--zx-sprite", "--name", "s", p)
        self.assertEqual(pic["s"], [0b00000011] * 8)   # inverted by the picture rule
        self.assertEqual(spr["s"], [0b11111100] * 8)   # sprite pixels set

    def test_zx_sprite_needs_spectrum(self):
        p = self.png("t.png", [[WHITE] * 8] * 8)
        self.assertIn("--zx-sprite needs --spectrum", self.fails("--mode", 0, "--zx-sprite", p))

    def test_normal_level(self):
        d7 = (0xD7, 0, 0xD7)  # normal magenta (idx 3)
        rows = [[d7] * 4 + [BLACK] * 4 for _ in range(8)]
        arr, _ = self.run_zx(rows)
        # equal counts: first appearance is paper (magenta), black ink
        self.assertEqual(arr["z_attr"], [(3 << 3) | 0])
        self.assertEqual(arr["z"], [0x0F] * 8)

    def test_single_colour_and_shared(self):
        arr, _ = self.run_zx([[(0, 0xD7, 0)] * 8] * 8)  # normal green idx 4
        self.assertEqual(arr["z_attr"], [(4 << 3) | 4])
        self.assertEqual(arr["z"], [0] * 8)
        # bright and normal blue in one cell: same colour -> ink = paper
        rows = [[(0, 0, 0xD7)] * 4 + [(0, 0, 255)] * 4] * 8
        arr, _ = self.run_zx(rows)
        self.assertEqual(arr["z_attr"][0] & 7, arr["z_attr"][0] >> 3 & 7)
        self.assertEqual(arr["z_attr"][0] & 7, 1)

    def test_cell_order(self):
        # 16x8: cell 0 red/black stripe, cell 1 solid blue; two rows of cells
        rows = [[RED if x % 2 == 0 else BLACK for x in range(8)] + [BLUE] * 8 for _ in range(8)]
        rows += [[GREEN] * 16 for _ in range(8)]
        arr, c = self.run_zx(rows)
        self.assertEqual(len(arr["z"]), 4 * 8)
        self.assertEqual(len(arr["z_attr"]), 4)
        self.assertEqual((c["z_COLS"], c["z_ROWS"]), (2, 2))
        self.assertEqual(arr["z_attr"][0], 0x40 | (2 << 3) | 0)   # paper red (first), ink black
        self.assertEqual(arr["z"][0:8], [0b01010101] * 8)
        self.assertEqual(arr["z_attr"][1], 0x40 | (1 << 3) | 1)
        self.assertEqual(arr["z_attr"][2], 0x40 | (4 << 3) | 4)
        self.assertEqual(arr["z"][8:16], [0] * 8)

    def test_bit7_is_leftmost(self):
        rows = [[BLACK] * 8 for _ in range(8)]
        rows[0] = [WHITE] + [BLACK] * 7
        arr, _ = self.run_zx(rows)
        self.assertEqual(arr["z_attr"], [0x40 | 7])  # black paper, white ink
        self.assertEqual(arr["z"][0], 0x80)

    def test_size_error(self):
        p = self.png("bad.png", [[RED] * 12] * 8)
        self.assertIn("multiple of 8", self.fails("--spectrum", p))


if __name__ == "__main__":
    unittest.main()

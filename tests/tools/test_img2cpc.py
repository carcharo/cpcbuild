"""Unit tests for tools/img2cpc.py (stdlib unittest):
python3 -m unittest discover -s tests/tools"""
from __future__ import annotations

import contextlib
import io
import json
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

    def test_tile_width_mode0_narrow(self):
        # 8x8 px, mode 0, 4-px tiles: left half red, right half green
        rows = [[RED] * 4 + [GREEN] * 4 for _ in range(8)]
        p = self.png("tw0.png", rows)
        arr, c, text = self.run_tool("--mode", 0, "--name", "t", "--tiles", "--tile-width", 4, p)
        self.assertEqual(c["t_COUNT"], 2)
        self.assertEqual(c["t_TILEW"], 2)
        self.assertEqual(len(arr["t"]), 2 * 16)
        self.assertEqual(arr["t"][:16], [0x00] * 16)  # red = pen 0
        self.assertEqual(arr["t"][16:32], [img2cpc.encode_byte(0, [1, 1])] * 16)
        self.assertIn("2 tiles of 16 bytes", text)
        self.assertLess(text.index("t_COUNT"), text.index("t_TILEW"))

    def test_tile_width_mode1_wide(self):
        rows = [[RED] * 16 + [GREEN] * 16 for _ in range(8)]
        p = self.png("tw1.png", rows)
        arr, c, _ = self.run_tool("--mode", 1, "--name", "t", "--tiles", "--tile-width", 16, p)
        self.assertEqual(c["t_COUNT"], 2)
        self.assertEqual(c["t_TILEW"], 4)
        self.assertEqual(len(arr["t"]), 2 * 32)
        self.assertEqual(arr["t"][32:64], [img2cpc.encode_byte(1, [1] * 4)] * 32)

    def test_tile_width_dedupe(self):
        # 16x16 px, 4-px tiles in mode 0: 4x2 cells, stripes A B A B per row
        rows = [[RED if (x // 4) % 2 == 0 else GREEN for x in range(16)] for _ in range(16)]
        p = self.png("tw2.png", rows)
        arr, c, _ = self.run_tool("--mode", 0, "--name", "t", "--tiles", "--tile-width", 4, "--dedupe", p)
        self.assertEqual(c["t_COUNT"], 2)
        self.assertEqual(c["t_TILEW"], 2)
        self.assertEqual((c["t_MAPW"], c["t_MAPH"]), (4, 2))
        self.assertEqual(arr["t_MAP"], [0, 1, 0, 1] * 2)
        self.assertEqual(len(arr["t"]), 2 * 16)

    def test_tile_width_default_unchanged(self):
        p = self.png("tw3.png", [[RED] * 8] * 8)
        _, c, text = self.run_tool("--mode", 0, "--name", "t", "--tiles", p)
        self.assertNotIn("t_TILEW", text)
        _, c8, text8 = self.run_tool("--mode", 0, "--name", "t", "--tiles", "--tile-width", 8, p)
        self.assertNotIn("t_TILEW", text8)
        self.assertEqual(c, c8)

    def test_tile_width_bad_value(self):
        p = self.png("tw4.png", [[RED] * 32] * 8)
        self.assertIn("img2cpc: tile width 6 must be 2, 4 or 8 pixels in mode 0 (1, 2 or 4 bytes)",
                      self.fails("--mode", 0, "--tiles", "--tile-width", 6, p))
        self.assertIn("img2cpc: tile width 2 must be 4, 8 or 16 pixels in mode 1 (1, 2 or 4 bytes)",
                      self.fails("--mode", 1, "--tiles", "--tile-width", 2, p))
        self.assertIn("img2cpc: tile width 4 must be 8, 16 or 32 pixels in mode 2 (1, 2 or 4 bytes)",
                      self.fails("--mode", 2, "--tiles", "--tile-width", 4, p))

    def test_tile_width_bad_image_size(self):
        p = self.png("tw5.png", [[RED] * 6] * 8)
        self.assertIn("img2cpc: tile image size 6x8 must be a multiple of 4x8",
                      self.fails("--mode", 0, "--tiles", "--tile-width", 4, p))
        p = self.png("tw6.png", [[RED] * 8] * 12)
        self.assertIn("must be a multiple of 4x8", self.fails("--mode", 0, "--tiles", "--tile-width", 4, p))

    def test_tile_width_needs_tiles(self):
        p = self.png("tw7.png", [[RED] * 8] * 8)
        self.assertIn("--tile-width needs --tiles", self.fails("--mode", 0, "--tile-width", 4, p))

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

class TestSidecar(Tmp):
    def side(self, stem, **fields):
        d = {"format": "cpcbuild-image", "version": 1}
        d.update(fields)
        path = self.dir / (stem + ".cpcbuild.json")
        path.write_text(json.dumps(d))
        return path

    def hero(self):
        # 32x8: four 8x8 frames; red, green, white and a blue cell
        rows = [[(RED, GREEN, WHITE, BLUE)[x // 8] for x in range(32)] for _ in range(8)]
        return self.png("hero.png", rows)

    def test_sprite_with_tags(self):
        p = self.hero()
        self.side("hero", kind="sprite", mode=0, name="hero", frame="8x8", masked=False, palette=[2, 6, 18, 26],
                  tags=[{"name": "walk", "from": 0, "to": 2}, {"name": "idle-1 b", "from": 3, "to": 3}])
        arr, c, text = self.run_tool(p)
        self.assertEqual((c["hero_W"], c["hero_H"], c["hero_FRAMES"], c["hero_SIZE"]), (4, 8, 4, 32))
        self.assertEqual((c["hero_WALK"], c["hero_WALK_LEN"]), (0, 3))
        self.assertEqual((c["hero_IDLE_1_B"], c["hero_IDLE_1_B_LEN"]), (3, 1))
        self.assertEqual(arr["hero_pal"], [2, 6, 18, 26])
        self.assertLess(text.index("hero_SIZE"), text.index("hero_WALK "))
        self.assertLess(text.index("hero_IDLE_1_B_LEN"), text.index("hero_pal"))
        self.assertEqual(text.splitlines()[0], "' Generated by img2cpc.py %s (settings from hero.cpcbuild.json)" % p)

    def test_same_as_options(self):
        p = self.hero()
        self.side("hero", kind="sprite", mode=0, name="hero", frame="8x8", palette=[2, 6, 18, 26])
        arr, c, text = self.run_tool(p)
        arr2, c2, text2 = self.run_tool("--mode", 0, "--name", "hero", "--frame", "8x8", "--palette", "2,6,18,26",
                                        "--no-sidecar", p)
        self.assertEqual((arr, c), (arr2, c2))
        self.assertEqual(text.split("\n", 1)[1], text2.split("\n", 1)[1])

    def test_masked_and_no_sidecar(self):
        p = self.hero()
        self.side("hero", kind="sprite", mode=1, frame="8x8", masked=True)
        _, c, _ = self.run_tool(p)
        self.assertEqual(c["hero_SIZE"], 32)
        _, c, text = self.run_tool("--no-sidecar", "--mode", 1, p)
        self.assertEqual(c["hero_FRAMES"], 1)
        self.assertNotIn("settings from", text)
        self.assertIn("--mode is required", self.fails("--no-sidecar", p))

    def test_tiles_with_tile_width(self):
        p = self.png("ground.png", [[(RED, GREEN, RED, GREEN)[x // 4] for x in range(16)] for _ in range(8)])
        self.side("ground", kind="tiles", mode=0, name="ground", tileWidth=4)
        arr, c, text = self.run_tool(p)
        self.assertEqual((c["ground_COUNT"], c["ground_TILEW"]), (4, 2))
        self.assertEqual(len(arr["ground"]), 4 * 16)
        self.assertIn("(settings from ground.cpcbuild.json)", text)
        # tile width 8 is the default and adds nothing
        self.side("ground", kind="tiles", mode=0, tileWidth=8)
        _, c, _ = self.run_tool(p)
        self.assertNotIn("ground_TILEW", c)
        self.assertEqual(c["ground_COUNT"], 2)

    def test_command_line_wins(self):
        p = self.hero()
        self.side("hero", kind="sprite", mode=0, name="hero", frame="8x8", masked=True, palette=[2, 6, 18, 26])
        _, c, _ = self.run_tool("--mode", 1, "--name", "x", "--frame", "16x8", p)
        self.assertEqual((c["x_W"], c["x_FRAMES"]), (4, 2))
        self.assertEqual(c["x_SIZE"], 64)  # still masked: only the sidecar says so
        arr, _, _ = self.run_tool("--palette", "1,24,20,6", "--name", "y", p)
        self.assertEqual(arr["y_pal"], [1, 24, 20, 6])
        pal = self.dir / "p.pal"
        pal.write_text("0, 26, 6, 18\n")
        arr, _, _ = self.run_tool("--palette-file", pal, "--name", "y", p)
        self.assertEqual(arr["y_pal"], [0, 26, 6, 18])
        # an explicit kind overrides the sidecar's, and then its sprite settings do not apply
        arr, c, _ = self.run_tool("--tiles", p)
        self.assertEqual(c["hero_COUNT"], 4)
        self.side("hero", kind="tiles", mode=0, name="hero", tileWidth=4, palette=[2, 6, 18, 26])
        _, c, _ = self.run_tool("--sprite", p)
        self.assertEqual((c["hero_W"], c["hero_H"], c["hero_FRAMES"]), (16, 8, 1))
        _, c, _ = self.run_tool("--dedupe", p)  # --dedupe needs --tiles, which the sidecar gives
        self.assertEqual((c["hero_COUNT"], c["hero_TILEW"]), (4, 2))

    def test_other_targets_ignore_the_sidecar(self):
        p = self.png("pic.png", [[RED] * 8] * 8)
        self.side("pic", kind="sprite", mode=0, name="bad", tags=[{"name": "t", "from": 5, "to": 6}])
        self.assertNotIn("settings from", self.run_tool("--spectrum", p)[2])
        self.assertNotIn("settings from", self.run_tool("--plus-palette", p)[2])

    def test_no_sidecar_file_changes_nothing(self):
        p = self.png("plain.png", [[RED] * 8] * 8)
        _, _, text = self.run_tool("--mode", 1, p)
        self.assertNotIn("settings from", text)
        self.assertIn("--mode is required", self.fails(p))

    def test_bad_sidecars(self):
        p = self.png("hero.png", [[RED] * 16] * 8)
        f = self.dir / "hero.cpcbuild.json"
        base = {"format": "cpcbuild-image", "version": 1}
        cases = [
            ("{", "not valid JSON"),
            ("[1]", "must hold one JSON object"),
            ('{"version": 1, "mode": NaN}', "not valid JSON"),
            (json.dumps({"format": "other", "version": 1}), '"format" must be "cpcbuild-image"'),
            (json.dumps({"version": 1}), '"format" must be "cpcbuild-image"'),
            (json.dumps({"format": "cpcbuild-image", "version": 2}), '"version" must be 1'),
            (json.dumps({"format": "cpcbuild-image", "version": "1"}), '"version" must be 1'),
            (json.dumps({"format": "cpcbuild-image"}), '"version" must be 1'),
            (json.dumps({**base, "kind": "map"}), '"kind" must be "sprite" or "tiles"'),
            (json.dumps({**base, "mode": 3}), '"mode" must be 0, 1 or 2'),
            (json.dumps({**base, "mode": True}), '"mode" must be 0, 1 or 2'),
            (json.dumps({**base, "name": ""}), '"name" must be a non-empty string'),
            (json.dumps({**base, "frame": "16"}), '"frame" must be a "WxH" string'),
            (json.dumps({**base, "frame": 16}), '"frame" must be a "WxH" string'),
            (json.dumps({**base, "masked": "yes"}), '"masked" must be true or false'),
            (json.dumps({**base, "tileWidth": 0}), '"tileWidth" must be a whole number of pixels'),
            (json.dumps({**base, "tileWidth": "8"}), '"tileWidth" must be a whole number of pixels'),
            (json.dumps({**base, "palette": [1, 27]}), '"palette" must be a list of firmware colours 0-26'),
            (json.dumps({**base, "palette": "1,2"}), '"palette" must be a list of firmware colours 0-26'),
            (json.dumps({**base, "tags": [{"name": "a", "from": 0}]}), '"tags" must be a list of {"name", "from", "to"}'),
            (json.dumps({**base, "tags": {}}), '"tags" must be a list of {"name", "from", "to"}'),
        ]
        for text, msg in cases:
            f.write_text(text)
            self.assertEqual(self.fails("--mode", 0, p), f"img2cpc: {f}: {msg}", text)
        # --no-sidecar does not read it
        self.run_tool("--no-sidecar", "--mode", 0, p)

    def test_tag_errors(self):
        p = self.hero()
        for tags, msg in [
            ([{"name": "x", "from": 0, "to": 4}], 'tag "x" is frames 0-4, but the sheet has 4 frames'),
            ([{"name": "x", "from": 3, "to": 2}], 'tag "x" is frames 3-2, but the sheet has 4 frames'),
            ([{"name": "x", "from": -1, "to": 1}], 'tag "x" is frames -1-1, but the sheet has 4 frames'),
            ([{"name": "a b", "from": 0, "to": 1}, {"name": "a_b", "from": 2, "to": 3}],
             'tag "a_b" makes hero_A_B, which is already defined'),
            ([{"name": "w", "from": 0, "to": 1}], 'tag "w" makes hero_W, which is already defined'),
            ([{"name": "x", "from": 0, "to": 1}, {"name": "x len", "from": 2, "to": 3}],
             'tag "x len" makes hero_X_LEN, which is already defined'),
        ]:
            f = self.side("hero", mode=0, frame="8x8", tags=tags)
            self.assertEqual(self.fails(p), f"img2cpc: {f}: {msg}")

    def test_conversion_errors_still_apply(self):
        p = self.hero()
        self.side("hero", kind="sprite", mode=0, frame="8x8", palette=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
        self.assertIn("palette has 17 pens", self.fails(p))

    def test_check_with_sidecar(self):
        p = self.hero()
        f = self.side("hero", kind="sprite", mode=0, frame="8x8", palette=[2, 6, 18, 26], tags=[])
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(img2cpc.main(["--check", str(p)]), 0)
        lines = out.getvalue().splitlines()
        self.assertEqual(lines[0], f"check: {p} 32x8 pixels, mode 0, sprite")
        self.assertEqual(lines[1], f"  sidecar: {f}")


class TestCheck(Tmp):
    def check(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = img2cpc.main(["--check", *[str(a) for a in argv]])
        self.assertEqual(rc, 0)
        return out.getvalue()

    def test_sprite_report(self):
        # 16x4 mode 0, two 8x4 frames; DARK is not a firmware colour and moves to firmware 3 (pen 1)
        DARK = (127, 0, 0)
        rows = [[BLUE] * 8 + [DARK] * 8] * 2 + [[BLUE] * 8 + [RED] * 8] * 2
        p = self.png("s.png", rows)
        self.assertEqual(self.check("--mode", 0, "--frame", "8x4", p), (
            f"check: {p} 16x4 pixels, mode 0, sprite\n"
            "  frames: 2 of 8x4 pixels (4 bytes x 4 lines, 16 bytes each)\n"
            "  pens: 0=2 1=3 2=6\n"
            "  colours moved: 1\n"
            "    #7F0000 -> pen 1 (firmware 3)\n"
            "  total: 32 bytes\n"
            "  ok\n"))

    def test_writes_nothing(self):
        p = self.png("s.png", [[BLUE] * 8] * 2)
        pal = self.dir / "w.pal"
        self.check("--mode", 1, "--write-palette", pal, p)
        self.assertFalse(pal.exists())
        self.assertEqual(sorted(x.name for x in self.dir.iterdir()), ["s.png"])

    def test_masked_sprite_report(self):
        rows = [[BLUE, (0, 0, 0, 0)] * 4] * 4
        p = self.png("m.png", rows)
        text = self.check("--mode", 1, "--masked", p)
        self.assertIn("  frames: 1 of 8x4 pixels (masked, 2 bytes x 4 lines, 16 bytes each)\n", text)
        self.assertNotIn("transparent", text)
        self.assertIn("  total: 16 bytes\n", text)

    def test_transparent_pixels_become_pen0(self):
        rows = [[BLUE, (0, 0, 0, 0)] * 4] * 4
        p = self.png("u.png", rows)
        text = self.check("--mode", 1, p)
        self.assertIn("  transparent pixels: 16\n", text)
        self.assertIn("  total: 8 bytes\n", text)
        self.assertNotIn("colours moved", text)

    def test_tiles_report_with_repeats(self):
        # 4 tiles of 4x8 pixels in mode 0: A B A A
        rows = [[(RED, GREEN, RED, RED)[x // 4] for x in range(16)] for _ in range(8)]
        p = self.png("t.png", rows)
        head = f"check: {p} 16x8 pixels, mode 0, tiles\n"
        text = self.check("--mode", 0, "--tiles", "--tile-width", 4, p)
        self.assertEqual(text.splitlines()[1],
                         "  tiles: 4 of 4x8 pixels (2 bytes wide, 16 bytes each), 2 repeats (--dedupe would drop them)")
        self.assertTrue(text.startswith(head))
        self.assertIn("  total: 64 bytes\n", text)
        text = self.check("--mode", 0, "--tiles", "--tile-width", 4, "--dedupe", p)
        self.assertEqual(text.splitlines()[1],
                         "  tiles: 2 of 4x8 pixels (2 bytes wide, 16 bytes each), 2 repeats dropped")
        self.assertIn("  total: 32 bytes\n", text)
        text = self.check("--mode", 0, "--tiles", "--tile-width", 8, p)
        self.assertEqual(text.splitlines()[1], "  tiles: 2 of 8x8 pixels (4 bytes wide, 32 bytes each)")

    def test_single_repeat(self):
        p = self.png("t.png", [[RED] * 16] * 8)
        self.assertIn("), 1 repeat (--dedupe would drop them)\n", self.check("--mode", 1, "--tiles", p))

    def test_same_errors_as_a_conversion(self):
        many = [[BLACK, BLUE, RED, GREEN, WHITE, (255, 255, 0), (0, 255, 255), (255, 0, 255)]] * 8
        p = self.png("many.png", many)
        self.assertIn("mode 1 has only 4 pens", self.fails("--check", "--mode", 1, p))
        q = self.png("w.png", [[RED] * 5] * 8)
        self.assertIn("not a multiple of 2", self.fails("--check", "--mode", 0, q))

    def test_check_usage(self):
        p = self.png("c.png", [[RED] * 8] * 8)
        self.assertIn("--check writes nothing; leave out -o", self.fails("--check", "--mode", 1, "-o", self.dir / "x.bas", p))
        self.assertIn("--check is for CPC modes", self.fails("--check", "--spectrum", p))
        self.assertIn("--check is for CPC modes", self.fails("--check", "--plus-sprite", p))
        self.assertFalse((self.dir / "x.bas").exists())


if __name__ == "__main__":
    unittest.main()

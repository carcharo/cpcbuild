"""Unit tests for tools/tmx2bas.py (stdlib unittest):
python3 -m unittest discover -s tests/tools"""
from __future__ import annotations

import base64
import contextlib
import gzip
import io
import re
import struct
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
import tmx2bas  # noqa: E402

FLIP_H = 0x80000000
FLIP_V = 0x40000000
FLIP_D = 0x20000000


def tmx_text(layers, w, h, firstgid=1):
    ls = "".join(layers)
    return (
        f'<?xml version="1.0"?>\n<map version="1.10" orientation="orthogonal" width="{w}" height="{h}" '
        f'tilewidth="8" tileheight="8">\n <tileset firstgid="{firstgid}" source="t.tsx"/>\n{ls}</map>\n'
    )


def csv_layer(name, w, h, gids):
    rows = [",".join(str(g) for g in gids[y * w : (y + 1) * w]) for y in range(h)]
    return f' <layer id="1" name="{name}" width="{w}" height="{h}">\n  <data encoding="csv">\n' + ",\n".join(rows) + "\n  </data>\n </layer>\n"


def b64_layer(name, w, h, gids, comp):
    raw = struct.pack(f"<{len(gids)}I", *gids)
    attr = ""
    if comp == "zlib":
        raw, attr = zlib.compress(raw), ' compression="zlib"'
    elif comp == "gzip":
        raw, attr = gzip.compress(raw), ' compression="gzip"'
    enc = base64.b64encode(raw).decode()
    return f' <layer id="2" name="{name}" width="{w}" height="{h}">\n  <data encoding="base64"{attr}>\n   {enc}\n  </data>\n </layer>\n'


class TestTmx(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.dir = Path(self._td.name)
        self.addCleanup(self._td.cleanup)

    def write(self, text):
        p = self.dir / "level.tmx"
        p.write_text(text)
        return p

    def run_tool(self, p, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = tmx2bas.main([str(p), *argv])
        self.assertEqual(rc, 0)
        text = out.getvalue()
        m = re.search(r"DIM (\w+)\((\d+)\) AS UBYTE => \{ _\n(.*?)\n\}", text, re.S)
        vals = [int(v[1:], 16) for v in re.findall(r"\$[0-9A-F]{2}", m.group(3))]
        self.assertEqual(len(vals), int(m.group(2)) + 1)
        consts = {a: int(b) for a, b in re.findall(r"CONST (\w+) AS UBYTE = (\d+)", text)}
        return m.group(1), vals, consts, text

    def fails(self, p, *argv):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            rc = tmx2bas.main([str(p), *argv])
        self.assertEqual(rc, 1)
        return err.getvalue()

    def test_csv(self):
        gids = [1, 2, 3, 4, 5, 6]
        name, vals, consts, text = self.run_tool(self.write(tmx_text([csv_layer("L", 3, 2, gids)], 3, 2)))
        self.assertEqual(name, "level")
        self.assertEqual(vals, [0, 1, 2, 3, 4, 5])
        self.assertEqual((consts["level_W"], consts["level_H"]), (3, 2))

    def test_encodings_agree(self):
        gids = [1, 0, 7, 256, 3, 2] * 2
        for comp in (None, "zlib", "gzip"):
            p = self.write(tmx_text([b64_layer("L", 4, 3, gids, comp)], 4, 3))
            _, vals, _, _ = self.run_tool(p, "--name", "m")
            self.assertEqual(vals, [max(g - 1, 0) if g else 0 for g in gids], comp)

    def test_firstgid_and_empty(self):
        p = self.write(tmx_text([csv_layer("L", 2, 1, [0, 11])], 2, 1, firstgid=10))
        _, vals, _, _ = self.run_tool(p, "--empty", "9")
        self.assertEqual(vals, [9, 1])
        _, vals, _, _ = self.run_tool(p)
        self.assertEqual(vals, [0, 1])

    def test_flip_flags_stripped(self):
        gids = [3 | FLIP_H, 4 | FLIP_V, 5 | FLIP_D, 6 | FLIP_H | FLIP_V | FLIP_D]
        for layer in (csv_layer("L", 4, 1, gids), b64_layer("L", 4, 1, gids, "zlib")):
            _, vals, _, _ = self.run_tool(self.write(tmx_text([layer], 4, 1)))
            self.assertEqual(vals, [2, 3, 4, 5])

    def test_flipped_empty_cell(self):
        p = self.write(tmx_text([csv_layer("L", 2, 1, [FLIP_H, 2])], 2, 1))
        _, vals, _, _ = self.run_tool(p, "--empty", "7")
        self.assertEqual(vals, [7, 1])

    def test_layer_selection(self):
        layers = [csv_layer("bg", 2, 1, [1, 1]), csv_layer("fg", 2, 1, [2, 3])]
        p = self.write(tmx_text(layers, 2, 1))
        self.assertEqual(self.run_tool(p)[1], [0, 0])
        self.assertEqual(self.run_tool(p, "--layer", "fg")[1], [1, 2])
        self.assertIn("no tile layer 'nope'", self.fails(p, "--layer", "nope"))

    def test_over_255(self):
        p = self.write(tmx_text([csv_layer("L", 2, 1, [1, 258])], 2, 1))
        self.assertIn("does not fit", self.fails(p))

    def test_255_ok_256_not(self):
        p = self.write(tmx_text([csv_layer("L", 1, 1, [256])], 1, 1))
        self.assertEqual(self.run_tool(p)[1], [255])
        p = self.write(tmx_text([csv_layer("L", 1, 1, [257])], 1, 1))
        self.assertIn("does not fit", self.fails(p))

    def test_bad_data(self):
        text = tmx_text([csv_layer("L", 3, 2, [1, 2, 3, 4, 5, 6])], 3, 2).replace('width="3" height="2">\n  <data', 'width="2" height="2">\n  <data')
        p = self.write(text)
        self.assertIn("expected", self.fails(p))

    def test_format(self):
        p = self.write(tmx_text([csv_layer("L", 20, 2, list(range(1, 41)))], 20, 2))
        _, _, _, text = self.run_tool(p, "--name", "m")
        self.assertIn("DIM m(39) AS UBYTE => { _", text)
        data_lines = [l for l in text.splitlines() if l.startswith("    $")]
        self.assertEqual(len(data_lines), 3)
        self.assertTrue(data_lines[-1].endswith(" _") and not data_lines[-1].endswith(", _"))


if __name__ == "__main__":
    unittest.main()

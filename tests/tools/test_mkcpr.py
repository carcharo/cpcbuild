"""Unit tests for tools/mkcpr.py: python3 -m unittest discover -s tests/tools"""
from __future__ import annotations

import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
import mkcpr  # noqa: E402


def parse(cpr: bytes):
    assert cpr[:4] == b"RIFF" and cpr[8:12] == b"AMS!"
    assert struct.unpack("<I", cpr[4:8])[0] == len(cpr) - 8
    pos, chunks = 12, []
    while pos < len(cpr):
        cid = cpr[pos : pos + 4]
        (size,) = struct.unpack("<I", cpr[pos + 4 : pos + 8])
        chunks.append((cid, cpr[pos + 8 : pos + 8 + size]))
        pos += 8 + size + (size & 1)
    assert pos == len(cpr)
    return chunks


class Cpr(unittest.TestCase):
    def test_small(self):
        img = bytes(range(100))
        ch = parse(mkcpr.build_cpr(img, 0x40))
        self.assertEqual([c for c, _ in ch], [b"cb00", b"cb01"])
        self.assertTrue(all(len(d) == 0x4000 for _, d in ch))
        self.assertEqual(ch[1][1][:100], img)
        self.assertEqual(ch[1][1][100:], bytes(0x4000 - 100))

    def test_stub_placement(self):
        stub, listing = mkcpr.build_stub(0x40, 0x50, 100)
        ch = parse(mkcpr.build_cpr(bytes(100), 0x40, 0x50))
        self.assertEqual(ch[0][1][: len(stub)], stub)
        self.assertEqual(ch[0][1][len(stub) :], bytes(0x4000 - len(stub)))
        self.assertEqual(stub[0], 0xF3)  # di first
        self.assertTrue(stub.endswith(bytes([0xC3, 0x50, 0x00])))  # tail jumps to entry
        self.assertTrue(listing)

    def test_big_split(self):
        n = 0xB7FF - 0x40 + 1
        img = bytes((i * 7) & 255 for i in range(n))
        ch = parse(mkcpr.build_cpr(img, 0x40))
        self.assertEqual([c for c, _ in ch], [b"cb00", b"cb01", b"cb02", b"cb03"])
        self.assertEqual(b"".join(d for _, d in ch[1:])[:n], img)
        stub, _ = mkcpr.build_stub(0x40, 0x40, n)
        # the three ldir lengths and destinations
        self.assertIn(bytes([0x11, 0x40, 0x40, 0x01, 0x00, 0x40]), stub)
        self.assertIn(bytes([0x11, 0x40, 0x80, 0x01]) + struct.pack("<H", n - 0x8000), stub)

    def test_errors(self):
        with self.assertRaises(ValueError):
            mkcpr.build_cpr(bytes(0x100), 0xBF80)
        with self.assertRaises(ValueError):
            mkcpr.build_cpr(b"", 0x40)

    def test_cli_reads_map(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            (d / "p.bin").write_bytes(b"\x01\x02")
            (d / "p.map").write_text("0040: .core.__START_PROGRAM\n")
            self.assertEqual(mkcpr.main([str(d / "p.bin"), "-o", str(d / "p.cpr")]), 0)
            self.assertEqual(len(parse((d / "p.cpr").read_bytes())), 2)


if __name__ == "__main__":
    unittest.main()

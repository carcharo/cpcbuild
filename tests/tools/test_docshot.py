"""Unit tests for tools/docshot.py and the docs' screenshots:
python3 -m unittest discover -s tests/tools"""
from __future__ import annotations

import re
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools"))
import docshot  # noqa: E402

DOCS = [REPO / "README.md", *sorted((REPO / "docs").rglob("*.md"))]


def doc_images():
    """(markdown file, linked image path) for every local .png a doc links."""
    for md in DOCS:
        for ref in re.findall(r"\]\(([^)\s]+\.png)\)|src=\"([^\"]+\.png)\"", md.read_text()):
            ref = next(r for r in ref if r)
            if "://" not in ref:
                yield md, (md.parent / ref).resolve()


class Docshot(unittest.TestCase):
    def test_doubles_single_scanline(self):
        with tempfile.TemporaryDirectory() as d:
            src, dst = Path(d) / "a.png", Path(d) / "b.png"
            im = Image.new("RGB", (768, 272))
            im.putpixel((5, 3), (255, 0, 0))
            im.save(src)
            self.assertEqual(docshot.docshot(src, dst), (768, 544))
            out = Image.open(dst).convert("RGB")
            self.assertEqual(out.getpixel((5, 6)), (255, 0, 0))
            self.assertEqual(out.getpixel((5, 7)), (255, 0, 0))
            self.assertEqual(out.getpixel((5, 8)), (0, 0, 0))

    def test_keeps_doubled_and_spectrum(self):
        with tempfile.TemporaryDirectory() as d:
            for size in ((768, 540), (320, 256)):
                src, dst = Path(d) / "a.png", Path(d) / "b.png"
                Image.new("RGB", size).save(src)
                self.assertEqual(docshot.docshot(src, dst), size)

    def test_copies_are_current(self):
        for dst, src in docshot.DOC_SHOTS.items():
            want = Image.open(REPO / src)
            want = want.resize((want.width, want.height * 2), Image.NEAREST).convert("RGB")
            got = Image.open(REPO / dst).convert("RGB")
            self.assertEqual(got.tobytes(), want.tobytes(), f"{dst} is stale: run tools/docshot.py --refresh")


class DocScreenshots(unittest.TestCase):
    def test_docs_link_no_goldens(self):
        bad = [f"{md.relative_to(REPO)}: {p.relative_to(REPO)}" for md, p in doc_images() if "golden" in p.parts]
        self.assertEqual(bad, [], "link a docs/images copy made with tools/docshot.py instead")

    def test_no_single_scanline_shots(self):
        bad = []
        for md, p in doc_images():
            if not p.exists():
                continue
            with Image.open(p) as im:
                if docshot.single_scanline(im):
                    bad.append(f"{md.relative_to(REPO)}: {p.relative_to(REPO)}")
        self.assertEqual(bad, [], "half-height CPC shot: run it through tools/docshot.py")


if __name__ == "__main__":
    unittest.main()

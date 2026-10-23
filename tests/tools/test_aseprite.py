"""Tests for the Aseprite extension in tools/aseprite/ (skipped when the
aseprite binary is missing). They run the extension's Lua code in batch mode
through tools/aseprite/headless.lua, then check the files it wrote and feed
them to img2cpc.py and tmx2bas.py.

    python3 -m pytest tests/tools/test_aseprite.py
    python3 -m unittest tests/tools/test_aseprite.py

Set ASEPRITE to use another binary."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools"
HEADLESS = TOOLS / "aseprite" / "headless.lua"
EXT = TOOLS / "aseprite" / "extension"

sys.path.insert(0, str(TOOLS))
import img2cpc  # noqa: E402  (fw_rgb, for the palette file)

DEFAULT_ASEPRITE = "/Applications/Aseprite.app/Contents/MacOS/aseprite"
ASEPRITE = os.environ.get("ASEPRITE") or shutil.which("aseprite") or DEFAULT_ASEPRITE
HAVE_ASEPRITE = Path(ASEPRITE).exists()

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None


def ase(*params: str, check: bool = True) -> subprocess.CompletedProcess:
    """Runs headless.lua with --script-param key=value pairs."""
    cmd = [ASEPRITE, "-b"]
    for p in params:
        cmd += ["--script-param", p]
    cmd += ["--script", str(HEADLESS)]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if check and r.returncode != 0:
        raise AssertionError(f"aseprite failed ({r.returncode}):\n{r.stdout}\n{r.stderr}")
    return r


def results(r: subprocess.CompletedProcess, kind: str) -> list[str]:
    return [l[len("RESULT " + kind) + 1:] for l in r.stdout.splitlines() if l.startswith("RESULT " + kind + " ")]


def py(script: str, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(TOOLS / script), *args], capture_output=True, text=True)


@unittest.skipUnless(HAVE_ASEPRITE, "aseprite binary not found")
@unittest.skipIf(Image is None, "Pillow not installed")
class AsepriteExtension(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cpcbuild-ase-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)

    # -- sprites

    def new_hero(self) -> Path:
        f = self.tmp / "hero.aseprite"
        ase("action=new_sprite", "mode=0", "w=16", "h=16", "frames=4", "masked=0",
            "name=hero", "tags=walk:1-4", f"out={f}")
        # frame 1: two red pen-3 pixels; frame 2: pen 7 at (5,5); frame 4: pen 15 at (15,15)
        ase("action=draw", f"file={f}", "px=1:0:0:3,1:1:0:3,2:5:5:7,4:15:15:15")
        return f

    def test_sprite_export(self):
        f = self.new_hero()
        r = ase("action=export", f"file={f}", f"dir={self.tmp}")
        self.assertIn("64x16 cols=4 count=4", results(r, "sheet")[0])

        im = Image.open(self.tmp / "hero.png")
        self.assertEqual(im.size, (64, 16))
        self.assertEqual(im.mode, "RGBA")
        # pen 3 = firmware 6 = bright red, in frame 1
        self.assertEqual(im.getpixel((0, 0)), (255, 0, 0, 255))
        self.assertEqual(im.getpixel((1, 0)), (255, 0, 0, 255))
        # untouched pixels are pen 0 = firmware 1 = blue
        self.assertEqual(im.getpixel((2, 0)), (0, 0, 128, 255))
        # pen 7 = firmware 8 (frame 2); pen 15 = firmware 15 (frame 4)
        self.assertEqual(im.getpixel((16 + 5, 5)), (*img2cpc.fw_rgb(8), 255))
        self.assertEqual(im.getpixel((48 + 15, 15)), (*img2cpc.fw_rgb(15), 255))

        side = json.loads((self.tmp / "hero.cpcbuild.json").read_text())
        self.assertEqual(side, {
            "format": "cpcbuild-image", "version": 1, "kind": "sprite", "mode": 0,
            "name": "hero", "frame": "16x16", "masked": False,
            "palette": [1, 24, 20, 6, 26, 0, 2, 8, 10, 12, 14, 16, 18, 22, 11, 15],
            "tags": [{"name": "walk", "from": 0, "to": 3}],
        })

        out = self.tmp / "hero.bas"
        p = py("img2cpc.py", "--mode", "0", "--frame", "16x16", str(self.tmp / "hero.png"), "-o", str(out))
        self.assertEqual(p.returncode, 0, p.stderr)
        text = out.read_text()
        self.assertIn("4 frame(s) of 8 bytes x 16 lines, 128 bytes each", text)
        self.assertIn("CONST hero_FRAMES AS UBYTE = 4", text)

        # no options at all: mode, frame, name, palette and tags come from the sidecar
        out2 = self.tmp / "hero2.bas"
        p = py("img2cpc.py", str(self.tmp / "hero.png"), "-o", str(out2))
        self.assertEqual(p.returncode, 0, p.stderr)
        text2 = out2.read_text()
        for const, value in (("hero_W", 8), ("hero_H", 16), ("hero_FRAMES", 4), ("hero_SIZE", 128),
                             ("hero_WALK", 0), ("hero_WALK_LEN", 4), ("hero_PENS", 16)):
            self.assertIn(f"CONST {const} AS UBYTE = {value}\n", text2)
        self.assertIn("(settings from hero.cpcbuild.json)", text2.splitlines()[0])

    def test_masked_sprite_sheet(self):
        f = self.tmp / "m.aseprite"
        ase("action=new_sprite", "mode=1", "w=8", "h=8", "frames=10", "masked=1", "name=m", f"out={f}")
        # masked: palette index 0 is transparent, pen p is index p + 1
        ase("action=draw", f"file={f}", "px=1:0:0:1,1:1:0:4,10:7:7:2")
        r = ase("action=export", f"file={f}", f"dir={self.tmp}")
        # 10 frames: 5 columns x 2 rows, every cell a frame
        self.assertIn("40x16 cols=5 count=10", results(r, "sheet")[0])
        im = Image.open(self.tmp / "m.png")
        self.assertEqual(im.size, (40, 16))
        self.assertEqual(im.getpixel((0, 0)), (*img2cpc.fw_rgb(1), 255))     # pen 0
        self.assertEqual(im.getpixel((1, 0)), (*img2cpc.fw_rgb(6), 255))     # pen 3
        self.assertEqual(im.getpixel((2, 0))[3], 0)                           # nothing drawn
        side = json.loads((self.tmp / "m.cpcbuild.json").read_text())
        self.assertEqual(side["masked"], True)
        self.assertEqual(side["palette"], [1, 24, 20, 6])
        self.assertEqual(side["tags"], [])
        p = py("img2cpc.py", "--mode", "1", "--frame", "8x8", "--masked", str(self.tmp / "m.png"),
               "-o", str(self.tmp / "m.bas"))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("10 frame(s)", (self.tmp / "m.bas").read_text())

    def test_new_rejects_bad_width(self):
        r = ase("action=new_sprite", "mode=0", "w=15", "h=16", "frames=1", "masked=0", "name=x",
                f"out={self.tmp / 'x.aseprite'}", check=False)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("multiple of 2", r.stdout)

    def test_pixel_ratio_and_grid_follow_the_mode(self):
        # check warns when the pixel ratio is not the mode's, so no warnings = ratio kept through save/load
        f = self.new_hero()
        r = ase("action=check", f"file={f}")
        self.assertEqual(results(r, "errors"), [])
        self.assertEqual(results(r, "warnings"), [])

    # -- check

    def test_check_reports_problems(self):
        f = self.new_hero()
        # a colour that is not a firmware colour, drawn into frame 3
        ase("action=set_color", f"file={f}", "index=9=10,200,30")
        ase("action=draw", f"file={f}", "px=3:2:2:9")
        r = ase("action=check", f"file={f}")
        errs = results(r, "errors")
        self.assertEqual(len(errs), 1, errs)
        self.assertIn("#0AC81E", errs[0])
        self.assertIn("not one of the 27 firmware colours", errs[0])
        # export refuses, force writes
        r = ase("action=export", f"file={f}", f"dir={self.tmp}", check=False)
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse((self.tmp / "hero.png").exists())
        ase("action=export", f"file={f}", f"dir={self.tmp}", "force=1")
        self.assertTrue((self.tmp / "hero.png").exists())

    def test_check_counts_pens_and_palette_entries(self):
        f = self.tmp / "m.aseprite"
        ase("action=new_sprite", "mode=1", "w=8", "h=8", "frames=1", "masked=0", "name=m", f"out={f}")
        ase("action=draw", f"file={f}", "px=1:0:0:3")           # pen 3: fine in mode 1
        self.assertEqual(results(ase("action=check", f"file={f}"), "errors"), [])
        ase("action=draw", f"file={f}", "px=1:0:0:4")           # index 4: not a pen of mode 1
        errs = results(ase("action=check", f"file={f}"), "errors")
        self.assertTrue(any("palette entry 4 is used" in e for e in errs), errs)

    # -- tilesets

    def new_tiles(self, tw: int) -> Path:
        f = self.tmp / f"ground{tw}.aseprite"
        ase("action=new_tiles", "mode=0", f"tw={tw}", "mw=8", "mh=1", f"name=ground{tw}", f"out={f}")
        # one stroke along row 1 makes tiles 1-3 (the cel grows to the stroke); a dot edits tile 1
        x2 = tw * 8 - 2
        r = ase("action=draw_tiles", f"file={f}", f"px=1:1:{x2}:1:2,2:5:2:5:3")
        self.assertEqual(results(r, "tiles"), ["4"])
        return f

    def test_tileset_tw4(self):
        f = self.new_tiles(4)
        r = ase("action=export", f"file={f}", f"dir={self.tmp}", "tmx=1")
        # tile 0 (Aseprite's empty tile) + 3 drawn tiles, 4 columns, 4 x 8 pixels each
        self.assertIn("16x8 cols=4 count=4", results(r, "sheet")[0])
        im = Image.open(self.tmp / "ground4.png")
        self.assertEqual(im.size, (16, 8))
        self.assertEqual(im.getpixel((0, 1))[3], 0)            # tile 0 is blank
        self.assertEqual(im.getpixel((5, 1)), (*img2cpc.fw_rgb(20), 255))   # tile 1, pen 2 = firmware 20
        self.assertEqual(im.getpixel((4 + 2, 5)), (*img2cpc.fw_rgb(6), 255))  # the dot, pen 3 = firmware 6

        side = json.loads((self.tmp / "ground4.cpcbuild.json").read_text())
        self.assertEqual(side["kind"], "tiles")
        self.assertEqual(side["tileWidth"], 4)
        self.assertEqual(side["mode"], 0)
        self.assertNotIn("frame", side)
        self.assertNotIn("tags", side)

        root = ET.parse(self.tmp / "ground4_map.tmx").getroot()
        self.assertEqual(root.get("orientation"), "orthogonal")
        self.assertEqual((root.get("width"), root.get("height")), ("8", "1"))
        self.assertEqual((root.get("tilewidth"), root.get("tileheight")), ("4", "8"))
        ts = root.find("tileset")
        self.assertEqual(ts.get("firstgid"), "1")
        self.assertEqual((ts.get("tilecount"), ts.get("columns")), ("4", "4"))
        self.assertEqual(ts.find("image").get("source"), "ground4.png")
        self.assertEqual((ts.find("image").get("width"), ts.find("image").get("height")), ("16", "8"))
        layer = root.find("layer")
        self.assertEqual(layer.get("name"), "Ground")
        gids = [int(g) for g in layer.find("data").text.replace("\n", "").split(",")]
        self.assertEqual(gids, [2, 3, 3, 3, 3, 3, 3, 4])      # tile index + 1

        out = self.tmp / "ground4.bas"
        p = py("tmx2bas.py", str(self.tmp / "ground4_map.tmx"), "-o", str(out))
        self.assertEqual(p.returncode, 0, p.stderr)
        text = out.read_text()
        self.assertIn("$01, $02, $02, $02, $02, $02, $02, $03", text)   # gid - firstgid = tile index
        self.assertIn("CONST ground4_map_W AS UBYTE = 8", text)
        self.assertIn("CONST ground4_map_H AS UBYTE = 1", text)
        self.assertIn("DIM ground4_map(", text)
        self.assertFalse((self.tmp / "ground4.tmx").exists())

    def test_tileset_tw8_through_img2cpc(self):
        f = self.new_tiles(8)
        ase("action=export", f"file={f}", f"dir={self.tmp}", "tmx=1")
        with Image.open(self.tmp / "ground8.png") as im:
            self.assertEqual(im.size, (32, 8))
        out = self.tmp / "ground8_tiles.bas"
        p = py("img2cpc.py", "--mode", "0", "--tiles", str(self.tmp / "ground8.png"), "--name", "ground8",
               "-o", str(out))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("CONST ground8_COUNT AS UBYTE = 4", out.read_text())
        p = py("tmx2bas.py", str(self.tmp / "ground8_map.tmx"), "-o", str(self.tmp / "ground8_map.bas"))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("$01, $02, $02, $02, $02, $02, $02, $03", (self.tmp / "ground8_map.bas").read_text())

    def test_tileset_rejects_illegal_width(self):
        r = ase("action=new_tiles", "mode=0", "tw=6", "name=x", f"out={self.tmp / 'x.aseprite'}",
                check=False)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("tile width must be 2, 4 or 8 in mode 0", r.stdout)

    def test_tileset_map_size_defaults_to_a_screen(self):
        # 160/320/640 pixels by 200 lines; tiles are 8 lines high
        for mode, tw, mw in ((0, 4, 40), (0, 8, 20), (0, 2, 80), (1, 4, 80), (1, 8, 40), (2, 8, 80), (2, 32, 20)):
            f = self.tmp / f"d{mode}_{tw}.aseprite"
            ase("action=new_tiles", f"mode={mode}", f"tw={tw}", "name=d", f"out={f}")
            with self.subTest(mode=mode, tw=tw):
                self.assertEqual(results(ase("action=size", f"file={f}"), "size"), [f"{mw * tw}x200"])
        f = self.tmp / "own.aseprite"
        ase("action=new_tiles", "mode=0", "tw=4", "mw=10", "mh=3", "name=own", f"out={f}")
        self.assertEqual(results(ase("action=size", f"file={f}"), "size"), ["40x24"])
        r = ase("action=new_tiles", "mode=0", "tw=4", "mw=0", "mh=3", "name=x", f"out={self.tmp / 'x.aseprite'}",
                check=False)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("1 to 255 tiles", r.stdout)

    # -- projects

    def make_project(self, assets=("assets/**/*.cpcimp", "assets/**/*.cpcspr", "assets/**/*.cpcpal")) -> Path:
        proj = self.tmp / "proj"
        (proj / "assets").mkdir(parents=True)
        (proj / "cpcbuild.json").write_text(json.dumps({"version": 1, "name": "demo", "targets": [],
                                                        "assets": list(assets)}))
        return proj

    def test_export_into_project_writes_minimal_recipe(self):
        proj = self.make_project()
        f = self.new_hero()
        r = ase("action=export", f"file={f}", f"dir={proj / 'assets'}")
        recipe = proj / "assets" / "hero.cpcimp"
        self.assertEqual(results(r, "project"), [f"demo|{recipe}|created|matched"])
        # source and output only (Studio's field order), paths relative to the project root
        self.assertEqual(recipe.read_text(),
                         '{\n  "format": "cpcimp",\n  "version": 1,\n  "source": "assets/hero.png",\n'
                         '  "output": "assets/hero.bas",\n  "target": "cpc"\n}\n')
        # img2cpc run from the project root on that source gets its settings from the sidecar
        p = subprocess.run([sys.executable, str(TOOLS / "img2cpc.py"), "assets/hero.png", "-o", "assets/hero.bas"],
                           capture_output=True, text=True, cwd=proj)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("CONST hero_FRAMES AS UBYTE = 4", (proj / "assets" / "hero.bas").read_text())

    def test_export_keeps_an_existing_recipe(self):
        proj = self.make_project()
        recipe = proj / "assets" / "hero.cpcimp"
        recipe.write_text("mine\n")
        r = ase("action=export", f"file={self.new_hero()}", f"dir={proj / 'assets'}")
        self.assertEqual(results(r, "project"), [f"demo|{recipe}|kept|matched"])
        self.assertEqual(recipe.read_text(), "mine\n")

    def test_export_recipe_at_project_root_and_unmatched(self):
        proj = self.make_project(assets=("src/*.cpcimp",))
        f = self.new_hero()
        r = ase("action=export", f"file={f}", f"dir={proj}")
        self.assertEqual(results(r, "project"), [f"demo|{proj / 'hero.cpcimp'}|created|unmatched"])
        self.assertIn('"source": "hero.png"', (proj / "hero.cpcimp").read_text())
        # a deeper folder: the glob must match the whole relative path
        (proj / "src" / "art").mkdir(parents=True)
        r = ase("action=export", f"file={f}", f"dir={proj / 'src' / 'art'}")
        self.assertTrue(results(r, "project")[0].endswith("|unmatched"))
        r = ase("action=export", f"file={f}", f"dir={proj / 'src'}")
        self.assertTrue(results(r, "project")[0].endswith("|matched"))

    def test_export_outside_a_project_writes_no_recipe(self):
        r = ase("action=export", f"file={self.new_hero()}", f"dir={self.tmp}")
        self.assertEqual(results(r, "project"), [])
        self.assertEqual(list(self.tmp.glob("*.cpcimp")), [])

    def test_tileset_export_into_project(self):
        proj = self.make_project()
        f = self.new_tiles(4)
        r = ase("action=export", f"file={f}", f"dir={proj / 'assets'}", "tmx=1")
        recipe = proj / "assets" / "ground4.cpcimp"
        self.assertEqual(results(r, "project"), [f"demo|{recipe}|created|matched"])
        self.assertIn('"source": "assets/ground4.png"', recipe.read_text())
        self.assertTrue((proj / "assets" / "ground4_map.tmx").exists())
        self.assertFalse((proj / "assets" / "ground4.tmx").exists())
        self.assertFalse((proj / "assets" / "ground4_map.cpcimp").exists())   # the map has no recipe

    # -- extension files

    def test_plugin_registers_four_commands(self):
        r = ase("action=plugin_init")
        cmds = results(r, "command")
        self.assertEqual([c.split(" ")[0] for c in cmds], ["CpcNewSprite", "CpcNewTileset", "CpcCheck", "CpcExport"])

    def test_palette_file_is_the_firmware_table(self):
        rows = [l for l in (EXT / "cpc-firmware-27.gpl").read_text().splitlines() if re.match(r"\s*\d", l)]
        self.assertEqual(len(rows), 27)
        for n, row in enumerate(rows):
            r, g, b, num = row.split()[:4]
            self.assertEqual((int(r), int(g), int(b)), img2cpc.fw_rgb(n))
            self.assertEqual(int(num), n)

    def test_manifest(self):
        pkg = json.loads((EXT / "package.json").read_text())
        self.assertEqual(pkg["name"], "cpcbuild")
        for s in pkg["contributes"]["scripts"]:
            self.assertTrue((EXT / s["path"]).exists())
        for p in pkg["contributes"]["palettes"]:
            self.assertTrue((EXT / p["path"]).exists())


if __name__ == "__main__":
    unittest.main()

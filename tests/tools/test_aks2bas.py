"""Unit tests for tools/aks2bas.py and tools/arkos/postprocess.py (stdlib
unittest): python3 -m unittest discover -s tests/tools

The Arkos binaries are not needed: the fixtures are heads of Arkos export
sources from the Arkos repo's MIT test resources (Tracker 3 export with
Disark region labels, and an Arkos Tracker 2 style export with a label
followed by an instruction on one line)."""
from __future__ import annotations

import os
import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "tools" / "arkos"))
import aks2bas  # noqa: E402
import postprocess  # noqa: E402

FIX = Path(__file__).resolve().parent / "fixtures"


def asm_body(bas: str) -> list[str]:
    """The lines between the data's `asm` and its end-asm, i.e. the data."""
    lines = bas.split("\n")
    start = [i for i, l in enumerate(lines) if l == "asm"][1] + 1
    end = max(i for i, l in enumerate(lines) if l == "end asm")
    assert re.fullmatch(r"__aks_\w+_end:", lines[end - 1])
    return lines[start:end - 1]


class TestAks2Bas(unittest.TestCase):
    def test_at3_export(self):
        src = (FIX / "akx_at3_head.asm").read_text()
        out = aks2bas.to_boriel(src, "sfx", "", "sfx")
        body = asm_body(out)
        # Every label has a colon and sits alone on its line.
        labels = [l for l in body if l and not l.startswith(" ")]
        self.assertIn("MainSoundEffects:", labels)
        self.assertIn("MainSoundEffects_Sound1:", labels)
        self.assertIn("MainSoundEffectsDisarkGenerateExternalLabel:", labels)
        for l in labels:
            self.assertTrue(re.fullmatch(r"[A-Za-z_]\w*:", l), l)
        # Instructions are indented, comments kept.
        self.assertIn("    dw MainSoundEffects_Sound1    ; Sound effect 1 at index 1.", body)
        self.assertIn("    db 4    ; End of the sound effect.", body)
        # Wrapper: guard, jump-over, BASIC label for @sfx.
        self.assertIn("#ifndef __AKS_SFX__", out)
        self.assertIn("sfx:", out.split("\n"))
        self.assertIn("    jp __aks_sfx_end", out)
        self.assertIn("__aks_sfx_end:", out.split("\n"))
        self.assertTrue(out.endswith("#endif\n"))

    def test_at2_label_and_instruction_on_one_line(self):
        src = (FIX / "akg_at2_head.asm").read_text()
        self.assertIn("Newsong_EmptyInstrument_Loop\tdb 0", src)  # fixture is what we think
        out = aks2bas.to_boriel(src, "tune", "", "song")
        body = asm_body(out)
        i = body.index("Newsong_EmptyInstrument_Loop:")
        self.assertTrue(body[i + 1].startswith("    db 0"))
        self.assertIn('    db "AT20"', body)

    def test_prefix_renames_labels_and_references_not_strings_or_comments(self):
        src = 'Start\n    db "Start"   ; Start here\n    dw Start\nOther\n    dw Other+2\n'
        body = asm_body(aks2bas.to_boriel(src, "x", "p_", "song"))
        self.assertIn("p_Start:", body)
        self.assertIn('    db "Start"    ; Start here', body)
        self.assertIn("    dw p_Start", body)
        self.assertIn("    dw p_Other+2", body)

    def test_hash_hex_becomes_0x(self):
        src = 'L\n    dw #1F2E\n    db "#12"  ; #34\n    ld a,#ff\n'
        body = asm_body(aks2bas.to_boriel(src, "x", "", "song"))
        self.assertIn("    dw 0x1F2E", body)
        self.assertIn('    db "#12"    ; #34', body)
        self.assertIn("    ld a,0xff", body)

    def test_existing_colon_and_directives_at_column_zero(self):
        src = "Lab:\n    db 1\ndb 2\nLab2: dw Lab\n"
        body = asm_body(aks2bas.to_boriel(src, "x", "", "song"))
        self.assertEqual(body, ["Lab:", "    db 1", "    db 2", "Lab2:", "    dw Lab"])

    def test_crlf_and_blank_lines(self):
        src = "A\r\n\r\n\r\n    db 1\r\n"
        body = asm_body(aks2bas.to_boriel(src, "x", "", "song"))
        self.assertEqual(body, ["A:", "", "    db 1"])

    def test_no_labels_is_an_error(self):
        with self.assertRaises(ValueError):
            aks2bas.to_boriel("    db 1\n", "x")

    def test_sanitize_name(self):
        self.assertEqual(aks2bas.sanitize_name("my-song 2"), "my_song_2")
        self.assertEqual(aks2bas.sanitize_name("2fast"), "_2fast")

    def test_cli_from_asm(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "tune.bas"
            rc = aks2bas.main(["--from-asm", str(FIX / "akg_at2_head.asm"), str(out), "--prefix", "tune_"])
            self.assertEqual(rc, 0)
            text = out.read_text()
            self.assertIn("\ntune:\n", text)
            self.assertIn("tune_Newsong_Start:", text)
            self.assertIn("MusicInit(@tune, subsong)", text)


AKS_XML = (b'<song><psgs><psg><type>ay</type><frequencyHz>2000000</frequencyHz>'
           b'<referenceFrequencyHz>440</referenceFrequencyHz></psg></psgs></song>')


class TestPsgClock(unittest.TestCase):
    def test_set_clock_in_plain_xml(self):
        out = aks2bas.set_psg_clock(AKS_XML, 1773400)
        self.assertIn(b"<frequencyHz>1773400</frequencyHz>", out)
        self.assertIn(b"<referenceFrequencyHz>440</referenceFrequencyHz>", out)  # untouched
        self.assertNotIn(b"2000000", out)

    def test_set_clock_in_zip(self):
        import io
        import zipfile
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("song.aks", AKS_XML)
        out = aks2bas.set_psg_clock(buf.getvalue(), 1000000)
        self.assertTrue(out.startswith(b"<song>"))
        self.assertIn(b"<frequencyHz>1000000</frequencyHz>", out)

    def test_every_psg_is_set(self):
        two = AKS_XML.replace(b"</psg>", b"</psg><psg><frequencyHz>1000000</frequencyHz></psg>", 1)
        out = aks2bas.set_psg_clock(two, 1773400)
        self.assertEqual(out.count(b"<frequencyHz>1773400</frequencyHz>"), 2)

    def test_no_frequency_is_an_error(self):
        with self.assertRaises(ValueError):
            aks2bas.set_psg_clock(b"<song/>", 1000000)

    def test_clock_values(self):
        self.assertEqual(aks2bas.PSG_HZ, {"cpc": 1000000, "spectrum": 1773400})

    def run_cli(self, *opts, sfx=False):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            tool = td / "bin"
            tool.mkdir()
            seen = td / "seen.txt"
            for name in ("SongToAkg", "SongToSoundEffects"):
                f = tool / name
                f.write_text(
                    "#!/usr/bin/env python3\nimport re, sys\n"
                    "a = sys.argv[1:]\n"
                    "m = re.search(rb'<frequencyHz>(\\d+)<', open(a[-2], 'rb').read())\n"
                    f"open({str(seen)!r}, 'a').write(m.group(1).decode())\n"
                    "open(a[-1], 'w').write('Lab\\n    db 1\\n')\n")
                f.chmod(0o755)
            aks = td / "in.aks"
            aks.write_bytes(AKS_XML)
            argv = (["--sfx"] if sfx else []) + [str(aks), str(td / "o.bas"), *opts]
            old = os.environ.get("AT3_TOOLS")
            os.environ["AT3_TOOLS"] = str(tool)
            try:
                rc = aks2bas.main(argv)
            finally:
                if old is None:
                    del os.environ["AT3_TOOLS"]
                else:
                    os.environ["AT3_TOOLS"] = old
            return rc, seen.read_text(), aks.read_bytes()

    def test_cli_psg_spectrum_sfx(self):
        rc, clock, orig = self.run_cli("--psg", "spectrum", sfx=True)
        self.assertEqual((rc, clock), (0, "1773400"))
        self.assertEqual(orig, AKS_XML)       # the user's file is not modified

    def test_cli_psg_cpc_song(self):
        rc, clock, _ = self.run_cli("--psg", "cpc")
        self.assertEqual((rc, clock), (0, "1000000"))

    def test_cli_without_psg_keeps_the_songs_clock(self):
        rc, clock, _ = self.run_cli()
        self.assertEqual((rc, clock), (0, "2000000"))

    def test_cli_psg_with_from_asm_is_refused(self):
        with self.assertRaises(SystemExit):
            aks2bas.main(["--from-asm", str(FIX / "akg_at2_head.asm"), "/dev/null", "--psg", "cpc"])


class TestPostprocess(unittest.TestCase):
    def conv(self, text, cmap=None, drop=()):
        return postprocess.convert(text.split("\n"), cmap or {}, set(drop)).split("\n")

    def test_labels_get_colons_and_split(self):
        out = self.conv("    org 32768\nPLY_AKG_INIT ld de,4\n    ret \nPLY_AKG_X\n    db 1\n")
        self.assertEqual([l for l in out if l], ["PLY_AKG_INIT:", "    ld de,4", "    ret", "PLY_AKG_X:", "    db 1"])

    def test_equ_stays_on_one_line(self):
        out = self.conv("PLY_AKG_A equ $+2\n")
        self.assertEqual(out[0], "PLY_AKG_A equ $+2")

    def test_case_restored_and_drop_label(self):
        cmap = {"PLY_AKG_INIT": "PLY_AKG_Init"}
        out = self.conv("PLAYER\nPLY_AKG_INIT ld hl,PLY_AKG_INIT\n", cmap, drop=["PLAYER"])
        self.assertEqual([l for l in out if l], ["PLY_AKG_Init:", "    ld hl,PLY_AKG_Init"])

    def test_reserved_label_renamed_with_references(self):
        out = self.conv("end ld a,1\n    jp end\n")
        self.assertIn("end_:", out)
        self.assertIn("    jp end_", out)

    def test_case_map_prefers_mixed_case(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "s.asm"
            p.write_text("PLY_AKG_Init: ld a,1 ; PLY_AKG_INIT in a comment\n    call PLY_AKG_Init\n")
            self.assertEqual(postprocess.case_map([str(p)])["PLY_AKG_INIT"], "PLY_AKG_Init")


if __name__ == "__main__":
    unittest.main()

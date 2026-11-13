"""Unit tests for tools/cpcrun.py's compiler side (cpcbas) and the cpcbas.json pin:
python3 -m unittest discover -s tests/tools"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools"))
import cpcrun  # noqa: E402

# a stand-in for cpcbas.js: records its arguments, writes the -o file and a map at origin 0x40
FAKE_CLI = """\
const fs = require('fs');
const a = process.argv.slice(2);
fs.writeFileSync(process.env.FAKE_ARGS, JSON.stringify(a));
fs.writeFileSync(a[a.indexOf('-o') + 1], 'x');
fs.writeFileSync(a[a.indexOf('-M') + 1], '0040: .core.__START_PROGRAM\\n');
"""


def fake_cpcbas(root: Path) -> Path:
    cli = root / cpcrun.CPCBAS_CLI
    cli.parent.mkdir(parents=True)
    cli.write_text(FAKE_CLI)
    return root


class CompileProgram(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.cpcbas = fake_cpcbas(self.dir / "cpcbas")
        self.args_file = self.dir / "args.json"
        self.env = {**os.environ, "FAKE_ARGS": str(self.args_file)}
        self.bas = self.dir / "my_prog.bas"
        self.bas.write_text('PRINT "HI"\n')
        patcher = mock.patch.dict(os.environ, {"CPCBAS": str(self.cpcbas)})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.tmp.cleanup)

    def args(self) -> list[str]:
        return json.loads(self.args_file.read_text())

    def test_bin_build(self):
        out = self.dir / "prog.bin"
        org = cpcrun.compile_program(self.bas, out, ["--org", "0x40", "-D", "X"], self.env)
        a = self.args()
        self.assertEqual(org, 0x40)
        self.assertEqual(a[0], str(self.bas))
        self.assertEqual(a[a.index("-D") + 1], "__CPC_PRINTER_ECHO__")
        self.assertEqual(a[a.index("-o") + 1], str(out))
        self.assertEqual(a[-4:], ["--org", "0x40", "-D", "X"])
        self.assertNotIn("-I", a)  # the library is cpcbas's own lib/
        self.assertNotIn("-f", a)

    def test_dsk_build_uses_a_wrapper_named_for_the_run_command(self):
        out = self.dir / "prog.dsk"
        data = self.dir / "d.bin"
        data.write_bytes(b"abc")
        cpcrun.compile_program(self.bas, out, [], self.env, [("DATA.BIN", data)])
        a = self.args()
        wrapper = self.dir / "MYPROG.bas"  # amsdos_stem: letters and digits only
        self.assertEqual(a[0], str(wrapper))
        self.assertIn(str(self.bas.resolve()), wrapper.read_text())
        self.assertEqual(a[a.index("-f") + 1], "dsk")
        self.assertEqual(a[a.index("--dsk-add") + 1], f"DATA.BIN={data}")

    def test_missing_cpcbas_is_a_build_error(self):
        with mock.patch.dict(os.environ, {"CPCBAS": str(self.dir / "nowhere")}):
            with self.assertRaises(cpcrun.BuildError):
                cpcrun.compile_program(self.bas, self.dir / "p.bin", [], self.env)

    def test_cpcbas_dir_default_is_the_sibling(self):
        with mock.patch.dict(os.environ):
            os.environ.pop("CPCBAS", None)
            self.assertEqual(cpcrun.cpcbas_dir(), REPO.parent / "cpcbas")


class Arguments(unittest.TestCase):
    def run_cpcrun(self, *argv: str) -> subprocess.CompletedProcess:
        return subprocess.run([sys.executable, str(REPO / "tools" / "cpcrun.py"), *argv],
                              capture_output=True, text=True)

    def test_zxbc_arg_is_an_error_naming_the_new_flag(self):
        p = self.run_cpcrun("x.bas", "--zxbc-arg=-D")
        self.assertEqual(p.returncode, 2)
        self.assertIn("--cpcbas-arg", p.stderr)

    def test_cpcbas_arg_is_accepted_and_the_origin_is_read_from_the_map(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            cpcbas = fake_cpcbas(root / "cpcbas")
            bas = root / "t.bas"
            bas.write_text("REM\n")
            env = {**os.environ, "CPCBAS": str(cpcbas), "FAKE_ARGS": str(root / "args.json")}
            # the build step runs first; whatever the emulator then does, we look at the compiler's arguments
            subprocess.run([sys.executable, str(REPO / "tools" / "cpcrun.py"), str(bas), "--emu", "chips",
                            "--cpcbas-arg=-O1", "--cpcbas-arg=-W301", "--org", "0x4000"],
                           capture_output=True, text=True, env=env, timeout=120)
            a = json.loads((root / "args.json").read_text())
            self.assertIn("-O1", a)
            self.assertIn("-W301", a)
            self.assertEqual(a[a.index("--org") + 1], "0x4000")


class Pin(unittest.TestCase):
    def pin(self) -> dict:
        return json.loads((REPO / "cpcbas.json").read_text())

    def test_pin_file_shape(self):
        pin = self.pin()
        self.assertEqual(sorted(pin), ["commit", "repo", "version"])
        self.assertRegex(pin["commit"], r"^[0-9a-f]{40}$")
        self.assertRegex(pin["repo"], r"^[\w.-]+/[\w.-]+$")
        self.assertTrue(pin["version"])

    def test_checkout_is_the_pinned_commit(self):
        """A warning locally, an error when CI is set."""
        pin = self.pin()
        cli = cpcrun.cpcbas_dir() / cpcrun.CPCBAS_CLI
        git = subprocess.run(["git", "-C", str(cpcrun.cpcbas_dir()), "rev-parse", "HEAD"],
                             capture_output=True, text=True)
        if git.returncode != 0:
            if os.environ.get("CI"):
                self.fail(f"no cpcbas checkout at {cpcrun.cpcbas_dir()} (set CPCBAS)")
            self.skipTest(f"no cpcbas checkout at {cpcrun.cpcbas_dir()}")
        head = git.stdout.strip()
        if head != pin["commit"]:
            msg = f"cpcbas at {cpcrun.cpcbas_dir()} is {head[:10]}, cpcbas.json pins {pin['commit'][:10]}"
            if os.environ.get("CI"):
                self.fail(msg)
            print(f"\nwarning: {msg}", file=sys.stderr)
        self.assertTrue(cli.is_file() or not os.environ.get("CI"), f"cpcbas is not built ({cli})")

    def test_version_matches_the_checkout(self):
        pkg = cpcrun.cpcbas_dir() / "packages" / "cpcbas" / "package.json"
        git = subprocess.run(["git", "-C", str(cpcrun.cpcbas_dir()), "rev-parse", "HEAD"],
                             capture_output=True, text=True)
        if not pkg.is_file() or git.stdout.strip() != self.pin()["commit"]:
            self.skipTest("no cpcbas checkout at the pinned commit")
        self.assertEqual(json.loads(pkg.read_text())["version"], self.pin()["version"])


if __name__ == "__main__":
    unittest.main()

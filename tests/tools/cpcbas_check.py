"""Shared by the converter tests: compile generated text with cpcbas (--parse-only), so a
test fails when a converter writes something the compiler rejects. cpcbas comes from
$CPCBAS (or the sibling checkout, see tools/cpcrun.py); the tests skip when it is not built."""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
import cpcrun  # noqa: E402


def cli() -> Path:
    return cpcrun.cpcbas_dir() / cpcrun.CPCBAS_CLI


def available() -> bool:
    return cli().is_file()


def parse_only(text: str, *args: str) -> tuple[int, str]:
    """(exit code, diagnostics) of `cpcbas --parse-only` on a program whose text is `text`."""
    with tempfile.TemporaryDirectory() as d:
        src = Path(d) / "t.bas"
        src.write_text(text, encoding="utf-8")
        p = subprocess.run(["node", str(cli()), "--parse-only", *args, str(src)],
                           env=cpcrun.subprocess_env(), capture_output=True, text=True, timeout=120)
        return p.returncode, p.stdout + p.stderr

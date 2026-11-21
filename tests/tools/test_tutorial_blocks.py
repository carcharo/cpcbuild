"""The ```basic code blocks of the tutorial (docs/tutorial/*.md) and of the library reference
(docs/library.md) are CPC BASIC that cpcbas accepts:

  * every block passes `cpcbas --parse-only` (cpcbas comes from $CPCBAS, see tools/cpcrun.py; the tests
    skip when it is not built). The block is parsed in a folder where `assets/`, `game.bas`, `main.bas`
    and the platform layers of games/lamplighter are visible, so `#include "assets/tiles.bas"` resolves.
  * a block that is only a piece of a program has a marker on the line above it:
        <!-- fragment -->                    parsed inside a stub SUB (a piece that is not a whole SUB or FUNCTION)
        <!-- fragment: skip: REASON -->      not parsed; the reason is required
  * a block that is a part of a file of the finished game has a marker saying which one:
        <!-- same as games/lamplighter/game.bas -->
    and must occur there verbatim (a run of consecutive lines, trailing blanks ignored).
  * no block uses a spelling of the old compiler's dialect: $hex numbers, BAND/BOR/BXOR/BNOT, ENDIF, WaitVsync, the old
    compiler's name (the same words the Studio's snippets test bans). Assembly between ASM and END ASM keeps its own
    syntax ($FF is an assembler number there) and is left out of the check.

A file in KNOWN_FAILING is checked and reported but its failures skip instead of failing, until the file
is fixed. Run one file with TUTORIAL_BLOCKS_FILES=docs/library.md (comma-separated paths from the repository root).

    python3 -m unittest tests/tools/test_tutorial_blocks.py -v
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cpcbas_check  # noqa: E402
import cpcrun  # noqa: E402  (cpcbas_check put tools/ on the path)

REPO = Path(__file__).resolve().parents[2]
GAME = REPO / "games" / "lamplighter"

# Files whose blocks are not all clean yet. A failure in one of these skips the test with the list of
# blocks; remove the entry when the file passes. (The library reference is being rewritten for CPC BASIC: its
# blocks that include files the reader has not got, or that still use the old dialect, fail until then.)
KNOWN_FAILING: set[str] = set()

# The chapters whose final-state listings must be tied to the finished game by a `same as` marker:
# file -> how many such blocks it has at least.
REQUIRE_SAME_AS = {
    "docs/tutorial/09-measuring.md": 6,
    "docs/tutorial/10-6128-and-plus.md": 3,
}

FENCE = re.compile(r"^```basic\s*$")
MARKER = re.compile(r"^\s*<!--\s*(.*?)\s*-->\s*$")
SAME_AS = re.compile(r"^same as (games/lamplighter/[\w./-]+)$")
FRAGMENT = re.compile(r"^fragment(?::\s*(.*))?$")
BANNED = [
    (re.compile(r"(?<![\w$\"])\$[0-9A-Fa-f]{2,4}\b"), "a $hex number (write &hex)"),
    (re.compile(r"\bB(?:AND|OR|XOR|NOT)\b", re.I), "BAND/BOR/BXOR/BNOT (AND, OR, XOR and NOT are bitwise)"),
    (re.compile(r"(?<!#)\bENDIF\b", re.I), "ENDIF (write END IF)"),
    (re.compile(r"\bWaitVsync\b", re.I), "WaitVsync (write FRAME)"),
    (re.compile("zx" + "bc", re.I), "the old compiler's name"),
]


class Block:
    def __init__(self, path: str, line: int, text: str, markers: list[str]):
        self.path = path
        self.line = line  # the line of the opening fence, 1-based
        self.text = text
        self.markers = markers
        self.same_as: str | None = None
        self.fragment = False
        self.skip_reason: str | None = None
        self.bad_markers: list[str] = []
        for m in markers:
            s = SAME_AS.match(m)
            f = FRAGMENT.match(m)
            if s:
                self.same_as = s.group(1)
            elif f:
                self.fragment = True
                if f.group(1):
                    r = re.sub(r"^skip:?\s*", "", f.group(1)).strip()
                    self.skip_reason = r or f.group(1)
            else:
                self.bad_markers.append(m)

    def where(self) -> str:
        return f"{self.path}:{self.line}"


def extract_blocks(path: str, text: str) -> list[Block]:
    """The ```basic blocks of a Markdown text, each with the marker comments just above its fence."""
    lines = text.split("\n")
    blocks: list[Block] = []
    i = 0
    while i < len(lines):
        if FENCE.match(lines[i]):
            j = i + 1
            while j < len(lines) and not lines[j].startswith("```"):
                j += 1
            markers: list[str] = []
            k = i - 1
            while k >= 0 and not lines[k].strip():
                k -= 1
            while k >= 0 and MARKER.match(lines[k]):
                markers.insert(0, MARKER.match(lines[k]).group(1))  # type: ignore[union-attr]
                k -= 1
            blocks.append(Block(path, i + 1, "\n".join(lines[i + 1:j]) + "\n", markers))
            i = j
        i += 1
    return blocks


def code_only(text: str) -> str:
    """The block without assembly bodies, string literals and comments (what the banned-spelling check reads)."""
    out: list[str] = []
    in_asm = False
    for ln in text.split("\n"):
        s = ln.strip()
        if re.match(r"^ASM\b", s, re.I) and not in_asm:
            in_asm = True
            continue
        if in_asm:
            if re.match(r"^END\s+ASM\b", s, re.I):
                in_asm = False
            continue
        ln = re.sub(r'"[^"]*"', '""', ln)
        ln = re.sub(r"'.*$", "", ln)
        ln = re.sub(r"^\s*REM\b.*$", "", ln, flags=re.I)
        out.append(ln)
    return "\n".join(out)


def banned_in(text: str) -> list[str]:
    code = code_only(text)
    return [what for rx, what in BANNED if rx.search(code)]


def occurs_verbatim(block: str, file_text: str) -> bool:
    want = [ln.rstrip() for ln in block.strip("\n").split("\n")]
    have = [ln.rstrip() for ln in file_text.split("\n")]
    n = len(want)
    return any(have[i:i + n] == want for i in range(len(have) - n + 1))


def is_whole_program_piece(text: str) -> bool:
    """A fragment that defines SUBs or FUNCTIONs (or carries preprocessor lines) is parsed as it is; any
    other piece (statements, DIMs) is parsed inside a SUB."""
    return any(re.match(r"^\s*(SUB|FUNCTION|#)", ln, re.I) for ln in text.split("\n"))


def parse_text(block: Block) -> str:
    if block.fragment and not is_whole_program_piece(block.text):
        return "SUB TutorialFragment()\n" + block.text + "END SUB\n"
    return block.text


def make_workdir(tmp: Path) -> None:
    """The finished game's files, linked, so that includes in a block resolve."""
    for name in ("assets", "game.bas", "main.bas", "platform_cpc.bas", "platform_plus.bas"):
        (tmp / name).symlink_to(GAME / name)


def parse_only(text: str, workdir: Path) -> tuple[int, str]:
    src = workdir / "block.bas"
    src.write_text(text, encoding="utf-8")
    p = subprocess.run(["node", str(cpcbas_check.cli()), "--parse-only", str(src)],
                       env=cpcrun.subprocess_env(), capture_output=True, text=True, timeout=120)
    return p.returncode, (p.stdout + p.stderr).strip()


def doc_files() -> list[str]:
    only = os.environ.get("TUTORIAL_BLOCKS_FILES")
    if only:
        return [f.strip() for f in only.split(",") if f.strip()]
    tut = sorted(p.relative_to(REPO).as_posix() for p in (REPO / "docs" / "tutorial").glob("*.md"))
    return tut + ["docs/library.md"]


def problems(path: str) -> list[str]:
    """Everything wrong with the blocks of one file, as `file:line: what`."""
    found: list[str] = []
    blocks = extract_blocks(path, (REPO / path).read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as d:
        work = Path(d)
        make_workdir(work)
        for b in blocks:
            for m in b.bad_markers:
                found.append(f"{b.where()}: unknown marker <!-- {m} -->")
            for what in banned_in(b.text):
                found.append(f"{b.where()}: uses {what}")
            if b.same_as:
                target = REPO / b.same_as
                if not target.is_file():
                    found.append(f"{b.where()}: {b.same_as} does not exist")
                elif not occurs_verbatim(b.text, target.read_text(encoding="utf-8")):
                    found.append(f"{b.where()}: the block does not occur verbatim in {b.same_as}")
            if b.skip_reason is not None:
                continue
            code, out = parse_only(parse_text(b), work)
            if code != 0:
                found.append(f"{b.where()}: cpcbas --parse-only failed:\n    " + out.replace("\n", "\n    "))
    return found


class Extraction(unittest.TestCase):
    """The marker rules, on a small document (no compiler needed)."""

    DOC = (
        "# t\n\n```basic\nPRINT 1\n```\n\n"
        "<!-- fragment -->\n```basic\nx = 1\n```\n\n"
        "<!-- fragment: skip: shows the idea only -->\n\n```basic\n...\n```\n\n"
        "<!-- same as games/lamplighter/game.bas -->\n<!-- fragment -->\n```basic\nDIM a AS UBYTE\n```\n"
        "```text\nnot basic\n```\n"
    )

    def test_markers(self):
        b = extract_blocks("t.md", self.DOC)
        self.assertEqual(len(b), 4)
        self.assertFalse(b[0].fragment)
        self.assertTrue(b[1].fragment and b[1].skip_reason is None)
        self.assertEqual(b[2].skip_reason, "shows the idea only")
        self.assertEqual(b[3].same_as, "games/lamplighter/game.bas")
        self.assertTrue(b[3].fragment)
        self.assertEqual(b[0].line, 3)

    def test_banned_spellings(self):
        self.assertEqual(banned_in("x = $FF\n"), ["a $hex number (write &hex)"])
        self.assertTrue(banned_in("a = b BAND 3\n"))
        self.assertTrue(banned_in("ENDIF\n"))
        self.assertTrue(banned_in("WaitVsync()\n"))
        self.assertTrue(banned_in("' build with " + "zx" + "bc\nPRINT 1\n") == [])  # a comment is not code
        self.assertEqual(banned_in('PRINT "$FF"\nx = &FF\n'), [])
        self.assertEqual(banned_in("ASM\n  ld a, $FF\nEND ASM\n"), [])
        self.assertEqual(banned_in("a$ = CHR$(65)\n"), [])

    def test_verbatim(self):
        f = "a\nb  \nc\nd\n"
        self.assertTrue(occurs_verbatim("b\nc\n", f))
        self.assertFalse(occurs_verbatim("b\nd\n", f))

    def test_fragment_wrapping(self):
        piece = Block("t.md", 1, "x = 1\n", ["fragment"])
        self.assertTrue(parse_text(piece).startswith("SUB TutorialFragment()"))
        sub = Block("t.md", 1, "SUB A()\nEND SUB\n", ["fragment"])
        self.assertEqual(parse_text(sub), sub.text)


@unittest.skipUnless(cpcbas_check.available(), "cpcbas is not built (set CPCBAS)")
class Blocks(unittest.TestCase):
    pass


def _make_test(path: str):
    def test(self):
        found = problems(path)
        if found and path in KNOWN_FAILING:
            self.skipTest(f"known failing ({len(found)}): " + "; ".join(f.split("\n")[0] for f in found))
        if found:
            self.fail(f"{len(found)} problem(s) in {path}:\n" + "\n".join(found))
    return test


for _p in doc_files():
    setattr(Blocks, "test_" + re.sub(r"\W+", "_", _p), _make_test(_p))


class Coverage(unittest.TestCase):
    """The final-state listings of the measuring chapter and of the 6128 and Plus chapter are tied to the game."""

    def test_same_as_markers(self):
        for path, least in REQUIRE_SAME_AS.items():
            f = REPO / path
            if not f.is_file():
                self.fail(f"{path} is missing")
            n = sum(1 for b in extract_blocks(path, f.read_text(encoding="utf-8")) if b.same_as)
            self.assertGreaterEqual(n, least, f"{path} has {n} `same as` blocks, at least {least} expected")


if __name__ == "__main__":
    unittest.main()

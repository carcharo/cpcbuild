#!/usr/bin/env python3
"""make-sdk.py -- assembles the CPCBuild SDK archive (Python standard library only; runs in CI and locally).

  python3 packaging/make-sdk.py --version 0.2.0 --cpcbas DIR --studio-vsix F --emu-vsix F --out OUT \
          [--cpcbuild-ref v0.2.0] [--cpcbas-tag v0.2.0] [--cpcbas-bundle FILE]

DIR is the built cpcbas checkout at the commit pinned in cpcbas.json (`npm ci && npm run build && npm run bundle`
there). The SDK needs Node 22 for the command line and nothing else: one archive for every platform.

OUT receives cpcbuild-sdk-<version>.zip, the two .vsix renamed to cpcbuild-studio-<version>.vsix and
cpcbuild-emu-<version>.vsix, and SHA256SUMS of all of them. The archive unpacks to cpcbuild-sdk-<version>/ :
  bin/cpcbas.mjs (the compiler's one-file bundle), lib/ (cpcbas's runtime library), docs/, examples/,
  games/lamplighter/, games/shooter/ (Starfall), the two .vsix, README-FIRST.txt, SOURCES.txt, LICENSES/.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SKIP_DIRS = {"__pycache__", ".git", ".worktrees", "build", "tests", "node_modules", ".vscode-test"}
SKIP_FILES = {".DS_Store", "Thumbs.db"}
SKIP_SUFFIXES = (".pyc", ".sh", ".dsk", ".cpr")  # shell scripts need a checkout; builds are outputs
GAMES = ("lamplighter", "shooter")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def git(repo: Path, *args: str) -> str:
    try:
        return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout.strip()
    except Exception:
        return ""


def keep(rel: Path) -> bool:
    return rel.name not in SKIP_FILES and not rel.name.endswith(SKIP_SUFFIXES) and not any(p in SKIP_DIRS for p in rel.parts)


def tree(base: Path, sub: str, dest: str | None = None):
    """(archive path, file path) of every kept file under base/sub."""
    top = base / sub
    for p in sorted(top.rglob("*")):
        rel = p.relative_to(top)
        if p.is_file() and not p.is_symlink() and keep(rel):
            yield f"{dest or sub}/{rel.as_posix()}", p


def sdk_files(cpcbas: Path):
    """(archive path, file path) of everything from the two repositories that goes into the SDK."""
    yield from tree(cpcbas, "lib")
    yield from tree(REPO, "examples")
    for g in GAMES:
        yield from tree(REPO, f"games/{g}")
    for name in ("library.md", "art-guide.md"):
        yield f"docs/{name}", REPO / "docs" / name
    yield from tree(REPO / "docs", "tutorial", "docs/tutorial")
    yield from tree(REPO / "docs", "images", "docs/images")
    for name in ("keywords.md", "migrate.md"):  # the language reference and the 0.1.x converter's rules
        yield f"docs/{name}", cpcbas / "docs" / name


# ---------------------------------------------------------------- texts

def readme_first(ver: str, studio: str, emu: str, cver: str) -> str:
    return f"""CPCBuild SDK {ver}
==================

What this is
  A toolchain for writing Amstrad CPC programs in CPC BASIC, compiled: the compiler (bin/cpcbas.mjs), its
  runtime library (lib/), the tutorial and guides (docs/), small examples (examples/), the games Lamplighter and
  Starfall with their sources (games/), and two Visual Studio Code extensions:
    {studio}   CPC Game Studio: project, build, asset editors
    {emu}      CPC Game Studio Emulator: a CPC emulator inside VS Code
  One archive for Windows, macOS and Linux. Nothing is installed system-wide.

Set up (about two minutes)
  1. Install Visual Studio Code (code.visualstudio.com).
  2. In VS Code open the Extensions view, click the "..." menu at its top right, choose
     "Install from VSIX...", and pick {studio}. Do the same for {emu}.
     The extensions need nothing else: CPC Game Studio compiles inside VS Code.
  3. File > Open Folder... and open games/lamplighter in this folder. Build the lamp464 target from the
     CPC Game Studio view and run it. Or start your own project with the command "CPC Game Studio: New Project".
  4. Read docs/tutorial/ first, then docs/library.md and docs/art-guide.md.

Command line (optional; needs Node.js 22 or newer, nodejs.org)
  node bin/cpcbas.mjs --version
  node bin/cpcbas.mjs --org 0x40 -D CPC464 -o game.dsk games/lamplighter/main.bas
  node bin/cpcbas.mjs --help
  bin/cpcbas.mjs finds the runtime library in lib/ (next to bin/) by itself. The compiler is cpcbas {cver}.
  Old (0.1.x) Boriel BASIC projects: node bin/cpcbas.mjs migrate --help, or the Studio command
  "Convert Project to CPC BASIC".

The programs are not code-signed. Unzip the whole folder first, and keep its path short.

Licences and sources
  See LICENSES/ (what applies to which part) and SOURCES.txt (exactly which sources this was built from,
  and where to get them). The compiler and the CPC Game Studio .vsix are AGPL-3.0, the emulator extension
  GPL-3.0, the rest of CPCBuild and the runtime library MIT.
"""


def licenses_notice(cver: str) -> str:
    return f"""Licences in this SDK
====================

cpcbuild-MIT.txt             CPCBuild itself: docs/, examples/, games/, and the sources of CPC Game Studio
cpcbas-AGPL-3.0.txt          bin/cpcbas.mjs: the cpcbas compiler {cver}, AGPL-3.0-or-later. The corresponding
                             source is linked in SOURCES.txt. cpcbas-NOTICE.txt is the compiler's own notice,
                             with its credits.
                             The CPC Game Studio .vsix bundles the compiler: it is a combined work distributed
                             under AGPL-3.0-or-later (the Studio's own sources stay MIT); its source offer is
                             SOURCES.txt.
lib/LICENSE                  the runtime library in lib/ (MIT), which the compiler links into every program
lib/music/LICENSE.arkos      the Arkos Tracker player sources in lib/music
cpcbuild-emu-GPL-3.0.txt     CPC Game Studio Emulator (the .vsix): GPL-3.0-or-later, built on CPCEC by Cesar
                             Nicolas-Gonzalez. The extension carries its own corresponding source
                             (source/cpcbuild-emu-source.tar.gz inside the .vsix) and the CPC firmware ROM
                             images that come with CPCEC.

The chips emulator (zlib licence) is used only by the project's test suite; none of it is in this SDK.
"""


def sources_txt(ver: str, ref: str, commit: str, pin: dict, cver: str, ctag: str, cpcec_sha: str) -> str:
    repo = pin["repo"]
    return f"""Sources of the programs in this SDK
===================================

CPCBuild {ver}
  repository   https://github.com/carcharo/cpcbuild
  tag/ref      {ref}
  commit       {commit or "(unknown)"}
  covers       docs/ examples/ games/ and the two .vsix (Studio and Emulator extension sources)

Compiler (bin/cpcbas.mjs): cpcbas {cver}
  repository   https://github.com/{repo}
  tag          {ctag}
  commit       {pin["commit"]}
  source       https://github.com/{repo}/archive/{pin["commit"]}.tar.gz
  bin/cpcbas.mjs is the one-file bundle of the compiler (`npm run build && npm run bundle` in that checkout;
  AGPL-3.0-or-later); lib/ is the checkout's lib/ folder. CPC Game Studio's .vsix bundles the same compiler,
  so its corresponding source is the two repositories above at these tags.
  The compiler's design follows Boriel BASIC 1.19 (https://github.com/boriel-basic, AGPL-3.0, by Jose
  Manuel Rodriguez de la Rosa and contributors); parts of its code generator are ported from it and the
  runtime library contains Boriel BASIC's Z80 runtime (MIT). See LICENSES/cpcbas-NOTICE.txt.

CPC Game Studio Emulator (cpcbuild-emu-{ver}.vsix)
  corresponding source: inside the .vsix (a zip), extension/source/cpcbuild-emu-source.tar.gz
    (CPCEC unmodified, our patches, the build scripts and the extension's source, with BUILDING.txt)
  CPCEC         https://github.com/cpcitor/cpcec commit {cpcec_sha} (mirror of Cesar Nicolas-Gonzalez's CPCEC)
"""


# ---------------------------------------------------------------- assembly

def build(a) -> Path:
    cpcbas = Path(a.cpcbas).resolve()
    bundle = Path(a.cpcbas_bundle) if a.cpcbas_bundle else cpcbas / "packages" / "cpcbas" / "dist" / "cpcbas.mjs"
    if not bundle.is_file():
        sys.exit(f"make-sdk: {bundle} not found (run `npm run build && npm run bundle` in the cpcbas checkout)")
    pin = json.loads((REPO / "cpcbas.json").read_text())
    cver = json.loads((cpcbas / "packages" / "cpcbas" / "package.json").read_text())["version"]
    if pin["version"] != cver:
        sys.exit(f"make-sdk: cpcbas.json says version {pin['version']}, the checkout is {cver}")
    head = git(cpcbas, "rev-parse", "HEAD")
    if head != pin["commit"]:
        msg = f"make-sdk: the cpcbas checkout is at {head or '(not a git checkout)'}, cpcbas.json pins {pin['commit']}"
        if os.environ.get("CI"):
            sys.exit(msg)
        print("warning:", msg, file=sys.stderr)
    ctag = a.cpcbas_tag or f"v{cver}"

    root = f"cpcbuild-sdk-{a.version}"
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    dest = out / f"{root}.zip"
    studio, emu = f"cpcbuild-studio-{a.version}.vsix", f"cpcbuild-emu-{a.version}.vsix"
    dt = time.gmtime(a.mtime)[:6]
    seen: set[str] = set()

    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        def add(rel: str, data: bytes) -> None:
            if rel in seen:
                sys.exit(f"make-sdk: {rel} added twice")
            seen.add(rel)
            zi = zipfile.ZipInfo(f"{root}/{rel}", dt)
            zi.create_system = 3
            zi.external_attr = 0o100644 << 16
            zi.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(zi, data, compresslevel=9)

        add("bin/cpcbas.mjs", bundle.read_bytes())
        n = 0
        for rel, p in sdk_files(cpcbas):
            add(rel, p.read_bytes())
            n += 1
        add(studio, Path(a.studio_vsix).read_bytes())
        add(emu, Path(a.emu_vsix).read_bytes())
        add("LICENSES/cpcbuild-MIT.txt", (REPO / "LICENSE").read_bytes())
        add("LICENSES/cpcbas-AGPL-3.0.txt", (cpcbas / "LICENSE").read_bytes())
        add("LICENSES/cpcbas-NOTICE.txt", (cpcbas / "NOTICE").read_bytes())
        add("LICENSES/cpcbuild-emu-GPL-3.0.txt", (REPO / "vscode" / "cpcbuild-emu" / "LICENSE").read_bytes())
        add("LICENSES/NOTICE.txt", licenses_notice(cver).encode())
        add("README-FIRST.txt", readme_first(a.version, studio, emu, cver).encode())
        add("SOURCES.txt", sources_txt(a.version, a.cpcbuild_ref, a.commit, pin, cver, ctag, a.cpcec_sha).encode())
    print(f"{dest.name}: {dest.stat().st_size:,} bytes ({n} repo files)")
    return dest


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", required=True, help="SDK version, e.g. 0.2.0 or 0.0.0-abc1234")
    ap.add_argument("--cpcbas", required=True, help="the built cpcbas checkout at the pinned commit")
    ap.add_argument("--cpcbas-bundle", help="the CLI bundle to ship (default: packages/cpcbas/dist/cpcbas.mjs of --cpcbas)")
    ap.add_argument("--cpcbas-tag", help="cpcbas tag for SOURCES.txt (default v<cpcbas version>)")
    ap.add_argument("--studio-vsix", required=True)
    ap.add_argument("--emu-vsix", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--cpcbuild-ref", help="tag or branch for SOURCES.txt (default: the current git ref)")
    a = ap.parse_args()
    a.commit = git(REPO, "rev-parse", "HEAD")
    a.cpcbuild_ref = a.cpcbuild_ref or git(REPO, "describe", "--tags", "--always") or a.commit
    a.mtime = int(os.environ.get("SOURCE_DATE_EPOCH") or git(REPO, "log", "-1", "--format=%ct") or time.time())
    m = re.search(r"^SHA=([0-9a-f]{40})", (REPO / "tools/cpcec/fetch_build.sh").read_text(), re.M)
    a.cpcec_sha = m.group(1) if m else "(see tools/cpcec/fetch_build.sh)"
    for k in ("studio_vsix", "emu_vsix"):
        if not Path(getattr(a, k)).is_file():
            sys.exit(f"make-sdk: {getattr(a, k)} not found")
    build(a)
    out = Path(a.out)
    for src, name in ((a.studio_vsix, f"cpcbuild-studio-{a.version}.vsix"), (a.emu_vsix, f"cpcbuild-emu-{a.version}.vsix")):
        (out / name).write_bytes(Path(src).read_bytes())
    files = sorted(p for p in out.iterdir() if p.is_file() and p.name != "SHA256SUMS")
    (out / "SHA256SUMS").write_text("".join(f"{sha256(p)}  {p.name}\n" for p in files))
    print(f"SHA256SUMS: {len(files)} files")


if __name__ == "__main__":
    main()

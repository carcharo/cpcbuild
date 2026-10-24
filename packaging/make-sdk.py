#!/usr/bin/env python3
"""make-sdk.py -- assembles the CPCBuild SDK archives (Python standard library only; runs in CI and locally).

  python3 packaging/make-sdk.py --version 0.1.0 --compiler-dir DIR --studio-vsix F --emu-vsix F --out OUT \
          [--platform all|windows-x64|windows-arm64|macos-arm64|macos-x64|linux-x64|linux-arm64] \
          [--compiler-version 1.19.0-cpc.1] [--compiler-tag v1.19.0-cpc.1] [--cpcbuild-ref v0.1.0]

DIR holds the compiler release assets, named zxbasic-<compiler-version>-<platform>.zip|.tar.gz, and
(optionally) SHA256SUMS. The compiler version defaults to zxbasic.version of
vscode/cpcbuild-studio/tools-manifest.json. Every archive is checked against SHA256SUMS (when there is one)
and against the manifest's sha256 (when it has one that is not "PIN" and the versions agree).

OUT receives cpcbuild-sdk-<version>-<platform>.zip (windows, macOS) or .tar.gz (linux), the two .vsix
renamed to cpcbuild-studio-<version>.vsix / cpcbuild-emu-<version>.vsix, and SHA256SUMS of all of them.

Each archive unpacks to cpcbuild-sdk-<version>-<platform>/ :
  bin/ (the compiler release's zxbasic/ folder, entry for entry: bytes, modes and symlinks untouched, so
  macOS code signatures stay valid), lib/, docs/, examples/, games/lamplighter/, the two .vsix,
  README-FIRST.txt, SOURCES.txt, LICENSES/.
The python tools (img2cpc, tmx2bas ...) are not shipped: Studio bundles its own copies.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import os
import re
import stat
import subprocess
import sys
import tarfile
import time
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PLATFORMS = ["windows-x64", "windows-arm64", "macos-arm64", "macos-x64", "linux-x64", "linux-arm64"]
MANIFEST = REPO / "vscode" / "cpcbuild-studio" / "tools-manifest.json"
SKIP_DIRS = {"__pycache__", ".git", ".worktrees", "build", "tests", "node_modules", ".vscode-test"}
SKIP_FILES = {".DS_Store", "Thumbs.db"}
SKIP_SUFFIXES = (".pyc", ".sh", ".dsk", ".cpr")  # shell scripts need poetry/checkout; builds are outputs


def ext(platform: str) -> str:
    return "tar.gz" if platform.startswith("linux") else "zip"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def git(*args: str) -> str:
    try:
        return subprocess.run(["git", "-C", str(REPO), *args], check=True, capture_output=True, text=True).stdout.strip()
    except Exception:
        return ""


# ---------------------------------------------------------------- archive writers

class Writer:
    """Adds entries under one top-level folder; same interface for zip and tar.gz."""

    def __init__(self, path: Path, root: str, mtime: int):
        self.path, self.root, self.mtime = path, root, mtime
        self.dirs: set[str] = set()

    def ensure_dirs(self, rel: str) -> None:
        parts = rel.split("/")[:-1]
        for i in range(len(parts) + 1):
            d = "/".join([self.root] + parts[:i])
            if d not in self.dirs:
                self.dirs.add(d)
                self.add_dir(d)


class ZipWriter(Writer):
    def __init__(self, path, root, mtime):
        super().__init__(path, root, mtime)
        self.z = zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=9)
        self.dt = time.gmtime(mtime)[:6]

    def _info(self, name: str, mode: int, is_dir=False):
        zi = zipfile.ZipInfo(name + ("/" if is_dir else ""), self.dt)
        zi.create_system = 3
        zi.external_attr = (mode & 0xFFFF) << 16 | (0x10 if is_dir else 0)
        zi.compress_type = zipfile.ZIP_STORED if is_dir else zipfile.ZIP_DEFLATED
        return zi

    def add_dir(self, name):
        self.z.writestr(self._info(name, stat.S_IFDIR | 0o755, True), b"")

    def add_file(self, rel: str, data: bytes, mode: int = 0o644):
        self.ensure_dirs(rel)
        self.z.writestr(self._info(f"{self.root}/{rel}", stat.S_IFREG | mode), data)

    def add_foreign(self, rel: str, src_info: zipfile.ZipInfo, data: bytes):
        # rel is already normalised to "/" (Compress-Archive on Windows writes "\\" in names)
        """A compiler entry: new name, same type bits, mode, time and data (symlinks stay symlinks)."""
        self.ensure_dirs(rel)
        is_dir = rel.endswith("/")
        if is_dir:  # ensure_dirs made it already
            key = f"{self.root}/{rel}".rstrip("/")
            if key in self.dirs:
                return
            self.dirs.add(key)
        zi = zipfile.ZipInfo(f"{self.root}/{rel}" + ("/" if is_dir and not rel.endswith("/") else ""), src_info.date_time)
        zi.create_system = src_info.create_system
        zi.external_attr = src_info.external_attr
        zi.compress_type = zipfile.ZIP_STORED if is_dir else src_info.compress_type
        self.z.writestr(zi, data)

    def close(self):
        self.z.close()


class TarWriter(Writer):
    def __init__(self, path, root, mtime):
        super().__init__(path, root, mtime)
        self.t = tarfile.open(path, "w:gz", compresslevel=9, format=tarfile.PAX_FORMAT)

    def _info(self, name, mode, typ=tarfile.REGTYPE, size=0):
        ti = tarfile.TarInfo(name)
        ti.mode, ti.type, ti.size, ti.mtime = mode & 0o7777, typ, size, self.mtime
        ti.uid = ti.gid = 0
        ti.uname = ti.gname = ""
        return ti

    def add_dir(self, name):
        self.t.addfile(self._info(name, 0o755, tarfile.DIRTYPE))

    def add_file(self, rel, data, mode=0o644):
        self.ensure_dirs(rel)
        self.t.addfile(self._info(f"{self.root}/{rel}", mode, size=len(data)), io.BytesIO(data))

    def add_foreign(self, rel, member: tarfile.TarInfo, fobj):
        self.ensure_dirs(rel)
        if member.isdir():
            key = f"{self.root}/{rel}".rstrip("/")
            if key in self.dirs:
                return
            self.dirs.add(key)
        ti = copy.copy(member)
        ti.name = f"{self.root}/{rel}"
        if ti.islnk() and ti.linkname.startswith("zxbasic/"):  # hard link: its target moved too
            ti.linkname = f"{self.root}/bin/{ti.linkname[len('zxbasic/'):]}"
        self.t.addfile(ti, fobj if ti.isreg() else None)

    def close(self):
        self.t.close()


# ---------------------------------------------------------------- inputs

def keep(path: Path) -> bool:
    if path.name in SKIP_FILES or path.suffix in SKIP_SUFFIXES or path.name.endswith(SKIP_SUFFIXES):
        return False
    return not any(p in SKIP_DIRS for p in path.parts)


def tree(base: Path, sub: str, dest: str | None = None, exclude_top: tuple[str, ...] = ()):
    """(relative archive path, file path) of every kept file under base/sub."""
    top = base / sub
    for p in sorted(top.rglob("*")):
        rel = p.relative_to(top)
        if p.is_dir() or p.is_symlink() or not keep(rel):
            continue
        if rel.parts[0] in exclude_top:
            continue
        yield f"{dest or sub}/{rel.as_posix()}", p


def sdk_files():
    """Everything from the repository that goes into an SDK."""
    yield from tree(REPO, "lib")
    yield from tree(REPO, "examples")
    yield from tree(REPO, "games/lamplighter")
    for name in ("library.md", "art-guide.md"):
        yield f"docs/{name}", REPO / "docs" / name
    yield from tree(REPO / "docs", "tutorial", "docs/tutorial")
    yield from tree(REPO / "docs", "images", "docs/images")


def check_checksums(archive: Path, sums: dict[str, str], manifest_sha: str | None) -> None:
    got = sha256(archive)
    if sums:
        if archive.name not in sums:
            sys.exit(f"make-sdk: SHA256SUMS has no entry for {archive.name}")
        if sums[archive.name] != got:
            sys.exit(f"make-sdk: {archive.name} does not match SHA256SUMS ({got} != {sums[archive.name]})")
    if manifest_sha and manifest_sha != "PIN" and manifest_sha != got:
        sys.exit(f"make-sdk: {archive.name} does not match tools-manifest.json ({got} != {manifest_sha})")


def parse_sums(path: Path) -> dict[str, str]:
    out = {}
    if path.exists():
        for line in path.read_text().splitlines():
            m = re.match(r"^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$", line)
            if m:
                out[m.group(2)] = m.group(1).lower()
    return out


# ---------------------------------------------------------------- texts

def readme_first(ver: str, platform: str, root: str, studio: str, emu: str, cver: str) -> str:
    notes = {
        "windows": (
            "WINDOWS\n"
            "  The programs are not code-signed. If SmartScreen ever shows \"Windows protected your PC\",\n"
            "  click \"More info\" and then \"Run anyway\". Unzip the whole folder first (not from inside the zip).\n"
            "  Keep the folder path short (for example C:\\cpcbuild) and, if you can, without spaces.\n"
        ),
        "macos": (
            "MACOS\n"
            "  The programs in bin/ are signed and notarised once the release is set up for it. If macOS says a\n"
            "  program cannot be opened because the developer cannot be verified, open Terminal and run:\n"
            f"      xattr -dr com.apple.quarantine {root}\n"
            "  (use the real path of the folder), then try again. Unzip with Finder or `ditto -x -k`, not with\n"
            "  tools that drop file permissions.\n"
        ),
        "linux": (
            "LINUX\n"
            "  Unpack with `tar -xzf` (it keeps the file permissions). bin/zxbc needs only the C library of a\n"
            "  recent distribution (the build host is Ubuntu 22.04 for x64 and 24.04 for arm64).\n"
        ),
    }[platform.split("-")[0]]
    return f"""CPCBuild SDK {ver} ({platform})
==============================

What this is
  A toolchain for writing Amstrad CPC programs in BASIC (Boriel BASIC, compiled): the compiler and disc
  tools (bin/), the CPCBuild library (lib/), the tutorial and guides (docs/), small examples (examples/),
  the Lamplighter game with its source (games/lamplighter/), and two Visual Studio Code extensions:
    {studio}   CPCBuild Studio: project, build, asset editors
    {emu}      CPCBuild Emulator: a CPC emulator inside VS Code
  Nothing is installed system-wide and nothing needs Python: the programs in bin/ are self-contained.

Set up (about two minutes)
  1. Install Visual Studio Code (code.visualstudio.com).
  2. In VS Code open the Extensions view, click the "..." menu at its top right, choose
     "Install from VSIX...", and pick {studio}. Do the same for {emu}.
  3. File > Open Folder... and open games/lamplighter in this folder. Build the lamp464 target from the
     CPCBuild Studio view and run it. Or start your own project with the command "CPCBuild: New Project"
     and create it inside this folder. Studio finds bin/ and lib/ of this SDK by itself for any project
     below the SDK folder; for a project elsewhere set "cpcbuild.sdk.path" in the VS Code settings to
     this folder.
  4. Read docs/tutorial/ first, then docs/library.md and docs/art-guide.md.

First run
{notes}
Command line (optional)
  bin/zxbc --arch cpc --org 0x40 -I lib -D CPC464 -o game.bin games/lamplighter/main.bas
  bin/mkdsk -o game.dsk --name LAMPLIGH game.bin
  The compiler is version {cver} of the CPCBuild fork of Boriel BASIC.

Licences and sources
  See LICENSES/ (what applies to which part) and SOURCES.txt (exactly which sources the binaries here
  were built from, and where to get them). The compiler is AGPL-3.0, the emulator extension GPL-3.0, the
  rest of CPCBuild MIT.
"""


def licenses_notice(cver: str) -> str:
    return f"""Licences in this SDK
====================

cpcbuild-MIT.txt             CPCBuild itself: lib/, docs/, examples/, games/, CPCBuild Studio (the .vsix)
zxbasic-AGPL-3.0.txt         bin/: the Boriel BASIC compiler fork {cver} (zxbc, zxbasm, zxbpp, mkdsk) and the
                             Python runtime and libraries bundled with it (each under its own licence, see
                             bin/_internal). AGPL-3.0: the corresponding source is linked in SOURCES.txt.
cpcbuild-emu-GPL-3.0.txt     CPCBuild Emulator (the .vsix): GPL-3.0-or-later, built on CPCEC by Cesar
                             Nicolas-Gonzalez. The extension carries its own corresponding source
                             (source/cpcbuild-emu-source.tar.gz inside the .vsix) and the CPC firmware ROM
                             images that come with CPCEC.
lib/music/LICENSE.arkos      the Arkos Tracker player sources in lib/music

The chips emulator (zlib licence) is used only by the project's test suite; none of it is in this SDK.
"""


def sources_txt(ver: str, cver: str, ctag: str, ref: str, commit: str, cpcec_sha: str) -> str:
    return f"""Sources of the binaries in this SDK
===================================

CPCBuild {ver}
  repository   https://github.com/carcharo/cpcbuild
  tag/ref      {ref}
  commit       {commit or "(unknown)"}
  covers       lib/ docs/ examples/ games/ and the two .vsix (Studio and Emulator extension sources)

Compiler (bin/): version {cver}, the Boriel BASIC fork
  release      https://github.com/carcharo/zxbasic/releases/tag/{ctag}
  source       https://github.com/carcharo/zxbasic/archive/refs/tags/{ctag}.tar.gz
  upstream     https://github.com/boriel-basic/zxbasic (AGPL-3.0)
  The files in bin/ are the release archive's zxbasic/ folder, unchanged. They are built by the fork's
  release workflow with PyInstaller from the tagged source above.

CPCBuild Emulator (cpcbuild-emu-{ver}.vsix)
  corresponding source: inside the .vsix (a zip), extension/source/cpcbuild-emu-source.tar.gz
    (CPCEC unmodified, our patches, the build scripts and the extension's source, with BUILDING.txt)
  CPCEC         https://github.com/cpcitor/cpcec commit {cpcec_sha} (mirror of Cesar Nicolas-Gonzalez's CPCEC)
"""


# ---------------------------------------------------------------- assembly

def build_one(platform: str, a) -> Path:
    cver, ctag = a.compiler_version, a.compiler_tag
    root = f"cpcbuild-sdk-{a.version}-{platform}"
    src = Path(a.compiler_dir) / f"zxbasic-{cver}-{platform}.{ext(platform)}"
    if not src.is_file():
        sys.exit(f"make-sdk: {src} not found")
    man = json.loads(MANIFEST.read_text())["zxbasic"]
    msha = None
    if man["version"] == cver:
        asset = man["assets"].get(platform)
        msha = asset.get("sha256") if isinstance(asset, dict) else None
    check_checksums(src, parse_sums(Path(a.compiler_dir) / "SHA256SUMS"), msha)

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    dest = out / f"{root}.{ext(platform)}"
    w = (ZipWriter if ext(platform) == "zip" else TarWriter)(dest, root, a.mtime)
    studio, emu = f"cpcbuild-studio-{a.version}.vsix", f"cpcbuild-emu-{a.version}.vsix"

    # 1. the compiler, entry for entry
    license_text = None
    count = 0
    if ext(platform) == "zip":
        with zipfile.ZipFile(src) as z:
            for zi in z.infolist():
                name = zi.filename.replace("\\", "/")
                if not name.startswith("zxbasic/") or name == "zxbasic/":
                    continue
                rel = "bin/" + name[len("zxbasic/"):]
                data = z.read(zi)
                if rel == "bin/_internal/LICENSE.txt":
                    license_text = data
                w.add_foreign(rel, zi, data)
                count += 1
    else:
        with tarfile.open(src) as t:
            for m in t.getmembers():
                if not m.name.startswith("zxbasic/"):
                    continue
                rel = "bin/" + m.name[len("zxbasic/"):]
                f = t.extractfile(m) if m.isreg() else None
                if rel == "bin/_internal/LICENSE.txt" and f:
                    license_text = f.read()
                    f = io.BytesIO(license_text)
                w.add_foreign(rel, m, f)
                count += 1
    if not count or not any(n for n in ("bin/zxbc", "bin/zxbc.exe") if _has(src, n)):
        sys.exit(f"make-sdk: {src.name} has no zxbasic/zxbc")
    if license_text is None or b"GNU AFFERO" not in license_text.upper():
        sys.exit("make-sdk: the compiler archive has no AGPL LICENSE.txt in _internal")

    # 2. our files
    n = 0
    for rel, p in sdk_files():
        w.add_file(rel, p.read_bytes())
        n += 1
    w.add_file(studio, Path(a.studio_vsix).read_bytes())
    w.add_file(emu, Path(a.emu_vsix).read_bytes())
    w.add_file("LICENSES/cpcbuild-MIT.txt", (REPO / "LICENSE").read_bytes())
    w.add_file("LICENSES/zxbasic-AGPL-3.0.txt", license_text)
    w.add_file("LICENSES/cpcbuild-emu-GPL-3.0.txt", (REPO / "vscode" / "cpcbuild-emu" / "LICENSE").read_bytes())
    w.add_file("LICENSES/NOTICE.txt", licenses_notice(cver).encode())
    w.add_file("README-FIRST.txt", readme_first(a.version, platform, root, studio, emu, cver).replace("\n", "\r\n" if platform.startswith("windows") else "\n").encode())
    w.add_file("SOURCES.txt", sources_txt(a.version, cver, ctag, a.cpcbuild_ref, a.commit, a.cpcec_sha).encode())
    w.close()
    print(f"{dest.name}: {dest.stat().st_size:,} bytes ({count} compiler entries, {n} repo files)")
    return dest


def _has(src: Path, name: str) -> bool:
    full = "zxbasic/" + name[len("bin/"):]
    if src.suffix == ".zip":
        with zipfile.ZipFile(src) as z:
            return full in [n.replace("\\", "/") for n in z.namelist()]
    with tarfile.open(src) as t:
        return full in t.getnames()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", required=True, help="SDK version, e.g. 0.1.0 or 0.0.0-abc1234")
    ap.add_argument("--compiler-dir", required=True)
    ap.add_argument("--studio-vsix", required=True)
    ap.add_argument("--emu-vsix", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--platform", default="all")
    ap.add_argument("--compiler-version")
    ap.add_argument("--compiler-tag")
    ap.add_argument("--cpcbuild-ref", help="tag or branch for SOURCES.txt (default: the current git ref)")
    a = ap.parse_args()
    manifest = json.loads(MANIFEST.read_text())
    a.compiler_version = a.compiler_version or manifest["zxbasic"]["version"]
    a.compiler_tag = a.compiler_tag or "v" + a.compiler_version
    a.commit = git("rev-parse", "HEAD")
    a.cpcbuild_ref = a.cpcbuild_ref or git("describe", "--tags", "--always") or a.commit
    a.mtime = int(os.environ.get("SOURCE_DATE_EPOCH") or git("log", "-1", "--format=%ct") or time.time())
    m = re.search(r"^SHA=([0-9a-f]{40})", (REPO / "tools/cpcec/fetch_build.sh").read_text(), re.M)
    a.cpcec_sha = m.group(1) if m else "(see tools/cpcec/fetch_build.sh)"
    for k in ("studio_vsix", "emu_vsix"):
        if not Path(getattr(a, k)).is_file():
            sys.exit(f"make-sdk: {getattr(a, k)} not found")
    platforms = PLATFORMS if a.platform == "all" else [a.platform]
    for p in platforms:
        if p not in PLATFORMS:
            sys.exit(f"make-sdk: unknown platform {p}")
    outs = [build_one(p, a) for p in platforms]
    # the vsix as release assets, then the checksums of everything in OUT
    out = Path(a.out)
    for src, name in ((a.studio_vsix, f"cpcbuild-studio-{a.version}.vsix"), (a.emu_vsix, f"cpcbuild-emu-{a.version}.vsix")):
        (out / name).write_bytes(Path(src).read_bytes())
    files = sorted(p for p in out.iterdir() if p.is_file() and p.name != "SHA256SUMS")
    (out / "SHA256SUMS").write_text("".join(f"{sha256(p)}  {p.name}\n" for p in files))
    print(f"SHA256SUMS: {len(files)} files")


if __name__ == "__main__":
    main()

"""Writes the fixtures mkcpr.test.ts reads into OUTDIR: <case>.bin (input), <case>.cpr and <case>.lst
(tools/mkcpr.py's output and --listing text) for each case, and cases.json (load, entry per case).
Usage: python3 mkcpr.gen.py OUTDIR   (run from anywhere; the tool is found relative to this file)"""
import json, random, subprocess, sys
from pathlib import Path

tool = Path(__file__).resolve().parents[4] / "tools" / "mkcpr.py"
out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
rnd = random.Random(11)
# name: (length, load, entry or None)
cases = {
    "tiny": (1, 0x40, None),
    "small": (300, 0x4000, 0x4010),
    "page": (0x4000, 0x100, None),
    "pageplus1": (0x4001, 0x40, None),
    "max": (0xC000 - 0x40, 0x40, 0x40),
    "top": (0x20, 0xBFE0, 0xBFE8),
}
meta = {}
for name, (n, load, entry) in cases.items():
    data = bytes(rnd.randrange(256) for _ in range(n))
    (out / f"{name}.bin").write_bytes(data)
    args = ["python3", str(tool), str(out / f"{name}.bin"), "--load", hex(load), "-o", str(out / f"{name}.cpr"), "--listing"]
    if entry is not None:
        args += ["--entry", hex(entry)]
    r = subprocess.run(args, capture_output=True, text=True, check=True)
    lines = r.stdout.rstrip("\n").split("\n")
    (out / f"{name}.lst").write_text("\n".join(lines[:-1]) + "\n")
    meta[name] = {"load": load, "entry": load if entry is None else entry, "summary": lines[-1].replace(str(out) + "/", "")}
(out / "cases.json").write_text(json.dumps(meta, indent=1) + "\n")

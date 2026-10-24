"""Writes the fixtures aks2bas.test.ts reads into OUTDIR. The Arkos tools' raw exports are captured once with
the real tools (AT3_TOOLS or tools/arkos/work/bin of this or the main checkout); each expected .bas / .bin
is what tools/aks2bas.py's own functions make of the same input.
  <case>.asm          raw SongToAkg / SongToSoundEffects --labelPrefix output   (case.name.txt: its label prefix)
  <case>.expected.bas to_boriel(asm, name, "", kind)
  <case>.akg.bin / .bank.expected.bas   the --exportAsBinary image for 0x4000 and bank_include() of it
  edge.asm / edge.expected.bas          a hand-made source covering strings, ';', directives, label forms
  psg_*.aks, psg_*.expected                set_psg_clock inputs (plain XML, zip) and outputs
Usage: python3 aks2bas.gen.py OUTDIR"""
import importlib.util, io, os, subprocess, sys, zipfile
from pathlib import Path

here = Path(__file__).resolve()
repo = here.parents[4]
spec = importlib.util.spec_from_file_location("aks2bas", repo / "tools" / "aks2bas.py")
a2b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a2b)
out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)

bins = [os.environ.get("AT3_TOOLS"), repo / "tools/arkos/work/bin", repo.parents[1] / "tools/arkos/work/bin"]
tools = next(Path(b) for b in bins if b and (Path(b) / "SongToAkg").is_file())
src = repo / "games/shooter/assets"

def run(tool, args):
    r = subprocess.run([str(tools / tool)] + args, capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr

# (case, input, tool, name, kind)
for case, inp, tool, name, kind in [
    ("title", "title.vt2", "SongToAkg", "sf_title", "song"),
    ("game", "game.vt2", "SongToAkg", "sf_game", "song"),
    ("sfx", "sfx.vt2", "SongToSoundEffects", "sf_sfx", "sfx"),
]:
    run(tool, ["--labelPrefix", name + "_", str(src / inp), str(out / f"{case}.asm")])
    (out / f"{case}.name.txt").write_text(f"{name} {kind}\n")
    text = (out / f"{case}.asm").read_text(encoding="utf-8")
    (out / f"{case}.expected.bas").write_text(a2b.to_boriel(text, name, "", kind), encoding="utf-8")

run("SongToAkg", ["--exportAsBinary", "--encodingAddress", "0x4000", str(src / "title.vt2"), str(out / "title.akg.bin")])
data = (out / "title.akg.bin").read_bytes()
(out / "title.bank.expected.bas").write_text(a2b.bank_include(data, "sf_title", 0x4000), encoding="utf-8")

edge = '''; header comment
Edge_Start
Edge_Colon:  ld a,#1F   ; hex after a label
\tdb "a;b", #FF, 'x'   ; semicolon inside a string
\tdw Edge_Colon, Edge_Other+#10
Edge_Other: db 1,2
label_only_comment:  ; just a comment

\t; indented comment
    defs 4
equ_dir equ 5
\tld hl,#abc\tld (#C000),a
Edge_End
'''
(out / "edge.asm").write_text(edge)
(out / "edge.expected.bas").write_text(a2b.to_boriel(edge, "edge", "", "song"), encoding="utf-8")
(out / "edge_prefix.expected.bas").write_text(a2b.to_boriel(edge, "edge", "p_", "sfx"), encoding="utf-8")

aks = b'<?xml version="1.0"?>\n<aks><psgs><psg><frequencyHz>1000000</frequencyHz></psg>\n<psg><frequencyHz> 1773400.5 </frequencyHz></psg></psgs><x>\xc3\xa9\xff</x></aks>\n'
(out / "psg_plain.aks").write_bytes(aks)
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("song.aks", aks * 20)
(out / "psg_zip.aks").write_bytes(buf.getvalue())
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
    z.writestr("song.aks", aks)
(out / "psg_stored.aks").write_bytes(buf.getvalue())
for n in ("plain", "zip", "stored"):
    d = (out / f"psg_{n}.aks").read_bytes()
    (out / f"psg_{n}.cpc.expected").write_bytes(a2b.set_psg_clock(d, a2b.PSG_HZ["cpc"]))
    (out / f"psg_{n}.spectrum.expected").write_bytes(a2b.set_psg_clock(d, a2b.PSG_HZ["spectrum"]))

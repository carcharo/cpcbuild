#!/usr/bin/env python3
"""make_music.py -- Starfall's music and sound effects (ours) as Vortex
Tracker II text modules, imported by the Arkos command-line tools
(games/shooter/build_assets.sh, tools/aks2bas.py).

    make_music.py [outdir]        (default: next to this script)

Writes title.vt2 (the title tune), game.vt2 (the in-game loop, quieter than the effects),
sfx.vt2 (the effect bank, CPC clock) and zx/sfx_zx.vt2 (the same effects
for the Spectrum 128K's 1.7734 MHz AY: sound effects store AY periods, so
the sweeps are rescaled).

Both songs leave AY channel A empty (melody on B, bass on C), where the
effects play. Importer quirks (docs/notes.md, 2026-10-03): all 31
[SampleN] sections must exist; a pattern may use samples 1-9 only;
identical samples are merged (hence the small differences); an effect has
the pitch of the note it is first played at in the sfx module.

Effects (instruments 1-4, one note each): 1 shoot, 2 enemy explodes,
3 player hit, 4 wave cleared.
"""
import sys
from pathlib import Path

NAMES = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"]
SPEED = 6        # frames per row


def n(name):
    """'A4' style helper: 'A-4' stays, 'a4' -> 'A-4'."""
    return name


def header(title, speed, freq):
    return ("[Module]\nVortexTrackerII=1\nVersion=3.7\nTitle=%s\n"
            "Author=cpcbuild\nNoteTable=1\nChipFreq=%d\nSpeed=%d\n"
            "Noise=HEX\nPlayOrder=%s\n\n")


def mod(title, speed, order, freq=1000000):
    return ("[Module]\nVortexTrackerII=1\nVersion=3.7\nTitle=%s\n"
            "Author=cpcbuild\nNoteTable=1\nChipFreq=%d\nSpeed=%d\n"
            "Noise=HEX\nPlayOrder=%s\n\n" % (title, freq, speed, order))


def sample(num, lines):
    """lines: (flags, tone offset, noise offset, amplitude); the last loops."""
    out = ["[Sample%d]" % num]
    for i, (fl, off, noi, amp) in enumerate(lines):
        out.append("%s %s%03X_ %s%02X_ %X_%s" % (
            fl, "+" if off >= 0 else "-", abs(off), "+" if noi >= 0 else "-", abs(noi), amp,
            " L" if i == len(lines) - 1 else ""))
    return "\n".join(out) + "\n\n"


def pad(first):
    return "".join("[Sample%d]\n... +000_ +00_ 0_ L\n\n" % i for i in range(first, 32))


def orn():
    return "[Ornament1]\nL0\n\n"


def cell(note, samp, vol="F"):
    if note is None:
        return "... .... ...."
    if note == "-":
        return "--- .... ...."
    return "%s %dF0%s ...." % (note, samp, vol)


def pattern(num, rows):
    return "[Pattern%d]\n%s\n\n" % (num, "\n".join("....|..|%s|%s|%s" % r for r in rows))


def bar(notes, samp, vol="F"):
    """8 rows from a list of (row, note) pairs; a note on row r, the rest
    silent continuation ('...')."""
    cells = [cell(None, samp)] * 8
    for r, nt in notes:
        cells[r] = cell(nt, samp, vol)
    return cells


EMPTY = cell(None, 1)

# --- title tune: A minor, F, C, G; then a livelier second half ---
def title():
    lead1 = [  # (row, note) per bar, 8 rows a bar
        [(0, "E-5"), (2, "A-5"), (4, "G-5"), (5, "E-5"), (6, "C-5")],
        [(0, "F-5"), (2, "A-5"), (4, "C-6"), (5, "A-5"), (6, "F-5")],
        [(0, "E-5"), (2, "G-5"), (4, "C-6"), (5, "G-5"), (6, "E-5")],
        [(0, "D-5"), (2, "G-5"), (4, "B-5"), (5, "G-5"), (6, "D-5")],
    ]
    lead2 = [
        [(0, "A-5"), (1, "G-5"), (2, "E-5"), (3, "G-5"), (4, "A-5"), (6, "C-6")],
        [(0, "A-5"), (1, "G-5"), (2, "F-5"), (3, "G-5"), (4, "A-5"), (6, "F-5")],
        [(0, "B-5"), (1, "A-5"), (2, "G-5"), (3, "A-5"), (4, "B-5"), (6, "D-6")],
        [(0, "C-6"), (1, "B-5"), (2, "A-5"), (3, "G-5"), (4, "E-5"), (6, "A-5"), (7, "-")],
    ]
    roots1 = ["A-2", "F-2", "C-3", "G-2"]
    roots2 = ["A-2", "F-2", "G-2", "A-2"]
    fifths1 = ["E-3", "C-3", "G-3", "D-3"]
    fifths2 = ["E-3", "C-3", "D-3", "E-3"]

    def bass(roots, fifths):
        rows = []
        for r, f in zip(roots, fifths):
            b = [cell(None, 2)] * 8
            b[0] = cell(r, 2, "E")
            b[2] = cell(r, 2, "E")
            b[4] = cell(f, 2, "E")
            b[6] = cell(r, 2, "E")
            rows += b
        return rows

    pats = ""
    for k, (lead, roots, fifths) in enumerate(((lead1, roots1, fifths1), (lead2, roots2, fifths2))):
        mel = []
        for b in lead:
            mel += bar(b, 1)
        bs = bass(roots, fifths)
        pats += pattern(k, [(EMPTY, mel[i], bs[i]) for i in range(32)])
    s1 = sample(1, [(" T..".strip(), 0, 0, a) for a in (13, 12, 10, 8, 6, 4, 3, 2, 1, 0)])
    s2 = sample(2, [("T..", 0, 0, 14), ("T..", 0, 0, 13), ("T..", 0, 0, 12)])
    return (mod("starfall title", SPEED, "L0,1") + orn() + s1 + s2 + pad(3) + pats).rstrip() + "\n"


# --- in-game loop: a pulse and a few slow notes (about two-thirds volume, under the effects) ---
def game():
    roots = ["A-2", "F-2", "G-2", "E-2"]
    mel0 = [[(0, "E-5"), (4, "C-5")], [(0, "C-5"), (4, "A-4")], [(0, "D-5"), (4, "B-4")], [(0, "B-4"), (4, "G#4")]]
    mel1 = [[(0, "A-4"), (3, "C-5"), (6, "E-5")], [(0, "A-4"), (3, "C-5"), (6, "F-5")],
            [(0, "B-4"), (3, "D-5"), (6, "G-5")], [(0, "G#4"), (3, "B-4"), (6, "E-5")]]
    pats = ""
    for k, mel in enumerate((mel0, mel1)):
        m = []
        bs = []
        for b, root in zip(mel, roots):
            m += bar(b, 3, "D")
            hi = root[:2] + str(int(root[2]) + 1)
            row = [cell(None, 4)] * 8
            for r in range(8):
                row[r] = cell(hi if r in (2, 5) else root, 4, "D")
            bs += row
        pats += pattern(k, [(EMPTY, m[i], bs[i]) for i in range(32)])
    s3 = sample(3, [("T..", 0, 0, a) for a in (13, 13, 12, 12, 12, 11, 11, 11, 10, 10, 10)])
    s4 = sample(4, [("T..", 0, 0, a) for a in (13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0)])
    return (mod("starfall game", SPEED, "L0,1") + orn() + sample(1, [("T..", 0, 0, 0)])
            + sample(2, [("T..", 0, 0, 0)]) + s3 + s4 + pad(5) + pats).rstrip() + "\n"


# --- effects: period offsets are in AY periods, scaled for the clock ---
def sfx(freq):
    k = freq / 1000000.0

    def p(x):
        return int(round(x * k))

    # 1 shoot: from A-5 falling fast
    shoot = [("T..", p(8 * i), 0, a) for i, a in enumerate((15, 14, 12, 10, 8, 6, 4, 3, 1, 0))]
    # 2 enemy explodes: tone burst and noise, decaying
    boom = [("TN.", 0, 4, 15), ("TN.", p(24), 6, 14), (".N.", 0, 8, 13), (".N.", 0, 10, 12),
            (".N.", 0, 13, 10), (".N.", 0, 15, 8), (".N.", 0, 18, 6), (".N.", 0, 22, 4),
            (".N.", 0, 26, 2), (".N.", 0, 30, 1), (".N.", 0, 30, 0)]
    # 3 player hit: low falling tone and long noise
    hit = [("TN.", p(16 * i), 6 + i, a) for i, a in enumerate(
        (15, 15, 14, 14, 13, 13, 12, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0))]
    hit = [(f, o, min(nz, 31), a) for f, o, nz, a in hit]
    # 4 wave cleared: C-5 E-5 G-5 C-6 (periods 119 95 80 60)
    steps = [0, 0, 0, 0, 95 - 119, 95 - 119, 95 - 119, 95 - 119,
             80 - 119, 80 - 119, 80 - 119, 80 - 119, 60 - 119, 60 - 119, 60 - 119, 60 - 119]
    amps = [13] * 12 + [13, 11, 8, 5, 3, 1, 0]
    steps += [60 - 119] * 3
    wave = [("T..", p(s), 0, amps[i]) for i, s in enumerate(steps)]
    wave = [("T..", o, 0, a) for (f, o, nz, a) in wave]
    notes = ["A-5", "C-6", "C-3", "C-5"]
    smp = "".join(sample(i + 1, s) for i, s in enumerate((shoot, boom, hit, wave)))
    rows = ["....|..|%s %dF0F ....|--- .... ....|--- .... ...." % (nt, i + 1) for i, nt in enumerate(notes)]
    return (mod("starfall sfx", 6, "L0", freq) + orn() + smp + pad(5)
            + "[Pattern0]\n" + "\n".join(rows) + "\n")


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent
    (out / "zx").mkdir(exist_ok=True)
    (out / "title.vt2").write_text(title())
    (out / "game.vt2").write_text(game())
    (out / "sfx.vt2").write_text(sfx(1000000))
    (out / "zx" / "sfx_zx.vt2").write_text(sfx(1773400))


if __name__ == "__main__":
    main()

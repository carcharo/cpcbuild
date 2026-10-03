#!/usr/bin/env python3
"""make_bounce_aks.py -- generate bounce's music and sound effects as
Vortex Tracker II text modules (.vt2), from the tune's own data.

    make_bounce_aks.py [outdir]        (default: next to this script)

Writes bounce_music.vt2, bounce_sfx.vt2 and bounce_quiet.vt2 (an empty song). Arkos Tracker 3's command-line
tools import .vt2 directly (SongToAkg, SongToSoundEffects), so no .aks
file is needed: tools/build_assets.sh runs them through tools/aks2bas.py
into bounce_music.bas and bounce_sfx.bas. The data below is bounce's old
firmware-sound tune (the same notes: A minor / F / C / G, 4 bars of 8
eighths of 0.16 s = 8 frames, melody plus bass), so it is ours; nothing is
derived from the songs shipped with the tracker.

Music: channel A is empty (the sound effects play there), B the melody (a
plucky, decaying tone), C the bass.
Effects: 8 short decaying blips (instruments 1-8): 4 pitches for the side
walls and the same an octave lower for the floor and ceiling.
"""
import math
import sys
from pathlib import Path

# bounce.bas: tone periods of the firmware (62500 / Hz).
MEL = [95, 119, 142, 119, 95, 119, 142, 119,
       90, 119, 142, 119, 90, 119, 142, 119,
       95, 119, 159, 119, 95, 119, 159, 119,
       106, 127, 159, 127, 106, 127, 159, 127]
BAS = [568, 379, 568, 379, 716, 478, 716, 478,
       478, 319, 478, 319, 638, 426, 638, 426]

SPEED = 8            # frames per row = one eighth, 0.16 s at 50 Hz
OCT = 0              # octave shift, to line the tracker's octaves up

NAMES = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"]


def note(period):
    """Nearest equal-tempered note name (A-4 = 440 Hz) of a firmware period."""
    f = 62500.0 / period
    n = round(69 + 12 * math.log2(f / 440.0))       # MIDI number
    return "%s%d" % (NAMES[n % 12], n // 12 - 1 + OCT)


def header(title, speed):
    return ("[Module]\nVortexTrackerII=1\nVersion=3.7\nTitle=%s\n"
            "Author=cpcbuild\nNoteTable=1\nChipFreq=1000000\nSpeed=%d\n"
            "Noise=HEX\nPlayOrder=L0\n\n" % (title, speed))


def ornament():
    return "[Ornament1]\nL0\n\n"


def sample(n, lines):
    """lines: (tone offset, amplitude); the last line loops."""
    out = ["[Sample%d]" % n]
    for i, (off, amp) in enumerate(lines):
        out.append("T.. %s%03X_ +00_ %X_%s" % ("+" if off >= 0 else "-", abs(off), amp,
                                               " L" if i == len(lines) - 1 else ""))
    return "\n".join(out) + "\n\n"


def pad(first):
    """The importer wants all 31 samples to exist: fill the rest with silence."""
    return "".join("[Sample%d]\n... +000_ +00_ 0_ L\n\n" % i for i in range(first, 32))


def music():
    # pluck: 13, then a quick decay to silence over the 8 frames of a note
    pluck = [(0, a) for a in (13, 12, 10, 8, 6, 4, 3, 2, 1, 0)]
    bass = [(0, 14)]
    rows = []
    for r in range(32):
        # melody on B every row (a new pluck each eighth)
        b = "%s 1F0F ...." % note(MEL[r])
        # bass on C every second row (a quarter)
        c = "%s 2F0F ...." % note(BAS[r // 2]) if r % 2 == 0 else "--- .... ...."
        rows.append("....|..|--- .... ....|%s|%s" % (b, c))
    return (header("bounce music", SPEED) + ornament() + sample(1, pluck) + sample(2, bass)
            + pad(3) + "[Pattern0]\n" + "\n".join(rows) + "\n")


# Blip pitches (62500 / Hz): C5 E5 A5 D6; ball i uses pitch i // 2.
BLIP_PER = [119, 95, 71, 53]


def sfx():
    # 8 short decaying blips, instruments 1-8: 1-4 the side-wall pitches,
    # 5-8 the same an octave lower (floor and ceiling). The importer reads
    # sample numbers in patterns only up to 9, so there are at most 9.
    # SongToSoundEffects gives an instrument the pitch of the note it is
    # first played at in the song, so the pattern plays each once, on its
    # note. The importer also merges identical samples, so the decays
    # differ by a volume step of 1 in three places (n-1 in binary).
    pers = BLIP_PER + [p * 2 for p in BLIP_PER]
    smp = ""
    for n in range(1, 9):
        k = n - 1
        amps = (15, 12, 9 + (k & 1), 6 + (k >> 1 & 1), 4 + (k >> 2 & 1), 2, 1, 0)
        smp += sample(n, [(0, a) for a in amps])
    rows = ["....|..|%s %dF0F ....|--- .... ....|--- .... ...." % (note(p), n)
            for n, p in enumerate(pers, 1)]
    return (header("bounce sfx", 6) + ornament() + smp + pad(9)
            + "[Pattern0]\n" + "\n".join(rows) + "\n")


def quiet():
    # An empty song: the player must be running for effects to sound, so
    # a build with effects but no music (-D NOMUSIC) plays this one.
    return (header("bounce quiet", SPEED) + ornament() + sample(1, [(0, 0)]) + pad(2)
            + "[Pattern0]\n" + "\n".join(["....|..|--- .... ....|--- .... ....|--- .... ...."] * 8) + "\n")


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent
    (out / "bounce_music.vt2").write_text(music())
    (out / "bounce_sfx.vt2").write_text(sfx())
    (out / "bounce_quiet.vt2").write_text(quiet())


if __name__ == "__main__":
    main()

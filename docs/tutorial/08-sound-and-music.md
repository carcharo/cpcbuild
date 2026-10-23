# Chapter 8: Sound and music

**Goal.** Add a tune on the title, a tune in the game, and four sound effects (jump, lamp, death, door),
without the game code knowing anything about the sound chip.

**What you'll learn**

- How the music library plays a song from the frame hook, in the background.
- How effects work: they ride on the music player.
- Why sound ownership matters (one owner of the AY chip at a time).
- Build switches to leave sound out, and what sound costs in memory.

**Time:** about 30 minutes.

**Before you start.** Chapter 7 is working. Copy these four files from `games/lamplighter/assets/`
into your project's `assets/` folder:

| File | Contains |
|---|---|
| `title.bas` | the title tune, array `sf_title` |
| `gamesong.bas` | the in-game tune, array `sf_game` |
| `sfx.bas` | the effects bank, array `sf_sfx` |
| `quiet.bas` | an empty song, array `bounce_quiet` (used when you build with music off but effects on) |

They are demo music written for CPCBuild (our own, not copied from any other game), so you can use them
freely; they were made in a tracker and converted for Boriel BASIC. Each file's header says it was
"converted by tools/aks2bas.py" and not to edit it.

---

## Step 1: How the music works

The CPC makes sound with an AY-3-8912 chip, which you program by writing to its registers. The library
includes a ready-made **player** (Arkos Tracker 3's `PlayerAkg`, converted for Boriel) that does
that for you from a song stored as data.

The important property: with the default **auto mode** the player runs on the *frame hook*, a routine
that the library calls once per frame at the screen flyback. You call `MusicInit(@song, 0)` once,
and the song keeps playing, 50 ticks a second, whatever the main program is doing: drawing,
waiting, even loading a room (library: **Music and sound effects (Arkos)**).

Three calls matter here:

| Call | What it does |
|---|---|
| `MusicInit(song, subsong)` | starts a song (calling it again switches songs) |
| `MusicStop()` | silences the chip |
| `SfxInit(effects)` and `SfxPlay(n, channel, invvol)` | give the player a bank of sound effects, and play effect *n* on channel 0 (A), 1 (B) or 2 (C) at volume `invvol` (0 is full, 16 is mute) |

**Effects only advance while a song plays**: the song's tick drives them. That is why the
game, when built with the music off but effects on, plays an *empty* song (`quiet.bas`).

**Sound ownership.** The AY has one owner at a time: the firmware's own sound manager (`BEEP`,
`SoundQueue`), the music player, or direct register writes. `MusicInit` stops the firmware
manager first. You should not mix the owners (library: **Sound ownership**).

## Step 2: Include the songs

In `platform_cpc.bas`, after the font include, add the build switches and the includes. Read the comment: it is
the finished game's own.

```basic
#ifdef NOSOUND
#ifndef NOMUSIC
#define NOMUSIC
#endif
#ifndef NOSFX
#define NOSFX
#endif
#endif

' The demo tunes and effects (lib/music, Arkos Tracker 3). The player runs
' on the frame hook, whatever the game does; the songs and the effects bank
' live in main RAM on both models (a few hundred bytes). Effects only sound
' while a song plays: -D NOMUSIC plays an empty one.
#ifndef NOSOUND
#include <music/music.bas>
#ifndef NOMUSIC
#include "assets/title.bas"
#include "assets/gamesong.bas"
#else
#include "assets/quiet.bas"
#endif
#ifndef NOSFX
#include "assets/sfx.bas"
#endif
#endif
```

(`platform_cpc.bas:59-83`.) The switches are all optional:

| Switch | Effect |
|---|---|
| `-D NOSOUND` | no music, no effects: the sound code is not even compiled |
| `-D NOMUSIC` | effects only (an empty song plays so the effects can advance) |
| `-D NOSFX` | music only |

Add them to a target's `defines` in `cpcbuild.json` (for example `["CPC464", "NOSOUND"]`) or just leave them out. They are
`#ifdef` switches, nothing more: the game logic never mentions them.

## Step 3: Start the sound

In `platform_cpc.bas` add these variables after the `hLit` line:

```basic
DIM curTune AS UBYTE                     ' the music playing: 0 none, 1 title, 2 game
' PlatSfx(n) -> the bank's effect: 1 jump = "shot", 2 lamp = "wave", 3 death
' = "hit", 4 door = "boom"
DIM sfxMap(4) AS UBYTE => {0, 1, 4, 3, 2}
```

`sfxMap` translates the game's four effect numbers into the effects bank's numbering
(the game's 1 is the bank's 1: "shot", used as the jump; the game's 2 is the bank's 4, "wave", for a lamp;
3 is "hit", for death; 4 is "boom", for a door opening). This is the only place that knows the
bank's order, so a new bank means changing one table.

In `PlatInit` add the effects bank, at the end, and **remove the `GameMode(1)` line** (we turn game mode on
only while playing, in a moment):

```basic
  sForce = 0
  hLit = 255
#ifndef NOSFX
  SfxInit(@sf_sfx)
#endif
END SUB
```

Now replace the empty `PlatSfx` and add the other two calls (`PlatPlaying` is here because it belongs with the other "while playing" settings):

```basic
' Game mode while playing (more CPU), unless -D NOGAMEMODE.
SUB PlatPlaying(flag AS UBYTE)
#ifndef NOGAMEMODE
  GameMode(flag)
#endif
END SUB

' 0 off, 1 the title's tune, 2 the game's.
SUB PlatMusic(tune AS UBYTE)
#ifndef NOSOUND
  IF tune = curTune THEN RETURN
  curTune = tune
  IF tune = 0 THEN
    MusicStop()
  ELSEIF tune = 1 THEN
#ifndef NOMUSIC
    MusicInit(@sf_title, 0)
#else
    MusicInit(@bounce_quiet, 0)
#endif
  ELSE
#ifndef NOMUSIC
    MusicInit(@sf_game, 0)
#else
    MusicInit(@bounce_quiet, 0)
#endif
  END IF
#endif
END SUB

' Effects: 1 jump, 2 lamp lit, 3 death, 4 door opens (they replace one
' still playing; heard while a tune plays).
SUB PlatSfx(n AS UBYTE)
#ifndef NOSFX
  IF curTune <> 0 THEN SfxPlay(sfxMap(n), 0, 0)
#endif
END SUB
```

(`platform_cpc.bas:319-354`.) `PlatMusic(tune)` is 0 for off, 1 for the title's tune, 2 for the game's. It
remembers which tune is playing (`curTune`) so it does not restart it every call. `PlatSfx(n)` does
nothing when no tune plays (an effect needs the player's tick).

**Game mode.** `PlatPlaying(1)` is `GameMode(1)`: the firmware's own interrupt handler, which takes about
12 % of the machine, is switched off while the game runs (`-D NOGAMEMODE` leaves it on; the finished game is
measured both ways in chapter 9). The music player keeps working, because it runs from the frame hook
rather than the firmware's interrupt (library: **Frame hook and game mode**).

## Step 4: Ask for the sound from the game

`game.bas` already calls `PlatSfx` where things happen: `PlatSfx(1)` when a jump starts, `PlatSfx(2)` in
`LightLamp`, `PlatSfx(4)` when the doors open, `PlatSfx(3)` in `Die`. Nothing in the game changes.

`main.bas` starts and stops the tunes. Add these calls to `TitleScreen` and `RunGame`:

```basic
SUB TitleScreen()
  ...
  PlatClear()
  PlatMusic(1)               ' <- new: the title's tune
  PlatText(4, 3, "LAMPLIGHTER")
  ...

SUB RunGame()
  DIM ov AS UBYTE
  PlatClear()
  PlatMusic(2)               ' <- new: the game's tune
  PlatPlaying(1)             ' <- new: game mode on
  GameInit(9)
  ...
  LOOP
  PlatPlaying(0)             ' <- new, after the loop: game mode off
  PlatMusic(0)               ' <- new: silence
END SUB
```

(`main.bas:158-255`; the finished file wraps the same calls with its test switches.)

## Build and run

**CPCBuild: Build and Run**. The emulator tab needs its sound switched on: click the screen and the
**Click for sound** button, once.

You should hear the title tune on the title screen, a different tune when the game starts, a
short blip when you jump, a chime when a lamp lights, a boom when the door opens, and a hit when you
die. When the game ends the music stops.
<!-- CHECK (hearing, for the user's test session): the toolbar button is labelled "Click for sound" (confirmed in the emulator's screenshots) and disappears once audio runs; confirm you actually hear the tunes and effects in the tab. -->

Test the switches: add `NOMUSIC` to the target's `defines`, rebuild: effects only. Then `NOSOUND`:
silence, and a smaller program. The screen must look identical in all three (the finished game's
tests check pixel for pixel that the sound switches change no pixel of room 9).

## How it works

**What sound costs.** In memory: the finished game is **26,749 bytes** on the 464 with sound
(`DESIGN.md` section 12) and **22,335** built with `-D NOSOUND` (measured by compiling the finished game with
`build_cpc.sh`'s flags plus `-D NOSOUND`): about 4.4 KB for the player, two tunes and the effects.
(`DESIGN.md` section 11 gives 22,404 for the game before the sound milestone: an earlier stage of the
code, not a build with the sound compiled out.) In time: the player costs about 3,700 T-states a frame, **about 6 % of the CPU**
(`DESIGN.md`, "As built", section 12); the library's own figure is about 5 % (16 scan lines a frame).
The 464 build had only about 8 % headroom before sound, so chapter 9 shows what had to be optimised to afford it.

**Why no bank on the 6128?** The library can keep songs in the 6128's extra RAM
(**Extra RAM banks (6128)**, `MusicInitBank`), but Lamplighter's songs are small (the finished game's notes say "a few hundred bytes of song"), so they live in main RAM on both models, and the 464 and 6128 builds are the same program.

**Auto mode.** `MusicAuto` defaults to 1: `MusicInit` hooks the player onto the frame hook. In manual mode
(`MusicAuto = 0`) you call `MusicFrame` yourself once per frame and the hook's one slot stays free for
your own code. Lamplighter does not need that.

**`SfxPlay(n, 0, 0)`** plays effect *n* on channel A at full volume. A new effect replaces one still
playing (the comment on `PlatSfx` says so).

## Writing your own music

The tutorial does not need you to, but if you want to: write a song in **Arkos Tracker 3**, save it as
`.aks`, and run **CPCBuild: Convert Music** on it (right-click the `.aks` in the Explorer, or run the command
from the Command Palette with the song open; Studio also takes Vortex Tracker `.vt2` files, which is what
the repository's own songs are). **CPCBuild: Open in Arkos Tracker** opens the application: set
`cpcbuild.arkos.trackerPath`, and for the converter set `cpcbuild.arkos.toolsPath` to the folder with the
Arkos command-line tools (**Check Environment** lists them as optional; its fix line is `sh tools/arkos/fetch.sh`
in a cpcbuild checkout). That runs `tools/aks2bas.py`, the same tool as on the command line:

```sh
python3 tools/aks2bas.py tune.aks tune.bas --name tune
python3 tools/aks2bas.py --sfx sfx.aks sfx.bas --name sfx
```

and you get a `.bas` like the ones you copied. **CPCBuild: Play Music** (also in the Explorer menu for `.aks`
and `.vt2`) builds a tiny preview program around the real player and plays your song in the emulator tab:
what you hear is what the library plays. **CPCBuild: Stop Music** ends it. The tutorial did not run these
commands (they need the Arkos tools), so treat this paragraph as read from the Studio's source, not as tried.

## Try this

1. Change `sfxMap` so the jump plays the door's boom. Hear it.
2. Start the game's tune in the title and the title's tune in the game (swap the `PlatMusic` arguments).
3. Play an effect at half volume: `SfxPlay(sfxMap(n), 0, 8)`.
4. Build with `-D NOMUSIC` and compare the program's size with the full build: how much do the songs cost?
5. Add `PlatSfx(3)` when the player lands from a jump (you need a new effect in the bank for it to sound distinct: use an existing one for now).

## What you have now

The complete CPC 464 game. Next: [Chapter 9, Measuring](09-measuring.md): is it fast enough, and
how do you know?

# Phase 5b design: frame hook, game mode, Arkos music

Decisions (notes.md, 2026-10-03): music runs from the frame interrupt;
sound effects through the music player; CPC first (Spectrum in 5c) with an
architecture-neutral API; player = Arkos Tracker 3.7 **AKG** (MIT) with
sound effects; the Arkos tools may run outside the sandbox for the
conversion and song export; bounce's tune is generated from its existing
melody; the player and `music.bas` live in the **cpcbuild repo**
(`lib/`), not the compiler fork. Game mode (Q21) is opt-in.

## 1. Frame hook and game mode (zxbasic runtime)

The hook is the one place per-frame work (the music player, user code)
runs, in every mode.

- `FrameHook(addr)` / `FrameHookOff()` in cpc.bas. The hook is always
  registered as a firmware frame-flyback event (KL_NEW_FRAME_FLY) with a
  **far address, ROM select &FF** (both ROMs off), so the routine can live
  anywhere, including program code at &1000-&3FFF.
- A wrapper (runtime `framehook.asm`) saves AF, BC, DE, HL, IX, IY and the
  alternate bank, runs the hook with interrupts off, and restores them. It
  counts frames (`Frames()`).
- **Normal mode** (default): our &0038 handler chains to the firmware as
  now; the firmware runs the event every frame.
- **Game mode** (`GameMode(1)` / `GameMode(0)`): outside firmware calls
  our handler doesn't chain to the firmware. It detects the frame flyback
  (PPI port B bit 0) and calls the hook wrapper itself. Inside firmware
  calls (IN_FW = 1, or the lower ROM on, where the ROM's &0038 is used)
  interrupts still go to the firmware, which runs the event. Each frame
  takes exactly one path.
- **What stops in game mode while not in a firmware call:** the firmware
  key buffer (use ScanKeys), its 300 Hz clock (use `Frames()`), its sound
  queue (use the music player) and its ink refresh (the every-10-frames
  palette rewrite also stops).
- **To prove first, in the emulator:** a far event with ROM select &FF
  runs with both ROMs off; the interrupt state an event routine is entered
  with; no frame is missed or run twice across mode switches and firmware
  calls.

## 2. Music library (cpcbuild `lib/`)

- `tools/arkos/`: pinned downloads (AT3 3.7 player sources, Rasm 3.3,
  Disark 2.0.0) and a conversion script: Rasm assembles PlayerAkg for the
  CPC with sound effects, `-s -sl -sq` for symbols; Disark
  (`--sourceProfile pasmo --hexPrefix 0x --undocumentedOpcodesToBytes`)
  turns it into plain source; a post-processor adds `:` to labels and
  renames clashes (`end`). Output committed as `lib/music/akg_cpc.asm` with
  Arkos's MIT notice (`lib/music/LICENSE.arkos`).
- `lib/music/music.bas`:
  - Music: `MusicInit(@song, subsong)`, `MusicStop()`, `MusicFrame()`
    (manual: DI, full register save, Play). `MusicInit` puts the player on
    the frame hook.
  - Effects: `SfxInit(@effects)`, `SfxPlay(n, channel, inverted volume)`,
    `SfxStop(channel)`.
  - The player hijacks SP and self-modifies, so every call runs with
    interrupts off; it must not run while Play or other AY writers own
    the AY.
- `tools/aks2bas.py`: wraps SongToAkg (and SongToSoundEffects) with a
  custom source profile, then post-processes to a Boriel include.
- The include path: cpcrun.py, run.sh and the Makefile pass
  `-I <cpcbuild>/lib`.
- Test songs: the Arkos repo's MIT test songs (with the notice). The
  bundled example songs (no licence) are never shipped.

## 3. bounce.bas

- A script generates an Arkos `.aks` from bounce's Am-F-C-G melody and
  bass, plus a small sound-effects bank for the blips. Both are exported
  with `tools/aks2bas.py`.
- bounce plays the music and effects through `music.bas`; `-D GAMEMODE`
  switches game mode on. Measured with `-D BENCH`.
- Target: 25 updates/s with music and effects in game mode.

## Who does what

The main model writes the specs, reviews the diffs, decides on anything
found, re-runs every verification step and commits. The interrupt-handler
change touches every program, so the main model writes that part itself.

| # | Work | Who |
|---|---|---|
| C1a | Prove the far-address event (ROM &FF), the event's interrupt state, frame detection in our ISR: small emulator experiments | sonnet |
| C1b | `isr.asm` game-mode path, `framehook.asm`, cpc.bas API | **main model** |
| C1c | Tests: frame count in both modes; hook runs every frame, including during WaitRetrace and PRINT; no double calls across mode switches; game-mode interrupt load (busy loop); a game-mode stress test | sonnet |
| C2 | Arkos pipeline, `akg_cpc.asm`, `music.bas`, `aks2bas.py`, include path; tests with the MIT test songs (AY registers while playing, frame-accurate tempo, SFX, stop) on chips and Caprice32 | sonnet (Arkos tools may run unsandboxed) |
| C3 | bounce: generated `.aks` and SFX bank, integration, `-D GAMEMODE`, benchmarks, screen golden if it changes | sonnet |
| C4 | Docs: library.md (music, game mode, frame hook), the zxbasic arch page (game mode, frame hook), README, notes | haiku |

C1a and C2 start in parallel; C1b follows C1a; C1c follows C1b; C3 needs
C1 and C2; C4 last.

## Verification (main model)

- Conformance and screen tests on chips (464, 6128) and Caprice32 (464,
  664, 6128); zxbasic pytest; CI green on `phase-5b`.
- Game-mode interrupt load measured, against 12.3 % (idle) and 22.9 %
  (busy sound) in normal mode.
- bounce with music: updates/s in normal and game mode.
- Listen: bounce with the Arkos music in Caprice32, for the user.

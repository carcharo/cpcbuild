# Starfall: a single-screen shooter, four builds

The Phase 5c demo game (docs/phase5c-design.md). One Boriel BASIC
codebase; builds for CPC 6128, CPC 464, Spectrum 128K and Spectrum 48K.
The point is the cross-platform machinery, so the game is deliberately
small and its rules simple.

## Game

- **Title screen:** the game name, a "press fire" prompt, the high score,
  and the title music (where the build has music). An attract mode starts
  after a few seconds idle (the game plays itself with a fixed random seed)
  and ends on a key press.
- **Play:**
  - **Player:** a ship on the bottom row moves left and right and fires
    upwards, with at most 2 bullets on screen.
  - **Enemies:** a formation of 3 rows of 6 moves sideways and steps down
    at each edge. It speeds up as it thins out and with each wave.
  - **Enemy attacks:** now and then an enemy drops a bomb, at most 3 bombs
    on screen. From wave 2, one enemy at a time may leave the formation and
    dive at the player in a curve, then return to its slot.
  - **Score:** 10 / 20 / 30 points by row, 50 for a diving enemy. Shown in
    a HUD line with the lives (3 to start) and the wave number.
  - **Life lost:** when the player is hit by a bomb or a diver. The wave
    restarts from its current state after a short pause.
  - **Game over:** when lives reach 0 or the formation reaches the
    player's row. Game over leads back to the title.
- **Sound** (music builds):
  - **Music:** the title tune on the title screen, a quieter in-game loop
    while playing.
  - **Effects:** shoot, enemy explodes, player hit, wave cleared.

## Logical coordinates (shared by all builds)

The game logic works in **logical units**:
- **Playfield size:** 128 wide by 160 tall.
- **Sprites:** 8x8 units, bullets 1x4, bombs 1x4.
- **Mapping:**
  - **CPC mode 0:** 1 unit = 1 mode-0 pixel (half a byte), 1 line = 1
    unit. The 128x160 playfield sits in the 160x200 screen with a HUD
    above it and borders at the sides.
  - **Spectrum:** 1 unit = 2 pixels horizontally, 1 line = 1 unit
    vertically, so the playfield is 256x160 inside 256x192, with the HUD
    in the top character rows.
- **Sprite x:** every sprite position the logic hands to the layer has an
  even x, so it maps to whole bytes on the CPC and to 4-pixel steps on
  the Spectrum.
- **Spectrum colour:** colour attributes are per 8x8 cell. The playfield
  background is black with one bright ink per sprite kind (ship, enemy
  rows, bombs), so clash stays mild. The HUD uses its own cells.

## Timing

- **Logic rate:** the game logic runs at a fixed **25 Hz** (one logic step
  every 2 frames), timed from the frame counter (`Frames()` on the CPC,
  the ROM FRAMES variable on the Spectrum).
- **When a build is slower:** it runs one logic step per drawn frame and
  says so in its BENCH output, never "catching up" with several steps in a
  row.
- **Randomness:** one small LCG, seeded from the frame counter on the
  title screen. The attract mode and `-D DEMO` seed it with a constant, so
  runs are reproducible for tests.

## The portable layer

Shared files: `game.bas` (logic) and `main.bas` (title, game loop, game
over). The logic calls only these routines; each platform implements them
in `platform_cpc.bas` or `platform_zx.bas`.

| Routine | Does |
|---|---|
| `PlatInit()` | screen mode, palette or attributes, screens, music and effects setup, keyboard |
| `PlatFrameBegin()` | start of a drawn frame: erase the sprites drawn last time on the drawing screen |
| `PlatSprite(kind, frame, x, y)` | queue or draw a sprite (kind: 0 ship, 1-3 enemy rows 0-2, 4 diver, 5 bullet, 6 bomb, 7 explosion) at logical x, y |
| `PlatFrameEnd()` | finish the frame: flip (double-buffered) or nothing (single-buffered), then wait so frames are paced |
| `PlatHud(score, lives, wave, hiscore)` | redraw the HUD where it changed |
| `PlatText(col, row, s$)` | text for the title and game over, in character cells of the platform (the logic uses fixed positions per platform from a table) |
| `PlatClear()` | clear the playfield (new wave, title) |
| `PlatInput() AS UBYTE` | bits: 1 left, 2 right, 4 fire, 8 any key/start. Keys: O / P / Space plus the cursor keys on the CPC, and a joystick (CPC joystick 0; Kempston on the Spectrum) |
| `PlatFrames() AS UINTEGER` | the frame counter (low 16 bits) |
| `PlatMusic(tune)` | 0 off, 1 title, 2 in-game (no-op on the 48K) |
| `PlatSfx(n)` | effect n (AY on CPC/128K, beeper on the 48K) |
| `PlatEnd()` | called at game end; used by -D SHOT/BENCH to exit |
| `PlatShot(name$)` | triggers a screenshot (used by -D SHOT for test goldens) |

**Sprite kinds:** 0 ship, 1 enemy row 0 (bottom, 10 points), 2 enemy row 1 (20 points), 3 enemy row 2 (top, 30 points), 4 diver, 5 bullet, 6 bomb, 7 explosion. Erasing on the Spectrum happens at the end of each frame; on the CPC per platform (on 6128 after the flip, on 464 just before redraw).

### Per-platform notes

- **CPC** (`platform_cpc.bas`): cpcbuild library (sprites, masked; tiles for the
  border and HUD frame; ScanKeys; SetPalette), `music/music.bas`, framehook.bas
  with `GameMode(1)` while playing. Custom 8x8 sprite routines (the cpcbuild library
  at 20.5 KB didn't fit below &4000 when added to the game code). Erasing restores
  the background from the tile map with TileRestore-like logic per platform.
  - **6128:** double-buffered with `EnableDoubleBuffer`; songs and effects in
    an extra bank via `MusicInitBank`, loaded from the disc at start.
  - **464:** single-buffered. Draws in flyback order (wait for flyback, erase and
    redraw each sprite in turn, top to bottom) to keep tearing to one line.
    Music in main RAM; pacing at 25.0 steps/s with about 30 % CPU to spare (not
    held to a frame).
- **Spectrum** (`platform_zx.bas`): custom 16x16-pixel masked sprite routines (Boriel's
  maskedsprites took 2.3 frames for 25 sprites). PRINT AT for text.
  - **128K:** `music/music.bas` with the IM2 frame hook; double-buffered using shadow
    screens (banks 5 and 7).
  - **48K:** single-buffered; no music, short beeper effects through `PlatSfx`.
  - **Own sprite routines:** draw sprites at any pixel x (0-240, from pre-shifted data
    to nearest 2-pixel boundary; only the shifts used are stored since x steps are 4 pixels)
    and any line y (0-176), save/restore the background. Sprites 16x8 pixels (8x8 logical
    units), padded to 16x16 with transparent lower half. Collision stays in logical units.
    Candidates for later folding into per-platform sprite libraries.

## Builds

| Build | Command (via the game's build script) | Output |
|---|---|---|
| CPC 6128 | `--arch cpc --org 0x40 -D CPC6128` | `starfall.bin` + `starfall.dat` (bank data) on `starfall.dsk` |
| CPC 464 | `--arch cpc --org 0x40 -D CPC464` | `starfa64.bin` on the same disc |
| Loader | `--arch cpc` | `run"disc`: checks for the extra RAM (BankAvailable) and runs the right build |
| Spectrum 128K | `--arch zx48k -D ZX128` | `starfall128.tap` |
| Spectrum 48K | `--arch zx48k -D ZX48` | `starfall48.tap` |

- **Test switches** (every build): `-D DEMO` (attract mode from the start,
  fixed seed), `-D SHOT=n` (screenshot after n logic steps, then END),
  `-D BENCH` (n steps, then print the frame rate).

## Assets

- **Art:** `assets/make_art.py` draws the sprite sheet, explosion frames
  and the border tiles as PNGs with a transparent colour. `img2cpc.py`
  turns them into CPC mode 0 data (masked sprites, tiles, palette) and,
  with `--spectrum`, into Spectrum bitmap data. The Spectrum sprites are
  1-bit (ink only); colour comes from per-cell attributes chosen by the
  platform layer.
- **Music and effects:** `assets/make_music.py` writes the title tune, the
  in-game loop and the effect bank as `.vt2` (our own melodies).
  `aks2bas.py` exports them per platform (`--psg cpc|spectrum` for the
  effects; songs are clock-independent). For the 6128 they are also
  exported as a binary at the bank address.
- **Rebuilding:** `games/shooter/build_assets.sh` regenerates everything.
  The outputs are committed.

## Tests and acceptance

- **Smoke test:** each build compiles and runs `-D DEMO -D SHOT` on chips
  (CPC 464/6128, Spectrum 48K/128K), compared against a golden screenshot
  per build (title screen and a gameplay frame).
- **Game logic tests:** collision, scoring, formation stepping, wave
  speed-up, lives and game over. They run on all four builds through a
  small test entry point.
- **Speed:** BENCH per build. Targets:
  - CPC 6128: 25 Hz with music and effects in game mode;
  - CPC 464: 25 Hz in game mode (single-buffered);
  - Spectrum 128K: 25 Hz;
  - Spectrum 48K: as fast as it goes (report).
- **CI:** all of the above in CI.
- **Play session:** the user plays each build in its emulator, with the
  window visible.

' ----------------------------------------------------------------
' platform_zx.bas -- the Starfall portable layer for the ZX Spectrum
' (--arch zx48k). The API is games/shooter/DESIGN.md's layer table; the
' sprite engine is platform_zx_draw.asm (included below).
'
'   -D ZX128   Spectrum 128K: double-buffered (screens 5 and 7), Arkos music
'              and effects (music/music.bas, IM2 frame hook). If the machine
'              turns out to have no paging, it falls back to the 48K way.
'   -D ZX48    Spectrum 48K: single-buffered, beeper effects only (no player).
'   (neither is taken as ZX128)
'
'   -D NOJOY      never read the Kempston port (31)
'   -D KEMPSTON   trust port 31 without the detection below
'   (neither: the port is read only if the start-up test finds a joystick)
'
'   -D SHOT=n, -D BENCH  main.bas's test switches: PlatShot and PlatEnd
'              (see them below; PZ_NOWAIT, for layer benchmarks, makes the
'              frame wait a no-op)
'
' Build: games/shooter/build_zx.sh (the .tap files); the tests are in
' tests/zx (run.py there). Compile with -I <cpcbuild>/lib (music/music.bas).
' The art and songs come from assets/ unless the including program defines
' PLAT_ZX_SPRITES, PLAT_ZX_SHOTS and PLAT_ZX_SONG_TITLE, PLAT_ZX_SONG_GAME,
' PLAT_ZX_SFX itself (the layer's test harness does).
'
' ---------------- Screen layout ----------------
' Logical units (DESIGN.md): 1 unit = 2 pixels across, 1 line down.
'   character rows 0-1   HUD (SCORE / WAVE, HI / LIVES); its rule is the
'                        last line of row 1 (blue)
'   character rows 2-3   free: PlatText may use them (the title does)
'   lines 32..191        the playfield, 256x160 = 128x160 units: logical y
'                        -> screen line y + 32, x*2 -> pixel x. Text row r
'                        is at y = 8 r - 32.
' PlatText is for character rows 2-23 (rows 0-1 belong to the HUD), and
' PlatClear clears rows 2-23 (not the HUD).
'
' ---------------- Sprites ----------------
' Not maskedsprites' drawing code. Boriel's cb/maskedsprites.bas is still
' used for what it does well (paging check, bank 7 at C000, switching
' which screen is shown and drawn on) but its 16-line sprites were too slow:
' benchmarked here, saving + drawing + restoring 25 of them took 2.3 frames
' (50 Hz) with nothing else, against the 2 frames of a whole 25 Hz game
' step. Ours (platform_zx_draw.asm) are 16x8 pixels, drawn from pre-shifted
' copies, with the saved background and the attribute handling in the same
' routine: about 4.7K T-states per sprite (erase, draw, attributes) and,
' because a sprite that is unchanged since its screen was last drawn is left
' alone, much less in practice. The art needs only the pixel shifts our
' even x allow (0 and 4 pixels).
'
' The art is the one of assets/zx/ (img2cpc.py --spectrum output, UDG order):
'   zx_sprites  12 frames of 4 cells (top-left, top-right, then two empty
'               cells), 32 bytes each: ship; enemy row 0 (2 frames), row 1,
'               row 2; diver (2); explosion (3)
'   zx_shots    2 frames of 32 bytes: bullet, bomb
' Only the first 16 bytes of a frame are read (the art in the 16x8 top
' half). The art is ink only: drawing is (screen OR graph), which is what
' a mask made of "everything that isn't ink" would give. Bullets and bombs
' (1x4 units = 2x4 pixels, art in the top-left 2x4 pixels of the frame) are
' one byte wide at any x (our x*2 is a multiple of 4, the art 2 pixels).
' PlatInit makes the copies (graph bytes only) in the sprite area.
'
' Kinds (the first argument of PlatSprite; tables PzNFrames, PzSheet,
' PzBase, PzAttr below hold the per-kind data):
'   0 ship, 1-3 enemy rows 0-2, 4 diver, 5 bullet, 6 bomb, 7 explosion
' Limits: at most 28 sprites a frame (more are dropped), y <= 152 (156 for
' bullets and bombs): below that the sprite would run off the screen.
' PlatSprite queues; PlatFrameEnd draws (see "Frame model").
'
' ---------------- Colour ----------------
' Spectrum attributes are per 8x8 cell and the sprites are bitmaps, so
' drawing a sprite also sets the attribute of the cells its art covers to
' that kind's bright ink on black paper (the old values are saved, so
' erasing puts back exactly what was there, text included). Colours: ship
' cyan, enemy rows green / red / magenta (as on the CPC), diver yellow,
' bullet white, bomb yellow, explosion white.
' Clash (accepted): a cell holds one ink, so where two kinds share a cell
' (a bullet passing through an enemy, a bomb beside an enemy, the red and
' green enemy rows, 12 lines apart, sharing cell rows) the one drawn last
' wins for the whole cell, and a sprite 16 pixels wide spans 2 or 3 cells,
' so its colour changes at cell boundaries as it moves (a 4-pixel step moves
' it between 2 and 3 cells). Black paper, bright ink: only lit pixels show,
' so a wrong ink is a wrong colour on a few pixels, never a coloured block.
'
' ---------------- Memory plan ----------------
'   0000-3FFF   ROM
'   4000-57FF   screen 5 bitmap       5800-5AFF   its attributes
'   5B00-7FFF   system variables, BASIC area (the stack lives here, below
'               the loader's CLEAR)
'   ORG-        our program: heap (256 bytes), variables, init, the music
'               player (128K: the Arkos AKG player, about 3.3 KB; the IM2
'               vector block, 512 bytes aligned to 256; the songs and the
'               effect bank), the sprite engine, the game and the Boriel
'               runtime. 48K: ORG 32768, ends about AEBF, to DB00 free.
'               128K: ORG 31744 (7C00), ends about BD85, and it has to end
'               below C000 (635 bytes to spare when this was written;
'               build_zx.sh checks). 7C00-7FFF is the heap and the first
'               700 bytes or so of the variables, the only contended part
'               of the program (all the code is above 8000).
'   DB00-E830   the sprite engine's data (platform_zx_draw.asm, fixed
'               addresses): DB00 the draw records (2 sets x 28 x 16 bytes),
'               DE80 the saved backgrounds (2 x 28 x 24), E400 the image
'               pointers, E440 the attribute table, E450 the images (graph
'               bytes: 40 per wide frame, 8 per narrow, about 500 bytes in
'               all). The 48K build has one set only (the rest is unused).
'   E830-FFFF   free (about 6 KB in bank 7 on a 128K).
'   128K only:  bank 7 is paged in at C000-FFFF for good: it holds screen 7
'               (C000-DAFF) and the engine's data above it, so one mapping
'               reaches both screens and the data. PlatEnd pages the bank
'               that was there back (BASIC, or the headless runner's stack
'               up at FF42, needs it). Banks 0-4 are free (they would take
'               song data if the program ever outgrows C000).
'   Contention: screen 5 (4000) is contended on both models, and bank 7 (odd
'               banks) on a 128K, so the engine's data in bank 7 is slower
'               than main RAM would be; measured: moving it made no
'               difference to the benchmark, the screen writes dominate.
'
' ---------------- Frame model ----------------
' PlatFrameBegin empties the queue; PlatSprite queues (kind, frame, x, y)
' and the order is the drawing order; PlatFrameEnd makes the drawing screen
' show exactly the queue (platform_zx_draw.asm: unchanged sprites at the
' start of the list are left alone, the rest of the old ones are erased in
' reverse order and the rest of the new ones drawn):
'   128K: draws on the hidden screen, then waits until 2 frames have passed
'         since the last flip (25 Hz; a slower game isn't held back and
'         never catches up), flips the visible screen at the start of a frame
'         (no tearing) and switches the drawing screen and set.
'   48K : waits for the frame (2 frames since the last), then changes the
'         one screen ahead of the beam, back to back (it can flicker where
'         the beam catches a sprite; unchanged sprites aren't touched).
'   The HUD and text are printed on the drawing screen: PlatHud keeps what
'   each screen shows (both need the change), PlatText prints on both.
' ----------------------------------------------------------------

#ifndef __PLATFORM_ZX__
#define __PLATFORM_ZX__

#ifndef __ZX48K__
#error "platform_zx.bas is for --arch zx48k"
#endif

#ifdef ZX48
#ifdef ZX128
#error "define only one of ZX48, ZX128"
#endif
#else
#ifndef ZX128
#define ZX128
#endif
#endif

' The art and (128K) the songs and effects: ours, unless the including
' program (the layer's test harness) defined its own.
#ifndef PLAT_ZX_SPRITES
#include "assets/zx/zx_sprites.bas"
#include "assets/zx/zx_shots.bas"
#define PLAT_ZX_SPRITES @zx_sprites(0)
#define PLAT_ZX_SHOTS @zx_shots(0)
#endif
#ifdef ZX128
#ifndef PLAT_ZX_SONG_TITLE
#include "assets/title.bas"
#include "assets/gamesong.bas"
#include "assets/zx/sfx_zx.bas"
#define PLAT_ZX_SONG_TITLE @sf_title
#define PLAT_ZX_SONG_GAME @sf_game
#define PLAT_ZX_SFX @sf_sfx
#endif
#endif

#include <cb/maskedsprites.bas>
#include <music/music.bas>

' Start-up (runs where this file is included, so include it before any
' code that matters): the stack must not be in the top 16K, which on a
' 128K is the paged window and on both models holds our sprite area.
' The BASIC loader (CLEAR) already leaves it below the program; a loader
' that starts the program with SP near the top (the headless runner does)
' gets it moved to just below the program's ORG.
ASM
    ld hl, 0
    add hl, sp
    ld a, h
    cp 0xC0
    jr c, __PZ_SP_OK
    ld sp, .core.__START_PROGRAM    ; just below our code (the ORG)
__PZ_SP_OK:
    jp __PZ_DRAW_END
#include "platform_zx_draw.asm"
__PZ_DRAW_END:
END ASM

#ifdef BENCH
' BENCH builds PRINT their result and END, and the headless runner's final
' screenshot is of the last whole frame, before that PRINT. So END returns
' through a stub that waits 10 frames first (the original return address,
' BASIC's or the runner's, is kept).
ASM
    ld hl, (.core.__CALL_BACK__)
    ld de, 6
    add hl, de                  ; the return address under the 3 saved words
    ld e, (hl)
    inc hl
    ld d, (hl)
    ld (__PZ_BENCH_RET), de
    ld de, __PZ_BENCH_END
    ld (hl), d
    dec hl
    ld (hl), e
    jp __PZ_BENCH_SKIP
__PZ_BENCH_RET:
    dw 0
__PZ_BENCH_END:
    ei
    ld b, 60
__PZ_BENCH_WAIT:
    halt
    djnz __PZ_BENCH_WAIT
    ld hl, (__PZ_BENCH_RET)
    jp (hl)
__PZ_BENCH_SKIP:
END ASM
#endif

CONST PZ_KINDS AS UBYTE = 8
CONST PZ_IMGTAB AS UINTEGER = 58368     ' E400: see platform_zx_draw.asm
CONST PZ_ATTRTAB AS UINTEGER = 58432    ' E440
CONST PZ_IMGS AS UINTEGER = 58448       ' E450

' ---- per-kind data (0 ship, 1-3 enemy rows, 4 diver, 5 bullet, 6 bomb, 7 explosion)
DIM PzNFrames(7) AS UBYTE => {1, 2, 2, 2, 2, 1, 1, 3}
DIM PzSheet(7) AS UBYTE => {0, 0, 0, 0, 0, 1, 1, 0}     ' 0 sprites, 1 shots
DIM PzBase(7) AS UBYTE => {0, 1, 3, 5, 7, 0, 1, 9}      ' first frame in its sheet
' attribute: BRIGHT + ink on black paper: ship cyan, enemy rows green / red /
' magenta (as on the CPC), diver yellow, bullet white, bomb yellow, explosion white
DIM PzAttr(7) AS UBYTE => {69, 68, 66, 67, 70, 71, 70, 71}

' ---- state
DIM pzDbl AS UBYTE                  ' 1: double-buffered
DIM pzDs AS UBYTE                   ' drawing set (0/1): the HUD shadows
DIM pzBank0 AS UBYTE                ' the bank that was at C000 before we paged in 7
DIM pzLast AS UINTEGER              ' FRAMES at the last flip
#ifdef ZX48
DIM pzSfxDone AS UBYTE              ' 1: a beeper effect already played this step
#endif
DIM pzJoy AS UBYTE                  ' 1: read Kempston
DIM pzHScore(1) AS UINTEGER            ' HUD values as drawn, per screen
DIM pzHLives(1) AS UBYTE
DIM pzHWave(1) AS UBYTE
DIM pzHHi(1) AS UINTEGER
DIM pzHValid(1) AS UBYTE

' ---------------- helpers ----------------

' Frame pacing: waits for the frame interrupt (HALT, repeatedly) until 2
' frames have passed since the last flip (25 Hz), and returns just after an
' interrupt, the safe moment to flip screens. A step that took longer is
' never made up for (the next flip is again 2 frames after this one).
' (A schedule that pays an overrun back with a shorter next frame was tried:
' it gains nothing here, since the steps after a late one cost more than the
' one frame it would have left them.)
SUB PzWait()
#ifdef PZ_NOWAIT
  RETURN                 ' benchmark builds: never wait, so the frame time shows
#endif
  DO
    ASM
    ei
    halt
    END ASM
  LOOP UNTIL PEEK(UINTEGER, 23672) - pzLast >= 2
  pzLast = PEEK(UINTEGER, 23672)
END SUB

' everything below the HUD (character rows 2-23): bitmap and attributes of
' the screen at base
SUB PzClearArea(base AS UINTEGER)
  DIM s AS UBYTE
  FOR s = 0 TO 7
    MemSet(base + CAST(UINTEGER, s) * 256 + 64, 0, 192)
    MemSet(base + 2048 + CAST(UINTEGER, s) * 256, 0, 256)
    MemSet(base + 4096 + CAST(UINTEGER, s) * 256, 0, 256)
  NEXT s
  MemSet(base + 6144 + 64, 0, 704)
END SUB

SUB PzPrint(row AS UBYTE, col AS UBYTE, ik AS UBYTE, s AS STRING)
  PRINT AT row, col; INK ik; BRIGHT 1; PAPER 0; s;
END SUB

SUB PzNum(row AS UBYTE, col AS UBYTE, v AS UINTEGER, n AS UBYTE)
  DIM i AS BYTE
  FOR i = n - 1 TO 0 STEP -1
    PRINT AT row, col + i; INK 7; BRIGHT 1; PAPER 0; CHR$(48 + CAST(UBYTE, v MOD 10));
    v = v / 10
  NEXT i
END SUB

' Kempston: 1 if port 31 looks like a joystick. A machine without one
' returns the floating bus (&FF in the border and retrace, screen bytes
' while the beam is in the display); a Kempston never sets bits 5-7. So
' sample for a while: any byte with bit 5, 6 or 7 set means "no joystick".
FUNCTION PzDetectJoy() AS UBYTE
#ifdef NOJOY
  RETURN 0
#else
#ifdef KEMPSTON
  RETURN 1
#else
  DIM i AS UINTEGER
  DIM ok AS UBYTE
  ok = 1
  FOR i = 1 TO 1500
    IF (IN(31) BAND 224) <> 0 THEN ok = 0: EXIT FOR
  NEXT i
  RETURN ok
#endif
#endif
END FUNCTION

' Make the images of the art at address a (left cell 8 bytes, right cell 8)
' at dst, graph bytes only (set = ink): for a wide sprite 8 rows of 2 bytes,
' then the same shifted right by 4 pixels, 8 rows of 3 bytes; for a narrow one
' (art in the first 4 rows of the left cell) 4 rows of 1 byte, then shifted.
' Returns the address after them.
FUNCTION PzBuild(kind AS UBYTE, frame AS UBYTE, a AS UINTEGER, dst AS UINTEGER) AS UINTEGER
  DIM r, l, rt AS UBYTE
  POKE UINTEGER PZ_IMGTAB + CAST(UINTEGER, kind * 4 + frame) * 2, dst
  IF kind = 5 OR kind = 6 THEN
    FOR r = 0 TO 3
      l = PEEK(a + r)
      POKE dst + r, l
      POKE dst + 4 + r, l >> 4
    NEXT r
    RETURN dst + 8
  END IF
  FOR r = 0 TO 7
    l = PEEK(a + r): rt = PEEK(a + 8 + r)
    POKE dst + r * 2, l
    POKE dst + r * 2 + 1, rt
    POKE dst + 16 + r * 3, l >> 4
    POKE dst + 16 + r * 3 + 1, ((l BAND 15) << 4) BOR (rt >> 4)
    POKE dst + 16 + r * 3 + 2, (rt BAND 15) << 4
  NEXT r
  RETURN dst + 40
END FUNCTION

' ---------------- the layer ----------------

SUB PzAsmInit(hi AS UBYTE, dbl AS UBYTE)
  ASM
    ld a,(ix+5)
    ld b,(ix+7)
    push ix
    call __PZ_INIT
    pop ix
  END ASM
END SUB

SUB PlatInit()
  DIM k, f, b AS UBYTE
  DIM u, dst AS UINTEGER
  BORDER 0: PAPER 0: INK 0: BRIGHT 0: FLASH 0
  CLS
  pzJoy = PzDetectJoy()
#ifdef ZX128
  pzDbl = CheckMemoryPaging()
#else
  pzDbl = 0
#endif
  IF pzDbl THEN
    pzBank0 = GetBankPreservingRegs()
    SetVisibleScreen(5)
    b = SetDrawingScreen7()   ' bank 7 stays paged in at C000 for good
    CLS
    PzAsmInit(192, 1)         ' frame 0 is drawn on screen 7, then flipped to
  ELSE
    PzAsmInit(64, 0)
  END IF
  pzDs = 0
  pzLast = PEEK(UINTEGER, 23672)
  pzHValid(0) = 0: pzHValid(1) = 0
  dst = PZ_IMGS
  FOR k = 0 TO PZ_KINDS - 1
    POKE PZ_ATTRTAB + k, PzAttr(k)
    FOR f = 0 TO PzNFrames(k) - 1
      IF PzSheet(k) = 0 THEN u = PLAT_ZX_SPRITES ELSE u = PLAT_ZX_SHOTS
      dst = PzBuild(k, f, u + CAST(UINTEGER, PzBase(k) + f) * 32, dst)
    NEXT f
  NEXT k
  ' HUD rule: the last line of character row 1 (the font leaves it empty),
  ' blue like the cells above it, on both screens
  FOR f = 0 TO pzDbl
    FOR k = 0 TO 31
      POKE GetScreenBufferAddr() + 1792 + 32 + k, 255
    NEXT k
    MemSet(GetAttrBufferAddr() + 32, 65, 32)       ' (row 1: text cells recolour theirs)
    IF pzDbl THEN ToggleDrawingScreen()
  NEXT f
#ifdef ZX128
  SfxInit(PLAT_ZX_SFX)
#endif
END SUB

SUB PlatFrameBegin()
#ifdef ZX48
  pzSfxDone = 0
#endif
  ASM
    call __PZ_QRESET
  END ASM
END SUB

SUB PlatSprite(kind AS UBYTE, frame AS UBYTE, x AS UBYTE, y AS UBYTE)
  ASM
    ld b,(ix+5)
    ld c,(ix+7)
    ld d,(ix+9)
    ld e,(ix+11)
    push ix
    call __PZ_SPRITE
    pop ix
  END ASM
END SUB

SUB PlatFrameEnd()
  IF pzDbl THEN
    ASM
    call __PZ_SYNC              ; draw the frame on the hidden screen,
    END ASM
    PzWait()                    ' then wait for the moment to show it
    ToggleVisibleScreen()
    ToggleDrawingScreen()
    ASM
    call __PZ_FLIP
    END ASM
    pzDs = 1 - pzDs
  ELSE
    ' the one screen: wait for the frame, then change what is on it, ahead
    ' of the beam
    PzWait()
    ASM
    call __PZ_SYNC
    END ASM
  END IF
END SUB

SUB PlatHud(score AS UINTEGER, lives AS UBYTE, wave AS UBYTE, hiscore AS UINTEGER)
  DIM s AS UBYTE
  s = pzDs
  IF pzHValid(s) = 0 THEN
    PzPrint(0, 1, 5, "SCORE")
    PzPrint(0, 21, 5, "WAVE")
    PzPrint(1, 1, 5, "HI")
    PzPrint(1, 21, 5, "LIVES")
    pzHValid(s) = 1
    pzHScore(s) = score + 1
    pzHHi(s) = hiscore + 1
    pzHLives(s) = lives + 1
    pzHWave(s) = wave + 1
  END IF
  IF pzHScore(s) <> score THEN PzNum(0, 7, score, 5): pzHScore(s) = score
  IF pzHHi(s) <> hiscore THEN PzNum(1, 7, hiscore, 5): pzHHi(s) = hiscore
  IF pzHLives(s) <> lives THEN PzNum(1, 27, lives, 1): pzHLives(s) = lives
  IF pzHWave(s) <> wave THEN PzNum(0, 26, wave, 2): pzHWave(s) = wave
END SUB

SUB PlatText(col AS UBYTE, row AS UBYTE, s AS STRING)
  PzPrint(row, col, 7, s)
  IF pzDbl THEN
    ToggleDrawingScreen()
    PzPrint(row, col, 7, s)
    ToggleDrawingScreen()
  END IF
END SUB

SUB PlatClear()
  PzClearArea(16384)
  IF pzDbl THEN PzClearArea(49152)
  ASM
    call __PZ_RESET
  END ASM
END SUB

FUNCTION PlatInput() AS UBYTE
  DIM r, k, j AS UBYTE
  r = 0
  k = IN(57342)                       ' &DFFE: P = bit 0, O = bit 1
  IF (k BAND 2) = 0 THEN r = r BOR 1
  IF (k BAND 1) = 0 THEN r = r BOR 2
  IF (IN(32766) BAND 1) = 0 THEN r = r BOR 4      ' &7FFE: Space
  IF (IN(254) BAND 31) <> 31 THEN r = r BOR 8     ' any key (all rows)
  IF pzJoy THEN
    j = IN(31)
    IF (j BAND 2) <> 0 THEN r = r BOR 1
    IF (j BAND 1) <> 0 THEN r = r BOR 2
    IF (j BAND 16) <> 0 THEN r = r BOR 4
    IF (j BAND 31) <> 0 THEN r = r BOR 8
  END IF
  RETURN r
END FUNCTION

FUNCTION PlatFrames() AS UINTEGER
  RETURN PEEK(UINTEGER, 23672)
END FUNCTION

SUB PlatMusic(tune AS UBYTE)
#ifdef ZX128
  IF tune = 0 THEN
    MusicStop()
  ELSEIF tune = 1 THEN
    MusicInit(PLAT_ZX_SONG_TITLE, 0)
  ELSE
    MusicInit(PLAT_ZX_SONG_GAME, 0)
  END IF
#endif
END SUB

#ifdef ZX48
' ---------------- 48K beeper effects ----------------
' PlatSfx(n) on the 48K plays short effects on the beeper (bit 4 of port &FE;
' the border colour bits are kept as BORDER set them (BORDCR), MIC off),
' interrupts off while it plays, blocking, then EI. At most one effect per
' logic step (PlatFrameBegin re-arms): a second PlatSfx in the same step is
' dropped. A table-driven routine: segments (count, d, step, mode); a tone
' segment is `count` square-wave cycles with half period delay d (DJNZ
' loops, 13 T per d), d += step after each cycle; a noise segment is `count`
' pseudo-random toggles (5x+1 xor R) with delay d. Durations (3.5 MHz):
'   1 shoot   19 cycles d 10..28 falling            ~10.5K T   ~3.0 ms
'   2 boom    4 noise bursts d 2,4,7,11 (14 each)    ~8.8K T   ~2.5 ms
'   3 hit     noise burst, then 20 cycles d 120..177  ~82K T   ~23 ms
'   4 wave    arpeggio C6 E6 G6, 25 ms each          ~263K T   ~75 ms
SUB PlatSfx(n AS UBYTE)
  IF pzSfxDone <> 0 THEN RETURN
  IF n = 0 THEN RETURN
  IF n > 4 THEN RETURN
  pzSfxDone = 1
  ASM
    ld a,(ix+5)
    push ix
    ld hl,__PZ_BEEP_TAB
    dec a
    add a,a
    ld e,a
    ld d,0
    add hl,de
    ld e,(hl)
    inc hl
    ld d,(hl)
    push de
    pop ix                      ; IX = the effect's segments
    ld a,(23624)                ; BORDCR: border colour in bits 3-5
    rrca
    rrca
    rrca
    and 7
    ld c,a                      ; C = port value with the speaker low
    di
__PZ_BEEP_SEG:
    ld e,(ix+0)                 ; E = count; 0 ends the effect
    ld a,e
    or a
    jr z,__PZ_BEEP_END
    ld d,(ix+1)                 ; D = delay
    ld h,(ix+2)                 ; H = step
    ld a,(ix+3)
    ld l,a                      ; L = mode (then the noise state)
    inc ix
    inc ix
    inc ix
    inc ix
    or a
    jr nz,__PZ_BEEP_NOISE
__PZ_BEEP_TONE:
    ld a,c
    or 16
    out (254),a
    ld b,d
__PZ_BEEP_T1:
    djnz __PZ_BEEP_T1
    ld a,c
    out (254),a
    ld b,d
__PZ_BEEP_T2:
    djnz __PZ_BEEP_T2
    ld a,d
    add a,h
    ld d,a
    dec e
    jr nz,__PZ_BEEP_TONE
    jr __PZ_BEEP_SEG
__PZ_BEEP_NOISE:
    ld a,l
    add a,a
    add a,a
    add a,l
    inc a
    ld l,a
    ld a,r
    xor l
    and 16
    or c
    out (254),a
    ld b,d
__PZ_BEEP_N1:
    djnz __PZ_BEEP_N1
    dec e
    jr nz,__PZ_BEEP_NOISE
    jr __PZ_BEEP_SEG
__PZ_BEEP_END:
    ld a,c
    out (254),a                 ; speaker low, border as it was
    ld (__PZ_BEEP_LAST),a
    ld hl,__PZ_BEEP_LAST+1
    inc (hl)                    ; effects played
    ei
    pop ix
    jp __PZ_BEEP_DATA_END
__PZ_BEEP_LAST:
    db 0, 0
__PZ_BEEP_TAB:
    dw __PZ_BEEP_1, __PZ_BEEP_2, __PZ_BEEP_3, __PZ_BEEP_4
__PZ_BEEP_1:
    db 19, 10, 1, 0, 0
__PZ_BEEP_2:
    db 14, 2, 0, 1, 14, 4, 0, 1, 14, 7, 0, 1, 14, 11, 0, 1, 0
__PZ_BEEP_3:
    db 10, 20, 0, 1, 20, 120, 3, 0, 0
__PZ_BEEP_4:
    db 26, 127, 0, 0, 33, 100, 0, 0, 39, 84, 0, 0, 0
__PZ_BEEP_DATA_END:
  END ASM
END SUB

#ifdef BEEPTEST
' The port value the last effect finished with (for the layer tests)
FUNCTION PzBeepLast() AS UBYTE
  ASM
    ld a,(__PZ_BEEP_LAST)
  END ASM
END FUNCTION

FUNCTION PzBeepCount() AS UBYTE
  ASM
    ld a,(__PZ_BEEP_LAST+1)
  END ASM
END FUNCTION
#endif
#else
SUB PlatSfx(n AS UBYTE)
  SfxPlay(n, 2, 0)
END SUB
#endif

' Back to the machine's own world, for text output (main.bas under -D BENCH
' or -D SHOT, which then PRINTs and ENDs): music off, screen 5 shown and
' drawn on (the 128K's bank 7 paged out again, the bank that was at C000 back:
' a stack up there, or BASIC itself, needs it), cleared, white on black, the
' cursor at the top.
SUB PlatEnd()
#ifdef ZX128
  MusicStop()
#endif
  IF pzDbl THEN
    SetVisibleScreen(5)
    SetDrawingScreen5()
    SetBankPreservingINTs(pzBank0)   ' the stack may live up there (the runner's does)
  END IF
  PAPER 0: INK 7: BRIGHT 0
  CLS
  PRINT AT 0, 0;
#ifdef SHOT
  ' the headless runner's end marker (as zxtest.bas's TEND: "DONE", then
  ' "&04 END" on its test port): SHOT builds END right after this
  ASM
    ld hl,__PZ_DONE_MSG
    call __PZ_TEXT
  END ASM
#endif
END SUB

#ifdef SHOT
' Asks the test runner for a screenshot called name: the marker "&04 SHOT
' name" on its test port (see tests/zx/lib/zxtest.bas, whose TSHOT this is,
' without the library's code size), then 6 frames' wait with the screen
' unchanged while it takes the picture.
SUB PlatShot(name AS STRING)
  ASM
    ld l,(ix+4)
    ld h,(ix+5)
    ld c,(hl)                   ; BC = length of name, HL its characters
    inc hl
    ld b,(hl)
    inc hl
    push hl
    push bc
    ld hl,__PZ_SHOT_MSG
    call __PZ_TEXT
    pop bc
    pop hl
__PZ_SHOT_NAME:
    ld a,b
    or c
    jr z,__PZ_SHOT_END
    ld a,(hl)
    out (255),a
    inc hl
    dec bc
    jr __PZ_SHOT_NAME
__PZ_SHOT_END:
    ld a,10
    out (255),a
    ei
    ld b,6
__PZ_SHOT_WAIT:
    halt
    djnz __PZ_SHOT_WAIT
  END ASM
END SUB

' (test port text, used by PlatShot and PlatEnd)
ASM
    jp __PZ_TEXT_END
__PZ_SHOT_MSG:
    db 4, "SHOT ", 0
__PZ_DONE_MSG:
    db "DONE", 10, 4, "END", 10, 0
; HL = zero-terminated text to the test port
__PZ_TEXT:
    ld a,(hl)
    or a
    ret z
    out (255),a
    inc hl
    jr __PZ_TEXT
__PZ_TEXT_END:
END ASM
#endif

#endif

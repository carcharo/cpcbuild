REM MODELS: 128
REM Conformance (ZX Spectrum 128K, --arch zx48k): interrupt-driven music
REM (MusicAuto = 1, the default): lib/music/music.bas with its IM2 handler.
REM
REM The song is soft123 (note starts on frames 1, 49, 91, 127, 157; volume
REM 15 falling by 1 a frame to 0 on the 16th frame of a note). The handler
REM ticks the player, then jumps to the ROM's interrupt routine, which
REM increments FRAMES. So with interrupts off, FRAMES - FRAMES at MusicInit
REM = the song position n, and the AY must hold the state of position n:
REM that proves one tick per frame. The rest checks what must keep working:
REM FRAMES, PAUSE, INKEY$, registers (IX, IY, the alternates), and the
REM CPU's I and interrupt mode after MusicStop.
REM Compile with: --arch zx48k -I lib   (the 128K for the AY).
REM Run: python3 tools/zxrun.py tests/zx/music_im2.bas --model 128

#include <music/music.bas>
#include <zxtest.bas>
#include <zxmusic.bas>
#include "../conformance/assets/music/soft123.bas"
#include "../conformance/assets/music/sfx.bas"

DIM f0 AS UINTEGER
DIM sn, sper, svol AS UINTEGER

FUNCTION ExpPer(n AS UINTEGER) AS UINTEGER
  DIM s, p AS UINTEGER
  s = 1: p = 239
  IF n >= 49 THEN s = 49: p = 213
  IF n >= 91 THEN s = 91: p = 190
  IF n >= 127 THEN s = 127: p = 179
  IF n >= 157 THEN s = 157: p = 159
  IF n - s >= 15 THEN RETURN 0
  RETURN p
END FUNCTION

FUNCTION ExpVol(n AS UINTEGER) AS UINTEGER
  DIM s AS UINTEGER
  s = 1
  IF n >= 49 THEN s = 49
  IF n >= 91 THEN s = 91
  IF n >= 127 THEN s = 127
  IF n >= 157 THEN s = 157
  IF n - s >= 15 THEN RETURN 0
  RETURN 16 - (n - s + 1)
END FUNCTION

REM Tone A period as the AY holds it, relative to the CPC's value: 1 if
REM within 0.5% of cpcper * 1.7734 (cpcper = 0: the register is 0).
FUNCTION PerOk(p AS UINTEGER, cpcper AS UINTEGER) AS UBYTE
  IF cpcper = 0 THEN RETURN (p = 0)
  RETURN (CAST(ULONG, p) * 10000 >= CAST(ULONG, cpcper) * 17644) AND (CAST(ULONG, p) * 10000 <= CAST(ULONG, cpcper) * 17824)
END FUNCTION

REM A consistent snapshot: sn = position, sper/svol = AY channel A. AyRead
REM turns interrupts back on, so retry if a frame passed in between.
SUB Sample()
  DIM fa, fb AS UINTEGER
  DO
    fa = Frames()
    sper = CAST(UINTEGER, AyRead(1) BAND 15) * 256 + AyRead(0)
    svol = AyRead(8)
    fb = Frames()
  LOOP UNTIL fa = fb
  sn = fa - f0
END SUB

SUB NextFrame()
  DIM f AS UINTEGER
  f = Frames()
  DO
  LOOP UNTIL Frames() <> f
END SUB

SUB Start(song AS UINTEGER)
  DIM ok AS UBYTE
  DO
    NextFrame()
    f0 = Frames()
    MusicInit(song, 0)
    ok = (Frames() = f0)
  LOOP UNTIL ok
END SUB

SUB Track(name AS STRING)
  Sample()
  CHK(name, STR$(PerOk(sper, ExpPer(sn))) + " " + STR$(svol), "1 " + STR$(ExpVol(sn)))
END SUB

REM Registers survive the interrupts: alternates, IX, IY, flags in AF'.
REM Returns 1 if all were intact after 4 frames (HALTs) with the music on.
FUNCTION FASTCALL RegsIntact() AS UBYTE
  ASM
  push ix
  push iy
  exx
  ld bc, 0x1111
  ld de, 0x2222
  ld hl, 0x3333
  exx
  ex af, af'
  ld a, 0x5A
  ex af, af'
  ld ix, 0xABCD
  ei
  halt
  halt
  halt
  halt
  ld hl, 0
  ld a, 1
  exx
  ld a, h
  cp 0x33
  jr nz, RI_BAD
  ld a, l
  cp 0x33
  jr nz, RI_BAD
  ld a, b
  cp 0x11
  jr nz, RI_BAD
  ld a, d
  cp 0x22
  jr nz, RI_BAD
  exx
  ex af, af'
  cp 0x5A
  ex af, af'
  jr nz, RI_BAD
  push ix
  pop hl
  ld de, 0xABCD
  or a
  sbc hl, de
  jr nz, RI_BAD
  push iy
  pop hl
  ld de, 23610
  or a
  sbc hl, de
  jr nz, RI_BAD
  ld a, 1
  jr RI_END
RI_BAD:
  exx
  xor a
RI_END:
  pop iy
  pop ix
  END ASM
END FUNCTION

DIM c AS UBYTE
DIM i, j, n AS UINTEGER
DIM seen(180) AS UBYTE
DIM t AS UINTEGER

DIM i0 AS UBYTE
i0 = IReg()
CHK("default_auto", STR$(MusicAuto), "1")
CHK("I_before", STR$(IReg()), STR$(i0))

REM ---------------- one tick per frame ----------------
FOR i = 0 TO 180
  seen(i) = 0
NEXT i
c = 1
Start(@soft123)
DO
  Sample()
  IF sn >= 1 AND sn <= 170 THEN
    seen(sn) = seen(sn) + 1
    IF PerOk(sper, ExpPer(sn)) = 0 OR svol <> ExpVol(sn) THEN
      c = 0
      TLN("FAIL_DETAIL pos=" + STR$(sn) + " per=" + STR$(sper) + " vol=" + STR$(svol))
    END IF
  END IF
LOOP UNTIL sn >= 171
CHK("every_frame_state_right", STR$(c), "1")
c = 1
FOR i = 1 TO 170
  IF seen(i) = 0 THEN c = 0: TLN("FAIL_DETAIL missed " + STR$(i))
NEXT i
CHK("no_frame_missed", STR$(c), "1")
CHK("I_moved_to_im2_page", STR$(IReg() <> i0), "1")
MusicStop()
CHK("I_restored_after_stop", STR$(IReg()), STR$(i0))

REM ---------------- ROM services stay working ----------------
REM FRAMES counts: PAUSE 10 takes 10 frames (+-1).
Start(@soft123)
NextFrame()
t = Frames()
PAUSE 10
t = Frames() - t
CHK("pause_10_frames", STR$(t >= 10 AND t <= 11), "1")
Track("after_pause")
REM busy BASIC loop, PRINT
FOR i = 1 TO 3000
  j = (j + i) BAND 255
NEXT i
Track("busy_basic")
FOR i = 1 TO 3
  PRINT "................................"
NEXT i
Track("print")
REM registers (IX, IY, alternates) intact across the interrupts
CHK("regs_intact_with_music", STR$(RegsIntact()), "1")
Track("after_regs_test")
REM INKEY$ with the music on: tests/zx/music_keys.bas (needs typed keys).
MusicStop()

REM ---------------- FRAMES keeps counting after MusicStop ----------------
t = Frames()
PAUSE 5
t = Frames() - t
CHK("pause_after_stop", STR$(t >= 5 AND t <= 6), "1")
CHK("stop_silent", STR$(AyRead(8) + AyRead(9) + AyRead(10)), "0")
CHK("stop_mixer", STR$(AyRead(7)), "63")
MusicStop()
CHK("stop_twice_ok", STR$(IReg()), STR$(i0))

REM ---------------- restart, MusicFrame is a no-op while IM2 drives ----------------
Start(@soft123)
NextFrame()
FOR i = 1 TO 6
  MusicFrame()
NEXT i
Track("musicframe_noop_when_im2")
MusicStop()
Start(@soft123)
NextFrame()
Track("restart_after_stop")
MusicInit(@soft123, 0)
Track("reinit_while_playing_ok")
MusicStop()

REM ---------------- manual mode leaves IM1 ----------------
MusicAuto = 0
MusicInit(@soft123, 0)
CHK("manual_no_im2", STR$(IReg()), STR$(i0))
WaitFrame()
WaitFrame()
CHK("manual_no_tick_by_itself", STR$(AyRead(8)), "0")
WaitFrame()
MusicFrame()
CHK("manual_first_tick_vol", STR$(AyRead(8)), "15")
MusicStop()
MusicAuto = 1

REM ---------------- effects over the interrupt-driven song ----------------
SfxInit(@sfx)
Start(@soft123)
WaitFrame()
SfxPlay(2, 2, 0)
WaitFrame()
WaitFrame()
CHK("sfx_on_C_sounds", STR$(AyRead(10) > 0), "1")
CHK("sfx_A_still_music", STR$(AyRead(8) > 0), "1")
SfxStop(2)
WaitFrame()
WaitFrame()
CHK("sfx_stopped_C_silent", STR$(AyRead(10)), "0")
MusicStop()
CHK("final_I", STR$(IReg()), STR$(i0))

TEND()

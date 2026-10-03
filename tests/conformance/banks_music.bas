REM MODELS: 6128
REM Conformance: music played from a 6128 extra bank (MusicInitBank,
REM lib/music/music_cpc.bas), copied into the bank with BankCopyIn.
REM
REM The sound chip's state, tick by tick, is compared with the same song
REM played from main RAM (lib/banktrack.bas): in normal and game mode, with
REM the main program selecting a different bank after every tick (the song's
REM own bank included), in manual mode (MusicFrame), through copies that run
REM in between, and after going back to a main-RAM song.

#include <cpc.bas>
#include <framehook.bas>
#include <cpcbuild/banks.bas>
#include <music/music.bas>

REM A number-only CHK: STR$ would pull in the floating-point code, and this
REM program (the player, two songs, the helpers) has to fit below &4000.
SUB CHKN(name AS STRING, gotv AS LONG, wantv AS LONG)
  IF gotv = wantv THEN
    PRINT "PASS "; name
  ELSE
    PRINT "FAIL "; name; " got="; gotv; " want="; wantv
  END IF
END SUB
#include "assets/music/bank_tune_main.bas"
#include "assets/music/bank_tune.bas"
#include "lib/banktrack.bas"

DIM i, j, n AS UINTEGER
DIM src(299) AS UBYTE
DIM m1 AS UBYTE
m1 = PEEK(32767)
FOR i = 0 TO 299
  src(i) = CAST(UBYTE, (i * 13 + 5) BAND 255)
NEXT i

CHKN("music_image_size", bank_tune_length > 100 AND bank_tune_length < 600, 1)
MusicAuto = 1
REM the reference: the same tune from main RAM (auto mode), 120 ticks
StartMain()
TrackReset()
Track(120, 1, 0)
MusicStop()
REM it must really play something
n = 0
FOR i = 2 TO 120
  IF refs(i) <> refs(i - 1) THEN n = n + 1
NEXT i
CHKN("reference_is_music", n > 10, 1)
REM nothing but the player has run: a second main-RAM run matches (determinism)
StartMain()
TrackReset()
Track(120, 0, 0)
TrackReport("main_run_repeats")
MusicStop()

BankCopyIn(2, 16384, @bank_tune, bank_tune_length)
StartBank(16384, 2)
TrackReset()
Track(120, 0, 0)
TrackReport("bank_auto_normal")
CHKN("bank_hook_installed", BankSelected(), 255)
MusicStop()
CHKN("bank_stop_silent", AyRead(8) + AyRead(9) + AyRead(10), 0)

REM the main program walks through the banks, the song's included
StartBank(16384, 2)
TrackReset()
Track(120, 0, 1)
TrackReport("bank_auto_main_selects")
CHKN("bank_shadow_kept", BankSelected(), 120 BAND 3)
MusicStop()
BankOff()

REM game mode
GameMode(1)
StartBank(16384, 2)
TrackReset()
Track(120, 0, 1)
TrackReport("bank_game_mode")
MusicStop()
BankOff()
StartBank(16384, 2)
FOR i = 1 TO 3000
  j = (j + i) BAND 255
NEXT i
NextFrame()
NextFrame()
PRINT "print in game mode with a banked song"
CHKN("bank_game_busy_firmware", BankSelected(), 255)
MusicStop()
GameMode(0)

REM manual mode: MusicFrame pages the bank itself
MusicAuto = 0
MusicInitBank(16384, 0, 2)
CHKN("bank_manual_not_hooked", PEEK(32767) = m1, 1)
TrackReset()
TrackManual(120, 0, 1)
TrackReport("bank_manual")
MusicStop()
BankOff()
MusicAuto = 1

REM the same song at another address in another bank, and two banks' songs
REM at once are not possible (one player): switching banks restarts cleanly
BankCopyIn(3, 16384, @bank_tune, bank_tune_length)
StartBank(16384, 3)
TrackReset()
Track(60, 0, 1)
TrackReport("bank_3")
MusicStop()
BankOff()

REM back to a main-RAM song after a banked one
StartMain()
TrackReset()
Track(120, 0, 1)
TrackReport("main_after_bank")
MusicStop()
BankOff()

REM MusicInitBank refusals leave things alone
StartMain()
MusicInitBank(16384, 0, 4)
NextFrame()
TrackReset()
tLast = CAST(UINTEGER, Frames() - f0) - 1
Track(CAST(UINTEGER, Frames() - f0) + 20, 0, 0)
TrackReport("bad_bank_ignored")
MusicStop()

REM no frame is ever lost while copies run in the background of the hook
StartBank(16384, 2)
FOR n = 1 TO 20
  BankCopyIn(1, 16640, @src(0), 300)
  BankCopyOut(1, 16640, @src(0), 300)
NEXT n
n = CAST(UINTEGER, Frames() - f0)
TrackReset()
tLast = n
Track(n + 20, 0, 0)
TrackReport("bank_music_through_copies")
MusicStop()

PRINT "DONE"

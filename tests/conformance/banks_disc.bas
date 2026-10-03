REM BARE: skip BankLoad reads the disc through the firmware
REM MODELS: 6128
REM EMUS: cap32
REM DISKFILE: BANKDAT.BIN=assets/bankdat.bin
REM DISKFILE: TUNE.BIN=assets/music/bank_tune.bin
REM Conformance: BankLoad, a disc file straight into an extra bank (6128,
REM Caprice32 only: chips has no disc). The disc holds the program, BANKDAT.BIN
REM (3000 bytes, byte i = (i*7 + i/256) AND 255) and TUNE.BIN (the song
REM of banks_music.bas assembled for &4000, with an AMSDOS header added by
REM the disc tool). Checks the bytes, the neighbouring bytes, the refusals,
REM that the selected bank is kept, loading in game mode, and music played
REM from a bank that BankLoad filled, while a second BankLoad runs.

#include <cpc.bas>
#include <framehook.bas>
#include <cpcbuild/banks.bas>
#include <music/music.bas>
#include "assets/music/bank_tune_main.bas"
#include "lib/banktrack.bas"

SUB CHKN(name AS STRING, gotv AS LONG, wantv AS LONG)
  IF gotv = wantv THEN
    PRINT "PASS "; name
  ELSE
    PRINT "FAIL "; name; " got="; gotv; " want="; wantv
  END IF
END SUB

DIM i, bad AS UINTEGER
DIM c AS UINTEGER
DIM buf(299) AS UBYTE
DIM ok AS UBYTE
DIM r AS UBYTE
DIM f1, f2 AS ULONG

REM Compares 3000 bytes of a bank (from addr) with the pattern; returns the
REM number of wrong bytes, 300 at a time (the buffer is small: this program
REM and the player share the 12 KB below &4000).
FUNCTION PatternErrors(bank AS UBYTE, addr AS UINTEGER) AS UINTEGER
  DIM p, k, wrong AS UINTEGER
  wrong = 0
  FOR p = 0 TO 2999 STEP 300
    r = BankCopyOut(bank, addr + p, @buf(0), 300)
    IF r = 0 THEN RETURN 9999
    FOR k = 0 TO 299
      IF buf(k) <> CAST(UBYTE, ((p + k) * 7 + ((p + k) >> 8)) BAND 255) THEN wrong = wrong + 1
    NEXT k
  NEXT p
  RETURN wrong
END FUNCTION

REM the sentinels around the load area
BankPoke(3, 16639, 0xEE)
BankPoke(3, 19640, 0xEE)

r = BankLoad("BANKDAT.BIN", 3, 16640)
CHKN("load_ok", r, 1)
CHKN("load_bytes_exact", PatternErrors(3, 16640), 0)
CHKN("load_neighbours", BankPeek(3, 16639) + 256 * BankPeek(3, 19640), 0xEE + 256 * 0xEE)
CHKN("load_selection_main", BankSelected(), 255)

REM into another bank at another address, lower-case name, with a bank selected
BankSelect(1)
POKE 16384, 0x42
r = BankLoad("bankdat.bin", 0, 20480)
CHKN("load_lowercase_ok", r, 1)
CHKN("load_selection_kept", BankSelected(), 1)
CHKN("load_selected_bank_intact", PEEK(16384), 0x42)
BankOff()
CHKN("load_other_bank_bytes", PatternErrors(0, 20480), 0)
CHKN("load_first_bank_unchanged", PatternErrors(3, 16640), 0)

REM a file that doesn't fit: refused before any byte is read
BankPoke(2, 29952, 0xEE)
r = BankLoad("BANKDAT.BIN", 2, 29952)
CHKN("load_too_long_refused", r, 0)
CHKN("load_too_long_untouched", BankPeek(2, 29952), 0xEE)
REM a file that just fits (&7FFF is the last byte: 3000 bytes from 0x7448)
r = BankLoad("BANKDAT.BIN", 2, 32768 - 3000)
CHKN("load_exact_fit", r, 1)
CHKN("load_exact_fit_bytes", PatternErrors(2, 32768 - 3000), 0)

REM refusals
CHKN("refuse_missing_file", BankLoad("NOSUCH.BIN", 1, 16384), 0)
CHKN("works_after_missing_file", BankLoad("TUNE.BIN", 1, 16384), 1)
CHKN("refuse_bad_bank", BankLoad("TUNE.BIN", 4, 16384), 0)
CHKN("refuse_addr_below", BankLoad("TUNE.BIN", 1, 12000), 0)
CHKN("refuse_addr_above", BankLoad("TUNE.BIN", 1, 33000), 0)
CHKN("refuse_empty_name", BankLoad("", 1, 16384), 0)
CHKN("refuse_long_name", BankLoad("ABCDEFGHIJKLMNOPQRSTUVWXYZ.BIN", 1, 16384), 0)
CHKN("works_after_refusals", BankLoad("TUNE.BIN", 1, 16384), 1)

REM game mode: the firmware's interrupt work is off outside firmware calls
GameMode(1)
r = BankLoad("BANKDAT.BIN", 3, 16640)
GameMode(0)
CHKN("load_in_game_mode", r, 1)
CHKN("load_in_game_mode_bytes", PatternErrors(3, 16640), 0)

REM the reference: the tune from main RAM, 120 ticks
StartMain()
TrackReset()
Track(120, 1, 0)
MusicStop()

REM the tune from the bank BankLoad filled
StartBank(16384, 1)
TrackReset()
Track(120, 0, 0)
TrackReport("music_from_loaded_bank")
MusicStop()

REM ...with a load running meanwhile (the hook runs from the firmware's
REM frame event during the disc read, with the song's bank in the way)
BankSelect(2)
StartBank(16384, 1)
Track(20, 0, 0)
f1 = Frames()
r = BankLoad("BANKDAT.BIN", 3, 16640)
f2 = Frames()
ok = BankSelected()
TrackReset()
tLast = CAST(UINTEGER, Frames() - f0)
c = tLast + 30
Track(c, 0, 0)
PRINT "INFO load took frames: "; f2 - f1
CHKN("load_during_music", r, 1)
CHKN("load_during_music_selection", ok, 2)
CHKN("load_during_music_within_reference", c <= 120, 1)
TrackReport("music_after_load")
MusicStop()
BankOff()
CHKN("load_during_music_bytes", PatternErrors(3, 16640), 0)

REM the same in game mode
GameMode(1)
BankSelect(2)
StartBank(16384, 1)
Track(10, 0, 0)
r = BankLoad("BANKDAT.BIN", 0, 16640)
TrackReset()
tLast = CAST(UINTEGER, Frames() - f0)
c = tLast + 30
Track(c, 0, 0)
CHKN("load_during_music_game", r, 1)
CHKN("load_during_music_game_within_reference", c <= 120, 1)
TrackReport("music_after_load_game")
MusicStop()
GameMode(0)
BankOff()
CHKN("load_game_bytes", PatternErrors(0, 16640), 0)

PRINT "DONE"

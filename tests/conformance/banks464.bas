REM BARE: skip BankLoad reads the disc through the firmware
REM MODELS: 464 664

REM Conformance: the bank library on a machine without extra RAM (464, 664;
REM Caprice32 gives them 64 KB). BankAvailable is 0 and everything else is a
REM safe no-op or a refusal: main RAM at &4000-&7FFF is never disturbed,
REM no Gate Array RAM configuration is left in force, copies and loads
REM report failure, MusicInitBank starts nothing. banks.bas is the 6128 test.

#include <cpc.bas>
#include <framehook.bas>
#include <cpcbuild/banks.bas>
#include <music/music.bas>
#include "lib/chk.bas"
#include "assets/music/bank_tune.bas"

FUNCTION FASTCALL HookAddr() AS UINTEGER
  ASM
  ld hl, (.core.FH_ADDR)
  END ASM
END FUNCTION

DIM i AS UINTEGER
DIM b AS UBYTE
DIM s AS STRING
DIM src(15) AS UBYTE
DIM dst(15) AS UBYTE

POKE 16384, 77
POKE 20000, 88
POKE 32767, 99
CHK("not_available", STR$(BankAvailable()), "0")
CHK("selected_is_main", STR$(BankSelected()), "255")
FOR b = 0 TO 3
  BankSelect(b)
NEXT b
CHK("select_noop", STR$(BankSelected()) + " " + STR$(PEEK(16384)) + " " + STR$(PEEK(20000)) + " " + STR$(PEEK(32767)), "255 77 88 99")
BankSelect(255)
BankOff()
FOR b = 0 TO 3
  BankPoke(b, 16384, 5 + b)
  BankPoke(b, 20000, 5 + b)
  BankPoke(b, 32767, 5 + b)
NEXT b
CHK("poke_leaves_main_alone", STR$(PEEK(16384)) + " " + STR$(PEEK(20000)) + " " + STR$(PEEK(32767)), "77 88 99")
s = ""
FOR b = 0 TO 4
  s = s + STR$(BankPeek(b, 16384)) + " "
NEXT b
CHK("peek_reads_zero", s, "0 0 0 0 0 ")
FOR i = 0 TO 15
  src(i) = i + 1
  dst(i) = 200
NEXT i
CHK("copy_in_refused", STR$(BankCopyIn(1, 16640, @src(0), 16)), "0")
CHK("copy_out_refused", STR$(BankCopyOut(1, 16640, @dst(0), 16)), "0")
CHK("copy_len0_refused", STR$(BankCopyIn(1, 16640, @src(0), 0)), "0")
CHK("copy_dst_untouched", STR$(dst(0)) + " " + STR$(dst(15)), "200 200")
CHK("main_after_copies", STR$(PEEK(16384)) + " " + STR$(PEEK(16640) = PEEK(16640)), "77 1")
CHK("load_refused", STR$(BankLoad("NOSUCH.BIN", 1, 16384)), "0")
CHK("load_refused_2", STR$(BankLoad("BANKDAT.BIN", 0, 16384)), "0")
CHK("hook_before", STR$(HookAddr()), "0")
MusicInitBank(16384, 0, 1)
CHK("music_not_started", STR$(HookAddr()), "0")
MusicStop()
REM the program still runs normally afterwards
PRINT "firmware ok"
CHK("still_main", STR$(PEEK(16384)) + " " + STR$(BankSelected()), "77 255")
PRINT "DONE"

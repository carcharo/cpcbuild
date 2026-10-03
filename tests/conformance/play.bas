REM Conformance: the AY primitive (AyWrite / AyRead) and the Play (MML)
REM library on the CPC (Phase 4d, zxbasic runtime/ay.asm, stdlib/play.bas).
REM Play runs with interrupts off, so what is checked is what it leaves
REM behind: the AY registers (the Caprice32 AY returns what was last
REM written, unused bits included, so reads are masked), that it returns,
REM that interrupts are back on and the firmware clock runs, that BEEP
REM works after Play and Play after BEEP, and that the keyboard port stays
REM an input (AY register 7 bit 6). Dividers are for the CPC's 1 MHz AY:
REM round(1000000 / 16 / f). The timing of Play is measured by
REM tests/stress/play_tempo.bas (it needs the clock, so interrupts on).

#include <cpc.bas>
#include <play.bas>
#include "lib/chk.bas"
#include "lib/ticks.bas"

REM P/V after LD A,I is IFF2 (bit 2 of F); an interrupt during that
REM instruction can make an NMOS Z80 report 0, so callers try twice.
FUNCTION FASTCALL IntsOn() AS UBYTE
  ASM
  ld a, i
  push af
  pop hl
  ld a, l
  and 4
  END ASM
END FUNCTION


REM The raw routines with interrupts off by hand: port C is set to the
REM cassette bits ($30 = motor and write data) first; the routine must
REM leave them (the function returns port C & $30 after the write).
FUNCTION FASTCALL CassAfterWrite() AS UBYTE
  ASM
  di
  ld bc, $F630
  out (c), c
  ld a, 8
  ld c, 0
  call .core.__CPC_AY_WRITE
  ld b, $F6
  in a, (c)
  and $30
  push af
  ld bc, $F600
  out (c), c
  pop af
  ei
  END ASM
END FUNCTION

FUNCTION FASTCALL CassAfterRead() AS UBYTE
  ASM
  di
  ld bc, $F630
  out (c), c
  ld a, 8
  call .core.__CPC_AY_READ
  ld b, $F6
  in a, (c)
  and $30
  push af
  ld bc, $F600
  out (c), c
  pop af
  ei
  END ASM
END FUNCTION

REM The AY register's implemented bits (the emulator returns unused bits as written).
FUNCTION Mask(r AS UBYTE) AS UBYTE
  IF r = 1 OR r = 3 OR r = 5 OR r = 13 THEN RETURN 15
  IF r = 6 OR r = 8 OR r = 9 OR r = 10 THEN RETURN 31
  IF r = 7 THEN RETURN 63
  RETURN 255
END FUNCTION

REM Tone divider of the channel (0-2) as the AY holds it.
FUNCTION Tone(ch AS UBYTE) AS UINTEGER
  RETURN CAST(UINTEGER, AyRead(ch * 2 + 1) BAND 15) * 256 + AyRead(ch * 2)
END FUNCTION

FUNCTION VolSum() AS UBYTE
  RETURN (AyRead(8) BAND 31) + (AyRead(9) BAND 31) + (AyRead(10) BAND 31)
END FUNCTION

DIM r, v, pat, ok AS UBYTE
DIM t0, t1 AS ULONG
DIM i AS UINTEGER

REM ---------------- AyWrite / AyRead ----------------
CHK("ints_on_start", STR$(IntsOn() BOR IntsOn()), "4")
FOR pat = 0 TO 2
  ok = 1
  FOR r = 0 TO 13
    IF pat = 0 THEN v = $A5
    IF pat = 1 THEN v = $5A
    IF pat = 2 THEN v = r * 3 + 1
    IF r = 7 THEN v = v BAND $3F : REM keep the keyboard port an input
    AyWrite r, v
    IF AyRead(r) <> (v BAND Mask(r)) THEN
      ok = 0
      PRINT "FAIL rt reg="; r; " wrote="; v; " got="; AyRead(r)
    END IF
  NEXT r
  CHK("roundtrip_" + STR$(pat), STR$(ok), "1")
NEXT pat
REM registers are independent: write all, then read all back
FOR r = 0 TO 13
  v = (r * 17 + 3)
  IF r = 7 THEN v = v BAND $3F
  AyWrite r, v
NEXT r
ok = 1
FOR r = 0 TO 13
  v = (r * 17 + 3)
  IF r = 7 THEN v = v BAND $3F
  IF AyRead(r) <> (v BAND Mask(r)) THEN ok = 0
NEXT r
CHK("registers_independent", STR$(ok), "1")
CHK("ints_on_after_ay", STR$(IntsOn() BOR IntsOn()), "4")
CHK("cass_bits_kept_write", STR$(CassAfterWrite()), "48")
CHK("cass_bits_kept_read", STR$(CassAfterRead()), "48")
REM silence again
AyWrite 8, 0 : AyWrite 9, 0 : AyWrite 10, 0 : AyWrite 7, $3F

REM ---------------- Play: the divider table ----------------
REM one channel; the other two are empty strings (finished at once).
Play "O4C"
CHK("c4_tone", STR$(Tone(0)), "239")
CHK("mixer_default", STR$(AyRead(7)), "56")
CHK("silent_after", STR$(VolSum()), "0")
Play "O4A"
CHK("a4_tone", STR$(Tone(0)), "142")
Play "O0C"
CHK("c0_tone_fits_12_bits", STR$(Tone(0)), "3822")
Play "O8B"
CHK("b8_tone", STR$(Tone(0)), "8")
Play "O5G"
CHK("g5_tone", STR$(Tone(0)), "80")
Play "O3E"
CHK("e3_tone", STR$(Tone(0)), "379")
REM default octave is 5; lower case is one octave down; # and $
Play "C"
CHK("default_octave", STR$(Tone(0)), "119")
Play "c"
CHK("lowercase_down", STR$(Tone(0)), "239")
Play "O4#C"
CHK("sharp", STR$(Tone(0)), "225")
Play "O4$D"
CHK("flat", STR$(Tone(0)), "225")

REM every note of octaves 0, 4 and 8 against round(62500 / f) (computed
REM offline from f = 440 * 2^((n - 57) / 12)); T240 and length 1: 62 ms each.
DIM nm$(0 TO 11) AS STRING
DIM oc, k AS UBYTE
DIM want AS UINTEGER
nm$(0) = "C" : nm$(1) = "#C" : nm$(2) = "D" : nm$(3) = "#D" : nm$(4) = "E" : nm$(5) = "F"
nm$(6) = "#F" : nm$(7) = "G" : nm$(8) = "#G" : nm$(9) = "A" : nm$(10) = "#A" : nm$(11) = "B"
ok = 1
FOR oc = 0 TO 8 STEP 4
  FOR k = 0 TO 11
    READ want
    Play "T240 1 O" + STR$(oc) + nm$(k)
    IF Tone(0) <> want THEN
      ok = 0
      PRINT "FAIL table oct="; oc; " k="; k; " got="; Tone(0); " want="; want
    END IF
  NEXT k
NEXT oc
CHK("table_36_notes", STR$(ok), "1")

REM ---------------- lengths, rests, ties, tempo, volume ----------------
REM only that they parse and return, with the last note in the chip
Play "T200 O4 V9 1C2D3E4F5G6A7B8c9d10e11f12g"
CHK("lengths_last_note", STR$(Tone(0)), "319")
Play "O4 C & D & 6 E _ 5"
CHK("rest_tie_last_note", STR$(Tone(0)), "190")
Play "T240 V3 O2 12C12D12E"
CHK("triplets_last", STR$(Tone(0)), "758")
CHK("silent_after_all", STR$(VolSum()), "0")

REM ---------------- repeats and H ----------------
Play "O4 C (D E)G"
CHK("repeat_returns_last", STR$(Tone(0)), "159")
Play "O4 C ( O4 D (E) ) F"
CHK("nested_repeat_last", STR$(Tone(0)), "179")
Play "O4 C H O4 G"
CHK("halt_before_G", STR$(Tone(0)), "239")
CHK("halt_silent", STR$(VolSum()), "0")

REM ---------------- 2 and 3 channels ----------------
Play "O4C", "O4E", "O4G"
CHK("ch3_a", STR$(Tone(0)), "239")
CHK("ch3_b", STR$(Tone(1)), "190")
CHK("ch3_c", STR$(Tone(2)), "159")
Play "O4 C D E", "O4 E"
CHK("ch2_a_last", STR$(Tone(0)), "190")
CHK("ch2_b", STR$(Tone(1)), "190")
REM channels of unequal length: the shorter one rests, the longer finishes
Play "O4 3C 3D", "O3 5A", "O2 1G"
CHK("uneq_a", STR$(Tone(0)), "213")
CHK("uneq_b", STR$(Tone(1)), "284")
CHK("uneq_c", STR$(Tone(2)), "638")
CHK("uneq_silent", STR$(VolSum()), "0")

REM ---------------- mixer, envelope, noise ----------------
Play "M56 O4 C"
CHK("mixer_M56", STR$(AyRead(7)), "7")
Play "M0 O4 C"
CHK("mixer_M0", STR$(AyRead(7)), "63")
CHK("mixer_bit6_clear", STR$(AyRead(7) BAND 64), "0")
Play "M7 O4 C"
CHK("mixer_M7", STR$(AyRead(7)), "56")
Play "X1000 W1 U O4 C"
CHK("env_period_lo", STR$(AyRead(11)), "232")
CHK("env_period_hi", STR$(AyRead(12)), "3")
CHK("env_shape_W1", STR$(AyRead(13) BAND 15), "4")
Play "W6 U O4 C"
CHK("env_shape_W6", STR$(AyRead(13) BAND 15), "14")
REM noise period from channel A's note (index 48: (not 48 and 127) >> 2 = 19)
Play "O4 C"
CHK("noise_period", STR$(AyRead(6) BAND 31), "19")

REM ---------------- interrupts, clock, keyboard port ----------------
Play "T240 O5 C D E F G"
CHK("ints_on_after_play", STR$(IntsOn() BOR IntsOn()), "4")
t0 = Ticks()
FOR i = 1 TO 30000
  REM a compute loop with no firmware calls: the clock must move
NEXT i
t1 = Ticks()
CHK("clock_runs_after_play", STR$(t1 - t0 > 5), "1")
CHK("kbd_port_input", STR$(AyRead(7) BAND 64), "0")

REM ---------------- BEEP after Play, Play after BEEP ----------------
REM BEEP 0.2 s waits about 60 ticks (1/300 s)
t0 = Ticks()
BEEP 0.2, 0
t1 = Ticks()
CHK("beep_after_play", STR$(t1 - t0 >= 50 AND t1 - t0 <= 90), "1")
PRINT "INFO beep 0.2 s took "; t1 - t0; " ticks"
Play "O4 A"
CHK("play_after_beep", STR$(Tone(0)), "142")
CHK("mixer_after_play_after_beep", STR$(AyRead(7)), "56")
BEEP 0.1, 0
Play "O4", "O4C"
CHK("play_after_beep_b", STR$(Tone(1)), "239")
CHK("ints_on_end", STR$(IntsOn() BOR IntsOn()), "4")

PRINT "DONE"

DATA 3822, 3608, 3405, 3214, 3034, 2863, 2703, 2551, 2408, 2273, 2145, 2025
DATA 239, 225, 213, 201, 190, 179, 169, 159, 150, 142, 134, 127
DATA 15, 14, 13, 13, 12, 11, 11, 10, 9, 9, 8, 8

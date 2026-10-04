REM MODELS: plus
REM Conformance: cpcplus DMA sound channels on a CPC Plus (Phase 7 P3, Caprice32; both modes):
REM a list that writes AY registers, checked by a frame hook with the runtime's own
REM AY read (the DMA writes the chip by itself), start/stop/active bits of the three channels,
REM refused starts, lists in &4000-&7FFF, the prescaler (PAUSE n takes n x (prescaler + 1)
REM lines), and that the frame hook and the library calls coexist with a running channel.
REM The lists are word data in asm blocks (ALIGN 2: the ASIC ignores bit 0 of the address).
REM The checks of the status after a list's own STOP are left out: Caprice32 leaves the
REM channel's DCSR enable bit set, CPCEC clears it (notes.md, Phase 7 P3).

#include <cpc.bas>
#include <framehook.bas>
#include <cpcplus/cpcplus.bas>
#include "lib/chk.bas"
#include "lib/plushelp.bas"
#include "lib/ticks.bas"

REM List A (channel 0): pause, set AY registers 8 (volume A), 9, 10, pause, volume A again, stop.
REM With a prescaler of 9 the first pause is 40 x 10 lines = 400 lines (1.3 frames).
FUNCTION FASTCALL ListA() AS UINTEGER
  ASM
  ld hl, DT_LISTA
  jp DT_SKIPA
  ALIGN 2
DT_LISTA:
  defw $1000 + 40         ; PAUSE 40
  defw $0800 + $0B        ; LOAD 8, $0B
  defw $0900 + $0C        ; LOAD 9, $0C
  defw $0A00 + $0D        ; LOAD 10, $0D
  defw $1000 + 2          ; PAUSE 2
  defw $0800 + $01        ; LOAD 8, $01
  defw $4020              ; STOP
DT_SKIPA:
  END ASM
END FUNCTION

REM List B (channel 1): sets AY register 11 (envelope period low) to $5A, then waits forever
REM in a loop (REPEAT/PAUSE/LOOP, hours long: the channel stays active until DmaStop, on
REM the real ASIC and CPCEC too, which clear the bit when a list reaches STOP).
FUNCTION FASTCALL ListB() AS UINTEGER
  ASM
  ld hl, DT_LISTB
  jp DT_SKIPB
  ALIGN 2
DT_LISTB:
  defw $0B00 + $5A        ; LOAD 11, $5A
  defw $2000 + 4000       ; REPEAT 4000 (loop start = next word)
  defw $1000 + 4000       ; PAUSE 4000: 4000 x 4000 lines (hours), then STOP
  defw $4001              ; LOOP
  defw $4020              ; STOP
DT_SKIPB:
  END ASM
END FUNCTION

REM An odd address (the list shifted by one byte), for the refusal check.
FUNCTION FASTCALL ListOdd() AS UINTEGER
  ASM
  ld hl, DT_LISTA + 1
  END ASM
END FUNCTION

REM The frame hook reads AY registers 8-12 with the runtime's own routine (interrupts are
REM off in a hook) and keeps the last values in DT_AY.
FUNCTION FASTCALL HookAddr() AS UINTEGER
  ASM
  ld hl, DT_HOOK
  jp DT_SKIPH
DT_HOOK:
  ld a, 8
  call .core.__CPC_AY_READ
  ld (DT_AY), a
  ld a, 9
  call .core.__CPC_AY_READ
  ld (DT_AY + 1), a
  ld a, 10
  call .core.__CPC_AY_READ
  ld (DT_AY + 2), a
  ld a, 11
  call .core.__CPC_AY_READ
  ld (DT_AY + 3), a
  ld a, 12
  call .core.__CPC_AY_READ
  ld (DT_AY + 4), a
  ld hl, DT_HOOKN
  inc (hl)
  ret
DT_AY:
  defs 5, 0
DT_HOOKN:
  defb 0
DT_SKIPH:
  END ASM
END FUNCTION

FUNCTION FASTCALL AyBase() AS UINTEGER
  ASM
  ld hl, DT_AY
  END ASM
END FUNCTION

FUNCTION FASTCALL HookN() AS UBYTE
  ASM
  ld a, (DT_HOOKN)
  END ASM
END FUNCTION

REM Waits for n frames by the frame counter (Frames() is 50 Hz in both modes).
SUB WaitF(n AS UINTEGER)
  DIM t AS ULONG
  t = Frames() + n
  DO
  LOOP UNTIL Frames() >= t
END SUB

DIM k AS UBYTE
DIM i AS UINTEGER
DIM a AS UINTEGER

CHK("avail", STR$(PlusAvailable()), "1")
a = ListA()
CHK("list_a_even", STR$(a BAND 1), "0")
CHK("start_bad_channel", STR$(DmaStart(3, a)), "0")
CHK("start_odd_address", STR$(DmaStart(0, ListOdd())), "0")
CHK("nothing_active_yet", STR$(DmaActive()), "0")
CHK("dcsr_reads_zero", STR$(PlusPeek($6C0F) BAND 7), "0")

REM ---- list A on channel 0 with a prescaler of 9: PAUSE 40 = 400 lines
FrameHook(HookAddr())
DmaPrescaler(0, 9)
CHK("start_a", STR$(DmaStart(0, a)), "1")
CHK("address_register", STR$(PlusPeek($6C00) + 256 * PlusPeek($6C01) >= a), "1")
CHK("prescaler_register", STR$(PlusPeek($6C02)), "9")
WaitF(8)
CHK("ay_reg9_set", STR$(PEEK(AyBase() + 1)), "12")
CHK("ay_reg10_set", STR$(PEEK(AyBase() + 2)), "13")
CHK("ay_reg8_second_write", STR$(PEEK(AyBase())), "1")
CHK("hook_kept_running", STR$(HookN() >= 6), "1")
DmaStop(0)
CHK("stop_0", STR$(DmaActive()), "0")
CHK("iff_on", STR$(Iff()), "1")
REM the active bit, on a list that cannot reach its STOP (Caprice32 never clears the bit, CPCEC
REM and the real ASIC do when a list ends, so list A's own bit is not checked)
CHK("start_loop_0", STR$(DmaStart(0, ListB())), "1")
CHK("active_0", STR$(DmaActive()), "1")
DmaStop(0)
CHK("stop_loop_0", STR$(DmaActive()), "0")

REM ---- two channels: B loops forever, A again; independent enable bits
DmaPrescaler(1, 0)
CHK("start_b", STR$(DmaStart(1, ListB())), "1")
CHK("active_1", STR$(DmaActive()), "2")
WaitF(2)
CHK("ay_reg11_set", STR$(PEEK(AyBase() + 3)), "90")
DmaPrescaler(0, 9)
CHK("start_b_on_0", STR$(DmaStart(0, ListB())), "1")
CHK("active_0_and_1", STR$(DmaActive()), "3")
DmaStop(0)
CHK("stop_0_keeps_1", STR$(DmaActive()), "2")
DmaStop(2)
CHK("stop_unstarted_keeps_1", STR$(DmaActive()), "2")
DmaStop(1)
CHK("stop_1", STR$(DmaActive()), "0")
DmaStop(1)
DmaStop(7)
CHK("stop_again_ok", STR$(DmaActive()), "0")

REM ---- a list in &4000-&7FFF (RAM; the ASIC page is out): AY registers 12 and 13
POKE 16640, $0C: POKE 16641, $0C      REM LOAD 12, $0C
POKE 16642, $0D: POKE 16643, $0D      REM LOAD 13, $0D (envelope shape)
POKE 16644, $20: POKE 16645, $40      REM STOP
CHK("start_in_window", STR$(DmaStart(2, 16640)), "1")
WaitF(2)
CHK("window_list_ran", STR$(PEEK(AyBase() + 4)), "12")
DmaStop(2)
CHK("stop_2", STR$(DmaActive()), "0")

REM ---- a list built in an array with the library's macros and DmaAlign (arrays may start
REM at an odd address): AY register 12 := $33, register 8 := $07, stop
DIM lst(5) AS UINTEGER
a = DmaAlign(@lst(0))
CHK("align_even", STR$(a BAND 1), "0")
CHK("align_in_array", STR$(a >= @lst(0) AND a <= @lst(0) + 1), "1")
POKE UINTEGER a, DMA_LOAD(12, $33)
POKE UINTEGER a + 2, DMA_PAUSE(3) + DMA_REPEAT(0)
POKE UINTEGER a + 4, DMA_LOAD(8, 7)
POKE UINTEGER a + 6, DMA_STOP
CHK("macro_words", STR$(PEEK(UINTEGER, a)) + " " + STR$(PEEK(UINTEGER, a + 2)) + " " + STR$(PEEK(UINTEGER, a + 6)), "3123 12291 16416")
CHK("start_macro_list", STR$(DmaStart(1, a)), "1")
WaitF(2)
CHK("macro_list_ran", STR$(PEEK(AyBase() + 4)) + " " + STR$(PEEK(AyBase())), "51 7")
DmaStop(1)
CHK("stop_1_macro", STR$(DmaActive()), "0")

REM ---- registers of an unstarted channel and the library state are back to quiet
CHK("pri_untouched", STR$(PlusPeek($6800)), "0")
CHK("iff_still_on", STR$(Iff()), "1")
FrameHookOff()
SoundStop()
PRINT "DONE"
END

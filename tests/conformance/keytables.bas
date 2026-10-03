REM Conformance: the key translation tables. Every key (0-79) under every
REM modifier (none, SHIFT, CONTROL) through __CPC_KEYCHAR must give what the
REM firmware's own tables give. EXPECTED below is that firmware output, dumped
REM on a 464 and a 6128 (identical) with tools/keytables_dump.bas: normal
REM table keys 0-79, then SHIFT, then CONTROL; 255 = no character, 253 and
REM 254 = the CAPS LOCK key (no character either). Keypad expansion tokens
REM are given as the first character of their default strings. Runs in
REM firmware mode (against the firmware tables) and in bare-metal mode
REM (-D CPC_BAREMETAL, against the runtime's own tables in kbare.asm).
REM Also the caps lock and the shift lock, where the mode allows setting
REM them directly (bare mode here; inkey_locks.bas for the firmware).

#require "io/keyboard/kscan.asm"
#ifdef CPC_BAREMETAL
#require "io/keyboard/kbare.asm"
#include "lib/bareout.bas"
#endif

DIM expected(239) AS UBYTE
DIM ri AS UINTEGER
RESTORE tabledata
FOR ri = 0 TO 239
  READ expected(ri)
NEXT ri

DIM results$ AS STRING
SUB CHK(name AS STRING, gotv AS STRING, wantv AS STRING)
  IF gotv = wantv THEN
    results$ = results$ + "PASS " + name + CHR$ 13
  ELSE
    results$ = results$ + "FAIL " + name + " got=" + gotv + " want=" + wantv + CHR$ 13
  END IF
END SUB

REM v = key + 256 * mods (1 SHIFT, 2 CONTROL); the character or 999 for none.
FUNCTION FASTCALL Xl(v AS UINTEGER) AS UINTEGER
  ASM
  PROC
  LOCAL none, done
  ld b, l
  ld e, h
  call .core.__CPC_KEYCHAR
  jr nc, none
  ld l, a
  ld h, 0
  jr done
none:
  ld hl, 999
done:
  ENDP
  END ASM
END FUNCTION

#ifdef CPC_BAREMETAL
REM Sets the locks (bit 0 shift lock, bit 1 caps lock).
SUB FASTCALL SetLocks(v AS UBYTE)
  ASM
  ld (.core.__CPC_KB_LOCKS), a
  END ASM
END SUB

REM The results string, CR as newline, through lib/bareout.bas (no PRINT:
REM the same test then also runs where bare PRINT is not wanted).
SUB Say(s AS STRING)
  DIM i AS UINTEGER
  IF LEN(s) = 0 THEN RETURN
  FOR i = 0 TO LEN(s) - 1
    IF CODE s(i TO i) = 13 THEN BPutCh(10) ELSE BPutCh(CODE s(i TO i))
  NEXT i
END SUB
#endif

DIM k, m, want AS UINTEGER
DIM bad AS UINTEGER
bad = 0
FOR m = 0 TO 2
  FOR k = 0 TO 79
    want = expected(m * 80 + k)
    IF want >= 253 THEN want = 999
    IF Xl(k + 256 * m) <> want THEN
      bad = bad + 1
      IF bad <= 10 THEN
        results$ = results$ + "FAIL key " + STR$(k) + " mods " + STR$(m) + " got=" + STR$(Xl(k + 256 * m)) + " want=" + STR$(want) + CHR$ 13
      END IF
    END IF
  NEXT k
NEXT m
CHK("tables_mismatches", STR$(bad), "0")
REM SHIFT+CONTROL uses the CONTROL table
CHK("ctrl_beats_shift", STR$(Xl(69 + 256 * 3)), "1")

#ifdef CPC_BAREMETAL
CHK("locks_off_at_start", STR$(Xl(69)) + " " + STR$(Xl(64)), "97 49")
REM caps lock: letters only, whatever SHIFT says
SetLocks(2)
CHK("caps_a", STR$(Xl(69)), "65")
CHK("caps_shift_a", STR$(Xl(69 + 256 * 1)), "65")
CHK("caps_1", STR$(Xl(64)), "49")
CHK("caps_shift_1", STR$(Xl(64 + 256 * 1)), "33")
REM shift lock: everything shifted, SHIFT on top changes nothing
SetLocks(1)
CHK("shlock_a", STR$(Xl(69)), "65")
CHK("shlock_1", STR$(Xl(64)), "33")
CHK("shlock_shift_1", STR$(Xl(64 + 256 * 1)), "33")
CHK("shlock_ctrl_a", STR$(Xl(69 + 256 * 2)), "1")
SetLocks(0)
#endif

REM Give cap32 time to process CAP32_WAITBREAK before END (see cpcrun.py).
#ifdef CPC_BAREMETAL
Say(CHR$ 13 + results$ + "DONE" + CHR$ 13)
#else
PAUSE 100
PRINT
PRINT results$; "DONE"
#endif
END

tabledata:
DATA 240, 243, 241, 57, 54, 51, 13, 46, 242, 224, 55, 56, 53, 49, 50, 48, 16, 91, 13, 93
DATA 52, 255, 92, 255, 94, 45, 64, 112, 59, 58, 47, 46, 48, 57, 111, 105, 108, 107, 109, 44
DATA 56, 55, 117, 121, 104, 106, 110, 32, 54, 53, 114, 116, 103, 102, 98, 118, 52, 51, 101, 119
DATA 115, 100, 99, 120, 49, 50, 252, 113, 9, 97, 253, 122, 11, 10, 8, 9, 88, 90, 255, 127
DATA 244, 247, 245, 57, 54, 51, 13, 46, 246, 224, 55, 56, 53, 49, 50, 48, 16, 123, 13, 125
DATA 52, 255, 96, 255, 163, 61, 124, 80, 43, 42, 63, 62, 95, 41, 79, 73, 76, 75, 77, 60
DATA 40, 39, 85, 89, 72, 74, 78, 32, 38, 37, 82, 84, 71, 70, 66, 86, 36, 35, 69, 87
DATA 83, 68, 67, 88, 33, 34, 252, 81, 9, 65, 253, 90, 11, 10, 8, 9, 88, 90, 255, 127
DATA 248, 251, 249, 57, 54, 51, 82, 46, 250, 224, 55, 56, 53, 49, 50, 48, 16, 27, 13, 29
DATA 52, 255, 28, 255, 30, 255, 0, 16, 255, 255, 255, 255, 31, 255, 15, 9, 12, 11, 13, 255
DATA 255, 255, 21, 25, 8, 10, 14, 255, 255, 255, 18, 20, 7, 6, 2, 22, 255, 255, 5, 23
DATA 19, 4, 3, 24, 255, 126, 252, 17, 225, 1, 254, 26, 255, 255, 255, 255, 255, 255, 255, 127

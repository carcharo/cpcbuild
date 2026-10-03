REM Conformance: INKEY$ is the key held now (Q15; the default), and the
REM firmware key translation behind it. cpcrun.py types the keys below while
REM the program runs, each string after a delay and followed by RETURN (run.py
REM reads these lines). The emulators hold a typed key for only 2-3 frames, so
REM the program polls INKEY$ in a tight loop. SHIFT is held for the capital
REM letters and the shifted symbols (!, =).
REM TYPE: q
REM TYPE: Q
REM TYPE: 1
REM TYPE: !
REM TYPE: -
REM TYPE: =
REM TYPE: x
REM TYPE: HI

#include <input.bas>

DIM results$ AS STRING
SUB CHK(name AS STRING, gotv AS STRING, wantv AS STRING)
  IF gotv = wantv THEN
    results$ = results$ + "PASS " + name + CHR$ 13
  ELSE
    results$ = results$ + "FAIL " + name + " got=" + gotv + " want=" + wantv + CHR$ 13
  END IF
END SUB

REM The keyboard translation seam of the runtime (__CPC_KEYCHAR): v = key
REM (the firmware key number) + 256 * mods (1 SHIFT, 2 CONTROL). Returns the
REM character, or 999 for "no key".
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

REM Polls INKEY$ until a key is held (up to ~15 s), then until it is released;
REM returns every distinct character seen on the way (a press landing between
REM the scan's row reads can show the key before SHIFT, e.g. "qQ").
FUNCTION GetHeld() AS STRING
  DIM n AS UINTEGER
  DIM k$, last$, seen$ AS STRING
  n = 0
  seen$ = ""
  last$ = ""
  DO
    k$ = INKEY$
    IF k$ <> "" THEN
      IF k$ <> last$ THEN seen$ = seen$ + k$
    ELSE
      IF LEN(seen$) THEN EXIT DO
      n = n + 1
    END IF
    last$ = k$
  LOOP UNTIL n > 30000
  RETURN seen$
END FUNCTION

FUNCTION Has(s$ AS STRING, c$ AS STRING) AS UBYTE
  DIM i AS UINTEGER
  IF LEN(s$) = 0 THEN RETURN 0
  FOR i = 0 TO LEN(s$) - 1
    IF s$(i TO i) = c$ THEN RETURN 1
  NEXT i
  RETURN 0
END FUNCTION

DIM a$, r$, t$ AS STRING

REM --- no key held: empty string ---
CHK("idle_empty", STR$(LEN(INKEY$)), "0")
CHK("idle_empty2", STR$(LEN(INKEY$ + INKEY$)), "0")

REM --- the translation: tables, modifiers (no key needs to be held; the locks
REM are in inkey_locks.bas, as KM_SET_LOCKS is not on the 464) ---
CHK("tr_a", STR$(Xl(69)), "97")
CHK("tr_shift_a", STR$(Xl(69 + 256 * 1)), "65")
CHK("tr_ctrl_a", STR$(Xl(69 + 256 * 2)), "1")
CHK("tr_ctrl_beats_shift", STR$(Xl(69 + 256 * 3)), "1")
CHK("tr_1", STR$(Xl(64)), "49")
CHK("tr_shift_1", STR$(Xl(64 + 256 * 1)), "33")
CHK("tr_ctrl_1", STR$(Xl(64 + 256 * 2)), "999")
CHK("tr_return", STR$(Xl(18)), "13")
CHK("tr_space", STR$(Xl(47)), "32")
CHK("tr_del", STR$(Xl(79)), "127")
CHK("tr_esc", STR$(Xl(66)), "252")
CHK("tr_copy", STR$(Xl(9)), "224")
CHK("tr_cursors", STR$(Xl(0)) + " " + STR$(Xl(2)) + " " + STR$(Xl(8)) + " " + STR$(Xl(1)), "240 241 242 243")
CHK("tr_ctrl_cursor", STR$(Xl(0 + 256 * 2)), "248")
CHK("tr_shift_cursor", STR$(Xl(0 + 256 * 1)), "244")
REM modifier keys and the lock keys give no character
CHK("tr_shift_key", STR$(Xl(21)), "999")
CHK("tr_ctrl_key", STR$(Xl(23)), "999")
CHK("tr_capslock_key", STR$(Xl(70)), "999")
REM keypad: expansion tokens give the first character of the string
CHK("tr_keypad", STR$(Xl(15)) + " " + STR$(Xl(13)) + " " + STR$(Xl(3)) + " " + STR$(Xl(7)) + " " + STR$(Xl(6)), "48 49 57 46 13")

REM --- held keys typed by the harness ---
a$ = GetHeld(): r$ = GetHeld()
CHK("held_q", a$, "q")
CHK("held_q_return", r$, CHR$ 13)
a$ = GetHeld(): r$ = GetHeld()
CHK("held_shift_q", STR$(Has(a$, "Q")), "1")
CHK("held_shift_q_only_q", STR$(LEN(a$) <= 2), "1")
a$ = GetHeld(): r$ = GetHeld()
CHK("held_1", a$, "1")
a$ = GetHeld(): r$ = GetHeld()
CHK("held_shift_1_bang", STR$(Has(a$, "!")), "1")
a$ = GetHeld(): r$ = GetHeld()
CHK("held_minus", a$, "-")
a$ = GetHeld(): r$ = GetHeld()
CHK("held_shift_minus_equals", STR$(Has(a$, "=")), "1")
CHK("released_empty", STR$(LEN(INKEY$)), "0")

REM --- INPUT after a held-key loop: the firmware's buffer got "x" and
REM RETURN meanwhile, INPUT must not see them (it flushes at its start) ---
a$ = GetHeld(): r$ = GetHeld()
CHK("held_x", a$, "x")
t$ = INPUT(10)
CHK("input_not_polluted", t$, "HI")

REM Give cap32 time to process CAP32_WAITBREAK before END (see cpcrun.py).
PAUSE 100
PRINT
PRINT results$; "DONE"
END

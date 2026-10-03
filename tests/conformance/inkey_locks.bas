REM BARE: skip sets the firmware's caps/shift locks (KM_SET_LOCKS) through __FW_CALL
REM Conformance: the caps lock and the shift lock in INKEY$'s key translation.
REM KM_SET_LOCKS (&BD3A) exists on the 664 and 6128 only, hence this separate
REM test. Nothing is typed: the lock states are set through the firmware and
REM the runtime's translation routine (__CPC_KEYCHAR) is asked directly.
REM MODELS: 664 6128

#require "io/keyboard/kscan.asm"

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

REM KM_SET_LOCKS (&BD3A): H = caps lock, L = shift lock (0 or &FF)
SUB FASTCALL SetLocks(v AS UINTEGER)
  ASM
  call .core.__FW_CALL
  defw $BD3A
  END ASM
END SUB

CHK("locks_off_at_start", STR$(Xl(69)) + " " + STR$(Xl(64)), "97 49")
REM caps lock: letters only, whatever SHIFT says
SetLocks(65280)
CHK("caps_a", STR$(Xl(69)), "65")
CHK("caps_shift_a", STR$(Xl(69 + 256 * 1)), "65")
CHK("caps_1", STR$(Xl(64)), "49")
CHK("caps_shift_1", STR$(Xl(64 + 256 * 1)), "33")
REM shift lock: everything shifted, SHIFT on top changes nothing
SetLocks(255)
CHK("shlock_a", STR$(Xl(69)), "65")
CHK("shlock_1", STR$(Xl(64)), "33")
CHK("shlock_shift_1", STR$(Xl(64 + 256 * 1)), "33")
CHK("shlock_ctrl_a", STR$(Xl(69 + 256 * 2)), "1")
SetLocks(0)
CHK("locks_off", STR$(Xl(69)), "97")


PRINT
PRINT results$; "DONE"
END

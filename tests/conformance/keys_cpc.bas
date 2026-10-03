REM Conformance: the CPC keys.bas (Q18): the zx48k API with the KEY constants
REM mapped onto the CPC matrix (high byte = row 0-9, low byte = bit mask).
REM cpcrun.py types the keys below, each followed by RETURN; the emulators
REM hold a key for only a few frames, so the program polls in a tight loop.
REM TYPE: a
REM TYPE: A
REM TYPE: m

#include <keys.bas>

DIM results$ AS STRING
SUB CHK(name AS STRING, gotv AS STRING, wantv AS STRING)
  IF gotv = wantv THEN
    results$ = results$ + "PASS " + name + CHR$ 13
  ELSE
    results$ = results$ + "FAIL " + name + " got=" + gotv + " want=" + wantv + CHR$ 13
  END IF
END SUB

DIM c(0 TO 78) AS UINTEGER
DIM i, j, bad, dup, badmask AS UINTEGER
DIM n AS UINTEGER
DIM mq, ma, mw, mqa, sc, ret, shiftseen, shiftalias AS UINTEGER
DIM k AS UBYTE

c(0) = KEYB
c(1) = KEYN
c(2) = KEYM
c(3) = KEYSYMBOL
c(4) = KEYSPACE
c(5) = KEYH
c(6) = KEYJ
c(7) = KEYK
c(8) = KEYL
c(9) = KEYENTER
c(10) = KEYY
c(11) = KEYU
c(12) = KEYI
c(13) = KEYO
c(14) = KEYP
c(15) = KEY6
c(16) = KEY7
c(17) = KEY8
c(18) = KEY9
c(19) = KEY0
c(20) = KEY5
c(21) = KEY4
c(22) = KEY3
c(23) = KEY2
c(24) = KEY1
c(25) = KEYT
c(26) = KEYR
c(27) = KEYE
c(28) = KEYW
c(29) = KEYQ
c(30) = KEYG
c(31) = KEYF
c(32) = KEYD
c(33) = KEYS
c(34) = KEYA
c(35) = KEYV
c(36) = KEYC
c(37) = KEYX
c(38) = KEYZ
c(39) = KEYCAPS
c(40) = KEYCURUP
c(41) = KEYCURRIGHT
c(42) = KEYCURDOWN
c(43) = KEYCURLEFT
c(44) = KEYCOPY
c(45) = KEYCLR
c(46) = KEYDEL
c(47) = KEYTAB
c(48) = KEYESC
c(49) = KEYCAPSLOCK
c(50) = KEYF0
c(51) = KEYF1
c(52) = KEYF2
c(53) = KEYF3
c(54) = KEYF4
c(55) = KEYF5
c(56) = KEYF6
c(57) = KEYF7
c(58) = KEYF8
c(59) = KEYF9
c(60) = KEYFDOT
c(61) = KEYPADENTER
c(62) = KEYMINUS
c(63) = KEYCARET
c(64) = KEYAT
c(65) = KEYSEMICOLON
c(66) = KEYCOLON
c(67) = KEYSLASH
c(68) = KEYDOT
c(69) = KEYCOMMA
c(70) = KEYLBRACKET
c(71) = KEYRBRACKET
c(72) = KEYBACKSLASH
c(73) = KEYJOYUP
c(74) = KEYJOYDOWN
c(75) = KEYJOYLEFT
c(76) = KEYJOYRIGHT
c(77) = KEYJOYFIRE1
c(78) = KEYJOYFIRE2

REM --- idle ---
CHK("idle_multikeys", STR$(MultiKeys(KEYA)), "0")
CHK("idle_multikeys_row", STR$(MultiKeys(KEYA bOR KEYQ)), "0")
CHK("idle_scancode", STR$(GetKeyScanCode()), "0")
CHK("idle_joystick", STR$(MultiKeys(KEYJOYFIRE1) + MultiKeys(KEYJOYUP)), "0")
CHK("not_a_cpc_row", STR$(MultiKeys(0FD01h)), "0")
CHK("row_10", STR$(MultiKeys(0A01h)), "0")

REM --- A held (typed lower case, no SHIFT) ---
n = 0
DO
  n = n + 1
LOOP UNTIL MultiKeys(KEYA) OR n > 30000
mq = MultiKeys(KEYQ)
ma = MultiKeys(KEYA)
mw = MultiKeys(KEYW)
mqa = MultiKeys(KEYA bOR KEYQ)
sc = GetKeyScanCode()
REM then RETURN (polled before any CHK: STR$ is slow, a typed key is short)
n = 0
DO
  n = n + 1
LOOP UNTIL MultiKeys(KEYENTER) OR n > 3000
ret = MultiKeys(KEYENTER)
n = 0
DO
  n = n + 1
LOOP UNTIL MultiKeys(KEYENTER) = 0 OR n > 3000
CHK("a_held", STR$(ma <> 0), "1")
CHK("a_returns_its_mask", STR$(ma), STR$(KEYA bAND 255))
CHK("a_other_key", STR$(mq + mw), "0")
CHK("a_or_row", STR$(mqa), STR$(KEYA bAND 255))
CHK("a_scancode", STR$(sc), STR$(KEYA))
CHK("return_held", STR$(ret <> 0), "1")
REM --- SHIFT + A ---
n = 0
DO
  n = n + 1
LOOP UNTIL MultiKeys(KEYA) OR n > 30000
shiftseen = 0: shiftalias = 0
DO WHILE MultiKeys(KEYA)
  IF MultiKeys(KEYCAPS) THEN shiftseen = 1
  IF MultiKeys(KEYSHIFT) THEN shiftalias = 1
LOOP
CHK("shift_with_a", STR$(shiftseen), "1")
CHK("shift_alias", STR$(shiftalias), "1")
n = 0
DO
  n = n + 1
LOOP UNTIL MultiKeys(KEYENTER) OR n > 3000
n = 0
DO
  n = n + 1
LOOP UNTIL MultiKeys(KEYENTER) = 0 OR n > 3000

REM --- GetKey waits for M and returns its character code ---
k = GetKey()
CHK("getkey_m", STR$(k), "109")

REM (The constants are checked last: the pairwise loop is slow, and the typed
REM keys must not arrive while it runs.)
REM --- the constants: all distinct (the aliases KEYSHIFT/KEYCONTROL are not in the list),
REM high byte a row 0-9, low byte exactly one bit ---
bad = 0: dup = 0: badmask = 0
FOR i = 0 TO 78
  IF (c(i) >> 8) > 9 THEN bad = bad + 1
  IF c(i) bAND 255 = 0 OR (c(i) bAND 255 bAND ((c(i) bAND 255) - 1)) <> 0 THEN badmask = badmask + 1
  FOR j = i + 1 TO 78
    IF c(i) = c(j) THEN dup = dup + 1
  NEXT j
NEXT i
CHK("constants_rows", STR$(bad), "0")
CHK("constants_one_bit", STR$(badmask), "0")
CHK("constants_distinct", STR$(dup), "0")
CHK("alias_shift", STR$(KEYSHIFT = KEYCAPS), "1")
CHK("alias_control", STR$(KEYCONTROL = KEYSYMBOL), "1")
CHK("values", STR$(KEYA) + " " + STR$(KEYQ) + " " + STR$(KEYENTER) + " " + STR$(KEYSPACE) + " " + STR$(KEYCAPS) + " " + STR$(KEYSYMBOL), "2080 2056 516 1408 544 640")
CHK("cpc_only", STR$(KEYCURUP) + " " + STR$(KEYESC) + " " + STR$(KEYJOYFIRE1) + " " + STR$(KEYTAB), "1 2052 2320 2064")

REM Give cap32 time to process CAP32_WAITBREAK before END (see cpcrun.py).
PAUSE 100
PRINT
PRINT results$; "DONE"
END

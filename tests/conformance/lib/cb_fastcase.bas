REM Shared by cb_sprites.bas and cb_fastdbuf.bas (included after they declare
REM npass, results$, sd, gbuf, bgv and doff): RectFn, an assembly-side checker
REM for the unrolled sprite paths, and FastCase / FastChk, one test case.

REM Fast, assembly-side helpers for the bulk tests of the unrolled paths
REM (BASIC loops over PeekScreen are far too slow for hundreds of cases).
REM RectFn(op, x, y, w, h, arg) works on the rectangle with its top-left at
REM byte x, line y (always entirely on the screen); it reads and writes the
REM screen through the library's addressing (__CB_ADDR), independently of
REM the routines under test. Returns a count of mismatching bytes (0 for
REM the fill ops). op:
REM   0  fill the rectangle and a one-byte margin with arg (remembered as the background)
REM   1  count wrong bytes after PutSprite of the w*h bytes at arg: sprite inside, background around
REM   2  the same after PutSpriteMasked (pairs at arg: (bg AND mask) OR pixels)
REM   3  fill the rectangle with the pattern (x*7 + y*13 + 1) AND 255
REM   4  count the bytes of the rectangle that aren't the pattern
REM   5  count the buffer bytes at arg (row-major) that aren't the pattern
REM   6  fill the rectangle with 0
REM   7  fill w*h bytes at arg with &EE
REM   8  fill w*h bytes at arg with a varied sequence;  9: the same for 2*w*h
FUNCTION RectFn(op AS UBYTE, x AS UBYTE, y AS UBYTE, w AS UBYTE, h AS UBYTE, arg AS UINTEGER) AS UINTEGER
  ASM
  push namespace core
  PROC
  LOCAL RF_WALK, RF_ROW, RF_COL, RF_CALLCB, RF_PAT, RF_INSIDE, RF_OUT, RF_CMP
  LOCAL RF_CBBG, RF_CBSPR, RF_CBPATF, RF_CBPATC, RF_CBBUF, RF_CBWIPE
  LOCAL RF_X, RF_Y, RF_W, RF_H, RF_RX, RF_RY, RF_RW, RF_RH, RF_XX, RF_YY, RF_RL, RF_CL
  LOCAL RF_ADDR, RF_BAD, RF_IDX, RF_ARG, RF_BG, RF_M, RF_CB, RF_BOX, RF_X0, RF_DONE
  LOCAL RF_OP1, RF_OP2, RF_OP3, RF_OP4, RF_OP5, RF_OP6
  LOCAL RF_BX1, RF_BY1, RF_BXOK, RF_BYOK, RF_FILL, RF_SEQL, RF_RET
  LOCAL RF_PLAIN, RF_IDXUP, RF_CMPP, RF_CMP2, RF_FILLP, RF_FSTORE, RF_NOT9
  ld hl, 0
  ld (RF_BAD), hl
  ld (RF_IDX), hl
  ld a, (ix+7)
  ld (RF_RX), a
  ld a, (ix+9)
  ld (RF_RY), a
  ld a, (ix+11)
  ld (RF_RW), a
  ld a, (ix+13)
  ld (RF_RH), a
  ld l, (ix+14)
  ld h, (ix+15)
  ld (RF_ARG), hl
  ld a, (ix+5)
  cp 7
  jp nc, RF_FILL
  cp 3
  jr c, RF_BOX            ; ops 0-2 walk the rectangle plus margin
  ld a, (RF_RX)           ; ops 3-6 walk the rectangle
  ld (RF_X), a
  ld a, (RF_RY)
  ld (RF_Y), a
  ld a, (RF_RW)
  ld (RF_W), a
  ld a, (RF_RH)
  ld (RF_H), a
  jr RF_X0
RF_BOX:
  ld a, (RF_RX)           ; box = rectangle + margin, clipped to the screen
  or a
  jr z, RF_BXOK
  dec a
RF_BXOK:
  ld (RF_X), a
  ld c, a
  ld a, (RF_RX)
  ld hl, RF_RW
  add a, (hl)
  cp 80
  jr c, RF_BX1
  ld a, 79
RF_BX1:
  sub c
  inc a
  ld (RF_W), a
  ld a, (RF_RY)
  or a
  jr z, RF_BYOK
  dec a
RF_BYOK:
  ld (RF_Y), a
  ld c, a
  ld a, (RF_RY)
  ld hl, RF_RH
  add a, (hl)
  cp 200
  jr c, RF_BY1
  ld a, 199
RF_BY1:
  sub c
  inc a
  ld (RF_H), a
RF_X0:
  ld a, (ix+5)
  or a
  jr nz, RF_OP1
  ld a, (ix+14)           ; op 0: remember the background
  ld (RF_BG), a
  ld hl, RF_CBBG
  jr RF_WALK
RF_OP1:
  cp 1
  jr nz, RF_OP2
  xor a
  ld (RF_M), a
  ld hl, RF_CBSPR
  jr RF_WALK
RF_OP2:
  cp 2
  jr nz, RF_OP3
  ld a, 1
  ld (RF_M), a
  ld hl, RF_CBSPR
  jr RF_WALK
RF_OP3:
  cp 3
  jr nz, RF_OP4
  ld hl, RF_CBPATF
  jr RF_WALK
RF_OP4:
  cp 4
  jr nz, RF_OP5
  ld hl, RF_CBPATC
  jr RF_WALK
RF_OP5:
  cp 5
  jr nz, RF_OP6
  ld hl, RF_CBBUF
  jr RF_WALK
RF_OP6:
  ld hl, RF_CBWIPE
RF_WALK:
  ld (RF_CB), hl
  ld a, (RF_Y)
  ld (RF_YY), a
  ld a, (RF_H)
  ld (RF_RL), a
RF_ROW:
  ld a, (RF_X)
  ld (RF_XX), a
  ld c, a
  ld a, (RF_YY)
  ld b, a
  call __CB_ADDR          ; HL = the row's first screen address
  ld (RF_ADDR), hl
  ld a, (RF_W)
  ld (RF_CL), a
RF_COL:
  ld hl, (RF_ADDR)
  call RF_CALLCB
  ld hl, (RF_ADDR)
  call __CB_INC_X
  ld (RF_ADDR), hl
  ld a, (RF_XX)
  inc a
  ld (RF_XX), a
  ld hl, RF_CL
  dec (hl)
  jr nz, RF_COL
  ld a, (RF_YY)
  inc a
  ld (RF_YY), a
  ld hl, RF_RL
  dec (hl)
  jr nz, RF_ROW
RF_RET:
  ld hl, (RF_BAD)
  jp RF_DONE
RF_CALLCB:
  ld de, (RF_CB)
  push de
  ret
RF_PAT:                   ; A = (xx * 7 + yy * 13 + 1) AND 255
  ld a, (RF_XX)
  ld b, a
  add a, a
  add a, a
  add a, a
  sub b                   ; 7 xx
  ld b, a
  ld a, (RF_YY)
  ld c, a
  add a, a
  add a, a                ; 4 yy
  ld d, a
  add a, a                ; 8 yy
  add a, d                ; 12 yy
  add a, c                ; 13 yy
  add a, b
  inc a
  ret
RF_CBBG:
  ld a, (RF_BG)
  ld (hl), a
  ret
RF_CBWIPE:
  ld (hl), 0
  ret
RF_CBPATF:
  push hl
  call RF_PAT
  pop hl
  ld (hl), a
  ret
RF_CBPATC:
  push hl
  call RF_PAT
  pop hl
  jr RF_CMP
RF_CBBUF:
  push hl
  call RF_PAT
  ld hl, (RF_IDX)
  inc hl
  ld (RF_IDX), hl
  dec hl
  ld de, (RF_ARG)
  add hl, de
  ld c, (hl)              ; the buffer byte
  pop hl
  cp c
  ret z
  jr RF_CMP2
RF_CBSPR:
  push hl                 ; the screen address
  ld a, (RF_XX)
  ld hl, RF_RX
  sub (hl)
  jr c, RF_OUT
  ld hl, RF_RW
  cp (hl)
  jr nc, RF_OUT
  ld a, (RF_YY)
  ld hl, RF_RY
  sub (hl)
  jr c, RF_OUT
  ld hl, RF_RH
  cp (hl)
  jr nc, RF_OUT
  ld hl, (RF_IDX)         ; inside: the next sprite byte(s)
  ld a, (RF_M)
  or a
  jr z, RF_INSIDE
  add hl, hl
RF_INSIDE:
  ld de, (RF_ARG)
  add hl, de
  ld a, (RF_M)
  or a
  jr z, RF_PLAIN
  ld a, (RF_BG)
  and (hl)
  inc hl
  or (hl)
  jr RF_IDXUP
RF_PLAIN:
  ld a, (hl)
RF_IDXUP:
  ld hl, (RF_IDX)
  inc hl
  ld (RF_IDX), hl
  jr RF_CMPP
RF_OUT:
  ld a, (RF_BG)
RF_CMPP:
  pop hl
RF_CMP:                   ; A = wanted, (HL) = the screen byte
  ld c, (hl)
  cp c
  ret z
RF_CMP2:
  ld hl, (RF_BAD)
  inc hl
  ld (RF_BAD), hl
  ret
RF_FILL:                  ; ops 7-9: fill w*h (or 2*w*h) bytes at arg
  ld a, (RF_RW)
  ld b, a
  ld a, (RF_RH)
  ld c, a
  ld hl, 0
  ld d, 0
  ld e, b
RF_SEQL:
  add hl, de              ; HL = w * h
  dec c
  jr nz, RF_SEQL
  ld a, (ix+5)
  cp 9
  jr nz, RF_NOT9
  add hl, hl
RF_NOT9:
  ld b, h
  ld c, l
  ld hl, (RF_ARG)
  ld d, 17
  ld e, 53
RF_FILLP:
  ld a, (ix+5)
  cp 7
  ld a, $EE
  jr z, RF_FSTORE
  ld a, d
  add a, e
  ld d, a
RF_FSTORE:
  ld (hl), a
  inc hl
  dec bc
  ld a, b
  or c
  jr nz, RF_FILLP
  ld hl, 0
  jr RF_DONE
RF_BAD:  defw 0
RF_ADDR: defw 0
RF_IDX:  defw 0
RF_ARG:  defw 0
RF_CB:   defw 0
RF_BG:   defb 0
RF_M:    defb 0
RF_X:    defb 0
RF_Y:    defb 0
RF_W:    defb 0
RF_H:    defb 0
RF_RX:   defb 0
RF_RY:   defb 0
RF_RW:   defb 0
RF_RH:   defb 0
RF_XX:   defb 0
RF_YY:   defb 0
RF_RL:   defb 0
RF_CL:   defb 0
RF_DONE:
  ENDP
  pop namespace
  END ASM
END FUNCTION

REM One case of the unrolled-path suite: kind 0 PutSprite, 1 PutSpriteMasked,
REM 2 GetBlock (then restore it with PutSprite). Returns the mismatch count
REM (for GetBlock: the buffer's plus the restored rectangle's).
FUNCTION FastCase(x AS UBYTE, y AS UBYTE, w AS UBYTE, h AS UBYTE, kind AS UBYTE) AS UINTEGER
  DIM r, bad AS UINTEGER
  IF kind = 2 THEN
    r = RectFn(3, x, y, w, h, 0)
    r = RectFn(7, 0, 0, w, h, @gbuf(0))
    GetBlock(x, y, w, h, @gbuf(0))
    bad = RectFn(5, x, y, w, h, @gbuf(0))
    r = RectFn(6, x, y, w, h, 0)
    PutSprite(x, y, w, h, @gbuf(0))
    RETURN bad + RectFn(4, x, y, w, h, 0)
  END IF
  r = RectFn(0, x, y, w, h, bgv)
  IF kind = 0 THEN
    r = RectFn(8, 0, 0, w, h, @sd(doff))
    PutSprite(x, y, w, h, @sd(doff))
    RETURN RectFn(1, x, y, w, h, @sd(doff))
  END IF
  r = RectFn(9, 0, 0, w, h, @sd(doff))
  PutSpriteMasked(x, y, w, h, @sd(doff))
  RETURN RectFn(2, x, y, w, h, @sd(doff))
END FUNCTION

REM Count a passed case, or list a failed one (the name is only built then).
SUB FastChk(bad AS UINTEGER, m AS STRING, kind AS UBYTE, w AS UBYTE, pp AS UBYTE, dj AS UBYTE)
  IF bad = 0 THEN
    npass = npass + 1
  ELSE
    results$ = results$ + "FAIL " + m + " kind=" + STR$(kind) + " w=" + STR$(w) + " pos=" + STR$(pp) + " doff#=" + STR$(dj) + " bad=" + STR$(bad) + CHR$ 13
  END IF
END SUB


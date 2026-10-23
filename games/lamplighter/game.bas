' ----------------------------------------------------------------
' game.bas -- Lamplighter's game logic (portable, no drawing)
'
' Platform-free: the including file first defines the platform layer's
' calls (platform_cpc.bas, or tests/platform_null.bas for the logic tests):
'
'   PlatRoom(addr)                    draw the room whose 20 x 23 tiles are at addr
'   PlatTile(cx, cy, tile)            one cell changed (also redraws sprites)
'   PlatSprite(slot, frame, x, y)     sprite slot 0 (player), 1-4 (enemies);
'                                     x in pixels, y in lines; frame 255 = hidden
'   PlatHud(lit, total, lives, room)  the HUD rows, where they changed
'   PlatSfx(n)                        1 jump, 2 lamp, 3 death, 4 door opens
'   (the music is the platform layer's and main.bas's business: PlatMusic)
'
' Units: x in mode-0 pixels 0-159 (the player is 8 wide, moves 2 at a time),
' y in lines 0-183 (16 tall). A room is 20 x 23 cells of 8 x 8.
' The hit box is x+1..x+6 across; rows y, y+8 and y+15 are probed.
'
' The hot routines (TileAttr, TouchAttr, ColSolid, WalkOK, CopyRoom, ScanRoom)
' exist twice: in Z80 assembly (the default, chapter 9 of the tutorial says
' why) and in plain BASIC, the versions the tutorial has you write (chapters
' 5-7). Build with -D LAMP_BASIC to get the plain BASIC ones: the game plays
' the same, only slower.
' ----------------------------------------------------------------

#ifndef __LAMP_GAME__
#define __LAMP_GAME__

#include once "assets/rooms.bas"

CONST S_PLAY AS UBYTE = 0
CONST S_OVER AS UBYTE = 1
CONST S_WON AS UBYTE = 2

' input bits
CONST I_LEFT AS UBYTE = 1
CONST I_RIGHT AS UBYTE = 2
CONST I_FIRE AS UBYTE = 4
CONST I_ANY AS UBYTE = 8
CONST I_UP AS UBYTE = 16
CONST I_DOWN AS UBYTE = 32

' tile numbers (assets/tiles.png) and the attribute bits of each
CONST T_BRICK AS UBYTE = 1
CONST T_LAMP AS UBYTE = 5
CONST T_LIT AS UBYTE = 6
CONST T_DOOR AS UBYTE = 7
CONST T_OPEN AS UBYTE = 8
' attribute bits: 1 solid, 2 one-way platform, 4 ladder, 8 hazard, 16 lamp;
' the table (TA_TAB in the assembly, taTab in the BASIC version, indexed by tile
' number) is with TileAttr below

' sprite frames: 0-3 right (stand, walk, walk, jump), 4-7 left, 8-9 climb,
' 10-11 enemy
CONST F_CLIMB AS UBYTE = 8
CONST F_ENEMY AS UBYTE = 10

' the jump: dy per step (rising, then falling; the last repeats)
DIM jtab(16) AS BYTE => {-5, -4, -4, -3, -3, -2, -2, -1, -1, 0, 1, 1, 2, 2, 3, 3, 4}
' a bat's wobble: 8 + 8 sin
DIM batTab(31) AS UBYTE => {8, 10, 11, 12, 14, 15, 15, 16, 16, 16, 15, 15, 14, 12, 11, 10, 8, 6, 5, 4, 2, 1, 1, 0, 0, 0, 1, 1, 2, 4, 5, 6}
DIM bitTab(7) AS UBYTE => {1, 2, 4, 8, 16, 32, 64, 128}

DIM cur(459) AS UBYTE                 ' the current room's tiles
DIM litMask(11) AS UBYTE              ' lit lamps of each room, one bit per lamp
' the current room's lamp and door cells (cell indices, in cell order; at
' most 8 of each, split_rooms.py checks), found once by LoadRoom
DIM nLamp, nDoor AS UBYTE
DIM lampCell(7) AS UINTEGER
DIM doorCell(7) AS UINTEGER
DIM gState, gLives, pRoom AS UBYTE
DIM gLit, gTotal, gRoomLamps, gRoomLit AS UBYTE
DIM pX, pY, pAir, pJt, pClimb, pFace, pAnim, pMove AS UBYTE
DIM entX, entY, startC, startR AS UBYTE
' enemies: kind (1 walker, 2 floater, 3 bat), position, direction (1 = right
' or down), start x, start y, range in pixels (eTick counts the steps)
DIM nEn AS UBYTE
DIM eK(3) AS UBYTE
DIM eX(3) AS UBYTE
DIM eY(3) AS UBYTE
DIM eD(3) AS UBYTE
DIM eTick AS UBYTE      ' steps since the enemies were put on their start squares
DIM eM(3) AS UBYTE      ' moved (or new) since GameDraw handed it over
DIM eX0(3) AS UBYTE
DIM eY0(3) AS UBYTE
DIM eR(3) AS UBYTE

' ---- the room ------------------------------------------------------------

' The attributes of cell (cx, cy) of the room: TA_TAB(cur(cy * 20 + cx) AND 15).
' Assembly, because the BASIC line is 2,500 T-states a call and a step makes
' ~25 of them (docs/library.md, Performance tips).
#ifdef LAMP_BASIC
' The plain BASIC version of the assembly below (-D LAMP_BASIC; chapter 5):
' about 2,560 T-states a call against 320 (measured on chips, 464, net of the empty call).
DIM taTab(15) AS UBYTE => {0, 1, 2, 4, 8, 16, 0, 1, 0, 0, 0, 0, 6, 0, 0, 0}

FUNCTION TileAttr(cx AS UBYTE, cy AS UBYTE) AS UBYTE
  RETURN taTab(cur(CAST(UINTEGER, cy) * ROOM_W + cx) BAND 15)
END FUNCTION
#else
FUNCTION TileAttr(cx AS UBYTE, cy AS UBYTE) AS UBYTE
  ASM
  jp TA_GO
TA_TAB:                   ; the attributes of tiles 0-15 (assets/tiles.png)
  defb 0, 1, 2, 4, 8, 16, 0, 1, 0, 0, 0, 0, 6, 0, 0, 0
CELL_ATTR:                ; B = column, C = row -> A = the cell's attributes (keeps BC)
  ld a, c
  ld l, a
  ld h, 0
  ld e, a
  ld d, 0
  add hl, hl
  add hl, hl
  add hl, de
  add hl, hl
  add hl, hl
  ld e, b
  ld d, 0
  add hl, de
  ld de, _cur.__DATA__
  add hl, de
  ld a, (hl)
  and 15
  ld e, a
  ld d, 0
  ld hl, TA_TAB
  add hl, de
  ld a, (hl)
  ret
TA_GO:
  ld a, (ix+7)            ; cy
  ld l, a
  ld h, 0
  ld e, a
  ld d, 0
  add hl, hl
  add hl, hl              ; 4 cy
  add hl, de              ; 5 cy
  add hl, hl
  add hl, hl              ; 20 cy
  ld a, (ix+5)            ; cx
  ld e, a
  add hl, de
  ld de, _cur.__DATA__
  add hl, de
  ld a, (hl)              ; the tile
  and 15
  ld e, a
  ld d, 0
  ld hl, TA_TAB
  add hl, de
  ld a, (hl)
  END ASM
END FUNCTION
#endif

' The lamps and the spikes the player is on, in one call: the attributes of
' cells l..r of the three rows the body is probed on (y, y+8, y+15), OR'd,
' masked with 16 (lamp: any of the rows) and 8 (hazard: the lower two rows
' only). Touch's common case is "nothing", and this answers it in a single
' call instead of ~6 TileAttr calls and their loops.
#ifdef LAMP_BASIC
' The plain BASIC version of the assembly below (-D LAMP_BASIC): about 56,600
' T-states a call against 3,800. TouchRow ORs the attributes of cells
' l..r of one row (l <= r).
FUNCTION TouchRow(l AS UBYTE, r AS UBYTE, row AS UBYTE) AS UBYTE
  DIM c, a AS UBYTE
  a = 0
  FOR c = l TO r
    a = a BOR TileAttr(c, row)
  NEXT c
  RETURN a
END FUNCTION

FUNCTION TouchAttr(l AS UBYTE, r AS UBYTE, y AS UBYTE) AS UBYTE
  DIM a AS UBYTE
  a = TouchRow(l, r, y >> 3) BAND 16          ' the top row: lamps only
  a = a BOR TouchRow(l, r, (y + 8) >> 3)
  a = a BOR TouchRow(l, r, (y + 15) >> 3)
  RETURN a BAND 24
END FUNCTION
#else
FUNCTION TouchAttr(l AS UBYTE, r AS UBYTE, y AS UBYTE) AS UBYTE
  ASM
  jp TOUCH_GO
TOUCH_ROW:                ; A = row; returns A = the attributes of cells l..r OR'd
  ld l, a
  ld h, 0
  ld e, a
  ld d, 0
  add hl, hl
  add hl, hl
  add hl, de
  add hl, hl
  add hl, hl              ; 20 row
  ld de, _cur.__DATA__
  add hl, de
  ld e, (ix+5)            ; l
  ld d, 0
  add hl, de              ; the cell (l, row)
  ld a, (ix+7)            ; r
  sub (ix+5)
  inc a
  ld b, a                 ; cells to read
  ld c, 0
TOUCH_CELL:
  ld a, (hl)
  and 15
  push hl
  ld e, a
  ld d, 0
  ld hl, TA_TAB
  add hl, de
  ld a, (hl)
  or c
  ld c, a
  pop hl
  inc hl
  djnz TOUCH_CELL
  ld a, c
  ret
TOUCH_GO:
  ld a, (ix+9)            ; y
  srl a
  srl a
  srl a
  call TOUCH_ROW
  and 16                  ; the top row: lamps only
  ld d, a
  ld a, (ix+9)
  add a, 8
  srl a
  srl a
  srl a
  push de
  call TOUCH_ROW
  pop de
  or d
  ld d, a
  ld a, (ix+9)
  add a, 15
  srl a
  srl a
  srl a
  push de
  call TOUCH_ROW
  pop de
  or d
  and 24
  END ASM
END FUNCTION
#endif

' cur = the 460 bytes at src (a room of rooms), a block copy (BASIC took 460
' iterations). The address comes from BASIC: an array used only from inline
' asm is dropped.
#ifdef LAMP_BASIC
' The plain BASIC version of the assembly below (-D LAMP_BASIC): about 511,000
' T-states against 13,200.
SUB CopyRoom(src AS UINTEGER)
  DIM i AS UINTEGER
  FOR i = 0 TO ROOM_SIZE - 1
    cur(i) = PEEK(src + i)
  NEXT i
END SUB
#else
SUB CopyRoom(src AS UINTEGER)
  ASM
  ld l, (ix+4)
  ld h, (ix+5)            ; src
  ld de, _cur.__DATA__
  ld bc, 460              ; ROOM_SIZE
  ldir
  END ASM
END SUB
#endif

' Lists the lamp cells (tile 5) and the door cells (tile 7) of cur, in cell
' order, into lampCell/doorCell with their counts (CPIR over the room).
#ifdef LAMP_BASIC
' The plain BASIC version of the assembly below (-D LAMP_BASIC): about 471,000
' T-states against 27,000.
SUB ScanRoom()
  DIM i AS UINTEGER
  DIM t AS UBYTE
  nLamp = 0
  nDoor = 0
  FOR i = 0 TO ROOM_SIZE - 1
    t = cur(i)
    IF t = T_LAMP THEN
      lampCell(nLamp) = i
      nLamp = nLamp + 1
    ELSEIF t = T_DOOR THEN
      doorCell(nDoor) = i
      nDoor = nDoor + 1
    END IF
  NEXT i
END SUB
#else
SUB ScanRoom()
  ASM
  xor a
  ld (_nLamp), a
  ld (_nDoor), a
  ld hl, _cur.__DATA__
  ld bc, 460
  ld de, _lampCell.__DATA__
  ld a, 5                 ; T_LAMP
SR_LAMP:
  cpir
  jr nz, SR_LAMPS_DONE
  call SR_STORE
  ld a, (_nLamp)
  inc a
  ld (_nLamp), a
  ld a, b
  or c
  ld a, 5
  jr nz, SR_LAMP
SR_LAMPS_DONE:
  ld hl, _cur.__DATA__
  ld bc, 460
  ld de, _doorCell.__DATA__
  ld a, 7                 ; T_DOOR
SR_DOOR:
  cpir
  jr nz, SR_END
  call SR_STORE
  ld a, (_nDoor)
  inc a
  ld (_nDoor), a
  ld a, b
  or c
  ld a, 7
  jr nz, SR_DOOR
  jr SR_END
SR_STORE:                 ; HL just past a match, DE the list's next entry
  push hl
  push bc
  dec hl
  ld bc, _cur.__DATA__
  or a
  sbc hl, bc              ; the cell index
  ex de, hl
  ld (hl), e
  inc hl
  ld (hl), d
  inc hl
  ex de, hl               ; DE the next entry again
  pop bc
  pop hl
  ret
SR_END:
  END ASM
END SUB
#endif

' Reads room id into cur (lit lamps and open doors applied), its start cell
' and its enemies.
SUB LoadRoom(id AS UBYTE)
  DIM o AS UINTEGER
  DIM n, t AS UBYTE
  CopyRoom(@rooms(0) + CAST(UINTEGER, id) * ROOM_SIZE)
  ScanRoom()
  gRoomLamps = nLamp
  gRoomLit = 0
  n = 0
  DO WHILE n < nLamp
    IF (litMask(id) BAND bitTab(n)) <> 0 THEN
      cur(lampCell(n)) = T_LIT
      gRoomLit = gRoomLit + 1
    END IF
    n = n + 1
  LOOP
  IF gRoomLit = gRoomLamps THEN
    n = 0
    DO WHILE n < nDoor
      cur(doorCell(n)) = T_OPEN
      n = n + 1
    LOOP
  END IF
  nEn = 0
  o = roff(id)
  DO
    t = robj(o)
    IF t = 0 THEN EXIT DO
    IF t = 1 THEN
      startC = robj(o + 1)
      startR = robj(o + 2)
    ELSEIF t = 2 THEN
      eK(nEn) = robj(o + 1)
      eX0(nEn) = robj(o + 2) << 3
      eY0(nEn) = robj(o + 3) << 3
      eR(nEn) = robj(o + 4) << 3
      nEn = nEn + 1
    END IF
    o = o + 5
  LOOP
END SUB

' Puts the enemies on their start squares, hides the unused slots.
SUB ResetEnemies()
  DIM i AS UBYTE
  eTick = 0
  FOR i = 0 TO 3
    IF i < nEn THEN
      eX(i) = eX0(i)
      eY(i) = eY0(i)
      eD(i) = 1
      eM(i) = 1
    ELSE
      PlatSprite(i + 1, 255, 0, 0)
    END IF
  NEXT i
END SUB

' Enters room id with the player's top left at (x, y); x = 255: its start cell.
SUB EnterRoom(id AS UBYTE, x AS UBYTE, y AS UBYTE)
  pRoom = id
  LoadRoom(id)
  IF x = 255 THEN
    x = startC << 3
    y = startR << 3
  END IF
  pX = x
  pY = y
  entX = x
  entY = y
  ResetEnemies()
  PlatRoom(@cur(0))
END SUB

' ---- the game ------------------------------------------------------------

' A game starting in `room` (9: the cellar) with all lamps unlit.
SUB GameInit(room AS UBYTE)
  DIM n AS UBYTE
  FOR n = 0 TO 11
    litMask(n) = 0
  NEXT n
  gTotal = LAMPS_TOTAL
  gLit = 0
  gLives = 3
  gState = S_PLAY
  pAir = 0
  pJt = 0
  pClimb = 0
  pFace = 0
  pAnim = 0
  pMove = 0
  EnterRoom(room, 255, 0)
END SUB

' Lamp at cell (cx, cy) is touched: light it, remember it, open the doors
' when the room is done.
SUB LightLamp(cx AS UBYTE, cy AS UBYTE)
  DIM idx AS UINTEGER
  DIM n, i AS UBYTE
  idx = CAST(UINTEGER, cy) * ROOM_W + cx
  n = 0
  DO WHILE lampCell(n) <> idx AND n < nLamp
    n = n + 1
  LOOP
  cur(idx) = T_LIT
  litMask(pRoom) = litMask(pRoom) BOR bitTab(n)
  gRoomLit = gRoomLit + 1
  gLit = gLit + 1
  PlatTile(cx, cy, T_LIT)
  PlatSfx(2)
  IF gRoomLit = gRoomLamps THEN
    i = 0
    DO WHILE i < nDoor
      idx = doorCell(i)
      cur(idx) = T_OPEN
      PlatTile(CAST(UBYTE, idx MOD ROOM_W), CAST(UBYTE, idx / ROOM_W), T_OPEN)
      PlatSfx(4)
      i = i + 1
    LOOP
  END IF
  IF gLit = gTotal THEN gState = S_WON
END SUB

SUB Die()
  gLives = gLives - 1
  PlatSfx(3)
  IF gLives = 0 THEN
    gState = S_OVER
    RETURN
  END IF
  pX = entX
  pY = entY
  pAir = 0
  pJt = 0
  pClimb = 0
  ResetEnemies()
END SUB

' Solid cell in column c over the body's rows (y, y+8, y+15)?
#ifdef LAMP_BASIC
' The plain BASIC version of the assembly below (-D LAMP_BASIC): about 8,800
' T-states a call against 1,100.
FUNCTION ColSolid(c AS UBYTE, y AS UBYTE) AS UBYTE
  IF (TileAttr(c, y >> 3) BAND 1) <> 0 THEN RETURN 1
  IF (TileAttr(c, (y + 8) >> 3) BAND 1) <> 0 THEN RETURN 1
  RETURN TileAttr(c, (y + 15) >> 3) BAND 1
END FUNCTION
#else
FUNCTION ColSolid(c AS UBYTE, y AS UBYTE) AS UBYTE
  ASM
  ld b, (ix+5)            ; the column
  ld a, (ix+7)            ; y
  srl a
  srl a
  srl a
  ld c, a
  call CELL_ATTR
  and 1
  jr nz, CS_YES
  ld a, (ix+7)
  add a, 8
  srl a
  srl a
  srl a
  ld c, a
  call CELL_ATTR
  and 1
  jr nz, CS_YES
  ld a, (ix+7)
  add a, 15
  srl a
  srl a
  srl a
  ld c, a
  call CELL_ATTR
  and 1
  jr CS_DONE
CS_YES:
  ld a, 1
CS_DONE:
  END ASM
END FUNCTION
#endif

' The attributes of the cells under the two hit box columns at line y
FUNCTION RowAttr(y AS UBYTE) AS UBYTE
  DIM r AS UBYTE
  r = y >> 3
  RETURN TileAttr((pX + 1) >> 3, r) BOR TileAttr((pX + 6) >> 3, r)
END FUNCTION

' Standing on something (or on the floor of the tower's bottom edge)?
FUNCTION Ground() AS UBYTE
  IF pY >= 168 THEN
    IF pRoom < 9 THEN RETURN 0
    RETURN 1
  END IF
  IF ((pY + 16) BAND 7) <> 0 THEN RETURN 0
  IF (RowAttr(pY + 16) BAND 3) <> 0 THEN RETURN 1
  RETURN 0
END FUNCTION

' One step sideways: dir 0 right, 1 left. At the room's edge, to the
' neighbouring room when there is one.
SUB MoveX(dir AS UBYTE)
  DIM nx AS UBYTE
  IF dir = 1 THEN
    IF pX < 2 THEN
      IF (pRoom MOD 3) > 0 THEN EnterRoom(pRoom - 1, 152, pY)
      RETURN
    END IF
    nx = pX - 2
    IF ColSolid((nx + 1) >> 3, pY) <> 0 THEN RETURN
  ELSE
    IF pX >= 152 THEN
      IF (pRoom MOD 3) < 2 THEN EnterRoom(pRoom + 1, 0, pY)
      RETURN
    END IF
    nx = pX + 2
    IF ColSolid((nx + 6) >> 3, pY) <> 0 THEN RETURN
  END IF
  pX = nx
END SUB

' Falling or rising: one step of the jump table
SUB MoveY()
  DIM dy AS BYTE
  DIM ny AS INTEGER
  DIM nb, a, row AS UBYTE
  dy = jtab(pJt)
  IF pJt < 16 THEN pJt = pJt + 1
  IF dy < 0 THEN
    ny = CAST(INTEGER, pY) + dy
    IF ny < 0 THEN
      IF pRoom >= 3 THEN
        EnterRoom(pRoom - 3, pX, 168)
      ELSE
        pY = 0
        pJt = 10
      END IF
      RETURN
    END IF
    a = RowAttr(CAST(UBYTE, ny))
    IF (a BAND 1) <> 0 THEN
      pY = ((CAST(UBYTE, ny) >> 3) + 1) << 3
      pJt = 10
    ELSE
      pY = CAST(UBYTE, ny)
    END IF
  ELSEIF dy > 0 THEN
    nb = pY + dy + 15
    IF nb >= 184 THEN
      IF pRoom < 9 THEN
        EnterRoom(pRoom + 3, pX, 0)
      ELSE
        pY = 168
        pAir = 0
        pJt = 0
      END IF
      RETURN
    END IF
    a = RowAttr(nb)
    row = nb >> 3
    IF (a BAND 1) <> 0 OR ((a BAND 2) <> 0 AND ((pY + 15) >> 3) < row) THEN
      pY = (row << 3) - 16
      pAir = 0
      pJt = 0
    ELSE
      pY = pY + dy
    END IF
  END IF
END SUB

SUB StartClimb(cx AS UBYTE)
  pClimb = 1
  pAir = 0
  pJt = 0
  pX = cx << 3
END SUB

' On a ladder: up and down two lines a step; fire jumps off.
SUB ClimbStep(inp AS UBYTE)
  DIM cx, ny, a AS UBYTE
  cx = (pX + 4) >> 3
  IF (inp BAND I_FIRE) <> 0 THEN
    pClimb = 0
    pAir = 1
    pJt = 0
    PlatSfx(1)
    RETURN
  END IF
  IF (inp BAND I_UP) <> 0 THEN
    IF pY < 2 THEN
      IF pRoom >= 3 THEN EnterRoom(pRoom - 3, pX, 168)
      RETURN
    END IF
    ny = pY - 2
    pAnim = pAnim + 1
    pY = ny
    IF ((TileAttr(cx, (ny + 8) >> 3) BOR TileAttr(cx, (ny + 15) >> 3)) BAND 4) = 0 THEN
      pClimb = 0
      pAir = 1
      pJt = 10
    END IF
  ELSEIF (inp BAND I_DOWN) <> 0 THEN
    ny = pY + 2
    IF ny + 16 > 184 THEN
      IF pRoom < 9 THEN EnterRoom(pRoom + 3, pX, 0)
      RETURN
    END IF
    pAnim = pAnim + 1
    a = TileAttr(cx, (ny + 15) >> 3)
    IF (a BAND 1) <> 0 OR ((a BAND 2) <> 0 AND (a BAND 4) = 0) THEN
      pY = (((ny + 15) >> 3) << 3) - 16
      pClimb = 0
      RETURN
    END IF
    pY = ny
    IF ((TileAttr(cx, (ny + 8) >> 3) BOR TileAttr(cx, (ny + 15) >> 3)) BAND 4) = 0 THEN
      pClimb = 0
      pAir = 1
      pJt = 10
    END IF
  END IF
END SUB

SUB MovePlayer(inp AS UBYTE)
  DIM cx AS UBYTE
  IF pClimb <> 0 THEN
    ClimbStep(inp)
    RETURN
  END IF
  cx = (pX + 4) >> 3
  IF (inp BAND I_UP) <> 0 THEN
    IF ((TileAttr(cx, (pY + 8) >> 3) BOR TileAttr(cx, (pY + 15) >> 3)) BAND 4) <> 0 THEN
      StartClimb(cx)
      RETURN
    END IF
  END IF
  IF (inp BAND I_DOWN) <> 0 AND pAir = 0 AND pY < 168 THEN
    IF (TileAttr(cx, (pY + 16) >> 3) BAND 4) <> 0 THEN
      StartClimb(cx)
      RETURN
    END IF
  END IF
  pMove = 0
  IF (inp BAND I_LEFT) <> 0 THEN
    pFace = 1
    pMove = 1
    MoveX(1)
  ELSEIF (inp BAND I_RIGHT) <> 0 THEN
    pFace = 0
    pMove = 1
    MoveX(0)
  END IF
  IF pMove <> 0 THEN pAnim = pAnim + 1
  IF pAir = 0 THEN
    IF (inp BAND I_FIRE) <> 0 THEN
      pAir = 1
      pJt = 0
      PlatSfx(1)
    ELSEIF Ground() = 0 THEN
      pAir = 1
      pJt = 10
    END IF
  END IF
  IF pAir <> 0 THEN MoveY()
END SUB

' Can a walker stand with its left edge at x, y, having just stepped in
' direction dir (1 right)? No wall in its way, ground under the leading
' edge, no spikes there.
#ifdef LAMP_BASIC
' The plain BASIC version of the assembly below (-D LAMP_BASIC; chapter 6):
' about 15,200 T-states a call against 1,900.
FUNCTION WalkOK(x AS UBYTE, y AS UBYTE, dir AS UBYTE) AS UBYTE
  DIM c AS UBYTE
  IF dir = 1 THEN c = (x + 7) >> 3 ELSE c = x >> 3
  IF ColSolid(c, y) <> 0 THEN RETURN 0
  IF (TileAttr(c, (y + 15) >> 3) BAND 8) <> 0 THEN RETURN 0
  IF (TileAttr(c, (y + 16) >> 3) BAND 3) = 0 THEN RETURN 0
  RETURN 1
END FUNCTION
#else
FUNCTION WalkOK(x AS UBYTE, y AS UBYTE, dir AS UBYTE) AS UBYTE
  ASM
  ld a, (ix+9)            ; dir
  cp 1
  ld a, (ix+5)            ; x
  jr nz, WK_COL
  add a, 7                ; going right: the right edge
WK_COL:
  srl a
  srl a
  srl a
  ld b, a                 ; the column in front
  ld a, (ix+7)            ; y
  srl a
  srl a
  srl a
  ld c, a
  call CELL_ATTR
  and 1
  jr nz, WK_NO            ; a wall (rows y, y+8, y+15)
  ld a, (ix+7)
  add a, 8
  srl a
  srl a
  srl a
  ld c, a
  call CELL_ATTR
  and 1
  jr nz, WK_NO
  ld a, (ix+7)
  add a, 15
  srl a
  srl a
  srl a
  ld c, a
  call CELL_ATTR
  and 1
  jr nz, WK_NO
  call CELL_ATTR          ; (row y+15 again: the spikes)
  and 8
  jr nz, WK_NO
  ld a, (ix+7)
  add a, 16
  srl a
  srl a
  srl a
  ld c, a
  call CELL_ATTR          ; the ground under it
  and 3
  jr z, WK_NO
  ld a, 1
  jr WK_DONE
WK_NO:
  xor a
WK_DONE:
  END ASM
END FUNCTION
#endif

' Enemies move two pixels every second step, half of them on each step: enemy
' i on the steps where eTick and i are both even or both odd (so the drawing
' of a step is the player and at most two enemies, which a 464 can do at 25
' steps a second). Only those are visited: the others cost nothing.
SUB MoveEnemies()
  DIM i, k, x, y, d AS UBYTE
  IF nEn = 0 THEN RETURN
  eTick = eTick + 1
  i = eTick BAND 1
  DO WHILE i < nEn
    eM(i) = 1
    k = eK(i)
    x = eX(i)
    d = eD(i)
    IF k = 1 THEN
      IF d = 1 THEN
        IF x >= 152 THEN
          eD(i) = 0
        ELSE
          x = x + 2
          IF WalkOK(x, eY(i), 1) = 0 THEN eD(i) = 0 ELSE eX(i) = x
        END IF
      ELSE
        IF x < 2 THEN
          eD(i) = 1
        ELSE
          x = x - 2
          IF WalkOK(x, eY(i), 0) = 0 THEN eD(i) = 1 ELSE eX(i) = x
        END IF
      END IF
    ELSEIF k = 2 THEN
      y = eY(i)
      IF d = 1 THEN
        y = y + 2
        eY(i) = y
        IF y >= eY0(i) + eR(i) THEN eD(i) = 0
      ELSE
        y = y - 2
        eY(i) = y
        IF y <= eY0(i) THEN eD(i) = 1
      END IF
    ELSE
      IF d = 1 THEN
        x = x + 2
        eX(i) = x
        IF x >= eX0(i) + eR(i) THEN eD(i) = 0
      ELSE
        x = x - 2
        eX(i) = x
        IF x <= eX0(i) THEN eD(i) = 1
      END IF
      eY(i) = eY0(i) + batTab((eTick >> 1) BAND 31) - 8
    END IF
    i = i + 2
  LOOP
END SUB

' Lamps, spikes and enemies against the player; returns 1 on a hit.
FUNCTION Touch() AS UBYTE
  DIM k, c, l, r, row, t, hit, ex, ey, a AS UBYTE
  l = (pX + 1) >> 3
  r = (pX + 6) >> 3
  hit = 0
  a = TouchAttr(l, r, pY)
  IF (a BAND 8) <> 0 THEN hit = 1
  IF (a BAND 16) <> 0 THEN
    FOR k = 0 TO 2
      IF k = 0 THEN
        row = pY >> 3
      ELSEIF k = 1 THEN
        row = (pY + 8) >> 3
      ELSE
        row = (pY + 15) >> 3
      END IF
      FOR c = l TO r
        IF (TileAttr(c, row) BAND 16) <> 0 THEN LightLamp(c, row)
      NEXT c
    NEXT k
  END IF
  IF nEn = 0 THEN RETURN hit
  FOR k = 0 TO nEn - 1
    ex = eX(k)
    ey = eY(k)
    IF pX < ex + 6 AND ex < pX + 6 AND pY < ey + 13 AND ey < pY + 13 THEN hit = 1
  NEXT k
  RETURN hit
END FUNCTION

' One logic step with input inp. Returns the game state.
FUNCTION GameStep(inp AS UBYTE) AS UBYTE
  IF gState <> S_PLAY THEN RETURN gState
  MovePlayer(inp)
  MoveEnemies()
  IF Touch() <> 0 THEN Die()
  RETURN gState
END FUNCTION

' Hands the sprites and the HUD to the platform layer.
SUB GameDraw()
  DIM f, i AS UBYTE
  IF pClimb <> 0 THEN
    f = F_CLIMB + ((pAnim >> 1) BAND 1)
  ELSEIF pAir <> 0 THEN
    f = 3 + (pFace << 2)
  ELSEIF pMove <> 0 THEN
    f = 1 + ((pAnim >> 1) BAND 1) + (pFace << 2)
  ELSE
    f = pFace << 2
  END IF
  PlatSprite(0, f, pX, pY)
  IF nEn = 0 THEN
    PlatHud(gLit, gTotal, gLives, pRoom)
    RETURN
  END IF
  FOR i = 0 TO nEn - 1
    IF eM(i) <> 0 THEN
      PlatSprite(i + 1, F_ENEMY + ((eTick >> 2) BAND 1), eX(i), eY(i))
      eM(i) = 0
    END IF
  NEXT i
  PlatHud(gLit, gTotal, gLives, pRoom)
END SUB

#endif

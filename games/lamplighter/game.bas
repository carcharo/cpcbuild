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
'   PlatSfx(n)                        1 jump, 2 lamp, 3 death
'
' Units: x in mode-0 pixels 0-159 (the player is 8 wide, moves 2 at a time),
' y in lines 0-183 (16 tall). A room is 20 x 23 cells of 8 x 8 (DESIGN.md).
' The hit box is x+1..x+6 across; rows y, y+8 and y+15 are probed.
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
' the table (TA_TAB, indexed by tile number) is in TileAttr's assembly below

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
DIM gState, gLives, pRoom AS UBYTE
DIM gLit, gTotal, gRoomLamps, gRoomLit AS UBYTE
DIM pX, pY, pAir, pJt, pClimb, pFace, pAnim, pMove AS UBYTE
DIM entX, entY, startC, startR AS UBYTE
' enemies: kind (1 walker, 2 floater, 3 bat), position, direction (1 = right
' or down), counter, start x, start y, range in pixels
DIM nEn AS UBYTE
DIM eK(3) AS UBYTE
DIM eX(3) AS UBYTE
DIM eY(3) AS UBYTE
DIM eD(3) AS UBYTE
DIM eT(3) AS UBYTE
DIM eM(3) AS UBYTE      ' moved (or new) since GameDraw handed it over
DIM eX0(3) AS UBYTE
DIM eY0(3) AS UBYTE
DIM eR(3) AS UBYTE

' ---- the room ------------------------------------------------------------

' The attributes of cell (cx, cy) of the room: TA_TAB(cur(cy * 20 + cx) AND 15).
' Assembly, because the BASIC line is 2,500 T-states a call and a step makes
' ~25 of them (docs/library.md, Performance tips).
FUNCTION TileAttr(cx AS UBYTE, cy AS UBYTE) AS UBYTE
  ASM
  jp TA_GO
TA_TAB:                   ; the attributes of tiles 0-15 (assets/tiles.png)
  defb 0, 1, 2, 4, 8, 16, 0, 1, 0, 0, 0, 0, 6, 0, 0, 0
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

' Reads room id into cur (lit lamps and open doors applied), its start cell
' and its enemies.
SUB LoadRoom(id AS UBYTE)
  DIM base, i, o AS UINTEGER
  DIM n, t AS UBYTE
  base = CAST(UINTEGER, id) * ROOM_SIZE
  FOR i = 0 TO ROOM_SIZE - 1
    cur(i) = rooms(base + i)
  NEXT i
  n = 0
  gRoomLamps = 0
  gRoomLit = 0
  FOR i = 0 TO ROOM_SIZE - 1
    IF cur(i) = T_LAMP THEN
      IF (litMask(id) BAND bitTab(n)) <> 0 THEN
        cur(i) = T_LIT
        gRoomLit = gRoomLit + 1
      END IF
      n = n + 1
      gRoomLamps = gRoomLamps + 1
    END IF
  NEXT i
  IF gRoomLit = gRoomLamps THEN
    FOR i = 0 TO ROOM_SIZE - 1
      IF cur(i) = T_DOOR THEN cur(i) = T_OPEN
    NEXT i
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
  FOR i = 0 TO 3
    IF i < nEn THEN
      eX(i) = eX0(i)
      eY(i) = eY0(i)
      eD(i) = 1
      eT(i) = 0
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
  DIM i AS UINTEGER
  DIM n AS UBYTE
  FOR n = 0 TO 11
    litMask(n) = 0
  NEXT n
  gTotal = 0
  FOR i = 0 TO 12 * ROOM_SIZE - 1
    IF rooms(i) = T_LAMP THEN gTotal = gTotal + 1
  NEXT i
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
  DIM idx, i AS UINTEGER
  DIM n AS UBYTE
  idx = CAST(UINTEGER, cy) * ROOM_W + cx
  n = 0
  FOR i = 0 TO idx - 1
    IF cur(i) = T_LAMP OR cur(i) = T_LIT THEN n = n + 1
  NEXT i
  cur(idx) = T_LIT
  litMask(pRoom) = litMask(pRoom) BOR bitTab(n)
  gRoomLit = gRoomLit + 1
  gLit = gLit + 1
  PlatTile(cx, cy, T_LIT)
  PlatSfx(2)
  IF gRoomLit = gRoomLamps THEN
    FOR i = 0 TO ROOM_SIZE - 1
      IF cur(i) = T_DOOR THEN
        cur(i) = T_OPEN
        PlatTile(CAST(UBYTE, i MOD ROOM_W), CAST(UBYTE, i / ROOM_W), T_OPEN)
      END IF
    NEXT i
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
FUNCTION ColSolid(c AS UBYTE, y AS UBYTE) AS UBYTE
  IF (TileAttr(c, y >> 3) BAND 1) <> 0 THEN RETURN 1
  IF (TileAttr(c, (y + 8) >> 3) BAND 1) <> 0 THEN RETURN 1
  IF (TileAttr(c, (y + 15) >> 3) BAND 1) <> 0 THEN RETURN 1
  RETURN 0
END FUNCTION

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
FUNCTION WalkOK(x AS UBYTE, y AS UBYTE, dir AS UBYTE) AS UBYTE
  DIM c AS UBYTE
  IF dir = 1 THEN c = (x + 7) >> 3 ELSE c = x >> 3
  IF ColSolid(c, y) <> 0 THEN RETURN 0
  IF (TileAttr(c, (y + 16) >> 3) BAND 3) = 0 THEN RETURN 0
  IF (TileAttr(c, (y + 15) >> 3) BAND 8) <> 0 THEN RETURN 0
  RETURN 1
END FUNCTION

' Enemies move two pixels every second step, half of them on each step
' (so the drawing of a step is the player and at most two enemies, which a
' 464 can do at 25 steps a second).
SUB MoveEnemies()
  DIM i, k, nx AS UBYTE
  IF nEn = 0 THEN RETURN
  FOR i = 0 TO nEn - 1
    eT(i) = eT(i) + 1
    eM(i) = 0
    IF ((eT(i) + i) BAND 1) = 0 THEN
      eM(i) = 1
      k = eK(i)
      IF k = 1 THEN
        IF eD(i) = 1 THEN
          IF eX(i) >= 152 THEN
            eD(i) = 0
          ELSE
            nx = eX(i) + 2
            IF WalkOK(nx, eY(i), 1) = 0 THEN eD(i) = 0 ELSE eX(i) = nx
          END IF
        ELSE
          IF eX(i) < 2 THEN
            eD(i) = 1
          ELSE
            nx = eX(i) - 2
            IF WalkOK(nx, eY(i), 0) = 0 THEN eD(i) = 1 ELSE eX(i) = nx
          END IF
        END IF
      ELSEIF k = 2 THEN
        IF eD(i) = 1 THEN
          eY(i) = eY(i) + 2
          IF eY(i) >= eY0(i) + eR(i) THEN eD(i) = 0
        ELSE
          eY(i) = eY(i) - 2
          IF eY(i) <= eY0(i) THEN eD(i) = 1
        END IF
      ELSE
        IF eD(i) = 1 THEN
          eX(i) = eX(i) + 2
          IF eX(i) >= eX0(i) + eR(i) THEN eD(i) = 0
        ELSE
          eX(i) = eX(i) - 2
          IF eX(i) <= eX0(i) THEN eD(i) = 1
        END IF
        eY(i) = eY0(i) + batTab((eT(i) >> 1) BAND 31) - 8
      END IF
    END IF
  NEXT i
END SUB

' Lamps, spikes and enemies against the player; returns 1 on a hit.
FUNCTION Touch() AS UBYTE
  DIM k, c, l, r, row, t, hit, ex, ey AS UBYTE
  l = (pX + 1) >> 3
  r = (pX + 6) >> 3
  hit = 0
  FOR k = 0 TO 2
    IF k = 0 THEN
      row = pY >> 3
    ELSEIF k = 1 THEN
      row = (pY + 8) >> 3
    ELSE
      row = (pY + 15) >> 3
    END IF
    FOR c = l TO r
      t = TileAttr(c, row)
      IF (t BAND 16) <> 0 THEN LightLamp(c, row)
      IF k > 0 AND (t BAND 8) <> 0 THEN hit = 1
    NEXT c
  NEXT k
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
      PlatSprite(i + 1, F_ENEMY + ((eT(i) >> 2) BAND 1), eX(i), eY(i))
      eM(i) = 0
    END IF
  NEXT i
  PlatHud(gLit, gTotal, gLives, pRoom)
END SUB

#endif

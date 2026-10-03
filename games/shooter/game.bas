' ----------------------------------------------------------------
' game.bas -- Starfall's game logic (portable: no platform code)
'
' See DESIGN.md. The logic works in logical units on a 128 x 160
' playfield (sprites 8 x 8, bullets and bombs 1 x 4). All x positions
' handed to PlatSprite are even. It calls only the portable layer's
' PlatSprite and PlatSfx; the caller (main.bas) runs one GameStep per
' logic step, then GameDraw.
'
' Speed and size notes (docs/notes.md): the formation is three row bitmasks
' (bit c = a living enemy in column c) and an origin, so moving it costs
' the same whatever its size and a bullet is tested against the one column
' and rows it is over; bullets, bombs and explosions are small records of
' bytes reached through a pointer (an array element with a variable index
' costs a call to a slow general routine); 8-bit maths; no floats, strings
' or MOD in the step. Unsigned wrap tests: (a - b) < n is "b <= a < b + n".
'
' Sprite kinds of PlatSprite(kind, frame, x, y):
'   0 ship; 1-3 enemy of row 0 (bottom, 10 points), 1 (20), 2 (top, 30),
'   frame 0-1; 4 diver, frame 0-1; 5 player bullet; 6 bomb;
'   7 explosion, frame 0-2.
' ----------------------------------------------------------------

#ifndef __STARFALL_GAME__
#define __STARFALL_GAME__

CONST K_SHIP AS UBYTE = 0
CONST K_ENEMY AS UBYTE = 1            ' + row 0-2
CONST K_DIVER AS UBYTE = 4
CONST K_BULLET AS UBYTE = 5
CONST K_BOMB AS UBYTE = 6
CONST K_EXPL AS UBYTE = 7

' PlatSfx numbers
CONST SFX_SHOOT AS UBYTE = 1
CONST SFX_BOOM AS UBYTE = 2
CONST SFX_HIT AS UBYTE = 3
CONST SFX_WAVE AS UBYTE = 4

' GameStep results (gState)
CONST S_PLAY AS UBYTE = 0
CONST S_DYING AS UBYTE = 1            ' the ship explodes, then the wave restarts
CONST S_CLEAR AS UBYTE = 2            ' a pause after the last enemy
CONST S_OVER AS UBYTE = 3

CONST SHIP_Y AS UBYTE = 152           ' the ship's row (top line)
CONST NEN AS UBYTE = 18               ' enemies: 3 rows of 6
CONST DYING_STEPS AS UBYTE = 30
CONST CLEAR_STEPS AS UBYTE = 25
CONST EXPL_STEPS AS UBYTE = 6
CONST FBIAS AS UBYTE = 96             ' gFxB = formation x + FBIAS (x may be < 0)

DIM gScore, gHi AS UINTEGER
DIM gLives, gWave, gState, gTimer AS UBYTE
DIM gShipX, gFireCd AS UBYTE
DIM gFxB, gFy AS UBYTE                ' formation origin: x of column 0 + 96, y of the top row
DIM gDir, gCount, gMoves, gAlive AS UBYTE   ' gDir: 0 right, 1 left; gMoves: animation frame
DIM gDive, gDvR, gDvC, gDvX, gDvY, gDvPh AS UBYTE   ' the diver: 0 none, 2 diving, 3 returning
DIM gSeed AS UINTEGER

' Formation rows (row 0 at the bottom, 10 points) as column bitmasks
DIM rm(2) AS UBYTE
DIM bl(3) AS UBYTE                    ' player bullets: (x, y) x 2, y = 255 free
DIM bm(5) AS UBYTE                    ' bombs: (x, y) x 3
DIM xp(11) AS UBYTE                   ' explosions: (x, y, timer) x 4, timer 0 free
DIM bitv(5) AS UBYTE => {1, 2, 4, 8, 16, 32}
DIM sway(15) AS UBYTE => {0, 1, 2, 2, 2, 1, 0, 255, 254, 254, 254, 255, 0, 1, 2, 2}

' Seeds the random number generator (one small LCG).
SUB GameSeed(s AS UINTEGER)
  gSeed = s
END SUB

FUNCTION Rand() AS UBYTE
  gSeed = gSeed * 8005 + 1
  RETURN CAST(UBYTE, gSeed >> 8)
END FUNCTION

' 0-5
FUNCTION Rand6() AS UBYTE
  RETURN CAST(UBYTE, (CAST(UINTEGER, Rand()) * 6) >> 8)
END FUNCTION

SUB AddScore(pts AS UBYTE)
  gScore = gScore + pts
  IF gScore > gHi THEN gHi = gScore
END SUB

' An explosion at (x, y), if a slot is free.
SUB Boom(x AS UBYTE, y AS UBYTE)
  DIM i AS UBYTE
  DIM p AS UINTEGER
  p = @xp(0)
  FOR i = 0 TO 3
    IF PEEK(p + 2) = 0 THEN
      POKE p, x
      POKE p + 1, y
      POKE p + 2, EXPL_STEPS
      EXIT FOR
    END IF
    p = p + 3
  NEXT i
END SUB

' Frees every bullet, bomb and explosion.
SUB ClearShots()
  DIM i AS UBYTE
  bl(1) = 255: bl(3) = 255
  bm(1) = 255: bm(3) = 255: bm(5) = 255
  xp(2) = 0: xp(5) = 0: xp(8) = 0: xp(11) = 0
END SUB

' The formation's start for the wave, all enemies alive.
SUB NewWave()
  DIM lv AS UBYTE
  IF gWave > 5 THEN lv = 4 ELSE lv = gWave - 1
  gFxB = 20 + FBIAS
  gFy = 16 + lv * 6
  gDir = 0
  gCount = 0
  gMoves = 0
  gDive = 0
  gAlive = NEN
  rm(0) = 63: rm(1) = 63: rm(2) = 63
  ClearShots()
  gShipX = 60
  gFireCd = 0
END SUB

' A new game: 3 lives, wave 1, score 0 (the high score is kept).
SUB GameInit()
  gScore = 0
  gLives = 3
  gWave = 1
  gState = S_PLAY
  NewWave()
END SUB

' Logic steps between formation moves: fewer enemies and later waves
' are faster. 1 is the fastest.
FUNCTION GameInterval() AS UBYTE
  DIM iv AS UBYTE
  iv = (gAlive + 3) >> 1
  IF iv > gWave THEN
    iv = iv - gWave + 1
  ELSE
    iv = 1
  END IF
  RETURN iv
END FUNCTION

' x of formation column c, y of formation row r.
FUNCTION FormX(c AS UBYTE) AS UBYTE
  RETURN gFxB + (c << 4) - FBIAS
END FUNCTION

FUNCTION FormY(r AS UBYTE) AS UBYTE
  RETURN gFy + (2 - r) * 12
END FUNCTION

' Moves the formation one step sideways, or down at an edge.
SUB FormMove()
  DIM m, c, cmin, cmax AS UBYTE
  m = rm(0) BOR rm(1) BOR rm(2)
  IF gDive <> 0 THEN m = m BOR bitv(gDvC)
  cmin = 5
  cmax = 0
  FOR c = 0 TO 5
    IF (m BAND bitv(c)) <> 0 THEN
      IF c < cmin THEN cmin = c
      cmax = c
    END IF
  NEXT c
  IF (gDir = 0 AND gFxB + (cmax << 4) + 10 > 128 + FBIAS) OR (gDir = 1 AND gFxB + (cmin << 4) < 2 + FBIAS) THEN
    gFy = gFy + 6
    gDir = 1 - gDir
    ' the formation reaches the ship's row
    IF rm(0) <> 0 THEN
      c = 0
    ELSE
      IF rm(1) <> 0 THEN c = 1 ELSE c = 2
    END IF
    IF FormY(c) + 8 >= SHIP_Y THEN gState = S_OVER
  ELSE
    IF gDir = 0 THEN gFxB = gFxB + 2 ELSE gFxB = gFxB - 2
  END IF
  gMoves = gMoves BXOR 1
END SUB

' The ship is hit: a life lost, the explosion and the pause start.
SUB ShipHit()
  gLives = gLives - 1
  gState = S_DYING
  gTimer = DYING_STEPS
  ClearShots()
  PlatSfx(SFX_HIT)
END SUB

' The lowest living enemy of formation column c: its row, or 255.
FUNCTION LowestIn(c AS UBYTE) AS UBYTE
  DIM b AS UBYTE
  b = bitv(c)
  IF (rm(0) BAND b) <> 0 THEN RETURN 0
  IF (rm(1) BAND b) <> 0 THEN RETURN 1
  IF (rm(2) BAND b) <> 0 THEN RETURN 2
  RETURN 255
END FUNCTION

' Player bullet at (x, y): the formation enemy it hits (a hit sets rm and
' returns 1), else 0.
FUNCTION BulletHit(x AS UBYTE, y AS UBYTE) AS UBYTE
  DIM dx, c, r, b, ey AS UBYTE
  dx = x + FBIAS - gFxB
  IF dx >= 96 THEN RETURN 0
  IF (dx BAND 15) >= 8 THEN RETURN 0
  c = dx >> 4
  b = bitv(c)
  FOR r = 0 TO 2
    IF (PEEK(@rm(0) + r) BAND b) <> 0 THEN
      ey = FormY(r)
      IF (y + 3 - ey) < 11 THEN
        POKE @rm(0) + r, PEEK(@rm(0) + r) BAND (63 - b)
        gAlive = gAlive - 1
        AddScore((r + 1) * 10)
        Boom(FormX(c), ey)
        PlatSfx(SFX_BOOM)
        RETURN 1
      END IF
    END IF
  NEXT r
  RETURN 0
END FUNCTION

' One logic step. inp: PlatInput bits (1 left, 2 right, 4 fire).
' Returns the game state.
FUNCTION GameStep(inp AS UBYTE) AS UBYTE
  DIM p AS UINTEGER
  DIM i, j, x, y, tx, ty AS UBYTE

  IF gState = S_OVER THEN RETURN gState

  IF gState = S_DYING THEN
    gTimer = gTimer - 1
    IF gTimer = 0 THEN
      IF gLives = 0 THEN
        gState = S_OVER
      ELSE
        gState = S_PLAY
        gShipX = 60
        gFireCd = 0
        ' a diver goes back to its slot
        IF gDive <> 0 THEN
          rm(gDvR) = rm(gDvR) BOR bitv(gDvC)
          gDive = 0
        END IF
      END IF
    END IF
    RETURN gState
  END IF

  IF gState = S_CLEAR THEN
    gTimer = gTimer - 1
    IF gTimer = 0 THEN
      gWave = gWave + 1
      IF gWave > 99 THEN gWave = 99
      gState = S_PLAY
      NewWave()
    END IF
    RETURN gState
  END IF

  ' --- the ship ---
  x = gShipX
  IF (inp BAND 1) <> 0 THEN
    IF x >= 4 THEN x = x - 4 ELSE x = 0
  END IF
  IF (inp BAND 2) <> 0 THEN
    IF x <= 116 THEN x = x + 4 ELSE x = 120
  END IF
  gShipX = x
  IF gFireCd > 0 THEN gFireCd = gFireCd - 1
  IF (inp BAND 4) <> 0 AND gFireCd = 0 THEN
    p = @bl(0)
    FOR i = 0 TO 1
      IF PEEK(p + 1) = 255 THEN
        POKE p, x + 4
        POKE p + 1, SHIP_Y - 4
        gFireCd = 4
        PlatSfx(SFX_SHOOT)
        EXIT FOR
      END IF
      p = p + 2
    NEXT i
  END IF

  ' --- player bullets: move, then hit the diver or the formation ---
  p = @bl(0)
  FOR i = 0 TO 1
    y = PEEK(p + 1)
    IF y <> 255 THEN
      IF y < 6 THEN
        POKE p + 1, 255
      ELSE
        y = y - 6
        POKE p + 1, y
        x = PEEK(p)
        IF gDive <> 0 THEN
          IF (x - gDvX) < 8 THEN
            IF (y + 3 - gDvY) < 11 THEN
              AddScore(50)
              Boom(gDvX, gDvY)
              PlatSfx(SFX_BOOM)
              gAlive = gAlive - 1
              gDive = 0
              POKE p + 1, 255
            END IF
          END IF
        END IF
        IF PEEK(p + 1) <> 255 THEN
          IF BulletHit(x, y) <> 0 THEN POKE p + 1, 255
        END IF
      END IF
    END IF
    p = p + 2
  NEXT i

  ' --- wave cleared ---
  IF gAlive = 0 THEN
    gState = S_CLEAR
    gTimer = CLEAR_STEPS
    PlatSfx(SFX_WAVE)
    ClearShots()
    RETURN gState
  END IF

  ' --- the formation ---
  gCount = gCount + 1
  IF gCount >= GameInterval() THEN
    gCount = 0
    FormMove()
    IF gState = S_OVER THEN RETURN gState
  END IF

  ' --- the diver ---
  IF gDive = 0 THEN
    IF gWave >= 2 AND gAlive > 1 THEN
      IF (Rand() BAND 63) = 0 THEN
        j = Rand6()
        i = LowestIn(j)
        IF i <> 255 THEN
          rm(i) = rm(i) BAND (63 - bitv(j))
          gDvR = i
          gDvC = j
          gDvX = FormX(j)
          gDvY = FormY(i)
          gDvPh = 0
          gDive = 2
        END IF
      END IF
    END IF
  ELSE
    gDvPh = gDvPh + 1
    x = gDvX
    y = gDvY
    IF gDive = 2 THEN
      y = y + 3
      x = x + sway(gDvPh BAND 15)
      IF (gDvPh BAND 1) = 0 THEN
        IF x < gShipX THEN x = x + 1
        IF x > gShipX THEN x = x - 1
      END IF
      IF x > 200 THEN x = 0
      IF x > 120 THEN x = 120
      x = x BAND 254
      IF y >= 160 THEN
        gDive = 3
        y = 0
      END IF
    ELSE
      ' returning: down to its slot, sideways to its column
      tx = FormX(gDvC)
      ty = FormY(gDvR)
      IF x < tx THEN
        x = x + 2
        IF x > tx THEN x = tx
      END IF
      IF x > tx THEN
        x = x - 2
        IF x < tx THEN x = tx
      END IF
      y = y + 3
      IF y >= ty THEN
        y = ty
        IF x = tx THEN
          rm(gDvR) = rm(gDvR) BOR bitv(gDvC)
          gDive = 0
        END IF
      END IF
    END IF
    gDvX = x
    gDvY = y
    ' the diver hits the ship
    IF gDive <> 0 THEN
      IF (x + 7 - gShipX) < 15 THEN
        IF (y + 7 - SHIP_Y) < 15 THEN
          gDive = 0
          gAlive = gAlive - 1
          AddScore(50)
          Boom(x, y)
          ShipHit()
          RETURN gState
        END IF
      END IF
    END IF
  END IF

  ' --- bombs: drop one now and then, move, hit the ship ---
  p = @bm(0)
  j = 0
  FOR i = 0 TO 2
    IF PEEK(p + 1) <> 255 THEN j = j + 1
    p = p + 2
  NEXT i
  IF j < 3 THEN
    j = gWave + 1
    IF j > 8 THEN j = 8
    IF (Rand() BAND 31) < j THEN
      j = Rand6()
      i = LowestIn(j)
      IF i <> 255 THEN
        p = @bm(0)
        FOR tx = 0 TO 2
          IF PEEK(p + 1) = 255 THEN
            POKE p, FormX(j) + 4
            POKE p + 1, FormY(i) + 8
            EXIT FOR
          END IF
          p = p + 2
        NEXT tx
      END IF
    END IF
  END IF
  p = @bm(0)
  FOR i = 0 TO 2
    y = PEEK(p + 1)
    IF y <> 255 THEN
      y = y + 3
      IF y >= 157 THEN
        POKE p + 1, 255
      ELSE
        POKE p + 1, y
        IF y + 3 > SHIP_Y THEN
          IF (PEEK(p) - gShipX) < 8 THEN
            ShipHit()
            RETURN gState
          END IF
        END IF
      END IF
    END IF
    p = p + 2
  NEXT i

  ' --- explosions ---
  p = @xp(0)
  FOR i = 0 TO 3
    j = PEEK(p + 2)
    IF j > 0 THEN POKE p + 2, j - 1
    p = p + 3
  NEXT i

  RETURN gState
END FUNCTION

' Queues every sprite of the current state (PlatSprite), top to bottom:
' the formation first, then the diver, ship, bullets, bombs, explosions.
SUB GameDraw()
  DIM p AS UINTEGER
  DIM i, k, r, m, x, y, fr AS UBYTE
  fr = gMoves
  FOR k = 0 TO 2
    r = 2 - k
    m = PEEK(@rm(0) + r)
    IF m <> 0 THEN
      x = gFxB - FBIAS
      y = FormY(r)
      FOR i = 0 TO 5
        IF (m BAND 1) <> 0 THEN PlatSprite(K_ENEMY + r, fr, x, y)
        m = m >> 1
        x = x + 16
      NEXT i
    END IF
  NEXT k
  IF gDive <> 0 THEN
    IF gDvY < 153 THEN PlatSprite(K_DIVER, (gDvPh >> 1) BAND 1, gDvX, gDvY)
  END IF
  IF gState = S_DYING THEN
    i = (DYING_STEPS - gTimer) >> 3
    IF i < 3 THEN PlatSprite(K_EXPL, i, gShipX, SHIP_Y)
  ELSE
    IF gState <> S_OVER THEN PlatSprite(K_SHIP, 0, gShipX, SHIP_Y)
  END IF
  p = @bl(0)
  FOR i = 0 TO 1
    y = PEEK(p + 1)
    IF y <> 255 THEN PlatSprite(K_BULLET, 0, PEEK(p), y)
    p = p + 2
  NEXT i
  p = @bm(0)
  FOR i = 0 TO 2
    y = PEEK(p + 1)
    IF y <> 255 THEN PlatSprite(K_BOMB, 0, PEEK(p), y)
    p = p + 2
  NEXT i
  p = @xp(0)
  FOR i = 0 TO 3
    m = PEEK(p + 2)
    IF m > 0 THEN PlatSprite(K_EXPL, (EXPL_STEPS - m) >> 1, PEEK(p), PEEK(p + 1))
    p = p + 3
  NEXT i
END SUB

' The attract mode's player: aims at a column of enemies, fires when lined
' up, and steps away from a bomb coming down on it (never into one).
' Returns PlatInput-style bits (1 left, 2 right, 4 fire).
DIM aiCol, aiN AS UBYTE

' 1 if a bomb low enough to matter is within 12 units of x (the ship's middle).
FUNCTION BombNear(x AS UBYTE, ymin AS UBYTE) AS UBYTE
  DIM p AS UINTEGER
  DIM i AS UBYTE
  p = @bm(0)
  FOR i = 0 TO 2
    IF PEEK(p + 1) <> 255 THEN
      IF PEEK(p + 1) > ymin THEN
        IF (PEEK(p) + 10 - x) < 21 THEN RETURN 1
      END IF
    END IF
    p = p + 2
  NEXT i
  RETURN 0
END FUNCTION

FUNCTION AttractInput() AS UBYTE
  DIM i, tx, sx, r AS UBYTE
  sx = gShipX + 4
  ' a bomb coming down on the ship: away from it, toward the roomier side
  IF BombNear(sx, 80) <> 0 THEN
    IF gShipX <= 8 THEN RETURN 2
    IF gShipX >= 112 THEN RETURN 1
    IF BombNear(sx - 12, 80) = 0 AND BombNear(sx + 12, 80) <> 0 THEN RETURN 1
    IF BombNear(sx + 12, 80) = 0 AND BombNear(sx - 12, 80) <> 0 THEN RETURN 2
    IF gShipX > 60 THEN RETURN 1
    RETURN 2
  END IF
  ' the target column: one with enemies in it, re-picked now and then
  aiN = aiN + 1
  IF (LowestIn(aiCol) = 255) OR (aiN BAND 31) = 0 THEN
    FOR i = 1 TO 6
      aiCol = aiCol + 1
      IF aiCol > 5 THEN aiCol = 0
      IF LowestIn(aiCol) <> 255 THEN EXIT FOR
    NEXT i
  END IF
  tx = FormX(aiCol) + 4
  r = 0
  IF tx + 3 < sx THEN
    r = 1
  ELSE
    IF sx + 3 < tx THEN r = 2 ELSE r = 4
  END IF
  IF (tx + 8 - sx) < 17 THEN r = r BOR 4
  ' don't walk into a bomb
  IF r = 1 THEN
    IF BombNear(sx - 4, 60) <> 0 THEN r = 0
  END IF
  IF r = 2 THEN
    IF BombNear(sx + 4, 60) <> 0 THEN r = 0
  END IF
  RETURN r
END FUNCTION

#endif

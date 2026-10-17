# Chapter 6: Enemies

**Goal.** Fill the rooms with enemies: walkers that patrol platforms, floaters that bob up and
down, and bats that flutter sideways. Touching one sends you back to where you entered the room.

**What you'll learn**

- How a game keeps many things of the same kind without objects: parallel arrays of bytes.
- Reading the map's object layer (the `robj` list from chapter 3).
- Moving some enemies each step instead of all, to save time.
- Redrawing only what changed, and the one overlap rule that keeps it correct.

**Time:** about 50 minutes.

**Before you start.** Chapter 5 is working. This chapter changes `game.bas` and the sprite part of
`platform_cpc.bas`.

---

## Step 1: Meet the enemies

Every enemy is 8 x 16 pixels, the player's size, drawn from frames 10 and 11 of the sprite sheet
(`F_ENEMY`, a two-frame animation). They differ only in how they move:

| Kind | Name | Moves | Uses |
|---|---|---|---|
| 1 | walker | back and forth along the floor; turns at a wall, at the edge of a platform and at spikes | its start position |
| 2 | floater | up and down between its start line and `range` lines below it | start position and range |
| 3 | bat | sideways between its start column and `range` pixels to the right, wobbling up and down by a sine | start position and range |

Enemies move 2 pixels every *second* step (more on that below), so they are half the player's speed.

## Step 2: Put them in the map

Open `assets/tower.tmx` in Tiled (**CPCBuild: Open in Tiled**) and look at the object layer from chapter 3. Every
enemy is an object of class `enemy` (the file stores it as `type="enemy"`) with two integer properties, `kind` (1, 2 or 3) and `range`
(in cells; walkers ignore it, so it is 0).

Room 9's walker is at room cell (17, 20). In the big map that is x = 17 x 8 = **136**,
y = 3 x 184 + 20 x 8 = **712**. Find the object at those coordinates. To add a second one:

1. Select the `objects` layer and insert a rectangle object (Tiled's **Insert Rectangle** tool, `R`).
2. Give it **Class** `enemy`, **width** 8, **height** 16, and position x = 72, y = 712 (cell (9, 20) of room 9).
3. Add custom properties `kind` (int) = 1 and `range` (int) = 0 (the `+` at the bottom of the Properties panel).
4. Save, run `split_rooms.py` as in chapter 3 (it is a script, not a Studio command), build.

The rules the splitter enforces: at most **four enemies** per room (the game has four enemy slots) and
exactly one `start` object.
<!-- CHECK (Tiled UI wording, from memory): Insert Rectangle (R), the Class field and the "+" for custom properties, as in chapter 3. -->

## Step 3: Per-enemy state

The game keeps one array per field (the finished game does not use objects; "an enemy" is index `i`
in all the arrays). Add to the top of `game.bas`:

```basic
CONST F_ENEMY AS UBYTE = 10
```

and, with the other tables:

```basic
' a bat's wobble: 8 + 8 sin
DIM batTab(31) AS UBYTE => {8, 10, 11, 12, 14, 15, 15, 16, 16, 16, 15, 15, 14, 12, 11, 10, 8, 6, 5, 4, 2, 1, 1, 0, 0, 0, 1, 1, 2, 4, 5, 6}
```

(`batTab` is 32 values of `8 + 8 sin`.) Then, after the player's variables:

```basic
DIM entX, entY AS UBYTE
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
```

(`game.bas:63-74`.) Note the separate `DIM` lines: `DIM a(3), b(3) AS UBYTE` does not parse in the
compiler this game was written against (`DESIGN.md`, "As built").

`eX0`, `eY0`, `eR` are where an enemy starts, in pixels, and its range in pixels; `eX`, `eY` where it
is; `eD` its direction (1 = right or down); `eM` is 1 when it moved since `GameDraw` last handed it to
the platform layer; `eTick` counts steps. `entX`, `entY` are where the player entered the room.

## Step 4: Load, reset and die

Replace `FindStart`, `EnterRoom` and `GameInit` with these (`GameInit` is repeated unchanged):

```basic
' Reads room id into cur, and its start cell and its enemies from the object list.
SUB LoadRoom(id AS UBYTE)
  DIM base, i, o AS UINTEGER
  DIM ty AS UBYTE
  base = CAST(UINTEGER, id) * ROOM_SIZE
  FOR i = 0 TO ROOM_SIZE - 1
    cur(i) = rooms(base + i)
  NEXT i
  nEn = 0
  o = roff(id)
  DO
    ty = robj(o)
    IF ty = 0 THEN EXIT DO
    IF ty = 1 THEN
      startC = robj(o + 1)
      startR = robj(o + 2)
    ELSEIF ty = 2 THEN
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

SUB GameInit(room AS UBYTE)
  pAir = 0
  pJt = 0
  pClimb = 0
  pFace = 0
  pAnim = 0
  pMove = 0
  EnterRoom(room, 255, 0)
END SUB

' Back to the point of entry (no lives yet).
SUB Die()
  pX = entX
  pY = entY
  pAir = 0
  pJt = 0
  pClimb = 0
  ResetEnemies()
END SUB
```

- `LoadRoom` reads the object list `robj` (chapter 3) for room `id`: a type 1 record is the start
  cell; a type 2 record is an enemy: kind, start cell and range in cells, which are multiplied by 8
  (`<< 3`) to pixels. **(simplified:** `game.bas:213-255` also finds the room's lamps, chapter 7.)
- `ResetEnemies` puts every enemy back on its start square and hides the unused slots (frame 255: "no
  sprite", chapter 4). Slots 1 to 4 belong to the enemies.
- `Die` is the *whole* of the punishment in this chapter: back to where you entered, enemies reset.
  **(simplified:** lives come in chapter 7.)

## Step 5: Moving the enemies

```basic
' Can a walker stand with its left edge at x, y, having just stepped in
' direction dir (1 right)? No wall in its way, ground under the leading
' edge, no spikes there. (simplified: the game's is assembly)
FUNCTION WalkOK(x AS UBYTE, y AS UBYTE, dir AS UBYTE) AS UBYTE
  DIM c AS UBYTE
  IF dir = 1 THEN c = (x + 7) >> 3 ELSE c = x >> 3
  IF ColSolid(c, y) <> 0 THEN RETURN 0
  IF (TileAttr(c, (y + 15) >> 3) BAND 8) <> 0 THEN RETURN 0
  IF (TileAttr(c, (y + 16) >> 3) BAND 3) = 0 THEN RETURN 0
  RETURN 1
END FUNCTION

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
```

(`WalkOK` is **simplified**: the finished game's is assembly, `game.bas:581-637`, with exactly this logic.
`MoveEnemies` is `game.bas:639-694` unchanged.)

Read `MoveEnemies` from the top.

- `eTick` goes up by one each step. `i = eTick BAND 1`, then the loop visits `i, i + 2, i + 4...`: on one step
  enemies 0 and 2 move, on the next 1 and 3. So each enemy moves every second step and, with four
  enemies, at most two are drawn on any step. The comment above the sub explains why: that is what
  a 464 can draw at 25 steps a second.
- **Walkers** (`k = 1`) go two pixels in their direction. `WalkOK(x, y, dir)` asks of the column in
  front: is it a wall (any of the three body heights solid)? are there spikes at the feet? is there
  ground under it (solid or a platform, `BAND 3`)? If not, turn round and do not move.
- **Floaters** (`k = 2`) move 2 lines and turn when they reach `eY0` or `eY0 + eR`.
- **Bats** (else) move 2 pixels sideways, turning at `eX0` and `eX0 + eR`, and their y follows the sine table:
  `eY0 + batTab(...) - 8`, which is `eY0` plus a value from -8 to +8.

## Step 6: Touching them, and drawing them

Replace `GameStep` and `GameDraw` with these, and put `Touch` before them:

```basic
' Enemies against the player; returns 1 on a hit. (simplified: no lamps or spikes yet)
FUNCTION Touch() AS UBYTE
  DIM k, ex, ey AS UBYTE
  IF nEn = 0 THEN RETURN 0
  FOR k = 0 TO nEn - 1
    ex = eX(k)
    ey = eY(k)
    IF pX < ex + 6 AND ex < pX + 6 AND pY < ey + 13 AND ey < pY + 13 THEN RETURN 1
  NEXT k
  RETURN 0
END FUNCTION

SUB GameStep(inp AS UBYTE)
  MovePlayer(inp)
  MoveEnemies()
  IF Touch() <> 0 THEN Die()
END SUB

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
  IF nEn = 0 THEN RETURN
  FOR i = 0 TO nEn - 1
    IF eM(i) <> 0 THEN
      PlatSprite(i + 1, F_ENEMY + ((eTick >> 2) BAND 1), eX(i), eY(i))
      eM(i) = 0
    END IF
  NEXT i
END SUB
```

`Touch` is a rectangle overlap test between the player and each enemy. The boxes are smaller than
the sprites (6 wide, 13 tall) so a near miss is a miss. In `GameStep`, a touch calls `Die`.

`GameDraw` tells the platform layer about each enemy that moved (`eM(i) <> 0`), in the slot `i + 1`,
with frame `F_ENEMY` plus 0 or 1 (it changes every 4 steps). Enemies that did not move are not
mentioned.

## Step 7: The layer draws only what changed

Chapter 4's layer erased and redrew every sprite every step. With five sprites that is too slow. Change
`platform_cpc.bas` so a sprite is redrawn only when it moved or changed frame. First, more variables, after
the `sOY` line:

```basic
DIM bitOf(4) AS UBYTE => {1, 2, 4, 8, 16}
DIM dMask AS UBYTE       ' bit s: slot s moved or changed since it was drawn
DIM vMask AS UBYTE       ' bit s: slot s is to be shown
DIM sForce AS UBYTE
DIM fT AS UINTEGER                   ' Frames() at the start of this step
```

In `PlatInit`, add `sForce = 0` before `GameMode(1)`. In `PlatRoom`, add the last two lines:

```basic
SUB PlatRoom(addr AS UINTEGER)
  DIM i AS UBYTE
  roomAddr = addr
  SetPalette(@blankPal(0), 16)
  TileMap(addr, 0, 0, 20, 23)
  SetPalette(@tiles_pal(0), 16)
  FOR i = 0 TO 4
    sOF(i) = 255                 ' the room has just covered every sprite
  NEXT i
  sForce = 1                     ' ... so every sprite is drawn again at the next flush
  dMask = 0
END SUB
```

Then replace `PlatSprite` and `PlatFrameEnd` with these, including the new `Overlap` and `PlatFlush`:

```basic
' Sprite slot s shows frame f at pixel x, line y at the next flush.
SUB PlatSprite(s AS UBYTE, f AS UBYTE, x AS UBYTE, y AS UBYTE)
  DIM bit AS UBYTE
  bit = bitOf(s)
  sNF(s) = f
  sNX(s) = x
  sNY(s) = y
  IF f = 255 THEN vMask = vMask BAND (255 - bit) ELSE vMask = vMask BOR bit
  IF f <> sOF(s) OR x <> sOX(s) OR y <> sOY(s) THEN dMask = dMask BOR bit
END SUB

' x/y rectangles (8 x 16) of two sprites overlap?
FUNCTION Overlap(x1 AS UBYTE, y1 AS UBYTE, x2 AS UBYTE, y2 AS UBYTE) AS UBYTE
  IF x1 + 8 <= x2 OR x2 + 8 <= x1 THEN RETURN 0
  IF y1 + 16 <= y2 OR y2 + 16 <= y1 THEN RETURN 0
  RETURN 1
END FUNCTION

' Erases and redraws the sprites that moved (or changed frame), and the
' player if one of them is over it.
SUB PlatFlush()
  DIM s, t, bit AS UBYTE
  IF sForce <> 0 THEN
    dMask = vMask
    FOR s = 0 TO NSLOT - 1
      IF sOF(s) <> 255 THEN dMask = dMask BOR bitOf(s)
    NEXT s
    sForce = 0
  END IF
  IF dMask = 0 THEN RETURN
  ' The player standing still, with a moved enemy over it: redraw it. (An enemy
  ' standing still under another one that moves is only chewed for a step: it
  ' moves on the next. Checking every pair costs ~30,000 T-states a step.)
  IF (dMask BAND 1) = 0 AND (vMask BAND 1) <> 0 THEN
    FOR t = 1 TO NSLOT - 1
      IF (dMask BAND bitOf(t)) <> 0 THEN
        IF Overlap(sNX(0), sNY(0), sNX(t), sNY(t)) <> 0 THEN
          dMask = dMask BOR 1
        ELSEIF sOF(t) <> 255 THEN
          IF Overlap(sNX(0), sNY(0), sOX(t), sOY(t)) <> 0 THEN dMask = dMask BOR 1
        END IF
      END IF
    NEXT t
  END IF
  bit = 1
  FOR s = 0 TO NSLOT - 1
    IF (dMask BAND bit) <> 0 THEN
      IF sOF(s) <> 255 THEN TileRestore(roomAddr, 20, sOX(s) >> 1, sOY(s), 4, 16)
    END IF
    bit = bit + bit
  NEXT s
  bit = 1
  FOR s = 0 TO NSLOT - 1
    IF (dMask BAND bit) <> 0 THEN
      IF sNF(s) <> 255 THEN
        PutSpriteMasked(sNX(s) >> 1, sNY(s), 4, 16, @sprites(CAST(UINTEGER, sNF(s)) << 7))
      END IF
      sOF(s) = sNF(s)
      sOX(s) = sNX(s)
      sOY(s) = sNY(s)
    END IF
    bit = bit + bit
  NEXT s
  dMask = 0
END SUB

' End of a step: wait until two frames have passed since the last one (25
' steps a second), then draw what GameDraw handed over.
SUB PlatFrameEnd()
  DO WHILE CAST(UINTEGER, Frames()) - fT < 2
  LOOP
  fT = CAST(UINTEGER, Frames())
  PlatFlush()
END SUB
```

(`platform_cpc.bas:161-224` and `303-316`; the `PlatFrameEnd` here leaves out the build switches
(`NOPACE`, `NOFLUSH`, `LAMP_PLUS`) of the real one.)

How it works:

- `PlatSprite` records the wish and sets that slot's bit in `dMask` ("dirty") only if the frame or
  position differs from what is on the screen. It also keeps `vMask`, the slots that should be visible.
- `PlatFlush` erases (`TileRestore`) and redraws only the dirty slots. `sForce` is set by a new room
  (everything gets redrawn).
- **The overlap rule.** Erasing an enemy's old rectangle with `TileRestore` repaints background
  tiles, which also wipes out any part of the player drawn in that rectangle. So if the player is
  *not* dirty but a dirty enemy's old or new rectangle overlaps him, the player is marked dirty and
  redrawn. The comment in the source is honest about the limit: "An enemy standing still under another
  one that moves is only chewed for a step: it moves on the next. Checking every pair costs
  ~30,000 T-states a step."

## Build and run

**CPCBuild: Build and Run**. In room 9 a purple walker patrols the strip of floor between the spikes and the
door, turning back at each. Walk into it and you are back at the start, with the enemy back at its start.
Go through rooms and meet floaters and bats (the finished game has them in rooms 0, 1, 3, 5, 8 and 10).
To visit them quickly, change `GameInit(9)` to another room (rooms 0, 5, 6 and 11 have no door; the
others will keep you in until chapter 7). The finished game's
[room 9 picture](../../games/lamplighter/tests/golden/464/room09.png) shows the walker.

If enemies leave trails, check `sOF(s) = sNF(s)` in `PlatFlush` ran for every dirty slot. If the player
vanishes when an enemy walks past, the overlap test is missing.

## How it works

**Why parallel arrays, and why bytes.** The library's **Performance tips** ("Array indexing") say an
array access with a variable index costs a few hundred T-states, and that pointer-based records are
faster; the game keeps simple arrays because there are few enemies and a step visits only two of
them. (`DESIGN.md` records "an array access ~350 T".) The finished game keeps everything `UBYTE`.

**Half the enemies each step.** Before this change the finished game visited every enemy every step,
about 33,000 T-states; with `eTick` it visits half (`DESIGN.md`, "As built", section 12).
Drawing is the other cost: one moved sprite is about 26,000 T-states (chapter 4), so
five moved sprites would need about 130,000 of the 160,000 T-states that two frames hold. Moving
only half the enemies, and only redrawing what moved, is what keeps the 464 at 25 steps a second.

**`TileRestore` for erasing.** You met it in chapter 4 (library: **Tiles**). Here is what changes:
it is now only called for slots that moved.

## Try this

1. Add a walker in a room without enemies (room 6 has none): pick a flat stretch of floor and work out
   the pixel position as in step 2. Does it turn at the right places?
2. Give a bat a larger `range` in Tiled. How far does it go? What stops a bat from flying through
   walls? (Nothing: bats ignore tiles; look at their code.)
3. Make enemies move on every step by removing the `i + 2` stepping (start `i` at 0 and add 1). What
   happens to the game speed with four enemies in a room? Put a counter in your head for chapter 9.
4. Add a new kind 4: a "chaser" that moves one step toward the player's x. Which arrays, tables and
   tests change?
5. Change `Die` so it does not reset the enemies. Is the game easier or harder?

## What you have now

Rooms with moving enemies, a death rule and a cheap way to draw. Next:
[Chapter 7, Lamps, doors, lives and the HUD](07-lamps-doors-lives-hud.md).

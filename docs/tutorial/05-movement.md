# Chapter 5: Movement

**Goal.** Make the lamplighter a player: he falls under gravity, walks without passing through
walls, jumps in a fixed arc, lands on platforms, climbs ladders, and flips between rooms by walking
or climbing off an edge.

**What you'll learn**

- Tile attributes: giving each tile a meaning with a 16-byte table.
- The hit box and the probe points the game checks.
- A jump as a table of speeds, and how to stop a `UBYTE` wrapping when you go off the top.
- One-way platforms and ladders.
- How rooms are linked by the edges.

**Time:** about 60 minutes. This is the longest chapter: most of the game's rules are here.

**Before you start.** Chapter 4 is working. This chapter changes `src/game.bas` (the movement
functions are copied from the finished game; the ones marked simplified are cut down) and adds
one empty sub to `src/platform_cpc.bas`.

---

## Step 1: Decide what tiles mean

The picture of a tile and what it *does* are separate. A 16-entry table maps tile number to
**attribute bits**:

| Bit | Value | Meaning |
|---|---|---|
| 0 | 1 | solid: you cannot walk into it |
| 1 | 2 | one-way platform: you can jump up through it, but stand on it |
| 2 | 4 | ladder |
| 3 | 8 | hazard (spikes) |
| 4 | 16 | lamp |

And the table, indexed by tile number:

```basic
DIM taTab(15) AS UBYTE => {0, 1, 2, 4, 8, 16, 0, 1, 0, 0, 0, 0, 6, 0, 0, 0}
```

Read it along the tile list from chapter 2: tile 1 (brick) is solid; 2 (platform) one-way; 3 (ladder)
a ladder; 4 (spikes) hazard; 5 (the unlit lamp) a lamp; 7 (the closed door) solid; and **12, the
ladder top, is `6` = one-way platform plus ladder**: you can stand on the ledge and also climb
down the ladder under it. Tile 6 (lit lamp), 8 (open door), 9 (heart), 10 (window) and 11 (wall)
have no attributes: they are scenery.

(`game.bas:43-44, 85`, where the real table sits inside an assembly routine.)

## Step 2: Constants, tables and variables

Replace `src/game.bas` piece by piece. First the top of the file:

```basic
' game.bas -- the game logic: no drawing, only calls into the platform layer.
#include once "assets/rooms.bas"

' input bits
CONST I_LEFT AS UBYTE = 1
CONST I_RIGHT AS UBYTE = 2
CONST I_FIRE AS UBYTE = 4
CONST I_ANY AS UBYTE = 8
CONST I_UP AS UBYTE = 16
CONST I_DOWN AS UBYTE = 32

' sprite frames: 0-3 right (stand, walk, walk, jump), 4-7 left, 8-9 climb
CONST F_CLIMB AS UBYTE = 8

' the jump: dy per step (rising, then falling; the last repeats)
DIM jtab(16) AS BYTE => {-5, -4, -4, -3, -3, -2, -2, -1, -1, 0, 1, 1, 2, 2, 3, 3, 4}

' What each tile does, indexed by tile number: 1 solid, 2 one-way platform,
' 4 ladder, 8 hazard, 16 lamp.
DIM taTab(15) AS UBYTE => {0, 1, 2, 4, 8, 16, 0, 1, 0, 0, 0, 0, 6, 0, 0, 0}

DIM cur(459) AS UBYTE                 ' the current room's tiles
DIM pRoom AS UBYTE
DIM pX, pY, pAir, pJt, pClimb, pFace, pAnim, pMove AS UBYTE
DIM startC, startR AS UBYTE
```

- `I_LEFT` ... `I_DOWN` are the bits `PlatInput` returns (chapter 3).
- `jtab` is the **jump**: how many lines the player moves vertically on each step of a jump,
  negative = up. Step by step he rises 5, 4, 4, 3, 3, 2, 2, 1, 1 lines (25 in all), stays put for one
  step (0), then falls 1, 1, 2, 2, 3, 3, 4 and keeps falling at 4 (the last value repeats). It is a
  `BYTE`, signed, so it can hold negative numbers.
- `pAir` is 1 while in the air; `pJt` is the player's place in `jtab`; `pClimb` is 1 on a ladder;
  `pFace` 0 right or 1 left; `pAnim` counts walking steps; `pMove` is 1 on a step in which he walked.
- Everything is `UBYTE` to stay fast; positions are `pX` in pixels (0 to 159, always even) and `pY`
  in lines (0 to 183).

## Step 3: Look up what is in a cell

```basic
' The attributes of cell (cx, cy) of the room.
FUNCTION TileAttr(cx AS UBYTE, cy AS UBYTE) AS UBYTE
  RETURN taTab(cur(CAST(UINTEGER, cy) * ROOM_W + cx) BAND 15)
END FUNCTION

' Solid cell in column c over the body's rows (y, y+8, y+15)?
FUNCTION ColSolid(c AS UBYTE, y AS UBYTE) AS UBYTE
  IF (TileAttr(c, y >> 3) BAND 1) <> 0 THEN RETURN 1
  IF (TileAttr(c, (y + 8) >> 3) BAND 1) <> 0 THEN RETURN 1
  RETURN TileAttr(c, (y + 15) >> 3) BAND 1
END FUNCTION
```

`TileAttr(cx, cy)` is the attribute byte of cell (cx, cy) of the current room. `ColSolid(c, y)` asks:
is column `c` solid at any of the three heights `y`, `y + 8`, `y + 15`? Those are the **probe points**
of the body: the player is 8 pixels wide and 16 lines tall, so his head, middle and feet are at lines
`y`, `y + 8` and `y + 15`. Across, his **hit box** is `x + 1` to `x + 6`, one pixel narrower than the
sprite on each side, so he fits through gaps a cell wide.

**(simplified.)** The finished game writes `TileAttr` and `ColSolid` in Z80 assembly
(`game.bas:81-134, 358-391`). In BASIC `TileAttr` costs about 2,500 T-states a call, and a step makes
about 25 of them; chapter 9 shows the measurements and why the real file does it in assembly. The
BASIC version here is the same logic, a little slower: on a 464 it may make a step take
longer than two frames at first. That is fine for learning.

## Step 4: Entering a room, and starting a game

```basic
' Finds the room's start cell in the object list (record type 1).
SUB FindStart(id AS UBYTE)
  DIM o AS UINTEGER
  o = roff(id)
  DO WHILE robj(o) <> 0
    IF robj(o) = 1 THEN
      startC = robj(o + 1)
      startR = robj(o + 2)
    END IF
    o = o + 5
  LOOP
END SUB

' Enters room id with the player's top left at (x, y); x = 255: its start cell.
SUB EnterRoom(id AS UBYTE, x AS UBYTE, y AS UBYTE)
  DIM base, i AS UINTEGER
  pRoom = id
  base = CAST(UINTEGER, id) * ROOM_SIZE
  FOR i = 0 TO ROOM_SIZE - 1
    cur(i) = rooms(base + i)
  NEXT i
  FindStart(id)
  IF x = 255 THEN
    x = startC << 3
    y = startR << 3
  END IF
  pX = x
  pY = y
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
```

`EnterRoom(id, x, y)` puts the player at `(x, y)` in room `id`. Passing `x = 255` means "at this
room's start cell". When you leave a room by an edge you arrive at the opposite edge at the same
height; the next steps do that.

## Step 5: Standing, walking, falling

```basic
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

```

`RowAttr(y)` is the attributes of the two cells under the hit box columns (`x + 1` and `x + 6`) at line
`y`. `Ground()` asks whether the player is standing on something:

- At `pY >= 168` he is on the bottom line of the screen: in rooms 9 to 11 that is the tower's
  floor (`RETURN 1`); in the other rooms it is a gap to the room below (`RETURN 0`).
- If his feet (`pY + 16`) are not exactly on a cell boundary (`BAND 7` is non-zero) he cannot be
  standing on a tile.
- Otherwise look at the row under his feet: solid (1) or one-way platform (2) holds him up (`BAND 3`).

`MoveX(dir)` takes one step sideways (2 pixels). Three things happen:

1. At the left edge (`pX < 2`), if the room has a neighbour on the left (`pRoom MOD 3 > 0`) you enter
   it at `x = 152`, the far right; otherwise you stop. The right edge is the same, with `pRoom MOD 3 < 2`.
2. Otherwise compute the new x (`nx`) and ask `ColSolid` about the column *in front*: the left edge
   of the hit box going left, the right edge going right. A solid column stops the step.
3. Otherwise `pX = nx`.

## Step 6: Jumping and falling

```basic
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
```

Each step in the air, `MoveY` reads `dy = jtab(pJt)` and advances `pJt` (stopping at 16).

**Rising (`dy < 0`).** The new y is computed as an `INTEGER`, not a `UBYTE`: if he is near the top
a `UBYTE` would wrap from 2 minus 5 to 253 and he would appear at the bottom. If `ny < 0`
he leaves through the top of the room (to the room above, if there is one, at `y = 168`, otherwise
he is stopped and starts falling). Otherwise `RowAttr(ny)` looks at what his head would touch: if
it is solid he bumps his head, is put just below that cell, and `pJt = 10` makes him start falling
(`jtab(10)` is the first positive entry). A one-way platform does not stop him going up.

**Falling (`dy > 0`).** `nb` is the line his feet would reach. If that is the bottom of the room he
falls into the room below (or, in rooms 9 to 11, lands on the floor). Otherwise look at the cell under his
feet: if it is solid, **or it is a one-way platform and his feet were above it before this step**
(`((pY + 15) >> 3) < row`), he lands: `pY` is set so his feet sit exactly on the cell, `pAir = 0`.
That last test is what makes a platform one-way: from below, his feet start below the platform's row,
so the test fails and he passes through.

## Step 7: Ladders

```basic
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
```

On a ladder he is in a different mode (`pClimb = 1`): gravity is off, up and down move him
2 lines a step, left and right do nothing, and fire jumps off (`PlatSfx(1)` is the jump sound; it does
nothing until chapter 8). `StartClimb` snaps him to the ladder's column (`pX = cx << 3`) so his body
lines up with it. When his body is no longer over a ladder tile (attribute 4) he falls (`pAir = 1`,
`pJt = 10`). Climbing off the top or bottom of a room goes to the next room, as walking does.

## Step 8: Put it together

```basic
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
```

`MovePlayer` is one step of player logic:

1. On a ladder, `ClimbStep` does everything.
2. Pressing up when his body is over a ladder tile starts a climb. Pressing down while standing
   *on top of* a ladder (the tile under his feet has the ladder bit) starts a climb too: that
   is why the ladder-top tile (12) has attributes 6.
3. Otherwise walk: left and right, setting `pFace` and `pMove`.
4. If on the ground: fire jumps (`pAir = 1`, `pJt = 0`, jump sound); if not on the ground (he walked off
   a ledge) he starts falling at the first falling step (`pJt = 10`).
5. If in the air, `MoveY()`.

Finally the glue and the game loop:

```basic
SUB GameStep(inp AS UBYTE)
  MovePlayer(inp)
END SUB

SUB GameDraw()
  DIM f AS UBYTE
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
END SUB

PlatInit()
GameInit(9)
DO
  GameStep(PlatInput())
  GameDraw()
  PlatFrameEnd()
LOOP UNTIL PlatQuit()
```

`GameDraw` chooses the frame: climbing frames 8 and 9, the jump frame 3 (+4 facing left) in the air,
walking frames 1 and 2, otherwise standing. `GameInit(9)` is the start of a game in the cellar.

The platform layer needs the sound hook that `MovePlayer` calls, as an empty sub for now. Add
to `src/platform_cpc.bas`, before `PlatText`:

```basic
' Sound effects: chapter 8 fills this in.
SUB PlatSfx(n AS UBYTE)
END SUB
```

(`GameInit` and `EnterRoom` are simplified from `game.bas:274-312`; the finished game also resets enemies and lamps there.)

## Build and run

**CPCBuild: Build and Run**. You are in room 9, standing on the floor at the left end. Walk with `O` and
`P` (or the cursor keys). Press `Space` to jump: he rises 25 lines and comes down. He can no longer
walk through walls or the floor.

Try these, in this order:

1. **Jump onto the central ledge** of room 9: it is a one-way platform. Jump from below it and he
   passes through; land on it and he stays. Walk off its end and he falls.
2. **Spikes** do not hurt yet: they are not solid, so he stands in them (chapter 7).
3. **The door** at the right end of room 9 is solid: he cannot pass it. (Doors open when the room's lamps
   are lit: chapter 7. Lamps do nothing yet.)
4. **Ladders and room changes.** In `game.bas` change the last lines to `GameInit(11)` and rebuild.
   Room 11 (the boiler room) has no door, and a ladder up to room 8. Climb it with `Q` (up) and `A`
   (down) and walk off the top of the screen: you arrive at the bottom of room 8, at the same x.
   Walk off the left or right edge of a room that has a neighbour and you flip to it.

The finished game's [ladder picture](../../games/lamplighter/tests/golden/464/climb.png) shows the
player climbing in room 10.

If he falls through the floor, check `pY >= 168` in `Ground` and that `pRoom` is 9 or more. If the
game seems slow, see the note in step 3; chapter 9 explains how to measure it.

## How it works

There are no new library calls in this chapter: it is all plain Boriel BASIC. The things worth
learning are in the code:

- **Types.** `UBYTE` is fast but wraps at 255 and 0. Every place where a value might go off the
  end (the top of the room, an array index of 460 or more) the code widens first with
  `CAST(INTEGER, ...)` or `CAST(UINTEGER, ...)`. The library's **Performance tips** section
  ("Arithmetic") says: prefer shifts and 8-bit variables to divisions in inner loops. That is why
  the code writes `>> 3` for "divide by 8" and `<< 3` for "multiply by 8".
- **`BAND` and `BOR`.** `AND`/`OR` are logical in Boriel BASIC; for bits you must use `BAND`/`BOR`.
  Writing `(a AND 1)` for a bit test is a classic bug.
- **Integer arrays.** `jtab(pJt)` and `taTab(...)` are arrays; every access with a variable index
  costs a few hundred T-states (**Performance tips**, "Array indexing"). Fine here.
- **Fixed arcs.** The jump is not physics: it is a table, and so it is the same every time. That
  makes the game deterministic, and it is what allowed the finished game to prove every lamp
  reachable by exhaustive search (`tests/reach.py`, `DESIGN.md` section 12).

## Try this

1. Change `jtab` to make the jump higher (make the first numbers bigger). Which ledges become
   reachable? Which become *too easy*?
2. Make the platform tile solid: change `taTab`'s third entry from `2` to `1`. What changes?
3. Let the player move 4 pixels a step on the ground. What breaks? (Look at the sprite frames and at
   `ColSolid`'s test column.)
4. Add a coyote-time rule: allow a jump for 2 steps after walking off a ledge. Where would you put the counter?
5. In Tiled, make a new room layout in room 9 with a ladder at the far left. Re-split (chapter 3).
   Can you climb it?

## What you have now

A player who obeys the tower's physics. Next: [Chapter 6, Enemies](06-enemies.md).

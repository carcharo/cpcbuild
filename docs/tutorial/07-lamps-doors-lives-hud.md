# Chapter 7: Lamps, doors, lives and the HUD

**Goal.** Turn the toy into a game: touching a lamp lights it, lighting a room's lamps opens its
doors, spikes and enemies cost lives, a status bar shows how you are doing, and there is a title,
a win and a game over.

**What you'll learn**

- Keeping game state in a few small tables, and finding the lamps by scanning the map (no objects).
- Remembering what you did in a room after you leave it.
- Changing one tile on the screen while the game is running.
- A HUD that redraws only the part that changed.
- The shape of the main loop: title, play, game over.

**Time:** about 60 minutes.

**Before you start.** Chapter 6 is working. This chapter changes `game.bas` and `platform_cpc.bas`
and replaces `main.bas`.

---

## Step 1: The rules

- Each room has one to three unlit lamps (tile 5). Walk into one and it becomes a lit lamp (tile 6).
- When every lamp in a room is lit, the room's doors (tile 7, solid) become open doors (tile 8, not
  solid). Leave a room and come back and it is as you left it.
- You have three lives. Touching spikes or an enemy costs one and sends you back to where you
  entered the room. No lives left: game over.
- Light all 28 lamps and you win. (Rooms 0, 5, 6 and 11 have no doors: 5, 6 and 11 are the
  ladders up; 0 is the top.)

The map decides all of this. The table below is what `tower.tmx` holds (counted from the map; the
code you are about to write finds the lamps itself):

| Room | Name | Lamps | Enemies |
|---|---|---|---|
| 9 | THE CELLAR | 2 | walker |
| 10 | COLD STORE | 3 | floater |
| 11 | BOILER ROOM | 2 | walker |
| 8 | SERVANTS WAY | 2 | bat |
| 7 | TOWER HALL | 3 | walker |
| 6 | OLD LIBRARY | 2 | none |
| 3 | GLASS GALLERY | 2 | bat |
| 4 | THE ARCHIVE | 3 | walker |
| 5 | WEST STAIR | 2 | floater |
| 2 | CLOCK LOFT | 2 | walker |
| 1 | ATTIC STORE | 2 | bat |
| 0 | THE BELFRY | 3 | walker and floater |

(In the order you climb them. 3 + 2 + 2 + 2 + 3 + 2 + 2 + 3 + 2 + 2 + 2 + 3 = 28.)

## Step 2: State

At the top of `game.bas`, after `#include once "assets/rooms.bas"`:

```basic
CONST S_PLAY AS UBYTE = 0
CONST S_OVER AS UBYTE = 1
CONST S_WON AS UBYTE = 2
```

`GameStep` will return one of these. And the tile numbers the code needs to know by name:

```basic
' tile numbers (assets/tiles.png) and the attribute bits of each
CONST T_BRICK AS UBYTE = 1
CONST T_LAMP AS UBYTE = 5
CONST T_LIT AS UBYTE = 6
CONST T_DOOR AS UBYTE = 7
CONST T_OPEN AS UBYTE = 8
' (what each tile does is in taTab, below)
```

In the variables, add (and remove the old `DIM pRoom` if you have one):

```basic
DIM bitTab(7) AS UBYTE => {1, 2, 4, 8, 16, 32, 64, 128}
DIM cur(459) AS UBYTE                 ' the current room's tiles
DIM litMask(11) AS UBYTE              ' lit lamps of each room, one bit per lamp
DIM gState, gLives, pRoom AS UBYTE
DIM gLit, gTotal, gRoomLamps, gRoomLit AS UBYTE
DIM pX, pY, pAir, pJt, pClimb, pFace, pAnim, pMove AS UBYTE
DIM startC, startR AS UBYTE
DIM entX, entY AS UBYTE
```

- `litMask(room)` has one bit per lamp in that room (a room has at most three, so a byte is plenty):
  bit *n* is 1 when the room's *n*th lamp is lit. This is the game's whole memory of what you did.
- `gLit` and `gTotal`: lamps lit in the tower, and lamps in the tower. `gRoomLit` and `gRoomLamps`:
  the same for the current room.
- `gLives`, `gState` (`S_PLAY`, `S_OVER` or `S_WON`).

## Step 3: Loading a room with its history

Replace `LoadRoom` with the finished game's:

```basic
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

```

(The finished `LoadRoom`, `game.bas:361-400`, is a little different: it hands the block copy and the
lamp and door scan to two routines, `CopyRoom` and `ScanRoom`. The loops above are their plain BASIC
logic, and the finished file has them as BASIC under `#ifdef LAMP_BASIC` (`game.bas:261-266` and
`284-299`), next to the faster assembly ones the game uses by default (`game.bas:268-276` and
`301-356`; chapter 9).) Now `LoadRoom` does the whole job:

1. Copies the room into `cur`.
2. **Scans for lamps.** Every cell holding tile 5 (`T_LAMP`) is a lamp. Lamps are numbered 0, 1, 2 in
   reading order (`n`). If `litMask` says lamp *n* is lit, the tile is changed to a lit lamp (`T_LIT`).
   There are no lamp objects in the map: the *tiles* are the lamps.
3. If every lamp is lit (`gRoomLit = gRoomLamps`), turns every door tile into an open door.
4. Reads the objects (start and enemies) as in chapter 6.

## Step 4: Starting, lighting, dying

Replace `GameInit` and `Die`, and add `LightLamp` between them:

```basic
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
        PlatSfx(4)
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
```

- `GameInit` clears `litMask`, **counts the lamps in the whole tower** by scanning the `rooms`
  array for tile 5 (that is how it knows there are 28), and starts a game: three lives, state `S_PLAY`.
- `LightLamp(cx, cy)` works out which lamp number this cell is (counting lamps before it in the
  room: `n`), sets the tile to lit in `cur`, sets bit `n` of `litMask(pRoom)`, adds one to the counters,
  and asks the platform to redraw that one cell with `PlatTile`. If the room is done it changes
  every door tile to an open door, in `cur` *and* on the screen, and plays the door sound (chapter 8's
  `PlatSfx(4)`). If that was the 28th lamp the state becomes `S_WON`.
- `Die` takes a life and plays the death sound (`PlatSfx(3)`); at zero lives the state is `S_OVER`;
  otherwise it puts the player back where he entered, and resets the enemies.

(`game.bas:457-497`, unchanged.)

## Step 5: Touching things

```basic
' Lamps, spikes and enemies against the player; returns 1 on a hit.
' (the game's checks the tiles in one call, TouchAttr)
FUNCTION Touch() AS UBYTE
  DIM k, c, l, r, row, hit, ex, ey, a AS UBYTE
  l = (pX + 1) >> 3
  r = (pX + 6) >> 3
  hit = 0
  FOR k = 0 TO 2                      ' the body is probed at y, y + 8 and y + 15
    IF k = 0 THEN
      row = pY >> 3
    ELSEIF k = 1 THEN
      row = (pY + 8) >> 3
    ELSE
      row = (pY + 15) >> 3
    END IF
    FOR c = l TO r
      a = TileAttr(c, row)
      IF (a BAND 16) <> 0 THEN LightLamp(c, row)
      IF k > 0 AND (a BAND 8) <> 0 THEN hit = 1    ' spikes: the lower two rows only
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
```

- `Touch` probes the body at lines `y`, `y + 8` and `y + 15` (as in chapter 5), and for every cell
  under the hit box (`l` to `r`): a lamp tile lights it, and spikes (hazard) hurt only if they are in the
  lower two rows. Then the enemies, as in chapter 6. The finished game does the
  tile part in a single call, `TouchAttr`, which ORs the attributes of the cells in the same way. Its
  plain BASIC version is under `#ifdef LAMP_BASIC` (`game.bas:163-182`), next to the faster
  assembly one the game uses by default (`game.bas:184-252`, chapter 9); `Touch` itself is
  `game.bas:862-890`.
- `GameStep` now returns the state and does nothing once the game is over.
- `GameDraw` also calls `PlatHud` with the numbers to show.

Remove the loop at the bottom of `game.bas` (`PlatInit()`, `GameInit(9)`, the `DO` loop): it
moves to `main.bas`, next.

## Step 6: The platform layer: tiles, HUD, clearing

In `platform_cpc.bas` add the HUD's state variables after the `sForce` line:

```basic
DIM hLit, hTot, hLives, hRoom AS UBYTE
```

In `PlatInit` add `hLit = 255` before `GameMode(1)`, and in `PlatRoom` the `hLit = 255` line shown below (it
means "draw the whole HUD again"). Change `DIM blankPal(15)` to `DIM blankPal(459)`: the title
screen uses the array as a map of 460 zeros to restore against.

```basic
' Draws a room: the screen is blanked (all pens black) while the tiles go
' down, then the palette comes back.
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
  hLit = 255                     ' and the HUD too
END SUB
```

Now add these four subs after `PlatRoom`:

```basic
' One cell changed. The tile may have covered part of a sprite: all are
' redrawn at the next flush.
SUB PlatTile(cx AS UBYTE, cy AS UBYTE, t AS UBYTE)
  DoTile8(cx, cy, t)
  sForce = 1
END SUB

' A tile at cell (cx, cy), outside the game's map (the title's lamps).
SUB PlatTileRaw(cx AS UBYTE, cy AS UBYTE, t AS UBYTE)
  DoTile8(cx, cy, t)
END SUB

' Hearts and numbers where they changed; the room name when the room did.
SUB PlatHud(lit AS UBYTE, total AS UBYTE, lives AS UBYTE, room AS UBYTE)
  DIM i AS UBYTE
  IF hLit = 255 THEN
    ' the whole HUD
    TextAt(0, 23, "LAMPS")
    TextAt(9, 23, "OF")
    hTot = 255
    hLives = 255
    hRoom = 255
    hLit = 254
  END IF
  IF lit <> hLit THEN
    hLit = lit
    TextAt(6, 23, CHR$(48 + lit / 10))
    TextAt(7, 23, CHR$(48 + lit MOD 10))
  END IF
  IF total <> hTot THEN
    hTot = total
    TextAt(12, 23, CHR$(48 + total / 10))
    TextAt(13, 23, CHR$(48 + total MOD 10))
  END IF
  IF lives <> hLives THEN
    hLives = lives
    FOR i = 0 TO 2
      IF lives > i THEN DoTile8(17 + i, 23, 9) ELSE DoTile8(17 + i, 23, 0)
    NEXT i
  END IF
  IF room <> hRoom THEN
    hRoom = room
    TextAt(0, 24, RoomName(room) + "                    ")
  END IF
END SUB

' Blanks the whole screen and forgets the sprites and the HUD.
SUB PlatClear()
  DIM i AS UBYTE
  ClearScreen(0)
  roomAddr = @blankPal(0)
  FOR i = 0 TO 4
    sNF(i) = 255
    sOF(i) = 255
  NEXT i
  sForce = 0
  dMask = 0
  vMask = 0
  hLit = 255
END SUB
```

(`platform_cpc.bas:147-157, 228-260, 267-280`.)

- `PlatTile` draws one cell and sets `sForce`, so every sprite is redrawn at the next flush (the new
  tile may have covered part of one).
- `PlatTileRaw` draws a tile outside the game's map: the title screen's two lamps.
- `PlatHud(lit, total, lives, room)` draws the two text rows. `hLit` is 255 right after a room
  change or a clear, meaning "everything is stale": it draws the labels `LAMPS` and `OF`. After that it only
  redraws the pieces that differ from what it last drew (`hLit`, `hTot`, `hLives`, `hRoom`): the two digits of
  each count (`CHR$(48 + lit / 10)` and `CHR$(48 + lit MOD 10)`), the hearts (tile 9 for each life, tile
  0 for each lost one, at cells 17 to 19 of row 23), and the room name on row 24, padded with spaces.
- `PlatClear` blanks the whole screen (`ClearScreen(0)`) and forgets all sprites and the HUD. It points
  `roomAddr` at the array of zeros so `TileRestore` repairs the title's background as black.

## Step 7: The title and the main loop

Replace `main.bas`. It has the title screen, a game, and the loop that joins them:

```basic
' main.bas -- Lamplighter: title, game loop, game over
#include once "assets/rooms.bas"
#ifdef __CPC__
#include "platform_cpc.bas"
#else
#include "platform_zx.bas"
#endif
#include "game.bas"

DIM inp, st AS UBYTE

' The title screen. Returns when fire (or any key) is pressed.
SUB TitleScreen()
  DIM released, f AS UBYTE
  DIM idle AS UINTEGER
  PlatClear()
  PlatText(4, 3, "LAMPLIGHTER")
  PlatText(1, 7, "LIGHT EVERY LAMP IN")
  PlatText(3, 9, "THE DARK TOWER")
  PlatTileRaw(8, 12, T_LIT)
  PlatTileRaw(11, 12, T_LAMP)
  PlatText(5, 17, "PRESS FIRE")
  PlatText(1, 20, "O P Q A OR CURSORS")
  PlatText(1, 22, "SPACE JUMPS")
  released = 0
  idle = 0
  DO
    inp = PlatInput()
    f = (idle >> 3) BAND 1
    PlatSprite(0, f + 1, 36, 96)
    PlatSprite(1, F_ENEMY + f, 108, 96)
    PlatFrameEnd()
    idle = idle + 1
    IF (inp BAND 8) = 0 THEN released = 1
  LOOP UNTIL released = 1 AND (inp BAND 8) <> 0
END SUB

' A game: from the cellar until the lives or the tower's dark run out.
SUB RunGame()
  DIM ov AS UBYTE
  PlatClear()
  GameInit(9)
  ov = 0
  DO
    inp = PlatInput()
    st = GameStep(inp)
    GameDraw()
    PlatFrameEnd()
    IF st <> S_PLAY THEN
      IF ov = 0 THEN
        IF st = S_OVER THEN
          PlatText(5, 9, "GAME OVER")
        ELSE
          PlatText(3, 9, "THE TOWER IS LIT")
        END IF
      END IF
      ov = ov + 1
      IF ov > 100 THEN EXIT DO
      IF ov > 30 AND (inp BAND I_FIRE) <> 0 THEN EXIT DO
    END IF
  LOOP
END SUB

PlatInit()
DO
  TitleScreen()
  RunGame()
LOOP
```

(Simplified from `main.bas:157-277`: the finished file also has the test and benchmark switches and
the music calls.) Notice the first line after the comment: `rooms.bas` is included *first* because
`PlatHud` in the platform layer calls `RoomName`.

`TitleScreen` draws the title text, two tiles and two animated sprites; it ends when a key
is pressed *after* every key has been released once, so a key still held from the game over does not skip
it. `RunGame` is the game loop: read input, `GameStep`, `GameDraw`, `PlatFrameEnd`. When the state is
not `S_PLAY` it prints `GAME OVER` or `THE TOWER IS LIT` once, then returns to the title after 100 steps
or, after 30, on fire.

## Build and run

**CPCBuild: Build and Run**. You should see the title: `LAMPLIGHTER`, a lit and an unlit lamp, the player and an
enemy animating, `PRESS FIRE`. Press any key.

In room 9: `LAMPS 00 OF 28` and three hearts at the bottom, with the room name under them. Walk into the
two lamps in the room (one stands on the floor near the start, one on the ledge: you will need to jump). Each lights, the number goes up, and
when both are lit the two orange door blocks at the right vanish. Walk through the doorway into
room 10. Walk back: the room is as you left it.

Touch the spikes or the walker: you lose a heart and are back at the start. Lose all three: `GAME
OVER`.

For comparison, the finished game with room 9 lit is
[this picture](../../games/lamplighter/tests/golden/464/lit09.png), and its
[title](../../games/lamplighter/tests/golden/464/title.png).

To check your lamp totals without playing the whole tower, change `GameInit(9)` in `RunGame` to the
number of another room and play just that one.

If you see "Variable 'pRoom' already declared", delete the old `DIM pRoom AS UBYTE`. If the hearts
do not appear, check `DoTile8(17 + i, 23, 9)` is in `PlatHud` and that tile 9 is the heart.

**Is the tower finishable?** The finished game's test suite proves it by search: a Python port of the
movement rules walks the whole tower in the intended order (9 10 11 8 7 6 3 4 5 2 1 0) and finds
every lamp reachable and every door usable, in 1,085 steps, without losing a life; the recorded
sequence is then played on the real `game.bas` and wins (`tests/reach.py`, `make reach-lamp`;
`DESIGN.md` section 12). You do not need to run it, but it is why you can trust the map.

## How it works

**Why scan for lamps instead of listing them?** An object list would need a second place to keep
in step with the picture. With tiles as lamps, the map you see in Tiled *is* the data: move a lamp
and the game follows. The price is one pass over 460 cells when a room loads, which is nothing next to
drawing it.

**State as bits.** `litMask` is twelve bytes for the whole tower. `bitTab(n)` is a table of `1, 2, 4,
8, 16, 32, 64, 128`: `litMask(room) BOR bitTab(n)` sets bit `n`, `litMask(room) BAND bitTab(n)` tests
it. (A table lookup avoids a shift loop when the bit number is a variable.)

**One tile at a time.** `DoTile8(x, y, tile)` draws a single tile at a cell (library: **Tiles**;
about 1,546 T-states in mode 0, or about 2.3k from BASIC with the call). That is cheap enough to do when a lamp
lights; it would be far too slow to redraw whole rooms.

**Text in a game.** `TextAt` is the library's text routine (**Text**); about 2,900 T-states for
the call. The HUD draws only what changed so a step in which nothing changes costs nothing.

## Try this

1. Give the player a fourth life: where is the number 3 written? (`GameInit`, and the number of hearts in `PlatHud`.)
2. Change the door tile's attribute in `taTab` (index 7) from solid to open. What happens to the
   lamps' meaning?
3. Add a "lamps left" count to the HUD in place of "lamps lit".
4. Make a lit lamp go out again after 20 seconds. What would you have to remember per lamp?
5. Draw a seventh frame for the player on death, and show it for a few steps before `Die` resets him.

## What you have now

A silent but complete game: title, 12 rooms, 28 lamps, enemies, lives, win and game over. Your
build is about 22 KB (22,227 bytes when this chapter's code was checked; the finished game built with
`-D NOSOUND` is 22,313, and `DESIGN.md` recorded 22,404 at the same stage). Next: [Chapter 8, Sound and music](08-sound-and-music.md).

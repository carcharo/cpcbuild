' platform_null.bas -- a stand-in for the portable layer (DESIGN.md) that
' draws and plays nothing: it counts and remembers the calls the game
' logic makes, so tests/logic.bas can run game.bas on any build (it uses
' only plain Boriel BASIC, nothing platform-specific).

DIM nRooms, nTiles, sfxLast, sfxCount AS UBYTE
DIM lastTileX, lastTileY, lastTile AS UBYTE
DIM spFrame(4) AS UBYTE
DIM spX(4) AS UBYTE
DIM spY(4) AS UBYTE

SUB PlatRoom(addr AS UINTEGER)
  nRooms = nRooms + 1
END SUB

SUB PlatTile(cx AS UBYTE, cy AS UBYTE, t AS UBYTE)
  nTiles = nTiles + 1
  lastTileX = cx
  lastTileY = cy
  lastTile = t
END SUB

SUB PlatSprite(s AS UBYTE, f AS UBYTE, x AS UBYTE, y AS UBYTE)
  spFrame(s) = f
  spX(s) = x
  spY(s) = y
END SUB

SUB PlatHud(lit AS UBYTE, total AS UBYTE, lives AS UBYTE, room AS UBYTE)
END SUB

SUB PlatSfx(n AS UBYTE)
  sfxLast = n
  sfxCount = sfxCount + 1
END SUB

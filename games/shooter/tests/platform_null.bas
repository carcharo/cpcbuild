' platform_null.bas -- a stand-in for the portable layer (DESIGN.md) that
' draws and plays nothing: it counts and remembers the calls the game
' logic makes, so tests/logic.bas can run game.bas on any build (it uses
' only plain Boriel BASIC, nothing platform-specific).

DIM nSprites, sfxLast, sfxCount AS UBYTE
DIM spKind, spX, spY AS UBYTE

SUB PlatSprite(kind AS UBYTE, frame AS UBYTE, x AS UBYTE, y AS UBYTE)
  nSprites = nSprites + 1
  spKind = kind
  spX = x
  spY = y
END SUB

SUB PlatSfx(n AS UBYTE)
  sfxLast = n
  sfxCount = sfxCount + 1
END SUB

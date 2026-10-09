' ----------------------------------------------------------------
' cpcbuild.bas -- the whole cpcbuild library (--arch cpc only)
'
' Fast drawing straight to screen memory, the keyboard matrix, and the
' palette. Library coordinates: x in bytes (0-79), y in pixel lines
' (0-199), from the top-left. Each part can also be included on its own:
'
'   cpcbuild/display.bas   ScreenInit, WaitRetrace, EnableDoubleBuffer,
'                          DisableDoubleBuffer, FlipBuffer, PokeScreen,
'                          PeekScreen
'   cpcbuild/sprites.bas   PutSprite, PutSpriteMasked, GetBlock
'   cpcbuild/fill.bas      PenByte, FillRect, ClearScreen
'   cpcbuild/tiles.bas     SetTileSet, DoTile8, DoTile16, TileMap
'   cpcbuild/keyboard.bas  ScanKeys, KeyDown, AnyKeyDown, KEY_* / JOY_*
'   cpcbuild/palette.bas   SetPalette, PalUpload
'   cpcbuild/spritelist.bas
'                          SprListBegin, SprListDraw, SprListEnd,
'                          SprListReset, SprListPaper
'   cpcbuild/text.bas      TextFont, TextPen, TextAt, TextAtBoth,
'                          TextFlush
'
' Only what a program calls is compiled in. Written from scratch for
' this project (MIT). Design: cpcbuild/docs/phase4c-design.md.
' ----------------------------------------------------------------

#ifndef __LIBRARY_CPCBUILD__
#define __LIBRARY_CPCBUILD__

#include once <cpcbuild/display.bas>
#include once <cpcbuild/sprites.bas>
#include once <cpcbuild/fill.bas>
#include once <cpcbuild/tiles.bas>
#include once <cpcbuild/keyboard.bas>
#include once <cpcbuild/palette.bas>
#include once <cpcbuild/spritelist.bas>
#include once <cpcbuild/text.bas>

#endif

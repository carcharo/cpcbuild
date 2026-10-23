' ----------------------------------------------------------------
' cpcbuild/tiles.bas -- 8x8 tiles drawn into screen memory (--arch cpc)
'
'   SetTileSet(addr)            the tile data is at addr
'   SetTileWidth(bytes)         tiles are 1, 2 or 4 bytes wide from now on,
'                               in any mode; 0 (or anything else): the
'                               mode's width again (the default)
'   TileWidth()                 the tile width in bytes in use now
'   DoTile8(x, y, tile)         draw 8x8 tile number `tile` at tile cell
'                               (x, y): byte column x * tile width, pixel
'                               line y * 8 (cells off the screen: nothing)
'   DoTile16(x, y, tile)        a 16x16 tile made of the 8x8 tiles
'                               4*tile .. 4*tile+3 (top-left, top-right,
'                               bottom-left, bottom-right) at 16x16 cell
'                               (x, y) = 8x8 cells (2x, 2y)..(2x+1, 2y+1)
'   TileMap(map, x, y, w, h)    draw a w x h block of 8x8 tiles, the tile
'                               numbers being bytes at map (row-major, w
'                               per row), top-left at cell (x, y); cells
'                               off the screen are skipped
'   TileMapPart(map, mapw, x, y, w, h)
'                               the same for a block out of a wider map:
'                               its rows are mapw bytes apart (mapw >= w)
'   TileRestore(map, mapw, x, y, w, h)
'                               redraws the tiles under a screen rectangle
'                               (x in bytes, y in lines, w bytes by h
'                               lines) from a map of mapw bytes per row
'                               drawn from cell (0, 0): every cell the
'                               rectangle touches. Erases a sprite in one
'                               call: TileRestore(@map, 20, x, y, 4, 16)
'
' A tile is W bytes x 8 lines: 8 rows top first, each row's bytes left
' to right, 8 * W bytes per tile. By default W follows the mode (1, 2,
' 4 in mode 2, 1, 0: 8x8 pixels), so a screen is 80/40/20 tile cells
' wide and 25 high. SetTileWidth fixes W instead (it stays through mode
' changes): 2 in mode 0 gives 4x8-pixel tiles, 40 x 25 cells. DoTile16
' draws 2 x 2 tiles whatever W is. Works with a hardware-scroll offset (see
' cpcbuild/core.asm; call ScreenInit() after a mode change).
' No firmware calls: safe on the 464 and 6128.
'
' Written from scratch for this project (MIT).
' ----------------------------------------------------------------

#ifndef __LIBRARY_CPCBUILD_TILES__
#define __LIBRARY_CPCBUILD_TILES__

#ifndef __CPC__
#error "cpcbuild is for --arch cpc only"
#endif

#pragma push(case_insensitive)
#pragma case_insensitive = TRUE

sub fastcall SetTileSet(addr as uinteger)
    #require "cpcbuild/core.asm"
    asm
    ld (.core.CB_TILESET), hl
    end asm
end sub

sub fastcall SetTileWidth(bytes as ubyte)
    #require "cpcbuild/core.asm"
    asm
    push namespace core
    PROC
    LOCAL __STW_SET
    ld   b, a               ; CB_TILEW = 1 + log2 bytes (1, 2, 3), else 0
    ld   a, 1
    dec  b
    jr   z, __STW_SET       ; 1 byte
    inc  a
    dec  b
    jr   z, __STW_SET       ; 2 bytes
    inc  a
    dec  b
    dec  b
    jr   z, __STW_SET       ; 4 bytes
    xor  a                  ; anything else: follow the mode
__STW_SET:
    ld   (CB_TILEW), a
    ENDP
    pop namespace
    end asm
end sub

function fastcall TileWidth() as ubyte
    #require "cpcbuild/tiledraw.asm"
    asm
    push namespace core
    PROC
    LOCAL __TW_L, __TW_D
    call __CB_TXS           ; A = s
    ld   b, a
    inc  b
    ld   a, 1
__TW_L:
    dec  b
    jr   z, __TW_D
    add  a, a
    jr   __TW_L
__TW_D:                     ; A = 1 << s
    ENDP
    pop namespace
    end asm
end function

sub DoTile8(x as ubyte, y as ubyte, tile as ubyte)
    #require "cpcbuild/tile8.asm"
    asm
    push namespace core
    ld c, (ix+5)
    ld b, (ix+7)
    ld l, (ix+9)
    ld h, 0
    call __CB_TILE_AT
    pop namespace
    end asm
end sub

sub DoTile16(x as ubyte, y as ubyte, tile as ubyte)
    #require "cpcbuild/tile16.asm"
    asm
    push namespace core
    ld c, (ix+5)
    ld b, (ix+7)
    ld a, (ix+9)
    call __CB_TILE16
    pop namespace
    end asm
end sub

sub TileMap(map as uinteger, x as ubyte, y as ubyte, w as ubyte, h as ubyte)
    #require "cpcbuild/tilemap.asm"
    asm
    push namespace core
    ld l, (ix+4)
    ld h, (ix+5)
    ld e, (ix+7)
    ld d, (ix+9)
    ld c, (ix+11)
    ld b, (ix+13)
    call __CB_TILEMAP
    pop namespace
    end asm
end sub

sub TileMapPart(map as uinteger, mapw as ubyte, x as ubyte, y as ubyte, w as ubyte, h as ubyte)
    #require "cpcbuild/tilemap.asm"
    asm
    push namespace core
    ld l, (ix+4)
    ld h, (ix+5)
    ld e, (ix+9)
    ld d, (ix+11)
    ld c, (ix+13)
    ld b, (ix+15)
    ld a, (ix+7)
    call __CB_TILEMAP_S
    pop namespace
    end asm
end sub

sub TileRestore(map as uinteger, mapw as ubyte, x as ubyte, y as ubyte, w as ubyte, h as ubyte)
    #require "cpcbuild/tilerestore.asm"
    asm
    push namespace core
    ld l, (ix+4)
    ld h, (ix+5)
    ld e, (ix+9)
    ld d, (ix+11)
    ld c, (ix+13)
    ld b, (ix+15)
    ld a, (ix+7)
    call __CB_TILE_RESTORE
    pop namespace
    end asm
end sub

#pragma pop(case_insensitive)

#endif

' ----------------------------------------------------------------
' cpcplus/sprman.bas -- hardware sprite slot manager (--arch cpc, CPC Plus)
'
'   #include <cpcplus/sprman.bas>        (it includes cpcplus.bas itself)
'
'   SprMgrInit(first, count)      the manager owns slots first..first+count-1
'                                 (cut at 15); the others stay the game's.
'                                 Forgets everything, hides the slots it owns
'   SprAlloc(img)                 a slot for the 256-byte picture at img (one
'                                 pixel per byte, as SpriteSetImage), or 255 if
'                                 all are in use or img is 0. A free slot that
'                                 still holds img is reused with NO upload;
'                                 otherwise an upload is queued (SprFlush does
'                                 it). The sprite stays hidden until it has a
'                                 picture AND a position (SprMove)
'   SprAllocPacked(img)           the same for the 128-byte packed picture
'                                 (SpriteSetImagePacked). The cache tells
'                                 packed and unpacked apart: the same address
'                                 as one is not a hit for the other
'   SprFree(slot)                 hides it; the slot keeps its picture as a
'                                 cached image for the next SprAlloc of it. A
'                                 slot freed before its upload was done holds
'                                 nothing (no cache entry)
'   SprSetImage(slot, img)        change the picture of an allocated slot: no
'   SprSetImagePacked(slot, img)  upload if it already holds img, else one is
'                                 queued. A sprite already showing keeps its old
'                                 picture on screen until SprFlush swaps it
'   SprMove(slot, x, y)           position, as SpriteMove (clamped). Remembered:
'                                 a sprite waiting for its upload appears at
'                                 this position when it is done. Needs no flush
'                                 once the picture is there
'   SprMag(slot, magx, magy)      magnification 1, 2 or 4 (default 1, 1; reset
'                                 by SprAlloc); applied when the sprite shows
'   SprFlush(maxUploads)          does up to maxUploads queued uploads now (in
'                                 slot order) and shows those sprites that have
'                                 a position. Call once a frame, after
'                                 WaitVsync, with a budget (an upload is about
'                                 2 ms: see docs/library.md, Sprite manager)
'   SprPending()                  how many uploads are queued
'   SprUploads()                  uploads done since SprMgrInit (a diagnostic,
'                                 and what the tests count cache hits with)
'
' The routines are machine code (sprman.asm) over the cpcplus ones
' (SpriteSetImage and friends), so the paging rules, the firmware / bare
' differences and the no-ASIC no-op behaviour are theirs: call from the main
' program (not from a raster handler or frame hook, which cannot afford those
' calls). Data is 16 records of 10 bytes in the program image (160 bytes plus
' 17 of state), no heap. A slot number outside the manager's range is ignored.
' Slot numbers are the hardware sprite numbers, so a game can still call SpriteMag / SpriteColour etc. on a slot it holds,
' and the lower slot number is in front.
'
' Written from scratch for this project (MIT).
' ----------------------------------------------------------------

#ifndef __LIBRARY_SPRMAN__
#define __LIBRARY_SPRMAN__

#include once <cpcplus/cpcplus.bas>

#pragma push(case_insensitive)
#pragma case_insensitive = TRUE

sub SprMgrInit(first as ubyte, count as ubyte)
    #require "cpcplus/sprman.asm"
    asm
    push namespace core
    ld a, (ix+5)
    ld c, (ix+7)
    call __SM_INIT
    pop namespace
    end asm
end sub

function SprAlloc(img as uinteger) as ubyte
    #require "cpcplus/sprman.asm"
    asm
    push namespace core
    ld l, (ix+4)
    ld h, (ix+5)
    ld c, 0
    call __SM_ALLOC
    pop namespace
    end asm
end function

function SprAllocPacked(img as uinteger) as ubyte
    #require "cpcplus/sprman.asm"
    asm
    push namespace core
    ld l, (ix+4)
    ld h, (ix+5)
    ld c, 2
    call __SM_ALLOC
    pop namespace
    end asm
end function

sub SprFree(slot as ubyte)
    #require "cpcplus/sprman.asm"
    asm
    push namespace core
    ld a, (ix+5)
    call __SM_FREE
    pop namespace
    end asm
end sub

sub SprSetImage(slot as ubyte, img as uinteger)
    #require "cpcplus/sprman.asm"
    asm
    push namespace core
    ld a, (ix+5)
    ld l, (ix+6)
    ld h, (ix+7)
    ld c, 0
    call __SM_SETIMG
    pop namespace
    end asm
end sub

sub SprSetImagePacked(slot as ubyte, img as uinteger)
    #require "cpcplus/sprman.asm"
    asm
    push namespace core
    ld a, (ix+5)
    ld l, (ix+6)
    ld h, (ix+7)
    ld c, 2
    call __SM_SETIMG
    pop namespace
    end asm
end sub

sub SprMove(slot as ubyte, x as integer, y as integer)
    #require "cpcplus/sprman.asm"
    asm
    push namespace core
    call __SM_MOVE
    pop namespace
    end asm
end sub

sub SprMag(slot as ubyte, magx as ubyte, magy as ubyte)
    #require "cpcplus/sprman.asm"
    asm
    push namespace core
    call __SM_MAG
    pop namespace
    end asm
end sub

sub SprFlush(maxUploads as ubyte)
    #require "cpcplus/sprman.asm"
    asm
    push namespace core
    ld a, (ix+5)
    call __SM_FLUSH
    pop namespace
    end asm
end sub

function SprPending() as ubyte
    #require "cpcplus/sprman.asm"
    asm
    push namespace core
    ld a, (__SM_PENDN)
    pop namespace
    end asm
end function

function SprUploads() as uinteger
    #require "cpcplus/sprman.asm"
    asm
    push namespace core
    ld hl, (__SM_UP)
    pop namespace
    end asm
end function

#pragma pop(case_insensitive)

#endif

REM MODELS: plus
REM Conformance: the sprite slot manager, second half (plus_sprman.bas has the first): packed and
REM unpacked pictures kept apart in the cache, SetImage, the pool's range (cut at 15, empty, all 16),
REM refused arguments. Split in two because a bare test must fit below &4000 (PlusPageIn reserves it).

#include <cpc.bas>
#include "lib/chk.bas"
#include "lib/plushelp.bas"
#include <cpcplus/sprman.bas>

DIM imgA(255) AS UBYTE
DIM imgB(255) AS UBYTE
DIM pk(127) AS UBYTE
DIM i AS UINTEGER
DIM a, b, c, d AS UBYTE

FUNCTION PosOf(n AS UBYTE) AS STRING
  RETURN STR$(AsicPeek($6000 + n * 8)) + " " + STR$(AsicPeek($6001 + n * 8)) + " " + STR$(AsicPeek($6002 + n * 8))
END FUNCTION

FUNCTION Pix(n AS UBYTE, k AS UINTEGER) AS UBYTE
  RETURN AsicPeek(16384 + n * 256 + k)
END FUNCTION

FOR i = 0 TO 255
  imgA(i) = 1
  imgB(i) = 2
NEXT i
FOR i = 0 TO 127
  pk(i) = $56
NEXT i
PlusUnlock()
SpritesHideAll()

REM ---- packed and unpacked are different cache keys, even at one address
SprMgrInit(8, 4)
a = SprAllocPacked(@pk(0))
SprFlush(9)
CHK("packed_pixels", STR$(Pix(8, 0)) + " " + STR$(Pix(8, 1)) + " " + STR$(Pix(8, 254)) + " " + STR$(Pix(8, 255)), "5 6 5 6")
SprFree(a)
b = SprAllocPacked(@pk(0))
CHK("packed_hit", STR$(b) + " " + STR$(SprUploads()) + " " + STR$(SprPending()), "8 1 0")
SprFree(b)
c = SprAlloc(@pk(0))
CHK("unpacked_same_addr_miss", STR$(c <> 8) + " " + STR$(SprPending()), "1 1")
SprFlush(9)
CHK("unpacked_same_addr_uploaded", STR$(SprUploads()), "2")
SprFree(c)
d = SprAllocPacked(@pk(0))
CHK("packed_hit_again", STR$(d) + " " + STR$(SprUploads()), "8 2")

REM ---- SetImage: nothing when unchanged, a queued upload when not, the slot keeps its place
SprFlush(9)
SprMove(d, 33, 44)
REM the same packed picture again: no upload, nothing queued
SprSetImagePacked(d, @pk(0))
CHK("setimage_same_pending", STR$(SprPending()), "0")
SprSetImage(d, @imgB(0))
CHK("setimage_changed_pending", STR$(SprPending()), "1")
CHK("setimage_old_picture_stays", STR$(Pix(8, 0)) + " " + PosOf(8), "5 33 0 44")
SprMove(d, 35, 46)
CHK("setimage_move_while_pending", PosOf(8), "35 0 46")
SprFlush(1)
CHK("setimage_uploaded", STR$(Pix(8, 0)) + " " + STR$(SprUploads()), "2 3")

REM ---- ranges: slots outside the pool are the game's and are ignored; a count past 15 is cut
SprMgrInit(14, 9)
a = SprAlloc(@imgA(0))
b = SprAlloc(@imgA(0))
c = SprAlloc(@imgA(0))
CHK("range_cut", STR$(a) + " " + STR$(b) + " " + STR$(c), "14 15 255")
SprMove(3, 1, 1)
SprFree(3)
SprMgrInit(2, 0)
CHK("empty_pool", STR$(SprAlloc(@imgA(0))), "255")
SprMgrInit(0, 16)
FOR i = 0 TO 15
  a = SprAlloc(@imgA(0))
NEXT i
CHK("all_sixteen", STR$(a) + " " + STR$(SprAlloc(@imgA(0))) + " " + STR$(SprPending()), "15 255 16")
CHK("img0_refused", STR$(SprAlloc(0)), "255")
SprFlush(255)
CHK("flush_255_all", STR$(SprPending()) + " " + STR$(SprUploads()), "0 16")
SprMgrInit(0, 16)
SpritesHideAll()

PRINT "DONE"
END

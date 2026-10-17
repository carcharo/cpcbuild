REM MODELS: plus
REM Conformance: the sprite slot manager (lib/cpcplus/sprman.bas) on a CPC Plus, first half
REM (plus_sprman2.bas has the rest): allocation, the image cache (a re-allocated image is not
REM uploaded again: counted with SprUploads()), LRU choice among free slots, exhaustion (255), the
REM SprFlush budget, positions applied only once the upload is done. Pixels and positions are read
REM back from the ASIC page.

#include <cpc.bas>
#include "lib/chk.bas"
#include "lib/plushelp.bas"
#include <cpcplus/sprman.bas>

DIM imgA(255) AS UBYTE
DIM imgB(255) AS UBYTE
DIM imgC(255) AS UBYTE
DIM imgD(255) AS UBYTE
DIM pk(127) AS UBYTE
DIM i AS UINTEGER
DIM a, b, c, d, e AS UBYTE

FUNCTION PosOf(n AS UBYTE) AS STRING
  RETURN STR$(AsicPeek($6000 + n * 8)) + " " + STR$(AsicPeek($6001 + n * 8)) + " " + STR$(AsicPeek($6002 + n * 8))
END FUNCTION

FUNCTION Pix(n AS UBYTE, k AS UINTEGER) AS UBYTE
  RETURN AsicPeek(16384 + n * 256 + k)
END FUNCTION

FOR i = 0 TO 255
  imgA(i) = 1
  imgB(i) = 2
  imgC(i) = 3
  imgD(i) = 4
NEXT i
FOR i = 0 TO 127
  pk(i) = $56
NEXT i
PlusUnlock()
SpritesHideAll()

REM ---- init, a pool of 3 slots: 4-6
SprMgrInit(4, 3)
CHK("init_pending", STR$(SprPending()), "0")
CHK("init_uploads", STR$(SprUploads()), "0")
a = SprAlloc(@imgA(0))
b = SprAlloc(@imgB(0))
c = SprAlloc(@imgC(0))
CHK("alloc_slots", STR$(a) + " " + STR$(b) + " " + STR$(c), "4 5 6")
CHK("alloc_pending", STR$(SprPending()), "3")
CHK("alloc_no_upload_yet", STR$(Pix(4, 0)) + " " + STR$(Pix(5, 0)) + " " + STR$(Pix(6, 0)), "0 0 0")
CHK("exhausted", STR$(SprAlloc(@imgD(0))), "255")
CHK("exhausted_packed", STR$(SprAllocPacked(@pk(0))), "255")
CHK("exhausted_keeps_pending", STR$(SprPending()), "3")

REM ---- positions while waiting are remembered but not written
SprMove(a, 100, 50)
SprMove(c, 300, 80)
CHK("move_waiting_not_applied", PosOf(4) + " | " + PosOf(6), "0 0 0 | 0 0 0")

REM ---- the flush budget
SprFlush(0)
CHK("flush0_nothing", STR$(SprUploads()) + " " + STR$(SprPending()), "0 3")
SprFlush(2)
CHK("flush2_uploads", STR$(SprUploads()) + " " + STR$(SprPending()), "2 1")
CHK("flush2_pixels", STR$(Pix(4, 17)) + " " + STR$(Pix(5, 200)) + " " + STR$(Pix(6, 0)), "1 2 0")
CHK("flush2_positions", PosOf(4) + " | " + PosOf(6), "100 0 50 | 0 0 0")
SprFlush(5)
CHK("flush_rest", STR$(SprUploads()) + " " + STR$(SprPending()) + " " + STR$(Pix(6, 99)), "3 0 3")
CHK("flush_rest_position", PosOf(6), "44 1 80")
CHK("flush_again_nothing", STR$(SprUploads()), "3")
SprMove(a, 120, 60)
CHK("move_after_upload_immediate", PosOf(4), "120 0 60")

REM ---- free keeps the picture: the same image gets its slot back, no upload
SprFree(a)
d = SprAlloc(@imgA(0))
CHK("cache_hit_slot", STR$(d), "4")
CHK("cache_hit_no_upload", STR$(SprUploads()) + " " + STR$(SprPending()), "3 0")
SprFree(d)

REM ---- LRU: free order a(4), b(5), c(6) ... a is the oldest, c the newest
SprFree(b)
SprFree(c)
d = SprAlloc(@imgD(0))
CHK("lru_takes_oldest_free", STR$(d) + " " + STR$(SprPending()), "4 1")
CHK("lru_cache_of_others_kept", STR$(Pix(5, 0)) + " " + STR$(Pix(6, 0)), "2 3")
e = SprAlloc(@imgB(0))
CHK("lru_hit_after_miss", STR$(e) + " " + STR$(SprPending()), "5 1")
SprFree(e)
REM a never-uploaded slot holds nothing: freed while pending, no cache entry
SprFree(d)
SprFlush(9)
CHK("free_pending_no_upload", STR$(SprUploads()) + " " + STR$(SprPending()), "3 0")
a = SprAlloc(@imgD(0))
CHK("freed_pending_is_a_miss", STR$(a) + " " + STR$(SprPending()), "4 1")
SprFlush(9)
CHK("miss_uploads", STR$(SprUploads()) + " " + STR$(Pix(4, 5)), "4 4")

REM ---- an empty slot is preferred over a cached free one
SprMgrInit(4, 3)
a = SprAlloc(@imgA(0))
SprFlush(9)
SprFree(a)
b = SprAlloc(@imgB(0))
CHK("empty_preferred", STR$(a) + " " + STR$(b), "4 5")
SprFlush(9)
SprFree(b)
c = SprAlloc(@imgC(0))
CHK("empty_preferred_2", STR$(c), "6")
SprFlush(9)
CHK("uploads_counted", STR$(SprUploads()), "3")
REM all three slots hold a picture now; imgA is the oldest cache entry (slot 4 freed first)
SprFree(c)
d = SprAlloc(@imgD(0))
CHK("lru_is_least_recent_free", STR$(d), "4")
SprFlush(9)

PRINT "DONE"
END

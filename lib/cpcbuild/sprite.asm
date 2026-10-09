; -----------------------------------------------------------------------
; cpcbuild library -- all the sprite routines (PutSprite, PutSpriteMasked,
; GetBlock)
;
; Written from scratch for this project (MIT); see core.asm.
;
; The routines live in sprput.asm, sprmask.asm and sprget.asm (set-up and
; fast paths shared by all three: sprcommon.asm). sprites.bas requires
; just the ones a program calls; this file pulls in all three for
; anything that still requires "cpcbuild/sprite.asm" as a whole.

#include once <cpcbuild/sprput.asm>
#include once <cpcbuild/sprmask.asm>
#include once <cpcbuild/sprget.asm>

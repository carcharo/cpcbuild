; -----------------------------------------------------------------------
; cpcbuild library -- the extra banks: what BankLoad needs besides banks.asm
;
; Written from scratch for this project (MIT); see banks.asm. BankLoad
; takes a heap block for the file name and the 2 KB read buffer, so it
; needs the compiler's heap allocator; it is pulled in only when BankLoad
; is called, so programs that use the other bank routines carry no
; allocator. No code of its own.

#include once <cpcbuild/banks.asm>
#include once <mem/alloc.asm>
#include once <mem/free.asm>

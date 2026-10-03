' ----------------------------------------------------------------
' cpcbuild/reserve.bas -- the "&4000-&7FFF is reserved" marker
'
' The compiler reserves &4000-&7FFF (code and data must end below it, the
' heap must stay above it) in every program that defines the label
' .core.__CPC_RESERVE_4000. Two libraries want that: double buffering
' (display.bas, the back screen) and the extra-RAM banks (banks.bas, the
' window the banks appear in). A label can only be defined once, so it
' lives in this one sub, and each library's subs call it: the label is in
' the program exactly when any of them is used.
'
' Written for this project (MIT).
' ----------------------------------------------------------------

#ifndef __LIBRARY_CPCBUILD_RESERVE__
#define __LIBRARY_CPCBUILD_RESERVE__

#ifndef __CPC__
#error "cpcbuild is for --arch cpc only"
#endif

#pragma push(case_insensitive)
#pragma case_insensitive = TRUE

sub fastcall CbReserve4000()
    asm
    push namespace core
__CPC_RESERVE_4000:
    pop namespace
    end asm
end sub

#pragma pop(case_insensitive)

#endif

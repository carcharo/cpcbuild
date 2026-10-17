' ----------------------------------------------------------------
' cpcplus/palcycle.bas -- palette cycling (--arch cpc, CPC Plus)
'
'   #include <cpcplus/palcycle.bas>      (it includes cpcplus.bas itself)
'
'   PalCycleSet(id, kind, first, count, table, period)
'                                 up to 4 cycles, id 0-3. kind 0: screen pens
'                                 (ASIC palette entries 0-15, first = the first
'                                 pen); kind 1: sprite colours (first = the
'                                 first sprite colour, 1-15, which is palette
'                                 entry 16 + first). table = count 12-bit
'                                 colours as the words of SetPalette12 (an
'                                 array of UINTEGER &H0RGB, not the ASIC order
'                                 of img2cpc.py's NAME_pal), kept by reference:
'                                 it must stay in place. Every
'                                 `period` frames (0 counts as 1) the colours
'                                 are rotated by one: after k steps the entry
'                                 first + i shows table((i + k) mod count). The
'                                 table is written at once (step 0). The
'                                 range is cut to the palette (pens 0-15,
'                                 sprite colours 1-15); count < 2 does nothing
'   PalCycleDir(id, dir)          0 forward (the default), 1 backward, 2
'                                 ping-pong (the rotation offset runs 0 to
'                                 count - 1 and back, which sweeps a highlight
'                                 to and fro instead of round)
'   PalCycleStop(id)              stops the cycle; the colours stay as they are
'   PalCycleStep()                call ONCE a frame (after WaitVsync): every
'                                 cycle that is due is rotated, one block write
'                                 to the palette each
'
' The sprite palette is shared by all 16 sprites: a cycled sprite colour
' changes in every sprite that uses it, so reserve those indices for what
' cycles. Screen pens: in firmware mode the first write stops the firmware's
' ink refresh (as SetPalette12 does; Mode() restarts it).
'
' Not in this module: cycling different colours in different bands of the
' screen (it needs a raster interrupt per band, bare mode; the handler would
' use the PlusHandler* entries of cpcplus.bas), and sprite multiplexing
' helpers. PalCycleStep goes through the cpcplus calls, so call it from the
' main program, not from a raster handler or a frame hook. The routines are
' machine code (palcycle.asm) over cpcplus's block write; the data is 4
' records of 8 bytes and a 32-byte buffer in the program image, no heap.
'
' Written from scratch for this project (MIT).
' ----------------------------------------------------------------

#ifndef __LIBRARY_PALCYCLE__
#define __LIBRARY_PALCYCLE__

#include once <cpcplus/cpcplus.bas>

#pragma push(case_insensitive)
#pragma case_insensitive = TRUE

sub PalCycleSet(id as ubyte, kind as ubyte, first as ubyte, count as ubyte, table as uinteger, period as ubyte)
    #require "cpcplus/palcycle.asm"
    asm
    push namespace core
    call __PC_SET
    pop namespace
    end asm
end sub

sub PalCycleDir(id as ubyte, dir as ubyte)
    #require "cpcplus/palcycle.asm"
    asm
    push namespace core
    ld a, (ix+5)
    ld c, (ix+7)
    call __PC_DIR
    pop namespace
    end asm
end sub

sub PalCycleStop(id as ubyte)
    #require "cpcplus/palcycle.asm"
    asm
    push namespace core
    ld a, (ix+5)
    call __PC_STOP
    pop namespace
    end asm
end sub

sub PalCycleStep()
    #require "cpcplus/palcycle.asm"
    asm
    push namespace core
    call __PC_STEP
    pop namespace
    end asm
end sub

#pragma pop(case_insensitive)

#endif

' ----------------------------------------------------------------
' cpcbuild/banks.bas -- the 6128's extra 64 KB (--arch cpc)
'
'   BankAvailable()          1 on a machine with the extra 64 KB (a 6128,
'                            or a 464/664 with a compatible RAM expansion),
'                            0 otherwise (found out at program start)
'   BankSelect(n)            n = 0-3: extra bank n appears at &4000-&7FFF
'                            (main RAM there is hidden, not lost);
'                            BankSelect(255): main RAM again
'   BankOff()                = BankSelect(255)
'   BankSelected()           0-3 for the bank in, 255 for main RAM
'   BankPeek(bank, addr)     reads a byte of a bank (addr = &4000-&7FFF)
'   BankPoke(bank, addr, v)  writes one
'   BankCopyIn(bank, bankaddr, src, len)    main RAM -> bank
'   BankCopyOut(bank, bankaddr, dst, len)   bank -> main RAM
'                            (return 1 if done, 0 if refused: no extra RAM,
'                            bad bank, a range outside &4000-&7FFF on the
'                            bank side or touching it on the main side;
'                            len 0 does nothing and returns 1)
'   BankLoad(file$, bank, addr)  loads a disc file into a bank, at addr
'                            (&4000-&7FFF); 1 if loaded, else 0
'
' The banks. A bank is 16 KB. Selecting bank n (&C4+n on the Gate Array)
' swaps it in for main RAM at &4000-&7FFF; the rest of the map is
' unchanged, and the screen at &C000 (all the CRTC ever shows) is
' unaffected. BankPeek/Poke and the copies page a bank in only for the
' instant they need it and put back whatever was selected; the persistent
' BankSelect is for code that wants to read or write a bank directly
' (PEEK/POKE/ASM at &4000-&7FFF).
'
' Rules.
'  - While a bank is selected, &4000-&7FFF is the bank. Don't draw into
'    the back screen then (EnableDoubleBuffer's screen is also &4000), and
'    don't call anything that does (FlipBuffer, sprite and tile drawing
'    while double buffering): the bytes would land in the bank. Select the
'    bank, use it, BankOff, then draw. PRINT and the firmware draw on
'    &C000 and are fine.
'  - Any program that uses these routines reserves &4000-&7FFF: the
'    compiler refuses a program whose code and data reach it (they must end
'    below &4000, as with double buffering), and the heap and stack are
'    elsewhere. The firmware, the interrupt handler, the frame hook and
'    the music player keep nothing there. Sound effects, song data in main
'    RAM and the like must therefore be below &4000 (or above &7FFF).
'  - The copies page a bank in for at most 256 bytes at a time with
'    interrupts off (1.3 ms), then let them run; BankPoke/Peek hold them
'    off for about 100 T-states. Interrupts are always on in the caller
'    afterwards. Costs, measured (bench/boriel/banks_bench.bas, T-states):
'    BankPeek/Poke about 550 a call from BASIC, BankSelect+BankOff about
'    590, a copy about 1200 per call plus 25 per byte.
'    Keep your own sections short: an interrupt held off for over 3.3 ms
'    (13300 T-states) is lost, and the music hook and the firmware's
'    clock and keyboard run from it.
'  - The frame hook (music) pages its own bank in and puts back the
'    configuration BankSelect left, so a selected bank survives it; only
'    this library may change the RAM configuration (it is write-only, so
'    the library keeps a shadow of it). Don't write the Gate Array's RAM
'    configuration (&7Fxx with bits 7-6 = 11) or call KL BANK SWITCH
'    (&BD5B) yourself.
'  - On a 464 or 664 nothing is paged: BankSelect/Off/Peek/Poke do nothing
'    (Peek reads 0), the copies and BankLoad return 0.
'
' BankLoad(file$, bank, addr) reads an AMSDOS file straight into the
' bank at addr, with the firmware's CAS_IN_OPEN / CAS_IN_DIRECT /
' CAS_IN_CLOSE (through the runtime's firmware gate). The file needs an
' AMSDOS header (SAVE"x",B on a CPC, tools/cpcrun.py --disk-file, mkdsk.py;
' the header's load address is ignored; its length is what is read) and
' must fit between addr and &7FFF. The name is a plain AMSDOS name (up to
' 16 characters, "NAME.EXT" or "A:NAME.EXT"; upper-cased for you). It
' needs the disc ROM (AMSDOS): BankLoad runs |DISC first, because the
' firmware hands a program it started (MC START PROGRAM, which RUN" ends
' with) the tape's vectors, not the disc's -- measured: without it
' CAS_IN_OPEN shows "Press PLAY then any key" and waits. So it leaves the
' firmware's CAS routines pointing at the disc, as |DISC does; a program
' that reads or writes tape afterwards must run |TAPE itself. With no
' disc ROM at all (a 464 without a drive) BankLoad returns 0 at once. A
' missing file makes AMSDOS print its own message on screen. A 2 KB buffer
' and the name are taken from the heap (so the heap must have 2 KB spare,
' the default 4.7 KB heap does) and given back before BankLoad returns;
' the bank is selected during the read, and what was selected before is
' put back after. The file is read with interrupts on (the firmware's
' disc routines time their own critical parts).
'
' Written from scratch for this project (MIT).
' ----------------------------------------------------------------

#ifndef __LIBRARY_CPCBUILD_BANKS__
#define __LIBRARY_CPCBUILD_BANKS__

#ifndef __CPC__
#error "cpcbuild is for --arch cpc only"
#endif

#include once <cpcbuild/reserve.bas>

#pragma push(case_insensitive)
#pragma case_insensitive = TRUE

function fastcall BankAvailable() as ubyte
    asm
    push namespace core
    ld a, (CBK_PRESENT)
    pop namespace
    end asm
end function

' n = 0-3: that extra bank at &4000-&7FFF; anything else (255): main RAM.
sub BankSelect(n as ubyte)
    CbReserve4000()
    asm
    push namespace core
    ld a, (ix+5)
    call __BK_SELECT
    pop namespace
    end asm
end sub

sub BankOff()
    CbReserve4000()
    asm
    push namespace core
    ld a, $C0
    call __BK_SETCFG
    pop namespace
    end asm
end sub

' 0-3: the bank in; 255: main RAM.
function BankSelected() as ubyte
    asm
    push namespace core
    ld a, (CBK_CFG)
    sub $C4
    cp 4
    jr c, __BKS_DONE
    ld a, 255
__BKS_DONE:
    pop namespace
    end asm
end function

function BankPeek(bank as ubyte, addr as uinteger) as ubyte
    CbReserve4000()
    asm
    push namespace core
    PROC
    LOCAL __BKP_ZERO, __BKP_END
    ld a, (ix+5)
    cp 4
    jr nc, __BKP_ZERO
    ld a, (CBK_PRESENT)
    or a
    jr z, __BKP_ZERO
    ld l, (ix+6)
    ld h, (ix+7)
    ld a, h
    cp $40
    jr c, __BKP_ZERO
    cp $80
    jr nc, __BKP_ZERO
    ld a, (ix+5)
    or $C4
    ld c, a
    ld b, $7F
    di
    out (c), c              ; the bank in
    ld d, (hl)
    ld a, (CBK_CFG)
    ld c, a
    out (c), c              ; what was in before
    ei
    ld a, d
    jr __BKP_END
__BKP_ZERO:
    xor a
__BKP_END:
    ENDP
    pop namespace
    end asm
end function

sub BankPoke(bank as ubyte, addr as uinteger, value as ubyte)
    CbReserve4000()
    asm
    push namespace core
    PROC
    LOCAL __BKW_END
    ld a, (ix+5)
    cp 4
    jr nc, __BKW_END
    ld a, (CBK_PRESENT)
    or a
    jr z, __BKW_END
    ld l, (ix+6)
    ld h, (ix+7)
    ld a, h
    cp $40
    jr c, __BKW_END
    cp $80
    jr nc, __BKW_END
    ld a, (ix+5)
    or $C4
    ld c, a
    ld d, (ix+9)
    ld b, $7F
    di
    out (c), c              ; the bank in
    ld (hl), d
    ld a, (CBK_CFG)
    ld c, a
    out (c), c              ; what was in before
    ei
__BKW_END:
    ENDP
    pop namespace
    end asm
end sub

' Main RAM (src, outside &4000-&7FFF) -> bank at bankaddr. 1 = done.
function BankCopyIn(bank as ubyte, bankaddr as uinteger, src as uinteger, length as uinteger) as ubyte
    CbReserve4000()
    asm
    push namespace core
    PROC
    LOCAL __BKI_FAIL, __BKI_OK, __BKI_END
    ld a, (ix+5)
    cp 4
    jr nc, __BKI_FAIL
    ld a, (CBK_PRESENT)
    or a
    jr z, __BKI_FAIL
    ld c, (ix+10)
    ld b, (ix+11)
    ld a, b
    or c
    jr z, __BKI_OK
    ld l, (ix+6)
    ld h, (ix+7)
    push bc
    call __BK_INWIN
    pop bc
    jr nc, __BKI_FAIL
    ld l, (ix+8)
    ld h, (ix+9)
    push bc
    call __BK_OUTWIN
    pop bc
    jr nc, __BKI_FAIL
    ld a, (ix+5)
    or $C4
    ld l, (ix+8)
    ld h, (ix+9)
    ld e, (ix+6)
    ld d, (ix+7)
    call __BK_COPY
__BKI_OK:
    ld a, 1
    jr __BKI_END
__BKI_FAIL:
    xor a
__BKI_END:
    ENDP
    pop namespace
    end asm
end function

' Bank at bankaddr -> main RAM (dst, outside &4000-&7FFF). 1 = done.
function BankCopyOut(bank as ubyte, bankaddr as uinteger, dst as uinteger, length as uinteger) as ubyte
    CbReserve4000()
    asm
    push namespace core
    PROC
    LOCAL __BKO_FAIL, __BKO_OK, __BKO_END
    ld a, (ix+5)
    cp 4
    jr nc, __BKO_FAIL
    ld a, (CBK_PRESENT)
    or a
    jr z, __BKO_FAIL
    ld c, (ix+10)
    ld b, (ix+11)
    ld a, b
    or c
    jr z, __BKO_OK
    ld l, (ix+6)
    ld h, (ix+7)
    push bc
    call __BK_INWIN
    pop bc
    jr nc, __BKO_FAIL
    ld l, (ix+8)
    ld h, (ix+9)
    push bc
    call __BK_OUTWIN
    pop bc
    jr nc, __BKO_FAIL
    ld a, (ix+5)
    or $C4
    ld l, (ix+6)
    ld h, (ix+7)
    ld e, (ix+8)
    ld d, (ix+9)
    call __BK_COPY
__BKO_OK:
    ld a, 1
    jr __BKO_END
__BKO_FAIL:
    xor a
__BKO_END:
    ENDP
    pop namespace
    end asm
end function

#ifdef CPC_BAREMETAL
' Bare-metal mode (-D CPC_BAREMETAL): no firmware, so no AMSDOS. BankLoad is
' refused at compile time (an "Undefined GLOBAL label" error whose name says
' why; an unused BankLoad is ignored as usual). BankCopyIn/BankCopyOut and
' the rest of this library work, for data that is already in the program.
function BankLoad(filename as string, bank as ubyte, addr as uinteger) as ubyte
    asm
    call .core.BankLoad_needs_the_firmware__not_available_with_CPC_BAREMETAL
    end asm
end function
#else
' Loads the AMSDOS file into the bank at addr. 1 = loaded.
' Firmware entries called (through __FW_CALL_IX): KL_FIND_COMMAND (&BCD4:
' HL = command name, last character with bit 7 set; carry set = found, C =
' ROM, HL = routine) and KL_FAR_PCHL (&001B: runs it) for |DISC, then
' CAS_IN_OPEN (&BC77: B =
' name length, HL = name, DE = 2 KB buffer; carry set = opened, HL = the
' file header), CAS_IN_DIRECT (&BC83: HL = destination; carry set = read),
' CAS_IN_CLOSE (&BC7A) or CAS_IN_ABANDON (&BC7D). All corrupt AF, BC, DE,
' HL, IX (the gate keeps IX).
function BankLoad(filename as string, bank as ubyte, addr as uinteger) as ubyte
    CbReserve4000()
    asm
    push namespace core
    PROC
    LOCAL __BKL_DISC, __BKL_COPY, __BKL_STORE, __BKL_LENOK, __BKL_ABANDON, __BKL_FREE, __BKL_END
    xor a
    ld (CBK_LRES), a
    ld a, (ix+7)
    cp 4
    jp nc, __BKL_END
    ld a, (CBK_PRESENT)
    or a
    jp z, __BKL_END
    ld a, (ix+9)
    cp $40
    jp c, __BKL_END
    cp $80
    jp nc, __BKL_END
    ld l, (ix+4)
    ld h, (ix+5)
    ld a, h
    or l
    jp z, __BKL_END
    ld c, (hl)
    inc hl
    ld b, (hl)              ; BC = name length
    ld a, b
    or a
    jp nz, __BKL_END
    ld a, c
    or a
    jp z, __BKL_END
    cp 17
    jp nc, __BKL_END
    ld (CBK_LLEN), a
    ld bc, 2064             ; 16 bytes of name, then the 2 KB buffer:
    call __MEM_ALLOC        ; both must be in the central 32 KB (the heap is)
    ld a, h
    or l
    jp z, __BKL_END
    ld (CBK_LBUF), hl
    ex de, hl               ; DE = block
    ld l, (ix+4)
    ld h, (ix+5)
    inc hl
    inc hl                  ; HL = the name's characters
    ld a, (CBK_LLEN)
    ld b, a
__BKL_COPY:
    ld a, (hl)
    cp 'a'
    jr c, __BKL_STORE
    cp 'z' + 1
    jr nc, __BKL_STORE
    sub 32                  ; upper case
__BKL_STORE:
    ld (de), a
    inc hl
    inc de
    djnz __BKL_COPY
    ld a, ($BC77)           ; CAS_IN_OPEN's jump-block entry: RST 3 (far call)
    cp $DF                  ; when AMSDOS is patched in; the tape's is RST 1
    jr z, __BKL_DISC
    ld c, 7                 ; AMSDOS runs from ROM 7: initialise it again, with
    ld de, $0100            ; the top of memory the firmware gave it at boot
    ld hl, $B0FF            ; (so its workspace is where the runtime expects
    call __FW_CALL_IX       ; it, &A67C-&B0FF)
    defw $BCCE              ; KL_INIT_BACK
    ld a, ($BC77)
    cp $DF
    jp nz, __BKL_FREE       ; no disc ROM there
__BKL_DISC:
    ld hl, (CBK_LBUF)
    ld de, 16
    add hl, de
    ex de, hl               ; DE = the 2 KB buffer
    ld hl, (CBK_LBUF)
    ld a, (CBK_LLEN)
    ld b, a
    call __FW_CALL_IX       ; CAS_IN_OPEN
    defw $BC77
    jp nc, __BKL_FREE       ; not opened
    ld de, 24
    add hl, de              ; header + &18: the logical length
    ld e, (hl)
    inc hl
    ld d, (hl)
    ld a, d
    or e
    jp z, __BKL_ABANDON     ; no usable length (not an AMSDOS-headered file)
    ld l, (ix+8)
    ld h, (ix+9)
    add hl, de              ; first byte after the data
    jp c, __BKL_ABANDON
    ld a, h
    cp $80
    jr c, __BKL_LENOK
    jp nz, __BKL_ABANDON
    ld a, l
    or a
    jp nz, __BKL_ABANDON    ; would run past &7FFF
__BKL_LENOK:
    ld a, (CBK_CFG)
    ld (CBK_LPREV), a
    ld a, (ix+7)
    call __BK_SELECT        ; the bank in (shadow too: the hook restores it)
    ld l, (ix+8)
    ld h, (ix+9)
    call __FW_CALL_IX       ; CAS_IN_DIRECT
    defw $BC83
    sbc a, a
    and 1                   ; carry set = read
    ld (CBK_LRES), a
    call __FW_CALL_IX       ; CAS_IN_CLOSE
    defw $BC7A
    ld a, (CBK_LPREV)
    call __BK_SETCFG        ; what was in before
    jr __BKL_FREE
__BKL_ABANDON:
    call __FW_CALL_IX       ; CAS_IN_ABANDON
    defw $BC7D
__BKL_FREE:
    ld hl, (CBK_LBUF)
    call __MEM_FREE
__BKL_END:
    ld a, (CBK_LRES)
    ENDP
    pop namespace
    end asm
end function
#endif

#pragma pop(case_insensitive)

#require "cpcbuild/banks.asm"

#endif

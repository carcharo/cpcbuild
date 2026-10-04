; -----------------------------------------------------------------------
; cpcplus library -- the ASIC of the CPC Plus / GX4000: detection, unlock,
; paging, 12-bit palette, hardware sprites
;
; Written from scratch for this project (MIT), from the public
; documentation of the ASIC (cpcwiki.eu, "Arnold V Specs Revised") and
; checked against the emulators' source: Caprice32 (asic.cpp, cap32.cpp
; z80_OUT_handler, crtc.cpp) and CPCEC (cpcec.c). Facts and sources:
; notes.md, Phase 7 P2.
;
; Unlock. The ASIC ignores everything new until a 17-byte sequence has
; been written to the CRTC register-select port (&BCxx):
;   FF 00 FF 77 B3 51 A8 D4 62 39 9C 46 2B 15 8A CD EE
; (the first 15 bytes, then CD unlocks, any other byte locks again; the
; trailing EE is what Caprice32 wants after the CD and CPCEC ignores).
; On a CPC without ASIC the bytes only select CRTC registers (no
; register is written). The sequence must not be broken by another write
; to &BCxx (the firmware's flyback events select CRTC registers 12/13
; for hardware scrolling), so it is sent with interrupts off.
;
; RMR2. With the ASIC unlocked, a Gate Array write (&7Fxx) whose bits 7-5
; are 101 is RMR2, not the normal mode/ROM register: bits 4-3 pick where
; the lower ROM (cartridge page = bits 2-0) appears: 00 at &0000, 01 at
; &4000, 10 at &8000, and 11 = the ASIC's register page at &4000-&7FFF
; (the lower ROM then stays at &0000 as page bits 2-0 say). &A0 is the
; reset value and what the library puts back. RMR2 does not change the
; RAM configuration (&7FC0+) or the RMR ROM/mode bits: it only replaces
; what a read or write of &4000-&7FFF sees (Caprice32: membank_read[1] /
; membank_write[1] = the register page after the RAM configuration is
; applied; CPCEC: mmu_rom[1] = mmu_ram[1] = plus_bank). So a RAM bank
; BankSelect put at &4000 and the 6128 back screen are hidden, not
; changed, while the page is in.
;
; The ASIC page (16 KB window at &4000-&7FFF):
;   &4000-&4FFF  sprite pixels, 16 sprites x 256 bytes, row-major, 16 rows
;                of 16; only the low nibble is stored: 0 transparent, 1-15
;                = sprite colour (palette entries 17-31)
;   &6000-&607F  sprite n at &6000 + 8n: X lo, X hi, Y lo, Y hi, mag
;                (bits 3-2 = X, bits 1-0 = Y: 0 off, 1 = x1, 2 = x2,
;                3 = x4); X is 10 bits (-256..767), Y 9 bits (-256..255)
;   &6400-&643F  palette, 2 bytes per entry: entries 0-15 pens, 16 border,
;                17-31 sprite colours 1-15; byte 0 = red << 4 | blue,
;                byte 1 = green (low nibble)
;   &6800 PRI, &6801 SSSL, &6802-3 SSA, &6804 SSCR, &6805 IVR, &6C00+ DMA,
;   &6C0F DCSR: not touched here (the P3 routines will).
;
; The window problem. While the page is in, &4000-&7FFF is not RAM: no
; library code, data or stack may be there, and no interrupt handler may
; run (the music frame hook pages RAM banks there and reads song data
; from them; with the ASIC page in it would read and write ASIC
; registers). The library therefore (1) reserves &4000-&7FFF exactly as
; the extra-RAM banks and the double buffer do (cpcbuild/reserve.bas:
; the compiler refuses a program whose code or data reach &4000, the
; heap is above &7FFF, the stack is at &A200+ / &B800), so every routine
; runs from below &4000, and (2) keeps the page in only inside a
; DI ... EI window of at most about 1.5 ms (one sprite image copy = 5.4k
; T-states; the packed copy runs as two windows of 64 bytes), restoring
; the interrupt state it found (the Z80's IFF through LD A,I, re-read
; once because of the NMOS "interrupt just after LD A,I" bug), so it is
; safe to call from the frame hook (interrupts already off there) as
; well as from main code. PlusPageIn leaves interrupts off until
; PlusPageOut.
;
; State, in the program image (zero at load, set by the first call):
;   PLUS_PRES 0 unknown, 1 Plus, 2 none     PLUS_UNLK 1 = the library has
;   unlocked the ASIC    PLUS_USER 1 = the program called PlusPageIn
;   PLUS_RMR2 the RMR2 value the library puts back (&A0)
;   PLUS_IFF  the interrupt state to restore
;
; Both runtime modes: nothing here calls the firmware. The only mode
; difference is __PL_RMR (what the Gate Array's RMR holds right now).

#include once <sysvars.asm>

    push namespace core

; ---- interrupt state ------------------------------------------------------

; __PL_DI -- interrupts off, and the state they were in kept for __PL_EI.
; Hardware: none. Registers clobbered: AF.
__PL_DI:
    PROC
    LOCAL __PD_ON, __PD_SET
    ld   a, i
    jp   pe, __PD_ON        ; P/V = IFF2
    ld   a, i               ; NMOS bug: an interrupt accepted right after
    jp   pe, __PD_ON        ; LD A,I reads as "off"; read again
    xor  a
    jr   __PD_SET
__PD_ON:
    ld   a, 1
__PD_SET:
    di
    ld   (PLUS_IFF), a
    ret
    ENDP

; __PL_EI -- interrupts back on if __PL_DI found them on.
; Registers clobbered: AF.
__PL_EI:
    ld   a, (PLUS_IFF)
    or   a
    ret  z
    ei
    ret

; ---- unlock / lock --------------------------------------------------------

__PL_SEQ:
    defb $FF, $00, $FF, $77, $B3, $51, $A8, $D4, $62, $39, $9C, $46, $2B, $15, $8A
    defb $CD, $EE           ; unlock: the 15 above + CD (EE is what Caprice32 wants after it)

; __PL_UNLOCK_RAW -- sends all 17 bytes. Interrupts must be off.
; Hardware: CRTC register-select port &BC00 (writes only).
; Registers clobbered: AF, BC, HL (DE kept).
__PL_UNLOCK_RAW:
    ld   a, 17
    jr   __PL_SEND

; __PL_LOCK_RAW -- the first 15 bytes, then EE (anything but CD locks).
; Interrupts must be off. Registers clobbered: AF, BC, HL (DE kept).
__PL_LOCK_RAW:
    ld   a, 15
    call __PL_SEND
    ld   bc, $BC00
    ld   a, $EE
    out  (c), a
    ret

; __PL_SEND -- A = number of bytes of __PL_SEQ to send.
__PL_SEND:
    PROC
    LOCAL __PS_LOOP
    push de
    ld   d, a
    ld   hl, __PL_SEQ
    ld   bc, $BC00
__PS_LOOP:
    ld   a, (hl)
    out  (c), a
    inc  hl
    dec  d
    jr   nz, __PS_LOOP
    pop  de
    ret
    ENDP

; ---- what the Gate Array's RMR holds now -----------------------------------

; __PL_RMR -- A = the Gate Array's mode/ROM register as the program left it
; (RMR is write-only): firmware mode, the firmware gate's C' shadow
; (FW_BC, kept by every firmware call, see fwcall.asm); bare mode, both
; ROMs off (&8C) and the mode from GFX_XSHIFT (2 = mode 0, 1 = mode 1,
; 0 = mode 2, as __CPC_SET_MODE_VARS set it). Only used to put the mode
; and ROM state back on a machine that turns out to have no ASIC.
; Registers clobbered: AF.
__PL_RMR:
#ifdef CPC_BAREMETAL
    ld   a, (GFX_XSHIFT)
    neg
    add  a, 2
    and  3
    or   $8C
    ret
#else
    ld   a, (FW_BC)
    ret
#endif

; ---- detection ------------------------------------------------------------

; __PL_PROBE -- finds out whether there is an ASIC, once: sets PLUS_PRES
; to 1 (Plus) or 2 (none). Writes a byte with bit 7 set to &4000 (RAM),
; unlocks, pages the register page in, and reads &4000: a CPC with no ASIC
; shows the byte it wrote, a Plus shows sprite 0's first pixel, which only
; has a low nibble. Then puts everything back: on a Plus the page is paged
; out and the ASIC locked again (the library's own unlock state is kept: it
; is "locked" until __PL_ENSURE); on a machine with none the RMR is
; rewritten with the value it had (the RMR2 write was an ordinary RMR write
; there: mode 0..3 as it had, both ROMs off, interrupt counter reset) and
; the byte at &4000 is restored.
; Needs both ROMs off (the normal state of a program) and &4000 = RAM, a RAM
; bank or the ASIC page, none of them in use by an interrupt handler: runs
; with interrupts off, for about 150 T-states plus the sequences.
; Hardware: CRTC &BC00 writes, Gate Array &7Fxx (RMR/RMR2).
; Registers clobbered: AF, BC, DE, HL.
__PL_PROBE:
    PROC
    LOCAL __PP_ABSENT, __PP_DONE
    call __PL_DI
    ld   hl, $4000
    ld   e, (hl)            ; E = the original byte
    ld   a, e
    or   $80
    ld   d, a               ; D = test value, bit 7 set
    ld   (hl), d
    call __PL_UNLOCK_RAW    ; DE kept
    call __PL_RMR
    push af                 ; the RMR value, for a machine with no ASIC
    and  3
    or   $BC                ; RMR2: ASIC page in; as an RMR: mode, ROMs off
    ld   c, a
    ld   b, $7F
    out  (c), c
    ld   a, ($4000)
    cp   d
    jr   z, __PP_ABSENT     ; RAM answered
    ld   a, (PLUS_RMR2)     ; Plus: page out, put the byte back, lock again
    ld   c, a
    out  (c), c
    ld   hl, $4000
    ld   (hl), e
    pop  af
    ld   a, (PLUS_UNLK)
    or   a
    call z, __PL_LOCK_RAW
    ld   a, 1
    jr   __PP_DONE
__PP_ABSENT:
    pop  af
    ld   c, a
    out  (c), c             ; the RMR as it was
    ld   hl, $4000
    ld   (hl), e
    ld   a, 2
__PP_DONE:
    ld   (PLUS_PRES), a
    jp   __PL_EI
    ENDP

; __PL_ENSURE -- the ASIC is there and unlocked: carry set; no ASIC: carry
; clear (and nothing was changed). Probes on first use, unlocks on first
; use after that (or after PlusLock). Safe with interrupts on or off.
; Registers clobbered: AF, BC, DE, HL.
__PL_ENSURE:
    PROC
    LOCAL __PE_KNOWN, __PE_NO, __PE_YES
    ld   a, (PLUS_PRES)
    or   a
    jr   nz, __PE_KNOWN
    call __PL_PROBE
    ld   a, (PLUS_PRES)
__PE_KNOWN:
    dec  a
    jr   nz, __PE_NO
    ld   a, (PLUS_UNLK)
    or   a
    jr   nz, __PE_YES
    call __PL_DI
    call __PL_UNLOCK_RAW
    ld   a, 1
    ld   (PLUS_UNLK), a
    call __PL_EI
__PE_YES:
    scf
    ret
__PE_NO:
    or   a
    ret
    ENDP

; __PL_ENSURE2 -- __PL_ENSURE that keeps BC, DE and HL (A is lost).
__PL_ENSURE2:
    push hl
    push de
    push bc
    call __PL_ENSURE
    pop  bc
    pop  de
    pop  hl
    ret

; __PL_AVAIL -- A = 1 on a Plus/GX4000, 0 otherwise. Leaves the ASIC locked
; as it found it (probing unlocks it for an instant).
; Registers clobbered: AF, BC, DE, HL.
__PL_AVAIL:
    ld   a, (PLUS_PRES)
    or   a
    call z, __PL_PROBE
    ld   a, (PLUS_PRES)
    cp   1
    ld   a, 0
    ret  nz
    inc  a
    ret

; ---- paging ---------------------------------------------------------------

; __PL_IN / __PL_OUT -- for the library's own routines: the ASIC page in
; (interrupts off, their state kept) and out again (interrupts restored).
; Both do nothing while the program holds the page itself (PlusPageIn).
; Call __PL_ENSURE first. Hardware: Gate Array RMR2 (&7Fxx).
; Registers clobbered: AF, BC.
__PL_IN:
    ld   a, (PLUS_USER)
    or   a
    ret  nz
__PL_PIN:
    call __PL_DI
    ld   a, (PLUS_RMR2)
    or   $18                ; bits 4-3 = 11: the register page at &4000
    ld   c, a
    ld   b, $7F
    out  (c), c
    ret

__PL_OUT:
    ld   a, (PLUS_USER)
    or   a
    ret  nz
__PL_POUT:
    ld   a, (PLUS_RMR2)
    ld   c, a
    ld   b, $7F
    out  (c), c
    jp   __PL_EI

; __PL_USER_IN / __PL_USER_OUT -- PlusPageIn / PlusPageOut. Registers
; clobbered: AF, BC, DE, HL.
__PL_USER_IN:
    call __PL_ENSURE
    ret  nc
    ld   a, (PLUS_USER)
    or   a
    ret  nz
    call __PL_PIN
    ld   a, 1
    ld   (PLUS_USER), a
    ret

__PL_USER_OUT:
    ld   a, (PLUS_USER)
    or   a
    ret  z
    xor  a
    ld   (PLUS_USER), a
    jr   __PL_POUT

; __PL_UNLOCK -- PlusUnlock = __PL_ENSURE.
; __PL_LOCK -- PlusLock: page out if the program holds the page, then lock
; (only if the ASIC is a Plus and the library had unlocked it).
; Registers clobbered: AF, BC, DE, HL.
__PL_LOCK:
    ld   a, (PLUS_PRES)
    dec  a
    ret  nz
    ld   a, (PLUS_UNLK)
    or   a
    ret  z
    call __PL_USER_OUT
    call __PL_DI
    call __PL_LOCK_RAW
    xor  a
    ld   (PLUS_UNLK), a
    jp   __PL_EI

; ---- state ----------------------------------------------------------------

PLUS_PRES:  defb 0          ; 0 not probed, 1 Plus, 2 no ASIC
PLUS_UNLK:  defb 0          ; 1 = unlocked by the library
PLUS_USER:  defb 0          ; 1 = PlusPageIn is in force
PLUS_RMR2:  defb $A0        ; RMR2 value that means "page out" (lower ROM page 0 at &0000)
PLUS_IFF:   defb 0          ; interrupts were on (1) or off (0) before __PL_DI

    pop namespace

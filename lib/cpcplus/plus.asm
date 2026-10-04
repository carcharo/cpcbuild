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
; The window problem, and how a program of any size can use the library.
; While the page is in, &4000-&7FFF is not RAM: no code, data or stack may
; be there, and no interrupt handler may run (the music frame hook pages RAM
; banks there and reads song data from them; with the ASIC page in it would
; read and write ASIC registers). The program itself may reach into
; &4000-&7FFF (code and data up to &9DFF / &B7FF), so the library never runs
; code from the program while the page is in. Instead:
;   (1) the few instructions that page in, copy or poke, and page out are
;       the "trampoline" (PLX, PLX1W, PLX1R, PLXP below): about 50 bytes,
;       copied at start-up (#init CPC_INIT_PLUS) into the runtime's private
;       block (PL_TRAMP, sysvars.asm: firmware layout &9E00 + &300, bare
;       layout &BC00 + &300), which is outside &4000-&7FFF in both memory
;       maps, so the next instruction after the page-in write is always
;       fetched from RAM;
;   (2) the interrupt state is saved and interrupts go off before the
;       trampoline runs and come back after it returns (__PL_DI/__PL_EI):
;       a window is one ldir of at most 256 bytes (5.4k T-states, 1.4 ms;
;       the sprite picture copy) or a single byte (about 100 T-states);
;       the stack is the program's (&A200+ / &B800) and not touched by the
;       trampoline except for one push of the length;
;   (3) data that is itself in &4000-&7FFF (a sprite picture, a palette) is
;       first copied, 64 bytes at a time with interrupts off, into the
;       bounce buffer PL_BUF (private block, +&340), and from there into
;       the ASIC page. A source outside &4000-&7FFF goes straight in, one
;       window. The unpacking of packed pictures (two pixels per byte) is
;       also done into PL_BUF, 32 source bytes per window;
;   (4) nothing here uses the program's memory in &4000-&7FFF while the
;       page is in, so the library no longer reserves that range (the
;       compiler's CbReserve4000): programs may be as large as the memory
;       map allows. Only PlusPageIn/PlusPageOut, which hand the page to the
;       program, still do: the program's own code between them must be
;       outside the window.
; All library entry points run with the page out and interrupts as the
; caller had them (frame hooks, which run with interrupts off, may call
; them). While the program holds the page (PLUS_USER = 1, PlusPageIn:
; interrupts already off, program code below &4000) the library does the
; access directly instead.
;
; State, in the program image (zero at load, set by the first call):
;   PLUS_PRES 0 unknown, 1 Plus, 2 none     PLUS_UNLK 1 = the library has
;   unlocked the ASIC    PLUS_USER 1 = the program called PlusPageIn
;   PLUS_RMR2 the RMR2 value PlusPageIn puts back (&A0; the trampoline has
;   it built in)   PLUS_IFF  the interrupt state to restore   PLUS_FAST 1
;   = PLUS_UNLK = 1 and PLUS_USER = 0 (one byte to test for the fast paths
;   of the common calls; see "Cost" below)
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
; unlocks, pages the register page in (trampoline PLXP) and reads &4000: a
; CPC with no ASIC shows the byte it wrote, a Plus shows sprite 0's first
; pixel, which only has a low nibble. Then puts everything back: on a Plus
; the page is paged out and the ASIC locked again (the library's own unlock
; state is kept: it is "locked" until __PL_ENSURE); on a machine with none
; the RMR is rewritten with the value it had (the RMR2 write was an
; ordinary RMR write there: mode 0..3 as it had, both ROMs off, interrupt
; counter reset) and the byte at &4000 is restored. The byte at &4000 is
; the program's (it may be code or data of a large program): it is changed
; only inside the interrupt-off window and restored before it ends; the
; instructions run meanwhile are the trampoline's, in the private block.
; Needs both ROMs off (the normal state of a program) and &4000 = RAM or a
; RAM bank, none of them used by an interrupt handler: runs with interrupts
; off, for about 150 T-states plus the sequences.
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
    push de                 ; (E = the original byte, for later)
    call __PL_UNLOCK_RAW    ; DE kept
    call __PL_RMR
    ld   e, a               ; E = the RMR value, for a machine with no ASIC
    and  3
    or   $BC                ; RMR2: ASIC page in; as an RMR: mode, ROMs off
    ld   c, a
    call PLXP               ; Z = RAM answered (RMR rewritten), NZ = Plus (paged out)
    pop  de                 ; (flags kept)
    ld   hl, $4000
    ld   (hl), e            ; the byte back
    jr   z, __PP_ABSENT
    ld   a, (PLUS_UNLK)     ; Plus: lock again unless the library had unlocked it
    or   a
    call z, __PL_LOCK_RAW
    ld   a, 1
    jr   __PP_DONE
__PP_ABSENT:
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
    ld   a, (PLUS_USER)     ; PLUS_FAST: unlocked and the program not holding the page
    or   a
    jr   nz, __PE_HELD
    inc  a
    ld   (PLUS_FAST), a
__PE_HELD:
    scf
    ret
__PE_NO:
    or   a
    ret
    ENDP

; __PL_ENSURE2 -- __PL_ENSURE that keeps BC, DE and HL (A is lost). Unlocked
; already: 38 T-states with the call.
__PL_ENSURE2:
    ld   a, (PLUS_UNLK)
    or   a
    jr   z, __PE2_SLOW
    scf
    ret
__PE2_SLOW:
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

; ---- the trampoline: paged access from RAM outside &4000-&7FFF -----------

; Entry points, as offsets into the copy at PL_TRAMP (sysvars.asm). All
; are called with interrupts OFF (the callers below do that), the library
; unlocked and the program NOT holding the page. Each one pages the ASIC
; register page in with RMR2 (&7F, &B8: bits 7-5 = 101, bits 4-3 = 11),
; does its work, and pages out with &A0 (the reset value: bits 4-3 = 00).
; None touches the interrupt flag or anything in &4000-&7FFF but the ASIC
; page's own addresses.
; Hardware: Gate Array RMR2 (&7Fxx). The source below is assembled in the
; program and copied at start-up; it must stay position independent (only
; relative jumps) and fit in 64 bytes.
__PL_TRAMP_SRC:
; PLX -- HL = source, DE = destination, BC = length (1-256 and more):
; page in, LDIR, page out. One of the two addresses is in the ASIC page,
; the other is outside &4000-&7FFF (or in the bounce buffer). On return DE
; and HL are advanced by the length, BC is spoiled.
; Registers clobbered: AF (flags), BC; HL, DE advanced.
__PLX_L:
    push bc
    ld   bc, $7FB8
    out  (c), c
    pop  bc
    ldir
    ld   bc, $7FA0
    out  (c), c
    ret
; PLX1W -- A = value, HL = ASIC address: one byte written. HL kept.
; Registers clobbered: BC.
__PLX1W_L:
    ld   bc, $7FB8
    out  (c), c
    ld   (hl), a
    ld   bc, $7FA0
    out  (c), c
    ret
; PLX1R -- HL = ASIC address -> A = the byte read. HL kept.
; Registers clobbered: BC.
__PLX1R_L:
    ld   bc, $7FB8
    out  (c), c
    ld   a, (hl)
    ld   bc, $7FA0
    out  (c), c
    ret
; PLXP -- the probe (see __PL_PROBE): C = RMR2/RMR value to write, D = the
; test byte left in RAM at &4000, E = the RMR value to put back if RAM
; answers. Returns Z if &4000 read D (no ASIC: E written as the RMR), NZ if
; the ASIC page answered (paged out with &A0).
; Registers clobbered: AF, B.
__PLXP_L:
    ld   b, $7F
    out  (c), c
    ld   a, ($4000)
    cp   d
    jr   z, __PLXP_NO
    ld   c, $A0
    out  (c), c
    ret                     ; NZ
__PLXP_NO:
    ld   c, e
    out  (c), c
    ret                     ; Z
__PL_TRAMP_END:

PLX         EQU PL_TRAMP + (__PLX_L - __PL_TRAMP_SRC)
PLX1W       EQU PL_TRAMP + (__PLX1W_L - __PL_TRAMP_SRC)
PLX1R       EQU PL_TRAMP + (__PLX1R_L - __PL_TRAMP_SRC)
PLXP        EQU PL_TRAMP + (__PLXP_L - __PL_TRAMP_SRC)

; ---- the second trampoline block: whole windows and the handler entries ----

; PL_TRAMP2 = PL_TRAMP + &80 (the private block's &380-&3FF, free in both
; layouts; 128 bytes, 102 used). Entries, the "W" ones with the whole window
; inside (the interrupt state saved on the stack, interrupts off, page in,
; the stores, page out, state restored: no PLUS_IFF, no calls, so a window
; costs the stores plus about 90 T-states):
;   PLW2  E, D = the two bytes for HL and HL+1 (a palette entry, a word).
;   PLW4  HL = source (outside &4000-&7FFF), DE = destination: 4 bytes.
;   PLWM  HL = source (outside &4000-&7FFF, a table of 4-byte records),
;         E = destination low byte (the destination is &60xx), D = count
;         (1-16): 4 bytes each to destinations 8 bytes apart (the first
;         four registers of consecutive sprites); the table has 4 bytes a
;         record. On return E is advanced, D = &60.
; and the same without the interrupt handling, for raster handlers and
; frame hooks (interrupts already off; see "Handler context" below):
;   PLHI  page in (BC clobbered)           PLHO  page out (BC clobbered)
;   PLX2  HL = ASIC address, E, D = two bytes: in, stores, out. HL advanced.
; Clobbered: AF, BC, and the advanced HL, DE of PLW4/PLWM/PLX2.
__PL_TRAMP2_SRC:
__PLW2_L:
    ld   a, i
    jp   pe, PL_TRAMP2 + (__PLW2_D - __PL_TRAMP2_SRC)
    ld   a, i
__PLW2_D:
    di
    push af
    ld   bc, $7FB8
    out  (c), c
    ld   (hl), e
    inc  hl
    ld   (hl), d
    ld   c, $A0
    out  (c), c
    pop  af
    ret  po
    ei
    ret
__PLW4_L:
    ld   a, i
    jp   pe, PL_TRAMP2 + (__PLW4_D - __PL_TRAMP2_SRC)
    ld   a, i
__PLW4_D:
    di
    push af
    ld   bc, $7FB8
    out  (c), c
    ldi                     ; (BC counts down from &7FB8: B stays &7F)
    ldi
    ldi
    ldi
    ld   c, $A0
    out  (c), c
    pop  af
    ret  po
    ei
    ret
__PLWM_L:
    ld   a, i
    jp   pe, PL_TRAMP2 + (__PLWM_D - __PL_TRAMP2_SRC)
    ld   a, i
__PLWM_D:
    di
    push af
    ld   bc, $7FB8
    out  (c), c
    ld   b, d               ; B = count (C only counts down by 4 a record)
    ld   d, $60
__PLWM_LOOP:
    ldi
    ldi
    ldi
    ldi
    ld   a, e
    add  a, 4               ; the register block is 8 bytes a sprite
    ld   e, a
    djnz __PLWM_LOOP
    ld   bc, $7FA0
    out  (c), c
    pop  af
    ret  po
    ei
    ret
__PLHI_L:
    ld   bc, $7FB8
    out  (c), c
    ret
__PLHO_L:
    ld   bc, $7FA0
    out  (c), c
    ret
__PLX2_L:
    ld   bc, $7FB8
    out  (c), c
    ld   (hl), e
    inc  hl
    ld   (hl), d
    ld   c, $A0
    out  (c), c
    ret
__PL_TRAMP2_END:

; PL_TRAMP2 (= PL_TRAMP + $80) is defined in the runtime's sysvars.asm.
PLW2        EQU PL_TRAMP2 + (__PLW2_L - __PL_TRAMP2_SRC)
PLW4        EQU PL_TRAMP2 + (__PLW4_L - __PL_TRAMP2_SRC)
PLWM        EQU PL_TRAMP2 + (__PLWM_L - __PL_TRAMP2_SRC)
PLHI        EQU PL_TRAMP2 + (__PLHI_L - __PL_TRAMP2_SRC)
PLHO        EQU PL_TRAMP2 + (__PLHO_L - __PL_TRAMP2_SRC)
PLX2        EQU PL_TRAMP2 + (__PLX2_L - __PL_TRAMP2_SRC)

#init .core.CPC_INIT_PLUS

; CPC_INIT_PLUS -- copies the trampolines to the private block. #init
; routines run in sorted order after CPC_INIT_00_BOOTSTRAP, which zeroes
; the private block first. Interrupts are not touched.
; Registers clobbered: AF, BC, DE, HL.
CPC_INIT_PLUS:
    ld   hl, __PL_TRAMP_SRC
    ld   de, PL_TRAMP
    ld   bc, __PL_TRAMP_END - __PL_TRAMP_SRC
    ldir
    ld   hl, __PL_TRAMP2_SRC
    ld   de, PL_TRAMP2
    ld   bc, __PL_TRAMP2_END - __PL_TRAMP2_SRC
    ldir
    ret

; __PL_SRCOK -- HL = first, BC = length: carry set if the range is not
; empty, does not wrap past &FFFF and lies wholly below &4000 or from
; &8000 up (so it can be read while the ASIC page is in). Not empty only.
; Registers clobbered: AF, BC, DE, HL.
__PL_SRCOK:
    PROC
    LOCAL __SO_OK, __SO_NO
    ld   a, b
    or   c
    jr   z, __SO_NO
    ld   d, h
    ld   e, l               ; DE = first
    dec  bc
    add  hl, bc             ; HL = last
    jr   c, __SO_NO
    ld   a, h
    cp   $40
    jr   c, __SO_OK         ; last < &4000
    ld   a, d
    cp   $80
    jr   nc, __SO_OK        ; first >= &8000
__SO_NO:
    or   a
    ret
__SO_OK:
    scf
    ret
    ENDP

; __PL_POKE -- A = value, HL = ASIC address (&4000-&7FFF): one byte, in a
; window of about 100 T-states with interrupts off. HL kept. While the
; program holds the page it is a plain store.
; Hardware: RMR2. Registers clobbered: AF, BC, D.
__PL_POKE:
    ld   d, a
    ld   a, (PLUS_USER)
    or   a
    jr   z, __PK_GO
    ld   a, d
    ld   (hl), a
    ret
__PK_GO:
    call __PL_DI
    ld   a, d
    call PLX1W
    jp   __PL_EI

; __PL_PEEK -- HL = ASIC address -> A = the byte. HL kept.
; Hardware: RMR2. Registers clobbered: AF, BC, D.
__PL_PEEK:
    ld   a, (PLUS_USER)
    or   a
    jr   z, __PR_GO
    ld   a, (hl)
    ret
__PR_GO:
    call __PL_DI
    call PLX1R
    ld   d, a
    call __PL_EI
    ld   a, d
    ret

; __PL_PUT -- HL = source (anywhere), DE = destination in the ASIC page,
; BC = length (not 0): copies. A source wholly outside &4000-&7FFF goes in
; one window (the whole length, interrupts off for 21 T-states a byte); one
; that touches it is bounced through PL_BUF, 64 bytes per window. Both
; end with the interrupt state as it was. While the program holds the page
; it is a plain LDIR.
; Hardware: RMR2. Registers clobbered: AF, BC, DE, HL.
__PL_PUT:
    PROC
    LOCAL __PT_CHK, __PT_LOOP, __PT_FULL, __PT_N, __PT_DIRECT
    ld   a, (PLUS_USER)
    or   a
    jr   z, __PT_CHK
    ldir
    ret
__PT_CHK:
    push hl
    push de
    push bc
    call __PL_SRCOK
    pop  bc
    pop  de
    pop  hl
    jr   c, __PT_DIRECT
__PT_LOOP:                  ; the bounce: one chunk per window
    call __PL_DI
    push bc                 ; remaining
    push de                 ; destination
    ld   a, b
    or   a
    jr   nz, __PT_FULL
    ld   a, c
    cp   64
    jr   c, __PT_N
__PT_FULL:
    ld   a, 64
__PT_N:
    ld   c, a
    ld   b, 0
    ld   de, PL_BUF
    ldir                    ; HL = source + n, BC = 0
    pop  de                 ; destination
    push hl                 ; source + n
    ld   c, a
    ld   hl, PL_BUF
    call PLX                ; DE = destination + n, HL = PL_BUF + n
    ld   bc, PL_BUF
    or   a
    sbc  hl, bc             ; HL = n
    ld   b, h
    ld   c, l
    pop  hl                 ; source + n
    ex   (sp), hl           ; HL = remaining, (SP) = source + n
    or   a
    sbc  hl, bc
    ld   b, h
    ld   c, l               ; BC = remaining - n
    pop  hl                 ; source + n
    call __PL_EI            ; (AF only)
    ld   a, b
    or   c
    jr   nz, __PT_LOOP
    ret
__PT_DIRECT:
    call __PL_DI
    call PLX
    jp   __PL_EI
    ENDP

; __PL_PUTP -- HL = source (anywhere) of B * 32 packed bytes (two pixels
; per byte, the left one in the high nibble), DE = destination in the ASIC
; page, which gets B * 64 bytes, one pixel per byte (low nibble): each 32
; source bytes are unpacked into PL_BUF and copied in one window (while the
; program holds the page: a plain LDIR instead of the trampoline).
; Hardware: RMR2. Registers clobbered: AF, BC, DE, HL.
__PL_PUTP:
    PROC
    LOCAL __PU_CHUNK, __PU_LOOP, __PU_TRAMP, __PU_NEXT
__PU_CHUNK:
    call __PL_DI
    push bc                 ; chunks left in B
    push de                 ; destination
    ld   de, PL_BUF
    ld   b, 32
__PU_LOOP:
    ld   a, (hl)
    inc  hl
    ld   c, a
    rrca
    rrca
    rrca
    rrca
    and  $0F
    ld   (de), a
    inc  de
    ld   a, c
    and  $0F
    ld   (de), a
    inc  de
    djnz __PU_LOOP
    pop  de                 ; destination
    push hl                 ; next source
    ld   hl, PL_BUF
    ld   bc, 64
    ld   a, (PLUS_USER)
    or   a
    jr   z, __PU_TRAMP
    ldir                    ; the program holds the page
    jr   __PU_NEXT
__PU_TRAMP:
    call PLX                ; DE = destination + 64
__PU_NEXT:
    pop  hl                 ; next source
    pop  bc                 ; B = chunks left
    dec  b
    call __PL_EI            ; (AF only)
    ld   a, b
    or   a
    jr   nz, __PU_CHUNK
    ret
    ENDP

; ---- paging ---------------------------------------------------------------

; __PL_PIN / __PL_POUT -- PlusPageIn / PlusPageOut's own page in (interrupts
; off, their state kept) and out again (interrupts restored). They run in
; program code, so a program that uses them is built with &4000-&7FFF
; reserved (CbReserve4000 in cpcplus.bas): the library and the program's own
; code between the two calls are below &4000. Call __PL_ENSURE first.
; Hardware: Gate Array RMR2 (&7Fxx). Registers clobbered: AF, BC.
__PL_PIN:
    call __PL_DI
    ld   a, (PLUS_RMR2)
    or   $18                ; bits 4-3 = 11: the register page at &4000
    ld   c, a
    ld   b, $7F
    out  (c), c
    ret

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
    xor  a
    ld   (PLUS_FAST), a
    ret

__PL_USER_OUT:
    ld   a, (PLUS_USER)
    or   a
    ret  z
    xor  a
    ld   (PLUS_USER), a
    ld   a, (PLUS_UNLK)
    ld   (PLUS_FAST), a
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
    ld   (PLUS_FAST), a
    jp   __PL_EI

; ---- handler context: raster handlers and frame hooks ------------------------
;
; Public entry points for machine-code routines that run with interrupts
; already off (a raster handler, RasterIntAt; a frame hook) and want to
; touch the ASIC in some tens of T-states instead of through the BASIC calls'
; window (interrupt state save and restore, probe check, trampoline). They
; never touch the interrupt flag and never call the firmware. Call them as
; `call .core.PlusHandlerIn` etc. from an ASM block.
;
; Rules (breaking them writes into the program's RAM or switches the
; screen mode of a CPC without ASIC):
;   - only on a Plus/GX4000 (test PlusAvailable() before installing the
;     handler) and only after PlusUnlock() (or any library call that
;     unlocks) and while not PlusLock'ed. PlusHandlerIn/Out cannot check;
;     the others below test the unlock flag and do nothing when it is 0.
;   - interrupts off throughout (they are, in a raster handler or frame
;     hook; nothing may EI between PlusHandlerIn and PlusHandlerOut).
;   - PlusHandlerIn/Out run from the private block, so the instruction
;     after the call, wherever the handler is, is fetched from RAM. But
;     between them the ASIC page replaces &4000-&7FFF: the handler's code
;     it runs there, the data it reads or writes there and the stack must
;     all lie OUTSIDE &4000-&7FFF (the stack is the program's, &A200 up in
;     firmware mode and &B800 down in bare mode: fine), so code for a
;     handler that uses In/Out directly is placed below &4000 or from
;     &8000 up. The PlusHandler* routines below that do their own paging
;     have no such restriction.
;   - the RMR2 value the page-out writes is &A0 (lower ROM page 0 at
;     &0000), the library's usual.
;
; PlusHandlerIn  -- the ASIC register page at &4000-&7FFF (RMR2 &B8).
;     Hardware: Gate Array. Clobbers BC. 49 T-states with the call.
; PlusHandlerOut -- RAM at &4000-&7FFF again (RMR2 &A0). Clobbers BC.
;     49 T-states with the call. Between the two, stores straight to the
;     ASIC addresses: `ld ($6400), de` is a pen 0 colour (E = red << 4 |
;     blue, D = green), `ld ($6420), de` the border, `ld a, n : ld ($6804),
;     a` the scroll register, 20 T-states for the word and 13 for the byte.
PlusHandlerIn   EQU PLHI
PlusHandlerOut  EQU PLHO

; ---- state ----------------------------------------------------------------

PLUS_PRES:  defb 0          ; 0 not probed, 1 Plus, 2 no ASIC
PLUS_UNLK:  defb 0          ; 1 = unlocked by the library
PLUS_USER:  defb 0          ; 1 = PlusPageIn is in force
PLUS_RMR2:  defb $A0        ; RMR2 value that means "page out" (lower ROM page 0 at &0000)
PLUS_IFF:   defb 0          ; interrupts were on (1) or off (0) before __PL_DI
PLUS_FAST:  defb 0          ; 1 = unlocked and PLUS_USER = 0: the fast paths (set by __PL_ENSURE,
                            ; cleared by PlusPageIn and PlusLock, set again by PlusPageOut)

    pop namespace

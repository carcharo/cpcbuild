; ----------------------------------------------------------------
; loader.asm -- Starfall's disc loader (CPC). RUN"DISC loads and runs the
; right build: the 6128's (double-buffered, extra RAM) or the 464's.
;
; Plain Z80 for the Boriel assembler (zxbasm), run by the firmware like
; any binary: no runtime, so it has the firmware's own state and the game
; starts exactly as with RUN"STARFALL". It is at &8000 (the game builds end
; below &4000); a 2 KB AMSDOS buffer follows at &8800.
;
; Is there extra RAM? The test of cpcbuild's CPC_INIT_BANKS (lib/cpcbuild/
; banks.asm, the same as BankAvailable()): write the complement of the byte
; at &4000 with extra bank 0 selected, and see if main RAM kept its own;
; every byte touched is put back. TODO(banks): this stays a stand-alone
; copy of the test because a Boriel loader would need the runtime and a
; firmware hand-over; BankAvailable() is the same code.
; ----------------------------------------------------------------

        org $8000

CAS_IN_OPEN     equ $BC77
CAS_IN_DIRECT   equ $BC83
CAS_IN_CLOSE    equ $BC7A
TXT_OUTPUT      equ $BB5A
KL_INIT_BACK    equ $BCCE
BUFFER          equ $8800

start:
        di
        ld hl, $4000
        ld d, (hl)              ; D = main RAM's byte
        ld bc, $7FC4
        out (c), c              ; extra bank 0 in (a 464/664 ignores this)
        ld e, (hl)              ; E = bank 0's byte
        ld a, d
        cpl
        ld (hl), a              ; the complement
        ld c, $C0
        out (c), c              ; main RAM back
        ld a, (hl)
        cp d
        jr nz, absent           ; the write went to main RAM: no extra RAM
        ld c, $C4
        out (c), c
        ld a, (hl)
        cpl
        cp d                    ; Z: it stuck in the bank
        ld (hl), e              ; bank 0's byte restored
        ld c, $C0
        out (c), c
        jr nz, no64
        ei
        ld hl, name6128
        ld b, name6128_end - name6128
        jr load
absent:
        ld (hl), d              ; main RAM's byte restored
no64:
        ei
        ld hl, name464
        ld b, name464_end - name464

; HL = file name, B = its length. The firmware hands a program that RUN"
; started the tape's vectors (MC START PROGRAM), not the disc's: if the
; CAS_IN_OPEN entry is not AMSDOS's RST 3 (&DF), initialise AMSDOS again
; (KL_INIT_BACK for ROM 7 with the top of memory it was given at boot, so
; its workspace is where cpcbuild's runtime expects it), as BankLoad does.
load:
        ld a, ($BC77)
        cp $DF
        jr z, disc
        push hl
        push bc
        ld c, 7
        ld de, $0100
        ld hl, $B0FF
        call KL_INIT_BACK
        pop bc
        pop hl
        ld a, ($BC77)
        cp $DF
        jr nz, fail             ; no disc ROM
disc:
        ld de, BUFFER
        call CAS_IN_OPEN
        jr nc, fail
        push hl
        ld de, 26
        add hl, de              ; header + 26: the entry address
        ld e, (hl)
        inc hl
        ld d, (hl)
        pop hl
        push de                 ; the entry
        ld de, 21
        add hl, de              ; header + 21: the load address
        ld e, (hl)
        inc hl
        ld d, (hl)
        ex de, hl
        call CAS_IN_DIRECT
        jr nc, fail2
        call CAS_IN_CLOSE
        pop hl
        jp (hl)
fail2:
        pop hl
fail:
        ld hl, failmsg
nextc:
        ld a, (hl)
        or a
        jr z, hang
        call TXT_OUTPUT
        inc hl
        jr nextc
hang:   jr hang

name6128:       defm "STARFALL.BIN"
name6128_end:
name464:        defm "STARFA64.BIN"
name464_end:
failmsg:        defm "Starfall: cannot load the game", 13, 10, 0

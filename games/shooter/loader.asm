; ----------------------------------------------------------------
; loader.asm -- Starfall's disc loader (CPC). Two entries on the disc, one
; source:
;
;   RUN"DISC   (DISC.BIN, built from this file as it is) loads and runs the
;              right firmware build: the 6128's (double-buffered, extra RAM)
;              or the 464's (STARFALL.BIN or STARFA64.BIN).
;   RUN"BARE   (BARE.BIN, loader_bare.asm = "#define BARE" + this file) does
;              the same for the bare-metal builds (STARBARE.BIN, STARBA64.BIN:
;              no firmware, own interrupt handler and text). A bare program
;              cannot read the disc, so on a 6128 this loader first loads
;              STARFALL.DAT (the songs) and puts it into extra RAM bank 0
;              itself; the bare game finds it there. Then it loads the bare
;              binary and jumps to it: the bare boot takes the machine over
;              from there (the firmware is never entered again).
;
; Plain Z80 for the Boriel assembler (zxbasm), run by the firmware like
; any binary: no runtime, so it has the firmware's own state and the game
; starts exactly as with RUN"STARFALL". It is at &8000 (the game builds end
; below &4000, bare ones below &8000: they are loaded over &0040 upwards);
; a 2 KB AMSDOS buffer follows at &8800 and the songs' staging area at
; &9000.
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
DATBUF          equ $9000

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
        ld a, 1
        ld (has128), a
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
#ifdef BARE
        ld a, (has128)
        or a
        jr z, nodat
        push hl
        push bc
        ld hl, namedat
        ld b, namedat_end - namedat
        ld de, DATBUF           ; staged in main RAM, then copied to bank 0
        call readfile
        jr nc, nodata           ; no songs: the game runs silent
        call copydat
nodata:
        pop bc
        pop hl
nodat:
#endif
        ld de, 0                ; to the file's own load address
        call readfile
        jr nc, fail
        ld hl, (rf_entry)
        jp (hl)

; HL = file name, B = its length, DE = where to load it (0: the load
; address in its AMSDOS header). Carry set = loaded; rf_entry = its entry
; address, rf_len = its length.
readfile:
        ld (rf_dest), de
        ld de, BUFFER
        call CAS_IN_OPEN
        ret nc
        push hl
        ld de, 24
        add hl, de              ; header + 24: the length
        ld e, (hl)
        inc hl
        ld d, (hl)
        ld (rf_len), de
        inc hl
        ld e, (hl)              ; header + 26: the entry address
        inc hl
        ld d, (hl)
        ld (rf_entry), de
        pop hl
        ld de, 21
        add hl, de              ; header + 21: the load address
        ld e, (hl)
        inc hl
        ld d, (hl)
        ld hl, (rf_dest)
        ld a, h
        or l
        jr nz, rfgo
        ex de, hl
rfgo:
        call CAS_IN_DIRECT
        ret nc
        call CAS_IN_CLOSE
        scf
        ret

#ifdef BARE
; The staged file (rf_len bytes at DATBUF) into extra bank 0 at &4000. This
; code is at &8000, outside the paged range; interrupts are off while the
; bank is in (the firmware's handler is in main RAM, not touched, but there
; is no reason to take one).
copydat:
        ld bc, (rf_len)
        ld a, b
        or c
        ret z
        di
        push bc
        ld bc, $7FC4
        out (c), c              ; bank 0 at &4000-&7FFF
        pop bc
        ld hl, DATBUF
        ld de, $4000
        ldir
        ld bc, $7FC0
        out (c), c              ; main RAM back
        ei
        ret
#endif

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

#ifdef BARE
name6128:       defm "STARBARE.BIN"
name6128_end:
name464:        defm "STARBA64.BIN"
name464_end:
namedat:        defm "STARFALL.DAT"
namedat_end:
#else
name6128:       defm "STARFALL.BIN"
name6128_end:
name464:        defm "STARFA64.BIN"
name464_end:
#endif
failmsg:        defm "Starfall: cannot load the game", 13, 10, 0

has128:         defb 0          ; 1 = extra RAM (the 6128's build)
rf_dest:        defw 0
rf_len:         defw 0
rf_entry:       defw 0

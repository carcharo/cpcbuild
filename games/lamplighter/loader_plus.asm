; ----------------------------------------------------------------
; loader_plus.asm -- Lamplighter Plus's disc loader: RUN"PLUS loads and runs
; LAMPPLUS.BIN, the firmware build of Lamplighter Plus, on the 6128 Plus.
;
; Derived from Starfall's RUN"PLUS loader (games/shooter/loader.asm, MIT,
; Copyright 2026 Barry White): the PLUSLOAD part only, with the file name
; changed and the loader and its buffer moved to the top of user RAM, because
; the build of Lamplighter Plus is about 34 700 bytes and ends above &8000.
; Plain Z80 for the assembler (assembled by `cpcbas asm`), run by the
; firmware like any binary.
;
; Memory plan:
;   &9E00-&9EAB   this loader (171 bytes): the top of the user RAM below
;                 the firmware's workspace (HIMEM is about &A67B), and in the
;                 part of the heap (&8B60-&9DFF) that the program only clears
;                 after this loader has jumped to it
;   &9600-&9DFF   the 2 KB AMSDOS buffer (CAS_IN_OPEN needs it; it holds the
;                 header and the file's last partial sector), right below
;   &0040-...     the program, loaded over this: it must end below &9600
;                 (build_plus.sh checks it)
; ----------------------------------------------------------------

        org $9E00

CAS_IN_OPEN     equ $BC77
CAS_IN_DIRECT   equ $BC83
CAS_IN_CLOSE    equ $BC7A
TXT_OUTPUT      equ $BB5A
KL_INIT_BACK    equ $BCCE
BUFFER          equ $9600       ; 2 KB AMSDOS buffer: &9600-&9DFF, below the loader

start:
        ld hl, nameplus
        ld b, nameplus_end - nameplus

; HL = file name, B = its length. The firmware hands a program that RUN"
; started the tape's vectors (MC START PROGRAM), not the disc's: if the
; CAS_IN_OPEN entry is not AMSDOS's RST 3 (&DF), initialise AMSDOS again
; (KL_INIT_BACK for ROM 7 with the top of memory it was given at boot).
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

nameplus:       defm "LAMPPLUS.BIN"
nameplus_end:
failmsg:        defm "Lamplighter: cannot load the game", 13, 10, 0

rf_dest:        defw 0
rf_len:         defw 0
rf_entry:       defw 0

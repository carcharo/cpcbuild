; -----------------------------------------------------------------------
; cpcplus library -- the ASIC's three DMA sound channels
;
; Written from scratch for this project (MIT); see plus.asm for the ASIC
; page, the unlock and the paged access. Facts and sources: notes.md,
; Phase 7 P3 (Caprice32 asic.cpp asic_dma_cycle/asic_register_page_write,
; CPCEC cpcec.c; the cpcwiki pages were not reachable).
;
; What the hardware does. Each of channels 0-2 reads one 16-bit
; instruction from RAM per scan line (when enabled and not pausing) from
; its address register, and the address moves on by 2. Instructions (the
; word as stored, little endian: low byte at the lower address):
;   &0RDD  LOAD R,DD   write DD to AY register R (0-15)
;   &1NNN  PAUSE N     wait N * (prescaler + 1) scan lines
;   &2NNN  REPEAT N    remember the next instruction as the loop start,
;                      N more passes
;   &4000  NOP
;   &4001  LOOP        back to the loop start, N times (see REPEAT)
;   &4010  INT         raise an interrupt for the channel (the library
;                      does not handle it, see below)
;   &4020  STOP        the channel stops
;   The bits 12/13 (PAUSE and REPEAT) and the three bit flags 0, 4, 5 of
;   &4xxx can be combined by OR. Channel registers: &6C00 + 4n: address
;   low (bit 0 is ignored: lists are word aligned), address high,
;   prescaler (the lists' time unit is (prescaler + 1) lines of 64 us).
;   DCSR &6C0F: bits 0-2 enable channels 0-2 (a read gives the channel's
;   status), bits 6-4 interrupt pending of channels 0-2 (written 1 to
;   clear). A write of the enables replaces all of them; Caprice32 resets
;   a channel (address and prescaler to 0) whose enable is written as 0,
;   so every DCSR write here carries the enables of the channels the
;   library started (PLUS_DMAEN).
; Where the lists live. The ASIC reads the CPC's 64 KB RAM as it is (the
; first 64 KB: Caprice32 reads the RAM through the current RAM
; configuration, CPCEC the base 64 KB), not through the lower ROM, upper
; ROM or the ASIC register page: a list may lie anywhere in RAM, also in
; &4000-&7FFF while the register page is paged in. Keep lists out of the
; extra RAM banks (BankSelect) which are not what the DMA sees. A list
; that was started must stay in place and unchanged until it has run or
; DmaStop has been called.
; AY: the DMA writes the sound chip's registers by itself, with no regard
; for the program's own access; a program must not run the music player,
; BEEP, Play or AyWrite on the same registers at the same time, and in
; firmware mode the firmware's sound manager (SOUND, BEEP) writes the AY
; from the interrupt too: do not queue firmware sounds while DMA runs.
; INT: an INT instruction interrupts the CPU (IM 1 vector &0038) and
; stays pending until DCSR's bit for it is written; neither runtime
; handler acknowledges it, so do not use INT in lists.
;
; State (program image, zero at load): PLUS_DMAEN the enable bits the
; library wrote, PLUS_DMAPS the prescaler for each channel (applied by
; DmaStart: a DCSR write may reset it, see above).
; -----------------------------------------------------------------------

#include once <cpcplus/plus.asm>

    push namespace core

; __PL_DMASTART -- A = channel (0-2), HL = list address (even) -> A = 1
; started, 0 refused (bad channel, odd address, no ASIC). Writes the
; channel's address and prescaler (three bytes in one window, built on the
; stack), then DCSR = the library's enable bits | this channel's.
; Hardware: DMA registers &6C00-&6C0F. Registers clobbered: AF, BC, DE, HL.
__PL_DMASTART:
    PROC
    LOCAL __DS_FAIL, __DS_FAIL2, __DS_SH, __DS_SD
    cp   3
    jr   nc, __DS_FAIL
    bit  0, l
    jr   nz, __DS_FAIL
    push af                 ; channel
    push hl                 ; address
    call __PL_ENSURE
    jr   nc, __DS_FAIL2
    pop  de                 ; DE = address
    pop  af                 ; A = channel
    push af
    ld   c, a
    ld   b, 0
    ld   hl, PLUS_DMAPS
    add  hl, bc
    ld   l, (hl)
    ld   h, 0               ; HL = prescaler
    push hl                 ; the block: addr lo, addr hi, prescaler, 0
    push de
    add  a, a
    add  a, a
    ld   e, a
    ld   d, $6C             ; DE = &6C00 + 4 * channel
    ld   hl, 0
    add  hl, sp
    ld   bc, 3
    call __PL_PUT
    pop  hl
    pop  hl
    pop  af                 ; channel
    ld   b, a
    ld   a, 1
    inc  b
__DS_SH:
    dec  b
    jr   z, __DS_SD
    add  a, a
    jr   __DS_SH
__DS_SD:
    ld   hl, PLUS_DMAEN
    or   (hl)
    ld   (hl), a
    ld   hl, $6C0F
    call __PL_POKE
    ld   a, 1
    ret
__DS_FAIL2:
    pop  hl
    pop  af
__DS_FAIL:
    xor  a
    ret
    ENDP

; __PL_DMASTOP -- A = channel (0-2, else nothing): clears its enable bit
; and its pending interrupt bit (DCSR bits 0-2 = the library's remaining
; enables, bits 6-4 = 1 for this channel).
; Hardware: DCSR &6C0F. Registers clobbered: AF, BC, DE, HL.
__PL_DMASTOP:
    PROC
    LOCAL __DP_SH, __DP_SD
    cp   3
    ret  nc
    ld   e, a
    call __PL_ENSURE2       ; keeps E (and BC, DE, HL)
    ret  nc
    ld   b, e
    ld   a, 1
    ld   c, $40
    inc  b
__DP_SH:
    dec  b
    jr   z, __DP_SD
    add  a, a
    srl  c
    jr   __DP_SH
__DP_SD:                    ; A = 1 << channel, C = &40 >> channel
    cpl
    ld   hl, PLUS_DMAEN
    and  (hl)               ; the enables without this channel
    ld   (hl), a
    or   c                  ; | the interrupt clear bit
    ld   hl, $6C0F
    jp   __PL_POKE
    ENDP

; __PL_DMAACTIVE -- A = DCSR bits 0-2 (channel running), 0 without ASIC.
; Registers clobbered: AF, BC, DE, HL.
__PL_DMAACTIVE:
    call __PL_ENSURE
    jr   c, __DA_GO
    xor  a
    ret
__DA_GO:
    ld   hl, $6C0F
    call __PL_PEEK
    and  7
    ret

; __PL_DMAPRESC -- A = channel (0-2), E = prescaler: kept for the next
; DmaStart of that channel. Registers clobbered: AF, BC, HL.
__PL_DMAPRESC:
    cp   3
    ret  nc
    ld   c, a
    ld   b, 0
    ld   hl, PLUS_DMAPS
    add  hl, bc
    ld   (hl), e
    ret

PLUS_DMAEN: defb 0          ; enable bits written by the library
PLUS_DMAPS: defb 0, 0, 0    ; prescaler per channel

    pop namespace

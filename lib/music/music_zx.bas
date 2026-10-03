' ----------------------------------------------------------------
' music/music_zx.bas -- Arkos Tracker 3 music and sound effects
' (--arch zx48k, ZX Spectrum 128K)
'
' Included by music/music.bas on --arch zx48k. The API is the one of the
' CPC build (see music_cpc.bas for the full description of each call);
' only the machine differs.
'
'   MusicInit(song, subsong)   MusicFrame()   MusicStop()
'   SfxInit(effects)   SfxPlay(n, channel, invvol)   SfxStop(channel)
'   MusicAuto = 1 (default, interrupt-driven) or 0 (manual MusicFrame)
'
' 48K machines. There is no AY in a 48K Spectrum. Compile with -D ZX48
' and every call below is an empty stub (MusicInit, SfxPlay ... do
' nothing, MusicAuto exists), no player and no interrupt handler are
' included, and the game is silent. Song and effect data you #include
' still occupy memory: wrap them in #ifndef ZX48 ... #endif. Without
' -D ZX48 the code is the 128K one; run on a 48K it is harmless (port
' writes to a missing chip) but pointless, so build the 48K variant with
' -D ZX48.
'
' The player. Arkos Tracker 3.7's PlayerAkg for the Spectrum (AY ports
' &FFFD / &BFFD, 1773400 Hz period table, sound effects, full
' configuration), converted by tools/arkos/convert.sh into akg_zx.asm
' (about 3.3 KB). Copyright (c) 2016-2025 Julien Nevo, MIT licence
' (LICENSE.arkos). The rest of this file is MIT, written for this
' project. The player uses the stack, modifies its own code and clobbers
' IX, IY and the alternate registers, so every call into it runs with
' interrupts off and with all of those saved (as on the CPC).
'
' Frame hook: an IM2 handler. With MusicAuto = 1 MusicInit switches the
' CPU to interrupt mode 2 and the player is called once per frame (50 Hz)
' from the 50 Hz interrupt, whatever the program is doing. The handler:
'
'   1. saves AF BC DE HL IX IY and AF' BC' DE' HL';
'   2. calls PLY_AKG_Play if a song is active;
'   3. restores everything (IY included, which the ROM needs);
'   4. JPs to the ROM's interrupt routine at &0038.
'
' Step 4 is why the rest of the system keeps working: the ROM's IM1
' routine increments the FRAMES system variable (23672..23674: PAUSE,
' the program's own frame counts), scans the keyboard (INKEY$, INPUT,
' anything reading LAST-K) and does its EI/RET. So the music is a layer
' on top of the normal interrupt, and nothing the Boriel runtime relies
' on stops. (Boriel's stdlib IM2.bas, by contrast, replaces the ROM
' routine: FRAMES, PAUSE and INKEY$ stop working. This is why it isn't
' used here.) The ROM routine needs IY = 23610 (ERR-NR), which is why the
' handler restores IY; so don't rely on the ROM if your own program
' leaves IY somewhere else, as with any interrupt-driven Spectrum code.
' The cost is the player's tick (a fraction of a frame) plus about
' 300 T-states of register saving, before the ROM's routine.
'
' The vector table. In IM2 the CPU reads the handler's address from
' I*256 + (the byte the bus floats during the acknowledge), which is
' &FF on most machines but not on all (some interfaces put another
' value there). So the table is the robust one: 257 bytes of the same
' value V, and a `jp isr` at address V*257 (both address bytes V). Both
' live in a 512-byte block aligned to 256 inside the program image
' (page A: the table; page A+1: V = A+1, the jp at offset V). The block
' is filled in by MusicInit; it costs 512 bytes plus up to 255 of
' alignment. The program must therefore not be loaded above &FD00.
' MusicStop returns the CPU to IM1 and I to the value it had.
'
' Interrupts. IM2 is on from MusicInit (auto mode) until MusicStop, with
' interrupts enabled. The compiled code runs with interrupts enabled as
' usual, so the ROM routine's work (FRAMES, keyboard) goes on. Code of
' your own that must not be interrupted (it would be delayed by one tick
' at most) uses DI/EI as ever. Manual mode (MusicAuto = 0) leaves the ROM's
' IM1 untouched: call MusicFrame once per frame, right after the
' interrupt (WaitRetrace(1) from retrace.bas, or a HALT).
'
' Sound chip. While a song plays nothing else may drive the AY (PLAY
' and any AY register write from your program would fight the player;
' BEEP is fine, it uses the speaker). After MusicStop the chip is silent
' and free.
' ----------------------------------------------------------------

#ifndef __LIBRARY_MUSIC_ZX__
#define __LIBRARY_MUSIC_ZX__

#ifndef __ZX48K__
#error "music_zx.bas is for --arch zx48k only"
#endif

#pragma push(case_insensitive)
#pragma case_insensitive = TRUE

' MusicInit puts the player on the interrupt when this is non-zero (the
' default); 0 means manual MusicFrame calls. Read by MusicInit only.
DIM MusicAuto AS UBYTE = 1

#ifdef ZX48

' 48K build: nothing to play with. All calls do nothing.
sub MusicInit(song as uinteger, subsong as ubyte)
end sub

sub MusicFrame()
end sub

sub MusicStop()
end sub

sub SfxInit(effects as uinteger)
end sub

sub SfxPlay(n as ubyte, channel as ubyte, invvol as ubyte)
end sub

sub SfxStop(channel as ubyte)
end sub

#else

' The player (jumped over at program start), then our glue:
'
'   __MUSIC_RUN      in: DE = player routine; A, BC, HL = its arguments.
'                    DI, saves IX, IY and the alternate bank, calls it,
'                    restores, EI.
'   __MUSIC_IM2_ISR  the interrupt handler (see the header).
'   __MUSIC_IM2_ON   the vector table / jp stub block (512 bytes,
'                    256-aligned) is the label __MUSIC_IM2_TBL.
asm
    jp __MUSIC_GLUE_END
#include "akg_zx.asm"

__MUSIC_ACTIVE:
    db 0                        ; 1 while a song is playing
__MUSIC_SFX_READY:
    db 0                        ; 1 once SfxInit has been called
__MUSIC_IM2_ON:
    db 0                        ; 1 while our IM2 handler is installed
__MUSIC_OLD_I:
    db 0                        ; I register before we took it

__MUSIC_RUN:
    di
    push ix
    push iy
    ex af, af'
    push af                     ; AF'
    ex af, af'                  ; (the arguments in AF are back)
    exx
    push bc                     ; BC', DE', HL'
    push de
    push hl
    exx
    ld (__MUSIC_RUN_CALL + 1), de
__MUSIC_RUN_CALL:
    call 0                      ; operand patched above
    exx
    pop hl
    pop de
    pop bc
    exx
    ex af, af'
    pop af
    ex af, af'
    pop iy
    pop ix
    ei
    ret

; The IM2 handler: called with interrupts off.
__MUSIC_IM2_ISR:
    push af
    push bc
    push de
    push hl
    push ix
    push iy
    exx
    ex af, af'
    push af
    push bc
    push de
    push hl
    ld a, (__MUSIC_ACTIVE)
    or a
    jr z, __MUSIC_IM2_NOPLAY
    call PLY_AKG_Play
__MUSIC_IM2_NOPLAY:
    pop hl
    pop de
    pop bc
    pop af
    ex af, af'
    exx
    pop iy
    pop ix
    pop hl
    pop de
    pop bc
    pop af
    jp 0x0038                   ; the ROM's IM1 routine: FRAMES, keyboard, EI, RET

; Vector table block: page A = the 257-byte table, page A+1 = the jp stub
; at offset V = A+1. Filled by __MUSIC_IM2_START.
    align 256
__MUSIC_IM2_TBL:
    defs 512, 0

; Installs the handler (interrupts left enabled).
__MUSIC_IM2_START:
    di
    ld hl, __MUSIC_IM2_TBL
    ld a, h
    inc a                       ; A = V
    ld (hl), a
    ld d, h
    ld e, l
    inc de
    ld bc, 256
    ldir                        ; 257 bytes of V
    ld h, a
    ld l, a                     ; HL = V*257
    ld (hl), 0xC3               ; jp __MUSIC_IM2_ISR
    inc hl
    ld (hl), __MUSIC_IM2_ISR & 0xFF
    inc hl
    ld (hl), __MUSIC_IM2_ISR >> 8
    ld a, (__MUSIC_IM2_ON)
    or a
    jr nz, __MUSIC_IM2_STARTED  ; already on: keep the original I
    ld a, i
    ld (__MUSIC_OLD_I), a
__MUSIC_IM2_STARTED:
    ld a, __MUSIC_IM2_TBL >> 8
    ld i, a
    im 2
    ld a, 1
    ld (__MUSIC_IM2_ON), a
    ei
    ret

; Back to the ROM's interrupt mode (interrupts left enabled).
__MUSIC_IM2_STOP:
    ld a, (__MUSIC_IM2_ON)
    or a
    ret z
    di
    im 1
    ld a, (__MUSIC_OLD_I)
    ld i, a
    xor a
    ld (__MUSIC_IM2_ON), a
    ei
    ret

__MUSIC_GLUE_END:
end asm

' Starts a song. song: address of AKG song data (@name of an aks2bas.py
' include); subsong: 0 for the first. With MusicAuto <> 0 (default) it
' plays from the next frame by itself; otherwise the first tick plays at
' the next MusicFrame. Calling it while a song plays restarts with the
' new one.
sub MusicInit(song as uinteger, subsong as ubyte)
    asm
    xor a
    ld (__MUSIC_ACTIVE), a
    ld l, (ix+4)
    ld h, (ix+5)
    ld a, (ix+7)
    ld de, PLY_AKG_Init
    call __MUSIC_RUN
    ld a, 1
    ld (__MUSIC_ACTIVE), a
    end asm
    ' Hooked only now that the player is initialised and active.
    if MusicAuto <> 0 then
        asm
        call __MUSIC_IM2_START
        end asm
    else
        ' manual mode: take our own handler off if a previous song left it
        asm
        call __MUSIC_IM2_STOP
        end asm
    end if
end sub

' Manual mode: plays one tick of the song. Does nothing when no song is
' playing, or while the interrupt handler drives it.
sub MusicFrame()
    asm
    ld a, (__MUSIC_ACTIVE)
    or a
    jr z, __music_frame_done
    ld a, (__MUSIC_IM2_ON)
    or a
    jr nz, __music_frame_done
    ld de, PLY_AKG_Play
    call __MUSIC_RUN
__music_frame_done:
    end asm
end sub

' Stops the song (and any effect playing), takes the handler off (back to
' IM1) and silences the chip. Does nothing when no song is playing.
sub MusicStop()
    asm
    ld a, (__MUSIC_ACTIVE)
    or a
    jr z, __music_stop_done
    xor a
    ld (__MUSIC_ACTIVE), a      ; a tick from now on does nothing
    call __MUSIC_IM2_STOP
    ld de, PLY_AKG_Stop
    call __MUSIC_RUN
__music_stop_done:
    end asm
end sub

' Gives the player a sound-effects bank (address of AKX data, exported
' with aks2bas.py --psg spectrum). Call it once, before the first SfxPlay.
sub SfxInit(effects as uinteger)
    asm
    ld l, (ix+4)
    ld h, (ix+5)
    ld de, PLY_AKG_InitSoundEffects
    call __MUSIC_RUN
    ld a, 1
    ld (__MUSIC_SFX_READY), a
    end asm
end sub

' Plays effect n (1 = the first of the bank) on channel 0-2 (A, B, C) at
' inverted volume invvol (0 full ... 16 mute). Ignored if SfxInit hasn't
' been called, or n = 0, or channel > 2. An effect only sounds while the
' player ticks (a song must be playing).
sub SfxPlay(n as ubyte, channel as ubyte, invvol as ubyte)
    if n = 0 or channel > 2 then return
    if invvol > 16 then invvol = 16
    asm
    ld a, (__MUSIC_SFX_READY)
    or a
    jr z, __music_sfxplay_done
    ld a, (ix+5)
    ld c, (ix+7)
    ld b, (ix+9)
    ld de, PLY_AKG_PlaySoundEffect
    call __MUSIC_RUN
__music_sfxplay_done:
    end asm
end sub

' Stops the effect playing on channel 0-2 (nothing happens if none).
sub SfxStop(channel as ubyte)
    if channel > 2 then return
    asm
    ld a, (ix+5)
    ld de, PLY_AKG_StopSoundEffectFromChannel
    call __MUSIC_RUN
    end asm
end sub

#endif

#pragma pop(case_insensitive)

#endif

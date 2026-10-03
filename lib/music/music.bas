' ----------------------------------------------------------------
' music/music.bas -- Arkos Tracker 3 music and sound effects (--arch cpc)
'
'   #include <music/music.bas>        (compile with -I <cpcbuild>/lib)
'
'   MusicInit(song, subsong)   start playing a song (the address of AKG
'                              song data, e.g. @tune; subsong 0 is the
'                              first). Takes over the sound chip.
'   MusicFrame()               manual mode only (MusicAuto = 0): play one
'                              tick (one 50 Hz frame) of the song; call it
'                              once per frame, right after WaitRetrace(1).
'                              Does nothing when no song is playing, or
'                              while the frame hook drives the music (so a
'                              stray call can't double-tick it).
'   MusicStop()                stop the song and silence the chip
'   SfxInit(effects)           give the player a sound-effects bank (the
'                              address of AKX data, e.g. @sfx); once
'   SfxPlay(n, channel, invvol)  play effect n (1 = the first, never 0) on
'                              channel 0 (A, left), 1 (B) or 2 (C, right)
'                              at inverted volume invvol: 0 = full, 16 =
'                              mute. Replaces an effect already playing on
'                              that channel
'   SfxStop(channel)           stop whatever effect plays on that channel
'   MusicAuto                  1 (the default): interrupt-driven; 0: manual
'                              (set it before MusicInit; see below)
'
' The song and effects data come from Arkos Tracker 3 via
' tools/aks2bas.py, which turns an .aks file into an include:
'
'      python3 tools/aks2bas.py tune.aks tune.bas --name tune
'      python3 tools/aks2bas.py --sfx fx.aks fx.bas --name fx
'      ...
'      #include <music/music.bas>
'      #include "tune.bas"
'      #include "fx.bas"
'      MusicInit(@tune, 0)
'      SfxInit(@fx)
'
' Interrupt-driven by default. MusicInit registers the player on the
' runtime's frame hook (framehook.bas), so the song advances exactly one
' tick per frame, at a steady 50 Hz, whatever the main loop does: it keeps
' playing through PRINT, WaitRetrace, firmware calls and long calculations.
' It works in normal mode and in game mode (GameMode(1) from framehook.bas,
' which stops the firmware's interrupt work and saves most of its CPU
' load; the music, being on the hook, is unaffected). A program just calls
' MusicInit and forgets about it; MusicFrame is not needed.
'
' Manual mode: set MusicAuto = 0 before MusicInit and call MusicFrame once
' per frame yourself:
'
'      MusicAuto = 0
'      MusicInit(@tune, 0)
'      DO
'          WaitRetrace(1)
'          MusicFrame()
'          ... game ...
'      LOOP
'
' MusicStop removes the hook only if it is the music's (a program that
' has put its own routine on the hook keeps it). The hook's single slot
' is taken while a song plays in auto mode: don't use FrameHook yourself
' then (or use MusicAuto = 0 and call your own code from the frame loop).
'
' Effects advance when the song does (they are mixed into the player's
' frame), so MusicFrame must be running for them to be heard, and
' MusicStop silences them too. A song of 50 Hz ("replay frequency" in the
' tracker) wants one MusicFrame per frame; other frequencies are handled
' by the song itself (the player is called once per tick: a 25 Hz song
' wants MusicFrame every second frame, a 100 Hz one twice a frame ...).
'
' Sound chip ownership. The player writes the AY itself, straight to the
' PPI. While a song plays, nothing else may drive the chip: no BEEP, no
' SoundQueue, no Play, no AyWrite (AyRead is harmless). The firmware sound
' manager (BEEP/SOUND, SoundQueue) writes the AY from its 300 Hz interrupt
' whenever a note is queued, so MusicInit calls SoundStop (the firmware's
' SOUND_RESET) first, to make it idle; don't queue firmware sounds until
' after MusicStop (and call SoundStop again before you do). After
' MusicStop the chip is silent and free again. The player leaves the
' cassette motor/write bits of PPI port C cleared.
'
' Interrupts. The player takes over SP and modifies its own code, so
' every call into it runs with interrupts off. Each routine here does:
' DI; save IX, IY and the alternate bank (AF', BC', DE', HL': the runtime
' uses BC' and the carry of AF' for the firmware gate); call the player;
' restore; EI. They return with interrupts on, like all compiled code.
' The cost of a tick is the player's (see tests/conformance/music.bas
' for a measurement); MusicFrame adds about 250 T-states for the saving
' (the hook has its own wrapper).
'
' The hook routine is __MUSIC_CORE: the runtime calls it with interrupts
' off and every register already saved, so it only checks that a song is
' active and calls the player. __MUSIC_ACTIVE stays 0 until MusicInit's
' player initialisation (done under DI) has finished, so the hook can
' never run the player half-initialised. SfxPlay, SfxStop and SfxInit
' also run the player's code under DI, so they can't be interleaved with
' a hooked tick.
'
' Memory: the player is about 3.4 KB, plus its data tables. It is in the
' program image (&1000 up); with double buffering (display.bas) the whole
' program must fit &1000-&3FFF.
'
' The player is Arkos Tracker 3.7's PlayerAkg (CPC, sound effects, the
' full configuration), converted by tools/arkos/convert.sh into
' akg_cpc.asm. Copyright (c) 2016-2025 Julien Nevo, MIT licence
' (LICENSE.arkos). The rest of this file is MIT, written for this
' project.
' ----------------------------------------------------------------

#ifndef __LIBRARY_MUSIC__
#define __LIBRARY_MUSIC__

#ifndef __CPC__
#error "music.bas is for --arch cpc only"
#endif

#include <cpc.bas>
#include <framehook.bas>

#pragma push(case_insensitive)
#pragma case_insensitive = TRUE

' MusicInit puts the player on the frame hook when this is non-zero (the
' default); 0 means manual MusicFrame calls. Read by MusicInit only.
DIM MusicAuto AS UBYTE = 1

' The player (jumped over at program start), then our glue:
'
'   __MUSIC_RUN   in: DE = player routine; A, BC, HL = its arguments.
'                 DI, saves IX, IY and the alternate bank, calls it,
'                 restores, EI.
'   __MUSIC_CORE  the frame hook routine: with interrupts off and
'                 registers saved by the caller, plays one tick if a
'                 song is active.
'   __MUSIC_HOOKED  returns Z if the frame hook is ours (HL, DE, AF
'                 clobbered).
asm
    jp __MUSIC_GLUE_END
#include "akg_cpc.asm"

__MUSIC_ACTIVE:
    db 0                        ; 1 while a song is playing
__MUSIC_SFX_READY:
    db 0                        ; 1 once SfxInit has been called

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

__MUSIC_CORE:
    ld a, (__MUSIC_ACTIVE)
    or a
    ret z
    jp PLY_AKG_Play

__MUSIC_HOOKED:
    ld hl, (.core.FH_ADDR)
    ld de, __MUSIC_CORE
    or a
    sbc hl, de
    ret

__MUSIC_GLUE_END:
end asm

' Starts a song. song: address of AKG song data (@name of an aks2bas.py
' include); subsong: 0 for the first. With MusicAuto <> 0 (default) it
' plays from the next frame by itself; otherwise the first tick plays at
' the next MusicFrame. Silences the firmware sound manager first (see the
' header). Calling it while a song plays restarts with the new one.
sub MusicInit(song as uinteger, subsong as ubyte)
    SoundStop()
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
        ld hl, __MUSIC_CORE
        ld (.core.FH_ADDR), hl
        end asm
    else
        ' manual mode: take our own hook off if a previous song left it
        asm
        call __MUSIC_HOOKED
        jr nz, __music_init_nohook
        ld hl, 0
        ld (.core.FH_ADDR), hl
__music_init_nohook:
        end asm
    end if
end sub

' Manual mode: plays one tick of the song. Does nothing when no song is
' playing, or while the frame hook drives it.
sub MusicFrame()
    asm
    ld a, (__MUSIC_ACTIVE)
    or a
    jr z, __music_frame_done
    call __MUSIC_HOOKED
    jr z, __music_frame_done
    ld de, PLY_AKG_Play
    call __MUSIC_RUN
__music_frame_done:
    end asm
end sub

' Stops the song (and any effect playing), takes the music off the frame
' hook and silences the chip. Does nothing when no song is playing.
sub MusicStop()
    asm
    ld a, (__MUSIC_ACTIVE)
    or a
    jr z, __music_stop_done
    xor a
    ld (__MUSIC_ACTIVE), a      ; a hooked tick from now on does nothing
    call __MUSIC_HOOKED
    jr nz, __music_stop_nohook  ; the hook isn't ours: leave it
    ld hl, 0
    ld (.core.FH_ADDR), hl
__music_stop_nohook:
    ld de, PLY_AKG_Stop
    call __MUSIC_RUN
__music_stop_done:
    end asm
end sub

' Gives the player a sound-effects bank (address of AKX data). Call it
' once, before the first SfxPlay; any time, with or without a song.
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
' been called, or n = 0, or channel > 2. An effect only sounds while
' MusicFrame runs (a song must be playing).
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

#pragma pop(case_insensitive)

#endif

' ----------------------------------------------------------------
' music/music.bas -- Arkos Tracker 3 music and sound effects, for the
' Amstrad CPC (--arch cpc) and the ZX Spectrum 128K (--arch zx48k)
'
'   #include <music/music.bas>        (compile with -I <cpcbuild>/lib)
'
' One include, one API; the target is picked at compile time:
'
'   --arch cpc     music_cpc.bas  CPC player, driven by the runtime's
'                                 frame hook (framehook.bas)
'   --arch zx48k   music_zx.bas   Spectrum player, driven by an IM2
'                                 interrupt handler
'                  (-D ZX48 there: every call is a no-op, see music_zx.bas)
'
'   MusicInit(song, subsong)   start a song (address of AKG data, e.g.
'                              @tune; subsong 0 is the first)
'   MusicFrame()               manual mode only (MusicAuto = 0): play one
'                              50 Hz tick
'   MusicStop()                stop the song and silence the chip
'   SfxInit(effects)           give the player a sound-effects bank
'   SfxPlay(n, channel, invvol)  effect n (1 = first) on channel 0-2,
'                              inverted volume 0 (full) - 16 (mute)
'   SfxStop(channel)           stop the effect on that channel
'   MusicAuto                  1 (default): interrupt-driven; 0: manual
'
' Songs and effects come from tools/aks2bas.py. Song data is the same for
' both machines (AKG stores notes; the player has the period table of its
' sound chip). Effect banks (AKX) store periods: export them for the
' target with `aks2bas.py --psg cpc|spectrum`.
' ----------------------------------------------------------------

#ifndef __LIBRARY_MUSIC__
#define __LIBRARY_MUSIC__

#ifdef __CPC__
#include <music/music_cpc.bas>
#else
#ifdef __ZX48K__
#include <music/music_zx.bas>
#else
#error "music.bas supports --arch cpc and --arch zx48k only"
#endif
#endif

#endif

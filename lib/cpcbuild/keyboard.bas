' ----------------------------------------------------------------
' cpcbuild/keyboard.bas -- direct keyboard scan (--arch cpc)
'
'   ScanKeys()          reads the whole keyboard matrix straight from
'                       the hardware (no firmware call) into a buffer
'   KeyDown(key)        1 if that key was down at the last ScanKeys,
'                       else 0
'   AnyKeyDown()        1 if any key was down at the last ScanKeys
'
' key is a firmware key number (row * 8 + bit of the 10x8 matrix):
' use the KEY_ and JOY_ constants below. Call ScanKeys once per frame
' (e.g. after WaitRetrace) and then test as many keys as you like.
'
' ScanKeys leaves the PPI as the firmware expects it, so INKEY$, INPUT
' and the rest keep working. The firmware's own scan (in its interrupt
' handler, which runs all the time) still collects typed keys into its
' buffer; INPUT empties it when it starts. (INKEY$ is a direct scan of its
' own and does not use the buffer.)
' Two keys can "ghost" a third on the matrix, as on any CPC.
'
' Written from scratch for this project (MIT).
' ----------------------------------------------------------------

#ifndef __LIBRARY_CPCBUILD_KEYBOARD__
#define __LIBRARY_CPCBUILD_KEYBOARD__

#ifndef __CPC__
#error "cpcbuild is for --arch cpc only"
#endif

#define KEY_UP      0
#define KEY_RIGHT   1
#define KEY_DOWN    2
#define KEY_LEFT    8
#define KEY_ENTER   6
#define KEY_RETURN  18
#define KEY_SHIFT   21
#define KEY_CONTROL 23
#define KEY_ESC     66
#define KEY_DEL     79
#define KEY_SPACE   47
#define KEY_TAB     68

#define KEY_0 32
#define KEY_1 64
#define KEY_2 65
#define KEY_3 57
#define KEY_4 56
#define KEY_5 49
#define KEY_6 48
#define KEY_7 41
#define KEY_8 40
#define KEY_9 33

#define KEY_A 69
#define KEY_B 54
#define KEY_C 62
#define KEY_D 61
#define KEY_E 58
#define KEY_F 53
#define KEY_G 52
#define KEY_H 44
#define KEY_I 35
#define KEY_J 45
#define KEY_K 37
#define KEY_L 36
#define KEY_M 38
#define KEY_N 46
#define KEY_O 34
#define KEY_P 27
#define KEY_Q 67
#define KEY_R 50
#define KEY_S 60
#define KEY_T 51
#define KEY_U 42
#define KEY_V 55
#define KEY_W 59
#define KEY_X 63
#define KEY_Y 43
#define KEY_Z 71

#define JOY_UP    72
#define JOY_DOWN  73
#define JOY_LEFT  74
#define JOY_RIGHT 75
#define JOY_FIRE1 76
#define JOY_FIRE2 77

#pragma push(case_insensitive)
#pragma case_insensitive = TRUE

' No firmware calls. Clobbers nothing the compiler relies on.
sub fastcall ScanKeys()
    asm
    push namespace core
    call __CB_SCAN_KEYS
    pop namespace
    end asm
end sub

function fastcall KeyDown(key as ubyte) as ubyte
    asm
    push namespace core
    call __CB_KEY_DOWN
    pop namespace
    end asm
end function

function fastcall AnyKeyDown() as ubyte
    asm
    push namespace core
    call __CB_ANY_KEY
    pop namespace
    end asm
end function

#pragma pop(case_insensitive)

#require "cpcbuild/keys.asm"

#endif

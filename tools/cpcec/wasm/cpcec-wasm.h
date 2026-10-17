 //  ####  ######    ####  #######   ####  ------------------------- //
//  ##  ##  ##  ##  ##  ##  ##   #  ##  ##  CPCEC, plain text Amstrad //
// ##       ##  ## ##       ## #   ##       CPC emulator written in C //
// ##       #####  ##       ####   ##       as a postgraduate project //
// ##       ##     ##       ## #   ##       by Cesar Nicolas-Gonzalez //
//  ##  ##  ##      ##  ##  ##   #  ##  ##  since 2018-12-01 till now //
 //  ####  ####      ####  #######   ####  ------------------------- //

// cpcec-wasm.h -- CPCBuild's headless WebAssembly front end for CPCEC.
//
// Licence: GNU General Public License, version 3 or (at your option) any
// later version, like CPCEC itself. CPCEC is (C) Cesar Nicolas-Gonzalez;
// this file is a derivative of his SDL2 front end (cpcec-ox.h), keeping its
// key-code table and replacing everything that talked to SDL2 or drew a user
// interface. It is built with -DCPCEC_WASM by tools/cpcec/wasm/build-host.sh
// after host.patch has made cpcec.c and cpcec-rt.h include it instead of
// cpcec-ox.h.
//
// What this front end is: no SDL, no window, no menus, no dialogs, no blocking
// main loop. Video goes to a plain memory frame buffer that the core renders
// into, audio to a plain sample buffer, the keyboard is a bit map written by
// emu_key(), "timing" is a fake clock (the host decides when a frame runs),
// and files are ordinary stdio calls that Emscripten's virtual file system
// serves. The exported API (emu_init, emu_frame, ...) lives in
// cpcec-wasm-api.h, included at the end of cpcec.c.

#include <stdint.h>
#include <limits.h>
#include <unistd.h>
#include <sys/stat.h>
#include <dirent.h>
#include <math.h>
#define SDL_pow pow // the core spells libm through SDL's names

#define SDL_BIG_ENDIAN 4321
#define SDL_LIL_ENDIAN 1234
#define SDL_BYTEORDER SDL_LIL_ENDIAN // WebAssembly is little-endian
#define SDL_MAIN_HANDLED // makes the core report errors with printf() instead of a dialog

#define STRMAX 1024
#define PATHCHAR '/'
#define fsetsize(f,l) (!ftruncate(fileno(f),(l)))
#define INT8 int8_t
#define BYTE uint8_t
#define WORD uint16_t
#define DWORD uint32_t
#define ARGVZERO argv[0]
#define I18N_MULTIPLY "x"
#define MESSAGEBOX_WIDETAB "\t\t"
#define GPL_3_LF "\n"

typedef int16_t AUDIO_UNIT; // 16-bit signed samples, interleaved stereo
#define AUDIO_BITDEPTH 16
#define AUDIO_ZERO 0
#define AUDIO_BYTESTEP (AUDIO_CHANNELS*AUDIO_BITDEPTH/8)
typedef DWORD VIDEO_UNIT; // 0X00RRGGBB

VIDEO_UNIT *menus_frame; // unused (no user interface), kept because shared code names it
VIDEO_UNIT *video_frame,*video_blend; // the frame buffer the core renders into, and its blend buffer
VIDEO_UNIT *debug_frame; // unused
AUDIO_UNIT audio_frame[AUDIO_PLAYBACK/50*AUDIO_CHANNELS]; // audio frame; 50 is the lowest legal framerate
VIDEO_UNIT *video_target;
AUDIO_UNIT *audio_target;
unsigned int session_joybits=0;
char session_path[STRMAX],session_parmtr[STRMAX],session_tmpstr[STRMAX],session_substr[STRMAX],session_info[STRMAX]="";

// SDL2 follows the USB keyboard standard, so we're using the same values here!

// function keys
#define KBCODE_F1	 58
#define KBCODE_F2	 59
#define KBCODE_F3	 60
#define KBCODE_F4	 61
#define KBCODE_F5	 62
#define KBCODE_F6	 63
#define KBCODE_F7	 64
#define KBCODE_F8	 65
#define KBCODE_F9	 66
#define KBCODE_F10	 67
#define KBCODE_F11	 68
#define KBCODE_F12	 69
// leftmost keys
#define KBCODE_ESCAPE	 41
#define KBCODE_TAB	 43
#define KBCODE_CAPSLOCK	 57
#define KBCODE_L_SHIFT	225
#define KBCODE_L_CTRL	224
//#define KBCODE_L_ALT	226 // trapped by Win32
// alphanumeric row 1
#define KBCODE_1	 30
#define KBCODE_2	 31
#define KBCODE_3	 32
#define KBCODE_4	 33
#define KBCODE_5	 34
#define KBCODE_6	 35
#define KBCODE_7	 36
#define KBCODE_8	 37
#define KBCODE_9	 38
#define KBCODE_0	 39
#define KBCODE_CHR1_1	 45
#define KBCODE_CHR1_2	 46
#define KBCODE_CHR4_5	100 // this is the key before "1" in modern keyboards
// alphanumeric row 2
#define KBCODE_Q	 20
#define KBCODE_W	 26
#define KBCODE_E	  8
#define KBCODE_R	 21
#define KBCODE_T	 23
#define KBCODE_Y	 28
#define KBCODE_U	 24
#define KBCODE_I	 12
#define KBCODE_O	 18
#define KBCODE_P	 19
#define KBCODE_CHR2_1	 47
#define KBCODE_CHR2_2	 48
// alphanumeric row 3
#define KBCODE_A	  4
#define KBCODE_S	 22
#define KBCODE_D	  7
#define KBCODE_F	  9
#define KBCODE_G	 10
#define KBCODE_H	 11
#define KBCODE_J	 13
#define KBCODE_K	 14
#define KBCODE_L	 15
#define KBCODE_CHR3_1	 51
#define KBCODE_CHR3_2	 52
#define KBCODE_CHR3_3	 49
// alphanumeric row 4
#define KBCODE_Z	 29
#define KBCODE_X	 27
#define KBCODE_C	  6
#define KBCODE_V	 25
#define KBCODE_B	  5
#define KBCODE_N	 17
#define KBCODE_M	 16
#define KBCODE_CHR4_1	 54
#define KBCODE_CHR4_2	 55
#define KBCODE_CHR4_3	 56
#define KBCODE_CHR4_4	 53 // this is the key before "Z" in 105-key modern keyboards; missing in 104-key layouts!
// rightmost keys
#define KBCODE_SPACE	 44
#define KBCODE_BKSPACE	 42
#define KBCODE_ENTER	 40
#define KBCODE_R_SHIFT	229
#define KBCODE_R_CTRL	228
// #define KBCODE_R_ALT	230 // trapped by Win32
// extended keys
// #define KBCODE_PRINT	 70 // trapped by Win32
#define KBCODE_SCR_LOCK	 71
#define KBCODE_HOLD	 72
#define KBCODE_INSERT	 73
#define KBCODE_DELETE	 76
#define KBCODE_HOME	 74
#define KBCODE_END	 77
#define KBCODE_PRIOR	 75
#define KBCODE_NEXT	 78
#define KBCODE_UP	 82
#define KBCODE_DOWN	 81
#define KBCODE_LEFT	 80
#define KBCODE_RIGHT	 79
#define KBCODE_APPS	101
// numeric keypad
#define KBCODE_NUM_LOCK	 83
#define KBCODE_X_7	 95
#define KBCODE_X_8	 96
#define KBCODE_X_9	 97
#define KBCODE_X_4	 92
#define KBCODE_X_5	 93
#define KBCODE_X_6	 94
#define KBCODE_X_1	 89
#define KBCODE_X_2	 90
#define KBCODE_X_3	 91
#define KBCODE_X_0	 98
#define KBCODE_X_DOT	 99
#define KBCODE_X_ENTER	 88
#define KBCODE_X_ADD	 87
#define KBCODE_X_SUB	 86
#define KBCODE_X_MUL	 85
#define KBCODE_X_DIV	 84
#define usbkey2native memcpy // no translation is needed;
#define native2usbkey(str,n) // the SDL2 keyboard is USB!
BYTE kbd_k2j[]= // these keys can simulate a 4-button joystick
	{ KBCODE_UP, KBCODE_DOWN, KBCODE_LEFT, KBCODE_RIGHT, KBCODE_Z, KBCODE_X, KBCODE_C, KBCODE_V };

unsigned char kbd_map[256]; // key-to-key translation map

char wildcard[]="*",basepath[8<<9];
#define makebasepath(s) realpath((s),basepath)

void session_please(void) { session_wait=1; }
void session_thanks(void) { session_wait=0; }
void session_kbdclear(void) { joy_kbd=joy_bit=session_joybits=0; MEMZERO(kbd_bit); }
#define session_kbdreset() MEMBYTE(kbd_map,~~~0)
void session_kbdsetup(const unsigned char *s,int l)
{
	session_kbdclear();
	while (l--) { int k=*s++; kbd_map[k]=*s++; }
}
int session_k2joy(int k)
{
	if (session_key2joy) for (int i=0;i<KBD_JOY_UNIQUE;++i) if (kbd_k2j[i]==k) return i-8;
	return kbd_map[k];
}

BYTE session_hidemenu=0; // the cmd-line option -$ (alternative UI style) means nothing here
int getftype(const char *s) // <0 = invalid path / nothing, 0 = file, >0 = directory
{
	struct stat a; int i; return (!s||!*s)?-1:(i=stat(s,&a))>=0?S_ISDIR(a.st_mode):i;
}
#define session_clrscr() ((void)0)
#define session_clock (1000) // fake clock unit: one tick per millisecond
int session_fake_ticks=0; // advanced by 20 ms per emulated frame by emu_frame()
int session_ticks(void) { return session_fake_ticks; }
int session_r_x,session_r_y,session_r_w,session_r_h;
int session_resize(void) { return 0; }
#define session_drawme() ((void)0) // the host reads the frame buffer after emu_frame()
void session_redraw(int q) { (void)q; }
void session_playme(void) {}
char *session_blitinfo(void) { return "wasm"; }
#define session_title(s) ((void)0)
#define session_sleep() ((void)0)
#define session_delay(i) ((void)0)
#define audio_mustsync() ((void)0)
#define audio_resyncme()
int session_queue(void) { return 0; } // no events: the host calls emu_key() and friends
int session_joy2k(void) { return session_joybits; }
void session_backupvideo(VIDEO_UNIT *t);

// no user interface: menus, dialogs and the graphical debugger do not exist here

void session_ui_makechrs(void) {}
int session_ui_fileflags=0;
void session_menuflags(int id,int a,int z,BYTE q,BYTE r) { (void)id,(void)a,(void)z,(void)q,(void)r; }
#define session_menucheck(id,q) ((void)0)
#define session_menuradio(id,a,z) ((void)0)
int session_message(char *s,char *t) { fprintf(stderr,"cpcec: %s: %s\n",t,s); return 0; }
int session_aboutme(char *s,char *t) { return session_message(s,t); }
#define session_line(t) (-1)
int session_list(int i,char *s,char *t) { (void)i,(void)s,(void)t; return -1; }
#define session_scan(s) (-1)
#define session_filedialog_get_readonly() (session_ui_fileflags&1)
#define session_filedialog_set_readonly(q) (q?(session_ui_fileflags|=1):(session_ui_fileflags&=~1))
char *session_newfile(char *r,char *s,char *t) { (void)r,(void)s,(void)t; return NULL; }
char *session_getfile(char *r,char *s,char *t) { (void)r,(void)s,(void)t; return NULL; }
char *session_getfilereadonly(char *r,char *s,char *t,int q) { (void)r,(void)s,(void)t,(void)q; return NULL; }

INLINE char *session_create(char *s) // allocate the frame buffers; NULL OK
{
	(void)s; session_hardblit=0;
	if (!(video_frame=calloc(VIDEO_LENGTH_X*VIDEO_LENGTH_Y,sizeof(VIDEO_UNIT)))||
		!(video_blend=malloc(sizeof(VIDEO_UNIT[16+(VIDEO_PIXELS_Y>>!!VIDEO_HALFBLEND)*VIDEO_PIXELS_X]))))
		return "out of memory";
	sprintf(session_version,"%d.%d.%d",0,0,0);
	session_clean();
	return NULL;
}
INLINE void session_byebye(void) { free(video_frame); free(video_blend); video_frame=video_blend=NULL; }

#define BOOTSTRAP // main() is not used; see cpcec-wasm-api.h

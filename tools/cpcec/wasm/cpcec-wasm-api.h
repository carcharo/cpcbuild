// cpcec-wasm-api.h -- CPCBuild's exported API around CPCEC for WebAssembly.
//
// Licence: GNU General Public License, version 3 or (at your option) any
// later version, like CPCEC (C) Cesar Nicolas-Gonzalez, whose core this file
// drives. Included at the end of cpcec.c when built with -DCPCEC_WASM (see
// cpcec-wasm.h and host.patch). Nothing here blocks: the host calls
// emu_frame() whenever it wants the next 50 Hz frame.
//
// API version 1. All functions are plain C ints and pointers; pointers
// returned point into the module's linear memory and stay valid until the next
// call that says otherwise (the frame buffer never moves; it may be
// re-rendered by the next emu_frame()).

#include <emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE

int cpcec_start(int argc,char *argv[]); // main() of cpcec.c, renamed by the patch: set everything up
int cpcec_frame(void); // one pass of main()'s loop, see cpcec.c

#define EMU_FB_WIDTH VIDEO_PIXELS_X
#define EMU_FB_HEIGHT VIDEO_PIXELS_Y
#define EMU_REG_COUNT 24

static char emu_ready=0,emu_stop_why=0,emu_audio_ok=0;
static unsigned char emu_rgba_buf[VIDEO_PIXELS_X*VIDEO_PIXELS_Y*4];

EXPORT int emu_api_version(void) { return 1; }

// Machine models: 0 = CPC 464, 1 = CPC 664, 2 = CPC 6128, 3 = 6128 Plus (CPCEC's -m0..-m3).
// The ROM images (cpc464.rom, cpc664.rom, cpc6128.rom, cpcplus.rom and cpcados.rom, i.e. the files
// that come with CPCEC) must already be in the virtual file system's root directory "/".
// Calling it again re-creates the machine (media are ejected). Returns 0, or nonzero on error.
EXPORT int emu_init(int model)
{
	if (model<0||model>3) return 1;
	if (emu_ready) { disc_closeall(); tape_close(); session_byebye(); }
	char m[4]={'-','m',(char)('0'+model),0};
	char *argv[]={ "/cpcec", "--headless", m, "-k0", NULL }; // --headless here means: no config file, no real-time delays
	int argc=3; if (model<2) argc=4; // a stock 464/664 has 64 KB (the 6128 and Plus 128 KB), as in tools/cpcrun.py
	if (cpcec_start(argc,argv)) return 2;
	session_audio=1; audio_disabled=0; // headless mode would mute; the host wants samples
	debug_reset(); // arms the "run to return" trap safely
	emu_ready=1; emu_stop_why=0;
	return 0;
}

// Loads a disc image (.dsk), cartridge (.cpr/.crt), snapshot (.sna), tape (.cdt/.wav...) or firmware ROM
// from the virtual file system, exactly as CPCEC's "open any file" does (the format is detected from the
// content; `kind` is informational: "dsk", "cpr", "sna", ...). Discs and tapes are autorun: the machine is
// reset and the best program is started (RUN"NAME) once the firmware is up. Returns 0, or nonzero.
EXPORT int emu_load(const char *path,const char *kind)
{
	(void)kind; if (!emu_ready) return 1;
	return any_load((char*)path,1);
}
// After emu_load() of a disc: run this AMSDOS name instead of the one CPCEC picked ("" = leave it).
EXPORT void emu_set_run(const char *name)
{
	if (name&&*name) sprintf(autorun_s,"RUN\"%.40s",name);
}

// Runs one 50 Hz frame. Returns 0 when the frame is complete, 1 when a breakpoint or a step stopped the
// machine first (the machine then stays stopped: emu_frame() keeps returning 1 until emu_continue()).
EXPORT int emu_frame(void)
{
	if (!emu_ready) return 1;
	emu_audio_ok=audio_required;
	if (cpcec_frame())
	{
		if (!(session_signal&SESSION_SIGNAL_DEBUG)) session_signal|=SESSION_SIGNAL_DEBUG; // (already so)
		if (!emu_stop_why) emu_stop_why=1; // breakpoint (or run-to-return trap)
		return 1;
	}
	session_fake_ticks+=20;
	return 0;
}

// The picture of the finished frame: the 768x536 visible area (border included) of CPCEC's 1024x624 buffer.
// emu_framebuffer() points at its top-left pixel; pixels are 32-bit 0x00RRGGBB (bytes B,G,R,0), rows are
// emu_fb_stride() pixels apart. emu_rgba() instead returns a packed copy, 768*536*4 bytes of R,G,B,255
// (ready for ImageData).
EXPORT const unsigned *emu_framebuffer(void) { return video_frame?&video_frame[VIDEO_OFFSET_Y*VIDEO_LENGTH_X+VIDEO_OFFSET_X]:NULL; }
EXPORT int emu_fb_width(void) { return EMU_FB_WIDTH; }
EXPORT int emu_fb_height(void) { return EMU_FB_HEIGHT; }
EXPORT int emu_fb_stride(void) { return VIDEO_LENGTH_X; }
EXPORT const unsigned char *emu_rgba(void)
{
	if (!video_frame) return NULL;
	unsigned char *t=emu_rgba_buf; for (int y=0;y<VIDEO_PIXELS_Y;++y)
	{
		const VIDEO_UNIT *s=&video_frame[(VIDEO_OFFSET_Y+y)*VIDEO_LENGTH_X+VIDEO_OFFSET_X];
		for (int x=0;x<VIDEO_PIXELS_X;++x) { VIDEO_UNIT v=*s++; *t++=v>>16; *t++=v>>8; *t++=v; *t++=255; }
	}
	return emu_rgba_buf;
}

// Audio of the finished frame: 44100/50 = 882 stereo sample pairs of signed 16-bit samples (interleaved
// L,R). Copies them to `dst` (if not NULL, room for 882*2 int16) and returns the number of pairs, 0 if
// the core produced no sound this frame (tape fast-forward). emu_audio_buffer() is the internal buffer.
EXPORT int emu_audio(short *dst)
{
	if (!emu_audio_ok) return 0;
	if (dst) memcpy(dst,audio_frame,AUDIO_LENGTH_Z*AUDIO_CHANNELS*sizeof(AUDIO_UNIT));
	return AUDIO_LENGTH_Z;
}
EXPORT const short *emu_audio_buffer(void) { return audio_frame; }
EXPORT int emu_audio_rate(void) { return AUDIO_PLAYBACK; }

// Keyboard: `cpc_key` is the CPC keyboard matrix position, row*8+bit (0..79; e.g. 0x12 RETURN, 0x17
// CONTROL, 0x15 SHIFT, 0x2F SPACE... the numbers in the table of cpcec.c), `down` 1 or 0.
EXPORT void emu_key(int cpc_key,int down)
{
	if (cpc_key<0||cpc_key>127) return;
	if (down) kbd_bit_set(cpc_key); else kbd_bit_res(cpc_key);
}
// The same through CPCEC's key map: `usb` is a USB HID scancode (what SDL2 calls a scancode, e.g. 4 = A).
EXPORT void emu_key_usb(int usb,int down)
{
	if (usb<0||usb>255) return;
	int k=kbd_map[usb]; if (k<128) emu_key(k,down);
}
// Joystick 1 as bits: 1 up, 2 down, 4 left, 8 right, 16 fire 1, 32 fire 2 (0 = released).
EXPORT void emu_joy(int bits) { session_key2joy=1; joy_kbd=bits; }
// Releases every key and joystick bit.
EXPORT void emu_keys_release(void) { session_kbdclear(); }

// Resets the machine (the Reset button; discs, tapes and cartridges stay inserted).
EXPORT void emu_reset(void) { all_reset(); emu_stop_why=0; session_signal&=~SESSION_SIGNAL_DEBUG; }

// Debugger. Addresses and values are what the Z80 sees now (current ROM/RAM banking).
EXPORT int emu_peek(int addr) { return debug_peek((WORD)addr); }
EXPORT void emu_poke(int addr,int value) { debug_poke((WORD)addr,(BYTE)value); }
// Breakpoint on executing `addr` (debug_point[] flag 16). The machine stops before the instruction runs.
EXPORT void emu_break(int addr,int on)
{
	WORD a=(WORD)addr; if (on) debug_point[a]|=16; else debug_point[a]&=~16;
}
EXPORT void emu_break_clear(void) { for (int i=0;i<length(debug_point);++i) debug_point[i]&=~16; }
// 1 when the machine is stopped by the debugger, 0 when it can run.
EXPORT int emu_stopped(void) { return !!(session_signal&SESSION_SIGNAL_DEBUG); }
// Why it stopped: 0 running, 1 breakpoint, 2 step, 3 user (emu_stop()).
EXPORT int emu_stop_reason(void) { return emu_stopped()?emu_stop_why:0; }
// Stops the machine at the current instruction (between frames), as the host's Pause.
EXPORT void emu_stop(void) { if (!emu_stopped()) emu_stop_why=3,session_signal|=SESSION_SIGNAL_DEBUG; }
// Leaves the stopped state; emu_frame() runs again.
EXPORT void emu_continue(void) { session_signal&=~SESSION_SIGNAL_DEBUG; emu_stop_why=0; debug_reset(); }
// Sets the program counter (the machine should be stopped).
EXPORT void emu_jump(int addr) { debug_jump((WORD)addr); }
// Step into: one instruction, then stopped. Returns the new PC.
EXPORT int emu_step(void)
{
	debug_step(); session_signal|=SESSION_SIGNAL_DEBUG; emu_stop_why=2; return debug_this();
}
// Step over (CALL, RST, DJNZ, block repeats run as one) and step out (run until the current routine returns).
// Both return 1 if the machine is already stopped again (a plain step), 0 if it is running to its trap:
// call emu_frame() until that returns 1 (a breakpoint may stop it first; see emu_stop_reason()).
EXPORT int emu_step_over(void)
{
	session_signal|=SESSION_SIGNAL_DEBUG; emu_stop_why=2; debug_leap();
	return emu_stopped();
}
EXPORT int emu_step_out(void)
{
	session_signal|=SESSION_SIGNAL_DEBUG; emu_stop_why=2; debug_fall();
	return emu_stopped();
}

// Registers into `dst`, EMU_REG_COUNT (24) int32 values:
//  0 PC  1 SP  2 AF  3 BC  4 DE  5 HL  6 IX  7 IY  8 AF'  9 BC'  10 DE'  11 HL'
//  12 I  13 R  14 IM  15 IFF1  16 IFF2  17 WZ  18 frame number  19 model (0..3)
//  20 stopped (0/1)  21 stop reason (emu_stop_reason)  22,23 reserved (0)
EXPORT int emu_regs(int *dst)
{
	if (!dst) return EMU_REG_COUNT;
	dst[0]=z80_pc.w; dst[1]=z80_sp.w; dst[2]=z80_af.w; dst[3]=z80_bc.w; dst[4]=z80_de.w; dst[5]=z80_hl.w;
	dst[6]=z80_ix.w; dst[7]=z80_iy.w; dst[8]=z80_af2.w; dst[9]=z80_bc2.w; dst[10]=z80_de2.w; dst[11]=z80_hl2.w;
	dst[12]=z80_ir.b.h; dst[13]=z80_ir.b.l; dst[14]=z80_imd; dst[15]=z80_iff.b.l; dst[16]=z80_iff.b.h; dst[17]=z80_wz;
	dst[18]=(int)cb_frame_no; dst[19]=type_id; dst[20]=emu_stopped(); dst[21]=emu_stop_reason(); dst[22]=dst[23]=0;
	return EMU_REG_COUNT;
}
EXPORT int emu_frame_count(void) { return (int)cb_frame_no; }

// Test support: arms CPCEC's printer capture and CPCBuild's "SHOT" mechanism (cpcec-cb.h): a program
// that prints "\004SHOT name\n" on the printer port gets the picture saved as <dir>/name.png two frames
// later, by CPCEC's own PNG code. Used by test/golden.mjs. Returns 0.
EXPORT int emu_test_shots(const char *dir)
{
	if (!printer) printer=fopen("/printer.out","wb");
	static char d[256]; strncpy(d,dir,sizeof(d)-1); cb_shot_dir=d; return printer?0:1;
}

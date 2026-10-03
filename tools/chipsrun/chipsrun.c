/* chipsrun -- headless Amstrad CPC test runner on floooh/chips (zlib).
 *
 *   chipsrun --model 464|6128 [--rom-dir DIR] [--type STRING]...
 *            [--timeout SECONDS] [--trace] [--cold] [--end-on-marker] prog.bin
 *
 * prog.bin is an AMSDOS binary (128-byte header + code). Boots the CPC to
 * the BASIC Ready prompt, quickloads the binary (CALL &xxxx), captures
 * the printer port to stdout, types --type strings, and stops when an M1
 * fetch from address 0 happens.
 *
 * --cold: rehearse a no-firmware boot (a GX4000-style cartridge) instead.
 * The firmware never runs. All RAM (all eight 16K banks) is filled with a
 * deterministic junk pattern (xorshift32, seed 0x2545F491) so any reliance on
 * firmware-initialised RAM shows up; the program image is then written at its
 * load address and the CPU starts at the entry address. Power-on state:
 *   CPU:   interrupts disabled (IFF1/2 = 0), IM 0, AF = SP = &FFFF (chips'
 *          reset values), then SP set to &C000 and PC to the entry address.
 *   Memory: RAM configuration 0 (banks 0-3 at &0000-&FFFF); both ROMs
 *          PAGED OUT (Gate Array config &0C, i.e. mode 0, lower and upper ROM
 *          disabled) so the image can sit at &0040. A real cartridge would
 *          have its own memory at the entry; ROMs-out is the closest match.
 *   Gate Array: mode 0, all 16 pens and the border = hardware colour 0
 *          (chips zeroes the registers), RAM config 0, upper ROM select 0.
 *   CRTC (MC6845, UM6845R type): all registers 0 (chips zeroes them; a real
 *          chip's are undefined), so no valid display or frame timing is
 *          produced until the program programs them -- the Gate Array
 *          interrupt (from CRTC HSYNC) therefore does not run until then.
 *   PPI (8255): all ports input (control &9B), port A output latch 0.
 *   PSG (AY): all registers 0 (mixer 0 = every channel enabled with volume 0).
 *   FDC: idle, no disc. Printer/keyboard capture, END detection, typed keys
 *   and screenshots work as in a normal run; typed keys keep the normal run's
 *   schedule (from program start) so tests behave the same.
 *
 * --end-on-marker: stop at the first frame boundary after the "\x04END\n" line
 * has been captured, instead of waiting for the M1 fetch at address 0, and
 * drop anything printed after it. For bare-metal builds, whose reset path
 * (__CPC_RESET in bareboot.asm) pages the lower ROM in under code that sits
 * below &4000, so the fetch at 0 can be missed (seen on the 464); the marker
 * line proves the program reached END either way. Without it a missing
 * address-0 fetch is a timeout (exit 2).
 *
 * Screenshots (all PNG, 8-bit RGB, written with a built-in minimal PNG
 * writer: stored deflate blocks, no compression, no dependencies):
 *   --shot FILE.png    write the screen when the run ends (END, address 0,
 *                      or timeout).
 *   --shot-at FRAMES   also write --shot's file FRAMES frames after program
 *                      start, then keep running (a later end-of-run shot
 *                      overwrites it; with --shot-at the end-of-run shot is
 *                      written only if --shot-end is also given).
 *   --shot-dir DIR     directory for program-triggered shots (default ".").
 *   Program-triggered: the program sends the printer-transcript line
 *       "\x04SHOT name\n"
 *   (control-D, "SHOT ", a name of [A-Za-z0-9_.-], LF -- the same shape as
 *   the "\x04END" marker and sent the same way, through MC_PRINT_CHAR).
 *   The line is removed from the transcript and DIR/name.png is written
 *   SHOT_DELAY (2) frames after chipsrun sees the line, so the program
 *   should keep the screen unchanged for ~4 frames after sending it.
 *   Program-triggered state dump: the line "\x04STATE\n" (same way) is removed
 *   from the transcript and, at the next frame boundary, one line is written
 *   to stderr:
 *     chipsrun-state: mode=M lrom=on|off urom=on|off ramcfg=N border=H
 *       ink=H,H,...(16) crtc=R0,...,R13
 *   (H = the 5-bit hardware colour numbers in the Gate Array's pen
 *   registers; ROM on/off and mode from the GA's ROM/mode register). It is
 *   how the bare-metal boot's hardware state is tested (the Gate Array
 *   cannot be read back by the program). The program should sit in a busy
 *   loop for a few frames after sending it.
 *   Image: the visible display, 768x272, exactly chips' native display area
 *   (AM40010_DISPLAY_WIDTH x HEIGHT: 48 CRTC characters of 16 pixels, 272
 *   scanlines, border included), no scaling. One pixel is one mode-2 pixel
 *   wide (mode 1: 2 px, mode 0: 4 px) and one scanline high. Colours come
 *   from the Gate Array hardware colour table in chips (cpc_display_info()
 *   palette), converted to RGB.
 *
 * Exit: 0 = reached address 0 and the END marker line was seen (marker
 * stripped from the transcript); 2 = timeout; 4 = reached address 0 without
 * the marker; 1 = usage/IO error.
 */
#define CHIPS_IMPL
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "chips/chips_common.h"
#include "chips/z80.h"
#include "chips/ay38910.h"
#include "chips/i8255.h"
#include "chips/mc6845.h"
#include "chips/am40010.h"
#include "chips/upd765.h"
#include "chips/mem.h"
#include "chips/kbd.h"
#include "chips/clk.h"
#include "chips/fdd.h"
#include "chips/fdd_cpc.h"
#include "systems/cpc.h"

#define FRAME_US 20000
#define BOOT_DELAY 42          /* cap32 boot_time (cap32.cfg), frames */
#define BOOT_FRAMES 120
#ifndef KEY_HOLD
#define KEY_HOLD 2
#endif
#ifndef KEY_GAP
#define KEY_GAP 3   /* 2 loses repeated letters (HELLO -> HELO) in chips */
#endif
#define FIRST_TYPE_DELAY (4 * BOOT_DELAY)
#define SHOT_DELAY 2           /* frames between a SHOT marker and the grab */

static cpc_t cpc;
static bool stopped;
static bool program_started;
static bool at_zero;
static bool io_wr_prev;
static int pending_key_events;  /* due key events not yet applied: see apply_keys() */
static uint8_t *xbuf;           /* captured printer bytes */
static size_t xlen, xcap;

static void emit(uint8_t c) {
    if (xlen == xcap) {
        xcap = xcap ? xcap * 2 : 4096;
        xbuf = realloc(xbuf, xcap);
        if (!xbuf) { perror("realloc"); exit(1); }
    }
    xbuf[xlen++] = c;
}

/* typing schedule */
typedef struct { int frame; int key; bool down; } kev_t;
static kev_t *kev; static int nkev, kpos;
static int pframe;
static uint16_t trace_entry;

/* Apply all key events that are due. Called at a frame boundary only if
   no scan is likely in flight (see below), else from debug_cb. */
static void apply_keys(void) {
    while (kpos < nkev && kev[kpos].frame <= pframe) {
        if (kev[kpos].down) cpc_key_down(&cpc, kev[kpos].key);
        else cpc_key_up(&cpc, kev[kpos].key);
        kpos++;
    }
}

static void debug_cb(void *ud, uint64_t pins) {
    (void)ud;
    /* printer: any I/O write with A12 low; value bit 7 = strobe (cap32:
       val ^ 0x80, byte taken when result bit 7 is clear, i.e. val bit 7 set) */
    const bool io_wr = (pins & (Z80_IORQ | Z80_WR | Z80_M1)) == (Z80_IORQ | Z80_WR);
    if (io_wr && !io_wr_prev && !(pins & Z80_A12)) {
        const uint8_t val = Z80_GET_DATA(pins);
        if (val & 0x80) { emit(val & 0x7f); }
    }
    io_wr_prev = io_wr;
    /* Key events are due at frame boundaries, but a program that scans
       the matrix directly (cpcbuild/keyboard.bas) takes a good fraction of
       a frame doing it, and a key change landing between two of its row
       reads shows half a chord (Q without SHIFT). To keep a key press
       atomic w.r.t. a scan, due events wait for the next write of "row 0"
       to PPI port C (&F6xx, low nibble 0: the first row select of any
       scan, firmware's or direct); a frame loop forces them after 2 frames. */
    if (pending_key_events && io_wr && (pins & Z80_A9) && !(pins & Z80_A8) && !(pins & Z80_A11)
        && (Z80_GET_DATA(pins) & 0x0F) == 0) {
        apply_keys();
        pending_key_events = 0;
    }
    if ((pins & (Z80_M1 | Z80_MREQ | Z80_RD)) == (Z80_M1 | Z80_MREQ | Z80_RD)) {
        const uint16_t a = Z80_GET_ADDR(pins);
        if (trace_entry && program_started && a == trace_entry) {
            fprintf(stderr, "chipsrun: entry PC=%04X BC'=%04X GA config=%02X (bit2 lower ROM off, bit3 upper ROM off) upper rom_select=%d\n",
                    a, cpc.cpu.bc2, cpc.ga.regs.config, cpc.ga.rom_select);
            trace_entry = 0;
        }
        if (a == 0x0000 && program_started) { at_zero = true; stopped = true; }
    }
}


/* ---- minimal PNG writer (stored deflate) ------------------------------ */
static uint32_t crc_table[256];
static void crc_init(void) {
    for (uint32_t n = 0; n < 256; n++) {
        uint32_t c = n;
        for (int k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
        crc_table[n] = c;
    }
}
static uint32_t crc_update(uint32_t crc, const uint8_t *p, size_t n) {
    for (size_t i = 0; i < n; i++) crc = crc_table[(crc ^ p[i]) & 0xFF] ^ (crc >> 8);
    return crc;
}
static void put32(uint8_t *p, uint32_t v) { p[0] = v >> 24; p[1] = v >> 16; p[2] = v >> 8; p[3] = v; }
static void png_chunk(FILE *f, const char *type, const uint8_t *data, uint32_t len) {
    uint8_t b[4];
    put32(b, len); fwrite(b, 1, 4, f);
    fwrite(type, 1, 4, f);
    uint32_t crc = crc_update(0xFFFFFFFFu, (const uint8_t *)type, 4);
    if (len) { fwrite(data, 1, len, f); crc = crc_update(crc, data, len); }
    put32(b, ~crc); fwrite(b, 1, 4, f);
}
/* rgb: w*h*3 bytes. Returns false on I/O error. */
static bool write_png(const char *path, const uint8_t *rgb, int w, int h) {
    FILE *f = fopen(path, "wb");
    if (!f) return false;
    size_t rowlen = (size_t)w * 3 + 1;
    size_t rawlen = rowlen * h;
    uint8_t *raw = malloc(rawlen);
    for (int y = 0; y < h; y++) {
        raw[y * rowlen] = 0;    /* filter: none */
        memcpy(raw + y * rowlen + 1, rgb + (size_t)y * w * 3, (size_t)w * 3);
    }
    size_t nblk = (rawlen + 65534) / 65535;
    size_t zlen = 2 + rawlen + nblk * 5 + 4;
    uint8_t *z = malloc(zlen), *q = z;
    *q++ = 0x78; *q++ = 0x01;
    uint32_t a = 1, b = 0;
    for (size_t off = 0; off < rawlen; ) {
        size_t n = rawlen - off > 65535 ? 65535 : rawlen - off;
        *q++ = (off + n == rawlen) ? 1 : 0;
        *q++ = n & 0xFF; *q++ = n >> 8; *q++ = ~n & 0xFF; *q++ = (~n >> 8) & 0xFF;
        memcpy(q, raw + off, n); q += n;
        for (size_t i = 0; i < n; i++) { a = (a + raw[off + i]) % 65521; b = (b + a) % 65521; }
        off += n;
    }
    put32(q, (b << 16) | a); q += 4;
    uint8_t ihdr[13];
    put32(ihdr, w); put32(ihdr + 4, h);
    ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    static const uint8_t sig[8] = { 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A };
    fwrite(sig, 1, 8, f);
    png_chunk(f, "IHDR", ihdr, 13);
    png_chunk(f, "IDAT", z, (uint32_t)(q - z));
    png_chunk(f, "IEND", NULL, 0);
    free(raw); free(z);
    bool ok = !ferror(f);
    return fclose(f) == 0 && ok;
}

/* Grab the visible display (see the header comment for the format). */
static bool save_shot(const char *path) {
    chips_display_info_t di = cpc_display_info(&cpc);
    const int w = di.screen.width, h = di.screen.height;
    const uint8_t *fb = di.frame.buffer.ptr;
    const uint32_t *pal = di.palette.ptr;
    const int stride = di.frame.dim.width;
    uint8_t *rgb = malloc((size_t)w * h * 3);
    for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
            uint32_t c = pal[fb[(di.screen.y + y) * stride + di.screen.x + x] & 63];
            uint8_t *d = rgb + ((size_t)y * w + x) * 3;
            d[0] = c & 0xFF; d[1] = (c >> 8) & 0xFF; d[2] = (c >> 16) & 0xFF;
        }
    }
    bool ok = write_png(path, rgb, w, h);
    free(rgb);
    if (!ok) fprintf(stderr, "chipsrun: cannot write %s\n", path);
    return ok;
}

/* program-triggered shots: queued by scan_markers(), written SHOT_DELAY
   frames later */
typedef struct { char name[64]; int due; } shot_t;
static shot_t shots[64]; static int nshots, shot_next;
static size_t scan_pos;     /* transcript bytes already scanned for markers */
static const char *shot_dir = ".";

static void dump_state(void) {
    const uint8_t cfg = cpc.ga.regs.config;
    fprintf(stderr, "chipsrun-state: mode=%d lrom=%s urom=%s ramcfg=%d border=%d ink=", cfg & 3,
            (cfg & 4) ? "off" : "on", (cfg & 8) ? "off" : "on", cpc.ga.ram_config & 7, cpc.ga.regs.border & 0x1F);
    for (int i = 0; i < 16; i++) fprintf(stderr, "%s%d", i ? "," : "", cpc.ga.regs.ink[i] & 0x1F);
    fprintf(stderr, " crtc=");
    for (int i = 0; i < 14; i++) fprintf(stderr, "%s%d", i ? "," : "", cpc.crtc.reg[i]);
    fprintf(stderr, "\n");
}
/* Look for complete "\x04SHOT name\n" lines in the transcript, queue them
   and remove them from it. */
static void scan_markers(int now) {
    static const char pre[] = "\x04" "SHOT ";
    const size_t plen = sizeof pre - 1;
    for (;;) {
        size_t i = scan_pos;
        while (i < xlen && xbuf[i] != 0x04) i++;
        scan_pos = i;
        if (i >= xlen) return;
        /* is there a complete line here? */
        size_t e = i;
        while (e < xlen && xbuf[e] != '\n') e++;
        if (e >= xlen) return;          /* incomplete: look again later */
        if (e - i == 6 && !memcmp(xbuf + i, "\x04" "STATE", 6)) {
            dump_state();
            memmove(xbuf + i, xbuf + e + 1, xlen - e - 1);
            xlen -= e - i + 1;
        } else if (e - i > plen && !memcmp(xbuf + i, pre, plen) && e - i - plen < sizeof shots[0].name && nshots < 64) {
            shot_t *s = &shots[nshots++];
            size_t n = e - i - plen;
            memcpy(s->name, xbuf + i + plen, n);
            s->name[n] = 0;
            for (char *c = s->name; *c; c++)
                if (!((*c >= 'a' && *c <= 'z') || (*c >= 'A' && *c <= 'Z') || (*c >= '0' && *c <= '9') || *c == '_' || *c == '-' || *c == '.')) *c = '_';
            s->due = now + SHOT_DELAY;
            memmove(xbuf + i, xbuf + e + 1, xlen - e - 1);
            xlen -= e - i + 1;
        } else {
            scan_pos = i + 1;           /* not ours (e.g. the END line) */
        }
    }
}
static bool has_end_marker(void) {
    for (size_t i = 0; i + 5 <= xlen; i++)
        if (!memcmp(xbuf + i, "\x04" "END\n", 5)) return true;
    return false;
}
static void run_shots(int now) {
    while (shot_next < nshots && shots[shot_next].due <= now) {
        char path[4352];
        snprintf(path, sizeof path, "%s/%s.png", shot_dir, shots[shot_next].name);
        save_shot(path);
        shot_next++;
    }
}

static uint8_t *read_file(const char *path, size_t *size) {
    FILE *f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "chipsrun: cannot open %s\n", path); exit(1); }
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t *p = malloc(n ? n : 1);
    if (fread(p, 1, n, f) != (size_t)n) { fprintf(stderr, "chipsrun: short read %s\n", path); exit(1); }
    fclose(f);
    *size = n;
    return p;
}

static uint8_t *load_rom(const char *dir, const char *name, size_t want) {
    char path[4096];
    size_t n;
    snprintf(path, sizeof path, "%s/%s", dir, name);
    uint8_t *p = read_file(path, &n);
    if (n != want) { fprintf(stderr, "chipsrun: %s: expected %zu bytes, got %zu\n", path, want, n); exit(1); }
    return p;
}


static void add_ev(int f, int key, bool down) {
    kev = realloc(kev, (nkev + 1) * sizeof(kev_t));
    kev[nkev++] = (kev_t){ f, key, down };
}

/* Mirrors cap32: each virtual key event is followed by a 1-frame wait, and
   the event only fires on the frame after that (so ~2 frames down, ~2 up in cap32; chips needs a 3-frame gap).
   Strings are separated by CAP32_DELAY (boot_time frames); the first one by
   four of them. Frames count from program start. */
static void build_schedule(char **types, int ntypes) {
    int f = 0;
    for (int i = 0; i < ntypes; i++) {
        f += (i == 0) ? FIRST_TYPE_DELAY : BOOT_DELAY;
        for (const char *s = types[i]; ; s++) {
            int c = *s ? (unsigned char)*s : 0x0D;
            add_ev(f, c, true);  f += KEY_HOLD;
            add_ev(f, c, false); f += KEY_GAP;
            if (!*s) break;
        }
    }
}

int main(int argc, char **argv) {
    const char *model = "6128", *romdir = NULL, *binpath = NULL;
    double timeout = 15.0;
    bool trace = false, shot_end = true, cold = false, end_on_marker = false;
    const char *shot_path = NULL;
    int shot_at = -1;
    char **types = calloc(argc + 1, sizeof(char *));
    int ntypes = 0;
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--model") && i + 1 < argc) model = argv[++i];
        else if (!strcmp(argv[i], "--rom-dir") && i + 1 < argc) romdir = argv[++i];
        else if (!strcmp(argv[i], "--type") && i + 1 < argc) types[ntypes++] = argv[++i];
        else if (!strcmp(argv[i], "--timeout") && i + 1 < argc) timeout = atof(argv[++i]);
        else if (!strcmp(argv[i], "--trace")) trace = true;
        else if (!strcmp(argv[i], "--cold")) cold = true;
        else if (!strcmp(argv[i], "--end-on-marker")) end_on_marker = true;
        else if (!strcmp(argv[i], "--shot") && i + 1 < argc) shot_path = argv[++i];
        else if (!strcmp(argv[i], "--shot-at") && i + 1 < argc) { shot_at = atoi(argv[++i]); shot_end = false; }
        else if (!strcmp(argv[i], "--shot-end")) shot_end = true;
        else if (!strcmp(argv[i], "--shot-dir") && i + 1 < argc) shot_dir = argv[++i];
        else if (argv[i][0] != '-' && !binpath) binpath = argv[i];
        else { fprintf(stderr, "usage: chipsrun --model 464|6128 [--rom-dir DIR] [--type STR]... [--timeout S] [--trace] [--cold] [--end-on-marker] [--shot F.png [--shot-at N] [--shot-end]] [--shot-dir D] prog.bin\n"); return 1; }
    }
    if (!binpath) { fprintf(stderr, "chipsrun: no program given\n"); return 1; }
    bool is464 = !strcmp(model, "464");
    if (!is464 && strcmp(model, "6128")) { fprintf(stderr, "chipsrun: chips supports only 464 and 6128\n"); return 1; }
    if (!romdir) romdir = "../caprice32/rom";

    uint8_t *rom = load_rom(romdir, is464 ? "cpc464.rom" : "cpc6128.rom", 0x8000);
    uint8_t *amsdos = is464 ? NULL : load_rom(romdir, "amsdos.rom", 0x4000);
    size_t binsize;
    uint8_t *bin = read_file(binpath, &binsize);

    cpc_desc_t desc = {0};
    desc.type = is464 ? CPC_TYPE_464 : CPC_TYPE_6128;
    desc.debug.callback.func = debug_cb;
    desc.debug.stopped = &stopped;
    if (is464) {
        desc.roms.cpc464.os = (chips_range_t){ rom, 0x4000 };
        desc.roms.cpc464.basic = (chips_range_t){ rom + 0x4000, 0x4000 };
    } else {
        desc.roms.cpc6128.os = (chips_range_t){ rom, 0x4000 };
        desc.roms.cpc6128.basic = (chips_range_t){ rom + 0x4000, 0x4000 };
        desc.roms.cpc6128.amsdos = (chips_range_t){ amsdos, 0x4000 };
    }
    cpc_init(&cpc, &desc);
    crc_init();

    clock_t wall0 = clock();
    double wall_cap = timeout * 4 + 20;
    int frame = 0;
    if (cold) {
        /* see the header comment: junk RAM, ROMs out, image in, jump to it */
        uint32_t x = 0x2545F491u;
        uint8_t *ram = &cpc.ram[0][0];
        for (size_t i = 0; i < sizeof cpc.ram; i++) {
            x ^= x << 13; x ^= x >> 17; x ^= x << 5;
            ram[i] = (uint8_t)(x >> 11);
        }
        cpc.ga.regs.config = 0x0C;
        cpc.ga.ram_config = 0;
        cpc.ga.rom_select = 0;
        _cpc_bankswitch(cpc.ga.ram_config, cpc.ga.regs.config, cpc.ga.rom_select, &cpc);
        const unsigned load = bin[0x15] | (bin[0x16] << 8);
        const unsigned len = bin[0x18] | (bin[0x19] << 8);
        const unsigned exec = bin[0x1A] | (bin[0x1B] << 8);
        if (binsize < 128 + (size_t)len || load + len > 0x10000) { fprintf(stderr, "chipsrun: bad image\n"); return 1; }
        for (unsigned i = 0; i < len; i++) mem_wr(&cpc.mem, load + i, bin[128 + i]);
        cpc.cpu.sp = 0xC000;
        cpc.pins = z80_prefetch(&cpc.cpu, exec);
        if (trace) fprintf(stderr, "chipsrun: cold start: %u bytes at &%04X, entry &%04X, SP &C000, ROMs out, CRTC R0-R13 = %d %d %d %d %d %d %d %d %d %d %d %d %d %d\n",
                           len, load, exec, cpc.crtc.reg[0], cpc.crtc.reg[1], cpc.crtc.reg[2], cpc.crtc.reg[3], cpc.crtc.reg[4], cpc.crtc.reg[5], cpc.crtc.reg[6],
                           cpc.crtc.reg[7], cpc.crtc.reg[8], cpc.crtc.reg[9], cpc.crtc.reg[10], cpc.crtc.reg[11], cpc.crtc.reg[12], cpc.crtc.reg[13]);
        if (trace) trace_entry = exec;
    } else {
    /* Boot. BASIC's Ready prompt is reached about 50 frames in (both
       models, measured); the firmware's idle loop is in ROM at model-
       specific addresses, so rather than hook those we run a fixed,
       generous number of frames, as chips' own examples do. */
    while (frame < BOOT_FRAMES) { cpc_exec(&cpc, FRAME_US); frame++; }
    if (trace) fprintf(stderr, "chipsrun: booted %d frames, quickloading\n", frame);

    if (trace) {
        fprintf(stderr, "chipsrun: load address 0x%02X%02X, exec address 0x%04X, %zu bytes\n",
                bin[0x16], bin[0x15], cpc_quickload_exec_addr((chips_range_t){ bin, binsize }), binsize - 128);
    }
    /* BASIC's CALL command scribbles on &0040-&0047 (its ROM, around E008,
       writes there while it parses and starts the call), after the image is
       loaded and before the first instruction runs; RUN" is unaffected, as
       AMSDOS loads the file last. So for a program loaded below &0048 the
       entry point is a small stub that puts the program's first 8 bytes
       back and jumps to the real entry:
           ld hl,saved / ld de,load / ld bc,8 / ldir / jp exec / saved: db ... */
    if (binsize > 128 + 8 && (bin[0x15] | (bin[0x16] << 8)) < 0x48) {
        const unsigned load = bin[0x15] | (bin[0x16] << 8), exec = bin[0x1A] | (bin[0x1B] << 8);
        const unsigned stub = 0xA300;
        uint8_t code[22] = { 0x21, (stub + 14) & 0xFF, (stub + 14) >> 8, 0x11, load & 0xFF, load >> 8,
                             0x01, 0x08, 0x00, 0xED, 0xB0, 0xC3, exec & 0xFF, exec >> 8 };
        memcpy(code + 14, bin + 128, 8);
        for (unsigned i = 0; i < sizeof code; i++) mem_wr(&cpc.mem, stub + i, code[i]);
        bin[0x1A] = stub & 0xFF; bin[0x1B] = stub >> 8;
    }
    if (!cpc_quickload(&cpc, (chips_range_t){ bin, binsize }, true)) {
        fprintf(stderr, "chipsrun: quickload failed\n");
        return 1;
    }
    }
    program_started = true;
    if (trace && !cold) trace_entry = cpc_quickload_exec_addr((chips_range_t){ bin, binsize });
    build_schedule(types, ntypes);

    pframe = 0;
    int due_since = -1;
    const int max_frames = (int)(timeout * 50.0);
    bool timed_out = false;
    while (!stopped) {
        if (kpos < nkev && kev[kpos].frame <= pframe) {
            if (due_since < 0) due_since = pframe;
            if (pframe - due_since >= 2) { apply_keys(); due_since = -1; pending_key_events = 0; }
            else pending_key_events = 1;
        } else due_since = -1;
        cpc_exec(&cpc, FRAME_US);
        pframe++;
        scan_markers(pframe);
        run_shots(pframe);
        if (end_on_marker && xlen >= 5 && has_end_marker()) { at_zero = true; break; }
        if (shot_path && shot_at >= 0 && pframe == shot_at) save_shot(shot_path);
        if (pframe >= max_frames) { timed_out = true; break; }
        if ((pframe & 255) == 0 && (double)(clock() - wall0) / CLOCKS_PER_SEC > wall_cap) { timed_out = true; break; }
    }
    if (trace) fprintf(stderr, "chipsrun: ended after %d program frames (%.2f emulated s): %s\n",
                       pframe, pframe / 50.0, at_zero ? "M1 fetch at address 0" : "timeout");
    if (trace && !at_zero) fprintf(stderr, "chipsrun: PC=%04X SP=%04X IFF1=%d GA config=%02X\n", cpc.cpu.pc, cpc.cpu.sp, cpc.cpu.iff1, cpc.ga.regs.config);

    /* shots still pending (the program ended first) are taken now */
    scan_markers(pframe);
    run_shots(1 << 30);
    if (shot_path && shot_end) save_shot(shot_path);

    int rc = 0;
    if (timed_out && !at_zero) rc = 2;
    /* strip the END marker line */
    static const char marker[] = "\x04" "END\n";
    size_t mlen = sizeof marker - 1;
    bool found = false;
    for (size_t i = 0; i + mlen <= xlen; i++) {
        if (!memcmp(xbuf + i, marker, mlen)) {
            if (end_on_marker) { xlen = i; found = true; break; }
            memmove(xbuf + i, xbuf + i + mlen, xlen - i - mlen);
            xlen -= mlen;
            found = true;
            break;
        }
    }
    if (rc == 0 && !found) rc = 4;
    if (xlen) fwrite(xbuf, 1, xlen, stdout);
    fflush(stdout);
    return rc;
}

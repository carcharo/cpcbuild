/* zxrun -- headless ZX Spectrum (48K / 128K) test runner on floooh/chips (zlib).
 *
 *   zxrun --model 48|128 [--rom-dir DIR] [--org ADDR] [--type STRING]...
 *         [--timeout SECONDS] [--trace] [--shot F.png [--shot-at N] [--shot-end]]
 *         [--shot-dir DIR] prog.bin
 *
 * prog.bin is the raw code zxbc writes with `--arch zx48k -f bin` (no header;
 * it starts at its ORG, 32768 unless zxbc ran with --org/-S, in which case
 * pass the same --org here). Loading route (the same for both models, and why
 * not a .z80 snapshot: zxbc writes one only with a BASIC loader, 48K only,
 * and zx_quickload refuses a 48K snapshot on a 128): boot the real ROM, let it reach
 * the 48K BASIC command loop (on the 128: press ENTER on the menu's "Tape
 * Loader", which pages in ROM 1, the 48K BASIC ROM, and waits in LOAD ""),
 * set I = 3F as the 48K ROM leaves it,
 * copy the code to ORG, push a return address of 0000 and jump to ORG with
 * interrupts on in IM 1 -- as a BASIC `RANDOMIZE USR` would call it.
 *
 * Test output (the zx48k runtime has no printer echo): every I/O write to a
 * port with A0=1 and A1=1 -- tests use &00FF -- is a transcript byte; see
 * tests/zx/lib/zxtest.bas. 48K and 128K decode nothing there: not the ULA
 * (A0=0), not paging (A15=0, A1=0), not the AY (A15=1, A1=0), not Kempston
 * (reads only).  The transcript goes to stdout.
 *   "\x04END\n"        ends the run (exit 0), stripped from the transcript.
 *   "\x04SHOT name\n"  saves DIR/name.png 2 frames later (--shot-dir), stripped.
 *
 * Screenshots: PNG, 8-bit RGB, 320x256 (chips' display area: the 256x192
 * screen with a 32 px border all round), written with a built-in minimal PNG
 * writer. --shot FILE.png saves when the run ends; --shot-at FRAMES saves
 * FRAMES frames after program start instead (--shot-end: both).
 *
 * Typed keys (--type): after FIRST_TYPE_DELAY frames, then TYPE_DELAY frames
 * after each earlier string, the string is typed and ENTER pressed. Uppercase
 * letters and symbols use CAPS/SYMBOL SHIFT as chips' key matrix maps them.
 *
 * Exit: 0 = the END marker was seen; 2 = timeout; 4 = the program fell to
 * address 0 (or hit RST 8, the Boriel runtime's error call: "Error N" is
 * appended to the transcript, N being the runtime's error code) without it;
 * 1 = usage/IO error.
 */
#define CHIPS_IMPL
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "chips/chips_common.h"
#include "chips/z80.h"
#include "chips/beeper.h"
#include "chips/ay38910.h"
#include "chips/mem.h"
#include "chips/kbd.h"
#include "chips/clk.h"
#include "systems/zx.h"

#define FRAME_US 20000
#define BOOT_FRAMES_48 150
#define BOOT_FRAMES_128 200     /* RAM test, then the menu */
#define MENU_FRAMES_128 100     /* after ENTER on the menu: ROM 1 up, in LOAD "" */
#ifndef KEY_HOLD
#define KEY_HOLD 3
#endif
#ifndef KEY_GAP
#define KEY_GAP 3
#endif
#define FIRST_TYPE_DELAY 25
#define TYPE_DELAY 25
#define SHOT_DELAY 2
#define OUT_PORT_MASK (Z80_A0 | Z80_A1)

static zx_t zx;
static bool stopped, program_started, io_wr_prev;
static bool at_zero, at_error, end_seen;
static int pending_key_events;
static uint8_t *xbuf;
static size_t xlen, xcap;
static uint16_t trace_entry;

static void emit(uint8_t c) {
    if (xlen == xcap) {
        xcap = xcap ? xcap * 2 : 4096;
        xbuf = realloc(xbuf, xcap);
        if (!xbuf) { perror("realloc"); exit(1); }
    }
    xbuf[xlen++] = c;
}

typedef struct { int frame; int key; bool down; } kev_t;
static kev_t *kev; static int nkev, kpos;
static int pframe;

static void apply_keys(void) {
    while (kpos < nkev && kev[kpos].frame <= pframe) {
        if (kev[kpos].down) zx_key_down(&zx, kev[kpos].key);
        else zx_key_up(&zx, kev[kpos].key);
        kpos++;
    }
}

static void debug_cb(void *ud, uint64_t pins) {
    (void)ud;
    if (!program_started) return;
    const bool io_wr = (pins & (Z80_IORQ | Z80_WR | Z80_M1)) == (Z80_IORQ | Z80_WR);
    if (io_wr && !io_wr_prev && (pins & OUT_PORT_MASK) == OUT_PORT_MASK) {
        emit(Z80_GET_DATA(pins));
        static const char marker[] = "\x04" "END\n";
        if (xlen >= 5 && !memcmp(xbuf + xlen - 5, marker, 5)) { end_seen = true; stopped = true; }
    }
    io_wr_prev = io_wr;
    /* Key events are due at frame boundaries, but a ROM keyboard scan takes
       a good fraction of a frame and a change landing between two of its
       row reads shows half a chord (Q without CAPS SHIFT). Due events wait
       for the next read of the first row (port &FEFE), which starts every
       scan; the frame loop forces them after 2 frames. */
    if (pending_key_events && (pins & (Z80_IORQ | Z80_RD | Z80_M1 | Z80_A0)) == (Z80_IORQ | Z80_RD)
        && (Z80_GET_ADDR(pins) & 0xFF00) == 0xFE00) {
        apply_keys();
        pending_key_events = 0;
    }
    if ((pins & (Z80_M1 | Z80_MREQ | Z80_RD)) == (Z80_M1 | Z80_MREQ | Z80_RD)) {
        const uint16_t a = Z80_GET_ADDR(pins);
        if (trace_entry && a == trace_entry) {
            fprintf(stderr, "zxrun: entry PC=%04X SP=%04X\n", a, zx.cpu.sp);
            trace_entry = 0;
        }
        if (a == 0x0000) { at_zero = true; stopped = true; }
        else if (a == 0x0008) {
            /* rst 8 (__ERROR in the Boriel runtime): the code byte follows
               the call, so the pushed return address points at it */
            uint16_t sp = zx.cpu.sp;
            uint16_t ret = mem_rd(&zx.mem, sp) | (mem_rd(&zx.mem, (uint16_t)(sp + 1)) << 8);
            char line[32];
            int n = snprintf(line, sizeof line, "Error %d\n", mem_rd(&zx.mem, ret));
            for (int i = 0; i < n; i++) emit((uint8_t)line[i]);
            at_error = true; stopped = true;
        }
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
static bool write_png(const char *path, const uint8_t *rgb, int w, int h) {
    FILE *f = fopen(path, "wb");
    if (!f) return false;
    size_t rowlen = (size_t)w * 3 + 1;
    size_t rawlen = rowlen * h;
    uint8_t *raw = malloc(rawlen);
    for (int y = 0; y < h; y++) {
        raw[y * rowlen] = 0;
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

static bool save_shot(const char *path) {
    chips_display_info_t di = zx_display_info(&zx);
    const int w = di.screen.width, h = di.screen.height;
    const uint8_t *fb = di.frame.buffer.ptr;
    const uint32_t *pal = di.palette.ptr;
    const int stride = di.frame.dim.width;
    uint8_t *rgb = malloc((size_t)w * h * 3);
    for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
            uint32_t c = pal[fb[(di.screen.y + y) * stride + di.screen.x + x] & 15];
            uint8_t *d = rgb + ((size_t)y * w + x) * 3;
            d[0] = c & 0xFF; d[1] = (c >> 8) & 0xFF; d[2] = (c >> 16) & 0xFF;
        }
    }
    bool ok = write_png(path, rgb, w, h);
    free(rgb);
    if (!ok) fprintf(stderr, "zxrun: cannot write %s\n", path);
    return ok;
}

typedef struct { char name[64]; int due; } shot_t;
static shot_t shots[64]; static int nshots, shot_next;
static size_t scan_pos;
static const char *shot_dir = ".";

static void scan_markers(int now) {
    static const char pre[] = "\x04" "SHOT ";
    const size_t plen = sizeof pre - 1;
    for (;;) {
        size_t i = scan_pos;
        while (i < xlen && xbuf[i] != 0x04) i++;
        scan_pos = i;
        if (i >= xlen) return;
        size_t e = i;
        while (e < xlen && xbuf[e] != '\n') e++;
        if (e >= xlen) return;
        if (e - i > plen && !memcmp(xbuf + i, pre, plen) && e - i - plen < sizeof shots[0].name && nshots < 64) {
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
            scan_pos = i + 1;
        }
    }
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
    if (!f) { fprintf(stderr, "zxrun: cannot open %s\n", path); exit(1); }
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t *p = malloc(n ? n : 1);
    if (fread(p, 1, n, f) != (size_t)n) { fprintf(stderr, "zxrun: short read %s\n", path); exit(1); }
    fclose(f);
    *size = n;
    return p;
}

static uint8_t *load_rom(const char *dir, const char *name) {
    char path[4096];
    size_t n;
    snprintf(path, sizeof path, "%s/%s", dir, name);
    uint8_t *p = read_file(path, &n);
    if (n != 0x4000) { fprintf(stderr, "zxrun: %s: expected 16384 bytes, got %zu\n", path, n); exit(1); }
    return p;
}

static void add_ev(int f, int key, bool down) {
    kev = realloc(kev, (nkev + 1) * sizeof(kev_t));
    kev[nkev++] = (kev_t){ f, key, down };
}

static void build_schedule(char **types, int ntypes) {
    int f = 0;
    for (int i = 0; i < ntypes; i++) {
        f += (i == 0) ? FIRST_TYPE_DELAY : TYPE_DELAY;
        for (const char *s = types[i]; ; s++) {
            int c = *s ? (unsigned char)*s : 0x0D;
            add_ev(f, c, true);  f += KEY_HOLD;
            add_ev(f, c, false); f += KEY_GAP;
            if (!*s) break;
        }
    }
}

static void run_frames(int n) { while (n-- > 0) zx_exec(&zx, FRAME_US); }

int main(int argc, char **argv) {
    const char *model = "48", *romdir = NULL, *binpath = NULL;
    double timeout = 15.0;
    bool trace = false, shot_end = true;
    const char *shot_path = NULL;
    int shot_at = -1;
    long org = 32768;
    char **types = calloc(argc + 1, sizeof(char *));
    int ntypes = 0;
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--model") && i + 1 < argc) model = argv[++i];
        else if (!strcmp(argv[i], "--rom-dir") && i + 1 < argc) romdir = argv[++i];
        else if (!strcmp(argv[i], "--org") && i + 1 < argc) org = strtol(argv[++i], NULL, 0);
        else if (!strcmp(argv[i], "--type") && i + 1 < argc) types[ntypes++] = argv[++i];
        else if (!strcmp(argv[i], "--timeout") && i + 1 < argc) timeout = atof(argv[++i]);
        else if (!strcmp(argv[i], "--trace")) trace = true;
        else if (!strcmp(argv[i], "--shot") && i + 1 < argc) shot_path = argv[++i];
        else if (!strcmp(argv[i], "--shot-at") && i + 1 < argc) { shot_at = atoi(argv[++i]); shot_end = false; }
        else if (!strcmp(argv[i], "--shot-end")) shot_end = true;
        else if (!strcmp(argv[i], "--shot-dir") && i + 1 < argc) shot_dir = argv[++i];
        else if (argv[i][0] != '-' && !binpath) binpath = argv[i];
        else { fprintf(stderr, "usage: zxrun --model 48|128 [--rom-dir D] [--org A] [--type STR]... [--timeout S] [--trace] [--shot F.png [--shot-at N] [--shot-end]] [--shot-dir D] prog.bin\n"); return 1; }
    }
    if (!binpath) { fprintf(stderr, "zxrun: no program given\n"); return 1; }
    const bool is128 = !strcmp(model, "128");
    if (!is128 && strcmp(model, "48")) { fprintf(stderr, "zxrun: model must be 48 or 128\n"); return 1; }
    if (!romdir) romdir = "zxroms";
    if (org < 0x4000 || org > 0xFFFF) { fprintf(stderr, "zxrun: bad --org\n"); return 1; }

    size_t binsize;
    uint8_t *bin = read_file(binpath, &binsize);
    if (org + binsize > 0x10000) { fprintf(stderr, "zxrun: program does not fit at --org\n"); return 1; }

    zx_desc_t desc = {0};
    desc.type = is128 ? ZX_TYPE_128 : ZX_TYPE_48K;
    desc.debug.callback.func = debug_cb;
    desc.debug.stopped = &stopped;
    if (is128) {
        desc.roms.zx128_0 = (chips_range_t){ load_rom(romdir, "128-0.rom"), 0x4000 };
        desc.roms.zx128_1 = (chips_range_t){ load_rom(romdir, "128-1.rom"), 0x4000 };
    } else {
        desc.roms.zx48k = (chips_range_t){ load_rom(romdir, "48.rom"), 0x4000 };
    }
    zx_init(&zx, &desc);
    crc_init();

    clock_t wall0 = clock();
    double wall_cap = timeout * 4 + 20;

    /* Boot to the 48K BASIC command loop. */
    if (is128) {
        run_frames(BOOT_FRAMES_128);
        zx_key_down(&zx, 0x0D); run_frames(KEY_HOLD);
        zx_key_up(&zx, 0x0D); run_frames(MENU_FRAMES_128);
    } else {
        run_frames(BOOT_FRAMES_48);
    }
    if (trace) fprintf(stderr, "zxrun: at start I=%02X IM=%d IFF1=%d PC=%04X SP=%04X\n", zx.cpu.i, zx.cpu.im, zx.cpu.iff1, zx.cpu.pc, zx.cpu.sp);
    if (trace) fprintf(stderr, "zxrun: booted, ROM paged: %s, injecting %zu bytes at %04lX\n",
                       is128 ? ((zx.last_mem_config & 0x10) ? "1 (48K BASIC)" : "0 (128 menu)") : "48K", binsize, org);

    /* Inject and start: RANDOMIZE USR org from BASIC. */
    for (size_t i = 0; i < binsize; i++) mem_wr(&zx.mem, (uint16_t)(org + i), bin[i]);
    zx.cpu.sp -= 2;
    mem_wr(&zx.mem, zx.cpu.sp, 0);
    mem_wr(&zx.mem, (uint16_t)(zx.cpu.sp + 1), 0);
    zx.cpu.iff1 = zx.cpu.iff2 = true;
    zx.cpu.im = 1;
    /* the 48K ROM's start-up (and its NEW) leaves I = 3F; the 128's menu ->
       Tape Loader path never runs it and leaves I = 0, so set what a
       BASIC USR call (and 48 BASIC on the 128) sees */
    zx.cpu.i = 0x3F;
    zx.pins = z80_prefetch(&zx.cpu, (uint16_t)org);
    program_started = true;
    if (trace) trace_entry = (uint16_t)org;
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
        zx_exec(&zx, FRAME_US);
        pframe++;
        scan_markers(pframe);
        run_shots(pframe);
        if (shot_path && shot_at >= 0 && pframe == shot_at) save_shot(shot_path);
        if (pframe >= max_frames) { timed_out = true; break; }
        if ((pframe & 255) == 0 && (double)(clock() - wall0) / CLOCKS_PER_SEC > wall_cap) { timed_out = true; break; }
    }
    if (trace) fprintf(stderr, "zxrun: ended after %d program frames (%.2f emulated s): %s\n", pframe, pframe / 50.0,
                       end_seen ? "END marker" : at_zero ? "M1 fetch at address 0" : at_error ? "rst 8" : "timeout");

    scan_markers(pframe);
    run_shots(1 << 30);
    if (shot_path && shot_end) save_shot(shot_path);

    int rc = 0;
    if (timed_out && !end_seen && !at_zero && !at_error) rc = 2;
    static const char marker[] = "\x04" "END\n";
    const size_t mlen = sizeof marker - 1;
    bool found = false;
    for (size_t i = 0; i + mlen <= xlen; i++) {
        if (!memcmp(xbuf + i, marker, mlen)) {
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

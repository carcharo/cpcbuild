/* chipsrun -- headless Amstrad CPC test runner on floooh/chips (zlib).
 *
 *   chipsrun --model 464|6128 [--rom-dir DIR] [--type STRING]...
 *            [--timeout SECONDS] [--trace] prog.bin
 *
 * prog.bin is an AMSDOS binary (128-byte header + code). Boots the CPC to
 * the BASIC Ready prompt, quickloads the binary (CALL &xxxx), captures
 * the printer port to stdout, types --type strings, and stops when an M1
 * fetch from address 0 happens.
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
    bool trace = false;
    char **types = calloc(argc + 1, sizeof(char *));
    int ntypes = 0;
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--model") && i + 1 < argc) model = argv[++i];
        else if (!strcmp(argv[i], "--rom-dir") && i + 1 < argc) romdir = argv[++i];
        else if (!strcmp(argv[i], "--type") && i + 1 < argc) types[ntypes++] = argv[++i];
        else if (!strcmp(argv[i], "--timeout") && i + 1 < argc) timeout = atof(argv[++i]);
        else if (!strcmp(argv[i], "--trace")) trace = true;
        else if (argv[i][0] != '-' && !binpath) binpath = argv[i];
        else { fprintf(stderr, "usage: chipsrun --model 464|6128 [--rom-dir DIR] [--type STR]... [--timeout S] [--trace] prog.bin\n"); return 1; }
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

    clock_t wall0 = clock();
    double wall_cap = timeout * 4 + 20;
    int frame = 0;
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
    if (!cpc_quickload(&cpc, (chips_range_t){ bin, binsize }, true)) {
        fprintf(stderr, "chipsrun: quickload failed\n");
        return 1;
    }
    program_started = true;
    if (trace) trace_entry = cpc_quickload_exec_addr((chips_range_t){ bin, binsize });
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
        if (pframe >= max_frames) { timed_out = true; break; }
        if ((pframe & 255) == 0 && (double)(clock() - wall0) / CLOCKS_PER_SEC > wall_cap) { timed_out = true; break; }
    }
    if (trace) fprintf(stderr, "chipsrun: ended after %d program frames (%.2f emulated s): %s\n",
                       pframe, pframe / 50.0, at_zero ? "M1 fetch at address 0" : "timeout");

    int rc = 0;
    if (timed_out && !at_zero) rc = 2;
    /* strip the END marker line */
    static const char marker[] = "\x04" "END\n";
    size_t mlen = sizeof marker - 1;
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

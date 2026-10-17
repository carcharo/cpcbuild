// Node (no browser) tests of the SDL-free CPCEC WebAssembly build (wasm/cpcec.{js,wasm},
// made by tools/cpcec/wasm/build-host.sh): the pictures it renders against the goldens
// of the native patched CPCEC (`make test-cpcec`), and the debugger exports.
//
//   python3 test/prepare_media.py       (once; npm run test:golden does it)
//   node test/golden.mjs [case-name ...]
//
// How the pictures are matched. `make test-cpcec` runs CPCEC headless on a program that
// prints "\x04SHOT name\n" on the printer port; CPCEC's own PNG saver writes the
// 768x536 visible area (VIDEO_OFFSET_X/Y, VIDEO_PIXELS_X/Y of CPCEC's 1024x624 frame)
// two frames after the printer line (tools/cpcec/cpcbuild.patch, cpcec-cb.h). The wasm
// build keeps that code, writes the PNG into its in-memory file system, and this test
//   1. decodes that PNG and compares it with the repo's golden PNG, pixel for pixel, and
//   2. compares emu_framebuffer() (the visible area, read straight from linear memory) at
//      the frame the PNG was saved with the same golden.
// Equality is exact (0 differing pixels): the emulation core is the same C code and the
// same ROMs, run in the same order of events.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const media = path.join(here, '.media');
const wasmJs = path.join(root, 'wasm', 'cpcec.js');
if (!fs.existsSync(wasmJs)) {
  console.error('wasm/cpcec.js missing: run sh tools/cpcec/wasm/build-host.sh (from the repo root)');
  process.exit(2);
}
const { default: createCpcec } = await import(wasmJs);

// ---- the ROMs that come with CPCEC (not vendored: tools/cpcec/work, made by `make cpcec`) ----
function findWork() {
  const cands = [];
  if (process.env.CPCEC_WORK) cands.push(process.env.CPCEC_WORK);
  const repo = path.resolve(root, '..', '..');
  cands.push(path.join(repo, 'tools', 'cpcec', 'work'));
  try { // a git worktree: the main checkout holds the (git-ignored) work directory
    const common = execFileSync('git', ['-C', repo, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
    cands.push(path.join(path.resolve(repo, common, '..'), 'tools', 'cpcec', 'work'));
  } catch { /* not a git checkout */ }
  for (const c of cands) if (fs.existsSync(path.join(c, 'cpc6128.rom'))) return c;
  throw new Error('CPCEC ROMs not found (run make cpcec, or set CPCEC_WORK): tried ' + cands.join(', '));
}
const work = findWork();
const ROMS = ['cpc464.rom', 'cpc664.rom', 'cpc6128.rom', 'cpcplus.rom', 'cpcados.rom'];
const romBytes = Object.fromEntries(ROMS.map((r) => [r, fs.readFileSync(path.join(work, r))]));

// ---- a small PNG reader (8-bit RGB / RGBA / palette, any filter; all that CPCEC and PIL write) ----
function readPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0, plte = null; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len); off += 12 + len;
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; }
    else if (type === 'PLTE') plte = data; else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break;
  }
  if (depth !== 8 || ![2, 3, 6].includes(ctype)) throw new Error(`unsupported PNG (depth ${depth}, type ${ctype})`);
  const bpp = ctype === 2 ? 3 : ctype === 6 ? 4 : 1, stride = w * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0, b = y ? out[dst - stride + x] : 0, c = x >= bpp && y ? out[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + x] = v;
    }
  }
  const px = new Uint32Array(w * h); // 0x00RRGGBB, like CPCEC's VIDEO_UNIT
  for (let i = 0; i < w * h; i++) {
    if (ctype === 3) { const k = out[i] * 3; px[i] = (plte[k] << 16) | (plte[k + 1] << 8) | plte[k + 2]; }
    else px[i] = (out[i * bpp] << 16) | (out[i * bpp + 1] << 8) | out[i * bpp + 2];
  }
  return { w, h, px };
}

function diffCount(a, b) { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; }

async function boot(model) {
  const M = await createCpcec();
  for (const r of ROMS) M.FS.writeFile('/' + r, romBytes[r]);
  M.FS.mkdir('/shots');
  const ex = (n) => M['_' + n];
  if (ex('emu_init')(model)) throw new Error('emu_init failed');
  return { M, e: new Proxy({}, { get: (_, n) => M['_' + n] }) };
}
function cstr(M, s) { const n = M.lengthBytesUTF8 ? M.lengthBytesUTF8(s) + 1 : s.length + 1; const p = M._malloc(n); M.stringToUTF8(s, p, n); return p; }
function framebuffer(M, e) { // the visible area as a packed 0x00RRGGBB array
  const ptr = e.emu_framebuffer() >> 2, w = e.emu_fb_width(), h = e.emu_fb_height(), stride = e.emu_fb_stride();
  const out = new Uint32Array(w * h), heap = new Uint32Array(M.HEAPU8.buffer);
  for (let y = 0; y < h; y++) out.set(heap.subarray(ptr + y * stride, ptr + y * stride + w), y * w);
  return { w, h, px: out };
}

const results = []; let failed = 0;
function report(ok, name, detail = '') { if (!ok) failed++; results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); }

// ---- 1. pictures ----
const manifest = JSON.parse(fs.readFileSync(path.join(media, 'manifest.json'), 'utf8'));
const only = process.argv.slice(2);
for (const c of manifest.cases) {
  if (only.length && !only.includes(c.name)) continue;
  const { M, e } = await boot(c.model);
  M.FS.writeFile('/media.' + c.kind, fs.readFileSync(path.join(media, c.media)));
  const dir = cstr(M, '/shots'), p = cstr(M, '/media.' + c.kind), k = cstr(M, c.kind);
  e.emu_test_shots(dir);
  if (e.emu_load(p, k)) { report(false, c.name, 'emu_load failed'); continue; }
  const shotPath = `/shots/${c.shot}.png`; let frames = 0, got = false;
  for (; frames < 6000 && !got; frames++) {
    if (e.emu_frame()) { report(false, c.name, 'stopped by the debugger'); break; }
    got = M.FS.analyzePath(shotPath).exists;
  }
  if (!got) { report(false, c.name, `no ${c.shot} shot within ${frames} frames`); continue; }
  const gold = readPng(fs.readFileSync(c.golden));
  const saved = readPng(Buffer.from(M.FS.readFile(shotPath)));
  const live = framebuffer(M, e);
  const dSaved = saved.w === gold.w && saved.h === gold.h ? diffCount(saved.px, gold.px) : -1;
  const dLive = live.w === gold.w && live.h === gold.h ? diffCount(live.px, gold.px) : -1;
  report(dSaved === 0, `${c.name}: CPCEC's PNG vs golden`, `${gold.w}x${gold.h}, frame ${frames}, ${dSaved} px differ`);
  report(dLive === 0, `${c.name}: emu_framebuffer vs golden`, `${dLive} px differ`);
  // emu_rgba() is the same picture packed for ImageData
  const rgba = e.emu_rgba(), rg = new Uint8Array(M.HEAPU8.buffer, rgba, live.w * live.h * 4);
  let bad = 0; for (let i = 0; i < live.px.length; i++) {
    const v = live.px[i]; if (rg[i * 4] !== ((v >> 16) & 255) || rg[i * 4 + 1] !== ((v >> 8) & 255) || rg[i * 4 + 2] !== (v & 255) || rg[i * 4 + 3] !== 255) bad++;
  }
  report(bad === 0, `${c.name}: emu_rgba matches the frame buffer`, `${bad} px differ`);
}

// ---- 1b. the stock models' power-on screens (no media), 200 frames in, against the native CPCEC's ----
for (const c of manifest.boots ?? []) {
  if (only.length && !only.includes(c.name)) continue;
  const { M, e } = await boot(c.model);
  for (let i = 0; i < c.frames; i++) e.emu_frame();
  const gold = readPng(fs.readFileSync(c.golden)), live = framebuffer(M, e);
  const d = live.w === gold.w && live.h === gold.h ? diffCount(live.px, gold.px) : -1;
  report(d === 0, `${c.name}: power-on screen vs native CPCEC`, `model ${c.model}, frame ${c.frames}, ${d} px differ`);
}

// ---- 2. the debugger, on plusdemo (disc, bare metal, origin &0040) ----
if (!only.length || only.includes('debugger')) {
  const map = new Map(fs.readFileSync(path.join(media, 'plusdemo.map'), 'utf8').split('\n').filter(Boolean)
    .map((l) => { const [a, n] = l.split(': '); return [n.trim(), parseInt(a, 16)]; }));
  const bin = fs.readFileSync(path.join(media, 'plusdemo.bin')), org = map.get('.core.__START_PROGRAM');
  const sub = map.get('._MoveSprites'), frameVar = map.get('._frame');
  const { M, e } = await boot(3);
  M.FS.writeFile('/media.dsk', fs.readFileSync(path.join(media, 'plusdemo.dsk')));
  e.emu_load(cstr(M, '/media.dsk'), cstr(M, 'dsk'));
  const regs = M._malloc(24 * 4), r = () => { e.emu_regs(regs); return new Int32Array(M.HEAPU8.buffer, regs, 24).slice(); };
  const peek = (a) => e.emu_peek(a), word = (a) => peek(a) | (peek(a + 1) << 8);
  const runToStop = (limit) => { for (let i = 0; i < limit; i++) if (e.emu_frame()) return i; return -1; };
  report(Number.isInteger(sub) && Number.isInteger(frameVar), 'debugger: labels found in plusdemo.map', `MoveSprites=&${sub?.toString(16)} frame=&${frameVar?.toString(16)}`);
  e.emu_break(sub, 1);
  const f1 = runToStop(3000), r1 = r();
  report(f1 >= 0 && r1[0] === sub && r1[20] === 1 && r1[21] === 1, 'debugger: stops at the breakpoint', `after ${f1} frames, PC=&${r1[0].toString(16)} stopped=${r1[20]} reason=${r1[21]}`);
  report(peek(sub) === bin[sub - org], 'debugger: emu_peek reads the program code', `&${sub.toString(16)} = &${peek(sub).toString(16)}`);
  report(e.emu_frame() === 1 && r()[0] === sub, 'debugger: stays stopped until emu_continue');
  const fv1 = word(frameVar), sp1 = r1[1], ret = word(sp1);
  e.emu_poke(0x3000, 0xa5);
  report(peek(0x3000) === 0xa5, 'debugger: emu_poke / emu_peek round trip');
  const pc2 = e.emu_step(), r2 = r();
  report(pc2 === r2[0] && pc2 !== sub && r2[20] === 1 && r2[21] === 2, 'debugger: emu_step executes one instruction', `PC &${sub.toString(16)} -> &${pc2.toString(16)}`);
  // continue: the breakpoint is hit again one or more frames later
  e.emu_continue();
  const fr1 = r2[18], f4 = runToStop(3000), r4 = r();
  report(f4 >= 0 && r4[0] === sub && r4[18] > fr1 && r4[21] === 1, 'debugger: continue hits the breakpoint again', `frame ${fr1} -> ${r4[18]}`);
  // step over a CALL in the real program: the whole call runs, the stop is the next instruction
  let a = sub; while (a < sub + 400 && peek(a) !== 0xcd) a++;
  e.emu_break(sub, 0); e.emu_break(a, 1); e.emu_continue();
  const f5 = runToStop(3000), r5 = r();
  report(f5 >= 0 && r5[0] === a, 'debugger: breakpoint on a CALL instruction', `CALL at &${a.toString(16)}`);
  const stopped = e.emu_step_over(); const f6 = stopped ? 0 : runToStop(3000), r6 = r();
  report(!stopped && f6 >= 0 && r6[0] === a + 3 && r6[21] === 2, 'debugger: emu_step_over runs the call and lands after it', `PC=&${r6[0].toString(16)} want &${(a + 3).toString(16)}`);
  e.emu_break_clear(); e.emu_continue();
  const free = runToStop(120);
  report(free === -1, 'debugger: with no breakpoints the machine runs on', '120 frames');
  // step out and step over on a routine written for the purpose (callee-cleanup routines such as the
  // real program's confuse CPCEC's "SP above the entry SP" return trap, so the test owns its code)
  const code = [0xf3, 0xcd, 0x10, 0x90, 0x00, 0x00, 0x18, 0xfe, 0, 0, 0, 0, 0, 0, 0, 0, 0xf5, 0x00, 0xf1, 0xc9];
  code.forEach((b, i) => e.emu_poke(0x9000 + i, b)); // 9000 DI; CALL 9010; NOP NOP; JR $ ... 9010 PUSH AF; NOP; POP AF; RET
  e.emu_stop(); e.emu_jump(0x9000); e.emu_continue();
  const sp0 = r()[1]; e.emu_break(0x9010, 1);
  const g1 = runToStop(10), q1 = r();
  report(g1 >= 0 && q1[0] === 0x9010 && q1[1] === sp0 - 2, 'debugger: synthetic routine, breakpoint inside the CALL', `PC=&${q1[0].toString(16)} SP-SP0=${q1[1] - sp0}`);
  const so = e.emu_step_out(); const g2 = so ? 0 : runToStop(10), q2 = r();
  report(!so && g2 >= 0 && q2[0] === 0x9004 && q2[1] === sp0 && q2[21] === 2, 'debugger: emu_step_out runs to the return', `PC=&${q2[0].toString(16)} SP-SP0=${q2[1] - sp0}`);
  e.emu_break_clear(); e.emu_jump(0x9000); e.emu_step(); // DI
  const ov = e.emu_step_over(); const g3 = ov ? 0 : runToStop(10), q3 = r();
  report(!ov && g3 >= 0 && q3[0] === 0x9004 && q3[1] === sp0, 'debugger: emu_step_over on a CALL', `PC=&${q3[0].toString(16)}`);
  const ov2 = e.emu_step_over(), q4 = r();
  report(ov2 === 1 && q4[0] === 0x9005, 'debugger: emu_step_over on a plain instruction is one step', `PC=&${q4[0].toString(16)}`);
  // keyboard: press and release does not wedge the machine
  e.emu_key(0x12, 1); e.emu_frame(); e.emu_key(0x12, 0); e.emu_frame();
}

// ---- audio: plusdemo plays a jingle; the samples must come out of emu_audio ----
if (!only.length || only.includes('audio')) {
  const { M, e } = await boot(3);
  M.FS.writeFile('/media.dsk', fs.readFileSync(path.join(media, 'plusdemo.dsk')));
  e.emu_load(cstr(M, '/media.dsk'), cstr(M, 'dsk'));
  const apt = M._malloc(882 * 4); let peak = 0, pairs = 0;
  for (let i = 0; i < 700; i++) {
    e.emu_frame(); pairs = e.emu_audio(apt);
    const pcm = new Int16Array(M.HEAPU8.buffer, apt, pairs * 2); for (const v of pcm) peak = Math.max(peak, Math.abs(v));
  }
  report(pairs === 882 && e.emu_audio_rate() === 44100 && peak > 1000, 'audio: plusdemo\'s jingle comes out of emu_audio', `${pairs} stereo pairs per frame at ${e.emu_audio_rate()} Hz, peak ${peak} within 700 frames`);
}

// ---- 3. speed ----
if (!only.length || only.includes('speed')) {
  const { M, e } = await boot(3);
  M.FS.writeFile('/media.dsk', fs.readFileSync(path.join(media, 'plusdemo.dsk')));
  e.emu_load(cstr(M, '/media.dsk'), cstr(M, 'dsk'));
  for (let i = 0; i < 200; i++) e.emu_frame(); // warm up (and let the demo start)
  const N = 2000, t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) e.emu_frame();
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  const fps = N / secs, wasm = fs.statSync(path.join(root, 'wasm', 'cpcec.wasm')).size;
  report(fps > 100, 'speed: plusdemo frames per second in Node', `${fps.toFixed(0)} fps (${(fps / 50).toFixed(1)}x real time); cpcec.wasm ${(wasm / 1024).toFixed(0)} KiB`);
}

console.log(results.join('\n'));
console.log(`\n${results.length - failed}/${results.length} ok`);
process.exit(failed ? 1 : 0);

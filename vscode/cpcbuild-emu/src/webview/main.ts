/// <reference lib="dom" />
// The CPC Emulator page: CPCEC (WebAssembly) driven from requestAnimationFrame, paced by an AudioWorklet
// when sound is on and by the wall clock otherwise. Answers the host's typed requests (src/shared/protocol.ts).
import type { EmuModel, EmuPauseReason, EmuState } from '../emuApi';
import type { HostNotice, HostRequest, ResponseMsg, WebviewBoot, WebviewNotice } from '../shared/protocol';
import { usbFromCode } from '../shared/keymap';

declare function acquireVsCodeApi(): { postMessage(m: unknown): void };
const api = acquireVsCodeApi();
const post = (m: ResponseMsg | WebviewNotice): void => api.postMessage(m);

interface Module {
  FS: { writeFile(p: string, d: Uint8Array | string): void; unlink(p: string): void };
  HEAPU8: Uint8Array;
  _malloc(n: number): number;
  _free(p: number): void;
  stringToUTF8(s: string, p: number, n: number): void;
  lengthBytesUTF8(s: string): number;
  [k: string]: unknown;
}
type Fn = (...a: number[]) => number;

const boot: WebviewBoot = JSON.parse(document.getElementById('boot')!.textContent!);
const W = 768, H = 536, FRAME_MS = 20, FRAME_PAIRS = 882;
const MODELS: EmuModel[] = ['464', '664', '6128', 'plus'];
const REASONS: (EmuPauseReason | undefined)[] = [undefined, 'breakpoint', 'step', 'user'];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('screen'), stage = $('stage'), status = $('status'), modelEl = $('model');
const btnPause = $<HTMLButtonElement>('pause'), btnReset = $<HTMLButtonElement>('reset'), btnSound = $<HTMLButtonElement>('sound');
const g = canvas.getContext('2d', { alpha: false })!;
const image = g.createImageData(W, H);

let M: Module | null = null;
let ex: Record<string, Fn> = {};
let regsPtr = 0, audPtr = 0;
let model: EmuModel = '6128';
let hostVisible = true, runHidden = boot.runHidden;
let stepping: { id: number } | null = null;
const breakpoints = new Set<number>();
let wasmBytes: ArrayBuffer | null = null;
const romCache = new Map<string, Uint8Array>();

window.addEventListener('error', (e) => post({ kind: 'log', text: `error: ${e.message} ${e.filename}:${e.lineno}` }));
window.addEventListener('unhandledrejection', (e) => post({ kind: 'log', text: `unhandled: ${String((e.reason as Error)?.stack ?? e.reason)}` }));

// ---- audio ----
let actx: AudioContext | null = null, node: AudioWorkletNode | null = null;
let produced = 0, consumed = 0, soundFailed = false;
const audioRunning = (): boolean => !!actx && actx.state === 'running' && !!node;

async function enableSound(): Promise<void> {
  if (soundFailed) return;
  try {
    if (!actx) {
      actx = new AudioContext({ sampleRate: 44100, latencyHint: 'interactive' });
      await actx.audioWorklet.addModule(boot.worklet);
      node = new AudioWorkletNode(actx, 'cpc-out', { outputChannelCount: [2] });
      node.port.onmessage = (ev: MessageEvent): void => {
        consumed = (ev.data as { consumed: number }).consumed;
        if (!visible()) tick(); // hidden pages get no animation frames, but worklet messages keep coming
      };
      node.connect(actx.destination);
      actx.onstatechange = showSound;
    }
    // resume() stays pending until the browser allows audio (a user gesture): never await it
    if (actx.state !== 'running' && visible()) void actx.resume();
  } catch (err) {
    soundFailed = true;
    post({ kind: 'log', text: `sound unavailable: ${String(err)}` });
  }
  showSound();
}
function showSound(): void {
  btnSound.hidden = audioRunning() || soundFailed;
}
btnSound.addEventListener('click', () => { void enableSound(); canvas.focus(); });

// ---- helpers ----
function toB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s), b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}
const visible = (): boolean => hostVisible;
const suspended = (): boolean => !hostVisible && !runHidden;

function cstr(s: string): number {
  const n = M!.lengthBytesUTF8(s) + 1, p = M!._malloc(n);
  M!.stringToUTF8(s, p, n);
  return p;
}

function readState(): EmuState {
  const r = new Int32Array(M!.HEAPU8.buffer, regsPtr, 24);
  ex.emu_regs(regsPtr);
  const paused = r[20] === 1;
  return {
    running: !paused, paused, reason: paused ? REASONS[r[21]] ?? 'user' : undefined,
    pc: r[0], sp: r[1], af: r[2], bc: r[3], de: r[4], hl: r[5], ix: r[6], iy: r[7],
    af2: r[8], bc2: r[9], de2: r[10], hl2: r[11], i: r[12], r: r[13], im: r[14], iff1: r[15],
    frame: r[18], model: MODELS[r[19]] ?? model,
  };
}

const hex = (n: number): string => '&' + n.toString(16).toUpperCase().padStart(4, '0');
function updateUi(s?: EmuState): void {
  const st = s ?? (M ? readState() : undefined);
  if (!st) {
    status.textContent = 'No program loaded';
    return;
  }
  const label = st.paused ? `Paused (${st.reason ?? 'user'}) at ${hex(st.pc)}` : suspended() ? 'Suspended (tab hidden)' : 'Running';
  if (status.textContent !== label) status.textContent = label;
  btnPause.setAttribute('aria-label', st.paused ? 'Resume' : 'Pause');
  btnPause.title = st.paused ? 'Resume' : 'Pause';
  btnPause.querySelector('.codicon')!.className = 'codicon ' + (st.paused ? 'codicon-debug-continue' : 'codicon-debug-pause');
  modelEl.textContent = 'CPC ' + (st.model === 'plus' ? '6128 Plus' : st.model);
}

function emit(event: 'paused' | 'resumed'): EmuState {
  const s = readState();
  updateUi(s);
  post({ kind: 'event', event, state: s });
  return s;
}

function draw(): void {
  if (!M) return;
  const p = ex.emu_rgba();
  image.data.set(M.HEAPU8.subarray(p, p + W * H * 4));
  g.putImageData(image, 0, 0);
}

function pushAudio(): void {
  if (!audioRunning() || !M) return;
  const n = ex.emu_audio(audPtr);
  if (n > 0) {
    const buf = new Int16Array(n * 2);
    buf.set(new Int16Array(M.HEAPU8.buffer, audPtr, n * 2));
    node!.port.postMessage({ samples: buf }, [buf.buffer]);
    produced += n;
  }
}

// ---- the frame loop ----
let last = performance.now(), debt = 0;

/** Runs one frame; returns true if the machine stopped (breakpoint or step trap). */
function runFrame(): boolean {
  if (ex.emu_frame()) return true;
  pushAudio();
  return false;
}

function onStopped(): void {
  if (stepping) {
    const id = stepping.id;
    stepping = null;
    const s = emit('paused');
    post({ kind: 'response', id, ok: true, result: { state: s } } as ResponseMsg);
  } else emit('paused');
  draw();
}

function tick(): void {
  const now = performance.now();
  const dt = Math.min(now - last, 100);
  last = now;
  if (!M || suspended()) { debt = 0; return; }
  if (ex.emu_stopped() && !stepping) return;
  let n: number;
  if (stepping) n = 3;
  else if (audioRunning()) {
    const level = produced - consumed;
    n = level < FRAME_PAIRS * 3 ? Math.min(2, Math.ceil((FRAME_PAIRS * 3 - level) / FRAME_PAIRS)) : 0;
    debt = 0;
  } else {
    debt += dt;
    n = Math.min(3, Math.floor(debt / FRAME_MS));
    debt -= Math.floor(debt / FRAME_MS) * FRAME_MS;
  }
  for (let i = 0; i < n; i++) {
    if (runFrame()) { onStopped(); return; }
  }
  if (n > 0) draw();
}

let raf = 0, timer: ReturnType<typeof setTimeout> | undefined;
/** One loop chain at a time: animation frames while shown, a timer while hidden (and allowed to run). */
function schedule(): void {
  if (raf) cancelAnimationFrame(raf);
  if (timer !== undefined) clearTimeout(timer);
  raf = 0; timer = undefined;
  if (hostVisible) raf = requestAnimationFrame(loop);
  else timer = setTimeout(loop, FRAME_MS);
}
function loop(): void {
  tick();
  schedule();
}

// ---- layout ----
function fit(): void {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (w <= 0 || h <= 0) return;
  let s = Math.min(w / W, h / H);
  if (s >= 1) s = Math.floor(s); // integer scale when it fits: crisp pixels
  canvas.style.width = Math.floor(W * s) + 'px';
  canvas.style.height = Math.floor(H * s) + 'px';
}
new ResizeObserver(fit).observe(stage);
fit();

// ---- module and media ----
async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`cannot load ${url}: ${r.status}`);
  return r.arrayBuffer();
}

async function instantiate(m: EmuModel): Promise<void> {
  if (M) { M._free(regsPtr); M._free(audPtr); M = null; }
  wasmBytes ??= await fetchBytes(boot.cpcecWasm);
  const mod = (await import(/* webpackIgnore: true */ boot.cpcecJs)) as { default: (o: object) => Promise<Module> };
  const mm = await mod.default({ wasmBinary: wasmBytes });
  for (const [name, url] of Object.entries(boot.roms)) {
    let b = romCache.get(name);
    if (!b) { b = new Uint8Array(await fetchBytes(url)); romCache.set(name, b); }
    mm.FS.writeFile('/' + name, b);
  }
  ex = new Proxy({}, { get: (_t, n: string) => mm['_' + n] as Fn }) as Record<string, Fn>;
  M = mm;
  if (ex.emu_init(MODELS.indexOf(m))) { M = null; throw new Error('emu_init failed'); }
  regsPtr = mm._malloc(24 * 4);
  audPtr = mm._malloc(FRAME_PAIRS * 4);
  model = m;
}

async function doOpen(r: Extract<HostRequest, { type: 'open' }>): Promise<{ state: EmuState }> {
  stepping = null;
  await instantiate(r.model);
  const path = '/media.' + r.fileKind;
  M!.FS.writeFile(path, fromB64(r.data));
  const p = cstr(path), k = cstr(r.fileKind);
  const rc = ex.emu_load(p, k);
  M!._free(p); M!._free(k);
  if (rc) throw new Error(`CPCEC could not load ${r.name}`);
  if (r.run && r.fileKind === 'dsk') { const q = cstr(r.run); ex.emu_set_run(q); M!._free(q); }
  for (const a of breakpoints) ex.emu_break(a, 1);
  produced = consumed = 0;
  node?.port.postMessage({ clear: true });
  last = performance.now(); debt = 0;
  draw();
  const s = readState();
  updateUi(s);
  return { state: s };
}

// ---- requests ----
function need(): void {
  if (!M) throw new Error('no program loaded yet (cpcbuild.emu.open first)');
}

async function handle(r: HostRequest): Promise<unknown> {
  if (r.type === 'open') return doOpen(r);
  need();
  switch (r.type) {
    case 'state': return { state: readState() };
    case 'reset': {
      const was = ex.emu_stopped();
      stepping = null;
      ex.emu_reset();
      produced = consumed = 0;
      node?.port.postMessage({ clear: true });
      const s = was ? emit('resumed') : readState();
      updateUi(s);
      return { state: s };
    }
    case 'pause': {
      if (!ex.emu_stopped()) {
        const pending = stepping;
        stepping = null;
        ex.emu_stop();
        const s = emit('paused');
        if (pending) post({ kind: 'response', id: pending.id, ok: true, result: { state: s } });
        return { state: s };
      }
      return { state: readState() };
    }
    case 'resume': {
      if (ex.emu_stopped()) { ex.emu_continue(); return { state: emit('resumed') }; }
      return { state: readState() };
    }
    case 'step': {
      if (!ex.emu_stopped()) throw new Error('the emulator is running: pause it first');
      ex.emu_step();
      draw();
      return { state: emit('paused') };
    }
    case 'stepOver':
    case 'stepOut': {
      if (!ex.emu_stopped()) throw new Error('the emulator is running: pause it first');
      const done = r.type === 'stepOver' ? ex.emu_step_over() : ex.emu_step_out();
      if (done) { draw(); return { state: emit('paused') }; }
      stepping = { id: r.id };
      updateUi({ ...readState(), running: true, paused: false });
      return STEPPING; // answered later, by onStopped()
    }
    case 'readMemory': {
      const out = new Uint8Array(r.length);
      for (let i = 0; i < r.length; i++) out[i] = ex.emu_peek((r.addr + i) & 0xffff) & 255;
      return { bytes: toB64(out) };
    }
    case 'writeMemory':
    { const b = fromB64(r.bytes); for (let i = 0; i < b.length; i++) ex.emu_poke((r.addr + i) & 0xffff, b[i]); }
      return {};
    case 'setBreakpoint':
      if (r.on) breakpoints.add(r.addr); else breakpoints.delete(r.addr);
      ex.emu_break(r.addr, r.on ? 1 : 0);
      return {};
    case 'screenshot': {
      const p = ex.emu_rgba();
      return { rgba: toB64(M!.HEAPU8.subarray(p, p + W * H * 4)), width: W, height: H };
    }
  }
}
const STEPPING = Symbol('answered later');

/** Requests run one at a time, in arrival order: an `open` that is still loading must not interleave with a `readMemory` or `step`. */
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

window.addEventListener('message', (ev: MessageEvent) => {
  const m = ev.data as (HostRequest & { kind?: undefined }) | HostNotice;
  if ('kind' in m && m.kind) {
    if (m.kind === 'visibility') {
      hostVisible = m.visible;
      last = performance.now(); debt = 0;
      if (actx) { if (suspended()) void actx.suspend(); else if (m.visible || runHidden) void actx.resume().then(showSound); }
      updateUi();
      if (hostVisible) fit();
      schedule();
    } else if (m.kind === 'probeAudio') {
      void enableSound().then(() => post({ kind: 'log', text: `sound probe: context=${actx?.state ?? 'none'} worklet=${node ? 'loaded' : 'missing'} failed=${soundFailed}` }));
    } else if (m.kind === 'config') {
      runHidden = m.runHidden;
      if (actx && !suspended()) void actx.resume().then(showSound);
      updateUi();
    }
    return;
  }
  const req = m as HostRequest;
  void enqueue(() => handle(req)).then(
    (result) => { if (result !== STEPPING) post({ kind: 'response', id: req.id, ok: true, result }); },
    (err: unknown) => { stepping = null; post({ kind: 'response', id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }); },
  );
});

// ---- toolbar and keyboard ----
const ui = (type: 'reset' | 'pause' | 'resume'): void => { enqueue(() => handle({ id: -1, type })).catch((e: unknown) => post({ kind: 'log', text: String(e) })); };
btnReset.addEventListener('click', () => { if (M) ui('reset'); });
btnPause.addEventListener('click', () => {
  if (M) ui(ex.emu_stopped() ? 'resume' : 'pause');
});

canvas.addEventListener('pointerdown', () => { void enableSound(); });
canvas.addEventListener('keydown', (e) => {
  void enableSound();
  if (e.ctrlKey && e.shiftKey && e.code === 'Escape') { btnPause.focus(); e.preventDefault(); return; } // leave the keyboard trap
  if (e.metaKey || !M) return;
  const usb = usbFromCode(e.code);
  if (usb === undefined) return;
  ex.emu_key_usb(usb, 1);
  e.preventDefault();
});
canvas.addEventListener('keyup', (e) => {
  if (!M) return;
  const usb = usbFromCode(e.code);
  if (usb === undefined) return;
  ex.emu_key_usb(usb, 0);
  e.preventDefault();
});
canvas.addEventListener('blur', () => { if (M) ex.emu_keys_release(); });

updateUi();
showSound();
schedule();
post({ kind: 'ready' });

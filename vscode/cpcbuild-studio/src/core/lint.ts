/**
 * lint.ts -- the advisory rules CB001-CB011 (spec 5.4). Token-level and
 * conservative: a rule only fires on what it can see in one source file, and
 * stays quiet when a name is the program's own (a user SUB that shadows a
 * library name) or when the call sits inside conditional compilation.
 *
 * Not implemented: CB010 (needs the last build's memory report; the compiler
 * already stops with an error when code reaches &4000 under double buffering
 * or banks, so a static rule would only duplicate it).
 */
import { Call, findCalls, includesOf, mask, ppDepths, scopesOf, userDefinedNames } from './bastok';
import type { LibIndex } from './libindex';

export type RuleId = 'CB001' | 'CB002' | 'CB003' | 'CB004' | 'CB005' | 'CB006' | 'CB007' | 'CB008' | 'CB009' | 'CB011';
export type Severity = 'hint' | 'information' | 'warning' | 'error';

export const RULES: Record<RuleId, { severity: Severity; summary: string }> = {
  CB001: { severity: 'warning', summary: 'Mode without ScreenInit() before drawing' },
  CB002: { severity: 'warning', summary: 'SPRLIST_MAX / TEXT_QUEUE defined after the include that reaches the module' },
  CB003: { severity: 'warning', summary: 'firmware-only call in a bare target, or bare-only call in a firmware target' },
  CB004: { severity: 'information', summary: '12-bit palette set before a Mode and not set again after it' },
  CB005: { severity: 'information', summary: 'Plus program with sprites ends without SpritesHideAll()' },
  CB006: { severity: 'warning', summary: 'AY owners mixed (Play, AyWrite, MusicInit)' },
  CB007: { severity: 'warning', summary: 'literal argument outside the parameter type or pen range' },
  CB008: { severity: 'warning', summary: 'Spectrum-only module included under a CPC target' },
  CB009: { severity: 'warning', summary: 'sprite size outside 1-255 (SprListDraw: width above 8)' },
  CB011: { severity: 'warning', summary: '#if defined() is not understood by zxbpp' },
};

export interface Finding {
  rule: RuleId;
  /** 0-based. */
  line: number;
  col: number;
  endCol: number;
  message: string;
}

export interface LintContext {
  /** The library index (for CB007 parameter types); without it CB007 only checks the built-in pen rules. */
  index?: LibIndex;
  /** Target facts, when known (undefined = unknown or the targets disagree: the rules that need them stay quiet). */
  arch?: 'cpc' | 'zx48k';
  bare?: boolean;
  /** Names defined by files this one includes (lower case). */
  userNames?: ReadonlySet<string>;
}

const low = (names: string[]): Set<string> => new Set(names.map((n) => n.toLowerCase()));

const DRAW = low([
  'PutSprite', 'PutSpriteMasked', 'GetBlock', 'FillRect', 'ClearScreen', 'DoTile8', 'DoTile16', 'TileMap', 'TileMapPart',
  'TileRestore', 'SprListDraw', 'TextAt', 'TextAtBoth', 'TextFlush', 'PokeScreen', 'PeekScreen',
]);
export const FIRMWARE_ONLY = ['SoundQueue', 'SoundFree', 'SoundBusy', 'SoundEnvelope', 'BankLoad'];
export const BARE_ONLY = ['RasterIntAt', 'RasterIntOff', 'RasterIntMove', 'RasterIntClear'];
const PAL12 = low(['SetPalette12', 'SetBorder12', 'SetPalette12Block']);
const PLUS_SPRITE = low([
  'SpriteMove', 'SpriteMoveBlock', 'SpriteMag', 'SpriteSetImage', 'SpriteSetImagePacked', 'SpriteColour', 'SpritePalette',
]);
const SPECTRUM_ONLY = ['print42.bas', 'print64.bas', 'attr.bas', 'sinclair.bas'];
const SIZED = low(['PutSprite', 'PutSpriteMasked', 'GetBlock']);
const PEN_CALLS = low(['PenByte', 'FillRect', 'ClearScreen', 'TextPen']);
const MODE_PENS = [15, 3, 1];

const RANGES: Record<string, [number, number]> = {
  UBYTE: [0, 255],
  BYTE: [-128, 127],
  UINTEGER: [0, 65535],
  INTEGER: [-32768, 32767],
};

/** An integer literal's value (decimal, 0x, $, &H, &, %binary), or undefined for anything else. */
export function literalValue(text: string): number | undefined {
  let t = text.trim();
  let neg = false;
  if (t.startsWith('-')) {
    neg = true;
    t = t.slice(1).trim();
  }
  let v: number | undefined;
  let m: RegExpExecArray | null;
  if (/^\d+$/.test(t)) v = parseInt(t, 10);
  else if ((m = /^0x([0-9a-f]+)$/i.exec(t))) v = parseInt(m[1], 16);
  else if ((m = /^\$([0-9a-f]+)$/i.exec(t))) v = parseInt(m[1], 16);
  else if ((m = /^&h?([0-9a-f]+)$/i.exec(t))) v = parseInt(m[1], 16);
  else if ((m = /^%([01]+)$/.exec(t))) v = parseInt(m[1], 2);
  if (v === undefined || !Number.isFinite(v)) return undefined;
  return neg ? -v : v;
}

export function lint(text: string, ctx: LintContext = {}): Finding[] {
  const m = mask(text);
  const out: Finding[] = [];
  const own = userDefinedNames(m.code);
  for (const n of ctx.userNames ?? []) own.add(n);
  const depths = ppDepths(m.code);
  const scopes = scopesOf(m.code);
  const incs = includesOf(m);

  const names = new Set<string>(['mode', 'screeninit', 'spriteshideall', 'play', 'aywrite', 'musicinit', 'musicinitbank', 'setink', 'setborder', 'sprlistdraw']);
  for (const s of [DRAW, PAL12, PLUS_SPRITE, SIZED, PEN_CALLS]) for (const n of s) names.add(n);
  for (const n of [...FIRMWARE_ONLY, ...BARE_ONLY]) names.add(n.toLowerCase());
  if (ctx.index) for (const k of ctx.index.byName.keys()) names.add(k);
  // calls of the program's own subs matter to CB004; collect them separately
  const calls = findCalls(m.code, names).filter((c) => !own.has(c.lower));
  const add = (rule: RuleId, line: number, col: number, endCol: number, message: string): void => void out.push({ rule, line, col, endCol, message });
  const at = (c: Call, message: string, rule: RuleId): void => add(rule, c.line, c.col, c.col + c.name.length, message);

  // CB001: Mode, then drawing, with no ScreenInit() in between (same SUB/FUNCTION or the same top-level stretch)
  {
    let pending: Call | undefined;
    let scope = -1;
    for (const c of calls) {
      if (scopes[c.line] !== scope) {
        scope = scopes[c.line];
        pending = undefined;
      }
      if (c.lower === 'mode') pending = c;
      else if (c.lower === 'screeninit') pending = undefined;
      else if (pending && DRAW.has(c.lower)) {
        at(pending, `Mode is followed by ${c.name} (line ${c.line + 1}) with no ScreenInit() in between. The library reads the screen state in ScreenInit(): call it after every Mode.`, 'CB001');
        pending = undefined;
      }
    }
  }

  // CB002: #define of a library setting after the include that reaches its module
  {
    const reach: Record<string, string[]> = {
      SPRLIST_MAX: ['cpcbuild.bas', 'cpcbuild/spritelist.bas'],
      TEXT_QUEUE: ['cpcbuild.bas', 'cpcbuild/text.bas'],
    };
    for (const [setting, files] of Object.entries(reach)) {
      const inc = incs.find((i) => files.includes(i.path));
      if (!inc) continue;
      m.code.forEach((l, line) => {
        const d = new RegExp(`^\\s*#\\s*define\\s+(${setting})\\b`, 'i').exec(l);
        if (d && line > inc.line) {
          const col = l.indexOf(d[1]);
          add('CB002', line, col, col + setting.length, `${setting} is defined after #include <${inc.path}> (line ${inc.line + 1}), so the library has already used its default. Move this #define above the include.`);
        }
      });
    }
  }

  // CB003: firmware-only / bare-only calls against the target's mode
  if (ctx.bare !== undefined && (ctx.arch === undefined || ctx.arch === 'cpc')) {
    const bad = low(ctx.bare ? FIRMWARE_ONLY : BARE_ONLY);
    for (const c of calls) {
      if (!bad.has(c.lower) || depths[c.line] > 0) continue;
      at(c, ctx.bare
        ? `${c.name} needs the firmware, and this target is bare-metal (-D CPC_BAREMETAL): the build will fail with an "Undefined GLOBAL label". Use the music library, Play or AyWrite for sound; there is no disc in a bare target.`
        : `${c.name} works only in bare-metal builds (-D CPC_BAREMETAL; set "bare": true on the target), and this target uses the firmware.`, 'CB003');
    }
  }

  // CB004: 12-bit palette set, then Mode, never set again (firmware mode: Mode resets the inks)
  if (ctx.bare !== true) {
    const userCalls = findCalls(m.code, own).filter((c) => !['mode', 'screeninit'].includes(c.lower));
    const ev = [...calls.filter((c) => PAL12.has(c.lower) || c.lower === 'mode'), ...userCalls].sort((a, b) => a.line - b.line || a.col - b.col);
    let scope = -1;
    let sawPal = false;
    let pending: Call | undefined;
    const flush = (): void => {
      if (pending) at(pending, 'Mode resets the inks, undoing the 12-bit palette set before it. Call SetPalette12 / SetBorder12 again after Mode.', 'CB004');
      pending = undefined;
    };
    for (const c of ev) {
      if (scopes[c.line] !== scope) {
        flush();
        scope = scopes[c.line];
        sawPal = false;
      }
      if (PAL12.has(c.lower)) {
        sawPal = true;
        pending = undefined;
      } else if (c.lower === 'mode') {
        if (sawPal && !pending) pending = c;
      } else pending = undefined; // a call to the program's own routine may set the palette
    }
    flush();
  }

  // CB005: a Plus program that moves sprites and ends with END but never calls SpritesHideAll
  if (incs.some((i) => i.path.includes('cpcplus')) && calls.some((c) => PLUS_SPRITE.has(c.lower)) && !calls.some((c) => c.lower === 'spriteshideall')) {
    for (let line = 0; line < m.code.length; line++) {
      const em = /(^|:|\bthen\b|\belse\b)\s*(end)\s*(?::|$)/i.exec(m.code[line]);
      if (em) {
        const col = m.code[line].indexOf(em[2], em.index);
        add('CB005', line, col, col + 3, 'This Plus program ends without SpritesHideAll(): hardware sprites are ASIC state and stay on screen after the program ends. Call SpritesHideAll() before END.');
        break;
      }
    }
  }

  // CB006: two AY owners in one program
  {
    const hasPlay = incs.some((i) => i.path === 'play.bas');
    const owners: [string, Call][] = [];
    for (const c of calls) {
      if (c.lower === 'play' && hasPlay) owners.push(['Play', c]);
      else if (c.lower === 'aywrite') owners.push(['AyWrite', c]);
      else if (c.lower === 'musicinit' || c.lower === 'musicinitbank') owners.push(['MusicInit', c]);
    }
    const first = owners[0];
    const other = first && owners.find(([k]) => k !== first[0]);
    if (first && other) {
      at(other[1], `${other[0]} and ${first[0]} (line ${first[1].line + 1}) both drive the sound chip. The AY has one owner at a time: call SoundStop() and use only one of them while it plays (library.md, sound ownership).`, 'CB006');
    }
  }

  // CB007: a literal argument outside the parameter's type, or a pen the screen mode lacks
  {
    let scope = -1;
    let modeLit: number | undefined;
    for (const c of calls) {
      if (scopes[c.line] !== scope) {
        scope = scopes[c.line];
        modeLit = undefined;
      }
      if (c.lower === 'mode') {
        const v = c.args?.length === 1 ? literalValue(c.args[0].text) : undefined;
        modeLit = v !== undefined && v >= 0 && v <= 2 ? v : undefined;
        continue;
      }
      if (!c.args) continue;
      const rt = ctx.index?.byName.get(c.lower)?.[0];
      if (rt) {
        c.args.forEach((a, i) => {
          const p = rt.params[i];
          if (!p?.type || !RANGES[p.type]) return;
          if (SIZED.has(c.lower) && (p.name === 'w' || p.name === 'h')) return; // CB009's
          if (c.lower === 'sprlistdraw' && (p.name === 'w' || p.name === 'h')) return;
          const v = literalValue(a.text);
          const [lo, hi] = RANGES[p.type];
          if (v !== undefined && (v < lo || v > hi)) {
            add('CB007', a.line, a.col, a.col + a.text.length, `${a.text} is outside ${p.type} (${lo} to ${hi}), the type of ${c.name}'s "${p.name}". It will be truncated; use a value in range.`);
          }
        });
      }
      if (c.lower === 'setink') {
        const pen = c.args[0] && literalValue(c.args[0].text);
        const col = c.args[1] && literalValue(c.args[1].text);
        if (pen !== undefined && pen > 15 && pen <= 255) add('CB007', c.args[0].line, c.args[0].col, c.args[0].col + c.args[0].text.length, `SetInk ignores pens above 15 (found ${pen}).`);
        if (col !== undefined && col > 26 && col <= 255) add('CB007', c.args[1].line, c.args[1].col, c.args[1].col + c.args[1].text.length, `SetInk ignores colours above 26 (found ${col}); the firmware colours are 0-26.`);
      } else if (c.lower === 'setborder') {
        const v = c.args[0] && literalValue(c.args[0].text);
        if (v !== undefined && v > 26 && v <= 255) add('CB007', c.args[0].line, c.args[0].col, c.args[0].col + c.args[0].text.length, `SetBorder ignores colours above 26 (found ${v}); the firmware colours are 0-26.`);
      } else if (modeLit !== undefined && PEN_CALLS.has(c.lower)) {
        const rt2 = ctx.index?.byName.get(c.lower)?.[0];
        rt2?.params.forEach((p, i) => {
          if (!/pen$/i.test(p.name) || !c.args![i]) return;
          const v = literalValue(c.args![i].text);
          if (v !== undefined && v >= 0 && v <= 255 && v > MODE_PENS[modeLit!]) {
            const a = c.args![i];
            add('CB007', a.line, a.col, a.col + a.text.length, `Pen ${v} does not exist in mode ${modeLit} (pens 0-${MODE_PENS[modeLit!]}); only the low bits will be used.`);
          }
        });
      }
    }
  }

  // CB008: Spectrum-only modules under a CPC target
  if (ctx.arch === 'cpc') {
    for (const i of incs) {
      if (i.depth > 0 || !SPECTRUM_ONLY.includes(i.path)) continue;
      add('CB008', i.line, i.col, i.col + i.path.length, `${i.path} is Spectrum-only: on --arch cpc it stops the build with #error. Use Mode 2 for 80 columns, INK/PAPER for colour, and POINT() from point.bas to read a pixel.`);
    }
  }

  // CB009: sprite sizes
  for (const c of calls) {
    if (!c.args) continue;
    if (SIZED.has(c.lower) || c.lower === 'sprlistdraw') {
      for (const idx of [2, 3]) {
        const a = c.args[idx];
        const v = a && literalValue(a.text);
        if (v === undefined) continue;
        const what = idx === 2 ? 'w' : 'h';
        if (v < 1 || v > 255) add('CB009', a.line, a.col, a.col + a.text.length, `${c.name}: ${what} = ${v}, but a sprite is 1 to 255 bytes ${idx === 2 ? 'wide' : 'high'} (w and h are UBYTE; 0 draws nothing).`);
        else if (c.lower === 'sprlistdraw' && idx === 2 && v > 8) add('CB009', a.line, a.col, a.col + a.text.length, `SprListDraw: w = ${v}, but a sprite-list sprite is at most 8 bytes wide. Use PutSprite for wider ones.`);
      }
    }
  }

  // CB011: #if defined(...)
  m.code.forEach((l, line) => {
    const pm = /^\s*#\s*(?:el)?if\b(.*)$/i.exec(l);
    if (!pm) return;
    const d = /\bdefined\s*\(/i.exec(pm[1]);
    if (!d) return;
    const col = l.indexOf(pm[1]) + d.index;
    add('CB011', line, col, col + 7, 'zxbpp has no defined() operator: "#if defined(X)" is always false on its own and always true inside || or &&. Use #ifdef / #ifndef (nest them for AND / OR).');
  });

  return out.sort((a, b) => a.line - b.line || a.col - b.col);
}

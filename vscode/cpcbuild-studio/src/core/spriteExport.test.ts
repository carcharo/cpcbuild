/**
 * Byte-compares the editor's export with tools/img2cpc.py run on the PNG rendering of the same document
 * (spec 4.2 acceptance: codec equivalence over a seeded corpus; Plus bas / packed / asm / bin; edge cases).
 * Shells out to python3 (with Pillow) at test time, like img2cpc.test.ts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodePng } from './image';
import { normPath } from './img2cpc';
import { MAXPENS, PPB, type Mode } from './pixels';
import { py, rng, scratchDir } from './testutil';
import { blankGrid, newSprite, parseSprite, resolvePalette, serialiseSprite, type Grid, type SpriteState } from './spriteDoc';
import { assetSnippets, equivalentArgs, equivalentCommand, exportAsset, ExportError, gridFromImage, mergeNote, quantiseImage, renderSheet } from './spriteExport';

const dir = scratchDir('c3b-export-');

/** n distinct firmware colours, deterministic. */
function distinctPens(r: () => number, n: number): number[] {
  const all = Array.from({ length: 27 }, (_, i) => i);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, n);
}

function randGrid(r: () => number, w: number, h: number, top: number, pTransparent: number): Grid {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => (r() < pTransparent ? -1 : Math.floor(r() * (top + 1)))));
}

/** Runs img2cpc.py on the rendering of `s` and returns its stdout (and checks the editor wrote the same). */
function compare(s: SpriteState, tag: string, extra: string[] = [], palFileText?: string): string {
  const png = path.join(dir, `${tag}.png`);
  const palette = resolvePalette(s, palFileText);
  fs.writeFileSync(png, encodePng(renderSheet(s, palette)));
  const argv = equivalentArgs(s, png, palette);
  const p = py('img2cpc.py', [...argv.slice(0, -1), ...extra, png]);
  expect(p.ok, `${tag}: ${p.stderr}`).toBe(true);
  const mine = exportAsset(s, { source: normPath(png), palette });
  expect(mine.text, tag).toBe(p.stdout);
  return p.stdout;
}

describe('export equals img2cpc.py (CPC modes)', () => {
  for (const mode of [0, 1, 2] as Mode[])
    for (const masked of [false, true])
      for (const frames of [1, 3])
        it(`mode ${mode}, ${masked ? 'masked' : 'plain'}, ${frames} frame(s)`, () => {
          const r = rng(1000 + mode * 100 + (masked ? 10 : 0) + frames);
          for (let k = 0; k < 4; k++) {
            const npens = 2 + Math.floor(r() * (MAXPENS[mode] - 1));
            const pens = distinctPens(r, Math.min(npens, MAXPENS[mode]));
            const w = PPB[mode] * (1 + Math.floor(r() * 6));
            const h = 1 + Math.floor(r() * 9);
            const s = newSprite('spr', { name: `t${mode}_${k}`, mode, masked, w, h, frames, palette: { pens } });
            s.items = s.items.map(() => randGrid(r, w, h, pens.length - 1, masked || k % 2 ? 0.25 : 0));
            if (frames === 1) s.items = [s.items[0]];
            compare(s, `spr-m${mode}-${masked}-${frames}-${k}`);
          }
        });

  it('edge cases: mode 0 width 2; a transparent pixel next to an opaque one; mode 2 with 2 pens', () => {
    const a = newSprite('spr', { name: 'one_byte', mode: 0, masked: true, w: 2, h: 3, palette: { pens: [0, 26, 6, 18] } });
    a.items = [[[1, -1], [-1, 2], [3, 3]]];
    compare(a, 'edge-w2');
    const b = newSprite('spr', { name: 'half', mode: 1, masked: true, w: 4, h: 1, palette: { pens: [0, 26, 6, 18] } });
    b.items = [[[2, -1, 3, 1]]];
    const text = compare(b, 'edge-half');
    expect(text).toContain('$'); // there is data
    const c = newSprite('spr', { name: 'mono', mode: 2, masked: false, w: 8, h: 2, palette: { pens: [0, 26] } });
    c.items = [[[0, 1, 0, 1, 1, 0, 0, 1], [1, 1, 1, 1, 0, 0, 0, 0]]];
    compare(c, 'edge-mono');
  });

  it('emitPalette off is --no-palette; a shared .cpcpal is --palette-file', () => {
    const r = rng(77);
    const s = newSprite('spr', { name: 'noemit', mode: 1, masked: false, w: 8, h: 4, palette: { pens: [0, 26, 6, 18] } });
    s.items = [randGrid(r, 8, 4, 3, 0)];
    s.emitPalette = false;
    const text = compare(s, 'noemit');
    expect(text).not.toContain('noemit_pal');
    const palFile = path.join(dir, 'shared.cpcpal');
    const palText = '# shared\n0, 26, 6, 18\n';
    fs.writeFileSync(palFile, palText);
    const f = newSprite('spr', { name: 'filed', mode: 1, masked: true, w: 8, h: 4, palette: { file: palFile } });
    f.items = [randGrid(r, 8, 4, 3, 0.2)];
    const t = compare(f, 'filed', [], palText);
    expect(t).toContain('--palette-file');
    expect(t).toContain('filed_pal');
  });

  it('tiles, with and without --dedupe', () => {
    const r = rng(5);
    for (const mode of [0, 1, 2] as Mode[])
      for (const dedupe of [false, true]) {
        const pens = distinctPens(r, MAXPENS[mode] === 16 ? 9 : MAXPENS[mode]);
        const s = newSprite('til', { name: `til${mode}`, mode, palette: { pens } });
        const a = randGrid(r, 8, 8, pens.length - 1, 0.1);
        s.items = [a, randGrid(r, 8, 8, pens.length - 1, 0), a.map((row) => row.slice()), randGrid(r, 8, 8, pens.length - 1, 0), a.map((row) => row.slice())];
        s.dedupe = dedupe;
        const text = compare(s, `til-${mode}-${dedupe}`);
        expect(text).toContain(dedupe ? 'til' + mode + '_MAP' : 'til' + mode + '_COUNT');
      }
  });

  it('a transparent pixel in a tile becomes pen 0, as the tool does', () => {
    const s = newSprite('til', { name: 'tt', mode: 1, palette: { pens: [0, 26, 6, 18] } });
    s.items = [blankGrid(8, 8, 2)];
    s.items[0][3][3] = -1;
    compare(s, 'til-transparent');
  });
});

describe('export equals img2cpc.py (Plus sprites)', () => {
  const colours = ['F00', '0F0', '00F', 'FF0', '0FF', 'F0F', '888', 'F80', '08F', '80F', '8F0', 'F08', '0F8', '123', 'ABC'];
  function plusDoc(r: () => number, n: number, frames: number, ncol: number): SpriteState {
    const s = newSprite('spr', { name: 'pl', kind: 'plus', frames, palette: { colours: colours.slice(0, ncol) } });
    s.items = s.items.map(() => randGrid(r, 16, 16, ncol, 0.3).map((row) => row.map((v) => (v === 0 ? -1 : v))));
    return s;
  }
  it('bas and packed, one and several frames, exactly 15 colours and fewer', () => {
    const r = rng(9);
    for (const packed of [false, true])
      for (const [frames, ncol] of [[1, 15], [3, 15], [2, 4]]) {
        const s = plusDoc(r, 0, frames, ncol);
        s.packed = packed;
        // make sure the top colour is used so the python palette (given explicitly) is the whole list
        s.items[0][0][0] = ncol;
        const text = compare(s, `plus-${packed}-${frames}-${ncol}`);
        expect(text).toContain('pl_PALN');
      }
  });
  it('asm format', () => {
    const r = rng(10);
    const s = plusDoc(r, 0, 2, 15);
    s.plusFormat = 'asm';
    s.output = 'pl.asm';
    const text = compare(s, 'plus-asm');
    expect(text).toContain('pl_pal:');
  });
  it('bin format: data and the .pal beside it are the tool bytes', () => {
    const r = rng(11);
    const s = plusDoc(r, 0, 2, 15);
    s.plusFormat = 'bin';
    s.packed = true;
    const png = path.join(dir, 'plus-bin.png');
    fs.writeFileSync(png, encodePng(renderSheet(s)));
    const out = path.join(dir, 'plus-bin.bin');
    const argv = equivalentArgs(s, png);
    const p = py('img2cpc.py', [...argv.slice(0, -1), '-o', out, png]);
    expect(p.ok, p.stderr).toBe(true);
    const mine = exportAsset(s, { source: png });
    expect(Buffer.from(mine.bin!).equals(fs.readFileSync(out))).toBe(true);
    expect(Buffer.from(mine.palBin!).equals(fs.readFileSync(path.join(dir, 'plus-bin.pal')))).toBe(true);
    expect(mine.palBin!.length).toBe(30);
  });
});

describe('export details', () => {
  it('the equivalent command line', () => {
    const s = newSprite('spr', { name: 'hero', mode: 1, masked: true, frames: 2 });
    expect(equivalentCommand(s, 'hero.cpcspr')).toBe('python3 tools/img2cpc.py --mode 1 --name hero --sprite --frame 16x16 --masked --palette 0,26,6,18 hero.cpcspr');
  });
  it('header styles', () => {
    const s = newSprite('spr', { name: 'hero', mode: 1, masked: false, w: 4, h: 1 });
    const a = exportAsset(s, { source: 'hero.cpcspr', header: 'img2cpc' }).text;
    const b = exportAsset(s, { source: 'hero.cpcspr', header: 'studio' }).text;
    const c = exportAsset(s, { source: 'hero.cpcspr', header: 'none' }).text;
    expect(a.startsWith("' Generated by img2cpc.py --mode 1 --name hero --sprite --palette 0,26,6,18 hero.cpcspr\n")).toBe(true);
    expect(b.startsWith("' Generated by CPCBuild Studio from hero.cpcspr\n")).toBe(true);
    expect(c.startsWith('DIM hero(')).toBe(true);
    expect(a.endsWith(c)).toBe(true);
    expect(b.endsWith(c)).toBe(true);
  });
  it("refuses with the tool's wording", () => {
    const wide = newSprite('spr', { name: 'big', mode: 0, w: 256, h: 255, masked: true, frames: 2 });
    expect(() => exportAsset(wide, { source: 'big.cpcspr' })).toThrow(/big would have 130560 bytes \(the limit is 65535\)/);
    const t = newSprite('til', { name: 'many', mode: 1 });
    t.items = Array.from({ length: 257 }, () => blankGrid(8, 8, 0));
    expect(() => exportAsset(t, { source: 'm.cpctil' })).toThrow(/257 tiles; tile numbers go up to 255/);
    const w = newSprite('spr', { name: 'w', mode: 1, w: 6, h: 2 });
    expect(() => exportAsset(w, { source: 'w' })).toThrow(/frame width 6 is not a multiple of 4 \(mode 1\)/);
    const e = newSprite('spr', { name: 'e', mode: 1 });
    e.palette = { pens: [] };
    expect(() => exportAsset(e, { source: 'e' })).toThrow(ExportError);
    const big = newSprite('spr', { name: 'p', mode: 0, palette: { pens: Array.from({ length: 17 }, (_, i) => i) } });
    expect(() => exportAsset(big, { source: 'p' })).toThrow(/palette has 17 pens, mode 0 has 16/);
  });
  it('duplicate pens of one colour stay distinct in the editor but merge through a PNG (documented)', () => {
    const s = newSprite('spr', { name: 'dup', mode: 1, masked: false, w: 4, h: 1, palette: { pens: [0, 26, 26, 6] } });
    s.items = [[[0, 1, 2, 3]]];
    const direct = exportAsset(s, { source: 'x.png' }).text;
    const png = path.join(dir, 'dup.png');
    fs.writeFileSync(png, encodePng(renderSheet(s)));
    const p = py('img2cpc.py', ['--mode', '1', '--name', 'dup', '--sprite', '--palette', '0,26,26,6', png]);
    expect(p.ok).toBe(true);
    expect(p.stdout.replace(/^.*\n.*\n/, '')).not.toBe(direct.replace(/^.*\n.*\n/, ''));
  });
  it('quantises an image with the document palette', () => {
    const s = newSprite('spr', { name: 'q', mode: 1, masked: true, w: 4, h: 2 });
    s.items = [[[0, 1, 2, 3], [3, 2, 1, -1]]];
    const back = gridFromImage(s, renderSheet(s));
    expect(back).toEqual(s.items[0]);
  });
  it('counts the colours that merged onto one pen', () => {
    const s = newSprite('spr', { name: 'm', mode: 1, masked: false, w: 3, h: 1, palette: { pens: [0, 26, 6, 18] } });
    const img = { width: 3, height: 1, data: Uint8Array.from([0, 0, 120, 255, 0, 0, 130, 255, 255, 255, 255, 255]) } as never;
    const q = quantiseImage(s, img);
    expect(q.colours).toBe(3);
    expect(q.pens).toBeLessThan(3);
    expect(mergeNote(q)).toBe(`3 colours in the image became ${q.pens} pen${q.pens === 1 ? '' : 's'} (nearest match); add pens or use the image's palette.`);
    expect(mergeNote({ colours: 2, pens: 2 })).toBeUndefined();
    // transparent pixels are not colours
    const t = { width: 2, height: 1, data: Uint8Array.from([5, 5, 5, 0, 255, 255, 255, 255]) } as never;
    expect(quantiseImage(s, t)).toMatchObject({ colours: 1, pens: 1, rows: [[-1, 1]] });
  });
  it('snippets', () => {
    const m = newSprite('spr', { name: 'hero', mode: 1, masked: true });
    expect(assetSnippets(m, 'hero.bas').map((x) => x.text)).toEqual(['#include "hero.bas"\n', 'SetPalette(@hero_pal(0), hero_PENS)\nPutSpriteMasked(x, y, hero_W, hero_H, @hero(frame * hero_SIZE))\n']);
    const t = newSprite('til', { name: 'bg', mode: 0 });
    expect(assetSnippets(t, 'bg.bas')[1].text).toContain('SetTileSet(@bg(0))');
    const p = newSprite('spr', { name: 'ball', kind: 'plus' });
    expect(assetSnippets(p, 'ball.bas')[1].text).toBe('SpriteSetImage(0, @ball(0))\n');
  });
  it('a loaded document that is not edited serialises to the same text', () => {
    const s = newSprite('spr', { name: 'keep', mode: 1 });
    const text = JSON.stringify(JSON.parse(serialiseSprite(s)), null, 4); // different layout from the canonical one
    const loaded = parseSprite(text, 'spr');
    expect(serialiseSprite(loaded)).toBe(text);
  });
});

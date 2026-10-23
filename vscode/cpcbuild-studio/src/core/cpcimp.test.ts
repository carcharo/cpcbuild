/**
 * The recipe model: JSON round trip, recipe <-> argv, grid extraction, and the equality guarantee
 * of spec 4.4: for every img2cpc.py command line the repo's build scripts use (read back from the
 * committed generated files' headers), the recipe's argv is that command line, and the built-in
 * engine writes the committed file byte for byte. Python (with Pillow) is the second oracle.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyRecipeOp, argvFor, argvToRecipe, commandLine, composeSheet, defaultGrid, effectiveOutput, effectiveRecipe, gridLayout, importRecipe, newRecipe, outputsOf, overriddenFields, parseRecipe,
  previewOf, readSidecarFor, recipeToArgv, restyleHeader, RecipeError, runRecipe, serialiseRecipe, shellSplit, sidecarOf, toolMessage,
  type Recipe,
} from './cpcimp';
import { decodeImage } from './imageio';
import { encodePng, newImage, setPixel } from './image';
import type { CliIo } from './img2cpc';
import { committed } from './testcorpus';
import { py, REPO, scratchDir } from './testutil';

const ioAt = (root: string): CliIo => ({
  readFile: (p) => new Uint8Array(fs.readFileSync(path.resolve(root, p))),
  readText: (p) => fs.readFileSync(path.resolve(root, p), 'utf8'),
});
const io = ioAt(REPO);

const CASES = committed();

describe('recipe JSON', () => {
  const example = `{ "format": "cpcimp", "version": 1,
  "source": "art/hero.png", "output": "assets/hero.bas",
  "target": "cpc", "mode": 1, "name": "hero", "kind": "sprite",
  "frame": "16x16", "masked": true, "transparent": "FF00FF",
  "palette": {"list": [0, 26, 6, 18]}, "emitPalette": true }`;

  it('parses the spec example and round-trips it', () => {
    const r = parseRecipe(example);
    expect(r.palette).toEqual({ list: [0, 26, 6, 18] });
    expect(parseRecipe(serialiseRecipe(r))).toEqual(r);
    expect(serialiseRecipe(parseRecipe(serialiseRecipe(r)))).toBe(serialiseRecipe(r));
  });
  it('keeps fields it does not know', () => {
    const r = parseRecipe('{"format":"cpcimp","version":1,"source":"a.png","target":"cpc","mode":0,"futureThing":{"x":1}}');
    expect(serialiseRecipe(r)).toContain('"futureThing"');
  });
  it('an empty file is a new empty recipe', () => {
    expect(parseRecipe('').source).toBe('');
  });
  it('rejects wrong shapes with a message that names the field', () => {
    expect(() => parseRecipe('{')).toThrow(/not valid JSON/);
    expect(() => parseRecipe('[]')).toThrow(/one JSON object/);
    expect(() => parseRecipe('{"format":"x","version":1}')).toThrow(/"format"/);
    expect(() => parseRecipe('{"format":"cpcimp","version":2}')).toThrow(/version 2/);
    expect(() => parseRecipe('{"format":"cpcimp","version":1,"mode":3}')).toThrow(/"mode" must be 0, 1 or 2/);
    expect(() => parseRecipe('{"format":"cpcimp","version":1,"grid":{"cellW":1}}')).toThrow(/"grid"/);
    expect(() => parseRecipe('{"format":"cpcimp","version":1,"palette":{"list":[{}]}}')).toThrow(/"palette"/);
  });
});

describe('recipe <-> argv', () => {
  it('maps the spec example to one fixed-order command line', () => {
    const r = parseRecipe('{"format":"cpcimp","version":1,"source":"art/hero.png","output":"assets/hero.bas","target":"cpc","mode":1,"name":"hero","kind":"sprite","frame":"16x16","masked":true,"transparent":"FF00FF","palette":{"list":[0,26,6,18]},"emitPalette":true}');
    expect(recipeToArgv(r).join(' ')).toBe('--mode 1 --name hero --sprite --frame 16x16 --masked --transparent FF00FF --palette 0,26,6,18 art/hero.png -o assets/hero.bas');
    expect(commandLine(r).command).toBe('python3 tools/img2cpc.py --mode 1 --name hero --sprite --frame 16x16 --masked --transparent FF00FF --palette 0,26,6,18 art/hero.png -o assets/hero.bas');
  });
  it('tile width: --tile-width after --tiles, only when not 8, and it round-trips through a command line', () => {
    const r = newRecipe('t.png', { mode: 0, kind: 'tiles', tileWidth: 4, dedupe: true, name: 't', output: 't.bas' });
    expect(recipeToArgv(r).join(' ')).toBe('--mode 0 --name t --tiles --tile-width 4 --dedupe t.png -o t.bas');
    expect(recipeToArgv({ ...r, tileWidth: 8 })).not.toContain('--tile-width');
    expect(recipeToArgv({ ...r, kind: 'sprite' })).not.toContain('--tile-width');
    const back = argvToRecipe(shellSplit(commandLine(r).command!)).recipe;
    expect(back).toMatchObject({ kind: 'tiles', tileWidth: 4, dedupe: true });
    expect(() => parseRecipe('{"format":"cpcimp","version":1,"tileWidth":"4"}')).toThrow(/"tileWidth"/);
    expect(() => argvToRecipe(shellSplit('img2cpc.py --mode 0 --tile-width 4 x.png'))).toThrow('--tile-width needs --tiles');
  });
  it('quotes like the tool does in its header', () => {
    const r = newRecipe('my art/it\'s.png', { name: 'a', output: 'o.bas' });
    expect(commandLine(r).command).toContain(`'my art/it'"'"'s.png'`);
  });
  it('defaults the name and the output from the source', () => {
    const r = newRecipe('assets/9lives hero.png');
    expect(recipeToArgv(r)).toEqual(['--mode', '1', '--name', 'img_9lives_hero', '--sprite', 'assets/9lives hero.png', '-o', 'assets/9lives hero.bas']);
    expect(effectiveOutput(newRecipe('a/b.png', { target: 'plus-sprite', plus: { format: 'asm' } }))).toBe('a/b.asm');
  });
  it('the Plus bin recipe also writes the .pal and the Python-style outputs list', () => {
    const r = newRecipe('p.png', { target: 'plus-sprite', plus: { format: 'bin' }, output: 'x/p.bin' });
    expect(outputsOf(r)).toEqual(['x/p.bin', 'x/p.pal']);
    expect(outputsOf(newRecipe('a.png', { writePalette: 'pal/a.pal', output: 'a.bas' }))).toEqual(['a.bas', 'pal/a.pal']);
  });
  it('a grid blocks the copy command and sets the frame to the cell', () => {
    const r = newRecipe('sheet.png', { grid: { ...defaultGrid(64, 64), cellW: 16, cellH: 8 } });
    expect(commandLine(r).command).toBeUndefined();
    expect(commandLine(r).reason).toMatch(/grid extraction/);
    expect(recipeToArgv(r)).toContain('16x8');
  });
  it('shellSplit handles quotes', () => {
    expect(shellSplit(`a 'b c' "d\\"e" f\\ g ''`)).toEqual(['a', 'b c', 'd"e', 'f g', '']);
    expect(() => shellSplit('a "b')).toThrow(RecipeError);
  });
  it('imports a build_assets.sh line, listing shell variables and unknown flags', () => {
    const { recipe, unrecognised } = argvToRecipe(shellSplit('$I --mode 0 --name balls --sprite --frame 8x16 --masked --palette-file $A/bounce.pal --no-palette $A/balls.png -o $A/balls.bas'));
    expect(recipe).toMatchObject({ target: 'cpc', mode: 0, name: 'balls', kind: 'sprite', frame: '8x16', masked: true, emitPalette: false });
    expect(unrecognised).toEqual(['$A/bounce.pal', '$A/balls.png', '$A/balls.bas']);
  });
  it('an invalid command line reports the tool\'s own message', () => {
    expect(() => argvToRecipe(shellSplit('python3 tools/img2cpc.py --mode 3 x.png'))).toThrow("argument --mode: invalid choice: '3' (choose from 0, 1, 2)");
    expect(() => argvToRecipe(shellSplit('python3 tools/img2cpc.py x.png'))).toThrow(/--mode is required/);
    expect(argvToRecipe(shellSplit('img2cpc.py --mode 1 --bogus x.png')).unrecognised).toEqual(['--bogus']);
  });
});

describe('the repo corpus: committed generated files', () => {
  it('finds the build scripts\' invocations', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(17);
    // the three --plus-* ones are in it
    expect(CASES.filter(([, a]) => a.some((w) => w.startsWith('--plus-'))).length).toBeGreaterThanOrEqual(3);
  });
  for (const [file, argv] of CASES) {
    it(`${file}: argv -> recipe -> the same argv -> the committed bytes`, () => {
      const { recipe, unrecognised } = argvToRecipe(argv);
      expect(unrecognised).toEqual([]);
      expect(recipeToArgv(recipe)).toEqual(argv);
      // through JSON as the file would be
      const back = parseRecipe(serialiseRecipe(recipe));
      expect(recipeToArgv(back)).toEqual(argv);
      const out = runRecipe(back, io);
      const f = out.files.find((x) => x.path === file);
      expect(f?.data).toBe(fs.readFileSync(path.join(REPO, file), 'utf8'));
    });
    it(`${file}: Python prints the same text`, () => {
      const { recipe } = argvToRecipe(argv);
      const a = recipeToArgv(recipe);
      const noO = a.slice(0, a.length - 2);
      const p = py('img2cpc.py', noO);
      expect(p.ok, p.stderr).toBe(true);
      // the first header line records the command line (here with -o); the rest must match
      expect(runRecipe(recipe, io).result.text.split('\n').slice(1)).toEqual(p.stdout.split('\n').slice(1));
    });
  }
  it('--write-palette: a_spr0 writes the committed pens16.pal', () => {
    const argv = ['--mode', '0', '--name', 'a_spr0', '--write-palette', 'tests/conformance/assets/pens16.pal', 'tests/conformance/assets/spr0.png', '-o', 'tests/conformance/assets/spr0.bas'];
    const { recipe } = argvToRecipe(argv);
    const out = runRecipe(recipe, io);
    expect(out.files.map((f) => f.path)).toEqual(['tests/conformance/assets/pens16.pal', 'tests/conformance/assets/spr0.bas']);
    expect(out.files[0].data).toBe(fs.readFileSync(path.join(REPO, 'tests/conformance/assets/pens16.pal'), 'utf8'));
    expect(out.files[1].data).toBe(fs.readFileSync(path.join(REPO, 'tests/conformance/assets/spr0.bas'), 'utf8'));
  });
  it('a recipe using palette.file re-run gives identical bytes', () => {
    const r = newRecipe('tests/conformance/assets/msk0.png', { mode: 0, name: 'a_msk0', masked: true, palette: { file: 'tests/conformance/assets/pens16.pal' }, output: 'x.bas' });
    expect(runRecipe(r, io).files[0].data).toBe(runRecipe(r, io).files[0].data);
    expect(runRecipe(r, io).result.text.split('\n').slice(1)).toEqual(py('img2cpc.py', recipeToArgv(r).slice(0, -2)).stdout.split('\n').slice(1));
  });
});

describe('header modes', () => {
  const r = newRecipe('tests/conformance/assets/spr1.png', { mode: 1, name: 'a_spr1', palette: { list: [0, 26, 6, 18] }, output: 'o.bas' });
  const text = runRecipe(r, io).result.text;
  it('img2cpc keeps it, none drops all five lines, studio names the recipe', () => {
    expect(restyleHeader(text, 'img2cpc', undefined)).toBe(text);
    expect(restyleHeader(text, 'none', undefined)).toBe(text.split('\n').slice(5).join('\n'));
    const s = restyleHeader(text, 'studio', 'assets/spr1.cpcimp');
    expect(s.split('\n')[0]).toBe("' Generated by CPCBuild Studio from assets/spr1.cpcimp");
    expect(s.split('\n')[1]).toBe(text.split('\n')[1]);
    expect(s).toContain('Regenerate Assets');
    expect(s.split('\n').slice(5)).toEqual(text.split('\n').slice(5));
  });
});

describe('errors are the tool\'s text', () => {
  const dir = scratchDir('cpcimp-err-');
  // images made by Pillow: 5 colours, 18 wide, 3 wide... (encodePng is not used for tiny images)
  const make = (name: string, w: number, h: number, colours: number): string => {
    const f = path.join(dir, name);
    const code = `from PIL import Image\nim=Image.new('RGB',(${w},${h}))\nim.putdata([((i*53)%${colours}*40+10,(i*29)%${colours}*30,(i*7)%${colours}*20) for i in range(${w * h})])\nim.save(${JSON.stringify(f)})`;
    expect(spawnSync('python3', ['-c', code]).status).toBe(0);
    return f;
  };
  const dio = ioAt(dir);
  const cases: [string, Partial<Recipe>, string, number, number, number][] = [
    ['too many colours', { mode: 1 }, 'a.png', 8, 8, 9],
    ['width not a multiple', { mode: 1 }, 'b.png', 7, 4, 2],
    ['frames do not divide', { mode: 1, frame: '4x3' }, 'c.png', 8, 8, 2],
    ['bad pen0 interplay is fine, bad palette is not', { mode: 1, palette: { list: [0, 1, 2, 3, 4, 5] } }, 'd.png', 8, 8, 2],
    ['tiles masked', { mode: 1, kind: 'tiles', masked: true }, 'e.png', 8, 8, 2],
    ['tile size', { mode: 1, kind: 'tiles' }, 'f.png', 12, 8, 2],
    ['tile width not allowed', { mode: 1, kind: 'tiles', tileWidth: 2 }, 'g.png', 8, 8, 2],
    ['tile size with a narrow tile', { mode: 0, kind: 'tiles', tileWidth: 4 }, 'h.png', 6, 8, 2],
  ];
  for (const [what, over, file, w, h, n] of cases) {
    it(what, () => {
      make(file, w, h, n);
      const r = newRecipe(file, { name: 'x', output: 'x.bas', ...over });
      const p = spawnSync('python3', [path.join(REPO, 'tools/img2cpc.py'), ...recipeToArgv(r)], { cwd: dir, encoding: 'utf8' });
      expect(p.status).not.toBe(0);
      let msg = '';
      try {
        runRecipe(r, dio);
      } catch (e) {
        msg = toolMessage(e);
      }
      expect(msg).toBe(p.stderr.trim());
    });
  }
});

describe('grid extraction', () => {
  // a 6x4-pixel image of 2x2 cells: cell n has a distinct colour
  const sheet = (): { width: number; height: number; data: Uint8Array } => {
    const w = 6 + 1 + 1, h = 4 + 1; // margin 1 left/top, spacing 1 between
    void h;
    return { width: 8, height: 5, data: new Uint8Array(8 * 5 * 4) };
  };
  it('lays cells out by margin, spacing and cell size', () => {
    const g = { cellW: 2, cellH: 2, marginX: 1, marginY: 1, spacingX: 1, spacingY: 0, exclude: [1] };
    const lay = gridLayout(g, 8, 5);
    expect(lay).toMatchObject({ cols: 2, rows: 2, selected: [0, 2, 3], sheetCols: 2, sheetRows: 2, leftoverX: 2 });
    expect(gridLayout({ ...g, columns: 1 }, 8, 5)).toMatchObject({ sheetCols: 1, sheetRows: 3 });
    expect(gridLayout({ ...g, cellW: 20 }, 8, 5)).toMatchObject({ cols: 0 });
  });
  it('composes the selected cells row-major, empty tail transparent', () => {
    const img = sheet();
    // paint cell (col,row) with value 10*(row*2+col+1) in R, alpha 255
    for (let cell = 0; cell < 4; cell++) {
      const sx = 1 + (cell % 2) * 3, sy = 1 + Math.floor(cell / 2) * 2;
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
        const i = ((sy + y) * 8 + sx + x) * 4;
        img.data[i] = 10 * (cell + 1);
        img.data[i + 3] = 255;
      }
    }
    const g = { cellW: 2, cellH: 2, marginX: 1, marginY: 1, spacingX: 1, spacingY: 0, exclude: [1] };
    const out = composeSheet(img, g);
    expect([out.width, out.height]).toEqual([4, 4]);
    const px = (x: number, y: number): number => out.data[(y * out.width + x) * 4];
    expect([px(0, 0), px(2, 0), px(0, 2), px(2, 2)]).toEqual([10, 30, 40, 0]);
    expect(out.data[(2 * 4 + 2) * 4 + 3]).toBe(0);
    expect(() => composeSheet(img, { ...g, exclude: [0, 1, 2, 3] })).toThrow(/no grid cell is selected/);
    expect(() => composeSheet(img, { ...g, cellW: 50 })).toThrow(/has no cell/);
  });
  it('default grid: the frame size, else the biggest power of two dividing both sides', () => {
    expect(defaultGrid(96, 8, '8x8')).toMatchObject({ cellW: 8, cellH: 8 });
    expect(defaultGrid(96, 16)).toMatchObject({ cellW: 16, cellH: 16 });
    expect(defaultGrid(100, 30)).toMatchObject({ cellW: 2, cellH: 2 });
    expect(defaultGrid(7, 7)).toMatchObject({ cellW: 1 });
  });
  it('the converter runs on the composed sheet: same bytes as converting a hand-built sheet with the tool', () => {
    // sprites.png (96x8) -> 12 cells of 8x8; drop cells 1 and 5, lay out 5 wide
    const src = 'games/shooter/assets/sprites.png';
    const r = newRecipe(src, { mode: 0, name: 'g', palette: { file: 'games/shooter/assets/starfall.pal' }, output: 'g.bas', grid: { cellW: 8, cellH: 8, marginX: 0, marginY: 0, spacingX: 0, spacingY: 0, columns: 5, exclude: [1, 5] } });
    const out = runRecipe(r, io);
    const img = decodeImage(new Uint8Array(fs.readFileSync(path.join(REPO, src))));
    const sheet2 = composeSheet(img, r.grid!);
    const dir = scratchDir('cpcimp-grid-');
    const png = path.join(dir, 'sheet.png');
    const f = path.join(dir, 'raw.rgba');
    fs.writeFileSync(f, sheet2.data);
    const code = `from PIL import Image\nImage.frombytes('RGBA',(${sheet2.width},${sheet2.height}),open(${JSON.stringify(f)},'rb').read()).save(${JSON.stringify(png)})`;
    expect(spawnSync('python3', ['-c', code]).status).toBe(0);
    const p = py('img2cpc.py', ['--mode', '0', '--name', 'g', '--sprite', '--frame', '8x8', '--palette-file', 'games/shooter/assets/starfall.pal', png]);
    expect(p.ok, p.stderr).toBe(true);
    const body = (t: string): string => t.split('\n').slice(5).join('\n');
    expect(body(out.result.text)).toBe(body(p.stdout));
    expect(out.result.text.split('\n')[1]).toBe(`' Source: ${src}, 40x16 pixels, mode 0`);
  });
});

describe('preview', () => {
  it('pen indices follow the converter and the table counts pixels', () => {
    const r = newRecipe('tests/conformance/assets/spr1.png', { mode: 1, name: 'a', palette: { list: [0, 26, 6, 18] }, output: 'o.bas' });
    const p = previewOf(r, io);
    expect(p.rows.map((x) => x.label)).toEqual(['0', '26', '6', '18']);
    expect(p.indices.length).toBe(p.width * p.height);
    expect(p.rows.reduce((s, x) => s + x.pixels, 0) + p.transparent).toBe(p.width * p.height);
    expect(p.summary).toMatch(/frame\(s\)/);
  });
  it('Plus sprites preview with 12-bit colours', () => {
    const r = newRecipe('tests/conformance/assets/plus_ball.png', { target: 'plus-sprite', name: 'b', output: 'o.bas' });
    const p = previewOf(r, io);
    expect(p.rows.length).toBeGreaterThan(0);
    expect(p.rows[0].label).toMatch(/^[0-9A-F]{3}$/);
  });
  it('an error carries the converter text', () => {
    const r = newRecipe('tests/conformance/assets/spr0.png', { mode: 2, name: 'b', output: 'o.bas' });
    expect(() => previewOf(r, io)).toThrow(/mode 2 has only 2 pens/);
  });
});

describe('edits', () => {
  it('set merges, null removes, unchanged is reported, bad shapes are refused', async () => {
    const { applyRecipeOp } = await import('./cpcimp');
    const r = newRecipe('a.png', { masked: true });
    const a = applyRecipeOp(r, { op: 'set', patch: { mode: 0, masked: null, name: 'x' } });
    expect('state' in a && a.state).toMatchObject({ mode: 0, name: 'x' });
    expect('state' in a && 'masked' in a.state).toBe(false);
    expect(applyRecipeOp(r, { op: 'set', patch: { masked: true } })).toEqual({ error: 'unchanged' });
    expect(applyRecipeOp(r, { op: 'set', patch: { mode: 7 } })).toMatchObject({ error: expect.stringContaining('"mode"') });
    expect(applyRecipeOp(r, { op: 'set', patch: { format: 'x' } })).toEqual({ error: 'unchanged' });
  });
  it('cells toggles grid exclusion', async () => {
    const { applyRecipeOp } = await import('./cpcimp');
    const r = newRecipe('a.png', { grid: defaultGrid(16, 16) });
    const a = applyRecipeOp(r, { op: 'cells', cells: [3, 1, 3], include: false });
    expect('state' in a && a.state.grid?.exclude).toEqual([1, 3]);
    const b = applyRecipeOp((a as { state: Recipe }).state, { op: 'cells', cells: [1], include: true });
    expect('state' in b && b.state.grid?.exclude).toEqual([3]);
    expect(applyRecipeOp(newRecipe('a.png'), { op: 'cells', cells: [1], include: false })).toEqual({ error: 'grid extraction is off' });
  });
});

describe('sidecar', () => {
  const dir = scratchDir('cpcimp-side-');
  const sio: CliIo = { ...ioAt(dir), exists: (p) => fs.existsSync(path.resolve(dir, p)) };
  const img = newImage(32, 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 32; x++) setPixel(img, x, y, ...(x < 16 ? [255, 0, 0] : [0, 0, 255]) as [number, number, number], 255);
  fs.writeFileSync(path.join(dir, 'hero.png'), encodePng(img));
  const side = { format: 'cpcbuild-image', version: 1, kind: 'sprite', mode: 0, name: 'hero', frame: '16x8', masked: false, palette: [1, 24, 20, 6], tags: [{ name: 'walk', from: 0, to: 1 }] };
  fs.writeFileSync(path.join(dir, 'hero.cpcbuild.json'), JSON.stringify(side));

  it('gives the recipe fields Import Image pre-fills', () => {
    const found = readSidecarFor('hero.png', sio)!;
    expect(found.file).toBe('hero.cpcbuild.json');
    expect(found.fields).toEqual({ mode: 0, name: 'hero', kind: 'sprite', frame: '16x8', palette: { list: [1, 24, 20, 6] } });
    expect(readSidecarFor('none.png', sio)).toBeUndefined();
    expect(readSidecarFor('hero.png', io)).toBeUndefined(); // io without exists: no sidecar looked for
  });

  it('tiles: tileWidth only when it is not 8', () => {
    fs.writeFileSync(path.join(dir, 'g.cpcbuild.json'), JSON.stringify({ format: 'cpcbuild-image', version: 1, kind: 'tiles', mode: 1, tileWidth: 4 }));
    fs.copyFileSync(path.join(dir, 'hero.png'), path.join(dir, 'g.png'));
    expect(readSidecarFor('g.png', sio)!.fields).toEqual({ mode: 1, kind: 'tiles', tileWidth: 4 });
  });

  it('a bad sidecar is reported, with no fields', () => {
    fs.writeFileSync(path.join(dir, 'b.cpcbuild.json'), '{');
    fs.copyFileSync(path.join(dir, 'hero.png'), path.join(dir, 'b.png'));
    expect(readSidecarFor('b.png', sio)).toEqual({ file: 'b.cpcbuild.json', fields: {}, error: 'b.cpcbuild.json: not valid JSON' });
  });

  it('a recipe run uses the sidecar for what the recipe leaves out (tags, header) and matches the tool', () => {
    const r = newRecipe('hero.png', { mode: 0, name: 'hero', output: 'hero.bas' });
    const out = runRecipe(r, sio);
    const text = out.files[0].data as string;
    expect(text).toContain('CONST hero_WALK AS UBYTE = 0');
    expect(text.split('\n')[0]).toBe("' Generated by img2cpc.py --mode 0 --name hero --sprite hero.png -o hero.bas (settings from hero.cpcbuild.json)");
    const t = spawnSync('python3', [path.join(REPO, 'tools', 'img2cpc.py'), ...out.argv.slice(0, -2)], { cwd: dir, encoding: 'utf8' });
    expect(t.stdout.split('\n').slice(1).join('\n')).toBe(text.split('\n').slice(1).join('\n'));
    // without exists in the io, or with a grid, the sidecar is not read
    expect((runRecipe(r, ioAt(dir)).files[0].data as string)).not.toContain('settings from');
  });
});

describe('the minimal recipe the Aseprite extension writes', () => {
  // {format, version, source, output, target}: every other setting comes from the sidecar
  const minimal = '{\n  "format": "cpcimp",\n  "version": 1,\n  "source": "assets/hero.png",\n  "output": "assets/hero.bas",\n  "target": "cpc"\n}\n';
  const dir = scratchDir('cpcimp-min-');
  fs.mkdirSync(path.join(dir, 'assets'));
  const sio: CliIo = { ...ioAt(dir), exists: (p) => fs.existsSync(path.resolve(dir, p)) };
  const img = newImage(32, 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 32; x++) setPixel(img, x, y, ...(x < 16 ? [255, 0, 0] : [0, 0, 255]) as [number, number, number], 255);
  fs.writeFileSync(path.join(dir, 'assets', 'hero.png'), encodePng(img));
  const side = { format: 'cpcbuild-image', version: 1, kind: 'sprite', mode: 0, name: 'hero', frame: '16x8', masked: false, palette: [1, 24, 20, 6], tags: [{ name: 'walk', from: 0, to: 1 }] };
  fs.writeFileSync(path.join(dir, 'assets', 'hero.cpcbuild.json'), JSON.stringify(side));

  it('converts like the full command with the sidecar settings', () => {
    const r = parseRecipe(minimal);
    const out = runRecipe(r, sio);
    const text = out.files[0].data as string;
    expect(out.files[0].path).toBe('assets/hero.bas');
    expect(text).toContain('CONST hero_W AS UBYTE = 8'); // mode 0 from the sidecar (mode 1 would give 4)
    expect(text).toContain('CONST hero_FRAMES AS UBYTE = 2');
    expect(text).toContain('CONST hero_WALK AS UBYTE = 0');
    expect(text).toContain('(settings from hero.cpcbuild.json)');
    const full = runRecipe(newRecipe('assets/hero.png', { mode: 0, name: 'hero', output: 'assets/hero.bas', kind: undefined, emitPalette: undefined }), sio);
    expect((full.files[0].data as string).split('\n').slice(1)).toEqual(text.split('\n').slice(1));
  });
});

describe('Import Image with a sidecar: the sidecar stays the source of the settings', () => {
  const dir = scratchDir('cpcimp-imp-');
  const sio: CliIo = { ...ioAt(dir), exists: (p) => fs.existsSync(path.resolve(dir, p)) };
  const img = newImage(32, 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 32; x++) setPixel(img, x, y, ...(x < 16 ? [255, 0, 0] : [0, 0, 255]) as [number, number, number], 255);
  fs.writeFileSync(path.join(dir, 'hero.png'), encodePng(img));
  fs.copyFileSync(path.join(dir, 'hero.png'), path.join(dir, 'plain.png'));
  fs.copyFileSync(path.join(dir, 'hero.png'), path.join(dir, 'bad.png'));
  const side = { format: 'cpcbuild-image', version: 1, kind: 'sprite', mode: 0, name: 'hero', frame: '16x8', masked: true, palette: [1, 24, 20, 6], tags: [] };
  fs.writeFileSync(path.join(dir, 'hero.cpcbuild.json'), JSON.stringify(side));
  fs.writeFileSync(path.join(dir, 'bad.cpcbuild.json'), '{"format":"cpcbuild-image","version":1,"mode":3}');

  it('a picked image with a sidecar gives a recipe of the source and output only', () => {
    const r = importRecipe('hero.png', 'hero.bas', sio);
    expect(JSON.parse(serialiseRecipe(r))).toEqual({ format: 'cpcimp', version: 1, source: 'hero.png', output: 'hero.bas', target: 'cpc', emitPalette: true });
    for (const k of ['mode', 'name', 'kind', 'frame', 'masked', 'palette', 'tileWidth']) expect(r[k]).toBeUndefined();
  });

  it('without a sidecar the recipe keeps its defaults, as before', () => {
    const r = importRecipe('plain.png', 'plain.bas', sio);
    expect(r).toMatchObject({ mode: 1, kind: 'sprite' });
    expect(commandLine(r).command).toBe('python3 tools/img2cpc.py --mode 1 --name plain --sprite plain.png -o plain.bas');
  });

  it('the Command line has no copied options and the run uses the sidecar', () => {
    const r = importRecipe('hero.png', 'hero.bas', sio);
    const found = sidecarOf(r, sio)!;
    expect(commandLine(r, found.side).command).toBe('python3 tools/img2cpc.py hero.png -o hero.bas');
    const text = runRecipe(r, sio).files[0].data as string;
    expect(text).toContain('CONST hero_FRAMES AS UBYTE = 2');
    expect(text.split('\n')[0]).toBe("' Generated by img2cpc.py hero.png -o hero.bas (settings from hero.cpcbuild.json)");
    // the tool, given the same words, reads the same sidecar
    const t = spawnSync('python3', [path.join(REPO, 'tools', 'img2cpc.py'), ...argvFor(r, sio).slice(0, -2)], { cwd: dir, encoding: 'utf8' });
    expect(t.stdout.split('\n').slice(1).join('\n')).toBe(text.split('\n').slice(1).join('\n'));
  });

  it('the effective view shows the sidecar values, with nothing overridden', () => {
    const r = importRecipe('hero.png', 'hero.bas', sio);
    const { fields } = sidecarOf(r, sio)!;
    expect(effectiveRecipe(r, fields)).toMatchObject({ mode: 0, name: 'hero', kind: 'sprite', frame: '16x8', masked: true, palette: { list: [1, 24, 20, 6] } });
    expect(overriddenFields(r, fields)).toEqual([]);
  });

  it('one override is stored in the recipe, wins over the sidecar, and is cleared back to it', () => {
    const r0 = importRecipe('hero.png', 'hero.bas', sio);
    const set = applyRecipeOp(r0, { op: 'set', patch: { mode: 1 } });
    const r1 = (set as { state: Recipe }).state;
    expect(r1.mode).toBe(1);
    const { fields, side: sc } = sidecarOf(r1, sio)!;
    expect(overriddenFields(r1, fields)).toEqual(['mode']);
    expect(effectiveRecipe(r1, fields)).toMatchObject({ mode: 1, name: 'hero', frame: '16x8' });
    expect(commandLine(r1, sc).command).toBe('python3 tools/img2cpc.py --mode 1 hero.png -o hero.bas');
    const clear = applyRecipeOp(r1, { op: 'set', patch: Object.fromEntries(overriddenFields(r1, fields).map((k) => [k, null])) });
    const r2 = (clear as { state: Recipe }).state;
    expect(r2.mode).toBeUndefined();
    expect(commandLine(r2, sc).command).toBe('python3 tools/img2cpc.py hero.png -o hero.bas');
    expect(serialiseRecipe(r2)).toBe(serialiseRecipe(r0));
  });

  it('a recipe that already holds copied values keeps working: they are overrides', () => {
    const r = newRecipe('hero.png', { mode: 0, name: 'hero', kind: 'sprite', frame: '16x8', masked: true, palette: { list: [1, 24, 20, 6] }, output: 'hero.bas' });
    const { fields, side: sc } = sidecarOf(r, sio)!;
    expect(overriddenFields(r, fields)).toEqual(['mode', 'name', 'kind', 'frame', 'masked', 'palette']);
    expect(commandLine(r, sc).command).toBe('python3 tools/img2cpc.py --mode 0 --name hero --sprite --frame 16x8 --masked --palette 1,24,20,6 hero.png -o hero.bas');
  });

  it('a grid recipe or a non-CPC target does not use the sidecar', () => {
    expect(sidecarOf(newRecipe('hero.png', { grid: defaultGrid(32, 8) }), sio)).toBeUndefined();
    expect(sidecarOf(newRecipe('hero.png', { target: 'spectrum' }), sio)).toBeUndefined();
  });

  it('an invalid sidecar shows its error, and the run reports it too', () => {
    const r = importRecipe('bad.png', 'bad.bas', sio);
    const found = sidecarOf(r, sio)!;
    expect(found.error).toBe('bad.cpcbuild.json: "mode" must be 0, 1 or 2');
    expect(found.fields).toEqual({});
    expect(() => runRecipe(r, sio)).toThrow(/bad\.cpcbuild\.json: "mode" must be 0, 1 or 2/);
  });
});

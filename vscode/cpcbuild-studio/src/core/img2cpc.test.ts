/**
 * Byte-compares the TS port with tools/img2cpc.py: every invocation the repo
 * makes (tools/build_assets.sh, games/shooter/build_assets.sh,
 * examples/plusdemo/build.sh, tests/conformance/assets/make_plus_sources.py),
 * the committed generated .bas files, and synthetic images covering every
 * mode and option. Shells out to python3 (with Pillow) at test time.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodePng, newImage, setPixel } from './image';
import { Img2cpcError, runCli, type CliIo } from './img2cpc';
import { py, REPO, rng, scratchDir } from './testutil';

const io: CliIo = {
  readFile: (p) => new Uint8Array(fs.readFileSync(path.resolve(REPO, p))),
  readText: (p) => fs.readFileSync(path.resolve(REPO, p), 'utf8'),
  exists: (p) => fs.existsSync(path.resolve(REPO, p)),
};

/** Runs both on the same argv (cwd = repo root) and compares stdout; returns the text. */
function same(argv: string[]): string {
  const p = py('img2cpc.py', argv);
  expect(p.ok, p.stderr).toBe(true);
  const t = runCli(argv, io);
  expect(t.stdout).toBe(p.stdout);
  return p.stdout;
}

/** Both fail with the same message: img2cpc.py prints `img2cpc: <msg>` (or argparse's `error: <msg>`), the port throws <msg>. */
function sameError(argv: string[]): string {
  const p = py('img2cpc.py', argv);
  expect(p.ok).toBe(false);
  let msg = '';
  try {
    runCli(argv, io);
  } catch (e) {
    expect(e).toBeInstanceOf(Img2cpcError);
    msg = (e as Error).message;
  }
  expect(msg).not.toBe('');
  const last = p.stderr.trim().split('\n').pop()!;
  expect([`img2cpc: ${msg}`, `img2cpc.py: error: ${msg}`]).toContain(last);
  return msg;
}

const A = 'examples/assets';
const C = 'tests/conformance/assets';
const G = 'games/shooter/assets';
const D = 'examples/plusdemo';

// [argv without -o, committed output (if any)]
const repoCases: [string[], string | undefined][] = [
  [['--mode', '0', '--name', 'bgtiles', '--tiles', '--palette-file', `${A}/bounce.pal`, `${A}/bgtiles.png`], `${A}/bgtiles.bas`],
  [['--mode', '0', '--name', 'balls', '--sprite', '--frame', '8x16', '--masked', '--palette-file', `${A}/bounce.pal`, '--no-palette', `${A}/balls.png`], `${A}/balls.bas`],
  [['--mode', '1', '--name', 'a_spr1', '--palette', '0,26,6,18', `${C}/spr1.png`], `${C}/spr1.bas`],
  [['--mode', '1', '--name', 'a_msk1', '--masked', '--palette', '0,26,6,18', `${C}/msk1.png`], `${C}/msk1.bas`],
  [['--mode', '1', '--name', 'a_pic', '--tiles', '--dedupe', `${C}/pic1.png`], `${C}/pic1.bas`],
  [['--mode', '0', '--name', 'a_spr0', `${C}/spr0.png`], undefined], // + --write-palette, see below
  [['--mode', '0', '--name', 'a_msk0', '--masked', '--palette-file', `${C}/pens16.pal`, `${C}/msk0.png`], `${C}/msk0.bas`],
  [['--plus-sprite', '--name', 'plusball', `${C}/plus_ball.png`], `${C}/plus_ball.bas`],
  [['--plus-sprite', '--packed', '--name', 'plusballpk', `${C}/plus_ball.png`], `${C}/plus_ballpk.bas`],
  [['--plus-palette', '--name', 'plusbars', `${C}/plus_bars.png`], `${C}/plus_bars.bas`],
  [['--mode', '0', '--name', 'sprites', '--sprite', '--frame', '8x8', '--palette-file', `${G}/starfall.pal`, `${G}/sprites.png`], `${G}/sprites.bas`],
  [['--mode', '0', '--name', 'shots', '--sprite', '--frame', '2x4', '--palette-file', `${G}/starfall.pal`, '--no-palette', `${G}/shots.png`], `${G}/shots.bas`],
  [['--mode', '0', '--name', 'tiles', '--tiles', '--palette-file', `${G}/starfall.pal`, `${G}/tiles.png`], `${G}/tiles.bas`],
  [['--plus-sprite', '--packed', '--name', 'plsprites', `${G}/plus_sprites.png`], `${G}/plsprites.bas`],
  [['--spectrum', '--zx-sprite', '--name', 'zx_sprites', `${G}/zx/zx_sprites.png`], `${G}/zx/zx_sprites.bas`],
  [['--spectrum', '--zx-sprite', '--name', 'zx_shots', `${G}/zx/zx_shots.png`], `${G}/zx/zx_shots.bas`],
  [['--spectrum', '--zx-sprite', '--name', 'zx_icon', `${G}/zx/zx_icon.png`], `${G}/zx/zx_icon.bas`],
  [['--plus-sprite', '--packed', '--name', 'dsprite', `${D}/sprites.png`], `${D}/sprites.bas`],
  [['--mode', '1', '--sprite', '--name', 'landscape', '--palette', '0,26,4,10', '--no-palette', `${D}/landscape.png`], `${D}/landscape.bas`],
  // not in any script, but the same art through the other paths
  [['--spectrum', '--name', 'zxpic', `${G}/zx/zx_sprites.png`], undefined],
  [['--spectrum', '--name', 'zxpic', `${G}/zx/zx_icon.png`], undefined],
];

describe('img2cpc.ts vs tools/img2cpc.py: the repo invocations', () => {
  for (const [argv, committed] of repoCases) {
    it(argv.join(' '), () => {
      const text = same(argv);
      if (committed) {
        // the committed file was generated with -o <committed>; same header
        const withO = runCli([...argv, '-o', committed], io);
        expect(withO.files[0].data).toBe(fs.readFileSync(path.join(REPO, committed), 'utf8'));
      }
      expect(text.length).toBeGreaterThan(0);
    });
  }

  it('--write-palette: a_spr0 and its pens16.pal', () => {
    const dir = scratchDir('img2cpc-wp-');
    const pal = path.join(dir, 'pens16.pal');
    const argv = ['--mode', '0', '--name', 'a_spr0', '--write-palette', pal, `${C}/spr0.png`];
    const p = py('img2cpc.py', argv);
    expect(p.ok, p.stderr).toBe(true);
    const t = runCli(argv, io);
    expect(t.stdout).toBe(p.stdout);
    expect(t.files).toHaveLength(1);
    expect(t.files[0].data).toBe(fs.readFileSync(pal, 'utf8'));
    expect(t.files[0].data).toBe(fs.readFileSync(path.join(REPO, C, 'pens16.pal'), 'utf8'));
  });
});

// ----------------------------------------------------------- synthetic images

const SCRATCH = scratchDir('img2cpc-syn-');

function makePng(name: string, w: number, h: number, seed: number, colours: [number, number, number][], transp = 0.15): string {
  const r = rng(seed);
  const img = newImage(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = colours[Math.floor(r() * colours.length)];
      setPixel(img, x, y, c[0], c[1], c[2], r() < transp ? 0 : 255);
    }
  const p = path.join(SCRATCH, name);
  fs.writeFileSync(p, encodePng(img));
  return p;
}

const rand = (seed: number, n: number): [number, number, number][] => {
  const r = rng(seed);
  return Array.from({ length: n }, () => [Math.floor(r() * 256), Math.floor(r() * 256), Math.floor(r() * 256)]);
};
const fwOnly: [number, number, number][] = [[0, 0, 0], [255, 0, 0], [0, 0, 255], [255, 255, 255], [128, 128, 0], [0, 128, 255]];
const hex12: [number, number, number][] = Array.from({ length: 12 }, (_, i) => [i * 0x11, (i * 7 % 16) * 0x11, (i * 5 % 16) * 0x11]);

describe('img2cpc.ts vs tools/img2cpc.py: synthetic images', () => {
  const cases: [string, () => string[]][] = [
    ['mode 0 auto palette', () => ['--mode', '0', makePng('m0.png', 32, 16, 1, rand(10, 9))]],
    ['mode 0 pen0', () => ['--mode', '0', '--pen0', '13', makePng('m0p.png', 16, 8, 2, rand(11, 5))]],
    ['mode 1 auto, fw colours', () => ['--mode', '1', makePng('m1.png', 40, 24, 3, fwOnly.slice(0, 4))]],
    ['mode 2 auto', () => ['--mode', '2', makePng('m2.png', 64, 8, 4, [[0, 0, 0], [255, 255, 0]])]],
    ['mode 2 fixed nearest', () => ['--mode', '2', '--palette', '1,24', makePng('m2f.png', 24, 8, 5, rand(12, 7))]],
    ['mode 1 fixed + masked + frame', () => ['--mode', '1', '--masked', '--frame', '8x8', '--palette', '0,26,6,18', makePng('m1m.png', 32, 16, 6, rand(13, 6))]],
    ['mode 0 transparent key colour', () => ['--mode', '0', '--transparent', 'ff0000', '--masked', makePng('m0t.png', 16, 8, 7, fwOnly, 0)]],
    ['mode 0 transparent key, unmasked, #', () => ['--mode', '0', '--transparent', '#0000FF', makePng('m0u.png', 16, 8, 8, fwOnly, 0)]],
    ['tiles mode 1 plain', () => ['--mode', '1', '--tiles', makePng('t1.png', 32, 16, 9, fwOnly.slice(0, 2), 0)]],
    ['tiles mode 2 dedupe', () => ['--mode', '2', '--tiles', '--dedupe', makePng('t2.png', 32, 32, 10, [[0, 0, 0]], 0)]],
    ['tiles mode 0 dedupe with repeats', () => {
      const r = rng(14), img = newImage(32, 16);
      const tile = Array.from({ length: 64 }, () => (r() < 0.5 ? 0 : 255));
      for (let t = 0; t < 8; t++)
        for (let i = 0; i < 64; i++) {
          const v = t % 3 === 0 ? tile[i] : (i + t) % 5 === 0 ? 255 : 0;
          setPixel(img, (t % 4) * 8 + (i % 8), Math.floor(t / 4) * 8 + Math.floor(i / 8), v, v, 0);
        }
      const p = path.join(SCRATCH, 'td.png');
      fs.writeFileSync(p, encodePng(img));
      return ['--mode', '0', '--tiles', '--dedupe', p];
    }],
    ['tiles mode 0 width 4', () => ['--mode', '0', '--tiles', '--tile-width', '4', makePng('tw4.png', 16, 16, 60, fwOnly, 0)]],
    ['tiles mode 0 width 2 dedupe', () => ['--mode', '0', '--tiles', '--tile-width', '2', '--dedupe', makePng('tw2.png', 8, 16, 61, fwOnly.slice(0, 2), 0)]],
    ['tiles mode 0 width 8 explicit', () => ['--mode', '0', '--tiles', '--tile-width', '8', makePng('tw8.png', 16, 8, 62, fwOnly, 0)]],
    ['tiles mode 1 width 4 and 16', () => ['--mode', '1', '--tiles', '--tile-width', '4', makePng('tw14.png', 16, 8, 63, fwOnly.slice(0, 4), 0)]],
    ['tiles mode 1 width 16 dedupe', () => ['--mode', '1', '--tiles', '--tile-width', '16', '--dedupe', makePng('tw116.png', 32, 16, 64, fwOnly.slice(0, 2), 0)]],
    ['tiles mode 2 width 32', () => ['--mode', '2', '--tiles', '--tile-width', '32', makePng('tw232.png', 64, 8, 65, [[0, 0, 0]], 0)]],
    ['name from stem', () => ['--mode', '0', makePng('1 weird-name.v2.png', 8, 8, 15, fwOnly)]],
    ['--no-palette', () => ['--mode', '1', '--no-palette', makePng('np.png', 8, 8, 16, fwOnly.slice(0, 3))]],
    ['spectrum picture', () => ['--spectrum', makePng('zx.png', 24, 16, 17, [[0, 0, 0], [215, 0, 0], [0, 255, 0], [255, 255, 255], [0, 0, 215]], 0.1)]],
    ['spectrum picture dense', () => ['--spectrum', makePng('zx2.png', 16, 16, 18, rand(19, 12), 0.3)]],
    ['spectrum zx-sprite', () => ['--spectrum', '--zx-sprite', makePng('zx3.png', 16, 8, 20, rand(21, 4))]],
    ['plus sprite sheet', () => ['--plus-sprite', makePng('ps.png', 32, 16, 22, hex12)]],
    ['plus sprite packed asm', () => ['--plus-sprite', '--packed', '--plus-format', 'asm', makePng('pa.png', 16, 16, 23, hex12.slice(0, 7))]],
    ['plus sprite fixed palette', () => ['--plus-sprite', '--palette', 'F00,0F0,00F,FFF', makePng('pf.png', 16, 16, 24, rand(25, 20))]],
    ['plus sprite transparent key', () => ['--plus-sprite', '--transparent', '000000', makePng('pt.png', 16, 16, 26, hex12.slice(0, 5), 0)]],
    ['plus palette', () => ['--plus-palette', makePng('pp.png', 16, 16, 27, hex12.slice(0, 9))]],
    ['plus palette asm fixed', () => ['--plus-palette', '--plus-format', 'asm', '--palette', '123,456', makePng('pq.png', 8, 8, 28, hex12)]],
  ];
  for (const [title, mk] of cases) {
    it(title, () => {
      same(mk());
    });
  }

  it('plus bin output: data and .pal match', () => {
    const png = makePng('pb.png', 16, 16, 29, hex12.slice(0, 6));
    const out = path.join(SCRATCH, 'pb.dat');
    const argv = ['--plus-sprite', '--plus-format', 'bin', '-o', out, png];
    const p = py('img2cpc.py', argv);
    expect(p.ok, p.stderr).toBe(true);
    const t = runCli(argv, io);
    expect(t.files).toHaveLength(2);
    expect(Buffer.from(t.files[0].data as Uint8Array).equals(fs.readFileSync(out))).toBe(true);
    expect(t.files[1].path).toBe(path.join(SCRATCH, 'pb.pal'));
    expect(Buffer.from(t.files[1].data as Uint8Array).equals(fs.readFileSync(path.join(SCRATCH, 'pb.pal')))).toBe(true);
    // palette-only bin
    const out2 = path.join(SCRATCH, 'pc.pal');
    const argv2 = ['--plus-palette', '--plus-format', 'bin', '-o', out2, png];
    expect(py('img2cpc.py', argv2).ok).toBe(true);
    const t2 = runCli(argv2, io);
    expect(t2.files).toHaveLength(1);
    expect(Buffer.from(t2.files[0].data as Uint8Array).equals(fs.readFileSync(out2))).toBe(true);
  });

  it('palette files and -o: an image written through --palette-file matches', () => {
    const pal = path.join(SCRATCH, 'p.pal');
    fs.writeFileSync(pal, '# test\n0, 26\n6 18 # more\n');
    same(['--mode', '1', '--palette-file', pal, makePng('pfile.png', 16, 8, 30, rand(31, 6))]);
  });
});

describe('img2cpc.ts vs tools/img2cpc.py: errors', () => {
  const bad: [string, () => string[]][] = [
    ['too many colours', () => ['--mode', '1', makePng('e1.png', 16, 16, 40, rand(41, 12), 0)]],
    ['width not a multiple', () => ['--mode', '0', makePng('e2.png', 9, 8, 42, fwOnly)]],
    ['tiles size', () => ['--mode', '1', '--tiles', makePng('e3.png', 12, 8, 43, fwOnly.slice(0, 2))]],
    ['masked tiles', () => ['--mode', '1', '--tiles', '--masked', makePng('e4.png', 8, 8, 44, fwOnly.slice(0, 2))]],
    ['frame size', () => ['--mode', '1', '--frame', '12x8', makePng('e5.png', 16, 8, 45, fwOnly.slice(0, 2))]],
    ['plus sprite size', () => ['--plus-sprite', makePng('e6.png', 16, 8, 46, hex12)]],
    ['plus too many colours', () => ['--plus-sprite', makePng('e7.png', 16, 16, 47, Array.from({ length: 16 }, (_, i) => [i * 17, 0, 0] as [number, number, number]), 0)]],
    ['bad palette entry', () => ['--mode', '1', '--palette', '0,27', makePng('e8.png', 8, 8, 48, fwOnly)]],
    ['too many tiles', () => ['--mode', '2', '--tiles', makePng('e9.png', 8, 8 * 257, 49, [[0, 0, 0], [255, 255, 255]], 0)]],
    ['no mode', () => [makePng('e10.png', 8, 8, 50, fwOnly)]],
    ['--tile-width without --tiles', () => ['--mode', '1', '--tile-width', '4', makePng('e12.png', 8, 8, 52, fwOnly)]],
    ['tile width 3', () => ['--mode', '1', '--tiles', '--tile-width', '3', makePng('e13.png', 12, 8, 53, fwOnly.slice(0, 2))]],
    ['tile width 4 in mode 2', () => ['--mode', '2', '--tiles', '--tile-width', '4', makePng('e14.png', 16, 8, 54, [[0, 0, 0]])]],
    ['tile width 16 in mode 0', () => ['--mode', '0', '--tiles', '--tile-width', '16', makePng('e15.png', 16, 8, 55, fwOnly)]],
    ['tile width not an int', () => ['--mode', '1', '--tiles', '--tile-width', 'x', makePng('e16.png', 16, 8, 56, fwOnly.slice(0, 2))]],
    ['tile image width not a multiple of the tile width', () => ['--mode', '0', '--tiles', '--tile-width', '4', makePng('e17.png', 10, 8, 57, fwOnly)]],
    ['tile image height with a narrow tile', () => ['--mode', '0', '--tiles', '--tile-width', '4', makePng('e18.png', 8, 12, 58, fwOnly)]],
    ['--dedupe without --tiles', () => ['--mode', '1', '--dedupe', makePng('e11.png', 8, 8, 51, fwOnly)]],
  ];
  for (const [title, mk] of bad) {
    it(title, () => {
      const argv = mk();
      expect(py('img2cpc.py', argv).ok).toBe(false);
      expect(() => runCli(argv, io)).toThrow(Img2cpcError);
    });
  }
});

// ----------------------------------------------------------- sidecar and --check

describe('img2cpc.ts vs tools/img2cpc.py: the sidecar', () => {
  const dir = scratchDir('img2cpc-side-');
  let n = 0;
  /** A PNG with a sidecar beside it; returns the PNG path. */
  function withSide(w: number, h: number, side: object | string, colours = fwOnly.slice(0, 4), transp = 0.15): string {
    const stem = `s${n++}`;
    const png = makePng(`${stem}.png`, w, h, 70 + n, colours, transp);
    const png2 = path.join(dir, `${stem}.png`);
    fs.copyFileSync(png, png2);
    fs.writeFileSync(path.join(dir, `${stem}.cpcbuild.json`), typeof side === 'string' ? side : JSON.stringify({ format: 'cpcbuild-image', version: 1, ...side }));
    return png2;
  }
  const hero = { kind: 'sprite', mode: 0, name: 'hero', frame: '8x8', masked: false, palette: [1, 24, 20, 6] };

  it('sprite with tags needs no other options', () => {
    const text = same([withSide(32, 16, { ...hero, tags: [{ name: 'walk', from: 0, to: 2 }, { name: 'idle-1 b', from: 3, to: 3 }] })]);
    expect(text).toContain('CONST hero_WALK AS UBYTE = 0');
    expect(text).toContain('CONST hero_IDLE_1_B_LEN AS UBYTE = 1');
    expect(text.split('\n')[0]).toMatch(/\(settings from s\d+\.cpcbuild\.json\)$/);
  });

  it('masked sprite, and mode 1', () => {
    same([withSide(32, 16, { kind: 'sprite', mode: 1, frame: '8x8', masked: true, palette: [0, 26, 6, 18], tags: [] })]);
  });

  it('tiles with tileWidth 4 (and 8, which adds nothing)', () => {
    const text = same([withSide(16, 16, { kind: 'tiles', mode: 0, name: 'ground', tileWidth: 4, palette: [1, 24, 20, 6] })]);
    expect(text).toContain('CONST ground_TILEW AS UBYTE = 2');
    same([withSide(16, 16, { kind: 'tiles', mode: 0, tileWidth: 8 })]);
  });

  it('the command line wins over the sidecar', () => {
    const p = withSide(32, 16, { ...hero, masked: true, tags: [{ name: 'a', from: 0, to: 1 }] });
    same(['--mode', '1', '--name', 'x', '--frame', '16x8', p]);
    same(['--palette', '1,24,20,6', '--name', 'y', p]);
    same(['--palette-file', `${A}/bounce.pal`, p]);
    same(['--tiles', p]);
    same(['--no-sidecar', '--mode', '0', p]);
    const t = withSide(16, 16, { kind: 'tiles', mode: 0, tileWidth: 4, palette: [1, 24, 20, 6] });
    same(['--sprite', t]);
    same(['--dedupe', t]);
  });

  it('spectrum and plus never read it', () => {
    const p = withSide(16, 16, { ...hero, tags: [{ name: 'a', from: 9, to: 9 }] });
    same(['--spectrum', p]);
    same(['--plus-palette', p]);
  });

  it('bad sidecars give the same message', () => {
    const cases: (object | string)[] = [
      '{', '[1]', { format: 'other' }, { version: 2 }, { version: '1' }, { kind: 'map' }, { mode: 3 }, { mode: true }, { name: '' },
      { frame: '16' }, { frame: 16 }, { masked: 'yes' }, { tileWidth: 0 }, { tileWidth: '8' }, { palette: [1, 27] }, { palette: '1,2' },
      { tags: [{ name: 'a', from: 0 }] }, { tags: {} }, { tags: [{ name: 'x', from: 0, to: 4 }] }, { tags: [{ name: 'x', from: 3, to: 2 }] },
      { tags: [{ name: 'a b', from: 0, to: 1 }, { name: 'a_b', from: 2, to: 3 }] }, { tags: [{ name: 'w', from: 0, to: 1 }] },
      { tags: [{ name: 'x', from: 0, to: 1 }, { name: 'x len', from: 2, to: 3 }] },
    ];
    for (const c of cases) {
      const p = withSide(32, 8, typeof c === 'string' ? c : { ...hero, ...c });
      const msg = sameError([p]);
      expect(msg).toContain('.cpcbuild.json: ');
    }
    const noVersion = withSide(32, 8, JSON.stringify({ format: 'cpcbuild-image', mode: 0 }));
    sameError([noVersion]);
  }, 30_000); // 24 runs of the Python tool: about 5 s, the default limit
});

describe('img2cpc.ts vs tools/img2cpc.py: --check', () => {
  const dir = scratchDir('img2cpc-check-');
  let n = 0;
  const png = (w: number, h: number, colours: [number, number, number][], transp = 0): string => {
    const p = path.join(dir, `c${n++}.png`);
    fs.copyFileSync(makePng('chk.png', w, h, 90 + n, colours, transp), p);
    return p;
  };
  const dark: [number, number, number][] = [[0, 0, 255], [127, 0, 0], [255, 0, 0], [0, 30, 0]];

  it('sprite', () => {
    const text = same(['--check', '--mode', '0', '--frame', '8x4', png(16, 8, dark)]);
    expect(text).toMatch(/^check: .* 16x8 pixels, mode 0, sprite\n {2}frames: 4 of 8x4 pixels \(4 bytes x 4 lines, 16 bytes each\)\n {2}pens: /);
    expect(text).toContain('  colours moved: ');
    expect(text.endsWith('  total: 64 bytes\n  ok\n')).toBe(true);
  });

  it('transparent pixels, unmasked and masked', () => {
    expect(same(['--check', '--mode', '1', png(16, 8, fwOnly.slice(0, 3), 0.3)])).toContain('  transparent pixels: ');
    expect(same(['--check', '--mode', '1', '--masked', png(16, 8, fwOnly.slice(0, 3), 0.3)])).not.toContain('transparent');
  });

  it('tiles: repeats, dedupe, widths', () => {
    const p = png(32, 16, [[255, 0, 0]], 0);
    expect(same(['--check', '--mode', '0', '--tiles', '--tile-width', '4', p])).toContain('(--dedupe would drop them)');
    expect(same(['--check', '--mode', '0', '--tiles', '--tile-width', '4', '--dedupe', p])).toContain(' dropped\n');
    same(['--check', '--mode', '1', '--tiles', p]);
    same(['--check', '--mode', '2', '--tiles', '--tile-width', '16', '--dedupe', png(32, 16, [[0, 0, 0], [255, 255, 255]], 0)]);
    const one = png(16, 8, [[255, 0, 0]], 0);
    expect(same(['--check', '--mode', '1', '--tiles', one])).toContain(', 1 repeat (--dedupe would drop it)\n');
  });

  it('with a sidecar', () => {
    const p = png(32, 8, dark, 0.2);
    fs.writeFileSync(p.replace(/\.png$/, '.cpcbuild.json'), JSON.stringify({ format: 'cpcbuild-image', version: 1, kind: 'sprite', mode: 0, frame: '8x8', palette: [2, 3, 6, 18] }));
    const text = same(['--check', p]);
    expect(text).toContain(`  sidecar: ${p.replace(/\.png$/, '.cpcbuild.json')}\n`);
  });

  it('writes nothing, even with --write-palette (the port returns no files)', () => {
    const p = png(16, 8, fwOnly.slice(0, 3));
    const argv = ['--check', '--mode', '1', '--write-palette', path.join(dir, 'w.pal'), p];
    expect(runCli(argv, io).files).toEqual([]);
    expect(py('img2cpc.py', argv).ok).toBe(true);
    expect(fs.existsSync(path.join(dir, 'w.pal'))).toBe(false);
  });

  it('same errors as a conversion, and usage errors', () => {
    sameError(['--check', '--mode', '1', png(16, 16, rand(41, 12))]);
    sameError(['--check', '--mode', '0', png(9, 8, fwOnly)]);
    expect(sameError(['--check', '--mode', '1', '-o', path.join(dir, 'x.bas'), png(8, 8, fwOnly)])).toBe('--check writes nothing; leave out -o');
    sameError(['--check', '--spectrum', png(8, 8, fwOnly)]);
    sameError(['--check', '--plus-sprite', png(16, 16, fwOnly)]);
  });
});

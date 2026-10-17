/** Byte-compares tmx.ts with tools/tmx2bas.py on the repo's maps and on synthetic ones. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { defaultMapName, parseTmx, parseXml, tmxToBas } from './tmx';
import { py, REPO, scratchDir } from './testutil';

/** Mini CLI for the test: tmx2bas.py's flags -> tmxToBas, argv recorded as given. */
function ts(argv: string[]): string {
  const f = argv.find((a, i) => /\.tmx$/.test(a) && argv[i - 1] !== '-o')!;
  const opt = (k: string): string | undefined => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const map = parseTmx(fs.readFileSync(path.resolve(REPO, f), 'utf8'));
  return tmxToBas(
    map,
    opt('--name') ?? defaultMapName(f),
    {
      layer: opt('--layer'),
      firstgid: opt('--firstgid') !== undefined ? Number(opt('--firstgid')) : undefined,
      empty: opt('--empty') !== undefined ? Number(opt('--empty')) : undefined,
    },
    argv,
    f,
  );
}

function same(argv: string[]): string {
  const p = py('tmx2bas.py', argv);
  expect(p.ok, p.stderr).toBe(true);
  expect(ts(argv)).toBe(p.stdout);
  return p.stdout;
}

describe('tmx.ts vs tools/tmx2bas.py: repo maps', () => {
  for (const [f, name] of [['examples/assets/level.tmx', 'level'], ['tests/conformance/assets/level.tmx', 'a_map']] as const) {
    it(f, () => {
      const out = same(['--name', name, f]);
      // the committed .bas was generated with the same flags plus -o <same dir>/level.bas
      const bas = f.replace('.tmx', '.bas');
      expect(ts(['--name', name, f, '-o', bas])).toBe(fs.readFileSync(path.join(REPO, bas), 'utf8'));
      expect(out.length).toBeGreaterThan(0);
      const m = parseTmx(fs.readFileSync(path.join(REPO, f), 'utf8'));
      expect(m.layers[0].gids).not.toBeNull();
      expect(m.width * m.height).toBe(m.layers[0].gids!.length);
    });
    it(`${f}: default name and options`, () => {
      same([f]);
      same(['--empty', '9', '--firstgid', '1', f]);
    });
  }
});

const dir = scratchDir('tmx-');

function tmx(name: string, w: number, h: number, gids: number[], enc: 'csv' | 'raw' | 'zlib' | 'gzip', extra = ''): string {
  const buf = Buffer.alloc(gids.length * 4);
  gids.forEach((g, i) => buf.writeUInt32LE(g >>> 0, i * 4));
  let data: string;
  if (enc === 'csv') data = `<data encoding="csv">\n${gids.map((g) => g >>> 0).join(',\n')}\n</data>`;
  else {
    const bytes = enc === 'raw' ? buf : enc === 'zlib' ? zlib.deflateSync(buf) : zlib.gzipSync(buf);
    data = `<data encoding="base64"${enc === 'raw' ? '' : ` compression="${enc}"`}>\n  ${bytes.toString('base64')}\n</data>`;
  }
  const p = path.join(dir, name);
  fs.writeFileSync(p, `<?xml version="1.0" encoding="UTF-8"?>\n<!-- c -->\n<map version="1.10" orientation="orthogonal" width="${w}" height="${h}" tilewidth="8" tileheight="8">\n <tileset firstgid="${extra ? 5 : 1}" name="t&amp;s" tilewidth="8" tileheight="8"><image source="t.png" width="64" height="64"/></tileset>\n <layer id="1" name="Ground" width="${w}" height="${h}">\n  ${data}\n </layer>\n <layer id="2" name="Top" width="${w}" height="${h}">\n  <data encoding="csv">${gids.map(() => 0).join(',')}</data>\n </layer>\n</map>\n`);
  return p;
}

describe('tmx.ts vs tools/tmx2bas.py: synthetic maps', () => {
  const gids = Array.from({ length: 6 * 5 }, (_, i) => (i % 7 === 0 ? 0 : (i % 13) + 1));
  for (const enc of ['csv', 'raw', 'zlib', 'gzip'] as const) {
    it(`encoding ${enc}`, () => {
      same([tmx(`m-${enc}.tmx`, 6, 5, gids, enc)]);
    });
  }
  it('flip flags are stripped', () => {
    const g = gids.map((v, i) => (v ? (v | (i % 2 ? 0x80000000 : 0x40000000) | (i % 3 ? 0x20000000 : 0)) >>> 0 : 0));
    same([tmx('flags.tmx', 6, 5, g, 'zlib')]);
  });
  it('--layer, --empty, --firstgid, --name', () => {
    const p = tmx('opts.tmx', 6, 5, gids.map((v) => (v ? v + 4 : 0)), 'csv', 'fg5');
    same(['--layer', 'Top', '--empty', '3', p]);
    same(['--layer', 'Ground', '--name', 'my_map', p]);
    same(['--firstgid', '2', '--name', 'x', p]);
  });
  it('errors agree', () => {
    const big = tmx('big.tmx', 6, 5, gids.map((v) => (v ? v + 300 : 0)), 'csv');
    expect(py('tmx2bas.py', [big]).ok).toBe(false);
    expect(() => ts([big])).toThrow();
    const low = tmx('low.tmx', 6, 5, gids, 'csv', 'fg5');
    expect(py('tmx2bas.py', [low]).ok).toBe(false);
    expect(() => ts([low])).toThrow();
    const ok = tmx('nl.tmx', 6, 5, gids, 'csv');
    expect(py('tmx2bas.py', ['--layer', 'Nope', ok]).ok).toBe(false);
    expect(() => ts(['--layer', 'Nope', ok])).toThrow();
  });
});

describe('parseXml', () => {
  it('attributes, entities, CDATA, self-closing', () => {
    const r = parseXml(`<?xml version="1.0"?><!DOCTYPE x><a k='1' m="&lt;&#65;&#x42;">t<![CDATA[<z>]]><b/><c>u</c></a>`);
    expect(r.attrs).toEqual({ k: '1', m: '<AB' });
    expect(r.text).toBe('t<z>');
    expect(r.children.map((c) => c.tag)).toEqual(['b', 'c']);
  });
  it('rejects broken documents', () => {
    expect(() => parseXml('<a><b></a>')).toThrow();
    expect(() => parseXml('<a>')).toThrow();
  });
});

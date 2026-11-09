/** The viewer's model: cells, errors, atlases and rendering a layer to a pixel buffer. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePng, type RgbaImage } from './image';
import { posixSlashes } from './pathtext';
import { layerTiles, parseTmx, parseTsx, TmxError } from './tmx';
import { mergeNote, pensLabel, PIXEL_SHAPE } from './cpcPreview';
import {
  atlasesUsed, cellAspect, cpcImage, nextProblem, reducedOf, roomLabel, summariseReduced, summaryNote, summaryPens, worstSummary,
  atlasFromImage, atlasFromPens, cellErrors, cellInfo, doTile8Call, effectiveFirstgid, FLIP_D, FLIP_H, FLIP_V, flagNames, layerWarnings, renderLayer, tileMapCall, tilesetOfGid, tileSizeNotice,
} from './tmxView';
import { py, REPO, scratchDir } from './testutil';

/** A tileset image of `n` 2x2 tiles in a row; tile k has four distinct pixels: (k, 0..3). */
function strip(n: number, opts: { margin?: number; spacing?: number } = {}): RgbaImage {
  const m = opts.margin ?? 0;
  const sp = opts.spacing ?? 0;
  const w = 2 * m + n * 2 + (n - 1) * sp;
  const h = 2 * m + 2;
  const data = new Uint8Array(w * h * 4);
  data.fill(255); // the margin and spacing are opaque white
  for (let k = 0; k < n; k++) {
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const i = ((m + y) * w + m + k * (2 + sp) + x) * 4;
        data.set([k + 1, y * 2 + x + 1, 0, 255], i);
      }
    }
  }
  return { width: w, height: h, data };
}

const px = (img: RgbaImage, x: number, y: number): number[] => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

function mapXml(gids: number[], w: number, h: number, extra = ''): string {
  return `<map width="${w}" height="${h}" tilewidth="2" tileheight="2"><tileset firstgid="1" name="t" tilewidth="2" tileheight="2" tilecount="3" columns="3"><image source="t.png" width="6" height="2"/></tileset>${extra}<layer id="1" name="L" width="${w}" height="${h}"><data encoding="csv">${gids.join(',')}</data></layer></map>`;
}

describe('atlasFromImage', () => {
  it('cuts a plain strip', () => {
    const a = atlasFromImage(strip(3), { tw: 2, th: 2, firstgid: 1, columns: 3, count: 3 });
    expect([a.count, a.columns, a.width, a.height]).toEqual([3, 3, 6, 2]);
    expect(px({ width: a.width, height: a.height, data: a.rgba }, 2, 1)).toEqual([2, 3, 0, 255]);
  });
  it('removes margin and spacing', () => {
    const a = atlasFromImage(strip(3, { margin: 1, spacing: 1 }), { tw: 2, th: 2, margin: 1, spacing: 1, firstgid: 1, columns: 3, count: 3 });
    const plain = atlasFromImage(strip(3), { tw: 2, th: 2, firstgid: 1, columns: 3, count: 3 });
    expect([...a.rgba]).toEqual([...plain.rgba]);
  });
  it('works out columns and count from the image when the tileset does not say', () => {
    const a = atlasFromImage(strip(4), { tw: 2, th: 2, firstgid: 1 });
    expect([a.count, a.columns]).toEqual([4, 4]);
  });
});

describe('renderLayer', () => {
  const atlas = atlasFromImage(strip(3), { tw: 2, th: 2, firstgid: 1, columns: 3, count: 3 });

  it('draws each cell with its tile; empty cells stay transparent', () => {
    const img = renderLayer([1, 0, 3, 2], 2, 2, 2, 2, [atlas]);
    expect([img.width, img.height]).toEqual([4, 4]);
    expect(px(img, 0, 0)).toEqual([1, 1, 0, 255]); // tile 1 (index 0), pixel (0,0)
    expect(px(img, 3, 0)).toEqual([0, 0, 0, 0]); // the empty cell
    expect(px(img, 2, 0)).toEqual([0, 0, 0, 0]);
    expect(px(img, 0, 2)).toEqual([3, 1, 0, 255]); // gid 3 -> index 2
    expect(px(img, 3, 3)).toEqual([2, 4, 0, 255]); // gid 2 -> index 1, pixel (1,1)
  });
  it('flips like Tiled: horizontal, vertical, diagonal', () => {
    const at = (flag: number): RgbaImage => renderLayer([(1 | flag) >>> 0], 1, 1, 2, 2, [atlas]);
    // tile 0 pixels: (0,0)=1 (1,0)=2 (0,1)=3 (1,1)=4 in the green channel
    const green = (img: RgbaImage): number[] => [px(img, 0, 0)[1], px(img, 1, 0)[1], px(img, 0, 1)[1], px(img, 1, 1)[1]];
    expect(green(at(0))).toEqual([1, 2, 3, 4]);
    expect(green(at(FLIP_H))).toEqual([2, 1, 4, 3]);
    expect(green(at(FLIP_V))).toEqual([3, 4, 1, 2]);
    expect(green(at(FLIP_D))).toEqual([1, 3, 2, 4]);
    expect(green(at(FLIP_H + FLIP_V))).toEqual([4, 3, 2, 1]);
    // diagonal then horizontal = rotate 90 degrees clockwise
    expect(green(at(FLIP_D + FLIP_H))).toEqual([3, 1, 4, 2]);
  });
  it('leaves a gid no atlas covers as background', () => {
    const img = renderLayer([9], 1, 1, 2, 2, [atlas], { background: [10, 20, 30, 255] });
    expect(px(img, 1, 1)).toEqual([10, 20, 30, 255]);
  });
  it('picks the atlas of the right tileset', () => {
    const b = atlasFromImage(strip(3), { tw: 2, th: 2, firstgid: 11, columns: 3, count: 3 });
    const img = renderLayer([1, 11], 2, 1, 2, 2, [atlas, b]);
    expect(px(img, 0, 0)).toEqual([1, 1, 0, 255]);
    expect(px(img, 2, 0)).toEqual([1, 1, 0, 255]);
  });
  it('renders a .cpctil-style atlas from pens', () => {
    const a = atlasFromPens([[[0, 1], [-1, 1]], [[1, 1], [1, 1]]], (pen) => (pen === 0 ? [255, 0, 0] : [0, 0, 255]), 5);
    const img = renderLayer([5, 6], 2, 1, 2, 2, [a]);
    expect(px(img, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(img, 0, 1)).toEqual([0, 0, 0, 0]);
    expect(px(img, 2, 0)).toEqual([0, 0, 255, 255]);
  });
  it('renders a 4x8 tile set (a narrow .cpctil) in 4x8 cells', () => {
    const col = (pen: number) => Array.from({ length: 8 }, () => [pen, pen, pen, pen]);
    const a = atlasFromPens([col(0), col(1)], (pen) => (pen === 0 ? [255, 0, 0] : [0, 0, 255]), 1);
    expect([a.tw, a.th, a.width, a.height]).toEqual([4, 8, 8, 8]);
    const img = renderLayer([1, 2, 2, 1], 2, 2, 4, 8, [a]);
    expect([img.width, img.height]).toEqual([8, 16]);
    expect(px(img, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(img, 3, 7)).toEqual([255, 0, 0, 255]);
    expect(px(img, 4, 0)).toEqual([0, 0, 255, 255]);
    expect(px(img, 0, 8)).toEqual([0, 0, 255, 255]);
    expect(px(img, 7, 15)).toEqual([255, 0, 0, 255]);
  });
  it('says when the tile set and the map disagree on the tile size', () => {
    expect(tileSizeNotice(8, 8, 8, 8)).toBeUndefined();
    expect(tileSizeNotice(4, 8, 8, 8)).toMatch(/4x8 but the map's cells are 8x8/);
  });
  it('renders the repo map with its tileset image (examples/assets/level.tmx)', () => {
    const dir = path.join(REPO, 'examples/assets');
    const map = parseTmx(fs.readFileSync(path.join(dir, 'level.tmx'), 'utf8'));
    const ts = map.tilesets[0];
    const a = atlasFromImage(decodePng(new Uint8Array(fs.readFileSync(path.join(dir, ts.image!.source)))), { tw: ts.tilewidth!, th: ts.tileheight!, columns: ts.columns, count: ts.tilecount, firstgid: ts.firstgid });
    const l = map.layers[0];
    const img = renderLayer(l.gids!, l.width, l.height, map.tilewidth, map.tileheight, [a]);
    expect([img.width, img.height]).toEqual([160, 200]);
    // cell (1,1) holds gid 1: its pixels are tile 0 of the atlas
    const gid = l.gids![l.width + 1];
    const k = gid - ts.firstgid;
    for (const [x, y] of [[0, 0], [3, 4], [7, 7]]) expect(px(img, 8 + x, 8 + y)).toEqual([...a.rgba.subarray(((Math.floor(k / a.columns) * 8 + y) * a.width + (k % a.columns) * 8 + x) * 4, ((Math.floor(k / a.columns) * 8 + y) * a.width + (k % a.columns) * 8 + x) * 4 + 4)]);
  });
  it('renders a 255 x 255 map of 16 x 16 tiles well inside the 500 ms budget', () => {
    const n = 255;
    const big = atlasFromImage({ width: 64, height: 16, data: new Uint8Array(64 * 16 * 4).fill(200) }, { tw: 16, th: 16, firstgid: 1, columns: 4, count: 4 });
    const gids = Array.from({ length: n * n }, (_, i) => 1 + (i % 4));
    const t0 = performance.now();
    const img = renderLayer(gids, n, n, 16, 16, [big]);
    const ms = performance.now() - t0;
    expect(img.width).toBe(n * 16);
    expect(ms).toBeLessThan(500);
  });
});

describe('cells, errors and warnings', () => {
  it('flag names', () => {
    expect(flagNames(((5 | FLIP_H | FLIP_D) >>> 0))).toEqual(['flipX', 'flipDiagonal']);
    expect(flagNames(5)).toEqual([]);
  });
  const map = parseTmx(mapXml([1, 0, (3 | FLIP_H) >>> 0, 300, 2, 1], 3, 2));
  it('cellInfo: gid, flags, tile number', () => {
    const l = map.layers[0];
    expect(cellInfo(map, l, 0, 0)).toMatchObject({ gid: 1, tile: 0, empty: false, flags: [], tileset: 0 });
    expect(cellInfo(map, l, 1, 0)).toMatchObject({ gid: 0, tile: 0, empty: true });
    expect(cellInfo(map, l, 1, 0, { empty: 7 })?.tile).toBe(7);
    expect(cellInfo(map, l, 2, 0)).toMatchObject({ gid: 3, tile: 2, flags: ['flipX'] });
    expect(cellInfo(map, l, 0, 1, { firstgid: 2 })?.error).toBe('cell 0,1: tile number 298 does not fit in a byte');
    expect(cellInfo(map, l, 0, 0, { firstgid: 2 })?.error).toBe('cell 0,0: gid 1 is below firstgid 2');
    expect(cellInfo(map, l, 5, 5)).toBeUndefined();
  });
  it('the error texts are the converter\'s', () => {
    const l = map.layers[0];
    expect(cellErrors(map, l)).toEqual([{ x: 0, y: 1, message: 'cell 0,1: tile number 299 does not fit in a byte' }]);
    const e2 = cellErrors(map, l, { firstgid: 2 });
    expect(e2.map((e) => e.message)).toContain('cell 0,0: gid 1 is below firstgid 2');
    // layerTiles (the tool port) throws the first of these
    expect(() => layerTiles(map)).toThrow(new TmxError('cell 0,1: tile number 299 does not fit in a byte'));
  });
  it('the error texts equal tmx2bas.py\'s', () => {
    const dir = scratchDir('tmxview-');
    const f = path.join(dir, 'e.tmx');
    fs.writeFileSync(f, mapXml([1, 0, 3, 300, 2, 1], 3, 2));
    const r = py('tmx2bas.py', [f]);
    expect(r.ok).toBe(false);
    const first = cellErrors(parseTmx(fs.readFileSync(f, 'utf8')), parseTmx(fs.readFileSync(f, 'utf8')).layers[0])[0];
    expect(r.stderr.trim()).toBe(`tmx2bas: ${posixSlashes(f)}: ${first.message}`);
    const r2 = py('tmx2bas.py', ['--firstgid', '2', f]);
    const m = parseTmx(fs.readFileSync(f, 'utf8'));
    expect(r2.stderr.trim()).toBe(`tmx2bas: ${posixSlashes(f)}: ${cellErrors(m, m.layers[0], { firstgid: 2 })[0].message}`);
  });
  it('warns about opacity, offsets and tiles of a later tileset', () => {
    const m = parseTmx(
      '<map width="2" height="1" tilewidth="2" tileheight="2"><tileset firstgid="1" tilewidth="2" tileheight="2"/><tileset firstgid="10" tilewidth="2" tileheight="2"/>' +
        '<layer name="L" width="2" height="1" opacity="0.5" offsetx="3"><data encoding="csv">1,12</data></layer></map>',
    );
    const w = layerWarnings(m, m.layers[0]);
    expect(w.some((x) => /opacity 0\.5 is ignored/.test(x))).toBe(true);
    expect(w.some((x) => /offset \(3, 0\) is ignored/.test(x))).toBe(true);
    expect(w.some((x) => /later tileset \(gid 12\)/.test(x))).toBe(true);
    expect(tilesetOfGid(m, 12)).toBe(1);
    expect(tilesetOfGid(m, 5)).toBe(0);
    expect(layerWarnings(map, map.layers[0])).toEqual([]);
  });
  it('effectiveFirstgid follows the tool', () => {
    expect(effectiveFirstgid(map)).toBe(1);
    expect(effectiveFirstgid(map, { firstgid: 4 })).toBe(4);
  });
});

describe('parsing the extra information', () => {
  it('reads tileset images, objects and external tilesets', () => {
    const m = parseTmx(
      '<map width="1" height="1" tilewidth="8" tileheight="8" infinite="0"><tileset firstgid="1" source="ts.tsx"/>' +
        '<tileset firstgid="5" name="b" tilewidth="8" tileheight="8" tilecount="4" columns="2" margin="1" spacing="2"><image source="b.png" width="20" height="20"/></tileset>' +
        '<layer name="L" width="1" height="1"><data encoding="csv">1</data></layer>' +
        '<objectgroup name="things"><object id="1" name="start" type="spawn" x="8" y="16"><point/></object><object id="2" x="0" y="0" width="16" height="8"/></objectgroup></map>',
    );
    expect(m.tilesets[1]).toMatchObject({ margin: 1, spacing: 2, columns: 2, image: { source: 'b.png', width: 20 } });
    expect(m.objectGroups[0].objects.map((o) => [o.name, o.type, o.shape])).toEqual([['start', 'spawn', 'point'], ['', '', 'rect']]);
    expect(parseTsx('<tileset name="x" tilewidth="8" tileheight="8" columns="3"><image source="i.png"/></tileset>')).toMatchObject({ name: 'x', columns: 3, image: { source: 'i.png' } });
    expect(() => parseTsx('<map/>')).toThrow(/not a Tiled tileset/);
  });
});

describe('snippets', () => {
  it('DoTile8 and TileMap calls', () => {
    expect(doTile8Call(12, 7, 20)).toBe('DoTile8(12, 7, 20)');
    expect(tileMapCall('level')).toBe('TileMap(@level(0), 0, 0, level_W, level_H)');
    expect(tileMapCall('level', 2, 3)).toBe('TileMap(@level(0), 2, 3, level_W, level_H)');
  });
});


describe('CPC mode cells', () => {
  it('takes the pixel shape in a CPC mode and stays square otherwise', () => {
    expect([0, 1, 2].map((m) => cellAspect('cpc', m as 0 | 1 | 2))).toEqual([PIXEL_SHAPE[0], PIXEL_SHAPE[1], PIXEL_SHAPE[2]]);
    expect([cellAspect('cpc', 0), cellAspect('cpc', 1), cellAspect('cpc', 2)]).toEqual([2, 1, 0.5]);
    expect(cellAspect('image', 0)).toBe(1);
    expect(cellAspect('cpctil', 2)).toBe(1);
  });

  /** 1 x 6 image: six distinct firmware colours (one pixel each, the first twice) */
  const six = (): { width: number; height: number; data: Uint8Array } => {
    const cols = [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 0, 0]];
    const data = new Uint8Array(cols.length * 4);
    cols.forEach((c, i) => data.set([c[0], c[1], c[2], 255], i * 4));
    return { width: cols.length, height: 1, data };
  };

  it('reduces a tileset image to the mode instead of failing, and reports it', () => {
    const { image, reduced } = cpcImage(six(), 1);
    expect(reduced.used).toBe(6);
    expect(reduced.fits).toBe(false);
    expect(reduced.merges).toHaveLength(2);
    expect(new Set(Array.from({ length: 7 }, (_, i) => px(image, i, 0).join(','))).size).toBe(4);
    const s = summariseReduced(1, reduced);
    expect(s).toMatchObject({ firstgid: 1, mode: 1, limit: 4, used: 6, fits: false });
    expect(s.merges.map((m) => m.pixels)).toEqual([1, 1]);
    expect(summaryNote(s)).toBe(mergeNote(reduced));
    expect(summaryPens(s)).toBe(pensLabel(reduced));
    expect(reducedOf(s).kept).toHaveLength(4);
  });

  it('leaves an image that fits alone, transparency included', () => {
    const img = six();
    img.data[3] = 0;
    const { image, reduced } = cpcImage(img, 0);
    expect(reduced.fits).toBe(true);
    expect(summaryNote(summariseReduced(1, reduced))).toBe('fits: 6 colours');
    expect(px(image, 0, 0)[3]).toBe(0);
    expect(px(image, 1, 0)).toEqual([255, 255, 255, 255]);
  });

  it('picks the summary to show: a tileset that does not fit, else the busiest', () => {
    const mk = (firstgid: number, used: number, fits: boolean) => ({ firstgid, mode: 1 as const, limit: 4, used, fits, merges: [] });
    expect(worstSummary([])).toBeUndefined();
    expect(worstSummary([mk(1, 3, true), mk(9, 4, true)])?.firstgid).toBe(9);
    expect(worstSummary([mk(1, 3, true), mk(9, 6, false), mk(20, 5, false)])?.firstgid).toBe(9);
  });

  it('finds the atlases a layer draws from', () => {
    const at = [{ firstgid: 1, count: 4 }, { firstgid: 10, count: 4 }];
    expect(atlasesUsed([0, 2, 3], at).map((a) => a.firstgid)).toEqual([1]);
    expect(atlasesUsed([1, 11], at).map((a) => a.firstgid)).toEqual([1, 10]);
    expect(atlasesUsed([0, 0], at)).toHaveLength(2);
    expect(atlasesUsed([0x80000000 + 11], at).map((a) => a.firstgid)).toEqual([10]);
  });
});

describe('problems and rooms', () => {
  const ps = [{ x: 1, y: 0 }, { x: 3, y: 2 }, { x: 0, y: 4 }];
  it('moves to the next problem in reading order and wraps', () => {
    expect(nextProblem([], 5, null)).toBeUndefined();
    expect(nextProblem(ps, 5, null)).toEqual(ps[0]);
    expect(nextProblem(ps, 5, { x: 1, y: 0 })).toEqual(ps[1]);
    expect(nextProblem(ps, 5, { x: 4, y: 3 })).toEqual(ps[2]);
    expect(nextProblem(ps, 5, { x: 0, y: 4 })).toEqual(ps[0]);
  });
  it('labels rooms from 1 in reading order', () => {
    expect(roomLabel(0, 0, 3, 20, 16)).toBe('Room 1 \u00b7 20 \u00d7 16');
    expect(roomLabel(2, 1, 3, 20, 16)).toBe('Room 6 \u00b7 20 \u00d7 16');
  });
});
